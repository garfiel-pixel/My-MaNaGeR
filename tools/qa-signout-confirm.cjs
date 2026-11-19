/* ============================================================
   tools/qa-signout-confirm.cjs - sign out asks first
   ------------------------------------------------------------
   UX-2026-11-19 A5. A tester signed out by accident: the account
   row's button signed out on the first click, with no question.
   Every sign-out entry point now routes through ONE shared dialog
   built by js/mmgr-google-auth.js.

   Gates:
     S1 the dialog host exists, hidden, on every page that loads the
        auth module (app, project, admin, marketing, signin).
     S2 the copy is the directive's copy (title, body, three buttons)
        and "Back up now" stays hidden until there is unsaved work.
     S3 the account row (app.html, a stubbed /api/auth/me session)
        opens the dialog and does NOT sign out until "Sign out".
     S4 "Stay signed in", Escape and an outside tap all leave the
        session intact and send no /api/auth/logout.
     S5 "Sign out" sends exactly one logout and the chip goes away.
     S6 the project page's sync panel entry point (MMGR.App.syncSignOut)
        behaves the same, including the toast only AFTER confirming.
     S7 focus starts on "Stay signed in" and Tab stays inside the
        dialog (focus trap).
     S8 the unsaved-work branch: the note appears, "Back up now" runs
        the existing backup and returns to the dialog.
     S9 the marketing sheet and the signin confirmation block open the
        same dialog.
     S10 short landscape (740x360): the card fits the viewport and the
        buttons keep a 40px+ target.

   Usage:   node tools/qa-signout-confirm.cjs
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
const log = s => process.stdout.write('[qa-signout-confirm] ' + s + '\n');
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

// A stubbed session: the static QA server has no /api/auth/me, so the chip
// would never render and the account row could not be exercised. Every other
// request goes to the real fetch.
const FAKE_SESSION = `(function () {
  var real = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/api/auth/me') !== -1) {
      return Promise.resolve(new Response(JSON.stringify({
        ok: true,
        user: { name: 'QA Operator', email: 'qa@example.com' }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    return real(input, init);
  };
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

    // ---- helpers ------------------------------------------------------
    async function openPage(pagePath, opts) {
      const ctx = await browser.newContext({
        viewport: (opts && opts.viewport) || { width: 1280, height: 800 }
      });
      if (opts && opts.session) {
        await ctx.addInitScript(FAKE_SESSION);
      }
      if (opts && opts.unlock) {
        // The project page bounces to app.html?locked=<id> unless this
        // device already holds the unlock flag for the project.
        await ctx.addInitScript(
          `try { localStorage.setItem('mmgr_unlocked_' + ${JSON.stringify(
            opts.unlock
          )}, '1'); } catch (e) {}`
        );
      }
      const page = await ctx.newPage();
      const logouts = [];
      page.on('request', req => {
        if (req.method() === 'POST' && req.url().indexOf('/api/auth/logout') !== -1) {
          logouts.push(req.url());
        }
      });
      await page.goto(BASE + pagePath, { waitUntil: 'domcontentloaded' });
      await page.evaluate(FLUSH_RAF);
      await delay(400);
      return { ctx, page, logouts };
    }

    const dialogState = page =>
      page.evaluate(() => {
        const d = document.getElementById('soc');
        if (!d) {
          return { present: false };
        }
        const card = d.querySelector('.soc-card');
        const rect = card ? card.getBoundingClientRect() : null;
        const btn = sel => d.querySelector(sel);
        const label = el => (el ? (el.textContent || '').trim() : '');
        return {
          present: true,
          hidden: !!d.hidden,
          title: label(d.querySelector('.soc-title')),
          body: label(d.querySelector('.soc-body')),
          stay: label(btn('[data-soc="stay"]')),
          out: label(btn('[data-soc="out"]')),
          back: label(btn('[data-soc="backup"]')),
          backHidden: btn('[data-soc="backup"]') ? !!btn('[data-soc="backup"]').hidden : null,
          noteHidden: btn('[data-soc-note]') ? !!btn('[data-soc-note]').hidden : null,
          note: label(btn('[data-soc-note]')),
          focus: document.activeElement ? document.activeElement.getAttribute('data-soc') : null,
          z: getComputedStyle(d).zIndex,
          rect: rect ? { top: rect.top, bottom: rect.bottom, height: rect.height } : null,
          btnHeights: ['stay', 'out', 'backup'].map(k => {
            const b = btn('[data-soc="' + k + '"]');
            return b && !b.hidden ? Math.round(b.getBoundingClientRect().height) : 0;
          })
        };
      });

    const EXPECT_TITLE = 'Sign out?';
    const EXPECT_BODY =
      'Your work stays saved on this device. Cloud projects stay in your account.';

    // The account row lives inside the #siom sign-in modal, which is closed on
    // a fresh load, so a real pointer click is impossible without opening it.
    // The handler is what this harness tests, so the click is dispatched.
    const clickAccountRow = page =>
      page.evaluate(() => {
        const b = document.querySelector('#google-user-chip .gchip-out');
        if (!b) {
          return false;
        }
        b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return true;
      });

    // ---- S1/S2: the host on every page that loads the auth module ----
    const PAGES = [
      '/app.html',
      '/project.html?id=demo-project',
      '/admin.html',
      '/index.html',
      '/signin.html'
    ];
    for (const p of PAGES) {
      const { ctx, page } = await openPage(p, { unlock: 'demo-project' });
      const st = await dialogState(page);
      check('S1 ' + p + ' has the sign-out dialog, hidden by default', st.present && st.hidden, st);
      if (p === '/app.html' && st.present) {
        check('S2 the title is "Sign out?"', st.title === EXPECT_TITLE, st.title);
        check('S2 the body is the directive sentence', st.body === EXPECT_BODY, st.body);
        check(
          'S2 the two buttons read "Stay signed in" and "Sign out"',
          st.stay === 'Stay signed in' && st.out === 'Sign out',
          { stay: st.stay, out: st.out }
        );
        check(
          'S2 "Back up now" is hidden and the note is hidden when nothing is unsaved',
          st.backHidden === true && st.noteHidden === true,
          { back: st.backHidden, note: st.noteHidden }
        );
      }
      await ctx.close();
    }

    // ---- S3-S5/S7: the account row on app.html -----------------------
    {
      const { ctx, page, logouts } = await openPage('/app.html', { session: true });
      const chip = await page.evaluate(() => {
        const b = document.querySelector('#google-user-chip .gchip-out');
        return b ? { text: (b.textContent || '').trim(), visible: !b.hidden } : null;
      });
      check('S3 the stubbed session renders the account row sign-out button', !!chip, chip);

      if (chip) {
        await clickAccountRow(page);
        await page.evaluate(FLUSH_RAF);
        await delay(150);
        let st = await dialogState(page);
        check('S3 the account row opens the dialog instead of signing out', !st.hidden, st);
        check('S7 focus starts on "Stay signed in"', st.focus === 'stay', st.focus);
        check(
          'S3 no logout request is sent before the question is answered',
          logouts.length === 0,
          logouts
        );

        // Tab from the last button wraps back to the first.
        await page.focus('[data-soc="out"]');
        await page.keyboard.press('Tab');
        const afterTab = await page.evaluate(() =>
          document.activeElement ? document.activeElement.getAttribute('data-soc') : null
        );
        check(
          'S7 Tab from the last button wraps to "Stay signed in"',
          afterTab === 'stay',
          afterTab
        );

        await page.click('[data-soc="stay"]');
        await page.evaluate(FLUSH_RAF);
        await delay(150);
        st = await dialogState(page);
        const stillChip = await page.evaluate(() => {
          const c = document.getElementById('google-user-chip');
          return !!c && !c.hidden;
        });
        check('S4 "Stay signed in" closes the dialog', st.hidden === true, st.hidden);
        check('S4 "Stay signed in" leaves the session intact', stillChip, stillChip);
        check('S4 "Stay signed in" sends no logout', logouts.length === 0, logouts);

        // Escape.
        await clickAccountRow(page);
        await page.evaluate(FLUSH_RAF);
        await page.keyboard.press('Escape');
        await page.evaluate(FLUSH_RAF);
        await delay(120);
        st = await dialogState(page);
        check('S4 Escape closes the dialog and keeps the session', st.hidden === true, st.hidden);
        check('S4 Escape sends no logout', logouts.length === 0, logouts);

        // Outside tap.
        await clickAccountRow(page);
        await page.evaluate(FLUSH_RAF);
        await page.mouse.click(8, 8);
        await page.evaluate(FLUSH_RAF);
        await delay(120);
        st = await dialogState(page);
        check('S4 an outside tap closes the dialog', st.hidden === true, st.hidden);
        check('S4 an outside tap sends no logout', logouts.length === 0, logouts);

        // Confirm.
        await clickAccountRow(page);
        await page.evaluate(FLUSH_RAF);
        await page.click('[data-soc="out"]');
        await page.evaluate(FLUSH_RAF);
        await delay(500);
        st = await dialogState(page);
        check('S5 "Sign out" closes the dialog', st.hidden === true, st.hidden);
        check('S5 "Sign out" sends exactly one logout', logouts.length === 1, logouts);
        const chipGone = await page.evaluate(() => {
          const c = document.getElementById('google-user-chip');
          return !c || c.hidden || !c.querySelector('.gchip-out');
        });
        check('S5 "Sign out" removes the account row', chipGone, chipGone);
      }
      await ctx.close();
    }

    // ---- S6/S8: the project page sync panel --------------------------
    {
      const { ctx, page, logouts } = await openPage('/project.html?id=demo-project', {
        unlock: 'demo-project'
      });
      const hasApi = await page.evaluate(
        () =>
          !!(window.MMGR && MMGR.App && typeof MMGR.App.syncSignOut === 'function') &&
          !!MMGR.GoogleAuth &&
          typeof MMGR.GoogleAuth.confirmSignOut === 'function'
      );
      check('S6 the project page exposes syncSignOut and confirmSignOut', hasApi, hasApi);

      if (hasApi) {
        await page.evaluate('MMGR.App.syncSignOut();');
        await page.evaluate(FLUSH_RAF);
        await delay(150);
        let st = await dialogState(page);
        const toasted = await page.evaluate(() => {
          const t = document.querySelector('.toast, #toast');
          return t ? (t.textContent || '').trim() : '';
        });
        check('S6 syncSignOut opens the dialog', !st.hidden, st.hidden);
        check(
          'S6 no "signed out" toast appears before confirming',
          toasted.indexOf('Signed out') === -1,
          toasted
        );

        await page.click('[data-soc="stay"]');
        await page.evaluate(FLUSH_RAF);
        await delay(200);
        const afterStay = await page.evaluate(() => {
          const t = document.querySelector('.toast, #toast');
          return t ? (t.textContent || '').trim() : '';
        });
        check(
          'S6 "Stay signed in" clears no identity and shows no toast',
          afterStay.indexOf('Signed out') === -1,
          afterStay
        );
        check('S6 "Stay signed in" sends no logout', logouts.length === 0, logouts);

        // S8: unsaved work adds the note and the backup button.
        await page.evaluate(`(function () {
          window.__socBak = 0;
          window.__socDirtyOrig = MMGR.State.isDirty;
          window.__socBakOrig = MMGR.Cloud && MMGR.Cloud.autoSaveToCloud;
          MMGR.State.isDirty = function () { return true; };
          if (MMGR.Cloud) { MMGR.Cloud.autoSaveToCloud = function () { window.__socBak++; return Promise.resolve(1); }; }
          MMGR.App.syncSignOut();
        })();`);
        await page.evaluate(FLUSH_RAF);
        await delay(150);
        st = await dialogState(page);
        check('S8 unsaved work shows the note', st.noteHidden === false, st);
        check(
          'S8 the note says changes are not backed up and invents no count',
          /not been backed up/i.test(st.note) && !/\b\d+\b/.test(st.note),
          st.note
        );
        check(
          'S8 "Back up now" is offered',
          st.backHidden === false && st.back === 'Back up now',
          st
        );
        await page.click('[data-soc="backup"]');
        await page.evaluate(FLUSH_RAF);
        await delay(300);
        const bak = await page.evaluate('window.__socBak');
        const closed = await dialogState(page);
        check('S8 "Back up now" runs the existing backup', bak === 1, bak);
        check(
          'S8 "Back up now" returns to the closed state',
          closed.hidden === true,
          closed.hidden
        );
        check('S8 "Back up now" sends no logout', logouts.length === 0, logouts);
        await page.evaluate(`(function () {
          MMGR.State.isDirty = window.__socDirtyOrig;
          if (MMGR.Cloud && window.__socBakOrig) { MMGR.Cloud.autoSaveToCloud = window.__socBakOrig; }
        })();`);
      }
      await ctx.close();
    }

    // ---- S9: marketing sheet + signin confirmation -------------------
    for (const p of ['/index.html', '/signin.html']) {
      const { ctx, page } = await openPage(p);
      const fired = await page.evaluate(() => {
        const b = document.getElementById('signin-out');
        if (!b) {
          return false;
        }
        b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return true;
      });
      await page.evaluate(FLUSH_RAF);
      await delay(150);
      const st = await dialogState(page);
      check('S9 ' + p + ' has a #signin-out control', fired, fired);
      check('S9 ' + p + ' sign-out opens the shared dialog', st.present && !st.hidden, st);
      await ctx.close();
    }

    // ---- S10: short landscape ---------------------------------------
    {
      const { ctx, page } = await openPage('/project.html?id=demo-project', {
        unlock: 'demo-project',
        viewport: { width: 740, height: 360 }
      });
      await page.evaluate('MMGR.GoogleAuth.confirmSignOut(function () {});');
      await page.evaluate(FLUSH_RAF);
      await delay(150);
      const st = await dialogState(page);
      check(
        'S10 at 740x360 the card sits inside the viewport',
        !!st.rect && st.rect.top >= 0 && st.rect.bottom <= 360,
        st.rect
      );
      check(
        'S10 every visible button keeps a 40px+ target',
        st.btnHeights.filter(h => h > 0).every(h => h >= 40),
        st.btnHeights
      );
      check('S10 the dialog paints above the toast layer', st.z === '10001', st.z);
      await ctx.close();
    }
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
