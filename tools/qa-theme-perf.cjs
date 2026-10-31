#!/usr/bin/env node
/* ============================================================
   tools/qa-theme-perf.cjs - theme and Performance Mode stay independent
   ------------------------------------------------------------
   Owner report (audit 2026-10-31, finding 11): "toggling the theme on the
   calculator does not reach the app, and toggling Performance Mode on the
   app page puts the theme back." Two separate device preferences live in
   two separate keys:

       mmgr_theme      'light' | 'dark' | 'system' | 'cyan' | 'magenta'
       mmgr_perf_mode  'on' | 'off'

   They are applied by different modules (js/mmgr-theme.js writes
   body.dark-mode; js/mmgr-perf.js writes <html data-perf>). This gate
   pins the contract that neither control may move the other, on every
   page that carries both:

     T1  on the calculator, a theme flip leaves the perf pref AND the perf
         attribute untouched; a perf flip leaves the theme pref AND
         body.dark-mode untouched
     T2  the same on the project workspace, where the controls are the
         Appearance select and the Performance Mode switch
     T3  both preferences survive a reload, independently
     T4  both preferences travel between pages (project -> calculator ->
         app), which is the "does not reach the app" half of the report

   The controls are driven by the same `change` events a person produces
   (the checkboxes are visually hidden by design, and the Appearance
   select sits in a closed drawer, so a pointer path would test the drawer
   rather than the state contract). Control presence is asserted first, so
   a missing or renamed control fails here instead of passing silently.

   Usage:  node tools/qa-theme-perf.cjs
   Registry: docs/CI-TEST-COVERAGE.md -> CI row (browser-app).
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

const PREFS = () => ({
  theme: (() => {
    try {
      return localStorage.getItem('mmgr_theme');
    } catch (e) {
      return null;
    }
  })(),
  perf: (() => {
    try {
      return localStorage.getItem('mmgr_perf_mode');
    } catch (e) {
      return null;
    }
  })(),
  dark: document.body.classList.contains('dark-mode'),
  perfAttr: document.documentElement.getAttribute('data-perf'),
  themeCtl:
    !!document.getElementById('theme-select') ||
    !!document.querySelector('[data-action="tglTheme"]'),
  perfCtl: !!document.querySelector('input[data-action="tglPerfMode"]')
});

// Two pages expose the theme differently: the project and the dashboard have
// the Appearance select (heard by js/mmgr-dock.js), the calculator has a
// toggle button (dispatched through its action map). Drive whichever one the
// page actually carries, and only if the stored value is not already right.
const SET_THEME = mode => {
  const sel = document.getElementById('theme-select');
  if (sel) {
    sel.value = mode;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return 'select';
  }
  const btn = document.querySelector('[data-action="tglTheme"]');
  if (btn) {
    let cur = null;
    try {
      cur = localStorage.getItem('mmgr_theme');
    } catch (e) {
      /* storage is a preference */
    }
    if (cur !== mode) {
      btn.click();
    }
    return 'button';
  }
  return false;
};

// Drive the Performance Mode switch through its own delegated `change`.
const SET_PERF = on => {
  const el = document.querySelector('input[data-action="tglPerfMode"]');
  if (!el) {
    return false;
  }
  el.checked = !!on;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
};

(async () => {
  const srv = await ensureServer();
  const { chromium } = require('playwright');
  const browser = await chromium.launch({
    headless: true,
    executablePath: require('./chrome-launcher.cjs').chromePath,
    args: ['--disk-cache-size=0', '--no-sandbox']
  });

  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String((e && e.message) || e).slice(0, 180)));

    // Deterministic baseline: light theme, Performance Mode off.
    await page.goto(BASE + '/calculator.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.setItem('mmgr_theme', 'light');
      localStorage.setItem('mmgr_perf_mode', 'off');
    });

    // ---- T1: calculator, both directions --------------------------------
    await page.goto(BASE + '/calculator.html', { waitUntil: 'domcontentloaded' });
    await delay(700);
    const c0 = await page.evaluate(PREFS);
    check('T1 the calculator carries both controls', c0.themeCtl && c0.perfCtl, c0);
    check(
      'T1 baseline is light with perf off',
      c0.theme === 'light' && c0.perf === 'off' && !c0.dark,
      c0
    );

    await page.evaluate(SET_THEME, 'dark');
    await delay(350);
    const c1 = await page.evaluate(PREFS);
    check(
      'T1a a theme flip on the calculator leaves Performance Mode alone',
      c1.theme === 'dark' && c1.dark === true && c1.perf === 'off' && c1.perfAttr === 'off',
      c1
    );

    await page.evaluate(SET_PERF, true);
    await delay(350);
    const c2 = await page.evaluate(PREFS);
    check(
      'T1b a Performance Mode flip on the calculator leaves the theme alone',
      c2.theme === 'dark' && c2.dark === true && c2.perf === 'on' && c2.perfAttr === 'on',
      c2
    );

    // ---- T3a: both survive a reload, still independent -------------------
    await page.reload({ waitUntil: 'domcontentloaded' });
    await delay(700);
    const c3 = await page.evaluate(PREFS);
    check(
      'T3a both preferences survive a calculator reload',
      c3.theme === 'dark' && c3.dark === true && c3.perf === 'on' && c3.perfAttr === 'on',
      c3
    );

    // ---- T4a: the pair travels to the project workspace -----------------
    await page.goto(BASE + '/seed-test.html', { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.MMGR && window.MMGR.App, null, { timeout: 60000 });
    await delay(1200);
    const p0 = await page.evaluate(PREFS);
    check(
      'T4a the theme and Performance Mode reach the project workspace',
      p0.theme === 'dark' && p0.dark === true && p0.perf === 'on' && p0.perfAttr === 'on',
      p0
    );

    // ---- T2: project workspace, both directions -------------------------
    check('T2 the project carries both controls', p0.themeCtl && p0.perfCtl, p0);

    await page.evaluate(SET_THEME, 'light');
    await delay(400);
    const p1 = await page.evaluate(PREFS);
    check(
      'T2a a theme flip on the project leaves Performance Mode alone',
      p1.theme === 'light' && p1.dark === false && p1.perf === 'on' && p1.perfAttr === 'on',
      p1
    );

    await page.evaluate(SET_PERF, false);
    await delay(400);
    const p2 = await page.evaluate(PREFS);
    check(
      'T2b a Performance Mode flip on the project leaves the theme alone',
      p2.theme === 'light' && p2.dark === false && p2.perf === 'off' && p2.perfAttr === 'off',
      p2
    );

    // ---- T4b: the pair travels to the app dashboard ---------------------
    await page.goto(BASE + '/app.html', { waitUntil: 'domcontentloaded' });
    await delay(900);
    const a0 = await page.evaluate(PREFS);
    check(
      'T4b the theme and Performance Mode reach the app dashboard',
      a0.theme === 'light' && a0.dark === false && a0.perf === 'off' && a0.perfAttr === 'off',
      a0
    );

    // ---- T3b: dark + perf on, then a reload keeps both ------------------
    await page.evaluate(SET_THEME, 'dark');
    await page.evaluate(SET_PERF, true);
    await delay(400);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await delay(900);
    const a1 = await page.evaluate(PREFS);
    check(
      'T3b both preferences survive an app reload',
      a1.theme === 'dark' && a1.dark === true && a1.perf === 'on' && a1.perfAttr === 'on',
      a1
    );

    // ---- T5: the second tab follows the first ---------------------------
    // The owner keeps a project open while pricing in the calculator, so the
    // realistic reading of "the theme does not reach the app" is TWO TABS in
    // one browser: a preference written in one must reach the other without a
    // reload. `storage` is the only signal a same-origin tab gets.
    const tabA = page;
    await tabA.goto(BASE + '/seed-test.html', { waitUntil: 'load', timeout: 60000 });
    await tabA.waitForFunction(() => window.MMGR && window.MMGR.App, null, { timeout: 60000 });
    await delay(900);
    const tabB = await ctx.newPage();
    await tabB.goto(BASE + '/calculator.html', { waitUntil: 'domcontentloaded' });
    await delay(700);

    // A is dark+perf-on from T3b; flip B to light with perf off.
    await tabB.evaluate(SET_THEME, 'light');
    await tabB.evaluate(SET_PERF, false);
    await delay(900);
    const followTheme = await tabA.evaluate(PREFS);
    check(
      'T5a an open tab follows a theme changed in another tab',
      followTheme.theme === 'light' && followTheme.dark === false,
      followTheme
    );
    check(
      'T5b it also follows Performance Mode, without the theme moving',
      followTheme.perf === 'off' && followTheme.perfAttr === 'off' && followTheme.dark === false,
      followTheme
    );

    await tabA.evaluate(SET_THEME, 'dark');
    await tabB.evaluate(SET_PERF, true);
    await delay(900);
    const followBack = await tabB.evaluate(PREFS);
    check(
      'T5c the calculator follows the project tab in return',
      followBack.theme === 'dark' && followBack.dark === true && followBack.perf === 'on',
      followBack
    );

    check('zero page errors across the walk', errors.length === 0, errors.slice(0, 4));
    await ctx.close();
  } finally {
    await browser.close();
    if (srv) {
      srv.kill();
    }
  }

  console.log('');
  const total = pass + fails.length;
  if (fails.length) {
    console.log('FAIL - ' + pass + '/' + total + ' gates');
    process.exit(1);
  }
  console.log('PASS - ' + pass + '/' + total + ' gates');
})().catch(e => {
  console.error('FATAL', e);
  process.exit(1);
});
