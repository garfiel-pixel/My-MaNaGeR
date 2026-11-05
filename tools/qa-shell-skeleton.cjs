#!/usr/bin/env node
/* ============================================================
   tools/qa-shell-skeleton.cjs - B12 (audit 2026-11-01)
   ------------------------------------------------------------
   The boot loading skeleton must mirror the real project workspace,
   not show generic grey blocks (audit B12). This gate is a
   STATIC-STRUCTURE arm: it compares the skeleton's node classes
   against the real shell's regions and asserts every major region
   the user sees (header, section nav, panel grid, rail) has a
   corresponding placeholder in the boot splash.

     Region map (real shell -> skeleton placeholder):
       #app-header                    -> .bs-skel-header
       #sec-nav (.sec-btn strip)     -> .bs-skel-nav  (.skel-sec children)
       .panel grid                   -> .skel-boot-grid (.skel-card children)
       #app-sidebar (rail)           -> .bs-skel-rail (.skel-dot children)

   Teeth: removing the .bs-skel-nav or .bs-skel-rail block (reverting to the
   old header+grid-only splash) fails the region-parity arm; a skeleton with
   fewer than the minimum placeholder children per region fails the shape arm.

   Usage:  node tools/qa-shell-skeleton.cjs
   Registry: docs/CI-TEST-COVERAGE.md -> CI row (browser-app).
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const BASE = (process.env.QA_BASE || 'http://127.0.0.1:8765').replace(/\/$/, '');
const log = s => process.stdout.write('[shell-skel] ' + s + '\n');
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
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String((e && e.message) || e).slice(0, 160)));

    // newContext() starts with empty storage, mirroring the first-load state.
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

    // --- Real shell regions ---
    const real = await page.evaluate(() => ({
      header: !!document.querySelector('#app-header'),
      nav: document.querySelectorAll('#sec-nav .sec-btn').length,
      panels: document.querySelectorAll('.panel').length,
      rail: !!document.querySelector('#app-sidebar')
    }));
    check('real shell has #app-header', real.header === true);
    check('real shell has #sec-nav with section buttons', real.nav >= 3, real);
    check('real shell has a .panel grid', real.panels >= 1, real);
    check('real shell has #app-sidebar (rail)', real.rail === true);

    // --- Skeleton placeholders (static markup in #boot-splash) ---
    const skel = await page.evaluate(() => {
      const sp = document.querySelector('#boot-splash');
      if (!sp) return null;
      return {
        header: sp.querySelectorAll('.bs-skel-header').length,
        nav: sp.querySelectorAll('.bs-skel-nav .skel-sec').length,
        grid: sp.querySelectorAll('.skel-boot-grid .skel-card').length,
        rail: sp.querySelectorAll('.bs-skel-rail .skel-dot').length
      };
    });
    check('skeleton is present in the DOM', skel !== null, skel);
    check('skeleton mirrors header (.bs-skel-header)', !!skel && skel.header >= 1, skel);
    check(
      'skeleton mirrors section nav (.bs-skel-nav with .skel-sec children)',
      !!skel && skel.nav >= 3,
      skel
    );
    check(
      'skeleton mirrors panel grid (.skel-boot-grid with .skel-card children)',
      !!skel && skel.grid >= 2,
      skel
    );
    check(
      'skeleton mirrors rail (.bs-skel-rail with .skel-dot children)',
      !!skel && skel.rail >= 3,
      skel
    );

    // --- Parity arm: every real region has a corresponding skeleton placeholder ---
    const parity =
      !!skel &&
      real.header === true &&
      skel.header >= 1 &&
      real.nav >= 3 &&
      skel.nav >= 3 &&
      real.panels >= 1 &&
      skel.grid >= 2 &&
      real.rail === true &&
      skel.rail >= 3;
    check('skeleton structure parallels the real shell (region parity)', parity === true, {
      real,
      skel
    });

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
  process.exit(1);
});
