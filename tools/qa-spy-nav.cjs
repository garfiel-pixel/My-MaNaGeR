#!/usr/bin/env node
// tools/qa-spy-nav.cjs
// Regression gate for the marketing dot rail (owner spec 2026-10-07) and the
// hero fold.
//
// REPLACED 2026-10-07. The previous version asserted on `.scroll-spy`,
// `.spy-subdots`, `.spy-stick` and `.done` - a rail that had ALREADY been
// deleted from index.html when the dot rail replaced it. It therefore ran
// green every night while the feature it guarded was broken: the big dots
// measured 0x0, the rail's markup was invalid HTML (nested <li> made the
// parser flatten the DOM, so every `>`-scoped rule matched nothing), and the
// highlight lit all fifteen subsection dots at once instead of following the
// scroll. A gate that cannot see its subject is worse than no gate.
//
// What it asserts now (all measured in a real browser):
//   - six BIG dots that actually render (>= 10px), and are bigger than the
//     small ones between them
//   - valid rail structure: the group's major dot and subsection cluster are
//     direct children of the group, no nested <li>, separator visible
//   - EXACTLY ONE active dot at a time, and it changes as the page scrolls
//     (the marker travels through big dots and small dots in page order)
//   - the hero puts its headline, sub-headline and primary CTA in the first
//     screen at 1440x900 and 1280x800, with a readable h1 scale + line-height
//   - the nav hugs the brand instead of leaving a void
//   - phones: the rail's 96px gutter is NOT reserved (content keeps the width)
//
// Runs against serve.cjs (QA_BASE, default http://127.0.0.1:8765).
const { chromium } = require('playwright');

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

  // ---- the dots actually render -----------------------------------------
  const dots = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.dot-item.major .dot')).map(d => {
      const r = d.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), disp: getComputedStyle(d).display };
    })
  );
  ok('six big dots exist', dots.length === 6, 'got ' + dots.length);
  ok(
    'every big dot renders a real box (>=10px), not an inline 0x0',
    dots.length === 6 && dots.every(d => d.w >= 10 && d.h >= 10),
    JSON.stringify(dots.slice(0, 3))
  );

  const minor = await page.evaluate(() => {
    const d = document.querySelector('.dot-item.minor .dot');
    const r = d ? d.getBoundingClientRect() : { width: 0, height: 0 };
    return Math.round(r.width);
  });
  ok(
    'the small dots between them stay smaller than the big ones',
    minor > 0 && minor < 10,
    'minor=' + minor + 'px vs major=' + (dots[0] ? dots[0].w : 0) + 'px'
  );

  // ---- valid structure (the bug that flattened the DOM) -----------------
  const structure = await page.evaluate(() => {
    const rail = document.querySelector('.dot-rail-navigation');
    const grp = document.querySelector('.dot-group');
    return {
      inGroup: document.querySelectorAll('.dot-group > .dot-item.major').length,
      clusterInGroup: document.querySelectorAll('.dot-group > .dot-group-children').length,
      clusterTag:
        grp && grp.querySelector('.dot-group-children')
          ? grp.querySelector('.dot-group-children').tagName
          : null,
      nestedLi: rail ? rail.querySelectorAll('li li').length : -1,
      liTotal: rail ? rail.querySelectorAll('li').length : -1,
      sepH: grp ? getComputedStyle(grp, '::before').height : '0px'
    };
  });
  ok(
    'the group holds its major dot as a direct child',
    structure.inGroup === 1,
    'got ' + structure.inGroup
  );
  ok(
    'the subsection cluster is a direct child and not an <li>',
    structure.clusterInGroup === 1 && structure.clusterTag === 'DIV',
    'tag=' + structure.clusterTag
  );
  ok(
    'no <li> is nested inside another <li> in the rail',
    structure.nestedLi === 0,
    'got ' + structure.nestedLi
  );
  ok(
    'the separator hairline renders a height',
    parseFloat(structure.sepH) > 4,
    'height=' + structure.sepH + ' across ' + structure.liTotal + ' items'
  );

  // ---- one marker, travelling ------------------------------------------
  const mark = async sel => {
    await page.evaluate(s => {
      const el = document.querySelector(s);
      if (el) el.scrollIntoView({ block: 'start' });
    }, sel);
    await page.waitForTimeout(420);
    return page.evaluate(() => {
      const act = document.querySelectorAll('.dot-rail-navigation .dot-item.active');
      const one = act[0];
      return {
        n: act.length,
        label: one ? one.getAttribute('data-label') : null,
        minor: one ? one.classList.contains('minor') : false,
        aria: one ? one.getAttribute('aria-current') : null
      };
    });
  };

  const stops = ['#top', '#features', '#f-wbs', '#f-kanban', '#f-ai', '#how', '#data', '#faq'];
  const seen = [];
  let exactlyOne = true;
  for (const s of stops) {
    const r = await mark(s);
    if (r.n !== 1) exactlyOne = false;
    if (r.label) seen.push(r.label);
    if (s === '#f-wbs')
      ok(
        'the marker lands on the FIRST of the tied feature cards, not the last',
        r.minor === true && r.label === 'WBS + Gantt',
        'at #f-wbs -> ' + r.label
      );
    if (s === '#how')
      ok(
        'the marker can land on a big dot',
        r.minor === false && !!r.label,
        'at #how -> ' + r.label
      );
  }
  ok('exactly ONE dot is active at every scroll position', exactlyOne);
  const distinct = Array.from(new Set(seen));
  ok(
    'the marker travels as you scroll (4+ distinct stops)',
    distinct.length >= 4,
    distinct.length + ' distinct: ' + distinct.join(' > ')
  );
  const ariaOk = await page.evaluate(
    () =>
      document.querySelectorAll('.dot-rail-navigation .dot-item.active[aria-current="true"]').length
  );
  ok('the active dot announces itself with aria-current', ariaOk === 1, 'got ' + ariaOk);

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

  // ---- phones keep their width ----------------------------------------
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
