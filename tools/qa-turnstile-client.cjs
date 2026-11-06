#!/usr/bin/env node
/* ============================================================
   tools/qa-turnstile-client.cjs - the Turnstile widget on the two
   surfaces added on 2026-11-05: the contact form and registration.
   ------------------------------------------------------------
   Why a browser gate: on 2026-10-15 the reviews widget silently
   never rendered (the client tested a capital-T `Turnstile` global
   that Cloudflare does not define) while every API-level check
   stayed green. The server gate can only refuse a token the client
   never sends; the mount itself needs a real page.

   What it asserts (real Chrome over serve.cjs on :8765):
     C1 contact: /api/turnstile-config says required -> exactly one
        widget is rendered into #ct-turnstile with the public sitekey.
     C2 contact: submitting carries the widget token to /api/contact.
     C3 contact: a completed submit resets the widget (tokens are
        single-use, so a second message needs a fresh challenge).
     C4 register: switching the shared auth form to "Create account"
        mounts a COMPACT widget inside the form.
     C5 register: submitting carries the token to /api/auth/register.
     C6 unconfigured: no sitekey -> no widget, no token in the body,
        and the form still submits (local dev and CI keep working).

   The Cloudflare script and the two POSTs are intercepted; no
   network leaves the machine and no real challenge is solved.

   Usage:  node serve.cjs &        (or let CI start it)
           node tools/qa-turnstile-client.cjs
   Env:    QA_BASE (default http://127.0.0.1:8765), QA_CHANNEL.
   Registry: docs/CI-TEST-COVERAGE.md -> CI row (browser-app).
   ============================================================ */
'use strict';
const { chromium } = require('playwright');

const BASE = (process.env.QA_BASE || 'http://127.0.0.1:8765').replace(/\/$/, '');
const log = s => process.stdout.write('[turnstile-client] ' + s + '\n');
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok });
  log(
    (ok ? 'PASS' : 'FAIL') +
      '  ' +
      name +
      (ok ? '' : '  <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 400))
  );
};

// A stand-in for Cloudflare's api.js. It records every render, reports the
// size and sitekey the page asked for, and hands back a token on the next
// tick exactly as the real widget does after a solved challenge.
const FAKE_TURNSTILE = `
(function () {
  window.__tsRenders = window.__tsRenders || [];
  window.__tsResets = 0;
  window.turnstile = {
    render: function (el, opts) {
      window.__tsRenders.push({
        target: el.id || el.className || '',
        size: (opts && opts.size) || '',
        sitekey: (opts && opts.sitekey) || ''
      });
      window.setTimeout(function () {
        if (opts && typeof opts.callback === 'function') {
          opts.callback('qa-client-token');
        }
      }, 0);
      return 'qa-widget';
    },
    reset: function () {
      window.__tsResets += 1;
    }
  };
  if (typeof window.mmgrTurnstileOnload === 'function') {
    window.mmgrTurnstileOnload();
  }
})();
`;

async function routeTurnstile(page, required) {
  await page.route('**/api/turnstile-config', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, sitekey: required ? 'qa-sitekey' : '', required: required })
    })
  );
  if (required) {
    await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js**', route =>
      route.fulfill({ status: 200, contentType: 'application/javascript', body: FAKE_TURNSTILE })
    );
  }
}

async function capturePost(page, path, reply) {
  const box = { body: null };
  await page.route('**' + path, async route => {
    try {
      box.body = JSON.parse(route.request().postData() || '{}');
    } catch (e) {
      box.body = {};
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(reply)
    });
  });
  return box;
}

(async () => {
  const browser = await chromium.launch({
    channel: process.env.QA_CHANNEL || 'chrome',
    args: ['--disk-cache-size=0']
  });

  // ---------- contact, configured ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await routeTurnstile(page, true);
    const posted = await capturePost(page, '/api/contact', { ok: true, sent: true });

    await page.goto(BASE + '/contact.html', { waitUntil: 'domcontentloaded' });
    let renders = [];
    try {
      await page.waitForFunction(() => window.__tsRenders && window.__tsRenders.length > 0, null, {
        timeout: 6000
      });
      renders = await page.evaluate(() => window.__tsRenders);
    } catch (e) {
      renders = await page.evaluate(() => window.__tsRenders || []);
    }
    check('C1a contact renders exactly one widget', renders.length === 1, renders);
    check(
      'C1b the widget is mounted on #ct-turnstile with the public sitekey',
      renders.length === 1 &&
        renders[0].target === 'ct-turnstile' &&
        renders[0].sitekey === 'qa-sitekey',
      renders
    );

    await page.fill('#ct-name', 'QA Visitor');
    await page.fill('#ct-email', 'qa@example.test');
    await page.fill('#ct-msg', 'Testing the contact Turnstile mount.');
    await page.click('#contact-form button[type=submit]');
    try {
      await page.waitForFunction(() => true, null, { timeout: 500 });
      await page.waitForTimeout(400);
    } catch (e) {
      /* the POST is synchronous enough for the assertion below */
    }
    check(
      'C2 the submitted body carries the widget token',
      posted.body && posted.body.turnstileToken === 'qa-client-token',
      posted.body
    );
    const resets = await page.evaluate(() => window.__tsResets || 0);
    check('C3 a completed submit resets the single-use token', resets >= 1, resets);

    await ctx.close();
  }

  // ---------- register, configured ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await routeTurnstile(page, true);
    const posted = await capturePost(page, '/api/auth/register', {
      ok: true,
      user: { sub: 'email:qa@example.test', email: 'qa@example.test', name: 'QA' },
      emailSent: false
    });

    await page.goto(BASE + '/signin.html', { waitUntil: 'domcontentloaded' });
    // The email form sits behind the page's own disclosure; open it first.
    await page.click('#signin-email-toggle');
    await page.waitForSelector('#signin-email-panel:not([hidden])', { timeout: 6000 });
    await page.waitForSelector('.email-auth-mode', { timeout: 6000 });
    await page.click('.email-auth-mode');
    let renders = [];
    try {
      await page.waitForFunction(
        () =>
          window.__tsRenders &&
          window.__tsRenders.some(r => r.target.indexOf('email-auth-turnstile') > -1),
        null,
        { timeout: 6000 }
      );
      renders = await page.evaluate(() => window.__tsRenders);
    } catch (e) {
      renders = await page.evaluate(() => window.__tsRenders || []);
    }
    const reg = renders.filter(r => r.target.indexOf('email-auth-turnstile') > -1);
    check('C4a switching to register mounts one widget', reg.length === 1, renders);
    check(
      'C4b the register widget uses the compact size',
      reg.length === 1 && reg[0].size === 'compact',
      reg
    );

    await page.fill('.email-auth-form input[type=email]', 'qa-new@example.test');
    await page.fill('.email-auth-pass', 'Correct-Horse-9!');
    await page.fill('.email-auth-name', 'QA');
    await page.click('.email-auth-submit');
    try {
      await page.waitForTimeout(700);
    } catch (e) {
      /* assertion below reads whatever arrived */
    }
    check(
      'C5 the register body carries the widget token',
      posted.body && posted.body.turnstileToken === 'qa-client-token',
      posted.body
    );

    await ctx.close();
  }

  // ---------- contact, unconfigured ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await routeTurnstile(page, false);
    const posted = await capturePost(page, '/api/contact', { ok: true, sent: true });

    await page.goto(BASE + '/contact.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    const renders = await page.evaluate(() => window.__tsRenders || []);
    check('C6a no sitekey means no widget is rendered', renders.length === 0, renders);

    await page.fill('#ct-email', 'qa@example.test');
    await page.fill('#ct-msg', 'Unconfigured deploy still works.');
    await page.click('#contact-form button[type=submit]');
    await page.waitForTimeout(500);
    check(
      'C6b the body carries no token when the challenge is off',
      posted.body && posted.body.turnstileToken === undefined,
      posted.body
    );

    await ctx.close();
  }

  await browser.close();

  const failed = results.filter(r => !r.ok).length;
  log('========================================');
  log(
    'turnstile client gate: ' + (results.length - failed) + '/' + results.length + ' checks passed'
  );
  process.exit(failed ? 1 : 0);
})().catch(err => {
  log('FATAL: ' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
