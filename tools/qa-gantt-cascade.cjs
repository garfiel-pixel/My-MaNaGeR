/* ============================================================
   tools/qa-gantt-cascade.cjs - the Gantt is readable and re-times itself
   ------------------------------------------------------------
   UI-WAVE 2026-11-20 G. The owner asked for four things the chart did not do:
   the date header vanished on scroll, the red Today line was unexplained,
   there was no way to pan, and moving a task left its successors behind.

   Gates:
     G1 the date header is sticky and the label column follows the rows.
     G2 the toolbar names the red Today line and the line is drawn.
     G3 drag-to-pan scrolls the chart background horizontally.
     G4 dragging a predecessor moves its successors (auto-cascade) and the
        Kanban card shows the new date.
     G5 a WBS duration edit moves its successors the same way.
     G6 no page error throughout.

   Usage:   node tools/qa-gantt-cascade.cjs
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
const log = s => process.stdout.write('[qa-gantt] ' + s + '\n');
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
        JSON.stringify(detail === undefined ? null : detail).slice(0, 1200)
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

const f = d => d.toISOString().slice(0, 10);
const now = new Date();
const D = n => {
  const d = new Date(now);
  d.setDate(now.getDate() + n);
  return f(d);
};

// Three linked tasks. The last one spans today, so the Today line has a home.
const CHAIN = [
  { id: 't1', name: 'First', startDate: D(-10), endDate: D(-8), duration: '3', status: 'todo' },
  {
    id: 't2',
    name: 'Second',
    startDate: D(-7),
    endDate: D(-5),
    duration: '3',
    status: 'todo',
    predecessors: ['t1']
  },
  {
    id: 't3',
    name: 'Third',
    startDate: D(-4),
    endDate: D(2),
    duration: '7',
    status: 'todo',
    predecessors: ['t2']
  }
];

const WIDE = [];
for (let i = 0; i < 20; i++) {
  WIDE.push({
    id: 'w' + i,
    name: 'Wide ' + i,
    startDate: D(-120 + i * 10),
    endDate: D(-116 + i * 10),
    duration: '5',
    status: 'todo'
  });
}

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

    async function makePage() {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await ctx.addInitScript(`try {
        localStorage.setItem('mmgr_unlocked_demo-project', '1');
        localStorage.setItem('mmgr_first_project_tour_v1', '1');
      } catch (e) {}`);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(BASE + '/project.html?id=demo-project', { waitUntil: 'domcontentloaded' });
      await delay(1200);
      return { ctx, page, errors };
    }

    const seed = (page, tasks) =>
      page.evaluate(t => {
        MMGR.State.updateState(s => {
          s.tasks = t;
          s.ui = s.ui || {};
          s.ui.ganttWindow = 'all';
          s.ui.ganttGroupBy = 'phase';
        });
        MMGR.Render.renderAll();
      }, tasks);

    const dates = page =>
      page.evaluate(() => {
        const s = MMGR.State.getState();
        const out = {};
        (s.tasks || []).forEach(t => {
          out[t.id] = { start: t.startDate, end: t.endDate, dur: t.duration };
        });
        const kan = {};
        document.querySelectorAll('#panel-kan .kc').forEach(c => {
          kan[c.getAttribute('data-id')] = (c.textContent || '').replace(/\s+/g, ' ').trim();
        });
        return { tasks: out, kan };
      });

    // ---- G1/G2/G3: sticky header, Today key, drag-to-pan -------------
    {
      const { ctx, page, errors } = await makePage();
      await seed(page, WIDE);
      await delay(400);
      await page.evaluate(() => MMGR.Nav.go({ panel: 'gantt' }));
      await delay(600);

      const before = await page.evaluate(() => {
        const gh = document.querySelector('.gh');
        const gc = document.getElementById('gantt-chart');
        return {
          ghPos: getComputedStyle(gh).position,
          ghZ: getComputedStyle(gh).zIndex,
          ghTop: Math.round(gh.getBoundingClientRect().top),
          ghH: Math.round(gh.getBoundingClientRect().height),
          gcTop: Math.round(gc.getBoundingClientRect().top),
          clientH: gc.clientHeight,
          scrollH: gc.scrollHeight,
          todayKey: !!document.querySelector('.gv-key'),
          todayLine: !!document.querySelector('.gantt-today'),
          cursor: getComputedStyle(gc).cursor
        };
      });

      const scrolled = await page.evaluate(() => {
        const gc = document.getElementById('gantt-chart');
        const gh = document.querySelector('.gh');
        const gl = document.getElementById('gantt-labels');
        gc.scrollTop = 400;
        return new Promise(resolve => {
          requestAnimationFrame(() =>
            requestAnimationFrame(() =>
              resolve({
                ghTop: Math.round(gh.getBoundingClientRect().top),
                glScrollTop: gl.scrollTop,
                gcScrollTop: gc.scrollTop,
                ghH: gh.offsetHeight
              })
            )
          );
        });
      });

      check(
        'G1 the date header is sticky at the chart top',
        before.ghPos === 'sticky' &&
          before.ghZ === '6' &&
          before.ghTop === before.gcTop &&
          scrolled.ghTop === before.gcTop,
        { before, scrolled }
      );
      check(
        'G1 the label column follows the rows (offset by the header)',
        scrolled.gcScrollTop > 0 &&
          Math.abs(scrolled.glScrollTop - (scrolled.gcScrollTop - scrolled.ghH)) <= 1,
        scrolled
      );
      check(
        'G2 the toolbar names the red Today line and the line is drawn',
        before.todayKey && before.todayLine,
        { key: before.todayKey, line: before.todayLine }
      );

      // Pan: drag the empty chart background left; the chart scrolls right.
      const panBox = await page.evaluate(() => {
        const gc = document.getElementById('gantt-chart');
        const r = gc.getBoundingClientRect();
        return { x: r.left + r.width - 80, y: r.top + r.height - 80 };
      });
      const panBefore = await page.evaluate(
        () => document.getElementById('gantt-chart').scrollLeft
      );
      await page.mouse.move(panBox.x, panBox.y);
      await page.mouse.down();
      await page.mouse.move(panBox.x - 120, panBox.y, { steps: 8 });
      await page.mouse.up();
      await delay(250);
      const panAfter = await page.evaluate(() => {
        const gc = document.getElementById('gantt-chart');
        return {
          left: gc.scrollLeft,
          ghTop: Math.round(document.querySelector('.gh').getBoundingClientRect().top),
          panning: document.body.classList.contains('gantt-panning')
        };
      });
      check(
        'G3 drag-to-pan scrolls the chart background',
        panAfter.left > panBefore + 40 && panAfter.ghTop === before.gcTop && !panAfter.panning,
        { panBefore, panAfter, cursor: before.cursor }
      );
      check('G1-G3 no page error', errors.length === 0, errors);
      await ctx.close();
    }

    // ---- G4: dragging a predecessor cascades to its successors ------
    {
      const { ctx, page, errors } = await makePage();
      await seed(page, CHAIN);
      await delay(400);
      await page.evaluate(() => MMGR.Nav.go({ panel: 'gantt' }));
      await delay(600);
      const before = await dates(page);
      const box = await page.evaluate(() => {
        const b = document.querySelector('#gantt-chart .gb[data-id="t1"]');
        if (!b) {
          return null;
        }
        const r = b.getBoundingClientRect();
        return { x: r.left + Math.min(10, r.width / 2), y: r.top + r.height / 2 };
      });
      if (!box) {
        check('G4 the fixture draws the t1 bar', false, null);
      } else {
        await page.mouse.move(box.x, box.y);
        await page.mouse.down();
        await page.mouse.move(box.x + 45, box.y, { steps: 10 });
        await page.mouse.up();
        await delay(800);
        const after = await dates(page);
        const t1Moved = after.tasks.t1.start !== before.tasks.t1.start;
        const t2Moved = after.tasks.t2.start > before.tasks.t2.start;
        const t2AfterT1 = after.tasks.t2.start >= after.tasks.t1.end;
        const t3Moved = after.tasks.t3.start > before.tasks.t3.start;
        const kanMoved = after.kan.t2 && after.kan.t2 !== before.kan.t2;
        check(
          'G4 dragging a predecessor moves its successors and the Kanban card',
          t1Moved && t2Moved && t2AfterT1 && t3Moved && kanMoved,
          {
            t1Moved,
            t2Moved,
            t2AfterT1,
            t3Moved,
            kanMoved,
            before: before.tasks,
            after: after.tasks,
            kanBefore: before.kan.t2,
            kanAfter: after.kan.t2
          }
        );
      }
      check('G4 no page error', errors.length === 0, errors);
      await ctx.close();
    }

    // ---- G5: a duration edit cascades the same way ------------------
    {
      const { ctx, page, errors } = await makePage();
      await seed(page, CHAIN);
      await delay(400);
      await page.evaluate(() => MMGR.Nav.go({ panel: 'wbs' }));
      await delay(500);
      const before = await dates(page);
      const ok = await page.evaluate(() => {
        const row = document.querySelector('#wbs-body tr.wbs-row[data-id="t1"]');
        const inp = row && row.querySelector('input[data-field="duration"]');
        if (!inp) {
          return false;
        }
        inp.focus();
        inp.value = '6';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      });
      await delay(800);
      const after = await dates(page);
      const t2Moved = after.tasks.t2.start > before.tasks.t2.start;
      const t3Moved = after.tasks.t3.start > before.tasks.t3.start;
      const kanMoved = after.kan.t2 && after.kan.t2 !== before.kan.t2;
      check(
        'G5 a WBS duration edit moves its successors and the Kanban card',
        ok && after.tasks.t1.dur === '6' && t2Moved && t3Moved && kanMoved,
        {
          ok,
          t2Moved,
          t3Moved,
          kanMoved,
          before: before.tasks,
          after: after.tasks,
          kanBefore: before.kan.t2,
          kanAfter: after.kan.t2
        }
      );
      check('G5 no page error', errors.length === 0, errors);
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
