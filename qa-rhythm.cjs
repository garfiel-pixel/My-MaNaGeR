/* ============================================================
   DASHBOARD RHYTHM GATE — spacing/alignment regression harness
   (UI-MODERNIZATION v91–v94: 33px row rhythm + ring/list alignment)
   Drives headless Chrome against http://127.0.0.1:8765.
   Covers the invariants the UI-MODERNIZATION passes established so
   future CSS edits cannot silently regress them:
     - Health status rows: exactly 6, all ONE height, ~33px
     - Next-3 rows: all ONE height, ~33px
     - Completion ring block and Next-3 list start on the SAME top
       line (the ring must not float mid-card)
     - Today's Decision rows: consistent height, >= 33px
     - Schedule Confidence cells: 3 cells, all equal height, ~88px
     - Dashboard stat cards (g4): 4 cards, all equal height
     - EVM tiles: all equal height (big + small)
     - <=768px: the Next-3 card spans the full row (no stubby orphan)
     - No horizontal overflow on the dashboard
     - Dark mode: row/tile HEIGHTS unchanged (layout parity), and
       the theme actually re-tints (token swap sanity)
   Exit 0 only when every contract holds.
   Usage: node qa-rhythm.cjs  (server must be on :8765)
   ============================================================ */
const { spawn } = require('child_process');
const path = require('path');
const CHROME = 'C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe';
const PORT = 9246;
const BASE = 'http://127.0.0.1:8765';
const PROFILE = path.join(require('os').tmpdir(), 'mmgr-rhythm-' + Date.now());
let ws, msgId = 0;
const pending = new Map();
const results = [];
const log = (s) => { process.stdout.write('[rhythm] ' + s + '\n'); };
const delay = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { log('WATCHDOG'); try { ws && ws.close(); } catch (e) {} process.exit(2); }, 300000);
function send(method, params) { return new Promise(res => { const id = ++msgId; pending.set(id, m => { pending.delete(id); res(m.result || {}); }); ws.send(JSON.stringify({ id, method, params: params || {} })); }); }
async function ev(expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __err: r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text }; return r.result && r.result.value; }

// Seeded project state: 5 tasks (one overdue + critical, one due soon, one
// todo, one blocked, one completed), a High/High risk (feeds Today's
// Decision), a charter target + weather window (feeds Schedule Confidence).
// The static dashboard markup always carries the 6 health rows / 4 g4 cards /
// EVM tiles regardless of counts, so the row/tile height invariants hold
// even if the decision/sc-confidence content differs.
const SEED_STATE = `(function(){
  var iso = function(d){ var x = new Date(d); return x.toISOString().slice(0,10); };
  var today = new Date(); today.setHours(0,0,0,0);
  var d = function(n){ return iso(new Date(today.getTime() + n*86400000)); };
  return JSON.stringify({
    charter: { targetCompletion: d(90), end: d(90), projectName: 'Demo' },
    tasks: [
      {id:'t1', name:'Foundation pour — critical path (overdue)', status:'inprogress', critical:true, weatherExposed:true, totalFloat:0, planned:'50000', actual:'42000', startDate:d(-5), endDate:d(-2)},
      {id:'t2', name:'Steel delivery — long lead item', status:'inprogress', critical:false, totalFloat:5, planned:'80000', actual:'90000', startDate:d(0), endDate:d(6)},
      {id:'t3', name:'Electrical rough-in', status:'todo', critical:false, totalFloat:8, planned:'30000', actual:'0', startDate:d(0), endDate:d(12)},
      {id:'t4', name:'Windows installation (blocked)', status:'blocked', critical:false, totalFloat:3, planned:'25000', actual:'5000', startDate:d(0), endDate:d(20)},
      {id:'t5', name:'Roofing complete', status:'completed', critical:false, totalFloat:0, planned:'40000', actual:'41000', startDate:d(-30), endDate:d(-10)}
    ],
    risks: [{id:'r1', title:'Supply chain delay', probability:'High', impact:'High'}],
    issues: [{id:'i1', title:'Crane availability'}],
    budgetLines: [{id:'b1', name:'Foundation', planned:'50000', actual:'42000'}, {id:'b2', name:'Steel', planned:'80000', actual:'90000'}, {id:'b3', name:'Electrical', planned:'30000', actual:'0'}],
    changes: [], resources: [{id:'res1', name:'Crew A', allocation:'100'}],
    wxWindow: { start: d(20), end: d(45), bufferDays: 5 },
    baseline: { plannedEnd: d(60) }
  });
})()`;

(async () => {
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, '--window-size=1440,1200', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) break; } catch (e) {} await delay(300); }
  const targets = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws fail')); });
  await send('Runtime.enable'); await send('Page.enable');

  // Seed unlock + scope + project state BEFORE every navigation so the gate
  // never redirects and the dashboard always boots with data.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.setItem('mmgr_unlocked_demo-project','1');
    localStorage.setItem('mmgr_scope_demo-project','full');
    localStorage.setItem('mmgr_state_demo-project', (${SEED_STATE.toString()}));
  ` });

  await send('Page.navigate', { url: BASE + '/project.html?id=demo-project' });
  // Wait for boot: splash fade + render pipeline. Poll until panel-dash is
  // active and the Next-3 list has its three rows.
  for (let i = 0; i < 30; i++) {
    await delay(400);
    const ready = await ev(`(function(){
      return !!document.querySelector('#panel-dash.active') && document.querySelectorAll('#n3 li').length >= 3;
    })()`);
    if (ready === true) break;
  }
  await delay(500);

  const check = (name, val, detail) => { results.push({ name, val, detail }); log((val ? 'PASS' : 'FAIL') + ' ' + name + (val ? '' : '  <-- ' + JSON.stringify(detail))); };

  // ---- R01 boot: dashboard active with the full status row set ----
  const b1 = await ev(`(function(){
    return { active: !!document.querySelector('#panel-dash.active'),
      healthRows: document.querySelectorAll('#health-card .fb-sm').length,
      n3Rows: document.querySelectorAll('#n3 li').length };
  })()`);
  // MARKET-FEATURE-ROADMAP A1 (2026-08-15) added a 7th row to the Project
  // Health card — "Compliance Expiring" (same .fb-sm pattern as the risk
  // counts, per the roadmap's own UI instruction). Expectations bumped 6→7.
  check('R01 boot: dashboard active, 7 health rows + >=3 Next-3 rows present', b1.active && b1.healthRows === 7 && b1.n3Rows >= 3, b1);

  // ---- R02 health rows: exactly 7, ONE consistent height, ~33px ----
  const m = await ev(`(function(){
    const hs = [...document.querySelectorAll('#health-card .fb-sm')].map(r => Math.round(r.getBoundingClientRect().height));
    return { heights: hs, allEqual: hs.every(h => h === hs[0]), target: hs[0] };
  })()`);
  const r02ok = m.heights.length === 7 && m.allEqual && m.target >= 32 && m.target <= 34;
  check('R02 health rows: one consistent height ~33px (was 33px at v91+)', r02ok, m);

  // ---- R03 Next-3 rows: all ONE height, ~33px ----
  const n3m = await ev(`(function(){
    const hs = [...document.querySelectorAll('#n3 li')].map(r => Math.round(r.getBoundingClientRect().height));
    return { heights: hs, allEqual: hs.every(h => h === hs[0]), target: hs[0] };
  })()`);
  const r03ok = n3m.heights.length >= 3 && n3m.allEqual && n3m.target >= 32 && n3m.target <= 34;
  check('R03 Next-3 rows: one consistent height ~33px', r03ok, n3m);

  // ---- R04 ring/list alignment: completion ring top == Next-3 list top ----
  const a1 = await ev(`(function(){
    const ring = document.querySelector('#completion-card .pring').getBoundingClientRect();
    const n3 = document.querySelector('#n3').getBoundingClientRect();
    return { ringTop: Math.round(ring.top), n3Top: Math.round(n3.top), drift: Math.round(ring.top - n3.top) };
  })()`);
  check('R04 ring/list alignment: ring and Next-3 share the same top line (<=2px)', Math.abs(a1.drift) <= 2, a1);

  // ---- R05 Today's Decision rows: consistent height, >= 33px ----
  const td = await ev(`(function(){
    const hs = [...document.querySelectorAll('#today-decision-body .tf-row')].map(r => Math.round(r.getBoundingClientRect().height));
    return { count: hs.length, heights: hs, allEqual: hs.length > 0 && hs.every(h => h === hs[0]), min: hs.length ? Math.min.apply(null, hs) : 0 };
  })()`);
  check('R05 Today\'s Decision rows: consistent height, >= 33px', td.count >= 1 && td.allEqual && td.min >= 33, td);

  // ---- R06 Schedule Confidence: 3 cells, all equal height, ~88px ----
  const sc = await ev(`(function(){
    const hs = [...document.querySelectorAll('#schedule-confidence-card .sc-cell')].map(c => Math.round(c.getBoundingClientRect().height));
    return { count: hs.length, heights: hs, allEqual: hs.length === 3 && hs.every(h => h === hs[0]), target: hs[0] };
  })()`);
  check('R06 Schedule Confidence: 3 equal-height cells ~88px', sc.count === 3 && sc.allEqual && sc.target >= 86 && sc.target <= 90, sc);

  // ---- R07 dashboard stat cards (g4): 4 cards, all equal height ----
  const g4 = await ev(`(function(){
    const hs = [...document.querySelectorAll('#panel-dash .g4 .card')].map(c => Math.round(c.getBoundingClientRect().height));
    return { count: hs.length, heights: hs, allEqual: hs.length === 4 && hs.every(h => h === hs[0]) };
  })()`);
  check('R07 stat cards: 4 equal-height cards', g4.count === 4 && g4.allEqual, g4);

  // ---- R08 EVM tiles: big tiles equal + small tiles equal ----
  const e1 = await ev(`(function(){
    const big = [...document.querySelectorAll('#evm-card .evm-tile')].map(t => Math.round(t.getBoundingClientRect().height));
    const small = [...document.querySelectorAll('#evm-card .evm-tile-sm')].map(t => Math.round(t.getBoundingClientRect().height));
    return { big, small, bigOk: big.length === 3 && big.every(h => h === big[0]), smallOk: small.length === 4 && small.every(h => h === small[0]) };
  })()`);
  check('R08 EVM tiles: big + small tiles each equal-height', e1.bigOk && e1.smallOk, e1);

  // ---- R09 no horizontal overflow on the dashboard ----
  const o1 = await ev(`(function(){
    return { scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth, ok: document.documentElement.scrollWidth <= window.innerWidth };
  })()`);
  check('R09 no horizontal overflow', o1.ok, o1);

  // ---- R10 <=768px: Next-3 card spans the full row (no stubby orphan) ----
  await send('Emulation.setDeviceMetricsOverride', { width: 768, height: 900, deviceScaleFactor: 1, mobile: false });
  await delay(500);
  const mob = await ev(`(function(){
    const cards = [...document.querySelectorAll('#panel-dash .g3 > .card')].map(c => Math.round(c.getBoundingClientRect().width));
    return { widths: cards, n3Wide: cards.length === 3 ? cards[2] >= cards[0] * 1.9 : false };
  })()`);
  check('R10 <=768px: Next-3 card spans the full row', mob.n3Wide, mob);
  await send('Emulation.clearDeviceMetricsOverride'); await delay(400);

  // ---- R11 dark parity: heights UNCHANGED + theme actually re-tints ----
  const before = await ev(`(function(){
    const h = [...document.querySelectorAll('#health-card .fb-sm')].map(r => Math.round(r.getBoundingClientRect().height));
    const s = [...document.querySelectorAll('#schedule-confidence-card .sc-cell')].map(c => Math.round(c.getBoundingClientRect().height));
    const badgeColor = getComputedStyle(document.querySelector('#h-ip')).color;
    return { h, s, badgeColor };
  })()`);
  await ev('document.body.classList.add("dark-mode"); true;');
  await delay(300);
  const after = await ev(`(function(){
    const h = [...document.querySelectorAll('#health-card .fb-sm')].map(r => Math.round(r.getBoundingClientRect().height));
    const s = [...document.querySelectorAll('#schedule-confidence-card .sc-cell')].map(c => Math.round(c.getBoundingClientRect().height));
    const badgeColor = getComputedStyle(document.querySelector('#h-ip')).color;
    const labelColor = getComputedStyle(document.querySelector('#health-card .fb-sm span:first-child')).color;
    return { h, s, badgeColor, labelColor };
  })()`);
  const sameHeights = JSON.stringify(before.h) === JSON.stringify(after.h) && JSON.stringify(before.s) === JSON.stringify(after.s);
  const reTinted = after.badgeColor !== before.badgeColor || after.labelColor !== 'rgb(15, 23, 42)';
  check('R11 dark parity: row/tile heights unchanged + tokens re-tint', sameHeights && reTinted, { before, after });

  const failed = results.filter(r => !r.val);
  log('RHYTHM_GATE ' + (failed.length === 0 ? 'PASS' : 'FAIL (' + failed.length + ' broken)'));
  proc.kill(); process.exit(failed.length === 0 ? 0 : 1);
})().catch(e => { log('FATAL: ' + e.message); process.exit(1); });
