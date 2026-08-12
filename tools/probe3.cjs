// probe3.cjs — full-page layout sweep: overflow offenders + sticky header/nav overlap.
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const delay = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const port = 9650 + Math.floor(Math.random() * 100);
  const prof = path.join(require('os').tmpdir(), 'mmgr-p3-' + Date.now());
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
  await send('Page.enable'); await send('Runtime.enable');

  const OVERFLOW = `(function(){ var vw=document.documentElement.clientWidth; var bad=[]; var all=document.querySelectorAll('body *'); for(var i=0;i<all.length;i++){ var el=all[i]; var cs=getComputedStyle(el); if(cs.position==='fixed'||cs.position==='absolute')continue; if(cs.display==='none'||cs.visibility==='hidden')continue; var r=el.getBoundingClientRect(); if(r.width<=1||r.height<=1)continue; if(r.right>vw+2){ var anc=el.parentElement,sc=false; while(anc&&anc!==document.body){ var acs=getComputedStyle(anc); if(/auto|scroll/.test(acs.overflowX)){sc=true;break;} anc=anc.parentElement; } if(!sc) bad.push({t:el.tagName,id:el.id,cls:(el.className||'').toString().slice(0,28),right:Math.round(r.right)}); if(bad.length>=5)break; } } return JSON.stringify({vw:vw,docScrollW:document.documentElement.scrollWidth,offenders:bad}); })()`;
  const STICKY = `(function(){ var hdr=document.getElementById('app-header'); var nav=document.getElementById('sec-nav'); if(!hdr||!nav) return 'no-header-nav'; window.scrollTo(0,500); return new Promise(function(res){ setTimeout(function(){ var hr=hdr.getBoundingClientRect(), nr=nav.getBoundingClientRect(); var out={headerBottom:Math.round(hr.bottom),navTop:Math.round(nr.top),overlap:nr.top<hr.bottom-1,stickyTop:getComputedStyle(nav).top}; window.scrollTo(0,0); res(JSON.stringify(out)); },300); }); })()`;

  const pages = [
    { name: 'launcher', url: '/app.html' },
    { name: 'admin', url: '/admin.html' },
    { name: 'index', url: '/index.html' },
    { name: 'features', url: '/features.html' }
  ];
  const vps = [{ name: 'desktop', w: 1280, h: 900, m: false }, { name: 'tablet', w: 820, h: 1180, m: false }, { name: 'mobile', w: 390, h: 844, m: true }];
  for (const pg of pages) {
    for (const vp of vps) {
      await send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.m });
      await send('Page.navigate', { url: 'http://127.0.0.1:8765' + pg.url }); await delay(3000);
      console.log(`${pg.name} @ ${vp.name}: ${await ev(OVERFLOW)}`);
    }
  }
  // workspace sticky chain at mobile
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: 'http://127.0.0.1:8765/project.html?id=demo-project' }); await delay(3500);
  await ev("localStorage.setItem('mmgr_unlocked_demo-project','1');localStorage.setItem('mmgr_scope_demo-project','full');");
  await send('Page.navigate', { url: 'http://127.0.0.1:8765/project.html?id=demo-project' }); await delay(3500);
  console.log('workspace @ mobile overflow: ' + await ev(OVERFLOW));
  console.log('workspace @ mobile sticky: ' + await ev(STICKY));
  try { await send('Browser.close'); } catch (e) {}
  p.kill();
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
