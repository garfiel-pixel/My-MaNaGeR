/* ============================================================
   tools/qa-autoaccept-ui.cjs - auto-accept admin control by plan
   ------------------------------------------------------------
   Close-out Step 3b (owner decision). Enabling low-risk auto-accept
   is a Company/Enterprise feature. The server gate is covered by
   tools/qa-mcp-agent-first.cjs P6o and the pure gate by
   test/tier-limits.test.mjs; THIS harness covers the third half of
   the directive: the key admin panel shows the control disabled with
   the reason on Free/Estimator/Contractor, enabled on
   Company/Enterprise, and always lets a downgraded owner turn an
   existing policy OFF.

   The API response is stubbed in-page - no Worker, no data writes.
   Usage: node tools/qa-autoaccept-ui.cjs
   Registry: docs/CI-TEST-COVERAGE.md
   ============================================================ */
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');

const PORT = 8765;
const BASE = process.env.QA_BASE || 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');
const log = s => process.stdout.write('[qa-autoaccept-ui] ' + s + '\n');
const delay = ms => new Promise(r => setTimeout(r, ms));

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) {
    passed++;
    log('PASS  ' + name);
  } else {
    failed++;
    log(
      'FAIL  ' +
        name +
        '  <-- ' +
        JSON.stringify(detail === undefined ? null : detail).slice(0, 900)
    );
  }
}

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

// Render the real admin list from a stubbed key response and read the control.
const PROBE = `(async function (plan, autoAccept) {
  if (!window.MMGR || !MMGR.Cloud || !MMGR.Entitlements) return { error: 'MMGR not loaded', hasMMGR: !!window.MMGR, keys: window.MMGR ? Object.keys(window.MMGR).slice(0,40) : [], cloud: !!(window.MMGR && window.MMGR.Cloud), ent: !!(window.MMGR && window.MMGR.Entitlements) };
  localStorage.setItem('mmgr_unlocked_autotest', '1');
  localStorage.setItem(
    'mmgr_cloud_code_' + (MMGR.projectId || 'default'),
    'OWNERCODE12345678'
  );
  var wrap = document.getElementById('cloud-apikey-list');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'cloud-apikey-list';
    document.body.appendChild(wrap);
  }
  var realFetch = window.fetch.bind(window);
  window.fetch = function (url, opts) {
    if (String(url).indexOf('/api-keys') > -1) {
      return Promise.resolve(new Response(JSON.stringify({
        ok: true,
        keys: [{ id: 1, label: 'agent key', scope: ['tasks'], active: true,
                 budgetRead: true, budgetWrite: false, autoAccept: autoAccept }]
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
    }
    return realFetch(url, opts);
  };
  MMGR.Entitlements.setBillingTier(plan);
  await MMGR.Cloud.listApiKeys();
  var btn = wrap.querySelector('[data-action="cloudApiKeyAutoAccept"]');
  var hints = Array.prototype.slice.call(wrap.querySelectorAll('.sr-hint'))
    .map(function (n) { return (n.textContent || ''); }).join(' ');
  window.fetch = realFetch;
  return {
    found: !!btn,
    disabled: !!(btn && btn.disabled),
    title: btn ? (btn.title || '') : '',
    mode: btn ? btn.getAttribute('data-mode') : '',
    label: btn ? (btn.textContent || '').trim() : '',
    reason: /Company or Enterprise/.test(hints)
  };
})`;

(async () => {
  let srv = null;
  const { chromium } = resolvePlaywright();
  let executablePath;
  try {
    executablePath =
      require(path.join(ROOT, 'tools', 'chrome-launcher.cjs')).chromePath || undefined;
  } catch (e) {}
  let browser = null;
  try {
    let up = false;
    try {
      up = (await fetch(BASE + '/manifest.webmanifest')).ok;
    } catch (e) {}
    if (!up) {
      log('starting serve.cjs for this run');
      srv = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
      for (let i = 0; i < 60 && !up; i++) {
        await delay(250);
        try {
          up = (await fetch(BASE + '/manifest.webmanifest')).ok;
        } catch (e) {}
      }
    }
    if (!up) {
      throw new Error('serve.cjs did not answer on ' + BASE);
    }

    browser = await chromium.launch({
      headless: true,
      executablePath,
      args: ['--disk-cache-size=0']
    });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('mmgr_unlocked_autotest', '1');
      } catch (e) {}
    });
    const page = await ctx.newPage();
    await page.goto(BASE + '/project.html?id=autotest', { waitUntil: 'domcontentloaded' });
    await delay(1200);

    const plans = [
      ['free', false],
      ['estimator', false],
      ['contractor', false],
      ['company', true],
      ['enterprise', true]
    ];
    for (const [plan, allowed] of plans) {
      const r = await page.evaluate(
        ([src, p, a]) => eval('(' + src + ')')(p, a),
        [PROBE, plan, 'off']
      );
      check(
        'U-' + plan + ' ' + (allowed ? 'can enable' : 'disabled with reason'),
        r.found &&
          r.disabled === !allowed &&
          (!allowed ? r.reason && /Company or Enterprise/.test(r.title) : !r.reason) &&
          r.mode === 'low-risk',
        r
      );
    }

    // A downgraded owner with the policy already ON must still see an
    // enabled "Turn off" control - the server allows turning it off on any
    // plan, and the admin panel must not strand them.
    const down = await page.evaluate(
      ([src, a]) => eval('(' + src + ')')(a, 'low-risk'),
      [PROBE, 'estimator']
    );
    check(
      'U-downgrade "Turn off" stays enabled on Estimator',
      down.found && !down.disabled && /Turn off/.test(down.label) && down.mode === 'off',
      down
    );
  } finally {
    if (browser) {
      await browser.close();
    }
    if (srv) {
      srv.kill('SIGTERM');
    }
  }

  log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});
