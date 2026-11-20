/* ============================================================
   test/no-dead-exports.test.mjs
   ------------------------------------------------------------
   Close-out Step 3d. Two constants survived the tier-table refactor
   as dead exports, and one comment still points at a harness that
   does not exist. No runtime test can see a dead export, so these
   are source-level checks against the three files the directive
   names. Every check here failed before 3d landed.
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(ROOT, f), 'utf8');

test('the retired MCP abuse-limit constants are gone from plan.js', () => {
  const src = read('src/mcp/plan.js');
  assert.ok(!/MCP_MAX_PENDING_PER_KEY/.test(src), 'dead pending cap export');
  assert.ok(!/MCP_MAX_DAILY_OPS_PER_KEY/.test(src), 'dead daily ops cap export');
});

test('the retired large-budget-per-day constant is gone from budget.js', () => {
  const src = read('src/lib/budget.js');
  assert.ok(!/BUDGET_LARGE_PER_DAY/.test(src), 'dead large-per-day export');
});

test('tier-limits.js names the real pricing-parity test, not a retired harness', () => {
  const src = read('src/mcp/tier-limits.js');
  assert.ok(!/tools\/qa-pricing-parity\.cjs/.test(src), 'stale harness path');
  assert.ok(/test\/tier-limits\.test\.mjs/.test(src), 'the check that actually pins the matrix');
});
