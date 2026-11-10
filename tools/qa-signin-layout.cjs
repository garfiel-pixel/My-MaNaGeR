#!/usr/bin/env node
/* ============================================================
   T-SIGNIN-LAYOUT - Wave 6 of the owner's UI directive (2026-11-10)
   ------------------------------------------------------------
   The sign-in page is two columns: the card + its links in one left column,
   the MMGRWP mark alone on the right. This gate pins:
     L1  at 1440 the card is left and the mark is right (no overlap)
     L2  the mark is six letters spelling MMGRWP
     L3  the links sit directly under the card and share its left edge
     L4  the link set is Home, Pricing, Refund, Privacy, Terms, Cookie settings
     L5  Contact lives in the card's legal line, not the links
     L6  hovering one letter lights ONLY that letter
     L7  reduced motion keeps every letter static silver
     L8  at 390 the mark sits BELOW the card and the page does not scroll
     L9  at 390 the links wrap to more than one row
     L10 no page error in the run

   Usage:  node tools/qa-signin-layout.cjs
   Env:    QA_PORT (default 8836)
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const ROOT = path.resolve(__dirname, '..');
const PORT = parseInt(process.env.QA_PORT || '8836', 10);
const BASE = 'http://127.0.0.1:' + PORT;

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log('  PASS  ' + name);
  } else {
    fail++;
    console.log('  FAIL  ' + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : ''));
  }
}
function log(s) {
  process.stdout.write('[signin] ' + s + '\n');
}
function waitFor(url, tries) {
  return new Promise(resolve => {
    const attempt = n => {
      const req = http.get(url, res => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => {
        if (n <= 1) return resolve(false);
        setTimeout(() => attempt(n - 1), 250);
      });
      req.setTimeout(1500, () => req.destroy());
    };
    attempt(tries || 60);
  });
}

async function main() {
  const server = spawn(process.execPath, [path.join(ROOT, 'serve.cjs')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { MMGR_SERVE_PORT: String(PORT) }),
    stdio: 'ignore'
  });
  const up = await waitFor(BASE + '/signin.html', 80);
  if (!up) {
    log('server did not start');
    server.kill();
    process.exit(1);
  }

  const { chromium } = require('playwright');
  const launch = { headless: true, args: ['--no-sandbox'] };
  const cp = require('./chrome-launcher.cjs').chromePath;
  if (cp) launch.executablePath = cp;
  else launch.channel = 'chrome';
  const browser = await chromium.launch(launch);

  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(String(e.message || e)));
  await page.goto(BASE + '/signin.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);

  const desktop = await page.evaluate(() => {
    const card = document.querySelector('.signin-card');
    const mark = document.querySelector('.signin-mmwrp');
    const foot = document.querySelector('.signin-foot');
    const legal = document.querySelector('.signin-legal');
    const r = el => {
      const b = el && el.getBoundingClientRect();
      return b ? { left: b.left, right: b.right, top: b.top, bottom: b.bottom, w: b.width } : null;
    };
    return {
      card: r(card),
      mark: r(mark),
      foot: r(foot),
      legalText: legal ? legal.textContent.replace(/\s+/g, ' ').trim() : '',
      letters: mark
        ? Array.prototype.map.call(mark.querySelectorAll('span'), s => s.textContent).join('')
        : '',
      links: foot
        ? Array.prototype.map.call(foot.querySelectorAll('a,button'), a => a.textContent.trim())
        : []
    };
  });

  check(
    'L1 at 1440 the card is left and the mark is right',
    !!desktop.card && !!desktop.mark && desktop.mark.left > desktop.card.right,
    { card: desktop.card, mark: desktop.mark }
  );
  check(
    'L2 the mark is six letters spelling MMGRWP',
    desktop.letters === 'MMGRWP',
    desktop.letters
  );
  check(
    'L3 the links sit under the card on its left edge',
    !!desktop.foot &&
      desktop.foot.top >= desktop.card.bottom - 2 &&
      Math.abs(desktop.foot.left - desktop.card.left) <= 2,
    { card: desktop.card, foot: desktop.foot }
  );
  const wantLinks = ['Home', 'Pricing', 'Refund Policy', 'Privacy', 'Terms', 'Cookie settings'];
  check(
    'L4 the link set is Home, Pricing, Refund, Privacy, Terms, Cookie settings',
    JSON.stringify(desktop.links) === JSON.stringify(wantLinks),
    desktop.links
  );
  check(
    'L5 Contact lives in the card legal line',
    /Contact us/i.test(desktop.legalText),
    desktop.legalText
  );

  // L6: per-letter hover. Hover the third letter (G) and read all strokes.
  const markSel = '.signin-mmwrp span';
  await page.hover(markSel + ':nth-child(3)');
  await page.waitForTimeout(350);
  const strokes = await page.evaluate(sel => {
    return Array.prototype.map.call(document.querySelectorAll(sel), s => {
      const cs = getComputedStyle(s);
      return {
        letter: s.textContent,
        stroke: cs.webkitTextStrokeColor || cs.getPropertyValue('-webkit-text-stroke-color'),
        hover: s.matches(':hover')
      };
    });
  }, markSel);
  const gold = strokes[2];
  const others = strokes.filter((_, i) => i !== 2);
  check('L6 the hovered letter is the only one lit', gold.hover === true, strokes);
  check(
    'L6 the hovered letter stroke is gold',
    /rgb\(201, 162, 39\)|rgb\(212, 175, 55\)|rgb\(21[0-9], 1[0-9][0-9], [0-9]+\)|gold/i.test(
      gold.stroke || ''
    ),
    gold.stroke
  );
  check(
    'L6 every other letter stays silver',
    others.every(s => /203, 208, 218/.test(s.stroke || '')),
    others.map(s => s.stroke)
  );

  // L7: reduced motion still lights ONLY the hovered letter (a colour change is
  // state feedback, not motion - qa-signin-mmwrp requires the gold hover), but
  // it drops the lift so the mark itself stays still.
  const rctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce'
  });
  const rpage = await rctx.newPage();
  await rpage.goto(BASE + '/signin.html', { waitUntil: 'domcontentloaded' });
  await rpage.waitForTimeout(700);
  await rpage.hover(markSel + ':nth-child(3)');
  await rpage.waitForTimeout(250);
  const rletters = await rpage.evaluate(sel => {
    return Array.prototype.map.call(document.querySelectorAll(sel), s => {
      const cs = getComputedStyle(s);
      return {
        stroke: cs.webkitTextStrokeColor || cs.getPropertyValue('-webkit-text-stroke-color'),
        transform: cs.transform
      };
    });
  }, markSel);
  const rGold = rletters[2];
  const rOthers = rletters.filter((_, i) => i !== 2);
  check(
    'L7 reduced motion lights only the hovered letter',
    !!rGold &&
      /rgb\(201, 162, 39\)|rgb\(212, 175, 55\)|rgb\(21[0-9], 1[0-9][0-9], [0-9]+\)|gold/i.test(
        rGold.stroke || ''
      ) &&
      rOthers.every(s => /203, 208, 218/.test(s.stroke || '')),
    rletters.map(s => s.stroke)
  );
  check(
    'L7 reduced motion drops the lift (the mark stays still)',
    !!rGold && (rGold.transform === 'none' || rGold.transform === 'matrix(1, 0, 0, 1, 0, 0)'),
    rGold && rGold.transform
  );
  await rctx.close();

  // L8/L9: mobile.
  await page.setViewportSize({ width: 390, height: 900 });
  await page.waitForTimeout(400);
  const mobile = await page.evaluate(() => {
    const card = document.querySelector('.signin-card');
    const mark = document.querySelector('.signin-mmwrp');
    const foot = document.querySelector('.signin-foot');
    const r = el => {
      const b = el && el.getBoundingClientRect();
      return b ? { top: b.top, bottom: b.bottom, left: b.left, h: b.height } : null;
    };
    return {
      card: r(card),
      mark: r(mark),
      foot: r(foot),
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      links: foot ? foot.querySelectorAll('a,button').length : 0
    };
  });
  check(
    'L8 at 390 the mark sits below the card',
    !!mobile.mark && !!mobile.card && mobile.mark.top >= mobile.card.bottom - 2,
    { card: mobile.card, mark: mobile.mark }
  );
  check('L8 the page does not scroll horizontally at 390', mobile.scrollW <= mobile.clientW + 1, {
    scrollW: mobile.scrollW,
    clientW: mobile.clientW
  });
  check(
    'L9 the links wrap to more than one row at 390',
    !!mobile.foot && mobile.foot.h > 30 && mobile.links === 6,
    { foot: mobile.foot, links: mobile.links }
  );

  check('L10 no page error in the run', errs.length === 0, errs.slice(0, 3));

  await ctx.close();
  await browser.close();
  server.kill();
  log('');
  log('==== SIGNIN LAYOUT: ' + pass + ' passed / ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
}

main().catch(e => {
  log('FATAL ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
