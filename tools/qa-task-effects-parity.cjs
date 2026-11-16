/* ============================================================
   qa-task-effects-parity.cjs - F1.2 parity law (MCP-FINAL 2026-11-16)
   ------------------------------------------------------------
   The MCP accept applies task ops on the server. The browser owns the side
   effects of a task edit: a status move stamps statusSince / startedDate /
   completedDate and clears leadTime (js/mmgr-kanban.js stampStatus + the
   updTaskField status branch), and a date/duration edit recomputes the triad
   and rolls phases up (js/mmgr-tasks.js + js/mmgr-schedule.js). This harness
   proves the pure server port (src/domain/task-effects.js) produces EXACTLY
   what the client does:

     1. It extracts the real `stampStatus` source out of js/mmgr-kanban.js and
        runs it in a sandbox, then compares its output to the port across every
        status fixture (zero differences).
     2. It runs 12 transition / triad / roll-up fixtures through the port and
        asserts the expected stamps and dates.

   Pure Node. No Chrome, no wrangler. Exit 0 only when every gate passes.
   Registry: CI-TEST-COVERAGE.md -> CI (static job).
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DAY = '2026-11-16';
const results = [];
const check = (name, val, detail) => {
  results.push({ name, val: !!val });
  const tag = val ? 'PASS' : 'FAIL';
  process.stdout.write(
    '[' +
      'task-effects' +
      '] ' +
      tag +
      '  ' +
      name +
      (val ? '' : '  <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 400)) +
      '\n'
  );
};

// ---- The real client stampStatus, extracted and sandboxed ----------------
function loadClientStampStatus() {
  const src = fs.readFileSync(path.join(ROOT, 'js/mmgr-kanban.js'), 'utf8');
  const m = /function stampStatus\(task, status, today\) \{[\s\S]*?\n  \}/.exec(src);
  if (!m) {
    return null;
  }
  // The extracted function calls todayStr(); stub it to the fixed day.
  const factory = new Function('todayStr', m[0] + '\nreturn stampStatus;');
  return factory(() => DAY);
}

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

(async () => {
  const port = await import('../src/domain/task-effects.js');
  const clientStamp = loadClientStampStatus();
  check('the real client stampStatus was extracted from js/mmgr-kanban.js', !!clientStamp, {});

  // ---- 1. Client-vs-port stampStatus parity across status transitions ----
  const transitions = [
    ['todo', 'inprogress', {}],
    ['todo', 'completed', {}],
    ['todo', 'blocked', {}],
    ['inprogress', 'completed', { startedDate: '2026-11-01' }],
    ['completed', 'todo', { startedDate: '2026-11-01', completedDate: '2026-11-05' }],
    ['completed', 'inprogress', { startedDate: '2026-11-01', completedDate: '2026-11-05' }],
    ['todo', 'inprogress', { startedDate: '2026-10-30' }], // existing start preserved
    ['blocked', 'completed', { statusSince: '2026-11-02' }],
    ['todo', 'inprogress', { leadTime: true }],
    ['inprogress', 'inprogress', { startedDate: '2026-11-01', leadTime: true }]
  ];
  let parityFailures = 0;
  transitions.forEach(([from, to, extra], i) => {
    const base = Object.assign({ id: 't' + i, status: from }, extra);
    const a = clone(base);
    const b = clone(base);
    clientStamp(a, to, DAY);
    port.stampStatus(b, to, DAY);
    const same = JSON.stringify(a) === JSON.stringify(b);
    if (!same) {
      parityFailures++;
    }
    check(
      'P1.' + (i + 1) + ' port stampStatus === client stampStatus (' + from + ' -> ' + to + ')',
      same,
      { client: a, port: b }
    );
  });
  check('P1 port matches the client stampStatus on every fixture', parityFailures === 0, {
    parityFailures
  });

  // ---- 2. applyTaskEffects fixtures -------------------------------------
  // Fixture 1: todo -> completed via the accept path.
  {
    const before = [{ id: 'a', status: 'todo' }];
    const after = [{ id: 'a', status: 'completed' }];
    port.applyTaskEffects(after, before, { today: DAY });
    check(
      'T1 todo -> completed stamps statusSince + completedDate and clears leadTime',
      after[0].statusSince === DAY &&
        after[0].completedDate === DAY &&
        after[0].leadTime === false &&
        after[0].startedDate === undefined,
      after[0]
    );
  }
  // Fixture 2: todo -> inprogress stamps startedDate.
  {
    const before = [{ id: 'b', status: 'todo' }];
    const after = [{ id: 'b', status: 'inprogress' }];
    port.applyTaskEffects(after, before, { today: DAY });
    check(
      'T2 todo -> inprogress stamps startedDate + statusSince',
      after[0].startedDate === DAY && after[0].statusSince === DAY && after[0].leadTime === false,
      after[0]
    );
  }
  // Fixture 3: completed -> todo clears completedDate.
  {
    const before = [{ id: 'c', status: 'completed', completedDate: '2026-11-01' }];
    const after = [{ id: 'c', status: 'todo' }];
    port.applyTaskEffects(after, before, { today: DAY });
    check(
      'T3 completed -> todo clears completedDate and re-stamps statusSince',
      after[0].completedDate === undefined && after[0].statusSince === DAY,
      after[0]
    );
  }
  // Fixture 4: an unchanged status stamps nothing and keeps leadTime.
  {
    const before = [{ id: 'd', status: 'inprogress', statusSince: '2026-11-02', leadTime: true }];
    // A real accept mutates the live record, so the untouched stamps carry over.
    const after = [
      { id: 'd', status: 'inprogress', statusSince: '2026-11-02', leadTime: true, notes: 'x' }
    ];
    port.applyTaskEffects(after, before, { today: DAY });
    check(
      'T4 an unchanged status leaves the stamps and leadTime untouched',
      after[0].statusSince === '2026-11-02' && after[0].leadTime === true,
      after[0]
    );
  }
  // Fixture 5: a created task (no snapshot entry) is left to the create path.
  {
    const before = [];
    const after = [{ id: 'e', status: 'completed' }];
    port.applyTaskEffects(after, before, { today: DAY });
    check(
      'T5 a created task is not stamped by the status-change path',
      after[0].statusSince === undefined && after[0].completedDate === undefined,
      after[0]
    );
  }
  // Fixture 6: duration edit recomputes endDate (5-day week, start Mon).
  {
    const before = [{ id: 'f', startDate: '2026-11-16', duration: '1', endDate: '2026-11-16' }];
    const after = [{ id: 'f', startDate: '2026-11-16', duration: '5', endDate: '2026-11-16' }];
    port.applyTaskEffects(after, before, { today: DAY, workWeek: 5 });
    check(
      'T6 a duration edit recomputes endDate over working days (Mon + 4 = Fri)',
      after[0].endDate === '2026-11-20',
      after[0]
    );
  }
  // Fixture 7: startDate edit recomputes endDate.
  {
    const before = [{ id: 'g', startDate: '2026-11-16', duration: '3', endDate: '2026-11-18' }];
    const after = [{ id: 'g', startDate: '2026-11-17', duration: '3', endDate: '2026-11-18' }];
    port.applyTaskEffects(after, before, { today: DAY, workWeek: 5 });
    check(
      'T7 a startDate edit recomputes endDate (Tue + 2 working days = Thu)',
      after[0].endDate === '2026-11-19',
      after[0]
    );
  }
  // Fixture 8: endDate edit back-computes duration.
  {
    const before = [{ id: 'h', startDate: '2026-11-16', duration: '1', endDate: '2026-11-16' }];
    const after = [{ id: 'h', startDate: '2026-11-16', duration: '1', endDate: '2026-11-20' }];
    port.applyTaskEffects(after, before, { today: DAY, workWeek: 5 });
    check(
      'T8 an endDate edit back-computes duration (Mon..Fri = 5)',
      after[0].duration === '5',
      after[0]
    );
  }
  // Fixture 9: a 6-day work week counts Saturday.
  {
    const before = [{ id: 'i', startDate: '2026-11-16', duration: '1', endDate: '2026-11-16' }];
    const after = [{ id: 'i', startDate: '2026-11-16', duration: '6', endDate: '2026-11-16' }];
    port.applyTaskEffects(after, before, { today: DAY, workWeek: 6 });
    check(
      'T9 a 6-day work week includes Saturday (Mon + 5 = Sat)',
      after[0].endDate === '2026-11-21',
      after[0]
    );
  }
  // Fixture 10: a phase rolls its span up from a changed child.
  {
    const before = [
      { id: 'ph', isPhase: true, startDate: '2026-11-16', endDate: '2026-11-16' },
      { id: 'k1', parentName: 'P', startDate: '2026-11-16', duration: '1', endDate: '2026-11-16' }
    ];
    const after = [
      { id: 'ph', isPhase: true, name: 'P', startDate: '2026-11-16', endDate: '2026-11-16' },
      { id: 'k1', parentName: 'P', startDate: '2026-11-16', duration: '3', endDate: '2026-11-16' }
    ];
    port.applyTaskEffects(after, before, { today: DAY, workWeek: 5 });
    check('T10 a child date edit rolls the phase span up', after[0].endDate === '2026-11-18', {
      phase: after[0]
    });
  }
  // Fixture 11: rollupPhases is idempotent when nothing changed.
  {
    const tasks = [
      { id: 'ph', isPhase: true, name: 'P', startDate: '2026-11-16', endDate: '2026-11-18' },
      { id: 'k1', parentName: 'P', startDate: '2026-11-16', endDate: '2026-11-18' }
    ];
    const changed = port.rollupPhases(tasks);
    check('T11 rollupPhases reports 0 changes when the span already matches', changed === 0, {
      changed
    });
  }
  // Fixture 12: an empty / missing before list never throws and stamps nothing.
  {
    const after = [{ id: 'z', status: 'completed' }];
    let ok = true;
    try {
      port.applyTaskEffects(after, null, { today: DAY });
    } catch (e) {
      ok = false;
    }
    check(
      'T12 applyTaskEffects tolerates a null snapshot without stamping',
      ok && after[0].statusSince === undefined,
      after[0]
    );
  }

  const failed = results.filter(r => !r.val);
  process.stdout.write('\n' + '='.repeat(40) + '\n');
  process.stdout.write(
    'QA-TASK-EFFECTS-PARITY RESULT: ' +
      (results.length - failed.length) +
      ' passed, ' +
      failed.length +
      ' failed\n'
  );
  process.exit(failed.length ? 1 : 0);
})();
