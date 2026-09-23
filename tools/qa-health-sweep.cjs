/* ============================================================
   My MaNaGeR — page health sweep (Playwright)
   ------------------------------------------------------------
   Loads every served page in a real browser and reports the class
   of breakage the per-feature gates cannot see, page by page:

     - console errors / uncaught page exceptions
     - failed requests + HTTP >= 400 responses
     - CSP violations (Refused to ... / Content Security Policy)
     - LIVE CSP inline-script hash drift vs the blocks on disk
       (AGENTS.md lesson 10: a running serve.cjs keeps the hashes it
       computed at startup, so a disk-only check can pass while the
       browser is served a stale policy)
     - emoji glyphs in rendered text (hard gate, owner 2026-08-13)
     - leaked raw values ("undefined" / "NaN" / "[object Object]")
     - meta sanity: <title>, <html lang>, meta viewport

   Expected-on-localhost findings are classified, not counted (otherwise the
   gate could never go green and would be ignored):
     - accounts.google.com/gsi/* 400/403 - Google rejects 127.0.0.1 as an
       unregistered OAuth origin; works on the real domain.
     - /api/* 401/403 - the signed-out gate. There is no session in a fresh
       browser profile, by design.
     - /api/* 404 and the presence WebSocket upgrade failure when QA_BASE is
       the static dev server (serve.cjs mirrors only part of the Worker API).
   Everything else (5xx, missing assets, unexpected 404s) is a real finding,
   and generic "Failed to load resource" console lines are dropped because the
   URL-level response check above already carries that signal.

   Usage:
     node serve.cjs &                    # or: wrangler dev (port 8787)
     node tools/qa-health-sweep.cjs                      # :8765 default
     node tools/qa-health-sweep.cjs http://127.0.0.1:8787 # the Worker
     QA_BASE=http://host:port node tools/qa-health-sweep.cjs

   Exit codes: 0 = every page clean, 1 = findings, 2 = harness error.

   Playwright: the LIBRARY must resolve (env PLAYWRIGHT_MODULE, a local
   devDependency, or an npx cache copy) but the BROWSER does not have to
   be Playwright's download - we drive the installed Chrome through
   tools/chrome-launcher.cjs, the same binary the CDP harnesses use.

   LOCAL-VS-PRODUCTION NOTE: against serve.cjs, /api/* routes are absent
   (404) and Google GSI rejects 127.0.0.1 as an unregistered origin, so a
   handful of expected findings always appear. Aim it at wrangler dev
   (:8787) to exercise the real Worker + CSP header. Pages are requested
   with their .html names: production strips the extension, so assert on
   both forms in feature gates (AGENTS.md lesson 4).
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const BASE = process.argv[2] || process.env.QA_BASE || 'http://127.0.0.1:' + (process.env.QA_PORT || '8765');

const PAGES = [
  'index.html', 'features.html', 'about.html', 'contact.html', 'reviews.html',
  'privacy.html', 'terms.html', 'mymanager-field-guide.html',
  'dashboard.html', 'app.html', 'project.html?id=demo-project',
  'admin.html', 'verify.html', 'reset.html', 'seed-test.html'
];

// Owner hard gate: no emoji glyph on any served page.
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;
const LEAK_RE = /\bundefined\b|\bNaN\b|\[object Object\]/;

// The static dev server (serve.cjs) mirrors only part of the Worker API.
const IS_DEV_SERVER = /:8765\b/.test(BASE);

function isExpectedOnLocalhost(url, status) {
  const u = String(url || '');
  if (/accounts\.google\.com\/gsi\//.test(u) || /googleusercontent\.com/.test(u)) return true;
  if (/\/api\//.test(u)) {
    if (status === 401 || status === 403) return true;           // signed-out gate
    if (IS_DEV_SERVER && (status === 404 || status === 0)) return true; // no route mirror
  }
  if (IS_DEV_SERVER && /\/api\/cloud\/presence/.test(u)) return true;   // no Durable Object locally
  return false;
}

// Console messages that are explained by the expected local-only conditions
// above (the URL-level response check still carries their real signal).
function isExpectedConsoleMessage(txt) {
  const t = String(txt || '').trim();
  // Generic resource-load failure: no URL in the text, already reported with
  // its real URL + status by the response listener - never double-count it.
  if (/^Failed to load resource/i.test(t)) return true;
  // Google rejects 127.0.0.1 as an unregistered OAuth origin; fine on the
  // real domain.
  if (/GSI_LOGGER.*origin is not allowed/i.test(t)) return true;
  // Presence WebSocket: the static dev server has no Durable Object, so the
  // /api/cloud/presence upgrade always fails there. On wrangler dev the DO
  // exists and a failure would be a genuine finding.
  if (IS_DEV_SERVER && /WebSocket connection to .*\/api\/cloud\/presence/i.test(t)) return true;
  return false;
}

function resolvePlaywright() {
  if (process.env.PLAYWRIGHT_MODULE && fs.existsSync(process.env.PLAYWRIGHT_MODULE)) {
    return require(process.env.PLAYWRIGHT_MODULE);
  }
  try { return require('playwright'); } catch (e) { /* not a local dependency */ }
  const roots = [
    path.join(os.homedir(), 'AppData', 'Local', 'npm-cache', '_npx'),
    path.join(os.homedir(), '.npm', '_npx')
  ];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const dir of fs.readdirSync(root)) {
      const p = path.join(root, dir, 'node_modules', 'playwright');
      if (fs.existsSync(path.join(p, 'index.js'))) return require(p);
    }
  }
  throw new Error('playwright library not found - `npm i -D playwright` or set PLAYWRIGHT_MODULE to its path');
}

// Executable inline-script hashes for a page. A data block
// (<script type="application/ld+json">) is never executed, so script-src
// never applies and the repo's CSP verifier does not hash it either.
function diskHashes(file) {
  const rel = file.split('?')[0];
  if (!fs.existsSync(rel)) return null;
  const html = fs.readFileSync(rel, 'utf8');
  const out = [];
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    const type = (m[0].match(/<script[^>]*>/)[0].match(/type=["']([^"']+)["']/) || [])[1];
    if (type && !/^(module|text\/javascript|application\/javascript)$/.test(type)) continue;
    out.push(crypto.createHash('sha256').update(m[1]).digest('base64'));
  }
  return out;
}

(async () => {
  const { chromium } = resolvePlaywright();
  let executablePath;
  try { executablePath = require('./chrome-launcher.cjs').chromePath || undefined; } catch (e) { /* fall back to playwright's browser */ }
  const browser = await chromium.launch({ headless: true, executablePath });
  const rows = [];
  const loadedSheets = {};
  let flagged = 0;

  for (const file of PAGES) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    // Without the unlock key project.html?id=demo-project redirects to the
    // launcher and the sweep would silently measure app.html instead.
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('mmgr_unlocked_demo-project', '1');
        localStorage.setItem('mmgr_scope_demo-project', 'full');
      } catch (e) {}
    });
    const page = await ctx.newPage();
    const consoleErrors = [];
    const cspViolations = [];
    const exceptions = [];
    const badResponses = [];
    const failed = [];

    page.on('console', (m) => {
      const t = m.type();
      const txt = m.text();
      if (/Content Security Policy|Refused to/i.test(txt)) cspViolations.push(txt);
      else if (t === 'error') consoleErrors.push(txt);
    });
    page.on('pageerror', (e) => exceptions.push(String((e && e.message) || e)));
    page.on('response', (r) => { if (r.status() >= 400) badResponses.push(r.status() + ' ' + r.url()); });
    page.on('requestfailed', (r) => failed.push(((r.failure() && r.failure().errorText) || 'failed') + ' ' + r.url()));

    // One retry per page (repo law, 2026-09-20 tracker entry: "every boot path
    // needs one retry - runners flake, the run is the truth"). Without it a
    // single contended load - e.g. this sweep started while other browser
    // suites' Chrome processes are still shutting down - flips the gate red and
    // a gate that cries wolf gets ignored. Findings from the failed first
    // attempt are discarded so a retry cannot double-count; the navigation
    // error is only recorded if the SECOND attempt also fails.
    let res = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        res = await page.goto(BASE + '/' + file, { waitUntil: 'load', timeout: 25000 });
        break;
      } catch (e) {
        if (attempt === 2) { exceptions.push('navigation: ' + e.message); break; }
        res = null;
        consoleErrors.length = 0; cspViolations.length = 0; badResponses.length = 0; failed.length = 0;
        await page.waitForTimeout(1500);
      }
    }
    await page.waitForTimeout(2500);

    let info = { title: '', lang: '', viewport: '', bodyText: '' };
    try {
      info = await page.evaluate(() => ({
        title: document.title || '',
        lang: document.documentElement.getAttribute('lang') || '',
        viewport: (document.querySelector('meta[name="viewport"]') || {}).content || '',
        sheets: Array.from(document.querySelectorAll('link[rel=stylesheet]')).map((l) => l.getAttribute('href') || ''),
        bodyText: (document.body ? document.body.innerText : '').slice(0, 200000)
      }));
    } catch (e) { /* page died during evaluate */ }

    let cspNote = '';
    let cspMissing = 0;
    try {
      const header = (res && res.headers()['content-security-policy']) || '';
      const declared = (header.match(/sha256-[A-Za-z0-9+/=]+/g) || []).map((s) => s.slice(7));
      const onDisk = diskHashes(file) || [];
      cspMissing = onDisk.filter((h) => declared.indexOf(h) === -1).length;
      if (!header) cspNote = 'NO CSP HEADER';
      else if (cspMissing) cspNote = 'MISSING-FROM-LIVE-CSP x' + cspMissing;
      else cspNote = 'live list superset of this page (' + declared.length + ' hashes, site-wide)';
    } catch (e) { cspNote = 'probe failed: ' + e.message; }

    const emoji = EMOJI_RE.test(info.bodyText);
    const leak = LEAK_RE.test(info.bodyText);

    // Split expected-on-localhost noise from real findings (see header).
    const parse = (s) => { const m = String(s).match(/^(\d+)\s+(.*)$/); return m ? { status: Number(m[1]), url: m[2] } : { status: 0, url: String(s) }; };
    const unexpectedResponses = badResponses.filter((s) => { const p = parse(s); return !isExpectedOnLocalhost(p.url, p.status); });
    const unexpectedFailed = failed.filter((s) => !isExpectedOnLocalhost(s, 0));
    const realConsoleErrors = consoleErrors.filter((t) => !isExpectedConsoleMessage(t));
    const expectedCount = badResponses.length - unexpectedResponses.length + (failed.length - unexpectedFailed.length);

    const problems = [];
    if (realConsoleErrors.length) problems.push('console-errors:' + realConsoleErrors.length);
    if (cspViolations.length) problems.push('CSP-violations:' + cspViolations.length);
    if (exceptions.length) problems.push('exceptions:' + exceptions.length);
    if (unexpectedResponses.length) problems.push('http>=400:' + unexpectedResponses.length);
    if (unexpectedFailed.length) problems.push('req-failed:' + unexpectedFailed.length);
    if (emoji) problems.push('EMOJI');
    if (leak) problems.push('LEAKED-RAW-VALUE');
    if (!info.title) problems.push('no-title');
    if (!info.lang) problems.push('no-lang-attr');
    if (!info.viewport) problems.push('no-viewport-meta');
    if (!res || cspMissing || /NO CSP HEADER/.test(cspNote)) problems.push('CSP-DRIFT');
    if (problems.length) flagged++;

    loadedSheets[file] = info.sheets || [];
    rows.push({
      file, status: res ? res.status() : 'n/a', problems, cspNote, expectedCount,
      consoleErrors: realConsoleErrors, cspViolations, exceptions,
      badResponses: unexpectedResponses, failed: unexpectedFailed,
      emojiSample: emoji ? (info.bodyText.match(EMOJI_RE) || [''])[0] : '',
      leakSample: leak ? (info.bodyText.match(LEAK_RE) || [''])[0] : ''
    });
    console.log((problems.length ? 'FAIL ' : 'ok   ') + file + (problems.length ? '  :: ' + problems.join(' ') : '') +
      (expectedCount ? '  [' + expectedCount + ' expected local-only]' : ''));
    await ctx.close();
  }

  // ---- CSS rule coverage: every source rule must exist as a LIVE rule ----
  // The static half lives in tools/verify-css-integrity.cjs; this is the
  // browser's own verdict, which is what catches a rule the parser dropped
  // (2026-09-22: a malformed comment killed .t-sm and .btn.full in production).
  const SHEET_PAIRS = [
    { dist: 'mmgr.min.css', src: 'css/mmgr.css' },
    { dist: 'marketing.min.css', src: 'css/marketing.css' }
  ];
  console.log('\n===== CSS RULE COVERAGE (live CSSOM vs source) =====');
  for (const pair of SHEET_PAIRS) {
    const hostPage = Object.keys(loadedSheets).find((p) => (loadedSheets[p] || []).some((h) => h.indexOf(pair.dist) > -1));
    if (!hostPage) { console.log('  SKIP  ' + pair.dist + ' - no swept page loads it'); continue; }
    const srcCss = fs.readFileSync(pair.src, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const srcClasses = new Set();
    for (const m of srcCss.matchAll(/([^{}]+)\{/g)) {
      for (const s of m[1].split(',')) for (const c of (s.trim().match(/\.([A-Za-z][A-Za-z0-9_-]*)/g) || [])) srcClasses.add(c.slice(1));
    }
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    await p.goto(BASE + '/' + hostPage, { waitUntil: 'load' });
    await p.waitForTimeout(2500);
    const live = await p.evaluate(() => {
      const seen = {};
      const walk = (rules) => {
        for (const r of rules) {
          if (r.cssRules && r.cssRules.length) { walk(r.cssRules); continue; }
          if (r.selectorText) for (const c of (r.selectorText.match(/\.([A-Za-z][A-Za-z0-9_-]*)/g) || [])) seen[c.slice(1)] = true;
        }
      };
      for (const sheet of document.styleSheets) { try { walk(sheet.cssRules); } catch (e) {} }
      return Object.keys(seen);
    });
    await ctx.close();
    const liveSet = {};
    live.forEach((c) => { liveSet[c] = true; });
    const dropped = Array.from(srcClasses).filter((c) => !liveSet[c]);
    if (dropped.length) {
      console.log('  FAIL  ' + pair.src + ': ' + dropped.length + ' rule(s) have no live rule in the browser -> ' + dropped.slice(0, 12).join(', '));
      flagged++;
    } else {
      console.log('  PASS  ' + pair.src + ': all ' + srcClasses.size + ' rules live (checked on ' + hostPage + ')');
    }
  }

  await browser.close();

  console.log('\n===== DETAIL =====');
  for (const r of rows) {
    if (!r.problems.length) continue;
    console.log('\n--- ' + r.file + ' (status ' + r.status + ')');
    for (const key of ['consoleErrors', 'cspViolations', 'exceptions', 'badResponses', 'failed']) {
      if (r[key].length) console.log('  ' + key + ': ' + JSON.stringify(r[key].slice(0, 5), null, 2));
    }
    if (r.emojiSample) console.log('  emoji glyph: ' + JSON.stringify(r.emojiSample));
    if (r.leakSample) console.log('  leaked value: ' + JSON.stringify(r.leakSample));
    console.log('  csp: ' + r.cspNote);
    if (r.expectedCount) console.log('  (plus ' + r.expectedCount + ' expected local-only event(s): signed-out /api 401-403, GSI origin, dev-server 404s)');
  }
  console.log('\n===== HEALTH SWEEP: ' + (PAGES.length - flagged) + ' clean / ' + flagged + ' with findings of ' + PAGES.length + ' pages =====');
  process.exit(flagged ? 1 : 0);
})().catch((e) => { console.error('ERR', (e && e.stack) || e); process.exit(2); });
