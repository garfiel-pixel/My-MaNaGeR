/* Real-time CDP verification of the homepage scroll-spy.
   Launches headless Chrome, drives real scrolling on the actual page,
   and reports spy state + scroll positions. Run: node tools/verify-spy-cdp.js */
const { spawn } = require('child_process');

const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9333;
const userDir = 'C:/tmp/chrome-cdp-' + Date.now();
const proc = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  '--remote-allow-origins=*',
  '--remote-debugging-port=' + port,
  '--user-data-dir=' + userDir,
  'about:blank'
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitForPageTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + port + '/json/list');
      const list = await r.json();
      const page = list.find(t => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch (e) { /* not up yet */ }
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
  const events = [];
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method) events.push(msg);
  };
  const send = (method, params) => new Promise(resolve => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.error) return 'CDP_ERROR:' + JSON.stringify(r.error);
    if (r.result && r.result.exceptionDetails) return 'EXC:' + (r.result.exceptionDetails.text || '') + ' ' + (r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || '');
    return r.result && r.result.result ? r.result.result.value : ('RAW:' + JSON.stringify(r).slice(0, 200));
  };
  const waitEvent = (method, timeout) => new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const i = events.findIndex(e => e.method === method);
      if (i >= 0) { events.splice(i, 1); clearInterval(iv); resolve(); }
      else if (Date.now() - t0 > (timeout || 10000)) { clearInterval(iv); reject(new Error('timeout: ' + method)); }
    }, 50);
  });

  await send('Page.enable');
  await send('Runtime.enable');
  const navResp = await send('Page.navigate', { url: 'file:///C:/Users/Garfield/Downloads/mymanager-fixed/index.html' });
  if (navResp.result && navResp.result.errorText) console.log('NAV:', navResp.result.errorText);
  try { await waitEvent('Page.loadEventFired', 8000); }
  catch (e) { console.log('no loadEvent (file://) — continuing after domContent'); }
  await sleep(1500);

  const out = [];
  out.push('probe_1plus1=' + await evaluate('1+1'));
  out.push('probe_title=' + await evaluate('document.title'));

  // 1. Continuous scroll — instant jumps so positions are exact. Snap would pull to boundaries.
  out.push('scrolls=' + await evaluate(`(function(){
    var s=document.createElement('style');
    s.textContent='html{scroll-behavior:auto !important;}';
    document.head.appendChild(s);
    var o=[];
    for(var i=0;i<4;i++){window.scrollBy(0,400);o.push(window.scrollY);}
    return o.join(',');})()`));

  // 2. Spy mid-page (real-time IO should fire)
  await sleep(700);
  out.push('spy_mid=' + await evaluate(`(function(){var a=document.querySelector('.scroll-spy a.active');return a?a.getAttribute('href'):'none';})()`));

  // 3. Bottom of page — fallback should force last spy link
  await evaluate('window.scrollTo(0,document.documentElement.scrollHeight)');
  await sleep(700);
  out.push('spy_bottom=' + await evaluate(`(function(){var a=document.querySelector('.scroll-spy a.active');return a?a.getAttribute('href'):'none';})()`));

  // 4. Click the FAQ stick — header must not cover the title (scroll-margin-top 84px)
  await evaluate(`(function(){var l=document.querySelector('.scroll-spy a[href="#faq"]');if(l)l.click();return 1;})()`);
  await sleep(1200);
  out.push('faq_top=' + await evaluate(`(function(){var r=document.getElementById('faq').getBoundingClientRect();return Math.round(r.top);})()`));
  out.push('spy_after_faq=' + await evaluate(`(function(){var a=document.querySelector('.scroll-spy a.active');return a?a.getAttribute('href'):'none';})()`));
  out.push('label_opacity=' + await evaluate(`(function(){var l=document.querySelector('.scroll-spy a.active .spy-label');return l?getComputedStyle(l).opacity:'n/a';})()`));
  out.push('scrollHeight=' + await evaluate('document.documentElement.scrollHeight'));

  console.log('RESULT:', JSON.stringify(out));
  proc.kill();
  process.exit(0);
})().catch(e => {
  console.error('ERR', e && e.message);
  proc.kill();
  process.exit(1);
});
