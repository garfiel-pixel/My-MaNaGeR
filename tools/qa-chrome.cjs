#!/usr/bin/env node
/* ============================================================
   tools/qa-chrome.cjs - quiet chrome gate (owner audit 2026-10-31)
   ------------------------------------------------------------
   The owner's walk named the same defect five times: controls that
   are really text or an icon arrive inside a box - a 999px pill, a
   bordered rectangle, a filled chip. This gate pins the fix.

   For every named control it proves, in a real browser, at 390 and
   1280, in both themes:

     C1  AT REST there is no box: border-width 0, background fully
         transparent, corner radius <= 8px
     C2  ON HOVER a highlight appears (a non-zero background tint), so
         the control is still discoverable without resting chrome
     C3  the stylesheet carries a :focus-visible rule for the control,
         so removing the box did not remove the keyboard affordance

   Plus static arms for the admin header, which sits behind a
   password and cannot be walked here:

     C4  .escrow-badge is a notifier line: no border, no pill radius,
         and a dot drawn by ::before with a state colour
     C5  admin.html's own stylesheet quiets .hdr-actions .btn

   Usage:  node tools/qa-chrome.cjs
   Registry: docs/CI-TEST-COVERAGE.md -> CI row (browser-calc).
   ============================================================ */
'use strict';
const fs = require('fs');
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
        (detail === undefined ? '' : '  <-- ' + JSON.stringify(detail).slice(0, 500))
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

// The controls the owner named, on the pages a person actually sees them.
const CONTROLS = [
  { page: 'calculator.html', sel: '.bcp-back', label: 'calculator back arrow' },
  { page: 'calculator.html', sel: '.bcp-theme', label: 'theme (moon) button' },
  { page: 'calculator.html', sel: '.bcp-perf', label: 'Performance Mode switch' },
  { page: 'seed-test.html', sel: '.hdr-back', label: 'project back link' },
  { page: 'seed-test.html', sel: '.nav-btn', label: 'project menu control' }
];

// Returns the parsed computed style we gate on, plus whether the CSSOM has a
// focus-visible rule that names this selector.
const PROBE = sel => {
  const el = document.querySelector(sel);
  if (!el) {
    return null;
  }
  const cs = getComputedStyle(el);
  const alpha = s => {
    if (!s || s === 'transparent') {
      return 0;
    }
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (!m) {
      return 1;
    }
    const parts = m[1].split(',').map(x => x.trim());
    return parts.length > 3 ? Number(parts[3]) : 1;
  };
  let focusRule = false;
  const wanted = sel.replace(/^\./, '');
  for (const sheet of Array.from(document.styleSheets)) {
    let rules = [];
    try {
      rules = Array.from(sheet.cssRules || []);
    } catch (e) {
      continue;
    }
    const walk = list => {
      Array.from(list).forEach(r => {
        // Check the selector BEFORE recursing: a modern CSSStyleRule exposes an
        // empty (but truthy) cssRules list for nesting, and testing it first
        // skipped every plain rule - the gate reported "no focus rule" for 98
        // rules that exist.
        if (r.selectorText) {
          const t = r.selectorText;
          if (t.indexOf(':focus-visible') > -1 && t.indexOf(wanted) > -1) {
            focusRule = true;
          }
        }
        if (r.cssRules && r.cssRules.length) {
          walk(r.cssRules);
        }
      });
    };
    walk(rules);
  }
  return {
    borderTop: cs.borderTopWidth,
    borderLeft: cs.borderLeftWidth,
    radius: parseFloat(cs.borderTopLeftRadius) || 0,
    bgAlpha: alpha(cs.backgroundColor),
    focusRule
  };
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
    for (const theme of ['light', 'dark']) {
      for (const width of [390, 1280]) {
        const ctx = await browser.newContext({ viewport: { width: width, height: 900 } });
        await ctx.addInitScript(t => {
          try {
            localStorage.setItem('mmgr_theme', t);
          } catch (e) {
            /* storage is a preference */
          }
        }, theme);
        const page = await ctx.newPage();

        for (const pagePath of Array.from(new Set(CONTROLS.map(c => c.page)))) {
          await page.goto(BASE + '/' + pagePath, { waitUntil: 'domcontentloaded', timeout: 60000 });
          await delay(600);

          for (const c of CONTROLS.filter(x => x.page === pagePath)) {
            const tag = c.label + ' (' + theme + ' ' + width + ')';
            const found = await page
              .waitForSelector(c.sel, { state: 'attached', timeout: 30000 })
              .then(() => true)
              .catch(() => false);
            check('C0 ' + tag + ' exists on the page', found, c.sel);
            if (!found) {
              continue;
            }
            const rest = await page.evaluate(PROBE, c.sel);
            check(
              'C1 ' + tag + ' has no box at rest',
              rest &&
                rest.borderTop === '0px' &&
                rest.borderLeft === '0px' &&
                rest.radius <= 8 &&
                rest.bgAlpha === 0,
              rest
            );

            await page.hover(c.sel, { timeout: 5000 }).catch(() => {});
            await delay(250);
            const hover = await page.evaluate(PROBE, c.sel);
            check('C2 ' + tag + ' shows a highlight on hover', hover && hover.bgAlpha > 0, hover);

            check(
              'C3 ' + tag + ' keeps a focus-visible rule',
              rest && rest.focusRule === true,
              rest
            );
            // Move the pointer away so the next control starts at rest.
            await page.mouse.move(0, 0);
            await delay(120);
          }
        }
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    if (srv) {
      srv.kill();
    }
  }

  // ---- Static arms -------------------------------------------------------
  const css = fs.readFileSync(path.join(ROOT, 'css', 'mmgr.css'), 'utf8');
  const badge = (css.match(/\.escrow-badge\s*\{[^}]*\}/) || [''])[0];
  check(
    'C4 the backup state is a notifier line, not a pill',
    badge &&
      /border:\s*0;/.test(badge) &&
      !/border-radius:\s*999px/.test(badge) &&
      /\.escrow-badge::before\s*\{[^}]*border-radius:\s*50%/.test(css) &&
      /\.escrow-badge\.off::before\{[^}]*background:\s*var\(--dot-red\)/.test(
        css.replace(/\s+/g, '')
      ),
    badge.slice(0, 260)
  );

  const admin = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  check(
    'C5 the admin header actions are text, not pills',
    /\.hdr-actions \.btn\{background:transparent;border:0;/.test(admin) &&
      /\.hdr-actions \.btn:hover\{color:var\(--gold-text\)/.test(admin),
    'admin.html inline style'
  );

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
