#!/usr/bin/env node
/* ============================================================
   tools/qa-cloud-refresh.cjs - the launcher's cloud list survives a reload
   ------------------------------------------------------------
   Owner report (audit 2026-10-31, finding 5): "Cloud projects disappear after
   a hard refresh". The cloud list is the only door to a project this device
   has not opened yet, so a list that blinks out is a list the owner cannot
   trust - and in the worst reading it is the difference between "my projects
   are gone" and "my projects are fine".

   The Worker API is stubbed at the network layer (Playwright route), because
   this gate is about the LAUNCHER's rendering contract, not the server:

     S5a  a signed-in boot paints every project the API returned
     S5b  a HARD reload paints the same list again (the owner's report)
     S5c  the rail's Cloud Projects accordion agrees with the main list
     S5d  a transient API failure after a good load leaves the cards on
          screen and says so, instead of blanking the section
     S5e  an offline boot with a previous good load still shows the cards
     S5f  a signed-out boot shows no cloud cards at all (never a leak)
     S5g  zero page errors through the walk

   Usage:  node tools/qa-cloud-refresh.cjs
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
    /* not up */
  }
  const srv = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 30; i++) {
    await delay(1000);
    try {
      const h = await fetch(BASE + '/app.html');
      if (h.ok) {
        return srv;
      }
    } catch (e) {
      /* keep waiting */
    }
  }
  throw new Error('serve.cjs did not come up');
}

// Two projects: one owner card with a snapshot, one shared editor card. The
// list renderer treats them differently, so both shapes ride every step.
const PROJECTS = [
  {
    projectId: 'harbourview-blk-b',
    label: 'Harbour View Block B',
    updatedAt: '2026-10-28T10:00:00.000Z',
    hasSnapshot: true,
    accessRole: 'owner'
  },
  {
    projectId: 'portmore-workshop',
    label: 'Portmore Workshop',
    createdAt: '2026-10-20T09:00:00.000Z',
    hasSnapshot: true,
    accessRole: 'editor'
  }
];

// What the gate reads off the page. Kept inside the page as one function so a
// single evaluate can answer the whole question.
const SNAP = () => {
  const list = document.getElementById('cloud-dash-list');
  const dash = document.getElementById('cloud-dash');
  const rail = document.getElementById('rail-cloud-list');
  const names = list ? [...list.querySelectorAll('.cd-title')].map(n => n.textContent.trim()) : [];
  return {
    cards: names,
    dashHidden: !dash || dash.hidden,
    busy: dash ? dash.getAttribute('aria-busy') : null,
    railText: rail ? rail.textContent.trim() : '',
    status: (document.getElementById('cloud-dash-status') || {}).textContent || ''
  };
};

(async () => {
  let srv = await ensureServer();
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ args: ['--disk-cache-size=0'] });

  // One context for the whole walk: localStorage is the state under test, so
  // a fresh profile per step would erase the very cache being proven.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e && e.message)));

  // mode: 'ok' | 'down' | 'signed-out'; read by every handler below.
  const net = { mode: 'ok' };

  await ctx.route('**/api/cloud/projects**', async route => {
    if (net.mode === 'down') {
      await route.abort('failed');
      return;
    }
    if (net.mode === 'signed-out') {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'sign in' })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, projects: PROJECTS })
    });
  });
  await ctx.route('**/api/auth/me', async route => {
    if (net.mode === 'signed-out') {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        signedIn: true,
        email: 'owner@example.test',
        sub: 'qa-sub-1'
      })
    });
  });
  await ctx.route('**/api/billing/**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, plan: 'premium' })
    });
  });
  await ctx.route('**/api/team/memberships**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, memberships: [] })
    });
  });

  try {
    // ---- S5a: a signed-in boot paints the list -----------------------------
    await page.goto(BASE + '/app.html', { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(
      () => {
        const l = document.getElementById('cloud-dash-list');
        return l && l.querySelectorAll('.cd-title').length > 0;
      },
      null,
      { timeout: 20000 }
    );
    await delay(400);
    const first = await page.evaluate(SNAP);
    check(
      'S5a a signed-in boot paints every project the API returned',
      first.cards.length === PROJECTS.length &&
        first.cards.some(c => c.indexOf('Harbour View Block B') === 0) &&
        first.cards.some(c => c.indexOf('Portmore Workshop') === 0),
      first
    );

    // ---- S5b: the hard reload (the owner's report) -------------------------
    await page.reload({ waitUntil: 'load', timeout: 60000 });
    await delay(1200);
    const second = await page.evaluate(SNAP);
    check(
      'S5b a hard reload paints the same cloud projects again',
      second.cards.length === PROJECTS.length && second.dashHidden === false,
      second
    );

    // ---- S5c: the rail accordion agrees ------------------------------------
    const railOk = await page.evaluate(() => {
      const t = document.getElementById('rail-cloud-list');
      return t ? t.textContent : '';
    });
    check(
      'S5c the rail Cloud Projects list agrees with the main list',
      /Harbour View Block B/.test(railOk) && /Portmore Workshop/.test(railOk),
      railOk.slice(0, 200)
    );

    // ---- S5d: a transient failure after a good load ------------------------
    // Reload with the API down: the grid must not blank. The cached list is
    // the only honest answer while the request is failing.
    net.mode = 'down';
    await page.reload({ waitUntil: 'load', timeout: 60000 });
    await delay(1600);
    const down = await page.evaluate(SNAP);
    check(
      'S5d a failing API leaves the last good cloud list on screen',
      down.dashHidden === false && down.cards.length === PROJECTS.length,
      down
    );
    check(
      'S5d2 the failure is stated in the status line, not swallowed',
      /offline|unavailable|could not|last saved|showing/i.test(down.status),
      down.status
    );

    // ---- S5e: a fresh page with no network at all --------------------------
    // Same storage, brand-new document, API still down: still the cache.
    const p2 = await ctx.newPage();
    p2.on('pageerror', e => errors.push(String(e && e.message)));
    await p2.goto(BASE + '/app.html', { waitUntil: 'load', timeout: 60000 });
    await delay(1600);
    const offline = await p2.evaluate(SNAP);
    check(
      'S5e an offline boot shows the cached cloud list',
      offline.dashHidden === false && offline.cards.length === PROJECTS.length,
      offline
    );

    // ---- S5f: signed out shows nothing ------------------------------------
    net.mode = 'signed-out';
    await p2.reload({ waitUntil: 'load', timeout: 60000 });
    await delay(1600);
    const out = await p2.evaluate(SNAP);
    check('S5f a signed-out boot shows no cloud cards', out.cards.length === 0, out);

    check('S5g zero page errors through the walk', errors.length === 0, errors.slice(0, 4));
  } finally {
    await ctx.close();
    await browser.close();
    if (srv) {
      srv.kill();
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
