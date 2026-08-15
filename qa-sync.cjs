/* ============================================================
   RANK 4.5 GATE — Optional Google Identity for Sync (never gating)
   (PLAN-OF-ACTION-AI-VOICE-SYNC-v1, Rank 4.5)
   Drives headless Chrome against http://127.0.0.1:8765.
   Covers:
     - Login stays 100% optional: the app boots and every core
       CRUD path works with zero identity — nothing is gated.
     - GIS is lazy-loaded ONLY on user action; at boot there is
       no Google script tag and no connect attempt (zero
       mandatory network).
     - handleCredential stores ONLY a device label (sub/email/
       name) in a DEVICE-level localStorage slot — never in
       project state, never in the portable .json export
       (constraint #5).
     - A single dismissible suggestion is offered once when
       multi-device use is detected (a merge); dismissing it
       persists on the device and it is never re-prompted
       (no notification spam).
     - Client ID is the SHARED public ID (mmgr-google-auth.js /
       worker.js) — the old BYO "paste your client ID" requirement
       is gone (OWNER 2026-08-15). A legacy mmgr_sync_clientid
       device slot still overrides when present. An offline GIS
       load degrades to a toast, never an error.
     - Identity is never a data-access gate: merge / save /
       load / CRUD all work identically signed out or in.
   Exit 0 only when every contract holds.
   Usage: node qa-sync.cjs  (server must be on :8765)
   ============================================================ */
const { spawn } = require('child_process');
const path = require('path');
const CHROME = 'C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe';
const PORT = 9243;
const BASE = 'http://127.0.0.1:8765';
const PROFILE = path.join(require('os').tmpdir(), 'mmgr-sync-' + Date.now());
let ws, msgId = 0;
const pending = new Map();
const results = [];
const log = (s) => { process.stdout.write('[sync45] ' + s + '\n'); };
const delay = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { log('WATCHDOG'); try { ws && ws.close(); } catch (e) {} process.exit(2); }, 300000);
function send(method, params) { return new Promise(res => { const id = ++msgId; pending.set(id, m => { pending.delete(id); res(m.result || {}); }); ws.send(JSON.stringify({ id, method, params: params || {} })); }); }
async function ev(expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __err: r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text }; return r.result && r.result.value; }

(async () => {
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, '--window-size=1440,1200', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) break; } catch (e) {} await delay(300); }
  const targets = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws fail')); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: BASE + '/seed-test.html' }); await delay(4000);

  const check = (name, val, detail) => { results.push({ name, val, detail }); log((val ? 'PASS' : 'FAIL') + ' ' + name + (val ? '' : '  <-- ' + JSON.stringify(detail))); };

  // ---- 1. boot: module present, zero identity, app fully functional ----
  const b1 = await ev(`(function(){
    return { sync: !!window.MMGR.Sync, signedIn: window.MMGR.Sync.isSignedIn(),
      ident: window.MMGR.Sync.getIdentity() };
  })()`);
  check('S01 boot: MMGR.Sync registered, not signed in, no stored identity', b1.sync && b1.signedIn === false && b1.ident === null, b1);

  // Never-gating: with ZERO identity, core CRUD still works.
  const g1 = await ev(`(function(){
    window.MMGR.Tasks.addTask();
    var n1 = window.MMGR.State.getState().tasks.length;
    window.MMGR.Risks.addRisk();
    window.MMGR.Budget.addBudgetLine();
    var s = window.MMGR.State.getState();
    return { tasks: n1, risks: (s.risks || []).length, lines: (s.budgetLines || []).length };
  })()`);
  await delay(300);
  check('S02 never-gating: task/risk/budget CRUD work with zero identity', g1.tasks > 0 && g1.risks > 0 && g1.lines > 0, g1);

  // No Google script is loaded at boot (zero mandatory network).
  const b2 = await ev(`(function(){
    var tags = Array.prototype.slice.call(document.querySelectorAll('script')).map(function(s){ return s.src || ''; });
    var gis = tags.filter(function(t){ return t.indexOf('accounts.google.com') > -1; });
    return { gisTags: gis.length, scripts: tags.length };
  })()`);
  check('S03 zero-net: no GIS script tag at boot (lazy load only on action)', b2.gisTags === 0, b2);

  // The Controls drawer renders the sync section (rendered at init).
  await ev('document.querySelector("[data-action=openDrw]").click();'); await delay(300);
  const d1 = await ev(`(function(){
    var sec = document.getElementById('sync-section');
    return { sec: !!sec, hasConnect: sec ? sec.innerHTML.indexOf('Sign in with Google') > -1 : false,
      noByoField: sec ? sec.innerHTML.indexOf('Google OAuth Client ID') === -1 : false,
      suggest: sec ? (sec.querySelector('.sync-suggest') ? true : false) : false };
  })()`);
  check('S04 ui: sync section renders in drawer with Sign-in button, NO BYO client-ID field, NO suggestion yet', d1.sec && d1.hasConnect && d1.noByoField && d1.suggest === false, d1);

  // ---- 2. GIS lazy load + credential -> device label --------------------
  // Mock GIS in-page (headless has no real Google): a blank BYO slot falls
  // back to the SHARED public Client ID (the same one the main site uses) —
  // signing in from the project works with no per-device paste.
  const c1 = await ev(`(async function(){
    window.google = { accounts: { id: {
      initialize: function(cfg){ window.__gcfg = cfg; },
      renderButton: function(container, opts){ window.__gbtn = { container: container, opts: opts }; }
    } } };
    window.MMGR.Sync.setClientId('');
    var r = await window.MMGR.Sync.connect();
    var shared = (window.MMGR.GoogleAuth && window.MMGR.GoogleAuth.CLIENT_ID) || null;
    return { ok: r, noCrash: true, cfgClientId: window.__gcfg ? window.__gcfg.client_id : null, shared: shared };
  })()`);
  check('S05 gis: blank BYO slot -> shared public client ID used (no paste needed)', c1.ok === true && c1.cfgClientId === c1.shared && !!c1.shared && c1.noCrash, c1);

  // Set a BYO client ID (device slot) and connect with the mock: initialize
  // + renderButton must be driven with the client id.
  const c2 = await ev(`(async function(){
    window.MMGR.Sync.setClientId('1234-abc.apps.googleusercontent.com');
    var r = await window.MMGR.Sync.connect();
    return { ok: r, cfgClientId: window.__gcfg ? window.__gcfg.client_id : null,
      btnRendered: !!window.__gbtn };
  })()`);
  check('S06 gis: client ID set -> initialize + renderButton driven, client id passed', c2.ok && c2.cfgClientId === '1234-abc.apps.googleusercontent.com' && c2.btnRendered, c2);

  // handleCredential decodes a real-shaped JWT into the device label.
  // Build a fake JWT: base64url(header).base64url(payload).base64url(sig).
  const c3 = await ev(`(function(){
    function b64u(obj){ return btoa(JSON.stringify(obj)).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,''); }
    var token = b64u({alg:'RS256',typ:'JWT'}) + '.' + b64u({ sub:'1122334455', email:'grace.jones@gmail.com', name:'Grace Jones', picture:'', iat: 1700000000, exp: 1731536000 }) + '.' + b64u({dummy:1});
    window.MMGR.Sync.handleCredential({ credential: token });
    var id = window.MMGR.Sync.getIdentity();
    var s = window.MMGR.State.getState();
    return { sub: id && id.sub, email: id && id.email, name: id && id.name,
      signedIn: window.MMGR.Sync.isSignedIn(),
      inState: s.syncIdentity !== undefined || s.syncId !== undefined || s.googleId !== undefined,
      exportHas: window.MMGR.State.exportState().indexOf('grace.jones@gmail.com') > -1 };
  })()`);
  check('S07 identity: JWT decoded to device label (sub/email/name)', c3.sub === '1122334455' && c3.email === 'grace.jones@gmail.com' && c3.name === 'Grace Jones' && c3.signedIn, c3);
  check('S08 portability: identity NOT in project state NOR in the .json export', c3.inState === false && c3.exportHas === false, c3);

  // UI reflects signed-in state; sign out clears it.
  const c4 = await ev(`(function(){
    window.MMGR.Sync.renderSyncSection();
    var sec = document.getElementById('sync-section');
    var showsEmail = sec ? sec.innerHTML.indexOf('grace.jones@gmail.com') > -1 : false;
    window.MMGR.Sync.signOut();
    var idAfter = window.MMGR.Sync.getIdentity();
    window.MMGR.Sync.renderSyncSection();
    var sec2 = document.getElementById('sync-section');
    var hasConnectAfter = sec2 ? sec2.innerHTML.indexOf('Sign in with Google') > -1 : false;
    return { showsEmail: showsEmail, cleared: idAfter === null, connectBack: hasConnectAfter };
  })()`);
  check('S09 signout: UI shows signed-in identity, signOut clears label, Connect returns', c4.showsEmail && c4.cleared && c4.connectBack, c4);

  // ---- 3. single dismissible suggestion (no spam) -----------------------
  // After a merge (multi-device use detected), the suggestion appears once.
  const m1 = await ev(`(function(){
    localStorage.removeItem('mmgr_sync_suggest');
    window.MMGR.Sync.noteMultiDeviceUse();
    window.MMGR.Sync.renderSyncSection();
    var sec = document.getElementById('sync-section');
    return { suggest: sec ? (sec.querySelector('.sync-suggest') ? true : false) : false };
  })()`);
  check('S10 suggest: multi-device use detected -> single suggestion offered', m1.suggest === true, m1);

  // Dismiss persists — re-detection never re-prompts on this device.
  const m2 = await ev(`(function(){
    window.MMGR.Sync.dismissSuggestion();
    window.MMGR.Sync.renderSyncSection();
    var gone = !document.getElementById('sync-section').querySelector('.sync-suggest');
    window.MMGR.Sync.noteMultiDeviceUse();
    window.MMGR.Sync.renderSyncSection();
    var stillGone = !document.getElementById('sync-section').querySelector('.sync-suggest');
    return { gone: gone, stillGone: stillGone, flag: localStorage.getItem('mmgr_sync_suggest') };
  })()`);
  check('S11 suggest: dismissed once -> never re-prompted (no spam)', m2.gone && m2.stillGone && m2.flag === '1', m2);

  // A signed-in user is never shown the suggestion at all.
  const m3 = await ev(`(function(){
    localStorage.removeItem('mmgr_sync_suggest');
    var b64u = function(o){ return btoa(JSON.stringify(o)).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,''); };
    var token = b64u({alg:'RS256'}) + '.' + b64u({ sub:'99', email:'a@b.com', name:'A' }) + '.' + b64u({x:1});
    window.MMGR.Sync.handleCredential({ credential: token });
    window.MMGR.Sync.noteMultiDeviceUse();
    window.MMGR.Sync.renderSyncSection();
    var sec = document.getElementById('sync-section');
    return { suggest: sec ? (sec.querySelector('.sync-suggest') ? true : false) : false, signedIn: window.MMGR.Sync.isSignedIn() };
  })()`);
  check('S12 suggest: signed-in user never gets the suggestion', m3.signedIn && m3.suggest === false, m3);

  // ---- 4. merge path reports device pairing (label, never a gate) -------
  const mg = await ev(`(function(){
    window.MMGR.Sync.signOut();
    window.MMGR.Sync.renderSyncSection();
    var s = window.MMGR.State.getState();
    s.fieldTs = s.fieldTs || {};
    s.tasks = [{ name: 'LOCAL-TASK' }]; s.fieldTs.tasks = '2026-01-01T10:00:00.000Z';
    var inc = { schemaVersion: window.MMGR.State.SCHEMA_VERSION, updatedAt: '2026-01-01T11:00:00.000Z',
      fieldTs: { tasks: '2026-01-01T09:00:00.000Z' }, tasks: [{ name: 'FILE-TASK' }] };
    var out = window.MMGR.State.mergeExternal(inc);
    return { merged: out && out.adopted === 0, taskKept: window.MMGR.State.getState().tasks[0].name === 'LOCAL-TASK',
      stillSignedOut: window.MMGR.Sync.isSignedIn() === false };
  })()`);
  check('S13 merge: field-level merge works signed OUT (identity never a gate)', mg.merged && mg.taskKept && mg.stillSignedOut, mg);

  // Cleanup: remove test identity.
  await ev(`(function(){ window.MMGR.Sync.signOut(); window.MMGR.Sync.dismissSuggestion(); localStorage.removeItem('mmgr_sync_clientid'); return true; })()`);

  const failed = results.filter(r => !r.val);
  log('SYNC45_GATE ' + (failed.length === 0 ? 'PASS' : 'FAIL (' + failed.length + ' broken)'));
  proc.kill(); process.exit(failed.length === 0 ? 0 : 1);
})().catch(e => { log('FATAL: ' + e.message); process.exit(1); });
