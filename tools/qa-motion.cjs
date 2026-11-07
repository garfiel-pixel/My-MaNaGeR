// T-MOTION gate (Wave I, I-5 motion language).
// Deterministic contract:
//   - header hides on scroll down and returns on scroll up (I-5d)
//   - --page-progress (the gold-light driver) is monotonic over a scripted
//     scroll, so the seam light cannot flicker (I-5a)
//   - the magnet canvas exists on a fine-pointer desktop (I-5e)
//   - prefers-reduced-motion disables the seam light, the reveal and the
//     typed text, and removes the canvas
//   - a touch viewport never gets the magnet canvas
// Runs against the shared QA server (:8765 by default, MMGR_BASE to override).

const { chromium } = require('playwright');

const BASE = process.env.MMGR_BASE || 'http://127.0.0.1:8765';
const URL = BASE + '/index.html';

let pass = 0;
let fail = 0;
const fails = [];
function ok(n) {
  pass++;
  console.log('  PASS', n);
}
function bad(n, d) {
  fail++;
  fails.push(n + ': ' + d);
  console.log('  FAIL', n, '-', d);
}

async function newPage(browser, opts) {
  const ctx = await browser.newContext(
    Object.assign({ viewport: { width: 1280, height: 896 } }, opts)
  );
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem(
        'mmgr_consent',
        JSON.stringify({ v: 1, iv: 3, analytics: false, ts: new Date().toISOString() })
      );
    } catch (e) {}
  });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(900);
  return { ctx, page };
}

(async () => {
  const browser = await chromium.launch();

  // ---- Desktop: header hide/show + monotonic progress + canvas ----
  {
    const { ctx, page } = await newPage(browser, {});
    // canvas on fine pointer
    const hasCanvas = await page.$('.magnet-field');
    if (hasCanvas) ok('magnet-canvas-on-fine-pointer');
    else bad('magnet-canvas-on-fine-pointer', 'no .magnet-field');

    // scroll down and read state
    await page.evaluate(() => window.scrollTo(0, 900));
    await page.waitForTimeout(400);
    const hiddenDown = await page.$eval('.site-header', h => h.getAttribute('data-hidden'));
    if (hiddenDown === 'true') ok('header-hides-on-scroll-down');
    else bad('header-hides-on-scroll-down', 'data-hidden=' + hiddenDown);

    // scroll up
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.waitForTimeout(400);
    const shownUp = await page.$eval('.site-header', h => h.getAttribute('data-hidden'));
    if (shownUp === 'false') ok('header-shows-on-scroll-up');
    else bad('header-shows-on-scroll-up', 'data-hidden=' + shownUp);

    // monotonic progress across a scripted scroll
    const ys = [0, 200, 400, 600, 800, 1000, 1200, 1400];
    let prev = -1;
    let mono = true;
    for (const y of ys) {
      await page.evaluate(v => window.scrollTo(0, v), y);
      await page.waitForTimeout(120);
      const p = await page.evaluate(
        () =>
          parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue('--page-progress')
          ) || 0
      );
      if (p + 0.0001 < prev) {
        mono = false;
        break;
      }
      prev = p;
    }
    if (mono) ok('seam-progress-monotonic');
    else bad('seam-progress-monotonic', 'progress decreased during downward scroll');
    await ctx.close();
  }

  // ---- Reduced motion: everything off ----
  {
    const { ctx, page } = await newPage(browser, { reducedMotion: 'reduce' });
    const canvas = await page.$('.magnet-field');
    if (!canvas) ok('reduced-motion-no-canvas');
    else bad('reduced-motion-no-canvas', 'canvas present');

    const typeAnim = await page.evaluate(() => {
      const el = document.querySelector('.hero-type');
      return el ? el.hasAttribute('data-type-anim') : false;
    });
    if (!typeAnim) ok('reduced-motion-typing-off');
    else bad('reduced-motion-typing-off', 'data-type-anim present');

    const seamDisplay = await page.evaluate(() => {
      const el = document.querySelector('.band-seam');
      return el ? getComputedStyle(el, '::before').display : 'none';
    });
    if (seamDisplay === 'none') ok('reduced-motion-seam-light-off');
    else bad('reduced-motion-seam-light-off', 'display=' + seamDisplay);

    const rvClass = await page.evaluate(() => {
      const el = document.querySelector('.fcard, .aud-item, .step, .section-head');
      return el ? el.classList.contains('rv') : false;
    });
    if (!rvClass) ok('reduced-motion-reveal-off');
    else bad('reduced-motion-reveal-off', '.rv was added under reduced motion');
    await ctx.close();
  }

  // ---- Touch viewport: no canvas ----
  {
    const { ctx, page } = await newPage(browser, {
      hasTouch: true,
      isMobile: true,
      viewport: { width: 390, height: 844 }
    });
    const canvas = await page.$('.magnet-field');
    if (!canvas) ok('touch-no-canvas');
    else bad('touch-no-canvas', 'canvas present on touch');
    await ctx.close();
  }

  await browser.close();
  console.log('\nT-MOTION: ' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) {
    console.log('FAILURES:\n - ' + fails.join('\n - '));
    process.exit(1);
  }
  console.log('T-MOTION PASS');
})().catch(e => {
  console.error('T-MOTION harness error:', e);
  process.exit(2);
});
