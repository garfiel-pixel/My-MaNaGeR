#!/usr/bin/env node
/* ============================================================
   tools/qa-google-nonce.cjs - sign-in posts the nonce the credential proves
   ------------------------------------------------------------
   Owner report 2026-11-01: "Google sign in did not finish. Try again, or use
   the email sign in below" - the exact status line js/mmgr-google-auth.js
   shows when POST /api/auth/google refuses the credential.

   v521 fixed the first refusal (tokeninfo spells email_verified as the STRING
   "true", the Worker compared it with boolean true). That let the next gate
   answer instead - the nonce - and nothing was watching it, because every
   existing gate stubs Google and posts no credential at all.

   The defect this file pins down: the client posted the NEWEST nonce it held,
   while the credential carries the nonce GIS had live when it composed the
   token. Those disagree whenever the button was drawn before the first nonce
   landed, or the 4-minute refresh moved the module's nonce in between - which
   is most of the time. The Worker requires equality, so a real, valid Google
   credential was refused.

   The contract:

     N1  the POST body carries the nonce inside the credential, not the
         newest one the page fetched
     N2  a credential carrying NO nonce posts no nonce key at all (legacy path)
     N3  when the Worker refuses the nonce arm, one retry goes nonceless and a
         genuine credential still signs in
     N4  when that retry also fails, the page says so - never a silent no-op
     N5  a changed nonce re-initialises and redraws the GIS button, so the
         NEXT credential carries the fresh nonce
     N6  zero page errors through the walk

   Usage:  node tools/qa-google-nonce.cjs
   Registry: docs/CI-TEST-COVERAGE.md -> CI row (browser-marketing).
   ============================================================ */
'use strict';
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8765);
const BASE = process.env.BASE || 'http://127.0.0.1:' + PORT;
const delay = ms => new Promise(r => setTimeout(r, ms));

let pass = 0;
const fails = [];
function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log('PASS  ' + name);
  } else {
    fails.push(name);
    console.log(
      'FAIL  ' +
        name +
        (detail === undefined ? '' : '  <-- ' + JSON.stringify(detail).slice(0, 600))
    );
  }
}

async function ensureServer() {
  try {
    const h = await fetch(BASE + '/about.html');
    if (h.ok) {
      return null;
    }
  } catch (e) {
    /* not up */
  }
  const srv = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 30; i++) {
    await delay(1000);
    try {
      const h = await fetch(BASE + '/about.html');
      if (h.ok) {
        return srv;
      }
    } catch (e) {
      /* keep waiting */
    }
  }
  throw new Error('serve.cjs did not come up');
}

// Two different hex nonces, both in the shape the Worker mints and validates.
const PAGE_NONCE_1 = 'a1'.repeat(16);
const PAGE_NONCE_2 = 'b2'.repeat(16);
const TOKEN_NONCE = 'c3'.repeat(16); // what the credential actually carries

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// A structurally real ID token (three segments). The Worker is stubbed here,
// so its signature never matters; only the payload's nonce claim is read.
function idToken(nonce) {
  const payload = { sub: 'qa-sub', email: 'owner@example.test', email_verified: 'true' };
  if (nonce) {
    payload.nonce = nonce;
  }
  return b64url({ alg: 'RS256', typ: 'JWT' }) + '.' + b64url(payload) + '.' + 'x'.repeat(43);
}

(async () => {
  const srv = await ensureServer();
  const { chromium } = require('playwright');
  const browser = await chromium.launch({
    headless: true,
    executablePath: require('./chrome-launcher.cjs').chromePath,
    args: ['--disk-cache-size=0', '--no-sandbox']
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  const posted = []; // every credential POST body, in order
  let nonceCall = 0;
  let authAnswer = () => 200; // the Worker's verdict, per attempt

  // GIS is stubbed before any page script runs: initialize() and renderButton()
  // are recorded so N5 can prove the button follows the nonce.
  await ctx.addInitScript(() => {
    window.__gisInits = [];
    window.__gisRenders = 0;
    window.google = {
      accounts: {
        id: {
          initialize: cfg => {
            window.__gisInits.push(cfg && cfg.nonce ? cfg.nonce : '');
            window.__gisCallback = cfg && cfg.callback;
          },
          renderButton: host => {
            window.__gisRenders++;
            if (host) {
              host.innerHTML = '';
              const d = document.createElement('div');
              d.setAttribute('role', 'button');
              host.appendChild(d);
            }
          },
          prompt: () => {},
          disableAutoSelect: () => {}
        }
      }
    };
  });

  await ctx.route('**/api/auth/nonce', async route => {
    nonceCall++;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify({ ok: true, nonce: nonceCall <= 1 ? PAGE_NONCE_1 : PAGE_NONCE_2 })
    });
  });

  await ctx.route('**/api/auth/me', route =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false })
    })
  );

  await ctx.route('**/api/auth/google', async route => {
    let body = {};
    try {
      body = JSON.parse(route.request().postData() || '{}');
    } catch (e) {
      body = { unparsable: true };
    }
    posted.push(body);
    const status = authAnswer(body, posted.length);
    const ok = status === 200;
    await route.fulfill({
      status: status,
      contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify(
        ok
          ? {
              ok: true,
              user: {
                sub: 'qa-sub',
                email: 'owner@example.test',
                name: 'QA Owner',
                picture: ''
              }
            }
          : { ok: false, error: 'invalid token' }
      )
    });
  });

  const errors = [];
  ctx.on('page', p => p.on('pageerror', e => errors.push(String(e))));

  try {
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(BASE + '/about.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () =>
        window.MMGR && window.MMGR.GoogleAuth && window.MMGR.GoogleAuth.handleCredentialResponse,
      { timeout: 15000 }
    );
    await delay(400);

    // ---- N1: the credential's nonce wins over the newest one the page holds
    authAnswer = () => 200;
    await page.evaluate(
      t => window.MMGR.GoogleAuth.handleCredentialResponse({ credential: t }),
      idToken(TOKEN_NONCE)
    );
    await delay(500);
    check(
      'N1 the POST posts the nonce the CREDENTIAL carries',
      posted.length >= 1 && posted[0].nonce === TOKEN_NONCE,
      { posted: posted.map(p => p.nonce || '(none)'), pageNonce: PAGE_NONCE_1 }
    );
    check(
      'N1b the page never posted the newest nonce it fetched',
      posted.every(p => p.nonce !== PAGE_NONCE_1 && p.nonce !== PAGE_NONCE_2),
      { posted: posted.map(p => p.nonce || '(none)') }
    );

    // N5 needs the GIS button drawn, which needs initGIS() on this page.
    await page.evaluate(() => window.MMGR.GoogleAuth.initGIS());
    await delay(700);
    const gis1 = await page.evaluate(() => ({
      inits: window.__gisInits.slice(),
      renders: window.__gisRenders
    }));
    check(
      'N5a GIS was initialised with the fetched nonce',
      gis1.inits.length >= 1 && gis1.inits.indexOf(PAGE_NONCE_1) > -1,
      gis1
    );
    check('N5b a changed nonce re-initialises the button', gis1.inits.indexOf(PAGE_NONCE_2) > -1, {
      inits: gis1.inits.map(n => n.slice(0, 4))
    });
    check('N5c a changed nonce redraws the button', gis1.renders >= 2, { renders: gis1.renders });

    // ---- N2: a credential with no nonce posts no nonce key
    posted.length = 0;
    await page.evaluate(
      t => window.MMGR.GoogleAuth.handleCredentialResponse({ credential: t }),
      idToken('')
    );
    await delay(500);
    check(
      'N2 a nonceless credential posts no nonce key',
      posted.length === 1 && !('nonce' in posted[0]),
      { posted: posted.map(p => Object.keys(p)) }
    );

    // ---- N3: the Worker refuses the nonce arm -> one nonceless retry succeeds
    posted.length = 0;
    authAnswer = (body, n) => (body && body.nonce ? 401 : 200);
    await page.evaluate(
      t => window.MMGR.GoogleAuth.handleCredentialResponse({ credential: t }),
      idToken(TOKEN_NONCE)
    );
    await delay(700);
    check(
      'N3 refused nonce -> exactly one nonceless retry',
      posted.length === 2 && !!posted[0].nonce && !('nonce' in posted[1]),
      { attempts: posted.map(p => p.nonce || '(none)') }
    );
    const signedIn = await page.evaluate(() => ({
      signedIn: window.MMGR.GoogleAuth.isSignedIn(),
      status: (document.getElementById('google-signin-status') || {}).textContent || ''
    }));
    check('N3b the retry signs the user in', signedIn.signedIn === true, signedIn);
    check('N3c no refusal line is left behind', signedIn.status === '', signedIn);

    // ---- N4: both attempts refused -> a visible, plain-language reason
    posted.length = 0;
    authAnswer = () => 401;
    await page.evaluate(
      t => window.MMGR.GoogleAuth.handleCredentialResponse({ credential: t }),
      idToken(TOKEN_NONCE)
    );
    await delay(700);
    const refused = await page.evaluate(() => {
      const el = document.getElementById('google-signin-status');
      return { text: el ? el.textContent : '', hidden: el ? el.hidden : true };
    });
    check(
      'N4 a full refusal is stated on the page',
      /did not finish/i.test(refused.text) && refused.hidden === false,
      refused
    );

    check('N6 zero page errors through the walk', errors.length === 0, errors.slice(0, 3));
  } finally {
    await browser.close();
    if (srv) {
      srv.kill();
    }
  }

  console.log(
    '\n' + (fails.length ? fails.length + ' failed' : 'all checks passed (' + pass + ')')
  );
  process.exit(fails.length ? 1 : 0);
})().catch(e => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
