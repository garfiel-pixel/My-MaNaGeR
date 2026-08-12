// probe2.cjs — page-level overflow + .g6 row isolation at tablet width.
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const delay = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const port = 9550 + Math.floor(Math.random() * 100);
  const prof = path.join(require('os').tmpdir(), 'mmgr-p2-' + Date.now());
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
  await send('Page.navigate', { url: 'http://127.0.0.1:8765/project.html?id=demo-project' }); await delay(4000);
  await ev("localStorage.setItem('mmgr_unlocked_demo-project','1');localStorage.setItem('mmgr_scope_demo-project','full');");
  for (const vp of [{ name: 'desktop', w: 1280, h: 900, mobile: false }, { name: 'tablet', w: 820, h: 1180, mobile: false }, { name: 'mobile', w: 390, h: 844, mobile: true }]) {
    await send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.mobile });
    await send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await send('Page.navigate', { url: 'http://127.0.0.1:8765/project.html?id=demo-project' }); await delay(3500);
    console.log('--- ' + vp.name + ' ---');
    console.log(await ev(`(function(){ var vw=document.documentElement.clientWidth; var bad=[]; var all=document.querySelectorAll('#app-main *'); for(var i=0;i<all.length;i++){ var el=all[i]; var cs=getComputedStyle(el); if(cs.position==='fixed'||cs.position==='absolute')continue; if(cs.display==='none')continue; var r=el.getBoundingClientRect(); if(r.width<=1||r.height<=1)continue; if(r.right>vw+2){ var anc=el.parentElement,sc=false; while(anc&&anc!==document.body){ var acs=getComputedStyle(anc); if(/auto|scroll/.test(acs.overflowX)){sc=true;break;} anc=anc.parentElement; } if(!sc) bad.push({t:el.tagName,cls:(el.className||'').toString().slice(0,30),right:Math.round(r.right)}); if(bad.length>=5)break; } } return JSON.stringify({vw:vw,docScrollW:document.documentElement.scrollWidth,offenders:bad}); })()`));
  }

  const probe = await ev(`(function(){
    var vw = document.documentElement.clientWidth;
    var out = { vw: vw, docScrollW: document.documentElement.scrollWidth };
    // real page overflow = elements poking past viewport, excluding fixed/absolute and inside-scrollable
    var bad = [];
    var all = document.querySelectorAll('#app-main *');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var cs = getComputedStyle(el);
      if (cs.position === 'fixed' || cs.position === 'absolute') continue;
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      var r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) continue;
      if (r.right > vw + 2) {
        // is it inside an overflow-x:auto/scroll ancestor? (intended scroll area)
        var anc = el.parentElement, scrollable = false;
        while (anc && anc !== document.body) {
          var acs = getComputedStyle(anc);
          if (/auto|scroll/.test(acs.overflowX)) { scrollable = true; break; }
          anc = anc.parentElement;
        }
        if (!scrollable) bad.push({ t: el.tagName, cls: (el.className || '').toString().slice(0, 35), right: Math.round(r.right), w: Math.round(r.width) });
        if (bad.length >= 8) break;
      }
    }
    out.offenders = bad;
    // .g6 rows: which have zero-height? which overflow their parent?
    var g6s = []; document.querySelectorAll('.g6').forEach(function (b, idx) {
      var r = b.getBoundingClientRect();
      var pr = b.parentElement.getBoundingClientRect();
      g6s.push({ i: idx, text: (b.textContent || '').trim().slice(0, 30), left: Math.round(r.left), right: Math.round(r.right), overflows: r.right > pr.right + 1 });
    });
    out.g6 = g6s.slice(0, 10);
    return JSON.stringify(out);
  })()`);
  console.log(probe);
  try { await send('Browser.close'); } catch (e) {}
  p.kill();
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
