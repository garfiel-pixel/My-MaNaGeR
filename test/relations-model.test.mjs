/* Work package relation model tests. No browser, no storage. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'js', 'mmgr-relations.js'), 'utf8');

let seq = 0;
const sandbox = { window: {}, console };
sandbox.window.MMGR = {
  Utils: {
    genId: prefix => (prefix || 'id') + '-' + ++seq
  }
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const R = sandbox.window.MMGR.Relations;
const plain = value => JSON.parse(JSON.stringify(value));
const task = (id, extra) =>
  Object.assign({ id, name: id, status: 'todo', level: 1, relations: [] }, extra || {});
const state = tasks => ({ tasks, relLens: 'all' });

test('addRelation writes the forward and reverse entries', () => {
  const s = state([task('a'), task('b')]);
  const r = R.addRelation(s, 'a', 'blocks', 'b', 0);
  assert.equal(r.ok, true);
  assert.deepEqual(plain(R.linksOf(s, 'a').map(l => [l.type, l.task.id])), [['blocks', 'b']]);
  assert.deepEqual(plain(R.linksOf(s, 'b').map(l => [l.type, l.task.id])), [['blocked', 'a']]);
});

test('the reverse pair is explicit for every type', () => {
  Object.keys(R.TYPES).forEach(type => {
    const back = R.TYPES[type].reverse;
    assert.equal(R.TYPES[back].reverse, type, type + ' does not round-trip');
  });
});

test('a self relation is refused', () => {
  const s = state([task('a')]);
  assert.equal(R.addRelation(s, 'a', 'relates', 'a').ok, false);
});

test('a duplicate relation is refused', () => {
  const s = state([task('a'), task('b')]);
  assert.equal(R.addRelation(s, 'a', 'relates', 'b').ok, true);
  assert.equal(R.addRelation(s, 'a', 'relates', 'b').ok, false);
});

test('an unknown type is refused', () => {
  const s = state([task('a'), task('b')]);
  assert.equal(R.addRelation(s, 'a', 'depends-on', 'b').ok, false);
});

test('a blocks loop is refused', () => {
  const s = state([task('a'), task('b'), task('c')]);
  assert.equal(R.addRelation(s, 'a', 'blocks', 'b').ok, true);
  assert.equal(R.addRelation(s, 'b', 'blocks', 'c').ok, true);
  assert.equal(R.addRelation(s, 'c', 'blocks', 'a').ok, false);
});

test('a precedes loop is refused but a cross-group edge is allowed', () => {
  const s = state([task('a'), task('b')]);
  assert.equal(R.addRelation(s, 'a', 'precedes', 'b').ok, true);
  assert.equal(R.addRelation(s, 'b', 'precedes', 'a').ok, false);
  assert.equal(R.addRelation(s, 'b', 'blocks', 'a').ok, true);
});

test('removeRelation removes both sides', () => {
  const s = state([task('a'), task('b')]);
  R.addRelation(s, 'a', 'blocks', 'b');
  const id = R.linksOf(s, 'a')[0].id;
  assert.equal(R.removeRelation(s, 'a', id), true);
  assert.equal(R.linksOf(s, 'a').length, 0);
  assert.equal(R.linksOf(s, 'b').length, 0);
});

test('only an open blocker counts as blocked', () => {
  const s = state([task('a'), task('b')]);
  R.addRelation(s, 'a', 'blocks', 'b');
  assert.equal(R.isBlocked(s, 'b'), true);
  s.tasks[0].status = 'completed';
  assert.equal(R.isBlocked(s, 'b'), false);
});

test('lag is clamped to the OpenProject bounds', () => {
  const s = state([task('a'), task('b')]);
  R.addRelation(s, 'a', 'precedes', 'b', 99999);
  assert.equal(R.linksOf(s, 'a')[0].lag, 2000);
});

test('the board lens filters work items, not phases', () => {
  const s = state([task('a', { level: 0 }), task('b', { level: 1 }), task('p', { isPhase: true })]);
  R.addRelation(s, 'a', 'blocks', 'b');
  assert.deepEqual(plain(R.lensTasks(s, 'blocked').map(t => t.id)), ['b']);
  assert.deepEqual(plain(R.lensTasks(s, 'ready').map(t => t.id)), ['a']);
});

test('setBoardLens refuses an unknown lens', () => {
  const s = state([task('a')]);
  assert.equal(R.setBoardLens(s, 'nope'), 'all');
  assert.equal(R.setBoardLens(s, 'blocked'), 'blocked');
});
