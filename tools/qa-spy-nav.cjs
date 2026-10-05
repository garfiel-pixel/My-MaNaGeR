#!/usr/bin/env node
// tools/qa-spy-nav.cjs
// Regression gate for the 2026-10-05 scroll-spy upgrade: connector line,
// travelling sub-dots, a stronger active glow, in the live gold token.
//
// It also re-asserts the two things the owner was specifically told would
// be KEPT, because those are the easiest to lose in a visual rewrite:
//   - every section label stays visible at rest (doctrine 2026-08-17 rule
//     5c: "a tracker you cannot read is not a tracker")
//   - the one-way .done lock-in progress trail still marks passed sections
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/404 \(Not Found\)/.test(m.text())) errs.push(m.text().slice(0, 90)); });
  page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message.slice(0, 80)));

  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(900);

  // ---- structure -------------------------------------------------------
  const links = await page.evaluate(() => document.querySelectorAll('.scroll-spy a').length);
  ok('six spy entries render', links === 6, 'got ' + links);

  const subPer = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.scroll-spy a')).map((a) => a.querySelectorAll('.spy-subdots i').length).join(','));
  ok('every entry carries exactly 3 sub-dots', /^(3,3,3,3,3,3)$/.test(subPer), subPer);

  const subHidden = await page.evaluate(() => {
    const s = document.querySelector('.spy-subdots');
    return s ? (s.getAttribute('aria-hidden') === 'true') : false;
  });
  ok('decorative sub-dots are hidden from assistive tech', subHidden);

  const connector = await page.evaluate(() => {
    const n = document.querySelector('.scroll-spy');
    const cs = getComputedStyle(n, '::before');
    return { w: cs.width, bg: cs.backgroundImage.slice(0, 40), content: cs.content };
  });
  ok('a connector line is drawn behind the rail',
     /gradient/.test(connector.bg) && connector.content !== 'none',
     JSON.stringify(connector));

  // ---- THE PROMISES: labels still readable, lock-in still there -------
  const labelState = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('.scroll-spy a').forEach((a) => {
      const l = a.querySelector('.spy-label');
      const cs = getComputedStyle(l);
      out.push({ text: l.textContent.trim(), opacity: Number(cs.opacity), w: Math.round(l.getBoundingClientRect().width) });
    });
    return out;
  });
  ok('every entry still shows a text label',
     labelState.length === 6 && labelState.every((l) => l.text && l.w > 0),
     labelState.map((l) => l.text).join('/'));
  ok('labels are visible at REST, not hover-only',
     labelState.every((l) => l.opacity >= 0.5),
     'min opacity=' + Math.min(...labelState.map((l) => l.opacity)));

  const railBox = await page.evaluate(() => {
    const r = document.querySelector('.scroll-spy').getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });
  ok('the rail still has real size (not collapsed)', railBox.w > 40 && railBox.h > 100, JSON.stringify(railBox));

  // ---- active state uses the live gold token, not orange/blue ---------
  // The observer watches a narrow band (rootMargin -40%/-45%) and only fires
  // when a section actually crosses it, so scroll well down the page and let
  // the observer settle. Probing at 15% of the document reliably lands in the
  // gap between two sections and reports nothing active.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight * 0.5));
  await page.waitForTimeout(1500);

  const active = await page.evaluate(() => {
    const el = document.querySelector('.scroll-spy a.active');
    if (!el) return null;
    const stick = el.querySelector('.spy-stick');
    const sub = el.querySelectorAll('.spy-subdots i');
    return {
      label: el.querySelector('.spy-label').textContent.trim(),
      stickShadow: getComputedStyle(stick).boxShadow,
      stickH: Math.round(stick.getBoundingClientRect().height),
      subLit: Array.from(sub).filter((i) => /rgb/.test(getComputedStyle(i).backgroundColor) &&
        !/rgba\(248, 250, 252/.test(getComputedStyle(i).backgroundColor)).length,
      subCount: sub.length,
    };
  });
  ok('scrolling marks a section active', !!active, active ? active.label : 'no .active found');
  if (active) {
    ok('the active stick carries a glow ring', /rgba/.test(active.stickShadow) && active.stickShadow !== 'none', active.stickShadow.slice(0, 44));
    ok('the active sub-dots light up', active.subLit === active.subCount, active.subLit + '/' + active.subCount);
  }

  // the token check: --gold-rgb is 217,107,39 -> rgba(217, 107, 39, ...)
  const usesGold = await page.evaluate(() => {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--gold-rgb').trim();
    return v;
  });
  ok('accent token is the live gold (217,107,39)', usesGold === '217,107,39', '--gold-rgb=' + usesGold);

  // ---- lock-in: passed sections stay marked done ----------------------
  const doneCount = await page.evaluate(() => document.querySelectorAll('.scroll-spy a.done').length);
  ok('the .done progress trail marks sections already passed', doneCount >= 1, doneCount + ' done');

  // ---- a dot-only regression must be caught --------------------------
  const labelsPresent = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.scroll-spy .spy-label')).filter((l) => l.textContent.trim()).length);
  ok('a dot-only rewrite would be caught here (6 labels required)', labelsPresent === 6, 'got ' + labelsPresent);

  // ---- responsive -----------------------------------------------------
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const mob = await page.evaluate(() => getComputedStyle(document.querySelector('.scroll-spy')).display);
  ok('the rail still collapses on phones', mob === 'none', 'display=' + mob);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('no horizontal overflow at 1280', overflow <= 1, 'overflow=' + overflow);

  ok('zero console errors', errs.length === 0, errs.slice(0, 2).join(' | '));

  await browser.close();
  console.log('\n' + (fails === 0 ? 'ALL CHECKS PASSED' : fails + ' CHECK(S) FAILED'));
  process.exit(fails === 0 ? 0 : 1);
})();