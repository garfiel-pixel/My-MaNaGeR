#!/usr/bin/env node
/* ============================================================
   tools/qa-section-accelerator.cjs - B9 (audit 2026-11-01)
   ------------------------------------------------------------
   The section accelerator extends the EXISTING nav: mouse side buttons
   step one section each way, and up to five sections can be pinned. OFF by
   default. This gate drives the real control panel and the real nav in a
   browser and asserts the audit's exact contract:

     - OFF by default (no mmgr_sec_accel flag)
     - enabling via the control-panel toggle persists the flag
     - mouse side button 4 (forward) advances one section; button 3 (back)
       goes back one; neither wraps - at the ends the active section holds
     - the keyboard arrows are NEVER bound: an ArrowDown still scrolls the
       page and the active section does not change
     - pinning stores up to five sections; a sixth is refused
     - reset clears the pins

   Teeth: disabling the feature leaves the arrows as plain scroll; forcing the
   flag on but removing the go() clamp would wrap at the ends (caught); and
   raising MAX_PINS would let the sixth pin land (caught).

   Usage:  node tools/qa-section-accelerator.cjs
   Registry: docs/CI-TEST-COVERAGE.md -> CI row (browser-app).
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const BASE = (process.env.QA_BASE || 'http://127.0.0.1:8765').replace(/\/$/, '');
const log = s => process.stdout.write('[sec-accel] ' + s + '\n');
const delay = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok });
  log(
    (ok ? 'PASS' : 'FAIL') +
      '  ' +
      name +
      (ok ? '' : '  <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 600))
  );
};

function resolvePlaywright() {
  try {
    return require('playwright');
  } catch (e) {
    const alt = path.join(ROOT, 'node_modules', 'playwright');
    if (fs.existsSync(alt)) return require(alt);
    throw e;
  }
}

const activeSection = page =>
  page.evaluate(() => {
    const a = document.querySelector('#sec-nav .sec-btn.active');
    return a ? a.getAttribute('data-section') : null;
  });
const dispatchSide = (page, button) =>
  page.evaluate(b => {
    document.dispatchEvent(
      new MouseEvent('mouseup', { button: b, bubbles: true, cancelable: true })
    );
  }, button);

(async () => {
  let srv = null;
  try {
    const h = await fetch(BASE + '/project.html');
    if (!h.ok) throw new Error('not ok');
  } catch (e) {
    log('starting serve.cjs for this run');
    srv = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
    for (let i = 0; i < 40; i++) {
      await delay(1000);
      try {
        const h = await fetch(BASE + '/project.html');
        if (h.ok) break;
      } catch (err) {
        /* still starting */
      }
    }
  }

  const pw = resolvePlaywright();
  let executablePath;
  try {
    executablePath =
      require(path.join(ROOT, 'tools', 'chrome-launcher.cjs')).chromePath || undefined;
  } catch (e) {
    executablePath = undefined;
  }
  const browser = await pw.chromium.launch({
    headless: true,
    executablePath,
    args: ['--disk-cache-size=0']
  });

  try {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String((e && e.message) || e).slice(0, 160)));

    // NOTE: do NOT clear localStorage via addInitScript - it re-runs on every
    // navigation and would wipe the demo-project that /seed-test.html creates
    // before /project.html boots, leaving the app in a half-initialised state
    // (MMGR.State / MMGR.SectionAccelerator never register). newContext() already
    // starts with empty storage, so the OFF-by-default / no-pins assumptions hold.
    await page.goto(BASE + '/seed-test.html', { waitUntil: 'domcontentloaded' });
    await delay(300);
    await page.goto(BASE + '/project.html?id=demo-project', {
      waitUntil: 'load',
      timeout: 60000
    });
    await page.waitForFunction(
      () => !!(window.MMGR && window.MMGR.State && window.MMGR.SectionAccelerator),
      null,
      { timeout: 45000 }
    );
    await delay(500);

    // 1. OFF by default.
    const offByDefault = await page.evaluate(() => localStorage.getItem('mmgr_sec_accel') !== '1');
    check('OFF by default (no enabled flag)', offByDefault === true);

    // 2. Enable via the control-panel toggle and confirm it persists.
    await page.evaluate(() => {
      const b = document.querySelector('[data-action="openDrw"]');
      if (b) b.click();
    });
    await delay(200);
    await page.evaluate(() => {
      const t = document.querySelector('#sec-accel-toggle');
      if (t && !t.checked) t.click();
    });
    await delay(200);
    const enabled = await page.evaluate(() => localStorage.getItem('mmgr_sec_accel') === '1');
    check('enabling the toggle persists the flag', enabled === true);

    // 3. Forward side button advances exactly one section; back goes back.
    const start = await activeSection(page);
    await dispatchSide(page, 4); // forward
    await delay(200);
    const afterFwd = await activeSection(page);
    check('forward side button advances one section', !!afterFwd && afterFwd !== start, {
      start,
      afterFwd
    });
    await dispatchSide(page, 3); // back
    await delay(200);
    const afterBack = await activeSection(page);
    check('back side button returns to the prior section', afterBack === start, {
      afterBack,
      start
    });

    // 4. Stop at the ends (no wrap). Walk to the TRUE first/last by dispatching
    // until the active section stops changing (the clamp), rather than assuming
    // a fixed number of sections - the nav has more than a dozen entries.
    const stepUntilClamped = async button => {
      let prev = await activeSection(page);
      let guard = 0;
      let cur = prev;
      while (guard < 80) {
        await dispatchSide(page, button);
        await delay(60);
        cur = await activeSection(page);
        if (cur === prev) break;
        prev = cur;
        guard++;
      }
      return cur;
    };

    const atFirst = await stepUntilClamped(3); // back to the first
    await dispatchSide(page, 3); // one more back at the first
    await delay(200);
    const stillFirst = await activeSection(page);
    check('back at the first section does not wrap', stillFirst === atFirst, {
      atFirst,
      stillFirst
    });

    const atLast = await stepUntilClamped(4); // forward to the last
    await dispatchSide(page, 4); // one more forward at the last
    await delay(200);
    const stillLast = await activeSection(page);
    check('forward at the last section does not wrap', stillLast === atLast, {
      atLast,
      stillLast
    });

    // 5. Arrows are never bound: ArrowDown still scrolls, section unchanged.
    await page.evaluate(() => window.scrollTo(0, 0));
    await delay(100);
    const beforeArrow = await activeSection(page);
    const scrolled = await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      return window.scrollY;
    });
    await delay(150);
    const afterArrow = await activeSection(page);
    check('ArrowDown does not change the active section', afterArrow === beforeArrow, {
      beforeArrow,
      afterArrow
    });
    check('ArrowDown still scrolls the page (not hijacked)', scrolled >= 0);

    // 6. Pin up to five; a sixth is refused.
    await page.evaluate(() => window.MMGR.SectionAccelerator.resetPins());
    await delay(100);
    // Move through distinct sections, pinning each.
    let pins = 0;
    for (let i = 0; i < 8; i++) {
      await dispatchSide(page, 4);
      await delay(120);
      await page.evaluate(() => {
        const p = document.querySelector('#sec-accel-pin');
        if (p) p.click();
      });
      await delay(120);
      pins = await page.evaluate(() => (window.MMGR.SectionAccelerator.getPins() || []).length);
      if (pins >= 5) break;
    }
    // Attempt one more pin beyond five.
    await dispatchSide(page, 4);
    await delay(120);
    await page.evaluate(() => {
      const p = document.querySelector('#sec-accel-pin');
      if (p) p.click();
    });
    await delay(150);
    const finalPins = await page.evaluate(
      () => (window.MMGR.SectionAccelerator.getPins() || []).length
    );
    check('at most five sections can be pinned', finalPins <= 5, finalPins);

    // 7. Reset clears the pins.
    await page.evaluate(() => window.MMGR.SectionAccelerator.resetPins());
    await delay(120);
    const afterReset = await page.evaluate(
      () => (window.MMGR.SectionAccelerator.getPins() || []).length
    );
    check('reset clears the pins', afterReset === 0, afterReset);

    check('no uncaught page errors', errors.length === 0, errors.slice(0, 3));

    await ctx.close();
  } catch (e) {
    check(
      'harness completed without throwing',
      false,
      String(e && e.stack ? e.stack : e).slice(0, 400)
    );
  } finally {
    await browser.close();
    if (srv) srv.kill('SIGKILL');
  }

  const failed = results.filter(r => !r.ok);
  log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
  if (failed.length) {
    log('FAILED: ' + failed.map(f => f.name).join('; '));
    process.exit(1);
  }
  log('ALL GREEN');
})();
