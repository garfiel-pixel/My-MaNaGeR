/* Accept-side field stamps. An accept applies changes server-side, so the
   top-level fields it touched must carry a fresh per-field timestamp: a
   client's field-level merge keeps its own copy on an equal-or-newer stamp,
   which is how an accepted resource never reached the open page. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stampChangedFieldTs } from '../src/lib/http.js';

const acceptTime = '2026-11-20T09:00:00.000Z';

test('stampChangedFieldTs stamps only the fields the accept changed', () => {
  const prev = {
    resources: [{ id: 'r1', name: 'Existing' }],
    tasks: [{ id: 't1', name: 'A' }],
    fieldTs: { resources: '2026-11-20T08:00:00.000Z', tasks: '2026-11-20T08:00:00.000Z' }
  };
  const next = JSON.parse(JSON.stringify(prev));
  next.resources.push({ id: 'r2', name: 'Damien Loki' });
  const changed = stampChangedFieldTs(prev, next, acceptTime);
  assert.deepEqual(changed, ['resources']);
  assert.equal(next.fieldTs.resources, acceptTime);
  assert.equal(next.fieldTs.tasks, '2026-11-20T08:00:00.000Z');
});

test('stampChangedFieldTs creates fieldTs when the blob has none', () => {
  const prev = { resources: [] };
  const next = { resources: [{ id: 'r1', name: 'Damien Loki' }] };
  stampChangedFieldTs(prev, next, acceptTime);
  assert.deepEqual(next.fieldTs, { resources: acceptTime });
});

test('stampChangedFieldTs ignores bookkeeping keys', () => {
  const prev = { resources: [], fieldTs: {}, updatedAt: '2026-11-20T08:00:00.000Z', revision: 4 };
  const next = { resources: [], fieldTs: {}, updatedAt: acceptTime, revision: 5 };
  const changed = stampChangedFieldTs(prev, next, acceptTime);
  assert.deepEqual(changed, []);
  assert.deepEqual(next.fieldTs, {});
});
