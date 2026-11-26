/* ============================================================
   qa-rollup-parents.cjs - WBS parent roll-up law (owner 2026-11-26)
   ------------------------------------------------------------
   A parent row (a phase, or a non-phase "main task" that children name by
   parentId OR parentName) is a SPAN over its children - earliest start to
   latest end - never the sum of their durations. Ten subtasks that total
   60 working days are:

     - 60 days of span when they run back-to-back, and
     - 6 days of span when they all run in parallel.

   This harness proves, against the REAL browser engine in a vm sandbox and
   the server port, that:

     R1 a parallel 10-subtask parent takes the 6-day span, not the stored 60
     R2 a sequential 10-subtask parent correctly takes the 60-day span
     R3 a nested grandparent settles on the child parent's corrected span
     R4 a phase keeps its stored duration (the Gantt treats it as a span)
     R5 the server port matches the browser engine byte-for-byte
     R6 get_schedule excludes scaffolding from workItemCount and missingDuration
     R7 get_project_health counts 10 work items, not 11
     R8 structural lint flags a parent whose stored dates do not span children

   Pure Node. No Chrome, no wrangler. Registry: CI-TEST-COVERAGE.md -> CI.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const results = [];
const check = (name, val, detail) => {
  results.push({ name, val: !!val });
  const tag = val ? 'PASS' : 'FAIL';
  process.stdout.write(
    '[rollup] ' +
      tag +
      '  ' +
      name +
      (val ? '' : '  <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 500)) +
      '\n'
  );
};

// Independent inclusive working-day count (Mon-Fri), used as the expectation
// so the test does not borrow the engine's own maths.
function workDays(a, b) {
  const start = new Date(a + 'T00:00:00Z');
  const end = new Date(b + 'T00:00:00Z');
  if (end < start) {
    return 0;
  }
  let n = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const dow = cur.getUTCDay();
    if (dow >= 1 && dow <= 5) {
      n++;
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return n;
}

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

// ---- the REAL browser schedule engine, sandboxed (same loader as qa-mcp-surface)
function loadBrowserEngine(state) {
  const sandbox = {
    window: { MMGR: {}, addEventListener() {} },
    document: {
      addEventListener() {},
      querySelector() {
        return null;
      }
    },
    console
  };
  sandbox.window.MMGR.State = {
    getState() {
      return state;
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/mmgr-utils.js'), 'utf8'), sandbox, {
    filename: 'mmgr-utils.js'
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/mmgr-schedule.js'), 'utf8'), sandbox, {
    filename: 'mmgr-schedule.js'
  });
  return sandbox.window.MMGR;
}

// A main task with ten subtasks. `sequential` chains the six-working-day
// children back-to-back; otherwise they all run on the same six days.
function mainWithTenSubtasks(sequential) {
  const tasks = [
    {
      id: 'm1',
      name: 'Main task',
      level: 0,
      startDate: '2026-01-05',
      endDate: '2026-01-12',
      duration: '60' // the wrong, summed value the owner reported
    }
  ];
  const starts = [
    '2026-01-05',
    '2026-01-13',
    '2026-01-21',
    '2026-01-29',
    '2026-02-06',
    '2026-02-16',
    '2026-02-24',
    '2026-03-04',
    '2026-03-12',
    '2026-03-20'
  ];
  const ends = [
    '2026-01-12',
    '2026-01-20',
    '2026-01-28',
    '2026-02-05',
    '2026-02-13',
    '2026-02-23',
    '2026-03-03',
    '2026-03-11',
    '2026-03-19',
    '2026-03-27'
  ];
  for (let i = 0; i < 10; i++) {
    tasks.push({
      id: 's' + (i + 1),
      name: 'Subtask ' + (i + 1),
      parentName: 'Main task',
      level: 1,
      startDate: sequential ? starts[i] : '2026-01-05',
      endDate: sequential ? ends[i] : '2026-01-12',
      duration: '6'
    });
  }
  return tasks;
}

(async () => {
  const port = await import('../src/domain/task-effects.js');
  const schedule = await import('../src/mcp/schedule.js');
  const health = await import('../src/mcp/health.js');

  // ---- R1 parallel: span 6, not 60 -------------------------------------
  {
    const state = { tasks: mainWithTenSubtasks(false), workWeek: 5 };
    const MMGR = loadBrowserEngine(state);
    const changed = MMGR.Schedule.rollupPhases(state.tasks);
    const parent = state.tasks[0];
    const expected = workDays('2026-01-05', '2026-01-12');
    check(
      'R1a parallel 10-subtask parent spans the children dates (not the sum)',
      parent.startDate === '2026-01-05' && parent.endDate === '2026-01-12',
      { start: parent.startDate, end: parent.endDate }
    );
    check(
      'R1b parallel parent Days cell is the ' + expected + '-day span, not 60',
      String(parent.duration) === String(expected) && String(parent.duration) !== '60',
      { duration: parent.duration, expected }
    );
    check('R1c the roll-up reports the parent as corrected', changed >= 1, { changed });
  }

  // ---- R2 sequential: span really is 60 --------------------------------
  {
    const state = { tasks: mainWithTenSubtasks(true), workWeek: 5 };
    const MMGR = loadBrowserEngine(state);
    MMGR.Schedule.rollupPhases(state.tasks);
    const parent = state.tasks[0];
    const expected = workDays('2026-01-05', '2026-03-27');
    check(
      'R2a sequential 10-subtask parent spans 2026-01-05 -> 2026-03-27',
      parent.startDate === '2026-01-05' && parent.endDate === '2026-03-27',
      { start: parent.startDate, end: parent.endDate }
    );
    check(
      'R2b sequential parent Days cell equals the ' + expected + '-working-day span',
      String(parent.duration) === String(expected),
      { duration: parent.duration, expected }
    );
  }

  // ---- R3 nested parent settles ---------------------------------------
  {
    const state = {
      workWeek: 5,
      tasks: [
        {
          id: 'g',
          name: 'Grand',
          level: 0,
          startDate: '2026-01-01',
          endDate: '2026-01-02',
          duration: '1'
        },
        {
          id: 'm',
          name: 'Main',
          parentName: 'Grand',
          level: 1,
          startDate: '2026-01-01',
          endDate: '2026-01-02',
          duration: '1'
        },
        {
          id: 'a',
          name: 'A',
          parentName: 'Main',
          level: 2,
          startDate: '2026-01-05',
          endDate: '2026-01-09',
          duration: '5'
        },
        {
          id: 'b',
          name: 'B',
          parentName: 'Main',
          level: 2,
          startDate: '2026-01-12',
          endDate: '2026-01-16',
          duration: '5'
        }
      ]
    };
    const MMGR = loadBrowserEngine(state);
    MMGR.Schedule.rollupPhases(state.tasks);
    const g = state.tasks[0];
    check(
      'R3 a grandparent settles on the child parent corrected span',
      g.startDate === '2026-01-05' && g.endDate === '2026-01-16',
      { start: g.startDate, end: g.endDate }
    );
  }

  // ---- R4 a phase keeps its stored duration ----------------------------
  {
    const state = {
      workWeek: 5,
      tasks: [
        {
          id: 'ph',
          name: 'Phase',
          isPhase: true,
          startDate: '2026-01-01',
          endDate: '2026-01-02',
          duration: '0'
        },
        {
          id: 'c',
          name: 'Child',
          parentName: 'Phase',
          startDate: '2026-01-05',
          endDate: '2026-01-09',
          duration: '5'
        }
      ]
    };
    const MMGR = loadBrowserEngine(state);
    MMGR.Schedule.rollupPhases(state.tasks);
    const ph = state.tasks[0];
    check(
      'R4 a phase rolls up its dates but keeps its stored duration',
      ph.startDate === '2026-01-05' && ph.endDate === '2026-01-09' && String(ph.duration) === '0',
      { start: ph.startDate, end: ph.endDate, duration: ph.duration }
    );
  }

  // ---- R5 browser vs server port parity --------------------------------
  {
    const browserState = { tasks: mainWithTenSubtasks(true), workWeek: 5 };
    const MMGR = loadBrowserEngine(browserState);
    MMGR.Schedule.rollupPhases(browserState.tasks);

    const portState = { tasks: mainWithTenSubtasks(true) };
    port.rollupPhases(portState.tasks, 5);

    const b = browserState.tasks[0];
    const p = portState.tasks[0];
    check(
      'R5 the server port matches the browser engine (dates and Days cell)',
      b.startDate === p.startDate &&
        b.endDate === p.endDate &&
        String(b.duration) === String(p.duration),
      {
        browser: { s: b.startDate, e: b.endDate, d: b.duration },
        port: { s: p.startDate, e: p.endDate, d: p.duration }
      }
    );
  }

  // ---- R6 get_schedule excludes scaffolding ----------------------------
  {
    const state = { tasks: mainWithTenSubtasks(false), workWeek: 5 };
    const sched = schedule.computeSchedule(state);
    const parent = sched.rows.find(r => r.id === 'm1');
    check(
      'R6a get_schedule marks the main task as a parent',
      parent && parent.isParent === true,
      parent
    );
    check('R6b workItemCount counts the 10 subtasks, not the parent', sched.workItemCount === 10, {
      workItemCount: sched.workItemCount
    });
    check('R6c the parent is not counted as missing a duration', sched.missingDuration === 0, {
      missingDuration: sched.missingDuration
    });
    check(
      'R6d the parent ES/EF span the children',
      parent && parent.es === '2026-01-05' && parent.ef === '2026-01-12',
      parent
    );
  }

  // ---- R7 health counts work items, not scaffolding --------------------
  {
    const state = {
      tasks: mainWithTenSubtasks(false),
      workWeek: 5,
      charter: { name: 'Roll-up fixture' }
    };
    const h = health.buildHealth(state);
    const dataChecks = (h.gates.data && h.gates.data.checks) || [];
    const countLine = dataChecks.map(c => c.detail).join(' | ');
    check('R7 health reports 10 work items, not 11', /10 work item/.test(countLine), { countLine });
  }

  // ---- R8 lint flags a parent whose dates do not span children ---------
  {
    const tasks = mainWithTenSubtasks(false);
    tasks[0].startDate = '2026-01-05';
    tasks[0].endDate = '2026-01-06'; // too narrow: children run to 01-12
    const lint = health.buildLint({ tasks, workWeek: 5 });
    const hit = lint.find(l => l.id === 'm1' && /do not span its children/.test(l.detail || ''));
    check(
      'R8 lint flags a parent whose stored dates do not span its children',
      !!hit,
      lint.filter(l => l.id === 'm1')
    );
  }

  const failed = results.filter(r => !r.val);
  process.stdout.write(
    '\n========== QA-ROLLUP-PARENTS RESULT: ' +
      (results.length - failed.length) +
      ' passed, ' +
      failed.length +
      ' failed ==========\n'
  );
  process.exit(failed.length ? 1 : 0);
})().catch(err => {
  process.stderr.write(String(err && err.stack ? err.stack : err) + '\n');
  process.exit(1);
});
