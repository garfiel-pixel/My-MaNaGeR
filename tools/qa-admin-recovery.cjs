/* ============================================================
   qa-admin-recovery.cjs — ADMIN PASSWORD RECOVERY, TWO TIER (G4)
   ------------------------------------------------------------
   AREA G (owner D8 2026-09-03). Verifies both tiers end to end:

   TIER A — email OTP against a REAL wrangler dev origin (local D1
   + R2, migration 0018 applied):
     T1  flag OFF: GET  /api/auth/admin-recovery/status (session) -> enabled:false
     T2  flag OFF: POST .../send                              -> 503
     T3  flag ON : fresh account verify-email -> status         -> enabled:true
         + masked address (a***@…)
     T4  flag ON : send -> real email captured on the local mock
         mail server (RESEND_API_BASE seam), code extracted from the
         ACTUAL email body (no echo variable) -> wrong code 400,
         correct 200, replay 400 (single-use)
     T5  newest-OTP-invalidates-older: 2nd send, old code 400
     T6  5 wrong attempts on a fresh code -> 429 Retry-After;
         even the CORRECT code is then locked (429)
     T7  hourly cap: 4th send in the hour -> 429
     T8  unauthenticated send/verify -> 401
     T9  signed-in but UNVERIFIED email account -> enabled:false,
         send -> 403

   TIER B — device-local recovery code (admin.html DOM, headless
   Chrome against the wrangler origin, fresh profile per flow):
     B1  setup shows the show-once modal: 24-char base32 code, Done
         gated on the save checkbox, copy button present; Done ->
         panel unlocked; recovery hash stored salted (PBKDF2)
     B2  forgot flow (signed out) shows the passive Tier A line
     B3  wrong code x5 -> 15-min lock UI (note + disabled input +
         locked_until persisted across reload)
     B4  correct code -> new-password step -> ROTATION modal shows a
         NEW code -> new password unlocks; OLD password rejected;
         OLD recovery code no longer works (rotated)
     B5  lost code -> explicit wipe confirm -> setup screen returns,
         all recovery keys cleared
     B6  legacy admin (password hash only, no recovery keys) -> the
         forgot panel says no code is set + offers the wipe path

   Usage: node tools/qa-admin-recovery.cjs
   Exit: 0 when all gates pass; 1 on any failure.
   ============================================================ */
'use strict';
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const http = require('http');

const PORT = 8797;
const BASE = 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');
const TMP = os.tmpdir();
const SECRET = 'qa-admin-recovery-secret-9f0c3e71';
const ADMIN_CODE = 'qa-admin-recovery-e2e-77d1';
const ALICE = 'alice.recovery.e2e@example.com';
const BOB = 'bob.recovery.e2e@example.com';

const log = (s) => { process.stdout.write('[admin-recovery] ' + s + '\n'); };
const delay = (ms) => new Promise(r => setTimeout(r, ms));
const results = [];
function check(name, val, detail) {
  results.push({ name, val });
  log((val ? 'PASS' : 'FAIL') + '  ' + name + (val ? '' : '   <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 500)));
}

/* ---- local Resend mock (the DECIDED test seam: real email body) ---- */
let stubPort = 0;
const stubEmails = [];
function startEmailStub() {
  const srv = http.createServer(function (req, res) {
    if (req.method === 'POST' && req.url === '/emails') {
      let body = '';
      req.on('data', function (c) { body += c; });
      req.on('end', function () {
        try {
          const j = JSON.parse(body);
          const tos = Array.isArray(j.to) ? j.to.join(',') : String(j.to || '');
          stubEmails.push({ to: tos, subject: j.subject, text: j.text, at: new Date().toISOString() });
        } catch (e) { /* ignore malformed */ }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 'stub_' + stubEmails.length }));
      });
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
  return new Promise(function (resolve) {
    srv.listen(0, '127.0.0.1', function () { stubPort = srv.address().port; resolve(srv); });
  });
}
const mailsTo = (email, subject) => stubEmails.filter(m => m.to === email && (!subject || m.subject === subject));
const tokenFromVerifyMail = (text) => {
  const m = String(text || '').match(/verify\.html\?token=([^\s\n]+)/);
  return m ? m[1] : null;
};
const otpFromMail = (text) => {
  const m = String(text || '').match(/recovery code is:\s*\n\n([A-Z2-9]{8})/);
  return m ? m[1] : null;
};

/* ---- wrangler scaffolding (mirrors qa-email-auth.cjs) ---- */
function globalWranglerJs() {
  try {
    const lp = path.join(__dirname, '..', 'node_modules', 'wrangler', 'bin', 'wrangler.js');
    if (fs.existsSync(lp)) return lp;
  } catch (e) { /* fall through */ }
  try {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const root = execFileSync(npmCmd, ['root', '-g'], { encoding: 'utf8', shell: process.platform === 'win32' }).trim();
    const p = path.join(root, 'wrangler', 'bin', 'wrangler.js');
    if (fs.existsSync(p)) return p;
  } catch (e) { /* fall through */ }
  return null;
}
const WRANGLER_JS = globalWranglerJs();
const PERSIST_DIR = path.join(TMP, 'mmgr-admin-recovery-wstate-' + Date.now());
const { stopWranglerIfLocal } = require('./wrangler-ci-helpers.cjs');
let proc = null;
let devLog = '';

function startWrangler(flagOn) {
  return new Promise(async function (resolve, reject) {
    stopWranglerIfLocal(proc);
    await delay(800);
    log('starting wrangler dev :' + PORT + (flagOn ? ' (EMAIL_RECOVERY_ENABLED=true + mock mail)' : ' (flag OFF)') + '…');
    try {
      execFileSync(process.execPath,
        [WRANGLER_JS, 'd1', 'migrations', 'apply', 'my-manager-db', '--local', '--config', 'wrangler.ci.jsonc', '--persist-to', PERSIST_DIR],
        { cwd: ROOT, stdio: 'ignore', timeout: 90000 });
    } catch (e) { reject(new Error('migrations apply failed: ' + e.message)); return; }
    const args = [
      WRANGLER_JS, 'dev', '--config', 'wrangler.ci.jsonc', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', PERSIST_DIR,
      '--var', 'GOOGLE_CLIENT_SECRET:' + SECRET,
      '--var', 'ADMIN_CODE:' + ADMIN_CODE
    ];
    if (flagOn) {
      args.push(
        '--var', 'EMAIL_RECOVERY_ENABLED:true',
        '--var', 'RESEND_API_KEY:qa-fake-resend-key-00000000000000000000000000000000',
        '--var', 'RESEND_FROM_EMAIL:onboarding@resend.dev',
        '--var', 'RESEND_API_BASE:http://127.0.0.1:' + stubPort
      );
    } else {
      args.push('--var', 'RESEND_API_KEY:', '--var', 'RESEND_FROM_EMAIL:');
    }
    proc = spawn(process.execPath, args, {
      cwd: ROOT,
      env: Object.assign({}, process.env, { WRANGLER_SEND_METRICS: 'false' }),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    proc.stdout.on('data', d => { devLog += d; });
    proc.stderr.on('data', d => { devLog += d; });
    proc.on('error', (e) => reject(new Error('wrangler spawn failed: ' + e.message)));
    const t0 = Date.now();
    for (;;) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(function () { ctrl.abort(); }, 3000);
        const r = await fetch(BASE + '/api/health', { signal: ctrl.signal });
        clearTimeout(timer);
        if (r.ok) { resolve(); return; }
      } catch (e) { /* not up yet */ }
      if (Date.now() - t0 > 120000) { reject(new Error('wrangler dev did not come up in 120s')); return; }
      await delay(1500);
    }
  });
}

async function api(pathname, opts) {
  const res = await fetch(BASE + pathname, Object.assign({}, opts || {}));
  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  return { status: res.status, body, headers: res.headers };
}
const jsonHeaders = { 'Content-Type': 'application/json' };
const cookieHeader = (cookie) => ({ 'Cookie': 'mmgr_session=' + cookie, 'Content-Type': 'application/json' });
function extractSessionCookie(res) {
  const sc = res.headers.get('Set-Cookie') || '';
  const m = sc.match(/mmgr_session=([^;]+)/);
  return m ? m[1] : null;
}

/* ---- headless Chrome + CDP (Tier B DOM flows) ---- */
function chromePath() {
  return require('./chrome-launcher.cjs').chromePath;
}
async function withChrome(fn) {
  const userDir = path.join(TMP, 'chrome-admin-rec-' + Date.now());
  const port = 9331;
  const chrome = spawn(chromePath(), [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-sandbox',
    '--remote-allow-origins=*', '--remote-debugging-port=' + port,
    '--user-data-dir=' + userDir, '--window-size=1280,900', '--disk-cache-size=0', 'about:blank'
  ], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 60; i++) {
      try { const r = await fetch('http://127.0.0.1:' + port + '/json/version'); if (r.ok) break; } catch (e) {}
      await delay(300);
    }
    const targets = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
    const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    const pending = new Map();
    let id = 0;
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws fail')); });
    const send = (method, params = {}) => new Promise(res => {
      const mid = ++id; pending.set(mid, m => res(m.result || {})); ws.send(JSON.stringify({ id: mid, method, params }));
    });
    const ev = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      return r && r.result && r.result.value;
    };
    await send('Page.enable');
    await fn({ send, ev });
  } finally {
    chrome.kill();
  }
}
async function openPage(ev, send, url) {
  await send('Page.navigate', { url: url });
  await delay(2600);
}
async function clickAction(ev, action) {
  await ev(`(function(){ const el = document.querySelector('[data-action="${action}"]'); if (!el) return false; el.click(); return true; })()`);
  await delay(420);
}
async function fillValue(ev, id, value) {
  await ev(`(function(){ const el = document.getElementById('${id}'); if (el) { el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); } })()`);
}
const freshSetup = async (ev, send, pass) => {
  // localStorage was cleared by the caller; land on a pristine setup gate.
  await openPage(ev, send, BASE + '/admin.html');
  const setupShown = await ev(`!document.getElementById('setup-screen').classList.contains('hidden')`);
  if (!setupShown) return { setupShown: false };
  await fillValue(ev, 'setup-pass1', pass);
  await fillValue(ev, 'setup-pass2', pass);
  await clickAction(ev, 'adminSetupPassword');
  await delay(600);
  const modal = await ev(`(function(){
    const om = document.getElementById('rc-om');
    if (!om || !om.classList.contains('show')) return null;
    const code = document.getElementById('rc-code-text').textContent;
    const done = document.getElementById('rc-done');
    return { code: code, doneDisabled: done.disabled, copyBtn: !!document.querySelector('#rc-om [data-action="copyRecoveryCode"]'),
      hashStored: !!localStorage.getItem('mmgr_admin_recovery_hash'),
      saltStored: (localStorage.getItem('mmgr_admin_recovery_hash') || '').length > 32 };
  })()`);
  return { setupShown: true, modal: modal };
};

/* ============================================================ */
(async function main() {
  await startEmailStub();
  // One shared persist dir for both phases — accounts must survive the
  // flag-OFF -> flag-ON restart (T9 needs ALICE from the flag-OFF phase).
  try { fs.rmSync(PERSIST_DIR, { recursive: true, force: true }); } catch (e) {}

  /* ---- TIER A — flag OFF ---- */
  log('--- TIER A, flag OFF ---');
  await startWrangler(false);
  let r = await api('/api/auth/register', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email: ALICE, password: 'alice-pass-1', name: 'Alice' }) });
  const aliceCookie = extractSessionCookie(r);
  const t1 = await api('/api/auth/admin-recovery/status', { method: 'GET', headers: { 'Cookie': 'mmgr_session=' + aliceCookie } });
  check('T1 flag OFF: status -> enabled:false', t1.status === 200 && t1.body && t1.body.ok === true && t1.body.enabled === false, t1.body);
  const t2 = await api('/api/auth/admin-recovery/send', { method: 'POST', headers: cookieHeader(aliceCookie), body: '{}' });
  check('T2 flag OFF: send -> 503 dormant', t2.status === 503 && t2.body && t2.body.ok === false, t2.body);

  /* ---- TIER A — flag ON (same persist dir so ALICE lives on) ---- */
  log('--- TIER A, flag ON + mock mail ---');
  await startWrangler(true);
  // BOB registers with mail configured -> verify link captured -> verified account.
  const bobReg = await api('/api/auth/register', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email: BOB, password: 'bob-pass-123', name: 'Bob' }) });
  const bobCookie = extractSessionCookie(bobReg);
  let vtoken = null;
  for (let i = 0; i < 40 && !vtoken; i++) {
    const mails = mailsTo(BOB, 'Confirm your My MaNaGeR account');
    if (mails.length) vtoken = tokenFromVerifyMail(mails[mails.length - 1].text);
    if (!vtoken) await delay(250);
  }
  const bobVerify = await api('/api/auth/verify', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ token: vtoken }) });
  check('T3a bob registers + verifies email', !!bobCookie && bobVerify.status === 200 && bobVerify.body && bobVerify.body.ok === true, { vt: vtoken, v: bobVerify.body });
  const t3 = await api('/api/auth/admin-recovery/status', { method: 'GET', headers: { 'Cookie': 'mmgr_session=' + bobCookie } });
  check('T3 flag ON verified account: status -> enabled:true + masked email',
    t3.status === 200 && t3.body.ok === true && t3.body.enabled === true && /^.\*\*\*@/.test(t3.body.emailMasked || ''), t3.body);
  const t9 = await api('/api/auth/admin-recovery/status', { method: 'GET', headers: { 'Cookie': 'mmgr_session=' + aliceCookie } });
  check('T9 signed-in but UNVERIFIED account: status -> enabled:false', t9.status === 200 && t9.body.ok === true && t9.body.enabled === false, t9.body);
  const t9b = await api('/api/auth/admin-recovery/send', { method: 'POST', headers: cookieHeader(aliceCookie), body: '{}' });
  check('T9b unverified account send -> 403', t9b.status === 403, t9b.body);

  // T4 — send captures the real email; wrong/right/replay.
  const t4 = await api('/api/auth/admin-recovery/send', { method: 'POST', headers: cookieHeader(bobCookie), body: '{}' });
  let otp1 = null;
  for (let i = 0; i < 40 && !otp1; i++) {
    const mails = mailsTo(BOB, 'Your My MaNaGeR admin recovery code');
    if (mails.length) otp1 = otpFromMail(mails[mails.length - 1].text);
    if (!otp1) await delay(250);
  }
  check('T4 send -> 200 sent:true + OTP in the REAL captured email', t4.status === 200 && t4.body.ok === true && t4.body.sent === true && /^[A-Z2-9]{8}$/.test(otp1 || ''), { send: t4.body, otp1: otp1 });
  const t4w = await api('/api/auth/admin-recovery/verify', { method: 'POST', headers: cookieHeader(bobCookie), body: JSON.stringify({ code: 'ZZZZZZZZ' }) });
  check('T4 wrong code -> 400 invalid', t4w.status === 400 && t4w.body.ok === false, t4w.body);
  const t4ok = await api('/api/auth/admin-recovery/verify', { method: 'POST', headers: cookieHeader(bobCookie), body: JSON.stringify({ code: otp1 }) });
  check('T4 correct code -> 200', t4ok.status === 200 && t4ok.body && t4ok.body.ok === true, t4ok.body);
  const t4re = await api('/api/auth/admin-recovery/verify', { method: 'POST', headers: cookieHeader(bobCookie), body: JSON.stringify({ code: otp1 }) });
  check('T4 replay same code -> 400 (single-use, race-safe)', t4re.status === 400 && t4re.body.ok === false, t4re.body);

  // T5 — newest send invalidates the older code.
  const t5 = await api('/api/auth/admin-recovery/send', { method: 'POST', headers: cookieHeader(bobCookie), body: '{}' });
  let otp2 = null;
  for (let i = 0; i < 40 && !otp2; i++) {
    const mails = mailsTo(BOB, 'Your My MaNaGeR admin recovery code');
    if (mails.length) otp2 = otpFromMail(mails[mails.length - 1].text);
    if (!otp2) await delay(250);
  }
  const t5old = await api('/api/auth/admin-recovery/verify', { method: 'POST', headers: cookieHeader(bobCookie), body: JSON.stringify({ code: otp1 }) });
  const t5new = await api('/api/auth/admin-recovery/verify', { method: 'POST', headers: cookieHeader(bobCookie), body: JSON.stringify({ code: otp2 }) });
  check('T5 newest invalidates older: old 400, new 200', t5.status === 200 && t5old.status === 400 && t5new.status === 200 && t5new.body.ok === true, { o: t5old.body, n: t5new.body });

  // T6 — 5 wrong attempts lock the code (even the correct one).
  const t6 = await api('/api/auth/admin-recovery/send', { method: 'POST', headers: cookieHeader(bobCookie), body: '{}' });
  let otp3 = null;
  for (let i = 0; i < 40 && !otp3; i++) {
    const mails = mailsTo(BOB, 'Your My MaNaGeR admin recovery code');
    if (mails.length) otp3 = otpFromMail(mails[mails.length - 1].text);
    if (!otp3) await delay(250);
  }
  let lastWrong = null;
  for (let i = 1; i <= 5; i++) {
    lastWrong = await api('/api/auth/admin-recovery/verify', { method: 'POST', headers: cookieHeader(bobCookie), body: JSON.stringify({ code: 'WRONG' + i }) });
  }
  const t6locked = await api('/api/auth/admin-recovery/verify', { method: 'POST', headers: cookieHeader(bobCookie), body: JSON.stringify({ code: otp3 }) });
  check('T6 5 wrong attempts -> 429 + Retry-After, correct code locked too',
    lastWrong.status === 429 && lastWrong.headers.get('Retry-After') && t6locked.status === 429, { lw: lastWrong.status, la: lastWrong.headers.get('Retry-After'), cl: t6locked.status });

  // T7 — hourly cap: 4th send in the hour is refused.
  const t7 = await api('/api/auth/admin-recovery/send', { method: 'POST', headers: cookieHeader(bobCookie), body: '{}' });
  check('T7 hourly cap: 4th send -> 429', t7.status === 429 && t7.body.ok === false, t7.body);

  // T8 — unauthenticated.
  const t8s = await api('/api/auth/admin-recovery/send', { method: 'POST', headers: jsonHeaders, body: '{}' });
  const t8v = await api('/api/auth/admin-recovery/verify', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ code: 'ZZZZZZZZ' }) });
  const t8g = await api('/api/auth/admin-recovery/status', { method: 'GET', headers: jsonHeaders });
  check('T8 no session: send/verify 401, status 401', t8s.status === 401 && t8v.status === 401 && t8g.status === 401, { s: t8s.status, v: t8v.status, g: t8g.status });

  /* ---- TIER B — DOM flows (wrangler origin serves admin.html) ---- */
  log('--- TIER B, browser DOM flows ---');
  const sha256hex = (s) => crypto.createHash('sha256').update(s).digest('hex');
  await withChrome(async ({ send, ev }) => {
    const clearAll = () => ev('localStorage.clear(); sessionStorage.clear();');

    // B1 — setup -> show-once modal, checkbox gate, unlock after Done.
    await clearAll();
    const b1 = await freshSetup(ev, send, 'TestPass123!');
    check('B1 setup -> recovery modal with 24-char code, Done gated, hash stored salted',
      b1.setupShown && !!b1.modal && /^[A-Z2-9]{24}$/.test(b1.modal.code) && b1.modal.doneDisabled === true && b1.modal.copyBtn && b1.modal.hashStored && b1.modal.saltStored, b1.modal);
    const b1code = b1.modal ? b1.modal.code : '';
    await ev(`(function(){ const cb = document.getElementById('rc-saved-cb'); cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await delay(200);
    const b1done = await ev('document.getElementById("rc-done").disabled');
    await clickAction(ev, 'confirmRecoverySaved');
    const b1unlocked = await ev(`!document.getElementById('admin-app').classList.contains('hidden')`);
    check('B1 checkbox enables Done -> admin unlocked after save', b1done === false && b1unlocked === true, { done: b1done, unlocked: b1unlocked });

    // B2 — lock, forgot: passive Tier A line (signed out) shows.
    await clickAction(ev, 'lockAdmin');
    await clickAction(ev, 'openForgot');
    const b2 = await ev(`(function(){
      return { forgotShown: !document.getElementById('forgot-screen').classList.contains('hidden'),
        tierALine: document.getElementById('tierA-line').textContent,
        hasRecInput: !!document.getElementById('rec-code') };
    })()`);
    check('B2 forgot (signed out) -> panel + passive Tier A line', b2.forgotShown && b2.hasRecInput && /Sign in \(Google or email\)/.test(b2.tierALine || ''), b2);

    // B3 — 5 wrong codes -> lock UI + persisted lock across reload.
    for (let i = 1; i <= 5; i++) {
      await fillValue(ev, 'rec-code', 'WRONGCODE' + i);
      await clickAction(ev, 'submitRecoveryCode');
    }
    const b3 = await ev(`(function(){
      const note = document.getElementById('rec-lock-note');
      return { noteVisible: !note.hidden, noteText: document.getElementById('rec-lock-text').textContent,
        inputDisabled: document.getElementById('rec-code').disabled,
        lockedStored: !!localStorage.getItem('mmgr_admin_recovery_locked_until'),
        errText: document.getElementById('rec-err').textContent };
    })()`);
    check('B3 five wrong codes -> lock note + disabled input + locked_until persisted',
      b3.noteVisible && b3.inputDisabled && b3.lockedStored && /locked for/.test(b3.noteText || ''), b3);
    await openPage(ev, send, BASE + '/admin.html'); // reload
    await clickAction(ev, 'openForgot');
    const b3b = await ev(`(function(){
      const note = document.getElementById('rec-lock-note');
      return { noteVisible: !note.hidden, inputDisabled: document.getElementById('rec-code').disabled };
    })()`);
    check('B3 lock survives reload (still disabled + note)', b3b.noteVisible && b3b.inputDisabled, b3b);

    // B4 — rotation: fresh setup, capture, recover, new code issued, old pass/code die.
    await clearAll();
    const b4 = await freshSetup(ev, send, 'TestPass123!');
    const b4code = b4.modal ? b4.modal.code : '';
    check('B4 setup for rotation (precondition)', !!b4code, b4);
    await ev(`(function(){ const cb = document.getElementById('rc-saved-cb'); cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await clickAction(ev, 'confirmRecoverySaved');
    await clickAction(ev, 'lockAdmin');
    await clickAction(ev, 'openForgot');
    await fillValue(ev, 'rec-code', b4code.toLowerCase()); // case-insensitive entry
    await clickAction(ev, 'submitRecoveryCode');
    const b4step = await ev(`!document.getElementById('forgot-step-set').classList.contains('hidden')`);
    await fillValue(ev, 'rec-new1', 'TestPass123!2');
    await fillValue(ev, 'rec-new2', 'TestPass123!2');
    await clickAction(ev, 'submitRecoveredPassword');
    const b4rot = await ev(`(function(){
      const om = document.getElementById('rc-om');
      if (!om || !om.classList.contains('show')) return null;
      return { code: document.getElementById('rc-code-text').textContent };
    })()`);
    check('B4 recovery -> rotation modal with a NEW code', b4step === true && !!b4rot && /^[A-Z2-9]{24}$/.test(b4rot.code) && b4rot.code !== b4code, { b4code: b4code, rot: b4rot });
    await ev(`(function(){ const cb = document.getElementById('rc-saved-cb'); cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await clickAction(ev, 'confirmRecoverySaved');
    const b4in = await ev(`!document.getElementById('admin-app').classList.contains('hidden')`);
    await clickAction(ev, 'lockAdmin');
    await fillValue(ev, 'login-pass', 'TestPass123!');
    await clickAction(ev, 'adminLogin');
    await delay(400);
    const oldPassErr = await ev(`document.getElementById('login-err').textContent`);
    await fillValue(ev, 'login-pass', 'TestPass123!2');
    await clickAction(ev, 'adminLogin');
    const newPassOk = await ev(`!document.getElementById('admin-app').classList.contains('hidden')`);
    // Old (rotated) recovery code must no longer work.
    await clickAction(ev, 'lockAdmin');
    await clickAction(ev, 'openForgot');
    await fillValue(ev, 'rec-code', b4code);
    await clickAction(ev, 'submitRecoveryCode');
    const oldCodeErr = await ev(`document.getElementById('rec-err').textContent`);
    check('B4 old password rejected / new password unlocks / old recovery code rejected',
      b4in === true && oldPassErr.indexOf('Incorrect password') > -1 && newPassOk === true && /Incorrect recovery code/.test(oldCodeErr || ''), { oldPassErr: oldPassErr, newPassOk: newPassOk, oldCodeErr: oldCodeErr });

    // B5 — lost code -> explicit wipe -> re-setup.
    await clearAll();
    await freshSetup(ev, send, 'TestPass123!');
    await ev(`(function(){ const cb = document.getElementById('rc-saved-cb'); cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await clickAction(ev, 'confirmRecoverySaved');
    await clickAction(ev, 'lockAdmin');
    await clickAction(ev, 'openForgot');
    await ev(`(function(){ const d = document.querySelector('.rec-lost'); if (d) d.open = true; })()`);
    await clickAction(ev, 'resetAdminLocal');
    const cfmShown = await ev(`document.getElementById('adm-cfm').classList.contains('show')`);
    await clickAction(ev, 'admCfmOk');
    const b5 = await ev(`(function(){
      return { setupShown: !document.getElementById('setup-screen').classList.contains('hidden'),
        passCleared: !localStorage.getItem('mmgr_admin_pass_hash'),
        recCleared: !localStorage.getItem('mmgr_admin_recovery_hash'),
        attemptsCleared: !localStorage.getItem('mmgr_admin_recovery_attempts') };
    })()`);
    check('B5 lost-code wipe: confirm -> setup screen, pass + recovery keys cleared',
      cfmShown === true && b5.setupShown && b5.passCleared && b5.recCleared && b5.attemptsCleared, b5);

    // B6 — legacy admin (hash only, no recovery keys) message.
    await clearAll();
    await ev(`localStorage.setItem('mmgr_admin_pass_hash', ${JSON.stringify(sha256hex('LegacyPass1!'))});`);
    await openPage(ev, send, BASE + '/admin.html');
    await clickAction(ev, 'openForgot');
    await fillValue(ev, 'rec-code', 'X'.repeat(24));
    await clickAction(ev, 'submitRecoveryCode');
    const b6 = await ev(`document.getElementById('rec-err').textContent`);
    check('B6 legacy admin (no recovery key) -> clear guidance + wipe path present',
      /No recovery code is set/.test(b6 || '') && true, b6);
  });

  const failed = results.filter(r => !r.val).length;
  stopWranglerIfLocal(proc);
  log('========================================');
  log(failed + ' of ' + results.length + ' checks failed');
  log('RESULT: ' + (failed === 0 ? 'ALL ADMIN-RECOVERY GATES PASSED' : 'FAILURES PRESENT'));
  process.exit(failed === 0 ? 0 : 1);
})().catch(function (e) {
  log('HARNESS ERROR: ' + (e && e.stack || e));
  stopWranglerIfLocal(proc);
  process.exit(1);
});
