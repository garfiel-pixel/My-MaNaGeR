/* Custom field model tests. No browser, no storage. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'js', 'mmgr-custom-fields.js'), 'utf8');

let seq = 0;
const sandbox = { window: {}, console };
sandbox.window.MMGR = {
  Utils: {
    genId: prefix => prefix + '_' + ++seq
  }
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const C = sandbox.window.MMGR.CustomFields;
const plain = value => JSON.parse(JSON.stringify(value));
const state = () => ({
  fields: [],
  tasks: [{ id: 't1', name: 'A', custom: {} }],
  cfFilter: { key: '', value: '' }
});
const addOk = (s, draft) => {
  const result = C.add(s, draft);
  assert.equal(result.ok, true, result.reason);
  return result.field;
};

test('a field needs a label', () => {
  const s = state();
  assert.equal(C.add(s, { label: '   ', type: 'text' }).ok, false);
});

test('an unknown type is refused', () => {
  const s = state();
  assert.equal(C.add(s, { label: 'Zone', type: 'geometry' }).ok, false);
});

test('a select needs at least one option', () => {
  const s = state();
  assert.equal(C.add(s, { label: 'Zone', type: 'select', options: [] }).ok, false);
});

test('add creates a stable custom key with the documented defaults', () => {
  const s = state();
  const field = addOk(s, { label: 'Permit no.', type: 'text' });
  assert.match(field.key, /^cf_/);
  assert.equal(field.showInWbs, true);
  assert.equal(field.showInCard, false);
  assert.equal(field.width, 120);
  assert.equal(C.list(s).length, 1);
});

test('a duplicate label is refused, case-insensitively', () => {
  const s = state();
  addOk(s, { label: 'Permit no.', type: 'text' });
  assert.equal(C.add(s, { label: 'permit NO.', type: 'text' }).ok, false);
});

test('update changes only whitelisted properties', () => {
  const s = state();
  const field = addOk(s, { label: 'Zone', type: 'text' });
  C.update(s, field.key, { type: 'select', label: 'Area' });
  assert.equal(field.type, 'text');
  assert.equal(field.label, 'Area');
});

test('update refuses a blank or duplicate label', () => {
  const s = state();
  const a = addOk(s, { label: 'Zone', type: 'text' });
  addOk(s, { label: 'Batch', type: 'text' });
  assert.equal(C.update(s, a.key, { label: '   ' }).ok, false);
  assert.equal(C.update(s, a.key, { label: 'Batch' }).ok, false);
});

test('text coercion trims and caps at 200 characters', () => {
  assert.equal(C.TYPES.text.coerce('  P-104  '), 'P-104');
  assert.equal(C.TYPES.text.coerce('x'.repeat(250)).length, 200);
});

test('number coercion keeps finite numbers and rejects junk', () => {
  assert.equal(C.TYPES.number.coerce('42'), 42);
  assert.equal(C.TYPES.number.coerce('-1.5'), -1.5);
  assert.equal(C.TYPES.number.coerce('12abc'), '');
  assert.equal(C.TYPES.number.coerce(''), '');
});

test('date coercion keeps only YYYY-MM-DD', () => {
  assert.equal(C.TYPES.date.coerce('2026-10-25'), '2026-10-25');
  assert.equal(C.TYPES.date.coerce('25/10/2026'), '');
});

test('select coercion rejects a value outside the options', () => {
  const field = { type: 'select', options: ['A', 'B'] };
  assert.equal(C.TYPES.select.coerce('B', field), 'B');
  assert.equal(C.TYPES.select.coerce('C', field), '');
});

test('checkbox coercion accepts only truthy storage forms', () => {
  [true, 'true', 'on', 1, '1'].forEach(v => assert.equal(C.TYPES.checkbox.coerce(v), true));
  [false, 'false', '', 0, '0', null].forEach(v => assert.equal(C.TYPES.checkbox.coerce(v), false));
});

test('valueOf falls back to the field default when no value is stored', () => {
  const s = state();
  const field = addOk(s, {
    label: 'Lane',
    type: 'select',
    options: ['North', 'South'],
    defaultValue: 'South'
  });
  assert.equal(C.valueOf(s.tasks[0], field), 'South');
});

test('setValue writes a coerced value into task.custom', () => {
  const s = state();
  const field = addOk(s, { label: 'Qty', type: 'number' });
  const result = C.setValue(s, s.tasks[0], field.key, '12');
  assert.equal(result.ok, true);
  assert.equal(result.value, 12);
  assert.equal(s.tasks[0].custom[field.key], 12);
});

test('missing returns only empty required fields', () => {
  const s = state();
  const field = addOk(s, { label: 'Permit', type: 'text', required: true });
  assert.equal(C.missing(s, s.tasks[0]).length, 1);
  C.setValue(s, s.tasks[0], field.key, 'P-1');
  assert.equal(C.missing(s, s.tasks[0]).length, 0);
});

test('remove deletes the field, every stored value, and a filter that used it', () => {
  const s = state();
  const field = addOk(s, { label: 'Zone', type: 'select', options: ['North', 'South'] });
  C.setValue(s, s.tasks[0], field.key, 'North');
  C.setFilter(s, field.key, 'North');
  assert.equal(C.remove(s, field.key).ok, true);
  assert.equal(C.list(s).length, 0);
  assert.equal(s.tasks[0].custom[field.key], undefined);
  assert.deepEqual(plain(s.cfFilter), { key: '', value: '' });
});

test('move respects the edges', () => {
  const s = state();
  const a = addOk(s, { label: 'A', type: 'text' });
  addOk(s, { label: 'B', type: 'text' });
  assert.equal(C.move(s, a.key, -1), false);
  assert.equal(C.move(s, a.key, 1), true);
  assert.deepEqual(plain(C.list(s).map(f => f.label)), ['B', 'A']);
  assert.equal(C.move(s, a.key, 1), false);
});

test('prune drops orphan values', () => {
  const s = state();
  s.tasks[0].custom.cf_gone = 'stale';
  const field = addOk(s, { label: 'Zone', type: 'text' });
  C.setValue(s, s.tasks[0], field.key, 'North');
  C.prune(s);
  assert.equal(s.tasks[0].custom.cf_gone, undefined);
  assert.equal(s.tasks[0].custom[field.key], 'North');
});

test('the board filter matches only an exact select value and clears on a stale key', () => {
  const s = state();
  const field = addOk(s, { label: 'Zone', type: 'select', options: ['North', 'South'] });
  C.setValue(s, s.tasks[0], field.key, 'North');
  C.setFilter(s, field.key, 'North');
  assert.equal(C.matchesFilter(s, s.tasks[0]), true);
  C.setFilter(s, field.key, 'South');
  assert.equal(C.matchesFilter(s, s.tasks[0]), false);
  C.setFilter(s, 'cf_missing', 'North');
  assert.deepEqual(plain(C.filter(s)), { key: '', value: '' });
  assert.equal(C.matchesFilter(s, s.tasks[0]), true);
});
