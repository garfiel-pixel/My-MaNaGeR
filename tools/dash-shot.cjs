/* Screenshot capture: Controls tab + admin panel */
const { spawn } = require('child_process');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9355;
const userDir = 'C:/tmp/chrome-shot-' + Date.now();
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

  // Admin panel — unlock then screenshot
  await send('Page.navigate', { url: 'http://127.0.0.1:8765/admin.html' });
  await delay(3000);
  await ev(`(function(){ const p1=document.getElementById('setup-pass1'),p2=document.getElementById('setup-pass2'); if(p1&&p2){p1.value='TestPass123!';p2.value='TestPass123!';} const b=document.querySelector('[data-action="adminSetupPassword"]'); if(b)b.click(); })()`);
  await delay(2000);
  const shot1 = await send('Page.captureScreenshot', { format: 'png' });
  require('fs').writeFileSync('tools/dash-review-admin-panel.png', Buffer.from(shot1.result.data, 'base64'));
  console.log('admin panel shot saved');

  // Admin rail open
  await ev(`document.getElementById('nav-btn').click()`);
  await delay(600);
  const shot2 = await send('Page.captureScreenshot', { format: 'png' });
  require('fs').writeFileSync('tools/dash-review-admin-rail.png', Buffer.from(shot2.result.data, 'base64'));
  console.log('admin rail shot saved');

  // Project Controls tab
  await ev(`localStorage.setItem('mmgr_admin_projects', JSON.stringify([{id:'qa-ctrl',title:'QA Ctrl',description:'',status:'active',file:'project.html?id=qa-ctrl',code:'QACTL1',codeHash:'x'}]));`);
  await send('Page.navigate', { url: 'http://127.0.0.1:8765/project.html?id=qa-ctrl' });
  await delay(3500);
  await ev(`(function(){ const b=Array.from(document.querySelectorAll('[data-action="swDtab"]')).find(x=>/ctrl|settings/i.test(x.textContent||'')); if(b) b.click(); const drw=document.getElementById('drw'); if(drw) drw.classList.add('open'); })()`);
  await delay(600);
  const shot3 = await send('Page.captureScreenshot', { format: 'png' });
  require('fs').writeFileSync('tools/dash-review-ctrl-tab.png', Buffer.from(shot3.result.data, 'base64'));
  console.log('controls tab shot saved');

  try { await send('Page.close'); } catch(e) {}
  try { proc.kill(); } catch(e) {}
  process.exit(0);
})().catch(e => { console.log('ERR', e && e.stack || e); try { proc.kill(); } catch(x){} process.exit(1); });
