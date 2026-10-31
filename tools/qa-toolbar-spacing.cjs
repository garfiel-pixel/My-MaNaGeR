#!/usr/bin/env node
/* ============================================================
   tools/qa-toolbar-spacing.cjs - density and dot gate (owner 2026-10-31)
   ------------------------------------------------------------
   Two defects the owner pointed at on a screenshot:

     T1  TOOLBAR SPACING. Save / Upload / Auto-Fill / Print sat in one
         bare wrapper with no gap, so they read as a single welded strip
         ("kissing buttons"). Every card-head button row must now keep at
         least 8px between adjacent controls, at 390, 768 and 1280.

     T2  DOT STATES. "At risk / N days over" was a bordered 100px pill.
         The schedule state and the backup state are notifier DOTS now:
         no border, no fill, radius <= 8, and an ::before dot of 8px.

   Measured in a real browser, on the unlocked project workspace, because
   the rule is a layout contract, not a string in a stylesheet.

   Usage:  node tools/qa-toolbar-spacing.cjs
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
    const h = await fetch(BASE + '/project.html');
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
      const h = await fetch(BASE + '/project.html');
      if (h.ok) {
        return srv;
      }
    } catch (e) {
      /* keep waiting */
    }
  }
  throw new Error('serve.cjs did not come up');
}

// Smallest horizontal gap between any two adjacent buttons in every card-head
// row, measured from real boxes (not from the declared CSS).
const SPACING = () => {
  const rows = Array.from(document.querySelectorAll('.card-title > div')).filter(
    d => d.querySelectorAll(':scope > .btn').length >= 2
  );
  const out = [];
  rows.forEach(row => {
    const btns = Array.from(row.querySelectorAll(':scope > .btn')).filter(b => b.offsetParent);
    for (let i = 1; i < btns.length; i++) {
      const a = btns[i - 1].getBoundingClientRect();
      const b = btns[i].getBoundingClientRect();
      // Same visual row only: a wrapped button is not a spacing failure.
      if (Math.abs(a.top - b.top) > 4) {
        continue;
      }
      out.push({
        row: ((row.parentElement && row.parentElement.textContent) || '').trim().slice(0, 32),
        gap: Math.round((b.left - a.right) * 10) / 10
      });
    }
  });
  return out;
};

const DOTS = () => {
  const read = sel => {
    const el = document.querySelector(sel);
    if (!el) {
      return null;
    }
    // The state classes are what the renderer sets; force one so a project
    // with no overrun still measures the styled state.
    el.classList.add('on');
    if (sel === '.timeline-ind') {
      el.classList.add('ti-ba');
    }
    const cs = getComputedStyle(el);
    const dot = getComputedStyle(el, '::before');
    const bg = cs.backgroundColor;
    return {
      border: cs.borderTopWidth,
      radius: parseFloat(cs.borderTopLeftRadius) || 0,
      bg: bg,
      dotW: parseFloat(dot.width) || 0,
      dotH: parseFloat(dot.height) || 0,
      dotRadius: parseFloat(dot.borderTopLeftRadius) || 0
    };
  };
  return { timeline: read('.timeline-ind'), dirty: read('.dirty-ind') };
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
    for (const width of [390, 768, 1280]) {
      const ctx = await browser.newContext({ viewport: { width: width, height: 1000 } });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String((e && e.message) || e).slice(0, 160)));
      await page.goto(BASE + '/seed-test.html', { waitUntil: 'load', timeout: 60000 });
      await page.waitForFunction(() => window.MMGR && window.MMGR.App, null, { timeout: 60000 });
      await delay(900);

      const rows = await page.evaluate(SPACING);
      const tight = rows.filter(r => r.gap < 8);
      check(
        'T1 every card-head button row keeps an 8px gap (' + width + ')',
        rows.length > 0 && tight.length === 0,
        { rows: rows.length, tight: tight.slice(0, 6) }
      );

      const dots = await page.evaluate(DOTS);
      ['timeline', 'dirty'].forEach(k => {
        const d = dots[k];
        check(
          'T2 ' +
            (k === 'timeline' ? 'schedule' : 'backup') +
            ' state is a dot, not a pill (' +
            width +
            ')',
          d &&
            d.border === '0px' &&
            d.radius <= 8 &&
            d.bg === 'rgba(0, 0, 0, 0)' &&
            Math.round(d.dotW) === 8 &&
            Math.round(d.dotH) === 8 &&
            d.dotRadius >= 50,
          d
        );
      });

      check('zero page errors (' + width + ')', errors.length === 0, errors.slice(0, 3));
      await ctx.close();
    }
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
