import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDiffPath,
  normalizeDiff,
  normalizeProposalDiffs,
  valuesEqual,
  getPathValue,
  setPathValue,
  deletePathValue,
  diffKey,
  enrichDiffs,
  applyLeafDiffs
} from '../src/cloud/proposal-diffs.js';

test('parseDiffPath splits array and object leaves', () => {
  assert.deepEqual(parseDiffPath('tasks[0].status'), {
    path: 'tasks',
    index: 0,
    field: 'status'
  });
  assert.deepEqual(parseDiffPath('budgetLines[2].planned'), {
    path: 'budgetLines',
    index: 2,
    field: 'planned'
  });
  assert.deepEqual(parseDiffPath('dmaic.define.problem'), {
    path: 'dmaic',
    index: null,
    field: 'define.problem'
  });
  assert.deepEqual(parseDiffPath('closure.lessons[0].text'), {
    path: 'closure',
    index: null,
    field: 'lessons[0].text'
  });
  assert.equal(parseDiffPath('__proto__.x'), null);
  assert.equal(parseDiffPath('tasks[0].__proto__'), null);
  assert.equal(parseDiffPath('nonsense'), null);
});

test('normalizeDiff turns a legacy flat leaf into a record diff', () => {
  const d = normalizeDiff({ path: 'tasks[3].endDate', before: '2026-01-01', after: '2026-02-01' });
  assert.equal(d.path, 'tasks');
  assert.equal(d.index, 3);
  assert.equal(d.field, 'endDate');
  assert.equal(d.fullPath, 'tasks[3].endDate');
  assert.equal(d.recordId, '');
});

test('normalizeDiff keeps a structured MCP diff', () => {
  const d = normalizeDiff({
    path: 'tasks',
    recordId: 't_1',
    field: 'status',
    before: 'todo',
    after: 'inprogress'
  });
  assert.equal(d.path, 'tasks');
  assert.equal(d.recordId, 't_1');
  assert.equal(d.field, 'status');
  assert.equal(d.fullPath, 'tasks.status');
  assert.equal(d.index, null);
});

test('normalizeProposalDiffs dedupes last-wins and caps', () => {
  const out = normalizeProposalDiffs(
    [
      { path: 'tasks[0].status', before: 'todo', after: 'inprogress' },
      { path: 'tasks[0].status', before: 'todo', after: 'blocked' },
      { path: 'tasks[1].status', before: 'todo', after: 'completed' },
      { path: 'nonsense' }
    ],
    1
  );
  assert.equal(out.total, 2);
  assert.equal(out.diffs.length, 1);
  assert.equal(out.truncated, true);
  assert.equal(out.diffs[0].after, 'blocked');
});

test('diffKey is stable', () => {
  const a = normalizeDiff({ path: 'risks', recordId: 'r1', field: 'mitigation', after: 'x' });
  const b = normalizeDiff({ path: 'risks', recordId: 'r1', field: 'mitigation', after: 'y' });
  assert.equal(diffKey(a), diffKey(b));
});

test('valuesEqual treats null and undefined as absent, not stale', () => {
  assert.equal(valuesEqual(null, undefined), true);
  assert.equal(valuesEqual(1, '1'), true);
  assert.equal(valuesEqual('', null), false);
  assert.equal(valuesEqual({ a: 1 }, { a: 1 }), true);
  assert.equal(valuesEqual({ a: 1 }, { a: 2 }), false);
});

test('normalizeDiff keeps a bare scalar top-level key', () => {
  const d = normalizeDiff({ path: 'budgetEnvelope', before: 1000, after: 2500 });
  assert.equal(d.path, 'budgetEnvelope');
  assert.equal(d.field, '');
  assert.equal(d.fullPath, 'budgetEnvelope');
  assert.deepEqual(d.surfaces, ['Budget', 'Dashboard', 'Reports']);
  assert.equal(normalizeDiff({ path: 'nonsense', after: 1 }), null);
});

test('enrichDiffs stamps the record id, name and surfaces', () => {
  const prev = { tasks: [{ id: 't1', name: 'Site survey', status: 'todo' }] };
  const next = { tasks: [{ id: 't1', name: 'Site survey', status: 'inprogress' }] };
  const out = enrichDiffs(
    [{ path: 'tasks[0].status', before: 'todo', after: 'inprogress' }],
    prev,
    next
  );
  assert.equal(out.total, 1);
  const d = out.diffs[0];
  assert.equal(d.recordId, 't1');
  assert.equal(d.recordName, 'Site survey');
  assert.deepEqual(d.surfaces, ['Kanban board', 'WBS / Tasks', 'Dashboard']);
  assert.equal(d.fullPath, 'tasks[0].status');
});

test('enrichDiffs resolves a created record from the next state', () => {
  const prev = { risks: [] };
  const next = { risks: [{ id: 'r9', name: 'Asbestos survey overdue' }] };
  const out = enrichDiffs(
    [{ path: 'risks[0].name', before: null, beforeAbsent: true, after: 'Asbestos survey overdue' }],
    prev,
    next
  );
  assert.equal(out.diffs[0].recordId, 'r9');
  assert.equal(out.diffs[0].recordName, 'Asbestos survey overdue');
  assert.equal(out.diffs[0].beforeAbsent, true);
});

test('applyLeafDiffs applies to current state and detects stale', () => {
  const prev = { tasks: [{ id: 't1', status: 'todo', name: 'A' }] };
  const ok = applyLeafDiffs(prev, [
    { path: 'tasks', recordId: 't1', field: 'status', before: 'todo', after: 'inprogress' }
  ]);
  assert.equal(ok.stale.length, 0);
  assert.equal(ok.changed, 1);
  assert.equal(ok.submitted.tasks[0].status, 'inprogress');
  // prev is untouched
  assert.equal(prev.tasks[0].status, 'todo');

  const stale = applyLeafDiffs(prev, [
    { path: 'tasks', recordId: 't1', field: 'status', before: 'blocked', after: 'completed' }
  ]);
  assert.equal(stale.changed, 0);
  assert.equal(stale.stale.length, 1);
  assert.equal(stale.stale[0].actual, 'todo');
});

test('applyLeafDiffs appends a created record from the submission', () => {
  const prev = { risks: [] };
  const submitted = { risks: [{ id: 'r9', name: 'Asbestos survey overdue', owner: 'PM' }] };
  const out = applyLeafDiffs(
    prev,
    [
      {
        path: 'risks',
        recordId: 'r9',
        field: 'name',
        beforeAbsent: true,
        after: 'Asbestos survey overdue'
      },
      { path: 'risks', recordId: 'r9', field: 'owner', beforeAbsent: true, after: 'PM' }
    ],
    submitted
  );
  assert.equal(out.stale.length, 0);
  assert.equal(out.changed, 2);
  assert.equal(out.submitted.risks.length, 1);
  assert.equal(out.submitted.risks[0].name, 'Asbestos survey overdue');
});

test('applyLeafDiffs starts a missing section for a created record', () => {
  // A project whose first meeting/log entry arrives through a proposal has no
  // live array yet. The create must seed it, not refuse the whole accept as
  // "not_a_list" (qa-api-keys P18c caught this).
  const prev = {};
  const submitted = {
    logEntries: [{ id: 'mcp_1', title: 'P18 decision', date: '2026-10-27' }]
  };
  const out = applyLeafDiffs(
    prev,
    [
      { path: 'logEntries', recordId: 'mcp_1', field: 'id', beforeAbsent: true, after: 'mcp_1' },
      {
        path: 'logEntries',
        recordId: 'mcp_1',
        field: 'title',
        beforeAbsent: true,
        after: 'P18 decision'
      }
    ],
    submitted
  );
  assert.equal(out.unaddressable.length, 0);
  assert.equal(out.stale.length, 0);
  assert.equal(out.changed, 2);
  assert.equal(out.submitted.logEntries.length, 1);
  assert.equal(out.submitted.logEntries[0].title, 'P18 decision');
});

test('applyLeafDiffs sets a scalar top-level key', () => {
  const out = applyLeafDiffs({ budgetEnvelope: 1000 }, [
    { path: 'budgetEnvelope', before: 1000, after: 2500 }
  ]);
  assert.equal(out.stale.length, 0);
  assert.equal(out.changed, 1);
  assert.equal(out.submitted.budgetEnvelope, 2500);
});

test('applyLeafDiffs writes a nested object-section field', () => {
  const out = applyLeafDiffs({ dmaic: { define: { problem: 'old' } } }, [
    { path: 'dmaic', field: 'define.problem', before: 'old', after: 'new' }
  ]);
  assert.equal(out.stale.length, 0);
  assert.equal(out.changed, 1);
  assert.equal(out.submitted.dmaic.define.problem, 'new');
});

test('applyLeafDiffs creates a missing object section', () => {
  const out = applyLeafDiffs({}, [
    { path: 'dmaic', field: 'define.problem', beforeAbsent: true, after: 'x' }
  ]);
  assert.equal(out.stale.length, 0);
  assert.equal(out.submitted.dmaic.define.problem, 'x');
});

test('applyLeafDiffs falls back to the array index for legacy diffs', () => {
  const out = applyLeafDiffs({ tasks: [{ id: 't1', status: 'todo' }] }, [
    { path: 'tasks[0].status', before: 'todo', after: 'completed' }
  ]);
  assert.equal(out.stale.length, 0);
  assert.equal(out.submitted.tasks[0].status, 'completed');
});

test('path helpers read, write and delete nested fields', () => {
  const obj = { dmaic: { define: { problem: 'old' } }, closure: { lessons: [{ text: 'a' }] } };
  assert.equal(getPathValue(obj.dmaic, 'define.problem'), 'old');
  setPathValue(obj.dmaic, 'define.problem', 'new');
  assert.equal(obj.dmaic.define.problem, 'new');
  setPathValue(obj.closure, 'lessons[0].text', 'b');
  assert.equal(obj.closure.lessons[0].text, 'b');
  deletePathValue(obj.dmaic, 'define.problem');
  assert.equal(obj.dmaic.define.problem, undefined);
  assert.equal(setPathValue(obj.dmaic, '__proto__.x', 1), false);
});
