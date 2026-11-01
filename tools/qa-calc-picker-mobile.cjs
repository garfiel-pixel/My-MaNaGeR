#!/usr/bin/env node
/* ============================================================
   tools/qa-calc-picker-mobile.cjs - the phone picker is a chooser, not a field
   ------------------------------------------------------------
   Owner report 2026-11-01: "on mobile, if I try to toggle type of work and
   choose the type of work, I can choose it, but my screen becomes completely
   grayed out... the moment I try to scroll the screen just passes back off and
   I cannot access that again. I think the issue is that you are treating it as
   a typing area."

   Three faults produced that one experience, and each has an arm here:

     M1  the control is readOnly on a phone, so tapping it never raises the
         soft keyboard (it is a chooser)
     M2  the bottom sheet sits inside the visible viewport, not under the
         keyboard: its rect is fully on screen at 390x844
     M3  a pointerdown that starts a SCROLL changes nothing - no pick, no close
     M4  a real click still picks the row and closes the sheet
     M5  the scrim closes on click only, so scrolling over it is safe
     M6  the sheet itself scrolls (its content is taller than its box)
     M7  zero page errors through the walk

   Usage:  node tools/qa-calc-picker-mobile.cjs
   Registry: docs/CI-TEST-COVERAGE.md -> CI row (browser-calc).
   ============================================================ */
'use strict';
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8765);
const BASE = process.env.BASE || 'http://127.0.0.1:' + PORT;
const delay = ms => new Promise(r => setTimeout(r, ms));

let pass = 0;
const fails = [];
function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log('PASS  ' + name);
  } else {
    fails.push(name);
    console.log(
      'FAIL  ' +
        name +
        (detail === undefined ? '' : '  <-- ' + JSON.stringify(detail).slice(0, 600))
    );
  }
}

async function ensureServer() {
  try {
    const h = await fetch(BASE + '/calculator.html');
    if (h.ok) {
      return null;
    }
  } catch (e) {
    /* not up */
  }
  const srv = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 30; i++) {
    await delay(1000);
    try {
      const h = await fetch(BASE + '/calculator.html');
      if (h.ok) {
        return srv;
      }
    } catch (e) {
      /* keep waiting */
    }
  }
  throw new Error('serve.cjs did not come up');
}

const OPENER = () => {
  const wrap = document.querySelector('.mmcb[data-for="calc-family"]');
  const input = wrap && wrap.querySelector('.mmcb-input');
  const pop = document.querySelector('.mmcb-pop[data-for="calc-family"]');
  return { input: input, pop: pop };
};

(async () => {
  const srv = await ensureServer();
  const { chromium } = require('playwright');
  const browser = await chromium.launch({
    headless: true,
    executablePath: require('./chrome-launcher.cjs').chromePath,
    args: ['--disk-cache-size=0', '--no-sandbox']
  });
  // A phone: touch, a narrow layout viewport, and a device pixel ratio.
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2
  });
  const errors = [];
  ctx.on('page', p => p.on('pageerror', e => errors.push(String(e))));

  try {
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(BASE + '/calculator.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.mmcb[data-for="calc-family"] .mmcb-input', { timeout: 20000 });
    await delay(600);

    // ---- M1: chooser, not a field
    const ro = await page.evaluate(() => {
      const w = document.querySelector('.mmcb[data-for="calc-family"] .mmcb-input');
      return w ? w.readOnly : null;
    });
    check('M1 the picker control is readOnly on a phone', ro === true, { readOnly: ro });

    // ---- open it
    await page.click('.mmcb[data-for="calc-family"] .mmcb-input');
    await delay(500);
    const opened = await page.evaluate(() => {
      const pop = document.querySelector('.mmcb-pop[data-for="calc-family"]');
      if (!pop || pop.hidden) {
        return null;
      }
      const r = pop.getBoundingClientRect();
      return {
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        left: Math.round(r.left),
        right: Math.round(r.right),
        vh: window.innerHeight,
        vw: window.innerWidth,
        rows: pop.querySelectorAll('[role="option"]').length
      };
    });
    check('M1b tapping the control opens the sheet', !!opened && opened.rows > 0, opened);

    // ---- M2: fully inside the visible viewport
    check(
      'M2 the sheet sits inside the visible viewport',
      !!opened && opened.bottom <= opened.vh + 1 && opened.top >= 0 && opened.left >= 0,
      opened
    );
    check(
      'M2b the sheet covers a usable height',
      !!opened && opened.bottom - opened.top >= 180,
      opened && { height: opened.bottom - opened.top }
    );

    // ---- M3: a scroll that starts on a row must not pick or close
    const beforeValue = await page.evaluate(() => document.getElementById('calc-family').value);
    const afterDrag = await page.evaluate(() => {
      const pop = document.querySelector('.mmcb-pop[data-for="calc-family"]');
      const row = pop.querySelector('[role="option"]');
      const o = { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 1 };
      row.dispatchEvent(new PointerEvent('pointerdown', o));
      return {
        stillOpen: !pop.hidden,
        value: document.getElementById('calc-family').value,
        rowValue: row.getAttribute('data-value')
      };
    });
    check(
      'M3 a pointerdown on a row does not close the sheet',
      afterDrag.stillOpen === true,
      afterDrag
    );
    check('M3b a pointerdown on a row does not pick it', afterDrag.value === beforeValue, {
      before: beforeValue,
      after: afterDrag.value,
      row: afterDrag.rowValue
    });

    // ---- M4: a real click picks and closes
    const targetRow = await page.evaluate(() => {
      const pop = document.querySelector('.mmcb-pop[data-for="calc-family"]');
      const rows = Array.prototype.slice.call(pop.querySelectorAll('[role="option"]'));
      const row =
        rows.find(r => r.getAttribute('data-value') === 'groundworks') || rows[1] || rows[0];
      return row ? row.getAttribute('data-value') : null;
    });
    await page.click(
      '.mmcb-pop[data-for="calc-family"] [role="option"][data-value="' + targetRow + '"]'
    );
    await delay(400);
    const picked = await page.evaluate(() => ({
      value: document.getElementById('calc-family').value,
      open: !document.querySelector('.mmcb-pop[data-for="calc-family"]').hidden
    }));
    check('M4 a click picks the row', picked.value === targetRow, { want: targetRow, got: picked });
    check('M4b the sheet closes after the pick', picked.open === false, picked);

    // ---- M5: scrolling over the scrim is safe, a click closes it
    await page.click('.mmcb[data-for="calc-family"] .mmcb-input');
    await delay(400);
    const scrimDrag = await page.evaluate(() => {
      const pop = document.querySelector('.mmcb-pop[data-for="calc-family"]');
      const scrim = pop.querySelector('.mmcb-scrim');
      scrim.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          pointerType: 'touch',
          pointerId: 2
        })
      );
      return !pop.hidden;
    });
    check('M5 a pointerdown on the scrim does not close the sheet', scrimDrag === true, {
      open: scrimDrag
    });
    await page.evaluate(() => {
      const pop = document.querySelector('.mmcb-pop[data-for="calc-family"]');
      pop.querySelector('.mmcb-scrim').click();
    });
    await delay(300);
    const closedByScrim = await page.evaluate(
      () => document.querySelector('.mmcb-pop[data-for="calc-family"]').hidden
    );
    check('M5b a click on the scrim closes the sheet', closedByScrim === true, {
      hidden: closedByScrim
    });

    // ---- M6: the sheet scrolls. Measured on the WORK ITEM list, which is the
    // one long enough to need it (the family list is eight rows).
    await page.click('.mmcb[data-for="calc-work"] .mmcb-input');
    await delay(400);
    const scrolled = await page.evaluate(() => {
      const sheet = document.querySelector('.mmcb-pop[data-for="calc-work"] .mmcb-sheet');
      const tall = sheet.scrollHeight > sheet.clientHeight;
      sheet.scrollTop = 120;
      return {
        tall: tall,
        scrollTop: sheet.scrollTop,
        scrollHeight: sheet.scrollHeight,
        clientHeight: sheet.clientHeight
      };
    });
    check('M6 the sheet has more rows than fit', scrolled.tall === true, scrolled);
    check('M6b the sheet scrolls', scrolled.scrollTop > 0, scrolled);

    check('M7 zero page errors through the walk', errors.length === 0, errors.slice(0, 3));
  } finally {
    await browser.close();
    if (srv) {
      srv.kill();
    }
  }

  console.log(
    '\n' + (fails.length ? fails.length + ' failed' : 'all checks passed (' + pass + ')')
  );
  process.exit(fails.length ? 1 : 0);
})().catch(e => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
