/* WBS hybrid add model (owner-approved 2026-11-20).
 *
 * js/mmgr-tasks.js is loaded into a vm sandbox with State/Render/Utils/Kanban
 * stubs, so these are the app's REAL createTask/addTask functions, not a copy.
 *
 * Contract:
 *   - plain "+ Add Task": first task is a main (level 0); every later add is
 *     a subtask (indent = most-recent-main + 1, capped at 3).
 *   - "+ Main Task": always a new top-level row.
 *   - "+ Subtask" on a main: child inserted after that main's last
 *     descendant, at main.indent + 1.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'js', 'mmgr-tasks.js'), 'utf8');

let seq = 0;
const sandbox = { window: {}, console };
sandbox.window.MMGR = {
  Utils: {
    genId: () => 't' + ++seq,
    todayStr: () => '2026-11-20',
    workingDaysBetween: () => 0,
    isWorkDay: () => true
  },
  Render: {
    renderWbs() {},
    renderGantt() {},
    renderKanban() {},
    renderDash() {},
    renderIdeas() {}
  },
  Kanban: { nextPosition: () => 0, stampStatus() {} },
  State: {
    _state: { tasks: [] },
    getState() {
      return this._state;
    },
    updateState(fn) {
      fn(this._state);
    }
  }
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const T = sandbox.window.MMGR.Tasks;
const state = () => sandbox.window.MMGR.State._state;
const reset = () => {
  sandbox.window.MMGR.State._state = { tasks: [] };
};
const plain = v => JSON.parse(JSON.stringify(v));
const lvl = t => (t.indent !== undefined ? t.indent : t.level || 0);

test('first plain add is a main task (level 0)', () => {
  reset();
  T.addTask();
  assert.equal(state().tasks.length, 1);
  assert.equal(lvl(state().tasks[0]), 0, 'first task must be a main');
});

test('later plain adds are subtasks of the most recent main', () => {
  reset();
  T.addTask(); // main 1
  T.addTask(); // child of main 1
  T.addTask(); // another child of main 1
  const tasks = plain(state().tasks);
  assert.deepEqual(tasks.map(lvl), [0, 1, 1], 'main then two subtasks');
});

test('new main task button always creates a top-level row', () => {
  reset();
  T.addTask();
  T.addTask();
  T.addMainTask();
  assert.deepEqual(plain(state().tasks).map(lvl), [0, 1, 0], 'main button resets to level 0');
});

test('add subtask on an earlier main inserts after that main last descendant', () => {
  reset();
  T.addTask(); // A (main)
  T.addTask(); // A.1
  T.addMainTask(); // B (main)
  T.addTask(); // B.1 (plain add follows most recent main B)
  T.addSubtask(state().tasks[0].id); // add child under A
  const tasks = plain(state().tasks);
  // A, A.1, [new A child], B, B.1
  assert.equal(tasks.length, 5);
  assert.deepEqual(tasks.map(lvl), [0, 1, 1, 0, 1], 'child lands under A, not at end');
  assert.equal(tasks[2].name, 'New Task');
});

test('add subtask with unknown id is a no-op', () => {
  reset();
  T.addTask();
  T.addSubtask('does-not-exist');
  assert.equal(state().tasks.length, 1);
});

test('createTask defaults are unchanged for Kanban quick-add callers', () => {
  reset();
  T.createTask({ name: 'From Kanban' });
  const t = plain(state().tasks)[0];
  assert.equal(t.level, 0);
  assert.equal(t.indent, 0);
  assert.equal(t.name, 'From Kanban');
});
