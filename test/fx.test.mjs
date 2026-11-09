/* ============================================================
   FX - USD to JMD estimate (A, 2026-11-09)
   ------------------------------------------------------------
   Paddle does not settle in JMD, so every J$ figure on the pricing page is
   an estimate at a rate this module owns. These tests pin the three rules
   that keep a broken feed from publishing a wrong number:

     - a candidate outside 100..250 is refused;
     - a candidate more than 5% away from the stored value is refused;
     - data older than 14 days reports available:false so the page hides
       the estimate instead of showing a stale one.

   They also pin the rounding contract (nearest J$100) and the two labels
   the page must carry: every price states USD, and the J$ line says the
   charge itself is in USD.
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  FX_MAX,
  FX_MAX_JUMP,
  FX_MIN,
  FX_STALE_MS,
  JMD_PER_USD_SEED,
  SEED_AS_OF,
  fxAccept,
  fxAvailable,
  fxNewest,
  fxRateFromPayload,
  fxRead,
  fxRoundJmd
} from '../src/fx.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('rounding lands on the nearest J$100', () => {
  assert.equal(fxRoundJmd(18.99, 158), 3000);
  assert.equal(fxRoundJmd(49.99, 158), 7900);
  assert.equal(fxRoundJmd(200, 158), 31600);
  assert.equal(fxRoundJmd(0, 158), 0);
  assert.equal(fxRoundJmd(1.01, 158), 200);
  assert.equal(fxRoundJmd('not a number', 158), null);
});

test('a candidate outside the sanity band is refused', () => {
  assert.equal(fxAccept(FX_MIN - 1, JMD_PER_USD_SEED), false);
  assert.equal(fxAccept(FX_MAX + 1, JMD_PER_USD_SEED), false);
  assert.equal(fxAccept('abc', JMD_PER_USD_SEED), false);
  assert.equal(fxAccept(NaN, JMD_PER_USD_SEED), false);
});

test('a candidate more than 5% from the stored value is refused', () => {
  assert.equal(fxAccept(158 * (1 + FX_MAX_JUMP + 0.001), 158), false);
  assert.equal(fxAccept(158 * (1 - FX_MAX_JUMP - 0.001), 158), false);
  assert.equal(fxAccept(158 * (1 + FX_MAX_JUMP - 0.001), 158), true);
});

test('a first run with no stored value accepts any in-band rate', () => {
  assert.equal(fxAccept(157.5, null), true);
  assert.equal(fxAccept(157.5, undefined), true);
});

test('the feed shape is read from usd.jmd only', () => {
  assert.equal(fxRateFromPayload({ usd: { jmd: 157.9 } }), 157.9);
  assert.equal(fxRateFromPayload({ usd: { jmd: '158.2' } }), 158.2);
  assert.equal(fxRateFromPayload({ usd: {} }), null);
  assert.equal(fxRateFromPayload(null), null);
});

test('the seed wins when there is no stored record', () => {
  const rec = fxNewest(null);
  assert.equal(rec.rate, JMD_PER_USD_SEED);
  assert.equal(rec.asOf, SEED_AS_OF);
});

test('a stored record newer than the seed is used', () => {
  const rec = fxNewest({ rate: 160, asOf: '2026-11-10', source: 'test' });
  assert.equal(rec.rate, 160);
  assert.equal(rec.asOf, '2026-11-10');
});

test('data older than 14 days reports unavailable', () => {
  const now = Date.parse('2026-11-09T12:00:00Z');
  assert.equal(fxAvailable({ rate: 158, asOf: '2026-11-09' }, now), true);
  assert.equal(fxAvailable({ rate: 158, asOf: '2026-11-01' }, now - FX_STALE_MS + 1000), true);
  assert.equal(fxAvailable({ rate: 158, asOf: '2026-10-01' }, now), false);
});

test('fxRead falls back to the seed and stays available today', async () => {
  const fx = await fxRead({});
  assert.equal(fx.jmdPerUsd, JMD_PER_USD_SEED);
  assert.equal(fx.asOf, SEED_AS_OF);
  assert.equal(fx.available, true);
});

test('fxRead reports unavailable once the newest record is 14 days old', async () => {
  const later = Date.parse('2026-12-01T12:00:00Z');
  const fx = await fxRead({}, later);
  assert.equal(fx.available, false);
});

test('every price on pricing.html carries a USD label', () => {
  const html = readFileSync(join(ROOT, 'pricing.html'), 'utf8');
  const prices = html.match(/<p class="pc-price"[^>]*>[\s\S]*?<\/p>/g) || [];
  assert.ok(prices.length >= 5, 'expected at least five price cards');
  prices.forEach(function (block) {
    assert.match(block, /\bUSD\b/, 'a price block is missing its USD label: ' + block);
  });
});

test('the J$ line states that the charge itself is in USD', () => {
  const js = readFileSync(join(ROOT, 'js', 'pricing-fx.js'), 'utf8');
  assert.match(js, /billed in USD/);
  assert.match(js, /Your bank sets the exact amount charged/);
});
