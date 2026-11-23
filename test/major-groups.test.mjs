/* UX-2026-11-19 B1: the ONE definition of a major group.

   js/mmgr-kanban.js and js/mmgr-major-tasks.js are loaded into a vm sandbox
   (the same pattern as test/agenda-model.test.mjs) so the counting rule is
   the app's real rule, not a copy of it. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = f => fs.readFileSync(path.join(here, '..', 'js', f), 'utf8');

const sandbox = { window: {}, console };
sandbox.window.MMGR = {};
vm.createContext(sandbox);
vm.runInContext(read('mmgr-kanban.js'), sandbox);
vm.runInContext(read('mmgr-major-tasks.js'), sandbox);

const M = sandbox.window.MMGR.MajorTasks;

const sum = (rows, key) => rows.reduce((n, r) => n + r[key], 0);
// Values built inside the vm sandbox belong to another realm, so their
// Array prototype differs; plain() puts them back in this one (the same
// helper test/agenda-model.test.mjs uses).
const plain = v => JSON.parse(JSON.stringify(v));
const round = n => Math.round(n * 1000) / 1000;
const stateOf = tasks => ({ tasks });

// ---- 1. phases with nested subtasks --------------------------------------
test('phase rows are the majors and nested descendants count to their top ancestor', () => {
  const state = {
    tasks: [
      { id: 'p1', name: 'Site preparation', isPhase: true, status: 'inprogress' },
      { id: 't1', name: 'Site grading', parentId: 'p1', status: 'completed' },
      { id: 't2', name: 'Temporary fences', parentName: 'Site preparation', status: 'todo' },
      // A deeper descendant: its parent is a task, not the phase.
      { id: 't3', name: 'Fence posts', parentId: 't2', status: 'completed' },
      { id: 'p2', name: 'Foundation', isPhase: true, status: 'todo' },
      { id: 't4', name: 'Excavate', parentId: 'p2', status: 'completed' },
      { id: 't5', name: 'Rebar', parentId: 'p2', status: 'todo' }
    ]
  };
  const out = M.getMajorGroups(state);
  assert.equal(out.groups.length, 2);
  assert.deepEqual(plain(out.groups.map(g => g.name)), ['Site preparation', 'Foundation']);
  const prep = out.groups[0];
  assert.equal(prep.total, 3, 'grading + fences + fence posts');
  assert.equal(prep.completed, 2, 'grading + fence posts');
  assert.equal(round(prep.fraction), round(2 / 3));
  const found = out.groups[1];
  assert.equal(found.total, 2);
  assert.equal(found.completed, 1);
  assert.equal(out.total, 5);
  assert.equal(out.completed, 3);
  assert.equal(out.overall, 60);
});

test('a phase row itself is never counted as a work item', () => {
  const state = {
    tasks: [
      { id: 'p1', name: 'Procurement', isPhase: true, status: 'completed' },
      { id: 't1', name: 'Order steel', parentId: 'p1', status: 'completed' }
    ]
  };
  const out = M.getMajorGroups(state);
  assert.equal(out.total, 1);
  assert.equal(out.completed, 1);
  assert.equal(out.groups[0].points, 100);
});

// ---- 2. the phase-label fallback ----------------------------------------
test('without phase rows the task phase labels group the work, in first-appearance order', () => {
  const state = {
    tasks: [
      { id: 'a', name: 'Survey', phase: 'planning', status: 'completed' },
      { id: 'b', name: 'Permits', phase: 'planning', status: 'todo' },
      { id: 'c', name: 'Order steel', phase: 'procurement', status: 'completed' },
      { id: 'd', name: 'Order concrete', phase: 'procurement', status: 'completed' },
      { id: 'e', name: 'Pour slab', phase: 'construction', status: 'todo' }
    ]
  };
  const out = M.getMajorGroups(state);
  assert.deepEqual(
    plain(out.groups.map(g => g.name)),
    ['Planning', 'Procurement', 'Construction'],
    'labels are capitalised and keep first-appearance order'
  );
  assert.deepEqual(plain(out.groups.map(g => g.total)), [2, 2, 1]);
  assert.deepEqual(plain(out.groups.map(g => g.completed)), [1, 2, 0]);
});

test('an unlabelled work item goes to an honest Unassigned group so the points still sum', () => {
  const state = {
    tasks: [
      { id: 'a', name: 'Survey', phase: 'planning', status: 'completed' },
      { id: 'b', name: 'Loose end', status: 'todo' }
    ]
  };
  const out = M.getMajorGroups(state);
  const names = out.groups.map(g => g.name);
  assert.ok(names.includes('Unassigned'), names.join(','));
  assert.equal(out.total, 2);
  assert.equal(round(sum(out.groups, 'points')), round(out.overall));
});

// ---- 3. the flat / older-project path (UI-WAVE D) ------------------------
// No phase rows and no phase labels: each top-level main task is a segment,
// every segment gets an equal arc, and the arc fills by its own subtasks.
test('flat project: each parentless task is its own main-task segment', () => {
  const state = {
    tasks: [
      { id: 'a', name: 'One', status: 'completed' },
      { id: 'b', name: 'Two', status: 'todo' }
    ]
  };
  const out = M.getMajorGroups(state);
  assert.equal(out.grouped, true);
  assert.deepEqual(plain(out.groups.map(g => g.name)), ['One', 'Two']);
  assert.deepEqual(plain(out.groups.map(g => g.share)), [0.5, 0.5]);
  assert.deepEqual(plain(out.groups.map(g => g.fraction)), [1, 0]);
  assert.deepEqual(plain(out.groups.map(g => g.points)), [50, 0]);
  assert.equal(out.overall, 50, 'the mean of the two main-task fractions');
});

test('flat project: a completed task with many subtasks cannot dominate the ring', () => {
  const tasks = [
    { id: 'm1', name: 'Big done', level: 0 },
    { id: 'm2', name: 'Small open', level: 0 }
  ];
  for (let i = 0; i < 10; i++) {
    tasks.push({
      id: 'b' + i,
      name: 'b' + i,
      parentName: 'Big done',
      level: 1,
      status: 'completed'
    });
  }
  tasks.push({
    id: 's1',
    name: 's1',
    parentName: 'Small open',
    level: 1,
    status: 'todo'
  });
  const out = M.getMajorGroups(stateOf(tasks));
  assert.deepEqual(plain(out.groups.map(g => g.name)), ['Big done', 'Small open']);
  // Equal arc width, whatever the subtask count.
  assert.deepEqual(plain(out.groups.map(g => g.share)), [0.5, 0.5]);
  assert.deepEqual(plain(out.groups.map(g => g.total)), [10, 1]);
  assert.deepEqual(plain(out.groups.map(g => g.fraction)), [1, 0]);
  // The work-item rate would be 10/11 = 90.9%; equal weighting keeps the
  // completed task from claiming the whole ring.
  assert.deepEqual(plain(out.groups.map(g => g.points)), [50, 0]);
  assert.equal(out.overall, 50);
  assert.equal(round(sum(out.groups, 'points')), round(out.overall));
  assert.equal(round(sum(out.groups, 'share')), 1);
});

test('flat project groups a deeper descendant under its top-level main task', () => {
  const state = stateOf([
    { id: 'm1', name: 'Main A', level: 0 },
    { id: 'mid', name: 'Mid', parentName: 'Main A', level: 1 },
    { id: 'leaf', name: 'Leaf', parentId: 'mid', level: 2, status: 'completed' },
    { id: 'm2', name: 'Main B', level: 0 },
    { id: 'leaf2', name: 'Leaf 2', parentName: 'Main B', level: 1, status: 'todo' }
  ]);
  const out = M.getMajorGroups(state);
  assert.deepEqual(plain(out.groups.map(g => g.name)), ['Main A', 'Main B']);
  // Mid is level 1, so the Kanban rule still counts it as a work item (only a
  // level-0 rollup is a container); both Mid and Leaf sit under Main A.
  assert.deepEqual(plain(out.groups.map(g => g.total)), [2, 1]);
  assert.deepEqual(plain(out.groups.map(g => g.completed)), [1, 0]);
});

test('flat project with a single main task draws one full-width segment', () => {
  const state = stateOf([
    { id: 'm1', name: 'Only', level: 0 },
    { id: 's1', name: 's1', parentName: 'Only', level: 1, status: 'completed' },
    { id: 's2', name: 's2', parentName: 'Only', level: 1, status: 'todo' }
  ]);
  const out = M.getMajorGroups(state);
  // The flat branch applies its main-task model even for one group, so the
  // ring fills by the subtasks (1/2) instead of counting the container row.
  assert.equal(out.grouped, true);
  assert.equal(out.groups.length, 1);
  assert.equal(out.groups[0].name, 'Only');
  assert.equal(out.groups[0].share, 1);
  assert.equal(round(out.groups[0].fraction), 0.5);
  assert.equal(out.groups[0].points, 50);
  assert.equal(out.overall, 50);
});

test('an empty project returns no groups at all', () => {
  const out = M.getMajorGroups({ tasks: [] });
  assert.deepEqual(plain(out.groups), []);
  assert.equal(out.overall, 0);
  assert.equal(out.total, 0);
});

// ---- 4. a major with zero work items is omitted --------------------------
test('a major with no work items beneath it is omitted', () => {
  const state = {
    tasks: [
      { id: 'p1', name: 'Empty phase', isPhase: true, status: 'todo' },
      { id: 'p2', name: 'Real phase', isPhase: true, status: 'todo' },
      { id: 't1', name: 'Do the work', parentId: 'p2', status: 'completed' }
    ]
  };
  const out = M.getMajorGroups(state);
  assert.deepEqual(plain(out.groups.map(g => g.name)), ['Real phase']);
  assert.equal(out.groups[0].points, 100);
});

// ---- 5. the invariant ----------------------------------------------------
test('the sum of every group points equals the overall completion exactly', () => {
  const state = {
    tasks: [
      { id: 'p1', name: 'A', isPhase: true },
      { id: 'p2', name: 'B', isPhase: true },
      { id: 'p3', name: 'C', isPhase: true },
      { id: 't1', name: 'a1', parentId: 'p1', status: 'completed' },
      { id: 't2', name: 'a2', parentId: 'p1', status: 'completed' },
      { id: 't3', name: 'a3', parentId: 'p1', status: 'todo' },
      { id: 't4', name: 'b1', parentId: 'p2', status: 'completed' },
      { id: 't5', name: 'b2', parentId: 'p2', status: 'todo' },
      { id: 't6', name: 'b3', parentId: 'p2', status: 'todo' },
      { id: 't7', name: 'b4', parentId: 'p2', status: 'blocked' },
      { id: 't8', name: 'c1', parentId: 'p3', status: 'todo' },
      { id: 't9', name: 'orphan', status: 'completed' }
    ]
  };
  const out = M.getMajorGroups(state);
  assert.equal(out.total, 9);
  assert.equal(out.completed, 4);
  assert.equal(round(sum(out.groups, 'points')), round(out.overall));
  assert.equal(round(sum(out.groups, 'total')), out.total);
  assert.equal(round(sum(out.groups, 'completed')), out.completed);
  // Shares are of the project, and they sum to 1.
  assert.equal(round(sum(out.groups, 'share')), 1);
});

test('the rule follows the Kanban work-item definition, not a copy of it', () => {
  // A level-0 row that is a roll-up parent is NOT a work item in the board
  // model, so it must not be counted here either.
  const state = {
    tasks: [
      { id: 'r1', name: 'Summary row', level: 0, status: 'completed' },
      {
        id: 'c1',
        name: 'Child',
        parentName: 'Summary row',
        level: 1,
        phase: 'build',
        status: 'todo'
      }
    ]
  };
  const K = sandbox.window.MMGR.Kanban;
  const boardItems = K.workItems(state).map(t => t.name);
  const out = M.getMajorGroups(state);
  assert.deepEqual(plain(boardItems), ['Child']);
  assert.equal(out.total, 1);
});

// ---- B2. stable chart slots ---------------------------------------------
test('a group keeps its colour when the tasks are reordered', () => {
  const base = {
    tasks: [
      { id: 'p1', name: 'A', isPhase: true },
      { id: 'p2', name: 'B', isPhase: true },
      { id: 'p3', name: 'C', isPhase: true },
      { id: 'p4', name: 'D', isPhase: true },
      { id: 't1', name: 'a1', parentId: 'p1', status: 'completed' },
      { id: 't2', name: 'b1', parentId: 'p2', status: 'todo' },
      { id: 't3', name: 'c1', parentId: 'p3', status: 'todo' },
      { id: 't4', name: 'd1', parentId: 'p4', status: 'todo' }
    ]
  };
  const first = M.withColors(M.getMajorGroups(base).groups);
  const map1 = {};
  first.forEach(g => (map1[g.id] = g.color));

  // Same rows, different order in the plan.
  const shuffled = { tasks: base.tasks.slice().reverse() };
  const second = M.withColors(M.getMajorGroups(shuffled).groups);
  const map2 = {};
  second.forEach(g => (map2[g.id] = g.color));

  assert.deepEqual(plain(map2), plain(map1));
  assert.ok(
    first.every(g => g.color >= 1 && g.color <= M.SLOTS),
    'every slot is inside 1..' + M.SLOTS
  );
});

test('sixteen or fewer groups never share a colour', () => {
  const groups = [];
  for (let i = 0; i < M.SLOTS; i++) {
    groups.push({
      id: 'g' + i,
      name: 'G' + i,
      total: 1,
      completed: 1,
      fraction: 1,
      share: 1 / M.SLOTS,
      points: 100 / M.SLOTS
    });
  }
  const colored = M.withColors(groups);
  const slots = colored.map(g => g.color);
  assert.equal(new Set(slots).size, M.SLOTS);
});

test('more than sixteen majors keep the fifteen largest and merge the rest into Other', () => {
  const groups = [];
  const extra = 3;
  for (let i = 0; i < M.SLOTS + extra; i++) {
    groups.push({
      id: 'g' + i,
      name: 'G' + i,
      total: 2,
      completed: i === 0 ? 2 : 0,
      fraction: i === 0 ? 1 : 0,
      share: 1 / (M.SLOTS + extra),
      points: i === 0 ? 20 : 0
    });
  }
  const colored = M.withColors(groups);
  assert.equal(colored.length, M.SLOTS, 'fifteen majors plus Other');
  const other = colored[colored.length - 1];
  assert.equal(other.name, 'Other');
  assert.equal(other.color, 0, 'Other is the neutral slot');
  assert.equal(other.total, (extra + 1) * 2, 'the merged groups of two');
  assert.equal(round(colored.reduce((n, g) => n + g.points, 0)), 20);
  assert.ok(
    colored.slice(0, M.SLOTS - 1).some(g => g.id === 'g0'),
    'the largest group keeps its own slot'
  );
});

// ---- OWNER 2026-11-22: WBS subtasks roll under their main by LEVEL ------
// The WBS hybrid add-flow stores hierarchy in level/indent, NOT in
// parentId/parentName. A plain "Add task" makes level-0 mains and level-1+
// subtasks with no parent link. They must group under the nearest preceding
// main, not each become its own colour-hungry group.
test('WBS level-indented subtasks roll under their top-level main (no parentId)', () => {
  const state = stateOf([
    { id: 'm1', name: 'Site works', level: 0, status: 'completed' },
    { id: 's1', name: 'Grading', level: 1, status: 'completed' },
    { id: 's2', name: 'Fence', level: 1, status: 'todo' },
    { id: 's3', name: 'Fence posts', level: 2, status: 'todo' },
    { id: 'm2', name: 'Handover', level: 0, status: 'todo' },
    { id: 's4', name: 'Snag list', level: 1, status: 'todo' }
  ]);
  const out = M.getMajorGroups(state);
  assert.deepEqual(plain(out.groups.map(g => g.name)), ['Site works', 'Handover']);
  // Every row (including the two mains) is a work item because rollups is
  // empty; all four Site-works rows land in one group, both Handover rows in
  // the other. No separate group per subtask.
  assert.deepEqual(plain(out.groups.map(g => g.total)), [4, 2]);
  assert.deepEqual(plain(out.groups.map(g => g.completed)), [2, 0]);
});

test('a top-level main is its own root, never rolled under the previous main', () => {
  const state = stateOf([
    { id: 'a', name: 'First', level: 0, status: 'todo' },
    { id: 'b', name: 'Second', level: 0, status: 'completed' }
  ]);
  const out = M.getMajorGroups(state);
  assert.deepEqual(plain(out.groups.map(g => g.name)), ['First', 'Second']);
  assert.deepEqual(plain(out.groups.map(g => g.total)), [1, 1]);
});

// ---- OWNER 2026-11-22: only the MAIN row wears the colour ---------------
test('assignments colour only top-level anchors; subtasks stay white', () => {
  const state = stateOf([
    { id: 'm1', name: 'Site works', level: 0, status: 'completed' },
    { id: 's1', name: 'Grading', level: 1, status: 'completed' },
    { id: 's2', name: 'Fence', level: 1, status: 'todo' },
    { id: 'm2', name: 'Handover', level: 0, status: 'todo' },
    { id: 's3', name: 'Snag list', level: 1, status: 'todo' }
  ]);
  const map = M.assignments(state);
  assert.ok(map, 'project is grouped');
  assert.ok(map['m1'] >= 1, 'the main row gets a colour');
  assert.ok(map['m2'] >= 1, 'the second main gets a colour');
  assert.notEqual(map['m1'], map['m2'], 'two mains never share a colour');
  assert.equal(map['s1'], undefined, 'a level-1 subtask is never coloured');
  assert.equal(map['s2'], undefined, 'a level-1 subtask is never coloured');
  assert.equal(map['s3'], undefined, 'a level-1 subtask is never coloured');
});

test('phase projects colour only the phase row, not its work items', () => {
  const state = stateOf([
    { id: 'p1', name: 'Prep', isPhase: true, status: 'todo' },
    { id: 't1', name: 'Grading', parentId: 'p1', status: 'completed' },
    { id: 't2', name: 'Fence', parentId: 'p1', status: 'todo' },
    { id: 'p2', name: 'Closeout', isPhase: true, status: 'todo' },
    { id: 't3', name: 'Punch list', parentId: 'p2', status: 'todo' }
  ]);
  const map = M.assignments(state);
  assert.ok(map['p1'] >= 1, 'the phase row gets a colour');
  assert.ok(map['p2'] >= 1, 'the second phase row gets a colour');
  assert.equal(map['t1'], undefined, 'phase work items stay white');
  assert.equal(map['t2'], undefined, 'phase work items stay white');
  assert.equal(map['t3'], undefined, 'phase work items stay white');
});

test('a long WBS of many mains never runs out of distinct colours', () => {
  const tasks = [];
  for (let i = 0; i < M.SLOTS; i++) {
    tasks.push({ id: 'm' + i, name: 'Main ' + i, level: 0, status: 'todo' });
    tasks.push({ id: 's' + i, name: 'Sub ' + i, level: 1, status: 'todo' });
  }
  const map = M.assignments(stateOf(tasks));
  const mainColors = Object.keys(map)
    .filter(id => id.charAt(0) === 'm')
    .map(id => map[id]);
  assert.equal(mainColors.length, M.SLOTS, 'one colour per main');
  assert.equal(new Set(mainColors).size, M.SLOTS, 'all sixteen mains are distinct');
  assert.ok(
    Object.keys(map).every(id => id.charAt(0) === 'm'),
    'no subtask id appears in the assignment map'
  );
});
