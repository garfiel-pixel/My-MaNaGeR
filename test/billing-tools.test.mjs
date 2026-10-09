import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseWranglerRows, isReadOnly } = require('../tools/d1-remote.cjs');
const { probe, verdict } = require('../tools/diag-paddle-sub.cjs');

const SID = 'sub_01m4e4v5652cz8vsgsz0eeaq96';

// The exact output shape that cost a terminal session hours: a banner, a
// "[WARNING]" line (contains "["), then a JSON ARRAY of per-statement results.
const WRANGLER_OUT =
  ' \u26C5 wrangler 4.127.1 (update available 4.148.0)\n' +
  'Resource location: remote \n' +
  '\u25B2 [WARNING] Processing wrangler.jsonc configuration:\n' +
  '    - Unexpected fields found in assets field: "exclude"\n\n' +
  '[\n  {\n    "results": [\n' +
  '      {"rowid":5,"owner_sub":"118128564657302334748","ls_subscription_id":"' +
  SID +
  '","status":"active"},\n' +
  '      {"rowid":4,"owner_sub":"101395870899174003981","ls_subscription_id":"sub_01m4cz78b7c1m39evy1vdbsq76","status":"on_trial"}\n' +
  '    ],\n    "success": true,\n    "meta": {"served_by":"v3-prod"}\n  }\n]\n';

test('d1-remote: reads the rows out of a banner + [WARNING] + array-of-results output', () => {
  const rows = parseWranglerRows(WRANGLER_OUT);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].ls_subscription_id, SID);
});

test('d1-remote: clean --json output, empty results, and garbage', () => {
  assert.deepEqual(parseWranglerRows('[{"results":[{"a":1}],"success":true}]'), [{ a: 1 }]);
  assert.deepEqual(parseWranglerRows('[{"results":[],"success":true}]'), []);
  assert.throws(() => parseWranglerRows('Error: no such table'), /no JSON/);
});

test('d1-remote: refuses anything that is not a single SELECT or PRAGMA', () => {
  assert.equal(isReadOnly('SELECT * FROM cloud_subscriptions;'), true);
  for (const bad of [
    'DELETE FROM cloud_subscriptions',
    'UPDATE x SET a=1',
    'SELECT 1; DROP TABLE x',
    'DROP TABLE x',
    'INSERT INTO x VALUES(1)'
  ])
    assert.equal(isReadOnly(bad), false, bad);
});

const okRes = async () => ({
  ok: true,
  status: 200,
  json: async () => ({
    data: {
      status: 'active',
      customer_id: 'ctm_1',
      next_billed_at: '2026-11-08T16:16:48Z',
      current_billing_period: { ends_at: '2026-11-08T16:16:48Z' },
      scheduled_change: null,
      items: [{ price: { id: 'pri_x' } }]
    }
  })
});
const notFound = async () => ({
  ok: false,
  status: 404,
  json: async () => ({ error: { code: 'not_found', detail: 'Entity not found' } })
});

test('diag-paddle-sub: probes the right host per environment and reads the result', async () => {
  const urls = [];
  const spy = impl => async (u, i) => {
    urls.push(u);
    return impl(u, i);
  };
  const live = await probe('live', 'k_live', SID, spy(okRes));
  const sbx = await probe('sandbox', 'k_sbx', SID, spy(notFound));
  assert.deepEqual(urls, [
    'https://api.paddle.com/subscriptions/' + SID,
    'https://sandbox-api.paddle.com/subscriptions/' + SID
  ]);
  assert.equal(live.status, 'active');
  assert.equal(sbx.code, 'not_found');
  assert.match(verdict(live, sbx), /^LIVE/);
  assert.match(verdict(sbx, live), /^SANDBOX ONLY/);
  assert.match(verdict(sbx, sbx), /^NOT FOUND/);
  assert.match(verdict({ skipped: true }, { skipped: true }), /^NO KEYS/);
});

test('diag-paddle-sub: a pri_ id is probed on /prices/ and a txn_ id is refused', async () => {
  const urls = [];
  const priceRes = async u => {
    urls.push(u);
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { status: 'active', product_id: 'pro_1', name: 'Enterprise' } })
    };
  };
  const r = await probe('live', 'k', 'pri_01abc', priceRes);
  assert.equal(urls[0], 'https://api.paddle.com/prices/pri_01abc');
  assert.equal(r.product, 'pro_1');
  assert.equal((await probe('live', 'k', 'txn_01abc')).invalidId, true);
});

test('diag-paddle-sub: skips a missing key, rejects a non sub_ id, never echoes the key', async () => {
  assert.equal((await probe('live', '', SID)).skipped, true);
  assert.equal((await probe('live', 'k', 'txn_123')).invalidId, true);
  const r = await probe('live', 'k_secret_value', SID, okRes);
  assert.ok(!JSON.stringify(r).includes('k_secret_value'));
});
