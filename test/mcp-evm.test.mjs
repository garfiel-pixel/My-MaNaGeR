/* MCP EVM parity (MCP-AGENT-FIRST 2026-11-12 2.4).
   get_budget must report the same earned-value numbers as the dashboard.
   This test loads the client's own computeEVM (js/mmgr-evm.js) together with
   its Spend helpers (js/mmgr-resources.js), then compares every returned field
   with the server's get_budget.evm for the same state. No browser. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { executeTool } from '../src/mcp/server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const js = name => fs.readFileSync(path.join(here, '..', 'js', name), 'utf8');
const noop = () => {};

// Utils.parseDL is the client's date parser: local midnight, unlike the
// server's UTC parseISO. Every window below ends in the past, so both sides
// agree on the cumulative fraction regardless of the test machine's zone.
const sandbox = {
  window: {},
  console,
  setInterval: () => 0,
  clearInterval: noop
};
sandbox.window.MMGR = {
  Utils: {
    genId: p => (p || 'x') + '_1',
    genShortId: p => (p || 'x') + '001',
    todayStr: () => '2026-11-12',
    fmtDate: d => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '')),
    parseDL(str) {
      if (!str) {
        return null;
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
        const p = str.split('-').map(Number);
        return new Date(p[0], p[1] - 1, p[2]);
      }
      const d = new Date(str);
      return isNaN(d.getTime()) ? null : d;
    },
    addWorkingDays: d => d,
    daysBetween: () => 0,
    isOverdue: () => false,
    escapeHtml: v => String(v == null ? '' : v),
    $: () => null
  },
  Render: new Proxy({}, { get: () => noop }),
  State: { getState: () => null, updateState: fn => fn({}) },
  Process: { runRules: () => ({ messages: [], hooks: [] }) },
  App: { showToast: noop, dispatchHooks: noop }
};
vm.createContext(sandbox);
['mmgr-resources.js', 'mmgr-evm.js'].forEach(name => vm.runInContext(js(name), sandbox));
const client = sandbox.window.MMGR;

// Two lines: one linked to a completed task (EV credited in full), one
// unlinked (EV at the blanket completion ratio). Windows are in 2019-2020, so
// PV is fully planned on both sides. The spend log mixes received, paid and
// ordered entries and one future-dated receipt.
function fixture() {
  return {
    schemaVersion: 19,
    projectId: 'p-evm',
    tasks: [
      { id: 't1', name: 'A', status: 'completed', startDate: '2020-01-01', endDate: '2020-01-31' },
      { id: 't2', name: 'B', status: 'completed', startDate: '2020-01-01', endDate: '2020-01-31' },
      { id: 't3', name: 'C', status: 'todo', startDate: '2020-01-01', endDate: '2020-01-31' },
      { id: 't4', name: 'D', status: 'todo', startDate: '2020-01-01', endDate: '2020-01-31' }
    ],
    budgetLines: [
      {
        id: 'b1',
        name: 'Concrete',
        category: 'Materials',
        planned: 1000,
        linkedTaskId: 't1',
        curveShape: 'linear'
      },
      { id: 'b2', category: 'Labour', planned: 500, curveShape: 'scurve' }
    ],
    spendLog: [
      { id: 's1', budgetLineId: 'b1', amount: 400, date: '2020-01-10', status: 'received' },
      { id: 's2', budgetLineId: 'b1', amount: 50, date: '2020-01-15', status: 'ordered' },
      { id: 's3', budgetLineId: 'b2', amount: 100, date: '2020-01-20', status: 'paid' },
      { id: 's4', budgetLineId: 'b2', amount: 25, date: '2099-01-01', status: 'received' }
    ]
  };
}

const ALL = ['bud', 'wbs', 'charter'];

function budgetOf(state, scope) {
  const res = executeTool('get_budget', state, 'p-evm', 'test', scope, {}, null, state);
  assert.equal(res.isError, undefined, res.content[0].text);
  return JSON.parse(res.content[0].text);
}

test('get_budget.evm equals the client computeEVM field for field', () => {
  const state = fixture();
  const expected = client.Evm.compute(state);
  const got = budgetOf(state, ALL).evm;
  assert.ok(expected && got, 'both implementations return a value');
  const keys = Object.keys(expected).sort();
  assert.deepEqual(Object.keys(got).sort(), keys, 'same field set as the client');
  keys.forEach(k => {
    if (expected[k] === null) {
      assert.equal(got[k], null, k + ' is null on both');
    } else {
      assert.ok(
        Math.abs(got[k] - expected[k]) < 1e-9,
        k + ' matches (' + got[k] + ' vs ' + expected[k] + ')'
      );
    }
  });
});

test('each line says what actual counts and splits future spend', () => {
  const body = budgetOf(fixture(), ALL);
  const b1 = body.lines.find(l => l.id === 'b1');
  const b2 = body.lines.find(l => l.id === 'b2');
  assert.equal(b1.name, 'Concrete', 'name wins as the label');
  assert.equal(b1.label, 'Concrete');
  assert.equal(b2.name, 'Labour', 'a category-only line is labelled by category');
  assert.equal(b2.label, 'Labour');
  assert.match(b1.actualBasis, /spendLog: sum of 1 received\/paid entry/);
  assert.match(b2.actualBasis, /spendLog: sum of 2 received\/paid entry/);
  assert.equal(b1.actual, 400, 'ordered entries are committed, not spent');
  assert.equal(b1.committed, 50);
  assert.equal(b2.actual, 125);
  assert.equal(b2.actualToDate, 100, 'the 2099 receipt is future spend');
  assert.equal(b2.committedFuture, 25);
  assert.equal(body.totalActual, 525);
  assert.equal(body.evmNote, null, 'no note when nothing is null');
});

test('a line with no spend entries reports the stored lump sum as its basis', () => {
  const state = fixture();
  state.budgetLines.push({ id: 'b3', name: 'Plant', planned: 200, actual: 75 });
  const body = budgetOf(state, ALL);
  const b3 = body.lines.find(l => l.id === 'b3');
  assert.equal(b3.actual, 75);
  assert.match(b3.actualBasis, /line\.actual: stored lump sum/);
});

test('evmNote names the real reason EVM is null', () => {
  const noPlan = fixture();
  noPlan.budgetLines = [];
  const a = budgetOf(noPlan, ALL);
  assert.equal(a.evm, null);
  assert.match(a.evmNote, /no planned budget/);

  const noTasks = fixture();
  noTasks.tasks = [];
  const b = budgetOf(noTasks, ALL);
  assert.equal(b.evm, null);
  assert.match(b.evmNote, /no tasks/);

  const noSpend = fixture();
  noSpend.spendLog = [];
  noSpend.budgetLines = noSpend.budgetLines.map(l => ({ ...l, actual: 0 }));
  const c = budgetOf(noSpend, ALL);
  assert.ok(c.evm, 'EVM exists');
  assert.equal(c.evm.cpi, null);
  assert.match(c.evmNote, /CPI is null because actual cost is zero/);
});

test('a key without the WBS section gets a scope note, not a false no-tasks note', () => {
  const body = budgetOf(fixture(), ['bud']);
  assert.equal(body.evm, null);
  assert.match(body.evmNote, /WBS section is not granted/);
});
