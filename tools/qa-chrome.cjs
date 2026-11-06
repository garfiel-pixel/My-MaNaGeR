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
     C5  admin.html's own stylesheet quiets the header's DIRECT .btn
         children (the plan popover's buttons keep their own skin)
     C8  BACK GOES LEFT EVERYWHERE (5.5 A4): the back/dashboard control
         is the FIRST control in the header on admin, project and
         calculator; app.html carries no header because it IS the root

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
  { page: 'seed-test.html', sel: '.nav-btn', label: 'project menu control' },
  // OWNER 2026-11-01: the top-bar icons (notices, collaborators, settings) are
  // bare at rest and grow their ring only on hover or focus.
  { page: 'seed-test.html', sel: '.settings-btn', label: 'top-bar icon control' }
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

  // C6 (owner 2026-11-01): the completion ring grew to 120px WITHOUT getting
  // thicker. The SVG keeps its 96-unit viewBox and r=39 (circumference 245,
  // which js/mmgr-render.js depends on), so the scale factor is 1.25 and the
  // painted stroke must stay 18: 14.4 x 1.25. This arm pins all four numbers
  // together, so the next person to touch one of them is told what breaks.
  const pring = (css.match(/\.pring\s*\{[^}]*\}/) || [''])[0];
  const ringStroke = (css.match(/\.ring-fill\s*\{[^}]*stroke-width:\s*([\d.]+)/) || [])[1];
  const projHtml = fs.readFileSync(path.join(ROOT, 'project.html'), 'utf8');
  // Scoped to the ring's OWN svg: project.html carries a 24-unit icon sprite
  // earlier in the document, and a loose match read that one instead.
  const viewBox = /class="pring">[\s\S]{0,400}?viewBox="0 0 (\d+) \1"/.exec(projHtml);
  const boxPx = Number((pring.match(/width:\s*(\d+)px/) || [])[1] || 0);
  const apparent = viewBox ? Number(ringStroke || 0) * (boxPx / Number(viewBox[1])) : 0;
  check(
    'C6 the completion ring is bigger at the same stroke weight',
    boxPx >= 112 && viewBox !== null && /r="39"/.test(projHtml) && Math.abs(apparent - 18) < 0.6,
    { box: boxPx, viewBox: viewBox && viewBox[1], stroke: ringStroke, apparent: apparent }
  );

  // C7 (owner 2026-11-01): "you do not need a rectangle around the X, and you
  // do not need a pill around Add area." The calculator's PER-ROW remove and
  // edit controls are bare glyphs (.bcp-x / .bcp-link); the crowded card-head
  // action groups keep their boxes. Both arms read source, so a regenerated
  // bundle can't hide a reintroduced pill.
  const calcHtml = fs.readFileSync(path.join(ROOT, 'calculator.html'), 'utf8');
  const calcJs = fs.readFileSync(path.join(ROOT, 'js', 'calculator-page.js'), 'utf8');
  const boxedRowAction = (src, action) =>
    new RegExp('class="btn btn-n btn-s[^"]*"[^>]*data-action="' + action + '"').test(src) ||
    new RegExp('data-action="' + action + '"[^>]*class="btn btn-n btn-s').test(src);
  const boxed = [
    'calcInstDel',
    'calcOpenDel',
    'calcBoqRemove',
    'calcBoqRecall',
    'calcAccDel'
  ].filter(a => boxedRowAction(calcJs, a));
  check('C7 calculator row remove/edit controls carry no box', boxed.length === 0, boxed);
  const xRule = (css.match(/\.bcp-x\s*\{[^}]*\}/) || [''])[0];
  const linkRule = (css.match(/\.bcp-link\s*\{[^}]*\}/) || [''])[0];
  // border / fill live in the shared base rule both classes open with.
  const bareBase = (css.match(/\.bcp-x,\s*\.bcp-link\s*\{[^}]*\}/) || [''])[0];
  check(
    'C7 .bcp-x and .bcp-link are borderless with no fill',
    xRule !== '' &&
      linkRule !== '' &&
      /border:\s*0;/.test(bareBase) &&
      /background:\s*none;/.test(bareBase) &&
      !/border-radius:\s*999px/.test(xRule + linkRule) &&
      /class="bcp-link" data-action="calcClearHistory">\s*<svg class="ico"/.test(
        calcHtml.replace(/\s+/g, ' ')
      )
  );

  const admin = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  // RE-BASELINE 2026-11-06 (owner plan control): the quiet rule is now
  // DIRECT-CHILD only. The header carries the account's plan badge, whose
  // popover holds a real Manage subscription button; the old descendant
  // selector stripped that button's surface, so "text, not pills" now means
  // "the header's own buttons", and the nested popover keeps its own skin.
  // The intent of C5 is unchanged and still asserted: header actions are
  // text, and the popover is proven NOT to inherit the reset.
  check(
    'C5 the admin header actions are text, not pills',
    /\.hdr-actions > \.btn\{background:transparent;border:0;/.test(admin) &&
      /\.hdr-actions > \.btn:hover\{color:var\(--gold-text\)/.test(admin) &&
      !/\.hdr-actions \.btn\{/.test(admin),
    'admin.html inline style'
  );

  /* C8 (5.5 A4, owner 2026-11-01): BACK GOES LEFT EVERYWHERE. The back /
     dashboard control must be the FIRST control inside the header on every
     shell. Measured from the source with comments stripped, because admin's
     header sits behind a password and project.html redirects to the unlock
     screen without a project id - markup order IS DOM order for these rows
     (no flex `order` touches them). app.html carries NO header: it IS the
     dashboard root, and asserting that means a future header there has to
     make the back-first decision consciously instead of by accident. */
  const headerInfo = file => {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/<!--[\s\S]*?-->/g, ' ');
    const m = src.match(/<header\b[\s\S]*?<\/header>/i);
    if (!m) return { hasHeader: false };
    const first = m[0].match(/<(a|button|input|select|textarea)\b[^>]*>/i);
    return {
      hasHeader: true,
      first: first ? first[0].slice(0, 160) : null,
      ok: first ? /class="[^"]*\b(hdr-back|bcp-back)\b/.test(first[0]) : false
    };
  };
  for (const f of ['admin.html', 'project.html', 'calculator.html']) {
    const info = headerInfo(f);
    check(
      'C8 ' + f + ' has the back control as the FIRST header control',
      !!(info.hasHeader && info.ok),
      info
    );
  }
  const appInfo = headerInfo('app.html');
  check(
    'C8 app.html carries no header bar (it IS the dashboard root)',
    appInfo.hasHeader === false,
    appInfo
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
