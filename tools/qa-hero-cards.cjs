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
  if (!cond) fails++;
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--disk-cache-size=0'] });

  for (const dark of [false, true]) {
    for (const w of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width: w, height: 900 } });
      const errs = [];
      page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 100)); });
      page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message.slice(0, 80)));

      await page.goto(BASE + '/index.html', { waitUntil: 'networkidle', timeout: 45000 });
      if (dark) {
        await page.evaluate(() => { document.body.classList.add('dark-mode'); });
      }
      await page.waitForTimeout(900);

      const tag = (dark ? 'dark' : 'light') + '@' + w;

      const heads = await page.evaluate(() => document.querySelectorAll('.hero-card .hc-panelhead').length);
      ok(tag + ': 3 panel headers render', heads === 3, 'got ' + heads);

      const nos = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.hc-panelno')).map((n) => n.textContent.trim()).join(','));
      ok(tag + ': panel numbers read 01,02,03', nos === '01,02,03', nos);

      const tips = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.hc-bar[data-tip]')).filter((b) => (b.getAttribute('data-tip') || '').length > 10).length);
      ok(tag + ': both bars carry a real tooltip', tips === 2, 'got ' + tips);

      // Tooltip must actually APPEAR on hover (not merely exist in markup).
      // At 390px the whole hero visual is display:none by pre-existing design,
      // so hover is meaningless there - assert structure only at that width.
      const heroShown = await page.evaluate(() =>
        getComputedStyle(document.querySelector('.hero-visual')).display !== 'none');
      if (heroShown) {
        const bar = page.locator('.hc-bar[data-tip]').first();
        await bar.hover();
        await page.waitForTimeout(450);
        const tipVis = await page.evaluate(() => {
          const b = document.querySelector('.hc-bar[data-tip]');
          const cs = getComputedStyle(b, '::after');
          return { op: cs.opacity, vis: cs.visibility, txt: cs.content.slice(0, 40) };
        });
        ok(tag + ': tooltip becomes visible on hover',
           tipVis.op === '1' && tipVis.vis === 'visible', JSON.stringify(tipVis));
      } else {
        ok(tag + ': hero visual hidden at this width (by design), hover not applicable', true);
      }

      const glow = await page.evaluate(() => {
        const b = document.querySelector('.hc-badge-glow');
        if (!b) return null;
        return getComputedStyle(b).boxShadow;
      });
      ok(tag + ': CPI badge has a glow ring', !!glow && glow !== 'none', String(glow).slice(0, 40));

      const steps = await page.evaluate(() => {
        const l = document.querySelectorAll('.hc-steps li').length;
        const d = document.querySelector('.hc-stepdot');
        const ol = document.querySelector('.hc-steps');
        const li = document.querySelector('.hc-steps li');
        return {
          l, anim: d ? getComputedStyle(d).animationName : '',
          // getComputedStyle returns the UNRESOLVED counter() function, so
          // assert the counter is wired rather than trying to read the digit.
          counterReset: ol ? getComputedStyle(ol).counterReset : '',
          counterInc: li ? getComputedStyle(li).counterIncrement : '',
          // The dot must carry NO text of its own: the number comes from the
          // counter, never from a glyph or emoji pasted into the markup.
          dotText: d ? d.textContent.trim() : 'x',
        };
      });
      ok(tag + ': 4 assistant steps render', steps.l === 4, 'got ' + steps.l);
      ok(tag + ': step dot pulses (animation applied)', /hc-pulse/.test(steps.anim), steps.anim);
      ok(tag + ': steps are numbered by CSS counter (reset + increment)',
         /hc-step/.test(steps.counterReset) && /hc-step/.test(steps.counterInc),
         steps.counterReset + ' / ' + steps.counterInc);
      ok(tag + ': no glyph or emoji baked into the step dot', steps.dotText === '', 'text=' + JSON.stringify(steps.dotText));

      // Cards must stay SOLID - the glass law is the gate we promised to keep.
      const solid = await page.evaluate(() => {
        const c = document.querySelector('.hero-card');
        const cs = getComputedStyle(c);
        return { bg: cs.backgroundColor, blur: cs.backdropFilter };
      });
      ok(tag + ': hero card is still SOLID (no backdrop blur)',
         /blur\(none\)|none/.test(solid.blur), 'backdrop=' + solid.blur);

      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok(tag + ': no horizontal overflow', overflow <= 1, 'overflow=' + overflow + 'px');

      // Ignore favicon-style 404s: they are not caused by this change and
      // every other page in the repo emits them under serve.cjs.
      const realErrs = errs.filter((e) => !/404 \(Not Found\)/.test(e));
      ok(tag + ': zero console errors', realErrs.length === 0, realErrs.slice(0, 2).join(' | '));
      await page.close();
    }
  }

  // Reduced motion must actually kill the animations.
  const rm = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 900 } });
  const p2 = await rm.newPage();
  await p2.goto(BASE + '/index.html', { waitUntil: 'networkidle', timeout: 45000 });
  await p2.waitForTimeout(600);
  const rmAnims = await p2.evaluate(() => {
    const d = document.querySelector('.hc-stepdot');
    const g = document.querySelector('.hc-badge-glow');
    return {
      step: d ? getComputedStyle(d).animationName : 'none',
      glow: g ? getComputedStyle(g).animationName : 'none',
    };
  });
  ok('prefers-reduced-motion: step pulse is OFF', rmAnims.step === 'none', rmAnims.step);
  ok('prefers-reduced-motion: badge glow pulse is OFF', rmAnims.glow === 'none', rmAnims.glow);
  await rm.close();

  // Keyboard reachability of the tooltip.
  const kb = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await kb.goto(BASE + '/index.html', { waitUntil: 'networkidle', timeout: 45000 });
  await kb.waitForTimeout(500);
  const focusable = await kb.evaluate(() => {
    const b = document.querySelector('.hc-bar[data-tip]');
    b.focus();
    return document.activeElement === b;
  });
  ok('tooltip bar is keyboard focusable', focusable);
  await kb.waitForTimeout(400);
  const kbTip = await kb.evaluate(() => getComputedStyle(document.querySelector('.hc-bar[data-tip]'), '::after').opacity);
  ok('tooltip appears on keyboard focus, not mouse only', kbTip === '1', 'opacity=' + kbTip);
  await kb.close();

  await browser.close();
  console.log('\n' + (fails === 0 ? 'ALL CHECKS PASSED' : fails + ' CHECK(S) FAILED'));
  process.exit(fails === 0 ? 0 : 1);
})();