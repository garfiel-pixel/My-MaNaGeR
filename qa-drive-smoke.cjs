/* ============================================================
   GOOGLE-DRIVE-BACKUP smoke test — verifies the app.html auth-bar
   wiring, the module API surface, and the project.html Controls-
   drawer section (data-action delegation through ACTION_MAP), and
   that clicking Backup without a Google session degrades
   gracefully (status line, no crash).
   Usage: node qa-drive-smoke.cjs (server on :8765)

   HARNESS LIMITATION (FINAL-PRE-DEPLOY-DIRECTIVE DIR-3, 2026-08-11):
   this harness has NO live Google credentials, so it can only verify
   the wiring, the module surface, and the no-session degradation
   paths. The REAL sign-in → Drive backup/restore round-trip requires
   a live OAuth identity and is covered MANUALLY against the deployed
   production URL (Part 1 item 5 of the directive: live click-through
   with a real Google account). Do not treat this harness's green run
   as proof of the live Drive path; run it in CI as a wiring/regression
   gate, and do the live pass separately.
   ============================================================ */
const { spawn } = require('child_process');
const path = require('path');
const { chromePath: CHROME, BASE, DEBUG_PORT: PORT } = require('./tools/chrome-launcher.cjs');
const PROFILE = path.join(require('os').tmpdir(), 'mmgr-drive-' + Date.now());
let ws, msgId = 0; const pending = new Map();
const log = (s) => { process.stdout.write('[drive] ' + s + '\n'); };
const delay = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { log('WATCHDOG'); try { ws && ws.close(); } catch (e) {} process.exit(2); }, 90000);
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

  // Collect console errors
  const consoleErrors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push((m.params.args || []).map(a => a.value || a.description || '').join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors.push('EXCEPTION: ' + (m.params.exceptionDetails && m.params.exceptionDetails.text));
    }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };

  await send('Page.navigate', { url: BASE + '/app.html' }); await delay(3500);

  const results = [];
  const check = (name, val, detail) => { results.push({ name, val, detail }); log((val ? 'PASS' : 'FAIL') + ' ' + name + (val ? '' : '  <-- ' + JSON.stringify(detail))); };

  // ---- A: buttons + status element present in the rail Backup & Restore
  //      section (NEW-UI-CREATION-BRIEF I1 follow-up 2026-08-14: the Drive
  //      controls moved from the old auth bar into the #db-sidebar rail;
  //      the ids are unchanged so mmgr-google-auth.js wiring still binds) ---
  const a = await ev(`(function(){
    var rail = document.querySelector('#db-sidebar');
    var b = document.getElementById('btn-drive-backup');
    var r = document.getElementById('btn-drive-restore');
    var s = document.getElementById('drive-sync-status');
    return {
      inRail: !!rail && !!b && !!r && rail.contains(b) && rail.contains(r),
      backupText: b ? b.textContent.trim() : '',
      restoreText: r ? r.textContent.trim() : '',
      statusPresent: !!s,
      wired: b && r && (typeof b.onclick === 'function' || b.dataset.mmgrWired === '1')
    };
  })()`);
  check('A buttons + status in the rail Backup section', a.inRail && a.backupText.indexOf('Backup') > -1 && a.restoreText.indexOf('Restore') > -1 && a.statusPresent, a);

  // ---- B: module API surface exposed --------------------------------------
  const b = await ev(`(function(){
    var G = window.MMGR && window.MMGR.GoogleAuth;
    return {
      api: !!G,
      hasBackup: !!G && typeof G.backupToDrive === 'function',
      hasRestore: !!G && typeof G.restoreFromDrive === 'function',
      hasToken: !!G && typeof G.getDriveToken === 'function',
      scope: G ? G.DRIVE_SCOPE : '',
      file: G ? G.DRIVE_FILE : ''
    };
  })()`);
  check('B module API (backup/restore/token + drive.file scope)', b.api && b.hasBackup && b.hasRestore && b.hasToken && b.scope === 'https://www.googleapis.com/auth/drive.file' && b.file === 'mymanager-backup.json', b);

  // ---- C: triggerBackup without a Google session → graceful status --------
  const c = await ev(`(async function(){
    try {
      var G = window.MMGR && window.MMGR.GoogleAuth;
      await G.triggerBackup();
      var s = document.getElementById('drive-sync-status');
      var t = s ? s.textContent : '';
      return { status: t, className: s ? s.className : '', buttonsReenabled: !document.getElementById('btn-drive-backup').disabled };
    } catch (e) {
      return { threw: e && e.message };
    }
  })()`);
  check('C Backup click without session: graceful status, no throw', !c.threw && (c.status || '').length > 0 && c.buttonsReenabled !== false, c);

  // ---- D: workspace collector excludes device-only keys -------------------
  const d = await ev(`(function(){
    try {
      localStorage.setItem('mmgr_state_demo', JSON.stringify({tasks:[1]}));
      localStorage.setItem('mmgr_unlocked_demo', '1');
      localStorage.setItem('mmgr_scope_demo', 'full');
      localStorage.setItem('mmgr_current_project', 'demo');
      localStorage.setItem('mmgr_sync_identity', JSON.stringify({sub:'x'}));
      localStorage.setItem('mmgr_sync_clientid', 'secret.apps.googleusercontent.com');
      localStorage.setItem('mmgr_errors_webhook', 'https://x');
    } catch(e) {}
    var G = window.MMGR && window.MMGR.GoogleAuth;
    var env = G.collectWorkspace ? G.collectWorkspace() : null;
    return { env: env, keys: env && env.data ? Object.keys(env.data) : [] };
  })()`);
  const dc = d.keys || [];
  check('D workspace collector present', !!d.env && d.env.kind === 'workspace-backup' && !d.__err, d);
  check('D2 excludes device-only slots', dc.indexOf('mmgr_sync_identity') === -1 && dc.indexOf('mmgr_sync_clientid') === -1 && dc.indexOf('mmgr_errors_webhook') === -1, dc);
  check('D3 includes workspace slots', dc.indexOf('mmgr_state_demo') > -1 && dc.indexOf('mmgr_unlocked_demo') > -1 && dc.indexOf('mmgr_current_project') > -1, dc);

  // ---- F: auto-backup interval select in the auth bar ---------------------
  const f = await ev(`(function(){
    var sel = document.getElementById('drive-auto-interval');
    if (!sel) return { present: false };
    var opts = Array.prototype.map.call(sel.options, function(o){ return o.value; });
    return { present: true, opts: opts, value: sel.value };
  })()`);
  check('F auto interval select present with Off/15/30/60', f.present && f.opts.join(',') === 'off,15,30,60', f);
  check('F2 auto select defaults to Off', f.value === 'off', f);

  // ---- G: setAutoInterval persists pref + restarts timer ------------------
  const g = await ev(`(async function(){
    var G = window.MMGR && window.MMGR.GoogleAuth;
    if (!G || typeof G.setAutoInterval !== 'function') return { api: false };
    var v = G.setAutoInterval('30');
    var stored = localStorage.getItem('mmgr_drive_auto');
    var sel = document.getElementById('drive-auto-interval');
    var reflected = sel ? sel.value : null;
    var back = G.getAutoInterval();
    // reset to off so the timer doesn't fire during the rest of the test
    G.setAutoInterval('off');
    return { api: true, v: v, stored: stored, reflected: reflected, back: back };
  })()`);
  check('G setAutoInterval(30) persists pref + API + select', g.api && g.v === '30' && g.stored === '30' && g.reflected === '30' && g.back === '30', g);
  const g2 = await ev(`(function(){
    return {
      stored: localStorage.getItem('mmgr_drive_auto'),
      selectValue: document.getElementById('drive-auto-interval').value
    };
  })()`);
  check('G2 setAutoInterval(off) reset persisted + select synced', g2.stored === 'off' && g2.selectValue === 'off', g2);

  // ---- H: runAutoBackupCheck with no grant → silent skip, no throw ---------
  const h = await ev(`(async function(){
    var G = window.MMGR && window.MMGR.GoogleAuth;
    if (!G || typeof G.runAutoBackupCheck !== 'function') return { api: false };
    try {
      localStorage.removeItem('mmgr_drive_auto');
      localStorage.removeItem('mmgr_drive_last');
      G.setAutoInterval('15');
      var ran = await G.runAutoBackupCheck(); // no token/grant → should return false quietly
      G.setAutoInterval('off');
      return { api: true, ran: ran };
    } catch (e) {
      return { api: true, threw: e && e.message };
    }
  })()`);
  check('H auto tick with no grant: silent skip (returns false, no throw)', h.api && h.ran === false && !h.threw, h);

  // ---- E: no console errors / exceptions on app.html ----------------------
  await delay(300);
  check('E no console errors on app.html', consoleErrors.length === 0, consoleErrors);
  consoleErrors.length = 0;

  // ---- I: project.html Controls drawer renders the Drive section -----------
  // localStorage from section D already unlocked mmgr_unlocked_demo + set the
  // current project, so project.html?id=demo boots straight into the app.
  await send('Page.navigate', { url: BASE + '/project.html?id=demo' }); await delay(4000);
  const i = await ev(`(function(){
    var sec = document.getElementById('drive-section');
    if (!sec) return { present: false };
    var b = sec.querySelector('[data-action="driveBackup"]');
    var r = sec.querySelector('[data-action="driveRestore"]');
    var sel = sec.querySelector('[data-action="driveAutoInterval"]');
    var st = document.getElementById('drive-sync-status');
    return {
      present: true,
      backup: !!b && b.textContent.indexOf('Backup to Drive') > -1,
      restore: !!r && r.textContent.indexOf('Restore from Drive') > -1,
      select: !!sel && sel.options.length === 4 && sel.value === 'off',
      status: !!st,
      inDrawer: !!sec.closest('#db-ctrl')
    };
  })()`);
  check('I project.html drawer renders Drive section (buttons + auto select + status)', i.present && i.backup && i.restore && i.select && i.status && i.inDrawer, i);

  // ---- I2: drawer Backup button (delegated data-action) degrades gracefully --
  const i2 = await ev(`(async function(){
    try {
      var b = document.querySelector('[data-action="driveBackup"]');
      if (!b) return { noBtn: true };
      b.click();
      var s, t = '';
      // Poll until the busy message clears (the no-session failure resolves
      // quickly in headless; 10s cap keeps the test from hanging on a slow GIS).
      for (var n = 0; n < 40; n++) {
        s = document.getElementById('drive-sync-status');
        t = s ? s.textContent : '';
        if (t && t.indexOf('Backing up') === -1) break;
        await new Promise(function(r){ setTimeout(r, 250); });
      }
      return { status: t, len: t.length, disabled: b ? b.disabled : null };
    } catch (e) { return { threw: e && e.message }; }
  })()`);
  check('I2 drawer Backup click: graceful status, no crash, buttons re-enabled', !i2.threw && !i2.noBtn && i2.len > 0 && i2.disabled === false, i2);

  // ---- I3: drawer auto-interval select persists via change delegation -------
  const i3 = await ev(`(async function(){
    try {
      var sel = document.querySelector('[data-action="driveAutoInterval"]');
      if (!sel) return { noSel: true };
      sel.value = '30';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(function(r){ setTimeout(r, 150); });
      var stored = localStorage.getItem('mmgr_drive_auto');
      var G = window.MMGR && window.MMGR.GoogleAuth;
      var api = G ? G.getAutoInterval() : '';
      var status = (document.getElementById('drive-sync-status') || {}).textContent || '';
      sel.value = 'off';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(function(r){ setTimeout(r, 150); });
      return { stored: stored, api: api, statusLen: status.length, final: localStorage.getItem('mmgr_drive_auto') };
    } catch (e) { return { threw: e && e.message }; }
  })()`);
  check('I3 drawer select persists + reports via data-action (30 -> off)', !i3.threw && !i3.noSel && i3.stored === '30' && i3.api === '30' && i3.statusLen > 0 && i3.final === 'off', i3);

  // ---- E2: no console errors / exceptions on project.html -------------------
  await delay(300);
  check('E2 no console errors on project.html', consoleErrors.length === 0, consoleErrors);

  // ---- K: drawer passphrase input — set -> enc ON, cleared input, status ----
  const k = await ev(`(async function(){
    var inp = document.querySelector('[data-action="driveSetPass"]');
    if (!inp) return { noInput: true };
    var G = window.MMGR && window.MMGR.GoogleAuth;
    inp.value = 's3cret-phrase';
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(function(r){ setTimeout(r, 200); });
    var on = localStorage.getItem('mmgr_drive_enc');
    var echoed = inp.value; // must be cleared so the passphrase never lingers in the DOM
    var status1 = (document.getElementById('drive-sync-status') || {}).textContent || '';
    // turn it off again
    inp.value = '';
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(function(r){ setTimeout(r, 200); });
    var off = localStorage.getItem('mmgr_drive_enc');
    var status2 = (document.getElementById('drive-sync-status') || {}).textContent || '';
    return { noInput: false, on: on, off: off, echoed: echoed, status1: status1, status2: status2 };
  })()`);
  check('K drawer passphrase: set -> enc ON + input cleared + status line', !k.noInput && k.on === '1' && k.off === null && k.echoed === '' && k.status1.indexOf('encryption ON') > -1 && k.status2.indexOf('encryption OFF') > -1, k);

  // ---- L: AES-256-GCM round-trip + wrong passphrase rejected ----------------
  const l = await ev(`(async function(){
    var G = window.MMGR && window.MMGR.GoogleAuth;
    var enc, dec;
    try {
      enc = await G.encryptPayload({ hello: 'world', pin: 'p4ss' }, 's3cret-phrase');
      dec = await G.decryptPayload(enc, 's3cret-phrase');
    } catch (e) { return { threw: e && e.message }; }
    var wrong = false;
    try { await G.decryptPayload(enc, 'totally-wrong'); } catch (e) { wrong = true; }
    return {
      hasSaltIvData: !!(enc.salt && enc.iv && enc.data),
      noPlaintext: enc.data.indexOf('world') === -1 && enc.data.indexOf('p4ss') === -1,
      round: dec.hello === 'world' && dec.pin === 'p4ss',
      wrong: wrong
    };
  })()`);
  check('L encrypt/decrypt round-trip (AES-GCM) + wrong passphrase fails', !l.threw && l.hasSaltIvData && l.noPlaintext && l.round && l.wrong, l);

  // ---- M: AI key in project state is hidden by encryption -------------------
  const m = await ev(`(async function(){
    var G = window.MMGR && window.MMGR.GoogleAuth;
    localStorage.setItem('mmgr_state_demo', JSON.stringify({ config: { ai: { tier: 'cloud', apiKey: 'sk-live-9f3a2b7c' } } }));
    var env = G.collectWorkspace();
    var plainHasKey = env.data['mmgr_state_demo'].indexOf('sk-live-9f3a2b7c') > -1;
    var sealed = await G.encryptPayload(env, 's3cret-phrase');
    var cipherLeaks = sealed.data.indexOf('sk-live-9f3a2b7c') > -1 || sealed.data.indexOf('mmgr_state_demo') > -1;
    var back = await G.decryptPayload(sealed, 's3cret-phrase');
    return { plainHasKey: plainHasKey, cipherLeaks: cipherLeaks, same: back.data['mmgr_state_demo'] === env.data['mmgr_state_demo'] };
  })()`);
  check('M AI key travels in plaintext envelope but not in ciphertext', m.plainHasKey === true && m.cipherLeaks === false && m.same === true, m);

  // ---- J2: fail-closed — enc ON with no session passphrase refuses upload ---
  // Re-arm the flag, wipe the session passphrase, reload so the module's
  // session-memory var resets — backupToDrive must throw BEFORE any Drive call.
  await ev(`(function(){ localStorage.setItem('mmgr_drive_enc', '1'); sessionStorage.removeItem('mmgr_drive_pass'); return true; })()`);
  consoleErrors.length = 0;
  await send('Page.reload'); await delay(4000);
  const j2 = await ev(`(async function(){
    var G = window.MMGR && window.MMGR.GoogleAuth;
    try {
      await G.backupToDrive();
      return { proceeded: true };
    } catch (e) {
      return { proceeded: false, msg: (e && e.message) || '', noPass: /passphrase/.test((e && e.message) || ''), encOn: G.encryptionEnabled() };
    }
  })()`);
  check('J2 fail-closed: enc ON + no session passphrase refuses to upload', j2.proceeded === false && j2.noPass === true && j2.encOn === true, j2);
  await ev(`(function(){ localStorage.removeItem('mmgr_drive_enc'); sessionStorage.removeItem('mmgr_drive_pass'); return true; })()`);
  await delay(200);

  // ---- E3: no console errors after reload + encryption checks ---------------
  check('E3 no console errors after reload + encryption checks', consoleErrors.length === 0, consoleErrors);

  const failed = results.filter(r => !r.val);
  log('DRIVE_SMOKE ' + (failed.length === 0 ? 'PASS' : 'FAIL (' + failed.length + ' broken)'));
  proc.kill(); process.exit(failed.length === 0 ? 0 : 1);
})().catch(e => { log('FATAL: ' + e.message); process.exit(1); });
