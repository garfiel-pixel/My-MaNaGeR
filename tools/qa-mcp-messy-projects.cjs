/* ============================================================
   MCP MESSY-PROJECT GATE (qa-mcp-messy-projects)
   ------------------------------------------------------------
   qa-mcp-surface proves the health/schedule port is faithful on
   clean fixtures. This gate asks the harder question: do the
   tools produce conclusions an agent can ACT on when the project
   is messy, the way real projects are?

     M1  a reconstruction of the owner's Resume Maker AI project
         (29 records, no dependency links, dated work items,
         zero effort-to-role link, no frozen baseline) reads as
         NOT executable and names the first fixes with record ids
     M2  cycles and dangling predecessors are blocking, named
         actions, not one more warning in a list
     M3  dates without duration, reversed dates and a milestone
         with a duration produce grouped, id-bearing fixes
     M4  duplicate ids, parentName-only nesting and a budget line
         pointing at a missing task are caught by lint
     M5  two parallel critical branches both appear in the
         critical set (one printed chain is not the whole risk)
     M6  a deadline before the first task and zero availability
         surface as deadline / capacity actions
     M7  a scoped key sees no budget or resource actions, and
         the report never crashes on a partial view

   Pure Node: no Chrome, no wrangler, no network.
   Registry: docs/CI-TEST-COVERAGE.md -> CI (static job).
   ============================================================ */
'use strict';

let pass = 0;
let fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log('PASS  ' + name);
  } else {
    fail++;
    failures.push(name);
    console.log(
      'FAIL  ' + name + (detail !== undefined ? '  => ' + JSON.stringify(detail).slice(0, 700) : '')
    );
  }
}
function section(t) {
  console.log('\n--- ' + t + ' ---');
}

function task(id, name, day, duration, extra) {
  return Object.assign(
    {
      id: id,
      name: name,
      duration: String(duration),
      startDate: '2026-12-' + String(day).padStart(2, '0'),
      endDate: '2026-12-' + String(day + duration).padStart(2, '0'),
      predecessors: [],
      status: 'todo'
    },
    extra || {}
  );
}

function codes(health) {
  return (health.nextActions || []).map(function (a) {
    return a.code;
  });
}

function action(health, code) {
  return (health.nextActions || []).find(function (a) {
    return a.code === code;
  });
}

/* ------------------------------------------------------------------ */
/* M1 — the owner's real project shape, reconstructed from the report */
/* ------------------------------------------------------------------ */
function resumeMaker() {
  const phases = [
    { id: 'ph1', name: 'Discovery & planning' },
    { id: 'ph2', name: 'UX/UI & prototype' },
    { id: 'ph3', name: 'MVP engineering' },
    { id: 'ph4', name: 'QA, pilot & closeout' }
  ].map(function (p) {
    return { id: p.id, name: p.name, isPhase: true, predecessors: [], status: 'todo' };
  });
  const names = [
    'Stakeholder interviews',
    'Target persona definition',
    'Competitor teardown',
    'Product charter',
    'Scope and exclusions',
    'WBS baseline',
    'Resource plan',
    'Risk register',
    'Information architecture',
    'Design tokens',
    'Wireframes',
    'Visual system',
    'Clickable prototype',
    'Usability review',
    'Design handover',
    'Project scaffold',
    'Resume parser',
    'AI rewrite service',
    'Editor UI',
    'Export pipeline',
    'Auth & accounts',
    'Analytics events',
    'Integration tests',
    'Pilot with 10 users',
    'Handover & closure'
  ];
  const work = names.map(function (n, i) {
    const phase = i < 8 ? 'ph1' : i < 15 ? 'ph2' : i < 21 ? 'ph3' : 'ph4';
    const day = 1 + (i % 24);
    return task('w' + (i + 1), n, day, 5, { parentId: phase });
  });
  const roles = [
    'Project manager',
    'Product designer',
    'Frontend engineer',
    'Backend engineer',
    'QA engineer',
    'AI engineer'
  ].map(function (n, i) {
    return {
      id: 'r' + (i + 1),
      name: n,
      rate: [90, 75, 95, 100, 70, 110][i],
      hoursAllocated: 0,
      availability: 100,
      allocationNote: 'allocation agreed, not tied to task effort'
    };
  });
  const planned = [3200, 2600, 3200, 3800, 2100, 2000, 1000];
  const lines = planned.map(function (v, i) {
    return {
      id: 'b' + (i + 1),
      name: ['PM', 'Design', 'Frontend', 'Backend', 'QA', 'AI', 'Contingency'][i],
      planned: v,
      taskId: null
    };
  });
  const risks = [
    ['Scope creep during pilot', 'High', 'High'],
    ['Model cost overrun', 'Medium', 'High'],
    ['Late design sign-off', 'High', 'Medium'],
    ['Parser accuracy below target', 'Medium', 'High'],
    ['Pilot recruitment delay', 'Medium', 'Medium'],
    ['Owner unavailable for review', 'Low', 'Medium']
  ].map(function (r, i) {
    return {
      id: 'k' + (i + 1),
      description: r[0],
      probability: r[1],
      impact: r[2],
      status: 'open',
      owner: 'Project manager',
      mitigation: 'Review at the weekly governance meeting'
    };
  });
  return {
    charter: { name: 'Resume Maker AI — MVP Delivery' },
    projectDeadline: '2027-02-26',
    workWeek: 5,
    tasks: phases.concat(work),
    resources: roles,
    budgetLines: lines,
    budgetEnvelope: 18500,
    risks: risks
  };
}

/* ------------------------------------------------------------------ */
/* Other messy fixtures                                               */
/* ------------------------------------------------------------------ */
function cycleAndDangling() {
  return {
    charter: { name: 'Cycle project' },
    workWeek: 5,
    tasks: [
      task('a', 'A', 1, 3, { predecessors: ['c'] }),
      task('b', 'B', 4, 3, { predecessors: ['a'] }),
      task('c', 'C', 7, 3, { predecessors: ['b'] }),
      task('d', 'D', 10, 2, { predecessors: ['ghost'] })
    ],
    resources: [],
    budgetLines: [],
    risks: []
  };
}

function durationAndDates() {
  return {
    charter: { name: 'Dates project' },
    workWeek: 5,
    tasks: [
      task('t1', 'Undated effort', 1, 5, { duration: '' }),
      task('t2', 'Backwards', 5, 5, { endDate: '2026-12-02' }),
      task('m1', 'Gateway', 12, 5, { milestone: true })
    ],
    resources: [],
    budgetLines: [],
    risks: []
  };
}

function duplicateAndNesting() {
  return {
    charter: { name: 'Identity project' },
    workWeek: 5,
    tasks: [
      { id: 'P', name: 'Phase P', isPhase: true, predecessors: [], status: 'todo' },
      task('x', 'First X', 1, 3, { parentName: 'P' }),
      task('x', 'Second X', 4, 3, { parentName: 'Phase P', predecessors: ['x'] }),
      task('z', 'Z', 7, 2, { predecessors: ['x'] }),
      task('y', 'Legacy child', 10, 2, { parentName: 'P' })
    ],
    resources: [],
    budgetLines: [{ id: 'L1', name: 'Labour', planned: 500, linkedTaskId: 'ghost' }],
    risks: []
  };
}

function parallelCritical() {
  return {
    charter: { name: 'Two paths' },
    projectDeadline: '2026-12-11',
    workWeek: 5,
    tasks: [
      task('a', 'Start', 1, 2, { startDate: '2026-12-01', endDate: '2026-12-02' }),
      task('b', 'Branch B', 3, 5, { startDate: '2026-12-03', endDate: '2026-12-07' }),
      task('c', 'Branch C', 3, 5, { startDate: '2026-12-03', endDate: '2026-12-07' }),
      task('d', 'Finish', 8, 2, { startDate: '2026-12-08', endDate: '2026-12-09' })
    ].map(function (t) {
      if (t.id === 'b' || t.id === 'c') {
        t.predecessors = ['a'];
      }
      if (t.id === 'd') {
        t.predecessors = ['b', 'c'];
      }
      return t;
    }),
    resources: [{ id: 'r1', name: 'Dev', rate: 100, hoursAllocated: 80, availability: 100 }],
    budgetLines: [{ id: 'L1', name: 'Labour', planned: 1000 }],
    budgetEnvelope: 2000,
    spendLog: [{ id: 's1', amount: 100, date: '2026-12-01' }],
    risks: [
      {
        id: 'k1',
        description: 'Rain',
        probability: 'Low',
        impact: 'Low',
        status: 'open',
        owner: 'PM',
        mitigation: 'Monitor'
      }
    ]
  };
}

function deadlineAndCapacity() {
  return {
    charter: { name: 'Impossible' },
    projectDeadline: '2026-11-01',
    workWeek: 5,
    tasks: [task('a', 'Work', 2, 10, { startDate: '2026-11-02', endDate: '2026-11-13' })],
    resources: [{ id: 'r1', name: 'Only role', rate: 100, hoursAllocated: 0, availability: 0 }],
    budgetLines: [{ id: 'L1', name: 'Labour', planned: 1000 }],
    budgetEnvelope: 2000,
    risks: []
  };
}

async function main() {
  const server = await import('../src/mcp/server.js');
  const health = await import('../src/mcp/health.js');
  const port = await import('../src/mcp/schedule.js');

  const owner = { role: 'owner', scope: null, budgetRead: true, budgetWrite: true };
  function read(state, ctx, scope, auth) {
    const result = server.executeTool(
      'get_project_health',
      state,
      'p1',
      'messy-gate',
      scope === undefined ? null : scope,
      {},
      auth || owner,
      state,
      'contractor',
      ctx || {}
    );
    return JSON.parse(result.content[0].text);
  }

  /* ---- M1 ------------------------------------------------------------- */
  section('M1 — reconstructed Resume Maker AI project');
  const m1 = resumeMaker();
  const h1 = read(m1, { baseline: null, pendingProposals: 0 });
  check('M1a 29 task records load without a throw', m1.tasks.length === 29, m1.tasks.length);
  check('M1b the plan reads warn, not ok', h1.overall === 'warn', h1.overall);
  check(
    'M1c an unlinked multi-item plan is not executable',
    h1.executable === false,
    h1.executable
  );
  check(
    'M1d the schedule names the unlinked network',
    h1.gates.schedule.checks.some(function (c) {
      return /no dependency links/i.test(c.detail);
    }),
    h1.gates.schedule.checks
  );
  check(
    'M1e a plain-language verdict names the blocker',
    typeof h1.verdict === 'string' && /link|dependenc/i.test(h1.verdict),
    h1.verdict
  );
  check(
    'M1f nextActions is a ranked, id-bearing list',
    Array.isArray(h1.nextActions) &&
      h1.nextActions.length >= 3 &&
      h1.nextActions.every(function (a) {
        return a.code && a.action && Array.isArray(a.ids) && a.severity;
      }),
    h1.nextActions
  );
  check(
    'M1g the first fix is to link the network',
    codes(h1)[0] === 'link-network' && action(h1, 'link-network').count === 25,
    codes(h1)
  );
  check(
    'M1h the effort-link and frozen-baseline problems are also named',
    !!action(h1, 'effort-link') && !!action(h1, 'freeze-baseline'),
    codes(h1)
  );
  check(
    'M1i the verdict does not call a degenerate plan a forecast',
    !/0%|will miss|deadline missed/i.test(h1.verdict || ''),
    h1.verdict
  );

  /* ---- M2 ------------------------------------------------------------- */
  section('M2 — cycles and dangling predecessors');
  const m2 = cycleAndDangling();
  const h2 = read(m2, {});
  const lint2 = health.buildLint(m2);
  check(
    'M2a the health rollup fails',
    h2.overall === 'fail' && h2.executable === false,
    h2.overall
  );
  check(
    'M2b the first action is to break the cycle',
    codes(h2)[0] === 'break-cycle' && action(h2, 'break-cycle').ids.length >= 3,
    h2.nextActions
  );
  check(
    'M2c a dangling predecessor is its own action with the bad id',
    !!action(h2, 'fix-dangling') && action(h2, 'fix-dangling').ids.indexOf('ghost') !== -1,
    action(h2, 'fix-dangling')
  );
  check(
    'M2d lint blocks both problems with the right ids',
    lint2.filter(function (l) {
      return l.severity === 'fail' && /does not exist/.test(l.detail);
    }).length === 1 &&
      lint2.some(function (l) {
        return /cycle/i.test(l.detail);
      }),
    lint2
  );

  /* ---- M3 ------------------------------------------------------------- */
  section('M3 — dates without duration, reversed dates, milestone');
  const m3 = durationAndDates();
  const h3 = read(m3, {});
  const lint3 = health.buildLint(m3);
  check(
    'M3a the missing duration is counted and reported',
    h3.gates.schedule.checks.some(function (c) {
      return /no duration/.test(c.detail) && c.count === 1;
    }),
    h3.gates.schedule.checks
  );
  check(
    'M3b the duration fix carries the record id',
    !!action(h3, 'set-duration') && action(h3, 'set-duration').ids.indexOf('t1') !== -1,
    action(h3, 'set-duration')
  );
  check(
    'M3c the reversed date is an id-bearing action',
    !!action(h3, 'fix-dates') && action(h3, 'fix-dates').ids.indexOf('t2') !== -1,
    action(h3, 'fix-dates')
  );
  check(
    'M3d lint lists all three problems by id',
    ['t1', 't2', 'm1'].every(function (id) {
      return lint3.some(function (l) {
        return l.id === id;
      });
    }),
    lint3
  );

  /* ---- M4 ------------------------------------------------------------- */
  section('M4 — duplicate ids, parentName nesting, bad budget link');
  const m4 = duplicateAndNesting();
  const lint4 = health.buildLint(m4);
  check(
    'M4a a duplicate task id is a blocking lint finding',
    lint4.some(function (l) {
      return l.severity === 'fail' && /duplicate/i.test(l.detail) && l.id === 'x';
    }),
    lint4
  );
  check(
    'M4b parentName-only nesting is accepted as a child',
    !lint4.some(function (l) {
      return /phase has no child/.test(l.detail);
    }),
    lint4
  );
  check(
    'M4c a budget line pointing at a missing task is flagged',
    lint4.some(function (l) {
      return /linked task ghost/.test(l.detail);
    }),
    lint4
  );
  check(
    'M4c2 a parentName holding a phase id is flagged',
    lint4.some(function (l) {
      return /parentName P is a phase id/.test(l.detail);
    }),
    lint4
  );
  check(
    'M4d the duplicate is also a health action',
    !!action(read(m4, {}), 'duplicate-ids'),
    codes(read(m4, {}))
  );

  /* ---- M5 ------------------------------------------------------------- */
  section('M5 — two parallel critical branches');
  const m5 = parallelCritical();
  const s5 = port.computeSchedule(m5);
  const h5 = read(m5, { baseline: 'frozen' });
  check(
    'M5a both parallel branches are in the critical set',
    s5.criticalTasks.indexOf('b') !== -1 && s5.criticalTasks.indexOf('c') !== -1,
    s5.criticalTasks
  );
  check(
    'M5b the health report carries the same critical set',
    h5.schedule.criticalTasks.indexOf('b') !== -1 && h5.schedule.criticalTasks.indexOf('c') !== -1,
    h5.schedule.criticalTasks
  );
  check(
    'M5c a linked plan with parallel branches has no blocker',
    h5.executable === true && h5.gates.schedule.status !== 'fail',
    { overall: h5.overall, executable: h5.executable, schedule: h5.gates.schedule.status }
  );
  const slackState = Object.assign({}, m5, { projectDeadline: '2026-12-31' });
  const h5s = read(slackState, { baseline: 'frozen' });
  check(
    'M5d spare deadline explains the empty critical set',
    h5s.gates.schedule.checks.some(function (c) {
      return /no zero-float tasks/.test(c.detail);
    }),
    h5s.gates.schedule.checks
  );

  /* ---- M6 ------------------------------------------------------------- */
  section('M6 — impossible deadline and zero availability');
  const m6 = deadlineAndCapacity();
  const h6 = read(m6, {});
  check(
    'M6a the missed deadline is a named action',
    !!action(h6, 'deadline') && h6.schedule.deadlineMissed === true,
    { codes: codes(h6), deadline: h6.schedule }
  );
  check(
    'M6b zero availability is a named capacity action',
    !!action(h6, 'capacity') && /availability/i.test(action(h6, 'capacity').action),
    action(h6, 'capacity')
  );

  /* ---- M7 ------------------------------------------------------------- */
  section('M7 — scoped key sees a partial but sane report');
  const scopedAuth = { role: 'api', scope: ['wbs'] };
  const h7 = read(resumeMaker(), { baseline: null }, ['wbs'], scopedAuth);
  check(
    'M7a a wbs-only key gets schedule and data gates',
    !!h7.gates.schedule && !!h7.gates.data,
    Object.keys(h7.gates)
  );
  check(
    'M7b budget, resource and risk gates are not leaked',
    !h7.gates.budget && !h7.gates.resources && !h7.gates.risk,
    Object.keys(h7.gates)
  );
  check(
    'M7c no budget or risk action leaks into the scoped verdict',
    !codes(h7).some(function (c) {
      return /baseline|budget|risk|effort/i.test(c);
    }),
    codes(h7)
  );
  check(
    'M7d the scoped verdict still names the network problem',
    /link|dependenc/i.test(h7.verdict || ''),
    h7.verdict
  );

  console.log('\nRESULT ' + pass + ' passed, ' + fail + ' failed');
  if (fail) {
    console.log('FAILED: ' + failures.join(' | '));
    process.exitCode = 1;
  }
}

main().catch(function (e) {
  console.error(e);
  process.exitCode = 1;
});
