/* Kanban model unit tests. No browser, no storage: js/mmgr-kanban.js is
   loaded into a vm sandbox with a minimal MMGR namespace. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'js', 'mmgr-kanban.js'), 'utf8');

const sandbox = { window: {}, console };
sandbox.window.MMGR = {
  Utils: {
    todayStr: () => '2026-10-25',
    isOverdue: d => !!d && d < '2026-10-25'
  }
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const K = sandbox.window.MMGR.Kanban;
const task = (id, status, pos, extra) =>
  Object.assign({ id, name: id, status, boardPosition: pos }, extra || {});
const state = tasks => ({
  tasks,
  kanban: {
    wip: { todo: 0, inprogress: 0, blocked: 0, completed: 0 },
    swimlane: 'none'
  }
});

// The model runs inside a vm realm, so the arrays and objects it creates
// carry that realm's prototypes. Strict deepEqual compares prototypes and
// would fail on structurally identical values. Norm through JSON first:
// the model output is plain data (strings, numbers, booleans, null), so
// this also proves it stays serialisable.
const plain = value => JSON.parse(JSON.stringify(value));

test('columnTasks sorts by boardPosition, not WBS array order', () => {
  const s = state([task('c', 'todo', 2), task('a', 'todo', 0), task('b', 'todo', 1)]);
  assert.deepEqual(plain(K.columnTasks(s, 'todo').map(t => t.id)), ['a', 'b', 'c']);
});

test('workItems drops phases and rollup parents', () => {
  const s = state([
    { id: 'p', name: 'Phase', isPhase: true, status: 'todo', boardPosition: 0 },
    { id: 'r', name: 'Parent', level: 0, status: 'todo', boardPosition: 1 },
    { id: 'c', name: 'Child', parentName: 'Parent', level: 1, status: 'todo', boardPosition: 2 }
  ]);
  assert.deepEqual(plain(K.workItems(s).map(t => t.id)), ['c']);
});

test('moveTo renumbers the target column and closes the old gap', () => {
  const s = state([task('a', 'todo', 0), task('b', 'todo', 1), task('c', 'inprogress', 0)]);
  const r = K.moveTo(s, 'a', 'inprogress', 'c');
  assert.equal(r.changed, true);
  assert.equal(r.from, 'todo');
  assert.deepEqual(plain(K.sortedColumn(s, 'inprogress').map(t => t.id)), ['a', 'c']);
  assert.deepEqual(plain(K.sortedColumn(s, 'todo').map(t => t.id)), ['b']);
  assert.equal(s.tasks.find(t => t.id === 'b').boardPosition, 0);
  assert.equal(s.tasks.find(t => t.id === 'c').boardPosition, 1);
});

test('moveBy moves one slot and refuses at the edges', () => {
  const s = state([task('a', 'todo', 0), task('b', 'todo', 1)]);
  assert.equal(K.moveBy(s, 'b', -1).changed, true);
  assert.deepEqual(plain(K.sortedColumn(s, 'todo').map(t => t.id)), ['b', 'a']);
  assert.equal(K.moveBy(s, 'b', -1).changed, false);
  assert.equal(K.moveBy(s, 'a', 1).changed, false);
});

test('stampStatus owns completedDate, startedDate, statusSince', () => {
  const t = task('a', 'todo', 0);
  K.stampStatus(t, 'inprogress', '2026-10-20');
  assert.equal(t.startedDate, '2026-10-20');
  assert.equal(t.statusSince, '2026-10-20');
  K.stampStatus(t, 'completed', '2026-10-24');
  assert.equal(t.completedDate, '2026-10-24');
  K.stampStatus(t, 'blocked', '2026-10-25');
  assert.equal('completedDate' in t, false);
  assert.equal(t.startedDate, '2026-10-20');
});

test('wip counts work items, 0 means unlimited, over is a warning flag', () => {
  const s = state([
    task('a', 'inprogress', 0),
    task('b', 'inprogress', 1),
    { id: 'p', isPhase: true, status: 'inprogress' }
  ]);
  assert.deepEqual(plain(K.wip(s, 'inprogress')), {
    count: 2,
    limit: 0,
    over: false,
    remaining: null
  });
  s.kanban.wip.inprogress = 1;
  const w = K.wip(s, 'inprogress');
  assert.equal(w.count, 2);
  assert.equal(w.over, true);
  assert.equal(w.remaining, 0);
});

test('matchTask covers text, assignee, overdue and flag', () => {
  const t = task('a', 'todo', 0, {
    name: 'Pour slab',
    assignee: 'Sam',
    endDate: '2026-10-20',
    critical: true
  });
  assert.equal(K.matchTask(t, { text: 'slab' }, '2026-10-25'), true);
  assert.equal(K.matchTask(t, { assignee: 'Sam' }, '2026-10-25'), true);
  assert.equal(K.matchTask(t, { due: 'overdue' }, '2026-10-25'), true);
  assert.equal(K.matchTask(t, { flag: 'critical' }, '2026-10-25'), true);
  assert.equal(K.matchTask(t, { assignee: 'Alex' }, '2026-10-25'), false);
  assert.equal(K.matchTask(t, { due: 'week' }, '2026-10-25'), false);
});

test('laneGroups puts Unassigned last and keeps every card once', () => {
  const tasks = [
    task('a', 'todo', 0, { assignee: 'Sam' }),
    task('b', 'todo', 1, { assignee: '' }),
    task('c', 'todo', 2, { assignee: 'Alex' })
  ];
  const lanes = K.laneGroups(tasks, 'assignee');
  assert.deepEqual(plain(lanes.map(l => l.key)), ['Alex', 'Sam', 'Unassigned']);
  assert.equal(
    lanes.reduce((n, l) => n + l.tasks.length, 0),
    3
  );
});

test('flow averages only cards with both dates', () => {
  const s = state([
    task('a', 'completed', 0, {
      createdDate: '2026-10-01',
      startedDate: '2026-10-11',
      completedDate: '2026-10-21'
    }),
    task('b', 'completed', 1, { createdDate: '2026-10-05', completedDate: '2026-10-25' }),
    task('c', 'completed', 2, {})
  ]);
  const f = K.flow(s, '2026-10-25');
  assert.equal(f.completed, 3);
  assert.equal(f.leadSamples, 2);
  assert.equal(f.avgLead, 20);
  assert.equal(f.cycleSamples, 1);
  assert.equal(f.avgCycle, 10);
});

test('parseQuickAdd reads @assignee and due:date', () => {
  assert.deepEqual(plain(K.parseQuickAdd('Fix door @Sam due:2026-11-01')), {
    name: 'Fix door',
    assignee: 'Sam',
    endDate: '2026-11-01'
  });
  assert.equal(K.parseQuickAdd('   '), null);
  assert.deepEqual(plain(K.parseQuickAdd('Order rebar')), {
    name: 'Order rebar',
    assignee: '',
    endDate: ''
  });
});

test('ensureSettings clamps negative limits and unknown lane modes', () => {
  const s = { kanban: { wip: { todo: -3, inprogress: '4' }, swimlane: 'nope' } };
  const k = K.ensureSettings(s);
  assert.equal(k.wip.todo, 0);
  assert.equal(k.wip.inprogress, 4);
  assert.equal(k.swimlane, 'none');
});

test('normalizePositions fills gaps without moving existing cards', () => {
  const s = state([task('a', 'todo', 3), { id: 'b', status: 'todo' }, { id: 'c', status: 'todo' }]);
  K.normalizePositions(s);
  assert.equal(s.tasks[1].boardPosition, 4);
  assert.equal(s.tasks[2].boardPosition, 5);
});
