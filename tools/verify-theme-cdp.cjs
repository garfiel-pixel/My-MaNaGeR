/* ============================================================
   Device-level theme persistence check across all three pages:
     S1 — mmgr_theme=dark pref wins over light project state
     S2 — dock Light click flips pref + body class (owner D11: the
          shared bottom dock is the one theme picker now)
     S3 — no device pref -> per-project state.theme is the fallback
     S4 — launcher (app.html) dock click flips pref + class
     S5 — admin.html dock click flips pref + class
     S6 — view-only scope: toggle allowed (device pref only, state untouched)
     S7 — System mode follows the OS (owner D6, restored 2026-09-03):
          stored 'system' + dark OS -> dark, + light OS -> light; also
          checks the marketing no-regression path (index.html shares
          mmgr-theme.js). D12: a fresh browser (no pref) stays light.
   Run: node tools/verify-theme-cdp.cjs
   ============================================================ */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

const { chromePath: CHROME, BASE, DEBUG_PORT: PORT } = require('./chrome-launcher.cjs');
const ROOT = path.join(__dirname, '..');
const userDir = path.join(os.tmpdir(), 'chrome-theme-' + Date.now());

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
      pressedDark: (function(){ var b=document.querySelector('.dock .pal-btn[data-pal="dark"]'); return b ? b.getAttribute('aria-pressed') === 'true' : null; })(),
      pref: localStorage.getItem('mmgr_theme'),
      stateTheme: (window.MMGR && MMGR.State.getState) ? MMGR.State.getState().theme : 'n/a'
    });
  })()`);

  // S2 — click the dock's Light button (S1 left Dark active): pref, pressed
  // state, and body class update together.
  await evaluate(`(function(){ var b=document.querySelector('.dock .pal-btn[data-pal="light"]'); if(b) b.click(); return true; })()`);
  await sleep(800);
  out.push({ scenario: 'S2-dock-light', result: await evaluate(`(function(){
    return JSON.stringify({
      darkClass: document.body.classList.contains('dark-mode'),
      pressedLight: (function(){ var b=document.querySelector('.dock .pal-btn[data-pal="light"]'); return b ? b.getAttribute('aria-pressed') === 'true' : null; })(),
      pref: localStorage.getItem('mmgr_theme'),
      stateTheme: (window.MMGR && MMGR.State.getState) ? MMGR.State.getState().theme : 'n/a'
    });
  })()`) });
  console.log('SCENARIO S2-dock-light: ' + out[out.length - 1].result);

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
      pref: localStorage.getItem('mmgr_theme'),
      stateTheme: (window.MMGR && MMGR.State.getState) ? MMGR.State.getState().theme : 'n/a'
    });
  })()`);

  // S4 — launcher (app.html) dock click: light -> dark flips pref + class.
  const pre4 = await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    try{localStorage.setItem('mmgr_theme','light');}catch(e){}
    try{indexedDB.deleteDatabase('mmgr_journal');}catch(e){}
  ` });
  const s4start = issues.length;
  await send('Page.navigate', { url: 'file:///' + ROOT + '/app.html' });
  await sleep(4000);
  const s4before = JSON.parse(await evaluate(`(function(){ return JSON.stringify({
    darkClass: document.body.classList.contains('dark-mode'),
    pressedDark: (function(){ var b=document.querySelector('.dock .pal-btn[data-pal="dark"]'); return b ? b.getAttribute('aria-pressed') === 'true' : null; })()
  }); })()`));
  await evaluate(`(function(){ var b=document.querySelector('.dock .pal-btn[data-pal="dark"]'); if(b) b.click(); return true; })()`);
  await sleep(400);
  const s4after = JSON.parse(await evaluate(`(function(){ return JSON.stringify({
    darkClass: document.body.classList.contains('dark-mode'),
    pressedDark: (function(){ var b=document.querySelector('.dock .pal-btn[data-pal="dark"]'); return b ? b.getAttribute('aria-pressed') === 'true' : null; })(),
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
    adminVisible: !document.getElementById('admin-app').classList.contains('hidden')
  }); })()`));
  await evaluate(`(function(){ var b=document.querySelector('.dock .pal-btn[data-pal="dark"]'); if(b) b.click(); return true; })()`);
  await sleep(400);
  const s5after = JSON.parse(await evaluate(`(function(){ return JSON.stringify({
    darkClass: document.body.classList.contains('dark-mode'),
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
    darkClass: document.body.classList.contains('dark-mode')
  }); })()`));
  await evaluate(`(function(){ var b=document.querySelector('.dock .pal-btn[data-pal="dark"]'); if(b) b.click(); return true; })()`);
  await sleep(600);
  const s6after = JSON.parse(await evaluate(`(function(){ return JSON.stringify({
    darkClass: document.body.classList.contains('dark-mode'),
    pref: localStorage.getItem('mmgr_theme'),
    stateTheme: (window.MMGR && MMGR.State.getState) ? MMGR.State.getState().theme : 'n/a'
  }); })()`));
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: pre6.identifier });
  out.push({ scenario: 'S6-viewonly-toggle', before: s6before, after: s6after, errors: issues.slice(s6start) });
  console.log('SCENARIO S6-viewonly-toggle: ' + JSON.stringify({ before: s6before, after: s6after }));

  // S7 — System mode follows the OS (owner D6, restored 2026-09-03).
  // Emulated dark OS + stored 'system' -> page dark + System pressed;
  // emulated light OS -> page light. Also covers the marketing
  // no-regression path (index.html shares mmgr-theme.js), and D12: a fresh
  // browser with no pref stays light (covered by S3's pref === null arm).
  const s7start = issues.length;
  const pre7 = await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    try{localStorage.setItem('mmgr_theme','system');}catch(e){}
    try{localStorage.setItem('mmgr_unlocked_demo','1');}catch(e){}
    try{localStorage.setItem('mmgr_scope_demo','full');}catch(e){}
    try{localStorage.removeItem('mmgr_state_demo');}catch(e){}
    try{indexedDB.deleteDatabase('mmgr_journal');}catch(e){}
  ` });  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  // Route through about:blank so the emulated colour scheme is definitely
  // active before the target document's FOUC script runs (a same-URL
  // re-navigation can otherwise short-circuit into the old document).
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(300);
  await send('Page.navigate', { url: 'file:///' + ROOT + '/project.html?id=demo&t=system' });
  await sleep(6500);
  const s7dark = JSON.parse(await evaluate(`(function(){ return JSON.stringify({
      darkClass: document.body.classList.contains('dark-mode'),
      mqDark: matchMedia('(prefers-color-scheme: dark)').matches,
      pref: localStorage.getItem('mmgr_theme'),
      pressedSystem: (function(){ var b=document.querySelector('.dock .pal-btn[data-pal="system"]'); return b ? b.getAttribute('aria-pressed') === 'true' : null; })()
    }); })()`));
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await send('Page.navigate', { url: 'file:///' + ROOT + '/index.html' });
  await sleep(4000);
  const s7light = JSON.parse(await evaluate(`(function(){ return JSON.stringify({
    darkClass: document.body.classList.contains('dark-mode'),
    pref: localStorage.getItem('mmgr_theme')
  }); })()`));
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: pre7.identifier });
  out.push({ scenario: 'S7-system-follows-os', dark: s7dark, light: s7light, errors: issues.slice(s7start) });
  console.log('SCENARIO S7-system-follows-os: ' + JSON.stringify({ dark: s7dark, light: s7light }));

  const s1 = JSON.parse(out[0].result);
  const s2 = JSON.parse(out[1].result);
  const s3 = JSON.parse(out[2].result);
  const s4 = out[3], s5 = out[4], s6 = out[5], s7 = out[6];
  const pass =
    s1.darkClass === true && s1.pressedDark === true && s1.pref === 'dark' &&
    s2.darkClass === false && s2.pressedLight === true && s2.pref === 'light' &&
    s3.darkClass === true && s3.pref === null && s3.stateTheme === 'dark' &&
    s4.before.darkClass === false && s4.after.darkClass === true && s4.after.pref === 'dark' && s4.after.pressedDark === true &&
    s5.before.adminVisible === true && s5.before.darkClass === false && s5.after.darkClass === true && s5.after.pref === 'dark' &&
    s6.before.readonlyMode === true && s6.after.darkClass === true && s6.after.pref === 'dark' && s6.after.stateTheme === 'light' &&
    s7.dark.darkClass === true && s7.dark.mqDark === true && s7.dark.pressedSystem === true && s7.dark.pref === 'system' &&
    s7.light.darkClass === false && s7.light.pref === 'system' &&
    !out.some(o => o.errors && o.errors.length);
  console.log('\n===== THEME CHECK =====');
  console.log(JSON.stringify({ scenarios: out.map(o => ({ scenario: o.scenario, result: o.result || { before: o.before, after: o.after }, errors: o.errors })), pass }, null, 2));
  console.log('RESULT:', pass ? 'THEME PERSISTENCE OK' : 'THEME CHECK FAILED');
  proc.kill();
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('ERR', e && e.stack || e); proc.kill(); process.exit(1); });
