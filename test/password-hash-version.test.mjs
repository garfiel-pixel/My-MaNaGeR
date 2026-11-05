/* ============================================================
   Password hash versioning (SEC-05 / wave 4.5, audit 2026-11-01)
   ------------------------------------------------------------
   The stored hash now carries its own version and iteration count:

       v2:<iterations>:<saltHex>:<hashHex>     current
       <saltHex>:<hashHex>                     legacy (v1, 100000)

   These tests drive the REAL handleAuthLogin against a fake D1, because the
   claims that matter are behavioural, not structural:

     - a legacy row still signs in (no forced reset, ever)
     - that sign-in silently rewrites the row as v2
     - an already-current row is NOT rewritten (no write amplification)
     - a wrong password never upgrades anything
     - a malformed or unknown-version row fails CLOSED instead of throwing

   The KDF itself is checked directly: the iteration count is honoured, which
   is the whole reason the count is stored per row.
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleAuthLogin } from '../src/auth/session.js';
import { hashPasswordWith, hashOwnerCode, randomSaltHex } from '../src/lib/http.js';

const SECRET = 'test-google-client-secret';
const EMAIL = 'legacy@example.test';
const PASSWORD = 'correct horse battery staple';

function fakeEnv(row, opts) {
  const writes = [];
  const DB = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (/FROM auth_login_guard/.test(sql)) {
                return null;
              }
              if (/FROM auth_users WHERE email/.test(sql)) {
                return row;
              }
              if (/FROM auth_sessions WHERE jti/.test(sql)) {
                return { revoked_at: null };
              }
              return null;
            },
            async run() {
              writes.push({ sql, args });
              return { meta: { changes: 1 } };
            },
            async all() {
              return { results: [] };
            }
          };
        },
        async first() {
          return null;
        },
        async run() {
          return { meta: { changes: 1 } };
        },
        async all() {
          return { results: [] };
        }
      };
    }
  };
  return { env: Object.assign({ DB, GOOGLE_CLIENT_SECRET: SECRET }, opts || {}), writes };
}

function loginRequest(password) {
  return new Request('https://app.example/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password })
  });
}

const hashWrites = writes => writes.filter(w => /UPDATE auth_users SET password_hash/.test(w.sql));

test('a legacy two-part hash still signs in and is upgraded to v2', async () => {
  const salt = randomSaltHex();
  const legacy = await hashOwnerCode(PASSWORD, salt);
  const { env, writes } = fakeEnv({ email: EMAIL, password_hash: salt + ':' + legacy, name: 'L' });

  const res = await handleAuthLogin(loginRequest(PASSWORD), env);
  assert.equal(res.status, 200);

  const upgrades = hashWrites(writes);
  assert.equal(upgrades.length, 1, 'the legacy row is re-hashed once');
  const stored = upgrades[0].args[0];
  assert.match(stored, /^v2:100000:[0-9a-f]{32}:[0-9a-f]{64}$/);
  assert.notEqual(stored.split(':')[2], salt, 'the upgrade uses a fresh salt');
});

test('an already-current v2 row is not rewritten', async () => {
  const salt = randomSaltHex();
  const hash = await hashPasswordWith(PASSWORD, salt, 100000);
  const { env, writes } = fakeEnv({
    email: EMAIL,
    password_hash: 'v2:100000:' + salt + ':' + hash,
    name: 'L'
  });

  const res = await handleAuthLogin(loginRequest(PASSWORD), env);
  assert.equal(res.status, 200);
  assert.equal(hashWrites(writes).length, 0, 'no write amplification on a current row');
});

test('a row stored with a lower iteration count is upgraded on sign-in', async () => {
  const salt = randomSaltHex();
  const weak = await hashPasswordWith(PASSWORD, salt, 1000);
  const { env, writes } = fakeEnv({
    email: EMAIL,
    password_hash: 'v2:1000:' + salt + ':' + weak,
    name: 'L'
  });

  const res = await handleAuthLogin(loginRequest(PASSWORD), env);
  assert.equal(res.status, 200);
  const upgrades = hashWrites(writes);
  assert.equal(upgrades.length, 1);
  assert.match(upgrades[0].args[0], /^v2:100000:/);
});

test('a wrong password is refused and upgrades nothing', async () => {
  const salt = randomSaltHex();
  const legacy = await hashOwnerCode(PASSWORD, salt);
  const { env, writes } = fakeEnv({ email: EMAIL, password_hash: salt + ':' + legacy, name: 'L' });

  const res = await handleAuthLogin(loginRequest('not the password'), env);
  assert.equal(res.status, 401);
  assert.equal(hashWrites(writes).length, 0);
});

test('a malformed hash fails closed instead of throwing', async () => {
  for (const bad of ['', 'garbage', 'only-one-part', 'v2:abc:deadbeef', 'v9:100000:aa:bb']) {
    const { env, writes } = fakeEnv({ email: EMAIL, password_hash: bad, name: 'L' });
    const res = await handleAuthLogin(loginRequest(PASSWORD), env);
    assert.equal(res.status, 401, 'refused: ' + JSON.stringify(bad));
    assert.equal(hashWrites(writes).length, 0, 'nothing rewritten for ' + JSON.stringify(bad));
  }
});

test('the KDF honours the iteration count it is given', async () => {
  const salt = randomSaltHex();
  const a = await hashPasswordWith(PASSWORD, salt, 1000);
  const b = await hashPasswordWith(PASSWORD, salt, 2000);
  const c = await hashPasswordWith(PASSWORD, salt);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b, 'a different iteration count is a different hash');
  assert.equal(c, await hashPasswordWith(PASSWORD, salt, 100000), 'the default is 100000');
  assert.equal(c, await hashOwnerCode(PASSWORD, salt), 'owner codes keep the same KDF');
});
