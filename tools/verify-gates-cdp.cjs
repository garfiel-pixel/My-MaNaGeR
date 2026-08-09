/* CDP check of the two access-gate screens: loads app.html + admin.html,
   collects console errors, extracts computed glass styles of the gates, and
   saves screenshots for a human eyeball. Run: node tools/verify-gates-cdp.js */
const { spawn } = require('child_process');
const fs = require('fs');

const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9334;
const userDir = 'C:/tmp/chrome-cdp-' + Date.now();
const root = 'C:/Users/Garfield/Downloads/mymanager-fixed';
const proc = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  '--remote-allow-origins=*', '--remote-debugging-port=' + port,
  '--user-data-dir=' + userDir, '--window-size=1280,900', 'about:blank'
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitForPageTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + port + '/json/list');
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
  const consoleIssues = [];
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method === 'Runtime.exceptionThrown') {
      consoleIssues.push('EXC: ' + (msg.params.exceptionDetails.exception && msg.params.exceptionDetails.exception.description || msg.params.exceptionDetails.text).slice(0, 200));
    }
    else if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) {
      consoleIssues.push(msg.params.type.toUpperCase() + ': ' + (msg.params.args || []).map(a => a.value || a.description || '').join(' ').slice(0, 200));
    }
  };
  const send = (method, params) => new Promise(resolve => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.error) return 'CDP_ERROR:' + JSON.stringify(r.error);
    if (r.result && r.result.exceptionDetails) return 'EXC:' + (r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || r.result.exceptionDetails.text);
    return r.result && r.result.result ? r.result.result.value : null;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await sleep(600);

  const out = [];

  // ---- app.html: unlock modal ----
  await send('Page.navigate', { url: 'file:///' + root + '/app.html' });
  await sleep(3500);
  const appModal = await evaluate(`(function(){
    var m = document.getElementById('om');
    if (!m) return 'no #om modal';
    m.classList.add('open');
    var s = getComputedStyle(m);
    return JSON.stringify({
      display: s.display,
      background: s.backgroundColor,
      backdropFilter: s.backdropFilter,
      border: s.borderColor + ' ' + s.borderWidth,
      radius: s.borderRadius,
      shadow: s.boxShadow.slice(0, 60)
    });
  })()`);
  out.push('app_unlock_modal=' + appModal);
  const appShot = await send('Page.captureScreenshot', { format: 'png' });
  if (appShot.result && appShot.result.data) {
    fs.writeFileSync('tools/gate-app.png', Buffer.from(appShot.result.data, 'base64'));
    out.push('app_screenshot=tools/gate-app.png');
  }
  await sleep(400);

  // ---- admin.html: login gate ----
  await send('Page.navigate', { url: 'file:///' + root + '/admin.html' });
  await sleep(3000);
  const adminGate = await evaluate(`(function(){
    var g = document.querySelector('.gbox') || document.querySelector('.gatewrap');
    if (!g) return 'no .gbox/.gatewrap';
    var s = getComputedStyle(g);
    return JSON.stringify({
      tag: g.className,
      background: s.backgroundColor,
      backdropFilter: s.backdropFilter,
      border: s.borderColor + ' ' + s.borderWidth,
      radius: s.borderRadius,
      shadow: s.boxShadow.slice(0, 60)
    });
  })()`);
  out.push('admin_gate=' + adminGate);
  const adminShot = await send('Page.captureScreenshot', { format: 'png' });
  if (adminShot.result && adminShot.result.data) {
    fs.writeFileSync('tools/gate-admin.png', Buffer.from(adminShot.result.data, 'base64'));
    out.push('admin_screenshot=tools/gate-admin.png');
  }

  out.push('console_issues=' + (consoleIssues.length ? JSON.stringify(consoleIssues.slice(0, 10)) : 'none'));
  console.log('RESULT:', JSON.stringify(out, null, 2));
  proc.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e && e.message); proc.kill(); process.exit(1); });
