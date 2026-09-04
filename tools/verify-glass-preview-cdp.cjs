/* ============================================================
   Premium-glass preview check for the launcher + admin gate:
     G1 — app.html boots the engine (pref premium + forced
          high-end + wide viewport): glass-premium class, canvas,
          content layered above it
     G2 — flipping the launcher glass toggle tears it down
     G3 — the shared bottom dock drives the engine on the admin
          gate (setup screen) — the dock replaced the old #gate-prefs
          pill (owner D3/D11, 2026-09-03)
   Run: node tools/verify-glass-preview-cdp.cjs
   ============================================================ */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

const { chromePath: CHROME, BASE, DEBUG_PORT: PORT } = require('./chrome-launcher.cjs');
const ROOT = path.join(__dirname, '..');
const userDir = path.join(os.tmpdir(), 'chrome-glass-' + Date.now());

const sleep = ms => new Promise(r => setTimeout(r, ms));

// NOTE: no --disable-gpu here — the premium engine needs a real WebGL
// context (SwiftShader in headless); the flag would silently fail every
// boot scenario with no console error.
const proc = spawn(CHROME, [
  '--headless=new', '--no-sandbox',
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
    else if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) {
      issues.push(msg.params.type.toUpperCase() + ': ' + (msg.params.args || []).map(a => a.value || a.description || '').join(' ').slice(0, 160));
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

  // Served over the dev server (BASE), not file:// — file:// pages block the
  // engine's cross-origin ES-module import of three.js (CDP harness fix,
  // 2026-09-03; the old hardcoded Downloads ROOT is retired).
  async function navigate(seed) {
    const pre = await send('Page.addScriptToEvaluateOnNewDocument', { source: seed });
    const startIdx = issues.length;
    await send('Page.navigate', { url: BASE + '/app.html' });
    await sleep(3000);
    await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: pre.identifier });
    return startIdx;
  }
  const state = () => evaluate(`(function(){ return JSON.stringify({
    glassClass: document.body.classList.contains('glass-premium'),
    canvas: !!document.getElementById('glass-canvas'),
    canvasZ: (function(){ var c=document.getElementById('glass-canvas'); return c ? getComputedStyle(c).zIndex : null; })(),
    wrapAbove: (function(){ var w=document.querySelector('.wrap'); if(!w) return null; var s=getComputedStyle(w); return {pos:s.position, z:s.zIndex}; })(),
    pref: localStorage.getItem('mmgr_glass_mode')
  }); })()`);

  // G1 — premium engine boots on the launcher.
  let idx = await navigate(`
    try{localStorage.setItem('mmgr_glass_mode','premium');}catch(e){}
    try{window.__mmgrForceHighEnd=true;}catch(e){}
  `);
  await sleep(7000); // CDN fetch + first frames
  const g1 = JSON.parse(await state());
  out.push({ scenario: 'G1-launcher-premium-boot', result: g1, errors: issues.slice(idx) });
  console.log('SCENARIO G1-launcher-premium-boot: ' + JSON.stringify(g1));

  // G2 — launcher toggle tears the engine down.
  const g2start = issues.length;
  await evaluate(`(function(){ var g=document.querySelector('[data-action="tglGlassMode"]'); if(g) g.click(); return true; })()`);
  await sleep(1200);
  const g2 = JSON.parse(await state());
  out.push({ scenario: 'G2-launcher-toggle-off', result: g2, errors: issues.slice(g2start) });
  console.log('SCENARIO G2-launcher-toggle-off: ' + JSON.stringify(g2));

  // G3 — the shared bottom dock drives the engine on the admin gate (fresh
  // page, setup screen). Each scenario seeds its own prefs: cross-file://
  // localStorage sharing is unreliable, so nothing is inherited from G2.
  const g3start = issues.length;
  const pre3 = await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    try{localStorage.setItem('mmgr_glass_mode','premium');}catch(e){}
    try{window.__mmgrForceHighEnd=true;}catch(e){}
  ` });
  await send('Page.navigate', { url: BASE + '/admin.html' });
  await sleep(3000);
  const g3before = JSON.parse(await evaluate(`(function(){ return JSON.stringify({
    dockVisible: (function(){ var d=document.getElementById('app-dock'); return !!d && getComputedStyle(d).display !== 'none'; })(),
    dockHasTheme: !!document.querySelector('.dock .pal-btn[data-pal]'),
    dockHasGlass: !!document.querySelector('.dock [data-action="tglGlassMode"]'),
    setupScreen: !document.getElementById('setup-screen').classList.contains('hidden'),
    glassChecked: (function(){ var g=document.querySelector('.dock [data-action="tglGlassMode"]'); return g ? g.checked : null; })(),
    pref: localStorage.getItem('mmgr_glass_mode')
  }); })()`));
  await sleep(5000); // engine boot (CDN fetch + first frames)
  const g3boot = JSON.parse(await evaluate(`(function(){ return JSON.stringify({
    glassClass: document.body.classList.contains('glass-premium'),
    canvas: !!document.getElementById('glass-canvas'),
    gateAbove: (function(){ var w=document.querySelector('.gatewrap'); if(!w) return null; var s=getComputedStyle(w); return {pos:s.position, z:s.zIndex}; })()
  }); })()`));
  await evaluate(`(function(){ var g=document.querySelector('.dock [data-action="tglGlassMode"]'); if(g) g.click(); return true; })()`);
  await sleep(1200);
  const g3after = JSON.parse(await evaluate(`(function(){ return JSON.stringify({
    glassClass: document.body.classList.contains('glass-premium'),
    canvas: !!document.getElementById('glass-canvas'),
    pref: localStorage.getItem('mmgr_glass_mode')
  }); })()`));
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: pre3.identifier });
  out.push({ scenario: 'G3-admin-gate-dock', before: g3before, boot: g3boot, after: g3after, errors: issues.slice(g3start) });
  console.log('SCENARIO G3-admin-gate-dock: ' + JSON.stringify({ before: g3before, boot: g3boot, after: g3after }));

  const pass =
    g1.glassClass === true && g1.canvas === true && g1.pref === 'premium' &&
    g1.wrapAbove && g1.wrapAbove.pos === 'relative' && g1.wrapAbove.z === '1' &&
    g2.glassClass === false && g2.canvas === false && g2.pref === 'css' &&
    g3before.dockVisible === true && g3before.dockHasTheme === true && g3before.dockHasGlass === true && g3before.setupScreen === true &&
    g3before.glassChecked === true && g3before.pref === 'premium' &&
    g3boot.glassClass === true && g3boot.canvas === true &&
    g3boot.gateAbove && g3boot.gateAbove.pos === 'relative' && g3boot.gateAbove.z === '1' &&
    g3after.glassClass === false && g3after.canvas === false && g3after.pref === 'css' &&
    !out.some(o => o.errors && o.errors.length);

  console.log('\n===== GLASS PREVIEW CHECK =====');
  console.log(JSON.stringify({ scenarios: out, pass }, null, 2));
  console.log('RESULT:', pass ? 'GLASS PREVIEW OK' : 'GLASS PREVIEW FAILED');
  proc.kill();
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('ERR', e && e.stack || e); proc.kill(); process.exit(1); });
