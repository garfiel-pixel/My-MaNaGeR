/* ============================================================
   tools/qa-shortcuts.cjs - AUDIT-DIRECTIVE-2026-10-18, task M-5
   ------------------------------------------------------------
   The keyboard shortcuts and the shortcut help sheet.
   Real browser (Playwright + the repo's chrome-launcher),
   against serve.cjs.

   Gates (workspace, project.html):
     A1  the module is served and loaded (MMGR.Shortcuts exists).
     A2  "?" opens the shortcut sheet: role=dialog, aria-modal,
         a title and a close button.
     A3  the sheet and the drawer's shortcut block list the SAME
         keys (one table, so the two can never drift).
     A4  Escape closes the sheet and leaves the page alive.
     A5  "/" opens the assistant and puts the cursor in the
         question box (signed-in owner).
     A6  "?" typed INTO a text box types the character and does
         NOT open the sheet (a shortcut must never eat typing).
     A7  "F" still toggles Focus Mode - the new module did not
         break the app's own shortcuts.
     A8  zero page errors.

   Gates (calculator, calculator.html):
     C1  the module is served and loaded there too.
     C2  "?" opens the sheet and the sheet lists the CALC keys
         (including "Work out the estimate").
     C3  Enter in a price box works out the estimate (the result
         card fills and the Calculate button runs exactly once).
     C4  "/" puts the cursor in the assistant box.
     C5  "/" typed into the item-name box types a slash and does
         not jump to the assistant.
     C6  Enter in the assistant box does NOT run the estimate.
     C7  zero page errors.

   Usage:   node tools/qa-shortcuts.cjs
   Registry: docs/CI-TEST-COVERAGE.md (CI row) + ci.yml step.
   ============================================================ */
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const PORT = 8765;
const BASE = process.env.QA_BASE || process.argv[2] || 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');
const log = s => process.stdout.write('[shortcuts] ' + s + '\n');
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
        JSON.stringify(detail === undefined ? null : detail).slice(0, 500)
    );
  }
};

// ---- kit copied from tools/qa-procurement.cjs ----
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
    /* fall through */
  }
  return undefined;
}

async function ensureServer() {
  try {
    const h = await fetch(BASE + '/project.html');
    if (h.ok || h.status === 307 || h.status === 301) {
      return null;
    }
  } catch (e) {}
  log('starting serve.cjs for this run');
  const srv = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 30; i++) {
    await delay(1000);
    try {
      const h = await fetch(BASE + '/project.html');
      if (h.ok || h.status === 307) {
        return srv;
      }
    } catch (e) {}
  }
  throw new Error('serve.cjs did not come up');
}

// UI-1 replaced the calculator's native pickers with the app's own listbox
// (js/mmgr-combobox.js). The native select stays in the DOM as the source of
// truth but is display:none, so `selectOption` can never resolve it. This picks
// a value the way a person does - open the listbox, press the row - and asserts
// the pick actually landed before returning, so a broken picker fails loudly
// here instead of surfacing as a mystery timeout three steps later.
async function pickCalcWork(page, value) {
  await page.click('.mmcb[data-for="calc-work"] .mmcb-input');
  await page.waitForSelector('.mmcb[data-for="calc-work"] [role="option"]', { timeout: 8000 });
  const id = await page.evaluate(v => {
    const sel = document.getElementById('calc-work');
    const rows = sel && sel.__mmcb ? sel.__mmcb.list.querySelectorAll('[role="option"]') : [];
    for (const r of rows) {
      if (r.getAttribute('data-value') === v) {
        return r.id;
      }
    }
    return null;
  }, value);
  if (!id) {
    throw new Error('no listbox row for calc-work value "' + value + '"');
  }
  await page.click('#' + id);
  await page.waitForTimeout(250);
  const landed = await page.evaluate(() => document.getElementById('calc-work').value);
  if (landed !== value) {
    throw new Error('the pick did not land: wanted "' + value + '", select reads "' + landed + '"');
  }
}

(async () => {
  const { chromium } = resolvePlaywright();
  let executablePath;
  try {
    executablePath =
      require(path.join(ROOT, 'tools', 'chrome-launcher.cjs')).chromePath || undefined;
  } catch (e) {
    /* fall back to playwright's browser */
  }
  executablePath = absolutizeChrome(executablePath);
  let browser = null;
  let srv = null;
  try {
    srv = await ensureServer();
    browser = await chromium.launch({ headless: true, executablePath });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });

    // The owner is signed in: the session endpoint is mocked, the same
    // contract the other harnesses use. The assistant only opens for a
    // signed-in operator, so the signed-out path cannot be proven here.
    await ctx.route('**/api/auth/me', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, user: { email: 'owner@example.com' } })
      })
    );
    // The demo project must be unlocked + FULL scope before the page
    // boots, or project.html bounces to the launcher.
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('mmgr_unlocked_demo-project', '1');
        localStorage.setItem('mmgr_scope_demo-project', 'full');
      } catch (e) {}
    });

    const pageErrors = [];
    const moduleHits = [];
    const page = await ctx.newPage();
    page.on('pageerror', e => pageErrors.push(String((e && e.message) || e).slice(0, 160)));
    page.on('response', r => {
      if (String(r.url()).indexOf('mmgr-shortcuts.js') > -1) {
        moduleHits.push(r.status());
      }
    });

    // ---------------- workspace (project.html) ----------------
    await page.goto(BASE + '/project.html?id=demo-project', {
      waitUntil: 'load',
      timeout: 45000
    });
    await page.waitForFunction(
      () => !!(window.MMGR && MMGR.State && document.getElementById('panel-dash')),
      null,
      { timeout: 25000 }
    );
    // The session is restored by the app's own boot; force it so the
    // gate does not wait for the (blocked) Google script fallback.
    await page.evaluate(async () => {
      try {
        if (window.MMGR && MMGR.GoogleAuth && MMGR.GoogleAuth.restoreSession) {
          await MMGR.GoogleAuth.restoreSession();
        }
      } catch (e) {}
    });
    await page.waitForTimeout(600);

    const mod = await page.evaluate(() => ({
      present: !!(window.MMGR && MMGR.Shortcuts),
      rows: window.MMGR && MMGR.Shortcuts ? MMGR.Shortcuts.rows().length : 0,
      served: !!document.querySelector('script[src*="mmgr-shortcuts.js"]')
    }));
    check(
      'A1 the shortcut module is served and loaded on the workspace',
      mod.present && mod.rows > 0 && mod.served && moduleHits.indexOf(200) > -1,
      { mod, moduleHits }
    );

    // "?" opens the sheet.
    await page.keyboard.press('?');
    await page.waitForTimeout(250);
    const sheet = await page.evaluate(() => {
      const s = document.getElementById('kb-sheet');
      if (!s) {
        return { exists: false };
      }
      return {
        exists: true,
        open: s.classList.contains('open'),
        role: s.getAttribute('role'),
        modal: s.getAttribute('aria-modal'),
        labelled: !!document.getElementById(s.getAttribute('aria-labelledby') || ''),
        closeBtn: !!s.querySelector('[data-mmks="close"]'),
        chips: Array.prototype.map.call(s.querySelectorAll('.kbd'), e => e.textContent.trim())
      };
    });
    check(
      'A2 "?" opens the shortcut sheet (dialog, labelled, close button)',
      sheet.exists &&
        sheet.open &&
        sheet.role === 'dialog' &&
        sheet.modal === 'true' &&
        sheet.labelled &&
        sheet.closeBtn &&
        sheet.chips.length > 0,
      { sheet }
    );

    // The drawer's block and the sheet come from ONE table.
    const same = await page.evaluate(() => {
      const chips = sel =>
        Array.prototype.map.call(document.querySelectorAll(sel + ' .kbd'), e =>
          e.textContent.trim()
        );
      return {
        drawer: chips('#kb-drawer-grid'),
        sheet: chips('#kb-sheet-grid'),
        drawerId: !!document.getElementById('kb-drawer-grid')
      };
    });
    check(
      'A3 the sheet and the drawer list the same keys (one source of truth)',
      same.drawerId &&
        same.drawer.length > 0 &&
        same.drawer.length === same.sheet.length &&
        same.drawer.join('|') === same.sheet.join('|'),
      { same }
    );

    // Escape closes the sheet.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const closed = await page.evaluate(() => {
      const s = document.getElementById('kb-sheet');
      return {
        open: !!(s && s.classList.contains('open')),
        alive: !!document.getElementById('panel-dash')
      };
    });
    check('A4 Escape closes the sheet and the page is still alive', !closed.open && closed.alive, {
      closed
    });

    // "/" opens the assistant and focuses the question box.
    await page.keyboard.press('/');
    await page.waitForTimeout(500);
    const ai = await page.evaluate(() => {
      const w = document.getElementById('ai-win');
      return {
        open: !!(w && w.classList.contains('open')),
        focusId: document.activeElement ? document.activeElement.id : '',
        signedIn: !!(window.MMGR && MMGR.GoogleAuth && MMGR.GoogleAuth.isSignedIn())
      };
    });
    check(
      'A5 "/" opens the assistant and puts the cursor in the question box',
      ai.open && ai.focusId === 'ai-q' && ai.signedIn,
      { ai }
    );
    // Close the assistant again (Escape) so the next gate starts clean.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);

    // "?" typed into a text box must stay in the text box.
    await page.waitForSelector('#ai-command-input', { timeout: 10000 });
    await page.focus('#ai-command-input');
    await page.keyboard.type('?');
    await page.waitForTimeout(250);
    const typed = await page.evaluate(() => {
      const s = document.getElementById('kb-sheet');
      const i = document.getElementById('ai-command-input');
      return {
        sheetOpen: !!(s && s.classList.contains('open')),
        value: i ? i.value : '',
        focused: document.activeElement === i
      };
    });
    check(
      'A6 "?" typed in a text box types the character and does not open the sheet',
      !typed.sheetOpen && typed.value.indexOf('?') > -1 && typed.focused,
      { typed }
    );
    await page.evaluate(() => {
      const i = document.getElementById('ai-command-input');
      if (i) {
        i.value = '';
        i.blur();
      }
    });
    await page.waitForTimeout(150);

    // "F" still toggles Focus Mode (the app's own shortcut).
    const focusBefore = await page.evaluate(() => document.body.classList.contains('focus-mode'));
    await page.keyboard.press('f');
    await page.waitForTimeout(250);
    const focusAfter = await page.evaluate(() => document.body.classList.contains('focus-mode'));
    check(
      'A7 "F" still toggles Focus Mode (the app shortcuts are intact)',
      focusBefore !== focusAfter,
      {
        focusBefore,
        focusAfter
      }
    );
    if (focusAfter) {
      await page.keyboard.press('f');
      await page.waitForTimeout(150);
    }

    check('A8 zero page errors on the workspace', pageErrors.length === 0, { pageErrors });

    // ---------------- calculator (calculator.html) ----------------
    const calcErrors = [];
    const calcModuleHits = [];
    const calc = await ctx.newPage();
    calc.on('pageerror', e => calcErrors.push(String((e && e.message) || e).slice(0, 160)));
    calc.on('response', r => {
      if (String(r.url()).indexOf('mmgr-shortcuts.js') > -1) {
        calcModuleHits.push(r.status());
      }
    });
    await calc.goto(BASE + '/calculator.html', { waitUntil: 'load', timeout: 45000 });
    await calc.waitForSelector('#calc-input-card', { timeout: 20000 });
    // The assistant box is disabled until the session is known.
    await calc.waitForFunction(
      () => {
        const i = document.getElementById('calc-ai-input');
        return !!i && !i.disabled;
      },
      null,
      { timeout: 20000 }
    );

    const cmod = await calc.evaluate(() => ({
      present: !!(window.MMGR && window.MMGR.Shortcuts),
      rows: window.MMGR && window.MMGR.Shortcuts ? window.MMGR.Shortcuts.rows().length : 0
    }));
    check(
      'C1 the shortcut module is served and loaded on the calculator',
      cmod.present && cmod.rows > 0 && calcModuleHits.indexOf(200) > -1,
      { cmod, calcModuleHits }
    );

    // "?" opens the sheet, and the sheet lists the CALC keys.
    await calc.keyboard.press('?');
    await calc.waitForTimeout(250);
    const csheet = await calc.evaluate(() => {
      const s = document.getElementById('kb-sheet');
      const chips = s
        ? Array.prototype.map.call(s.querySelectorAll('.kbd'), e => e.textContent.trim())
        : [];
      const text = s ? s.textContent : '';
      return {
        exists: !!s,
        open: !!(s && s.classList.contains('open')),
        chips,
        hasCalcRow: text.indexOf('Work out the estimate') > -1
      };
    });
    check(
      'C2 "?" opens the sheet on the calculator and it lists the estimate key',
      csheet.exists && csheet.open && csheet.chips.length > 0 && csheet.hasCalcRow,
      { csheet }
    );
    await calc.keyboard.press('Escape');
    await calc.waitForTimeout(200);

    // Price a custom item, then press Enter in a price box.
    // RE-BASELINED 2026-10-27: `#calc-work` is no longer a native select you can
    // drive with selectOption - UI-1 replaced it with the app's own listbox
    // (`#calc-work` is display:none, aria-hidden and still the source of truth),
    // so Playwright waits forever for a hidden element to become visible. The
    // pick now goes through the control a person actually presses: open the
    // listbox, then click the `custom` row.
    await pickCalcWork(calc, 'custom');
    await calc.waitForTimeout(400);
    await calc.waitForSelector('#calc-custom-qty', { state: 'visible', timeout: 8000 });
    await calc.fill('#calc-custom-name', 'Harness item');
    await calc.fill('#calc-custom-qty', '10');
    await calc.fill('#calc-custom-rate', '100');
    await calc.evaluate(() => {
      window.__kbRuns = 0;
      document.addEventListener(
        'click',
        e => {
          const b =
            e.target && e.target.closest ? e.target.closest('[data-action="calcRun"]') : null;
          if (b) {
            window.__kbRuns++;
          }
        },
        true
      );
    });
    await calc.focus('#calc-custom-qty');
    await calc.keyboard.press('Enter');
    await calc.waitForTimeout(700);
    const ran = await calc.evaluate(() => {
      const out = document.getElementById('calc-output');
      return {
        runs: window.__kbRuns,
        hasTotal: !!(out && out.textContent.indexOf('Estimated total') > -1),
        stillEmpty: !!(out && out.textContent.indexOf('Pick a work item') > -1)
      };
    });
    check(
      'C3 Enter in a price box works out the estimate (once, and the result lands)',
      ran.runs === 1 && ran.hasTotal && !ran.stillEmpty,
      { ran }
    );

    // "/" focuses the assistant box.
    await calc.evaluate(() => {
      window.__kbRuns = 0;
    });
    await calc.keyboard.press('/');
    await calc.waitForTimeout(350);
    const cjump = await calc.evaluate(() => ({
      focused: document.activeElement ? document.activeElement.id : ''
    }));
    check('C4 "/" puts the cursor in the assistant box', cjump.focused === 'calc-ai-input', {
      cjump
    });

    // "/" typed into the item-name box stays there.
    await calc.focus('#calc-custom-name');
    await calc.keyboard.press('End');
    await calc.keyboard.type('/');
    await calc.waitForTimeout(250);
    const ctyped = await calc.evaluate(() => {
      const s = document.getElementById('kb-sheet');
      const n = document.getElementById('calc-custom-name');
      const i = document.getElementById('calc-ai-input');
      return {
        sheetOpen: !!(s && s.classList.contains('open')),
        value: n ? n.value : '',
        stillInBox: document.activeElement === n,
        aiFocused: document.activeElement === i
      };
    });
    check(
      'C5 "/" typed in the item-name box types a slash and does not jump away',
      !ctyped.sheetOpen && ctyped.value.slice(-1) === '/' && ctyped.stillInBox && !ctyped.aiFocused,
      { ctyped }
    );

    // Enter in the assistant box must not run the estimate.
    await calc.evaluate(() => {
      window.__kbRuns = 0;
    });
    await calc.focus('#calc-ai-input');
    await calc.keyboard.press('Enter');
    await calc.waitForTimeout(400);
    const center = await calc.evaluate(() => ({
      runs: window.__kbRuns,
      sheetOpen: !!(
        document.getElementById('kb-sheet') &&
        document.getElementById('kb-sheet').classList.contains('open')
      )
    }));
    check(
      'C6 Enter in the assistant box does not run the estimate',
      center.runs === 0 && !center.sheetOpen,
      { center }
    );

    check('C7 zero page errors on the calculator', calcErrors.length === 0, { calcErrors });
  } catch (e) {
    failed++;
    log('FAIL  harness crashed: ' + (e && e.stack ? e.stack : e));
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (srv && srv.kill) {
      srv.kill();
    }
  }
  log('');
  log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
