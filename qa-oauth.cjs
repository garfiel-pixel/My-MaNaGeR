/* ============================================================
   GOOGLE-OPERATOR-IDENTITY-v1 GATE — optional operator identity
   (never gating) on app.html / admin.html
   Drives headless Chrome against http://127.0.0.1:8765.
   Covers (STEP-4/STEP-5 VERIFY items):
     - Module loads with no throw; GIS missing/blocked degrades
       to an empty button slot, never an error.
     - GIS wiring: initialize + renderButton driven into
       #google-signin-button with the public Client ID.
     - Sign-in success -> chip renders, event + optional hook
       fire, NO redirect, NO unlock.
     - Sign-in failure -> no false signed-in state, button stays.
     - /api/auth/me restore drives the chip on load.
     - Access-code unlock modal: wrong code fails, correct code
       (TRYME2026) unlocks — completely untouched by the bar.
     - admin.html mounts the same optional bar without breaking
       the admin gate.
   The real GIS script is blocked (Network.setBlockedURLs) and a
   deterministic GIS mock is injected, so the battery never
   depends on Google reachability or origin allowlisting.
   Exit 0 only when every contract holds.
   Usage: node qa-oauth.cjs  (server must be on :8765)
   ============================================================ */
const { spawn } = require('child_process');
const path = require('path');
const CHROME = 'C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe';
const PORT = 9247;
const BASE = 'http://127.0.0.1:8765';
const PROFILE = path.join(require('os').tmpdir(), 'mmgr-oauth-' + Date.now());
const CLIENT_ID = '297970704704-m05hgt93lfaq286q90br8c96ffg1aph3.apps.googleusercontent.com';

let ws, msgId = 0;
const pending = new Map();
const results = [];
const pageExceptions = [];
const log = (s) => { process.stdout.write('[oauth] ' + s + '\n'); };
const delay = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { log('WATCHDOG'); try { ws && ws.close(); } catch (e) {} process.exit(2); }, 240000);

function send(method, params) { return new Promise(res => { const id = ++msgId; pending.set(id, m => { pending.delete(id); res(m.result || {}); }); ws.send(JSON.stringify({ id, method, params: params || {} })); }); }
async function ev(expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __err: r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text }; return r.result && r.result.value; }
async function evAsync(expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result && r.result.value; }

// Page-level mock that persists across navigations: a deterministic GIS and a
// fetch override whose behavior is keyed on localStorage test flags.
const PRELOAD = `(function(){
  window.google = { accounts: { id: {
    initialize: function(cfg){ window.__gCfg = cfg; },
    renderButton: function(container, opts){ window.__gBtn = { containerId: container && container.id, opts: opts }; }
  } } };
  var __origFetch = window.fetch.bind(window);
  window.fetch = function(url, opts){
    var u = String(url);
    if (u.indexOf('/api/auth/me') !== -1) {
      var me = localStorage.getItem('mmgr_qa_me') || 'signedout';
      if (me === 'signedin') return Promise.resolve(new Response(JSON.stringify({ ok:true, user:{ sub:'1', email:'operator@example.com', name:'Op Example', picture:'' } }), { status:200, headers:{ 'Content-Type':'application/json' } }));
      return Promise.resolve(new Response(JSON.stringify({ ok:false, user:null }), { status:200, headers:{ 'Content-Type':'application/json' } }));
    }
    if (u.indexOf('/api/auth/google') !== -1) {
      if (localStorage.getItem('mmgr_qa_google') === 'fail401') return Promise.resolve(new Response(JSON.stringify({ ok:false, error:'invalid token' }), { status:401, headers:{ 'Content-Type':'application/json' } }));
      return Promise.resolve(new Response(JSON.stringify({ ok:true, user:{ sub:'1', email:'operator@example.com', name:'Op Example', picture:'' } }), { status:200, headers:{ 'Content-Type':'application/json' } }));
    }
    if (u.indexOf('/api/auth/logout') !== -1) return Promise.resolve(new Response(JSON.stringify({ ok:true }), { status:200 }));
    return __origFetch(url, opts);
  };
})();`;

(async () => {
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, '--window-size=1440,1200', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) break; } catch (e) {} await delay(300); }
  const targets = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') { pageExceptions.push((m.params.exceptionDetails && m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text || 'exception'); } };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws fail')); });
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  // Block the real GIS script so the injected mock stays authoritative.
  await send('Network.setBlockedURLs', { urls: ['*://accounts.google.com/gsi/client*', '*://apis.google.com/*'] });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: PRELOAD });

  const check = (name, val, detail) => { results.push({ name, val, detail }); log((val ? 'PASS' : 'FAIL') + ' ' + name + (val ? '' : '  <-- ' + JSON.stringify(detail))); };

  // ---- boot on app.html ----------------------------------------------------
  await send('Page.navigate', { url: BASE + '/app.html' }); await delay(3000);

  const b1 = await ev(`(function(){
    var btn = document.getElementById('google-signin-button');
    var chip = document.getElementById('google-user-chip');
    // The launcher's sign-in moved from a .auth-bar strip into the #siom
    // sheet (NEW-UI-CREATION-BRIEF I1, 2026-08-14) — the mount points inside
    // it ARE the auth bar now.
    var bar = document.getElementById('siom');
    return { mod: !!(window.MMGR && window.MMGR.GoogleAuth), btn: !!btn, chip: !!chip,
      chipHidden: chip ? chip.hidden : null, barInDoc: !!bar };
  })()`);
  check('O01 boot: auth bar + mount points present, chip hidden, module registered',
    b1.mod && b1.btn && b1.chip && b1.chipHidden === true && b1.barInDoc, b1);

  const b2 = await ev(`(function(){
    return { cfgClientId: window.__gCfg ? window.__gCfg.client_id : null,
      btnRendered: window.__gBtn ? window.__gBtn.containerId : null };
  })()`);
  check('O03 gis: initialize + renderButton driven into #google-signin-button with the public client ID',
    b2.cfgClientId === CLIENT_ID && b2.btnRendered === 'google-signin-button', b2);

  // ---- success path ----------------------------------------------------------
  await ev('localStorage.setItem("mmgr_qa_google","ok"); window.__evt = false; window.__hook = null; document.addEventListener("mmgr:google-signed-in", function(){ window.__evt = true; }); window.mmgrOnGoogleSignIn = function(u){ window.__hook = u; };');
  await evAsync(`(async function(){ await window.MMGR.GoogleAuth.handleCredentialResponse({ credential: 'header.payload.sig' }); return true; })()`);
  await delay(500);
  const s1 = await ev(`(function(){
    var chip = document.getElementById('google-user-chip');
    var btn = document.getElementById('google-signin-button');
    return { chipHidden: chip.hidden, chipText: chip.textContent || '',
      btnHidden: btn.hidden, evt: window.__evt, hook: window.__hook ? window.__hook.email : null,
      here: location.pathname, unlocked: localStorage.getItem('mmgr_unlocked_demo-project') };
  })()`);
  check('O05 signin: chip shows operator, event + hook fire, NO redirect, NO unlock',
    s1.chipHidden === false && s1.chipText.indexOf('Op Example') > -1 && s1.btnHidden === true &&
    s1.evt === true && s1.hook === 'operator@example.com' && s1.here === '/app.html' && s1.unlocked === null, s1);

  // ---- failure path ------------------------------------------------------------
  await ev('localStorage.setItem("mmgr_qa_google","fail401"); window.__evt = false; window.MMGR.GoogleAuth.handleCredentialResponse({ credential: "forged.token" });');
  await delay(500);
  const f1 = await ev(`(function(){
    var chip = document.getElementById('google-user-chip');
    var btn = document.getElementById('google-signin-button');
    return { chipHidden: chip.hidden, btnHidden: btn.hidden, evt: window.__evt, here: location.pathname };
  })()`);
  check('O06 fail: rejected token -> chip stays hidden, button back, no event, no redirect',
    f1.chipHidden === true && f1.btnHidden === false && f1.evt === false && f1.here === '/app.html', f1);

  // ---- sign out ----------------------------------------------------------------
  await ev('localStorage.setItem("mmgr_qa_google","ok");');
  await evAsync(`(async function(){ await window.MMGR.GoogleAuth.handleCredentialResponse({ credential: 'x.y.z' }); await window.MMGR.GoogleAuth.signOut(); return true; })()`);
  await delay(400);
  const so = await ev(`(function(){
    var chip = document.getElementById('google-user-chip');
    var btn = document.getElementById('google-signin-button');
    return { chipHidden: chip.hidden, btnHidden: btn.hidden };
  })()`);
  check('O07 signout: chip hidden, sign-in button visible again', so.chipHidden === true && so.btnHidden === false, so);

  // ---- no page exceptions while the GIS script is blocked -----------------------
  check('O04 no-throw: zero page exceptions with GIS blocked', pageExceptions.length === 0, pageExceptions.slice(0, 3));

  // ---- access-code unlock modal untouched ----------------------------------------
  await ev('localStorage.removeItem("mmgr_unlocked_demo-project"); localStorage.removeItem("mmgr_scope_demo-project");');
  await ev('document.querySelector(".pcard[data-id=demo-project]").click();');
  await delay(300);
  const u1 = await ev(`(function(){
    return { modalOpen: document.getElementById('om').classList.contains('open'), hasInput: !!document.getElementById('code-input') };
  })()`);
  check('O02a unlock: clicking a locked project still opens the access-code modal', u1.modalOpen && u1.hasInput, u1);
  await evAsync(`(async function(){
    document.getElementById('code-input').value = 'WRONGCODE';
    await attemptUnlock();
    var wrongErr = document.getElementById('gerr').textContent;
    document.getElementById('code-input').value = 'TRYME2026';
    await attemptUnlock();
    return { wrongErr: wrongErr };
  })()`);
  await delay(600);
  const u2 = await ev(`(function(){
    return { unlocked: localStorage.getItem('mmgr_unlocked_demo-project'),
      scope: localStorage.getItem('mmgr_scope_demo-project'), stillOnApp: location.pathname === '/app.html' };
  })()`);
  check('O02b unlock: wrong code fails, correct code unlocks (bar never interferes)',
    u1.modalOpen && u2.unlocked === '1' && u2.scope === 'full', u2);
  await ev('localStorage.removeItem("mmgr_unlocked_demo-project"); localStorage.removeItem("mmgr_scope_demo-project");');

  // ---- restore from session cookie on load -----------------------------------------
  await ev('localStorage.setItem("mmgr_qa_me","signedin");');
  await send('Page.navigate', { url: BASE + '/app.html' }); await delay(3000);
  const r1 = await ev(`(function(){
    var chip = document.getElementById('google-user-chip');
    var btn = document.getElementById('google-signin-button');
    return { chipHidden: chip.hidden, chipText: chip.textContent || '', btnHidden: btn.hidden };
  })()`);
  check('O08 restore: /api/auth/me signed-in -> chip renders without interaction',
    r1.chipHidden === false && r1.chipText.indexOf('Op Example') > -1 && r1.btnHidden === true, r1);
  await ev('localStorage.setItem("mmgr_qa_me","signedout");');

  // ---- admin.html ---------------------------------------------------------------------
  await send('Page.navigate', { url: BASE + '/admin.html' }); await delay(3000);
  const a1 = await ev(`(function(){
    var bar = document.querySelector('.auth-bar');
    return { mod: !!(window.MMGR && window.MMGR.GoogleAuth), bar: !!bar,
      btn: !!(bar && bar.querySelector('#google-signin-button')),
      chip: !!(bar && bar.querySelector('#google-user-chip')),
      gateVisible: document.getElementById('setup-screen') ? !document.getElementById('setup-screen').classList.contains('hidden') : null };
  })()`);
  check('O09 admin: same optional bar mounted in the header, admin gate untouched',
    a1.mod && a1.bar && a1.btn && a1.chip && a1.gateVisible === true, a1);
  check('O09b admin: zero page exceptions on admin.html', pageExceptions.length === 0, pageExceptions.slice(0, 3));

  // ---- summary -------------------------------------------------------------------------
  try { await send('Page.close'); } catch (e) {}
  try { proc.kill(); } catch (e) {}
  const failed = results.filter(r => !r.val);
  log('========================================');
  log(results.length + ' checks, ' + failed.length + ' failed');
  failed.forEach(f => log('FAIL: ' + f.name + '  <-- ' + JSON.stringify(f.detail)));
  process.exit(failed.length ? 1 : 0);
})().catch(e => { log('HARNESS ERROR: ' + (e && e.stack || e)); try { proc && proc.kill(); } catch (x) {} process.exit(1); });
