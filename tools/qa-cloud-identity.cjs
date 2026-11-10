#!/usr/bin/env node
/* tools/qa-cloud-identity.cjs - Wave 2 gate: identity, status and sync mode
   ---------------------------------------------------------------------------
   The owner's rules (2026-11-10):
     - two accounts may keep the same project NAME; only the cloud id is global,
       so a taken id is retried with -2 ... -6 and the name never changes;
     - a project carries a lifecycle status that the header chip writes and the
       launcher card reads;
     - a person who does not want unfinished work published picks MANUAL sync,
       and then the only publish is "Close snapshot" in the backup popover.

   Every check measures the RENDERED app or the requests the app actually made.
   The Worker is replaced by page.route() fixtures, so no D1 or wrangler is
   needed - the server contract itself is covered by qa-tenant-isolation
   (I22-I29).

   Usage:  node serve.cjs &          (separate shell)
           node tools/qa-cloud-identity.cjs
   Env:    QA_BASE (default http://127.0.0.1:8765), QA_CHANNEL (e.g. 'chrome')
   Needs:  playwright.                                                          */
'use strict';
const { chromium } = require('playwright');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:8765';
const results = [];

function check(id, cond, detail) {
  results.push({ id, ok: !!cond });
  console.log(
    (cond ? 'PASS  ' : 'FAIL  ') + id + (detail !== undefined ? '   [' + detail + ']' : '')
  );
}

// A signed-out /api/auth/me: the create path then runs anonymously, exactly as
// a visitor's would, and no session-owner probe can short-circuit it.
const SIGNED_OUT = { status: 401, contentType: 'application/json', body: '{"ok":false}' };

async function newPage(browser, projectId, routes, opts) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.addInitScript(id => {
    localStorage.setItem(
      'mmgr_admin_projects',
      JSON.stringify([{ id: id, title: 'Feature testing', description: '', status: 'active' }])
    );
  }, projectId);
  await page.route('**/api/auth/me', route =>
    route.fulfill(
      opts && opts.signedIn
        ? {
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              ok: true,
              email: 'qa-identity@example.com',
              user: { email: 'qa-identity@example.com', name: 'QA Identity' }
            })
          }
        : SIGNED_OUT
    )
  );
  if (routes) {
    await routes(page);
  }
  await page.goto(BASE + '/project.html?id=' + encodeURIComponent(projectId), {
    waitUntil: 'load'
  });
  await page.waitForFunction(
    () => !!(window.MMGR && window.MMGR.State && window.MMGR.Render && window.MMGR.Cloud),
    null,
    { timeout: 20000 }
  );
  await page.waitForTimeout(500);
  return { ctx, page, errs };
}

(async () => {
  const browser = await chromium.launch({
    channel: process.env.QA_CHANNEL || 'chrome',
    args: ['--disk-cache-size=0']
  });

  // ---- A. the lifecycle status chip ---------------------------------------
  // Signed in with a linked cloud copy, so the sync-mode arm has a real link
  // to hang the manual choice on.
  const A = await newPage(
    browser,
    'qa-identity-a',
    async page => {
      await page.route('**/api/cloud/projects/*/meta', route =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            projectId: 'qa-identity-a',
            linked: true,
            hasSnapshot: true,
            updatedAt: '2026-11-10T09:00:00.000Z',
            status: 'active',
            syncMode: 'auto'
          })
        })
      );
      await page.route('**/api/cloud/projects', route =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, projects: [] })
        })
      );
    },
    { signedIn: true }
  );
  const a = A.page;
  await a.evaluate(() => window.MMGR.Cloud._probeOwnerSession(true));

  const chip = await a.evaluate(() => {
    const c = document.getElementById('status-chip');
    if (!c) return null;
    return {
      label: (document.getElementById('status-chip-lbl') || {}).textContent,
      hasPop: !!document.getElementById('status-pop'),
      items: document.querySelectorAll('#status-pop [data-status]').length
    };
  });
  check('S1 the workspace header carries a status chip', !!chip, JSON.stringify(chip));
  check('S2 it starts on Active', !!chip && chip.label === 'Active', chip && chip.label);
  check(
    'S3 the chip opens a four-state menu',
    !!chip && chip.hasPop && chip.items === 4,
    chip && chip.hasPop + '/' + chip.items
  );

  await a.click('#status-chip');
  const opened = await a.evaluate(() => {
    const p = document.getElementById('status-pop');
    return !!(p && p.matches(':popover-open'));
  });
  check('S4 clicking the chip opens the menu', opened, String(opened));

  await a.click('#status-pop [data-status="planning"]');
  await a.waitForTimeout(200);
  const afterClick = await a.evaluate(() => ({
    state: window.MMGR.State.getState().status,
    label: (document.getElementById('status-chip-lbl') || {}).textContent,
    checked: (
      document.querySelector('#status-pop [data-status="planning"]') || {}
    ).getAttribute
      ? document
          .querySelector('#status-pop [data-status="planning"]')
          .getAttribute('aria-checked')
      : null,
    popOpen: (document.getElementById('status-pop') || {}).matches
      ? document.getElementById('status-pop').matches(':popover-open')
      : null
  }));
  check(
    'S5 choosing Planning writes state.status and repaints the chip',
    afterClick.state === 'planning' &&
      afterClick.label === 'Planning' &&
      afterClick.checked === 'true',
    JSON.stringify(afterClick)
  );
  check('S6 the menu closes after a choice', afterClick.popOpen === false, String(afterClick.popOpen));

  const mirror = await a.evaluate(() => {
    const list = JSON.parse(localStorage.getItem('mmgr_admin_projects') || '[]');
    const row = list.find(p => p.id === 'qa-identity-a');
    return row ? row.status : null;
  });
  check(
    'S7 the launcher registry is mirrored so the card agrees',
    mirror === 'planning',
    String(mirror)
  );

  // ---- B. manual sync and the Close snapshot row --------------------------
  const autoRow = await a.evaluate(() => {
    window.MMGR.Render.renderDirtyIndicator();
    const row = document.getElementById('bk-snapshot');
    return row ? row.hidden : null;
  });
  check('S8 in auto mode the Close snapshot row is hidden', autoRow === true, String(autoRow));

  const manualRow = await a.evaluate(() => {
    window.MMGR.Cloud.setSyncMode('manual');
    window.MMGR.Render.renderDirtyIndicator();
    const row = document.getElementById('bk-snapshot');
    return {
      hidden: row ? row.hidden : null,
      hint: (document.getElementById('bk-snapshot-hint') || {}).textContent || '',
      mode: window.MMGR.Cloud.getSyncMode()
    };
  });
  check(
    'S9 manual mode reveals Close snapshot with the manual copy',
    manualRow.hidden === false &&
      manualRow.mode === 'manual' &&
      /Manual/i.test(manualRow.hint),
    JSON.stringify(manualRow)
  );

  const backToAuto = await a.evaluate(() => {
    window.MMGR.Cloud.setSyncMode('auto');
    window.MMGR.Render.renderDirtyIndicator();
    return document.getElementById('bk-snapshot').hidden;
  });
  check('S10 switching back to auto hides the row again', backToAuto === true, String(backToAuto));

  await A.ctx.close();

  // ---- C. a taken id is suffixed, the name never changes ------------------
  const posts = [];
  const C = await newPage(browser, 'qa-identity-c', async page => {
    await page.route('**/api/cloud/projects', async route => {
      const req = route.request();
      if (req.method() !== 'POST') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, projects: [] })
        });
      }
      const body = JSON.parse(req.postData() || '{}');
      posts.push(body);
      if (body.projectId === 'qa-identity-c') {
        return route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, code: 'id_taken', error: 'that project id is taken' })
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          projectId: body.projectId,
          ownerCode: 'AAAA-BBBB-CCCC-DDDD',
          linked: false,
          status: 'active',
          syncMode: 'auto'
        })
      });
    });
  });
  const c = C.page;
  await c.evaluate(() => window.MMGR.Cloud.createProject());
  await c.waitForTimeout(600);
  check(
    'S11 a taken id is retried with -2 (two create attempts)',
    posts.length === 2,
    JSON.stringify(posts.map(p => p.projectId))
  );
  check(
    'S12 the retry keeps the project NAME unchanged',
    posts.length === 2 && posts[0].name === posts[1].name && posts[1].projectId === 'qa-identity-c-2',
    JSON.stringify(posts)
  );
  const stored = await c.evaluate(() => ({
    cloudId: localStorage.getItem('mmgr_cloud_id_qa-identity-c'),
    code: localStorage.getItem('mmgr_cloud_code_qa-identity-c-2'),
    staleCode: localStorage.getItem('mmgr_cloud_code_qa-identity-c')
  }));
  check(
    'S13 the winning id and its owner code are stored under that id',
    stored.cloudId === 'qa-identity-c-2' &&
      stored.code === 'AAAA-BBBB-CCCC-DDDD' &&
      !stored.staleCode,
    JSON.stringify(stored)
  );
  await C.ctx.close();

  // ---- D. already_linked is NEVER suffixed --------------------------------
  const dPosts = [];
  const D = await newPage(browser, 'qa-identity-d', async page => {
    await page.route('**/api/cloud/projects', async route => {
      const req = route.request();
      if (req.method() !== 'POST') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, projects: [] })
        });
      }
      dPosts.push(JSON.parse(req.postData() || '{}'));
      return route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, code: 'already_linked', error: 'project already linked' })
      });
    });
  });
  const d = D.page;
  await d.evaluate(() => window.MMGR.Cloud.createProject());
  await d.waitForTimeout(600);
  const dStored = await d.evaluate(() => ({
    override: localStorage.getItem('mmgr_cloud_id_qa-identity-d'),
    code: localStorage.getItem('mmgr_cloud_code_qa-identity-d')
  }));
  check(
    'S14 an id that is already mine is not suffixed (one attempt)',
    dPosts.length === 1 && dPosts[0].projectId === 'qa-identity-d',
    JSON.stringify(dPosts.map(p => p.projectId))
  );
  check(
    'S15 the reconnect path stores no suffix and no bogus code',
    !dStored.override && !dStored.code,
    JSON.stringify(dStored)
  );
  await D.ctx.close();

  const errs = A.errs.concat(C.errs, D.errs);
  check(
    'S16 no page errors during any arm',
    errs.length === 0,
    errs.slice(0, 2).join(' | ')
  );

  await browser.close();
  const passed = results.filter(r => r.ok).length;
  console.log('');
  console.log(
    'CLOUD IDENTITY ' +
      (passed === results.length ? 'PASS' : 'FAIL') +
      ' - ' +
      passed +
      '/' +
      results.length +
      ' gates'
  );
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => {
  console.error('ERROR ' + (e && e.message ? e.message : e));
  process.exit(1);
});
