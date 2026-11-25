/* ============================================================
   OPERATOR PAGE GATE (worker.js, 2026-11-25)
   ------------------------------------------------------------
   /operator is a private owner-only console. The Worker refuses to
   serve the page at all unless the request carries a signed-in session
   whose proven email is the owner address. A signed-out visitor, or a
   session for any other account, gets the same real 404 an unknown page
   gets - so the address does not exist for anyone but the owner. Both
   spellings (/operator and /operator.html) hit the same gate, so the
   edge's extensionless redirect cannot walk around it.

   These tests drive the real worker export with a mocked ASSETS binding
   and a forged session cookie, and pin the gate contract plus the two
   static guarantees the private page depends on: it is never in the
   service-worker shell (a cached copy would survive sign-out), and no
   served page links to it.
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../worker.js';
import { signSession, sessionKey } from '../src/lib/http.js';
import { ADMIN_OWNER_EMAIL } from '../src/auth/admin-otp.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = 'test-secret-operator-gate';
const SHELL = '<!doctype html><html><body>operator console</body></html>';
const ctx = { waitUntil() {}, passThroughOnException() {} };

function makeEnv() {
  return {
    SESSION_SECRET: SECRET,
    ASSETS: {
      async fetch() {
        return new Response(SHELL, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }
    }
  };
}

async function cookieFor(env, sub, email) {
  const key = await sessionKey(env);
  const token = await signSession({ sub, email, exp: Math.floor(Date.now() / 1000) + 3600 }, key);
  return 'mmgr_session=' + token;
}

async function get(pathname, cookie) {
  const headers = cookie ? { Cookie: cookie } : {};
  const res = await worker.fetch(
    new Request('https://mymanagerworkspace.com' + pathname, { headers }),
    makeEnv(),
    ctx
  );
  return { status: res.status, body: await res.text() };
}

test('signed out, /operator is a real 404 (the page does not exist for visitors)', async () => {
  const res = await get('/operator');
  assert.equal(res.status, 404);
  assert.equal(res.body.indexOf('operator console'), -1);
});

test('signed in as another account, /operator is a real 404', async () => {
  const env = makeEnv();
  const cookie = await cookieFor(env, 'google:someone-else', 'someone@example.com');
  const res = await get('/operator', cookie);
  assert.equal(res.status, 404);
  assert.equal(res.body.indexOf('operator console'), -1);
});

test('signed in as the owner, /operator serves the page', async () => {
  const env = makeEnv();
  const cookie = await cookieFor(env, 'google:owner', ADMIN_OWNER_EMAIL);
  const res = await get('/operator', cookie);
  assert.equal(res.status, 200);
  assert.ok(res.body.indexOf('operator console') > -1);
});

test('the /operator.html spelling is gated identically', async () => {
  const env = makeEnv();
  const owner = await cookieFor(env, 'google:owner', ADMIN_OWNER_EMAIL);
  const stranger = await cookieFor(env, 'google:someone-else', 'someone@example.com');

  const signedOut = await get('/operator.html');
  assert.equal(signedOut.status, 404);

  const other = await get('/operator.html', stranger);
  assert.equal(other.status, 404);

  const asOwner = await get('/operator.html', owner);
  assert.equal(asOwner.status, 200);
});

test('operator.html is not in the service-worker shell (a cached copy would survive sign-out)', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  assert.equal(sw.indexOf("'operator.html'"), -1);
});

test('no served page links to /operator (direct address or bookmark only)', () => {
  const pages = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));
  const offenders = [];
  for (const file of pages) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    // Any href/action pointing at the operator page (with or without .html).
    if (/href\s*=\s*["'][^"']*\/operator(?:\.html)?["']/i.test(src)) {
      offenders.push(file);
    }
  }
  assert.deepEqual(offenders, []);
});
