#!/usr/bin/env node
/* ============================================================
   tools/qa-fixed-containment.cjs
   GATE: a position:fixed element never sits inside a containing block
   ------------------------------------------------------------
   WHY THIS EXISTS (UI-CI-DIRECTIVE section 3, D-3)
   `contain: layout` or `contain: paint` on an ancestor turns that ancestor
   into the containing block for every position:fixed descendant, and paint
   also clips it. `.card` carries `contain: layout paint` (css/mmgr.css), so a
   fixed popup mounted inside a card was drawn offset by the card's own
   position and could not paint over the card edge. The calculator listbox
   hit exactly that; the fix portals it to <body>.

   This gate makes the rule permanent and general, not listbox-specific. On
   every page it loads, it walks each RENDERED position:fixed element and
   climbs its ancestors. An ancestor breaks fixed positioning when it has:

     contain: layout | paint | strict | content
     transform: anything but none
     filter: anything but none
     backdrop-filter: anything but none
     perspective: anything but none
     container-type: anything but normal
     will-change: naming any of the above

   Any offender not listed in tools/fixed-containment-allow.json fails the
   gate. The allowlist carries only offenders proven intentional, each with a
   one-line reason - never a blanket page entry.

   Pages: calculator.html (both trade lists open, one at a time),
   project.html (seed-test unlock, then the AI window open), app.html.

   Usage:  node tools/qa-fixed-containment.cjs
   Registry: docs/CI-TEST-COVERAGE.md -> CI row (browser-app group).
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const BASE = (process.env.QA_BASE || 'http://127.0.0.1:8765').replace(/\/$/, '');
const ALLOW_FILE = path.join(__dirname, 'fixed-containment-allow.json');
const log = s => process.stdout.write('[fixed-containment] ' + s + '\n');
const delay = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok });
  log(
    (ok ? 'PASS' : 'FAIL') +
      '  ' +
      name +
      (ok ? '' : '  <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 6000))
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

/* Runs INSIDE the page. Returns every fixed element whose containing block or
   paint area an ancestor has taken over. Kept dependency-free and literal so
   Playwright can serialise it. */
function scanFixed() {
  const label = el => {
    let s = el.tagName.toLowerCase();
    if (el.id) {
      s += '#' + el.id;
    }
    const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 3);
    if (cls.length) {
      s += '.' + cls.join('.');
    }
    return s;
  };
  const out = [];
  const all = document.querySelectorAll('body *');
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed') {
      continue;
    }
    // A hidden element is not painted, so it cannot be clipped or offset yet.
    if (el.getClientRects().length === 0) {
      continue;
    }
    let a = el.parentElement;
    while (a && a !== document.documentElement) {
      const acs = getComputedStyle(a);
      const hits = [];
      if (/\b(layout|paint|strict|content)\b/.test(acs.contain)) {
        hits.push(['contain', acs.contain]);
      }
      if (acs.transform && acs.transform !== 'none') {
        hits.push(['transform', acs.transform]);
      }
      if (acs.filter && acs.filter !== 'none') {
        hits.push(['filter', acs.filter]);
      }
      const bf = acs.backdropFilter || acs.webkitBackdropFilter;
      if (bf && bf !== 'none') {
        hits.push(['backdrop-filter', bf]);
      }
      if (acs.perspective && acs.perspective !== 'none') {
        hits.push(['perspective', acs.perspective]);
      }
      if (acs.containerType && acs.containerType !== 'normal') {
        hits.push(['container-type', acs.containerType]);
      }
      const wc = acs.willChange || '';
      if (/(transform|filter|backdrop-filter|perspective|contain|container-type)/.test(wc)) {
        hits.push(['will-change', wc]);
      }
      for (let h = 0; h < hits.length; h++) {
        out.push({
          element: label(el),
          ancestor: label(a),
          property: hits[h][0],
          value: hits[h][1]
        });
      }
      a = a.parentElement;
    }
  }
  return out;
}

(async () => {
  let srv = null;
  let allow = { allow: [] };
  try {
    allow = JSON.parse(fs.readFileSync(ALLOW_FILE, 'utf8'));
  } catch (e) {
    check(
      'tools/fixed-containment-allow.json is readable JSON',
      false,
      String((e && e.message) || e)
    );
  }
  const allowed = Array.isArray(allow.allow) ? allow.allow : [];

  if (!process.env.QA_BASE) {
    let up = false;
    try {
      up = (await fetch(BASE + '/calculator.html')).ok;
    } catch (e) {}
    if (!up) {
      log('starting serve.cjs for this run');
      srv = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
      for (let i = 0; i < 30; i++) {
        await delay(1000);
        try {
          if ((await fetch(BASE + '/calculator.html')).ok) {
            break;
          }
        } catch (e) {}
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

  /* One scan = one page state. Fails on any offender the allowlist does not
     name (element + ancestor + property). */
  const scan = async (page, label) => {
    const offenders = await page.evaluate(scanFixed);
    const unlisted = offenders.filter(
      o =>
        !allowed.some(
          a =>
            a &&
            a.element === o.element &&
            a.ancestor === o.ancestor &&
            a.property === o.property &&
            typeof a.reason === 'string' &&
            a.reason.length > 0
        )
    );
    check(
      label + ': no fixed element sits in a containment, transform or filter ancestor',
      unlisted.length === 0,
      { offenders: unlisted.slice(0, 20), total: unlisted.length }
    );
    if (offenders.length && unlisted.length === 0) {
      log(
        '  allowed: ' +
          offenders.map(o => o.element + ' in ' + o.ancestor + ' (' + o.property + ')').join('; ')
      );
    }
    return offenders.length;
  };

  try {
    // ---- calculator.html: the listbox portal, both lists ----
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String((e && e.message) || e).slice(0, 200)));
      await page.goto(BASE + '/calculator.html', { waitUntil: 'load', timeout: 60000 });
      await page.waitForSelector('.mmcb[data-for="calc-work"] .mmcb-input', { timeout: 30000 });

      await page.click('.mmcb[data-for="calc-work"] .mmcb-input');
      await page.waitForSelector('.mmcb-pop[data-for="calc-work"]:not([hidden])', {
        timeout: 8000
      });
      await scan(page, 'calculator.html with the Type of work list open');

      await page.keyboard.press('Escape');
      await page.click('.mmcb[data-for="calc-family"] .mmcb-input');
      await page.waitForSelector('.mmcb-pop[data-for="calc-family"]:not([hidden])', {
        timeout: 8000
      });
      await scan(page, 'calculator.html with the Work item list open');
      check('calculator.html: no uncaught page error', errors.length === 0, errors);
      await ctx.close();
    }

    // ---- project.html: unlocked workspace with the AI window open ----
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String((e && e.message) || e).slice(0, 200)));
      // The assistant is part of the signed-in experience. Install the documented
      // QA seam (qa-ai-win.cjs and qa-ai.cjs use the same one) so the window can
      // open here; the signed-out refusal belongs to its own gate.
      await page.addInitScript(() => {
        let tries = 0;
        const iv = setInterval(() => {
          if (window.MMGR && window.MMGR.Entitlements) {
            window.MMGR.Entitlements.aiAssistant = function () {
              return true;
            };
            clearInterval(iv);
          }
          if (++tries > 400) {
            clearInterval(iv);
          }
        }, 25);
      });
      await page.goto(BASE + '/seed-test.html', { waitUntil: 'load', timeout: 60000 });
      await page.waitForFunction(
        () => /\/project(\.html)?$/.test(location.pathname) && window.MMGR && window.MMGR.App,
        null,
        { timeout: 60000 }
      );
      await delay(600);
      await page.evaluate(() => {
        const fab = document.getElementById('ai-fab');
        if (fab) {
          fab.click();
        }
      });
      let aiOpen = false;
      try {
        await page.waitForFunction(
          () => {
            const win = document.getElementById('ai-win');
            return !!win && win.classList.contains('open') && win.getClientRects().length > 0;
          },
          null,
          { timeout: 8000 }
        );
        aiOpen = true;
      } catch (e) {
        aiOpen = false;
      }
      await delay(500);
      check('project.html: the AI window really opened for the scan', aiOpen, aiOpen);
      await scan(page, 'project.html with the AI window open');
      check('project.html: no uncaught page error', errors.length === 0, errors);
      await ctx.close();
    }

    // ---- app.html: the launcher shell ----
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String((e && e.message) || e).slice(0, 200)));
      await page.goto(BASE + '/app.html', { waitUntil: 'load', timeout: 60000 });
      await delay(800);
      await scan(page, 'app.html');
      check('app.html: no uncaught page error', errors.length === 0, errors);
      await ctx.close();
    }
  } catch (e) {
    check('harness ran without throwing', false, String((e && e.stack) || e));
  } finally {
    try {
      await browser.close();
    } catch (e) {
      /* closed */
    }
    if (srv) {
      try {
        srv.kill();
      } catch (e) {
        /* gone */
      }
    }
  }

  const failed = results.filter(r => !r.ok);
  log('');
  log(
    (failed.length ? 'FAIL' : 'PASS') +
      ' - ' +
      (results.length - failed.length) +
      '/' +
      results.length +
      ' gates'
  );
  process.exit(failed.length ? 1 : 0);
})();
