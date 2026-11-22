/* ============================================================
   tools/qa-raci-matrix.cjs - the RACI matrix reads and edits like a table
   ------------------------------------------------------------
   UI-WAVE 2026-11-20 I. The owner's complaints were all about the surface:
   person names were clipped in 90px inputs, the task column cut names off at
   190px, there was no zebra, no sticky header and no sticky task column, six
   dark "remove" buttons sat under the column headers, empty cells were dark
   blocks, and a cell could only be changed by cycling.

   Gates:
     R1 the matrix is a bounded scroll area and the header row sticks.
     R2 the task column sticks horizontally while the grid scrolls.
     R3 even rows are striped and a row lights on hover.
     R4 the column action is a small menu that still removes the column.
     R5 an unassigned cell is a dashed outline with a faint plus; an assigned
        one is neither.
     R6 R / A / C / I set the letter directly and Backspace clears it.
     R7 a row with no Accountable person carries the amber mark beside its
        name, and assigning one removes it.
     R8 no page error throughout.

   Usage:   node tools/qa-raci-matrix.cjs
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
const log = s => process.stdout.write('[qa-raci] ' + s + '\n');
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

// Two named rows plus filler, three people, one assigned letter. The filler
// makes the grid taller than its cap so the sticky header has something to
// scroll under; the second row deliberately has no Accountable person.
const ROWS = [
  { id: 't1', name: 'Pour slab', level: 1, status: 'todo' },
  { id: 't2', name: 'Set out and excavate the north-east corner', level: 1, status: 'todo' }
];
for (let i = 3; i <= 30; i++) {
  ROWS.push({ id: 't' + i, name: 'Filler task ' + i, level: 1, status: 'todo' });
}
const SEED = {
  tasks: ROWS,
  persons: [
    { id: 'p1', name: 'Amara Okonkwo-Bennett', role: 'Site manager' },
    { id: 'p2', name: 'Rui', role: 'Foreman' },
    { id: 'p3', name: 'Dee', role: 'QS' }
  ],
  matrix: { t1_p1: 'A', t1_p2: 'R', t2_p1: 'R' }
};

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

    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(`try {
      localStorage.setItem('mmgr_unlocked_demo-project', '1');
      localStorage.setItem('mmgr_first_project_tour_v1', '1');
    } catch (e) {}`);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE + '/project.html?id=demo-project', { waitUntil: 'domcontentloaded' });
    await delay(1400);

    // Seed the matrix and open the Collaborate panel.
    await page.evaluate(seed => {
      MMGR.State.updateState(s => {
        s.tasks = seed.tasks;
        s.raci = { tasks: seed.tasks, persons: seed.persons, matrix: seed.matrix };
      });
      MMGR.Render.renderAll();
    }, SEED);
    await delay(300);
    await page.evaluate(() => MMGR.Nav.go({ panel: 'raci' }));
    await delay(700);
    await page.evaluate(() => MMGR.Render.renderRaci());
    await delay(300);

    // ---- R1/R2/R3: the scroll area, both sticky axes, the stripes ------
    const frame = await page.evaluate(() => {
      const wrap = document.querySelector('.raci-scroll');
      const table = document.querySelector('.raci-matrix');
      const head = table ? table.querySelector('thead th') : null;
      const taskTh = table ? table.querySelector('thead .raci-task-col') : null;
      const taskTd = table ? table.querySelector('tbody .raci-task-td') : null;
      const rows = table ? table.querySelectorAll('tbody tr') : [];
      const rowBg = i => {
        const td = rows[i] ? rows[i].querySelector('.raci-cell-td') : null;
        return td ? getComputedStyle(td).backgroundColor : null;
      };
      return {
        hasWrap: !!wrap,
        wrapOverflow: wrap ? getComputedStyle(wrap).overflow : null,
        wrapMaxH: wrap ? getComputedStyle(wrap).maxHeight : null,
        headPos: head ? getComputedStyle(head).position : null,
        headTop: head ? getComputedStyle(head).top : null,
        taskThPos: taskTh ? getComputedStyle(taskTh).position : null,
        taskTdPos: taskTd ? getComputedStyle(taskTd).position : null,
        rows: rows.length,
        even: rowBg(1),
        odd: rowBg(0)
      };
    });
    check(
      'R1 the matrix is a bounded scroll area with a sticky header row',
      frame.hasWrap &&
        /auto|scroll/.test(frame.wrapOverflow || '') &&
        frame.wrapMaxH !== 'none' &&
        frame.headPos === 'sticky' &&
        frame.headTop === '0px',
      frame
    );
    check(
      'R2 the task column sticks on the horizontal axis',
      frame.taskThPos === 'sticky' && frame.taskTdPos === 'sticky',
      frame
    );
    check(
      'R3 even rows are striped and the stripe is not the odd-row colour',
      frame.rows >= 2 && !!frame.even && !!frame.odd && frame.even !== frame.odd,
      frame
    );

    // The header must actually hold its place when the grid scrolls.
    const sticky = await page.evaluate(async () => {
      const wrap = document.querySelector('.raci-scroll');
      const head = wrap.querySelector('thead th');
      const before = Math.round(head.getBoundingClientRect().top);
      wrap.scrollTop = 200;
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const after = Math.round(head.getBoundingClientRect().top);
      const scrolled = wrap.scrollTop;
      const metrics = { scrollH: wrap.scrollHeight, clientH: wrap.clientHeight };
      wrap.scrollTop = 0;
      return { before, after, scrolled, metrics };
    });
    check(
      'R1b the header holds its place when the grid scrolls under it',
      sticky.scrolled > 0 && Math.abs(sticky.after - sticky.before) <= 1,
      sticky
    );

    // ---- R4: the column menu ------------------------------------------
    const menu = await page.evaluate(() => {
      const th = document.querySelector('.raci-person-col');
      const btn = th ? th.querySelector('.raci-col-menu') : null;
      const popId = btn ? btn.getAttribute('popovertarget') : null;
      const pop = popId ? document.getElementById(popId) : null;
      const item = pop ? pop.querySelector('[data-action="delRaciPerson"]') : null;
      return {
        hasBtn: !!btn,
        hasPop: !!pop,
        popover: pop ? pop.hasAttribute('popover') : false,
        label: item ? item.textContent.trim() : null,
        // the old dark button must be gone
        oldBtn: !!th.querySelector('.btn-d')
      };
    });
    check(
      'R4 the column action is a menu that names "Remove column"',
      menu.hasBtn &&
        menu.hasPop &&
        menu.popover &&
        menu.label === 'Remove column' &&
        menu.oldBtn === false,
      menu
    );

    const removed = await page.evaluate(async () => {
      const before = MMGR.State.getState().raci.persons.length;
      const btn = document.querySelector('.raci-person-col .raci-col-menu');
      const pop = document.getElementById(btn.getAttribute('popovertarget'));
      pop.querySelector('[data-action="delRaciPerson"]').click();
      await new Promise(r => setTimeout(r, 120));
      const after = MMGR.State.getState().raci.persons.length;
      MMGR.State.updateState(s => {
        s.raci = { tasks: [], persons: [], matrix: {} };
      });
      MMGR.Render.renderRaci();
      return { before, after };
    });
    check(
      'R4b the menu entry still removes the column',
      removed.before === 3 && removed.after === 2,
      removed
    );

    // ---- R5/R7: empty cells and the zero-Accountable mark -------------
    await page.evaluate(seed => {
      MMGR.State.updateState(s => {
        s.raci = { tasks: seed.tasks, persons: seed.persons, matrix: seed.matrix };
      });
      MMGR.Render.renderRaci();
    }, SEED);
    await delay(200);
    const cells = await page.evaluate(() => {
      const btn = document.querySelector('.raci-cell[data-task="t2"][data-person="p3"]');
      const full = document.querySelector('.raci-cell[data-task="t1"][data-person="p1"]');
      const cs = btn ? getComputedStyle(btn) : null;
      const after = btn ? getComputedStyle(btn, '::after') : null;
      const fullCs = full ? getComputedStyle(full) : null;
      return {
        emptyClass: btn ? btn.classList.contains('is-empty') : null,
        emptyStyle: cs ? cs.borderTopStyle : null,
        emptyText: btn ? btn.textContent.trim() : null,
        plus: after ? after.content : null,
        fullClass: full ? full.classList.contains('is-empty') : null,
        fullStyle: fullCs ? fullCs.borderTopStyle : null,
        fullText: full ? full.textContent.trim() : null
      };
    });
    check(
      'R5 an unassigned cell is a dashed outline with a plus, an assigned one is solid',
      cells.emptyClass === true &&
        cells.emptyStyle === 'dashed' &&
        cells.emptyText === '' &&
        /\+/.test(cells.plus || '') &&
        cells.fullClass === false &&
        cells.fullStyle === 'solid' &&
        cells.fullText === 'A',
      cells
    );

    const warn = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.raci-matrix tbody tr'));
      const marks = rows.map(r => !!r.querySelector('.raci-gate'));
      const rowText = rows.map(r => (r.querySelector('.raci-task-td') || {}).textContent || '');
      return { marks, rowText };
    });
    check(
      'R7 only the row with no Accountable person carries the amber mark',
      warn.marks.length === ROWS.length &&
        warn.marks[0] === false &&
        warn.marks.slice(1).every(v => v === true),
      { marks: warn.marks, first: warn.rowText[0], second: warn.rowText[1] }
    );

    const warnGone = await page.evaluate(async () => {
      MMGR.Raci.setRaci('t2', 'p3', 'A');
      await new Promise(r => setTimeout(r, 120));
      const rows = Array.from(document.querySelectorAll('.raci-matrix tbody tr'));
      return rows.map(r => !!r.querySelector('.raci-gate'));
    });
    check(
      'R7b assigning an Accountable person clears the mark',
      warnGone.length === ROWS.length && warnGone[1] === false,
      warnGone
    );

    // ---- R6: direct keys ----------------------------------------------
    const keys = await page.evaluate(async () => {
      const fire = (k, idx) => {
        const btn = document.querySelector('.raci-cell[data-task="t1"][data-person="p3"]');
        if (!btn) {
          return false;
        }
        btn.focus();
        btn.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
        return true;
      };
      const read = () => MMGR.State.getState().raci.matrix['t1_p3'] || '';
      const out = {};
      out.fired = fire('c');
      await new Promise(r => setTimeout(r, 80));
      out.c = read();
      fire('i');
      await new Promise(r => setTimeout(r, 80));
      out.i = read();
      fire('Backspace');
      await new Promise(r => setTimeout(r, 80));
      out.cleared = read();
      // Enter must still cycle forward (the old contract)
      fire('Enter');
      await new Promise(r => setTimeout(r, 80));
      out.enter = read();
      return out;
    });
    check(
      'R6 R/A/C/I set the letter directly, Backspace clears, Enter still cycles',
      keys.c === 'C' && keys.i === 'I' && keys.cleared === '' && keys.enter === 'R',
      keys
    );

    check('R8 no page error throughout', errors.length === 0, errors);

    await ctx.close();
    await browser.close();
    browser = null;
    if (srv) {
      try {
        srv.kill();
      } catch (e) {}
    }
    log('RESULT ' + passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
  } catch (e) {
    if (browser) {
      try {
        await browser.close();
      } catch (err) {}
    }
    if (srv) {
      try {
        srv.kill();
      } catch (err) {}
    }
    log('HARNESS ERROR ' + String((e && e.stack) || e).slice(0, 900));
    process.exit(1);
  }
})();
