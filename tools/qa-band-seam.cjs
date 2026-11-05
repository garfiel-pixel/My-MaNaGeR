#!/usr/bin/env node
/* ============================================================
   tools/qa-band-seam.cjs - C1 (audit 2026-11-01)
   ------------------------------------------------------------
   C1 asked for ONE deliberate seam where two landing bands of different tone
   meet: a construction-flavoured, themeable treatment that is cheap enough not
   to delay first paint or LCP, and off under reduced motion.

   This gate proves, in a real browser on index.html:
     - exactly six seams exist, in the dark->light / warm->dark order the page
       needs, and every one is aria-hidden with a survey mark;
     - each seam paints a CSS gradient (the blend) and contains NO canvas,
       NO script and NO img, so it cannot run a rAF loop or fetch anything;
     - the hero (the LCP block) precedes the first seam in the DOM, so the seam
       can never be the LCP candidate;
     - under prefers-reduced-motion the decoration is switched off while the
       gradient blend stays;
     - the seam markup carries no emoji (repo hard gate).

   Teeth: remove the reduced-motion block -> the marks stay visible and the
   reduced-motion arm fails. Add a <canvas> inside a seam -> the cheap arm
   fails. Drop a seam -> the count/order arm fails.

   Usage:  node tools/qa-band-seam.cjs
   Registry: docs/CI-TEST-COVERAGE.md -> CI row (browser-marketing).
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const BASE = (process.env.QA_BASE || 'http://127.0.0.1:8765').replace(/\/$/, '');
const log = s => process.stdout.write('[band-seam] ' + s + '\n');
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

const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;

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
    const h = await fetch(BASE + '/index.html');
    if (!h.ok) throw new Error('not ok');
  } catch (e) {
    log('starting serve.cjs for this run');
    srv = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
    for (let i = 0; i < 40; i++) {
      await delay(1000);
      try {
        const h = await fetch(BASE + '/index.html');
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

    await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => !!document.body, null, { timeout: 45000 });
    await delay(400);

    // ---- structure + order ------------------------------------------------
    const structure = await page.evaluate(() => {
      const seams = Array.from(document.querySelectorAll('.band-seam'));
      const main = document.querySelector('main');
      const hero = document.querySelector('main .hero');
      const firstSeam = seams[0] || null;
      const heroBeforeSeam =
        !!(hero && firstSeam) &&
        !!(hero.compareDocumentPosition(firstSeam) & Node.DOCUMENT_POSITION_FOLLOWING);
      return {
        count: seams.length,
        order: seams.map(s => s.getAttribute('data-seam')),
        allHidden: seams.every(s => s.getAttribute('aria-hidden') === 'true'),
        allMarked: seams.every(s => !!s.querySelector('svg.seam-mark')),
        directChildOfMain: seams.every(s => s.parentElement === main),
        heroBeforeSeam,
        markup: seams.map(s => s.outerHTML).join('')
      };
    });

    check('six band seams present', structure.count === 6, structure.count);
    check(
      'seam tone order is dl, wd, dl, wd, dl, wd',
      JSON.stringify(structure.order) === JSON.stringify(['dl', 'wd', 'dl', 'wd', 'dl', 'wd']),
      structure.order
    );
    check('every seam is aria-hidden', structure.allHidden, structure.allHidden);
    check('every seam carries a survey mark SVG', structure.allMarked, structure.allMarked);
    check('every seam is a direct child of <main> (full-bleed)', structure.directChildOfMain);
    check('hero precedes the first seam (seam cannot be LCP)', structure.heroBeforeSeam);
    check('seam markup carries no emoji', !EMOJI_RE.test(structure.markup), null);

    // ---- cheap: gradient only, no canvas / script / img --------------------
    const cheap = await page.evaluate(() => {
      const seams = Array.from(document.querySelectorAll('.band-seam'));
      return {
        allGradient: seams.every(s => getComputedStyle(s).backgroundImage.indexOf('gradient') > -1),
        anyCanvas: seams.some(s => !!s.querySelector('canvas')),
        anyScript: seams.some(s => !!s.querySelector('script')),
        anyImg: seams.some(s => !!s.querySelector('img'))
      };
    });
    check('every seam paints a gradient blend', cheap.allGradient, cheap.allGradient);
    check('no canvas inside any seam (no rAF loop)', !cheap.anyCanvas);
    check('no script inside any seam', !cheap.anyScript);
    check('no image inside any seam', !cheap.anyImg);

    // ---- reduced motion: decoration off, blend kept -----------------------
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await delay(150);
    const reduced = await page.evaluate(() => {
      const seam = document.querySelector('.band-seam');
      if (!seam) return null;
      const mark = seam.querySelector('.seam-mark');
      const cs = getComputedStyle(seam);
      return {
        markHidden: !mark || getComputedStyle(mark).display === 'none',
        beforeHidden: getComputedStyle(seam, '::before').display === 'none',
        afterHidden: getComputedStyle(seam, '::after').display === 'none',
        gradientKept: cs.backgroundImage.indexOf('gradient') > -1
      };
    });
    check('reduced motion: survey mark is off', !!reduced && reduced.markHidden, reduced);
    check('reduced motion: join line is off', !!reduced && reduced.beforeHidden, reduced);
    check('reduced motion: tick grid is off', !!reduced && reduced.afterHidden, reduced);
    check('reduced motion: gradient blend remains', !!reduced && reduced.gradientKept, reduced);

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
