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
import { readFileSync, writeFileSync, mkdtempSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const workerSrc = readFileSync(join(ROOT, 'worker.js'), 'utf8');
const tmp = mkdtempSync(join(tmpdir(), 'mmgr-worker-test-'));
const modPath = join(tmp, 'worker-test.mjs');
writeFileSync(modPath, workerSrc);
// worker.js has imported ./src/* since the architecture split, so the temp
// copy needs the src tree beside it or the import fails with
// ERR_MODULE_NOT_FOUND (the harness was silently dead until 2026-10-23).
cpSync(join(ROOT, 'src'), join(tmp, 'src'), { recursive: true });

const PUBLIC_CLIENT_ID = '297970704704-m05hgt93lfaq286q90br8c96ffg1aph3.apps.googleusercontent.com';
const SECRET = 'unit-test-client-secret-not-shipped';
const USER = { sub: '1122334455', email: 'operator@example.com', name: 'Op Example', picture: '' };

// ---- tokeninfo endpoint stub -------------------------------------------------
let tokenInfoPayload = null; // what tokeninfo returns for a valid-looking token
let tokenInfoStatus = 200;
globalThis.fetch = async url => {
  const u = String(url);
  if (u.startsWith('https://oauth2.googleapis.com/tokeninfo')) {
    if (tokenInfoPayload === null)
      return new Response('invalid_token', { status: tokenInfoStatus });
    return new Response(JSON.stringify(tokenInfoPayload), {
      status: tokenInfoStatus,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  throw new Error('harness: unexpected fetch to ' + u);
};

// readSession (src/lib/http.js) checks auth_sessions for jti revocation on
// every session-bearing request, so the harness env needs a DB binding: a
// live, non-revoked row for whatever jti it is asked about.
const BASE_DB = {
  prepare() {
    return {
      bind() {
        return this;
      },
      async first() {
        return { revoked_at: null };
      },
      async all() {
        return { results: [] };
      },
      async run() {
        return { meta: { changes: 0 } };
      }
    };
  }
};

const env = {
  ASSETS: {
    fetch: async () =>
      new Response('<html>fake-assets</html>', { status: 200, headers: { 'x-assets': 'yes' } })
  },
  GOOGLE_CLIENT_SECRET: SECRET,
  GOOGLE_CLIENT_ID: undefined, // exercise the constant fallback
  DB: BASE_DB
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
  return Object.assign(
    {
      aud: PUBLIC_CLIENT_ID,
      iss: 'accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: USER.sub,
      email: USER.email,
      name: USER.name,
      picture: USER.picture,
      // G-2 (2026-10-23): the Worker now refuses any token whose
      // email_verified is not literally true, so the fixture carries it.
      email_verified: true
    },
    over
  );
}
function b64u(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
async function signedCookie(payload) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const jsonStr = JSON.stringify(payload);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(jsonStr));
  return b64u(jsonStr) + '.' + b64u(Buffer.from(sig));
}
function setToken(over) {
  tokenInfoPayload = validPayload(over);
  tokenInfoStatus = 200;
}
function setTokenFail(status) {
  tokenInfoPayload = null;
  tokenInfoStatus = status;
}

let passed = 0,
  failed = 0;
const check = (name, cond, detail) => {
  if (cond) {
    passed++;
    console.log('[PASS] ' + name);
  } else {
    failed++;
    console.log('[FAIL] ' + name + '  <-- ' + JSON.stringify(detail));
  }
};

// ---- CSP invariants (STEP-3) -------------------------------------------------
// IMPORTANT: the absolute checks run on the RAW array text (only whitespace
// trimmed). A comment-stripping normalizer would eat https:// URLs, and a
// bare 'unsafe-eval' substring match is fooled by 'wasm-unsafe-eval'.
const cspArr = (workerSrc.match(/const CSP = \[([\s\S]*?)\]\.join/) || [])[1] || '';
const csp = cspArr
  .split('\n')
  .map(s => s.trim())
  .filter(s => s.length)
  .join(' ');
const scriptSrc = csp.match(/"script-src [^"]*"/)?.[0] || csp.match(/script-src [^,]+/)?.[0] || '';
const connectSrc = csp.match(/connect-src [^,]+/)?.[0] || '';
check(
  'CSP: script-src allows accounts.google.com + apis.google.com',
  scriptSrc.includes('https://accounts.google.com') &&
    scriptSrc.includes('https://apis.google.com'),
  scriptSrc.slice(0, 160)
);
check(
  'CSP: connect-src allows accounts.google.com + oauth2.googleapis.com (https: kept)',
  connectSrc.includes('https://accounts.google.com') &&
    connectSrc.includes('https://oauth2.googleapis.com') &&
    connectSrc.includes('https:'),
  connectSrc
);
check(
  'CSP: frame-src allows accounts.google.com',
  csp.includes('frame-src https://accounts.google.com'),
  csp.match(/frame-src[^,]+/)?.[0]
);
check(
  'CSP: no unsafe-inline added to script-src',
  !scriptSrc.includes('unsafe-inline'),
  scriptSrc.slice(0, 160)
);
check(
  'CSP: frame-ancestors none intact (app refuses to be framed)',
  csp.includes("frame-ancestors 'none'"),
  csp.match(/frame-ancestors[^,]+/)?.[0]
);
// Parity comparison mirrors qa-obs-verify D2d: comment-stripping is fine HERE
// because both sides get mangled identically (same URLs in both files).
const norm = str =>
  str
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
const wCsp = norm(workerSrc.match(/const CSP = \[([\s\S]*?)\]\.join/)?.[1] || '');
const serveSrc = readFileSync(join(ROOT, 'serve.cjs'), 'utf8');
const sCsp = norm(serveSrc.match(/Content-Security-Policy.: \[([\s\S]*?)\]\.join/)?.[1] || '');
check(
  'CSP: worker.js and serve.cjs stay identical (D2d parity)',
  wCsp.length > 0 && wCsp === sCsp,
  { w: wCsp.slice(0, 80), s: sCsp.slice(0, 80) }
);

// ---- static/whisper paths untouched (STEP-2 verify) --------------------------
const home = await worker.fetch(req('/index.html'), env);
check(
  'static: header decoration preserved on non-API paths',
  home.headers.get('x-assets') === 'yes' &&
    home.headers.get('Content-Security-Policy') &&
    home.headers.get('X-Frame-Options') === 'DENY',
  ''
);
// Exact-directive matcher: "'unsafe-eval'" (with quotes) — a bare substring
// check would be fooled by the harmless 'wasm-unsafe-eval' in the strict CSP.
const hasRelaxedEval = cspHeader => (cspHeader || '').includes("'unsafe-eval'");
const whisper = await worker.fetch(req('/vendor/whisper/worker.js'), env);
check(
  'static: whisper subtree still gets the relaxed CSP (unsafe-eval)',
  hasRelaxedEval(whisper.headers.get('Content-Security-Policy')),
  ''
);
const trav = await worker.fetch(req('/vendor/whisper/../../index.html'), env);
check(
  'static: dot-segment traversal cannot leak the relaxed CSP',
  !hasRelaxedEval(trav.headers.get('Content-Security-Policy')),
  ''
);

// ---- /api/auth/google ---------------------------------------------------------
let r = await worker.fetch(req('/api/auth/google', { method: 'POST' }), env);
check('google: POST without body -> 400', r.status === 400, r.status);
setTokenFail(400);
r = await worker.fetch(
  req('/api/auth/google', { method: 'POST', body: { idToken: 'garbage.token.here' } }),
  env
);
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
check(
  'google: valid token -> 200 { ok:true, user }',
  r.status === 200 && body.ok === true && body.user.email === USER.email,
  body
);
check(
  'google: Set-Cookie mmgr_session HttpOnly; Secure; SameSite=Lax; Max-Age=604800',
  /^mmgr_session=[^;]+; HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=604800$/.test(setCookie),
  setCookie
);
const cookie = setCookie.split(';')[0];

// ---- /api/auth/me --------------------------------------------------------------
r = await worker.fetch(req('/api/auth/me'), env);
check('me: no cookie -> { ok:false, user:null }', (await r.json()).ok === false, '');
r = await worker.fetch(req('/api/auth/me', { cookie }), env);
const me = await r.json();
check(
  'me: valid session cookie -> user returned',
  me.ok === true && me.user.email === USER.email,
  me
);
check(
  'me: response is no-store JSON (never page CSP)',
  (r.headers.get('Cache-Control') || '').indexOf('no-store') > -1 &&
    (r.headers.get('Content-Type') || '').indexOf('application/json') > -1,
  ''
);

const tampered = cookie.slice(0, -2) + (cookie.endsWith('AA') ? 'BB' : 'AA');
r = await worker.fetch(req('/api/auth/me', { cookie: tampered }), env);
check('me: tampered cookie rejected (HMAC)', (await r.json()).ok === false, '');
r = await worker.fetch(
  req('/api/auth/me', {
    cookie:
      'mmgr_session=' +
      (await signedCookie({ sub: '999', email: 'a@b.com', exp: Math.floor(Date.now() / 1000) - 5 }))
  }),
  env
);
check('me: forged-but-expired cookie rejected', (await r.json()).ok === false, '');
r = await worker.fetch(
  req('/api/auth/me', {
    cookie:
      'mmgr_session=' +
      (await signedCookie({
        sub: '999',
        email: 'a@b.com',
        exp: Math.floor(Date.now() / 1000) + 60
      }))
  }),
  env
);
check(
  'me: forged cookie with correct secret is accepted (signing works as designed)',
  (await r.json()).ok === true,
  ''
);

// ---- logout + unknown api ------------------------------------------------------
r = await worker.fetch(req('/api/auth/logout', { method: 'POST' }), env);
check(
  'logout: clears cookie with Max-Age=0',
  (r.headers.get('Set-Cookie') || '').indexOf('Max-Age=0') > -1 && r.status === 200,
  r.headers.get('Set-Cookie')
);
r = await worker.fetch(
  new Request('https://example.workers.dev/api/auth/logout', {
    method: 'POST',
    headers: { 'Sec-Fetch-Site': 'cross-site' }
  }),
  env
);
check('logout: cross-site Sec-Fetch-Site -> 403 (logout-CSRF guard)', r.status === 403, r.status);
r = await worker.fetch(req('/api/does-not-exist'), env);
const nf = await r.json();
check(
  'api: unknown /api/* -> 404 JSON, NOT the SPA index.html fallback',
  r.status === 404 &&
    nf.ok === false &&
    (r.headers.get('Content-Type') || '').indexOf('application/json') > -1,
  { status: r.status, body: nf }
);

// ---- env override ---------------------------------------------------------------
setToken({ aud: 'env-specified-client' });
const env2 = Object.assign({}, env, { GOOGLE_CLIENT_ID: 'env-specified-client' });
r = await worker.fetch(req('/api/auth/google', { method: 'POST', body: { idToken: 'tok' } }), env2);
check(
  'google: env.GOOGLE_CLIENT_ID takes precedence over the constant',
  r.status === 200,
  r.status
);

// ---- G-2: sign-in nonce contract (DIRECTIVE: GOOGLE SIGN-IN SECURITY
// GAPS, 2026-10-23). In-memory auth_nonces store behind the same
// prepare/bind/run shape D1 uses, so the atomic single-use DELETE and the
// flag on/off behavior are exercised end to end through the real routes.
const nonceRows = new Map(); // nonce_hash -> expires_at (ISO string)
const sha256hex = async s => {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
};

function makeDbStub() {
  return {
    prepare(sql) {
      const exec = {
        async run(...args) {
          if (sql.indexOf('INSERT INTO auth_nonces') === 0) {
            nonceRows.set(args[0], args[2]);
            return { meta: { changes: 1 } };
          }
          if (sql.indexOf('DELETE FROM auth_nonces WHERE nonce_hash') === 0) {
            // Mirrors the real single-use contract: row must exist, be
            // unexpired, and the DELETE wins the race exactly once.
            const exp = nonceRows.get(args[0]);
            if (exp && exp > args[1]) {
              nonceRows.delete(args[0]);
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          }
          if (sql.indexOf('DELETE FROM auth_nonces WHERE expires_at') === 0) {
            let n = 0;
            for (const [k, v] of nonceRows) {
              if (v < args[0]) {
                nonceRows.delete(k);
                n++;
              }
            }
            return { meta: { changes: n } };
          }
          // auth_sessions / login guard / token bookkeeping: harmless no-op
          // (mintSession already tolerates a failed bookkeeping write).
          return { meta: { changes: 0 }, results: [] };
        },
        async first() {
          return null;
        },
        async all() {
          return { results: [] };
        }
      };
      // D1 allows both prepare().bind(...).run() and prepare().all(); give
      // the no-bind style the same behavior (webhook evaluation uses it).
      exec.bind = function (...bindArgs) {
        return {
          run: () => exec.run(...bindArgs),
          first: () => exec.first(...bindArgs),
          all: () => exec.all(...bindArgs)
        };
      };
      return exec;
    }
  };
}

const dbEnv = Object.assign({}, env, { DB: makeDbStub() });
const dbEnvStrict = Object.assign({}, dbEnv, { GOOGLE_NONCE_REQUIRED: 'on' });
async function mintNonce(e = dbEnv) {
  const res = await worker.fetch(req('/api/auth/nonce'), e);
  const body = await res.json();
  return { status: res.status, nonce: body && body.nonce };
}
async function signInWithNonce(e, postedNonce, over) {
  setToken(Object.assign({ nonce: postedNonce }, over || {}));
  const res = await worker.fetch(
    req('/api/auth/google', {
      method: 'POST',
      body: postedNonce ? { idToken: 'tok', nonce: postedNonce } : { idToken: 'tok' }
    }),
    e
  );
  return res.status;
}

// N1: mint endpoint returns a fresh 32-hex nonce.
const n1 = await mintNonce();
check(
  'nonce: GET /api/auth/nonce -> 200 + 32-hex nonce',
  n1.status === 200 && /^[0-9a-f]{32}$/.test(n1.nonce),
  n1
);
// N2: only the SHA-256 hash is stored, never the nonce itself.
check(
  'nonce: stored row is the SHA-256 hash, never the nonce',
  (nonceRows.has(await sha256hex(n1.nonce)) && !nonceRows.has(n1.nonce)) === true,
  [...nonceRows.keys()]
);
// N3: cross-site requests are refused (CSRF guard on the mint route).
const n3 = await worker.fetch(
  new Request('https://example.workers.dev/api/auth/nonce', {
    headers: { 'Sec-Fetch-Site': 'cross-site' }
  }),
  dbEnv
);
check('nonce: cross-site Sec-Fetch-Site -> 403', n3.status === 403, n3.status);

// N4: valid fixture (payload.nonce == posted nonce, live row) signs in.
const n4 = await mintNonce();
check('nonce: valid nonce -> 200', (await signInWithNonce(dbEnv, n4.nonce)) === 200, n4);
// N5: wrong nonce (posted value differs from the token's claim) -> 401.
const n5a = await mintNonce();
const n5b = await mintNonce();
setToken({ nonce: n5a.nonce });
const n5 = await worker.fetch(
  req('/api/auth/google', { method: 'POST', body: { idToken: 'tok', nonce: n5b.nonce } }),
  dbEnv
);
check('nonce: wrong nonce -> 401', n5.status === 401, n5.status);
// N6: reused nonce (row already consumed by N4) -> 401.
check('nonce: reused nonce -> 401', (await signInWithNonce(dbEnv, n4.nonce)) === 401, n4);
// N7: expired nonce row -> 401.
const n7 = await mintNonce();
nonceRows.set(await sha256hex(n7.nonce), new Date(Date.now() - 1000).toISOString());
check('nonce: expired nonce -> 401', (await signInWithNonce(dbEnv, n7.nonce)) === 401, n7);
// N8: email_verified false -> 401 even with a valid nonce.
const n8 = await mintNonce();
check(
  'nonce: email_verified false -> 401',
  (await signInWithNonce(dbEnv, n8.nonce, { email_verified: false })) === 401,
  n8
);
// N9: forged/invalid token (tokeninfo 400) -> 401.
const n9 = await mintNonce();
setTokenFail(400);
const n9r = await worker.fetch(
  req('/api/auth/google', { method: 'POST', body: { idToken: 'garbage', nonce: n9.nonce } }),
  dbEnv
);
check('nonce: forged token -> 401', n9r.status === 401, n9r.status);
// N10: flag ON + no nonce -> refused (legacy cached pages must re-fetch).
setToken({});
const n10 = await worker.fetch(
  req('/api/auth/google', { method: 'POST', body: { idToken: 'tok' } }),
  dbEnvStrict
);
check('nonce: flag ON + no nonce -> 401', n10.status === 401, n10.status);
// N11: flag OFF + no nonce -> still signs in (safe rollout path).
setToken({});
const n11 = await worker.fetch(
  req('/api/auth/google', { method: 'POST', body: { idToken: 'tok' } }),
  dbEnv
);
check('nonce: flag OFF + no nonce -> 200 (rollout path)', n11.status === 200, n11.status);
// N12: cron sweep drops long-dead rows (worker.scheduled auth sweep uses
// the same 7-day cutoff as the auth_tokens sweep; a 5-minute nonce that
// expires today is swept on the next daily cron after that window).
const n12 = await mintNonce();
const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
nonceRows.set(await sha256hex(n12.nonce), eightDaysAgo);
const deadKey = await sha256hex(n12.nonce);
check('nonce: seeded dead row present before sweep', nonceRows.has(deadKey), [...nonceRows.keys()]);
await worker.scheduled({}, dbEnv);
check('nonce: scheduled sweep removes expired rows', !nonceRows.has(deadKey), [
  ...nonceRows.keys()
]);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
