/* ============================================================
   tools/qa-consent.cjs - S-2 / M-1 cookie consent gate
   ------------------------------------------------------------
   Audit directive 2026-10-18, section 8.2 (GATE S-2) plus the
   directive's "inventory first" rule: a test fails when code
   writes a storage key that docs/STORAGE-INVENTORY.md does not
   list.

   Phase S (static, no browser):
     S1  every mmgr_* storage key literal in shipped code (js/,
         src/, served HTML) appears in docs/STORAGE-INVENTORY.md.
     S2  all 10 public pages carry the data-consent-banner body
         flag, the js/consent.js script tag and the footer
         Cookie settings button.
     S3  privacy.html carries the inventory section and a
         Change your choice button.
     S4  worker.js AND serve.cjs gate the analytics host on the
         mmgr_consent_a cookie (the %%ANALYTICS%% placeholder),
         and no served HTML hardcodes the beacon URL.
     S6  the inventory version agrees in js/consent.js, worker.js
         and serve.cjs - the client writes the version into the
         cookie and the server checks that same number.
     S7  both servers PARSE the versioned cookie (version + when
         the choice was made) and the old bare "1" flag is gone.
         A flag cannot tell a current choice from a stale one, and
         the stale case is the leak.

   Phase B (Playwright against serve.cjs):
     B1  fresh visit: the banner is a labelled region with three
         EQUAL buttons (Accept all / Necessary only / Choose).
     B2  zero requests to static.cloudflareinsights.com before a
         choice exists (holds locally by construction; the same
         assertion is the live probe against the production zone,
         where Cloudflare auto-injects the beacon).
     B3  Necessary only: card hides, mmgr_consent.analytics=false,
         the mirror cookie is NOT set, the next response's CSP
         does not allow the analytics host.
     B4  reload: the choice is respected, no banner.
     B5  the footer Cookie settings button reopens the banner.
     B6  Choose: the panel opens with Usage statistics OFF (the
         saved choice was necessary-only), switching it on and
         Save writes the versioned mirror cookie.
     B7  reload after accept: banner stays hidden and the CSP
         now allows the analytics host.
     B8  a choice that has AGED OUT (older than 12 months) re-asks,
         clears the mirror cookie, and the reload's OWN response CSP
         does not allow the analytics host - so the edge-injected
         beacon is refused again (no new response at all).
     B8b a cookie carrying a foreign inventory version is refused by
         the server on that very response, and the client heals the
         mirror back to the current version.
     B8c the signed-in APP page under an aged-out choice collects no
         analytics at all and clears the mirror - the hole the app's
         missing banner used to leave open (found live 2026-10-21).
     B9  signin.html shows the banner too.
     B10 project.html (signed-in app) never shows the banner
         (audit item 7: the choice lives in Settings).
     B11 axe-core on the open banner in BOTH palettes: zero
         serious/critical violations.
     B12 zero page errors across the whole flow.

   Usage:   node tools/qa-consent.cjs [baseUrl]
   Registry: docs/CI-TEST-COVERAGE.md + ci.yml step.
   ============================================================ */
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const PORT = 8765;
const BASE = process.env.QA_BASE || process.argv[2] || 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');
const log = s => process.stdout.write('[consent] ' + s + '\n');
const delay = ms => new Promise(r => setTimeout(r, ms));
let passed = 0,
  failed = 0;
const check = (name, ok, detail) => {
  if (ok) {
    passed++;
    log('PASS  ' + name);
  } else {
    failed++;
    log(
      'FAIL  ' +
        name +
        '  <-- ' +
        JSON.stringify(detail === undefined ? null : detail).slice(0, 500)
    );
  }
};

function resolvePlaywright() {
  try {
    return require('playwright');
  } catch (e) {}
  const roots = [
    path.join(os.homedir(), 'AppData', 'Local', 'npm-cache', '_npx'),
    path.join(os.homedir(), '.npm', '_npx')
  ];
  for (const root of roots) {
    if (!fs.existsSync(root)) {
      continue;
    }
    for (const dir of fs.readdirSync(root)) {
      const p = path.join(root, dir, 'node_modules', 'playwright');
      if (fs.existsSync(path.join(p, 'index.js'))) {
        return require(p);
      }
    }
  }
  throw new Error('playwright not found - npm i -D playwright');
}

function axeSource() {
  const c = path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js');
  if (!fs.existsSync(c)) {
    throw new Error('axe-core not found - npm i -D axe-core');
  }
  return fs.readFileSync(c, 'utf8');
}

async function ensureServer() {
  try {
    const h = await fetch(BASE + '/index.html');
    if (h.ok) {
      return null;
    }
  } catch (e) {}
  log('starting serve.cjs for this run');
  const srv = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 30; i++) {
    await delay(1000);
    try {
      const h = await fetch(BASE + '/index.html');
      if (h.ok) {
        return srv;
      }
    } catch (e) {}
  }
  throw new Error('serve.cjs did not come up on ' + BASE);
}

// ---- Phase S: static gates ----
const PUBLIC_PAGES = [
  'index.html',
  'about.html',
  'contact.html',
  'features.html',
  'reviews.html',
  'privacy.html',
  'terms.html',
  'refund.html',
  'pricing.html',
  'signin.html'
];

function shippedFiles() {
  const out = [];
  const walk = dir => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (
        ent.name === 'node_modules' ||
        ent.name === 'dist' ||
        ent.name === 'tmp' ||
        ent.name[0] === '.'
      ) {
        continue;
      }
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(p);
      } else if (/\.js$/.test(ent.name)) {
        out.push(p);
      }
    }
  };
  walk(path.join(ROOT, 'js'));
  walk(path.join(ROOT, 'src'));
  out.push(path.join(ROOT, 'worker.js'), path.join(ROOT, 'sw.js'));
  for (const p of PUBLIC_PAGES.concat([
    'app.html',
    'project.html',
    'admin.html',
    'calculator.html',
    'dashboard.html'
  ])) {
    out.push(path.join(ROOT, p));
  }
  return out;
}

function phaseStatic() {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'STORAGE-INVENTORY.md'), 'utf8');
  const missing = new Set();
  for (const f of shippedFiles()) {
    if (!fs.existsSync(f)) {
      continue;
    }
    const src = fs.readFileSync(f, 'utf8');
    const re = /['"`](mmgr_[a-z0-9_]+)['"`]/g;
    let m;
    while ((m = re.exec(src))) {
      // strip the trailing underscore of prefix keys ('mmgr_state_' + id)
      const key = m[1].replace(/_+$/, '');
      if (key.length < 6) {
        continue;
      }
      if (doc.indexOf(key) === -1) {
        missing.add(key + '  (' + path.relative(ROOT, f) + ')');
      }
    }
  }
  check(
    'S1 every storage key is in docs/STORAGE-INVENTORY.md',
    missing.size === 0,
    Array.from(missing)
  );

  const missingWiring = [];
  for (const p of PUBLIC_PAGES) {
    const s = fs.readFileSync(path.join(ROOT, p), 'utf8');
    if (!/data-consent-banner="on"/.test(s)) missingWiring.push(p + ': body flag');
    if (!/js\/consent\.js/.test(s)) missingWiring.push(p + ': script tag');
    if (!/data-consent-open/.test(s)) missingWiring.push(p + ': footer link');
  }
  check(
    'S2 all 10 public pages carry the banner wiring',
    missingWiring.length === 0,
    missingWiring
  );

  const privacy = fs.readFileSync(path.join(ROOT, 'privacy.html'), 'utf8');
  check(
    'S3 privacy.html has the inventory section and change-choice button',
    /Storage this site uses/i.test(privacy) && /data-consent-open/.test(privacy)
  );

  const worker = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
  const serve = fs.readFileSync(path.join(ROOT, 'serve.cjs'), 'utf8');
  check(
    'S4 worker.js and serve.cjs both gate the analytics host on the consent cookie',
    /%%ANALYTICS%%/.test(worker) &&
      /mmgr_consent_a/.test(worker) &&
      /%%ANALYTICS%%/.test(serve) &&
      /mmgr_consent_a/.test(serve)
  );
  const hardcoded = [];
  for (const p of PUBLIC_PAGES.concat([
    'app.html',
    'project.html',
    'admin.html',
    'calculator.html'
  ])) {
    const s = fs.readFileSync(path.join(ROOT, p), 'utf8');
    if (/static\.cloudflareinsights\.com/.test(s)) {
      hardcoded.push(p);
    }
  }
  check('S4b no served HTML hardcodes the beacon URL', hardcoded.length === 0, hardcoded);

  // S6 - the inventory version is read by the client AND by both servers:
  // the client writes it into the mirror cookie, the server checks it.
  // If the three numbers drift, the server either blocks a valid choice
  // or (worse) allows one the client has already declared stale.
  const consentSrc = fs.readFileSync(path.join(ROOT, 'js', 'consent.js'), 'utf8');
  const readIv = src => {
    const m = /INVENTORY_VERSION\s*=\s*(\d+)/.exec(src);
    return m ? Number(m[1]) : null;
  };
  const ivs = {
    client: readIv(consentSrc),
    worker: readIv(worker),
    serve: readIv(serve)
  };
  check(
    'S6 the inventory version agrees in js/consent.js, worker.js and serve.cjs',
    ivs.client !== null && ivs.client === ivs.worker && ivs.client === ivs.serve,
    ivs
  );

  // S7 - the servers must JUDGE the cookie, not merely see it. The bare
  // "1" flag cannot tell a current choice from a stale one, and a stale
  // choice is exactly the case that leaked on the app pages (no banner
  // there to re-ask). The versioned cookie carries both facts.
  const VERSIONED_COOKIE = 'mmgr_consent_a=(\\d+)\\.(\\d+)';
  const BARE_FLAG = 'mmgr_consent_a=1(\\s*;|$)';
  check(
    'S7 both servers parse the versioned consent cookie and the bare flag is gone',
    worker.indexOf(VERSIONED_COOKIE) > -1 &&
      serve.indexOf(VERSIONED_COOKIE) > -1 &&
      worker.indexOf(BARE_FLAG) === -1 &&
      serve.indexOf(BARE_FLAG) === -1 &&
      /CONSENT_INVENTORY_VERSION\s*=\s*\d+/.test(worker) &&
      /CONSENT_INVENTORY_VERSION\s*=\s*\d+/.test(serve),
    {
      workerVersioned: worker.indexOf(VERSIONED_COOKIE) > -1,
      serveVersioned: serve.indexOf(VERSIONED_COOKIE) > -1,
      bareFlagGone: worker.indexOf(BARE_FLAG) === -1 && serve.indexOf(BARE_FLAG) === -1
    }
  );

  // S8 - the per-request Content-Security-Policy must never be handed to a
  // cache that can reuse it across consent states. Measured live
  // 2026-10-21: the extensionless page routes (/project, /app, ...) fell
  // through to the shared one-hour TTL, so the browser replayed the copy it
  // had cached WHILE THE CHOICE WAS CURRENT and the beacon ran under a
  // choice that had aged out - the server refusal was never even asked
  // for. Documents therefore revalidate on every visit.
  //
  // This is a source-level gate on purpose: the leak only reproduces where
  // the beacon is actually injected (production), so a behavioural gate
  // would be green on the dev server by construction and would never bite.
  const ccStart = worker.indexOf('Cache-Control strategy');
  const ccBlock = ccStart > -1 ? worker.slice(ccStart, ccStart + 2600) : '';
  const docStart = worker.indexOf('const isDocument =');
  const docBlock = docStart > -1 ? worker.slice(docStart - 1400, docStart + 200) : '';
  check(
    'S8 the Worker serves the page routes as documents (they revalidate, so no cache can replay an old consent decision)',
    ccBlock !== '' &&
      /NO_CACHE/.test(ccBlock) &&
      // The extensionless routing answers /index.html and /project.html with
      // a 307 that carries NO Content-Type, and a 304 carries none either -
      // so the CONTENT TYPE alone cannot identify a document. The PATH
      // rule is what keeps the redirects and the revalidations in the set.
      docBlock !== '' &&
      /PAGE_ROUTES\.has\(normalized\)/.test(docBlock) &&
      /\.html\$/i.test(docBlock),
    {
      blockFound: ccBlock !== '',
      docBlockFound: docBlock !== '',
      pageRouteRule: /PAGE_ROUTES\.has\(normalized\)/.test(docBlock),
      htmlPathRule: /\.html\$/i.test(docBlock)
    }
  );

  // S10 - the analytics host belongs in a DOCUMENT's policy only. A browser
  // enforces the policy of the response it finally renders, so an asset's
  // policy is inert - but a cacheable asset (a script with a one-year TTL)
  // that carries a consent-dependent header can be replayed across consent
  // states, which is the same leak one layer down. Both servers must
  // therefore resolve the placeholder to the host for documents ONLY.
  const workerCsp = /function cspFor\([^)]*\)[\s\S]{0,1200}?isDocument/.test(worker);
  const serveDocOnly = /isDocument\s*&&\s*analyticsAllowed/.test(serve);
  check(
    'S10 both servers put the analytics host in documents only (a cacheable asset never carries a consent-dependent header)',
    workerCsp && serveDocOnly,
    { workerDocumentOnly: workerCsp, serveDocumentOnly: serveDocOnly }
  );

  // S9 - a copy the service worker keeps is NOT the server's live word on
  // consent. It carries the policy it was cached with, and the HTML the
  // edge served already carries the beacon tag inside it, so a cached copy
  // handed back to a visitor must not carry the analytics host.
  const swSrc = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  check(
    'S9 the service worker serves its cached copies without the analytics host',
    /function withoutAnalyticsHost/.test(swSrc) &&
      /withoutAnalyticsHost\(hit\)/.test(swSrc) &&
      /withoutAnalyticsHost\(fallback\)/.test(swSrc),
    { helper: /function withoutAnalyticsHost/.test(swSrc) }
  );

  // S5 - the app-side choice surface (audit 8.2 item 7): the signed-in app
  // carries the choice in Settings, NOT a banner. The markup lives in
  // project.html's Controls drawer, the module rides the app bundle, and
  // the action is device-level (never project state, so it is allowed in
  // view-only mode).
  const projectHtml = fs.readFileSync(path.join(ROOT, 'project.html'), 'utf8');
  const buildSrc = fs.readFileSync(path.join(ROOT, 'build.js'), 'utf8');
  const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'mmgr-app.js'), 'utf8');
  const s5 = {
    markup: /data-action="tglConsentStat"/.test(projectHtml),
    bundle: /'js\/consent\.js'/.test(buildSrc),
    action: /tglConsentStat\s*:\s*el/.test(appSrc),
    readonlySafe: /tglConsentStat\s*:\s*1/.test(appSrc)
  };
  check(
    'S5 the app carries the choice in Settings (markup, bundle, action, view-only safe)',
    s5.markup && s5.bundle && s5.action && s5.readonlySafe,
    s5
  );
}

// ---- Phase B: browser gates ----
async function phaseBrowser() {
  const { chromium } = resolvePlaywright();
  // Use the shared Chrome auto-detect (tools/chrome-launcher.cjs) rather than
  // the bare CHROME_PATH env var. CI installs the playwright devDep with
  // --ignore-scripts, so Playwright's OWN bundled Chromium is never
  // downloaded there; the CI runner supplies the SYSTEM Chrome instead.
  // With no executablePath, Playwright asks for the bundled binary and dies
  // with "Executable doesn't exist ... chromium_headless_shell" (CI run
  // 39693725061, step 77). The launcher finds google-chrome on the runner
  // and the installed Chrome on the dev machine; if neither exists we fall
  // back to Playwright's own browser so a local `npx playwright install`
  // setup still works.
  let executablePath;
  try {
    executablePath =
      require(path.join(ROOT, 'tools', 'chrome-launcher.cjs')).chromePath || undefined;
  } catch (e) {
    /* fall back to playwright's browser */
  }
  const browser = await chromium.launch({
    executablePath,
    headless: true
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  // THE BEACON CONTRACT IS "NEVER FETCHED AND NEVER RAN" - not "the browser
  // never tried".
  //
  // Cloudflare's zone auto-injects the Web Analytics beacon <script> into
  // every browser navigation at the EDGE, after the Worker's response is
  // built, so on the LIVE site the browser always ATTEMPTS the request. Our
  // CSP (the analytics host is absent from script-src until the consent
  // cookie is present) refuses that attempt renderer-side: the request never
  // reaches the network, the script never executes and window.__cfBeacon is
  // never defined.
  //
  // The old gate counted Playwright's 'request' event, which fires for the
  // REFUSED attempt too. That made it green on serve.cjs (which injects no
  // beacon at all, so zero attempts) and RED on production for the wrong
  // reason - it reported a privacy failure where the privacy actually held.
  // Measured live 2026-10-21: 1 attempt, 0 responses, transferSize 0,
  // requestfailed errorText 'csp', no route interception hit (the request
  // never reached the network layer), no __cfBeacon global.
  //
  // So: count RESPONSES (a fetch that completed) and EXECUTION (the beacon
  // actually ran), and separately prove every attempt was stopped by CSP
  // rather than by luck.
  const beaconAttempts = [];
  const beaconResponses = [];
  const beaconBlockedByCsp = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('request', r => {
    if (r.url().indexOf('static.cloudflareinsights.com') > -1) {
      beaconAttempts.push(r.url());
    }
  });
  page.on('response', r => {
    if (r.url().indexOf('static.cloudflareinsights.com') > -1) {
      beaconResponses.push(r.url());
    }
  });
  page.on('requestfailed', r => {
    if (r.url().indexOf('static.cloudflareinsights.com') > -1) {
      const t = r.failure() && r.failure().errorText;
      if (t === 'csp') beaconBlockedByCsp.push(r.url());
    }
  });
  // The beacon's own global is the ground truth for "it ran".
  const beaconRan = () => page.evaluate(() => typeof window.__cfBeacon !== 'undefined');
  const beaconTagPresent = () =>
    page.evaluate(
      () => !!document.querySelector('script[src*="cloudflareinsights"], script[data-cf-beacon]')
    );

  const consentOf = async () =>
    page.evaluate(() => {
      try {
        return JSON.parse(localStorage.getItem('mmgr_consent') || 'null');
      } catch (e) {
        return null;
      }
    });
  const mirrorCookie = async () =>
    (await context.cookies()).filter(c => c.name === 'mmgr_consent_a').map(c => c.value);
  // Put a mirror cookie straight into the jar, so a test can present the
  // server with a choice the client would never have written itself: one
  // made under another inventory version, or one that has aged out. The
  // server has to judge those on its own - it is the only place that can,
  // before any script on the page has run.
  const setMirror = async (value, expires) => {
    const c = { name: 'mmgr_consent_a', value: value, url: BASE };
    if (expires !== undefined) {
      c.expires = expires;
    }
    await context.addCookies([c]);
  };
  const clearMirror = () => setMirror('', -1);
  // The CSP of a navigation's OWN response - the header the browser was
  // actually given, not a later fetch of the same page.
  const cspOfResponse = resp => (resp ? resp.headers()['content-security-policy'] || '' : '');
  const cspOf = async url =>
    page.evaluate(
      u =>
        fetch(u, { credentials: 'same-origin' }).then(
          r => r.headers.get('content-security-policy') || ''
        ),
      url
    );
  const bannerVisible = () =>
    page.evaluate(() => {
      const el = document.getElementById('consent-card');
      return !!el && !el.hidden;
    });

  await page.goto(BASE + '/index.html', { waitUntil: 'load' });

  // The inventory version the RUNNING client uses. The server checks the
  // same number, so the tests below build their cookies from this one.
  const IV = await page.evaluate(() =>
    window.MMGR && window.MMGR.Consent ? window.MMGR.Consent.INVENTORY_VERSION : null
  );

  const structure = await page.evaluate(() => {
    const el = document.getElementById('consent-card');
    if (!el) {
      return null;
    }
    return {
      role: el.getAttribute('role'),
      label: el.getAttribute('aria-label'),
      buttons: Array.from(el.querySelectorAll(':scope > .consent-actions button')).map(b =>
        b.textContent.trim()
      )
    };
  });
  check(
    'B1 banner is a labelled region with three equal choice buttons',
    !!structure &&
      structure.role === 'region' &&
      structure.label === 'Cookie choices' &&
      JSON.stringify(structure.buttons) ===
        JSON.stringify(['Accept all', 'Necessary only', 'Choose']),
    structure
  );
  const b2 = {
    attempts: beaconAttempts.length,
    responses: beaconResponses.length,
    blockedByCsp: beaconBlockedByCsp.length,
    executed: await beaconRan()
  };
  check(
    'B2 no analytics fetched and none executed before a choice',
    // nothing completed over the wire ...
    b2.responses === 0 &&
      // ... the beacon never ran ...
      b2.executed === false &&
      // ... and every attempt was refused by CSP (not by a lucky network error)
      b2.attempts === b2.blockedByCsp,
    b2
  );

  await page.click('#consent-card [data-consent="necessary"]');
  await delay(120);
  const afterNecessary = await consentOf();
  check(
    'B3 Necessary only stores analytics=false, hides the card, sets no mirror cookie',
    (await bannerVisible()) === false &&
      !!afterNecessary &&
      afterNecessary.analytics === false &&
      (await mirrorCookie()).length === 0,
    { afterNecessary, mirror: await mirrorCookie() }
  );
  const cspNo = await cspOf('/index.html');
  check(
    'B3b CSP without consent does not allow the analytics host',
    cspNo.indexOf('static.cloudflareinsights.com') === -1,
    cspNo.slice(0, 200)
  );

  await page.reload({ waitUntil: 'load' });
  check('B4 the choice is respected after reload', (await bannerVisible()) === false);

  await page.click(
    '.footer-legal [data-consent-open], .footer-links [data-consent-open], .signin-foot [data-consent-open]'
  );
  await delay(120);
  check(
    'B5 the footer Cookie settings button reopens the banner',
    (await bannerVisible()) === true
  );

  await page.click('#consent-card [data-consent="choose"]');
  await delay(80);
  const chooseState = await page.evaluate(() => {
    const panel = document.querySelector('#consent-card .consent-choose');
    const box = document.getElementById('consent-analytics');
    return { open: !!panel && !panel.hidden, checked: !!box && box.checked };
  });
  check(
    'B6 Choose opens the panel with Usage statistics off (saved choice was necessary-only)',
    chooseState.open === true && chooseState.checked === false,
    chooseState
  );
  await page.click('#consent-analytics');
  await page.click('#consent-card [data-consent="save"]');
  await delay(120);
  const afterSave = await consentOf();
  // The mirror carries the version the choice was made under and the moment
  // it was made, so the server can tell a current choice from a stale one.
  const wantMirror = afterSave ? String(afterSave.iv) + '.' + Date.parse(afterSave.ts) : '';
  check(
    'B6b Save stores analytics=true and writes the versioned mirror cookie',
    !!afterSave && afterSave.analytics === true && (await mirrorCookie()).join() === wantMirror,
    { afterSave, mirror: await mirrorCookie(), wantMirror }
  );

  await page.reload({ waitUntil: 'load' });
  const cspYes = await cspOf('/index.html');
  check(
    'B7 after accept: no banner and the CSP allows the analytics host',
    (await bannerVisible()) === false && cspYes.indexOf('static.cloudflareinsights.com') > -1,
    { banner: await bannerVisible(), csp: cspYes.slice(0, 200) }
  );

  // B7b - THE POSITIVE HALF of the gate. B2 proves nothing was collected
  // before the choice; this proves the choice OPENS the door for real: with
  // the mirror cookie set, the CSP now allows the analytics host, so the
  // edge-injected beacon is fetched (a real 200 response) and EXECUTES.
  //
  // The beacon tag is injected at the edge, so it only exists in production.
  // Where there is no beacon tag at all (serve.cjs injects nothing), there is
  // nothing to fetch - so the check asserts the tag's absence is understood
  // rather than silently passing. Measured live 2026-10-21 after consent:
  // response 200, window.__cfBeacon is an object.
  await delay(1500);
  const b7b = {
    tagPresent: await beaconTagPresent(),
    responses: beaconResponses.length,
    executed: await beaconRan()
  };
  check(
    'B7b after accept the beacon is fetched and runs (or no beacon is injected)',
    b7b.tagPresent ? b7b.responses > 0 && b7b.executed === true : true,
    b7b
  );

  // ---- B8a: THE POSITIVE CONTROL ----
  // A server that refused EVERY cookie would make "the stale choice is
  // refused" true for the wrong reason. So prove here, right before the
  // refusal gates, that a current choice is still allowed - the two gates
  // then prove the same code path in both directions.
  await setMirror(String(IV) + '.' + Date.now());
  const b8aResp = await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  const b8aCsp = cspOfResponse(b8aResp);
  check(
    'B8a the server allows a current choice (the control for the refusals below)',
    b8aCsp.indexOf('static.cloudflareinsights.com') > -1,
    b8aCsp.slice(0, 200)
  );

  // ---- B8b: THE SERVER MUST JUDGE THE COOKIE ----
  // The record is fresh and consented here. Put a cookie in the jar that
  // carries a FOREIGN inventory version - the shape a choice made before an
  // inventory change would have. The server has to refuse it on that very
  // response: it is the only place that can tell that choice from a current
  // one, because nothing on the page has run yet.
  await setMirror('99.' + Date.now());
  const b8bResp = await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  const b8bCsp = cspOfResponse(b8bResp);
  check(
    'B8b the server refuses a cookie carrying a foreign inventory version',
    b8bCsp.indexOf('static.cloudflareinsights.com') === -1,
    b8bCsp.slice(0, 200)
  );
  // ... and the client heals the mirror on the page it just loaded, so a
  // foreign cookie never survives to be the server's answer next time.
  const healed = await mirrorCookie();
  const healedWant = (await consentOf())
    ? String((await consentOf()).iv) + '.' + Date.parse((await consentOf()).ts)
    : '';
  check(
    'B8b2 the client heals the mirror back to the current version',
    healed.join() === healedWant,
    { healed, healedWant }
  );

  // ---- B8: A CHOICE THAT HAS AGED OUT ----
  // Twelve months is the re-ask window. Age the record AND the cookie the
  // way the world does it (the cookie still carries the old moment), then
  // reload. Three things must hold: the banner asks again, the mirror is
  // cleared, and the reload's OWN response does not allow the analytics
  // host - so the edge-injected beacon is refused again with no new request
  // at all. The response counter is cumulative, so snapshot it first.
  const OLD_TS = Date.now() - 400 * 24 * 60 * 60 * 1000; // ~13 months
  await page.evaluate(ts => {
    const c = JSON.parse(localStorage.getItem('mmgr_consent'));
    c.ts = new Date(ts).toISOString();
    localStorage.setItem('mmgr_consent', JSON.stringify(c));
  }, OLD_TS);
  await setMirror(String(IV) + '.' + OLD_TS);
  const responsesBeforeStale = beaconResponses.length;
  const staleResp = await page.reload({ waitUntil: 'load' });
  await delay(120);
  const staleCsp = cspOfResponse(staleResp);
  const b8 = {
    bannerVisible: await bannerVisible(),
    mirror: await mirrorCookie(),
    cspAllowsHost: staleCsp.indexOf('static.cloudflareinsights.com') > -1,
    newResponses: beaconResponses.length - responsesBeforeStale
  };
  check(
    'B8 an aged-out choice re-asks, clears the mirror, and the reload blocks the beacon',
    b8.bannerVisible === true &&
      b8.mirror.length === 0 &&
      b8.cspAllowsHost === false &&
      b8.newResponses === 0,
    b8
  );

  await page.goto(BASE + '/signin.html', { waitUntil: 'load' });
  check('B9 signin.html shows the banner', (await bannerVisible()) === true);

  // The app page redirects to the launcher unless the project is unlocked,
  // so the app-side checks below open a real project (the same fixture
  // qa-full.cjs uses) with the documented unlock flag set first.
  await page.evaluate(() => {
    try {
      localStorage.setItem('mmgr_unlocked_demo-project', '1');
    } catch (e) {}
  });
  await page.goto(BASE + '/project.html?id=demo-project', { waitUntil: 'load' });
  await delay(3000);
  const onAppPage = await page.evaluate(
    () =>
      location.pathname.indexOf('project.html') > -1 || location.pathname.indexOf('/project') > -1
  );
  check('B10 the signed-in app never shows the banner', (await bannerVisible()) === false);
  check(
    'B10b the app page really loaded (not redirected to the launcher)',
    onAppPage === true,
    await page.evaluate(() => location.pathname)
  );

  // ---- B8c: THE APP-PAGE HOLE, WITH THE CACHES PRIMED ----
  // Found live 2026-10-21: the signed-in app shows NO banner, so an aged-out
  // choice used to leave the mirror cookie standing and the beacon kept
  // running on every app load (3 of 3 loads collected it). The server must
  // refuse the aged cookie on the very first app request, and the app must
  // clear the mirror it finds. This is the gate that was missing.
  //
  // PRIME THE CACHES FIRST, or the gate passes for the wrong reason. The
  // Content-Security-Policy is a PER REQUEST decision, and the browser
  // keeps the copy it cached while the choice was current. Measured live
  // 2026-10-21, one layer below the server gate: with the app page cached
  // under a current choice, an aged-out choice STILL ran the beacon - the
  // server refused the stale cookie and the browser never asked again,
  // because it replayed the policy from its cache. The old gate only
  // passed because nothing had been cached under a current choice yet.
  //
  // So: restore a current choice, load the app page twice (the first
  // installs the service worker, the second is served through it), and
  // PROVE the copy in the caches allows the host - that is the control that
  // gives the refusal below its teeth.
  //
  // The three loads share ONE fresh query string on purpose. The leak was
  // the browser REPLAYING a cached copy, so the priming and the test have
  // to look at the same cached URL: a query the browser has never seen
  // forces the priming to fetch it for real, and the test then replays
  // exactly that copy. Measured live 2026-10-21 against the unfixed site:
  // the control failed, the refusal passed for the wrong reason - the
  // browser answered with whatever it had cached last, in either
  // direction.
  const CACHE_KEY = '?id=demo-project&qa=consent-' + Date.now();
  const APP_URL = BASE + '/project.html' + CACHE_KEY;
  await page.evaluate(() => {
    const c = JSON.parse(localStorage.getItem('mmgr_consent')) || {
      v: 1,
      iv: 1,
      analytics: true
    };
    c.ts = new Date().toISOString();
    localStorage.setItem('mmgr_consent', JSON.stringify(c));
  });
  await setMirror(String(IV) + '.' + Date.now());
  await page.goto(APP_URL, { waitUntil: 'load' });
  await delay(1500);
  const primeResp = await page.goto(APP_URL, { waitUntil: 'load' });
  await delay(1500);
  const primeCsp = cspOfResponse(primeResp);
  check(
    'B8c0 the app page under a CURRENT choice allows the analytics host (the control for B8c)',
    primeCsp.indexOf('static.cloudflareinsights.com') > -1,
    primeCsp.slice(0, 200)
  );

  // Now age the choice out - the record AND the mirror carry the old moment,
  // exactly as the world leaves them - and load the app page again. The
  // caches now hold a copy that WOULD allow the beacon, so this load is the
  // real test: the server must refuse the stale cookie, the browser must
  // not replay the policy it cached under the old choice, and the app must
  // clear the mirror it finds. "The beacon did not run" is the ground
  // truth: a cached copy can serve the script from the browser's own cache,
  // so a zero RESPONSE count alone would prove nothing.
  await page.evaluate(ts => {
    const c = JSON.parse(localStorage.getItem('mmgr_consent')) || {
      v: 1,
      iv: 1,
      analytics: true
    };
    c.ts = new Date(ts).toISOString();
    localStorage.setItem('mmgr_consent', JSON.stringify(c));
  }, OLD_TS);
  await setMirror(String(IV) + '.' + OLD_TS);
  const responsesBeforeApp = beaconResponses.length;
  const appResp = await page.goto(APP_URL, { waitUntil: 'load' });
  await delay(3000);
  const appCsp = cspOfResponse(appResp);
  const b8c = {
    cspAllowsHost: appCsp.indexOf('static.cloudflareinsights.com') > -1,
    newResponses: beaconResponses.length - responsesBeforeApp,
    executed: await beaconRan(),
    mirror: await mirrorCookie()
  };
  check(
    'B8c the app page under an aged-out choice collects no analytics and clears the mirror',
    b8c.cspAllowsHost === false &&
      b8c.newResponses === 0 &&
      b8c.executed !== true &&
      b8c.mirror.length === 0,
    b8c
  );

  // ---- B8d: THE COPY THE SERVICE WORKER KEEPS ----
  // Offline-first is sacred, so the service worker keeps the shell. That
  // copy carries the policy it was cached with - and the HTML the edge
  // served already carries the beacon tag inside it. A page served from
  // the cache is NOT the server's live word on consent, so it must not
  // carry the analytics host. Go offline and prove the cached page
  // refuses the beacon.
  await context.setOffline(true);
  let offlineCsp = '';
  let offlineRan = null;
  let offlineError = null;
  try {
    const offlineResp = await page.goto(APP_URL, { waitUntil: 'load' });
    await delay(2000);
    offlineCsp = cspOfResponse(offlineResp);
    offlineRan = await beaconRan();
  } catch (e) {
    offlineError = String((e && e.message) || e);
    offlineCsp = '(navigation failed offline) ' + offlineError;
  } finally {
    await context.setOffline(false);
  }
  check(
    'B8d the offline (service worker) copy of the app page does not allow the analytics host',
    offlineError === null &&
      offlineCsp.indexOf('static.cloudflareinsights.com') === -1 &&
      offlineRan !== true,
    { offlineCsp: offlineCsp.slice(0, 200), offlineRan: offlineRan, offlineError: offlineError }
  );

  // B13 - the app-side Privacy row, driven for real: open the Settings
  // drawer, flip the Usage statistics toggle and prove the device record
  // and the mirror cookie follow it in BOTH directions. The mirror cookie
  // is what the Worker's CSP reads, so this is the whole point of the row.
  await page.click('[data-action="openDrw"]');
  await delay(500);
  // The drawer opens on its first tab (Features); Controls is a tab, so
  // switch to it the way a user does.
  await page.click('[data-action="swDtab"][data-tab="ctrl"]');
  await delay(500);
  // The Controls drawer is an accordion: Privacy is a collapsed section by
  // default, so open it the way a user does - click its heading.
  const privacySec = await page.evaluateHandle(() => {
    const secs = Array.from(document.querySelectorAll('#db-ctrl .ctl-sec'));
    return secs.find(s => (s.textContent || '').trim().indexOf('Privacy') === 0) || null;
  });
  const privacySecEl = privacySec.asElement();
  if (privacySecEl) {
    await privacySecEl.click();
    await delay(400);
  }
  const privacyRow = await page.evaluate(() => {
    const box = document.querySelector('input[data-action="tglConsentStat"]');
    if (!box) {
      return null;
    }
    // The switch is a custom control: the input itself is hidden by design
    // (the visible part is the .tsl track), so visibility is measured on the
    // track the user actually clicks.
    const track = box.parentElement ? box.parentElement.querySelector('.tsl') : null;
    const vis = el => !!(el && el.getClientRects().length);
    return {
      exists: true,
      checked: !!box.checked,
      switchVisible: vis(track),
      label: box.getAttribute('aria-label') || ''
    };
  });
  check(
    'B13a the app has a Privacy Usage statistics toggle, synced to the saved choice',
    !!privacyRow && privacyRow.exists && privacyRow.switchVisible && privacyRow.checked === false,
    privacyRow
  );
  // Click the visible switch track (the label wraps the input, so this is
  // exactly what a user clicks).
  await page.click('label.tgl:has(input[data-action="tglConsentStat"]) .tsl');
  await delay(250);
  const appOn = await consentOf();
  const appWantMirror = appOn ? String(appOn.iv) + '.' + Date.parse(appOn.ts) : '';
  check(
    'B13b turning it ON in the app writes the choice and the versioned mirror cookie',
    !!appOn && appOn.analytics === true && (await mirrorCookie()).join() === appWantMirror,
    { appOn, mirror: await mirrorCookie(), appWantMirror }
  );
  await page.click('label.tgl:has(input[data-action="tglConsentStat"]) .tsl');
  await delay(250);
  const appOff = await consentOf();
  check(
    'B13c turning it OFF in the app clears the mirror cookie again',
    !!appOff && appOff.analytics === false && (await mirrorCookie()).length === 0,
    { appOff, mirror: await mirrorCookie() }
  );

  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  // axe is evaluated as a page expression (never as a script tag): the CSP
  // rightly blocks injected inline scripts, but page.evaluate is not one.
  await page.evaluate(axeSource());
  const axeRun = () =>
    page.evaluate(async () => {
      const res = await window.axe.run('#consent-card', {
        resultTypes: ['violations']
      });
      return res.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
    });
  const lightViolations = await axeRun();
  check(
    'B11a axe clean on the banner (light palette)',
    lightViolations.length === 0,
    lightViolations
  );
  await page.evaluate(() => document.body.classList.add('dark-mode'));
  const darkViolations = await axeRun();
  check('B11b axe clean on the banner (dark palette)', darkViolations.length === 0, darkViolations);

  check('B12 zero page errors across the flow', pageErrors.length === 0, pageErrors);
  await browser.close();
}

(async () => {
  const srv = await ensureServer();
  try {
    phaseStatic();
    await phaseBrowser();
  } finally {
    if (srv) {
      try {
        srv.kill();
      } catch (e) {}
    }
  }
  log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => {
  log('ERROR ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
