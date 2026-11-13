#!/usr/bin/env node
/* ============================================================
   tools/verify-demo-dates.cjs
   GATE: the seeded demo project must never rot into an overdue wall
   ------------------------------------------------------------
   WHY THIS EXISTS (owner report, 2026-11-12)
   The launcher re-seeds `demo-filled` on every visit, so whatever
   `demo-data.js` says is the first thing a visitor sees. By November 2026
   every one of its 30 tasks ended at or before 2026-06-30: the dashboard
   read "11 overdue", the Gantt was red end to end, and the demo looked
   broken rather than finished. A blind date shift is not enough either -
   a task whose window has already elapsed at 0% is just as visibly wrong.

   This gate is STATIC and STABLE: it judges the fixture against its own
   `updatedAt` ("as of" clock), not against the wall clock, so it cannot
   turn red on a date change alone. It fails when:
     - a non-completed task ends before the fixture's own clock
     - a task at 0% has a start before that clock (work that should have begun)
     - start > end, a missing date, or a duplicate task id
     - `duration` is missing or disagrees with the working-day count
     - the baseline names a task that does not exist
     - charter.targetStart / targetCompletion fall outside the task span
     - a record the process model would silently repair on load:
       approved change with no title, resolved issue with no resolution
     - a weather-log entry is dated after the fixture's clock
   Usage:  node tools/verify-demo-dates.cjs
   Exit:   0 = fixture is coherent, 1 = at least one check failed
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'demo-data.js');

let failures = 0;
function check(name, ok, detail) {
  if (ok) {
    console.log('PASS  ' + name);
    return;
  }
  failures++;
  console.log('FAIL  ' + name + (detail ? ' - ' + detail : ''));
}

function dayMs(iso) {
  return Date.parse(iso + 'T00:00:00Z');
}
function isWorkDay(iso) {
  const d = new Date(iso + 'T00:00:00Z').getUTCDay();
  return d !== 0 && d !== 6;
}
function workingDaysBetween(a, b) {
  let cur = new Date(a + 'T00:00:00Z');
  const end = new Date(b + 'T00:00:00Z');
  cur.setUTCDate(cur.getUTCDate() + 1);
  let n = 0;
  while (cur < end) {
    const d = cur.getUTCDay();
    if (d !== 0 && d !== 6) {
      n++;
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return n;
}
function durationOf(a, b) {
  if (a === b) {
    return 1;
  }
  return workingDaysBetween(a, b) + (isWorkDay(a) ? 1 : 0) + (isWorkDay(b) ? 1 : 0);
}

if (!fs.existsSync(SRC)) {
  console.error('[verify-demo-dates] FAIL: demo-data.js is missing.');
  process.exit(1);
}

const src = fs.readFileSync(SRC, 'utf8');
const win = {};
try {
  new Function('window', src)(win);
} catch (e) {
  console.error('[verify-demo-dates] FAIL: demo-data.js does not evaluate - ' + e.message);
  process.exit(1);
}

const demo = win.MMGR_DEMO_FILLED;
check('MMGR_DEMO_FILLED is defined', !!demo);
if (!demo) {
  process.exit(1);
}

const tasks = Array.isArray(demo.tasks) ? demo.tasks : [];
const clock = String(demo.updatedAt || '').slice(0, 10);
check('updatedAt carries an ISO date', /^\d{4}-\d{2}-\d{2}$/.test(clock), String(demo.updatedAt));
check('the demo carries 30 tasks', tasks.length === 30, String(tasks.length));

const ids = new Set();
let dupes = [];
for (const t of tasks) {
  if (ids.has(t.id)) {
    dupes.push(t.id);
  }
  ids.add(t.id);
}
check('task ids are unique', dupes.length === 0, dupes.join(', '));

let missing = [];
let inverted = [];
let badDuration = [];
let overdue = [];
let lateStart = [];
for (const t of tasks) {
  if (!t.startDate || !t.endDate) {
    missing.push(t.id);
    continue;
  }
  if (dayMs(t.startDate) > dayMs(t.endDate)) {
    inverted.push(t.id);
  }
  const want = durationOf(t.startDate, t.endDate);
  if (String(t.duration || '') !== String(want)) {
    badDuration.push(t.id + ' ' + (t.duration || 'none') + '!=' + want);
  }
  if (t.status !== 'completed' && t.endDate < clock) {
    overdue.push(t.id + ' ends ' + t.endDate);
  }
  if (t.status !== 'completed' && Number(t.progress) === 0 && t.startDate < clock) {
    lateStart.push(t.id + ' starts ' + t.startDate);
  }
}
check('every task has both dates', missing.length === 0, missing.join(', '));
check('no task ends before it starts', inverted.length === 0, inverted.join(', '));
check(
  'every duration matches the working-day span',
  badDuration.length === 0,
  badDuration.join(', ')
);
check(
  'no open task ends before the fixture clock (' + clock + ')',
  overdue.length === 0,
  overdue.join('; ')
);
check('no 0% task has an elapsed start', lateStart.length === 0, lateStart.join('; '));

const base = demo.baseline && Array.isArray(demo.baseline.tasks) ? demo.baseline.tasks : [];
const unknownBase = base.filter(b => !ids.has(b.id)).map(b => b.id);
check('baseline rows all name a live task', unknownBase.length === 0, unknownBase.join(', '));

const starts = tasks
  .map(t => t.startDate)
  .filter(Boolean)
  .sort();
const ends = tasks
  .map(t => t.endDate)
  .filter(Boolean)
  .sort();
const charter = demo.charter || {};
check(
  'charter.targetStart is not after the first task',
  !!charter.targetStart && !!starts[0] && charter.targetStart <= starts[0],
  charter.targetStart + ' vs ' + starts[0]
);
check(
  'charter.targetCompletion is not before the last task',
  !!charter.targetCompletion &&
    !!ends[ends.length - 1] &&
    charter.targetCompletion >= ends[ends.length - 1],
  charter.targetCompletion + ' vs ' + ends[ends.length - 1]
);

/* The load-time process repair (mmgr-process.js plannedRepair) rewrites a
   record whose status its history could not have produced. A fixture that
   trips it silently changes what the demo shows, so assert the two rules. */
const repairChanges = (demo.changes || [])
  .filter(c => c && c.status === 'approved' && !String(c.title || '').trim())
  .map(c => c.id || c.name);
const repairIssues = (demo.issues || [])
  .filter(i => i && i.status === 'resolved' && !String(i.resolution || '').trim())
  .map(i => i.id || i.name);
check('approved changes carry a title', repairChanges.length === 0, repairChanges.join(', '));
check('resolved issues carry a resolution', repairIssues.length === 0, repairIssues.join(', '));

const futureWx = (demo.weatherLog || [])
  .filter(w => w && w.date && w.date > clock)
  .map(w => w.date);
check(
  'weather log is historical (not after the fixture clock)',
  futureWx.length === 0,
  futureWx.join(', ')
);

if (failures) {
  console.error('\n[verify-demo-dates] ' + failures + ' check(s) failed.');
  process.exit(1);
}
console.log('\nDEMO FIXTURE PASS - ' + tasks.length + ' tasks, as of ' + clock + '.');
