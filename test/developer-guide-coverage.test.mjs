/* ============================================================
   test/developer-guide-coverage.test.mjs
   ------------------------------------------------------------
   Close-out Step 3e. The Developer Guide is the map a future
   session reads before touching the MCP tier table, the auto-accept
   policy or the dashboard navigation. These three topics were
   named explicitly by the directive, so each needs a source-level
   assertion that fails when the section is removed or left abstract.
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const doc = readFileSync(join(ROOT, 'docs', 'DEVELOPER-GUIDE.md'), 'utf8');

test('the guide publishes the tier matrix and the limitsFor lookup', () => {
  assert.ok(/\blimitsFor\(/.test(doc), 'limitsFor is named');
  for (const tier of ['free', 'estimator', 'contractor', 'company', 'enterprise']) {
    assert.ok(new RegExp('\\|\\s*`?' + tier + '`?\\s*\\|').test(doc), tier + ' row in the table');
  }
  for (const column of ['activeApiKeys', 'dailyOpsPerKey', 'maxOpsPerCall']) {
    assert.ok(doc.includes(column), column + ' column documented');
  }
  assert.ok(/test\/tier-limits\.test\.mjs/.test(doc), 'the test that pins the matrix');
});

test('the guide documents auto-accept and its Company/Enterprise restriction', () => {
  assert.ok(/autoAcceptEligible/.test(doc), 'the eligibility predicate');
  assert.ok(/mcpAutoAccept|autoAcceptPlanAllowed/.test(doc), 'the plan gate');
  assert.ok(/Company.*Enterprise/.test(doc), 'the two plans that may raise it');
  assert.ok(/upgradeRequired/.test(doc), 'the server refusal contract');
  assert.ok(/qa-autoaccept-ui/.test(doc), 'the admin-panel harness');
});

test('the guide carries a concrete Nav.go link inventory', () => {
  assert.ok(/Nav\.go\(/.test(doc), 'Nav.go entry point');
  assert.ok(/qa-dashboard-links\.cjs/.test(doc), 'the harness that pins the inventory');
  assert.ok(/data-nav-panel/.test(doc), 'the markup contract');
  for (const target of ['overdue', 'blocked', 'atrisk', 'issues', 'recordId', 'column', 'anchor']) {
    assert.ok(doc.includes(target), 'link target ' + target);
  }
});
