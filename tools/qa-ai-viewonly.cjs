/* ============================================================
   tools/qa-ai-viewonly.cjs - the assistant answers in view-only mode
   ------------------------------------------------------------
   UX-2026-11-19 A6. A tester opened the AI Assistant in a demo
   project, typed a question, pressed Send, and was told "View-only
   mode , read-only access. Contact the admin for full access." The
   guard was answering "you may not" to a question that changes
   nothing in the project.

   Branch 1 of the directive applies: Send only reads the project and
   runs on this device (or the BYO-key relay); the only thing it
   writes is the assistant transcript (state.aiOutputs + the
   conversation history), never a project record. So aiRun and
   aiRunPreset are now on READONLY_SAFE_ACTIONS, and the actions that
   really change a project record stay refused.

   Gates:
     V1 the fixture really is a view-only session (MMGR.App.isReadonly()).
     V2 a typed question is accepted: Send produces a user bubble and NO
        "View-only mode" toast.
     V3 a one-click preset is accepted the same way.
     V4 the guard still bites: a project-writing action (addRisk) shows
        the view-only toast.

   Usage:   node tools/qa-ai-viewonly.cjs
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
const log = s => process.stdout.write('[qa-ai-viewonly] ' + s + '\n');
const delay = ms => new Promise(r => setTimeout(r, ms));

let passed = 0;
let failed = 0;
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
        JSON.stringify(detail === undefined ? null : detail).slice(0, 1000)
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

const FLUSH_RAF = `new Promise(function (res) {
  requestAnimationFrame(function () { requestAnimationFrame(function () { res(1); }); });
})`;

// Every toast text this page shows, in order. Toasts are created and removed,
// so a snapshot read would miss the refusal.
const WATCH_TOASTS = `(function () {
  window.__toasts = [];
  var push = function (t) {
    if (t && window.__toasts.indexOf(t) === -1) window.__toasts.push(t);
  };
  var scan = function () {
    var t = document.querySelector('.toast');
    if (t) push((t.textContent || '').trim());
  };
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  scan();
})();`;

(async () => {
  let srv = null;
  const { chromium } = resolvePlaywright();
  let executablePath;
  try {
    executablePath =
      require(path.join(ROOT, 'tools', 'chrome-launcher.cjs')).chromePath || undefined;
  } catch (e) {
    /* playwright's own browser */
  }
  let browser = null;
  try {
    let up = false;
    try {
      up = (await fetch(BASE + '/manifest.webmanifest')).ok;
    } catch (e) {
      up = false;
    }
    if (!up) {
      log('starting serve.cjs for this run');
      srv = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
      for (let i = 0; i < 60 && !up; i++) {
        await delay(250);
        try {
          up = (await fetch(BASE + '/manifest.webmanifest')).ok;
        } catch (e) {
          /* keep waiting */
        }
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
    // A view-only session: unlocked so the page opens, but the stored scope is
    // "readonly" - exactly what a visitor holding a viewer code gets.
    await ctx.addInitScript(`
      try {
        localStorage.setItem('mmgr_unlocked_demo-project', '1');
        localStorage.setItem('mmgr_scope_demo-project', 'readonly');
      } catch (e) {}
    `);
    const page = await ctx.newPage();
    await page.goto(BASE + '/project.html?id=demo-project', { waitUntil: 'domcontentloaded' });
    await page.evaluate(FLUSH_RAF);
    await delay(900);

    const ro = await page.evaluate(
      () => !!(window.MMGR && MMGR.App && MMGR.App.isReadonly && MMGR.App.isReadonly())
    );
    check('V1 the fixture is a view-only session', ro === true, ro);

    await page.evaluate(WATCH_TOASTS);

    // ---- V2: a typed question --------------------------------------
    const opened = await page.evaluate(() => {
      const fab = document.getElementById('ai-fab');
      if (fab) {
        fab.click();
        return true;
      }
      return !!(window.MMGR && MMGR.AiWin && (MMGR.AiWin.open(), true));
    });
    await page.evaluate(FLUSH_RAF);
    await delay(400);
    check('V2 the assistant panel opens', opened === true, opened);

    const typed = await page.evaluate(() => {
      const q = document.getElementById('ai-q');
      const send = document.getElementById('ai-send');
      if (!q || !send) {
        return false;
      }
      q.value = 'What is the biggest risk on this job?';
      q.dispatchEvent(new Event('input', { bubbles: true }));
      send.click();
      return true;
    });
    check('V2 the composer and Send exist', typed === true, typed);
    await page.evaluate(FLUSH_RAF);
    await delay(2200);

    let seen = await page.evaluate('window.__toasts || []');
    const refusal = seen.filter(t => /view-only/i.test(t));
    check('V2 Send is not refused in view-only mode', refusal.length === 0, seen);
    const bubbles = await page.evaluate(
      () => document.querySelectorAll('#ai-thread .ai-bubble.ai-user').length
    );
    check('V2 the typed question reaches the thread', bubbles >= 1, bubbles);

    // ---- V3: a one-click preset ------------------------------------
    await page.evaluate(`(function () {
      window.__toasts.length = 0;
      var seg = document.getElementById('ai-seg-presets');
      if (seg) seg.click();
      var row = document.querySelector('#ai-presets [data-action="aiRunPreset"]');
      if (row) { row.click(); return; }
      if (window.MMGR && MMGR.AiWin && MMGR.AiWin.runPreset) { MMGR.AiWin.runPreset('status'); }
    })();`);
    await page.evaluate(FLUSH_RAF);
    await delay(2200);
    seen = await page.evaluate('window.__toasts || []');
    check(
      'V3 a preset is not refused in view-only mode',
      seen.filter(t => /view-only/i.test(t)).length === 0,
      seen
    );

    // ---- V4: the guard still bites ---------------------------------
    await page.evaluate(`(function () {
      window.__toasts.length = 0;
      var b = document.querySelector('[data-action="addRisk"]');
      if (b) { b.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
    })();`);
    await page.evaluate(FLUSH_RAF);
    await delay(400);
    seen = await page.evaluate('window.__toasts || []');
    check(
      'V4 a project-writing action is still refused in view-only mode',
      seen.some(t => /view-only/i.test(t)),
      seen
    );

    await ctx.close();
  } catch (e) {
    failed++;
    log('FAIL  harness error  <-- ' + (e && e.message ? e.message : e));
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {}
    }
    if (srv) {
      try {
        srv.kill();
      } catch (e) {}
    }
    log('');
    log(passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
  }
})();
