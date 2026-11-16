/* MCP get_schema (MCP-AGENT-FIRST 2026-11-12 2.5).
   The tool must describe exactly the model the planner validates against -
   no hand-written copy - and must hide tables outside the key's sections. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeTool } from '../src/mcp/server.js';
import {
  describeSchema,
  LIST_PATHS,
  SECTION_PATHS,
  STRING_MAX,
  SHORT_MAX,
  ID_MAX
} from '../src/mcp/model.js';
import {
  MCP_MAX_DIFFS,
  MCP_MAX_CREATES,
  MCP_MAX_SETS,
  MCP_WRITE_BUDGET_MS
} from '../src/mcp/plan.js';
import { limitsFor, perCallCap } from '../src/mcp/tier-limits.js';
import { BUDGET_PROPOSAL_LIMIT, BUDGET_LARGE_ABS, BUDGET_LINE_FIELDS } from '../src/lib/budget.js';

const state = { schemaVersion: 19, projectId: 'p-schema', tasks: [], budgetLines: [] };

function schema(scope, args, tier) {
  const res = executeTool(
    'get_schema',
    state,
    'p-schema',
    'test',
    scope,
    args || {},
    null,
    state,
    tier
  );
  return { res, body: res.isError ? null : JSON.parse(res.content[0].text) };
}

test('every list and section is described exactly as the model says', () => {
  const { body } = schema(null, {});
  assert.deepEqual(Object.keys(body.tables).sort(), LIST_PATHS.concat(SECTION_PATHS).sort());
  LIST_PATHS.concat(SECTION_PATHS).forEach(p => {
    assert.deepEqual(body.tables[p], describeSchema(p), p + ' equals describeSchema');
  });
});

test('the limits are the effective limits for the owner tier', () => {
  const { body } = schema(null, {});
  // No tier given reads as the paid default (contractor); production always
  // passes the project owner's real tier.
  const l = limitsFor('contractor');
  assert.deepEqual(body.limits, {
    tier: 'contractor',
    maxDiffs: perCallCap(MCP_MAX_DIFFS, l),
    maxCreates: perCallCap(MCP_MAX_CREATES, l),
    maxSets: perCallCap(MCP_MAX_SETS, l),
    maxOpsPerCall: l.maxOpsPerCall,
    writeBudgetMs: MCP_WRITE_BUDGET_MS,
    stringMax: STRING_MAX,
    shortMax: SHORT_MAX,
    idMax: ID_MAX,
    tempIdMax: 40,
    budgetProposalLimit: BUDGET_PROPOSAL_LIMIT,
    largeChangeAbs: BUDGET_LARGE_ABS,
    largeChangePerDay: l.largeBudgetPerDay,
    budgetLineFields: BUDGET_LINE_FIELDS,
    maxPendingPerKey: l.pendingPerKey,
    maxDailyOpsPerKey: l.dailyOpsPerKey,
    maxActiveApiKeys: l.activeApiKeys,
    reportRetentionDays: l.reportRetentionDays
  });
  assert.equal(body.changeSet.atomic, true);
});

test('the schema limits follow the tier it is asked for', () => {
  const ent = schema(null, {}, 'enterprise').body.limits;
  assert.equal(ent.tier, 'enterprise');
  assert.equal(ent.maxPendingPerKey, 100);
  assert.equal(ent.maxDailyOpsPerKey, 10000);
  const est = schema(null, {}, 'estimator').body.limits;
  assert.equal(est.tier, 'estimator');
  assert.equal(est.maxDiffs, 100);
});

test('a key with only the Budget section sees only budget tables', () => {
  const { body } = schema(['bud'], {});
  assert.deepEqual(Object.keys(body.tables).sort(), ['budgetEnvelope', 'budgetLines', 'spendLog']);
});

test('a table outside the grant is refused; a granted one is returned alone', () => {
  const refused = schema(['bud'], { table: 'tasks' });
  assert.equal(refused.res.isError, true);
  assert.match(refused.res.content[0].text, /does not include that section/);
  assert.match(refused.res.content[0].text, /bud/);

  const one = schema(['bud'], { table: 'budgetLines' });
  assert.equal(one.res.isError, undefined);
  assert.deepEqual(one.body.table, describeSchema('budgetLines'));
});

test('an unknown table names the available ones', () => {
  const { res } = schema(['bud'], { table: 'nope' });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /Unknown table: nope/);
  assert.match(res.content[0].text, /budgetLines/);
  assert.doesNotMatch(res.content[0].text, /tasks/);
});

test('field flags the agent relies on are present', () => {
  const { body } = schema(null, {});
  const task = body.tables.tasks.fields;
  assert.deepEqual(task.status.enum, ['todo', 'inprogress', 'blocked', 'completed']);
  assert.equal(task.critical.derived, true);
  assert.equal(task.startDate.derivedWhen, 'isPhase');
  assert.equal(body.tables.risks.fields.description.alias, 'name');
  assert.equal(body.tables.budgetLines.writeVia, 'budget');
  assert.equal(body.tables.budgetLines.deletable, false);
});
