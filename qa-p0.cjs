/* ============================================================
   PHASE 0 GATE — date-edit fighting bug (P0)
   Stronger than qa-focus/qa-typing: wraps the renderers in
   spies so a date commit provably NEVER rebuilds the WBS table,
   never re-focuses a picker input, and leaves adjacent fields
   editable. Exit 0 only when every contract holds.
   Usage: node qa-p0.cjs  (server must be on :8765)
   ============================================================ */
const { spawn } = require('child_process');
const path = require('path');
const { chromePath: CHROME, BASE, DEBUG_PORT: PORT } = require('./tools/chrome-launcher.cjs');
const PROFILE = path.join(require('os').tmpdir(), 'mmgr-p0-' + Date.now());
let ws, msgId = 0; const pending = new Map();
const log = (s) => { process.stdout.write('[p0] ' + s + '\n'); };
const delay = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { log('WATCHDOG'); try { ws && ws.close(); } catch (e) {} process.exit(2); }, 120000);
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
  await ev('document.querySelector(".sec-btn[data-section=wbs]").click()'); await delay(400);

  const results = [];
  const check = (name, val, detail) => { results.push({ name, val, detail }); log((val ? 'PASS' : 'FAIL') + ' ' + name + (val ? '' : '  <-- ' + JSON.stringify(detail))); };

  // ---- A: install render spies -------------------------------------------
  await ev(`(function(){
    window.__spy = {};
    ['renderWbs','renderGantt','renderKanban','renderDash'].forEach(function(k){
      var orig = MMGR.Render[k];
      window.__spy[k] = { calls: 0, orig: orig };
      MMGR.Render[k] = function(){ window.__spy[k].calls++; return orig.apply(MMGR.Render, arguments); };
    });
    return true;
  })()`);

  // ---- B: focus a date input must NOT re-render or recreate it ------------
  const focRes = await ev(`(function(){
    var row = document.querySelector('#wbs-body tr.wbs-row[data-id="t2"]');
    var inp = row.querySelector('input[data-field="startDate"]');
    inp.focus();
    return { node: inp, nodeId: (window.__d0 = inp) !== null };
  })()`);
  await delay(150);
  const focCalls = await ev('(function(){return {wbs: window.__spy.renderWbs.calls, gan: window.__spy.renderGantt.calls, kan: window.__spy.renderKanban.calls, dash: window.__spy.renderDash.calls};})()');
  const stillSame = await ev('(function(){var inp=document.querySelector(\'#wbs-body tr.wbs-row[data-id="t2"] input[data-field="startDate"]\');return inp===window.__d0 && inp.isConnected;})()');
  check('B focus date input: no re-render fired', focCalls.wbs === 0 && focCalls.gan === 0 && focCalls.kan === 0 && focCalls.dash === 0, focCalls);
  check('B2 focus date input: same node survives', stillSame === true, stillSame);

  // ---- C: date commit must patch cell + refresh derived panels only ------
  const commitRes = await ev(`(async function(){
    window.__spy.renderWbs.calls = 0; window.__spy.renderGantt.calls = 0;
    window.__spy.renderKanban.calls = 0; window.__spy.renderDash.calls = 0;
    var row = document.querySelector('#wbs-body tr.wbs-row[data-id="t2"]');
    var d = row.querySelector('input[data-field="startDate"]');
    var node = d;
    var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(d, '2026-08-01');
    d.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(function(r){ setTimeout(r, 200); });
    var s = MMGR.State.getState();
    var t = s.tasks.find(function(x){ return x.id === 't2'; });
    var row2 = document.querySelector('#wbs-body tr.wbs-row[data-id="t2"]');
    var d2 = row2 ? row2.querySelector('input[data-field="startDate"]') : null;
    var e2 = row2 ? row2.querySelector('input[data-field="endDate"]') : null;
    return {
      sameNode: !!node && node.isConnected && d2 === node,
      committed: t.startDate === '2026-08-01',
      endRecomputed: !!t.endDate && t.endDate !== '2026-08-21',
      endCellPatched: !!e2 && e2.value === t.endDate,
      wbsCalls: window.__spy.renderWbs.calls,
      ganttCalls: window.__spy.renderGantt.calls,
      kanbanCalls: window.__spy.renderKanban.calls,
      dashCalls: window.__spy.renderDash.calls
    };
  })()`);
  check('C date commit: never calls renderWbs', commitRes.wbsCalls === 0, commitRes);
  check('C2 date commit: state + same node + end cell patched', commitRes.sameNode && commitRes.committed && commitRes.endRecomputed && commitRes.endCellPatched, commitRes);
  check('C3 date commit: Gantt + Kanban + Dash refresh', commitRes.ganttCalls > 0 && commitRes.kanbanCalls > 0 && commitRes.dashCalls > 0, commitRes);

  // ---- D: adjacent field immediately editable after a date commit --------
  const adjRes = await ev(`(async function(){
    var row = document.querySelector('#wbs-body tr.wbs-row[data-id="t2"]');
    var inp = row.querySelector('input[data-field="assignee"]');
    inp.focus();
    inp.setSelectionRange(inp.value.length, inp.value.length);
    document.execCommand('insertText', false, 'X');
    await new Promise(function(r){ setTimeout(r, 120); });
    var row2 = document.querySelector('#wbs-body tr.wbs-row[data-id="t2"]');
    var inp2 = row2 ? row2.querySelector('input[data-field="assignee"]') : null;
    var s = MMGR.State.getState();
    var t = s.tasks.find(function(x){ return x.id === 't2'; });
    return { value: t.assignee, focused: document.activeElement === inp2, typed: (t.assignee || '').indexOf('X') > -1 };
  })()`);
  check('D adjacent field editable right after date commit', adjRes.typed && adjRes.focused, adjRes);

  // ---- E: non-date change while a date input has focus skips renderWbs ----
  const pickerGuard = await ev(`(async function(){
    var row = document.querySelector('#wbs-body tr.wbs-row[data-id="t2"]');
    var d = row.querySelector('input[data-field="startDate"]');
    d.focus();
    window.__spy.renderWbs.calls = 0;
    var sel = row.querySelector('select[data-field="status"]');
    var setterSel = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setterSel.call(sel, 'blocked');
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(function(r){ setTimeout(r, 200); });
    var s = MMGR.State.getState();
    var t = s.tasks.find(function(x){ return x.id === 't2'; });
    var row2 = document.querySelector('#wbs-body tr.wbs-row[data-id="t2"]');
    var d2 = row2 ? row2.querySelector('input[data-field="startDate"]') : null;
    var ok = { wbsCalls: window.__spy.renderWbs.calls, committed: t.status === 'blocked', dateStillConnected: !!d2 && d2.isConnected };
    t.status = 'inprogress';
    MMGR.State.updateState(function(s){ s.tasks.find(function(x){return x.id==='t2';}).status = 'inprogress'; });
    return ok;
  })()`);
  check('E non-date change with date focused: renderWbs skipped', pickerGuard.wbsCalls === 0 && pickerGuard.committed && pickerGuard.dateStillConnected, pickerGuard);

  // ---- F: lead-time dates (submittedDate/expectedDate) also never rebuild --
  const ltRes = await ev(`(async function(){
    window.__spy.renderWbs.calls = 0;
    var row = document.querySelector('#wbs-body tr.wbs-row[data-id="t3"]');
    var d = row.querySelector('input[data-field="expectedDate"]');
    var node = d;
    var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(d, '2026-08-25');
    d.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(function(r){ setTimeout(r, 200); });
    var s = MMGR.State.getState();
    var t = s.tasks.find(function(x){ return x.id === 't3'; });
    var row2 = document.querySelector('#wbs-body tr.wbs-row[data-id="t3"]');
    var d2 = row2 ? row2.querySelector('input[data-field="expectedDate"]') : null;
    return { wbsCalls: window.__spy.renderWbs.calls, committed: t.expectedDate === '2026-08-25', sameNode: d2 === node };
  })()`);
  check('F lead-time date commit: no renderWbs, node survives', ltRes.wbsCalls === 0 && ltRes.committed && ltRes.sameNode, ltRes);

  // ---- G: endDate direct edit also never rebuilds -------------------------
  const endRes = await ev(`(async function(){
    window.__spy.renderWbs.calls = 0;
    var row = document.querySelector('#wbs-body tr.wbs-row[data-id="t2"]');
    var d = row.querySelector('input[data-field="endDate"]');
    var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(d, '2026-09-05');
    d.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(function(r){ setTimeout(r, 200); });
    var s = MMGR.State.getState();
    var t = s.tasks.find(function(x){ return x.id === 't2'; });
    return { wbsCalls: window.__spy.renderWbs.calls, committed: t.endDate === '2026-09-05' };
  })()`);
  check('G endDate commit: no renderWbs', endRes.wbsCalls === 0 && endRes.committed, endRes);

  // ---- H: REAL click path (the user-facing failure mode) ----------------
  // A real click on a date input must fire ZERO renders and ZERO preventDefault
  // (the delegated click handler no longer touches editable controls).
  const realClick = await ev(`(async function(){
    window.__spy.renderWbs.calls = 0; window.__spy.renderGantt.calls = 0;
    window.__spy.renderKanban.calls = 0; window.__spy.renderDash.calls = 0;
    var out = {};
    var row = document.querySelector('#wbs-body tr.wbs-row[data-id="t2"]');

    // date input
    var d = row.querySelector('input[data-field="startDate"]');
    var ev2 = new MouseEvent('click', { bubbles: true, cancelable: true });
    d.dispatchEvent(ev2);
    out.datePrevented = ev2.defaultPrevented;
    await new Promise(function(r){ setTimeout(r, 150); });
    out.afterDate = {
      wbs: window.__spy.renderWbs.calls, gantt: window.__spy.renderGantt.calls,
      kanban: window.__spy.renderKanban.calls, dash: window.__spy.renderDash.calls
    };

    // status select
    window.__spy.renderWbs.calls = 0; window.__spy.renderKanban.calls = 0;
    var sel = row.querySelector('select[data-field="status"]');
    var ev3 = new MouseEvent('click', { bubbles: true, cancelable: true });
    sel.dispatchEvent(ev3);
    out.selPrevented = ev3.defaultPrevented;
    await new Promise(function(r){ setTimeout(r, 150); });
    out.afterSelect = { wbs: window.__spy.renderWbs.calls, kanban: window.__spy.renderKanban.calls };

    // assignee text input
    window.__spy.renderWbs.calls = 0;
    var inp = row.querySelector('input[data-field="assignee"]');
    inp.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise(function(r){ setTimeout(r, 150); });
    out.afterText = { wbs: window.__spy.renderWbs.calls };

    // a real click must not have committed any state change either
    var s = MMGR.State.getState();
    var t = s.tasks.find(function(x){ return x.id === 't2'; });
    out.startUnchanged = t.startDate;
    return out;
  })()`);
  const rd = realClick.afterDate, rs = realClick.afterSelect, rt = realClick.afterText;
  check('H real click date input: zero renders + no preventDefault', !!rd && rd.wbs === 0 && rd.gantt === 0 && rd.kanban === 0 && rd.dash === 0 && realClick.datePrevented === false, realClick);
  check('H2 real click select: zero renders + no preventDefault', !!rs && rs.wbs === 0 && rs.kanban === 0 && realClick.selPrevented === false, realClick);
  check('H3 real click text input: zero renders', !!rt && rt.wbs === 0, realClick);
  check('H4 real clicks commit no state', realClick.startUnchanged === '2026-08-01', realClick);

  const failed = results.filter(r => !r.val);
  log('P0_GATE ' + (failed.length === 0 ? 'PASS' : 'FAIL (' + failed.length + ' broken)'));
  proc.kill(); process.exit(failed.length === 0 ? 0 : 1);
})().catch(e => { log('FATAL: ' + e.message); process.exit(1); });
