/* TEMPORARY — probes focus/rebuild behavior during change-triggered re-renders. Deleted after. */
const { spawn } = require('child_process');
const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9227;
const PROFILE = path.join(require('os').tmpdir(), 'mmgr-foc-' + Date.now());
let ws, msgId = 0; const pending = new Map();
const log = (s) => { process.stdout.write('[fc] ' + s + '\n'); };
const delay = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { log('WATCHDOG'); try{ws&&ws.close();}catch(e){} process.exit(2); }, 90000);
function send(method, params) { return new Promise(res => { const id = ++msgId; pending.set(id, m => { pending.delete(id); res(m.result || {}); }); ws.send(JSON.stringify({ id, method, params: params || {} })); }); }
async function ev(expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __err: r.exceptionDetails.exception.description }; return r.result && r.result.value; }

(async () => {
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, '--window-size=1440,1200', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { const r = await fetch('http://localhost:' + PORT + '/json/version'); if (r.ok) break; } catch (e) { } await delay(300); }
  const targets = await (await fetch('http://localhost:' + PORT + '/json')).json();
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws fail')); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://localhost:8765/seed-test.html' }); await delay(3500);
  await ev('window.MMGR.Schedule.cascade("northern-temperate",{threshold:999}); window.MMGR.Render.renderAll();'); await delay(300);
  await ev('document.querySelector(".sec-btn[data-section=wbs]").click()'); await delay(400);
  await ev('(function(){var row=document.querySelector("#wbs-body tr[data-id=t2]");if(row)row.querySelector("[data-action=tglLeadTime]").click();})()'); await delay(400);

  // Case A — TEXT field (assignee): a change-triggered re-render must restore
  // focus to the rebuilt twin (caret-preservation contract, unchanged).
  await ev('(function(){var row=document.querySelector("#wbs-body tr[data-id=t2]");var inp=row.querySelector("input[data-field=assignee]");inp.focus();inp.setSelectionRange(inp.value.length,inp.value.length);return true;})()');
  await ev('document.execCommand("insertText", false, "Zed");');
  await ev('(function(){var row=document.querySelector("#wbs-body tr[data-id=t2]");var inp=row.querySelector("input[data-field=assignee]");var setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;setter.call(inp,inp.value);inp.dispatchEvent(new Event("change",{bubbles:true}));return true;})()');
  await delay(500);
  const txt = await ev('(function(){var ae=document.activeElement;return {ok: !!ae && ae.getAttribute && ae.getAttribute("data-field")==="assignee" && ae.getAttribute("data-id")==="t2" && ae.value==="BobZed"};})()');
  log('text-field focus restored to twin: ' + JSON.stringify(txt));

  // Case B — DATE field: a real picker commit must NOT rebuild the WBS row.
  // The same input node survives, the value commits to state, and focus stays
  // on it (re-focusing a date input would re-open the picker in Chrome).
  const dateRes = await ev('(async function(){var row=document.querySelector("#wbs-body tr[data-id=t2]");var d=row.querySelector("input[data-field=submittedDate]");d.focus();var node=d;var setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;setter.call(d,"2026-08-02");d.dispatchEvent(new Event("change",{bubbles:true}));await new Promise(function(r){setTimeout(r,200);});var row2=document.querySelector("#wbs-body tr[data-id=t2]");var d2=row2?row2.querySelector("input[data-field=submittedDate]"):null;var s=MMGR.State.getState();var t=s.tasks.find(function(x){return x.id==="t2";});return {sameNode: !!node && node.isConnected && d2===node, committed: !!(t && t.submittedDate==="2026-08-02"), focusKept: document.activeElement===node};})()');
  log('date-commit no-rebuild contract: ' + JSON.stringify(dateRes));

  const pass = !!(txt && txt.ok && dateRes && dateRes.sameNode && dateRes.committed && dateRes.focusKept);
  log('FOCUS_PROBE ' + (pass ? 'PASS' : 'FAIL'));
  proc.kill(); process.exit(pass ? 0 : 1);
})().catch(e => { log('FATAL: ' + e.message); process.exit(1); });
