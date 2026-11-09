/* ============================================================
   SESSION CACHE LATENCY (G, 2026-11-09)
   ------------------------------------------------------------
   GET /api/cloud/projects took about 500 ms on a session-cache miss, and
   about 240 ms of that was an awaited KV write that the response did not
   need. The write now rides ctx.waitUntil. These tests pin both halves:

     - the cache read and the D1 revocation read still decide the answer
       (a revoked session is refused on a hit and on a miss);
     - the write-back no longer holds the response (a put that never
       resolves does not stop readSession returning).

   Nothing here changes the order of the auth checks: KV first, D1 second,
   exactly as before.
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SESSION_COOKIE,
  bindRequestContext,
  bytesToBase64Url,
  provenEmail,
  readSession,
  sessionKey
} from '../src/lib/http.js';

const SECRET = 'test-session-secret';

async function mint(payload) {
  const key = await sessionKey({ GOOGLE_CLIENT_SECRET: SECRET });
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const bodyB64 = bytesToBase64Url(body);
  const sig = await crypto.subtle.sign('HMAC', key, body);
  return bodyB64 + '.' + bytesToBase64Url(new Uint8Array(sig));
}

function requestWith(token) {
  return new Request('https://app.test/api/cloud/projects', {
    headers: { Cookie: SESSION_COOKIE + '=' + token }
  });
}

function envWith(opts) {
  const puts = [];
  return {
    puts,
    env: {
      GOOGLE_CLIENT_SECRET: SECRET,
      KV: {
        async get() {
          return opts.cached === undefined ? null : opts.cached;
        },
        put(key, value, options) {
          puts.push({ key, value, options });
          return opts.putPromise || Promise.resolve();
        }
      },
      DB: {
        prepare() {
          return {
            bind() {
              return {
                async first() {
                  if (opts.noDb) {
                    throw new Error('D1 must not be queried on a cache hit');
                  }
                  return opts.row === undefined ? null : opts.row;
                }
              };
            }
          };
        }
      }
    }
  };
}

const PAYLOAD = { sub: 'google-123', exp: Math.floor(Date.now() / 1000) + 3600, jti: 'jti-1' };

test('a valid cache hit answers without touching D1', async () => {
  const token = await mint(PAYLOAD);
  const f = envWith({ cached: 'valid', noDb: true });
  const session = await readSession(requestWith(token), f.env);
  assert.equal(session && session.sub, PAYLOAD.sub);
  assert.equal(f.puts.length, 0, 'a hit must not rewrite the cache');
});

test('a revoked cache hit is refused', async () => {
  const token = await mint(PAYLOAD);
  const f = envWith({ cached: 'revoked', noDb: true });
  assert.equal(await readSession(requestWith(token), f.env), null);
});

test('a revoked row on a cache miss is refused and cached', async () => {
  const token = await mint(PAYLOAD);
  const f = envWith({ row: { revoked_at: '2026-11-09T00:00:00Z' } });
  assert.equal(await readSession(requestWith(token), f.env), null);
  assert.equal(f.puts.length, 1);
  assert.equal(f.puts[0].value, 'revoked');
});

test('a live row on a cache miss answers and fills the cache', async () => {
  const token = await mint(PAYLOAD);
  const f = envWith({ row: { revoked_at: null } });
  const session = await readSession(requestWith(token), f.env);
  assert.equal(session && session.sub, PAYLOAD.sub);
  assert.equal(f.puts.length, 1);
  assert.equal(f.puts[0].value, 'valid');
});

test('a put that never resolves does not hold the response', async () => {
  const token = await mint(PAYLOAD);
  const never = new Promise(function () {});
  const f = envWith({ row: { revoked_at: null }, putPromise: never });
  const req = requestWith(token);
  const pending = [];
  bindRequestContext(req, {
    waitUntil: function (p) {
      pending.push(p);
    }
  });
  const answer = await Promise.race([
    readSession(req, f.env),
    new Promise(function (resolve) {
      setTimeout(function () {
        resolve('timeout');
      }, 300);
    })
  ]);
  assert.notEqual(answer, 'timeout', 'readSession waited for the cache write');
  assert.equal(answer && answer.sub, PAYLOAD.sub);
  assert.equal(pending.length, 1, 'the write was not handed to waitUntil');
});

test('without a bound context the write is still awaited (correctness first)', async () => {
  const token = await mint(PAYLOAD);
  const f = envWith({ row: { revoked_at: null } });
  const session = await readSession(requestWith(token), f.env);
  assert.equal(session && session.sub, PAYLOAD.sub);
  assert.equal(f.puts.length, 1);
});

test('the context binding is per request', async () => {
  const a = requestWith(await mint(PAYLOAD));
  const b = requestWith(await mint(PAYLOAD));
  bindRequestContext(a, { waitUntil: function () {} });
  const fa = envWith({ row: { revoked_at: null } });
  const fb = envWith({ row: { revoked_at: null } });
  await readSession(a, fa.env);
  await readSession(b, fb.env);
  assert.equal(fa.puts.length, 1);
  assert.equal(fb.puts.length, 1, 'the unbound request took the awaited path');
});

test('an unverified email account has no proven address', async () => {
  const env = {
    DB: {
      prepare() {
        return {
          bind() {
            return {
              async first() {
                return { email_verified: 0 };
              }
            };
          }
        };
      }
    }
  };
  assert.equal(await provenEmail({ sub: 'email:person@example.test' }, env), null);
});

test('a verified email account resolves to its address', async () => {
  const env = {
    DB: {
      prepare() {
        return {
          bind() {
            return {
              async first() {
                return { email_verified: 1 };
              }
            };
          }
        };
      }
    }
  };
  assert.equal(await provenEmail({ sub: 'email:person@example.test' }, env), 'person@example.test');
});
