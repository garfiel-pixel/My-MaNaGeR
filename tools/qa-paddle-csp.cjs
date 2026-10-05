#!/usr/bin/env node
// tools/qa-paddle-csp.cjs
// Regression gate for the Paddle checkout overlay CSP (owner incident
// 2026-10-04: the overlay iframe was silently blocked, so the Upgrade button
// did nothing and no checkout could ever render).
//
// What it asserts, against the REAL served pages:
//   1. worker.js and serve.cjs declare a Paddle_CSP that is byte-identical
//      (the AGENTS rule-1 mirror requirement).
//   2. That policy is scoped to pricing.html ONLY - the strict site-wide
//      policy is still what other pages receive.
//   3. script-src keeps NO 'unsafe-inline' (the XSS gate must not be widened
//      to make checkout work).
//   4. style-src allows cdn.paddle.com and frame-src allows buy.paddle.com
//      (the two origins the overlay provably needs).
//   5. frame-ancestors is not 'none' on the Paddle policy.
//   6. LIVE BROWSER: on the real /pricing page, opening the overlay creates a
//      visible buy.paddle.com iframe and produces NO CSP violation.
//
//   7. PADDLE OWNS _ptxn (regression gate, owner incident 2026-10-05): the
//      page must NEVER remove ?_ptxn before Paddle.Initialize() has read it.
//      _ptxn is Paddle's instruction to OPEN a checkout, so deleting it kills
//      the payment form outright. This is asserted from the source (the
//      unconditional 4-key strip is gone, the return handler no longer names
//      _ptxn, and the module-scope order puts Paddle's init first), from the
//      SHIPPED bundle (the old 4-key strip must not be in what the browser
//      actually runs - AGENTS lesson 2), and in a real browser (the parameter
//      survives a normal page load).
//   8. The browser arms target /pricing on a deployed origin and
//      /pricing.html on a local one, because serve.cjs does NOT serve the
//      extensionless form (it 404s, which silently turns a live assertion
//      into a test of an error page).
//
// Exit 0 = pass. Any failure exits non-zero.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SITE = process.env.QA_SITE || 'https://mymanagerworkspace.com';
const LIVE = process.env.MMGR_QA_NO_BROWSER !== '1';
// Production 307s /pricing.html -> /pricing and carries the query string over
// (verified), so the .html form is correct on a local serve.cjs origin and
// harmless on a deployed one.
const PRICING_PATH = /^https?:\/\/(127\.0\.0\.1|localhost)/.test(SITE) ? '/pricing.html' : '/pricing';

let fails = 0;
function ok(label, cond, extra) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  [' + extra + ']' : ''));
  if (!cond) fails++;
}

// Extract a `const NAME = [ ... ].join(<anything>);` array block. The join
// separator differs per policy ('; ' here, ' ' for INLINE_SCRIPT_HASHES), so
// match `.join(` generically and slice back to the closing bracket.
function policy(src, name) {
  const start = src.indexOf('const ' + name + ' = [');
  if (start === -1) return null;
  const open = src.indexOf('[', start);
  const end = src.indexOf('.join(', open);
  if (open === -1 || end === -1) return null;
  return src.slice(open, src.lastIndexOf(']', end) + 1);
}

// Return ONE directive element (e.g. the script-src line) from a policy array
// literal. The literal's elements are comma-separated double-quoted strings,
// so a directive must be matched up to its own closing quote - matching across
// elements would let script-src checks accidentally read style-src's
// 'unsafe-inline' (which is legitimate and required).
function directive(policySrc, name) {
  const re = new RegExp('"' + name + '(?:-[a-z]+)?[^"]*"(?:\\s*\\+\\s*[A-Z_]+)?');
  const m = policySrc.match(re);
  return m ? m[0] : '';
}

(async () => {
  console.log('=== ARM 1: static policy shape ===\n');

  const workerSrc = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
  const serveSrc = fs.readFileSync(path.join(ROOT, 'serve.cjs'), 'utf8');

  const wPaddle = policy(workerSrc, 'PADDLE_CSP');
  const sPaddle = policy(serveSrc, 'PADDLE_CSP');
  const wWhisper = policy(workerSrc, 'WHISPER_CSP');
  const sWhisper = policy(serveSrc, 'WHISPER_CSP');

  ok('worker.js declares PADDLE_CSP', !!wPaddle);
  ok('serve.cjs declares PADDLE_CSP', !!sPaddle);
  ok('PADDLE_CSP identical in both mirrors', !!wPaddle && wPaddle === sPaddle);

  // Regression guard on the existing mirror too.
  ok('WHISPER_CSP still identical in both mirrors', !!wWhisper && wWhisper === sWhisper);

  if (wPaddle) {
    // The security invariant: script-src stays HASH-ONLY. This is the whole
    // reason the fix is a scoped policy rather than a global 'unsafe-inline'.
    const scriptSrc = directive(wPaddle, 'script-src');
    ok("PADDLE_CSP script-src has no 'unsafe-inline'",
       !!scriptSrc && scriptSrc.indexOf("'unsafe-inline'") === -1,
       'the hash gate must stay strict');
    ok('PADDLE_CSP script-src still appends INLINE_SCRIPT_HASHES',
       /\+\s*INLINE_SCRIPT_HASHES/.test(scriptSrc),
       'the real hashes live in that shared list');

    const styleSrc = directive(wPaddle, 'style-src');
    ok('style-src allows cdn.paddle.com', /https:\/\/cdn\.paddle\.com/.test(styleSrc),
       'paddle.css = overlay styling');

    const frameSrc = directive(wPaddle, 'frame-src');
    ok('frame-src allows buy.paddle.com', /https:\/\/buy\.paddle\.com/.test(frameSrc),
       'the overlay iframe itself - this was the blocker');

    const ancestors = directive(wPaddle, 'frame-ancestors');
    ok("frame-ancestors is not 'none'", !!ancestors && ancestors.indexOf("'none'") === -1,
       "'none' also vetoed the overlay iframe");

    // profitwell must stay out: revenue analytics, not checkout.
    ok('public.profitwell.com stays blocked', wPaddle.indexOf('profitwell') === -1);

    // The scoped policy must not have drifted from the global one in the
    // directives it shares: anything Paddle did not need stays as it was.
    const globalSrc = policy(workerSrc, 'CSP');
    ok('global CSP is untouched and still hash-only', !!globalSrc &&
       /INLINE_SCRIPT_HASHES/.test(globalSrc) &&
       directive(globalSrc, 'script-src').indexOf("'unsafe-inline'") === -1,
       'site-wide XSS gate must not be widened');
  }

  // Scoping: only pricing.html may receive PADDLE_CSP.
  const wScope = workerSrc.slice(workerSrc.indexOf('const PADDLE_CSP'));
  ok('worker.js scopes PADDLE_CSP to pricing only',
     /normalized === '\/pricing' \|\| normalized === '\/pricing\.html'/.test(
       wScope.slice(wScope.indexOf("normalized === '/pricing'") - 200)));
  ok("worker.js does not apply PADDLE_CSP to '/'",
     !/normalized === '\/pricing'\s*\|\s*normalized === '\/pricing\.html'\s*\|\s*normalized === '\/'/.test(workerSrc));
  ok('serve.cjs scopes PADDLE_CSP by pricing.html basename',
     /path\.basename\(file\) === 'pricing\.html'/.test(serveSrc));

  // ---- ARM 1b: PADDLE OWNS _ptxn (regression gate, owner 2026-10-05) -----
  // The dead-checkout bug was self-inflicted and invisible: handlePaddleReturn()
  // ran at module scope BEFORE Paddle.Initialize() and deleted ?_ptxn, which is
  // Paddle's instruction to OPEN a checkout. A buyer who returned from our own
  // Upgrade flow got a page with no payment form and no error anywhere. These
  // assertions pin the contract that fixed it.
  console.log('\n=== ARM 1b: Paddle owns _ptxn (the dead-checkout regression) ===\n');

  const marketing = fs.readFileSync(path.join(ROOT, 'js', 'marketing.js'), 'utf8');

  ok('js/marketing.js declares stripOnly(keys)', /function stripOnly\s*\(/.test(marketing));
  ok('the unconditional stripPaddleParams() is gone', !/function stripPaddleParams\s*\(/.test(marketing),
     'it deleted _ptxn before Paddle could read it');

  const hprStart = marketing.indexOf('function handlePaddleReturn');
  const hprEnd = marketing.indexOf('function pollPlanAfterCheckout');
  const hprBody = (hprStart > -1 && hprEnd > hprStart) ? marketing.slice(hprStart, hprEnd) : '';
  ok('handlePaddleReturn found in js/marketing.js', !!hprBody);
  ok('handlePaddleReturn never names _ptxn', !!hprBody && hprBody.indexOf('_ptxn') === -1,
     '_ptxn is an instruction to OPEN a checkout, never a return signal');
  ok("handlePaddleReturn still strips pdc (Paddle's own checkout error)",
     /stripOnly\(\s*\[\s*'pdc'\s*\]\s*\)/.test(hprBody));

  // Module-scope ORDER is load-bearing, not cosmetic: Paddle must be allowed to
  // read ?_ptxn before any other code touches the URL.
  const orderInit = marketing.lastIndexOf('initPaddleWhenReady();');
  const orderHandle = marketing.lastIndexOf('handlePaddleReturn();');
  ok('module scope calls initPaddleWhenReady() BEFORE handlePaddleReturn()',
     orderInit > -1 && orderHandle > -1 && orderInit < orderHandle,
     'init@' + orderInit + ' return@' + orderHandle);

  // The SHIPPED bundle is what the browser actually executes (AGENTS lesson 2),
  // so assert the fix reached it. Quotes are stripped first because minify
  // swaps them; the element ORDER is the signature that changed.
  const bundlePath = path.join(ROOT, 'dist', 'marketing-bundle.js');
  ok('dist/marketing-bundle.js exists (npm run build precedes this gate)', fs.existsSync(bundlePath));
  if (fs.existsSync(bundlePath)) {
    const norm = fs.readFileSync(bundlePath, 'utf8').replace(/["'`]/g, '').replace(/\s+/g, '');
    ok('shipped bundle has NO 4-key strip (_ptxn,plnk,_pxc,pdc)',
       norm.indexOf('[_ptxn,plnk,_pxc,pdc]') === -1);
    ok('shipped bundle strips _ptxn only AFTER checkout.completed',
       norm.indexOf('[_ptxn,plnk,_pxc]') > -1);
    ok('shipped bundle keeps the pdc-only strip', norm.indexOf('[pdc]') > -1);
  }

  if (!LIVE) {
    console.log('\n=== ARM 2 skipped (MMGR_QA_NO_BROWSER=1) ===');
    finish();
    return;
  }

  console.log('\n=== ARM 2: live browser, real Paddle overlay ===\n');
  const browser = await chromium.launch({ channel: 'chrome', args: ['--disk-cache-size=0'] });
  try {
    const page = await browser.newPage();
    const viol = [];
    page.on('console', (m) => {
      const t = m.text();
      if (/Content Security Policy/.test(t)) viol.push(t.slice(0, 160));
    });
    page.on('requestfailed', (r) => {
      const u = r.url();
      if (/paddle/.test(u)) viol.push('REQFAIL ' + u.slice(0, 90) + ' :: ' + ((r.failure() || {}).errorText || ''));
    });

    // ---- ARM 2b: _ptxn SURVIVES A REAL PAGE LOAD (regression gate) -------
    // Asserted in a BROWSER because the source alone cannot prove it: the old
    // bug was a correct-looking call order plus an unconditional strip. If
    // _ptxn is missing from the address bar after a normal load, the checkout
    // is dead again - this is the exact symptom the owner reported.
    const ptxnVal = 'txn_01m4703mawe217sswjt0g0ssky01';
    await page.goto(SITE + PRICING_PATH + '?_ptxn=' + ptxnVal, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);
    const afterPtxn = await page.evaluate(() => ({ search: location.search, paddle: typeof window.Paddle }));
    ok('_ptxn SURVIVES a real page load (the dead-checkout regression)',
       new RegExp('[?&]_ptxn=' + ptxnVal).test(afterPtxn.search),
       'location.search=' + (afterPtxn.search || '(empty - the page ate it)'));

    await page.goto(SITE + PRICING_PATH, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);

    ok('Paddle.js loaded', await page.evaluate(() => typeof window.Paddle === 'object'));
    viol.length = 0; // only violations during the overlay attempt matter

    await page.evaluate(() => {
      try { window.Paddle.Checkout.open({ transactionId: 'txn_00000000000000000000000000' }); }
      catch (e) { /* non-fatal; absence of a throw is what we assert */ }
    });
    await page.waitForTimeout(5000);

    const frames = await page.evaluate(() =>
      Array.from(document.querySelectorAll('iframe')).map((n) => ({
        src: n.src, w: n.offsetWidth, h: n.offsetHeight,
      })));

    const overlay = frames.find((f) => /buy\.paddle\.com/.test(f.src));
    ok('overlay iframe created on buy.paddle.com', !!overlay,
       frames.length ? frames.map((f) => f.src.slice(0, 50)).join(' | ') : 'no iframes at all');
    ok('overlay iframe is VISIBLE (non-zero size)',
       !!overlay && overlay.w > 0 && overlay.h > 0,
       overlay ? overlay.w + 'x' + overlay.h : 'n/a');

    ok('no CSP violation while opening checkout', viol.length === 0,
       viol.slice(0, 3).join(' ;; '));
  } finally {
    await browser.close();
  }

  finish();
})().catch((e) => {
  console.error('HARNESS ERROR:', e && e.message);
  fails++;
  finish();
});

function finish() {
  console.log('\n' + (fails === 0
    ? 'ALL CHECKS PASSED'
    : fails + ' CHECK(S) FAILED'));
  process.exit(fails === 0 ? 0 : 1);
}