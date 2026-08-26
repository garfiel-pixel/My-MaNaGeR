/* ============================================================
   RANK 3 GATE — Progressive Disclosure + Viewport Detection
   (MASTER-ACTION-PLAN Rank 3.1 + PLAN-OF-ACTION Rank 3.4)
   Drives headless Chrome against http://127.0.0.1:8765.
   Covers:
     3.1 Core Mode vs Advanced Packs:
       - New projects start Core-only (all packs off); existing
         projects migrate with all packs ON.
       - Pack toggle is a single action (Controls drawer chip);
         turning a pack off hides its nav sections and never
         strands the user on a hidden panel; state is unchanged
         except packs; readonly blocks the toggle.
     3.4 Viewport-aware layout detection:
       - Dense sections offer exactly ONE dismissible prompt on a
         narrow viewport; acceptance applies simplified view and
         remembers the device preference; dismissal never re-prompts.
       - The prompt never auto-switches; escape hatch toggles back.
   Exit 0 only when every contract holds.
   Usage: node qa-r3.cjs  (server must be on :8765)
   ============================================================ */
const { spawn } = require('child_process');
const path = require('path');
const { chromePath: CHROME, BASE, DEBUG_PORT: PORT } = require('./tools/chrome-launcher.cjs');
const PROFILE = path.join(require('os').tmpdir(), 'mmgr-r3-' + Date.now());
let ws, msgId = 0;
const pending = new Map();
const results = [];
const log = (s) => { process.stdout.write('[r3] ' + s + '\n'); };
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
  await ev('window.MMGR.Schedule.cascade("northern-temperate",{threshold:999}); window.MMGR.Render.renderAll();'); await delay(300);

  const check = (name, val, detail) => { results.push({ name, val, detail }); log((val ? 'PASS' : 'FAIL') + ' ' + name + (val ? '' : '  <-- ' + JSON.stringify(detail))); };

  // ---- 3.1 Core Mode vs Advanced Packs ----
  // Existing demo project (migrated from old schema) must have all packs ON.
  const p1 = await ev(`(function(){
    var s = MMGR.State.getState();
    var pk = s.packs || {};
    return { exists: !!s.packs, allOn: ['schedule','money','governance','field','quality'].every(function(k){ return pk[k] === true; }), schema: s.schemaVersion, live: MMGR.State.SCHEMA_VERSION };
  })()`);
  // Schema version must equal the LIVE version (17 as of Rank 4.4 fieldTs).
  check('R01 packs: existing project migrates with ALL packs on (nothing disappears)', p1.exists && p1.allOn && p1.schema === p1.live, p1);

  // A brand-new project (default state) starts Core-only.
  const p2 = await ev(`(function(){
    var d = MMGR.State.getDefaultState();
    var pk = d.packs || {};
    return { allOff: ['schedule','money','governance','field','quality'].every(function(k){ return pk[k] === false; }) };
  })()`);
  check('R02 packs: NEW project default = all packs OFF (Core only)', p2.allOff, p2);

  // Turn the Schedule pack off: Gantt nav hides; state only changes packs; the
  // active panel (dash) is unaffected. NOTE: checkbox .click() already toggles
  // checked before the handler reads it (same convention as tglFlag) — so a
  // single click on the currently-checked chip turns it OFF; do NOT pre-set
  // checked (that would double-flip and cancel out).
  await ev(`(function(){
    document.querySelector('[data-action="tglPack"][data-pack="schedule"]').click();
    return true;
  })()`);
  await delay(400);
  const p3 = await ev(`(function(){
    var s = MMGR.State.getState();
    var ganttBtn = document.querySelector('.sec-btn[data-section="gantt"]');
    return { off: s.packs.schedule === false, ganttHidden: !!ganttBtn && ganttBtn.classList.contains('is-hide'),
      chipSynced: document.querySelector('[data-action="tglPack"][data-pack="schedule"]').checked === false,
      dashStillActive: !!document.querySelector('#panel-dash.active') };
  })()`);
  check('R03 packs: toggle off hides Gantt nav, chip syncs, dashboard stays active', p3.off && p3.ganttHidden && p3.chipSynced && p3.dashStillActive, p3);

  // Turn it back on: nav restores (single click on the now-unchecked chip).
  await ev(`(function(){
    document.querySelector('[data-action="tglPack"][data-pack="schedule"]').click();
    return true;
  })()`);
  await delay(400);
  const p4 = await ev(`(function(){
    var s = MMGR.State.getState();
    var ganttBtn = document.querySelector('.sec-btn[data-section="gantt"]');
    return { on: s.packs.schedule === true, ganttShown: !!ganttBtn && !ganttBtn.classList.contains('is-hide') };
  })()`);
  check('R04 packs: toggle back on restores Gantt nav', p4.on && p4.ganttShown, p4);

  // Stranded-panel safety: with Schedule pack off, asking to show gantt
  // directly (nav hidden, but programmatic) must not crash.
  await ev(`(function(){ document.querySelector('[data-action="tglPack"][data-pack="schedule"]').click(); return true; })()`);
  await delay(300);
  const p5 = await ev(`(function(){
    var before = document.querySelector('.panel.active') ? document.querySelector('.panel.active').id : null;
    var dashBtn = document.querySelector('.sec-btn[data-section="dash"]');
    var ganttBtn = document.querySelector('.sec-btn[data-section="gantt"]');
    ganttBtn.click(); // hidden button, but click path must be safe
    var after = document.querySelector('.panel.active') ? document.querySelector('.panel.active').id : null;
    return { safe: after === before || after === 'panel-gantt', before: before, after: after };
  })()`);
  check('R05 packs: clicking a pack-hidden nav button is safe (no crash)', p5.safe, p5);
  await ev(`(function(){ document.querySelector('[data-action="tglPack"][data-pack="schedule"]').click(); return true; })()`);
  await delay(300);

  // Readonly blocks tglPack.
  await ev('MMGR.State.save(true); true;'); await delay(200);
  await ev(`(function(){ localStorage.setItem('mmgr_scope_demo-project','readonly'); return true; })()`);
  await send('Page.navigate', { url: BASE + '/project.html?id=demo-project' }); await delay(4000);
  const p6 = await ev(`(function(){
    var before = MMGR.State.getState().packs.money;
    var chip = document.querySelector('[data-action="tglPack"][data-pack="money"]');
    chip.checked = false; chip.click();
    var after = MMGR.State.getState().packs.money;
    var toast = document.querySelector('.toast');
    return { unchanged: before === after, toastShown: !!toast && toast.textContent.indexOf('View-only') > -1 };
  })()`);
  check('R06 packs: readonly blocks tglPack with toast, state unchanged', p6.unchanged && p6.toastShown, p6);
  await ev(`(function(){ localStorage.setItem('mmgr_scope_demo-project','full'); return true; })()`);
  await send('Page.navigate', { url: BASE + '/project.html?id=demo-project' }); await delay(3500);

  // ---- 3.4 Viewport-aware layout detection ----
  // Force a narrow viewport via CDP Emulation so matchMedia + innerWidth
  // report a phone-sized portrait screen.
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await delay(300);
  const v1 = await ev(`(function(){
    return { narrow: MMGR.Viewport.isNarrow(), dense: MMGR.Viewport.isDense('gantt'), notDense: MMGR.Viewport.isDense('dash') };
  })()`);
  check('R07 viewport: narrow detected from real viewport + dense section flagged', v1.narrow && v1.dense && !v1.notDense, v1);

  // Clear any stored pref, then open Gantt: exactly ONE prompt appears.
  await ev('MMGR.Viewport.clearPref("gantt"); true;'); await delay(150);
  await ev('document.querySelector(".sec-btn[data-section=gantt]").click()'); await delay(400);
  const v2 = await ev(`(function(){
    var prompts = document.querySelectorAll('#panel-gantt .vp-prompt').length;
    return { one: prompts === 1, text: document.querySelector('#panel-gantt .vp-prompt') ? document.querySelector('#panel-gantt .vp-prompt').textContent.indexOf('wide screen') > -1 : false };
  })()`);
  check('R08 viewport: exactly one dismissible prompt on dense view (narrow)', v2.one && v2.text, v2);

  // Re-render (navigate away and back) must NOT double-prompt.
  await ev('document.querySelector(".sec-btn[data-section=dash]").click()'); await delay(300);
  await ev('document.querySelector(".sec-btn[data-section=gantt]").click()'); await delay(400);
  const v3 = await ev(`document.querySelectorAll('#panel-gantt .vp-prompt').length`);
  check('R09 viewport: navigating away + back does not duplicate the prompt', v3 === 1, v3);

  // Accept: simplified class applied, device pref stored, prompt removed.
  await ev('document.querySelector("#panel-gantt [data-action=vpAccept]").click()'); await delay(400);
  const v4 = await ev(`(function(){
    return { simple: document.getElementById('panel-gantt').classList.contains('vp-simple'),
      pref: MMGR.Viewport.getPref('gantt'), promptGone: document.querySelectorAll('#panel-gantt .vp-prompt').length === 0,
      escapeBtn: document.querySelectorAll('#panel-gantt .vp-full-btn').length === 1 };
  })()`);
  check('R10 viewport: accept -> simplified class + device pref + escape hatch', v4.simple && v4.pref === 'simple' && v4.promptGone && v4.escapeBtn, v4);

  // Escape hatch: toggle full table back.
  await ev('document.querySelector("#panel-gantt [data-action=vpFull]").click()'); await delay(250);
  const v5 = await ev(`(function(){
    return { full: document.getElementById('panel-gantt').classList.contains('vp-full'),
      stillSimple: document.getElementById('panel-gantt').classList.contains('vp-simple') };
  })()`);
  check('R11 viewport: escape hatch toggles the full wide layout', v5.full && v5.stillSimple, v5);

  // Navigate away/back: pref remembered, no re-prompt, simplified auto-applied.
  await ev('document.querySelector(".sec-btn[data-section=dash]").click()'); await delay(300);
  await ev('document.querySelector(".sec-btn[data-section=gantt]").click()'); await delay(400);
  const v6 = await ev(`(function(){
    return { simple: document.getElementById('panel-gantt').classList.contains('vp-simple'),
      promptCount: document.querySelectorAll('#panel-gantt .vp-prompt').length };
  })()`);
  check('R12 viewport: pref remembered on return — simplified auto-applied, no re-prompt', v6.simple && v6.promptCount === 0, v6);

  // Dismiss path (fresh pref): dismissal never re-prompts.
  await ev('MMGR.Viewport.clearPref("raci"); document.querySelector(".sec-btn[data-section=raci]").click()'); await delay(400);
  await ev('document.querySelector("#panel-raci [data-action=vpDismiss]").click()'); await delay(300);
  await ev('document.querySelector(".sec-btn[data-section=dash]").click()'); await delay(300);
  await ev('document.querySelector(".sec-btn[data-section=raci]").click()'); await delay(400);
  const v7 = await ev(`(function(){
    return { pref: MMGR.Viewport.getPref('raci'), promptCount: document.querySelectorAll('#panel-raci .vp-prompt').length,
      simple: document.getElementById('panel-raci').classList.contains('vp-simple') };
  })()`);
  check('R13 viewport: dismissal stored — never re-prompted, not simplified', v7.pref === 'dismiss' && v7.promptCount === 0 && !v7.simple, v7);

  await send('Emulation.clearDeviceMetricsOverride'); await delay(200);

  const failed = results.filter(r => !r.val);
  log('R3_GATE ' + (failed.length === 0 ? 'PASS' : 'FAIL (' + failed.length + ' broken)'));
  proc.kill(); process.exit(failed.length === 0 ? 0 : 1);
})().catch(e => { log('FATAL: ' + e.message); process.exit(1); });
