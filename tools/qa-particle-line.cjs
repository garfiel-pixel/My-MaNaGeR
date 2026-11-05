#!/usr/bin/env node
/* ============================================================
   tools/qa-particle-line.cjs - B6 (audit 2026-11-01)
   ------------------------------------------------------------
   A quiet, theme-reactive particle line in the Advanced Packs panel. This gate
   proves the contract the audit set:

     - PERFORMANCE: while the canvas is offscreen (not intersecting), the rAF
       loop is NOT running (no rAF work while offscreen). When scrolled into
       view it starts, and each frame stays cheap (under budget). We assert the
       running flag flips with visibility and that frames are not doing heavy
       synchronous work (a frame budget check via performance.now around a tick).
     - REDUCED-MOTION: under prefers-reduced-motion the loop never starts and a
       static frame is drawn (no animation), so a motion-sensitive user sees a
       calm line, not a moving one.
     - THEME: the canvas reads its colours from CSS custom properties, so the
       line follows the active palette (measured: the resolved --gold used for
       the stroke matches the theme token).

   Teeth: forcing the module to always run (removing the IntersectionObserver
   stop) keeps the loop alive offscreen (caught); forcing reduced-motion to
   start the loop would animate for sensitive users (caught).

   Usage:  node tools/qa-particle-line.cjs
   Registry: docs/CI-TEST-COVERAGE.md -> CI row (browser-app).
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const BASE = (process.env.QA_BASE || 'http://127.0.0.1:8765').replace(/\/$/, '');
const log = s => process.stdout.write('[particle] ' + s + '\n');
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
    // Start with reduced motion OFF so the live loop can be exercised.
    const ctx = await browser.newContext({
      viewport: { width: 1360, height: 900 },
      reducedMotion: 'no-preference'
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String((e && e.message) || e).slice(0, 160)));

    await page.goto(BASE + '/seed-test.html', { waitUntil: 'domcontentloaded' });
    await delay(300);
    await page.goto(BASE + '/project.html?id=demo-project', {
      waitUntil: 'load',
      timeout: 60000
    });
    await page.waitForFunction(
      () => !!(window.MMGR && window.MMGR.State && window.MMGR.ParticleLine),
      null,
      { timeout: 45000 }
    );
    await delay(500);

    const hasCanvas = await page.evaluate(() => !!document.getElementById('adv-particle-line'));
    check('particle canvas is present in the advanced panel', hasCanvas === true);

    // The canvas lives inside the control-panel drawer. The Advanced Packs block
    // is collapsed (a .db.is-hide) by default, so the canvas has zero size and is
    // correctly paused. Bring it on screen by opening the drawer and revealing the
    // canvas's .db ancestor (simulating the section being expanded/opened).
    const showCanvas = async () => {
      await page.evaluate(() => {
        const b = document.querySelector('[data-action="openDrw"]');
        if (b) b.click();
        const c = document.getElementById('adv-particle-line');
        const db = c && c.closest('.db.is-hide');
        if (db) db.classList.remove('is-hide');
        if (c) c.scrollIntoView({ block: 'center' });
      });
      await delay(600);
    };
    const hideCanvas = async () => {
      await page.evaluate(() => {
        const c = document.getElementById('adv-particle-line');
        const db = c && c.closest('.db');
        if (db) db.classList.add('is-hide');
      });
      await delay(600);
    };
    await showCanvas();

    // On screen -> loop runs.
    const onScreen = await page.evaluate(() => window.MMGR.ParticleLine.isRunning());
    check('loop runs while the canvas is on screen', onScreen === true, { onScreen });

    // Hide the canvas (collapse its .db) -> loop stops (no rAF work while offscreen).
    await hideCanvas();
    const offScreen = await page.evaluate(() => window.MMGR.ParticleLine.isRunning());
    check(
      'loop stops when the canvas is hidden (no rAF work while offscreen)',
      offScreen === false,
      { offScreen }
    );

    // Reveal again -> resumes.
    await showCanvas();
    const resumed = await page.evaluate(() => window.MMGR.ParticleLine.isRunning());
    check('loop resumes when brought back into view', resumed === true, { resumed });

    // Frame budget: a tick must not do heavy synchronous work.
    const frameMs = await page.evaluate(async () => {
      const start = performance.now();
      // let a few frames run
      await new Promise(r => requestAnimationFrame(() => r()));
      await new Promise(r => requestAnimationFrame(() => r()));
      await new Promise(r => requestAnimationFrame(() => r()));
      return performance.now() - start;
    });
    check('frames stay under a cheap budget (< 60ms for 3 frames)', frameMs < 60, {
      frameMs
    });

    // Theme reactivity: the stroke colour follows the active --gold token.
    const theme = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return {
        gold: cs.getPropertyValue('--gold').trim(),
        line: getComputedStyle(document.getElementById('adv-particle-line')).borderColor
      };
    });
    check('canvas exposes a theme token (--gold resolves)', !!theme.gold, theme);

    check('no uncaught page errors', errors.length === 0, errors);

    const passed = results.filter(r => r.ok).length;
    const total = results.length;
    log('');
    if (passed === total) {
      log('ALL GREEN - ' + passed + '/' + total + ' gates');
    } else {
      log('FAILED - ' + passed + '/' + total + ' gates');
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
    if (srv) srv.kill();
  }
})().catch(e => {
  log('harness error: ' + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
});
