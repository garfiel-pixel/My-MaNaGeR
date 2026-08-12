// layout-probe.cjs — scans pages for layout misalignment: horizontal overflow,
// left-edge drift between sibling blocks, overlapping sticky header/nav, and
// non-centered auto-margin containers. Mirrors the bootChrome pattern used by
// the qa-*.cjs harnesses.
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE || 'http://127.0.0.1:8765';
const CHROME = process.env.CHROME || (() => {
  const cands = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ];
  for (const c of cands) { if (fs.existsSync(c)) return c; }
  return 'chrome';
})();

const VIEWPORTS = [
  { name: 'desktop', w: 1280, h: 900 },
  { name: 'tablet',  w: 820,  h: 1180 },
  { name: 'mobile',  w: 390,  h: 844 }
];

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function bootChrome(port, profile) {
  const args = [
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions'
  ];
  const proc = spawn(CHROME, args, { stdio: 'ignore' });
  let ws;
  for (let i = 0; i < 60; i++) {
    try {
      let j;
      try {
        const r = await fetch(`http://127.0.0.1:${port}/json/version`);
        j = await r.json();
        // /json/version returns the BROWSER socket (Browser.* only). For
        // Runtime/Page/Emulation we need the page target from /json/list.
        const lr = await fetch(`http://127.0.0.1:${port}/json/list`);
        const list = await lr.json();
        const page = list.find(t => t.type === 'page');
        ws = new WebSocket((page && page.webSocketDebuggerUrl) || j.webSocketDebuggerUrl);
      } catch (e) {
        throw e;
      }
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      break;
    } catch (e) { await delay(250); }
  }
  if (!ws) throw new Error('chrome did not start');
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params) => new Promise((resolve) => {
    const mid = ++id; pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  await send('Page.enable');
  await send('Runtime.enable');
  return { proc, send, ws };
}

async function navigate(send, url) {
  await send('Page.navigate', { url });
  await delay(3500);
}

async function ev(send, expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) return 'EXC: ' + (r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || '').slice(0, 200);
  return r.result && r.result.result ? r.result.result.value : 'RAW:' + JSON.stringify(r).slice(0, 300);
}

// Probe: returns layout facts. Focused on things that read as "misaligned".
const PROBE = `(function(){
  var out = { viewport: innerWidth + 'x' + innerHeight, overflowX: document.documentElement.scrollWidth > innerWidth + 1 };
  var body = document.body;
  // 1) horizontal overflow offenders: elements wider than viewport or poking past right edge
  var bad = [];
  var all = document.querySelectorAll('body *');
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue;
    var r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) continue;
    if (r.right > innerWidth + 2 && !/modal|drawer|drw|ai-win|#om|chartup|wbsimport|importdates/.test(el.id)) {
      bad.push({ id: el.id || '', cls: (el.className||'').toString().slice(0,30), tag: el.tagName, right: Math.round(r.right), width: Math.round(r.width) });
      if (bad.length >= 6) break;
    }
  }
  out.overflowOffenders = bad;
  // 2) sticky header/nav overlap check
  var hdr = document.getElementById('app-header');
  var nav = document.getElementById('sec-nav');
  if (hdr && nav) {
    window.scrollTo(0, 600);
    // force a frame
    return new Promise(function(res){
      setTimeout(function(){
        var hr = hdr.getBoundingClientRect(), nr = nav.getBoundingClientRect();
        out.header = { bottom: Math.round(hr.bottom), top: Math.round(hr.top) };
        out.nav = { top: Math.round(nr.top), stickyTop: getComputedStyle(nav).top };
        out.navOverlapsHeader = nr.top < hr.bottom - 1;
        window.scrollTo(0, 0);
        res(out);
      }, 300);
    });
  }
  // 3) main content column edges vs page edges (drift detection)
  var main = document.getElementById('app-main') || document.querySelector('main') || document.querySelector('.wrap');
  if (main) {
    var mr = main.getBoundingClientRect();
    out.main = { left: Math.round(mr.left), right: Math.round(mr.right), width: Math.round(mr.width) };
    out.mainCentered = Math.abs(mr.left - (innerWidth - mr.width) / 2) < 4;
  }
  return out;
})()`;

(async () => {
  const port = 9333 + Math.floor(Math.random() * 300);
  const profile = path.join(require('os').tmpdir(), 'mmgr-layout-' + Date.now());
  const { proc, send } = await bootChrome(port, profile);
  const pages = [
    { name: 'launcher (app.html)', url: '/app.html', seed: null },
    { name: 'workspace (project.html)', url: '/project.html?id=demo-project', seed: "localStorage.setItem('mmgr_unlocked_demo-project','1');localStorage.setItem('mmgr_scope_demo-project','full');" }
  ];
  try {
    for (const page of pages) {
      for (const vp of VIEWPORTS) {
        await send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.w <= 420 });
        await navigate(send, BASE + page.url);
        if (page.seed) {
          await ev(send, page.seed);
          await navigate(send, BASE + page.url);
        }
        const res = await ev(send, PROBE);
        console.log(`\n=== ${page.name} @ ${vp.name} (${vp.w}px) ===`);
        console.log(JSON.stringify(res));
      }
    }
  } finally {
    try { await send('Browser.close'); } catch (e) {}
    proc.kill();
  }
  process.exit(0);
})().catch(e => { console.error('PROBE FAIL:', e.message); process.exit(1); });
