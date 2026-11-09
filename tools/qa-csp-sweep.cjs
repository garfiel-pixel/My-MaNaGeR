/* ============================================================
   My MaNaGeR - CSP browser sweep (E4, 2026-11-09)
   ------------------------------------------------------------
   Loads every public page and the signed-out app shell against the REAL
   Worker, so the response carries the real Content-Security-Policy-Report-Only
   header, and records every securitypolicyviolation the browser fires.

   Why a real wrangler dev and not serve.cjs: serve.cjs carries only the
   enforced policy. The report-only candidate is the thing being observed, and
   a copy of it in a second file would drift (AGENTS lesson 10).

   Output: one line per violation - directive / blocked origin / page - and a
   summary. Exit 1 when:
     - any connect-src violation appears (the candidate is incomplete), or
     - a blocked origin is neither in the policy nor a known injected host.

   Inline script violations are printed but not fatal: the hash-only policy
   already allows the blocks this repo ships, and the sweep's job is the
   network surface.

   Usage:  npm run qa:csp   (or node tools/qa-csp-sweep.cjs)
   ============================================================ */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = parseInt(process.env.QA_CSP_PORT || '8794', 10);
const BASE = 'http://127.0.0.1:' + PORT;

// Public documents plus the signed-out app shell. No credentials, no state.
const PAGES = [
  '/',
  '/about',
  '/features',
  '/pricing',
  '/contact',
  '/privacy',
  '/terms',
  '/refund',
  '/reviews',
  '/mymanager-field-guide',
  '/calculator',
  '/app',
  '/signin'
];

// Hosts a browser extension or an edge injection may name. A blocked origin
// here is noise, not a policy gap.
const INJECTED_HOSTS = [
  'static.cloudflareinsights.com',
  'cloudflareinsights.com',
  'public.profitwell.com',
  'retain-api.profitwell.com',
  'api.profitwell-events.com',
  'www2.profitwell.com'
];

function globalWranglerJs() {
  const local = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  return fs.existsSync(local) ? local : null;
}

function log(msg) {
  process.stdout.write('[csp-sweep] ' + msg + '\n');
}

// A blocked URL can carry a query string (Paddle's script URL carries a
// client token). The sweep prints origin + path only.
function safeUrl(value) {
  const s = String(value || '');
  if (!/^https?:\/\//i.test(s)) {
    return s;
  }
  try {
    const u = new URL(s);
    return u.origin + u.pathname;
  } catch (e) {
    return s.split('?')[0];
  }
}

// One line per violation with every field labelled. An unlabelled line put the
// page path immediately after the blocked URL, which reads as one concatenated
// value ("/pricinghttps://..."). The labels make that impossible to misread -
// and this is a print-only concern: the Worker's log fields are separate keys.
function formatViolation(v) {
  return (
    (v.directive || '?') +
    ' | blocked=' +
    safeUrl(v.blocked) +
    ' | page=' +
    (v.page || '?') +
    ' | disposition=' +
    (v.disposition || '?') +
    (v.document ? ' | doc=' + safeUrl(v.document) : '')
  );
}

function startWrangler() {
  return new Promise(function (resolve, reject) {
    const wrangler = globalWranglerJs();
    if (!wrangler) {
      return reject(new Error('wrangler is not installed in node_modules'));
    }
    const persist = path.join(os.tmpdir(), 'mmgr-csp-sweep-' + Date.now());
    const proc = spawn(
      process.execPath,
      [
        wrangler,
        'dev',
        '--config',
        'wrangler.ci.jsonc',
        '--port',
        String(PORT),
        '--ip',
        '127.0.0.1',
        '--persist-to',
        persist
      ],
      {
        cwd: ROOT,
        env: Object.assign({}, process.env, { WRANGLER_SEND_METRICS: 'false' }),
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );
    let devLog = '';
    proc.stdout.on('data', function (d) {
      devLog += d;
    });
    proc.stderr.on('data', function (d) {
      devLog += d;
    });
    proc.on('error', function (e) {
      reject(new Error('wrangler spawn failed: ' + e.message));
    });
    const t0 = Date.now();
    const poll = async function () {
      try {
        const res = await fetch(BASE + '/api/health');
        if (res.ok) {
          const body = await res.json().catch(function () {
            return null;
          });
          if (body && body.ok === true) {
            return resolve({ proc: proc, persist: persist });
          }
        }
      } catch (e) {
        /* not up yet */
      }
      if (Date.now() - t0 > 120000) {
        try {
          proc.kill();
        } catch (e) {}
        return reject(new Error('wrangler dev did not come up in 120s\n' + devLog.slice(-1500)));
      }
      setTimeout(poll, 1500);
    };
    poll();
  });
}

async function main() {
  const { chromium } = require('playwright');
  const server = await startWrangler();
  const violations = [];

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.addInitScript(function () {
      window.__cspViolations = [];
      document.addEventListener('securitypolicyviolation', function (e) {
        window.__cspViolations.push({
          directive: e.effectiveDirective || e.violatedDirective || '',
          blocked: e.blockedURI || '',
          document: e.documentURI || '',
          disposition: e.disposition || ''
        });
      });
    });

    for (const pagePath of PAGES) {
      const page = await context.newPage();
      try {
        await page.goto(BASE + pagePath, { waitUntil: 'load', timeout: 30000 });
        await page.waitForTimeout(1500);
        const found = await page.evaluate(function () {
          return window.__cspViolations || [];
        });
        found.forEach(function (v) {
          violations.push(Object.assign({ page: pagePath }, v));
        });
        log('loaded ' + pagePath + ' (' + found.length + ' violation(s))');
      } catch (e) {
        log('FAILED to load ' + pagePath + ': ' + e.message);
        violations.push({ page: pagePath, directive: 'load', blocked: e.message });
      } finally {
        await page.close();
      }
    }
  } finally {
    if (browser) {
      await browser.close().catch(function () {});
    }
    try {
      server.proc.kill();
    } catch (e) {}
  }

  if (violations.length) {
    log('violations:');
    violations.forEach(function (v) {
      log('  ' + formatViolation(v));
    });
  } else {
    log('no violations recorded');
  }

  const fatal = violations.filter(function (v) {
    if (v.directive === 'load') {
      return true;
    }
    if (String(v.directive).indexOf('connect-src') === 0) {
      return true;
    }
    if (!/^https?:\/\//i.test(v.blocked || '')) {
      return false;
    }
    try {
      const host = new URL(v.blocked).hostname;
      return INJECTED_HOSTS.indexOf(host) === -1;
    } catch (e) {
      return false;
    }
  });

  if (fatal.length) {
    log('FAIL: ' + fatal.length + ' fatal violation(s)');
    return 1;
  }
  log('PASS: ' + violations.length + ' recorded, 0 fatal');
  return 0;
}

module.exports = { formatViolation: formatViolation, safeUrl: safeUrl };

if (require.main === module) {
  main()
    .then(function (code) {
      process.exit(code);
    })
    .catch(function (e) {
      console.error('[csp-sweep] ERROR: ' + (e && e.message));
      process.exit(1);
    });
}
