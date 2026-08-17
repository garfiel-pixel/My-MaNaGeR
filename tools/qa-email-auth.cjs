/* ============================================================
   qa-email-auth.cjs — EMAIL+PASSWORD AUTH + BILLING WIRING
   ------------------------------------------------------------
   Exercises the completed deferred cloud items #14 (email+password
   sign-in) and #15 (billing tier) end to end against a REAL
   wrangler dev origin (local D1 + R2, all migrations applied):

   PHASE 1 — DORMANT (no LEMONSQUEEZY_* secrets, matching the
   current unconfigured production state):
     A1  register invalid email            -> 400
     A2  register password < 8 chars       -> 400
     A3  register valid                    -> 200 + Set-Cookie
         mmgr_session, user.sub === 'email:<addr>' (namespace that
         can never collide with Google's numeric subs), name
         echoed, NO password_hash in the response
     A4  duplicate register                -> 409
     A5  login unknown email               -> 401 'invalid email or
         password' (indistinguishable from a wrong password —
         timing-side-channel guard)
     A6  login wrong password              -> 401, same body shape
     A7  login correct                     -> 200 + Set-Cookie
     A8  /api/auth/me with the cookie      -> ok, email normalized
     A9  register with mixed-case+spaces   -> stored lowercase,
         login with a different case still works
     A10 /api/auth/me with NO cookie       -> {ok:false,user:null}
     A11 cloud endpoint with NO cookie     -> 403 generic body
     A12 email session creates a cloud     -> linked:true (google_sub
         project / loads it with the session  -> 200 (the sub-match
         gate accepts the 'email:' namespace)
     A13 account isolation: second account -> cannot see or load
         the first account's project
     A14 billing DORMANT: status           -> configured:false;
         checkout                          -> 503
     A16 register name > 80 chars          -> sliced to 80
     A17 logout clears; /me afterwards     -> null
     A18 email session on prefs R2         -> PUT/GET round-trip
         works (prefs keyed on 'email:' sub)
     A15 rate burst LAST: 40 wrong-password -> at least one 429 with
         logins (never-registered           Retry-After AND at least
         email — the per-account lockout    one 401 (limiter lets
         guard never engages, so the        real attempts through,
         RATE LIMITER is what is tested)    then blocks)

   PHASE 2 — CONFIGURED (fake LEMONSQUEEZY_* secrets + a
   FREE_PROJECT_CAP override, same persist dir so accounts live):
     B1  status (alice)                    -> configured:true,
         plan free, projectCap 2
     B2  new account creates linked        -> 2 ok, then the 3rd is
         projects over the cap              HTTP 402 {upgrade:true}
     B3  signature-verified webhook        -> 200, row upserted
         subscription_created for that sub
     B4  status after webhook              -> active:true, plan 'pro'
     B5  create again now over the cap     -> 200 (cap cleared by an
                                            active subscription)
     B6  webhook bad signature /          -> 401 / 200 ignored
         test_request event

   The password path is exercised for REAL (no cookie minting):
   PBKDF2-SHA256 (100k iters, per-account salt) is computed by the
   Worker on every register/login. Wrangler is started with
   --var GOOGLE_CLIENT_SECRET (same mechanism a real deploy gets
   from the Wrangler secret store — the session-signing path is
   identical to Google sign-in).

   Usage:  node tools/qa-email-auth.cjs
   Exit:   0 when all gates pass + clean stop; 1 on any failure.
   ============================================================ */
'use strict';
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const http = require('http');

const PORT = 8796;
const BASE = 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');
const TMP = os.tmpdir();
const STATE_FILE = path.join(TMP, 'mmgr-email-auth-state.json');
const STOP_FILE = path.join(TMP, 'mmgr-email-auth-stop');

// Known secret passed to wrangler dev — the session-signing path is
// byte-identical to a real deployment's Wrangler secret.
const SECRET = 'qa-email-auth-secret-4e71b9c2';
const ADMIN_CODE = 'qa-admin-email-e2e-51f0';
// Fake LemonSqueezy credentials for PHASE 2 — never real, only used to
// flip billingConfigured() on so the dormant/configured paths both get gated.
const LS_SECRET = 'qa-ls-webhook-secret-8d2c44aa';
const LS_KEY = 'qa-ls-api-key-00000000000000000000000000000000';
const LS_VARIANT = '654321';
const LS_STORE = '451253';

const log = (s) => { process.stdout.write('[email-auth] ' + s + '\n'); };
const delay = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, val, detail) => {
  results.push({ name, val });
  log((val ? 'PASS' : 'FAIL') + '  ' + name + (val ? '' : '   <-- ' + JSON.stringify(detail).slice(0, 500)));
};

// ---- PHASE 3: local Resend stub -------------------------------------------------
// The Worker's sendAuthEmail posts to RESEND_API_BASE (test-only env seam).
// Point it at this in-process stub so the email path is exercised END TO END
// (token minted -> email body built -> link extracted -> token consumed)
// without ever calling the real api.resend.com.
let stubPort = 0;
const stubEmails = []; // { to, subject, text, at }
function startEmailStub() {
  const srv = http.createServer(function (req, res) {
    if (req.method === 'POST' && req.url === '/emails') {
      let body = '';
      req.on('data', function (c) { body += c; });
      req.on('end', function () {
        try {
          const j = JSON.parse(body);
          // The Worker sends to: [addr] (Resend API shape) — normalize to a
          // string so mailsTo() can match it directly.
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
const mailsTo = (email, subject) => stubEmails.filter(function (m) { return m.to === email && (!subject || m.subject === subject); });
const tokenFromLink = (text, page) => {
  const m = String(text || '').match(new RegExp(page + '\\.html\\?token=([^\\s\\n]+)'));
  return m ? m[1] : null;
};

let proc = null;
let devLog = '';

// ---- wrangler scaffolding (same as qa-prefs-roundtrip.cjs) ---------------
function globalWranglerJs() {
  try {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const root = execFileSync(npmCmd, ['root', '-g'], { encoding: 'utf8', shell: process.platform === 'win32' }).trim();
    const p = path.join(root, 'wrangler', 'bin', 'wrangler.js');
    if (fs.existsSync(p)) return p;
  } catch (e) { /* fall through */ }
  return null;
}
const WRANGLER_JS = globalWranglerJs();
const PERSIST_DIR = path.join(TMP, 'mmgr-email-auth-wstate-' + Date.now());

async function startWrangler(mode) {
  // mode: 'dormant' (phase 1 — no secrets) | 'configured' (phase 2 — LS) | 'email' (phase 3 — LS + Resend stub)
  const configured = mode === 'configured' || mode === 'email';
  stopWrangler();
  await delay(800); // let the previous process release the port
  log('starting wrangler dev on :' + PORT + ' (' + mode + ' phase)…');
  try {
    fs.rmSync(STOP_FILE, { force: true });
    fs.rmSync(STATE_FILE, { force: true });
  } catch (e) { /* ignore */ }
  if (!configured) {
    try {
      execFileSync(process.execPath,
        [WRANGLER_JS, 'd1', 'migrations', 'apply', 'my-manager-db', '--local', '--persist-to', PERSIST_DIR],
        { cwd: ROOT, stdio: 'ignore', timeout: 90000 });
    } catch (e) { log('migrations apply (best-effort): ' + e.message); }
  }
  const args = [
    WRANGLER_JS, 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', PERSIST_DIR,
    '--var', 'GOOGLE_CLIENT_SECRET:' + SECRET,
    '--var', 'ADMIN_CODE:' + ADMIN_CODE
  ];
  if (configured) {
    args.push(
      '--var', 'LEMONSQUEEZY_WEBHOOK_SECRET:' + LS_SECRET,
      '--var', 'LEMONSQUEEZY_API_KEY:' + LS_KEY,
      '--var', 'LEMONSQUEEZY_VARIANT_ID:' + LS_VARIANT,
      '--var', 'LEMONSQUEEZY_STORE_ID:' + LS_STORE,
      '--var', 'FREE_PROJECT_CAP:2'
    );
  }
  // The repo root may carry a .dev.vars with the REAL RESEND_API_KEY (local
  // testing) — wrangler dev reads it automatically and would otherwise leak
  // the key into EVERY phase here: register would mint verification emails
  // and the verified-email cloud gate would 403 the accounts these phases
  // never verify. CLI --var beats .dev.vars, so non-email phases explicitly
  // NULL the key (empty value = falsy = authEmailConfigured() false), and the
  // email phase overrides it with the stub-scoped fake.
  if (mode === 'email') {
    args.push(
      '--var', 'RESEND_API_KEY:qa-fake-resend-key-00000000000000000000000000000000',
      '--var', 'RESEND_FROM_EMAIL:onboarding@resend.dev',
      '--var', 'RESEND_API_BASE:http://127.0.0.1:' + stubPort
    );
  } else {
    args.push(
      '--var', 'RESEND_API_KEY:',
      '--var', 'RESEND_FROM_EMAIL:'
    );
  }
  proc = spawn(process.execPath, args, {
    cwd: ROOT,
    env: Object.assign({}, process.env, { WRANGLER_SEND_METRICS: 'false' }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  proc.stdout.on('data', d => { devLog += d; });
  proc.stderr.on('data', d => { devLog += d; });
  proc.on('error', (e) => { throw new Error('wrangler spawn failed: ' + e.message); });
  const t0 = Date.now();
  for (;;) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(function() { ctrl.abort(); }, 3000);
      const r = await fetch(BASE + '/api/health', { signal: ctrl.signal });
      clearTimeout(timer);
      if (r.ok) return;
    } catch (e) { /* not up yet */ }
    if (Date.now() - t0 > 120000) throw new Error('wrangler dev did not come up in 120s');
    await delay(1500);
  }
}
function stopWrangler() {
  try { fs.rmSync(STOP_FILE, { force: true }); } catch (e) { /* ignore */ }
  try { proc && proc.kill(); } catch (e) { /* ignore */ }
}

async function api(pathname, opts) {
  const res = await fetch(BASE + pathname, Object.assign({}, opts || {}));
  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  return { status: res.status, body, text: res.status + '|' + JSON.stringify(body), headers: res.headers };
}
const jsonHeaders = { 'Content-Type': 'application/json' };
const cookieHeader = (cookie) => ({ 'Cookie': 'mmgr_session=' + cookie, 'Content-Type': 'application/json' });

function extractSessionCookie(res) {
  const sc = res.headers.get('Set-Cookie') || '';
  const m = sc.match(/mmgr_session=([^;]+)/);
  return m ? m[1] : null;
}

// HMAC-SHA256 hex over the RAW body — mirrors billingVerifySignature.
function lsSignature(rawBody, secret) {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

// ---- gate definitions -----------------------------------------------------
const ALICE = 'alice.auth.e2e@example.com';
const BOB = 'bob.auth.e2e@example.com';
const CAROL = 'carol.auth.e2e@example.com';
const PID_ALICE = 'ea-alice-' + Date.now().toString(36);
let aliceCookie = null;
let carolCookie = null;

async function phase1() {
  log('--- PHASE 1 (dormant — no LemonSqueezy secrets) ---');
  // A1 / A2 — validation before any DB write.
  const a1 = await api('/api/auth/register', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email: 'nope', password: 'password123' }) });
  check('A1 register invalid email -> 400', a1.status === 400 && a1.body && a1.body.ok === false, a1.text);
  const a2 = await api('/api/auth/register', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email: ALICE, password: 'short' }) });
  check('A2 register password < 8 chars -> 400', a2.status === 400 && a2.body && a2.body.ok === false, a2.text);

  // A3 — happy-path register: real cookie, correct namespace, no secret leakage.
  const a3 = await api('/api/auth/register', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email: ALICE, password: 's3cure-pass!', name: 'Alice Test' }) });
  const a3cookie = extractSessionCookie(a3);
  check('A3 register valid -> 200 + session cookie + sub email: namespace (emailSent:false when dormant)',
    a3.status === 200 && a3.body.ok === true && a3.body.user.sub === 'email:' + ALICE && a3.body.user.name === 'Alice Test' && !!a3cookie && !('password_hash' in a3.body) && !('password' in a3.body) && a3.body.emailSent === false, a3.text);
  const a4 = await api('/api/auth/register', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email: ALICE, password: 'another-pass-1' }) });
  check('A4 duplicate register -> 409', a4.status === 409, a4.text);

  // A5 / A6 — the timing-guard pair: unknown email and wrong password are the SAME body.
  const a5 = await api('/api/auth/login', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email: 'nobody@example.com', password: 'wrong-pass-1' }) });
  const a6 = await api('/api/auth/login', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email: ALICE, password: 'wrong-pass-1' }) });
  check('A5 login unknown email -> 401 generic', a5.status === 401 && a5.body && a5.body.error === 'invalid email or password', a5.text);
  check('A6 login wrong password -> 401 same generic body', a6.status === 401 && a6.body && a6.body.error === 'invalid email or password' && a6.body.error === a5.body.error, a6.text);

  // A7 — correct login issues the SAME cookie shape as register.
  const a7 = await api('/api/auth/login', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email: ALICE, password: 's3cure-pass!' }) });
  aliceCookie = extractSessionCookie(a7);
  check('A7 login correct -> 200 + cookie + name echoed', a7.status === 200 && a7.body.ok === true && a7.body.user.name === 'Alice Test' && !!aliceCookie, a7.text);

  const a8 = await api('/api/auth/me', { method: 'GET', headers: cookieHeader(aliceCookie) });
  check('A8 /api/auth/me with cookie -> ok, email: sub', a8.status === 200 && a8.body.ok === true && a8.body.user.sub === 'email:' + ALICE && a8.body.user.email === ALICE, a8.text);

  // A9 — normalization: register with spaces + mixed case, log in with different case.
  const a9r = await api('/api/auth/register', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email: '  MiXeD.CaSe@Example.COM  ', password: 'mixed-pass-1', name: 'Mixed' }) });
  const a9l = await api('/api/auth/login', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email: 'mixed.case@example.com', password: 'mixed-pass-1' }) });
  check('A9 register normalizes (trim+lower), login case-insensitive',
    a9r.status === 200 && a9r.body.user.sub === 'email:mixed.case@example.com' && a9l.status === 200, a9r.text + ' | ' + a9l.text);

  const a10 = await api('/api/auth/me', { method: 'GET', headers: jsonHeaders });
  check('A10 /me with no cookie -> {ok:false,user:null}', a10.status === 200 && a10.body.ok === false && a10.body.user === null, a10.text);

  const a11 = await api('/api/cloud/projects', { method: 'GET', headers: jsonHeaders });
  check('A11 cloud endpoint no cookie -> 403 generic (no distinction leak)',
    a11.status === 403 && a11.body && a11.body.ok === false && a11.body.error === 'invalid project or owner code', a11.text);

  // A12 — the email session is a first-class owner identity for cloud.
  const a12 = await api('/api/cloud/projects', { method: 'POST', headers: cookieHeader(aliceCookie), body: JSON.stringify({ projectId: PID_ALICE, name: 'Alice Cloud' }) });
  check('A12 email session creates cloud project -> linked:true', a12.status === 200 && a12.body.ok === true && a12.body.linked === true && a12.body.ownerCode, a12.text);
  const a12b = await api('/api/cloud/projects/' + PID_ALICE + '/load', { method: 'POST', headers: cookieHeader(aliceCookie), body: JSON.stringify({}) });
  check('A12b email session loads its own project -> 200 (sub-match accepts email:)', a12b.status === 200 && a12b.body.ok === true, a12b.text);

  // A13 — account isolation across email accounts.
  const a13r = await api('/api/auth/register', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email: BOB, password: 'bob-pass-123' }) });
  const bobCookie = extractSessionCookie(a13r);
  const a13list = await api('/api/cloud/projects', { method: 'GET', headers: cookieHeader(bobCookie) });
  const a13load = await api('/api/cloud/projects/' + PID_ALICE + '/load', { method: 'POST', headers: cookieHeader(bobCookie), body: JSON.stringify({}) });
  check('A13 account isolation: bob cannot see or load alice\'s project',
    a13r.status === 200 && a13list.status === 200 && !(a13list.body && a13list.body.projects || []).some(function(p) { return p.projectId === PID_ALICE; }) && a13load.status === 403, a13list.text + ' | ' + a13load.text);

  // A14 — billing DORMANT: exact current-production behavior.
  const a14s = await api('/api/billing/status', { method: 'GET', headers: cookieHeader(aliceCookie) });
  const a14c = await api('/api/billing/checkout', { method: 'POST', headers: cookieHeader(aliceCookie), body: JSON.stringify({}) });
  check('A14 billing dormant: status configured:false, checkout 503',
    a14s.status === 200 && a14s.body.configured === false && a14s.body.plan === 'free' && a14c.status === 503, a14s.text + ' | ' + a14c.text);

  // A16 — name sanitization.
  const a16 = await api('/api/auth/register', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email: 'longname@example.com', password: 'longname-pass1', name: 'X'.repeat(100) }) });
  check('A16 register name > 80 chars sliced to 80', a16.status === 200 && a16.body.user.name.length === 80, a16.text);

  // A18 — the email session drives the R2 prefs store (same 'email:' sub key).
  // Runs BEFORE A17: logout (A17) now revokes the session server-side, so a
  // cookie used after it is dead by design (auth mainframe).
  const a18p = await api('/api/cloud/prefs/theme', { method: 'PUT', headers: cookieHeader(aliceCookie), body: JSON.stringify({ palette: 'cyan' }) });
  const a18g = await api('/api/cloud/prefs/theme', { method: 'GET', headers: cookieHeader(aliceCookie) });
  check('A18 email session on prefs R2: PUT cyan -> GET cyan', a18p.status === 200 && a18g.status === 200 && a18g.body.theme.palette === 'cyan', a18g.text);

  // A17 — logout clears the session (server-side revocation).
  const a17o = await api('/api/auth/logout', { method: 'POST', headers: { 'Cookie': 'mmgr_session=' + aliceCookie } });
  const a17m = await api('/api/auth/me', { method: 'GET', headers: jsonHeaders });
  check('A17 logout -> 200 and /me afterwards -> null', a17o.status === 200 && a17m.body.ok === false && a17m.body.user === null, a17o.text + ' | ' + a17m.text);

  // A15 — rate burst LAST in this phase. Probes a NEVER-REGISTERED email so
  // the per-account lockout guard (auth_login_guard, 5 fails -> lock) never
  // engages — what is under test here is the RATE LIMITER (authLogin bucket,
  // 30/min), and an unknown email keeps the generic-401 path (no guard row).
  let saw429 = 0, saw401 = 0, retryAfter = null;
  for (let i = 0; i < 40; i++) {
    const r = await api('/api/auth/login', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email: 'rate-limit-probe@example.com', password: 'brute-' + i }) });
    if (r.status === 429) { saw429++; retryAfter = r.headers.get('Retry-After'); }
    else if (r.status === 401) saw401++;
  }
  check('A15 rate burst: ≥1 401 (real attempts pass) AND ≥1 429 with Retry-After (blocked)',
    saw401 >= 1 && saw429 >= 1 && !!retryAfter, JSON.stringify({ saw401: saw401, saw429: saw429, retryAfter: retryAfter }));
}

async function phase2() {
  log('--- PHASE 2 (configured — fake LemonSqueezy secrets + FREE_PROJECT_CAP=2) ---');
  // AUTH MAINFRAME: phase 1's A17 logout revoked alice's session server-side,
  // so phase 2 re-signs in for a fresh cookie before touching billing.
  const relog = await api('/api/auth/login', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email: ALICE, password: 's3cure-pass!' }) });
  aliceCookie = extractSessionCookie(relog);
  // B1 — configured status surfaces the cap.
  const b1 = await api('/api/billing/status', { method: 'GET', headers: cookieHeader(aliceCookie) });
  check('B1 status configured:true, plan free, projectCap 2',
    b1.status === 200 && b1.body.configured === true && b1.body.plan === 'free' && b1.body.active === false && b1.body.projectCap === 2 && b1.body.projectCount >= 1, b1.text);

  // B2 — the free cap: 2 linked projects ok, the 3rd gets 402 + upgrade flag.
  const b2r = await api('/api/auth/register', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email: CAROL, password: 'carol-pass-1', name: 'Carol Cap' }) });
  carolCookie = extractSessionCookie(b2r);
  check('B2 register carol -> 200', b2r.status === 200 && !!carolCookie, b2r.text);
  const capIds = ['ea-cap-1-' + Date.now().toString(36), 'ea-cap-2-' + Date.now().toString(36), 'ea-cap-3-' + Date.now().toString(36)];
  const c1 = await api('/api/cloud/projects', { method: 'POST', headers: cookieHeader(carolCookie), body: JSON.stringify({ projectId: capIds[0], name: 'Cap 1' }) });
  const c2 = await api('/api/cloud/projects', { method: 'POST', headers: cookieHeader(carolCookie), body: JSON.stringify({ projectId: capIds[1], name: 'Cap 2' }) });
  const c3 = await api('/api/cloud/projects', { method: 'POST', headers: cookieHeader(carolCookie), body: JSON.stringify({ projectId: capIds[2], name: 'Cap 3' }) });
  check('B2 cap: 2 creates ok, 3rd -> 402 {ok:false, upgrade:true}',
    c1.status === 200 && c2.status === 200 && c3.status === 402 && c3.body.ok === false && c3.body.upgrade === true, JSON.stringify({ c1: c1.status, c2: c2.status, c3: c3.status, body: c3.body }));

  // B3 — signature-verified webhook is the ONLY writer of cloud_subscriptions.
  const webhookBody = JSON.stringify({
    meta: { event_name: 'subscription_created', custom_data: { sub: 'email:' + CAROL } },
    data: { id: 'ls_sub_123456', attributes: { status: 'active', renews_at: new Date(Date.now() + 30 * 86400000).toISOString() } }
  });
  const b3 = await api('/api/billing/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature': lsSignature(webhookBody, LS_SECRET) }, body: webhookBody });
  check('B3 webhook subscription_created (valid HMAC) -> 200, status active', b3.status === 200 && b3.body.event === 'subscription_created' && b3.body.status === 'active', b3.text);

  // B4 — the subscription flipped the account active.
  const b4 = await api('/api/billing/status', { method: 'GET', headers: cookieHeader(carolCookie) });
  check('B4 status after webhook: active:true, plan pro', b4.status === 200 && b4.body.active === true && b4.body.plan === 'pro', b4.text);

  // B5 — an active subscription clears the cap.
  const b5 = await api('/api/cloud/projects', { method: 'POST', headers: cookieHeader(carolCookie), body: JSON.stringify({ projectId: capIds[2], name: 'Cap 3 retry' }) });
  check('B5 create over cap with active sub -> 200', b5.status === 200 && b5.body.ok === true, b5.text);

  // B6 — bad signature 401; non-lifecycle event 200 ignored (no row).
  const bad = await api('/api/billing/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature': 'deadbeef' }, body: webhookBody });
  const testReq = JSON.stringify({ meta: { event_name: 'test_request', custom_data: {} }, data: {} });
  const tr = await api('/api/billing/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature': lsSignature(testReq, LS_SECRET) }, body: testReq });
  check('B6 webhook: bad signature -> 401; test_request -> 200 ignored', bad.status === 401 && tr.status === 200 && tr.body.ignored === 'test_request', bad.text + ' | ' + tr.text);
}

// ---- PHASE 3 (email configured — Resend stub) ----------------------------------
// AUTH MAINFRAME v2: verification on signup, verified-email cloud gate,
// forgot/reset with no existence leak + per-email quota, reset revokes ALL
// sessions, and subscription confirmation/cancellation emails. The stub
// intercepts sendAuthEmail so no real Resend call ever happens.
const DAVE = 'dave.email.e2e@example.com';
const FRANK = 'frank.email.e2e@example.com';
const PID_DAVE = 'ea-dave-' + Date.now().toString(36);

async function phase3() {
  log('--- PHASE 3 (email configured — Resend stub on :' + stubPort + ') ---');

  // E1 — register mints a verify token and emails it (emailSent:true).
  const e1 = await api('/api/auth/register', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email: DAVE, password: 'dave-pass-123', name: 'Dave Email' }) });
  const daveCookie = extractSessionCookie(e1);
  const verifyMails = mailsTo(DAVE, 'Confirm your My MaNaGeR account');
  check('E1 register -> 200 + emailSent:true + one verification email captured by the stub',
    e1.status === 200 && e1.body.ok === true && e1.body.emailSent === true && !!daveCookie && verifyMails.length === 1, e1.text + ' | mails=' + verifyMails.length);
  const verifyToken = tokenFromLink(verifyMails[0] && verifyMails[0].text, 'verify');

  // E1b — the verified-email gate blocks cloud ownership BEFORE verification.
  const e1b = await api('/api/cloud/projects', { method: 'POST', headers: cookieHeader(daveCookie), body: JSON.stringify({ projectId: PID_DAVE, name: 'Dave Cloud' }) });
  check('E1b unverified email session cannot create a cloud project -> 403 verifyRequired',
    e1b.status === 403 && e1b.body.ok === false && e1b.body.verifyRequired === true, e1b.text);

  // E2 — consume the verify token; the account is now verified and can own.
  const e2 = await api('/api/auth/verify', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ token: verifyToken }) });
  check('E2 verify token -> 200 ok', e2.status === 200 && e2.body.ok === true && e2.body.email === DAVE, e2.text);
  const e2b = await api('/api/cloud/projects', { method: 'POST', headers: cookieHeader(daveCookie), body: JSON.stringify({ projectId: PID_DAVE, name: 'Dave Cloud' }) });
  check('E2b verified email session creates cloud project -> 200 linked', e2b.status === 200 && e2b.body.ok === true && e2b.body.linked === true, e2b.text);

  // E3 — single-use: replaying the same verify token is rejected.
  const e3 = await api('/api/auth/verify', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ token: verifyToken }) });
  check('E3 verify token replay -> 400', e3.status === 400 && e3.body.ok === false, e3.text);

  // E4 — garbage tokens are rejected, never crash.
  const e4 = await api('/api/auth/verify', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ token: 'garbage.token.value' }) });
  check('E4 verify with a garbage token -> 400', e4.status === 400 && e4.body.ok === false, e4.text);

  // E5 — duplicate register still 409 in the email phase.
  const e5 = await api('/api/auth/register', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email: DAVE, password: 'other-pass-1' }) });
  check('E5 duplicate register -> 409', e5.status === 409, e5.text);

  // E6 — forgot for an EXISTING account mints a reset token + email.
  const e6 = await api('/api/auth/forgot', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email: DAVE }) });
  const genericMsg = e6.body && e6.body.message;
  const resetMailsAfterForgot = mailsTo(DAVE, 'Reset your My MaNaGeR password');
  check('E6 forgot (existing) -> 200 generic + one reset email captured',
    e6.status === 200 && e6.body.ok === true && !!genericMsg && resetMailsAfterForgot.length === 1, e6.text + ' | resetMails=' + resetMailsAfterForgot.length);

  // E7 — forgot for an UNKNOWN email: same generic response, no email, no leak.
  const e7 = await api('/api/auth/forgot', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email: 'nobody.ever@example.com' }) });
  const e7mails = mailsTo('nobody.ever@example.com');
  check('E7 forgot (unknown) -> 200 IDENTICAL message + no email captured',
    e7.status === 200 && e7.body.ok === true && e7.body.message === genericMsg && e7mails.length === 0, e7.text + ' | mails=' + e7mails.length);

  // E8 — reset swaps the hash, revokes EVERY session (old cookie dies).
  const resetToken = tokenFromLink(resetMailsAfterForgot[0] && resetMailsAfterForgot[0].text, 'reset');
  const e8 = await api('/api/auth/reset', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ token: resetToken, newPassword: 'dave-new-pass-9' }) });
  const oldPw = await api('/api/auth/login', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email: DAVE, password: 'dave-pass-123' }) });
  const newPw = await api('/api/auth/login', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email: DAVE, password: 'dave-new-pass-9' }) });
  const oldSessionDead = await api('/api/auth/me', { method: 'GET', headers: cookieHeader(daveCookie) });
  check('E8 reset -> 200; old password 401; new password 200; pre-reset session dead',
    e8.status === 200 && oldPw.status === 401 && newPw.status === 200 && oldSessionDead.body.ok === false && oldSessionDead.body.user === null,
    JSON.stringify({ e8: e8.status, oldPw: oldPw.status, newPw: newPw.status, me: oldSessionDead.text }));

  // E9 — reset token is single-use: replay rejected.
  const e9 = await api('/api/auth/reset', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ token: resetToken, newPassword: 'another-pass-1' }) });
  check('E9 reset token replay -> 400', e9.status === 400 && e9.body.ok === false, e9.text);

  // E10 — subscription confirmation + cancellation emails (PART 4).
  const subCreated = JSON.stringify({
    meta: { event_name: 'subscription_created', custom_data: { sub: 'email:' + DAVE } },
    data: { id: 'ls_sub_dave', attributes: { status: 'active', renews_at: new Date(Date.now() + 30 * 86400000).toISOString(), user_email: 'customer@buyer.example' } }
  });
  const s1 = await api('/api/billing/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature': lsSignature(subCreated, LS_SECRET) }, body: subCreated });
  const confirmMails = mailsTo('customer@buyer.example', 'Your My MaNaGeR subscription is confirmed');
  check('E10a webhook subscription_created -> confirmation email to the LS customer email',
    s1.status === 200 && confirmMails.length === 1, s1.text + ' | mails=' + confirmMails.length);
  const subCancelled = JSON.stringify({
    meta: { event_name: 'subscription_cancelled', custom_data: { sub: 'email:' + DAVE } },
    data: { id: 'ls_sub_dave', attributes: { status: 'cancelled', ends_at: new Date(Date.now() + 7 * 86400000).toISOString() } }
  });
  const s2 = await api('/api/billing/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature': lsSignature(subCancelled, LS_SECRET) }, body: subCancelled });
  const cancelMails = mailsTo(DAVE, 'Your My MaNaGeR subscription was cancelled');
  check('E10b webhook subscription_cancelled -> cancellation email (no user_email, falls back to the account email)',
    s2.status === 200 && cancelMails.length === 1, s2.text + ' | mails=' + cancelMails.length);

  // E11 — per-email reset quota: 5/hour. E6 used 1; the next 4 mint (total 5),
  // the 6th answers the same generic message WITHOUT minting or emailing.
  for (let i = 0; i < 5; i++) {
    await api('/api/auth/forgot', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email: DAVE }) });
  }
  const quotaMsg = (await api('/api/auth/forgot', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email: DAVE }) })).body;
  const resetMailsFinal = mailsTo(DAVE, 'Reset your My MaNaGeR password');
  check('E11 forgot quota: 5 reset emails max per hour, 6th still answers the same generic message',
    quotaMsg.ok === true && quotaMsg.message === genericMsg && resetMailsFinal.length === 5,
    JSON.stringify({ resetMails: resetMailsFinal.length, msg: quotaMsg }));

  // E12/E13 — resend-verify (the fresh-link recovery path behind verify.html's
  // error state): an UNVERIFIED account gets a second verification email, an
  // already-verified account gets NOTHING, and both answers are the SAME
  // generic message — the endpoint can never probe account existence/status.
  const e12r = await api('/api/auth/register', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email: FRANK, password: 'frank-pass-1', name: 'Frank Email' }) });
  const frankMailsAfterRegister = mailsTo(FRANK, 'Confirm your My MaNaGeR account');
  const e12 = await api('/api/auth/resend-verify', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email: FRANK }) });
  const frankMailsAfterResend = mailsTo(FRANK, 'Confirm your My MaNaGeR account');
  check('E12 resend-verify (unverified) -> generic 200 + a SECOND verification email',
    e12r.status === 200 && e12.status === 200 && e12.body.ok === true && !!e12.body.message && frankMailsAfterRegister.length === 1 && frankMailsAfterResend.length === 2,
    e12.text + ' | mails=' + frankMailsAfterResend.length);
  const e13 = await api('/api/auth/resend-verify', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email: DAVE }) });
  const daveVerifyMails = mailsTo(DAVE, 'Confirm your My MaNaGeR account');
  check('E13 resend-verify (already verified) -> SAME generic message + NO new email',
    e13.status === 200 && e13.body.ok === true && e13.body.message === e12.body.message && daveVerifyMails.length === 1,
    e13.text + ' | mails=' + daveVerifyMails.length);
  const frankNewToken = tokenFromLink(frankMailsAfterResend[1] && frankMailsAfterResend[1].text, 'verify');
  const e12b = await api('/api/auth/verify', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ token: frankNewToken }) });
  check('E12b the fresh resend link verifies the account -> 200', e12b.status === 200 && e12b.body.ok === true, e12b.text);
}

(async () => {
  if (!WRANGLER_JS) { log('FATAL: global wrangler not found (npm root -g)'); process.exit(1); }
  try {
    await startWrangler('dormant');
    await phase1();
    await startWrangler('configured');
    await phase2();
    await startEmailStub();
    await startWrangler('email');
    await phase3();

    try {
      fs.writeFileSync(STATE_FILE, JSON.stringify({ port: PORT, secret: SECRET, alice: ALICE, aliceCookie: aliceCookie, carol: CAROL, adminCode: ADMIN_CODE }));
    } catch (e) { /* non-fatal */ }
    log('READY port=' + PORT + ' — browser phase: http://127.0.0.1:' + PORT + '/app.html (register/login via the email form)');
    // MMGR_QA_NO_BROWSER=1 skips the interactive browser-phase wait (CI /
    // automated runs) — the API gates above are the actual test.
    if (!process.env.MMGR_QA_NO_BROWSER) {
      log('waiting for browser phase (stop file: ' + STOP_FILE + ')…');
      const t0 = Date.now();
      while (Date.now() - t0 < 1200000) {
        if (fs.existsSync(STOP_FILE)) break;
        await delay(1000);
      }
    }
  } catch (e) {
    log('FATAL harness exception: ' + ((e && e.stack) || e));
  }

  const fails = results.filter(function(r) { return !r.val; });
  log('----------------------------------------');
  log('RESULT: ' + (results.length - fails.length) + '/' + results.length + ' gates passed' + (fails.length ? ' — FAILED: ' + fails.map(function(f) { return f.name; }).join(', ') : ''));
  log('STOPPED — wrangler dev torn down.');
  stopWrangler();
  process.exit(fails.length ? 1 : 0);
})().catch(function(e) { log('FATAL: ' + ((e && e.stack) || e)); stopWrangler(); process.exit(1); });
