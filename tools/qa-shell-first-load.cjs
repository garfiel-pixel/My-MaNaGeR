#!/usr/bin/env node
/* ============================================================
   tools/qa-shell-first-load.cjs - B7 (audit 2026-11-01) first-load shell
   ------------------------------------------------------------
   The owner asked that every shell load FLAT: no off-canvas drawer
   pops out on its own, and a first-time visitor gets ONE silent demo
   where the rail slides out and back, then is never seen again on that
   device. This gate proves that contract on the real served pages.

   What it asserts (real Chrome over serve.cjs on :8765):
     1. FRESH app.html: the one-shot demo fires exactly once - `rail-nudge`
        appears and then clears, the `mmgr_rail_nudge` flag is written, and
        the drawer is NOT left stuck open after the demo.
     2. WARM app.html (flag already set): the demo does NOT fire again.
     3. REDUCED-MOTION app.html: no demo at all and the flag is untouched.
     4. project.html: loads flat - no `side-open` / `rail-nudge` at load or
        after settle (its shell already boots without the drawer).

   Teeth: removing the one-shot guard (so it fires every load) turns FRESH
   into a second-run failure; disabling the demo entirely leaves FRESH red
   because the flag is never written and the rail never moves.

   Usage:  node tools/qa-shell-first-load.cjs
   Registry: docs/CI-TEST-COVERAGE.md -> CI row (browser-app).
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const BASE = (process.env.QA_BASE || 'http://127.0.0.1:8765').replace(/\/$/, '');
const log = s => process.stdout.write('[shell-first-load] ' + s + '\n');
const delay = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok });
  log(
    (ok ? 'PASS' : 'FAIL') +
      '  ' +
      name +
      (ok ? '' : '  <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 500))
  );
};

function resolvePlaywright() {
  try {
    return require('playwright');
  } catch (e) {
    const alt = path.join(ROOT, 'node_modules', 'playwright');
    if (fs.existsSync(alt)) {
      return require(alt);
    }
    throw e;
  }
}

// Wait until `rail-nudge` has been seen and then cleared, or the cap elapses.
// A device that skips the nudge (reduced motion, warm profile, narrow viewport)
// resolves on the cap without ever seeing it.
// The demo runs on a 900ms timer and clears itself 1500ms later, while
// `page.goto(..., waitUntil: 'load')` can resolve AFTER all of that has
// happened - measured locally: a cold load took longer than the whole 2.4s
// demo, so a class poll that only starts at the load event saw nothing and
// called a working demo dead. A MutationObserver installed before any page
// script runs records the appearance itself, so the assertion no longer
// depends on when the load event fires.
async function watchRailNudge(page) {
  await page.addInitScript(() => {
    window.__railNudgeSeen = false;
    const watch = () => {
      if (!document.body) {
        return;
      }
      new MutationObserver(() => {
        if (document.body.classList.contains('rail-nudge')) {
          window.__railNudgeSeen = true;
        }
      }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    };
    if (document.body) {
      watch();
    } else {
      document.addEventListener('DOMContentLoaded', watch, { once: true });
    }
  });
}

async function waitForOneShotDemo(page, capMs) {
  const started = Date.now();
  while (Date.now() - started < capMs) {
    const st = await page.evaluate(() => ({
      seen: window.__railNudgeSeen === true,
      on: document.body.classList.contains('rail-nudge')
    }));
    if (st.seen && !st.on) {
      return true;
    }
    await new Promise(r => setTimeout(r, 50));
  }
  return page.evaluate(() => window.__railNudgeSeen === true);
}

(async () => {
  let srv = null;
  try {
    const h = await fetch(BASE + '/app.html');
    if (!h.ok) {
      throw new Error('not ok');
    }
  } catch (e) {
    log('starting serve.cjs for this run');
    srv = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
    for (let i = 0; i < 40; i++) {
      await delay(1000);
      try {
        const h = await fetch(BASE + '/app.html');
        if (h.ok) {
          break;
        }
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
    // ----------------------------------------------------------------
    // FRESH app.html - the one-shot demo must fire exactly once.
    // ----------------------------------------------------------------
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      const errors = [];
      await watchRailNudge(page);
      page.on('pageerror', e => errors.push(String((e && e.message) || e).slice(0, 160)));
      // Fresh device: no rail-nudge flag yet.
      await page.addInitScript(() => {
        try {
          localStorage.clear();
        } catch (e) {}
      });
      await page.goto(BASE + '/app.html', { waitUntil: 'load', timeout: 60000 });
      const played = await waitForOneShotDemo(page, 6000);
      const flag = await page.evaluate(() => localStorage.getItem('mmgr_rail_nudge'));
      const stuckOpen = await page.evaluate(
        () =>
          document.body.classList.contains('side-open') ||
          document.body.classList.contains('rail-nudge')
      );
      // focus must not be trapped by the demo
      const focusOk = await page.evaluate(() => {
        const a = document.activeElement;
        return !a || a === document.body || a.tagName === 'BODY';
      });
      check('FRESH: one-shot demo fires once', played === true);
      check('FRESH: mmgr_rail_nudge flag written', flag === '1', flag);
      check('FRESH: drawer not left stuck open after demo', stuckOpen === false);
      check('FRESH: demo does not trap focus', focusOk === true);
      check('FRESH: no uncaught page errors', errors.length === 0, errors.slice(0, 3));
      await ctx.close();
    }

    // ----------------------------------------------------------------
    // WARM app.html - flag already set, demo must NOT fire again.
    // ----------------------------------------------------------------
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      await watchRailNudge(page);
      await page.addInitScript(() => {
        try {
          localStorage.setItem('mmgr_rail_nudge', '1');
        } catch (e) {}
      });
      await page.goto(BASE + '/app.html', { waitUntil: 'load', timeout: 60000 });
      const played = await waitForOneShotDemo(page, 4000);
      check('WARM: demo does not replay on a returning device', played === false);
      await ctx.close();
    }

    // ----------------------------------------------------------------
    // REDUCED MOTION - no demo at all, flag untouched.
    // ----------------------------------------------------------------
    {
      const ctx = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        reducedMotion: 'reduce'
      });
      const page = await ctx.newPage();
      await watchRailNudge(page);
      await page.addInitScript(() => {
        try {
          localStorage.clear();
        } catch (e) {}
      });
      await page.goto(BASE + '/app.html', { waitUntil: 'load', timeout: 60000 });
      const played = await waitForOneShotDemo(page, 4000);
      const flag = await page.evaluate(() => localStorage.getItem('mmgr_rail_nudge'));
      check('REDUCED-MOTION: no demo plays', played === false);
      check('REDUCED-MOTION: flag left untouched', flag === null, flag);
      await ctx.close();
    }

    // ----------------------------------------------------------------
    // project.html - loads flat, no off-canvas drawer at any point.
    // ----------------------------------------------------------------
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      // A bare /project.html redirects to the app shell when no project id is
      // given, and the app shell legitimately plays the one-shot rail demo at
      // +900ms. The assertion below samples at +800ms, so on a slow runner the
      // demo could start first and fail a check that is about the DRAWER, not
      // the demo. Pre-setting the once-per-device flag removes the demo from
      // the equation and leaves the real contract: nothing opens the drawer by
      // itself at load.
      await page.addInitScript(() => {
        try {
          localStorage.setItem('mmgr_rail_nudge', '1');
        } catch (e) {}
      });
      await page.goto(BASE + '/project.html', { waitUntil: 'load', timeout: 60000 });
      await delay(800);
      const flatAtLoad = await page.evaluate(
        () =>
          !document.body.classList.contains('side-open') &&
          !document.body.classList.contains('rail-nudge')
      );
      check('project.html: loads flat (no off-canvas drawer)', flatAtLoad === true);
      await ctx.close();
    }
  } catch (e) {
    check(
      'harness completed without throwing',
      false,
      String(e && e.stack ? e.stack : e).slice(0, 400)
    );
  } finally {
    await browser.close();
    if (srv) {
      srv.kill('SIGKILL');
    }
  }

  const failed = results.filter(r => !r.ok);
  log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
  if (failed.length) {
    log('FAILED: ' + failed.map(f => f.name).join('; '));
    process.exit(1);
  }
  log('ALL GREEN');
})();
