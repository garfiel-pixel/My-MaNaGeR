// T-RAIL gate (Wave I, I-9 dot rail / stats strip / AI tour label).
//   - the landing dot rail rests at <= 0.45 opacity (a quarter below 0.6)
//   - the four-steps block carries no star icon
//   - the AI tour is branded "My MaNaGeR AI Tour"
//   - the stats strip is four tiles with icons, the panel count equals the
//     single constant (15) and the data figure reads 100%
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

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(function () {
      try {
        const cp = require('./chrome-launcher.cjs').chromePath;
        return cp ? { executablePath: cp } : {};
      } catch (e) {
        return {};
      }
    })()
  });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: 'dark'
  });
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
  await page.waitForTimeout(1400); // let the count-up finish

  // dot rail resting opacity (a non-active dot)
  const opacity = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.dot-item'));
    const rest = items.find(el => !el.classList.contains('active'));
    return rest ? parseFloat(getComputedStyle(rest).opacity) : null;
  });
  if (opacity === null) bad('dot-rail-present', 'no .dot-item found');
  else if (opacity <= 0.4501) ok('dot-rail-dimmed');
  else bad('dot-rail-dimmed', 'resting opacity=' + opacity + ' (want <= 0.45)');

  // four-steps block: no star icon
  const stepsStar = await page.evaluate(() => {
    const steps = document.querySelector('.steps');
    if (!steps) return null;
    return !!steps.querySelector('use[href*="i-star"]');
  });
  if (stepsStar === null) bad('steps-present', 'no .steps block');
  else if (!stepsStar) ok('steps-no-star');
  else bad('steps-no-star', 'a star icon is still in .steps');

  // AI tour label
  const tourLabel = await page.evaluate(
    () => document.body.textContent.indexOf('My MaNaGeR AI Tour') > -1
  );
  if (tourLabel) ok('ai-tour-label');
  else bad('ai-tour-label', 'label not found');

  // stats strip: four tiles with icons
  const stats = await page.evaluate(() => {
    const tiles = Array.from(document.querySelectorAll('.hero-stats .hstat'));
    return {
      count: tiles.length,
      allIcons: tiles.every(t => !!t.querySelector('svg.ico')),
      panels: (document.querySelector('.hero-stats [data-count="panels"]') || {}).textContent,
      percent: (document.querySelector('.hero-stats [data-count="percent"]') || {}).textContent
    };
  });
  if (stats.count === 4) ok('stats-four-tiles');
  else bad('stats-four-tiles', 'count=' + stats.count);
  if (stats.allIcons) ok('stats-icons');
  else bad('stats-icons', 'a tile has no icon');
  if (String(stats.panels).trim() === '15') ok('stats-panel-constant');
  else bad('stats-panel-constant', 'panels=' + stats.panels);
  if (String(stats.percent).trim() === '100%') ok('stats-percent');
  else bad('stats-percent', 'percent=' + stats.percent);

  await browser.close();
  console.log('\nT-RAIL: ' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) {
    console.log('FAILURES:\n - ' + fails.join('\n - '));
    process.exit(1);
  }
  console.log('T-RAIL PASS');
})().catch(e => {
  console.error('T-RAIL harness error:', e);
  process.exit(2);
});
