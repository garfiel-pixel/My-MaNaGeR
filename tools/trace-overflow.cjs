// trace-overflow.cjs — trace the .dh/.dc/.g6 overflow to its root cause.
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const delay = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const port = 9451 + Math.floor(Math.random() * 100);
  const prof = path.join(require('os').tmpdir(), 'mmgr-tr-' + Date.now());
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
  if (!ws) throw new Error('no chrome');
  let id = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params) => new Promise(r => { const mid = ++id; pend.set(mid, r); ws.send(JSON.stringify({ id: mid, method, params: params || {} })); });
  const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : 'ERR:' + JSON.stringify(r).slice(0, 200); };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8765/project.html?id=demo-project' }); await delay(4000);
  await ev("localStorage.setItem('mmgr_unlocked_demo-project','1');localStorage.setItem('mmgr_scope_demo-project','full');");
  await send('Page.navigate', { url: 'http://127.0.0.1:8765/project.html?id=demo-project' }); await delay(4000);

  const probe = await ev(`(function(){
    var out = {};
    var dh = document.querySelector('.dh');
    if (dh) {
      var r = dh.getBoundingClientRect();
      out.dh = { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), parent: dh.parentElement ? dh.parentElement.className.toString().slice(0,30) : '?' };
      var el = dh;
      for (var i = 0; i < 6; i++) {
        el = el.parentElement;
        if (!el || el === document.body) break;
        var er = el.getBoundingClientRect(); var ecs = getComputedStyle(el);
        out['p' + i] = { tag: el.tagName, cls: (el.className || '').toString().slice(0, 40), left: Math.round(er.left), right: Math.round(er.right), width: Math.round(er.width), overflowX: ecs.overflowX, maxW: ecs.maxWidth };
      }
    }
    var g6 = document.querySelectorAll('.g6');
    var g6s = []; g6.forEach(function (b) { var r = b.getBoundingClientRect(); g6s.push({ left: Math.round(r.left), right: Math.round(r.right) }); });
    out.g6 = g6s.slice(0, 4);
    var cards = [].slice.call(document.querySelectorAll('.card')).slice(0, 5).map(function (c) { var r = c.getBoundingClientRect(); return { cls: (c.className || '').toString().slice(0, 25), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) }; });
    out.cards = cards;
    return JSON.stringify(out);
  })()`);
  console.log(probe);
  try { await send('Browser.close'); } catch (e) {}
  p.kill();
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
