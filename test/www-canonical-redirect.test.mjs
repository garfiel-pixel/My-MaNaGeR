/* ============================================================
   WWW CANONICAL REDIRECT (worker.js, 2026-11-24)
   ------------------------------------------------------------
   www.mymanagerworkspace.com is attached to the Worker as a
   custom domain, so the Worker itself must answer it. Serving
   the app on both hosts would split the host-only session
   cookie and break the OAuth redirect URIs (registered for the
   apex only), so www is a 301 to the apex with the path and
   query preserved.
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';

const ctx = { waitUntil() {}, passThroughOnException() {} };

test('www is permanently redirected to the apex host, path and query preserved', async () => {
  const res = await worker.fetch(
    new Request('https://www.mymanagerworkspace.com/pricing?plan=pro'),
    {},
    ctx
  );
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), 'https://mymanagerworkspace.com/pricing?plan=pro');
});

test('plain http on www lands on https at the apex host', async () => {
  const res = await worker.fetch(
    new Request('http://www.mymanagerworkspace.com/features'),
    {},
    ctx
  );
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), 'https://mymanagerworkspace.com/features');
});

test('the apex host itself is not redirected', async () => {
  const res = await worker.fetch(new Request('https://mymanagerworkspace.com/api/health'), {}, ctx);
  assert.notEqual(res.status, 301);
});
