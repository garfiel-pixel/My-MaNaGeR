#!/usr/bin/env node
/* ============================================================
   tools/qa-admin-autosave.cjs - 5.5 A3 AUTO-UPDATE FOR CLOUD PROJECTS
   ---------------------------------------------------------------
   Owner (audit 2026-11-01, A3): "when you click the auto update ... a
   user['s] projects are automatically updated. They don't have to go and
   manually click update."

   The contract this gate pins, against a real admin.html with /api/cloud/*
   stubbed at the network layer (Playwright route):

     AU0  a fresh profile unlocks (setup -> recovery modal -> panel)
     AU1  the toggle is OFF by default and the status line says so
     AU2  turning it ON persists the preference across a reload (per device)
     AU3  one edit with the toggle on pushes EXACTLY ONCE and the status
          reads "Last pushed"
     AU4  a burst of state changes in one debounce window coalesces into
          ONE push (autoNoteChange is the entry every save uses)
     AU5  a 500 is retried and the retry lands (2 requests, then success)
     AU6  once retries are exhausted the status shows Failed WITH the
          provider's reason (3 requests: initial + two retries)
     AU7  offline an edit holds at zero pushes and fires when the
          connection returns
     AU8  zero uncaught page errors through the whole walk

   Usage:  node tools/qa-admin-autosave.cjs
   Registry: docs/CI-TEST-COVERAGE.md -> CI row (browser-calc).
   ============================================================ */
'use strict';
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8765);
const BASE = process.env.BASE || 'http://127.0.0.1:' + PORT;
const delay = ms => new Promise(r => setTimeout(r, ms));

let pass = 0;
const fails = [];
function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log('PASS  ' + name);
  } else {
    fails.push(name);
    console.log(
      'FAIL  ' +
        name +
        (detail === undefined ? '' : '  <-- ' + JSON.stringify(detail).slice(0, 600))
    );
  }
}

async function ensureServer() {
  try {
    const h = await fetch(BASE + '/admin.html');
    if (h.ok) {
      return null;
    }
  } catch (e) {
    /* not up */
  }
  const srv = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 30; i++) {
    await delay(1000);
    try {
      const h = await fetch(BASE + '/admin.html');
      if (h.ok) {
        return srv;
      }
    } catch (e) {
      /* keep waiting */
    }
  }
  throw new Error('serve.cjs did not come up');
}

// One cloud-linked project on the device. Plain (non-session) owner code so
// the push path does not need a Google sign-in: the role/session gates only
// apply to cloudOwnerCode === 'session'.
const SEED = [
  {
    id: 'qa-auto-1',
    title: 'QA Auto Project',
    description: '',
    status: 'active',
    file: 'project.html?id=qa-auto-1',
    code: 'QAAUTO123',
    codeHash: null,
    roCode: '',
    roCodeHash: null,
    cloudId: 'qa-cloud-1',
    cloudOwnerCode: 'QAOWNER0001',
    lastCloudPushAt: null
  }
];

(async () => {
  let srv = await ensureServer();
  const { chromium } = require('playwright');
  const browser = await chromium.launch({
    headless: true,
    executablePath: require('./chrome-launcher.cjs').chromePath,
    args: ['--disk-cache-size=0', '--no-sandbox']
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  // ---- the stub: /api/cloud/* answered in the page's own network stack ----
  // save is the ONLY counter: mode 'ok' | 'flaky' (first save 500) | 'fail'.
  const cloud = { saves: 0, mode: 'ok', flakyFired: 0 };
  await ctx.route(/\/api\/cloud\//, async route => {
    const url = route.request().url();
    const json = (status, body) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (/\/save$/.test(url)) {
      cloud.saves++;
      if (cloud.mode === 'fail') {
        return json(500, { ok: false, error: 'stubbed save failure' });
      }
      if (cloud.mode === 'flaky' && cloud.flakyFired === 0) {
        cloud.flakyFired++;
        return json(500, { ok: false, error: 'stubbed save failure' });
      }
      return json(200, { ok: true, savedAt: new Date().toISOString() });
    }
    if (/\/load$/.test(url)) {
      return json(200, { ok: true, state: null });
    }
    if (/\/projects$/.test(url)) {
      return json(200, { ok: true, projects: [] });
    }
    return json(200, { ok: true });
  });

  // Seed the device BEFORE any page script runs.
  await ctx.addInitScript(list => {
    try {
      localStorage.setItem('mmgr_admin_projects', list);
    } catch (e) {
      /* ignore */
    }
  }, JSON.stringify(SEED));

  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String((e && e.message) || e)));

  // The panel sits behind a first-run setup (fresh device) or the local
  // password (returning device), then a show-once recovery-code modal.
  // Same walk verify-controls-admin.cjs uses, but polled from one place so
  // a reload mid-gate (AU2) re-unlocks through the login arm.
  let setupClicked = false;
  let loginClicked = false;
  async function unlock() {
    for (let t = 0; t < 60; t++) {
      const st = await page.evaluate(
        clicks => {
          const vis = id => {
            const el = document.getElementById(id);
            return !!el && !el.classList.contains('hidden');
          };
          const app = document.getElementById('admin-app');
          if (app && !app.classList.contains('hidden')) return 'unlocked';
          // The recovery modal opens ON TOP of the still-visible setup
          // screen, so it must be checked BEFORE the screens or the poll
          // sits on 'setup' forever with a modal it never dismisses.
          const omEarly = document.getElementById('rc-om');
          if (omEarly && omEarly.classList.contains('show')) {
            const cb0 = document.getElementById('rc-saved-cb');
            if (cb0 && !cb0.checked) {
              cb0.checked = true;
              cb0.dispatchEvent(new Event('change', { bubbles: true }));
            }
            const b0 = document.querySelector('#rc-om [data-action="confirmRecoverySaved"]');
            if (b0) b0.click();
            return 'recovery';
          }
          if (vis('setup-screen')) {
            const p1 = document.getElementById('setup-pass1');
            const p2 = document.getElementById('setup-pass2');
            if (p1 && p2 && !p1.value) {
              p1.value = 'TestPass123!';
              p2.value = 'TestPass123!';
            }
            if (!clicks.setup) {
              clicks.setup = true;
              const b = document.querySelector('#setup-screen [data-action="adminSetupPassword"]');
              if (b) b.click();
            }
            return 'setup';
          }
          if (vis('login-screen')) {
            const p = document.getElementById('login-pass');
            if (p && !p.value) {
              p.value = 'TestPass123!';
            }
            if (!clicks.login) {
              clicks.login = true;
              const b = document.querySelector('#login-screen [data-action="adminLogin"]');
              if (b) b.click();
            }
            return 'login';
          }
          const om = document.getElementById('rc-om');
          if (om && om.classList.contains('show')) {
            const cb = document.getElementById('rc-saved-cb');
            if (cb && !cb.checked) {
              cb.checked = true;
              cb.dispatchEvent(new Event('change', { bubbles: true }));
            }
            const b = document.querySelector('#rc-om [data-action="confirmRecoverySaved"]');
            if (b) b.click();
            return 'recovery';
          }
          return 'waiting';
        },
        { setup: setupClicked, login: loginClicked }
      );
      if (st === 'setup') setupClicked = true;
      if (st === 'login') loginClicked = true;
      if (st === 'unlocked') return true;
      await delay(400);
    }
    return false;
  }

  const snap = () =>
    page.evaluate(() => ({
      on: localStorage.getItem('mmgr_autosave_cloud') === '1',
      checked: !!(document.getElementById('autosave-tgl') || {}).checked,
      status: ((document.getElementById('autosave-status') || {}).textContent || '').trim(),
      rows: document.querySelectorAll('#project-list .prow').length
    }));

  // Wait until the status matches and the save counter is where we expect.
  async function waitStatus(re, wantSaves, tries) {
    let s = null;
    for (let t = 0; t < (tries || 40); t++) {
      s = await snap();
      if (re.test(s.status) && (wantSaves === undefined || cloud.saves >= wantSaves)) return s;
      await delay(300);
    }
    return s;
  }

  try {
    await page.goto(BASE + '/admin.html', { waitUntil: 'domcontentloaded' });
    const ok0 = await unlock();
    check('AU0 a fresh profile unlocks through setup and the recovery modal', ok0);

    // ---- AU1: OFF by default -------------------------------------------
    let s = await snap();
    check(
      'AU1 the toggle is OFF by default and the status line says so',
      !s.on && !s.checked && /Auto-update is off/.test(s.status) && s.rows > 0,
      s
    );

    // ---- AU2: ON persists across a reload (per device) ------------------
    await page.click('#autosave-section label.tgl');
    s = await snap();
    check(
      'AU2a turning it ON flips the status and stores the preference',
      s.on && s.checked && /Auto-update is on/.test(s.status),
      s
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    const ok2 = await unlock();
    s = await snap();
    check(
      'AU2b the preference survives a reload (persisted per device)',
      ok2 && s.on && s.checked,
      {
        ok2,
        s
      }
    );

    // ---- AU3: one edit pushes ONCE --------------------------------------
    cloud.saves = 0;
    await page.click('#project-list button[data-action="openProjectModal"][data-idx="0"]');
    await page.fill('#pf-title', 'QA Auto Project Renamed');
    await page.click('#om [data-action="saveProjectForm"]');
    s = await waitStatus(/Last pushed/, 1, 40);
    check(
      'AU3 one edit pushes exactly once and the status reads Last pushed',
      cloud.saves === 1 && /Last pushed/.test(s.status),
      { saves: cloud.saves, status: s.status }
    );

    // ---- AU4: a burst coalesces into ONE push ---------------------------
    cloud.saves = 0;
    await page.evaluate(() => {
      autoNoteChange(0);
      autoNoteChange(0);
      autoNoteChange(0);
    });
    await delay(3400); // debounce (1200) + the push itself; anything more is idle time
    check(
      'AU4 three state changes in one debounce window coalesce to ONE push',
      cloud.saves === 1,
      { saves: cloud.saves }
    );

    // ---- AU5: a 500 is retried and the retry lands ----------------------
    cloud.saves = 0;
    cloud.mode = 'flaky';
    cloud.flakyFired = 0;
    await page.evaluate(() => autoNoteChange(0));
    s = await waitStatus(/Last pushed/, 2, 40);
    check('AU5 a 500 is retried and the retry lands (2 requests)', cloud.saves === 2, {
      saves: cloud.saves,
      status: s && s.status
    });
    cloud.mode = 'ok';

    // ---- AU6: exhausted retries show Failed WITH the reason -------------
    cloud.saves = 0;
    cloud.mode = 'fail';
    await page.evaluate(() => autoNoteChange(0));
    s = await waitStatus(/Failed:/, undefined, 60);
    check(
      'AU6 the status shows Failed with the provider reason after the retries',
      !!s && /Failed:/.test(s.status) && /stubbed save failure/.test(s.status),
      s && s.status
    );
    check('AU6b the failure path made the initial attempt plus two retries', cloud.saves === 3, {
      saves: cloud.saves
    });
    cloud.mode = 'ok';

    // ---- AU7: offline holds the push until the connection returns --------
    cloud.saves = 0;
    await ctx.setOffline(true);
    for (let t = 0; t < 20; t++) {
      const on = await page.evaluate(() => navigator.onLine);
      if (!on) break;
      await delay(150);
    }
    await page.evaluate(() => autoNoteChange(0));
    await delay(2600); // past the debounce: an online schedule would have pushed by now
    const held = await snap();
    const heldOffline = cloud.saves === 0 && /Offline/.test(held.status);
    await ctx.setOffline(false);
    for (let t = 0; t < 20; t++) {
      const on = await page.evaluate(() => navigator.onLine);
      if (on) break;
      await delay(150);
    }
    const landed = await waitStatus(/Last pushed/, 1, 30);
    check(
      'AU7 an offline edit holds at zero pushes and fires when the connection returns',
      heldOffline && cloud.saves === 1,
      { heldOffline, saves: cloud.saves, status: landed && landed.status }
    );

    // ---- AU8: clean page ------------------------------------------------
    check(
      'AU8 zero uncaught page errors through the walk',
      pageErrors.length === 0,
      pageErrors.slice(0, 5)
    );
  } catch (e) {
    check('harness ran without throwing', false, String((e && e.stack) || e));
  } finally {
    try {
      await ctx.close();
    } catch (e) {
      /* ignore */
    }
    try {
      await browser.close();
    } catch (e) {
      /* ignore */
    }
    if (srv) {
      try {
        srv.kill();
      } catch (e) {
        /* gone */
      }
    }
  }

  console.log('');
  const total = pass + fails.length;
  if (fails.length) {
    console.log('FAIL - ' + pass + '/' + total + ' gates');
    process.exit(1);
  }
  console.log('PASS - ' + pass + '/' + total + ' gates');
})().catch(e => {
  console.error('FATAL', e);
  process.exit(1);
});
