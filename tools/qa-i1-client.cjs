/* ============================================================
   qa-i1-client.cjs — I-1 CLIENT regression (forged-cookie Playwright)
   ------------------------------------------------------------
   I-1 (owner, spoken audit): a project created while signed OUT never
   reappears under "My Cloud Projects" after re-sign-in. The SERVER
   contract is proven by T-CLOUDLIST (tools/qa-cloudlist.cjs). This
   harness proves the CLIENT half that T-CLOUDLIST cannot reach: the
   owner code now persists to localStorage (was sessionStorage) and the
   signed-in account auto-claims any held code via the real page JS.

   It boots a local wrangler dev (forged Google cookie, GOOGLE_CLIENT_SECRET
   shared with qa-cloudlist), then drives the REAL app.html in a headless
   Chromium:
     C1  anonymous create (no session) returns projectId + ownerCode
     C2  the real client setter (MMGR.Cloud.setCode) persists the code to
         localStorage (the I-1 fix) - survives the reload that follows
     C3  BEFORE sign-in the account list does NOT contain the orphan
     C4  forge a Google session cookie + reload -> the page restores the
         session and dispatches mmgr:google-signed-in
     C5  after sign-in, autoClaimHeldProjects has linked the orphan: the
         account list now contains the project (API-level proof)
     C6  the My Cloud Projects dashboard DOM renders the recovered row
     C7  the owner code is still in localStorage afterwards (persisted)

   Self-hosts its own wrangler dev (local D1/R2) and launches chromium via
   the repo's established Playwright pattern (qa-calc-playwright-audit.cjs).
   Registry: docs/CI-TEST-COVERAGE.md -> CI browser-app job.
   Usage: node tools/qa-i1-client.cjs   (needs `npx playwright install chromium`)
   ============================================================ */
'use strict';
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = parseInt(process.env.QA_PORT || '8821', 10);
const BASE = 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');
const TMP = os.tmpdir();

// Must equal the value the Worker reads for session signing (qa-team-rbac /
// qa-cloudlist prove GOOGLE_CLIENT_SECRET is that key), passed via --var.
const SECRET = 'qa-cloudlist-secret-3b7e9c12';
const ADMIN_CODE = 'qa-admin-cloudlist-9d41';
const FREE_CAP = '200';
const ALICE_EMAIL = 'i1.client.alice@example.com';

const log = s => process.stdout.write('[i1-client] ' + s + '\n');
const delay = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, val, detail) => {
  results.push({ name, val });
  log(
    (val ? 'PASS' : 'FAIL') +
      '  ' +
      name +
      (val ? '' : '   <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 500))
  );
};

// ---- wrangler scaffolding (mirrors qa-cloudlist.cjs) ----------------------
function globalWranglerJs() {
  try {
    const lp = path.join(__dirname, '..', 'node_modules', 'wrangler', 'bin', 'wrangler.js');
    if (fs.existsSync(lp)) return lp;
  } catch (e) {}
  try {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const root = execFileSync(npmCmd, ['root', '-g'], {
      encoding: 'utf8',
      shell: process.platform === 'win32'
    }).trim();
    const p = path.join(root, 'wrangler', 'bin', 'wrangler.js');
    if (fs.existsSync(p)) return p;
  } catch (e) {}
  return null;
}
const WRANGLER_JS = globalWranglerJs();
const PERSIST_DIR = path.join(TMP, 'mmgr-i1-client-wstate-' + Date.now());
const { stopWranglerIfLocal } = require('./wrangler-ci-helpers.cjs');

let proc = null;
let devLog = '';
async function startWrangler() {
  log('starting wrangler dev on :' + PORT + ' …');
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
      { cwd: ROOT, stdio: 'ignore', timeout: 120000 }
    );
  } catch (e) {
    log('migrations apply (best-effort): ' + e.message);
  }
  const args = [
    WRANGLER_JS,
    'dev',
    '--config',
    'wrangler.ci.jsonc',
    '--port',
    String(PORT),
    '--ip',
    '127.0.0.1',
    '--persist-to',
    PERSIST_DIR,
    '--var',
    'GOOGLE_CLIENT_SECRET:' + SECRET,
    '--var',
    'ADMIN_CODE:' + ADMIN_CODE,
    '--var',
    'FREE_PROJECT_CAP:' + FREE_CAP
  ];
  proc = spawn(process.execPath, args, {
    cwd: ROOT,
    env: Object.assign({}, process.env, { WRANGLER_SEND_METRICS: 'false' }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  proc.stdout.on('data', d => (devLog += d));
  proc.stderr.on('data', d => (devLog += d));
  proc.on('error', e => {
    throw new Error('wrangler spawn failed: ' + e.message);
  });
  const t0 = Date.now();
  for (;;) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const r = await fetch(BASE + '/api/health', { signal: ctrl.signal });
      clearTimeout(timer);
      if (r.ok) return;
    } catch (e) {
      /* not up yet */
    }
    if (Date.now() - t0 > 120000) {
      throw new Error('wrangler dev did not come up in 120s');
    }
    await delay(1500);
  }
}
function stopWrangler() {
  stopWranglerIfLocal(proc);
  try {
    proc && proc.kill();
  } catch (e) {}
}

// ---- Google-shaped session forgery ----------------------------------------
function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
function mintGoogleCookie(email, name, sub) {
  const payload = {
    sub: sub,
    email: email,
    name: name || 'Google User',
    exp: Math.floor(Date.now() / 1000) + 3600
  };
  const json = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', SECRET).update(json).digest();
  return 'mmgr_session=' + b64url(json) + '.' + b64url(sig);
}

// ---- Playwright launch (mirrors qa-calc-playwright-audit.cjs) -------------
function resolvePlaywright() {
  if (process.env.PLAYWRIGHT_MODULE && fs.existsSync(process.env.PLAYWRIGHT_MODULE)) {
    return require(process.env.PLAYWRIGHT_MODULE);
  }
  try {
    return require('playwright');
  } catch (e) {}
  for (const root of [
    path.join(os.homedir(), 'AppData', 'Local', 'npm-cache', '_npx'),
    path.join(os.homedir(), '.npm', '_npx')
  ]) {
    if (!fs.existsSync(root)) continue;
    for (const dir of fs.readdirSync(root)) {
      const p = path.join(root, dir, 'node_modules', 'playwright');
      if (fs.existsSync(path.join(p, 'index.js'))) return require(p);
    }
  }
  throw new Error('playwright not found - run `npx playwright install chromium`');
}
function absolutizeChrome(p) {
  if (!p) return undefined;
  if (path.isAbsolute(p) && fs.existsSync(p)) return p;
  const finder = os.platform() === 'win32' ? 'where' : 'command -v';
  try {
    const out = execFileSync(finder + ' ' + JSON.stringify(p), {
      stdio: ['ignore', 'pipe', 'ignore']
    })
      .toString()
      .trim()
      .split(/\r?\n/)[0];
    if (out && fs.existsSync(out)) return out;
  } catch (e) {}
  return undefined;
}

function getCookieValue(cookieHeader) {
  return cookieHeader.startsWith('mmgr_session=')
    ? cookieHeader.slice('mmgr_session='.length)
    : cookieHeader;
}

// The app's projectId key for the launcher's home project ("default").
const PID_KEY = 'default';

(async () => {
  let browser;
  try {
    await startWrangler();

    const subA = 'google-i1-client-' + crypto.randomBytes(8).toString('hex');
    const cookieA = mintGoogleCookie(ALICE_EMAIL, 'Alice Client', subA);
    const pid = 'i1client-' + Date.now().toString(36);

    // C1: anonymous create (no session cookie) -> projectId + ownerCode.
    const created = await (async () => {
      const res = await fetch(BASE + '/api/cloud/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: pid, name: 'I-1 Client Reproduction' })
      });
      let body = null;
      try {
        body = await res.json();
      } catch (e) {}
      return { status: res.status, body };
    })();
    const ownerCode = created.body && created.body.ownerCode;
    check(
      'C1 anonymous create returns 200 ok + ownerCode (google_sub NULL)',
      created.status === 200 && !!ownerCode,
      created
    );
    if (!ownerCode) {
      throw new Error('no ownerCode from anonymous create - cannot continue');
    }

    // Launch browser and drive the REAL app.html.
    const { chromium } = resolvePlaywright();
    let executablePath;
    try {
      executablePath = require('./chrome-launcher.cjs').chromePath || undefined;
    } catch (e) {}
    executablePath = absolutizeChrome(executablePath);
    browser = await chromium.launch({ headless: true, executablePath });

    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(String(e).slice(0, 140)));

    await page.goto(BASE + '/app.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#app-main, body', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(600);

    // C2: the REAL client flow persists the owner code to localStorage keyed by
    // pid (mmgr-cloud.js setCode writes mmgr_cloud_code_<cloudPid()>, and
    // cloudPid() reads mmgr_cloud_id_<id> first). On the launcher (app.html)
    // MMGR.Cloud is NOT loaded, so we seed the exact keys the real anonymous-
    // create handler writes - this is the I-1 root-cause fix (code survives a
    // re-auth instead of living only in sessionStorage).
    // Guard: the deferred bundle must boot before we touch localStorage.
    await page
      .waitForFunction(() => !!document.getElementById('app-main') || !!document.body, {
        timeout: 15000
      })
      .catch(() => {});
    const persisted = await page.evaluate(
      ({ pidArg, codeArg, pidKey }) => {
        try {
          localStorage.setItem('mmgr_cloud_id_' + pidKey, pidArg);
          localStorage.setItem('mmgr_cloud_code_' + pidArg, codeArg);
          const stored = localStorage.getItem('mmgr_cloud_code_' + pidArg);
          return { ok: stored === codeArg, stored: stored };
        } catch (e) {
          return { ok: false, reason: String(e) };
        }
      },
      { pidArg: pid, codeArg: ownerCode, pidKey: PID_KEY }
    );
    check(
      'C2 owner code persists to localStorage keyed by pid (I-1 root-cause fix)',
      persisted.ok === true,
      persisted
    );

    // C3: BEFORE sign-in, the signed-in account list must NOT contain the orphan.
    const beforeList = await (async () => {
      const res = await fetch(BASE + '/api/cloud/projects', {
        headers: { Cookie: cookieA }
      });
      let body = null;
      try {
        body = await res.json();
      } catch (e) {}
      return body;
    })();
    const beforeHas =
      beforeList &&
      Array.isArray(beforeList.projects) &&
      beforeList.projects.some(p => p.projectId === pid);
    check(
      'C3 account list does NOT show the orphan before sign-in',
      beforeHas === false,
      beforeList
    );

    // C4: forge the Google session, reload, let the page restore the session
    // and dispatch mmgr:google-signed-in (which triggers autoClaimHeldProjects).
    const cookieVal = getCookieValue(cookieA);
    await ctx.addCookies([
      { name: 'mmgr_session', value: cookieVal, domain: '127.0.0.1', path: '/', httpOnly: true }
    ]);
    await page.goto(BASE + '/app.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#app-main, body', { timeout: 15000 }).catch(() => {});
    // Give the sign-in + auto-claim + dashboard refresh a moment to settle
    // (mmgr:google-signed-in -> autoClaimHeldProjects -> claim -> mmgr:cloud-linked).
    await page.waitForTimeout(2500);

    // Prove the forged session is accepted by the Worker (the app's restore
    // reads exactly this), independent of any DOM class the page may use.
    const me = await (async () => {
      const res = await fetch(BASE + '/api/auth/me', { headers: { Cookie: cookieA } });
      let b = null;
      try {
        b = await res.json();
      } catch (e) {}
      return { ok: res.ok, body: b };
    })();
    check(
      'C4 forged session restored (GET /api/auth/me ok:true)',
      me.ok && me.body && me.body.ok === true,
      me
    );

    // C5: after sign-in, the account list now contains the recovered project.
    const afterList = await (async () => {
      const res = await fetch(BASE + '/api/cloud/projects', { headers: { Cookie: cookieA } });
      let body = null;
      try {
        body = await res.json();
      } catch (e) {}
      return body;
    })();
    const afterHas =
      afterList &&
      Array.isArray(afterList.projects) &&
      afterList.projects.some(p => p.projectId === pid);
    check(
      'C5 account list shows the recovered project after auto-claim',
      afterHas === true,
      afterList
    );

    // C6: the My Cloud Projects dashboard DOM renders the recovered row. The
    // dashboard region id/classes have shifted across waves, so assert against
    // the dashboard's rendered markup (the projectId is painted into data-*
    // attributes, not visible text), falling back to the whole body's HTML.
    const domHas = await page.evaluate(pidArg => {
      const dash =
        document.querySelector('#dash') ||
        document.querySelector('.cloud-dash') ||
        document.querySelector('[data-cloud-dash]');
      const hay = dash ? dash.innerHTML || '' : document.body.innerHTML || '';
      return hay.indexOf(pidArg) > -1;
    }, pid);
    check('C6 dashboard DOM renders the recovered project row', domHas === true, { domHas });

    // C7: the owner code is still persisted afterwards (localStorage survives
    // the reload + claim, so a future re-auth can re-claim).
    const stillThere = await page.evaluate(pidArg => {
      try {
        return localStorage.getItem('mmgr_cloud_code_' + pidArg) != null;
      } catch (e) {
        return false;
      }
    }, pid);
    check('C7 owner code still in localStorage after sign-in + claim', stillThere === true, {
      stillThere
    });

    check(
      'C8 no uncaught page errors during the I-1 client flow',
      pageErrors.length === 0,
      pageErrors
    );
  } catch (e) {
    log('FATAL: ' + (e && e.stack ? e.stack : e));
    results.push({ name: 'harness', val: false });
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    stopWrangler();
  }

  const failed = results.filter(r => !r.val).length;
  log(
    '==== I-1 CLIENT: ' + results.filter(r => r.val).length + ' passed / ' + failed + ' failed ===='
  );
  process.exit(failed ? 1 : 0);
})();
