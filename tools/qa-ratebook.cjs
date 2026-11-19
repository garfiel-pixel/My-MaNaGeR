#!/usr/bin/env node
/* ============================================================
   qa-ratebook.cjs - RB-1 gate (REFINEMENT-DIRECTIVE-2026-10-24 3.4)
   ------------------------------------------------------------
   The 811 planning rates used to be a PUBLIC static file, and the
   publisher's PDF sat in the repo root. Live probe before the fix
   (2026-10-25): both answered 200 to anyone, signed in or not, and
   the service worker precached the rates for every visitor - so the
   sign-in gate on the rate-book card was a screen, not a lock.

   OWNER 2026-11-17: the rate book is My MaNaGeR's OWN first-party data and a
   TRADE SECRET. No endpoint returns the whole book. A signed-in session may
   look up ONE rate by id (GET /api/ratebook/rate/:id); the old whole-book
   route is retired. The browser caches only the single rates a line used,
   under mmgr-ratebook-v2.

   T2 harness: starts a local wrangler dev on its own port and asks
   the questions the gate asks.

     R1  signed-out per-id GET -> 401 and no rate in the body
     R2  signed-out GET /js/rates-full.js -> 404
     R3  signed-out GET of the old publisher PDF -> 404
     R4  a FORGED session cookie -> 401 (a cookie is not a session)
     R5  the WHOLE-book route -> 404 (no path returns all rows)
     R6  signed-in per-id GET -> 200 with exactly ONE row, Cache-Control:
         private, no provenance serialised; unknown id -> 404
     R7  the service-worker shell lists no rate file, and the public
         data file is gone from disk
     R8  the calculator uses /api/ratebook/rate/:id with per-id cache
         mmgr-ratebook-v2 (no whole-book fetch, no whole-book copy)

   Usage: node tools/qa-ratebook.cjs
   Registry: docs/CI-TEST-COVERAGE.md -> CI row (T2 group in ci.yml).
   Wrangler log + persist dir stay OUTSIDE the repo (AGENTS lesson 11).
   ============================================================ */
'use strict';
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = parseInt(process.env.QA_PORT || '8812', 10);
const BASE = 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');
const HOME = os.homedir();
const PERSIST_DIR = process.env.QA_PERSIST_DIR || path.join(HOME, 'wrangler-ratebook-state');
const LOG_PATH = path.join(HOME, 'wrangler-ratebook.log');
const log = s => process.stdout.write('[ratebook] ' + s + '\n');
const delay = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, val, detail) => {
  results.push({ name, val: !!val });
  log(
    (val ? 'PASS' : 'FAIL') +
      '  ' +
      name +
      (val ? '' : '  <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 500))
  );
};
const j = async res => {
  try {
    return await res.json();
  } catch (e) {
    return {};
  }
};

let proc = null;
function globalWranglerJs() {
  try {
    const out = execFileSync(
      process.execPath,
      [path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), '--version'],
      { encoding: 'utf8', timeout: 30000 }
    );
    if (out) {
      return path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
    }
  } catch (e) {
    /* not local */
  }
  const env = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');
  const guess = path.join(env, 'npm', 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  return fs.existsSync(guess) ? guess : null;
}
const WRANGLER_JS = globalWranglerJs();

async function startWrangler() {
  try {
    fs.mkdirSync(PERSIST_DIR, { recursive: true });
  } catch (e) {
    /* exists */
  }
  try {
    execFileSync(
      process.execPath,
      [
        WRANGLER_JS,
        'd1',
        'migrations',
        'apply',
        'my-manager-db',
        '--local',
        '--config',
        'wrangler.ci.jsonc',
        '--persist-to',
        PERSIST_DIR
      ],
      { cwd: ROOT, stdio: 'ignore', timeout: 90000 }
    );
  } catch (e) {
    log('migrations (best-effort): ' + e.message);
  }
  const out = fs.openSync(LOG_PATH, 'a');
  proc = spawn(
    process.execPath,
    [
      WRANGLER_JS,
      'dev',
      '--config',
      'wrangler.ci.jsonc',
      '--port',
      String(PORT),
      '--ip',
      '127.0.0.1',
      '--persist-to',
      PERSIST_DIR
    ],
    {
      cwd: ROOT,
      stdio: ['ignore', out, out],
      env: Object.assign({}, process.env, {
        ADMIN_CODE: 'QA-RATEBOOK-ADMIN',
        WRANGLER_SEND_METRICS: 'false'
      })
    }
  );
  const t0 = Date.now();
  for (;;) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const r = await fetch(BASE + '/api/health', { signal: ctrl.signal });
      clearTimeout(timer);
      if (r.ok) {
        return;
      }
    } catch (e) {
      /* not up yet */
    }
    if (Date.now() - t0 > 120000) {
      throw new Error('wrangler dev did not come up (log ' + LOG_PATH + ')');
    }
    await delay(1500);
  }
}
function stopWrangler() {
  try {
    proc && proc.kill();
  } catch (e) {
    /* gone */
  }
}

function read(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
  } catch (e) {
    return '';
  }
}

(async function main() {
  if (!WRANGLER_JS) {
    log('FATAL: wrangler not found');
    process.exit(1);
  }

  // ---- static half: the pieces that must not exist, and the source contract.
  // The retired public data file is checked by CLASS, not by one name, so a
  // rename cannot quietly reintroduce it.
  const PUBLIC_DATA = /rates?-full/i;
  check(
    'R7a no public full rate-data file sits in js/',
    fs.readdirSync(path.join(ROOT, 'js')).every(n => !PUBLIC_DATA.test(n))
  );
  const shell = read('sw.js');
  const shellList = shell
    .slice(shell.indexOf('const SHELL'), shell.indexOf('];', shell.indexOf('const SHELL')))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  check(
    'R7b the service-worker shell lists no rate file',
    !PUBLIC_DATA.test(shellList) && !/ratebook/i.test(shellList),
    { hit: (shellList.match(/.*rate.*/i) || [''])[0].slice(0, 120) }
  );
  const calc = read('js/calculator-page.js');
  check(
    'R8a the calculator no longer injects a rate-data script',
    !/createElement\('script'\)[\s\S]{0,200}rates?-full/i.test(calc) && !/rates?-full/i.test(calc)
  );
  check(
    'R8b it looks up a single rate at /api/ratebook/rate/:id',
    /\/api\/ratebook\/rate\//.test(calc) && /function rrLookupRate/.test(calc)
  );
  check(
    'R8c it keeps single-rate copies in mmgr-ratebook-v2, never v1',
    /RATEBOOK_CACHE\s*=\s*'mmgr-ratebook-v2'/.test(calc) && calc.indexOf('mmgr-ratebook-v1') === -1
  );
  check(
    'R8d the per-id cache is read BEFORE the network',
    calc.indexOf('rrCacheRead(id)') > -1 &&
      calc.indexOf('rrCacheRead(id)') < calc.indexOf('fetch(rateUrl(id)')
  );
  check(
    'R8e signing out clears the rate-book cache',
    /caches\.delete\('mmgr-ratebook-v2'\)/.test(read('js/mmgr-google-auth.js'))
  );
  check(
    'R8f no whole-book route or whole-book fetch remains',
    calc.indexOf("fetch('/api/ratebook'") === -1 && calc.indexOf('fetch(RATEBOOK_URL') === -1
  );

  try {
    await startWrangler();
  } catch (e) {
    log('FATAL: ' + e.message);
    process.exit(1);
  }

  try {
    const RATE_URL = id => BASE + '/api/ratebook/rate/' + id;

    // R1: signed out, a single rate does not exist for you either.
    const r1 = await fetch(RATE_URL('excavation-1'));
    const b1 = await j(r1);
    check(
      'R1 signed-out per-id lookup -> 401 with no rate',
      r1.status === 401 && !b1.rate && b1.ok === false,
      { status: r1.status, keys: Object.keys(b1) }
    );

    // R2: the old public data file.
    const r2 = await fetch(BASE + '/js/rates-full.js');
    check('R2 old rate-data path -> 404', r2.status === 404, { status: r2.status });

    // R3: the publisher's PDF that used to sit in the root.
    const r3 = await fetch(BASE + '/rate-book-2025-2027-imperial-metric.pdf');
    check('R3 old rate-book PDF path -> 404', r3.status === 404, { status: r3.status });

    // R4: a cookie is not a session. Forged HMAC must not open a rate.
    const r4 = await fetch(RATE_URL('excavation-1'), {
      headers: { Cookie: 'mmgr_session=forged.deadbeef' }
    });
    check('R4 forged cookie -> 401', r4.status === 401, { status: r4.status });

    // R5: the WHOLE-book route is retired - no path returns all rows.
    const r5whole = await fetch(BASE + '/api/ratebook');
    check('R5a retired whole-book route -> 404', r5whole.status === 404, {
      status: r5whole.status
    });

    // A real session, minted the way the app mints one.
    const email = 'ratebook-' + Date.now().toString(36) + '@example.com';
    let r = await fetch(BASE + '/api/auth/register', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: 's3cure-pass-1', name: 'Rate Book QA' })
    });
    let cookie = '';
    const m = (r.headers.get('set-cookie') || '').match(/mmgr_session=([^;]+)/);
    if (m) {
      cookie = m[1];
    }
    if (!cookie) {
      r = await fetch(BASE + '/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: 's3cure-pass-1' })
      });
      const m2 = (r.headers.get('set-cookie') || '').match(/mmgr_session=([^;]+)/);
      if (m2) {
        cookie = m2[1];
      }
    }
    if (!cookie) {
      check('R6 a session could be minted to test the signed-in path', false);
    } else {
      const r6 = await fetch(RATE_URL('excavation-1'), {
        headers: { Cookie: 'mmgr_session=' + cookie }
      });
      const b6 = await j(r6);
      const rate = b6.rate || {};
      check(
        'R6a signed-in per-id lookup -> 200 with EXACTLY one row (no list)',
        r6.status === 200 &&
          !!b6.ok &&
          rate.id === 'excavation-1' &&
          !b6.book &&
          !b6.rows &&
          !b6.rates,
        { status: r6.status, keys: Object.keys(b6) }
      );
      const cc = r6.headers.get('cache-control') || '';
      const vary = r6.headers.get('vary') || '';
      check('R6b Cache-Control is private', /^private/.test(cc), { cacheControl: cc });
      check('R6c Vary includes Cookie', /cookie/i.test(vary), { vary });
      const raw = JSON.stringify(b6);
      check(
        'R6d the response never serialises the provenance record',
        raw.indexOf('RATEBOOK_PROVENANCE') === -1 &&
          raw.indexOf('JIC_Rate_Book') === -1 &&
          raw.indexOf('publisher') === -1,
        { sample: raw.slice(0, 120) }
      );
      // R6e: a signed-in unknown id is a clean 404, not a row and not a list.
      const r6bad = await fetch(RATE_URL('no-such-trade-9999'), {
        headers: { Cookie: 'mmgr_session=' + cookie }
      });
      check('R6e signed-in unknown id -> 404', r6bad.status === 404, { status: r6bad.status });

      // R9: rate limiting. The general bucket allows 30/min; hammer the
      // per-id route until one answer is 429. Placed LAST so the shared-IP
      // counter cannot poison the gates above.
      let saw429 = false;
      for (let i = 0; i < 40 && !saw429; i++) {
        const rr = await fetch(RATE_URL('excavation-1'), {
          headers: { Cookie: 'mmgr_session=' + cookie }
        });
        if (rr.status === 429) {
          saw429 = true;
        }
      }
      check('R9 repeated per-id lookups are rate limited (429)', saw429);
    }
  } catch (e) {
    check('harness ran without throwing', false, e && e.message);
  } finally {
    stopWrangler();
  }

  const failed = results.filter(x => !x.val);
  log('');
  log(
    (failed.length ? 'FAIL' : 'PASS') +
      ' - ' +
      (results.length - failed.length) +
      '/' +
      results.length +
      ' gates'
  );
  process.exit(failed.length ? 1 : 0);
})();
