/* ============================================================
   verify-gantt-view.cjs - T-GANTT gate (GANTT-1, static + pure module)
   ------------------------------------------------------------
   REFINEMENT-DIRECTIVE-2026-10-24, section "Wide dialog, tidy chart,
   same output everywhere":

     "One view builder feeds the screen and the PNG/SVG/PDF exports.
      Tidy is a view switch, never a data change. The default link
      policy must be legible."

   The Gantt had TWO copies of every drawing rule: the live chart ordered
   its own rows, found its own date range and walked `predecessors` for
   its arrows, while the export had a second copy of the ordering, the
   spans, the WBS numbering and the milestone test. Two copies is how a
   screen and a picture start disagreeing.

   js/mmgr-gantt-view.js is now the only answer to "which rows, over
   which span, joined by which links, at which scale". This gate loads
   that module in a `vm` sandbox (no browser, no DOM, no copy of the
   logic) and proves it against a committed fixture:

     tools/fixtures/gantt-bank.json - a bank renovation: five phases,
     parented children, one critical chain, one gate milestone per
     phase, one plain milestone, one orphan and a finish-to-start web.

   It then proves STATICALLY that the screen and all three export
   formats draw from that one builder, that the derived gate lines are
   not offered as deletable dependencies, and that the toolbar controls
   exist in markup, in the action map and in the stylesheet.

   Usage:  node tools/verify-gantt-view.cjs
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const log = s => process.stdout.write('[gantt-view] ' + s + '\n');
let failed = 0;
const fail = (name, detail) => {
  failed++;
  log('FAIL  ' + name + '  <-- ' + JSON.stringify(detail).slice(0, 700));
};
const pass = name => log('PASS  ' + name);
const eq = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    pass(name);
  } else {
    fail(name, { got: got, want: want });
  }
};
const ok = (name, cond, detail) => {
  if (cond) {
    pass(name);
  } else {
    fail(name, detail === undefined ? 'condition false' : detail);
  }
};

const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const between = (src, from, to) => {
  const a = src.indexOf(from);
  if (a < 0) {
    return '';
  }
  const b = src.indexOf(to, a + from.length);
  return src.slice(a, b < 0 ? src.length : b);
};

// ------------------------------------------------------------------
// 1. load the pure module twice: with deterministic Utils (the app's
//    own contract) and without them (the built-in fallbacks).
// ------------------------------------------------------------------
// The fake MIRRORS the real js/mmgr-utils.js contract, including the detail
// that addDays returns a DATE and fmtDate turns it back into a string. An
// earlier version of this harness returned a string from addDays, which hid a
// real defect: the app's Date leaked into scale.to, so every string comparison
// against a window bound was silently false. A gate that models the contract
// wrong is worse than no gate.
const SRC = read('js/mmgr-gantt-view.js');

const pad2 = n => (n < 10 ? '0' : '') + n;
const FMT = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const UTC_DAYS = (a, b) =>
  Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const FAKE_UTILS = {
  parseDL: s => new Date(s + 'T00:00:00'),
  fmtDate: d => FMT(typeof d === 'string' ? new Date(d + 'T00:00:00') : d),
  daysBetween: UTC_DAYS,
  addDays: (d, n) => {
    const x = new Date(String(d).slice(0, 10) + 'T00:00:00');
    x.setDate(x.getDate() + n);
    return x; // a DATE, exactly like js/mmgr-utils.js
  },
  todayStr: () => '2027-01-20'
};

function load(withUtils) {
  const sandbox = { window: {}, console };
  sandbox.window.MMGR = withUtils ? { Utils: FAKE_UTILS } : {};
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'js/mmgr-gantt-view.js' });
  return sandbox.window.MMGR;
}

const ns = load(true);
const GV = ns.GanttView;
ok('the module publishes MMGR.GanttView', !!GV);
if (!GV) {
  log('');
  log('RESULT  cannot continue without the module');
  process.exit(1);
}
['build', 'reduceLinks', 'isMilestone', 'isGateMilestone', 'groupKeyOf'].forEach(fn => {
  ok('GanttView.' + fn + ' is a function', typeof GV[fn] === 'function');
});

// PURITY: a view builder must not touch the page, the network or storage.
const forbidden = [
  ['document.', /(^|[^.\w])document\./],
  ['fetch(', /\bfetch\s*\(/],
  ['XMLHttpRequest', /XMLHttpRequest/],
  ['localStorage', /localStorage/],
  ['sessionStorage', /sessionStorage/],
  ['addEventListener', /addEventListener/],
  ['getElementById', /getElementById/]
];
forbidden.forEach(([label, re]) => {
  const hit = SRC.match(re);
  ok('the builder never touches ' + label, !hit, hit ? hit[0] : '');
});
ok(
  'the builder writes nothing into the state object',
  !/\.(startDate|endDate|predecessors|duration|critical)\s*=[^=]/.test(
    between(SRC, 'function build(', 'ns.GanttView =')
  )
);

// ------------------------------------------------------------------
// 2. the fixture
// ------------------------------------------------------------------
const FX = JSON.parse(read('tools/fixtures/gantt-bank.json'));
const TODAY = FX.today;
const STATE = { tasks: FX.tasks };
const TASK = {};
FX.tasks.forEach(t => (TASK[t.id] = t));
const DATED = FX.tasks.filter(t => t.startDate && t.endDate);
const PHASES = FX.tasks.filter(t => t.isPhase);
const REAL = FX.tasks.filter(t => !t.isPhase);
const RAW_LINKS = FX.tasks.reduce((n, t) => n + (t.predecessors || []).length, 0);

ok('the fixture is a bank renovation with five phases', PHASES.length === 5, PHASES.length);
ok('the fixture carries parented children', REAL.filter(t => t.parentId).length >= 30);
ok('the fixture carries one orphan whose parent cannot resolve', !TASK.p99 && !!TASK.t34);

const before = JSON.stringify(STATE);
const V_ALL = GV.build(STATE, { links: 'all', today: TODAY });
const V_NEAR = GV.build(STATE, { links: 'near', today: TODAY });
const V_CRIT = GV.build(STATE, { links: 'critical', today: TODAY });
const V_GATES = GV.build(STATE, { links: 'gates', today: TODAY });
const V_DEFAULT = GV.build(STATE, { today: TODAY });
eq(
  'build() leaves the state byte-identical (a view is not a write)',
  JSON.stringify(STATE),
  before
);

// ------------------------------------------------------------------
// 3. rows: order, completeness, the orphan group
// ------------------------------------------------------------------
const rowIds = V_GATES.rows.map(r => r.row.id);
const dupes = rowIds.filter((id, i) => rowIds.indexOf(id) !== i);
eq('no row is drawn twice', dupes, []);
const drawnTasks = V_GATES.rows.filter(r => r.kind === 'task').map(r => r.row.id);
eq(
  'every dated task is drawn exactly once (nothing is silently dropped)',
  drawnTasks.slice().sort(),
  DATED.filter(t => !t.isPhase)
    .map(t => t.id)
    .sort()
);
eq(
  'rows = five phases + every real task + one group header',
  V_GATES.rows.length,
  PHASES.length + DATED.filter(t => !t.isPhase).length + 1
);

// phases in state order, each followed by its own children
const phaseOrder = V_GATES.rows.filter(r => r.kind === 'phase').map(r => r.row.id);
eq(
  'phases keep state order',
  phaseOrder,
  PHASES.map(p => p.id)
);
let orderBad = [];
PHASES.forEach(p => {
  const at = rowIds.indexOf(p.id);
  const kids = V_GATES.rows
    .map((r, i) => ({ r, i }))
    .filter(x => x.r.kind === 'task' && x.r.row.parentId === p.id);
  kids.forEach(k => {
    if (k.i < at) {
      orderBad.push(k.r.row.id + ' before its phase ' + p.id);
    }
  });
  // sorted by start date inside the phase
  const dates = kids.map(k => k.r.row.startDate);
  const sorted = dates.slice().sort();
  if (JSON.stringify(dates) !== JSON.stringify(sorted)) {
    orderBad.push(p.id + ' children not in start-date order');
  }
});
eq('every child sits under its phase, in start-date order', orderBad, []);

const last = V_GATES.rows.slice(-2);
eq(
  'the orphan is listed last, under one named group header',
  [last[0].kind, last[0].row.name, last[1].row.id],
  ['group', 'Unassigned tasks (1)', 't34']
);
eq(
  'the orphan list is reported to the caller',
  V_GATES.orphans.map(t => t.id),
  ['t34']
);

// ------------------------------------------------------------------
// 4. WBS: numbered over the FULL phase order, and stable across axes
// ------------------------------------------------------------------
eq(
  'phases are numbered 1..5',
  PHASES.map(p => V_GATES.wbs[p.id]),
  ['1', '2', '3', '4', '5']
);
eq('the first child of P1 is 1.1', V_GATES.wbs.t01, '1.1');
eq('a sibling counts up', V_GATES.wbs.t02, '1.3');
const V_TRADE = GV.build(STATE, { links: 'gates', today: TODAY, groupBy: 'trade' });
eq(
  'switching the swimlane axis does not renumber the plan',
  Object.keys(V_GATES.wbs).length === Object.keys(V_TRADE.wbs).length &&
    Object.keys(V_GATES.wbs).every(id => V_GATES.wbs[id] === V_TRADE.wbs[id]),
  true
);
const V_TIDY = GV.build(STATE, { links: 'gates', today: TODAY, tidy: true });
eq(
  'collapsing finished phases does not renumber the plan',
  Object.keys(V_GATES.wbs).every(id => V_GATES.wbs[id] === V_TIDY.wbs[id]),
  true
);

// ------------------------------------------------------------------
// 5. spans: a phase reads its children, derived at read time
// ------------------------------------------------------------------
ok(
  'a phase span falls back to its own dates when no Schedule is loaded',
  V_GATES.spans.p1.start === TASK.p1.startDate && V_GATES.spans.p1.end === TASK.p1.endDate,
  V_GATES.spans.p1
);
{
  const withSched = load(true);
  withSched.Schedule = {
    phaseSpan: () => ({ start: '2000-01-01', end: '2000-12-31' })
  };
  const v = withSched.GanttView.build(STATE, { links: 'gates', today: TODAY });
  eq('a phase span comes from Schedule.phaseSpan (never a stored rollup)', v.spans.p1, {
    start: '2000-01-01',
    end: '2000-12-31'
  });
  ok('a task span is never asked of Schedule', v.spans.t01.start === TASK.t01.startDate);
}

// ------------------------------------------------------------------
// 6. milestones: one rule, and a phase is never a diamond
// ------------------------------------------------------------------
eq(
  'the fixture draws six diamonds: one plain milestone and five gates',
  V_GATES.milestones.slice().sort(),
  ['g1', 'g2', 'g3', 'g4', 'g5', 'm0']
);
eq(
  'the gate rule picks the five phase gates and not the plain milestone',
  V_GATES.milestones.filter(id => GV.isGateMilestone(TASK[id])).sort(),
  ['g1', 'g2', 'g3', 'g4', 'g5']
);
ok('a phase is never a milestone diamond', !GV.isMilestone(TASK.p1), TASK.p1);
ok(
  'a same-day row that names a sign-off is a milestone by name',
  GV.isMilestone({
    id: 'x',
    name: 'Practical completion sign-off',
    startDate: '2027-01-01',
    endDate: '2027-01-01',
    duration: 1
  })
);
ok(
  'a multi-day task is not a milestone',
  !GV.isMilestone({
    id: 'y',
    name: 'Practical completion sign-off',
    startDate: '2027-01-01',
    endDate: '2027-01-05',
    duration: 5
  })
);
ok(
  'the milestone flag alone is enough',
  GV.isMilestone({
    id: 'z',
    name: 'Any',
    startDate: '2027-01-01',
    endDate: '2027-01-03',
    milestone: true
  })
);

// ------------------------------------------------------------------
// 7. link policies
// ------------------------------------------------------------------
eq('the fixture has 63 finish-to-start links', RAW_LINKS, 63);
eq("'all' draws every plan link and nothing else", V_ALL.links.length, RAW_LINKS);
{
  const synthetic = V_ALL.links.filter(l => {
    const to = TASK[l.to];
    return !to || (to.predecessors || []).indexOf(l.from) < 0;
  });
  eq(
    "'all' invents no link (every line is in the plan)",
    synthetic.map(l => l.from + '>' + l.to),
    []
  );
}
const key = l => l.from + '>' + l.to;
const setOf = list => new Set(list.map(key));
{
  const all = setOf(V_ALL.links);
  const missingCrit = V_CRIT.links.filter(l => !all.has(key(l)));
  eq('the critical chain is a subset of the plan links', missingCrit.map(key), []);
}
{
  const crit = setOf(V_CRIT.links);
  const missing = V_NEAR.links.filter(l => l.critical && !crit.has(key(l)));
  eq("'near' keeps every critical link", missing.map(key), []);
  const rowIndex = {};
  V_NEAR.rows.forEach((r, i) => (rowIndex[r.row.id] = i));
  const long = V_NEAR.links.filter(
    l => !l.critical && Math.abs(rowIndex[l.to] - rowIndex[l.from]) > 8
  );
  eq("'near' drops every line longer than eight rows", long.map(key), []);
}
{
  const derived = V_GATES.links.filter(l => l.derived);
  eq('the gates view derives one line per phase gate', derived.length, 5);
  const bad = derived.filter(l => {
    const ph = TASK[l.from];
    const ms = TASK[l.to];
    return !ph || !ph.isPhase || !ms || String(ms.parentId) !== ph.id || !GV.isGateMilestone(ms);
  });
  eq('every derived line runs from a phase to its OWN gate milestone', bad.map(key), []);
  ok(
    'the gates view is materially thinner than the wall of links',
    V_GATES.links.length < V_ALL.links.length * 0.5,
    { gates: V_GATES.links.length, all: V_ALL.links.length }
  );
  ok(
    'the default view stays legible on a 46-row plan (at most 40 lines)',
    V_GATES.links.length <= 40,
    V_GATES.links.length
  );
  const badPolicy = V_GATES.links.filter(l => !l.critical && !l.derived).length;
  eq('the gates view draws no task-to-task line', badPolicy, 0);
}
eq(
  "an unknown policy falls back to the default 'gates'",
  V_DEFAULT.links.length,
  V_GATES.links.length
);
eq('the default policy is reported back', V_DEFAULT.policy, 'gates');

// ------------------------------------------------------------------
// 8. Tidy: a view switch, never a data change
// ------------------------------------------------------------------
eq(
  'tidy collapses the three phases that finished before today',
  Object.keys(V_TIDY.collapsed).sort(),
  ['p1', 'p2', 'p3']
);
eq(
  'tidy keeps the collapsed phase rows themselves',
  V_TIDY.rows.filter(r => r.kind === 'phase').length,
  5
);
eq('tidy drops the children of a collapsed phase', V_TIDY.rows.length, 22);
ok(
  'tidy never draws a link the untidied view does not have',
  V_TIDY.links.every(l => V_GATES.links.some(g => key(g) === key(l))),
  V_TIDY.links.map(key)
);
{
  // transitive reduction: no line may survive whose endpoints are still
  // connected through another path.
  const next = {};
  V_TIDY.links.forEach(l => (next[l.from] = next[l.from] || []).push(l.to));
  const reach = (a, b, skip) => {
    const seen = {};
    const stack = (next[a] || []).filter(x => !(skip && x === b));
    while (stack.length) {
      const n = stack.pop();
      if (n === b) {
        return true;
      }
      if (seen[n]) {
        continue;
      }
      seen[n] = true;
      (next[n] || []).forEach(x => stack.push(x));
    }
    return false;
  };
  const redundant = V_TIDY.links.filter(l => reach(l.from, l.to, true));
  eq('tidy reduces the links transitively (no redundant line survives)', redundant.map(key), []);
}
{
  // A phase whose children are all complete is finished even if its own
  // dates say otherwise; an ACTIVE phase stays open.
  const st = {
    tasks: [
      { id: 'pa', name: 'Phase A', isPhase: true, startDate: '2027-01-01', endDate: '2027-12-31' },
      {
        id: 'a1',
        name: 'A1',
        parentId: 'pa',
        startDate: '2027-01-01',
        endDate: '2027-01-02',
        duration: 2,
        status: 'completed'
      },
      { id: 'pb', name: 'Phase B', isPhase: true, startDate: '2027-01-01', endDate: '2027-12-31' },
      {
        id: 'b1',
        name: 'B1',
        parentId: 'pb',
        startDate: '2027-01-01',
        endDate: '2027-01-02',
        duration: 2,
        status: 'in-progress'
      }
    ]
  };
  const v = GV.build(st, { today: TODAY, tidy: true });
  eq('an all-complete phase collapses even with open dates', Object.keys(v.collapsed), ['pa']);
  ok('an active phase stays open', !v.collapsed.pb);
  eq(
    'the active phase keeps its child',
    v.rows.filter(r => r.kind === 'task').map(r => r.row.id),
    ['b1']
  );
}

// ------------------------------------------------------------------
// 9. grouping: trade / assignee swimlanes
// ------------------------------------------------------------------
{
  const bandsOf = list => {
    const s = {};
    list.forEach(t => (s[t] = true));
    return Object.keys(s).length;
  };
  eq(
    'the trade axis draws one band per trade',
    V_TRADE.rows.filter(r => r.kind === 'group').length,
    bandsOf(REAL.map(t => t.trade))
  );
  const vAssign = GV.build(STATE, { links: 'gates', today: TODAY, groupBy: 'assignee' });
  eq(
    'the assignee axis draws one band per person',
    vAssign.rows.filter(r => r.kind === 'group').length,
    bandsOf(REAL.map(t => t.assignedTo))
  );
  eq('the trade axis draws no phase rows', V_TRADE.rows.filter(r => r.kind === 'phase').length, 0);
  eq(
    'every task appears once on the trade axis',
    V_TRADE.rows
      .filter(r => r.kind === 'task')
      .map(r => r.row.id)
      .sort(),
    DATED.filter(t => !t.isPhase)
      .map(t => t.id)
      .sort()
  );
  const unsorted = [];
  let cur = null;
  V_TRADE.rows.forEach(r => {
    if (r.kind === 'group') {
      cur = [];
      return;
    }
    cur.push(r.row.startDate);
  });
  V_TRADE.rows.forEach((r, i) => {
    if (r.kind !== 'group') {
      return;
    }
    const band = [];
    for (let j = i + 1; j < V_TRADE.rows.length && V_TRADE.rows[j].kind === 'task'; j++) {
      band.push(V_TRADE.rows[j].row.startDate);
    }
    if (JSON.stringify(band) !== JSON.stringify(band.slice().sort())) {
      unsorted.push(r.row.name);
    }
  });
  eq('tasks inside a band are in start-date order', unsorted, []);
  ok(
    'a band is labelled, not blank',
    V_TRADE.rows.some(r => r.kind === 'group' && r.row.name)
  );
  eq(
    'an unknown axis falls back to phases',
    GV.build(STATE, { today: TODAY, groupBy: 'nonsense' }).groupBy,
    'phase'
  );
  eq(
    'a task with no assignee is not dropped from the assignee axis',
    vAssign.rows.filter(r => r.kind === 'task').length,
    DATED.filter(t => !t.isPhase).length
  );
}

// ------------------------------------------------------------------
// 10. the time window and the automatic scale
// ------------------------------------------------------------------
eq(
  'the whole-project window is the project range',
  [V_GATES.scale.from, V_GATES.scale.to],
  ['2026-11-02', '2027-02-26']
);
eq('a 117-day plan gets week ticks', V_GATES.scale.unit, 'week');
eq('totalDays matches the window', V_GATES.scale.totalDays, 117);
{
  const v = GV.build(STATE, { today: TODAY, window: 'next90' });
  eq(
    'the next-90 window starts today and runs 90 days',
    [v.window, v.scale.from, v.scale.to],
    ['next90', '2027-01-20', '2027-04-20']
  );
  eq('a 91-day window gets week ticks', v.scale.unit, 'week');
}
{
  // THE BUG THIS CATCHES: js/mmgr-utils.js addDays returns a Date. If one
  // leaks out of the builder, `'2027-02-01' > Date` is silently false, so
  // "this phase starts after the window" never fires and the scale prints
  // [object Date]. Every date the builder hands out must be 'YYYY-MM-DD'.
  const isDL = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const v = GV.build(STATE, { today: TODAY, window: 'next90' });
  ok(
    'the scale bounds are date STRINGS, never Date objects',
    isDL(v.scale.from) && isDL(v.scale.to),
    {
      from: String(v.scale.from),
      to: String(v.scale.to)
    }
  );
  ok(
    'every span bound is a date string',
    Object.keys(v.spans).every(id => isDL(v.spans[id].start) && isDL(v.spans[id].end)),
    Object.keys(v.spans)
      .filter(id => !isDL(v.spans[id].start) || !isDL(v.spans[id].end))
      .slice(0, 5)
  );
  const c = GV.build(STATE, { today: TODAY, window: { from: '2027-01-01', to: '2027-02-01' } });
  ok(
    'a custom window keeps the owner dates verbatim',
    c.scale.from === '2027-01-01' && c.scale.to === '2027-02-01',
    c.scale
  );
  const after = GV.build(
    {
      tasks: [
        {
          id: 'pa',
          name: 'Phase A',
          isPhase: true,
          startDate: '2027-01-01',
          endDate: '2027-01-10'
        },
        {
          id: 'a1',
          name: 'A1',
          parentId: 'pa',
          startDate: '2027-01-01',
          endDate: '2027-01-10',
          duration: 10
        },
        {
          id: 'pb',
          name: 'Phase B',
          isPhase: true,
          startDate: '2027-06-01',
          endDate: '2027-06-10'
        },
        {
          id: 'b1',
          name: 'B1',
          parentId: 'pb',
          startDate: '2027-06-01',
          endDate: '2027-06-10',
          duration: 10
        }
      ]
    },
    { today: TODAY, tidy: true, window: { from: '2027-01-01', to: '2027-02-01' } }
  );
  ok(
    'tidy collapses a phase that starts AFTER the visible window',
    after.collapsed.pb === true,
    after.collapsed
  );
}
{
  const v = GV.build(STATE, { today: TODAY, window: { from: '2027-01-01', to: '2027-01-20' } });
  eq(
    'a 20-day custom window gets day ticks',
    [v.window, v.scale.unit, v.scale.totalDays],
    ['custom', 'day', 20]
  );
}
{
  const v = GV.build(STATE, { today: TODAY, window: { from: '2026-11-01', to: '2028-12-31' } });
  eq('a two-year window gets month ticks', [v.scale.unit, v.scale.totalDays], ['month', 792]);
}
{
  const v = GV.build(STATE, { today: TODAY, window: { from: '2027-03-01', to: '2027-01-01' } });
  eq(
    'an inverted window falls back to the whole project',
    [v.window, v.scale.from],
    ['all', '2026-11-02']
  );
  const h = GV.build(STATE, { today: TODAY, window: { from: '2027-01-01' } });
  eq('a half-typed window falls back to the whole project', h.window, 'all');
}
{
  const v = GV.build({ tasks: [] }, { today: TODAY });
  eq('an empty plan returns no rows and no links', [v.rows.length, v.links.length], [0, 0]);
  ok('an empty plan still reports a usable scale', v.scale.totalDays >= 1, v.scale);
}
{
  // the module must work with no Utils at all (the export path loads it
  // standalone in the bundle, and the dev fallback loads it alone)
  const bare = load(false);
  const v = bare.GanttView.build(STATE, { links: 'gates' });
  eq('the module builds without MMGR.Utils (fallbacks hold)', v.rows.length, 46);
}

// ------------------------------------------------------------------
// 11. STATIC: one builder, four painters
// ------------------------------------------------------------------
const RENDER = read('js/mmgr-render.js');
const APP = read('js/mmgr-app.js');
const PAGE = read('project.html');
const CSS = read('css/mmgr.css');

ok('the live chart reads the view through one helper', /function ganttViewFor\(/.test(RENDER));
ok(
  'renderGantt paints the builder answer',
  /const view = ganttViewFor\(s\);/.test(
    between(RENDER, 'function renderGantt(', 'function drawDependencyArrows(')
  )
);
{
  const body = between(RENDER, 'function renderGantt(', 'function drawDependencyArrows(');
  ok('the live chart no longer re-derives the row order', body.indexOf('orderPhaseRows') < 0);
  ok('the live chart no longer re-derives the date range', body.indexOf('maxDate = t.endDate') < 0);
  ok(
    'the live chart no longer walks predecessors for its arrows',
    body.indexOf('.predecessors') < 0
  );
  ok('the live chart draws the builder scale', /view\.scale\.from/.test(body));
  ok(
    'the live chart clamps bars to the visible window',
    /visStart/.test(body) && /visEnd/.test(body)
  );
}
ok(
  'the arrow overlay consumes the view link list',
  /drawDependencyArrows\(view\)/.test(RENDER) &&
    /const links = \(view && view\.links\) \|\| \[\]/.test(RENDER)
);
ok(
  'a derived gate line is drawn but never offered as a deletable dependency',
  /if \(l\.derived\) \{/.test(RENDER) &&
    /'gan-derived'/.test(RENDER) &&
    between(RENDER, 'if (l.derived) {', "'gan-link'").indexOf('data-from') < 0
);
ok(
  'the arrow redraw path rebuilds the same view',
  /drawDependencyArrows\(ganttViewFor\(s\)\)/.test(RENDER)
);
ok('the export builds its draw list from the one builder', /ns\.GanttView\.build\(s, \{/.test(APP));
['exportGanttPNG', 'exportGanttSVG', 'exportGanttPDF'].forEach(fn => {
  const body = between(APP, 'function ' + fn + '(', 'function ');
  ok(fn + ' draws from the shared draw list', /buildGanttDrawList\(o\)/.test(body));
});
ok(
  'the export passes the same axis and window the screen uses',
  /groupBy: o\.groupBy/.test(APP) && /window: o\.window/.test(APP)
);
ok('the export x-axis is the view scale', /const minDate = view\.scale\.from;/.test(APP));

// ------------------------------------------------------------------
// 12. STATIC: the toolbar controls exist, are wired, and are styled
// ------------------------------------------------------------------
const CONTROLS = ['ganttTidy', 'setGanttGroup', 'setGanttWindow', 'setGanttWindowDate'];
CONTROLS.forEach(action => {
  ok(
    'project.html carries the ' + action + ' control',
    new RegExp('data-action="' + action + '"').test(PAGE)
  );
  ok(
    'the ' + action + ' action is in the exported App object',
    new RegExp('\\b' + action + ': ' + action + ',').test(APP)
  );
  ok(
    'the ' + action + ' action is in ACTION_MAP',
    new RegExp('\\b' + action + ': el => window\\.MMGR\\.App\\.' + action + '\\(el\\)').test(APP)
  );
});
ok(
  'the custom window row ships hidden and is a real date range',
  /id="gantt-window-custom"[^>]*hidden/.test(PAGE) &&
    /id="gantt-from"/.test(PAGE) &&
    /id="gantt-to"/.test(PAGE)
);
ok(
  'the change-event whitelist carries the toolbar selects',
  /action === 'setGanttGroup'/.test(APP) && /action === 'setGanttWindowDate'/.test(APP)
);
ok(
  'renderGantt mirrors the view state back onto the controls',
  /tidyBox\.checked = !!vui\.ganttTidy/.test(RENDER) &&
    /customRow\.hidden = vWindow !== 'custom'/.test(RENDER)
);
ok(
  'the hidden custom row has its own display guard (verify-hidden-attr)',
  /\.gv-custom\[hidden\]\s*\{\s*display:\s*none;?\s*\}/.test(CSS)
);
[
  '.gr-group',
  '.gr-group-name',
  '.gb-ms-label',
  '.gb-milestone.gate',
  '.ms-diamond.gate',
  '.gd-tick',
  '.gv-custom',
  '.gv-tgl',
  '.gv-tgl-txt'
].forEach(sel => {
  ok('css/mmgr.css defines ' + sel, CSS.indexOf(sel + ' {') >= 0 || CSS.indexOf(sel + '{') >= 0);
});

// ------------------------------------------------------------------
log('');
log('RESULT  ' + (failed ? failed + ' failed' : 'all checks passed'));
process.exit(failed ? 1 : 0);
