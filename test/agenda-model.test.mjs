/* Agenda model unit tests. js/mmgr-agenda.js is loaded into a vm sandbox
   with a fixed today, so the window and overdue rules are deterministic. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'js', 'mmgr-agenda.js'), 'utf8');

const sandbox = { window: {}, console };
sandbox.window.MMGR = {
  Utils: { todayStr: () => '2026-10-26' }
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const A = sandbox.window.MMGR.Agenda;
const plain = value => JSON.parse(JSON.stringify(value));
const TODAY = '2026-10-26';

const base = () => ({
  tasks: [],
  meetings: [],
  issues: [],
  changes: [],
  ideas: []
});

test('build merges six record kinds and sorts by date then kind', () => {
  const s = base();
  s.tasks.push({
    id: 't1',
    name: 'Pour slab',
    status: 'todo',
    endDate: '2026-10-28',
    assignee: 'Ana'
  });
  s.tasks.push({
    id: 't2',
    name: 'Gate review',
    status: 'todo',
    endDate: '2026-10-27',
    milestone: true
  });
  s.meetings.push({
    id: 1,
    title: 'Weekly',
    kind: 'weekly',
    startedAt: '2026-10-26T09:00:00.000Z'
  });
  s.issues.push({
    id: 'I1',
    description: 'Shared access',
    status: 'open',
    targetDate: '2026-10-30'
  });
  s.changes.push({ id: 'C1', title: 'Add canopy', status: 'review', date: '2026-10-29' });
  s.ideas.push({
    id: 'i1',
    title: 'Cure tent',
    stage: 'research',
    createdAt: '2026-10-27T12:00:00.000Z'
  });
  const out = plain(A.build(s, { today: TODAY, days: 30 }));
  assert.deepEqual(
    out.map(e => e.kind),
    ['meeting', 'milestone', 'idea', 'task', 'change', 'issue']
  );
  assert.deepEqual(
    out.map(e => e.date),
    ['2026-10-26', '2026-10-27', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']
  );
  assert.equal(out[3].detail, 'Ana, To do');
  assert.equal(out[3].section, 'wbs');
  assert.equal(out[3].targetId, 't1');
});

test('build drops completed work, closed registers and terminal ideas', () => {
  const s = base();
  s.tasks.push({ id: 't1', name: 'Done task', status: 'completed', endDate: '2026-10-28' });
  s.tasks.push({ id: 't2', name: 'Phase', isPhase: true, endDate: '2026-10-28' });
  s.tasks.push({ id: 't3', name: 'No date', status: 'todo' });
  s.issues.push({ id: 'I1', description: 'Gone', status: 'resolved', targetDate: '2026-10-28' });
  s.changes.push({ id: 'C1', title: 'Gone', status: 'approved', date: '2026-10-28' });
  s.ideas.push({
    id: 'i1',
    title: 'Done',
    stage: 'implemented',
    createdAt: '2026-10-28T00:00:00.000Z'
  });
  s.ideas.push({
    id: 'i2',
    title: 'Parked',
    stage: 'deferred',
    createdAt: '2026-10-28T00:00:00.000Z'
  });
  assert.deepEqual(plain(A.build(s, { today: TODAY, days: 30 })), []);
});

test('the 7-day window stops at day seven and 0 means no horizon', () => {
  const s = base();
  s.tasks.push({ id: 'in', name: 'Day seven', status: 'todo', endDate: '2026-11-02' });
  s.tasks.push({ id: 'out', name: 'Day twelve', status: 'todo', endDate: '2026-11-07' });
  assert.deepEqual(plain(A.build(s, { today: TODAY, days: 7 }).map(e => e.targetId)), ['in']);
  assert.deepEqual(plain(A.build(s, { today: TODAY, days: 0 }).map(e => e.targetId)), [
    'in',
    'out'
  ]);
  assert.equal(A.build(s, { today: TODAY, days: 99 }).length, 2);
  assert.equal(plain(A.summary(s, null, { days: 7 })).window, 'Next 7 days');
});

test('past open work stays and is overdue, past meetings and ideas drop', () => {
  const s = base();
  s.tasks.push({ id: 't1', name: 'Late pour', status: 'inprogress', endDate: '2026-10-20' });
  s.meetings.push({
    id: 1,
    title: 'Old weekly',
    kind: 'weekly',
    startedAt: '2026-10-20T09:00:00.000Z'
  });
  s.ideas.push({
    id: 'i1',
    title: 'Old idea',
    stage: 'idea',
    createdAt: '2026-10-20T09:00:00.000Z'
  });
  const out = plain(A.build(s, { today: TODAY, days: 30 }));
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'task');
  assert.equal(out[0].overdue, true);
  assert.equal(out[0].tone, 'late');
});

test('a milestone is one event, never also a task', () => {
  const s = base();
  s.tasks.push({ id: 't1', name: 'Gate', status: 'todo', endDate: '2026-10-27', milestone: true });
  const out = plain(A.build(s, { today: TODAY, days: 30 }));
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'milestone');
  assert.equal(out[0].section, 'gantt');
});

test('tone marks today and the next two days as now', () => {
  const s = base();
  s.tasks.push({ id: 'a', name: 'Today', status: 'todo', endDate: '2026-10-26' });
  s.tasks.push({ id: 'b', name: 'Plus two', status: 'todo', endDate: '2026-10-28' });
  s.tasks.push({ id: 'c', name: 'Plus three', status: 'todo', endDate: '2026-10-29' });
  assert.deepEqual(plain(A.build(s, { today: TODAY, days: 30 }).map(e => e.tone)), [
    'now',
    'now',
    'later'
  ]);
});

test('group keeps day order and every event lands in one group', () => {
  const s = base();
  s.tasks.push({ id: 'a', name: 'A', status: 'todo', endDate: '2026-10-27' });
  s.tasks.push({ id: 'b', name: 'B', status: 'todo', endDate: '2026-10-27' });
  s.tasks.push({ id: 'c', name: 'C', status: 'todo', endDate: '2026-10-29' });
  const groups = plain(A.group(A.build(s, { today: TODAY, days: 30 })));
  assert.deepEqual(
    groups.map(g => g.date),
    ['2026-10-27', '2026-10-29']
  );
  assert.deepEqual(
    groups[0].events.map(e => e.targetId),
    ['a', 'b']
  );
  assert.equal(A.dayLabel('2026-10-26', { today: TODAY }), 'Today');
  assert.equal(A.dayLabel('2026-10-27', { today: TODAY }), 'Tomorrow');
  assert.equal(A.dayLabel('2026-10-25', { today: TODAY }), 'Yesterday');
  assert.equal(A.dayLabel('2026-10-29', { today: TODAY }), 'Thursday 29 Oct');
});

test('summary counts each kind and totals the overdue ones', () => {
  const s = base();
  s.tasks.push({ id: 'a', name: 'Late', status: 'todo', endDate: '2026-10-20' });
  s.tasks.push({ id: 'b', name: 'Soon', status: 'todo', endDate: '2026-10-28' });
  s.issues.push({ id: 'I1', description: 'Open', status: 'open', targetDate: '2026-10-27' });
  const sum = plain(A.summary(s, null, { days: 30 }));
  assert.equal(sum.total, 3);
  assert.equal(sum.overdue, 1);
  assert.equal(sum.counts.task, 2);
  assert.equal(sum.counts.issue, 1);
  assert.equal(sum.counts.idea, 0);
});

test('ics is a CRLF calendar with date-only events and escaped text', () => {
  const s = base();
  s.tasks.push({
    id: 't1',
    name: 'Pour, cure; inspect',
    status: 'todo',
    endDate: '2026-10-28',
    assignee: 'Ana'
  });
  const out = A.ics(s, { today: TODAY, days: 30, now: new Date('2026-10-26T01:02:03Z') });
  assert.equal(out.includes('\r\n'), true);
  assert.equal(/\n(?!\r)/.test(out.replace(/\r\n/g, '')), false);
  assert.match(out, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
  assert.match(out, /DTSTAMP:20261026T010203Z/);
  assert.match(out, /DTSTART;VALUE=DATE:20261028/);
  assert.match(out, /DTEND;VALUE=DATE:20261029/);
  assert.match(out, /SUMMARY:Pour\\, cure\\; inspect/);
  assert.match(out, /UID:task:t1@mymanager/);
  assert.equal((out.match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.match(out, /END:VCALENDAR\r\n$/);
  // No raw line may exceed 75 octets.
  out
    .split('\r\n')
    .filter(l => l && !l.startsWith(' '))
    .forEach(line => assert.ok(line.length <= 75, line));
});

test('parseISO rejects impossible dates and never shifts a day', () => {
  assert.equal(A.parseISO('2026-02-30'), null);
  assert.equal(A.parseISO('26-02-03'), null);
  assert.equal(A.parseISO(''), null);
  assert.equal(A.parseISO('2026-02-03').toString(), String(Date.UTC(2026, 1, 3)));
  assert.equal(A.dayLabel('2026-03-01', { today: TODAY }), 'Sunday 1 Mar');
});
