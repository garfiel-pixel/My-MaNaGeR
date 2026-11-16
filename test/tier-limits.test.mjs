/* ============================================================
   TIER LIMITS + PRICING PARITY (MCP-FINAL F2.1/F2.6, 2026-11-16)
   ------------------------------------------------------------
   The limits table lives in src/mcp/tier-limits.js. pricing.html publishes
   two of its columns. These tests pin both halves:

     - the table's five rows are the published matrix;
     - an unknown paid tier is contractor, an empty tier is free;
     - every number on pricing.html matches the table, so a plan change
       cannot ship on one side only.
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { limitsFor, TIER_LIMITS, perCallCap } from '../src/mcp/tier-limits.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the five rows are the published matrix', () => {
  const rows = ['free', 'estimator', 'contractor', 'company', 'enterprise'].map(t => {
    const l = TIER_LIMITS[t];
    return [
      l.activeApiKeys,
      l.pendingPerKey,
      l.dailyOpsPerKey,
      l.maxOpsPerCall,
      l.largeBudgetPerDay,
      l.reportRetentionDays
    ].join('/');
  });
  assert.deepEqual(rows, [
    '2/0/0/0/0/30',
    '2/10/300/100/5/30',
    '5/25/1000/250/10/60',
    '10/50/3000/500/20/90',
    '25/100/10000/500/50/180'
  ]);
});

test('unknown paid tiers read as contractor, an empty tier reads as free', () => {
  assert.equal(limitsFor('premium').tier, 'contractor');
  assert.equal(limitsFor('legacy_pro').tier, 'contractor');
  assert.equal(limitsFor('').tier, 'free');
  assert.equal(limitsFor(null).tier, 'free');
  assert.equal(limitsFor('ENTERPRISE').tier, 'enterprise');
});

test('the per-call cap never exceeds the array ceiling', () => {
  assert.equal(perCallCap(500, limitsFor('contractor')), 250);
  assert.equal(perCallCap(100, limitsFor('enterprise')), 100);
  assert.equal(perCallCap(500, limitsFor('company')), 500);
});

// The comparison table's column order: Feature, Free, Contractor, Estimator,
// Company, Enterprise.
const COLS = ['free', 'contractor', 'estimator', 'company', 'enterprise'];

function pricingRows() {
  const html = readFileSync(join(ROOT, 'pricing.html'), 'utf8');
  const rows = {};
  const re = /<tr><td>([^<]+)<\/td>((?:<td[^>]*>.*?<\/td>)+)<\/tr>/g;
  let m;
  while ((m = re.exec(html))) {
    const label = m[1].trim();
    const cells = [...m[2].matchAll(/<td[^>]*>(.*?)<\/td>/g)].map(c =>
      c[1]
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .trim()
    );
    if (cells.length === 5) {
      rows[label] = cells;
    }
  }
  return rows;
}

function numberIn(cell) {
  const m = String(cell).replace(/,/g, '').match(/\d+/);
  return m ? Number(m[0]) : null;
}

test('pricing.html publishes the API-key cap for every plan', () => {
  const rows = pricingRows();
  const cells = rows['Active API keys'];
  assert.ok(cells, 'the Active API keys row exists');
  COLS.forEach((tier, i) => {
    assert.equal(numberIn(cells[i]), TIER_LIMITS[tier].activeApiKeys, tier + ' key cap');
  });
  assert.match(cells[0], /MCP not included/);
});

test('pricing.html publishes the daily agent-change cap for every plan', () => {
  const rows = pricingRows();
  const cells = rows['Agent changes per day (per key)'];
  assert.ok(cells, 'the agent-changes row exists');
  COLS.forEach((tier, i) => {
    const expected = TIER_LIMITS[tier].dailyOpsPerKey;
    if (expected === 0) {
      assert.match(cells[i], /MCP not included/, tier + ' is not included');
    } else {
      assert.equal(numberIn(cells[i]), expected, tier + ' daily ops');
    }
  });
});
