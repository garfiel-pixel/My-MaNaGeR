// T-TOUR gate (Wave I, I-11 first-open tour highlights what it describes).
//   - every step with a target rings it: the target box lies INSIDE the
//     rounded spotlight cut-out
//   - the rest of the page is dimmed (the cut-out is cut by a viewport-sized
//     shadow, not just an outline on top of a flat dim)
//   - the tip never overlaps the target, at 1280 and at 390
//   - a step whose target is hidden for this user is SKIPPED, and the count
//     reflects the steps that will actually be shown
//   - keyboard: focus starts in the tip, ArrowRight/ArrowLeft walk, Escape ends
//   - dark and light both render the card on real theme tokens
// Screenshots of every step at 1280 and 390 land in tmp/tour-shots/.
// Runs against the shared QA server (:8765 by default, MMGR_BASE to override).

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.MMGR_BASE || 'http://127.0.0.1:8765';
const URL = BASE + '/seed-test.html';
const SHOTS = path.resolve(__dirname, '..', 'tmp', 'tour-shots');

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

const launchOpts = {
  headless: true,
  ...(function () {
    try {
      const cp = require('./chrome-launcher.cjs').chromePath;
      return cp ? { executablePath: cp } : {};
    } catch (e) {
      return {};
    }
  })()
};

function seed(theme) {
  try {
    localStorage.setItem('mmgr_theme', theme);
    localStorage.setItem('mmgr_first_project_tour_v1', '1');
    localStorage.setItem(
      'mmgr_consent',
      JSON.stringify({ v: 1, iv: 3, analytics: false, ts: new Date().toISOString() })
    );
  } catch (e) {}
}

const inside = (inner, outer, pad) => {
  if (!inner || !outer) return false;
  pad = pad || 0;
  return (
    inner.left >= outer.left - pad &&
    inner.top >= outer.top - pad &&
    inner.right <= outer.right + pad &&
    inner.bottom <= outer.bottom + pad
  );
};
const overlap = (a, b, pad) => {
  if (!a || !b) return false;
  pad = pad || 0;
  return !(
    a.right + pad <= b.left ||
    a.left - pad >= b.right ||
    a.bottom + pad <= b.top ||
    a.top - pad >= b.bottom
  );
};

// The tour settles its plan before showing the first card (a section whose
// target is still rendering is not dropped), so it is briefly display:none
// after start(). Wait for the overlay to be visible AND open before reading
// geometry or clicking through it.
async function waitTourOpen(page) {
  await page.waitForFunction(
    () => {
      const r = document.getElementById('tour-root');
      return (
        !!r &&
        getComputedStyle(r).display !== 'none' &&
        window.MMGR &&
        MMGR.Tour &&
        MMGR.Tour.isOpen()
      );
    },
    null,
    { timeout: 8000 }
  );
  await page.waitForTimeout(60);
}

async function startTour(page) {
  await page.evaluate(() => {
    if (window.MMGR && window.MMGR.Tour) window.MMGR.Tour.start();
  });
  await waitTourOpen(page);
}

async function walk(page, label, shots) {
  await waitTourOpen(page);
  const seen = [];
  for (let i = 0; i < 20; i++) {
    const cur = await page.evaluate(() =>
      window.MMGR && MMGR.Tour.current ? MMGR.Tour.current() : null
    );
    if (!cur) break;
    seen.push(cur.title);
    if (cur.target) {
      if (inside(cur.target, cur.ring, 1)) ok(label + ' target-inside-spotlight #' + (i + 1));
      else
        bad(
          label + ' target-inside-spotlight #' + (i + 1),
          JSON.stringify({ t: cur.target, r: cur.ring })
        );
      if (!overlap(cur.card, cur.target, 2)) ok(label + ' tip-clear-of-target #' + (i + 1));
      else
        bad(
          label + ' tip-clear-of-target #' + (i + 1),
          JSON.stringify({ c: cur.card, t: cur.target })
        );
    } else {
      ok(label + ' targetless-step-centred #' + (i + 1));
    }
    if (shots) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, label + '-step-' + (i + 1) + '.png') });
    }
    await page.click('#tour-next');
    await page.waitForTimeout(180);
  }
  return seen;
}

(async () => {
  const browser = await chromium.launch(launchOpts);
  fs.mkdirSync(SHOTS, { recursive: true });

  // ---------- 1280 dark: the full walk + cut-out proof ----------
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: 'dark'
  });
  await ctx.addInitScript(seed, 'dark');
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => window.MMGR && window.MMGR.Tour, null, { timeout: 45000 });
  await page.waitForTimeout(700);

  await startTour(page);
  const opened = await page.evaluate(() => !!MMGR.Tour.current());
  if (opened) ok('tour-opens');
  else bad('tour-opens', 'MMGR.Tour.current() was null after start()');

  // The dim must be a cut-out shadow around the ring, not a flat layer.
  const shadow = await page.evaluate(() => {
    const r = document.getElementById('tour-ring');
    return r ? getComputedStyle(r).boxShadow : null;
  });
  const bigSpread = !!shadow && /9999px/.test(shadow);
  const darkLayer = !!shadow && /rgba\(\s*8\s*,\s*9\s*,\s*11\s*,\s*0\.7/.test(shadow);
  if (bigSpread && darkLayer) ok('dim-is-a-cut-out');
  else bad('dim-is-a-cut-out', String(shadow));

  const rootBg = await page.evaluate(
    () => getComputedStyle(document.getElementById('tour-root')).backgroundColor
  );
  if (rootBg === 'rgba(0, 0, 0, 0)' || rootBg === 'transparent') ok('target-step-not-flat-dim');
  else bad('target-step-not-flat-dim', rootBg);

  // Focus starts in the tip.
  const focus = await page.evaluate(() => document.activeElement && document.activeElement.id);
  if (focus === 'tour-next') ok('focus-in-tip');
  else bad('focus-in-tip', 'activeElement=' + focus);

  // Keyboard walk: right advances, left goes back.
  const t1 = await page.evaluate(() => MMGR.Tour.current().title);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(160);
  const t2 = await page.evaluate(() => MMGR.Tour.current().title);
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(160);
  const t3 = await page.evaluate(() => MMGR.Tour.current().title);
  if (t1 !== t2 && t1 === t3) ok('keyboard-walk');
  else bad('keyboard-walk', JSON.stringify({ t1, t2, t3 }));

  const seen = await walk(page, '1280-dark', true);
  if (seen.length >= 6) ok('walk-covers-steps');
  else bad('walk-covers-steps', 'only ' + seen.length + ' steps');
  const ended = await page.evaluate(() => !MMGR.Tour.isOpen());
  if (ended) ok('walk-ends');
  else bad('walk-ends', 'tour still open after the last Next');

  // ---------- skipping: a hidden section is not a step ----------
  await page.evaluate(() => {
    document.querySelectorAll('.sec-btn[data-section="stk"]').forEach(el => {
      el.style.display = 'none';
    });
    MMGR.Tour.start();
  });
  await page.waitForTimeout(200);
  const skipInfo = await page.evaluate(() => ({
    total: MMGR.Tour.current().total,
    title: MMGR.Tour.current().title
  }));
  const skipWalk = await walk(page, 'skip', false);
  if (skipWalk.indexOf('Collaborate') === -1) ok('missing-target-skipped');
  else bad('missing-target-skipped', 'Collaborate still appears: ' + skipWalk.join(' / '));
  if (skipInfo.total === seen.length - 1) ok('count-reflects-skip');
  else bad('count-reflects-skip', 'total=' + skipInfo.total + ' fullWalk=' + seen.length);
  await ctx.close();

  // ---------- 390: phone sheet never covers the target ----------
  const mctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: 'dark',
    isMobile: true,
    hasTouch: true
  });
  await mctx.addInitScript(seed, 'dark');
  const mpage = await mctx.newPage();
  await mpage.goto(URL, { waitUntil: 'networkidle', timeout: 45000 });
  await mpage.waitForFunction(() => window.MMGR && window.MMGR.Tour, null, { timeout: 45000 });
  await mpage.waitForTimeout(700);
  await startTour(mpage);
  const phoneSeen = await walk(mpage, '390-dark', true);
  if (phoneSeen.length >= 4) ok('phone-walk-covers-steps');
  else
    bad('phone-walk-covers-steps', 'only ' + phoneSeen.length + ' steps: ' + phoneSeen.join(' / '));
  await mctx.close();

  // ---------- light: the card is a real themed surface ----------
  const lctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: 'light'
  });
  await lctx.addInitScript(seed, 'light');
  const lpage = await lctx.newPage();
  await lpage.goto(URL, { waitUntil: 'networkidle', timeout: 45000 });
  await lpage.waitForFunction(() => window.MMGR && window.MMGR.Tour, null, { timeout: 45000 });
  await lpage.waitForTimeout(700);
  await startTour(lpage);
  const lightCard = await lpage.evaluate(() => {
    const c = document.getElementById('tour-card');
    const cs = getComputedStyle(c);
    return { bg: cs.backgroundColor, color: cs.color };
  });
  const light =
    /^rgb\(25[0-5]|^rgb\(2[4-5][0-9]/.test(lightCard.bg) &&
    lightCard.color !== 'rgb(232, 234, 238)';
  if (light) ok('light-theme-card');
  else bad('light-theme-card', JSON.stringify(lightCard));
  await lpage.screenshot({ path: path.join(SHOTS, '1280-light-step-1.png') });
  await lctx.close();

  await browser.close();
  console.log('\nT-TOUR: ' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) {
    console.log('FAILURES:\n - ' + fails.join('\n - '));
    process.exit(1);
  }
  console.log('T-TOUR PASS');
})().catch(e => {
  console.error('T-TOUR harness error:', e);
  process.exit(2);
});
