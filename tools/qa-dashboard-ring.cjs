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
     R4 no groups: exactly today's single stroke, no slot layer.
     R5 Performance Mode: the entry sweep does not run.
     R6 the SVG is role="img" and its label names the percentage and
        the top contributors (colour is never the only carrier).
     R7 hovering an arc marks it hot (the list half arrives with B4).
     R8 the ring survives a dark theme with the same tokens.

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
// phase rows and no labels, which is the "keep today's ring" case.
const PHASED = `[
  { id: 'p1', name: 'Site preparation', isPhase: true, status: 'inprogress' },
  { id: 't1', name: 'Site grading', parentId: 'p1', status: 'completed' },
  { id: 't2', name: 'Temporary fences', parentId: 'p1', status: 'todo' },
  { id: 'p2', name: 'Foundation', isPhase: true, status: 'inprogress' },
  { id: 't3', name: 'Excavate', parentId: 'p2', status: 'completed' },
  { id: 't4', name: 'Rebar', parentId: 'p2', status: 'todo' },
  { id: 'p3', name: 'Structure', isPhase: true, status: 'todo' },
  { id: 't5', name: 'Columns', parentId: 'p3', status: 'todo' },
  { id: 't6', name: 'Slab', parentId: 'p3', status: 'completed' },
  { id: 't7', name: 'Stairs', parentId: 'p3', status: 'todo' }
]`;

const PLAIN = `[
  { id: 'a', name: 'One', status: 'completed' },
  { id: 'b', name: 'Two', status: 'todo' }
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
      const ctx = await browser.newContext({
        viewport: { width: 1280, height: 900 }
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

    const ringState = page =>
      page.evaluate(() => {
        const pring = document.querySelector('.pring');
        const svg = pring ? pring.querySelector('svg') : null;
        const fill = svg ? svg.querySelector('#rf') : null;
        const slots = svg ? Array.from(svg.querySelectorAll('.ring-slot')) : [];
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

    // ---- R4: no groups keeps today's ring ---------------------------
    {
      const { ctx, page } = await openProject();
      await seed(page, PLAIN);
      await page.evaluate(FLUSH_RAF);
      await delay(250);
      const st = await ringState(page);
      check('R4 a project with no groups draws no slots', st.slots.length === 0, st.slots.length);
      check('R4 the single stroke is back', st.fillShown, st.fillShown);
      check('R4 the centre still reads the all-task percentage', st.centre === '50%', st.centre);
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
      } else {
        check('R7 the fixture has an arc to hover', false, first);
      }
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
