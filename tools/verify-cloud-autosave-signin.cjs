/* ============================================================
   CLOUD AUTO-SAVE + SIGN-IN ROUTING browser verification
   (owner directive 2026-08-15: "Save to Cloud isn't automatic"
   + "Google connect not routed from cloud actions")
     C1 — editor-session auto-save fires with X-Editor-Code
     C2 — recoverCode while unsigned pops sign-in, then auto-resumes
     C3 — admin Publish to Cloud while unsigned pops sign-in, then
          auto-publishes after sign-in; re-click skips sign-in
   Run: node tools/verify-cloud-autosave-signin.cjs
   ============================================================ */
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const log = (s) => process.stdout.write(s + '\n');

// ---- Wrangler startup (self-contained, like other T2 harnesses) ----
const WRANGLER_JS = (function () {
  const local = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  if (fs.existsSync(local)) return local;
  try { return execFileSync(process.execPath, ['npm', 'root', '-g'], { encoding: 'utf8' }).trim() + '/wrangler/bin/wrangler.js'; } catch (e) {}
  return local;
})();
const PORT = parseInt(process.env.QA_PORT || '8797', 10);
const PERSIST_DIR = path.join(os.tmpdir(), 'mmgr-cas-wstate-' + Date.now());
let wranglerProc = null;

async function startWrangler() {
  log('[cas] starting wrangler dev on :' + PORT + '...');
  try {
    execFileSync(process.execPath, [WRANGLER_JS, 'd1', 'migrations', 'apply', 'my-manager-db', '--local', '--config', 'wrangler.ci.jsonc', '--persist-to', PERSIST_DIR], { cwd: ROOT, stdio: 'ignore' });
  } catch (e) { /* migrations may already be applied */ }
  wranglerProc = spawn(process.execPath, [WRANGLER_JS, 'dev', '--config', 'wrangler.ci.jsonc', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', PERSIST_DIR], {
    cwd: ROOT, stdio: 'ignore',
    env: Object.assign({}, process.env, { ADMIN_CODE: 'QA-CAS-ADMIN' })
  });
  wranglerProc.on('error', (e) => { log('[cas] wrangler spawn error: ' + e.message); });
  wranglerProc.on('exit', (code) => { log('[cas] wrangler exited code=' + code); wranglerProc = null; });
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/api/health');
      if (r.ok) { log('[cas] wrangler ready on :' + PORT); return; }
    } catch (e) {}
    await delay(2000);
  }
  throw new Error('wrangler dev did not come up in 80s');
}

function stopWrangler() {
  if (wranglerProc) { try { wranglerProc.kill(); } catch (e) {} wranglerProc = null; }
}

// ---- Chrome launcher ----
const { chromePath: CHROME, DEBUG_PORT } = require('./chrome-launcher.cjs');
const CHROME_PORT = DEBUG_PORT;
const BASE = 'http://127.0.0.1:' + PORT;
const userDir = path.join(os.tmpdir(), 'chrome-cas-' + Date.now());

const delay = ms => new Promise(r => setTimeout(r, ms));

// Watchdog
setTimeout(() => { log('WATCHDOG TIMEOUT'); stopWrangler(); process.exit(2); }, 180000);

const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-sandbox',
  '--remote-allow-origins=*', '--remote-debugging-port=' + CHROME_PORT,
  '--user-data-dir=' + userDir, '--window-size=1280,900', 'about:blank'
], { stdio: 'ignore' });

const results = [];
function check(name, val, detail) {
  results.push({ name, val: !!val, detail });
  log((val ? '[PASS] ' : '[FAIL] ') + name + (val ? '' : '  <-- ' + JSON.stringify(detail)));
}

(async () => {
  // Start our own wrangler
  await startWrangler();

  // Wait for Chrome
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch('http://127.0.0.1:' + CHROME_PORT + '/json/version'); if (r.ok) break; } catch (e) {}
    await delay(300);
  }
  const targets = await (await fetch('http://127.0.0.1:' + CHROME_PORT + '/json')).json();
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  const pending = new Map();
  let id = 0;
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws fail')); });
  const send = (method, params = {}) => new Promise(res => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Runtime.enable'); await send('Page.enable');

  // ---- C1: editor-session auto-save fires with X-Editor-Code ---------------
  await send('Page.navigate', { url: BASE + '/project.html?id=qa-edit' });
  await delay(2500);
  await ev(`(function(){
    localStorage.setItem('mmgr_admin_projects', JSON.stringify([{id:'qa-edit',title:'QA Edit',description:'',status:'active',file:'project.html?id=qa-edit',code:'QAE1',codeHash:'x'}]));
    localStorage.setItem('mmgr_state_qa-edit', JSON.stringify({ projectName: 'QA Edit', schemaVersion: 18, tasks: [{ id: 't1', title: 'Pour slab' }] }));
  })()`);
  await send('Page.navigate', { url: BASE + '/project.html?id=qa-edit' });
  await delay(3500);
  const c1 = await ev(`(async function(){
    try {
      if (!(window.MMGR && window.MMGR.Cloud)) return { cloudMissing: true };
      sessionStorage.setItem('mmgr_cloud_ecode_qa-edit', 'AAAA-BBBB-CCCC-DDDD');
      const calls = [];
      const origFetch = window.fetch;
      window.fetch = function(url, opts){
        calls.push({ url: String(url), headers: (opts && opts.headers) || {}, keepalive: !!(opts && opts.keepalive) });
        return Promise.resolve(new Response(JSON.stringify({ ok: true, savedAt: '2026-08-15T00:00:00Z' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      };
      try {
        const ok = await window.MMGR.Cloud.autoSaveToCloud({ keepalive: true });
        const save = calls.find(c => /\\/save$/.test(c.url));
        return { ok: ok, saveUrl: !!(save && save.url), editorHeader: !!(save && save.headers['X-Editor-Code'] === 'AAAA-BBBB-CCCC-DDDD'),
          noOwnerHeader: !(save && save.headers['X-Owner-Code']), keepalive: !!(save && save.keepalive), calls: calls.length };
      } finally {
        window.fetch = origFetch;
      }
    } catch (e) { return { threw: String(e && e.message || e) }; }
  })()`);
  check('C1 editor auto-save fires with X-Editor-Code header', c1 && c1.ok && c1.saveUrl && c1.editorHeader && c1.noOwnerHeader, c1);
  check('C1 keepalive flag passed through', c1 && c1.keepalive === true, c1);

  // ---- C2: recoverCode while unsigned -> sign-in prompt -> auto-resume -----
  const c2 = await ev(`(async function(){
    try {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const GA = window.MMGR.GoogleAuth;
      let promptCalls = 0;
      if (GA) GA.openSignInPrompt = function(){ promptCalls++; return true; };
      const calls = [];
      const origFetch = window.fetch;
      window.fetch = function(url, opts){
        const u = String(url);
        calls.push(u);
        if (u.indexOf('/api/auth/me') > -1) {
          window.__meLog = (window.__meLog || []).concat([{ u: u, signed: !!window.__signedIn }]);
          return Promise.resolve(new Response(JSON.stringify(window.__signedIn ? { ok: true, user: { sub: '123', email: 'o@t.com' } } : { ok: false, user: null }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
        if (u.indexOf('/recover') > -1) {
          return Promise.resolve(new Response(JSON.stringify({ ok: true, ownerCode: 'NEW1-CODE-CODE-CODE' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
        return origFetch.apply(window, arguments);
      };
      window.__signedIn = false;
      try {
        sessionStorage.removeItem('mmgr_cloud_code_qa-edit');
        sessionStorage.removeItem('mmgr_cloud_ecode_qa-edit');
        const p1 = window.MMGR.Cloud.recoverCode();
        await sleep(800);
        const statusText = (document.getElementById('cloud-status') || {}).textContent || '';
        const promptedBefore = promptCalls;
        window.__signedIn = true;
        document.dispatchEvent(new CustomEvent('mmgr:google-signed-in', { detail: { sub: '123', email: 'o@t.com' } }));
        await sleep(1200);
        return { prompted: promptedBefore > 0,
          statusMentionsSignIn: /Sign in to continue/.test(statusText),
          recoverFiredAfter: calls.some(u => u.indexOf('/recover') > -1),
          recoverSucceeded: /New owner code issued/.test((document.getElementById('cloud-status') || {}).textContent || ''),
          statusAfter: (document.getElementById('cloud-status') || {}).textContent || '',
          meLog: window.__meLog || [],
          allCalls: calls.slice(-10) };
      } finally {
        window.fetch = origFetch;
        window.__signedIn = false;
      }
    } catch (e) { return { threw: String(e && e.message || e) }; }
  })()`);
  check('C2 unsigned recover pops the sign-in prompt', c2 && c2.prompted === true, c2);
  check('C2 status says sign in to continue', c2 && c2.statusMentionsSignIn === true, c2);
  check('C2 recovery auto-resumes and succeeds after sign-in', c2 && c2.recoverFiredAfter === true && c2.recoverSucceeded === true, c2);

  // ---- C3: admin Publish to Cloud while unsigned ---------------------------
  await send('Page.navigate', { url: BASE + '/admin.html' });
  await delay(3000);
  await ev(`(function(){
    const p1=document.getElementById('setup-pass1'),p2=document.getElementById('setup-pass2');
    if(p1&&p2){p1.value='TestPass123!';p2.value='TestPass123!';}
    const b=document.querySelector('[data-action="adminSetupPassword"]');
    if(b)b.click();
  })()`);
  await delay(2000);
  const c3 = await ev(`(async function(){
    try {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const GA = window.MMGR && window.MMGR.GoogleAuth;
      let promptCalls = 0;
      if (GA) GA.openSignInPrompt = function(){ promptCalls++; return true; };
      if (GA) GA.isSignedIn = function(){ return !!window.__signedInAdmin; };
      window.__signedInAdmin = false;
      const calls = [];
      const origFetch = window.fetch;
      window.fetch = function(url, opts){
        const u = String(url);
        calls.push(u);
        if (u.indexOf('/api/cloud/projects') > -1 && (opts && opts.method === 'POST')) {
          return Promise.resolve(new Response(JSON.stringify({ ok: true, projectId: 'cld-1', ownerCode: 'ADM1-CODE-CODE-CODE', linked: !!window.__signedInAdmin }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
        return origFetch.apply(window, arguments);
      };
      try {
        const btn = document.querySelector('#project-list [data-action="publishToCloud"]');
        if (!btn) return { noRow: true, bodyPreview: (document.body.textContent || '').slice(0, 120) };
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        const before = promptCalls;
        window.publishToCloud(idx);
        await sleep(900);
        const publishBlocked = !calls.some(u => u.indexOf('/api/cloud/projects') > -1 && true);
        const prompted = promptCalls > before;
        const toastText = (document.querySelector('.toast') || {}).textContent || '';
        window.__signedInAdmin = true;
        document.dispatchEvent(new CustomEvent('mmgr:google-signed-in', { detail: { sub: '1', email: 'a@t.com' } }));
        await sleep(1200);
        const publishedAfter = calls.some(u => u.indexOf('/api/cloud/projects') > -1);
        return { prompted: prompted, publishBlocked: publishBlocked,
          toastMentionsSignIn: /Sign in to link/.test(toastText), publishedAfter: publishedAfter };
      } finally {
        window.fetch = origFetch;
        window.__signedInAdmin = false;
      }
    } catch (e) { return { threw: String(e && e.message || e) }; }
  })()`);
  check('C3 admin publish blocked while unsigned', c3 && c3.publishBlocked === true, c3);
  check('C3 admin publish pops the sign-in prompt + toast', c3 && c3.prompted === true && c3.toastMentionsSignIn === true, c3);
  check('C3 admin publish auto-resumes after sign-in', c3 && c3.publishedAfter === true, c3);

  try { await send('Page.close'); } catch (e) {}
  try { proc.kill(); } catch (e) {}
  stopWrangler();
  const failed = results.filter(r => !r.val);
  log('========================================');
  log(results.length + ' checks, ' + failed.length + ' failed');
  process.exit(failed.length ? 1 : 0);
})().catch(e => { log('HARNESS ERROR: ' + (e && e.stack || e)); try { proc.kill(); } catch (x) {} stopWrangler(); process.exit(1); });
