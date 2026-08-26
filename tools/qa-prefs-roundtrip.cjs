/* ============================================================
   qa-prefs-roundtrip.cjs — /api/cloud/prefs/theme ROUND-TRIP
   ------------------------------------------------------------
   Exercises the account theme-preference pipeline
   (THEME-SYSTEM-AND-MOBILE-UI-ACTION-PLAN §2.3) end to end with
   CRYPTOGRAPHICALLY VALID Google sessions.

   A real Google login is a POST /api/auth/google { idToken } that
   the Worker verifies and answers with Set-Cookie mmgr_session
   (HttpOnly HMAC-SHA256-signed, keyed by env.GOOGLE_CLIENT_SECRET).
   We cannot click through Google's consent screen here, so this
   harness mints session cookies that are BYTE-IDENTICAL to what a
   real login produces: base64url(JSON{sub,email,name,picture,exp})
   + '.' + base64url(HMAC-SHA256(payload, secret)), signed with a
   known secret passed to `wrangler dev --var GOOGLE_CLIENT_SECRET`
   (same mechanism a real deployment gets via the Wrangler secret).

   API phase (committed gates, run BEFORE the browser):
     P1  PUT with no cookie            -> 403 generic forbidden
     P2  GET with no cookie            -> 403
     P3  GET with an EXPIRED cookie    -> 403
     P4  GET with a TAMPERED signature -> 403
     P5  PUT {palette:'cyan'} (acct A) -> ok, theme cyan/light
     P6  GET (acct A)                  -> cyan + dark false + updatedAt
     P7  PUT {palette:'hotpink'}       -> 400 (palette whitelist)
     P8  PUT {dark:true} (acct A)      -> merge: palette stays cyan,
                                         dark true  (sequential writes land)
     P9  GET (acct A)                  -> cyan + dark true
     P10 GET (acct B, fresh)           -> defaults (account isolation)
     P11 PUT oversized body (>2048)    -> 413 (payload cap)
     P12 PUT {palette:'cyan'} again    -> idempotent re-save ok

   Then writes { port, secret, cookieA, cookieB, subs } to
   %TMPDIR%/mmgr-prefs-e2e-state.json, prints a READY banner, and
   STAYS ALIVE so a browser (CDP) can be driven against the origin
   for the two-device phase:
     - Device A: fresh profile, real cookie -> click Cyan ->
       verify the PUT reached R2 (GET) + survives reload.
     - Device B: fresh profile, same account cookie, STALE local
       palette 'default' + the mmgr_palette_backend flag -> load ->
       the one-per-load backend pull OVERRIDES the stale local
       value to cyan (the cross-device sync proof).

   Stop it by creating the stop file (touch mmgr-prefs-e2e-stop in
   the tmpdir) — it exits and takes the wrangler child down.

   Usage:  node tools/qa-prefs-roundtrip.cjs
   Exit:   0 after a clean stop; 1 on any API-phase gate failure.
   ============================================================ */
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = 8795;
const BASE = 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');
const TMP = os.tmpdir();
const STATE_FILE = path.join(TMP, 'mmgr-prefs-e2e-state.json');
const STOP_FILE = path.join(TMP, 'mmgr-prefs-e2e-stop');

// The known secret passed to wrangler dev. A REAL deployment reads the same
// env var from the Wrangler secret store — the signing path is identical.
const SECRET = 'qa-prefs-e2e-secret-9f2c1a7e';
const ADMIN_CODE = 'qa-admin-e2e-code-77bb';

const SUB_A = '108123456789012345678'; // account A (owner-style sub)
const SUB_B = '208765432109876543210'; // account B (different account)
const EMAIL_A = 'alice.prefs.e2e@example.com';
const EMAIL_B = 'bob.prefs.e2e@example.com';

const log = (s) => { process.stdout.write('[prefs-e2e] ' + s + '\n'); };
const delay = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, val, detail) => { results.push({ name, val }); log((val ? 'PASS' : 'FAIL') + '  ' + name + (val ? '' : '   <-- ' + JSON.stringify(detail).slice(0, 500))); };

let proc = null;
let devLog = '';

// ---- session cookie minting (byte-identical to worker signSession) -------
function base64UrlEncode(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function signSession(payload, secret) {
  const jsonStr = JSON.stringify(payload);
  const key = await crypto.subtle.importKey('raw', Buffer.from(secret, 'utf8'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, Buffer.from(jsonStr, 'utf8')));
  return base64UrlEncode(jsonStr) + '.' + base64UrlEncode(sig);
}

// ---- wrangler scaffolding (same as qa-ai-badge-e2e.cjs) ------------------
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
const PERSIST_DIR = path.join(TMP, 'mmgr-prefs-e2e-wstate-' + Date.now());

async function startWrangler() {
  try {
    fs.rmSync(STOP_FILE, { force: true });
    fs.rmSync(STATE_FILE, { force: true });
  } catch (e) {}
  log('starting wrangler dev on :' + PORT + ' (local D1 + R2, GOOGLE_CLIENT_SECRET var set)…');
  try {
    execFileSync(process.execPath,
      [WRANGLER_JS, 'd1', 'migrations', 'apply', 'my-manager-db', '--local', '--config', 'wrangler.ci.jsonc', '--persist-to', PERSIST_DIR],
      { cwd: ROOT, stdio: 'ignore', timeout: 90000 });
  } catch (e) { log('migrations apply (best-effort): ' + e.message); }
  proc = spawn(process.execPath, [
    WRANGLER_JS, 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', PERSIST_DIR,
    '--var', 'GOOGLE_CLIENT_SECRET:' + SECRET,
    '--var', 'ADMIN_CODE:' + ADMIN_CODE
  ], {
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
  try { fs.rmSync(STOP_FILE, { force: true }); } catch (e) {}
  try { proc && proc.kill(); } catch (e) {}
}

async function api(pathname, opts) {
  const res = await fetch(BASE + pathname, Object.assign({}, opts || {}));
  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  return { status: res.status, body, text: res.status + '|' + JSON.stringify(body) };
}

const PREFS = '/api/cloud/prefs/theme';
const authHeaders = (cookie) => cookie ? { 'Cookie': 'mmgr_session=' + cookie, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };

(async () => {
  if (!WRANGLER_JS) { log('FATAL: global wrangler not found (npm root -g)'); process.exit(1); }
  try { await startWrangler(); }
  catch (e) { log('FATAL: ' + e.message); log(devLog.slice(-1500)); process.exit(1); }

  try {
    const now = Math.floor(Date.now() / 1000);
    const cookieA = await signSession({ sub: SUB_A, email: EMAIL_A, name: 'Alice', picture: '', exp: now + 604800 }, SECRET);
    const cookieB = await signSession({ sub: SUB_B, email: EMAIL_B, name: 'Bob', picture: '', exp: now + 604800 }, SECRET);
    const cookieExpired = await signSession({ sub: SUB_A, email: EMAIL_A, name: 'Alice', picture: '', exp: now - 3600 }, SECRET);
    // Tampered cookie: same payload string, signature flipped at the last byte.
    const cookieTampered = cookieA.slice(0, -1) + (cookieA.slice(-1) === 'A' ? 'B' : 'A');

    // ---- auth guards: every failure is the SAME generic 403 ----------------
    const p1 = await api(PREFS, { method: 'PUT', headers: authHeaders(null), body: JSON.stringify({ palette: 'cyan' }) });
    check('P1 PUT with no cookie -> 403 generic', p1.status === 403 && p1.body && p1.body.ok === false, p1.text);
    const p2 = await api(PREFS, { method: 'GET', headers: authHeaders(null) });
    check('P2 GET with no cookie -> 403 generic', p2.status === 403 && p2.body && p2.body.ok === false, p2.text);
    const p3 = await api(PREFS, { method: 'GET', headers: authHeaders(cookieExpired) });
    check('P3 GET with expired cookie -> 403 generic (same body, nothing distinguishes it)', p3.status === 403 && p3.body && p3.body.ok === false, p3.text);
    const p4 = await api(PREFS, { method: 'GET', headers: authHeaders(cookieTampered) });
    check('P4 GET with tampered signature -> 403 generic (HMAC rejected, same body)', p4.status === 403 && p4.body && p4.body.ok === false, p4.text);

    // ---- happy path + write semantics --------------------------------------
    const p5 = await api(PREFS, { method: 'PUT', headers: authHeaders(cookieA), body: JSON.stringify({ palette: 'cyan' }) });
    check('P5 PUT {palette:cyan} (acct A) -> ok, theme cyan/light', p5.status === 200 && p5.body && p5.body.ok === true && p5.body.theme.palette === 'cyan' && p5.body.theme.dark === false, p5.text);
    const p6 = await api(PREFS, { method: 'GET', headers: authHeaders(cookieA) });
    check('P6 GET (acct A) -> cyan persisted, dark false (GET contract: palette + dark only)', p6.status === 200 && p6.body.theme.palette === 'cyan' && p6.body.theme.dark === false && !('updatedAt' in p6.body), p6.body);
    const p7 = await api(PREFS, { method: 'PUT', headers: authHeaders(cookieA), body: JSON.stringify({ palette: 'hotpink' }) });
    check('P7 PUT {palette:hotpink} -> 400 (whitelist, nothing saved)', p7.status === 400, p7.text);
    const p8 = await api(PREFS, { method: 'PUT', headers: authHeaders(cookieA), body: JSON.stringify({ dark: true }) });
    check('P8 PUT {dark:true} (acct A) -> merge keeps cyan, dark true', p8.status === 200 && p8.body.theme.palette === 'cyan' && p8.body.theme.dark === true, p8.text);
    const p9 = await api(PREFS, { method: 'GET', headers: authHeaders(cookieA) });
    check('P9 GET (acct A) -> cyan + dark true (sequential writes landed)', p9.status === 200 && p9.body.theme.palette === 'cyan' && p9.body.theme.dark === true, p9.body);
    const p10 = await api(PREFS, { method: 'GET', headers: authHeaders(cookieB) });
    check('P10 GET (acct B) -> defaults (account isolation, no cross-account read)', p10.status === 200 && p10.body.theme.palette === 'default' && p10.body.theme.dark === false, p10.body);
    const bigBody = JSON.stringify({ palette: 'cyan', pad: 'x'.repeat(3000) });
    const p11 = await api(PREFS, { method: 'PUT', headers: authHeaders(cookieA), body: bigBody });
    check('P11 PUT oversized body (>2048) -> 413', p11.status === 413, p11.text);
    // Reset to the final cross-device state: cyan + light.
    const p11b = await api(PREFS, { method: 'PUT', headers: authHeaders(cookieA), body: JSON.stringify({ palette: 'cyan', dark: false }) });
    check('P11b reset acct A to cyan/light for the browser phase', p11b.status === 200 && p11b.body.theme.palette === 'cyan' && p11b.body.theme.dark === false, p11b.text);
    const p12 = await api(PREFS, { method: 'PUT', headers: authHeaders(cookieA), body: JSON.stringify({ palette: 'cyan' }) });
    check('P12 idempotent re-save ok', p12.status === 200 && p12.body.ok === true, p12.text);

    // ---- session linkage: the cookie powers project linking + admin surfacing ----
    const PID = 'prefs-e2e-' + Date.now().toString(36);
    const create = await api('/api/cloud/projects', {
      method: 'POST', headers: { 'Cookie': 'mmgr_session=' + cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: PID, name: 'Prefs E2E' })
    });
    check('P13 create project WITH session cookie -> linked:true (google_sub recorded)', create.status === 200 && create.body && create.body.ok === true && create.body.linked === true, create.text);
    const adminList = await api('/api/cloud/admin/projects', { method: 'GET', headers: { 'X-Admin-Code': ADMIN_CODE } });
    const row = adminList.body && adminList.body.projects && adminList.body.projects.find(function(p) { return p.projectId === PID; });
    check('P14 admin list surfaces the linked account\'s themePrefs (cyan, dark false, updatedAt ISO)',
      adminList.status === 200 && row && row.themePrefs && row.themePrefs.palette === 'cyan' && row.themePrefs.dark === false && typeof row.themePrefs.updatedAt === 'string' && !('googleSub' in row) && !('sub' in row),
      row);

    // ---- hand off to the browser phase ---------------------------------------
    try { fs.writeFileSync(STATE_FILE, JSON.stringify({ port: PORT, secret: SECRET, cookieA: cookieA, cookieB: cookieB, subA: SUB_A, subB: SUB_B, adminCode: ADMIN_CODE })); } catch (e) {}
    log('READY port=' + PORT + ' subA=' + SUB_A);
    log('browser device A: http://127.0.0.1:' + PORT + '/app.html  (cookieA, pick cyan)');
    log('browser device B: http://127.0.0.1:' + PORT + '/app.html  (same account, stale local default -> pull overrides to cyan)');
    log('waiting for browser phase (stop file: ' + STOP_FILE + ')…');

    const t0 = Date.now();
    while (Date.now() - t0 < 1200000) {
      if (fs.existsSync(STOP_FILE)) break;
      await delay(1000);
    }
  } catch (e) {
    log('FATAL harness exception: ' + (e && e.stack || e));
  }

  const fails = results.filter(r => !r.val);
  log('----------------------------------------');
  log('API PHASE RESULT: ' + (results.length - fails.length) + '/' + results.length + ' gates passed');
  log('STOPPED — wrangler dev torn down.');
  stopWrangler();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { log('FATAL: ' + (e && e.stack || e)); stopWrangler(); process.exit(1); });
