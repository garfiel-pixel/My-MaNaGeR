#!/usr/bin/env node
// tools/qa-hero-cards.cjs
// Regression gate for the 2026-10-05 hero-card work: numbered panel headers,
// bar tooltips on hover AND keyboard focus, the CPI glow, and the pulsing
// assistant steps. Also re-asserts the two promises that work was scoped
// around: the cards stay SOLID (owner glass law, 2026-08-17) and every
// animation dies under prefers-reduced-motion.
//
// Runs against serve.cjs (QA_BASE, default http://127.0.0.1:8765).
const { chromium } = require('playwright');
const path = require('path');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:8765';
let fails = 0;
function ok(label, cond, extra) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  [' + extra + ']' : ''));
  if (!cond) {
    fails++;
  }
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--disk-cache-size=0'] });

  for (const dark of [false, true]) {
    for (const w of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width: w, height: 900 } });
      const errs = [];
      page.on('console', m => {
        if (m.type() === 'error') {
          errs.push(m.text().slice(0, 100));
        }
      });
      page.on('pageerror', e => errs.push('PAGEERROR ' + e.message.slice(0, 80)));

      await page.goto(BASE + '/index.html', { waitUntil: 'networkidle', timeout: 45000 });
      if (dark) {
        await page.evaluate(() => {
          document.body.classList.add('dark-mode');
        });
      }
      await page.waitForTimeout(900);

      const tag = (dark ? 'dark' : 'light') + '@' + w;

      const heads = await page.evaluate(
        () => document.querySelectorAll('.hero-card .hc-panelhead').length
      );
      ok(tag + ': 3 panel headers render', heads === 3, 'got ' + heads);

      const nos = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.hc-panelno'))
          .map(n => n.textContent.trim())
          .join(',')
      );
      ok(tag + ': panel numbers read 01,02,03', nos === '01,02,03', nos);

      const tips = await page.evaluate(
        () =>
          Array.from(document.querySelectorAll('.hc-bar[data-tip]')).filter(
            b => (b.getAttribute('data-tip') || '').length > 10
          ).length
      );
      ok(tag + ': both bars carry a real tooltip', tips === 2, 'got ' + tips);

      // Tooltip must actually APPEAR on hover (not merely exist in markup).
      // At 390px the whole hero visual is display:none by pre-existing design,
      // so hover is meaningless there - assert structure only at that width.
      const heroShown = await page.evaluate(
        () => getComputedStyle(document.querySelector('.hero-visual')).display !== 'none'
      );
      // CONTRACT CHANGED (commit 43e2d5b, 2026-10-12, "hero dot globe with
      // features popping out as cards"): index.html now ships these MOCK
      // cards `<div class="hero-cards" inert aria-hidden="true">` and
      // `.hero-visual.hg-live .hero-cards` hides them once the globe paints
      // its first frame (marketing-globe.js adds hg-live). They are
      // decorative placeholders behind the globe's own card layer, so a
      // pointer hover or a focus on them can never happen - asserting either
      // threw a TimeoutError ("element is not visible" / "intercepts pointer
      // events"). The gate pins the real contract instead: the cards are
      // decorative and inaccessible by design, they are hidden while the
      // globe owns the hero, and the tooltip RULE still ships for any card
      // that is genuinely interactive.
      const mock = await page.evaluate(() => {
        const c = document.querySelector('.hero-cards');
        let rule = '';
        const walk = list => {
          for (const r of list) {
            if (r.selectorText && /hc-bar\[data-tip\]/.test(r.selectorText)) {
              rule += r.selectorText + ' | ';
            }
            if (r.cssRules) {
              walk(r.cssRules);
            }
          }
        };
        for (const ss of document.styleSheets) {
          try {
            walk(ss.cssRules);
          } catch (e) {
            /* cross-origin sheet */
          }
        }
        return {
          inert: !!(c && (c.inert || c.hasAttribute('inert'))),
          aria: c ? c.getAttribute('aria-hidden') : null,
          hidden: !!c && getComputedStyle(c).visibility === 'hidden',
          live: !!document.querySelector('.hero-visual.hg-live'),
          rule
        };
      });
      ok(
        tag + ': mock cards are decorative (inert + aria-hidden)',
        mock.inert && mock.aria === 'true',
        JSON.stringify(mock)
      );
      ok(
        tag + ': tooltip rule for the hero bars still ships',
        /:hover/.test(mock.rule) && /::after/.test(mock.rule),
        mock.rule.slice(0, 90)
      );
      if (mock.live) {
        ok(
          tag + ': mock cards hidden while the live globe owns the hero',
          mock.hidden,
          'hidden=' + mock.hidden
        );
      } else if (heroShown) {
        ok(
          tag + ': hero shown, globe not live (mock cards stay as drawn)',
          !mock.hidden,
          'hidden=' + mock.hidden
        );
      } else {
        ok(tag + ': hero visual hidden at this width (by design)', true);
      }

      const glow = await page.evaluate(() => {
        const b = document.querySelector('.hc-badge-glow');
        if (!b) {
          return null;
        }
        return getComputedStyle(b).boxShadow;
      });
      ok(tag + ': CPI badge has a glow ring', !!glow && glow !== 'none', String(glow).slice(0, 40));

      const steps = await page.evaluate(() => {
        const l = document.querySelectorAll('.hc-steps li').length;
        const d = document.querySelector('.hc-stepdot');
        const ol = document.querySelector('.hc-steps');
        const li = document.querySelector('.hc-steps li');
        return {
          l,
          anim: d ? getComputedStyle(d).animationName : '',
          // getComputedStyle returns the UNRESOLVED counter() function, so
          // assert the counter is wired rather than trying to read the digit.
          counterReset: ol ? getComputedStyle(ol).counterReset : '',
          counterInc: li ? getComputedStyle(li).counterIncrement : '',
          // The dot must carry NO text of its own: the number comes from the
          // counter, never from a glyph or emoji pasted into the markup.
          dotText: d ? d.textContent.trim() : 'x'
        };
      });
      ok(tag + ': 4 assistant steps render', steps.l === 4, 'got ' + steps.l);
      ok(tag + ': step dot pulses (animation applied)', /hc-pulse/.test(steps.anim), steps.anim);
      ok(
        tag + ': steps are numbered by CSS counter (reset + increment)',
        /hc-step/.test(steps.counterReset) && /hc-step/.test(steps.counterInc),
        steps.counterReset + ' / ' + steps.counterInc
      );
      ok(
        tag + ': no glyph or emoji baked into the step dot',
        steps.dotText === '',
        'text=' + JSON.stringify(steps.dotText)
      );

      // Cards must stay SOLID - the glass law is the gate we promised to keep.
      const solid = await page.evaluate(() => {
        const c = document.querySelector('.hero-card');
        const cs = getComputedStyle(c);
        return { bg: cs.backgroundColor, blur: cs.backdropFilter };
      });
      ok(
        tag + ': hero card is still SOLID (no backdrop blur)',
        /blur\(none\)|none/.test(solid.blur),
        'backdrop=' + solid.blur
      );

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      ok(tag + ': no horizontal overflow', overflow <= 1, 'overflow=' + overflow + 'px');

      // Ignore favicon-style 404s: they are not caused by this change and
      // every other page in the repo emits them under serve.cjs.
      const realErrs = errs.filter(e => !/404 \(Not Found\)/.test(e));
      ok(tag + ': zero console errors', realErrs.length === 0, realErrs.slice(0, 2).join(' | '));
      await page.close();
    }
  }

  // Reduced motion must actually kill the animations.
  const rm = await browser.newContext({
    reducedMotion: 'reduce',
    viewport: { width: 1280, height: 900 }
  });
  const p2 = await rm.newPage();
  await p2.goto(BASE + '/index.html', { waitUntil: 'networkidle', timeout: 45000 });
  await p2.waitForTimeout(600);
  const rmAnims = await p2.evaluate(() => {
    const d = document.querySelector('.hc-stepdot');
    const g = document.querySelector('.hc-badge-glow');
    return {
      step: d ? getComputedStyle(d).animationName : 'none',
      glow: g ? getComputedStyle(g).animationName : 'none'
    };
  });
  ok('prefers-reduced-motion: step pulse is OFF', rmAnims.step === 'none', rmAnims.step);
  ok('prefers-reduced-motion: badge glow pulse is OFF', rmAnims.glow === 'none', rmAnims.glow);

  // With motion reduced the globe never starts (marketing-globe.js returns
  // 'reduced-motion' before its first frame), so hg-live is never added and
  // the MOCK cards stay drawn. That is the one state where they are on
  // screen - but they are still `inert aria-hidden` in index.html, so they
  // are deliberately unreachable by pointer and by keyboard. Assert both
  // halves: visible when the globe does not run, and decorative anyway.
  const rmCards = await p2.evaluate(() => {
    const c = document.querySelector('.hero-cards');
    return {
      shown: getComputedStyle(c).visibility !== 'hidden',
      live: !!document.querySelector('.hero-visual.hg-live'),
      inert: !!(c.inert || c.hasAttribute('inert')),
      aria: c.getAttribute('aria-hidden')
    };
  });
  ok(
    'reduced motion: mock hero cards are shown (globe never takes over)',
    rmCards.shown && !rmCards.live,
    JSON.stringify(rmCards)
  );
  ok(
    'reduced motion: mock cards stay decorative (inert + aria-hidden)',
    rmCards.inert && rmCards.aria === 'true',
    JSON.stringify(rmCards)
  );
  await rm.close();

  await browser.close();
  console.log('\n' + (fails === 0 ? 'ALL CHECKS PASSED' : fails + ' CHECK(S) FAILED'));
  process.exit(fails === 0 ? 0 : 1);
})();
