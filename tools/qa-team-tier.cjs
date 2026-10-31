#!/usr/bin/env node
/* ============================================================
   tools/qa-team-tier.cjs - the enterprise tier actually reaches the workspace
   ------------------------------------------------------------
   Owner report (audit 2026-10-31, finding 3): "the team panel does not appear
   with an enterprise plan". S7 is a DIAGNOSTIC sprint, so this gate measures
   the claim instead of assuming it. qa-team-ui and qa-team-enterprise were both
   green before this file existed, and both pass the tier in as a test fixture,
   so neither could see the bug: nothing ever asked the WORKSPACE what plan the
   account is on. `js/app/entitlements.js` starts at 'free' and only
   `/api/billing/status` moves it - and only the launcher and the sign-in path
   fetched that. On project.html the tier stayed 'free' for the whole session,
   so every enterprise control in the team panel was suppressed for a paying
   account.

   The contract, with the billing answer stubbed at the network layer:

     E1  an enterprise account's workspace knows its tier
         (Entitlements.tier() === 'enterprise', rbacEnterprise() === true)
     E2  the team panel is reachable (bell present, panel opens)
     E3  a collaborator row offers the enterprise tools: Access editor
     E4  the panel offers bulk invite and the access templates
     E5  a FREE account gets none of them (no leak, no dead control)
     E6  a contractor keeps rbacAccess but not the enterprise layer
     E7  zero page errors through the walk

   Usage:  node tools/qa-team-tier.cjs
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
    const h = await fetch(BASE + '/project.html');
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
      const h = await fetch(BASE + '/project.html');
      if (h.ok) {
        return srv;
      }
    } catch (e) {
      /* keep waiting */
    }
  }
  throw new Error('serve.cjs did not come up');
}

const MEMBER = {
  id: 'm1',
  inviteeEmail: 'site@example.test',
  role: 'editor',
  status: 'active',
  acceptedAt: '2026-10-01T00:00:00Z'
};

// One enterprise-tier plan answer; the walk below flips it.
function planBody(plan) {
  var paid = plan && plan !== 'free';
  return {
    ok: true,
    configured: true,
    active: paid,
    plan: plan || 'free',
    projectCount: 3,
    projectCap: paid ? null : 1
  };
}

async function openWorkspace(ctx, plan) {
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e && e.message)));
  await ctx.unroute('**/api/billing/status');
  await ctx.route('**/api/billing/status', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(planBody(plan))
    })
  );
  // Land on the launcher once to seed a locally-owned project, then open the
  // workspace the way the owner does.
  await page.goto(BASE + '/app.html', { waitUntil: 'load', timeout: 60000 });
  await page.evaluate(() => {
    localStorage.setItem(
      'mmgr_admin_projects',
      JSON.stringify([
        {
          id: 'qa-tier',
          title: 'QA Tier',
          description: '',
          status: 'active',
          file: 'project.html?id=qa-tier',
          code: 'QATIER1',
          codeHash: 'x'
        }
      ])
    );
    localStorage.setItem('mmgr_unlocked_qa-tier', '1');
    localStorage.setItem('mmgr_scope_qa-tier', 'full');
  });
  await page.goto(BASE + '/project.html?id=qa-tier', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.MMGR && window.MMGR.TeamUI, null, { timeout: 60000 });
  // The identity (and with it the plan) must arrive with the session restore,
  // not after the 10s GIS fallback poll (the S7 defect: a paying account read
  // as 'free' until the Google script gave up). 6s is a generous ceiling for
  // one cookie fetch. The E1/E5/E6 assertions then read the tier itself, so a
  // slow restore still fails this gate rather than being waited out forever.
  await page
    .waitForFunction(
      () =>
        window.MMGR &&
        window.MMGR.GoogleAuth &&
        window.MMGR.GoogleAuth.getUser &&
        window.MMGR.GoogleAuth.getUser(),
      null,
      { timeout: 6000 }
    )
    .catch(() => {});
  await delay(700);
  return page;
}

const errors = [];

(async () => {
  const srv = await ensureServer();
  const { chromium } = require('playwright');
  const browser = await chromium.launch({
    headless: true,
    executablePath: require('./chrome-launcher.cjs').chromePath,
    args: ['--disk-cache-size=0', '--no-sandbox']
  });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });

  // The Worker API, stubbed: this gate is about the CLIENT honouring the tier
  // the server reports, not about billing.
  await ctx.route('**/api/**', async route => {
    const u = route.request().url();
    const json = (o, s) =>
      route.fulfill({
        status: s || 200,
        contentType: 'application/json',
        body: JSON.stringify(o)
      });
    // The shape the client actually reads: auth restore needs `user`, and the
    // launcher/workspace needs a project list before the collaborators tab
    // has anything to render. A stub that omits either makes this gate fail
    // for its own reasons (the first run of this file did exactly that).
    if (u.includes('/api/auth/me')) {
      return json({
        ok: true,
        signedIn: true,
        user: { email: 'owner@example.test', sub: 'qa-sub', name: 'QA Owner' }
      });
    }
    // The shape /api/cloud/projects really returns (src/cloud/projects.js):
    // projectId + label + accessRole. A row without projectId renders a People
    // button with no target, which is how the first run of this gate failed.
    if (/\/api\/cloud\/projects(\?|$)/.test(u)) {
      return json({
        ok: true,
        projects: [{ projectId: 'p1', label: 'QA Project', accessRole: 'owner', hasSnapshot: true }]
      });
    }
    if (u.includes('/api/team/memberships')) {
      return json({ ok: true, memberships: [] });
    }
    if (u.includes('/api/team/invitations')) {
      return json({ ok: true, invitations: [] });
    }
    if (u.includes('/api/cloud/sections')) {
      return json({ ok: true, sections: [] });
    }
    if (u.includes('/team/templates')) {
      return json({ ok: true, templates: [] });
    }
    if (u.includes('/team/audit')) {
      return json({ ok: true, events: [] });
    }
    if (/\/api\/cloud\/projects\/[^/]+\/(team|meta)(\?|$)/.test(u)) {
      return json({ ok: true, members: [MEMBER] });
    }
    if (/\/team(\?|$)/.test(u)) {
      return json({ ok: true, members: [MEMBER] });
    }
    return json({ ok: true });
  });

  // The panel's enterprise surface, read off the DOM. The Collaborators tab is
  // a project PICKER first: each owned project row has a "People" button, and
  // the per-member rows (and their enterprise controls) only exist inside that
  // project's #team-people container once it is opened.
  const PROJ = 'p1';
  const PANEL = proj => {
    const pop = document.getElementById('team-pop');
    const list = document.getElementById('team-col-list');
    const people = document.getElementById('team-people-' + proj);
    return {
      text: (list ? list.innerText : '') + '\n--people--\n' + (people ? people.innerText : ''),
      opened: !!(people && !people.hidden),
      access: !!(pop && pop.querySelector('[data-team-access]')),
      extend: !!(pop && pop.querySelector('[data-team-extend]')),
      bulk: !!(pop && pop.querySelector('[data-team-bulk]')),
      tpl: !!(pop && pop.querySelector('[data-team-tpls], [data-team-tpl-apply]'))
    };
  };

  async function openCollaborators(page) {
    if (!(await page.isVisible('#team-pop'))) {
      await page.click('[data-team-bell]');
      await delay(600);
    }
    await page.click('[data-team-tab="collaborators"]');
    await delay(1200);
    const people = '[data-team-people="' + PROJ + '"]';
    if (await page.isVisible(people)) {
      await page.click(people);
      await delay(1200);
    }
    return page.evaluate(PANEL, PROJ);
  }

  try {
    // ---- E1-E4: an enterprise account -----------------------------------
    let page = await openWorkspace(ctx, 'enterprise');
    const ent = await page.evaluate(() => ({
      tier: window.MMGR.Entitlements ? window.MMGR.Entitlements.tier() : null,
      rbac: window.MMGR.Entitlements ? window.MMGR.Entitlements.rbacEnterprise() : null,
      access: window.MMGR.Entitlements ? window.MMGR.Entitlements.rbacAccess() : null
    }));
    check(
      'E1 the workspace adopts the enterprise tier the server reports',
      ent.tier === 'enterprise' && ent.rbac === true && ent.access === true,
      ent
    );

    const bell = await page.evaluate(() => {
      const b = document.querySelector('[data-team-bell]');
      return b ? { present: true, hidden: b.hidden } : { present: false };
    });
    check(
      'E2 the team panel is reachable on an enterprise account',
      bell.present && !bell.hidden,
      bell
    );

    const ePanel = await openCollaborators(page);
    check(
      "E2b the panel opens the project's People list",
      ePanel.opened && /site@example\.test/.test(ePanel.text),
      ePanel
    );
    check(
      'E3 an enterprise account gets the per-member Access editor',
      ePanel.access === true,
      ePanel
    );
    check(
      'E4 an enterprise account gets bulk invite and templates',
      ePanel.bulk && ePanel.tpl,
      ePanel
    );

    await page.close();

    // ---- E5: a free account gets none of it ------------------------------
    page = await openWorkspace(ctx, 'free');
    const free = await page.evaluate(() => ({
      tier: window.MMGR.Entitlements.tier(),
      rbac: window.MMGR.Entitlements.rbacEnterprise()
    }));
    const fPanel = await openCollaborators(page);
    check(
      'E5 a free account is told free and is offered no enterprise tool',
      free.tier === 'free' &&
        free.rbac === false &&
        !fPanel.access &&
        !fPanel.extend &&
        !fPanel.bulk,
      { free: free, panel: fPanel }
    );
    await page.close();

    // ---- E6: contractor is a middle rung --------------------------------
    page = await openWorkspace(ctx, 'contractor');
    const con = await page.evaluate(() => ({
      tier: window.MMGR.Entitlements.tier(),
      rbac: window.MMGR.Entitlements.rbacAccess(),
      ent: window.MMGR.Entitlements.rbacEnterprise()
    }));
    check(
      'E6 contractor keeps team access but not the enterprise layer',
      con.tier === 'contractor' && con.rbac === true && con.ent === false,
      con
    );
    await page.close();

    check('E7 zero page errors through the walk', errors.length === 0, errors.slice(0, 4));
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
