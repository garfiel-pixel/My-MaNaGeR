/* ============================================================
   GOOGLE-OPERATOR-IDENTITY-v1 — Worker route + CSP verification
   (dev tooling; never deployed)
   ------------------------------------------------------------
   Imports the production worker.js as ESM (Node treats .js as
   CJS, so this harness copies it to a temp .mjs), stubs the
   oauth2.googleapis.com/tokeninfo endpoint and env.ASSETS, and
   exercises every /api/auth/* route plus the CSP invariants:

     - POST /api/auth/google: 400 (no body), 401 (garbage / aud
       mismatch / iss mismatch / expired), 200 + HttpOnly Secure
       SameSite=Lax cookie (valid token)
     - GET /api/auth/me: user from cookie, ok:false when absent
       or tampered or expired (HMAC forgery resistance)
     - POST /api/auth/logout: clears cookie (Max-Age=0)
     - /api/* 404 JSON — never the SPA index.html fallback
     - Static paths keep header decoration + whisper CSP scoping
     - CSP: GIS origins present, no unsafe-inline added,
       frame-ancestors 'none' intact, worker.js == serve.cjs
   Exit 0 only when every check passes.
   Usage: node tools/verify-auth-worker.mjs
   ============================================================ */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const workerSrc = readFileSync(join(ROOT, 'worker.js'), 'utf8');
const tmp = mkdtempSync(join(tmpdir(), 'mmgr-worker-test-'));
const modPath = join(tmp, 'worker-test.mjs');
writeFileSync(modPath, workerSrc);

const PUBLIC_CLIENT_ID = '297970704704-m05hgt93lfaq286q90br8c96ffg1aph3.apps.googleusercontent.com';
const SECRET = 'unit-test-client-secret-not-shipped';
const USER = { sub: '1122334455', email: 'operator@example.com', name: 'Op Example', picture: '' };

// ---- tokeninfo endpoint stub -------------------------------------------------
let tokenInfoPayload = null;   // what tokeninfo returns for a valid-looking token
let tokenInfoStatus = 200;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.startsWith('https://oauth2.googleapis.com/tokeninfo')) {
    if (tokenInfoPayload === null) return new Response('invalid_token', { status: tokenInfoStatus });
    return new Response(JSON.stringify(tokenInfoPayload), { status: tokenInfoStatus, headers: { 'Content-Type': 'application/json' } });
  }
  throw new Error('harness: unexpected fetch to ' + u);
};

const env = {
  ASSETS: { fetch: async () => new Response('<html>fake-assets</html>', { status: 200, headers: { 'x-assets': 'yes' } }) },
  GOOGLE_CLIENT_SECRET: SECRET,
  GOOGLE_CLIENT_ID: undefined // exercise the constant fallback
};

const { default: worker } = await import(pathToFileURL(modPath).href);

function req(path, { method = 'GET', body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers['Cookie'] = cookie;
  return new Request('https://example.workers.dev' + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}
function validPayload(over = {}) {
  return Object.assign({
    aud: PUBLIC_CLIENT_ID,
    iss: 'accounts.google.com',
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub: USER.sub,
    email: USER.email,
    name: USER.name,
    picture: USER.picture
  }, over);
}
function b64u(str) {
  return Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function signedCookie(payload) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const jsonStr = JSON.stringify(payload);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(jsonStr));
  return b64u(jsonStr) + '.' + b64u(Buffer.from(sig));
}
function setToken(over) { tokenInfoPayload = validPayload(over); tokenInfoStatus = 200; }
function setTokenFail(status) { tokenInfoPayload = null; tokenInfoStatus = status; }

let passed = 0, failed = 0;
const check = (name, cond, detail) => {
  if (cond) { passed++; console.log('[PASS] ' + name); }
  else { failed++; console.log('[FAIL] ' + name + '  <-- ' + JSON.stringify(detail)); }
};

// ---- CSP invariants (STEP-3) -------------------------------------------------
// IMPORTANT: the absolute checks run on the RAW array text (only whitespace
// trimmed). A comment-stripping normalizer would eat https:// URLs, and a
// bare 'unsafe-eval' substring match is fooled by 'wasm-unsafe-eval'.
const cspArr = (workerSrc.match(/const CSP = \[([\s\S]*?)\]\.join/) || [])[1] || '';
const csp = cspArr.split('\n').map(s => s.trim()).filter(s => s.length).join(' ');
const scriptSrc = csp.match(/"script-src [^"]*"/)?.[0] || csp.match(/script-src [^,]+/)?.[0] || '';
const connectSrc = csp.match(/connect-src [^,]+/)?.[0] || '';
check('CSP: script-src allows accounts.google.com + apis.google.com',
  scriptSrc.includes('https://accounts.google.com') && scriptSrc.includes('https://apis.google.com'), scriptSrc.slice(0, 160));
check('CSP: connect-src allows accounts.google.com + oauth2.googleapis.com (https: kept)',
  connectSrc.includes('https://accounts.google.com') && connectSrc.includes('https://oauth2.googleapis.com') && connectSrc.includes('https:'), connectSrc);
check('CSP: frame-src allows accounts.google.com',
  csp.includes('frame-src https://accounts.google.com'), csp.match(/frame-src[^,]+/)?.[0]);
check('CSP: no unsafe-inline added to script-src',
  !scriptSrc.includes('unsafe-inline'), scriptSrc.slice(0, 160));
check('CSP: frame-ancestors none intact (app refuses to be framed)',
  csp.includes("frame-ancestors 'none'"), csp.match(/frame-ancestors[^,]+/)?.[0]);
// Parity comparison mirrors qa-obs-verify D2d: comment-stripping is fine HERE
// because both sides get mangled identically (same URLs in both files).
const norm = (str) => str.replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ').trim();
const wCsp = norm(workerSrc.match(/const CSP = \[([\s\S]*?)\]\.join/)?.[1] || '');
const serveSrc = readFileSync(join(ROOT, 'serve.cjs'), 'utf8');
const sCsp = norm(serveSrc.match(/Content-Security-Policy.: \[([\s\S]*?)\]\.join/)?.[1] || '');
check('CSP: worker.js and serve.cjs stay identical (D2d parity)',
  wCsp.length > 0 && wCsp === sCsp, { w: wCsp.slice(0, 80), s: sCsp.slice(0, 80) });

// ---- static/whisper paths untouched (STEP-2 verify) --------------------------
const home = await worker.fetch(req('/index.html'), env);
check('static: header decoration preserved on non-API paths',
  home.headers.get('x-assets') === 'yes' && home.headers.get('Content-Security-Policy') && home.headers.get('X-Frame-Options') === 'DENY', '');
// Exact-directive matcher: "'unsafe-eval'" (with quotes) — a bare substring
// check would be fooled by the harmless 'wasm-unsafe-eval' in the strict CSP.
const hasRelaxedEval = (cspHeader) => (cspHeader || '').includes("'unsafe-eval'");
const whisper = await worker.fetch(req('/vendor/whisper/worker.js'), env);
check('static: whisper subtree still gets the relaxed CSP (unsafe-eval)',
  hasRelaxedEval(whisper.headers.get('Content-Security-Policy')), '');
const trav = await worker.fetch(req('/vendor/whisper/../../index.html'), env);
check('static: dot-segment traversal cannot leak the relaxed CSP',
  !hasRelaxedEval(trav.headers.get('Content-Security-Policy')), '');

// ---- /api/auth/google ---------------------------------------------------------
let r = await worker.fetch(req('/api/auth/google', { method: 'POST' }), env);
check('google: POST without body -> 400', r.status === 400, r.status);
setTokenFail(400);
r = await worker.fetch(req('/api/auth/google', { method: 'POST', body: { idToken: 'garbage.token.here' } }), env);
check('google: garbage token -> 401', r.status === 401, r.status);

setToken({ aud: 'someone-elses-client-id' });
r = await worker.fetch(req('/api/auth/google', { method: 'POST', body: { idToken: 'tok' } }), env);
check('google: aud mismatch -> 401', r.status === 401, r.status);
setToken({ iss: 'https://evil.example' });
r = await worker.fetch(req('/api/auth/google', { method: 'POST', body: { idToken: 'tok' } }), env);
check('google: iss mismatch -> 401', r.status === 401, r.status);
setToken({ exp: Math.floor(Date.now() / 1000) - 10 });
r = await worker.fetch(req('/api/auth/google', { method: 'POST', body: { idToken: 'tok' } }), env);
check('google: expired exp -> 401', r.status === 401, r.status);

setToken({});
r = await worker.fetch(req('/api/auth/google', { method: 'POST', body: { idToken: 'tok' } }), env);
const body = await r.json();
const setCookie = r.headers.get('Set-Cookie') || '';
check('google: valid token -> 200 { ok:true, user }', r.status === 200 && body.ok === true && body.user.email === USER.email, body);
check('google: Set-Cookie mmgr_session HttpOnly; Secure; SameSite=Lax; Max-Age=604800',
  /^mmgr_session=[^;]+; HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=604800$/.test(setCookie), setCookie);
const cookie = setCookie.split(';')[0];

// ---- /api/auth/me --------------------------------------------------------------
r = await worker.fetch(req('/api/auth/me'), env);
check('me: no cookie -> { ok:false, user:null }', (await r.json()).ok === false, '');
r = await worker.fetch(req('/api/auth/me', { cookie }), env);
const me = await r.json();
check('me: valid session cookie -> user returned', me.ok === true && me.user.email === USER.email, me);
check('me: response is no-store JSON (never page CSP)',
  (r.headers.get('Cache-Control') || '').indexOf('no-store') > -1 && (r.headers.get('Content-Type') || '').indexOf('application/json') > -1, '');

const tampered = cookie.slice(0, -2) + (cookie.endsWith('AA') ? 'BB' : 'AA');
r = await worker.fetch(req('/api/auth/me', { cookie: tampered }), env);
check('me: tampered cookie rejected (HMAC)', (await r.json()).ok === false, '');
r = await worker.fetch(req('/api/auth/me', { cookie: 'mmgr_session=' + await signedCookie({ sub: '999', email: 'a@b.com', exp: Math.floor(Date.now() / 1000) - 5 }) }), env);
check('me: forged-but-expired cookie rejected', (await r.json()).ok === false, '');
r = await worker.fetch(req('/api/auth/me', { cookie: 'mmgr_session=' + await signedCookie({ sub: '999', email: 'a@b.com', exp: Math.floor(Date.now() / 1000) + 60 }) }), env);
check('me: forged cookie with correct secret is accepted (signing works as designed)', (await r.json()).ok === true, '');

// ---- logout + unknown api ------------------------------------------------------
r = await worker.fetch(req('/api/auth/logout', { method: 'POST' }), env);
check('logout: clears cookie with Max-Age=0',
  (r.headers.get('Set-Cookie') || '').indexOf('Max-Age=0') > -1 && r.status === 200, r.headers.get('Set-Cookie'));
r = await worker.fetch(new Request('https://example.workers.dev/api/auth/logout', { method: 'POST', headers: { 'Sec-Fetch-Site': 'cross-site' } }), env);
check('logout: cross-site Sec-Fetch-Site -> 403 (logout-CSRF guard)', r.status === 403, r.status);
r = await worker.fetch(req('/api/does-not-exist'), env);
const nf = await r.json();
check('api: unknown /api/* -> 404 JSON, NOT the SPA index.html fallback',
  r.status === 404 && nf.ok === false && (r.headers.get('Content-Type') || '').indexOf('application/json') > -1, { status: r.status, body: nf });

// ---- env override ---------------------------------------------------------------
setToken({ aud: 'env-specified-client' });
const env2 = Object.assign({}, env, { GOOGLE_CLIENT_ID: 'env-specified-client' });
r = await worker.fetch(req('/api/auth/google', { method: 'POST', body: { idToken: 'tok' } }), env2);
check('google: env.GOOGLE_CLIENT_ID takes precedence over the constant', r.status === 200, r.status);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
