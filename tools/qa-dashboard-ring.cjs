/* ============================================================
   tools/qa-dashboard-ring.cjs - the completion ring is honest
   ------------------------------------------------------------
   UX-2026-11-19 B3 (and the visual half of B4/B6). The ring used
   to be ONE stroke. It now draws one arc per major group over the
   same geometry, and the centre figure is the sum of those arcs.

   Gates:
     R1 with groups: one arc per group, the original #rf hidden.
     R2 the arcs' points sum to the centre percentage within 0.1.
     R3 every arc paints the --major-N token its data-color names.
     R4 one phase (no groups): exactly today's single stroke, no slot layer.
     R5 Performance Mode: the entry sweep does not run.
     R6 the SVG is role="img" and its label names the percentage and
        the top contributors (colour is never the only carrier).
     R7 hovering an arc marks it hot, and hovering a row lights its arc.
     R8 the ring survives a dark theme with the same tokens.

   UI-WAVE 2026-11-20 D gates (the flat / older-project path):
     D1 no phase rows and no labels: one slot per top-level main task.
     D2 every main task gets an equal arc width.
     D3 an arc fills by its own subtask completion.
     D4 the centre is the mean main-task fraction (the sum of the arcs).
     D5 the original #rf stroke stays hidden while the slots draw.
     D6 a completed main task with ten subtasks cannot dominate an open one:
        equal arcs, points 50/0, centre 50% - not the 90.9% work-item rate.
     D7 a single main task draws one full-width segment that fills by its
        subtasks, not by counting the container row.

   B4 gates (the list under the ring):
     L1 five rows while collapsed, one per major, the rest behind a toggle.
     L2 order: highest contribution first, zero-completed rows last.
     L3 "+X.X pts" carries exactly one decimal and matches the model.
     L4 a row's dot paints the same token as its own ring arc.
     L5 "Show all (N)" expands to every group; "Show top 5" collapses.
     L6 every row is a link to its major in the plan (#wbs).
     L7 nothing completed: the empty line shows and no points render.
     L8 rows are at least 44px high on a coarse pointer.
     L9 a project with no groups hides the list entirely.

   B6 gates (colour carry-through):
     C1 the WBS row marker paints the same colour as the ring slot.
     C2 the Gantt bar's 4px accent paints the same colour.
     C3 the Kanban card's top stripe paints the same colour.
     C4 an ungrouped project draws no stripe on any surface.

   Usage:   node tools/qa-dashboard-ring.cjs
   Registry: docs/CI-TEST-COVERAGE.md
   ============================================================ */
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');

const PORT = 8765;
const BASE = process.env.QA_BASE || 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');
const log = s => process.stdout.write('[qa-ring] ' + s + '\n');
const delay = ms => new Promise(r => setTimeout(r, ms));

let passed = 0;
let failed = 0;
const check = (name, ok, detail) => {
  if (ok) {
    passed++;
    log('PASS  ' + name);
  } else {
    failed++;
    log(
      'FAIL  ' +
        name +
        '  <-- ' +
        JSON.stringify(detail === undefined ? null : detail).slice(0, 1000)
    );
  }
};

function resolvePlaywright() {
  try {
    return require('playwright');
  } catch (e) {}
  const roots = [
    path.join(os.homedir(), 'AppData', 'Local', 'npm-cache', '_npx'),
    path.join(os.homedir(), '.npm', '_npx')
  ];
  for (const root of roots) {
    if (!fs.existsSync(root)) {
      continue;
    }
    for (const dir of fs.readdirSync(root)) {
      const p = path.join(root, dir, 'node_modules', 'playwright');
      if (fs.existsSync(path.join(p, 'index.js'))) {
        return require(p);
      }
    }
  }
  throw new Error('playwright not found - npm i -D playwright');
}

const FLUSH_RAF = `new Promise(function (res) {
  requestAnimationFrame(function () { requestAnimationFrame(function () { res(1); }); });
})`;

// Two fixture projects. PHASED has phase rows with nested work; PLAIN has no
// phase rows and no labels, which is the "keep today's ring" case. Every
// PHASED task carries dates so the Gantt arm of B6 has bars to paint.
const PHASED = `[
  { id: 'p1', name: 'Site preparation', isPhase: true, status: 'inprogress', startDate: '2026-01-05', endDate: '2026-01-20' },
  { id: 't1', name: 'Site grading', parentId: 'p1', status: 'completed', startDate: '2026-01-05', endDate: '2026-01-10' },
  { id: 't2', name: 'Temporary fences', parentId: 'p1', status: 'todo', startDate: '2026-01-12', endDate: '2026-01-20' },
  { id: 'p2', name: 'Foundation', isPhase: true, status: 'inprogress', startDate: '2026-01-21', endDate: '2026-02-10' },
  { id: 't3', name: 'Excavate', parentId: 'p2', status: 'completed', startDate: '2026-01-21', endDate: '2026-01-28' },
  { id: 't4', name: 'Rebar', parentId: 'p2', status: 'todo', startDate: '2026-02-01', endDate: '2026-02-10' },
  { id: 'p3', name: 'Structure', isPhase: true, status: 'todo', startDate: '2026-02-11', endDate: '2026-03-10' },
  { id: 't5', name: 'Columns', parentId: 'p3', status: 'todo', startDate: '2026-02-11', endDate: '2026-02-20' },
  { id: 't6', name: 'Slab', parentId: 'p3', status: 'completed', startDate: '2026-02-21', endDate: '2026-02-28' },
  { id: 't7', name: 'Stairs', parentId: 'p3', status: 'todo', startDate: '2026-03-01', endDate: '2026-03-10' }
]`;

const PLAIN = `[
  { id: 'a', name: 'One', status: 'completed', startDate: '2026-01-05', endDate: '2026-01-10' },
  { id: 'b', name: 'Two', status: 'todo', startDate: '2026-01-12', endDate: '2026-01-20' }
]`;

// One main task is one segment - not a ring of one. grouped stays false, so
// this is the "keep today's stroke" fixture.
const SINGLE = `[
  { id: 'm1', name: 'Only main task' },
  { id: 's1', name: 'Sub one', parentName: 'Only main task', status: 'completed' },
  { id: 's2', name: 'Sub two', parentName: 'Only main task', status: 'todo' }
]`;

// One phase is one group, so the phase branch keeps today's single stroke.
const SINGLE_PHASE = `[
  { id: 'p1', name: 'Only phase', isPhase: true, status: 'todo' },
  { id: 't1', name: 'Work', parentId: 'p1', status: 'completed' }
]`;

// UI-WAVE D: the owner's dominance case. One completed main task with ten
// subtasks and one open main task with one subtask. Equal weighting must keep
// the ring at 50%, not the 10/11 = 90.9% work-item rate.
const DOMINANCE = `[
  { id: 'm1', name: 'Big done', level: 0 },
  { id: 'b1', name: 'b1', parentName: 'Big done', level: 1, status: 'completed' },
  { id: 'b2', name: 'b2', parentName: 'Big done', level: 1, status: 'completed' },
  { id: 'b3', name: 'b3', parentName: 'Big done', level: 1, status: 'completed' },
  { id: 'b4', name: 'b4', parentName: 'Big done', level: 1, status: 'completed' },
  { id: 'b5', name: 'b5', parentName: 'Big done', level: 1, status: 'completed' },
  { id: 'b6', name: 'b6', parentName: 'Big done', level: 1, status: 'completed' },
  { id: 'b7', name: 'b7', parentName: 'Big done', level: 1, status: 'completed' },
  { id: 'b8', name: 'b8', parentName: 'Big done', level: 1, status: 'completed' },
  { id: 'b9', name: 'b9', parentName: 'Big done', level: 1, status: 'completed' },
  { id: 'b10', name: 'b10', parentName: 'Big done', level: 1, status: 'completed' },
  { id: 'm2', name: 'Small open', level: 0 },
  { id: 's1', name: 's1', parentName: 'Small open', level: 1, status: 'todo' }
]`;

// Seven majors with distinct contributions, so the list has a real order:
// 3/16, 2/16, then three at 1/16, then two at zero - and the zero group with
// more items ("Services", 2) still sorts below the one with fewer ("Finishes").
const WIDE = `[
  { id: 'w1', name: 'Site preparation', isPhase: true },
  { id: 'w1a', name: 'Clear', parentId: 'w1', status: 'completed' },
  { id: 'w1b', name: 'Grade', parentId: 'w1', status: 'completed' },
  { id: 'w1c', name: 'Fence', parentId: 'w1', status: 'completed' },
  { id: 'w1d', name: 'Survey', parentId: 'w1', status: 'todo' },
  { id: 'w2', name: 'Foundation', isPhase: true },
  { id: 'w2a', name: 'Excavate', parentId: 'w2', status: 'completed' },
  { id: 'w2b', name: 'Rebar', parentId: 'w2', status: 'completed' },
  { id: 'w2c', name: 'Pour', parentId: 'w2', status: 'todo' },
  { id: 'w3', name: 'Structure', isPhase: true },
  { id: 'w3a', name: 'Columns', parentId: 'w3', status: 'completed' },
  { id: 'w3b', name: 'Beams', parentId: 'w3', status: 'todo' },
  { id: 'w3c', name: 'Slab', parentId: 'w3', status: 'todo' },
  { id: 'w4', name: 'Envelope', isPhase: true },
  { id: 'w4a', name: 'Roof', parentId: 'w4', status: 'completed' },
  { id: 'w4b', name: 'Windows', parentId: 'w4', status: 'todo' },
  { id: 'w5', name: 'Services', isPhase: true },
  { id: 'w5a', name: 'Rough-in', parentId: 'w5', status: 'todo' },
  { id: 'w5b', name: 'Terminations', parentId: 'w5', status: 'todo' },
  { id: 'w6', name: 'Finishes', isPhase: true },
  { id: 'w6a', name: 'Paint', parentId: 'w6', status: 'todo' },
  { id: 'w7', name: 'Handover', isPhase: true },
  { id: 'w7a', name: 'Snag', parentId: 'w7', status: 'completed' }
]`;

// Two majors, nothing completed: the empty line case.
const NOTHING_DONE = `[
  { id: 'n1', name: 'Site preparation', isPhase: true },
  { id: 'n1a', name: 'Clear', parentId: 'n1', status: 'todo' },
  { id: 'n1b', name: 'Grade', parentId: 'n1', status: 'todo' },
  { id: 'n2', name: 'Foundation', isPhase: true },
  { id: 'n2a', name: 'Excavate', parentId: 'n2', status: 'blocked' }
]`;

(async () => {
  let srv = null;
  const { chromium } = resolvePlaywright();
  let executablePath;
  try {
    executablePath =
      require(path.join(ROOT, 'tools', 'chrome-launcher.cjs')).chromePath || undefined;
  } catch (e) {
    /* playwright's own browser */
  }
  let browser = null;
  try {
    let up = false;
    try {
      up = (await fetch(BASE + '/manifest.webmanifest')).ok;
    } catch (e) {
      up = false;
    }
    if (!up) {
      log('starting serve.cjs for this run');
      srv = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
      for (let i = 0; i < 60 && !up; i++) {
        await delay(250);
        try {
          up = (await fetch(BASE + '/manifest.webmanifest')).ok;
        } catch (e) {
          /* keep waiting */
        }
      }
    }
    if (!up) {
      throw new Error('serve.cjs did not answer on ' + BASE);
    }

    browser = await chromium.launch({
      headless: true,
      executablePath,
      args: ['--disk-cache-size=0']
    });

    async function openProject(opts) {
      const coarse = !!(opts && opts.coarse);
      const ctx = await browser.newContext({
        viewport: coarse ? { width: 390, height: 844 } : { width: 1280, height: 900 },
        hasTouch: coarse,
        isMobile: coarse
      });
      await ctx.addInitScript(`try {
        localStorage.setItem('mmgr_unlocked_demo-project', '1');
        ${opts && opts.theme ? `localStorage.setItem('mmgr_theme', ${JSON.stringify(opts.theme)});` : ''}
        ${opts && opts.perf ? `localStorage.setItem('mmgr_perf_mode', 'on');` : ''}
      } catch (e) {}`);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(BASE + '/project.html?id=demo-project', { waitUntil: 'domcontentloaded' });
      await delay(1200);
      return { ctx, page, errors };
    }

    const seed = (page, tasks) =>
      page.evaluate(`(function () {
        MMGR.State.updateState(function (s) { s.tasks = ${tasks}; });
        MMGR.Render.renderDash();
      })();`);

    const listState = page =>
      page.evaluate(() => {
        const host = document.getElementById('major-list');
        if (!host) {
          return { exists: false };
        }
        const rows = Array.from(host.querySelectorAll('.major-row'));
        return {
          exists: true,
          hidden: !!host.hidden || getComputedStyle(host).display === 'none',
          rows: rows.map(function (el) {
            const dot = el.querySelector('.major-dot');
            const pts = el.querySelector('.major-pts');
            return {
              id: el.getAttribute('data-major-id'),
              name: (el.querySelector('.major-name') || {}).textContent || '',
              count: (el.querySelector('.major-count') || {}).textContent || '',
              pts: pts ? pts.textContent : null,
              dot: dot ? getComputedStyle(dot).backgroundColor : '',
              href: el.getAttribute('href'),
              nav: el.getAttribute('data-nav'),
              h: el.getBoundingClientRect().height
            };
          }),
          empty: !!host.querySelector('.major-empty'),
          more: host.querySelector('.major-more')
            ? host.querySelector('.major-more').textContent.trim()
            : '',
          moreAction: host.querySelector('.major-more')
            ? host.querySelector('.major-more').getAttribute('data-action')
            : ''
        };
      });

    const ringState = page =>
      page.evaluate(() => {
        const pring = document.querySelector('.pring');
        const svg = pring ? pring.querySelector('svg') : null;
        const fill = svg ? svg.querySelector('#rf') : null;
        const slots = svg ? Array.from(svg.querySelectorAll('.ring-slot')) : [];
        const tracks = svg ? Array.from(svg.querySelectorAll('.ring-slot-track')) : [];
        const tokens = {};
        slots.forEach(function (el) {
          const n = el.getAttribute('data-color');
          const probe = document.createElement('span');
          probe.style.color = 'var(--major-' + n + ')';
          document.body.appendChild(probe);
          tokens[n] = getComputedStyle(probe).color;
          probe.remove();
        });
        return {
          hasRing: !!pring,
          hasSvg: !!svg,
          fillHidden: !!fill && (fill.style.display === 'none' || !fill.offsetParent),
          fillShown: !!fill && fill.style.display !== 'none',
          slots: slots.map(function (el) {
            return {
              id: el.getAttribute('data-major-id'),
              color: el.getAttribute('data-color'),
              points: parseFloat(el.getAttribute('data-points')),
              dash: el.getAttribute('stroke-dasharray'),
              stroke: getComputedStyle(el).stroke,
              token: tokens[el.getAttribute('data-color')]
            };
          }),
          tracks: tracks.map(function (el) {
            return el.getAttribute('stroke-dasharray');
          }),
          centre: (document.getElementById('rt') || {}).textContent || '',
          dc: (document.getElementById('dc') || {}).textContent || '',
          tc: (document.getElementById('tc') || {}).textContent || '',
          role: svg ? svg.getAttribute('role') : '',
          label: svg ? svg.getAttribute('aria-label') : '',
          animation: svg ? getComputedStyle(svg).animationName : ''
        };
      });

    // ---- R1-R3, R6: the phased fixture ------------------------------
    {
      const { ctx, page, errors } = await openProject();
      await seed(page, PHASED);
      await page.evaluate(FLUSH_RAF);
      await delay(250);
      const st = await ringState(page);
      const expected = await page.evaluate(() => {
        const out = MMGR.MajorTasks.getMajorGroups(MMGR.State.getState());
        return {
          groups: out.groups.length,
          overall: out.overall,
          total: out.total,
          completed: out.completed
        };
      });

      check('R1 the phased fixture draws one arc per group', st.slots.length === expected.groups, {
        slots: st.slots.length,
        groups: expected.groups
      });
      check(
        'R1 the original single stroke is hidden while slots are drawn',
        st.fillHidden,
        st.fillShown
      );

      const sumPoints = st.slots.reduce((n, s) => n + (isFinite(s.points) ? s.points : 0), 0);
      const centreNum = parseFloat(st.centre);
      check(
        'R2 the arc points sum to the centre percentage within 0.1',
        Math.abs(sumPoints - centreNum) <= 0.1,
        { sumPoints: sumPoints, centre: st.centre }
      );
      check(
        'R2 the centre counts work items, not phase rows',
        centreNum === Math.round(expected.overall) && st.tc === String(expected.total),
        { centre: st.centre, tc: st.tc, want: expected.overall, total: expected.total }
      );

      const colourBad = st.slots.filter(s => s.stroke !== s.token);
      check(
        'R3 every arc paints the --major-N token it names',
        colourBad.length === 0,
        colourBad.map(s => ({ color: s.color, stroke: s.stroke, token: s.token }))
      );

      check(
        'R6 the SVG is role="img" with a label naming the percentage',
        st.role === 'img' && st.label.indexOf(st.centre) === 0,
        { role: st.role, label: st.label }
      );
      check(
        'R6 the label names the top contributors',
        /Top contributors:/.test(st.label),
        st.label
      );
      check('R1 no page error while drawing the ring', errors.length === 0, errors);
      await ctx.close();
    }

    // ---- R4: one phase keeps today's ring ---------------------------
    {
      const { ctx, page } = await openProject();
      await seed(page, SINGLE_PHASE);
      await page.evaluate(FLUSH_RAF);
      await delay(250);
      const st = await ringState(page);
      check('R4 a project with one phase draws no slots', st.slots.length === 0, st.slots.length);
      check('R4 the single stroke is back', st.fillShown, st.fillShown);
      check('R4 the centre reads the all-task percentage', st.centre === '50%', st.centre);
      await ctx.close();
    }

    // ---- D1-D5: the flat / older-project path ----------------------
    {
      const { ctx, page, errors } = await openProject();
      await seed(page, PLAIN);
      await page.evaluate(FLUSH_RAF);
      await delay(250);
      const st = await ringState(page);
      const dashFirst = s => parseFloat(String(s || '').split(' ')[0]) || 0;
      const byPts = st.slots.slice().sort((a, b) => b.points - a.points);

      check(
        'D1 a flat project draws one slot per main task',
        st.slots.length === 2,
        st.slots.length
      );
      check(
        'D2 every main task gets an equal arc width',
        st.tracks.length === 2 && st.tracks[0] === st.tracks[1],
        st.tracks
      );
      check(
        'D3 the completed main task fills its arc, the open one does not',
        byPts.length === 2 &&
          byPts[0].points === 50 &&
          byPts[1].points === 0 &&
          dashFirst(byPts[0].dash) > 100 &&
          dashFirst(byPts[1].dash) === 0,
        byPts.map(s => ({ points: s.points, dash: s.dash }))
      );
      check('D4 the centre is the mean main-task fraction', st.centre === '50%', {
        centre: st.centre,
        dc: st.dc,
        tc: st.tc
      });
      check('D5 the original #rf stroke stays hidden', st.fillHidden, st.fillShown);
      check('D5 no page error while drawing the flat ring', errors.length === 0, errors);
      await ctx.close();
    }

    // ---- D6: equal weighting beats the work-item rate --------------
    {
      const { ctx, page } = await openProject();
      await seed(page, DOMINANCE);
      await page.evaluate(FLUSH_RAF);
      await delay(250);
      const st = await ringState(page);
      const byPts = st.slots.slice().sort((a, b) => b.points - a.points);
      check(
        'D6 a completed task with ten subtasks cannot dominate an open one',
        st.slots.length === 2 &&
          st.tracks[0] === st.tracks[1] &&
          byPts[0].points === 50 &&
          byPts[1].points === 0 &&
          st.centre === '50%',
        {
          slots: st.slots.length,
          tracks: st.tracks,
          points: byPts.map(s => s.points),
          centre: st.centre
        }
      );
      check(
        'D6 the stat still counts the work items behind the ring',
        st.dc === '10' && st.tc === '11',
        { dc: st.dc, tc: st.tc }
      );
      await ctx.close();
    }

    // ---- D7: one main task draws one full-width segment -------------
    {
      const { ctx, page } = await openProject();
      await seed(page, SINGLE);
      await page.evaluate(FLUSH_RAF);
      await delay(250);
      const st = await ringState(page);
      const list = await listState(page);
      check(
        'D7 a single main task draws one full-width slot',
        st.slots.length === 1 && st.tracks.length === 1,
        { slots: st.slots.length, tracks: st.tracks }
      );
      check(
        'D7 the slot fills by its subtasks, not the container row',
        st.centre === '50%' && st.slots[0].points === 50,
        { centre: st.centre, points: st.slots[0] && st.slots[0].points, dc: st.dc, tc: st.tc }
      );
      check('D7 the single stroke is hidden', st.fillHidden, st.fillShown);
      check(
        'D7 the one-row list stays hidden',
        !list.exists || list.hidden || list.rows.length === 0,
        list
      );
      await ctx.close();
    }

    // ---- R5: Performance Mode --------------------------------------
    {
      const { ctx, page } = await openProject({ perf: true });
      await seed(page, PHASED);
      await page.evaluate(FLUSH_RAF);
      await delay(250);
      const st = await ringState(page);
      check(
        'R5 under Performance Mode the entry sweep does not run',
        st.animation === 'none',
        st.animation
      );
      check('R5 the slots still draw under Performance Mode', st.slots.length > 0, st.slots.length);
      await ctx.close();
    }

    // ---- R7: hover linkage -----------------------------------------
    {
      const { ctx, page } = await openProject();
      await seed(page, PHASED);
      await page.evaluate(FLUSH_RAF);
      await delay(250);
      const first = await page.evaluate(() => {
        const arc = document.querySelector('.ring-slot');
        return arc ? arc.getAttribute('data-major-id') : null;
      });
      if (first) {
        await page.evaluate(() => {
          const arc = document.querySelector('.ring-slot');
          arc.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
        });
        const hotArc = await page.evaluate(
          id =>
            Array.from(document.querySelectorAll('.ring-slot')).some(
              el => el.getAttribute('data-major-id') === id && el.classList.contains('is-hot')
            ),
          first
        );
        check('R7 hovering an arc marks it hot', hotArc, first);

        // The other half of the link (B4): a row lights its own arc.
        const rowId = await page.evaluate(() => {
          document.querySelectorAll('.ring-slot').forEach(function (el) {
            el.classList.remove('is-hot');
          });
          const row = document.querySelector('.major-row');
          if (!row) {
            return null;
          }
          row.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
          return row.getAttribute('data-major-id');
        });
        const hotFromRow = await page.evaluate(id => {
          const row = id ? document.querySelector('.major-row[data-major-id="' + id + '"]') : null;
          const arc = id ? document.querySelector('.ring-slot[data-major-id="' + id + '"]') : null;
          return {
            id: id,
            row: !!row && row.classList.contains('is-hot'),
            arc: !!arc && arc.classList.contains('is-hot')
          };
        }, rowId);
        check(
          'R7 hovering a row lights the matching arc',
          hotFromRow.row && hotFromRow.arc,
          hotFromRow
        );
      } else {
        check('R7 the fixture has an arc to hover', false, first);
      }
      await ctx.close();
    }

    // ---- L1-L6: the "What is driving completion" list (B4) ----------
    {
      const { ctx, page, errors } = await openProject();
      await seed(page, WIDE);
      await page.evaluate(FLUSH_RAF);
      await delay(250);
      const st = await listState(page);
      const ring = await ringState(page);

      check('L1 the list is shown for a grouped project', st.exists && !st.hidden, st);
      check('L1 five rows while collapsed', st.rows.length === 5, st.rows.length);
      check(
        'L1 the toggle offers the remaining groups',
        st.more === 'Show all (7)' && st.moreAction === 'majorShowAll',
        { more: st.more, action: st.moreAction }
      );
      check(
        'L1 the first row is the largest contributor',
        st.rows.length > 0 && st.rows[0].name === 'Site preparation',
        st.rows.map(r => r.name)
      );

      const model = await page.evaluate(() => {
        const out = MMGR.MajorTasks.getMajorGroups(MMGR.State.getState());
        return out.groups.map(function (g) {
          return { id: g.id, name: g.name, points: g.points, completed: g.completed };
        });
      });
      const byId = {};
      model.forEach(function (g) {
        byId[g.id] = g;
      });

      const ptsBad = st.rows.filter(function (r) {
        const g = byId[r.id];
        if (!g) {
          return true;
        }
        return r.pts !== '+' + g.points.toFixed(1) + ' pts';
      });
      check(
        'L3 points carry one decimal and match the model',
        ptsBad.length === 0,
        ptsBad.map(r => ({ id: r.id, pts: r.pts, want: byId[r.id] && byId[r.id].points }))
      );
      check(
        'L3 a completed group reads 18.8, not 18.75',
        st.rows.length > 0 && st.rows[0].pts === '+18.8 pts',
        st.rows.length > 0 ? st.rows[0].pts : null
      );
      check(
        'L3 every row reads "done of total"',
        st.rows.every(r => /^\d+ of \d+$/.test(r.count)),
        st.rows.map(r => r.count)
      );

      const arcById = {};
      ring.slots.forEach(function (s) {
        arcById[s.id] = s;
      });
      const dotBad = st.rows.filter(function (r) {
        return !arcById[r.id] || r.dot !== arcById[r.id].stroke;
      });
      check(
        'L4 a row dot paints the same token as its own arc',
        dotBad.length === 0,
        dotBad.map(r => ({ id: r.id, dot: r.dot, arc: arcById[r.id] && arcById[r.id].stroke }))
      );

      check(
        'L6 every row links to its major in the plan',
        st.rows.every(r => r.href === '#wbs' && r.nav === 'major'),
        st.rows.map(r => ({ href: r.href, nav: r.nav }))
      );

      // Expand.
      await page.evaluate(() => {
        const btn = document.querySelector('.major-more');
        if (btn) {
          btn.click();
        }
      });
      await delay(200);
      const all = await listState(page);
      check('L5 "Show all" expands to every group', all.rows.length === 7, all.rows.length);
      check('L5 the toggle flips to "Show top 5"', all.more === 'Show top 5', all.more);

      const expanded = all.rows.map(function (r) {
        return {
          id: r.id,
          name: r.name,
          pts: parseFloat(String(r.pts).replace(/[^\d.]/g, '')),
          zero: byId[r.id] && byId[r.id].completed === 0
        };
      });
      const orderBad = [];
      for (let i = 1; i < expanded.length; i++) {
        if (expanded[i].zero !== expanded[i - 1].zero) {
          if (expanded[i - 1].zero) {
            orderBad.push('zero before done at ' + i);
          }
        } else if (expanded[i].pts > expanded[i - 1].pts + 0.05) {
          orderBad.push('points rise at ' + i);
        }
      }
      check(
        'L2 order: highest contribution first, zero-completed rows last',
        orderBad.length === 0 && expanded[expanded.length - 1].zero,
        { orderBad: orderBad, names: expanded.map(r => r.name) }
      );

      // Collapse again.
      await page.evaluate(() => {
        const btn = document.querySelector('.major-more');
        if (btn) {
          btn.click();
        }
      });
      await delay(200);
      const back = await listState(page);
      check(
        'L5 "Show top 5" collapses back to five',
        back.rows.length === 5 && back.more === 'Show all (7)',
        { rows: back.rows.length, more: back.more }
      );
      check('L1 no page error while drawing the list', errors.length === 0, errors);
      await ctx.close();
    }

    // ---- L7: nothing completed yet ---------------------------------
    {
      const { ctx, page } = await openProject();
      await seed(page, NOTHING_DONE);
      await page.evaluate(FLUSH_RAF);
      await delay(250);
      const st = await listState(page);
      check('L7 the list still lists the groups', st.rows.length === 2, st.rows.length);
      check('L7 the empty line says nothing is completed', st.empty, st);
      check(
        'L7 no points render before anything is completed',
        st.rows.every(r => r.pts === null),
        st.rows.map(r => r.pts)
      );
      await ctx.close();
    }

    // ---- L8: coarse pointer row height -----------------------------
    {
      const { ctx, page } = await openProject({ coarse: true });
      await seed(page, WIDE);
      await page.evaluate(FLUSH_RAF);
      await delay(300);
      const st = await listState(page);
      const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
      check(
        'L8 rows are at least 44px high on a coarse pointer',
        coarse === true && st.rows.length > 0 && st.rows.every(r => r.h >= 44),
        { coarse: coarse, heights: st.rows.map(r => Math.round(r.h)) }
      );
      await ctx.close();
    }

    // ---- L9: one main task hides the list --------------------------
    {
      const { ctx, page } = await openProject();
      await seed(page, SINGLE);
      await page.evaluate(FLUSH_RAF);
      await delay(250);
      const st = await listState(page);
      check(
        'L9 a project with one main task hides the list',
        !st.exists || st.hidden || st.rows.length === 0,
        st
      );
      await ctx.close();
    }

    // ---- B6: the same colour on every surface ----------------------
    {
      const { ctx, page } = await openProject();
      await seed(page, PHASED);
      await page.evaluate(FLUSH_RAF);
      await delay(250);
      const ring = await ringState(page);
      const slot = ring.slots.filter(s => s.id === 'group:p:p1')[0];
      check(
        'B6 the fixture has the ring slot to match',
        !!slot,
        ring.slots.map(s => s.id)
      );

      // t1 belongs to phase p1; its row, bar and card must paint p1's colour.
      const wbsShadow = await page.evaluate(() => {
        MMGR.Nav.go({ panel: 'wbs' });
        const row = document.querySelector('#wbs-body tr[data-id="t1"]');
        const td = row ? row.querySelector('td') : null;
        return {
          has: !!row && row.hasAttribute('data-major'),
          paint: td ? getComputedStyle(td).boxShadow : ''
        };
      });
      const ganttPaint = await page.evaluate(() => {
        MMGR.Nav.go({ panel: 'gantt' });
        const bar = document.querySelector('#panel-gantt .gb[data-id="t1"]');
        return {
          has: !!bar && bar.hasAttribute('data-major'),
          paint: bar ? getComputedStyle(bar, '::before').backgroundColor : ''
        };
      });
      const kanPaint = await page.evaluate(() => {
        MMGR.Nav.go({ panel: 'kan' });
        const card = document.querySelector('#panel-kan .kc[data-id="t1"]');
        return {
          has: !!card && card.hasAttribute('data-major'),
          paint: card ? getComputedStyle(card).borderTopColor : ''
        };
      });

      const rgb = s => {
        const m = String(s || '').match(/rgba?\(([^)]+)\)/);
        return m ? 'rgb(' + m[1].replace(/\s+/g, '') + ')' : String(s || '');
      };
      const want = rgb(slot && slot.stroke);
      check(
        'B6 the WBS row marker paints the ring slot colour',
        wbsShadow.has && rgb(wbsShadow.paint) === want,
        { want: want, got: rgb(wbsShadow.paint), raw: wbsShadow.paint }
      );
      check(
        'B6 the Gantt bar accent paints the ring slot colour',
        ganttPaint.has && rgb(ganttPaint.paint) === want,
        { want: want, got: rgb(ganttPaint.paint) }
      );
      check(
        'B6 the Kanban card stripe paints the ring slot colour',
        kanPaint.has && rgb(kanPaint.paint) === want,
        { want: want, got: rgb(kanPaint.paint) }
      );
      await ctx.close();
    }

    // ---- B6: no majors, no stripe ----------------------------------
    {
      const { ctx, page } = await openProject();
      await seed(page, SINGLE_PHASE);
      await page.evaluate(FLUSH_RAF);
      await delay(250);
      const st = await page.evaluate(() => {
        MMGR.Nav.go({ panel: 'kan' });
        const card = document.querySelector('#panel-kan .kc');
        return {
          has: !!card && card.hasAttribute('data-major'),
          border: card ? getComputedStyle(card).borderTopColor : ''
        };
      });
      check('B6 an ungrouped project draws no stripe', !st.has, st);
      await ctx.close();
    }

    // ---- R8: dark theme --------------------------------------------
    {
      const { ctx, page } = await openProject({ theme: 'dark' });
      await seed(page, PHASED);
      await page.evaluate(FLUSH_RAF);
      await delay(300);
      const st = await ringState(page);
      const colourBad = st.slots.filter(s => s.stroke !== s.token);
      check(
        'R8 the dark theme paints the dark steps of the same tokens',
        st.slots.length > 0 && colourBad.length === 0,
        colourBad.map(s => ({ color: s.color, stroke: s.stroke, token: s.token }))
      );
      await ctx.close();
    }
  } catch (e) {
    failed++;
    log('FAIL  harness error  <-- ' + (e && e.message ? e.message : e));
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {}
    }
    if (srv) {
      try {
        srv.kill();
      } catch (e) {}
    }
    log('');
    log(passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
  }
})();
