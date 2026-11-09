/* Process model unit tests. js/mmgr-process.js is loaded into a vm sandbox so
   the edges, the refusals and the repair are deterministic without a browser. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'js', 'mmgr-process.js'), 'utf8');

const sandbox = { window: {}, console };
sandbox.window.MMGR = {};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const P = sandbox.window.MMGR.Process;
const plain = value => JSON.parse(JSON.stringify(value));

const base = (over = {}) => ({
  userName: 'Ana',
  changes: [
    {
      id: 'C-1',
      title: 'Extra drainage',
      requester: 'Client',
      notes: '',
      status: 'submitted',
      approvedBy: '',
      ...over
    }
  ],
  issues: [{ id: 'I-1', description: 'Crack in slab', status: 'open', resolution: '' }],
  transitions: []
});

test('a submitted change cannot jump straight to approved', () => {
  const s = base();
  const res = P.canMove(s, 'change', 0, 'approved');
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'illegal');
  assert.match(res.message, /Review it first/);
});

test('approved, rejected and cancelled are final', () => {
  ['approved', 'rejected', 'cancelled'].forEach(from => {
    const s = base({ status: from, approvedBy: 'Ana' });
    const res = P.canMove(s, 'change', 0, 'submitted');
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'illegal');
    assert.match(res.message, /final/);
  });
});

test('review needs a name and approval needs a title', () => {
  const s = base();
  s.userName = '';
  const noName = P.canMove(s, 'change', 0, 'review');
  assert.equal(noName.ok, false);
  assert.equal(noName.reason, 'approver');
  assert.match(noName.message, /Controls/);

  s.userName = 'Ana';
  assert.equal(P.canMove(s, 'change', 0, 'review').ok, true);
  s.changes[0].status = 'review';
  s.changes[0].title = '   ';
  const noTitle = P.canMove(s, 'change', 0, 'approved');
  assert.equal(noTitle.ok, false);
  assert.equal(noTitle.reason, 'title');
});

test('a rejection needs a reason in the notes', () => {
  const s = base({ status: 'review' });
  const refused = P.canMove(s, 'change', 0, 'rejected');
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'reason');
  s.changes[0].notes = 'Not in the contract.';
  assert.equal(P.canMove(s, 'change', 0, 'rejected').ok, true);
});

test('an accepted move writes exactly one history entry', () => {
  const s = base({ status: 'review' });
  const res = P.applyMove(s, 'change', 0, 'approved');
  assert.equal(res.ok, true);
  assert.equal(s.changes[0].status, 'approved');
  assert.equal(s.changes[0].approvedBy, 'Ana');
  assert.equal(s.transitions.length, 1);
  const row = s.transitions[0];
  assert.equal(row.kind, 'change');
  assert.equal(row.ref, 'C-1');
  assert.equal(row.from, 'review');
  assert.equal(row.to, 'approved');
  assert.equal(row.by, 'Ana');
  assert.equal(row.via, 'user');
  assert.ok(row.at);
  // The same move again is a no-op and records nothing.
  const again = P.applyMove(s, 'change', 0, 'approved');
  assert.equal(again.noop, true);
  assert.equal(s.transitions.length, 1);
});

test('a second approver is required before an approval', () => {
  const s = base({ status: 'review', secondApproverRequired: true });
  const refused = P.canMove(s, 'change', 0, 'approved');
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'second-approver');
  s.changes[0].secondApprover = 'Ben';
  assert.equal(P.applyMove(s, 'change', 0, 'approved').ok, true);
});

test('issues resolve with a note, reopen, and close once', () => {
  const s = base();
  const noNote = P.applyMove(s, 'issue', 0, 'resolved');
  assert.equal(noNote.ok, false);
  assert.equal(noNote.reason, 'reason');
  assert.equal(P.applyMove(s, 'issue', 0, 'resolved', { reason: 'Grouted and sealed.' }).ok, true);
  assert.equal(s.issues[0].status, 'resolved');
  assert.equal(s.issues[0].resolution, 'Grouted and sealed.');
  assert.equal(P.applyMove(s, 'issue', 0, 'open').ok, true);
  assert.equal(P.applyMove(s, 'issue', 0, 'resolved', { reason: 'Again.' }).ok, true);
  assert.equal(P.applyMove(s, 'issue', 0, 'closed').ok, true);
  const terminal = P.canMove(s, 'issue', 0, 'open');
  assert.equal(terminal.ok, false);
  assert.match(terminal.message, /final/);
});

test('history survives the deletion of its record', () => {
  const s = base({ status: 'review' });
  P.applyMove(s, 'change', 0, 'approved');
  s.changes.splice(0, 1);
  const rows = P.historyFor(s, 'change', 'C-1');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].to, 'approved');
});

test('repair steps an impossible status back and records why', () => {
  const s = base({ status: 'archived' });
  s.changes.push({ id: 'C-2', title: 'X', requester: '', status: 'review', approvedBy: '' });
  s.changes.push({
    id: 'C-3',
    title: '',
    requester: 'Client',
    status: 'approved',
    approvedBy: 'Ana'
  });
  s.issues[0].status = 'resolved';
  assert.equal(P.needsRepair(s), true);
  const made = P.repairAll(s);
  assert.equal(made, 4);
  assert.equal(s.changes[0].status, 'submitted');
  assert.equal(s.changes[1].status, 'submitted');
  assert.equal(s.changes[2].status, 'review');
  assert.equal(s.issues[0].status, 'open');
  assert.equal(P.needsRepair(s), false);
  const repairs = s.transitions.filter(r => r.via === 'repair');
  assert.equal(repairs.length, 4);
  assert.match(repairs[0].reason, /Repaired on read/);
  // A second pass changes nothing.
  assert.equal(P.repairAll(s), 0);
});

test('the feed is newest first and filters by kind', () => {
  const s = base({ status: 'review' });
  P.applyMove(s, 'change', 0, 'approved');
  P.applyMove(s, 'issue', 0, 'resolved', { reason: 'Done.' });
  const all = P.feed(s);
  assert.equal(all.length, 2);
  const changes = P.feed(s, 'change');
  assert.equal(changes.length, 1);
  assert.equal(changes[0].kind, 'change');
});

const ruleBase = () => ({
  userName: 'Ana',
  changes: [
    { id: 'C-1', title: 'Extra drainage', requester: 'Client', notes: '', status: 'submitted' }
  ],
  issues: [],
  risks: [{ id: 'R-1', description: 'Groundwater', probability: 'High', impact: 'High' }],
  transitions: [],
  rules: [],
  ruleLog: [],
  logEntries: []
});

test('a rule raises an issue when a risk score passes a threshold', () => {
  const s = ruleBase();
  s.rules.push({
    id: 'r1',
    name: 'High risk raises an issue',
    enabled: true,
    trigger: { kind: 'risk', event: 'field' },
    conditions: [{ field: 'score', op: 'gt', value: '6' }],
    action: { type: 'raiseIssue', text: 'Treat {title}' }
  });
  const ctx = P.runRules(s, 'field', 'risk', 0);
  assert.equal(ctx.fired, 1);
  assert.equal(s.issues.length, 1);
  assert.equal(s.issues[0].status, 'open');
  assert.equal(s.issues[0].sourceRiskId, 'R-1');
  assert.equal(s.risks[0].issueId, s.issues[0].id);
  assert.equal(s.ruleLog.length, 1);
  assert.equal(s.ruleLog[0].result, 'done');
});

test('a disabled rule does nothing', () => {
  const s = ruleBase();
  s.rules.push({
    id: 'r1',
    name: 'Off',
    enabled: false,
    trigger: { kind: 'risk', event: 'field' },
    conditions: [],
    action: { type: 'raiseIssue' }
  });
  assert.equal(P.runRules(s, 'field', 'risk', 0).fired, 0);
  assert.equal(s.issues.length, 0);
  assert.equal(s.ruleLog.length, 0);
});

test('a rule cannot fire on another rule action: the chain stops and says so', () => {
  const s = ruleBase();
  s.risks[0].probability = 'Low';
  s.rules.push({
    id: 'r1',
    name: 'Lift probability',
    enabled: true,
    trigger: { kind: 'risk', event: 'field' },
    conditions: [{ field: 'probability', op: 'is', value: 'Low' }],
    action: { type: 'setField', field: 'probability', value: 'High' }
  });
  s.rules.push({
    id: 'r2',
    name: 'Tell someone',
    enabled: true,
    trigger: { kind: 'risk', event: 'field' },
    conditions: [{ field: 'probability', op: 'is', value: 'High' }],
    action: { type: 'notify', text: 'High risk' }
  });
  const ctx = P.runRules(s, 'field', 'risk', 0);
  assert.equal(ctx.fired, 1);
  assert.equal(ctx.messages.length, 0);
  assert.equal(s.risks[0].probability, 'High');
  const stopped = s.ruleLog.find(r => r.rule === 'r2');
  assert.ok(stopped);
  assert.equal(stopped.result, 'refused');
  assert.match(stopped.note, /Chain stopped/);
});

test('a rule fires only on the event it declares', () => {
  const s = ruleBase();
  s.rules.push({
    id: 'r1',
    name: 'Only on a status move',
    enabled: true,
    trigger: { kind: 'change', event: 'status' },
    conditions: [],
    action: { type: 'appendLog', text: 'Moved {ref}' }
  });
  assert.equal(P.runRules(s, 'created', 'change', 0).fired, 0);
  assert.equal(P.runRules(s, 'field', 'change', 0).fired, 0);
  assert.equal(s.logEntries.length, 0);
  assert.equal(P.runRules(s, 'status', 'change', 0).fired, 1);
  assert.equal(s.logEntries.length, 1);
});

test('a rule cannot bypass the change guard', () => {
  const s = ruleBase();
  s.rules.push({
    id: 'r1',
    name: 'Auto approve',
    enabled: true,
    trigger: { kind: 'change', event: 'created' },
    conditions: [],
    action: { type: 'setField', field: 'status', value: 'approved' }
  });
  P.runRules(s, 'created', 'change', 0);
  assert.equal(s.changes[0].status, 'submitted');
  assert.equal(s.transitions.length, 0);
  assert.equal(s.ruleLog[0].result, 'refused');
  assert.match(s.ruleLog[0].note, /Review it first/);
});

test('raiseIssue is refused for anything but a risk', () => {
  const s = ruleBase();
  s.rules.push({
    id: 'r1',
    name: 'Wrong kind',
    enabled: true,
    trigger: { kind: 'change', event: 'created' },
    conditions: [],
    action: { type: 'raiseIssue' }
  });
  P.runRules(s, 'created', 'change', 0);
  assert.equal(s.issues.length, 0);
  assert.equal(s.ruleLog[0].result, 'refused');
});

test('appendLog fills the record placeholders', () => {
  const s = ruleBase();
  s.rules.push({
    id: 'r1',
    name: 'Note the change',
    enabled: true,
    trigger: { kind: 'change', event: 'created' },
    conditions: [],
    action: { type: 'appendLog', text: 'Change {ref} raised: {title}' }
  });
  P.runRules(s, 'created', 'change', 0);
  assert.equal(s.logEntries.length, 1);
  assert.match(s.logEntries[0].decision, /Change C-1 raised: Extra drainage/);
  assert.match(s.logEntries[0].by, /Rule: Note the change/);
});

test('requireApproval sets the flag the change guard then honours', () => {
  const s = ruleBase();
  s.changes[0].status = 'review';
  s.rules.push({
    id: 'r1',
    name: 'Second pair of eyes',
    enabled: true,
    trigger: { kind: 'change', event: 'field' },
    conditions: [{ field: 'costImpact', op: 'gt', value: '10000' }],
    action: { type: 'requireApproval' }
  });
  s.changes[0].costImpact = '12000';
  P.runRules(s, 'field', 'change', 0);
  assert.equal(s.changes[0].secondApproverRequired, true);
  const refused = P.canMove(s, 'change', 0, 'approved');
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'second-approver');
});
