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

// ---- 3. the no-groups fallback ------------------------------------------
test('no phase rows and no labels returns no groups, and the dashboard keeps its single ring', () => {
  const state = {
    tasks: [
      { id: 'a', name: 'One', status: 'completed' },
      { id: 'b', name: 'Two', status: 'todo' }
    ]
  };
  const out = M.getMajorGroups(state);
  // Every item is unlabelled, so there is exactly one bucket - not a ring of
  // one. grouped stays false and the renderer draws today's stroke.
  assert.equal(out.grouped, false);
  assert.equal(out.groups.length, 1);
  assert.equal(out.groups[0].name, 'Unassigned');
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
