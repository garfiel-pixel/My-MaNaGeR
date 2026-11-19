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
const stub = { invitations: 'ok', memberships: 'ok', delayMs: 0, offline: false };

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
    if (u.includes('/api/team/invitations')) {
      if (stub.delayMs) {
        await delay(stub.delayMs);
      }
      if (stub.invitations === 'fail') {
        return json({ ok: false, error: 'boom' }, 500);
      }
      return json({ ok: true, invitations: [] });
    }
    if (u.includes('/api/team/memberships')) {
      if (stub.delayMs) {
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
      return json({ ok: true, projects: [] });
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
    stub.delayMs = 4000;
    stub.offline = false;
    {
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(BASE + '/app.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForFunction(() => document.readyState === 'complete', null, {
        timeout: 30000
      });
      await delay(900);
      const during = await page.evaluate(STATE);
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
