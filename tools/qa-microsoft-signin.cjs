#!/usr/bin/env node
/* ============================================================
   MICROSOFT SIGN-IN DOOR browser verification (owner 2026-11-22)

   The Worker runs the whole OAuth dance server-side
   (/api/auth/microsoft/start), so this page keeps its no-inline-script
   property and the CSP hash set is untouched. This gate proves the door is
   actually wired into the shipped page rather than stranded on a branch:

     MS1  the Microsoft link renders under the Google door, as a real link
     MS2  it points at the Worker start route and carries a same-site ?next=
     MS3  a hostile ?next= is NOT propagated into the Microsoft href
     MS4  the shared sprite icon resolves (SVG-only, no emoji glyph)
     MS5  the refusal status line is present and hidden at rest, and a
          ?microsoft=failed / =unavailable answer is shown in plain words
     MS6  no page error, no emoji, no horizontal overflow at 390

   Runs against serve.cjs (QA_BASE, default http://127.0.0.1:8765).
   Registry: docs/CI-TEST-COVERAGE.md -> CI row (browser-calc).
   ============================================================ */
'use strict';
const { chromium } = require('playwright');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:8765';
let fails = 0;
function ok(label, cond, extra) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  [' + extra + ']' : ''));
  if (!cond) {
    fails++;
  }
}

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--disk-cache-size=0'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  await page.route('**/accounts.google.com/gsi/client*', r =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'window.google={accounts:{id:{initialize:function(){},renderButton:function(){},prompt:function(){}}}};'
    })
  );
  page.on('console', m => {
    if (m.type() === 'error' && !/404 \(Not Found\)/.test(m.text())) {
      errs.push(m.text().slice(0, 90));
    }
  });
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message.slice(0, 90)));

  // --- ARM 1: the door renders, under the Google door, as a link ---
  await page.goto(BASE + '/signin.html?next=/app.html', {
    waitUntil: 'networkidle',
    timeout: 45000
  });
  await page.waitForTimeout(500);
  const s = await page.evaluate(() => {
    const q = sel => document.querySelector(sel);
    const rect = sel => (q(sel) ? q(sel).getBoundingClientRect() : null);
    const ms = q('#signin-microsoft');
    return {
      tag: ms ? ms.tagName.toLowerCase() : null,
      href: ms ? ms.getAttribute('href') : null,
      msY: rect('#signin-microsoft') ? Math.round(rect('#signin-microsoft').top) : null,
      gY: rect('#google-signin-button') ? Math.round(rect('#google-signin-button').top) : null,
      label: ms ? ms.textContent.trim() : null,
      iconUse: ms ? ms.querySelector('use') && ms.querySelector('use').getAttribute('href') : null,
      statusExists: !!q('#signin-microsoft-status'),
      statusHidden: q('#signin-microsoft-status') ? q('#signin-microsoft-status').hidden : null,
      inlineScripts: document.querySelectorAll('script:not([src])').length
    };
  });
  console.log('=== ARM 1: the Microsoft door ===\n');
  ok('MS1 Microsoft link renders', s.tag === 'a', 'tag=' + s.tag);
  ok('MS1 named "Sign in with Microsoft"', /microsoft/i.test(s.label || ''), s.label);
  ok(
    'MS1 sits below the Google door',
    s.msY !== null && s.gY !== null && s.msY > s.gY,
    'ms@' + s.msY + ' g@' + s.gY
  );
  ok(
    'MS2 href is the Worker start route',
    /^\/api\/auth\/microsoft\/start/.test(s.href || ''),
    s.href
  );
  ok(
    'MS2 same-site ?next=/app.html is carried',
    /next=%2Fapp\.html|next=\/app\.html/.test(s.href || ''),
    s.href
  );
  ok('MS4 shared sprite icon resolves', /mmgr-icons\.svg#i-ms/.test(s.iconUse || ''), s.iconUse);
  ok('MS5 status line present and hidden at rest', s.statusExists && s.statusHidden === true);
  ok(
    'no inline script added (CSP hashes untouched)',
    s.inlineScripts === 0,
    'inline=' + s.inlineScripts
  );

  // --- ARM 2: hostile ?next= is not propagated into the Microsoft href ---
  await page.goto(BASE + '/signin.html?next=//evil.example/steal', {
    waitUntil: 'domcontentloaded',
    timeout: 45000
  });
  await page.waitForTimeout(400);
  const hostile = await page.evaluate(() => {
    const ms = document.querySelector('#signin-microsoft');
    return ms ? ms.getAttribute('href') : null;
  });
  ok('MS3 hostile ?next= is refused in the href', !/evil\.example/.test(hostile || ''), hostile);

  // --- ARM 3: refusal status is shown in plain words ---
  for (const state of ['failed', 'unavailable']) {
    await page.goto(BASE + '/signin.html?microsoft=' + state, {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    });
    await page.waitForTimeout(400);
    const status = await page.evaluate(() => {
      const e = document.querySelector('#signin-microsoft-status');
      return e ? { hidden: e.hidden, text: e.textContent.trim() } : null;
    });
    ok(
      'MS5 ?microsoft=' + state + ' shows a plain message',
      status && status.hidden === false && status.text.length > 0,
      status && status.text
    );
    ok(
      'MS5 ?microsoft=' + state + ' message does not leak a provider error',
      status && !/error|401|403|invalid/i.test(status.text),
      status && status.text
    );
  }

  // --- ARM 4: no emoji, no overflow at 390, no page error ---
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE + '/signin.html', { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(400);
  const responsive = await page.evaluate(() => ({
    text: document.body.innerText || '',
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
  }));
  ok('MS6 zero emoji on the page', !EMOJI.test(responsive.text));
  ok(
    'MS6 no horizontal overflow at 390',
    responsive.overflow <= 1,
    'overflow=' + responsive.overflow
  );
  ok('MS6 zero page errors', errs.length === 0, errs.join(' | '));

  await browser.close();
  console.log('\n========================================');
  console.log(fails ? fails + ' check(s) FAILED' : 'ALL CHECKS PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => {
  console.error('HARNESS ERROR', e);
  process.exit(2);
});
