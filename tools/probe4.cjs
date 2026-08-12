// probe4.cjs — verify every workspace section stays inside the content column.
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const delay = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const port = 9750 + Math.floor(Math.random() * 100);
  const prof = path.join(require('os').tmpdir(), 'mmgr-p4-' + Date.now());
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://127.0.0.1:8765/project.html?id=demo-project' }); await delay(3500);
  await ev("localStorage.setItem('mmgr_unlocked_demo-project','1');localStorage.setItem('mmgr_scope_demo-project','full');");
  await send('Page.navigate', { url: 'http://127.0.0.1:8765/project.html?id=demo-project' }); await delay(3500);

  // visit every section, check the active panel stays inside #app-main
  const SECTIONS = ['dash', 'defs', 'charter', 'wbs', 'gantt', 'kanban', 'res', 'budget', 'stake', 'chg', 'decis', 'risk', 'claim', 'close', 'raci', 'comms', 'docs', 'dmaic', 'meet'];
  for (const s of SECTIONS) {
    await ev(`(function(){ var b=document.querySelector('.sec-btn[data-section="${s}"]'); if(b) b.click(); return true; })()`);
    await delay(600);
    const res = await ev(`(function(){
      var main=document.getElementById('app-main'); var mr=main.getBoundingClientRect();
      var panel=document.querySelector('.panel.active'); if(!panel) return 'no-active';
      var bad=[];
      var all=panel.querySelectorAll('*');
      for(var i=0;i<all.length;i++){
        var el=all[i]; var cs=getComputedStyle(el);
        if(cs.position==='fixed'||cs.position==='absolute')continue;
        if(cs.display==='none')continue;
        var r=el.getBoundingClientRect();
        if(r.width<=1||r.height<=1)continue;
        if(r.right>mr.right+2||r.left<mr.left-2){
          var anc=el.parentElement,sc=false;
          while(anc&&anc!==panel){ var acs=getComputedStyle(anc); if(/auto|scroll/.test(acs.overflowX)){sc=true;break;} anc=anc.parentElement; }
          if(!sc) bad.push({t:el.tagName,cls:(el.className||'').toString().slice(0,25),right:Math.round(r.right),mainRight:Math.round(mr.right)});
          if(bad.length>=4)break;
        }
      }
      return JSON.stringify({section:'${s}',spills:bad});
    })()`);
    console.log(res);
  }
  try { await send('Browser.close'); } catch (e) {}
  p.kill();
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
