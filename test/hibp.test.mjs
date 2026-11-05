/* ============================================================
   HIBP k-anonymity password screening (OWNER 2026-11-05)
   ------------------------------------------------------------
   passwordIsPwned() screens NEW and CHANGED passwords against the
   Have I Been Pwned range API. What these tests pin:

     - k-anonymity: only the first 5 hex of the SHA-1 ever leaves
       the Worker. The fetched URL ends in the prefix and never
       contains the suffix, so the password itself is never sent.
     - a pwned password (suffix present in the range response)
       returns true -> the handler rejects registration / change /
       reset with a breach message.
     - a clean password (suffix absent) returns false.
     - FAIL-OPEN: a network throw, a non-200, and the
       HIBP_ENABLED === 'false' kill-switch all return false, so a
       vendor outage or a deliberate disable can never lock a
       registrant out or block a legitimate password.
     - empty / missing password returns false without any fetch.

   The real fetch path against the live API is not exercised here;
   these unit tests mock globalThis.fetch and assert on the URL
   reached and the returned verdict.
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { passwordIsPwned } from '../src/lib/http.js';

// The code under test calls the Worker global `crypto.subtle`; ensure it
// resolves under node:test (node 20+ exposes globalThis.crypto, but guard).
if (!globalThis.crypto || !globalThis.crypto.subtle) {
  const { webcrypto } = await import('node:crypto');
  globalThis.crypto = webcrypto;
}

const HIBP_URL = 'https://api.pwnedpasswords.com/range/';

function sha1Hex(s) {
  return createHash('sha1').update(String(s), 'utf8').digest('hex').toUpperCase();
}
const prefixOf = s => sha1Hex(s).slice(0, 5);
const suffixOf = s => sha1Hex(s).slice(5);

// Run fn with a temporary global fetch, always restored afterwards.
async function withFetch(mock, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

test('k-anonymity: only the 5-char prefix leaves, never the suffix', async () => {
  const pw = 'SuperSecret123!';
  const suffix = suffixOf(pw);
  const prefix = prefixOf(pw);
  let calledUrl = null;
  const verdict = await withFetch(
    async (url, opts) => {
      calledUrl = String(url);
      assert.match(opts.headers['User-Agent'], /My-MaNaGeR/);
      return { ok: true, text: async () => `${suffix}:1\r\nABCDEF:2\r\n` };
    },
    () => passwordIsPwned(pw, {})
  );
  assert.equal(verdict, true, 'matching suffix means pwned');
  assert.equal(calledUrl, HIBP_URL + prefix, 'URL carries only the prefix');
  assert.ok(!calledUrl.includes(suffix), 'the suffix must never be sent');
});

test('a clean password (suffix absent from range) returns false', async () => {
  const pw = 'This-Is-A-Very-Unlikely-Pwned-Value-9f3a';
  const suffix = suffixOf(pw);
  const verdict = await withFetch(
    async () => ({
      ok: true,
      text: async () => `ZZZZZ1:1\r\nZZZZZ2:2\r\n`
    }),
    () => passwordIsPwned(pw, {})
  );
  assert.equal(verdict, false);
  assert.ok(suffix.length === 35, 'sanity: suffix is the remaining 35 hex chars');
});

test('HIBP_ENABLED === false is a hard kill-switch: no fetch, false verdict', async () => {
  let fetched = false;
  const verdict = await withFetch(
    async () => {
      fetched = true;
      return { ok: true, text: async () => '' };
    },
    () => passwordIsPwned('anything', { HIBP_ENABLED: 'false' })
  );
  assert.equal(fetched, false, 'no network call should be made when disabled');
  assert.equal(verdict, false);
});

test('empty / missing password returns false without fetching', async () => {
  let fetched = false;
  const mock = async () => {
    fetched = true;
    return { ok: true, text: async () => '' };
  };
  assert.equal(await withFetch(mock, () => passwordIsPwned('', {})), false);
  assert.equal(await withFetch(mock, () => passwordIsPwned(null, {})), false);
  assert.equal(await withFetch(mock, () => passwordIsPwned(undefined, {})), false);
  assert.equal(fetched, false, 'no fetch for empty input');
});

test('FAIL-OPEN: a thrown network error returns false, not a rejection', async () => {
  const verdict = await withFetch(
    async () => {
      throw new Error('network down');
    },
    () => passwordIsPwned('whatever', {})
  );
  assert.equal(verdict, false, 'an outage must not block the user');
});

test('FAIL-OPEN: a non-200 response returns false', async () => {
  const verdict = await withFetch(
    async () => ({
      ok: false,
      status: 503,
      text: async () => ''
    }),
    () => passwordIsPwned('whatever', {})
  );
  assert.equal(verdict, false);
});

test('case-insensitive suffix match still detects a pwned password', async () => {
  // The API returns hex in mixed case; our comparison upper-cases both.
  const pw = 'PwnedPass99';
  const suffix = suffixOf(pw).toLowerCase(); // lowercase to prove we normalize
  const verdict = await withFetch(
    async () => ({
      ok: true,
      text: async () => `${suffix}:42\r\n`
    }),
    () => passwordIsPwned(pw, {})
  );
  assert.equal(verdict, true, 'mixed-case suffix must still match');
});
