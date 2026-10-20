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
         Save sets the mirror cookie to 1.
     B7  reload after accept: banner stays hidden and the CSP
         now allows the analytics host.
     B8  a stale choice (old inventory version) re-asks AND
         clears the mirror cookie, so the script is blocked again.
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
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    headless: true
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  const beaconRequests = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('request', r => {
    if (r.url().indexOf('static.cloudflareinsights.com') > -1) {
      beaconRequests.push(r.url());
    }
  });

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
  check('B2 zero analytics requests before a choice', beaconRequests.length === 0, beaconRequests);

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
  check(
    'B6b Save stores analytics=true and sets the mirror cookie to 1',
    !!afterSave && afterSave.analytics === true && (await mirrorCookie()).join() === '1',
    { afterSave, mirror: await mirrorCookie() }
  );

  await page.reload({ waitUntil: 'load' });
  const cspYes = await cspOf('/index.html');
  check(
    'B7 after accept: no banner and the CSP allows the analytics host',
    (await bannerVisible()) === false && cspYes.indexOf('static.cloudflareinsights.com') > -1
  );

  await page.evaluate(() => {
    const c = JSON.parse(localStorage.getItem('mmgr_consent'));
    c.iv = 99; // a future inventory version = the choice must be re-asked
    localStorage.setItem('mmgr_consent', JSON.stringify(c));
  });
  await page.reload({ waitUntil: 'load' });
  await delay(120);
  check(
    'B8 a stale choice re-asks AND clears the mirror cookie (script blocked again)',
    (await bannerVisible()) === true && (await mirrorCookie()).length === 0,
    { mirror: await mirrorCookie() }
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
  check(
    'B13b turning it ON in the app writes the choice and the mirror cookie',
    !!appOn && appOn.analytics === true && (await mirrorCookie()).join() === '1',
    { appOn, mirror: await mirrorCookie() }
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
