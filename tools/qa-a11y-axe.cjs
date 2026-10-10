/* ============================================================
   qa-a11y-axe.cjs - axe-core accessibility gate (T10-B, owner 2026-10-10)
   ------------------------------------------------------------
   The web review's accessibility register (PLAN-ASSISTANT-INTAKE... section 7)
   was written from a browser axe run: A-1 contrast, A-2 aria-label with no
   role, A-3 focusable content inside aria-hidden, A-4 scroll regions a
   keyboard cannot reach. Those are exactly the axe rules that fail loudly,
   so this harness keeps the measurement instead of re-deriving it by hand.

   It loads every served page in a real browser (Playwright + axe-core
   injected through CDP, which CSP does not block), runs axe in LIGHT and
   DARK mode, and FAILS on any serious or critical violation. Moderate and
   minor findings are printed but do not fail the gate (they are tracked in
   the plan's register as known, non-blocking debt).

   Two extra gates that axe does not have:
     H1-1  one visible h1 per page (the register's A-6 was measured from a
           raw-markup crawl that counted the h1s sitting inside MUTUALLY
           EXCLUSIVE hidden states; this asserts what a screen reader gets:
           exactly one h1 in the accessibility tree, never two at once).
     H1-2  at least one visible h1 on the public pages.

   Usage:  node tools/qa-a11y-axe.cjs        (starts serve.cjs if needed)
           BASE=https://... node tools/qa-a11y-axe.cjs  (live smoke)
   Registry: CI-TEST-COVERAGE.md -> CI row (serve.cjs battery).
   ============================================================ */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const PORT = 8765;
const BASE = process.env.QA_BASE || process.argv[2] || 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');
const log = s => process.stdout.write('[a11y-axe] ' + s + '\n');
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
        JSON.stringify(detail === undefined ? null : detail).slice(0, 600)
    );
  }
};

// Every served page. dashboard.html is a redirect stub to app.html and is
// measured through that redirect, so it appears only once as app.html.
const PAGES = [
  'index.html',
  'features.html',
  'about.html',
  'contact.html',
  'reviews.html',
  'pricing.html',
  'privacy.html',
  'terms.html',
  'refund.html',
  'mymanager-field-guide.html',
  'signin.html',
  'verify.html',
  'reset.html',
  'app.html',
  'project.html?id=demo-project',
  'admin.html',
  'calculator.html',
  'seed-test.html'
];
// Pages whose whole job is a heading (the register's A-6 subjects).
const HEADING_PAGES = ['signin.html', 'verify.html', 'reset.html', 'admin.html'];

function resolvePlaywright() {
  if (process.env.PLAYWRIGHT_MODULE && fs.existsSync(process.env.PLAYWRIGHT_MODULE)) {
    return require(process.env.PLAYWRIGHT_MODULE);
  }
  try {
    return require('playwright');
  } catch (e) {
    /* not a local dependency */
  }
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
// Playwright demands an ABSOLUTE executablePath (see qa-calc-trade-coverage).
function absolutizeChrome(p) {
  if (!p) {
    return undefined;
  }
  if (path.isAbsolute(p)) {
    return fs.existsSync(p) ? p : undefined;
  }
  const finder = os.platform() === 'win32' ? 'where' : 'command -v';
  try {
    const out = require('child_process')
      .execSync(finder + ' ' + JSON.stringify(p), { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
      .split(/\r?\n/)[0];
    if (out && fs.existsSync(out)) {
      return out;
    }
  } catch (e) {
    /* fall back */
  }
  return undefined;
}

function axeSource() {
  const candidates = [];
  try {
    candidates.push(require.resolve('axe-core/axe.min.js'));
  } catch (e) {
    /* not resolvable from here */
  }
  candidates.push(path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'));
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return fs.readFileSync(c, 'utf8');
    }
  }
  throw new Error('axe-core not found - npm i -D axe-core');
}

(async () => {
  const AXE = axeSource();
  const { chromium } = resolvePlaywright();
  let executablePath;
  try {
    executablePath =
      require(path.join(ROOT, 'tools', 'chrome-launcher.cjs')).chromePath || undefined;
  } catch (e) {
    /* fall back to playwright's browser */
  }
  executablePath = absolutizeChrome(executablePath);
  if (!process.env.BASE && !process.env.QA_BASE) {
    let srv = null;
    try {
      const h = await fetch(BASE + '/index.html');
      if (!h.ok) {
        throw 0;
      }
    } catch (e) {
      log('starting serve.cjs for this run');
      srv = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
      for (let i = 0; i < 30; i++) {
        await delay(1000);
        try {
          const h = await fetch(BASE + '/index.html');
          if (h.ok) {
            break;
          }
        } catch (e) {}
      }
    }
    global.__srv = srv;
  }

  const browser = await chromium.launch({ headless: true, executablePath });
  const blocking = []; // serious + critical, per page/theme
  const byRule = {}; // everything, for the report
  const headingRows = [];

  for (const file of PAGES) {
    for (const theme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      // demo-project must be unlocked or the page redirects to the launcher
      // and the sweep would measure app.html twice (see qa-health-sweep).
      await ctx.addInitScript(t => {
        try {
          localStorage.setItem('mmgr_theme', t);
          localStorage.setItem('mmgr_unlocked_demo-project', '1');
          localStorage.setItem('mmgr_scope_demo-project', 'full');
        } catch (e) {}
      }, theme);
      const page = await ctx.newPage();
      const pageErrors = [];
      page.on('pageerror', e => pageErrors.push(String((e && e.message) || e).slice(0, 120)));
      try {
        await page.goto(BASE + '/' + file, { waitUntil: 'load', timeout: 45000 });
        await page.waitForTimeout(1600);
        await page.evaluate(AXE);
        const res = await page.evaluate(async () => {
          const r = await window.axe.run(document, { resultTypes: ['violations'] });
          // "Visible" means actually laid out: the h1 and every ancestor are
          // rendered (an h1 inside a hidden .auth-state has a 0x0 rect).
          const vis = [...document.querySelectorAll('h1')].filter(h => {
            const r = h.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && getComputedStyle(h).visibility !== 'hidden';
          });
          return {
            violations: r.violations.map(v => ({
              id: v.id,
              impact: v.impact,
              nodes: v.nodes.map(
                n =>
                  n.target.join(' ') +
                  ' :: ' +
                  String(n.failureSummary || '')
                    .replace(/\s+/g, ' ')
                    .slice(0, 220)
              )
            })),
            h1Visible: vis.length,
            h1Hidden: document.querySelectorAll('h1[hidden]').length
          };
        });
        const tag = file.replace('.html', '') + '[' + theme + ']';
        for (const v of res.violations) {
          byRule[v.impact + '  ' + v.id] = (byRule[v.impact + '  ' + v.id] || 0) + v.nodes.length;
          if (v.impact === 'serious' || v.impact === 'critical') {
            for (const n of v.nodes) {
              blocking.push(tag + ' ' + v.id + ' ' + n);
            }
          }
        }
        headingRows.push({ tag, file, theme, visible: res.h1Visible, hidden: res.h1Hidden });
        if (pageErrors.length) {
          blocking.push(tag + ' pageerror ' + pageErrors[0]);
        }
      } catch (e) {
        blocking.push(file + '[' + theme + '] axe run failed: ' + String(e).slice(0, 200));
      }
      await ctx.close();
    }
  }
  await browser.close();

  log('');
  log('===== axe rules seen in this run =====');
  const keys = Object.keys(byRule).sort();
  if (!keys.length) {
    log('(no violations of any kind)');
  }
  keys.forEach(k => log('  ' + k + '  (' + byRule[k] + ' nodes)'));

  log('');
  log('===== gates =====');
  check(
    'zero serious or critical axe violations (18 pages x light+dark)',
    blocking.length === 0,
    blocking.slice(0, 12)
  );
  // A-6, measured the way a screen reader experiences it.
  for (const f of HEADING_PAGES) {
    const rows = headingRows.filter(r => r.file === f);
    check(
      'A-6 exactly one visible h1 on ' + f,
      rows.every(r => r.visible === 1),
      rows.map(r => r.tag + ' visible=' + r.visible + ' hidden=' + r.hidden)
    );
  }
  check(
    'public pages have a visible h1',
    ['index.html', 'features.html', 'about.html', 'contact.html', 'pricing.html'].every(
      f => headingRows.find(r => r.file === f && r.theme === 'light').visible === 1
    ),
    headingRows.filter(r => r.visible === 0).map(r => r.tag)
  );

  log('');
  log('===== a11y-axe: ' + passed + ' passed, ' + failed + ' failed =====');
  if (global.__srv) {
    global.__srv.kill();
  }
  process.exit(failed ? 1 : 0);
})().catch(e => {
  log('FATAL ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
