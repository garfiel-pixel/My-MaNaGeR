/* ============================================================
   G-1 GATE — DRIVE TOKEN `state` CONTRACT
   (DIRECTIVE: GOOGLE SIGN-IN SECURITY GAPS, 2026-10-23)
   ------------------------------------------------------------
   Why this harness exists: the directive names tools/qa-oauth.cjs
   as the place for the state gate, but the committed file is
   qa-oauth.cjs at the repo root and it is registered TRIAGE (its
   O02a/O02b unlock checks assume the pre-local-first unlock
   modal and fail against the current contract). A GATE that must
   prove green cannot live inside an already-red harness, so the
   state contract gets this focused harness instead - the
   directive's "closest Drive harness" fallback.

   Drives headless Chrome against http://127.0.0.1:8765 with a
   deterministic GIS mock (the real script is blocked via
   Network.setBlockedURLs, same pattern as qa-oauth.cjs). The
   mock's initTokenClient captures the per-request `state` the
   module passes to requestAccessToken, and the harness invokes
   the token callback with five controlled variants:

     (a) the right state            -> CONNECTS (token persisted)
     (b) a wrong state              -> refused, nothing persisted
     (c) no state at all            -> refused, nothing persisted
     (d) the right state TWICE
          (a replay of an already-
          consumed state)           -> refused, nothing persisted
     (e) the right state, but the
          response arrives > 5 min
          after the request         -> refused, nothing persisted

   plus: the state is 32-hex CSPRNG, and every request gets a
   FRESH state (single use, never reused across requests).

   A page-level Date.now shim (test-only, PRELOAD) advances time
   for case (e); production code is untouched.

   Exit 0 only when every case holds.
   Usage: node tools/qa-drive-state.cjs  (serve.cjs on :8765)
   ============================================================ */
const { spawn } = require('child_process');
const path = require('path');
const { chromePath: CHROME, BASE, DEBUG_PORT: PORT } = require('./chrome-launcher.cjs');
const PROFILE = path.join(require('os').tmpdir(), 'mmgr-drive-state-' + Date.now());

let ws,
  msgId = 0;
const pending = new Map();
const results = [];
const pageExceptions = [];
const log = s => {
  process.stdout.write('[drive-state] ' + s + '\n');
};
const delay = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => {
  log('WATCHDOG');
  try {
    ws && ws.close();
  } catch (e) {}
  process.exit(2);
}, 240000);

function send(method, params) {
  return new Promise(res => {
    const id = ++msgId;
    pending.set(id, m => {
      pending.delete(id);
      res(m.result || {});
    });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}
async function ev(expr) {
  const r = await send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true
  });
  if (r.exceptionDetails) {
    return {
      __err: r.exceptionDetails.exception
        ? r.exceptionDetails.exception.description
        : r.exceptionDetails.text
    };
  }
  return r.result && r.result.value;
}

// Page-level mock that persists across navigations: deterministic GIS (id +
// oauth2), a Date.now time-shift shim (case e), and a fetch override that
// answers /api/auth/nonce + the auth stubs so the module boots clean.
const PRELOAD = `(function(){
  var __realNow = Date.now.bind(Date);
  window.__timeShift = 0;
  Date.now = function(){ return __realNow() + (window.__timeShift || 0); };

  window.google = { accounts: {
    id: {
      initialize: function(cfg){ window.__gCfg = cfg; },
      renderButton: function(container, opts){ window.__gBtn = { containerId: container && container.id, opts: opts }; }
    },
    oauth2: {
      initTokenClient: function(cfg){
        window.__tokCfg = cfg;
        return {
          requestAccessToken: function(ov){
            window.__lastState = (ov && ov.state) || null;
            window.__pendingCb = cfg.callback;
            window.__reqCount = (window.__reqCount || 0) + 1;
          }
        };
      }
    }
  } };

  var __origFetch = window.fetch.bind(window);
  window.fetch = function(url, opts){
    var u = String(url);
    if (u.indexOf('/api/auth/nonce') !== -1) {
      return Promise.resolve(new Response(JSON.stringify({ ok:true, nonce:'0123456789abcdef0123456789abcdef' }), { status:200, headers:{ 'Content-Type':'application/json' } }));
    }
    if (u.indexOf('/api/auth/me') !== -1) {
      return Promise.resolve(new Response(JSON.stringify({ ok:false, user:null }), { status:200, headers:{ 'Content-Type':'application/json' } }));
    }
    if (u.indexOf('/api/auth/google') !== -1) {
      return Promise.resolve(new Response(JSON.stringify({ ok:true, user:{ sub:'1', email:'operator@example.com', name:'Op', picture:'' } }), { status:200, headers:{ 'Content-Type':'application/json' } }));
    }
    if (u.indexOf('/api/auth/logout') !== -1) return Promise.resolve(new Response(JSON.stringify({ ok:true }), { status:200 }));
    return __origFetch(url, opts);
  };
})();`;

(async () => {
  const proc = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--remote-debugging-port=' + PORT,
      '--user-data-dir=' + PROFILE,
      '--window-size=1440,1200',
      'about:blank'
    ],
    { stdio: 'ignore' }
  );
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/version');
      if (r.ok) {
        break;
      }
    } catch (e) {}
    await delay(300);
  }
  const targets = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
    if (m.method === 'Runtime.exceptionThrown') {
      pageExceptions.push(
        (m.params.exceptionDetails &&
          m.params.exceptionDetails.exception &&
          m.params.exceptionDetails.exception.description) ||
          m.params.exceptionDetails.text ||
          'exception'
      );
    }
  };
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('ws fail'));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Network.setBlockedURLs', {
    urls: ['*://accounts.google.com/gsi/client*', '*://apis.google.com/*']
  });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: PRELOAD });

  const check = (name, val, detail) => {
    results.push({ name, val, detail });
    log((val ? 'PASS' : 'FAIL') + ' ' + name + (val ? '' : '  <-- ' + JSON.stringify(detail)));
  };

  // ---- boot on app.html ----------------------------------------------------
  await send('Page.navigate', { url: BASE + '/app.html' });
  await delay(3500);

  const boot = await ev(`(function(){
    return { mod: !!(window.MMGR && window.MMGR.GoogleAuth && window.MMGR.GoogleAuth.getDriveToken),
      oauth2: !!(window.google && window.google.accounts && window.google.accounts.oauth2) };
  })()`);
  check(
    'S00 boot: module + mocked oauth2 present',
    boot.mod === true && boot.oauth2 === true,
    boot
  );

  // ---- helpers (in-page) ----------------------------------------------------
  // Each case runs as ONE awaited evaluate: clear storage, fire the request,
  // wait for requestAccessToken, fire the callback with the chosen variant,
  // and report the promise result + storage in one shot. No cross-evaluate
  // interleaving is possible this way.
  //   accessTok  - access_token in the mock response
  //   mode       - 'right' (echo the live state) | 'wrong' | 'none' | 'replay:<state>'
  //   shiftMs    - advance the Date.now shim before the callback (case e)
  const RUN_CASE = `(function(accessTok, mode, shiftMs, replayState){
    return (async function(){
      try { sessionStorage.removeItem('mmgr_drive_token'); sessionStorage.removeItem('mmgr_drive_token_exp'); } catch(e){}
      try { localStorage.removeItem('mmgr_drive_granted'); } catch(e){}
      window.__timeShift = 0;
      var p = window.MMGR.GoogleAuth.getDriveToken(true);
      await new Promise(function(r){ setTimeout(r, 80); });
      var st = window.__lastState;
      if (shiftMs) { window.__timeShift += shiftMs; }
      var resp = { access_token: accessTok, expires_in: 3600 };
      if (mode === 'right') { resp.state = st; }
      else if (mode === 'wrong') { resp.state = 'deadbeefdeadbeefdeadbeefdeadbeef'; }
      else if (mode === 'replay') { resp.state = replayState; }
      window.__pendingCb(resp);
      var res = await p.then(
        function(t){ return { ok:true, tok:t }; },
        function(e){ return { ok:false, msg:(e && e.message) || '' }; }
      );
      window.__timeShift = 0;
      var store = { tok:null, granted:null };
      try { store.tok = sessionStorage.getItem('mmgr_drive_token'); } catch(e){}
      try { store.granted = localStorage.getItem('mmgr_drive_granted'); } catch(e){}
      return { res: res, store: store, st: st };
    })();
  })`;

  const PLAIN = 'could not connect Google Drive, try again';

  async function runCase(accessTok, mode, shiftMs, replayState) {
    return await ev(
      `(${RUN_CASE})(${JSON.stringify(accessTok)}, ${JSON.stringify(mode)}, ${shiftMs || 0}, ${JSON.stringify(replayState || null)})`
    );
  }

  // (a) the right state -> connects, token persisted, grant recorded.
  const a = await runCase('tok-a', 'right');
  check(
    'S01 (a) right state -> CONNECTS and persists the token + grant flag',
    a.res && a.res.ok === true && a.store.tok === 'tok-a' && a.store.granted === '1',
    { res: a.res, store: a.store, st: a.st }
  );
  check(
    'S02 state sent to requestAccessToken is 32-hex CSPRNG',
    typeof a.st === 'string' && /^[0-9a-f]{32}$/.test(a.st),
    a.st
  );
  const SAVED_STATE = a.st;

  // (b) a wrong state -> refused, plain message, nothing persisted.
  const b = await runCase('tok-b', 'wrong');
  check(
    'S03 (b) wrong state -> refused with the plain message, nothing persisted',
    b.res &&
      b.res.ok === false &&
      b.res.msg === PLAIN &&
      b.store.tok === null &&
      b.store.granted === null,
    { res: b.res, store: b.store }
  );

  // (c) no state at all -> refused.
  const c = await runCase('tok-c', 'none');
  check(
    'S04 (c) missing state -> refused with the plain message, nothing persisted',
    c.res &&
      c.res.ok === false &&
      c.res.msg === PLAIN &&
      c.store.tok === null &&
      c.store.granted === null,
    { res: c.res, store: c.store }
  );

  // (d) the right state TWICE: replay the already-consumed state from (a).
  const d = await runCase('tok-d', 'replay', 0, SAVED_STATE);
  check(
    'S05 (d) replayed (already-consumed) state -> refused, nothing persisted',
    d.res &&
      d.res.ok === false &&
      d.res.msg === PLAIN &&
      d.store.tok === null &&
      d.store.granted === null,
    { res: d.res, store: d.store }
  );

  // (e) right state, but the response arrives > 5 minutes late.
  const e = await runCase('tok-e', 'right', 6 * 60 * 1000);
  check(
    'S06 (e) state older than 5 minutes -> refused, nothing persisted',
    e.res &&
      e.res.ok === false &&
      e.res.msg === PLAIN &&
      e.store.tok === null &&
      e.store.granted === null,
    { res: e.res, store: e.store }
  );

  // fresh state per request (never reused across requests).
  const f1 = await runCase('tok-f1', 'right');
  const f2 = await runCase('tok-f2', 'right');
  check(
    'S07 every request gets a FRESH state (single use, never reused)',
    typeof f1.st === 'string' &&
      typeof f2.st === 'string' &&
      /^[0-9a-f]{32}$/.test(f1.st) &&
      /^[0-9a-f]{32}$/.test(f2.st) &&
      f1.st !== f2.st,
    { s1: f1.st, s2: f2.st }
  );

  check('S08 zero page exceptions', pageExceptions.length === 0, pageExceptions.slice(0, 3));

  // ---- summary ---------------------------------------------------------------
  try {
    await send('Page.close');
  } catch (e) {}
  try {
    proc.kill();
  } catch (e) {}
  const failed = results.filter(r => !r.val);
  log('========================================');
  log(results.length + ' checks, ' + failed.length + ' failed');
  failed.forEach(f => log('FAIL: ' + f.name + '  <-- ' + JSON.stringify(f.detail)));
  process.exit(failed.length ? 1 : 0);
})().catch(e => {
  log('HARNESS ERROR: ' + ((e && e.stack) || e));
  try {
    proc && proc.kill();
  } catch (x) {}
  process.exit(1);
});
