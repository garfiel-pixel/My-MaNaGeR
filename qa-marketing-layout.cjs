#!/usr/bin/env node
// tools/qa-marketing-layout.cjs
// Regression gate for the marketing pages' CANVAS and the homepage DOT RAIL.
// Owner rules 2026-10-07:
//   R1  Every marketing page is FULL-BLEED: <main> and every band inside it
//       (.hero .page-hero .photo-band .section .section-alt) is exactly as wide
//       as the window, starting at x=0. No cream gutters, no cropped hero.
//   R2  Text never touches a band's edge: the first heading keeps a real inset.
//   R3  The dot rail: big dot = major topic, small dot = minor topic, strictly
//       big, small, small, big, ... big. No labels. Compact. One active dot.
//   R4  The rail never overlaps content, and is hidden when it cannot fit.
//   R5  The field guide (its own design system) never scrolls sideways.
//
// Why this exists: qa-spy-nav.cjs only measured phones for the 96px gutter and
// never measured the desktop canvas, so <main> sat at x=96..1296 on a 1534px
// window for days while every gate stayed green. This gate measures the thing
// the owner SEES: left/right edges of the bands, at real desktop sizes.
//
// Runs against serve.cjs (QA_BASE, default http://127.0.0.1:8765).
// Optional: PW_CHROMIUM=/path/to/chrome for sandboxes with a pinned browser.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:8765';
const ROOT = path.join(__dirname, '..');
const MINORS_PER_GAP = 2; // keep equal to js/marketing.js
const MAJORS = 7;
const EXPECT_MINORS = MINORS_PER_GAP * (MAJORS - 1);
const EXPECT_PATTERN = 'M' + ('m'.repeat(MINORS_PER_GAP) + 'M').repeat(MAJORS - 1);
const RAIL_MAX_HEIGHT = 340; // px, tallest the rail may ever be
const RAIL_CLEARANCE = 12; // px, rail right edge to the reading column
const DESKTOPS = [
  [1200, 800],
  [1280, 800],
  [1366, 768],
  [1534, 697], // the owner's screen: 1917px at 125% display scaling
  [1920, 1080],
  [2560, 1300]
];
const PHONE = [390, 844];
const MID = [1024, 768]; // rail must be hidden here

const pages = fs
  .readdirSync(ROOT)
  .filter(f => f.endsWith('.html'))
  .filter(f => {
    const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
    return t.includes('class="site-header"') && t.includes('marketing.min.css');
  })
  .sort();

let fails = 0;
function check(ok, label, extra) {
  if (!ok) fails++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  [' + extra + ']' : ''));
}

const MEASURE = () => {
  const vw = document.documentElement.clientWidth;
  const rect = e => {
    const b = e.getBoundingClientRect();
    return { x: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width) };
  };
  const main = document.querySelector('main');
  const bands = main
    ? [...main.children]
        .filter(e => e.matches('.hero,.page-hero,.photo-band,.section,.section-alt'))
        .map(e => ({ c: e.className.split(' ')[0] + (e.id ? '#' + e.id : ''), ...rect(e) }))
    : [];
  const h1 = document.querySelector('main h1');
  return {
    vw,
    scrollW: document.documentElement.scrollWidth,
    main: main ? rect(main) : null,
    bands,
    h1x: h1 ? Math.round(h1.getBoundingClientRect().left) : null
  };
};

(async () => {
  const browser = await chromium.launch(
    process.env.PW_CHROMIUM
      ? { executablePath: process.env.PW_CHROMIUM, args: ['--no-sandbox'] }
      : {}
  );
  console.log('pages under test: ' + pages.join(', ') + '\n');

  // ---- R1 + R2: full-bleed canvas, every page, every size --------------------
  for (const [w, h] of [...DESKTOPS, MID, PHONE]) {
    const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
    for (const f of pages) {
      await page.goto(BASE + '/' + f, { waitUntil: 'load' });
      await page.waitForTimeout(250);
      const m = await page.evaluate(MEASURE);
      const tag = f + ' @' + w;
      check(
        m.scrollW <= m.vw + 1,
        tag + ' has no sideways scroll',
        'scrollW ' + m.scrollW + ' vs ' + m.vw
      );
      check(
        !!m.main && m.main.x === 0 && Math.abs(m.main.w - m.vw) <= 1,
        tag + ' <main> spans the whole window',
        m.main ? 'x=' + m.main.x + ' w=' + m.main.w + ' vw=' + m.vw : 'no <main>'
      );
      const bad = m.bands.filter(b => b.x !== 0 || Math.abs(b.w - m.vw) > 1);
      check(
        m.bands.length > 0 && bad.length === 0,
        tag + ' every band is edge to edge',
        bad.length
          ? bad.map(b => b.c + ' x=' + b.x + ' w=' + b.w).join('; ')
          : m.bands.length + ' bands'
      );
      check(
        m.h1x !== null && m.h1x >= (w <= 480 ? 14 : 24),
        tag + ' heading is inset from the edge',
        'h1 x=' + m.h1x
      );
    }
    await page.context().close();
  }

  // ---- R3 + R4: the homepage rail --------------------------------------------
  console.log('');
  for (const [w, h] of DESKTOPS) {
    const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
    await page.goto(BASE + '/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
      const nav = document.querySelector('.dot-rail-navigation');
      if (!nav) return null;
      const items = [...nav.querySelectorAll('.dot-item')];
      const nb = nav.getBoundingClientRect();
      const dots = items.map(i => {
        const b = i.querySelector('.dot').getBoundingClientRect();
        return { t: i.classList.contains('major') ? 'M' : 'm', w: Math.round(b.width) };
      });
      const h1 = document.querySelector('main h1').getBoundingClientRect();
      const visible = e =>
        e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
      return {
        shown: visible(nav),
        pattern: dots.map(d => d.t).join(''),
        majorW: Math.min(...dots.filter(d => d.t === 'M').map(d => d.w)),
        minorW: Math.max(...dots.filter(d => d.t === 'm').map(d => d.w)),
        height: Math.round(nb.height),
        right: Math.round(nb.right),
        h1x: Math.round(h1.left),
        top: Math.round(nb.top),
        bottom: Math.round(nb.bottom),
        labelsShown: [...nav.querySelectorAll('.dot-label,.tooltip,.rail-line,.dot-group')].filter(
          visible
        ).length,
        textInRail: nav.innerText.trim().length,
        vh: innerHeight
      };
    });
    const tag = 'rail @' + w + 'x' + h;
    check(!!r && r.shown, tag + ' is visible');
    if (r && r.shown) {
      check(
        r.pattern === EXPECT_PATTERN,
        tag + ' alternates big, small, small, big ...',
        r.pattern
      );
      check(
        r.majorW >= 12 && r.minorW <= 8 && r.minorW < r.majorW,
        tag + ' big dots are bigger than small dots',
        'big ' + r.majorW + ' small ' + r.minorW
      );
      check(
        r.height <= RAIL_MAX_HEIGHT,
        tag + ' is compact',
        r.height + 'px (max ' + RAIL_MAX_HEIGHT + ')'
      );
      check(
        r.top >= 64 && r.bottom <= r.vh,
        tag + ' fits inside the window below the header',
        r.top + '..' + r.bottom + ' of ' + r.vh
      );
      check(
        r.h1x - r.right >= RAIL_CLEARANCE,
        tag + ' clears the reading column',
        'gap ' + (r.h1x - r.right) + 'px'
      );
      check(r.labelsShown === 0 && r.textInRail === 0, tag + ' shows no labels, tooltips or lines');
    }
    await page.context().close();
  }
  {
    const page = await (
      await browser.newContext({ viewport: { width: MID[0], height: MID[1] } })
    ).newPage();
    await page.goto(BASE + '/index.html', { waitUntil: 'load' });
    const hidden = await page.evaluate(() => {
      const n = document.querySelector('.dot-rail-navigation');
      return !n || n.getClientRects().length === 0;
    });
    check(hidden, 'rail is hidden at 1024px (it cannot fit without overlapping)');
    await page.context().close();
  }

  // ---- R3: exactly one active dot, and it travels in page order -----------
  console.log('');
  {
    const page = await (
      await browser.newContext({ viewport: { width: 1534, height: 697 } })
    ).newPage();
    await page.goto(BASE + '/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const seen = [];
    let onlyOne = true;
    let first = null;
    for (let i = 0; i <= 120; i++) {
      // 'instant' defeats html{scroll-behavior:smooth}; sampling mid-animation reads a lagging marker
      await page.evaluate(f => {
        const t = document.documentElement.scrollHeight - innerHeight;
        window.scrollTo({ top: Math.round(t * f), behavior: 'instant' });
      }, i / 120);
      await page.waitForTimeout(90);
      const st = await page.evaluate(() => {
        const items = [...document.querySelectorAll('.dot-rail-navigation .dot-item')];
        const act = items
          .map((e, ix) => (e.classList.contains('active') ? ix : -1))
          .filter(x => x >= 0);
        return { n: act.length, ix: act[0] };
      });
      if (st.n !== 1) onlyOne = false;
      if (i === 0) first = st.ix;
      seen.push(st.ix);
    }
    const monotone = seen.every((v, i) => i === 0 || v >= seen[i - 1]);
    const distinct = new Set(seen).size;
    check(onlyOne, 'exactly one dot is active at every scroll position (121 samples)');
    check(first === 0, 'the first big dot is active at the top of the page', 'index ' + first);
    check(monotone, 'the marker only moves forward as you scroll down');
    check(
      distinct === MAJORS + EXPECT_MINORS,
      'the marker visits every dot, big and small',
      distinct + ' of ' + (MAJORS + EXPECT_MINORS)
    );
    check(
      seen[seen.length - 1] === MAJORS + EXPECT_MINORS - 1,
      'the last big dot is active at the bottom'
    );
    await page.context().close();
  }

  // ---- R5: the guide is its own design system; it must just not break -------
  console.log('');
  for (const [w, h] of [
    [1534, 697],
    [390, 844]
  ]) {
    const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
    await page.goto(BASE + '/mymanager-field-guide.html', { waitUntil: 'load' });
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => ({
      s: document.documentElement.scrollWidth,
      v: document.documentElement.clientWidth
    }));
    check(m.s <= m.v + 1, 'field guide @' + w + ' has no sideways scroll', m.s + ' vs ' + m.v);
    await page.context().close();
  }

  await browser.close();
  console.log('\n' + (fails === 0 ? 'MARKETING LAYOUT PASS' : fails + ' CHECK(S) FAILED'));
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => {
  console.error(e);
  process.exit(2);
});
