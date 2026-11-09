/* Idea intake model unit tests. No browser, no storage: js/mmgr-ideas.js
   is loaded into a vm sandbox with a minimal MMGR namespace. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'js', 'mmgr-ideas.js'), 'utf8');

const sandbox = { window: {}, console };
sandbox.window.MMGR = { Utils: {} };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const I = sandbox.window.MMGR.Ideas;

// The model runs inside a vm realm, so every array and object it creates
// carries that realm's prototypes. Norm through JSON: the output is plain
// data, and this also proves it stays serialisable.
const plain = value => JSON.parse(JSON.stringify(value));

const state = ideas => ({ ideas: ideas || [] });
// Fixtures go through the shipped normaliser, so a missing optional field is
// filled exactly the way a loaded project would fill it.
const idea = (id, stage, order, extra) =>
  I.normalize(Object.assign({ id, title: id, stage, order }, extra || {}));

test('STAGES keeps the six canvas keys in board order', () => {
  assert.deepEqual(plain(I.STAGES.map(s => s.key)), [
    'idea',
    'research',
    'prototype',
    'validation',
    'implemented',
    'deferred'
  ]);
  assert.equal(I.isStage('research'), true);
  assert.equal(I.isStage('done'), false);
  assert.equal(I.isStage(''), false);
});

test('add trims, defaults and appends to the end of its column', () => {
  const s = state([idea('a', 'idea', 0), idea('b', 'idea', 1)]);
  const made = I.add(s, { title: '  Cure time study  ', tags: ['Concrete', 'concrete', ' '] });
  assert.equal(made.title, 'Cure time study');
  assert.equal(made.stage, 'idea');
  assert.equal(made.impact, 3);
  assert.equal(made.effort, 3);
  assert.equal(made.order, 2);
  assert.deepEqual(plain(made.tags), ['Concrete']);
  assert.equal(made.promotedTaskId, '');
  assert.equal(s.ideas.length, 3);
  assert.equal(typeof made.createdAt, 'string');
});

test('add refuses an empty title and a duplicate id', () => {
  const s = state([idea('a', 'idea', 0)]);
  assert.equal(I.add(s, { title: '   ' }), null);
  assert.equal(I.add(s, { id: 'a', title: 'Second' }), null);
  assert.equal(s.ideas.length, 1);
});

test('score weighs impact twice and clamps out-of-range input', () => {
  assert.equal(I.score({ impact: 5, effort: 1 }), 9);
  assert.equal(I.score({ impact: 1, effort: 5 }), -3);
  assert.equal(I.score({ impact: 9, effort: 0 }), 9);
  assert.equal(I.score({ impact: 'x', effort: null }), 3);
  assert.equal(I.score(null), 0);
});

test('update ignores protected keys and an empty title', () => {
  const s = state([idea('a', 'research', 0, { createdAt: '2026-01-01T00:00:00.000Z' })]);
  assert.equal(
    I.update(s, 'a', { id: 'z', order: 99, createdAt: 'nope', promotedTaskId: 't1' }),
    false
  );
  assert.equal(I.update(s, 'a', { title: '  ' }), false);
  const row = I.find(s, 'a');
  assert.equal(row.id, 'a');
  assert.equal(row.order, 0);
  assert.equal(row.createdAt, '2026-01-01T00:00:00.000Z');
  assert.equal(row.promotedTaskId, '');
});

test('update appends a stage change to the end of the new column', () => {
  const s = state([idea('a', 'research', 0), idea('b', 'prototype', 0), idea('c', 'prototype', 1)]);
  assert.equal(I.update(s, 'a', { stage: 'prototype' }), true);
  assert.deepEqual(
    plain(
      I.byStage(s)
        .find(g => g.key === 'prototype')
        .ideas.map(x => x.id)
    ),
    ['b', 'c', 'a']
  );
  assert.equal(I.find(s, 'a').order, 2);
  assert.equal(I.byStage(s).find(g => g.key === 'research').ideas.length, 0);
});

test('applyDrop lands a two-card move and numbers both columns from zero', () => {
  const s = state([
    idea('a', 'idea', 0),
    idea('b', 'idea', 1),
    idea('c', 'research', 0),
    idea('d', 'research', 1)
  ]);
  const ok = I.applyDrop(s, [
    { id: 'b', stage: 'research', order: 0 },
    { id: 'a', stage: 'idea', order: 0 }
  ]);
  assert.equal(ok, true);
  assert.deepEqual(
    plain(
      I.byStage(s)
        .find(g => g.key === 'research')
        .ideas.map(x => x.id)
    ),
    ['b', 'c', 'd']
  );
  assert.deepEqual(
    plain(
      I.byStage(s)
        .find(g => g.key === 'idea')
        .ideas.map(x => x.id)
    ),
    ['a']
  );
  assert.deepEqual(plain(s.ideas.map(x => x.order).sort((x, y) => x - y)), [0, 0, 1, 2]);
});

test('applyDrop is all-or-nothing on an unknown id', () => {
  const s = state([idea('a', 'idea', 0), idea('b', 'idea', 1)]);
  const before = JSON.stringify(plain(s));
  assert.equal(
    I.applyDrop(s, [
      { id: 'a', stage: 'research', order: 0 },
      { id: 'ghost', stage: 'research', order: 1 }
    ]),
    false
  );
  assert.equal(JSON.stringify(plain(s)), before);
});

test('applyDrop rejects duplicates, bad stages and bad orders', () => {
  const s = state([idea('a', 'idea', 0), idea('b', 'idea', 1)]);
  assert.equal(I.applyDrop(s, []), false);
  assert.equal(
    I.applyDrop(s, [
      { id: 'a', stage: 'idea', order: 0 },
      { id: 'a', stage: 'idea', order: 1 }
    ]),
    false
  );
  assert.equal(I.applyDrop(s, [{ id: 'a', stage: 'nope', order: 0 }]), false);
  assert.equal(I.applyDrop(s, [{ id: 'a', stage: 'idea', order: -1 }]), false);
  assert.equal(I.applyDrop(s, [{ id: 'a', stage: 'idea', order: 1.5 }]), false);
  assert.equal(s.ideas.length, 2);
});

test('promote records the task link once without changing the stage', () => {
  const s = state([idea('a', 'validation', 0)]);
  assert.equal(I.promote(s, 'a', 't42'), true);
  assert.equal(I.find(s, 'a').promotedTaskId, 't42');
  assert.equal(I.find(s, 'a').stage, 'validation');
  assert.equal(I.promote(s, 'a', 't43'), false);
  assert.equal(I.promote(s, 'missing', 't43'), false);
  assert.equal(I.promote(s, 'a', ''), false);
});

test('unlink clears only the links that point at the deleted task', () => {
  const s = state([
    idea('a', 'idea', 0, { promotedTaskId: 't1' }),
    idea('b', 'idea', 1, { promotedTaskId: 't2' }),
    idea('c', 'idea', 2, { promotedTaskId: 't1' })
  ]);
  assert.equal(I.unlink(s, 't1'), 2);
  assert.equal(I.find(s, 'a').promotedTaskId, '');
  assert.equal(I.find(s, 'b').promotedTaskId, 't2');
  assert.equal(I.find(s, 'c').promotedTaskId, '');
  assert.equal(I.unlink(s, 't9'), 0);
  assert.equal(I.unlink(s, ''), 0);
  assert.equal(I.unlink(null, 't1'), 0);
});

test('repair clears a link to a task that is no longer in the state', () => {
  const s = state([idea('a', 'idea', 0, { promotedTaskId: 't1' })]);
  s.tasks = [{ id: 't1' }];
  assert.equal(I.repair(s), 0);
  assert.equal(I.find(s, 'a').promotedTaskId, 't1');
  s.tasks = [];
  assert.equal(I.repair(s), 1);
  assert.equal(I.find(s, 'a').promotedTaskId, '');
  // A state without a task list is not evidence that every task was deleted.
  s.tasks = undefined;
  assert.equal(I.repair(s), 0);
});

test('repair makes an imported row renderable and is idempotent', () => {
  const s = {
    ideas: [
      { id: 'b', title: 'Second', stage: 'research', order: 4, impact: '9', effort: 0 },
      { title: 'No id', stage: 'nope', impact: 2, effort: 2 },
      { id: 'a', title: 'First', stage: 'research', order: 1 },
      { id: 'b', title: 'Shadow', stage: 'idea', order: 0 },
      { id: 'x', title: '   ', stage: 'idea', order: 0 },
      null
    ]
  };
  const changed = I.repair(s);
  assert.equal(changed > 0, true);
  assert.deepEqual(plain(s.ideas.map(x => [x.title, x.stage, x.order])), [
    ['No id', 'idea', 0],
    ['Shadow', 'idea', 1],
    ['First', 'research', 0],
    ['Second', 'research', 1]
  ]);
  assert.equal(I.find(s, 'b').impact, 5);
  assert.equal(I.find(s, 'b').effort, 1);
  assert.equal(I.find(s, 'a').order, 0);
  assert.equal(I.repair(s), 0);
});

test('byStage, filter, tags and stats read the same records', () => {
  const s = state([
    idea('a', 'idea', 0, { title: 'Slab cure', tags: ['Concrete'] }),
    idea('b', 'research', 0, { title: 'Pump hire', tags: ['Plant', 'concrete'] }),
    idea('c', 'implemented', 0, { title: 'Gate code' }),
    idea('d', 'deferred', 0, { title: 'Solar fence' }),
    idea('e', 'idea', 1, { title: 'Cure tent', promotedTaskId: 't7' })
  ]);
  assert.deepEqual(plain(I.byStage(s).map(g => [g.key, g.ideas.length])), [
    ['idea', 2],
    ['research', 1],
    ['prototype', 0],
    ['validation', 0],
    ['implemented', 1],
    ['deferred', 1]
  ]);
  assert.deepEqual(plain(I.filter(s, { tag: 'CONCRETE' }).map(x => x.id)), ['a', 'b']);
  assert.deepEqual(plain(I.filter(s, { q: 'cure' }).map(x => x.id)), ['a', 'e']);
  assert.deepEqual(plain(I.tags(s)), ['Concrete', 'Plant']);
  assert.deepEqual(plain(I.stats(s)), {
    total: 5,
    counts: { idea: 2, research: 1, prototype: 0, validation: 0, implemented: 1, deferred: 1 },
    promoted: 1,
    open: 3
  });
});
