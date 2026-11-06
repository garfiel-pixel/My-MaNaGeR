/* ============================================================
   TURNSTILE GATE , contact and registration
   ------------------------------------------------------------
   Proves the shared gate (src/lib/turnstile.js) is wired into both
   new surfaces and runs BEFORE any validation, email send, HIBP
   lookup or D1 read. The reviews surface has its own end-to-end
   coverage in tools/qa-reviews.cjs; this file is the fast unit
   proof for the two surfaces added on 2026-11-05.
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';

import { handleContactCreate } from '../src/contact.js';
import { handleAuthRegister } from '../src/auth/session.js';
import { verifyTurnstileToken } from '../src/lib/turnstile.js';

const REAL_FETCH = globalThis.fetch;

function jsonRequest(path, body) {
  return new Request('https://example.test' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    duplex: 'half'
  });
}

function stubSiteverify(result) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  return calls;
}

function envWithSecret(extra) {
  return {
    TURNSTILE_SECRET: 'test-secret',
    TURNSTILE_SITEKEY: 'test-sitekey',
    TURNSTILE_VERIFY_URL: 'https://stub.test/siteverify',
    ...(extra || {})
  };
}

test.afterEach(() => {
  globalThis.fetch = REAL_FETCH;
});

test('contact: a missing token is refused before any work', async () => {
  const calls = stubSiteverify({ success: true });
  const res = await handleContactCreate(
    jsonRequest('/api/contact', {
      email: 'site@example.test',
      topic: 'Support',
      message: 'Please call me.'
    }),
    envWithSecret()
  );
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.match(body.error, /finish the check above before sending your message/);
  assert.equal(calls.length, 0, 'siteverify must not run without a token');
});

test('contact: a valid token passes the gate and reaches the mail path', async () => {
  const calls = stubSiteverify({ success: true });
  const res = await handleContactCreate(
    jsonRequest('/api/contact', {
      email: 'site@example.test',
      topic: 'Support',
      message: 'Please call me.',
      turnstileToken: 'good-token'
    }),
    envWithSecret()
  );
  // RESEND is deliberately unset, so the handler reports it could not send.
  // Reaching that branch proves the gate let the request through.
  assert.equal(res.status, 502);
  assert.equal(calls.length, 1);
  const sent = calls[0].init.body;
  assert.equal(sent.get('secret'), 'test-secret');
  assert.equal(sent.get('response'), 'good-token');
});

test('contact: no secret means the gate is off and behaviour is unchanged', async () => {
  const calls = stubSiteverify({ success: true });
  const res = await handleContactCreate(
    jsonRequest('/api/contact', {
      email: 'site@example.test',
      topic: 'Support',
      message: 'Please call me.'
    }),
    {}
  );
  assert.equal(res.status, 502);
  assert.equal(calls.length, 0);
});

test('register: a missing token is refused before D1 is touched', async () => {
  stubSiteverify({ success: true });
  const env = envWithSecret({
    DB: {
      prepare() {
        throw new Error('D1 must not be touched before the Turnstile gate');
      }
    }
  });
  const res = await handleAuthRegister(
    jsonRequest('/api/auth/register', {
      email: 'new@example.test',
      password: 'Correct-Horse-9!',
      name: 'New Operator'
    }),
    env
  );
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.match(body.error, /finish the check above before creating an account/);
});

test('register: a valid token passes the gate and reaches field validation', async () => {
  stubSiteverify({ success: true });
  const env = envWithSecret({
    DB: {
      prepare() {
        throw new Error('D1 must not be touched before the email check');
      }
    }
  });
  const res = await handleAuthRegister(
    jsonRequest('/api/auth/register', {
      email: 'not-an-email',
      password: 'Correct-Horse-9!',
      turnstileToken: 'good-token'
    }),
    env
  );
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'invalid email address');
});

test('register: no secret means the gate is off and behaviour is unchanged', async () => {
  stubSiteverify({ success: true });
  const res = await handleAuthRegister(
    jsonRequest('/api/auth/register', {
      email: 'not-an-email',
      password: 'Correct-Horse-9!'
    }),
    {}
  );
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'invalid email address');
});

test('shared gate: an oversize token is refused without calling siteverify', async () => {
  const calls = stubSiteverify({ success: true });
  const out = await verifyTurnstileToken('x'.repeat(5000), '', envWithSecret(), 'missing');
  assert.equal(out.ok, false);
  assert.match(out.error, /could not be read/);
  assert.equal(calls.length, 0);
});

test('shared gate: a failed verification refuses and does not leak the reason', async () => {
  stubSiteverify({ success: false, 'error-codes': ['invalid-input-response'] });
  const out = await verifyTurnstileToken('bad-token', '', envWithSecret(), 'missing');
  assert.equal(out.ok, false);
  assert.match(out.error, /did not pass/);
  assert.equal(out.error.includes('invalid-input-response'), false);
});
