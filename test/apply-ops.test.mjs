/* Pure accept engine (MCP-AGENT-FIRST 2026-11-12, 3.4).
   Every branch of src/cloud/apply-ops.js: supersession against the pre-state,
   idempotent re-accept, cycle rollback, delete refused by a budget reference,
   delete strips survivor predecessors, non-deletable + scope conflicts, stale
   before, enum hard-failure, and the derived-null fallback. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOps } from '../src/cloud/apply-ops.js';
import { fieldSpec, getList, getSection, isDeletable } from '../src/mcp/model.js';

const model = { fieldSpec, getList, getSection, isDeletable };
const base = () => ({
  schemaVersion: 19,
  tasks: [
    { id: 't1', name: 'A', status: 'todo', predecessors: [] },
    { id: 't2', name: 'B', status: 'todo', predecessors: ['t1'] },
    { id: 't3', name: 'P', isPhase: true }
  ],
  budgetLines: [{ id: 'b1', name: 'Concrete', planned: 1000, taskId: 't1' }]
});

test('a set applies against the pre-state and reports applied', () => {
  const r = applyOps(
    base(),
    [
      {
        id: 10,
        scope: ['wbs'],
        ops: [
          {
            op: 'set',
            path: 'tasks',
            recordId: 't1',
            field: 'status',
            before: 'todo',
            after: 'completed'
          }
        ]
      }
    ],
    { model }
  );
  assert.equal(r.hardFailure, null);
  const e = r.report.find(x => x.result === 'applied');
  assert.ok(e);
  assert.equal(r.next.tasks[0].status, 'completed');
  assert.equal(e.before, 'todo');
});

test('a set whose after already matches the live value is skipped_already', () => {
  const r = applyOps(
    base(),
    [
      {
        id: 10,
        scope: ['wbs'],
        ops: [
          {
            op: 'set',
            path: 'tasks',
            recordId: 't1',
            field: 'status',
            before: 'todo',
            after: 'todo'
          }
        ]
      }
    ],
    { model }
  );
  assert.equal(r.report[0].result, 'skipped_already');
  assert.equal(r.next.tasks[0].status, 'todo');
});

test('a set whose before no longer matches is a conflict and the live value stays', () => {
  const st = base();
  st.tasks[0].status = 'inprogress';
  const r = applyOps(
    st,
    [
      {
        id: 10,
        scope: ['wbs'],
        ops: [
          {
            op: 'set',
            path: 'tasks',
            recordId: 't1',
            field: 'status',
            before: 'todo',
            after: 'completed'
          }
        ]
      }
    ],
    { model }
  );
  assert.equal(r.report[0].result, 'conflict');
  assert.equal(r.next.tasks[0].status, 'inprogress');
});

test('a later op on the same target supersedes the earlier one', () => {
  const r = applyOps(
    base(),
    [
      {
        id: 10,
        scope: ['wbs'],
        ops: [
          {
            op: 'set',
            path: 'tasks',
            recordId: 't1',
            field: 'status',
            before: 'todo',
            after: 'inprogress'
          },
          {
            op: 'set',
            path: 'tasks',
            recordId: 't1',
            field: 'status',
            before: 'todo',
            after: 'completed'
          }
        ]
      }
    ],
    { model }
  );
  assert.equal(r.next.tasks[0].status, 'completed');
  assert.equal(r.report[0].result, 'superseded');
  assert.equal(r.report[1].result, 'applied');
});

test('idempotent re-accept: the same ops on the accepted state all skip', () => {
  const first = applyOps(
    base(),
    [
      {
        id: 10,
        scope: ['wbs'],
        ops: [
          {
            op: 'set',
            path: 'tasks',
            recordId: 't1',
            field: 'status',
            before: 'todo',
            after: 'completed'
          }
        ]
      }
    ],
    { model }
  );
  const second = applyOps(
    first.next,
    [
      {
        id: 10,
        scope: ['wbs'],
        ops: [
          {
            op: 'set',
            path: 'tasks',
            recordId: 't1',
            field: 'status',
            before: 'todo',
            after: 'completed'
          }
        ]
      }
    ],
    { model }
  );
  assert.equal(second.report[0].result, 'skipped_already');
});

test('a create inserts; a repeat create with the same id skips', () => {
  const r = applyOps(
    base(),
    [
      {
        id: 10,
        scope: ['wbs'],
        ops: [{ op: 'create', path: 'tasks', record: { id: 't9', name: 'New', status: 'todo' } }]
      }
    ],
    { model }
  );
  assert.equal(r.next.tasks.length, 4);
  assert.equal(r.report[0].result, 'applied');
  const again = applyOps(
    r.next,
    [
      {
        id: 11,
        scope: ['wbs'],
        ops: [{ op: 'create', path: 'tasks', record: { id: 't9', name: 'New', status: 'todo' } }]
      }
    ],
    { model }
  );
  assert.equal(again.report[0].result, 'skipped_already');
  assert.equal(again.next.tasks.length, 4);
});

test('a create that revalidates an out-of-enum status is refused', () => {
  const r = applyOps(
    base(),
    [
      {
        id: 10,
        scope: ['wbs'],
        ops: [{ op: 'create', path: 'tasks', record: { id: 't9', name: 'New', status: 'done' } }]
      }
    ],
    { model }
  );
  assert.equal(r.report[0].result, 'conflict');
  assert.match(r.report[0].reason, /not one of/);
  assert.equal(r.next.tasks.length, 3);
});

test('a delete of a referenced task is refused', () => {
  const r = applyOps(
    base(),
    [{ id: 10, scope: ['wbs'], ops: [{ op: 'delete', path: 'tasks', recordId: 't1' }] }],
    { model }
  );
  assert.equal(r.report[0].result, 'conflict');
  assert.match(r.report[0].reason, /budget line/);
  assert.equal(r.next.tasks.length, 3);
});

test('a delete of an unreferenced task removes it and strips survivor predecessors', () => {
  const r = applyOps(
    base(),
    [{ id: 10, scope: ['wbs'], ops: [{ op: 'delete', path: 'tasks', recordId: 't2' }] }],
    { model }
  );
  assert.equal(r.report[0].result, 'applied');
  assert.equal(r.next.tasks.length, 2);
  // t2 was t1's predecessor; deleting t2 must strip it from t1.
  assert.equal(r.next.tasks[0].predecessors.length, 0);
});

test('deleting a phase that still has children is refused', () => {
  const st = base();
  st.tasks[2].isPhase = true;
  st.tasks.push({ id: 't4', name: 'child', status: 'todo', parentName: 'P', predecessors: [] });
  const r = applyOps(
    st,
    [{ id: 10, scope: ['wbs'], ops: [{ op: 'delete', path: 'tasks', recordId: 't3' }] }],
    { model }
  );
  assert.equal(r.report[0].result, 'conflict');
  assert.match(r.report[0].reason, /child tasks/);
});

test('a non-deletable list (budgetLines) refuses delete', () => {
  const r = applyOps(
    base(),
    [{ id: 10, scope: ['bud'], ops: [{ op: 'delete', path: 'budgetLines', recordId: 'b1' }] }],
    { model }
  );
  assert.equal(r.report[0].result, 'conflict');
  assert.match(r.report[0].reason, /not deletable/);
});

test('an op outside the granted scope is a conflict', () => {
  const r = applyOps(
    base(),
    [
      {
        id: 10,
        scope: ['bud'],
        ops: [{ op: 'set', path: 'tasks', recordId: 't1', field: 'status', after: 'completed' }]
      }
    ],
    { model }
  );
  assert.equal(r.report[0].result, 'conflict');
  assert.match(r.report[0].reason, /granted scope/);
});

test('a predecessor cycle is a hard failure and the state is unchanged', () => {
  const st = base();
  st.tasks[0].predecessors = ['t2'];
  const r = applyOps(
    st,
    [
      {
        id: 10,
        scope: ['wbs'],
        ops: [{ op: 'set', path: 'tasks', recordId: 't3', field: 'status', after: 'completed' }]
      }
    ],
    { model }
  );
  assert.ok(r.hardFailure && r.hardFailure.code === 'cycle');
  assert.equal(r.next, null);
});

test('a cycle rolls every report row back and blames the predecessors op', () => {
  const st = base();
  // Both writes must be real changes, otherwise the second is skipped_already
  // and never reaches the cycle check.
  st.tasks[0].predecessors = [];
  st.tasks[1].predecessors = [];
  const r = applyOps(
    st,
    [
      {
        id: 10,
        scope: ['wbs'],
        ops: [
          { op: 'set', path: 'tasks', recordId: 't1', field: 'predecessors', after: ['t2'] },
          { op: 'set', path: 'tasks', recordId: 't2', field: 'predecessors', after: ['t1'] }
        ]
      }
    ],
    { model }
  );
  assert.ok(r.hardFailure && r.hardFailure.code === 'cycle');
  assert.equal(r.report.length, 2);
  // Nothing was applied, so no row may claim it was.
  assert.deepEqual(
    r.report.map(x => x.result),
    ['rolled_back', 'rolled_back']
  );
  assert.deepEqual(
    r.report.map(x => x.code),
    ['CYCLE', 'CYCLE']
  );
  assert.ok(r.report.every(x => x.field === 'predecessors'));
  assert.ok(r.report.every(x => /cycle/.test(x.reason)));
});

test('a bad enum left in state is a hard failure', () => {
  const st = base();
  st.tasks[0].status = 'weird';
  const r = applyOps(
    st,
    [
      {
        id: 10,
        scope: ['wbs'],
        ops: [{ op: 'set', path: 'tasks', recordId: 't2', field: 'status', after: 'completed' }]
      }
    ],
    { model }
  );
  assert.ok(r.hardFailure && r.hardFailure.code === 'bad_enum');
});

test('touched tasks have their derived schedule fields nulled for recompute', () => {
  const st = base();
  st.tasks[0].critical = true;
  st.tasks[0].totalFloat = 5;
  const r = applyOps(
    st,
    [
      {
        id: 10,
        scope: ['wbs'],
        ops: [{ op: 'set', path: 'tasks', recordId: 't1', field: 'assignee', after: 'Sam' }]
      }
    ],
    { model }
  );
  assert.equal(r.next.tasks[0].critical, null);
  assert.equal(r.next.tasks[0].totalFloat, null);
  assert.equal(r.next.tasks[0].derived, 'pending recompute (opens in the app)');
  assert.ok(r.derivedChanges.find(c => c.id === 't1' && c.field === 'critical'));
  // An untouched task keeps its derived values.
  assert.equal(r.next.tasks[1].critical, undefined);
});
