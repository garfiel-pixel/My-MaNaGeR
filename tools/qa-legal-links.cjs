'use strict';
/* QA-LEGAL-LINKS — every marketing footer must link Privacy Policy and
   Terms of Service, and both anchors must exist on privacy.html.
   Runs headless Chrome against the local server (:8765, spawns if down). */
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { chromePath: CHROME, BASE } = require('./chrome-launcher.cjs');

const PAGES = ['index.html', 'features.html', 'about.html', 'contact.html', 'reviews.html'];
const PROFILE = path.join(os.tmpdir(), 'mmgr-legal-' + Date.now());
let ws, msgId = 0;
const pending = new Map();
const results = [];
const log = (s) => process.stdout.write('[legal] ' + s + '\n');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function send(method, params) {
  return new Promise((res) => {
    const id = ++msgId;
    pending.set(id, (m) => { pending.delete(id); res(m.result || {}); });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { __err: r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text };
  return r.result && r.result.value;
}
const check = (name, val, detail) => { results.push(val); log((val ? 'PASS' : 'FAIL') + ' ' + name + (val ? '' : '  <-- ' + JSON.stringify(detail))); };

(async () => {
  let server = null;
  try { const r = await fetch(BASE + '/index.html'); if (!r.ok) throw new Error('down'); }
  catch (e) {
    log('server down — spawning serve.cjs');
    server = spawn(process.execPath, ['serve.cjs'], { stdio: 'ignore', detached: true });
    for (let i = 0; i < 30; i++) { try { const r = await fetch(BASE + '/index.html'); if (r.ok) break; } catch (e2) {} await delay(300); }
  }
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9251', '--user-data-dir=' + PROFILE, '--window-size=1280,1000', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { const r = await fetch('http://127.0.0.1:9251/json/version'); if (r.ok) break; } catch (e) {} await delay(300); }
  const targets = await (await fetch('http://127.0.0.1:9251/json')).json();
  ws = new WebSocket(targets.filter((t) => t.type === 'page')[0].webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws fail')); });
  ws.onmessage = (evt) => { const m = JSON.parse(evt.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await send('Runtime.enable'); await send('Page.enable');

  for (const page of PAGES) {
    await send('Page.navigate', { url: BASE + '/' + page });
    await delay(1800);
    const foot = await ev(`(function(){
      var links = Array.prototype.slice.call(document.querySelectorAll('.site-footer a[href^="privacy.html"]'))
        .map(function(a){ return a.getAttribute('href') + '|' + a.textContent.trim(); });
      return { legal: links, onPrivacy: location.pathname.indexOf('privacy') > -1 };
    })()`);
    const need = ['privacy.html#privacy|Privacy Policy', 'privacy.html#terms|Terms of Service'];
    const ok = foot && foot.legal && need.every((n) => foot.legal.indexOf(n) > -1);
    check(page + ' footer links Privacy Policy + Terms of Service', ok === true, foot);
  }

  // Anchors resolve on privacy.html itself
  await send('Page.navigate', { url: BASE + '/privacy.html#terms' });
  await delay(1500);
  const anchor = await ev(`(function(){
    return { hash: location.hash, hasPrivacy: !!document.getElementById('privacy'), hasTerms: !!document.getElementById('terms'), toc: !!document.querySelector('.privacy-toc') };
  })()`);
  check('privacy.html exposes #privacy + #terms anchors and a TOC', anchor && anchor.hasPrivacy && anchor.hasTerms && anchor.toc === true, anchor);

  const okAll = results.every(Boolean);
  log(okAll ? 'LEGAL-LINKS GATE PASS — ' + results.length + '/' + results.length : 'LEGAL-LINKS GATE FAIL');
  try { ws.close(); } catch (e) {}
  try { proc.kill('SIGKILL'); } catch (e) {}
  process.exit(okAll ? 0 : 1);
})().catch((e) => { console.error(e); try { ws && ws.close(); } catch (e2) {} try { proc && proc.kill('SIGKILL'); } catch (e2) {} process.exit(1); });