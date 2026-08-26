/* TEMPORARY — verifies WBS input typing survives the updTaskField re-render. Deleted after. */
const { spawn } = require('child_process');
const path = require('path');
const { chromePath: CHROME, BASE, DEBUG_PORT: PORT } = require('./tools/chrome-launcher.cjs');
const PROFILE = path.join(require('os').tmpdir(), 'mmgr-ty-' + Date.now());
let ws, msgId = 0; const pending = new Map();
const log = (s) => { process.stdout.write('[ty] ' + s + '\n'); };
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

  // Open WBS
  const diag0 = await ev('(function(){return {panels:document.querySelectorAll(".panel").length,active:document.querySelector(".panel.active")?document.querySelector(".panel.active").id:null,rows:document.querySelectorAll("#wbs-body tr").length,wbsBody:!!document.querySelector("#wbs-body"),secs:Array.from(document.querySelectorAll(".sec-btn")).map(function(b){return b.getAttribute("data-section");}).join(",")};})()');
  log('pre-diag: ' + JSON.stringify(diag0));
  await ev('document.querySelector(".sec-btn[data-section=wbs]").click()'); await delay(400);
  const diag1 = await ev('(function(){return {active:document.querySelector(".panel.active")?document.querySelector(".panel.active").id:null,rows:document.querySelectorAll("#wbs-body tr").length};})()');
  log('post-click: ' + JSON.stringify(diag1));
  // Mark t2 as lead-time so the date inputs render
  await ev('(function(){var row=document.querySelector("#wbs-body tr[data-id=t2]");if(row)row.querySelector("[data-action=tglLeadTime]").click();})()'); await delay(400);

  // Focus the assignee text input of t2 and type via CDP key events
  const tgt = await ev('(function(){var row=document.querySelector("#wbs-body tr[data-id=t2]");var inp=row.querySelector("input[data-field=assignee]");inp.focus();inp.setSelectionRange(inp.value.length,inp.value.length);return {id:inp.getAttribute("data-id"),before:inp.value};})()');
  log('focus assignee of ' + tgt.id + ' (was "' + tgt.before + '")');
  await ev('document.execCommand("insertText", false, "Zed");'); await delay(300);
  const after = await ev('(function(){var row=document.querySelector("#wbs-body tr[data-id=t2]");var inp=row.querySelector("input[data-field=assignee]");return {value:inp?inp.value:null,focused:document.activeElement===inp};})()');
  log('assignee after typing 3 chars: value=' + JSON.stringify(after.value) + ' stillFocused=' + after.focused);

  // Now the date input: type into submittedDate
  await ev('(function(){var row=document.querySelector("#wbs-body tr[data-id=t2]");var inp=row.querySelector("input[data-field=submittedDate]");inp.focus();return true;})()'); await delay(200);
  // Use native setter + input event to simulate what typing does
  await ev('(function(){var row=document.querySelector("#wbs-body tr[data-id=t2]");var inp=row.querySelector("input[data-field=submittedDate]");var setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;setter.call(inp,"2026-08-01");inp.dispatchEvent(new Event("input",{bubbles:true}));return true;})()'); await delay(300);
  const d1 = await ev('(function(){var row=document.querySelector("#wbs-body tr[data-id=t2]");var inp=row.querySelector("input[data-field=submittedDate]");return {value:inp?inp.value:null,focused:document.activeElement===inp};})()');
  log('submittedDate after input: value=' + JSON.stringify(d1.value) + ' stillFocused=' + d1.focused);

  const pass = !!(after && after.value === 'BobZed' && after.focused === true && d1 && d1.value === '2026-08-01' && d1.focused === true && !d1.__err);
  log('TYPING_PROBE ' + (pass ? 'PASS' : 'FAIL'));
  proc.kill(); process.exit(pass ? 0 : 1);
})().catch(e => { log('FATAL: ' + e.message); process.exit(1); });
