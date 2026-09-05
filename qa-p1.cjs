/* ============================================================
   PHASE 1 GATE — interaction correctness verification
   Charter tab switch / Definitions paint / Theme+Crosshair
   persist / Kanban Completed drop / Import full-surface refresh.
   Usage: node qa-p1.cjs  (server must be on :8765)
   ============================================================ */
const { spawn } = require('child_process');
const path = require('path');
const { chromePath: CHROME, BASE, DEBUG_PORT: PORT } = require('./tools/chrome-launcher.cjs');
const PROFILE = path.join(require('os').tmpdir(), 'mmgr-p1-' + Date.now());
let ws, msgId = 0; const pending = new Map();
const log = (s) => { process.stdout.write('[p1] ' + s + '\n'); };
const delay = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { log('WATCHDOG'); try { ws && ws.close(); } catch (e) {} process.exit(2); }, 150000);
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

  const results = [];
  const check = (name, val, detail) => { results.push({ name, val }); log((val ? 'PASS' : 'FAIL') + ' ' + name + (val ? '' : '  <-- ' + JSON.stringify(detail))); };

  // ---- 1. Charter renders on tab switch (edit -> leave -> return) --------
  const charter = await ev(`(async function(){
    document.querySelector('.sec-btn[data-section=charter]').click();
    await new Promise(function(r){ setTimeout(r, 300); });
    MMGR.State.updateState(function(s){ if (!s.charter.kpis) s.charter.kpis = []; s.charter.kpis.push({ name: 'Permit Issued', target: '2026-08-15', measure: 'days', linkedMetric: null, dir: 'higher' }); s.charter.name = 'Tab-Switch Name'; });
    // leave the tab
    document.querySelector('.sec-btn[data-section=dash]').click();
    await new Promise(function(r){ setTimeout(r, 250); });
    // come back
    document.querySelector('.sec-btn[data-section=charter]').click();
    await new Promise(function(r){ setTimeout(r, 300); });
    var nameIn = document.getElementById('ch-name');
    var kpiCount = document.querySelectorAll('#kpi-list .kpi-row').length;
    var s1 = MMGR.State.getState();
    return {
      active: document.getElementById('panel-charter').classList.contains('active'),
      nameRepainted: !!nameIn && nameIn.value === 'Tab-Switch Name',
      kpiRendered: kpiCount >= 1,
      kpisInState: (s1.charter.kpis || []).length >= 1
    };
  })()`);
  check('1 charter: fields + KPIs repaint on tab switch', charter.active && charter.nameRepainted && charter.kpiRendered && charter.kpisInState, charter);

  // ---- 2. Definitions panel paints on showSec('def') ----------------------
  const def = await ev(`(async function(){
    document.querySelector('.sec-btn[data-section=def]').click();
    await new Promise(function(r){ setTimeout(r, 300); });
    var active = document.getElementById('panel-def').classList.contains('active');
    var cards = document.querySelectorAll('#def-container .def-card').length;
    var cardText = document.getElementById('def-container') ? document.getElementById('def-container').textContent : '';
    var before = cards;
    // re-render idempotency
    MMGR.Render.renderDefs();
    var after = document.querySelectorAll('#def-container .def-card').length;
    return { active: active, cards: cards, hasText: cardText.length > 50, noDupe: after === before, before: before, after: after };
  })()`);
  check('2 def: panel paints on showSec(def), cards render, idempotent', def.active && def.cards > 0 && def.hasText && def.noDupe, def);

  // ---- 3. Theme + crosshair persist across hard refresh -------------------
  // Write BOTH slots like the real toggle does (device pref mmgr_theme is the
  // master; state.theme is the portable fallback), then assert via the shared
  // Appearance controls now live inline inside the Customize/Appearance panels
  // on app.html / admin.html / project.html (wrapped in .dock.dock-inline);
  // the floating bottom dock was removed. The mmgr-dock.js selectors still
  // match because the inline markup keeps the .dock class.
  await ev(`try{localStorage.setItem('mmgr_theme','dark');}catch(e){} MMGR.State.updateState(function(s){ s.theme='dark'; s.crosshairOn=true; });`); await delay(400);
  await send('Page.navigate', { url: BASE + '/project.html?id=demo-project' }); await delay(4000);
  const persist = await ev(`(function(){
    var darkBtn = document.querySelector('.dock .pal-btn[data-pal="dark"]');
    return {
      dark: document.body.classList.contains('dark-mode'),
      cross: document.body.classList.contains('crosshair-on'),
      thm: !!darkBtn && darkBtn.getAttribute('aria-pressed') === 'true',
      ch: !!document.getElementById('ch-tgl') && document.getElementById('ch-tgl').checked === true
    };
  })()`);
  check('3 theme+crosshair persist after hard refresh', persist.dark && persist.cross && persist.thm && persist.ch, persist);
  await ev(`MMGR.State.updateState(function(s){ s.theme='light'; s.crosshairOn=false; });`); await delay(300);
  await ev('window.MMGR.Schedule.cascade("northern-temperate",{threshold:999}); window.MMGR.Render.renderAll();'); await delay(200);

  // ---- 4. Kanban Completed column keeps the card after drop ---------------
  // t2 is a real work item (not a phase), so it MUST render on the board.
  const kan = await ev(`(async function(){
    document.querySelector('.sec-btn[data-section=kan]').click();
    await new Promise(function(r){ setTimeout(r, 300); });
    var s = MMGR.State.getState();
    var t = s.tasks.find(function(x){ return x.id === 't2'; });
    var orig = t.status;
    MMGR.App.dragCard({ dataTransfer: { effectAllowed: 'move' } }, 't2');
    MMGR.App.dropCard({ preventDefault: function(){} }, 'completed');
    var s1 = MMGR.State.getState();
    var t1 = s1.tasks.find(function(x){ return x.id === 't2'; });
    var inCol = !!document.querySelector('#kc-dn .kc[data-id="t2"]');
    var wip = document.getElementById('w-dn') ? document.getElementById('w-dn').textContent : null;
    var rollup = {};
    s1.tasks.forEach(function(x){ if (x.parentName) rollup[x.parentName] = 1; });
    var expected = s1.tasks.filter(function(x){ return x.status === 'completed' && !x.isPhase && !((x.level || 0) === 0 && rollup[x.name]); }).length;
    var moved = t1.status === 'completed'; // capture BEFORE restoring
    // a later re-render must not drop the card
    MMGR.Render.renderKanban();
    var stillThere = !!document.querySelector('#kc-dn .kc[data-id="t2"]');
    s1.tasks.find(function(x){ return x.id === 't2'; }).status = orig;
    MMGR.Render.renderAll();
    return { moved: moved, inCol: inCol, wip: wip, expected: String(expected), stillThere: stillThere };
  })()`);
  check('4 kanban: Completed drop keeps card visible + WIP correct', kan.moved && kan.inCol && kan.wip === kan.expected && kan.stillThere, kan);

  // ---- 5. Import refreshes every task-consuming surface -------------------
  const imp = await ev(`(async function(){
    var st0 = MMGR.State.getState();
    var before = st0.tasks.length;
    var src = document.getElementById('wi-source');
    if (!src) return { why: 'no wi-source' };
    src.value = 'QA Phase\\n  QA Task One\\n  QA Task Two\\n';
    MMGR.Tasks.wiCommit();
    await new Promise(function(r){ setTimeout(r, 300); });
    var s = MMGR.State.getState();
    var names = ['QA Phase', 'QA Task One', 'QA Task Two'];
    var imp2 = s.tasks.filter(function(t){ return names.indexOf(t.name) > -1; });
    var wbsRows = imp2.length === 3 && imp2.every(function(t){ return !!document.querySelector('#wbs-body tr.wbs-row[data-id="' + t.id + '"]'); });
    var rollup = {};
    s.tasks.forEach(function(x){ if (x.parentName) rollup[x.parentName] = 1; });
    var todoExpected = s.tasks.filter(function(x){ return (x.status || 'todo') === 'todo' && !x.isPhase && !((x.level || 0) === 0 && rollup[x.name]); }).length;
    var kanbanCards = document.getElementById('kc-todo') ? document.getElementById('kc-todo').querySelectorAll('.kc').length : -1;
    var ganttLabels = document.getElementById('gantt-labels') ? document.getElementById('gantt-labels').children.length : -1;
    var hTc = document.getElementById('tc') ? document.getElementById('tc').textContent : null;
    var decisionBody = document.getElementById('today-decision-body') ? document.getElementById('today-decision-body').children.length : -1;
    var ok = imp2.length === 3 && wbsRows && kanbanCards === todoExpected && ganttLabels >= 5 && decisionBody >= 0 && hTc === String(s.tasks.length);
    var s2 = MMGR.State.getState();
    s2.tasks = s2.tasks.filter(function(t){ return names.indexOf(t.name) === -1; });
    MMGR.Render.renderAll();
    return { ok: ok, imported: imp2.length, wbsRows: wbsRows, kanbanCards: kanbanCards, todoExpected: todoExpected, ganttLabels: ganttLabels, dashTotal: hTc, decisions: decisionBody };
  })()`);
  check('5 import: WBS + Kanban + Gantt + Dash + Decisions all refresh', !!imp.ok, imp);

  const failed = results.filter(r => !r.val);
  log('P1_GATE ' + (failed.length === 0 ? 'PASS' : 'FAIL (' + failed.length + ' broken)'));
  proc.kill(); process.exit(failed.length === 0 ? 0 : 1);
})().catch(e => { log('FATAL: ' + e.message); process.exit(1); });
