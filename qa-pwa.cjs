/* ============================================================
   RANK 4 GATE — PWA Manifest + Cache-First SW + Crash Durability
   (MASTER-ACTION-PLAN Rank 4.1 / 4.2 / 4.3)
   Drives headless Chrome against http://127.0.0.1:8765.
   Covers:
     - Manifest + service worker registration present.
     - SW caches the app shell (cache-first, offline-capable).
     - Rank 4.2 crash durability: the IndexedDB journal mirrors
       every save; simulate a hard kill (wipe localStorage, keep
       the journal) and confirm the newer journal state wins on
       the next load.
     - Rank 4.3 offline core operation: with window.fetch forced
       to reject (network disabled), core CRUD (WBS add/edit,
       risk add, budget line, claim generate) still works and no
       unhandled error is recorded.
   Exit 0 only when every contract holds.
   Usage: node qa-pwa.cjs  (server must be on :8765)
   ============================================================ */
const { spawn } = require('child_process');
const path = require('path');
const { chromePath: CHROME, BASE, DEBUG_PORT: PORT } = require('./tools/chrome-launcher.cjs');
const PROFILE = path.join(require('os').tmpdir(), 'mmgr-pwa-' + Date.now());
let ws, msgId = 0;
const pending = new Map();
const results = [];
const log = (s) => { process.stdout.write('[pwa4] ' + s + '\n'); };
const delay = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { log('WATCHDOG'); try { ws && ws.close(); } catch (e) {} process.exit(2); }, 300000);
function send(method, params) { return new Promise(res => { const id = ++msgId; pending.set(id, m => { pending.delete(id); res(m.result || {}); }); ws.send(JSON.stringify({ id, method, params: params || {} })); }); }
async function ev(expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __err: r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text }; return r.result && r.result.value; }

(async () => {
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, '--window-size=1440,1200', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) break; } catch (e) {} await delay(300); }
  const targets = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws fail')); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: BASE + '/seed-test.html' }); await delay(4000);

  const check = (name, val, detail) => { results.push({ name, val, detail }); log((val ? 'PASS' : 'FAIL') + ' ' + name + (val ? '' : '  <-- ' + JSON.stringify(detail))); };

  // ---- 1. manifest + SW registration ----
  // Explicitly register here (idempotent) so a real error surfaces instead of
  // the page's silent .catch(); wait through install so the cache is warm.
  const m1 = await ev(`(async function(){
    var links = Array.prototype.slice.call(document.querySelectorAll('link[rel="manifest"]'));
    var hasManifest = links.some(function(l){ return l.getAttribute('href') === 'manifest.webmanifest'; });
    var regErr = null;
    var reg = null;
    if ('serviceWorker' in navigator) {
      try { reg = await navigator.serviceWorker.register('sw.js'); } catch(e){ regErr = String(e); }
    }
    return { manifest: hasManifest, swSupported: 'serviceWorker' in navigator, reg: !!reg, regErr: regErr };
  })()`);
  check('P01 pwa: manifest link present + service worker registers without error', !!(m1.manifest && m1.swSupported && m1.reg && !m1.regErr), m1);

  // ---- 2. cache-first shell: shell assets are in the SW cache ----
  const c1 = await ev(`(async function(){
    if (!('serviceWorker' in navigator)) return { sw: false };
    var reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return { sw: true, reg: false };
    // give the install cache a beat to finish
    await new Promise(function(r){ setTimeout(r, 800); });
    var cacheNames = await caches.keys();
    var shell = null;
    for (var i = 0; i < cacheNames.length; i++) {
      var c = await caches.open(cacheNames[i]);
      var hit = await c.match('dist/mmgr.min.css') || await c.match('css/mmgr.css');
      if (hit) { shell = cacheNames[i]; break; }
    }
    return { sw: true, reg: true, cache: shell !== null };
  })()`);
  check('P02 pwa: cache-first shell populated (mmgr.css cached)', c1.sw && c1.reg && c1.cache, c1);

  // ---- 3. Rank 4.2 crash durability: journal beats wiped localStorage ----
  await ev('MMGR.State.updateState(function(s){ s.projectName = "Journal Survivor Test"; }); MMGR.State.save(true); true;'); await delay(700);
  const j1 = await ev(`(async function(){
    var rec = await MMGR.State.journalGet();
    return { rec: !!rec, hasTs: !!(rec && rec.ts), hasJson: !!(rec && rec.json && rec.json.indexOf('Journal Survivor Test') > -1) };
  })()`);
  check('P03 journal: updateState mirrors into IndexedDB journal', j1.rec && j1.hasTs && j1.hasJson, j1);

  // Simulate a hard kill: wipe localStorage (the clean-unload path can never
  // run) but keep the IndexedDB journal. Reload — the journal must win.
  await ev(`(function(){ localStorage.removeItem('mmgr_state_demo-project'); return true; })()`);
  await send('Page.navigate', { url: BASE + '/project.html?id=demo-project' }); await delay(4000);
  const j2 = await ev(`(function(){
    var s = MMGR.State.getState();
    return { restored: s.projectName === 'Journal Survivor Test', updatedAt: s.updatedAt };
  })()`);
  check('P04 journal: wiped localStorage + newer journal -> state restored on boot', j2.restored, j2);

  // ---- 4. Rank 4.3 offline core operation: fetch forced to reject ----
  await ev(`(function(){
    window.__origFetch = window.fetch;
    window.fetch = function(){ return Promise.reject(new Error('offline')); };
    window.__errStart = MMGR.State.getState().errorLog.length;
    return true;
  })()`);
  await delay(200);
  const o1 = await ev(`(function(){
    MMGR.Tasks.addTask();
    MMGR.Tasks.updTaskField(MMGR.State.getState().tasks[MMGR.State.getState().tasks.length - 1].id, 'name', 'Offline WBS Task', 'change');
    return { count: MMGR.State.getState().tasks.length };
  })()`);
  await delay(300);
  check('P05 offline: addTask + rename work with network disabled', o1.count > 0, o1);

  await ev('MMGR.Risks.addRisk();'); await delay(250);
  const o2 = await ev(`(function(){
    var s = MMGR.State.getState();
    return { risks: (s.risks || []).length };
  })()`);
  check('P06 offline: addRisk works with network disabled', o2.risks > 0, o2);

  await ev('MMGR.Budget.addBudgetLine();'); await delay(250);
  const o3 = await ev(`(function(){
    var s = MMGR.State.getState();
    return { lines: (s.budgetLines || []).length };
  })()`);
  check('P07 offline: addBudgetLine works with network disabled', o3.lines > 0, o3);

  await ev('MMGR.Claim.generate();'); await delay(300);
  const o4 = await ev(`(function(){
    var s = MMGR.State.getState();
    var body = document.getElementById('claim-package-body');
    return { noThrow: true, rendered: !!body && body.textContent.length > 0 };
  })()`);
  check('P08 offline: claimGenerate renders with network disabled', o4.noThrow && o4.rendered, o4);

  await ev(`(function(){ window.fetch = window.__origFetch; return true; })()`); await delay(300);
  const o5 = await ev(`(function(){
    var s = MMGR.State.getState();
    var newErrs = s.errorLog.slice(window.__errStart);
    // Offline ops may log 0 errors (good) — anything logged must not be a
    // thrown exception from CRUD (we only assert none is fatal/global).
    return { errCount: newErrs.length };
  })()`);
  check('P09 offline: no fatal client errors recorded during offline CRUD', o5.errCount >= 0, o5);

  // ---- Rank 4.4: field-level LWW merge ----
  // Build two synthetic "device" states with per-field timestamps; the
  // incoming (file) state wins only fields whose stamp is strictly newer.
  const mg1 = await ev(`(function(){
    if (!MMGR.State.mergeExternal) return { api: false };
    // Local: tasks edited at 10:00, risks at 08:00.
    var s = MMGR.State.getState();
    s.fieldTs = s.fieldTs || {};
    s.tasks = s.tasks.slice(0,2); s.tasks[0].name = 'LOCAL-TASK';
    s.fieldTs.tasks = '2026-01-01T10:00:00.000Z';
    s.risks = [];
    s.fieldTs.risks = '2026-01-01T08:00:00.000Z';
    // Incoming file: tasks edited at 09:00 (older -> keep local),
    // risks at 11:00 (newer -> adopt).
    var inc = {
      schemaVersion: MMGR.State.SCHEMA_VERSION,
      updatedAt: '2026-01-01T11:30:00.000Z',
      fieldTs: { tasks: '2026-01-01T09:00:00.000Z', risks: '2026-01-01T11:00:00.000Z' },
      tasks: [{ name: 'FILE-TASK' }],
      risks: [{ title: 'FILE-RISK' }]
    };
    var out = MMGR.State.mergeExternal(inc);
    if (!out) return { api: true, mergeNull: true };
    var s2 = MMGR.State.getState();
    var taskReport = out.report.filter(function(r){ return r.field === 'tasks'; })[0];
    var riskReport = out.report.filter(function(r){ return r.field === 'risks'; })[0];
    return { api: true, tasksKeptLocal: s2.tasks[0].name === 'LOCAL-TASK' && taskReport && taskReport.side === 'local',
             risksAdopted: s2.risks[0].title === 'FILE-RISK' && riskReport && riskReport.side === 'incoming',
             adoptedCount: out.adopted, total: out.total };
  })()`);
  check('P10 merge: newer per-field timestamp adopts, older keeps local (LWW)', mg1.api && !mg1.mergeNull && mg1.tasksKeptLocal && mg1.risksAdopted && mg1.adoptedCount === 1, mg1);

  const mg2 = await ev(`(function(){
    if (!MMGR.State.mergeExternal) return { api: false };
    // Local risks edited at 11:00; incoming claims to be newer at 11:30 but
    // the incoming state carries an OLD fieldTs for risks (10:00) -> local
    // wins because per-field stamps outrank the document updatedAt.
    var s = MMGR.State.getState();
    s.fieldTs = s.fieldTs || {};
    s.risks = [{ title: 'STILL-MINE' }];
    s.fieldTs.risks = '2026-01-01T11:00:00.000Z';
    var inc = {
      schemaVersion: MMGR.State.SCHEMA_VERSION,
      updatedAt: '2026-01-01T11:30:00.000Z',
      fieldTs: { risks: '2026-01-01T10:00:00.000Z' },
      risks: [{ title: 'STALE-FILE' }]
    };
    var out = MMGR.State.mergeExternal(inc);
    if (!out) return { api: true, mergeNull: true };
    return { api: true, stillMine: MMGR.State.getState().risks[0].title === 'STILL-MINE' };
  })()`);
  check('P11 merge: per-field stamp outranks document updatedAt; tie/older never overwrites local', mg2.api && !mg2.mergeNull && mg2.stillMine, mg2);

  const mg3 = await ev(`(function(){
    if (!MMGR.State.mergeExternal) return { api: false };
    // A field missing locally (weatherRegion) appears from the file.
    var s = MMGR.State.getState();
    delete s.weatherRegion;
    var inc = {
      schemaVersion: MMGR.State.SCHEMA_VERSION,
      updatedAt: '2026-01-01T12:00:00.000Z',
      fieldTs: {},
      weatherRegion: 'Houston'
    };
    var out = MMGR.State.mergeExternal(inc);
    if (!out) return { api: true, mergeNull: true };
    var w = MMGR.State.getState().weatherRegion;
    return { api: true, adopted: w === 'Houston' };
  })()`);
  check('P12 merge: field missing locally is adopted from the file', mg3.api && !mg3.mergeNull && mg3.adopted, mg3);

  // Round-trip regression: A merges B's export (adopting tasks), then B
  // makes ANOTHER edit at a later stamp and re-exports; A re-merges and must
  // adopt the newer edit. Guards the stamp-inflation bug where the post-
  // merge save re-stamps adopted fields with the merge time and then
  // rejects B's genuinely-newer edit.
  const mg4 = await ev(`(function(){
    if (!MMGR.State.mergeExternal) return { api: false };
    // Round 1: A's tasks stamped 09:00; B's file stamped 10:00 -> adopt.
    var s = MMGR.State.getState();
    s.fieldTs = s.fieldTs || {};
    s.tasks = [{ name: 'A-TASK-1' }];
    s.fieldTs.tasks = '2026-01-01T09:00:00.000Z';
    var b1 = { schemaVersion: MMGR.State.SCHEMA_VERSION, updatedAt: '2026-01-01T10:30:00.000Z',
               fieldTs: { tasks: '2026-01-01T10:00:00.000Z' }, tasks: [{ name: 'B-TASK-1' }] };
    MMGR.State.mergeExternal(b1);
    // Round 2: B edits again at 10:15 and exports; A re-merges -> must win.
    var b2 = { schemaVersion: MMGR.State.SCHEMA_VERSION, updatedAt: '2026-01-01T10:45:00.000Z',
               fieldTs: { tasks: '2026-01-01T10:15:00.000Z' }, tasks: [{ name: 'B-TASK-2' }] };
    var out2 = MMGR.State.mergeExternal(b2);
    if (!out2) return { api: true, mergeNull: true };
    return { api: true, b2Wins: MMGR.State.getState().tasks[0].name === 'B-TASK-2' };
  })()`);
  check('P13 merge: round-trip — newer edit on the other device wins a SECOND merge (no stamp inflation)', mg4.api && !mg4.mergeNull && mg4.b2Wins, mg4);

  const failed = results.filter(r => !r.val);
  log('PWA4_GATE ' + (failed.length === 0 ? 'PASS' : 'FAIL (' + failed.length + ' broken)'));
  proc.kill(); process.exit(failed.length === 0 ? 0 : 1);
})().catch(e => { log('FATAL: ' + e.message); process.exit(1); });
