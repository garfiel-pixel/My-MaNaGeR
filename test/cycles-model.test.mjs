/* Cycle model unit tests. js/mmgr-cycles.js is loaded into a vm sandbox so the
   windows, the commitment and the close choice are deterministic. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'js', 'mmgr-cycles.js'), 'utf8');
const sandbox = { window: {}, console };
sandbox.window.MMGR = {};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const C = sandbox.window.MMGR.Cycles;
const plain = v => JSON.parse(JSON.stringify(v));

const task = (over = {}) => ({
  id: 'T1',
  name: 'Pour slab',
  status: 'todo',
  duration: '5',
  startDate: '2026-11-02',
  endDate: '2026-11-06',
  cycleId: '',
  ...over
});

const base = () => ({ cycles: [], tasks: [task()], sprint: null });

test('a cycle needs a name, two dates, and an end after the start', () => {
  const s = base();
  assert.equal(C.newCycle(s, { name: '', start: '2026-11-01', end: '2026-11-14' }).ok, false);
  assert.equal(C.newCycle(s, { name: 'Sprint 1', start: '', end: '2026-11-14' }).ok, false);
  assert.equal(
    C.newCycle(s, { name: 'Sprint 1', start: '2026-11-10', end: '2026-11-01' }).ok,
    false
  );
  assert.equal(s.cycles.length, 0);
  const made = C.newCycle(s, { name: 'Sprint 1', start: '2026-11-01', end: '2026-11-14' });
  assert.equal(made.ok, true);
  assert.equal(s.cycles.length, 1);
  assert.equal(C.stateOf(s.cycles[0]), 'planned');
});

test('activating a cycle demotes the previous active one in the same write', () => {
  const s = base();
  const a = C.newCycle(s, { name: 'One', start: '2026-11-01', end: '2026-11-14' }).id;
  const b = C.newCycle(s, { name: 'Two', start: '2026-11-15', end: '2026-11-28' }).id;
  assert.equal(C.activate(s, a).ok, true);
  assert.equal(C.active(s).id, a);
  assert.equal(C.activate(s, b).ok, true);
  assert.equal(C.active(s).id, b);
  assert.equal(C.find(s, a).state, 'planned');
  assert.equal(C.list(s).filter(c => c.state === 'active').length, 1);
});

test('activation takes the commitment once and does not recalculate it', () => {
  const s = base();
  s.tasks.push(task({ id: 'T2', duration: '3' }));
  const id = C.newCycle(s, { name: 'One', start: '2026-11-01', end: '2026-11-14' }).id;
  C.assign(s, 0, id);
  C.assign(s, 1, id);
  C.activate(s, id);
  assert.equal(C.find(s, id).commitment.tasks, 2);
  assert.equal(C.find(s, id).commitment.days, 8);
  s.tasks.push(task({ id: 'T3', duration: '9' }));
  C.assign(s, 2, id);
  assert.equal(C.find(s, id).commitment.tasks, 2);
  assert.equal(C.find(s, id).commitment.days, 8);
});

test('a task joins one cycle at a time and can leave it', () => {
  const s = base();
  const a = C.newCycle(s, { name: 'One', start: '2026-11-01', end: '2026-11-14' }).id;
  const b = C.newCycle(s, { name: 'Two', start: '2026-11-15', end: '2026-11-28' }).id;
  assert.equal(C.assign(s, 0, a).ok, true);
  assert.equal(s.tasks[0].cycleId, a);
  assert.equal(C.assign(s, 0, b).ok, true);
  assert.equal(s.tasks[0].cycleId, b);
  assert.equal(C.tasksOf(s, a).length, 0);
  assert.equal(C.assign(s, 0, '').ok, true);
  assert.equal(s.tasks[0].cycleId, '');
  assert.equal(C.backlog(s).length, 1);
});

test('a closed cycle keeps its membership and its dates', () => {
  const s = base();
  const id = C.newCycle(s, { name: 'One', start: '2026-11-01', end: '2026-11-14' }).id;
  C.assign(s, 0, id);
  s.tasks[0].status = 'completed';
  assert.equal(C.close(s, id, 'backlog').ok, true);
  assert.equal(C.assign(s, 1, id).ok, false);
  assert.equal(C.updateCycle(s, id, 'start', '2026-12-01').ok, false);
  assert.equal(C.updateCycle(s, id, 'name', 'Renamed').ok, true);
  assert.equal(C.find(s, id).name, 'Renamed');
});

test('closing refuses without a choice and while a task has no status', () => {
  const s = base();
  const id = C.newCycle(s, { name: 'One', start: '2026-11-01', end: '2026-11-14' }).id;
  s.tasks.push(task({ id: 'T2', status: '' }));
  C.assign(s, 0, id);
  C.assign(s, 1, id);
  const unstated = C.close(s, id, 'backlog');
  assert.equal(unstated.ok, false);
  assert.match(unstated.message, /no status/);
  s.tasks[1].status = 'todo';
  assert.equal(C.close(s, id, '').ok, false);
  assert.match(C.close(s, id, '').message, /Choose/);
  assert.equal(C.stateOf(C.find(s, id)), 'planned');
});

test('carry forward moves the unfinished work into the next planned cycle', () => {
  const s = base();
  s.tasks.push(task({ id: 'T2', status: 'completed', duration: '2' }));
  s.tasks.push(task({ id: 'T3', status: 'todo', duration: '4' }));
  const a = C.newCycle(s, { name: 'One', start: '2026-11-01', end: '2026-11-14' }).id;
  const b = C.newCycle(s, { name: 'Two', start: '2026-11-15', end: '2026-11-28' }).id;
  [0, 1, 2].forEach(i => C.assign(s, i, a));
  const res = C.close(s, a, 'forward');
  assert.equal(res.ok, true);
  assert.equal(C.stateOf(C.find(s, a)), 'closed');
  assert.equal(C.tasksOf(s, a).length, 1);
  assert.equal(C.tasksOf(s, b).length, 2);
  assert.equal(res.close.carried, 2);
  assert.equal(res.close.carriedDays, 9);
  assert.equal(res.close.returned, 0);
  assert.equal(res.close.done, 1);
  assert.equal(res.close.doneDays, 2);
  assert.equal(res.close.tasks, 3);
  assert.equal(res.close.days, 11);
  assert.equal(res.close.to, b);
});

test('carry forward is refused when no planned cycle follows', () => {
  const s = base();
  const a = C.newCycle(s, { name: 'One', start: '2026-11-01', end: '2026-11-14' }).id;
  C.assign(s, 0, a);
  const plan = C.closePlan(s, a);
  assert.equal(plan.canForward, false);
  const res = C.close(s, a, 'forward');
  assert.equal(res.ok, false);
  assert.match(res.message, /backlog/);
  assert.equal(C.stateOf(C.find(s, a)), 'planned');
});

test('return to the backlog clears the pointer and records the counts', () => {
  const s = base();
  s.tasks.push(task({ id: 'T2', status: 'todo', duration: '3' }));
  const a = C.newCycle(s, { name: 'One', start: '2026-11-01', end: '2026-11-14' }).id;
  C.assign(s, 0, a);
  C.assign(s, 1, a);
  const res = C.close(s, a, 'backlog');
  assert.equal(res.ok, true);
  assert.equal(s.tasks[0].cycleId, '');
  assert.equal(s.tasks[1].cycleId, '');
  assert.equal(res.close.returned, 2);
  assert.equal(res.close.returnedDays, 8);
  assert.equal(C.backlog(s).length, 2);
});

test('a cycle that holds work or is active cannot be deleted', () => {
  const s = base();
  const a = C.newCycle(s, { name: 'One', start: '2026-11-01', end: '2026-11-14' }).id;
  C.assign(s, 0, a);
  assert.equal(C.removeCycle(s, a).ok, false);
  C.assign(s, 0, '');
  assert.equal(C.removeCycle(s, a).ok, true);
  const b = C.newCycle(s, { name: 'Two', start: '2026-11-15', end: '2026-11-28' }).id;
  C.activate(s, b);
  assert.equal(C.removeCycle(s, b).ok, false);
});

test('a task with no duration counts as a task and as zero days', () => {
  const s = base();
  s.tasks[0].duration = '';
  const id = C.newCycle(s, { name: 'One', start: '2026-11-01', end: '2026-11-14' }).id;
  C.assign(s, 0, id);
  assert.equal(C.sumDays(C.tasksOf(s, id)), 0);
  assert.equal(C.tasksOf(s, id).length, 1);
});
