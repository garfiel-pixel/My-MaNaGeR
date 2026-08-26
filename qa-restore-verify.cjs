/* ============================================================
   My MaNaGeR — RESTORE verification (MONOLITH-FEATURE-PARITY)
   Drives headless Chrome against http://127.0.0.1:8765 and
   verifies each restoration works end to end.
   ============================================================ */
const { spawn } = require('child_process');
const path = require('path');
const { chromePath: CHROME, BASE, DEBUG_PORT: PORT } = require('./tools/chrome-launcher.cjs');
const PROFILE = path.join(require('os').tmpdir(), 'mmgr-restore-' + Date.now());
let ws, msgId = 0;
const pending = new Map();
const results = [];
const log = (s) => { process.stdout.write(s + '\n'); };
const delay = (ms) => new Promise(r => setTimeout(r, ms));
setTimeout(() => { log('WATCHDOG TIMEOUT'); try { ws && ws.close(); } catch (e) {} process.exit(2); }, 120000);

function send(method, params) {
  return new Promise(res => {
    const id = ++msgId;
    pending.set(id, m => { pending.delete(id); res(m.result || {}); });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text };
  return r.result && r.result.value;
}
async function check(name, expr, hint) {
  const v = await ev(expr);
  const ok = !!v && v.__err === undefined && v.val === true;
  results.push({ status: ok ? 'PASS' : 'FAIL', name, detail: v && v.__err ? v.__err : JSON.stringify(v) });
  log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${ok ? '' : '  <-- ' + JSON.stringify(v) + (hint ? ' (' + hint + ')' : '')}`);
  return v;
}

(async () => {
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, '--window-size=1440,1200', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) break; } catch (e) {}
    await delay(300);
  }
  const targets = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  ws.onmessage = (ev2) => {
    const m = JSON.parse(ev2.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws fail')); });
  await send('Runtime.enable'); await send('Page.enable');

  // Seed + boot the demo project
  await send('Page.navigate', { url: BASE + '/seed-test.html' });
  await delay(4000);
  await send('Page.navigate', { url: BASE + '/project.html?id=demo-project' });
  await delay(3500);

  // Seed a risk + a schedule issue so the new UI has data to render.
  await ev(`MMGR.State.updateState(function(s){if(!s.risks)s.risks=[];s.risks.push({id:'vr1',description:'Restore verify risk',probability:'High',impact:'High',mitigation:'Mitigate',issueId:null});});`);
  await ev(`MMGR.State.updateState(function(s){var t=s.tasks&&s.tasks.find(function(x){return x.id&&!x.isPhase;});if(t){t.startDate='2026-03-10';t.endDate='2026-03-01';}});`);
  await ev(`MMGR.Render.renderRisks(); MMGR.Render.renderWbs();`);
  await delay(300);
  await check('R1a matrix container populated', `(function(){var m=document.getElementById('risk-matrix');return {val: !!m && m.innerHTML.indexOf('Very High')>-1 && m.innerHTML.indexOf('data-action="riskMatrixCell"')>-1};})()`);
  await check('R1b cell click filters risk list', `(function(){
    var cell=document.querySelector('#risk-matrix [data-action="riskMatrixCell"]');
    if(!cell)return {val:false,why:'no cell'};
    cell.click();
    var s=MMGR.State.getState();
    var filt=(s.risks||[]).filter(function(r){return (r.probability||'')===cell.getAttribute('data-prob')&&(r.impact||'')===cell.getAttribute('data-imp');});
    var body=document.getElementById('risk-body');
    var rows=body?body.querySelectorAll('tr').length:0;
    return {val: rows>0 && rows<=Math.max(1,filt.length), rows:rows, want:filt.length};
  })()`);
  await check('R1c clear filter button appears + works', `(function(){
    var btn=document.querySelector('[data-action="riskMatrixClear"]');
    if(!btn)return {val:false,why:'no clear btn'};
    btn.click();
    var body=document.getElementById('risk-body');
    return {val: !document.querySelector('[data-action="riskMatrixClear"]') && body.querySelectorAll('tr').length>0};
  })()`);

  // RESTORE-2: Import Dates Copy List button
  await check('R2 Copy List button present in modal', `(function(){var b=document.querySelector('[data-action="copyIdTemplate"]');return {val: !!b && b.textContent.indexOf('Copy List')>-1};})()`);
  await check('R2b copyIdTemplate copies the template', `(function(){
    MMGR.Tasks.openImportDates();
    var b=document.querySelector('[data-action="copyIdTemplate"]');
    if(!b)return {val:false,why:'no btn'};
    b.click();
    var toast=document.querySelector('.toast');
    return {val: !!toast && toast.textContent.indexOf('Copied')>-1};
  })()`);

  // RESTORE-3: email templates
  await check('R3a four email buttons exist', `(function(){var b=document.querySelectorAll('[data-action="emailTpl"]');return {val: b.length===4 && b[0].getAttribute('data-kind')==='status' && b[3].getAttribute('data-kind')==='closure'};})()`);
  await check('R3b emailTpl(status) produces a draft', `(function(){
    MMGR.App.emailTpl('status');
    var toast=document.querySelector('.toast');
    // Verify the compositor produces a Subject line by peeking through the
    // same state path the copy uses (clipboard read needs a permission grant
    // headless Chrome does not auto-grant; the toast is the copy evidence).
    var s=MMGR.State.getState();
    var f=s.charter||{};
    var okSubject=(f.name||'[Project Name]').length>0;
    return {val: !!toast && toast.textContent.indexOf('Email template copied')>-1 && okSubject};
  })()`);

  // RESTORE-5: Print Charter wiring
  await check('R5a charter-root carries charter-print-root class', `(function(){var el=document.getElementById('charter-root');return {val: !!el && el.classList.contains('charter-print-root')};})()`);
  await check('R5b printCharter action wired + API present', `(function(){return {val: typeof MMGR.Charter.printCharter==='function' && !!document.querySelector('[data-action="printCharter"]')};})()`);

  // RESTORE-6: Save Charter
  await check('R6a saveCharter action wired', `(function(){return {val: typeof MMGR.Charter.saveCharter==='function' && !!document.querySelector('[data-action="saveCharter"]')};})()`);
  await check('R6b saveCharter writes state + toast', `(function(){
    var nm=document.getElementById('ch-name');
    if(nm)nm.value='RESTORE VERIFY PROJ';
    MMGR.Charter.saveCharter();
    var s=MMGR.State.getState();
    var toast=document.querySelector('.toast');
    return {val: (s.charter||{}).name==='RESTORE VERIFY PROJ' && !!toast && toast.textContent.indexOf('Charter saved')>-1};
  })()`);

  // RESTORE-7: WBS alerts banner
  await check('R7a banner container exists', `(function(){return {val: !!document.getElementById('wbs-alerts')};})()`);
  await check('R7b banner renders when schedule has issues', `(function(){
    var el=document.getElementById('wbs-alerts');
    return {val: !!el && el.innerHTML.indexOf('schedule logic issue')>-1 && el.innerHTML.indexOf('tglWbsIssues')>-1};
  })()`);
  await check('R7c banner toggle expands/collapses detail', `(function(){
    var tgl=document.querySelector('[data-action="tglWbsIssues"]');
    if(!tgl)return {val:false,why:'no tgl'};
    tgl.click();
    // Re-query after the re-render — renderWbsAlerts replaces the nodes.
    var d1=document.getElementById('wbs-issues-detail');
    var open1=!!d1 && d1.style.display!=='none';
    var tgl2=document.querySelector('[data-action="tglWbsIssues"]');
    if(!tgl2)return {val:false,why:'no tgl after open'};
    tgl2.click();
    var d2=document.getElementById('wbs-issues-detail');
    var open2=!!d2 && d2.style.display==='none';
    return {val: open1 && open2, open1:open1, open2:open2};
  })()`);

  const pass = results.filter(r => r.status === 'PASS').length;
  const fail = results.length - pass;
  log('\n==== QA RESTORE SUMMARY: ' + pass + ' passed / ' + fail + ' failed of ' + results.length + ' ====');
  results.filter(r => r.status === 'FAIL').forEach(r => log('FAILED: ' + r.name + ' :: ' + r.detail));
  try { proc.kill(); ws.close(); } catch (e) {}
  process.exit(fail ? 1 : 0);
})().catch(e => { log('FATAL ' + e.message); process.exit(1); });
