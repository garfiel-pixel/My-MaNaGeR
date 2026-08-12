// probe5.cjs — console errors + header re-measure on wrap + mobile nav sanity.
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const delay = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const port = 9850 + Math.floor(Math.random() * 100);
  const prof = path.join(require('os').tmpdir(), 'mmgr-p5-' + Date.now());
  const p = spawn(CHROME, [`--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--headless=new', '--disable-gpu', '--no-first-run'], { stdio: 'ignore' });
  let ws;
  for (let i = 0; i < 60; i++) {
    try {
      const lr = await fetch(`http://127.0.0.1:${port}/json/list`);
      const l = await lr.json();
      ws = new WebSocket(l.find(t => t.type === 'page').webSocketDebuggerUrl);
      await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
      break;
    } catch (e) { await delay(250); }
  }
  let id = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params) => new Promise(r => { const mid = ++id; pend.set(mid, r); ws.send(JSON.stringify({ id: mid, method, params: params || {} })); });
  const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : 'ERR'; };
  const errors = [];
  await send('Page.enable'); await send('Runtime.enable');
  await send('Runtime.enable'); // idempotent
  // capture console + exceptions
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') errors.push('EXC: ' + (m.params.exceptionDetails.exception ? m.params.exceptionDetails.exception.description || '' : m.params.exceptionDetails.text || '').slice(0, 150));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('CONSOLE: ' + (m.params.args || []).map(a => a.value || a.description || '').join(' ').slice(0, 150));
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  };
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: 'http://127.0.0.1:8765/project.html?id=demo-project' }); await delay(3500);
  await ev("localStorage.setItem('mmgr_unlocked_demo-project','1');localStorage.setItem('mmgr_scope_demo-project','full');");
  await send('Page.navigate', { url: 'http://127.0.0.1:8765/project.html?id=demo-project' }); await delay(4000);
  const info = await ev(`(function(){
    var hdr=document.getElementById('app-header'); var hr=hdr.getBoundingClientRect();
    var nav=document.getElementById('sec-nav'); var nr=nav.getBoundingClientRect();
    var root=getComputedStyle(document.documentElement);
    var hdrH = root.getPropertyValue('--hdr-h');
    var navCS=getComputedStyle(nav);
    // do all section buttons share one row or wrap gracefully?
    var btns=nav.querySelectorAll('.sec-btn');
    var tops={}; btns.forEach(function(b){ var t=Math.round(b.getBoundingClientRect().top); tops[t]=(tops[t]||0)+1; });
    var navW=Math.round(nr.width), vw=document.documentElement.clientWidth;
    return JSON.stringify({headerHeight:Math.round(hr.height),hdrVar:hdrH,navTop:Math.round(nr.top),navW:navW,vw:vw,navRows:Object.keys(tops).map(function(t){return t+':'+tops[t];}),navOverflow:navW>vw+2,navScrollW:nav.scrollWidth,navClientW:nav.clientWidth,stickyTop:navCS.top});
  })()`);
  console.log('MOBILE INFO:', info);
  console.log('ERRORS:', errors.length ? errors.slice(0, 8) : 'none');
  try { await send('Browser.close'); } catch (e) {}
  p.kill();
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
