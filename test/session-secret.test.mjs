/* ============================================================
   DEDICATED SESSION SIGNING KEY (owner 2026-11-25)
   ------------------------------------------------------------
   Sessions must be signed with SESSION_SECRET, not with the OAuth
   client secret that also protects admin-code escrow material.
   These cases pin the precedence and the fallback: the fallback
   keeps an un-migrated deployment working, and the escrow derivation
   is untouched so existing code backups remain readable.
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { signSession, sessionKey, SESSION_COOKIE, bytesToBase64Url } from '../src/lib/http.js';

const SESSION = 'dedicated-session-secret';
const OAUTH = 'shared-oauth-client-secret';

async function digestWith(env, payload) {
  const key = await sessionKey(env);
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const sig = await crypto.subtle.sign('HMAC', key, body);
  return bytesToBase64Url(body) + '.' + bytesToBase64Url(new Uint8Array(sig));
}

test('SESSION_SECRET takes precedence over the OAuth client secret', async () => {
  const both = { SESSION_SECRET: SESSION, GOOGLE_CLIENT_SECRET: OAUTH };
  const sessionOnly = { SESSION_SECRET: SESSION };
  const oauthOnly = { GOOGLE_CLIENT_SECRET: OAUTH };
  const payload = { sub: 'google:owner', exp: Math.floor(Date.now() / 1000) + 600 };

  const token = await signSession(payload, await sessionKey(both));
  assert.equal(token, await digestWith(sessionOnly, payload), 'signed with SESSION_SECRET');
  assert.notEqual(token, await digestWith(oauthOnly, payload), 'not signed with the OAuth secret');
});

test('the OAuth fallback still signs when SESSION_SECRET is unset', async () => {
  const oauthOnly = { GOOGLE_CLIENT_SECRET: OAUTH };
  const payload = { sub: 'google:legacy', exp: Math.floor(Date.now() / 1000) + 600 };
  assert.equal(
    await signSession(payload, await sessionKey(oauthOnly)),
    await digestWith(oauthOnly, payload)
  );
});

test('a session signed under the old key is refused once the new secret is set', async () => {
  const oauthOnly = { GOOGLE_CLIENT_SECRET: OAUTH };
  const both = { SESSION_SECRET: SESSION, GOOGLE_CLIENT_SECRET: OAUTH };
  const payload = { sub: 'google:owner', exp: Math.floor(Date.now() / 1000) + 600 };
  const legacy = await digestWith(oauthOnly, payload);
  const fresh = await digestWith(both, payload);
  assert.notEqual(legacy, fresh);
  assert.ok(legacy.indexOf(SESSION_COOKIE) === -1, 'cookie name stays out of the token');
});

test('the escrow key material still derives from GOOGLE_CLIENT_SECRET', () => {
  // The escrow helper is not exported; pin the source contract directly so a
  // future refactor cannot silently point it at SESSION_SECRET and orphan
  // every code backup already in the field.
  const src = fs.readFileSync(new URL('../src/auth/admin-code.js', import.meta.url), 'utf8');
  assert.match(src, /env\.GOOGLE_CLIENT_SECRET/, 'escrow still reads the OAuth secret');
  assert.doesNotMatch(src, /env\.SESSION_SECRET/, 'escrow never reads the session secret');
});
