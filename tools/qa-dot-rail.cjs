#!/usr/bin/env node
/* ============================================================
   tools/qa-dot-rail.cjs - LAND-1 (Wave E)
   ------------------------------------------------------------
   REFINEMENT-DIRECTIVE-2026-10-24, section 10.

   The landing dot rail was always visible at full strength, competing with the
   copy it points at. The contract now:
     - at rest every inactive dot is quiet but visible (opacity 0.5 to 0.75)
     - hovering or keyboard-focusing the rail raises the whole column
     - the active dot is ALWAYS solid, so the reader can see their place
     - each dot keeps a hit area of at least 24 x 24 CSS px (WCAG 2.2 target)
     - the hover label is read from the section's own heading, never retyped
     - the rail never overlaps the reading column at 1280, 1100 or 900 px
     - reduced motion removes the transitions, and the active dot is the
       bullion gold, not the old orange token

   Usage:  node tools/qa-dot-rail.cjs
   Registry: docs/CI-TEST-COVERAGE.md -> CI row.
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const BASE = (process.env.QA_BASE || 'http://127.0.0.1:8765').replace(/\/$/, '');
const log = s => process.stdout.write('[dot-rail] ' + s + '\n');
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

(async () => {
  let srv = null;
  try {
    const h = await fetch(BASE + '/index.html');
    if (!h.ok) {
      throw new Error('not ok');
    }
  } catch (e) {
    log('starting serve.cjs for this run');
    srv = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
    for (let i = 0; i < 40; i++) {
      await delay(1000);
      try {
        const h = await fetch(BASE + '/index.html');
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
    for (const width of [1280, 1100, 900]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String((e && e.message) || e).slice(0, 160)));
      await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 60000 });
      await page.waitForFunction(
        () => document.querySelectorAll('.dot-rail-navigation a.dot-item.major').length >= 7,
        null,
        { timeout: 30000 }
      );
      await delay(400);

      const tag = width + 'px';
      const rail = await page.evaluate(() => {
        const nav = document.querySelector('.dot-rail-navigation');
        if (!nav) {
          return { missing: true };
        }
        const cs = getComputedStyle(nav);
        const majors = Array.prototype.slice.call(nav.querySelectorAll('a.dot-item.major'));
        const minors = Array.prototype.slice.call(nav.querySelectorAll('.dot-item.minor'));
        const active = nav.querySelector('.dot-item.active');
        const rest = majors
          .filter(a => !a.classList.contains('active'))
          .map(a => Number(getComputedStyle(a).opacity));
        const label = majors.map(a => ({
          href: a.getAttribute('href'),
          label: a.getAttribute('data-label') || '',
          aria: a.getAttribute('aria-label') || ''
        }));
        const heading = el => {
          const sec = document.getElementById((el.getAttribute('href') || '').slice(1));
          const h = sec ? sec.querySelector('h2') : null;
          return h ? (h.textContent || '').replace(/\s+/g, ' ').trim() : '';
        };
        // Hit area: the transparent ::before is what makes the target bigger
        // than the painted dot. Its computed inset is resolved to px, so the
        // true target box is the link's own box plus those overhangs. (Hit
        // testing cannot answer this in a 22px column: neighbouring dots tile
        // the gap, so a probe just outside one lands on the next.)
        const hits = majors.map(a => {
          const r = a.getBoundingClientRect();
          const cs = getComputedStyle(a, '::before');
          const n = v => Math.abs(parseFloat(v) || 0);
          return {
            href: a.getAttribute('href'),
            w: Math.round(r.width + n(cs.left) + n(cs.right)),
            h: Math.round(r.height + n(cs.top) + n(cs.bottom))
          };
        });
        const navBox = nav.getBoundingClientRect();
        const col = document.querySelector('main .container');
        const colBox = col ? col.getBoundingClientRect() : null;
        return {
          missing: false,
          visible: cs.display !== 'none' && cs.visibility !== 'hidden',
          rest: rest,
          restMax: rest.length ? Math.max.apply(null, rest) : null,
          activeOpacity: active ? Number(getComputedStyle(active).opacity) : null,
          activeBg: active ? getComputedStyle(active.querySelector('.dot')).backgroundColor : null,
          minorsCount: minors.length,
          majorCount: majors.length,
          label: label,
          heading: majors.map(a => ({ href: a.getAttribute('href'), h2: heading(a) })),
          hits: hits,
          navRight: navBox.right,
          colLeft: colBox ? colBox.x : null,
          transition: getComputedStyle(majors[0]).transitionDuration
        };
      }); // Owner rule (AGENTS.md, marketing canvas): the rail is a wide-screen
      // affordance. Below 1200px it is hidden by design, so a narrow window is
      // asserted to have NO rail rather than measured against one.
      if (width < 1200) {
        check(
          'LAND-1 [' + tag + '] the rail is hidden where there is no room (by design)',
          !rail.missing && rail.visible === false,
          rail
        );
        await ctx.close();
        continue;
      }
      check(
        'LAND-1 [' + tag + '] the rail is present and visible',
        !rail.missing && rail.visible,
        rail
      );
      if (!rail.missing) {
        check(
          'LAND-1/UI-2026-10-30 [' +
            tag +
            '] inactive dots are quiet but visible at rest (0.5 <= opacity <= 0.75)',
          rail.restMax !== null && rail.restMax >= 0.5 && rail.restMax <= 0.75,
          rail.rest
        );
        check(
          'LAND-1 [' + tag + '] the active dot stays fully opaque',
          rail.activeOpacity === 1,
          rail.activeOpacity
        );
        check(
          'LAND-1 [' + tag + '] the active dot is bullion, not the old orange',
          /212,\s*175,\s*55/.test(rail.activeBg || ''),
          rail.activeBg
        );
        check(
          'LAND-1 [' + tag + '] every dot keeps a 24 x 24 hit area',
          rail.hits.every(h => h.w >= 24 && h.h >= 24),
          rail.hits.filter(h => !(h.w >= 24 && h.h >= 24))
        );
        check(
          'LAND-1 [' + tag + '] each label is read from its own section heading',
          rail.label.length > 0 &&
            rail.label.every((l, i) => {
              const h2 = rail.heading[i] && rail.heading[i].h2;
              return l.label && (l.label === h2 || (l.label === l.aria && !h2));
            }),
          { labels: rail.label, headings: rail.heading }
        );
        check(
          'LAND-1 [' + tag + '] the rail does not overlap the reading column',
          rail.colLeft === null || rail.navRight <= rail.colLeft,
          { navRight: rail.navRight, colLeft: rail.colLeft }
        );
        check(
          'LAND-1 [' + tag + '] the small dots are still generated',
          rail.minorsCount === 12,
          rail.minorsCount
        ); // Hover raises the column (a REAL pointer move, because CSS :hover is
        // not something a synthetic event can fake).
        await page.hover('.dot-rail-navigation');
        await delay(300);
        const raised = await page.evaluate(() => ({
          hover: Number(
            getComputedStyle(document.querySelector('.dot-rail-navigation .dot-item:not(.active)'))
              .opacity
          )
        }));
        check(
          'LAND-1 [' + tag + '] hovering the rail raises the inactive dots',
          raised.hover > rail.restMax,
          raised
        );
        await page.mouse.move(0, 0);
        await delay(250);

        // Keyboard focus (real Tab presses, so :focus-visible applies) shows
        // the label bubble.
        let focus = { focused: false, after: 0, content: '' };
        for (let i = 0; i < 60 && !focus.focused; i++) {
          await page.keyboard.press('Tab');
          focus = await page.evaluate(() => {
            const el = document.activeElement;
            const isDot = !!(el && el.closest && el.closest('.dot-rail-navigation'));
            if (!isDot) {
              return { focused: false, after: 0, content: '' };
            }
            return {
              focused: true,
              after: -1,
              content: getComputedStyle(el, '::after').content,
              matches: el.matches(':focus-visible')
            };
          });
        }
        if (focus.focused) {
          await delay(300); // let the label's 0.15s fade land
          focus.after = await page.evaluate(() => {
            const el = document.activeElement;
            return Number(getComputedStyle(el, '::after').opacity);
          });
        }
        check(
          'LAND-1 [' + tag + '] keyboard focus shows the label',
          focus.focused && focus.matches === true && focus.after === 1 && /\"/.test(focus.content),
          focus
        );

        check('LAND-1 [' + tag + '] no uncaught page error', errors.length === 0, errors);
      }
      await ctx.close();
    }

    // Reduced motion and Performance Mode remove the transitions.
    for (const mode of ['reduce', 'perf']) {
      const ctx = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        reducedMotion: mode === 'reduce' ? 'reduce' : 'no-preference'
      });
      const page = await ctx.newPage();
      if (mode === 'perf') {
        await page.addInitScript(() => {
          try {
            localStorage.setItem('mmgr_perf_mode', 'on');
          } catch (e) {}
        });
      }
      await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 60000 });
      await page.waitForFunction(
        () => document.querySelectorAll('.dot-rail-navigation a.dot-item.major').length >= 7,
        null,
        { timeout: 30000 }
      );
      const t = await page.evaluate(() => {
        const a = document.querySelector('.dot-rail-navigation a.dot-item.major');
        return getComputedStyle(a).transitionDuration;
      });
      check(
        'LAND-1 [' +
          (mode === 'reduce' ? 'reduced motion' : 'Performance Mode') +
          '] the rail does not animate',
        parseFloat(t) <= 0.01,
        t
      );
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
