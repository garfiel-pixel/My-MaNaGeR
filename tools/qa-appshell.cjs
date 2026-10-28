#!/usr/bin/env node
/* ============================================================
   tools/qa-appshell.cjs - APP-1 (closed rail) + APP-2 (one session, one tab)
   ------------------------------------------------------------
   REFINEMENT-DIRECTIVE-2026-10-24, Wave D.

   APP-1. The collapsed sidebar used to FLOAT over the page: `.sidebar-icons`
   was position:fixed at the left edge and nothing reserved room for it, so the
   first column of cards and the first form field sat underneath it. The fix
   takes the rail's width out of the content column on wide screens and moves
   the strip to the bottom edge where there is no side room.

   This gate measures, in a real browser, at 1280 / 1024 / 900 / 768 / 390 px,
   light and dark, with the rail CLOSED:
     - the strip's bounding box must not intersect the first content card, the
       first visible form field, or the page's header link row
     - wide screens: the content column starts at or right of the strip
     - 769-1023: the strip sits along the BOTTOM edge and the page keeps a
       matching bottom padding (no content hidden behind it)
     - narrow screens: the strip is not rendered at all
     - no horizontal overflow at any of those widths

   APP-2. "Seven tabs open for one session." The walk clicks real links:
   dashboard -> project -> dashboard -> calculator -> dashboard and asserts the
   browser never has more than ONE page open. It also reads the DOM contracts:
   no core page carries target="_blank" except the explicit "open in new tab"
   popout, and the admin Dashboard link is a plain same-tab link.

   Usage:  node tools/qa-appshell.cjs
   Registry: docs/CI-TEST-COVERAGE.md -> CI row.
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const BASE = (process.env.QA_BASE || 'http://127.0.0.1:8765').replace(/\/$/, '');
const log = s => process.stdout.write('[appshell] ' + s + '\n');
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

// Overlap test on axis-aligned boxes, with a 1px tolerance so a hairline
// border sharing an edge is not reported as an overlap.
function overlaps(a, b) {
  if (!a || !b) {
    return false;
  }
  const dx = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const dy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return dx > 1 && dy > 1;
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
    // ------------------------------------------------------------------
    // APP-1: the closed rail never sits on the page.
    // ------------------------------------------------------------------
    const WIDTHS = [1280, 1024, 900, 768, 390];
    for (const width of WIDTHS) {
      for (const theme of ['light', 'dark']) {
        const ctx = await browser.newContext({ viewport: { width, height: 900 } });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(String((e && e.message) || e).slice(0, 160)));
        await page.addInitScript(t => {
          try {
            localStorage.setItem('mmgr_theme', t);
          } catch (e) {}
        }, theme);

        // Seed the demo project first, exactly as the other harnesses do, so
        // the dashboard paints real cards instead of an empty state.
        await page.goto(BASE + '/seed-test.html', { waitUntil: 'domcontentloaded' });
        await delay(300);
        await page.goto(BASE + '/app.html', { waitUntil: 'load', timeout: 60000 });
        await page.waitForFunction(() => !!document.querySelector('.sidebar-icons'), null, {
          timeout: 30000
        });
        await delay(400);

        // Close the rail through the real hamburger (pinned open by default).
        await page.evaluate(() => {
          if (document.body.classList.contains('side-open')) {
            const btn = document.querySelector('[data-action="toggleSidebar"]');
            if (btn) {
              btn.click();
            }
          }
        });
        await delay(450);

        const m = await page.evaluate(() => {
          function box(el) {
            if (!el) {
              return null;
            }
            const r = el.getBoundingClientRect();
            if (!r.width && !r.height) {
              return null;
            }
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) {
              return null;
            }
            return { x: r.x, y: r.y, width: r.width, height: r.height };
          }
          const strip = document.getElementById('sidebar-icons');
          const wrap = document.querySelector('.wrap');
          const cands = [];
          const card = document.querySelector('.wrap .card, .wrap .db-card, .wrap .proj-card');
          if (card) {
            cands.push({ what: 'first card', box: box(card) });
          }
          const field = Array.prototype.slice
            .call(document.querySelectorAll('.wrap input, .wrap select, .wrap textarea'))
            .filter(el => !el.closest('#sidebar-icons'))
            .map(el => ({ what: 'field ' + (el.id || el.type), box: box(el) }))
            .filter(x => x.box)[0];
          if (field) {
            cands.push(field);
          }
          const link = Array.prototype.slice
            .call(document.querySelectorAll('.wrap a, .wrap button'))
            .filter(el => !el.closest('#sidebar-icons') && !el.closest('.db-side'))
            .map(el => ({ what: 'control ' + (el.className || el.tagName), box: box(el) }))
            .filter(x => x.box)[0];
          if (link) {
            cands.push(link);
          }
          const wrapBox = box(wrap);
          const cs = wrap ? getComputedStyle(wrap) : null;
          return {
            closed: document.body.classList.contains('side-closed'),
            strip: box(strip),
            stripPos: strip ? getComputedStyle(strip).position : null,
            stripFlex: strip ? getComputedStyle(strip).flexDirection : null,
            wrap: wrapBox,
            wrapLeft: wrapBox ? wrapBox.x : null,
            wrapPadBottom: cs ? parseFloat(cs.paddingBottom) : 0,
            cands: cands,
            scrollW: document.documentElement.scrollWidth,
            innerW: window.innerWidth,
            vh: window.innerHeight
          };
        });

        const tag = width + 'px ' + theme;
        // The closed strip is a desktop affordance: below 769px the rail is a
        // drawer and the strip is not rendered at all, so `side-closed` is
        // never set there (app.html sets it only when the viewport is wide).
        check(
          'APP-1 [' + tag + '] the rail is in its closed state',
          width >= 769 ? m.closed === true : m.closed === false,
          { closed: m.closed, width }
        );

        if (width >= 769) {
          const hits = m.cands.filter(c => overlaps(m.strip, c.box));
          check(
            'APP-1 [' + tag + '] nothing on the page sits under the icon strip',
            !!m.strip && hits.length === 0,
            { strip: m.strip, hits: hits.map(h => h.what) }
          );
        } else {
          check('APP-1 [' + tag + '] no side strip is drawn on a phone', m.strip === null, m.strip);
        }

        if (width >= 1024) {
          check(
            'APP-1 [' + tag + '] the content column starts at or right of the reserved gutter',
            m.strip && m.wrapLeft !== null && m.wrapLeft >= m.strip.x + m.strip.width - 1,
            { strip: m.strip, wrapLeft: m.wrapLeft }
          );
        } else if (width >= 769) {
          check(
            'APP-1 [' + tag + '] the strip moves to the bottom edge and the page pads for it',
            !!m.strip && m.strip.y > m.vh / 2 && m.stripFlex === 'row' && m.wrapPadBottom >= 60,
            { strip: m.strip, flex: m.stripFlex, pad: m.wrapPadBottom, vh: m.vh }
          );
        }

        check(
          'APP-1 [' + tag + '] the page does not overflow sideways',
          m.scrollW <= m.innerW + 1,
          { scrollW: m.scrollW, innerW: m.innerW }
        );
        check('APP-1 [' + tag + '] no uncaught page error', errors.length === 0, errors);

        // The project page: its closed rail slides off-canvas, so there is no
        // strip to reserve a gutter for - assert that, so a future fixed rail
        // there cannot reintroduce the overlap unnoticed.
        await page.goto(BASE + '/project.html?id=demo-project', {
          waitUntil: 'load',
          timeout: 60000
        });
        await page.waitForFunction(() => !!(window.MMGR && window.MMGR.App), null, {
          timeout: 45000
        });
        await delay(500);
        // project.html pins its rail OPEN on desktop (mmgr-app.js adds
        // body.sidebar-open at boot). Close it through the real rail-head
        // control so the CLOSED state is what gets measured.
        await page.evaluate(() => {
          if (document.body.classList.contains('sidebar-open')) {
            const btn = document.querySelector('[data-action="tglSidebarOpen"]');
            if (btn) {
              btn.click();
            }
          }
        });
        await delay(450);
        const readRail = () =>
          page.evaluate(() => {
            function vis(el) {
              if (!el) {
                return null;
              }
              const r = el.getBoundingClientRect();
              if (!r.width && !r.height) {
                return null;
              }
              const cs = getComputedStyle(el);
              if (
                cs.display === 'none' ||
                cs.visibility === 'hidden' ||
                Number(cs.opacity) < 0.05
              ) {
                return null;
              }
              return { x: r.x, y: r.y, width: r.width, height: r.height };
            }
            const sb = document.getElementById('app-sidebar');
            const main =
              document.getElementById('app-main') || document.querySelector('.main, .wrap');
            const mr = main ? main.getBoundingClientRect() : null;
            // A real piece of the page, not the column itself: if the closed
            // rail were floating over content, this is what it would cover.
            const probe = main
              ? vis(
                  main.querySelector(
                    '.card, .panel, .gv-wrap, button, input, select, a, table, canvas'
                  )
                )
              : null;
            return {
              missing: !sb,
              open: document.body.classList.contains('sidebar-open'),
              railBox: sb
                ? (() => {
                    const r = sb.getBoundingClientRect();
                    return { x: r.x, y: r.y, width: r.width, height: r.height };
                  })()
                : null,
              right: sb ? sb.getBoundingClientRect().right : null,
              width: sb ? sb.getBoundingClientRect().width : null,
              visibility: sb ? getComputedStyle(sb).visibility : null,
              position: sb ? getComputedStyle(sb).position : null,
              mainLeft: mr ? mr.x : null,
              probe: probe,
              scrollW: document.documentElement.scrollWidth,
              clientW: document.documentElement.clientWidth
            };
          });

        const pjClosed = await readRail();
        check(
          'APP-1 [' + tag + '] the project page keeps its closed rail off-canvas and invisible',
          !pjClosed.missing &&
            pjClosed.open === false &&
            pjClosed.right <= 1 &&
            pjClosed.visibility === 'hidden' &&
            pjClosed.position === 'fixed',
          pjClosed
        );
        check(
          'APP-1 [' +
            tag +
            '] no content sits under the project page closed rail, and the column starts at 0',
          !overlaps(pjClosed.railBox, pjClosed.probe) &&
            pjClosed.mainLeft !== null &&
            pjClosed.mainLeft <= 1 &&
            pjClosed.scrollW <= pjClosed.clientW + 1,
          { railBox: pjClosed.railBox, probe: pjClosed.probe, mainLeft: pjClosed.mainLeft }
        );

        // And the OPEN state is the other half of the claim: the rail becomes a
        // real column and the page moves over for it, so the two never overlap.
        // DESKTOP ONLY: at 768 and below the rail is the off-canvas drawer and
        // `sidebar-open` does not open it (the drawer is `body.nav-open`), so
        // that state belongs to the drawer arms above, not to this claim.
        if (width > 768) {
          await page.evaluate(() => {
            const btn = document.querySelector('[data-action="tglSidebarOpen"]');
            if (btn) {
              btn.click();
            }
          });
          await delay(500);
          const pjOpen = await readRail();
          check(
            'APP-1 [' +
              tag +
              '] opening the project rail moves the column over instead of covering it',
            pjOpen.open === true &&
              pjOpen.visibility === 'visible' &&
              pjOpen.right > 100 &&
              pjOpen.mainLeft >= 200 &&
              !overlaps(pjOpen.railBox, pjOpen.probe),
            pjOpen
          );
        }

        await ctx.close();
      }
    }

    // ------------------------------------------------------------------
    // APP-2: one session, one tab.
    // ------------------------------------------------------------------
    {
      const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String((e && e.message) || e).slice(0, 160)));
      const pages = () => ctx.pages().length;

      await page.goto(BASE + '/seed-test.html', { waitUntil: 'domcontentloaded' });
      await delay(300);
      await page.goto(BASE + '/app.html', { waitUntil: 'load', timeout: 60000 });
      // The project a person clicks on the launcher is a card. (The rail's
      // All Projects accordion is collapsed by default, so a rail row is not
      // the obvious target - the card is what the dashboard shows.)
      await page.waitForFunction(() => !!document.querySelector('.pcard[data-id]'), null, {
        timeout: 30000
      });

      // app.html -> project.html through the card a person clicks.
      await page.locator('.pcard[data-id]').first().click();
      await page.waitForFunction(
        () => /project(\.html)?($|\?)/.test(location.pathname + location.search),
        null,
        {
          timeout: 30000
        }
      );
      check('APP-2 dashboard -> project stays in the one tab', pages() === 1, {
        pages: pages(),
        url: page.url()
      });

      // project.html -> dashboard through the real back link.
      await page.click('.hdr-back');
      await page.waitForFunction(() => /app(\.html)?($|\?)/.test(location.pathname), null, {
        timeout: 30000
      });
      check('APP-2 project -> dashboard stays in the one tab', pages() === 1, {
        pages: pages(),
        url: page.url()
      });

      // dashboard -> calculator through the rail link (open the rail first).
      await page.evaluate(() => {
        if (!document.body.classList.contains('side-open')) {
          const btn = document.querySelector('[data-action="toggleSidebar"]');
          if (btn) {
            btn.click();
          }
        }
      });
      await delay(400);
      await page.click('.db-link[href="calculator.html"]');
      await page.waitForFunction(() => /calculator(\.html)?$/.test(location.pathname), null, {
        timeout: 30000
      });
      check('APP-2 dashboard -> calculator stays in the one tab', pages() === 1, {
        pages: pages(),
        url: page.url()
      });

      check('APP-2 the whole walk ends with exactly ONE page open', pages() === 1, pages());
      check('APP-2 no uncaught page error during the walk', errors.length === 0, errors);

      // DOM contracts on every core page.
      const contracts = await page.evaluate(
        async ids => {
          const out = {};
          for (const id of ids) {
            const res = await fetch(id, { cache: 'no-store' });
            const html = await res.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const blank = Array.prototype.slice
              .call(doc.querySelectorAll('a[target="_blank"]'))
              .map(
                a => (a.getAttribute('href') || '') + ' | ' + (a.getAttribute('data-newtab') || '')
              );
            const dash = Array.prototype.slice
              .call(doc.querySelectorAll('a[href="app.html"]'))
              .map(a => a.getAttribute('target') || 'same-tab');
            out[id] = { blank, dash };
          }
          return out;
        },
        ['app.html', 'admin.html', 'project.html', 'calculator.html']
      );

      const badBlank = [];
      Object.keys(contracts).forEach(id => {
        contracts[id].blank.forEach(t => {
          if (t.indexOf('|') > -1 && !/\|\s*\S/.test(t)) {
            badBlank.push(id + ': ' + t);
          }
        });
      });
      check(
        'APP-2 no core page opens a blank tab except the explicit popout action',
        badBlank.length === 0,
        { badBlank, all: contracts }
      );

      const adminDash = contracts['admin.html'].dash || [];
      check(
        'APP-2 the admin Dashboard link is a plain same-tab link',
        adminDash.length > 0 && adminDash.every(t => t === 'same-tab'),
        adminDash
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
