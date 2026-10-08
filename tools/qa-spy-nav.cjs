#!/usr/bin/env node
// tools/qa-spy-nav.cjs
// Regression gate for the marketing dot rail (owner spec 2026-10-07) and the
// hero fold.
//
// RAIL COVERAGE: the dot rail's big-dot count, nesting, active-dot tracking,
// small-dot generation, label/line absence and 96px-gutter assertions moved to
// tools/qa-marketing-layout.cjs which measures them at real desktop sizes
// (1200-2560px) via Playwright. This file keeps the hero-fold and
// nav-hugs-brand assertions that qa-marketing-layout.cjs does not cover.
//
// What it asserts now (all measured in a real browser):
//   - the hero puts its headline, sub-headline and primary CTA in the first
//     screen at 1440x900 and 1280x800, with a readable h1 scale + line-height
//   - the nav hugs the brand instead of leaving a void
//   - phones: the rail is hidden and <main> is full-bleed (no gutter)
//
// Runs against serve.cjs (QA_BASE, default http://127.0.0.1:8765).
const { chromium } = require('chromium');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:8765';
let fails = 0;
function ok(label, cond, extra) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  [' + extra + ']' : ''));
  if (!cond) fails++;
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--disk-cache-size=0'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('console', m => {
    if (m.type() === 'error' && !/404 \(Not Found\)/.test(m.text()))
      errs.push(m.text().slice(0, 90));
  });
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message.slice(0, 80)));

  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(900);

  // ---- the hero fits the first screen ----------------------------------
  const foldAt = async (w, h) => {
    await page.setViewportSize({ width: w, height: h });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    return page.evaluate(() => {
      const q = s => document.querySelector(s);
      const box = s => {
        const el = q(s);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
      };
      const h1 = q('.hero h1');
      const cs = h1 ? getComputedStyle(h1) : null;
      return {
        vh: window.innerHeight,
        h1: box('.hero h1'),
        sub: box('.hero-sub'),
        cta: box('.hero-cta .btn'),
        heroH: q('.hero') ? Math.round(q('.hero').getBoundingClientRect().height) : null,
        h1px: cs ? parseFloat(cs.fontSize) : 0,
        lhRatio: cs ? +(parseFloat(cs.lineHeight) / parseFloat(cs.fontSize)).toFixed(2) : 0
      };
    });
  };

  for (const [w, h] of [
    [1440, 900],
    [1280, 800]
  ]) {
    const f = await foldAt(w, h);
    ok(
      `@${w}: the headline starts in the first screen`,
      f.h1 && f.h1.top <= 260,
      'h1 top=' + (f.h1 && f.h1.top)
    );
    ok(
      `@${w}: the sub-headline is not cut by the fold`,
      f.sub && f.sub.bottom <= f.vh,
      'sub bottom=' + (f.sub && f.sub.bottom) + ' vs ' + f.vh
    );
    ok(
      `@${w}: the Get Started button is above the fold`,
      f.cta && f.cta.bottom <= f.vh,
      'cta bottom=' + (f.cta && f.cta.bottom) + ' vs ' + f.vh
    );
  }
  const big = await foldAt(1440, 900);
  ok('the h1 is a headline, not body copy', big.h1px >= 44, 'font-size=' + big.h1px + 'px');
  ok('the h1 line-height clears its own descenders', big.lhRatio >= 1.1, 'ratio=' + big.lhRatio);
  ok('the hero is no longer twice the viewport', big.heroH <= 1300, 'hero height=' + big.heroH);

  // ---- the nav hugs the brand ------------------------------------------
  const nav = await page.evaluate(() => {
    const b = document.querySelector('.site-header .brand').getBoundingClientRect();
    const n = document.querySelector('.site-nav a.nav-link').getBoundingClientRect();
    return Math.round(n.left - b.right);
  });
  ok('the nav sits next to the brand (no 300px void)', nav <= 60, 'gap=' + nav + 'px');

  // ---- phones: rail hidden, main full-bleed ---------------------------
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  const mob = await page.evaluate(() => {
    const m = document.querySelector('main');
    return {
      ml: m ? getComputedStyle(m).marginLeft : null,
      mw: m ? Math.round(m.getBoundingClientRect().width) : 0,
      vw: window.innerWidth,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      rail: getComputedStyle(document.querySelector('.dot-rail-navigation')).display
    };
  });
  ok('the rail is hidden on phones', mob.rail === 'none', 'display=' + mob.rail);
  ok('phones no longer pay the rail gutter', mob.ml === '0px', 'main margin-left=' + mob.ml);
  ok(
    'phone content keeps the width it should',
    mob.mw >= mob.vw * 0.98,
    'main=' + mob.mw + 'px of ' + mob.vw + 'px'
  );
  ok('no horizontal overflow on phones', mob.overflow <= 1, 'overflow=' + mob.overflow);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
  ok('zero console errors', errs.length === 0, errs.slice(0, 2).join(' | '));

  await browser.close();
  console.log('\n' + (fails === 0 ? 'ALL CHECKS PASSED' : fails + ' CHECK(S) FAILED'));
  process.exit(fails === 0 ? 0 : 1);
})();
