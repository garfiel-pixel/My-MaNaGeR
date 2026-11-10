// T-SIGNIN gate (Wave I, I-10 sign-in MMWRP outline).
//   - at 1280 the card sits left of the page centre and MMWRP is on the right
//   - the wordmark has a transparent fill and a silver stroke, gold on hover
//   - at 390 the card is centred as before and the wordmark is absent
//   - the card's inner markup is intact (h1, Google button, email disclosure)
// Runs against the shared QA server (:8765 by default, MMGR_BASE to override).

const { chromium } = require('playwright');

const BASE = process.env.MMGR_BASE || 'http://127.0.0.1:8765';
const URL = BASE + '/signin.html';

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

async function open(browser, viewport) {
  const ctx = await browser.newContext({ viewport, colorScheme: 'dark' });
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
  await page.waitForTimeout(700);
  return { ctx, page };
}

(async () => {
  let launchOpts = { headless: true };
  try {
    const cp = require('./chrome-launcher.cjs').chromePath;
    if (cp) launchOpts.executablePath = cp;
  } catch (e) {}
  const browser = await chromium.launch(launchOpts);

  // ---- Desktop 1280 ----
  {
    const { ctx, page } = await open(browser, { width: 1280, height: 900 });

    const card = await page.$('.signin-card');
    if (!card) bad('card-present', 'no .signin-card');
    else {
      const box = await card.boundingBox();
      const centerX = box.x + box.width / 2;
      if (centerX < 1280 / 2) ok('card-left-of-centre');
      else bad('card-left-of-centre', 'card centre x=' + Math.round(centerX) + ' not < 640');
    }

    const word = await page.$('.signin-mmwrp');
    if (!word) bad('wordmark-present', 'no .signin-mmwrp');
    else {
      const disp = await word.evaluate(el => getComputedStyle(el).display);
      if (disp !== 'none') ok('wordmark-visible-desktop');
      else bad('wordmark-visible-desktop', 'display=' + disp);
      const txt = await word.evaluate(el => el.textContent.trim());
      // Owner 2026-11-10: the wordmark is MMGRWP (six letters, one span each).
      if (txt === 'MMGRWP') ok('wordmark-text');
      else bad('wordmark-text', 'text=' + txt);

      const cs = await word.evaluate(el => {
        const s = getComputedStyle(el);
        return {
          color: s.color,
          stroke: s.getPropertyValue('-webkit-text-stroke-color').trim()
        };
      });
      const transparentFill = /rgba?\(0, 0, 0, 0\)|transparent/.test(cs.color);
      if (transparentFill) ok('wordmark-transparent-fill');
      else bad('wordmark-transparent-fill', 'color=' + cs.color);
      // silver, not gold: gold would be ~rgb(212,175,55). Silver is a near-neutral.
      const isSilver = /rgb\(20[0-9],\s*20[0-9],\s*21[0-9]\)|rgba\(20[0-9]/.test(cs.stroke);
      if (isSilver) ok('wordmark-silver-stroke');
      else bad('wordmark-silver-stroke', 'stroke=' + cs.stroke);

      // Owner 2026-11-10: hovering a LETTER lights only that letter, so hover a
      // span (not the container centre, which can land in the gap between
      // letters and never trigger span:hover). Read the SPAN's stroke, not the
      // container's (the container keeps its rest stroke; only the hovered
      // letter turns gold).
      const firstLetter = await word.$('span');
      if (firstLetter) await firstLetter.hover();
      else await word.hover();
      // The stroke cross-fades over 0.28s, and a loaded CI runner can still be
      // mid-fade at any fixed wait, so poll until the gold lands. Read the
      // resolved numbers rather than one literal: the computed value can come
      // back as rgb() or rgba() depending on the alpha channel.
      const isGoldStroke = s => {
        const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(s || '');
        if (!m) return false;
        const r = +m[1];
        const g = +m[2];
        const b = +m[3];
        return r >= 200 && g >= 140 && g <= 210 && b <= 110;
      };
      let hoverStroke = '';
      for (let i = 0; i < 25; i++) {
        await page.waitForTimeout(100);
        hoverStroke = await (firstLetter || word).evaluate(el =>
          getComputedStyle(el).getPropertyValue('-webkit-text-stroke-color').trim()
        );
        if (isGoldStroke(hoverStroke)) break;
      }
      if (isGoldStroke(hoverStroke)) ok('wordmark-gold-stroke-on-hover');
      else bad('wordmark-gold-stroke-on-hover', 'stroke=' + hoverStroke);
    }

    // card inner markup intact
    const inner = await page.evaluate(() => {
      const c = document.querySelector('.signin-card');
      return {
        h1: !!c.querySelector('h1'),
        google: !!c.querySelector('#google-signin-button'),
        emailToggle: !!c.querySelector('#signin-email-toggle'),
        legal: !!c.querySelector('.signin-legal')
      };
    });
    if (inner.h1 && inner.google && inner.emailToggle && inner.legal) ok('card-markup-intact');
    else bad('card-markup-intact', JSON.stringify(inner));

    await ctx.close();
  }

  // ---- Phone 390 ----
  {
    const { ctx, page } = await open(browser, { width: 390, height: 844 });
    // Owner 2026-11-10: on a narrow screen the column centres and the MMGRWP
    // mark sits BELOW the card, smaller - it is visible, not absent.
    const word = await page.$('.signin-mmwrp');
    if (!word) bad('wordmark-visible-phone', 'wordmark missing on phone');
    else {
      const disp = await word.evaluate(el => getComputedStyle(el).display);
      if (disp !== 'none') ok('wordmark-visible-phone');
      else bad('wordmark-visible-phone', 'display=' + disp);
    }
    const card = await page.$('.signin-card');
    if (card) {
      const box = await card.boundingBox();
      const centerX = box.x + box.width / 2;
      if (Math.abs(centerX - 195) < 30) ok('card-centred-phone');
      else bad('card-centred-phone', 'card centre x=' + Math.round(centerX));
    } else bad('card-present-phone', 'no card');
    await ctx.close();
  }

  await browser.close();
  console.log('\nT-SIGNIN: ' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) {
    console.log('FAILURES:\n - ' + fails.join('\n - '));
    process.exit(1);
  }
  console.log('T-SIGNIN PASS');
})().catch(e => {
  console.error('T-SIGNIN harness error:', e);
  process.exit(2);
});
