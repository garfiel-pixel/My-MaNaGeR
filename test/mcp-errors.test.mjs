/* MCP error-code set (MCP-AGENT-FIRST ADDENDUM A2, 2026-11-13).
   The taxonomy is FROZEN and both classifiers must always return a member, so
   an agent can branch on `code` without a "code not in the set" surprise. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MCP_ERROR_CODES, refusalCode, applyResultCode } from '../src/mcp/errors.js';

test('the error-code set is frozen, unique and 23 long', () => {
  assert.equal(MCP_ERROR_CODES.length, 23);
  assert.ok(Object.isFrozen(MCP_ERROR_CODES));
  assert.equal(new Set(MCP_ERROR_CODES).size, 23);
  [
    'STALE_BEFORE',
    'UNKNOWN_FIELD',
    'INVALID_ENUM',
    'RECORD_NOT_FOUND',
    'CONFLICT',
    'SKIPPED_ALREADY',
    'REFUSED'
  ].forEach(c => assert.ok(MCP_ERROR_CODES.includes(c), c));
});

test('refusalCode always returns a member of the set', () => {
  const samples = [
    'tasks.nope: unknown field. Allowed: id, name',
    'tasks[t1].status: not one of: todo, inprogress, blocked, completed',
    'zzz: not found in tasks',
    'notASection: not a project section',
    'tasks: outside the granted sections',
    'tasks[t1].status: stale before: expected todo, live inprogress',
    'tasks[t1].critical: derived field, recomputed by the app',
    'spendLog: use the budget array (addDelivery)',
    'nspid: server-managed and cannot be written',
    'tasks[t1].notes: longer than 4000 characters',
    'diff 0: invalid',
    '',
    'some totally unmapped prose'
  ];
  samples.forEach(s => {
    const c = refusalCode(s);
    assert.ok(MCP_ERROR_CODES.includes(c), JSON.stringify(s) + ' -> ' + c);
  });
  assert.equal(refusalCode('tasks[t1].status: stale before: expected todo'), 'STALE_BEFORE');
  assert.equal(refusalCode('tasks.nope: unknown field. Allowed: id'), 'UNKNOWN_FIELD');
  assert.equal(refusalCode('zzz: not found in tasks'), 'RECORD_NOT_FOUND');
  assert.equal(refusalCode('some totally unmapped prose'), 'REFUSED');
});

test('applyResultCode: applied=null, skip=SKIPPED_ALREADY, conflict classified', () => {
  assert.equal(applyResultCode('applied'), null);
  assert.equal(applyResultCode('skipped_already', 'value already set'), 'SKIPPED_ALREADY');
  assert.equal(applyResultCode('conflict', 'stale before: expected completed'), 'STALE_BEFORE');
  assert.equal(applyResultCode('conflict', 'out of the granted scope'), 'OUT_OF_SCOPE');
  assert.equal(applyResultCode('conflict', 'unmapped'), 'CONFLICT');
});
