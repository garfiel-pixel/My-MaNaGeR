#!/usr/bin/env node
/* ============================================================
   tools/qa-team-loading.cjs - a slow answer is not a lost connection
   ------------------------------------------------------------
   Owner report 2026-11-19: "I open the menu for role based access and it
   tells me that I need connection, but if I did not have connection I could
   not be on the web page... it loads in afterwards, but if it is going to
   take so long, why does it say I need a connection? I would prefer a line
   going across that is saying loading, and once finished the projects should
   load."

   This gate drives the launcher in a real browser with the team endpoints
   answered at controlled speeds (the client contract is what failed, not
   the Worker):

     L1  a slow memberships read keeps the section on screen with the
         travelling line and a plain "loading" sentence - and never claims
         the connection is gone
     L2  the shared cards appear when the answer lands, and the line goes
     L3  an invitations failure while the browser is ONLINE shows a plain
         retry sentence, not "Needs a connection"
     L4  a browser that really is offline still shows "Needs a connection"
     L5  zero page errors through the walk

   Owner report 2026-11-27 (added the same day):
     L6  the Collaborators tab shows a travelling line and never claims "No
         cloud projects of your own" while the owned-projects read is in
         flight - the answer replaces the wait with the real rows
     L7  a background refresh does not repaint over an edit in progress: an
         address typed into an open invite form survives a refresh call

   Usage:  node tools/qa-team-loading.cjs
   Registry: docs/CI-TEST-COVERAGE.md -> CI row (browser-app).
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
    const h = await fetch(BASE + '/app.html');
    if (h.ok) {
      return null;
    }
  } catch (e) {
    /* not running */
  }
  const proc = spawn(process.execPath, [path.join(ROOT, 'serve.cjs')], {
    cwd: ROOT,
    stdio: 'ignore'
  });
  for (let i = 0; i < 40; i++) {
    await delay(500);
    try {
      const h = await fetch(BASE + '/app.html');
      if (h.ok) {
        return proc;
      }
    } catch (e) {
      /* keep waiting */
    }
  }
  throw new Error('serve.cjs did not answer on ' + BASE);
}

/* What the stubbed Worker answers, and how slowly. */
const stub = {
  invitations: 'ok',
  memberships: 'ok',
  delayMs: 0,
  offline: false,
  projects: [],
  projectsDelayMs: 0,
  projectsFail: false,
  // When true the two team reads park until releaseHeld() runs. A fixed delay
  // raced the page load on a busy machine (the 900ms snapshot could land after
  // a 4s delay had already elapsed), which made L1 flaky; a held response makes
  // "during the wait" a fact rather than a guess.
  hold: false
};
let heldResolvers = [];
function releaseHeld() {
  const rs = heldResolvers;
  heldResolvers = [];
  rs.forEach(r => r());
}

async function newContext(browser, width) {
  const ctx = await browser.newContext({
    viewport: { width: width || 1280, height: 900 },
    colorScheme: 'light',
    serviceWorkers: 'block'
  });
  await ctx.addInitScript(off => {
    try {
      localStorage.setItem(
        'mmgr_consent',
        JSON.stringify({ v: 1, iv: 3, analytics: false, ts: new Date().toISOString() })
      );
    } catch (e) {}
    if (off) {
      Object.defineProperty(navigator, 'onLine', { get: () => false });
    }
  }, stub.offline);
  await ctx.route('**/api/**', async route => {
    const u = route.request().url();
    const json = (o, s) =>
      route.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(o) });
    // The roster read is checked before the list route: both contain
    // `/api/cloud/projects`.
    if (/\/api\/cloud\/projects\/[^/]+\/team(\?|$)/.test(u)) {
      return json({
        ok: true,
        members: [
          {
            id: 11,
            name: 'Sam Reed',
            inviteeEmail: 'sam@example.test',
            status: 'active',
            role: 'supervisor',
            perm: {},
            budgetApprover: false,
            acceptedAt: '2026-11-10T00:00:00.000Z',
            accessExpiresAt: null
          }
        ]
      });
    }
    if (u.includes('/api/team/invitations')) {
      if (stub.hold) {
        await new Promise(res => heldResolvers.push(res));
      } else if (stub.delayMs) {
        await delay(stub.delayMs);
      }
      if (stub.invitations === 'fail') {
        return json({ ok: false, error: 'boom' }, 500);
      }
      return json({ ok: true, invitations: [] });
    }
    if (u.includes('/api/team/memberships')) {
      if (stub.hold) {
        await new Promise(res => heldResolvers.push(res));
      } else if (stub.delayMs) {
        await delay(stub.delayMs);
      }
      return json({
        ok: true,
        memberships: [
          {
            id: 'm1',
            projectId: 'p1',
            projectName: 'Riverside Tower',
            ownerName: 'Owner',
            role: 'supervisor',
            status: 'active',
            updatedAt: '2026-11-10T00:00:00.000Z',
            hasSnapshot: true
          }
        ]
      });
    }
    if (u.includes('/api/auth/me')) {
      return json({
        ok: true,
        signedIn: true,
        user: { email: 'm@example.test', sub: 'qa', name: 'tester' }
      });
    }
    if (u.includes('/api/cloud/projects')) {
      if (stub.projectsDelayMs) {
        await delay(stub.projectsDelayMs);
      }
      if (stub.projectsFail) {
        return json({ ok: false, error: 'boom' }, 500);
      }
      return json({ ok: true, projects: stub.projects || [] });
    }
    if (u.includes('/api/billing/status')) {
      return json({ ok: true, configured: false, plan: 'free', active: false });
    }
    return json({ ok: true });
  });
  return ctx;
}

const STATE = () => {
  const bar = document.getElementById('shared-progress');
  const off = document.getElementById('team-offline');
  const sec = document.getElementById('shared-dash');
  const panelBar = document.getElementById('team-progress');
  const status = document.getElementById('team-pop-status');
  return {
    barHidden: bar ? bar.hidden : null,
    barHeight: bar ? Math.round(bar.getBoundingClientRect().height) : 0,
    panelBarHidden: panelBar ? panelBar.hidden : null,
    offlineHidden: off ? off.hidden : null,
    sectionHidden: sec ? sec.hidden : null,
    cards: document.querySelectorAll('#shared-list .pcard').length,
    text: sec ? sec.innerText.replace(/\s+/g, ' ').trim() : '',
    status: status ? status.textContent : ''
  };
};

const COL_STATE = () => {
  const bar = document.getElementById('team-own-progress');
  const list = document.getElementById('team-col-list');
  const email = document.getElementById('team-inv-email-p1');
  return {
    ownBarHidden: bar ? bar.hidden : null,
    ownBarHeight: bar ? Math.round(bar.getBoundingClientRect().height) : 0,
    text: list ? list.innerText.replace(/\s+/g, ' ').trim() : '',
    projectRows: document.querySelectorAll('#team-col-list .team-project-row').length,
    emailValue: email ? email.value : null,
    emailPresent: !!email
  };
};

(async () => {
  let srv = null;
  let browser = null;
  try {
    srv = await ensureServer();
    const { chromium } = require('playwright');
    browser = await chromium.launch({
      headless: true,
      executablePath: require('./chrome-launcher.cjs').chromePath,
      args: ['--disk-cache-size=0', '--no-sandbox']
    });

    // ---- L1/L2: a slow answer ---------------------------------------------
    stub.invitations = 'ok';
    stub.memberships = 'ok';
    stub.delayMs = 0;
    stub.offline = false;
    stub.hold = true;
    {
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(BASE + '/app.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForFunction(() => document.readyState === 'complete', null, {
        timeout: 30000
      });
      // The reads are parked, so this snapshot is always "during the wait".
      await page
        .waitForFunction(
          () => {
            const b = document.getElementById('shared-progress');
            return b && !b.hidden;
          },
          null,
          { timeout: 10000 }
        )
        .catch(() => {});
      const during = await page.evaluate(STATE);
      releaseHeld();
      stub.hold = false;
      check(
        'L1a the shared section is on screen while the answer is in flight',
        during.sectionHidden === false,
        during
      );
      check(
        'L1b a travelling line is visible',
        during.barHidden === false && during.barHeight >= 2,
        during
      );
      check(
        'L1c it says it is loading, in plain words',
        /Loading the projects shared with you/i.test(during.text),
        during.text
      );
      check('L1d it does NOT claim the connection is gone', during.offlineHidden === true, during);
      await page
        .waitForFunction(() => document.querySelectorAll('#shared-list .pcard').length > 0, null, {
          timeout: 12000
        })
        .catch(() => {});
      const after = await page.evaluate(STATE);
      check('L2a the shared project arrives when the answer lands', after.cards === 1, after);
      check('L2b the line goes away when it lands', after.barHidden === true, after);
      check(
        'L2c the loading sentence is cleared',
        !/Loading the projects/i.test(after.text),
        after.text
      );
      check('L5a zero page errors on the slow walk', errors.length === 0, errors.slice(0, 3));
      await ctx.close();
    }

    // ---- L3: a failed read while ONLINE ------------------------------------
    stub.delayMs = 0;
    stub.invitations = 'fail';
    {
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      await page.goto(BASE + '/app.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForFunction(() => document.readyState === 'complete', null, {
        timeout: 30000
      });
      await delay(900);
      await page.evaluate(() => {
        const p = document.getElementById('team-pop');
        if (p) {
          p.hidden = false;
        }
      });
      await delay(300);
      const s = await page.evaluate(STATE);
      check('L3a an online failure keeps "Needs a connection" hidden', s.offlineHidden === true, s);
      check(
        'L3b it says the server has not answered, in plain words',
        /has not answered yet/i.test(s.status),
        s.status
      );
      await ctx.close();
    }

    // ---- L4: a browser that really is offline ------------------------------
    stub.offline = true;
    stub.invitations = 'fail';
    {
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      await page.goto(BASE + '/app.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForFunction(() => document.readyState === 'complete', null, {
        timeout: 30000
      });
      await delay(900);
      await page.evaluate(() => {
        const p = document.getElementById('team-pop');
        if (p) {
          p.hidden = false;
        }
      });
      await delay(300);
      const s = await page.evaluate(STATE);
      check('L4 an offline browser still shows "Needs a connection"', s.offlineHidden === false, s);
      await ctx.close();
    }
    // ---- L6: the owned list is loading, not empty --------------------------
    stub.invitations = 'ok';
    stub.memberships = 'ok';
    stub.delayMs = 0;
    stub.offline = false;
    stub.projectsFail = false;
    stub.projects = [
      {
        projectId: 'p1',
        label: 'Riverside Tower',
        hasSnapshot: true,
        updatedAt: '2026-11-20T00:00:00.000Z',
        createdAt: '2026-11-01T00:00:00.000Z',
        status: 'active',
        accessRole: 'owner'
      }
    ];
    stub.projectsDelayMs = 0;
    {
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(BASE + '/app.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForFunction(
        () => document.documentElement.getAttribute('data-team-ready') === '1',
        null,
        {
          timeout: 30000
        }
      );
      // Only the owned-projects read is slow from here on.
      stub.projectsDelayMs = 3500;
      await page.click('[data-team-bell]');
      await page.click('#team-tab-col');
      await delay(700);
      const during = await page.evaluate(COL_STATE);
      check(
        'L6a a travelling line is visible while the owned list loads',
        during.ownBarHidden === false && during.ownBarHeight >= 2,
        during
      );
      check(
        'L6b it does NOT claim there are no cloud projects while loading',
        !/No cloud projects of your own/i.test(during.text) &&
          /Loading your cloud projects/i.test(during.text),
        during.text
      );
      // Wait for the OWNED row itself: the shared card above it carries the
      // same project name, so a text match would pass before the fetch lands.
      await page
        .waitForFunction(
          () => document.querySelectorAll('#team-col-list .team-project-row').length === 1,
          null,
          { timeout: 15000 }
        )
        .catch(() => {});
      const after = await page.evaluate(COL_STATE);
      check('L6c the real project row replaces the wait', after.projectRows === 1, after);
      check('L6d the line goes away when the answer lands', after.ownBarHidden === true, after);
      check(
        'L6e the waited answer never reads as an empty account',
        !/No cloud projects of your own/i.test(after.text),
        after.text
      );

      // ---- L7: a refresh stays quiet while the reader is editing ----------
      stub.projectsDelayMs = 0;
      await page.click('[data-team-people="p1"]');
      await page.waitForFunction(() => !!document.getElementById('team-inv-email-p1'), null, {
        timeout: 10000
      });
      await page.fill('#team-inv-email-p1', 'new.person@example.test');
      await page.evaluate(() => window.MMGR.TeamUI.refreshNow());
      await delay(700);
      const edited = await page.evaluate(COL_STATE);
      check(
        'L7a the typed address survives a background refresh',
        edited.emailValue === 'new.person@example.test',
        edited
      );
      check('L7b the invite form is still open', edited.emailPresent === true, edited);
      check('L5b zero page errors on the quiet walk', errors.length === 0, errors.slice(0, 3));
      await ctx.close();
    }
  } catch (e) {
    fails.push('HARNESS ERROR: ' + e.message);
    console.log('FAIL  harness error  <-- ' + e.message);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (srv) {
      try {
        process.kill(srv.pid);
      } catch (e) {}
    }
  }
  console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) {
    console.log('FAILED: ' + fails.join(' | '));
    process.exit(1);
  }
  console.log('TEAM LOADING GATE GREEN');
})();
