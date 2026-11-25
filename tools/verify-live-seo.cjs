#!/usr/bin/env node
/* ============================================================
   tools/verify-live-seo.cjs
   GATE: post-deploy - the live origin serves this checkout's SEO files
   ------------------------------------------------------------
   WHY THIS EXISTS (2026-11-24)
   The launch wave shipped /llms.txt and the IndexNow key file, then a live
   probe right after the merge answered 404 for both. Nothing was wrong with
   the repo (local `wrangler dev` served all three 200, `git ls-tree` showed
   them tracked): the Cloudflare Workers Build that deploys `main` had not
   finished rolling out yet. A 404 therefore cannot be read as "the file is
   missing" or "the deploy is broken" at the moment you look at it - only as
   "not yet", until a deadline has passed.

   This harness encodes that: it POLLS the live origin until every route in
   `worker.js`'s SEO_FILES map serves bytes that are byte-identical to the
   files in this checkout (so a stale deploy cannot pass), then checks the
   route hygiene around them. On timeout it prints the last observed state
   with the two real causes named, instead of leaving a bare 404.

   Checks
     1. every SEO_FILES route: HTTP 200, the pinned Content-Type, and a body
        identical to the local file (an HTML SPA shell is a failure, not a
        200 - that is what an un-uploaded file used to look like). Line
        endings are normalised to LF first: sitemap.xml and BingSiteAuth.xml
        are not pinned `eol=lf` in .gitattributes, so a Windows worktree
        checkouts them CRLF (2046/88 bytes) while the Linux CI checkout sees
        LF (1985/85). Comparing raw bytes made this gate pass locally and fail
        in CI on the same commit (2026-11-24). Nothing else is normalised -
        a content edit, a missing file and a stale deploy still fail;
     2. every SEO_FILES entry has a real file in the checkout, so a route
        added to worker.js without its asset is caught before the deploy;
     3. route hygiene: /manifest.webmanifest 200, /app.html 307 -> /app, and
        an unknown path still 404s (the SPA fallback guard);
     4. app surface: /signin serves HTML carrying a sign-in affordance, and
        /api/health returns 200 JSON with { ok: true, app: 'my-manager' };
     5. canonical host: www 301s to the apex with the path and query intact,
        so the site never answers 200 on two hostnames.

   Env / args
     node tools/verify-live-seo.cjs [origin]     # default: production
     MMGR_LIVE_ORIGIN      origin override
     MMGR_SEO_TIMEOUT_MS   total poll budget (default 90000 local; CI sets
                           1200000 to absorb a slow Workers Build)
     MMGR_SEO_INTERVAL_MS  poll interval (default 15000)

   Registry: docs/CI-TEST-COVERAGE.md -> POST-DEPLOY row.
   Workflow: .github/workflows/post-deploy-smoke.yml (push to main).
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_ORIGIN = 'https://mymanagerworkspace.com';
const ORIGIN = (process.argv[2] || process.env.MMGR_LIVE_ORIGIN || DEFAULT_ORIGIN).replace(
  /\/+$/,
  ''
);
const TIMEOUT_MS = Number(process.env.MMGR_SEO_TIMEOUT_MS) || 90000;
const INTERVAL_MS = Number(process.env.MMGR_SEO_INTERVAL_MS) || 15000;
const UNKNOWN_PATH = '/mmgr-seo-smoke-not-a-route';

const results = [];
// Byte-for-byte, except CRLF vs LF. utf8 round-trip is lossy for arbitrary
// bytes, so decode/encode through latin1, which maps 1:1 onto bytes.
const normalizeEol = buf => Buffer.from(buf.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail: detail || '' });

/* ---- expected routes, read from the Worker itself ---------------------
   SEO_FILES is the single source of truth for "served with a pinned type".
   Parsing it here means a new SEO route joins this gate automatically; the
   copies that must agree with it are .assetsignore and tools/deploy.cjs. */
function seoFiles() {
  const src = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
  const start = src.indexOf('const SEO_FILES = {');
  if (start < 0) {
    throw new Error('could not find `const SEO_FILES = {` in worker.js');
  }
  const end = src.indexOf('};', start);
  const map = {};
  for (const m of src.slice(start, end).matchAll(/'(\/[^']+)':\s*'([^']+)'/g)) {
    map[m[1]] = m[2];
  }
  return map;
}

function get(url, timeoutMs) {
  return fetch(url, {
    redirect: 'manual',
    headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache', 'User-Agent': 'mmgr-seo-smoke' },
    signal: AbortSignal.timeout(timeoutMs || 20000)
  });
}

function hintFor(status) {
  if (status === 404) {
    return (
      'not deployed yet, or missing from the upload. The Workers Build for a `main` push ' +
      'lags the merge, so wait out the poll budget first; if it still 404s, the file is ' +
      'absent from the asset bundle - check the .assetsignore negation for it and ' +
      'COPY_BACK in tools/deploy.cjs.'
    );
  }
  if (status === 0) {
    return 'the origin did not answer (network, DNS, or the Worker is refusing connections)';
  }
  return 'the live response does not match this checkout';
}

async function collect() {
  results.length = 0;
  let files;
  try {
    files = seoFiles();
  } catch (e) {
    check('worker.js declares an SEO_FILES map', false, e.message);
    return results;
  }
  check('worker.js declares an SEO_FILES map', Object.keys(files).length > 0, Object.keys(files));

  for (const [route, pinnedType] of Object.entries(files)) {
    const localPath = path.join(ROOT, route.slice(1));
    const hasLocal = fs.existsSync(localPath);
    check(route + ' exists in this checkout', hasLocal, localPath);
    if (!hasLocal) {
      continue;
    }
    let res;
    try {
      res = await get(ORIGIN + route);
    } catch (e) {
      check(route + ' is served', false, 'fetch failed: ' + e.message + ' - ' + hintFor(0));
      continue;
    }
    const type = (res.headers.get('content-type') || '').toLowerCase().trim();
    const body = Buffer.from(await res.arrayBuffer());
    const local = fs.readFileSync(localPath);
    const same = res.status === 200 && normalizeEol(body).equals(normalizeEol(local));
    check(
      route + ' is served',
      same,
      same
        ? ''
        : 'HTTP ' +
            res.status +
            ', ' +
            body.length +
            ' bytes (checkout has ' +
            local.length +
            '), type "' +
            type +
            '" - ' +
            (res.status === 200
              ? 'content differs from the checkout after LF normalisation'
              : hintFor(res.status))
    );
    if (res.status === 200) {
      check(
        route + ' carries the pinned Content-Type',
        type === pinnedType.toLowerCase(),
        'got "' + type + '", worker.js pins "' + pinnedType + '"'
      );
      check(
        route + ' is not the SPA shell',
        !/^\s*<!DOCTYPE html/i.test(body.toString('utf8', 0, 200)),
        'the route answered with HTML, so env.ASSETS.fetch() missed and something fell through'
      );
    }
  }

  const manifest = await get(ORIGIN + '/manifest.webmanifest').catch(e => e);
  check(
    '/manifest.webmanifest is served',
    manifest && manifest.status === 200 && /json/i.test(manifest.headers.get('content-type') || ''),
    manifest && manifest.status ? 'HTTP ' + manifest.status : String(manifest && manifest.message)
  );

  const shell = await get(ORIGIN + '/app.html').catch(e => e);
  const location = (shell && shell.headers.get('location')) || '';
  check(
    '/app.html redirects to the extensionless /app',
    shell && shell.status === 307 && /\/app$/.test(location),
    shell && shell.status ? 'HTTP ' + shell.status + ' location "' + location + '"' : 'no answer'
  );

  const missing = await get(ORIGIN + UNKNOWN_PATH).catch(e => e);
  check(
    'an unknown path still 404s',
    missing && missing.status === 404,
    missing && missing.status ? 'HTTP ' + missing.status : 'no answer'
  );

  const signin = await get(ORIGIN + '/signin').catch(e => e);
  let signinOk = false;
  let signinDetail = 'no answer';
  if (signin && signin.status === 200) {
    const ct = (signin.headers.get('content-type') || '').toLowerCase();
    let body = '';
    try {
      body = await signin.text();
    } catch (e) {
      body = '';
    }
    signinOk = /text\/html/i.test(ct) && /google-signin-button|signin-done/i.test(body);
    signinDetail =
      'HTTP ' + signin.status + ', type "' + ct + '"' + (signinOk ? '' : ' (marker missing)');
  } else if (signin && signin.status) {
    signinDetail = 'HTTP ' + signin.status;
  } else if (signin && signin.message) {
    signinDetail = 'fetch failed: ' + signin.message;
  }
  check('/signin is served (HTML with a sign-in affordance)', signinOk, signinDetail);

  const health = await get(ORIGIN + '/api/health').catch(e => e);
  let healthOk = false;
  let healthDetail = 'no answer';
  if (health && health.status === 200) {
    const ct = (health.headers.get('content-type') || '').toLowerCase();
    let parsed = null;
    let raw = '';
    try {
      raw = await health.text();
      parsed = JSON.parse(raw);
    } catch (e) {
      parsed = null;
    }
    healthOk = /json/i.test(ct) && !!parsed && parsed.ok === true && parsed.app === 'my-manager';
    healthDetail =
      'HTTP ' + health.status + ', body ' + (parsed ? JSON.stringify(parsed) : raw.slice(0, 80));
  } else if (health && health.status) {
    healthDetail = 'HTTP ' + health.status;
  } else if (health && health.message) {
    healthDetail = 'fetch failed: ' + health.message;
  }
  check('/api/health answers ok JSON', healthOk, healthDetail);

  // www is a permanent alias of the apex (2026-11-24): the Worker answers 301
  // with the path and query intact, so one canonical origin serves every page
  // and the host-only session cookie and OAuth redirect URIs never split.
  // Only meaningful against the real apex - a local or workers.dev override
  // has no www host to probe, so the check is skipped rather than failed.
  if (new URL(ORIGIN).hostname === 'mymanagerworkspace.com') {
    const wwwPath = '/pricing?plan=pro';
    const wwwWant = ORIGIN + wwwPath;
    const www = await get(ORIGIN.replace('://', '://www.') + wwwPath).catch(e => e);
    const wwwLoc = www && www.headers ? www.headers.get('location') : null;
    check(
      'www redirects to the apex with path and query preserved',
      www && www.status === 301 && wwwLoc === wwwWant,
      www && www.status ? 'HTTP ' + www.status + ' -> ' + wwwLoc : 'no answer'
    );
  }

  return results;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const started = Date.now();
  console.log('\n=== POST-DEPLOY SEO SMOKE: ' + ORIGIN + ' ===');
  console.log(
    '  budget ' + Math.round(TIMEOUT_MS / 1000) + 's, polling every ' + INTERVAL_MS / 1000 + 's'
  );

  let attempt = 0;
  let failures = [];
  for (;;) {
    attempt++;
    const resultsNow = await collect();
    failures = resultsNow.filter(r => !r.ok);
    if (!failures.length) {
      for (const r of resultsNow) {
        console.log('  PASS  ' + r.name);
      }
      console.log(
        '\nPOST-DEPLOY SEO SMOKE PASS - ' +
          resultsNow.length +
          ' checks after ' +
          attempt +
          ' attempt(s), ' +
          Math.round((Date.now() - started) / 1000) +
          's'
      );
      process.exit(0);
    }
    const elapsed = Date.now() - started;
    if (elapsed + INTERVAL_MS > TIMEOUT_MS) {
      console.log('\n  still failing after ' + Math.round(elapsed / 1000) + 's:');
      for (const r of failures) {
        console.log('  FAIL  ' + r.name + (r.detail ? '  <-- ' + r.detail : ''));
      }
      console.log(
        '\nPOST-DEPLOY SEO SMOKE FAIL (' +
          failures.length +
          ' of ' +
          resultsNow.length +
          ' checks, ' +
          attempt +
          ' attempt(s) over ' +
          Math.round(elapsed / 1000) +
          's)'
      );
      console.log(
        'The deploy may still be running. Re-probe before changing code: a Workers Build ' +
          'can take many minutes after the merge.'
      );
      process.exit(1);
    }
    console.log(
      '  waiting: ' +
        failures.length +
        ' check(s) not ready after ' +
        Math.round(elapsed / 1000) +
        's (' +
        failures[0].name +
        '), retrying in ' +
        INTERVAL_MS / 1000 +
        's'
    );
    await sleep(INTERVAL_MS);
  }
})();
