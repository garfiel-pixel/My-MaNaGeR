#!/usr/bin/env node
/* ============================================================
   tools/qa-operator.cjs - private /operator console gate (2026-11-25)
   ------------------------------------------------------------
   The operator console is a private owner-only page. The Worker
   refuses to serve it unless the request is signed in as the owner
   (proven in test/operator-gate.test.mjs). THIS harness proves the
   second layer in a real browser: even once the page is delivered,
   it shows only a lock screen until a 20-digit code emailed to the
   fixed operator inbox is redeemed, and the console data appears
   only after that.

   The page is served directly by serve.cjs here (no Worker in front),
   so the account gate is out of scope for this run - it is unit-tested
   against the real worker export. Every operator API call is stubbed so
   the arm needs no account, no D1 and no email.

   Checks:
     O1  on load, the lock screen is visible and the console is hidden
     O2  the console never becomes visible without a redeemed code
     O3  "Email me a sign-in code" reveals the 20-digit entry form
     O4  a code that is not 20 digits is refused client-side, console stays hidden
     O5  a 20-digit code is submitted to /api/admin/signin/verify
     O6  a valid code reveals the console and hides the lock
     O7  the console loads cloud projects and subscriptions with the token
     O8  sign out returns to the lock and clears the stored token

   Usage:  node tools/qa-operator.cjs
   Registry: docs/CI-TEST-COVERAGE.md -> CI row; wired in ci.yml T4.
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const BASE = (process.env.QA_BASE || 'http://127.0.0.1:8765').replace(/\/$/, '');
const log = s => process.stdout.write('[operator] ' + s + '\n');
const delay = ms => new Promise(r => setTimeout(r, ms));
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

function resolvePlaywright() {
  try {
    return require('playwright');
  } catch (e) {
    const alt = path.join(ROOT, 'node_modules', 'playwright');
    if (fs.existsSync(alt)) {
      return require(alt);
    }
    throw e;
  }
}

const VALID_CODE = '12345678901234567890';

(async () => {
  let srv = null;
  try {
    const h = await fetch(BASE + '/operator.html');
    if (!h.ok) {
      throw new Error('not ok');
    }
  } catch (e) {
    log('starting serve.cjs for this run');
    srv = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
    for (let i = 0; i < 40; i++) {
      await delay(1000);
      try {
        const h = await fetch(BASE + '/operator.html');
        if (h.ok) {
          break;
        }
      } catch (err) {
        /* keep waiting */
      }
    }
  }

  const { chromium } = resolvePlaywright();
  let browser = null;
  try {
    let chromePath;
    try {
      chromePath = require('./chrome-launcher.cjs').chromePath || undefined;
    } catch (e) {}
    if (chromePath && !path.isAbsolute(chromePath)) {
      try {
        chromePath =
          require('child_process')
            .execSync((process.platform === 'win32' ? 'where' : 'command -v') + ' ' + chromePath, {
              stdio: ['ignore', 'pipe', 'ignore']
            })
            .toString()
            .trim()
            .split(/\r?\n/)[0] || undefined;
      } catch (e) {
        chromePath = undefined;
      }
    }
    if (chromePath && !fs.existsSync(chromePath)) {
      chromePath = undefined;
    }
    browser = await chromium.launch({
      executablePath: chromePath,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disk-cache-size=0']
    });

    const page = await browser.newPage();

    // Stub every operator API so the arm needs no account / D1 / email.
    await page.route('**/api/admin/signin/request', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, emailMasked: 'a***@mymanagerworkspace.com' })
      })
    );
    await page.route('**/api/admin/signin/verify', route => {
      const body = route.request().postDataJSON ? route.request().postDataJSON() : {};
      const code = (body && body.code) || '';
      if (code === VALID_CODE) {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, token: 'stub-operator-token' })
        });
      } else {
        route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, error: 'that code was not accepted' })
        });
      }
    });
    await page.route('**/api/admin/signin/session', route => {
      const hdr = route.request().headers()['x-admin-session'] || '';
      route.fulfill({
        status: hdr === 'stub-operator-token' ? 200 : 401,
        contentType: 'application/json',
        body: JSON.stringify(hdr === 'stub-operator-token' ? { ok: true } : { ok: false })
      });
    });
    await page.route('**/api/cloud/admin/projects', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          projects: [
            {
              projectId: 'op-1',
              label: 'Operator Project',
              linkedName: 'owner@example.com',
              hasSnapshot: true
            }
          ]
        })
      })
    );
    let recoverHeader = '';
    await page.route('**/api/cloud/projects/op-1/recover', route => {
      const req = route.request();
      recoverHeader = req.headers()['x-admin-session'] || '';
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, delivered: 'email', to: 'owner@example.com' })
      });
    });
    await page.route('**/api/admin/billing/subscriptions', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, cancellable: false, subscriptions: [] })
      })
    );
    await page.route('**/api/admin/signout', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true })
      })
    );

    const state = () =>
      page.evaluate(() => ({
        lock: !document.getElementById('op-lock').hidden,
        console: !document.getElementById('op-console').hidden,
        token: sessionStorage.getItem('mmgr_admin_token') || ''
      }));

    await page.goto(BASE + '/operator.html', { waitUntil: 'domcontentloaded' });
    await delay(600);

    // O1: locked on load, console hidden.
    let s = await state();
    check(
      'O1 the page opens locked (console hidden, no token)',
      s.lock === true && s.console === false && s.token === '',
      s
    );

    // O2: no amount of waiting reveals the console without a code.
    await delay(700);
    s = await state();
    check(
      'O2 the console stays hidden without a redeemed code',
      s.console === false && s.lock === true,
      s
    );

    // O3: requesting a code reveals the 20-digit entry form.
    await page.click('#op-send');
    await page.waitForSelector('#op-verify-form:not([hidden])', { timeout: 6000 }).catch(() => {});
    const formShown = await page.evaluate(() => {
      const f = document.getElementById('op-verify-form');
      return !!f && !f.hidden;
    });
    check('O3 requesting a code reveals the 20-digit entry form', formShown, formShown);

    // O4: a short code is refused client-side and never reaches the server.
    let verifyCalls = 0;
    page.on('request', r => {
      if (r.url().indexOf('/api/admin/signin/verify') > -1) {
        verifyCalls++;
      }
    });
    await page.fill('#op-code', '123');
    await page.click('#op-verify');
    await delay(250);
    s = await state();
    const shortErr = await page.evaluate(
      () => (document.getElementById('op-error') || {}).textContent || ''
    );
    check(
      'O4 a code that is not 20 digits is refused and the console stays hidden',
      s.console === false && verifyCalls === 0 && /20 digits/i.test(shortErr),
      { s, verifyCalls, shortErr }
    );

    // O5 + O6: a valid 20-digit code reveals the console.
    await page.fill('#op-code', VALID_CODE);
    await page.click('#op-verify');
    await page.waitForSelector('#op-console:not([hidden])', { timeout: 6000 }).catch(() => {});
    s = await state();
    check(
      'O5/O6 a valid 20-digit code reveals the console and stores the token',
      s.console === true &&
        s.lock === false &&
        s.token === 'stub-operator-token' &&
        verifyCalls === 1,
      { s, verifyCalls }
    );

    // O7: the console loads cloud projects with the token.
    await page.waitForSelector('#op-cloud-list .op-row', { timeout: 6000 }).catch(() => {});
    // loadCloud() and loadBilling() are fire-and-forget from showConsole(), so
    // wait for the billing LIST to render (the status line is intentionally
    // blank when there are no subscriptions) rather than reading mid-flight.
    for (let i = 0; i < 30; i++) {
      const done = await page.evaluate(
        () => (document.getElementById('op-billing-list') || {}).innerHTML !== ''
      );
      if (done) {
        break;
      }
      await delay(100);
    }
    const cloudRows = await page.evaluate(
      () => document.querySelectorAll('#op-cloud-list .op-row').length
    );
    const billingHtml = await page.evaluate(
      () => (document.getElementById('op-billing-list') || {}).innerHTML || ''
    );
    check(
      'O7 the console loads cloud projects and subscriptions once unlocked',
      cloudRows === 1 && /No subscriptions/.test(billingHtml),
      { cloudRows, billingHtml: billingHtml.slice(0, 120) }
    );

    // O9: reissue sends the admin token and reports email delivery; the new
    // code is never printed in the console (the worker owns that contract).
    page.once('dialog', d => d.accept());
    await page.click('#op-cloud-list [data-op-action="reissue"]');
    for (let i = 0; i < 30; i++) {
      const txt = await page.evaluate(
        () => (document.getElementById('op-cloud-status') || {}).textContent || ''
      );
      if (/emailed to the project owner/.test(txt)) {
        break;
      }
      await delay(100);
    }
    const reissueStatus = await page.evaluate(
      () => (document.getElementById('op-cloud-status') || {}).textContent || ''
    );
    check(
      'O9 reissue carries the admin token and reports email delivery, never showing a code',
      recoverHeader === 'stub-operator-token' &&
        /emailed to the project owner/.test(reissueStatus) &&
        !/New owner code: [A-Za-z0-9]/.test(reissueStatus),
      { recoverHeader, reissueStatus }
    );

    // O8: sign out returns to the lock and clears the token.
    await page.click('#op-signout');
    await delay(400);
    s = await state();
    check(
      'O8 sign out returns to the lock and clears the token',
      s.lock === true && s.console === false && s.token === '',
      s
    );

    await page.close();
  } catch (e) {
    check('harness ran to completion', false, String(e && e.stack ? e.stack : e).slice(0, 500));
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (srv) {
      try {
        srv.kill();
      } catch (e) {}
    }
  }

  const failed = results.filter(r => !r.ok);
  log('---');
  log('qa-operator: ' + (results.length - failed.length) + '/' + results.length + ' checks');
  process.exit(failed.length ? 1 : 0);
})();
