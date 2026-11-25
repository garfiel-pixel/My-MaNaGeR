/* ============================================================
   EMAILED ADMIN SIGN-IN (2026-11-24)
   ------------------------------------------------------------
   The operator credential is a single-use code emailed to the admin inbox,
   exchanged for a 45-minute admin token. These cases pin the properties that
   make it safe: the code only redeems in the browser that asked for it, it
   dies on first use, wrong guesses are counted, and the token only works
   alongside the site session cookie of the same account.
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  adminEmail,
  adminAuthorized,
  handleAdminOtpRequest,
  handleAdminOtpVerify,
  ADMIN_OWNER_EMAIL
} from '../src/auth/admin-otp.js';
import { signSession, sessionKey, hashOwnerCode } from '../src/lib/http.js';

const SECRET = 'test-session-secret';
const SUB = 'google:owner-1';

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/* Minimal in-memory D1 stand-in: only the statements this flow issues. */
function makeDb(state) {
  const db = {
    prepare(sql) {
      const stmt = {
        sql,
        args: [],
        bind(...args) {
          stmt.args = args;
          return stmt;
        },
        async first() {
          if (sql.indexOf('FROM admin_otp_challenges WHERE id = ?') > -1) {
            return state.challenges.find(c => c.id === stmt.args[0]) || null;
          }
          if (sql.indexOf('FROM admin_sessions WHERE token_hash = ?') > -1) {
            return state.sessions.find(s => s.token_hash === stmt.args[0]) || null;
          }
          return null;
        },
        async run() {
          if (sql.indexOf('UPDATE admin_otp_challenges SET attempts = attempts + 1') > -1) {
            const c = state.challenges.find(x => x.id === stmt.args[0]);
            if (c && !c.consumed_at) {
              c.attempts += 1;
            }
            return { meta: { changes: 1 } };
          }
          if (sql.indexOf('UPDATE admin_otp_challenges SET consumed_at = ?') > -1) {
            const c = state.challenges.find(x => x.id === stmt.args[1]);
            if (c && !c.consumed_at) {
              c.consumed_at = stmt.args[0];
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          }
          if (sql.indexOf('INSERT INTO admin_sessions') > -1) {
            state.sessions.push({
              sub: stmt.args[1],
              token_hash: stmt.args[2],
              created_at: stmt.args[3],
              expires_at: stmt.args[4]
            });
            return { meta: { changes: 1 } };
          }
          if (sql.indexOf('DELETE FROM admin_sessions WHERE token_hash = ?') > -1) {
            state.sessions = state.sessions.filter(s => s.token_hash !== stmt.args[0]);
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 1 } };
        }
      };
      return stmt;
    }
  };
  return db;
}

async function cookieFor(env, sub = SUB, email = ADMIN_OWNER_EMAIL) {
  const key = await sessionKey(env);
  const token = await signSession({ sub, email, exp: Math.floor(Date.now() / 1000) + 3600 }, key);
  return 'mmgr_session=' + token;
}

function verifyRequest(body, cookie, challengeId) {
  const headers = { 'Content-Type': 'application/json', Origin: 'https://mymanagerworkspace.com' };
  if (cookie) {
    headers.Cookie = challengeId ? cookie + '; mmgr_admin_chal=' + challengeId : cookie;
  }
  return new Request('https://mymanagerworkspace.com/api/admin/signin/verify', {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
}

async function freshChallenge(state, code, overrides = {}) {
  const salt = 'a'.repeat(32);
  const hash = await hashOwnerCode(code, salt);
  const row = Object.assign(
    {
      id: 'chal-1',
      sub: SUB,
      code_hash: salt + ':' + hash,
      attempts: 0,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      consumed_at: null
    },
    overrides
  );
  state.challenges.push(row);
  return row;
}

test('the destination inbox is server-side, with a documented default', () => {
  assert.equal(adminEmail({}), 'admin@mymanagerworkspace.com');
  assert.equal(adminEmail({ ADMIN_EMAIL: ' ops@example.com ' }), 'ops@example.com');
});

test('verify refuses without a site session', async () => {
  const state = { challenges: [], sessions: [] };
  const env = { DB: makeDb(state), GOOGLE_CLIENT_SECRET: SECRET };
  const res = await handleAdminOtpVerify(
    verifyRequest({ code: '12345678901234567890' }, null),
    env
  );
  assert.equal(res.status, 401);
});

test('verify refuses without the challenge cookie that requested the code', async () => {
  const state = { challenges: [], sessions: [] };
  const env = { DB: makeDb(state), GOOGLE_CLIENT_SECRET: SECRET };
  const cookie = await cookieFor(env);
  const res = await handleAdminOtpVerify(
    verifyRequest({ code: '12345678901234567890' }, cookie),
    env
  );
  assert.equal(res.status, 400);
  assert.match(await res.text(), /this browser/);
});

test('a wrong code is rejected and counted, and never issues a token', async () => {
  const state = { challenges: [], sessions: [] };
  const env = { DB: makeDb(state), GOOGLE_CLIENT_SECRET: SECRET };
  const row = await freshChallenge(state, '12345678901234567890');
  const cookie = await cookieFor(env);
  const res = await handleAdminOtpVerify(
    verifyRequest({ code: '99999999999999999999' }, cookie, row.id),
    env
  );
  assert.equal(res.status, 400);
  assert.equal(state.challenges[0].attempts, 1);
  assert.equal(state.sessions.length, 0);
});

test('the right code issues one token and cannot be replayed', async () => {
  const state = { challenges: [], sessions: [] };
  const env = { DB: makeDb(state), GOOGLE_CLIENT_SECRET: SECRET };
  const row = await freshChallenge(state, '12345678901234567890');
  const cookie = await cookieFor(env);

  const first = await handleAdminOtpVerify(
    verifyRequest({ code: '12345678901234567890' }, cookie, row.id),
    env
  );
  assert.equal(first.status, 200);
  const data = await first.json();
  assert.equal(data.ok, true);
  assert.ok(data.token && data.token.length > 20);
  assert.equal(state.sessions.length, 1);
  assert.equal(state.sessions[0].token_hash, sha256Hex(data.token));
  assert.ok(state.challenges[0].consumed_at, 'the challenge is consumed on success');

  const again = await handleAdminOtpVerify(
    verifyRequest({ code: '12345678901234567890' }, cookie, row.id),
    env
  );
  assert.equal(again.status, 400);
  assert.equal(state.sessions.length, 1, 'a replay must not mint a second token');
});

test('an expired challenge is refused even with the right code', async () => {
  const state = { challenges: [], sessions: [] };
  const env = { DB: makeDb(state), GOOGLE_CLIENT_SECRET: SECRET };
  const row = await freshChallenge(state, '12345678901234567890', {
    expires_at: new Date(Date.now() - 1000).toISOString()
  });
  const cookie = await cookieFor(env);
  const res = await handleAdminOtpVerify(
    verifyRequest({ code: '12345678901234567890' }, cookie, row.id),
    env
  );
  assert.equal(res.status, 400);
  assert.equal(state.sessions.length, 0);
});

test('a challenge minted for another account cannot be redeemed in this session', async () => {
  const state = { challenges: [], sessions: [] };
  const env = { DB: makeDb(state), GOOGLE_CLIENT_SECRET: SECRET };
  const row = await freshChallenge(state, '12345678901234567890', { sub: 'google:someone-else' });
  const cookie = await cookieFor(env);
  const res = await handleAdminOtpVerify(
    verifyRequest({ code: '12345678901234567890' }, cookie, row.id),
    env
  );
  assert.equal(res.status, 400);
  assert.equal(state.sessions.length, 0);
});

test('the admin token only authenticates alongside the same account session', async () => {
  const state = { challenges: [], sessions: [] };
  const env = { DB: makeDb(state), GOOGLE_CLIENT_SECRET: SECRET };
  const token = 'token-abc';
  state.sessions.push({
    sub: SUB,
    token_hash: sha256Hex(token),
    expires_at: new Date(Date.now() + 45 * 60 * 1000).toISOString()
  });
  const cookie = await cookieFor(env);

  const noHeader = await adminAuthorized(
    new Request('https://mymanagerworkspace.com/api/admin/billing/subscriptions', {
      headers: { Cookie: cookie }
    }),
    env
  );
  assert.equal(noHeader.ok, false, 'no header is not an authorisation');

  const badToken = await adminAuthorized(
    new Request('https://mymanagerworkspace.com/api/admin/billing/subscriptions', {
      headers: { Cookie: cookie, 'X-Admin-Session': 'not-a-token' }
    }),
    env
  );
  assert.equal(badToken, null, 'a bad token must not fall through');

  const noSession = await adminAuthorized(
    new Request('https://mymanagerworkspace.com/api/admin/billing/subscriptions', {
      headers: { 'X-Admin-Session': token }
    }),
    env
  );
  assert.equal(noSession, null, 'a leaked header alone is useless');

  const otherAccount = await adminAuthorized(
    new Request('https://mymanagerworkspace.com/api/admin/billing/subscriptions', {
      headers: { Cookie: await cookieFor(env, 'google:other'), 'X-Admin-Session': token }
    }),
    env
  );
  assert.equal(otherAccount, null, 'the token belongs to one account');

  const ok = await adminAuthorized(
    new Request('https://mymanagerworkspace.com/api/admin/billing/subscriptions', {
      headers: { Cookie: cookie, 'X-Admin-Session': token }
    }),
    env
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.via, 'otp');
});

test('a fresh sign-in code is 20 random digits and goes to the fixed inbox', async () => {
  const state = { challenges: [], sessions: [] };
  const env = {
    DB: makeDb(state),
    GOOGLE_CLIENT_SECRET: SECRET,
    RESEND_API_KEY: 'test-key'
  };
  const realFetch = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async function (url, init) {
    captured = { url: String(url), body: JSON.parse(init.body) };
    return new Response('{}', { status: 200 });
  };
  try {
    const cookie = await cookieFor(env);
    const res = await handleAdminOtpRequest(
      new Request('https://mymanagerworkspace.com/api/admin/signin/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: '{}'
      }),
      env
    );
    assert.equal(res.status, 200);
    assert.ok(captured, 'the code was actually emailed');
    assert.deepEqual(captured.body.to, ['admin@mymanagerworkspace.com']);
    const code = /\b(\d{20})\b/.exec(captured.body.text);
    assert.ok(code, 'the email carries exactly one 20-digit code');
    assert.match(code[1], /^\d{20}$/);
    assert.ok(!/[A-Za-z]/.test(code[1]), 'the code contains no letters');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a non-owner account cannot request or redeem an admin code', async () => {
  const state = { challenges: [], sessions: [] };
  const env = {
    DB: makeDb(state),
    GOOGLE_CLIENT_SECRET: SECRET,
    RESEND_API_KEY: 'test-key'
  };
  const realFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async function () {
    called = true;
    return new Response('{}', { status: 200 });
  };
  try {
    const stranger = await cookieFor(env, 'google:someone-else', 'someone@example.com');
    const request = await handleAdminOtpRequest(
      new Request('https://mymanagerworkspace.com/api/admin/signin/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: stranger },
        body: '{}'
      }),
      env
    );
    assert.equal(request.status, 403);
    assert.equal(called, false, 'no email is sent for a stranger');

    const row = await freshChallenge(state, '12345678901234567890');
    const verify = await handleAdminOtpVerify(
      verifyRequest({ code: '12345678901234567890' }, stranger, row.id),
      env
    );
    assert.equal(verify.status, 403);
    assert.equal(state.sessions.length, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});
