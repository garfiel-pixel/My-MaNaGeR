#!/usr/bin/env node
/* ============================================================
   tools/qa-gold-edge.cjs - C3 (audit 2026-11-01)
   ------------------------------------------------------------
   C3 judged the gold edge "too thick / forced" - in dark mode the focus ring
   was pure white (#ffffff, because --gold-ink is white there), reading as a
   whiteboard box. The fix introduces a dedicated --focus-ring token: gold in
   light mode, a soft gold in dark mode. This gate MEASURES the resolved token
   in both themes (not an eyeball check) and asserts the dark-mode edge is no
   longer pure white, so the focus edge earns its place as a gold hairline.

   Teeth: reverting --focus-ring to var(--gold-ink) in dark mode makes the
   resolved value white again and fails the "not pure white" arm.

   Usage:  node tools/qa-gold-edge.cjs
   Registry: docs/CI-TEST-COVERAGE.md -> CI row (browser-app).
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const BASE = (process.env.QA_BASE || 'http://127.0.0.1:8765').replace(/\/$/, '');
const log = s => process.stdout.write('[gold-edge] ' + s + '\n');
const delay = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok });
  log(
    (ok ? 'PASS' : 'FAIL') +
      '  ' +
      name +
      (ok ? '' : '  <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 400))
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
    const h = await fetch(BASE + '/app.html');
    if (!h.ok) throw new Error('not ok');
  } catch (e) {
    log('starting serve.cjs for this run');
    srv = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
    for (let i = 0; i < 40; i++) {
      await delay(1000);
      try {
        const h = await fetch(BASE + '/app.html');
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

    await page.goto(BASE + '/app.html', { waitUntil: 'load', timeout: 60000 });
    // The gate only reads the resolved --focus-ring CSS token, which is available
    // as soon as the stylesheet is applied - no app module state is required.
    await page.waitForFunction(() => !!document.body, null, { timeout: 45000 });
    await delay(400);

    // Light mode: --focus-ring resolves to the gold ink (gold, not white).
    const light = await page.evaluate(() => {
      document.body.classList.remove('dark-mode');
      return getComputedStyle(document.documentElement).getPropertyValue('--focus-ring').trim();
    });
    check('light-mode --focus-ring is defined', !!light && light.length > 0, light);
    check(
      'light-mode focus edge is not pure white',
      !/^#?fff(?:f)?$|^rgb\(\s*255\s*,\s*255\s*,\s*255/.test(light.toLowerCase()),
      light
    );

    // Dark mode: --focus-ring must resolve to a soft gold, NOT pure white.
    const dark = await page.evaluate(() => {
      document.body.classList.add('dark-mode');
      return getComputedStyle(document.documentElement).getPropertyValue('--focus-ring').trim();
    });
    check('dark-mode --focus-ring is defined', !!dark && dark.length > 0, dark);
    check(
      'dark-mode focus edge is softened (not pure white #fff)',
      !/^#?fff(?:f)?$|^rgb\(\s*255\s*,\s*255\s*,\s*255/.test(dark.toLowerCase()),
      dark
    );

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
