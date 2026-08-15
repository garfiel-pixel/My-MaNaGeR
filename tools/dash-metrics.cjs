/* Layout metrics: Controls tab sections + admin page overflow */
const { spawn } = require('child_process');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9357;
const userDir = 'C:/tmp/chrome-metrics-' + Date.now();
const delay = ms => new Promise(r => setTimeout(r, ms));
const proc = spawn(CHROME, ['--headless=new','--disable-gpu','--no-first-run','--no-sandbox','--remote-allow-origins=*','--remote-debugging-port='+PORT,'--user-data-dir='+userDir,'--window-size=1280,1000','about:blank'], { stdio:'ignore' });
(async () => {
  for (let i = 0; i < 60; i++) { try { const r = await fetch('http://127.0.0.1:'+PORT+'/json/version'); if (r.ok) break; } catch (e) {} await delay(300); }
  const targets = await (await fetch('http://127.0.0.1:'+PORT+'/json')).json();
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  const pending = new Map(); let id = 0;
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws fail')); });
  const send = (method, params={}) => new Promise(res => { const mid=++id; pending.set(mid,res); ws.send(JSON.stringify({id:mid,method,params})); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue:true, awaitPromise:true }); return r.result && r.result.result ? r.result.result.value : undefined; };
  await send('Runtime.enable'); await send('Page.enable');

  // Controls tab metrics
  await ev(`localStorage.setItem('mmgr_admin_projects', JSON.stringify([{id:'qa-ctrl',title:'QA Ctrl',description:'',status:'active',file:'project.html?id=qa-ctrl',code:'QACTL1',codeHash:'x'}]));`);
  await send('Page.navigate', { url: 'http://127.0.0.1:8765/project.html?id=qa-ctrl' });
  await delay(3500);
  const m1 = await ev(`(function(){
    const drw = document.getElementById('drw'); if (drw) drw.classList.add('open');
    const ctrl = document.getElementById('db-ctrl');
    const sections = ctrl ? Array.from(ctrl.querySelectorAll('.sl, .sr, .share-card, .fmt-card, .exp-row')).map(el => {
      const r = el.getBoundingClientRect();
      return { cls: el.className.slice(0,20), w: Math.round(r.width), h: Math.round(r.height) };
    }) : [];
    return { sections: sections.slice(0, 30),
      ctrlH: ctrl ? Math.round(ctrl.getBoundingClientRect().height) : 0,
      noHOverflow: document.documentElement.scrollWidth <= window.innerWidth,
      shareCards: document.querySelectorAll('#ctrl-share .share-card').length,
      fmtCards: document.querySelectorAll('#db-ctrl .fmt-card').length };
  })()`);
  console.log('CONTROLS:', JSON.stringify({ ctrlH: m1.ctrlH, noHOverflow: m1.noHOverflow, shareCards: m1.shareCards, fmtCards: m1.fmtCards }, null, 2));

  // Admin metrics
  await send('Page.navigate', { url: 'http://127.0.0.1:8765/admin.html' });
  await delay(3000);
  await ev(`(function(){ const p1=document.getElementById('setup-pass1'),p2=document.getElementById('setup-pass2'); if(p1&&p2){p1.value='TestPass123!';p2.value='TestPass123!';} const b=document.querySelector('[data-action="adminSetupPassword"]'); if(b)b.click(); })()`);
  await delay(2000);
  const m2 = await ev(`(function(){
    const toolbar = document.querySelector('.toolbar');
    const hdr = document.querySelector('#admin-app header');
    return { noHOverflow: document.documentElement.scrollWidth <= window.innerWidth,
      hdrButtons: hdr ? Array.from(hdr.querySelectorAll('button, a')).map(b => (b.textContent||'').trim().replace(/\s+/g,' ')).filter(Boolean) : [],
      railCtl: document.querySelectorAll('#app-sidebar .rail-ctl-row').length,
      importBtn: !!(toolbar && /Import Project/.test(toolbar.textContent)) };
  })()`);
  console.log('ADMIN:', JSON.stringify(m2, null, 2));

  try { await send('Page.close'); } catch(e) {}
  try { proc.kill(); } catch(e) {}
  process.exit(0);
})().catch(e => { console.log('ERR', e && e.stack || e); try { proc.kill(); } catch(x){} process.exit(1); });
