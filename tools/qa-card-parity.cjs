#!/usr/bin/env node
/* tools/qa-card-parity.cjs - Wave 1 gate: one card language on the launcher
   ---------------------------------------------------------------------------
   The owner's rule (2026-11-10): a project card looks and opens the same way
   whether it is local, a demo, or a cloud project. That means one gold top
   band, one status dot + label, and the whole card as the open target - the
   cloud grid must not need a separate Load button.

   Every check measures the RENDERED app.html. The cloud list is served from a
   fixture through page.route(), so no Worker or D1 is needed.

   Usage:  node serve.cjs &          (separate shell)
           node tools/qa-card-parity.cjs
   Env:    QA_BASE (default http://127.0.0.1:8765), QA_CHANNEL (e.g. 'chrome')
   Needs:  playwright.                                                          */
'use strict';
const { chromium } = require('playwright');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:8765';
const GOLD = '212, 175, 55';
const results = [];

function check(id, label, cond, detail) {
  results.push({ id, label, ok: !!cond });
  console.log(
    (cond ? 'PASS  ' : 'FAIL  ') +
      id +
      '  ' +
      label +
      (detail !== undefined ? '   [' + detail + ']' : '')
  );
}

const CLOUD = [
  {
    projectId: 'parity-cloud-active',
    label: 'Cloud Active Project',
    updatedAt: '2026-11-08T10:00:00.000Z',
    createdAt: '2026-10-01T10:00:00.000Z',
    hasSnapshot: true,
    accessRole: 'owner',
    linkedName: 'Parity Owner',
    status: 'active'
  },
  {
    projectId: 'parity-cloud-planning',
    label: 'Cloud Planning Project',
    updatedAt: '2026-11-09T10:00:00.000Z',
    createdAt: '2026-10-02T10:00:00.000Z',
    hasSnapshot: true,
    accessRole: 'owner',
    linkedName: 'Parity Owner',
    status: 'planning'
  }
];

(async () => {
  const browser = await chromium.launch({
    channel: process.env.QA_CHANNEL || 'chrome',
    args: ['--disk-cache-size=0']
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));

  await page.addInitScript(() => {
    localStorage.setItem(
      'mmgr_admin_projects',
      JSON.stringify([
        {
          id: 'parity-local-1',
          title: 'Local Parity Project',
          description: 'A device project used by the card parity gate.',
          status: 'planning'
        }
      ])
    );
  });

  let loadHits = 0;
  await page.route('**/api/auth/me', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, email: 'parity@example.com' })
    })
  );
  await page.route('**/api/cloud/projects', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, projects: CLOUD })
    })
  );
  await page.route('**/api/cloud/projects/*/load', route => {
    loadHits += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, state: { projectName: 'Parity' } })
    });
  });

  await page.goto(BASE + '/app.html', { waitUntil: 'load' });
  await page.waitForTimeout(900);
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('mmgr:google-signed-in')));
  await page.waitForTimeout(1200);

  const probe = sel =>
    page.evaluate(s => {
      const el = document.querySelector(s);
      if (!el) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        cls: el.className,
        shadow: cs.boxShadow,
        status: el.querySelector('.pc-status')
          ? el.querySelector('.pc-status').textContent.trim()
          : null,
        dots: el.querySelectorAll('.pc-status .sdot').length,
        text: el.textContent.replace(/\s+/g, ' ').trim(),
        rect: {
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
          h: Math.round(r.height)
        }
      };
    }, sel);

  const band = s => !!s && /inset/.test(s.shadow) && s.shadow.indexOf(GOLD) > -1;

  // ---- local + demo ----
  const local = await probe('#grid .pcard');
  check('P-01', 'a local project card exists', !!local, local && local.text.slice(0, 40));
  check('P-01', 'the local card carries the gold top band', band(local), local && local.shadow);
  check(
    'P-02',
    'the local card carries a status dot and label',
    !!local && local.dots === 1 && !!local.status,
    local && local.status
  );

  const demo = await probe('#demo-grid .pcard');
  check('P-03', 'a demo project card exists', !!demo, demo && demo.text.slice(0, 40));
  check('P-03', 'the demo card carries the same top band', band(demo), demo && demo.shadow);
  check(
    'P-03',
    'the demo card carries the same status dot and label',
    !!demo && demo.dots === 1 && !!demo.status,
    demo && demo.status
  );

  // ---- cloud ----
  const cloud = await probe('#cloud-dash-list .cd-card');
  check(
    'P-04',
    'a cloud card renders from the account list',
    !!cloud,
    cloud && cloud.text.slice(0, 50)
  );
  check(
    'P-04',
    'the cloud card uses the shared .pcard surface',
    !!cloud && /\bpcard\b/.test(cloud.cls),
    cloud && cloud.cls
  );
  check(
    'P-04',
    'the cloud card carries the same gold top band',
    band(cloud),
    cloud && cloud.shadow
  );
  check(
    'P-05',
    'the cloud card carries a status dot and label',
    !!cloud && cloud.dots === 1 && !!cloud.status,
    cloud && cloud.status
  );
  check(
    'P-05',
    'the status comes from the project record (planning on the second card)',
    await page.evaluate(() => {
      const cards = document.querySelectorAll('#cloud-dash-list .cd-card');
      return (
        cards.length === 2 && /planning/i.test(cards[1].querySelector('.pc-status').textContent)
      );
    }),
    cloud && cloud.status
  );
  check(
    'P-06',
    'the cloud card has no Load control',
    await page.evaluate(() => {
      const card = document.querySelector('#cloud-dash-list .cd-card');
      if (!card) return false;
      if (card.querySelector('.btn[data-cd-load]')) return false;
      return !/\bLoad\b/.test(card.textContent);
    })
  );

  const hit = await page.evaluate(() => {
    const card = document.querySelector('#cloud-dash-list .cd-card');
    const h = card ? card.querySelector('.cd-hit') : null;
    if (!h) return null;
    const cr = card.getBoundingClientRect();
    const hr = h.getBoundingClientRect();
    return {
      tag: h.tagName,
      label: h.getAttribute('aria-label'),
      dw: Math.abs(cr.width - hr.width),
      dh: Math.abs(cr.height - hr.height),
      z: getComputedStyle(h).zIndex,
      menuZ: getComputedStyle(card.querySelector('.cd-menu')).zIndex
    };
  });
  check(
    'P-07',
    'the card exposes a real overlay button',
    !!hit && hit.tag === 'BUTTON',
    hit && hit.tag
  );
  check(
    'P-07',
    'the overlay covers the whole card (within 2px)',
    !!hit && hit.dw <= 2 && hit.dh <= 2,
    hit && hit.dw + 'x' + hit.dh
  );
  check('P-07', 'the overlay has an accessible name', !!hit && !!hit.label, hit && hit.label);
  check(
    'P-09',
    'the 3-dot menu sits above the overlay',
    !!hit && Number(hit.menuZ) > Number(hit.z),
    hit && hit.z + ' < ' + hit.menuZ
  );

  // Keyboard: the overlay is the focusable open target.
  const kb = await page.evaluate(() => {
    const h = document.querySelector('#cloud-dash-list .cd-card .cd-hit');
    if (!h) return null;
    h.focus();
    return document.activeElement === h;
  });
  check('P-10', 'the overlay takes keyboard focus', kb === true, kb);

  // Whole-card click opens the project: the overlay is clicked, the load
  // endpoint is called, and the browser navigates to the viewer.
  loadHits = 0;
  await page.locator('#cloud-dash-list .cd-card .cd-hit').first().click();
  await page.waitForTimeout(900);
  check('P-08', 'clicking the card body calls the load endpoint', loadHits === 1, loadHits);
  check(
    'P-08',
    'clicking the card body opens the project viewer',
    /project\.html\?id=parity-cloud-active/.test(page.url()),
    page.url().replace(BASE, '')
  );

  // The menu must not open the project.
  await page.goto(BASE + '/app.html', { waitUntil: 'load' });
  await page.waitForTimeout(900);
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('mmgr:google-signed-in')));
  await page.waitForTimeout(1200);
  loadHits = 0;
  await page.locator('#cloud-dash-list .cd-card .cd-menu').first().click();
  await page.waitForTimeout(600);
  const menuOpen = await page.evaluate(() => {
    const pop = document.querySelector('#cloud-dash-list .cd-menu-pop');
    return !!pop && !pop.hidden;
  });
  check('P-09', 'the 3-dot menu opens its popover', menuOpen, menuOpen);
  check(
    'P-09',
    'opening the menu does not open the project',
    loadHits === 0 && !/project\.html/.test(page.url()),
    loadHits
  );

  check('P-00', 'no uncaught page errors', errs.length === 0, errs.join(' | '));

  await ctx.close();

  /* ---- P-11/P-12: a project can be born in the cloud ----
     The launcher's New Project door lands on admin.html?new=1, the create
     modal offers "This device" or "Cloud", and choosing Cloud links the
     project and pushes its first snapshot inside the same save. */
  {
    const actx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const ap = await actx.newPage();
    const aerrs = [];
    ap.on('pageerror', e => aerrs.push(String(e)));
    const posts = [];
    await ap.route('**/api/cloud/projects', route => {
      if (route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() || '{}');
        posts.push(body);
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, projectId: body.projectId, ownerCode: 'ABCD1234' })
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, projects: [] })
      });
    });
    await ap.route('**/api/cloud/projects/*/save', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    );

    await ap.goto(BASE + '/admin.html?new=1', { waitUntil: 'load' });
    await ap.waitForTimeout(700);
    await ap.evaluate(() => {
      const s = document.getElementById('setup-screen');
      if (s && !s.classList.contains('hidden')) {
        document.getElementById('setup-pass1').value = 'TestPass123!';
        document.getElementById('setup-pass2').value = 'TestPass123!';
        s.querySelector('[data-action="adminSetupPassword"]').click();
      }
    });
    let opened = false;
    for (let i = 0; i < 30; i++) {
      opened = await ap.evaluate(() => {
        const om = document.getElementById('rc-om');
        if (om && om.classList.contains('show')) {
          const cb = document.getElementById('rc-saved-cb');
          if (cb && !cb.checked) {
            cb.checked = true;
            cb.dispatchEvent(new Event('change'));
          }
          const done = document.getElementById('rc-done');
          if (done && !done.disabled) done.click();
        }
        return document.getElementById('om').classList.contains('show');
      });
      if (opened) break;
      await ap.waitForTimeout(250);
    }
    check('P-11', 'the New Project door opens the create modal (?new=1)', opened, opened);
    check(
      'P-11',
      'the create modal offers This device or Cloud',
      await ap.evaluate(() => {
        const f = document.getElementById('pf-where-field');
        return (
          !!f &&
          !f.hidden &&
          !!document.getElementById('pf-where-device') &&
          !!document.getElementById('pf-where-cloud')
        );
      })
    );
    check(
      'P-11',
      'the URL flag is cleared after the modal opens',
      !/[?&]new=1/.test(new URL(ap.url()).search),
      new URL(ap.url()).search
    );

    await ap.fill('#pf-title', 'Cloud Born Project');
    await ap.click('[data-action="generateCodeIntoForm"]');
    await ap.evaluate(() => {
      window.MMGR = window.MMGR || {};
      window.MMGR.GoogleAuth = window.MMGR.GoogleAuth || {};
      window.MMGR.GoogleAuth.isSignedIn = () => true;
    });
    await ap.check('#pf-where-cloud');
    await ap.click('[data-action="saveProjectForm"]');
    await ap.waitForTimeout(1200);
    const born = await ap.evaluate(() => {
      const list = JSON.parse(localStorage.getItem('mmgr_admin_projects') || '[]');
      const p = list.find(x => x.title === 'Cloud Born Project');
      return p ? { id: p.id, cloudId: p.cloudId, code: p.cloudOwnerCode } : null;
    });
    check('P-12', 'the project is saved on this device first', !!born, born && born.id);
    check(
      'P-12',
      'choosing Cloud links it in the same save',
      !!born && !!born.cloudId,
      born && born.cloudId
    );
    check(
      'P-12',
      'the publish call carries the new project id',
      posts.length === 1 && posts[0].projectId === (born && born.id),
      JSON.stringify(posts)
    );

    const editHides = await ap.evaluate(() => {
      openProjectModal(0);
      const f = document.getElementById('pf-where-field');
      const hidden = !!f && f.hidden;
      closeProjectModal();
      return hidden;
    });
    check('P-12', 'editing an existing project never re-homes it', editHides, editHides);
    check('P-11', 'no uncaught admin page errors', aerrs.length === 0, aerrs.join(' | '));
    await actx.close();
  }
  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log(
    '\n' +
      (results.length - failed.length) +
      '/' +
      results.length +
      ' passed' +
      (failed.length ? '   FAILED: ' + [...new Set(failed.map(f => f.id))].join(', ') : '')
  );
  process.exit(failed.length ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(2);
});
