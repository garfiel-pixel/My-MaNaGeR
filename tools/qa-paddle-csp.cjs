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
// Exit 0 = pass. Any failure exits non-zero.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SITE = process.env.QA_SITE || 'https://mymanagerworkspace.com';
const LIVE = process.env.MMGR_QA_NO_BROWSER !== '1';

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

    await page.goto(SITE + '/pricing', { waitUntil: 'networkidle', timeout: 60000 });
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