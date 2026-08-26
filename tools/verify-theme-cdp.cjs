/* ============================================================
   Device-level theme persistence check across all three pages:
     S1 — mmgr_theme=dark pref wins over light project state
     S2 — flipping the Settings toggle writes mmgr_theme + state
     S3 — no device pref -> per-project state.theme is the fallback
     S4 — launcher (app.html) toggle click flips pref + class
     S5 — admin.html header toggle click flips pref + class
     S6 — view-only scope: toggle allowed (device pref only, state untouched)
   Run: node tools/verify-theme-cdp.cjs
   ============================================================ */
const { spawn } = require('child_process');

const { chromePath: CHROME, BASE, DEBUG_PORT: PORT } = require('./chrome-launcher.cjs');
const ROOT = 'C:/Users/Garfield/Downloads/mymanager-fixed';
const userDir = 'C:/tmp/chrome-theme-' + Date.now();

const sleep = ms => new Promise(r => setTimeout(r, ms));

const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  '--remote-allow-origins=*', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + userDir, '--window-size=1280,900', 'about:blank'
], { stdio: 'ignore' });

async function waitForPageTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const list = await r.json();
      const page = list.find(t => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch (e) { /* not up */ }
    await sleep(200);
  }
  throw new Error('CDP page target did not come up');
}

(async function () {
  const wsUrl = await waitForPageTarget();
  const ws = new WebSocket(wsUrl);
  await new Promise(r => { ws.onopen = r; });

  let id = 0;
  const pending = new Map();
  const issues = [];
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method === 'Runtime.exceptionThrown') {
      issues.push('EXC: ' + ((msg.params.exceptionDetails.exception && msg.params.exceptionDetails.exception.description) || msg.params.exceptionDetails.text).slice(0, 160));
    }
    else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      issues.push('ERROR: ' + (msg.params.args || []).map(a => a.value || a.description || '').join(' ').slice(0, 160));
    }
  };
  const send = (method, params) => new Promise(resolve => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.error) return 'CDP_ERROR:' + JSON.stringify(r.error);
    if (r.result && r.result.exceptionDetails) return 'EXC:' + ((r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description) || r.result.exceptionDetails.text);
    return r.result && r.result.result ? r.result.result.value : null;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await sleep(600);

  const out = [];
  async function scenario(name, seedSrc, checkExpr) {
    const pre = await send('Page.addScriptToEvaluateOnNewDocument', { source: seedSrc });
    const startIdx = issues.length;
    await send('Page.navigate', { url: 'file:///' + ROOT + '/project.html?id=demo' });
    await sleep(6500);
    const res = await evaluate(checkExpr);
    await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: pre.identifier });
    await sleep(300);
    out.push({ scenario: name, result: res, errors: issues.slice(startIdx) });
    console.log('SCENARIO ' + name + ': ' + res);
  }

  // S1 — device pref dark vs default (light) project state: pref wins.
  await scenario('S1-pref-dark-wins', `
    try{localStorage.setItem('mmgr_theme','dark');}catch(e){}
    try{localStorage.setItem('mmgr_unlocked_demo','1');}catch(e){}
    try{localStorage.setItem('mmgr_scope_demo','full');}catch(e){}
    try{localStorage.removeItem('mmgr_state_demo');}catch(e){}
    try{indexedDB.deleteDatabase('mmgr_journal');}catch(e){}
  `, `(function(){
    return JSON.stringify({
      darkClass: document.body.classList.contains('dark-mode'),
      tglChecked: (document.getElementById('thm-tgl')||{}).checked,
      pref: localStorage.getItem('mmgr_theme'),
      stateTheme: (window.MMGR && MMGR.State.getState) ? MMGR.State.getState().theme : 'n/a'
    });
  })()`);

  // S2 — flip the Settings toggle: pref, state, and class all update.
  await evaluate(`(function(){ var t=document.getElementById('thm-tgl'); if(t) t.click(); return true; })()`);
  await sleep(800);
  out.push({ scenario: 'S2-toggle-flips', result: await evaluate(`(function(){
    return JSON.stringify({
      darkClass: document.body.classList.contains('dark-mode'),
      tglChecked: (document.getElementById('thm-tgl')||{}).checked,
      pref: localStorage.getItem('mmgr_theme'),
      stateTheme: (window.MMGR && MMGR.State.getState) ? MMGR.State.getState().theme : 'n/a'
    });
  })()`) });
  console.log('SCENARIO S2-toggle-flips: ' + out[out.length - 1].result);

  // S3 — no device pref: per-project state.theme is the fallback.
  await scenario('S3-state-fallback', `
    try{localStorage.removeItem('mmgr_theme');}catch(e){}
    try{localStorage.setItem('mmgr_unlocked_demo','1');}catch(e){}
    try{localStorage.setItem('mmgr_scope_demo','full');}catch(e){}
    try{localStorage.setItem('mmgr_state_demo', JSON.stringify({theme:'dark'}));}catch(e){}
    try{indexedDB.deleteDatabase('mmgr_journal');}catch(e){}
  `, `(function(){
    return JSON.stringify({
      darkClass: document.body.classList.contains('dark-mode'),
      tglChecked: (document.getElementById('thm-tgl')||{}).checked,
      pref: localStorage.getItem('mmgr_theme'),
      stateTheme: (window.MMGR && MMGR.State.getState) ? MMGR.State.getState().theme : 'n/a'
    });
  })()`);

  // S4 — launcher (app.html) toggle click: light -> dark flips pref + class.
  const pre4 = await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    try{localStorage.setItem('mmgr_theme','light');}catch(e){}
    try{indexedDB.deleteDatabase('mmgr_journal');}catch(e){}
  ` });
  const s4start = issues.length;
  await send('Page.navigate', { url: 'file:///' + ROOT + '/app.html' });
  await sleep(4000);
  const s4before = JSON.parse(await evaluate(`(function(){ return JSON.stringify({
    darkClass: document.body.classList.contains('dark-mode'),
    tglChecked: (document.getElementById('thm-tgl')||{}).checked
  }); })()`));
  await evaluate(`(function(){ var t=document.getElementById('thm-tgl'); if(t) t.click(); return true; })()`);
  await sleep(400);
  const s4after = JSON.parse(await evaluate(`(function(){ return JSON.stringify({
    darkClass: document.body.classList.contains('dark-mode'),
    tglChecked: (document.getElementById('thm-tgl')||{}).checked,
    pref: localStorage.getItem('mmgr_theme')
  }); })()`));
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: pre4.identifier });
  out.push({ scenario: 'S4-launcher-toggle', before: s4before, after: s4after, errors: issues.slice(s4start) });
  console.log('SCENARIO S4-launcher-toggle: ' + JSON.stringify({ before: s4before, after: s4after }));

  // S5 — admin header toggle click (logged-in session).
  const pre5 = await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    try{localStorage.setItem('mmgr_theme','light');}catch(e){}
    try{localStorage.setItem('mmgr_admin_pass_hash','seedhash');}catch(e){}
    try{sessionStorage.setItem('mmgr_admin_session','1');}catch(e){}
  ` });
  const s5start = issues.length;
  await send('Page.navigate', { url: 'file:///' + ROOT + '/admin.html' });
  await sleep(3500);
  const s5before = JSON.parse(await evaluate(`(function(){ return JSON.stringify({
    darkClass: document.body.classList.contains('dark-mode'),
    adminVisible: !document.getElementById('admin-app').classList.contains('hidden'),
    tglChecked: (document.getElementById('thm-tgl')||{}).checked
  }); })()`));
  await evaluate(`(function(){ var t=document.getElementById('thm-tgl'); if(t) t.click(); return true; })()`);
  await sleep(400);
  const s5after = JSON.parse(await evaluate(`(function(){ return JSON.stringify({
    darkClass: document.body.classList.contains('dark-mode'),
    tglChecked: (document.getElementById('thm-tgl')||{}).checked,
    pref: localStorage.getItem('mmgr_theme')
  }); })()`));
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: pre5.identifier });
  out.push({ scenario: 'S5-admin-toggle', before: s5before, after: s5after, errors: issues.slice(s5start) });
  console.log('SCENARIO S5-admin-toggle: ' + JSON.stringify({ before: s5before, after: s5after }));

  // S6 — view-only scope: theme toggle is allowed (it's a device pref), but
  // the per-project state write must be skipped.
  const pre6 = await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    try{localStorage.setItem('mmgr_theme','light');}catch(e){}
    try{localStorage.setItem('mmgr_unlocked_demo','1');}catch(e){}
    try{localStorage.setItem('mmgr_scope_demo','readonly');}catch(e){}
    try{localStorage.setItem('mmgr_state_demo', JSON.stringify({theme:'light'}));}catch(e){}
    try{indexedDB.deleteDatabase('mmgr_journal');}catch(e){}
  ` });
  const s6start = issues.length;
  await send('Page.navigate', { url: 'file:///' + ROOT + '/project.html?id=demo' });
  await sleep(6500);
  const s6before = JSON.parse(await evaluate(`(function(){ return JSON.stringify({
    readonlyMode: document.body.classList.contains('readonly-mode'),
    darkClass: document.body.classList.contains('dark-mode'),
    tglChecked: (document.getElementById('thm-tgl')||{}).checked
  }); })()`));
  await evaluate(`(function(){ var t=document.getElementById('thm-tgl'); if(t) t.click(); return true; })()`);
  await sleep(600);
  const s6after = JSON.parse(await evaluate(`(function(){ return JSON.stringify({
    darkClass: document.body.classList.contains('dark-mode'),
    tglChecked: (document.getElementById('thm-tgl')||{}).checked,
    pref: localStorage.getItem('mmgr_theme'),
    stateTheme: (window.MMGR && MMGR.State.getState) ? MMGR.State.getState().theme : 'n/a'
  }); })()`));
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: pre6.identifier });
  out.push({ scenario: 'S6-viewonly-toggle', before: s6before, after: s6after, errors: issues.slice(s6start) });
  console.log('SCENARIO S6-viewonly-toggle: ' + JSON.stringify({ before: s6before, after: s6after }));

  const s1 = JSON.parse(out[0].result);
  const s2 = JSON.parse(out[1].result);
  const s3 = JSON.parse(out[2].result);
  const s4 = out[3], s5 = out[4], s6 = out[5];
  const pass =
    s1.darkClass === true && s1.tglChecked === false && s1.pref === 'dark' &&
    s2.darkClass === false && s2.tglChecked === true && s2.pref === 'light' && s2.stateTheme === 'light' &&
    s3.darkClass === true && s3.pref === null && s3.stateTheme === 'dark' &&
    s4.before.darkClass === false && s4.after.darkClass === true && s4.after.pref === 'dark' &&
    s5.before.adminVisible === true && s5.before.darkClass === false && s5.after.darkClass === true && s5.after.pref === 'dark' &&
    s6.before.readonlyMode === true && s6.after.darkClass === true && s6.after.pref === 'dark' && s6.after.stateTheme === 'light' &&
    !out.some(o => o.errors && o.errors.length);
  console.log('\n===== THEME CHECK =====');
  console.log(JSON.stringify({ scenarios: out.map(o => ({ scenario: o.scenario, result: o.result || { before: o.before, after: o.after }, errors: o.errors })), pass }, null, 2));
  console.log('RESULT:', pass ? 'THEME PERSISTENCE OK' : 'THEME CHECK FAILED');
  proc.kill();
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('ERR', e && e.stack || e); proc.kill(); process.exit(1); });
