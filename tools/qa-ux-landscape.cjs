/* ============================================================
   tools/qa-ux-landscape.cjs - short screens and landscape phones
   ------------------------------------------------------------
   UX-2026-11-19 A1/A2/A3/A4. Three phone recordings (Android Chrome,
   portrait 480x1040) and the usability test report two things that only
   show up when the phone is turned sideways:

     1. the calculator's guided-tour card lands ON TOP of the control it is
        explaining (step 2 covers the Metric / Imperial toggle), because
        positionTourPop() only tries "below" then "above" and clamps to the
        viewport - at 390px of height both candidates collide with the
        spotlight;
     2. the header, the sticky Estimate bar and the tour card leave only a
        thin strip of page. The stylesheet has no landscape or short-screen
        rules at all (no orientation query, no max-height query).

   Gates:
     L1 no horizontal overflow on any page at any viewport.
     L2 visible content height (viewport minus fixed top/bottom chrome) is
        at least 45% of the viewport height at 844x390 and 740x360.
     L3 the tour card never intersects the spotlight rectangle (+8px) at
        390x844, 844x390 and 1280x720, for every step, and Back / Skip / Next
        are inside the viewport and at least 44px on a coarse pointer.
     L4 every dialog's close / Done control sits inside the viewport.
     L5 no element clips its text without an ellipsis (A4).

   Usage:   node tools/qa-ux-landscape.cjs
   Registry: docs/CI-TEST-COVERAGE.md + ci.yml
   ============================================================ */
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');

const PORT = 8765;
const BASE = process.env.QA_BASE || 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');
const log = s => process.stdout.write('[qa-ux-landscape] ' + s + '\n');
const delay = ms => new Promise(r => setTimeout(r, ms));

let passed = 0;
let failed = 0;
const check = (name, ok, detail) => {
  if (ok) {
    passed++;
    log('PASS  ' + name);
  } else {
    failed++;
    log(
      'FAIL  ' +
        name +
        '  <-- ' +
        JSON.stringify(detail === undefined ? null : detail).slice(0, 400)
    );
  }
};

function resolvePlaywright() {
  try {
    return require('playwright');
  } catch (e) {}
  const roots = [
    path.join(os.homedir(), 'AppData', 'Local', 'npm-cache', '_npx'),
    path.join(os.homedir(), '.npm', '_npx')
  ];
  for (const root of roots) {
    if (!fs.existsSync(root)) {
      continue;
    }
    for (const dir of fs.readdirSync(root)) {
      const p = path.join(root, dir, 'node_modules', 'playwright');
      if (fs.existsSync(path.join(p, 'index.js'))) {
        return require(p);
      }
    }
  }
  throw new Error('playwright not found - npm i -D playwright');
}

const VIEWPORTS = [
  { name: 'portrait-390x844', width: 390, height: 844 },
  { name: 'landscape-844x390', width: 844, height: 390 },
  { name: 'landscape-740x360', width: 740, height: 360 },
  { name: 'desktop-1280x720', width: 1280, height: 720 }
];

// Two double-rAFs: the repo's standard flush (AGENTS.md lesson 3).
const FLUSH_RAF = `new Promise(function (res) {
  requestAnimationFrame(function () { requestAnimationFrame(function () { res(1); }); });
})`;

(async () => {
  let srv = null;
  const { chromium } = resolvePlaywright();
  let executablePath;
  try {
    executablePath =
      require(path.join(ROOT, 'tools', 'chrome-launcher.cjs')).chromePath || undefined;
  } catch (e) {
    /* playwright's own browser */
  }
  let browser = null;
  try {
    let up = false;
    try {
      up = (await fetch(BASE + '/manifest.webmanifest')).ok;
    } catch (e) {
      up = false;
    }
    if (!up) {
      log('starting serve.cjs for this run');
      srv = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
      for (let i = 0; i < 60 && !up; i++) {
        await delay(250);
        try {
          up = (await fetch(BASE + '/manifest.webmanifest')).ok;
        } catch (e) {
          /* keep waiting */
        }
      }
    }
    if (!up) {
      throw new Error('serve.cjs did not answer on ' + BASE);
    }

    browser = await chromium.launch({
      headless: true,
      executablePath,
      args: ['--disk-cache-size=0']
    });

    // Geometry of the page: horizontal overflow plus the height left for
    // content once fixed top and bottom chrome is subtracted. Sticky bars are
    // skipped on purpose - they scroll with the content, so they do not
    // permanently eat the viewport.
    const geo = page =>
      page.evaluate(() => {
        const de = document.documentElement;
        const vh = window.innerHeight;
        const vw = window.innerWidth;
        let top = 0;
        let bottom = 0;
        const chrome = [];
        const all = document.querySelectorAll('body *');
        for (let i = 0; i < all.length; i++) {
          const el = all[i];
          const cs = getComputedStyle(el);
          if (cs.position !== 'fixed') {
            continue;
          }
          if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) {
            continue;
          }
          // Decorative layers (the glass canvas, the mouse glow) and panels
          // that sit off-screen horizontally are not chrome.
          if (cs.pointerEvents === 'none') {
            continue;
          }
          const r = el.getBoundingClientRect();
          if (r.height <= 0 || r.width <= 0) {
            continue;
          }
          if (r.bottom <= 0 || r.top >= vh) {
            continue;
          }
          if (r.right <= 0 || r.left >= vw) {
            continue;
          }
          // A bar, not a panel: anything taller than 40% of the viewport is a
          // sidebar or an open sheet, and those are measured as content.
          if (r.height > vh * 0.4) {
            continue;
          }
          if (r.top <= 1) {
            top = Math.max(top, Math.min(r.bottom, vh));
            chrome.push(
              'top:' + (el.id || el.className).toString().slice(0, 24) + '=' + Math.round(r.height)
            );
          } else if (r.bottom >= vh - 1) {
            bottom = Math.max(bottom, Math.min(vh - r.top, vh));
            chrome.push(
              'bottom:' +
                (el.id || el.className).toString().slice(0, 24) +
                '=' +
                Math.round(r.height)
            );
          }
        }
        return {
          vw: vw,
          vh: vh,
          scrollW: de.scrollWidth,
          clientW: de.clientWidth,
          top: Math.round(top),
          bottom: Math.round(bottom),
          visible: Math.max(0, vh - top - bottom),
          chrome: chrome
        };
      });

    // Text clipped by overflow:hidden with no ellipsis to signal it.
    const clipped = page =>
      page.evaluate(() => {
        const out = [];
        const all = document.querySelectorAll(
          'p, span, td, th, li, h1, h2, h3, h4, label, button, a, div'
        );
        for (let i = 0; i < all.length; i++) {
          const el = all[i];
          const cs = getComputedStyle(el);
          if (cs.overflowX !== 'hidden' || cs.textOverflow === 'ellipsis') {
            continue;
          }
          // Screen-reader helpers are clipped to 1px on purpose.
          if (el.classList.contains('sr-only') || el.clientWidth <= 2) {
            continue;
          }
          if (!el.textContent || !el.textContent.trim()) {
            continue;
          }
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) {
            continue;
          }
          if (el.scrollWidth > el.clientWidth + 2) {
            out.push({
              sel: (el.id ? '#' + el.id : el.className || el.tagName).toString().slice(0, 40),
              scrollW: el.scrollWidth,
              clientW: el.clientWidth
            });
          }
        }
        return out.slice(0, 8);
      });

    const newPage = async vp => {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 2
      });
      await ctx.addInitScript(() => {
        try {
          localStorage.setItem('mmgr_unlocked_demo-project', '1');
          localStorage.setItem('mmgr_scope_demo-project', 'full');
          localStorage.setItem('mmgr_calc_tour_done', '0');
        } catch (e) {
          /* ignore */
        }
      });
      const page = await ctx.newPage();
      return { ctx, page };
    };

    const openPage = async (page, url) => {
      await page.goto(BASE + url, { waitUntil: 'load' });
      await delay(700);
      await page.evaluate(FLUSH_RAF);
    };

    // ---- L1 / L2: every page, every viewport ---------------------------
    const PAGES = [
      { name: 'projects-list', url: '/app.html' },
      { name: 'calculator', url: '/calculator.html' },
      { name: 'project-dashboard', url: '/project.html?id=demo-project' }
    ];

    for (const vp of VIEWPORTS) {
      for (const p of PAGES) {
        const { ctx, page } = await newPage(vp);
        try {
          await openPage(page, p.url);
          const g = await geo(page);
          check(
            'L1 ' + p.name + ' @' + vp.name + ': no horizontal overflow',
            g.scrollW <= g.clientW + 1,
            g
          );
          if (vp.name.indexOf('landscape') === 0) {
            const pct = Math.round((g.visible / g.vh) * 100);
            check(
              'L2 ' + p.name + ' @' + vp.name + ': content height >= 45% (' + pct + '%)',
              g.visible >= g.vh * 0.45,
              { visible: g.visible, vh: g.vh, chrome: g.chrome }
            );
          }
          const clip = await clipped(page);
          check(
            'L5 ' + p.name + ' @' + vp.name + ': no text clipped without ellipsis',
            clip.length === 0,
            clip
          );
        } catch (e) {
          check('L1 ' + p.name + ' @' + vp.name + ': page loads', false, String(e).slice(0, 200));
        } finally {
          await ctx.close();
        }
      }
    }

    // ---- L4: Customize dialog, Done + close inside the viewport --------
    for (const vp of VIEWPORTS) {
      const { ctx, page } = await newPage(vp);
      try {
        await openPage(page, '/app.html');
        await page.evaluate(() => {
          if (window.MMGR_SKIN && window.MMGR_SKIN.openModal) {
            window.MMGR_SKIN.openModal();
            return;
          }
          const b = document.querySelector('[data-nav="customize"]');
          if (b) {
            b.click();
          }
        });
        await page.evaluate(FLUSH_RAF);
        await delay(250);
        const r = await page.evaluate(() => {
          const done = document.querySelector('#customize-modal [data-customize-focus]');
          const close = document.querySelector('#customize-modal .cm-close');
          const box = el => {
            if (!el) {
              return null;
            }
            const b = el.getBoundingClientRect();
            return {
              top: Math.round(b.top),
              bottom: Math.round(b.bottom),
              left: Math.round(b.left),
              right: Math.round(b.right),
              h: Math.round(b.height)
            };
          };
          const modal = document.querySelector('#customize-modal');
          return {
            open: !!modal && !modal.hidden,
            done: box(done),
            close: box(close),
            vh: window.innerHeight,
            vw: window.innerWidth
          };
        });
        const inside = b => !!b && b.top >= 0 && b.bottom <= r.vh && b.left >= 0 && b.right <= r.vw;
        check(
          'L4 customize @' + vp.name + ': Done and close inside the viewport',
          r.open && inside(r.done) && inside(r.close),
          r
        );
      } catch (e) {
        check('L4 customize @' + vp.name + ': dialog opens', false, String(e).slice(0, 200));
      } finally {
        await ctx.close();
      }
    }

    // ---- L3: the tour card never covers its spotlight ------------------
    for (const vp of VIEWPORTS) {
      const { ctx, page } = await newPage(vp);
      try {
        await openPage(page, '/calculator.html');
        const steps = await page.evaluate(() => {
          if (!window.__calcTour) {
            return -1;
          }
          window.__calcTour.start();
          return 1;
        });
        if (steps !== 1) {
          check('L3 tour @' + vp.name + ': tour starts', false, 'no window.__calcTour');
          continue;
        }
        await page.evaluate(FLUSH_RAF);
        await delay(350);
        const seen = [];
        let bad = 0;
        let seenSteps = 0;
        let maxShare = 0;
        for (let i = 0; i < 16; i++) {
          const m = await page.evaluate(() => {
            const pop = document.getElementById('calc-tour-pop');
            const spot = document.getElementById('calc-tour-spot');
            const overlay = document.getElementById('calc-tour-overlay');
            const count = (document.getElementById('calc-tour-count') || {}).textContent || '';
            // offsetParent is null for position:fixed descendants, so the
            // overlay's own hidden flag is the visibility test.
            if (!pop || !overlay || overlay.hidden) {
              return null;
            }
            const p = pop.getBoundingClientRect();
            const s = spot && !spot.hidden ? spot.getBoundingClientRect() : null;
            const btn = Array.prototype.slice
              .call(pop.querySelectorAll('.bcp-tour-btns .btn'))
              .map(b => {
                const r = b.getBoundingClientRect();
                return {
                  t: b.textContent.trim(),
                  w: Math.round(r.width),
                  h: Math.round(r.height),
                  inside:
                    r.top >= 0 &&
                    r.left >= 0 &&
                    r.bottom <= window.innerHeight &&
                    r.right <= window.innerWidth
                };
              });
            return {
              count: count,
              final: pop.classList.contains('is-final'),
              pop: { top: p.top, bottom: p.bottom, left: p.left, right: p.right },
              spot: s ? { top: s.top, bottom: s.bottom, left: s.left, right: s.right } : null,
              btn: btn,
              vh: window.innerHeight
            };
          });
          if (!m) {
            break;
          }
          seenSteps++;
          const sharePct = Math.round(((m.pop.bottom - m.pop.top) / m.vh) * 100);
          if (sharePct > maxShare) {
            maxShare = sharePct;
          }
          // A spotlight smaller than 20px is not highlighting a control at
          // all (the target was off-screen when the cutout was measured).
          const degenerate =
            !!m.spot &&
            !m.final &&
            (m.spot.right - m.spot.left < 20 || m.spot.bottom - m.spot.top < 20);
          // Intersection against the spotlight grown by 8px. The final card
          // IS its own spotlight (no target), so it is exempt by design.
          let overlap = false;
          if (m.spot && !m.final) {
            const s = {
              top: m.spot.top - 8,
              bottom: m.spot.bottom + 8,
              left: m.spot.left - 8,
              right: m.spot.right + 8
            };
            overlap =
              m.pop.left < s.right &&
              m.pop.right > s.left &&
              m.pop.top < s.bottom &&
              m.pop.bottom > s.top;
          }
          const outBtn = m.btn.filter(b => !b.inside);
          const tiny = m.btn.filter(b => b.w < 44 || b.h < 44);
          if (overlap || degenerate || outBtn.length || tiny.length) {
            bad++;
            seen.push({
              step: m.count,
              overlap: overlap,
              degenerate: degenerate,
              pop: m.pop,
              spot: m.spot,
              outside: outBtn.map(b => b.t),
              small: tiny.map(b => b.t + ' ' + b.w + 'x' + b.h)
            });
          }
          const done = await page.evaluate(() => {
            const b = document.querySelector('[data-action="calcTourNext"]');
            if (!b) {
              return 'no-next';
            }
            b.click();
            return 'clicked';
          });
          if (done !== 'clicked') {
            break;
          }
          await page.evaluate(FLUSH_RAF);
          await delay(200);
          const ended = await page.evaluate(() => {
            const ov = document.getElementById('calc-tour-overlay');
            return !ov || ov.hidden;
          });
          if (ended) {
            break;
          }
        }
        // L2b: in landscape the card must dock to a side, not eat the height.
        // A full-width card over a 360-390px screen leaves a thin strip.
        if (vp.name.indexOf('landscape') === 0) {
          check(
            'L2b tour @' + vp.name + ': card takes <= 35% of the height (' + maxShare + '%)',
            maxShare > 0 && maxShare <= 35,
            { maxShare: maxShare }
          );
        }
        check(
          'L3 tour @' + vp.name + ': card never covers the spotlight, buttons visible and 44px',
          bad === 0 && seenSteps >= 12,
          { bad: bad, steps: seenSteps, detail: seen.slice(0, 4) }
        );
      } catch (e) {
        check('L3 tour @' + vp.name + ': tour runs', false, String(e).slice(0, 200));
      } finally {
        await ctx.close();
      }
    }
  } catch (e) {
    check('harness completed', false, String(e).slice(0, 300));
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {}
    }
    if (srv) {
      try {
        srv.kill();
      } catch (e) {}
    }
  }
  log('---');
  log((failed ? 'FAIL ' : 'PASS ') + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
