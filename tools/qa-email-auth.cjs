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
         logins                             Retry-After AND at least
                                            one 401 (limiter lets
                                            real attempts through,
                                            then blocks)

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

const log = (s) => { process.stdout.write('[email-auth] ' + s + '\n'); };
const delay = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, val, detail) => {
  results.push({ name, val });
  log((val ? 'PASS' : 'FAIL') + '  ' + name + (val ? '' : '   <-- ' + JSON.stringify(detail).slice(0, 500)));
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

async function startWrangler(configured) {
  stopWrangler();
  await delay(800); // let the previous process release the port
  log('starting wrangler dev on :' + PORT + ' (' + (configured ? 'CONFIGURED' : 'dormant') + ' phase)…');
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
      '--var', 'FREE_PROJECT_CAP:2'
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
  check('A3 register valid -> 200 + session cookie + sub email: namespace',
    a3.status === 200 && a3.body.ok === true && a3.body.user.sub === 'email:' + ALICE && a3.body.user.name === 'Alice Test' && !!a3cookie && !('password_hash' in a3.body) && !('password' in a3.body), a3.text);
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

  // A17 — logout clears the session.
  const a17o = await api('/api/auth/logout', { method: 'POST', headers: { 'Cookie': 'mmgr_session=' + aliceCookie } });
  const a17m = await api('/api/auth/me', { method: 'GET', headers: jsonHeaders });
  check('A17 logout -> 200 and /me afterwards -> null', a17o.status === 200 && a17m.body.ok === false && a17m.body.user === null, a17o.text + ' | ' + a17m.text);

  // A18 — the email session drives the R2 prefs store (same 'email:' sub key).
  const a18p = await api('/api/cloud/prefs/theme', { method: 'PUT', headers: cookieHeader(aliceCookie), body: JSON.stringify({ palette: 'cyan' }) });
  const a18g = await api('/api/cloud/prefs/theme', { method: 'GET', headers: cookieHeader(aliceCookie) });
  check('A18 email session on prefs R2: PUT cyan -> GET cyan', a18p.status === 200 && a18g.status === 200 && a18g.body.theme.palette === 'cyan', a18g.text);

  // A15 — rate burst LAST in this phase (shared anon bucket, 30/min).
  let saw429 = 0, saw401 = 0, retryAfter = null;
  for (let i = 0; i < 40; i++) {
    const r = await api('/api/auth/login', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email: ALICE, password: 'brute-' + i }) });
    if (r.status === 429) { saw429++; retryAfter = r.headers.get('Retry-After'); }
    else if (r.status === 401) saw401++;
  }
  check('A15 rate burst: ≥1 401 (real attempts pass) AND ≥1 429 with Retry-After (blocked)',
    saw401 >= 1 && saw429 >= 1 && !!retryAfter, JSON.stringify({ saw401: saw401, saw429: saw429, retryAfter: retryAfter }));
}

async function phase2() {
  log('--- PHASE 2 (configured — fake LemonSqueezy secrets + FREE_PROJECT_CAP=2) ---');
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

(async () => {
  if (!WRANGLER_JS) { log('FATAL: global wrangler not found (npm root -g)'); process.exit(1); }
  try {
    await startWrangler(false);
    await phase1();
    await startWrangler(true);
    await phase2();

    try {
      fs.writeFileSync(STATE_FILE, JSON.stringify({ port: PORT, secret: SECRET, alice: ALICE, aliceCookie: aliceCookie, carol: CAROL, adminCode: ADMIN_CODE }));
    } catch (e) { /* non-fatal */ }
    log('READY port=' + PORT + ' — browser phase: http://127.0.0.1:' + PORT + '/app.html (register/login via the email form)');
    log('waiting for browser phase (stop file: ' + STOP_FILE + ')…');
    const t0 = Date.now();
    while (Date.now() - t0 < 1200000) {
      if (fs.existsSync(STOP_FILE)) break;
      await delay(1000);
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
