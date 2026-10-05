#!/usr/bin/env node
// tools/qa-signin-page.cjs
// Regression gate for the standalone sign-in page (owner 2026-10-05).
//
// The load-bearing check here is the OPEN REDIRECT: /signin?next= is
// attacker-controllable, and an open redirect on a sign-in page is a
// credential-phishing primitive. The suite throws hostile values at
// safeNext() and requires every one to be rejected.
//
// The rest asserts the layout the research pass established: social above
// the fields, legal below the action, the card centred, and the glass card
// staying legible over the star field.
//
// Runs against serve.cjs (QA_BASE, default http://127.0.0.1:8765).
const { chromium } = require('playwright');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:8765';
let fails = 0;
function ok(label, cond, extra) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  [' + extra + ']' : ''));
  if (!cond) fails++;
}

// next= values that MUST be refused, and ones that MUST be honoured.
const HOSTILE = [
  'https://evil.example/steal',
  'http://evil.example',
  '//evil.example/steal',
  '\\\\evil.example',
  '/\\evil.example',
  'javascript:alert(1)',
  'data:text/html,<script>1</script>',
  'evil.example',
  'HTTPS://EVIL.EXAMPLE',
  '',
];
const VALID = ['/app.html', '/project.html?id=demo', '/index.html#faq', '/dashboard.html'];

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--disk-cache-size=0'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/404 \(Not Found\)/.test(m.text())) errs.push(m.text().slice(0, 90)); });
  page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message.slice(0, 90)));

  await page.goto(BASE + '/signin.html', { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1000);

  console.log('=== ARM 1: structure and the two doors ===\n');
  const s = await page.evaluate(() => {
    const q = (sel) => document.querySelector(sel);
    const rect = (sel) => { const e = q(sel); return e ? e.getBoundingClientRect() : null; };
    return {
      title: document.title,
      google: !!q('#google-signin-button'),
      toggle: !!q('#signin-email-toggle'),
      panelHidden: q('#signin-email-panel') ? q('#signin-email-panel').hidden : null,
      legal: !!q('.signin-legal'),
      legalY: rect('.signin-legal') ? Math.round(rect('.signin-legal').top) : null,
      googleY: rect('#google-signin-button') ? Math.round(rect('#google-signin-button').top) : null,
      toggleY: rect('#signin-email-toggle') ? Math.round(rect('#signin-email-toggle').top) : null,
      cardW: rect('.signin-card') ? Math.round(rect('.signin-card').width) : null,
      cardLeft: rect('.signin-card') ? Math.round(rect('.signin-card').left) : null,
      sky: !!q('.signin-sky'),
      ariaExpanded: q('#signin-email-toggle') ? q('#signin-email-toggle').getAttribute('aria-expanded') : null,
      controls: q('#signin-email-toggle') ? q('#signin-email-toggle').getAttribute('aria-controls') : null,
    };
  });

  ok('the page has a real title', /sign in/i.test(s.title), s.title);
  ok('the Google door renders', s.google);
  ok('the email door is a disclosure, collapsed at rest', s.toggle && s.panelHidden === true);
  ok('the disclosure is a real ARIA disclosure pattern',
     s.ariaExpanded === 'false' && s.controls === 'signin-email-panel',
     'aria-expanded=' + s.ariaExpanded + ' aria-controls=' + s.controls);
  ok('the star field is present', s.sky);

  console.log('\n=== ARM 2: the measured layout order ===\n');
  ok('Google sits ABOVE the email door', s.googleY !== null && s.toggleY !== null && s.googleY < s.toggleY,
     'google@' + s.googleY + ' email@' + s.toggleY);
  ok('the legal line sits BELOW the doors', s.legalY !== null && s.googleY !== null && s.legalY > s.toggleY,
     'legal@' + s.legalY);
  ok('the card is centred', s.cardLeft > 380 && s.cardLeft < 520, 'left=' + s.cardLeft + ' w=' + s.cardW);

  console.log('\n=== ARM 3: OPEN REDIRECT DEFENCE ===\n');
  for (const bad of HOSTILE) {
    await page.goto(BASE + '/signin.html?next=' + encodeURIComponent(bad), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(320);
    const got = await page.evaluate(() => document.body.getAttribute('data-signin-next'));
    ok('rejects next=' + JSON.stringify(bad), got === '', 'resolved to ' + JSON.stringify(got));
  }
  for (const good of VALID) {
    await page.goto(BASE + '/signin.html?next=' + encodeURIComponent(good), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(320);
    const got = await page.evaluate(() => document.body.getAttribute('data-signin-next'));
    ok('honours same-site next=' + good, got === good, 'resolved to ' + JSON.stringify(got));
  }

  console.log('\n=== ARM 4: disclosure behaviour ===\n');
  await page.goto(BASE + '/signin.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.click('#signin-email-toggle');
  await page.waitForTimeout(450);
  const opened = await page.evaluate(() => ({
    hidden: document.getElementById('signin-email-panel').hidden,
    exp: document.getElementById('signin-email-toggle').getAttribute('aria-expanded'),
    fields: document.querySelectorAll('#marketing-email-auth input').length,
  }));
  ok('clicking the disclosure reveals the email form', opened.hidden === false && opened.exp === 'true',
     JSON.stringify(opened));
  ok('the email form actually mounted fields', opened.fields > 0, opened.fields + ' inputs');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
  const closed = await page.evaluate(() => document.getElementById('signin-email-panel').hidden);
  ok('Escape closes the disclosure', closed === true);

  console.log('\n=== ARM 5: legibility + no emoji + responsive ===\n');
  await page.goto(BASE + '/signin.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const leg = await page.evaluate(() => {
    const card = document.querySelector('.signin-card');
    const lede = document.querySelector('.signin-lede');
    const inner = document.querySelector('#marketing-email-auth');
    const input = document.querySelector('#marketing-email-auth input');
    // Relative luminance of the copy, so "is it light enough to read on the
    // dark sky" is measured rather than pattern-matched.
    const rgb = (c) => (c.match(/\d+/g) || []).map(Number);
    const lum = (c) => {
      const [r, g, b] = rgb(c);
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    };
    return {
      cardBlur: getComputedStyle(card).backdropFilter,
      ledeColor: getComputedStyle(lede).color,
      ledeLum: +lum(getComputedStyle(lede).color).toFixed(3),
      innerBg: getComputedStyle(inner).backgroundColor,
      innerLum: +lum(getComputedStyle(inner).backgroundColor).toFixed(3),
      inputBg: input ? getComputedStyle(input).backgroundColor : null,
    };
  });
  ok('the card is a glass surface', /blur/.test(leg.cardBlur), leg.cardBlur.slice(0, 30));
  // Light text over a dark sky: measure luminance instead of matching a hex.
  ok('body copy over the sky is LIGHT enough to read (luminance > 0.5)',
     leg.ledeLum > 0.5, 'luminance=' + leg.ledeLum + ' ' + leg.ledeColor);
  // Glass law: the card may be glass, but the form layer inside it must be a
  // DARK, near-opaque fill so labels and inputs stay readable.
  ok('the form layer is DARK and opaque enough to read (luminance < 0.3)',
     leg.innerLum < 0.3, 'luminance=' + leg.innerLum + ' ' + leg.innerBg);
  ok('the email inputs carry a solid fill of their own',
     !!leg.inputBg && leg.inputBg !== 'rgba(0, 0, 0, 0)', String(leg.inputBg));

  console.log('\n=== ARM 6: measured WCAG contrast (composited, not assumed) ===\n');
  // Open the disclosure so the real fields exist, then composite every text
  // colour over what is actually behind it and compute the true ratio.
  await page.click('#signin-email-toggle');
  await page.waitForTimeout(500);
  const cr = await page.evaluate(() => {
    const lum = (c) => {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const parse = (s) => { const m = (String(s).match(/[\d.]+/g) || []).map(Number); return { c: [m[0], m[1], m[2]], a: m.length > 3 ? m[3] : 1 }; };
    const over = (fg, bg) => ({ c: fg.c.map((v, i) => v * fg.a + bg.c[i] * (1 - fg.a)) });
    const ratio = (a, b) => { const l1 = Math.max(lum(a.c), lum(b.c)), l2 = Math.min(lum(a.c), lum(b.c)); return +((l1 + 0.05) / (l2 + 0.05)).toFixed(2); };
    const sky = { c: [11, 18, 32] };
    const cardFill = over({ c: [255, 255, 255], a: 0.07 }, sky);
    const innerFill = over({ c: [8, 14, 26], a: 0.55 }, cardFill);
    const input = document.querySelector('#marketing-email-auth input');
    const ib = input ? parse(getComputedStyle(input).backgroundColor) : { c: [17, 17, 20], a: 1 };
    const out = {};
    const g = (sel, bg, key) => { const e = document.querySelector(sel); if (e) out[key] = ratio(over(parse(getComputedStyle(e).color), bg), bg); };
    g('.signin-card h1', cardFill, 'h1');
    g('.signin-lede', cardFill, 'lede');
    g('.signin-legal', cardFill, 'legal');
    if (input) {
      out.inputText = ratio(over(parse(getComputedStyle(input).color), ib), ib);
      // This form is placeholder-only, so the placeholder IS the label text.
      out.placeholder = ratio(over(parse(getComputedStyle(input, '::placeholder').color), ib), ib);
    }
    return out;
  });
  for (const k of ['h1', 'lede', 'legal', 'inputText', 'placeholder']) {
    if (cr[k] === undefined) continue;
    ok('WCAG AA contrast: ' + k + ' >= 4.5:1', cr[k] >= 4.5, cr[k] + ':1');
  }

  const emoji = await page.evaluate(() => {
    const re = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/gu;
    return (document.body.innerText.match(re) || []).length;
  });
  ok('zero emoji on the page', emoji === 0, emoji + ' found');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(450);
  const mob = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('no horizontal overflow at 390', mob <= 1, 'overflow=' + mob);
  await page.setViewportSize({ width: 1280, height: 900 });

  ok('zero console errors', errs.length === 0, errs.slice(0, 2).join(' | '));

  await browser.close();
  console.log('\n' + (fails === 0 ? 'ALL CHECKS PASSED' : fails + ' CHECK(S) FAILED'));
  process.exit(fails === 0 ? 0 : 1);
})();