#!/usr/bin/env node
/* ============================================================
   tools/qa-plan-badge.cjs - the plan control is really on screen
   ------------------------------------------------------------
   Owner report (2026-11-16, third time): a screenshot of the open launcher
   rail showed OVERVIEW..CUSTOMIZE, then the account row "tester / Sign out" -
   and no Upgrade button anywhere. The markup, the CSS and the script were all
   present, so every static gate was green: nothing measured whether the
   control is VISIBLE to the person looking at the page.

   This gate drives the launcher in a real browser and measures what a person
   sees, with the billing answer stubbed at the network layer (the client
   contract is what failed, not the billing route):

     P1  a free signed-in account sees "Upgrade to Premium", in the viewport,
         inside the rail footer, directly above the account row, text unclipped
         - at 390 / 768 / 1280 / 1920
     P2  the badge is the upgrade path: one click lands on pricing.html
     P3  a signed-out visitor sees no badge (the control needs a session)
     P4  an expired cookie (server says 403, the rail still shows the stored
         profile) keeps the free badge - a visible name must never sit above a
         blank where the upgrade button belongs
     P5  a stale cached page (no plan mount in the DOM at all) is self-healing:
         the script builds the mount instead of depending on the HTML version
     P6  zero page errors through the walk

   Usage:  node tools/qa-plan-badge.cjs
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

/* What the stubbed Worker answers. The rail identity and the billing answer
   are set independently, which is exactly how an expired cookie looks to the
   page: the stored profile renders, the server refuses the session. */
const stub = { signedIn: true, billing: 'free' };

async function newContext(browser, width, height) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    colorScheme: 'light',
    serviceWorkers: 'block'
  });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem(
        'mmgr_consent',
        JSON.stringify({ v: 1, iv: 3, analytics: false, ts: new Date().toISOString() })
      );
    } catch (e) {}
  });
  await ctx.route('**/api/**', route => {
    const u = route.request().url();
    const json = (o, s) =>
      route.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.includes('/api/billing/status')) {
      if (stub.billing === '403') {
        return json({ ok: false, error: 'unauthorized' }, 403);
      }
      if (stub.billing === 'active') {
        return json({
          ok: true,
          configured: true,
          plan: 'premium',
          active: true,
          currentPeriodEnd: '2026-12-31T00:00:00.000Z'
        });
      }
      return json({ ok: true, configured: false, plan: 'free', active: false });
    }
    if (u.includes('/api/auth/me')) {
      if (!stub.signedIn) {
        return json({ ok: false, signedIn: false }, 401);
      }
      return json({
        ok: true,
        signedIn: true,
        user: { email: 'owner@example.test', sub: 'qa-sub', name: 'tester' }
      });
    }
    if (u.includes('/api/cloud/projects')) {
      return json({ ok: true, projects: [] });
    }
    if (u.includes('/api/cloud/sections')) {
      return json({ ok: true, sections: [] });
    }
    if (u.includes('/api/team/')) {
      return json({ ok: true, members: [], invitations: [], memberships: [] });
    }
    return json({ ok: true });
  });
  return ctx;
}

/* Measure the control as rendered: geometry, layering and text fit. */
const MEASURE = () => {
  const badge = document.getElementById('plan-badge');
  const foot = document.querySelector('.db-foot');
  const user = document.getElementById('rail-user');
  if (!badge) {
    return { exists: false };
  }
  const r = badge.getBoundingClientRect();
  const cs = getComputedStyle(badge);
  const txt = document.getElementById('plan-badge-text');
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const top = cx > 0 && cy > 0 ? document.elementFromPoint(cx, cy) : null;
  const fr = foot ? foot.getBoundingClientRect() : null;
  const ur = user ? user.getBoundingClientRect() : null;
  return {
    exists: true,
    hiddenAttr: badge.hasAttribute('hidden'),
    display: cs.display,
    visibility: cs.visibility,
    text: txt ? txt.textContent : null,
    label: badge.getAttribute('aria-label'),
    textFits: txt ? txt.scrollWidth <= txt.clientWidth + 1 : false,
    rect: {
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height)
    },
    inViewport:
      r.top >= 0 && r.bottom <= innerHeight + 1 && r.left >= 0 && r.right <= innerWidth + 1,
    insideFoot: !!(fr && r.top >= fr.top - 1 && r.bottom <= fr.bottom + 1),
    aboveAccount: !!(ur && r.bottom <= ur.top + 1),
    covered: !(top === badge || (top && badge.contains(top)))
  };
};

/* Open the rail the way a person does at this width: the hamburger opens the
   drawer on a phone, and a fine-pointer desktop slides the panel in when the
   pointer enters the closed icon strip (I-14, owner 2026-11-07). */
async function openRail(page, w) {
  if (w >= 769) {
    await page.hover('#sidebar-icons .sidebar-icon', { timeout: 5000 }).catch(() => {});
  } else {
    await page.click('#db-nav-btn', { timeout: 5000 }).catch(() => {});
  }
  await delay(600);
}

async function openApp(ctx, w, { open = true } = {}) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + '/app.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 30000 });
  await delay(1200);
  if (open) {
    await openRail(page, w);
  }
  page.__errors = errors;
  return page;
}

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

    // ---- P1: a free signed-in account sees the control, at every width ----
    stub.signedIn = true;
    stub.billing = 'free';
    const widths = [390, 768, 1280, 1920];
    let first = null;
    for (const w of widths) {
      const ctx = await newContext(browser, w, Math.max(720, Math.round(w * 0.62)));
      const page = await openApp(ctx, w);
      const m = await page.evaluate(MEASURE);
      if (w === widths[0]) {
        first = m;
      }
      check('P1a ' + w + 'px: the plan badge exists in the rail footer', m.exists === true, m);
      check(
        'P1b ' + w + 'px: it renders as a visible pill, not a hidden element',
        m.exists && !m.hiddenAttr && m.display === 'flex' && m.visibility === 'visible',
        m
      );
      check(
        'P1c ' + w + 'px: it is inside the viewport',
        m.exists && m.inViewport === true,
        m.rect
      );
      check(
        'P1d ' + w + 'px: it sits inside the footer, above the account row',
        m.exists && m.insideFoot === true && m.aboveAccount === true,
        { rect: m.rect, insideFoot: m.insideFoot, aboveAccount: m.aboveAccount }
      );
      check('P1e ' + w + 'px: nothing covers it', m.exists && m.covered === false, m);
      check('P1f ' + w + 'px: the label is unclipped', m.exists && m.textFits === true, m);
      await ctx.close();
    }
    check(
      'P1g a free account reads "Upgrade to Premium" with a named action',
      first && first.text === 'Upgrade to Premium' && /Upgrade to Premium/i.test(first.label || ''),
      first && { text: first.text, label: first.label }
    );

    // ---- P2: the badge IS the upgrade path ----
    {
      const ctx = await newContext(browser, 1280, 900);
      const page = await openApp(ctx, 1280);
      await page.click('#plan-badge');
      const landed = await page
        .waitForURL(/pricing(\.html)?(\?|#|$)/, { timeout: 8000 })
        .then(() => true)
        .catch(() => false);
      check('P2 one click on the badge opens the pricing page', landed, page.url());
      await ctx.close();
    }

    // ---- P3: a signed-out visitor has nothing to manage ----
    {
      stub.signedIn = false;
      stub.billing = '403';
      const ctx = await newContext(browser, 1280, 900);
      const page = await openApp(ctx, 1280);
      const m = await page.evaluate(MEASURE);
      check(
        'P3 a signed-out visitor sees no plan badge (no dead control)',
        m.exists === false || m.hiddenAttr === true || m.display === 'none',
        m
      );
      await ctx.close();
    }

    // ---- P4: expired cookie - server 403, rail still shows the profile ----
    {
      stub.signedIn = true;
      stub.billing = '403';
      const ctx = await newContext(browser, 1280, 900);
      const page = await openApp(ctx, 1280);
      const m = await page.evaluate(MEASURE);
      const railName = await page.evaluate(() => {
        const u = document.getElementById('rail-user');
        return u ? u.innerText.replace(/\s+/g, ' ').trim() : '';
      });
      check(
        'P4a the rail still shows the stored profile in this state',
        /tester/i.test(railName),
        railName
      );
      check(
        'P4b an expired cookie keeps the free badge visible under a visible name',
        m.exists === true && !m.hiddenAttr && m.display === 'flex' && m.inViewport === true,
        m
      );
      await ctx.close();
    }

    // ---- P5: a stale cached page (no mount at all) is self-healing ----
    {
      stub.signedIn = true;
      stub.billing = 'free';
      const ctx = await newContext(browser, 1280, 900);
      const page = await openApp(ctx, 1280);
      const before = await page.evaluate(() => {
        const w = document.getElementById('plan-wrap');
        if (w) {
          w.remove();
        }
        return !!document.getElementById('plan-badge');
      });
      await page.evaluate(() => {
        document.dispatchEvent(new CustomEvent('mmgr:google-signed-in', { detail: {} }));
      });
      await delay(800);
      const m = await page.evaluate(MEASURE);
      check('P5a the stale-page fixture really removed the mount', before === false);
      check(
        'P5b the plan script rebuilds the mount and shows the badge',
        m.exists === true && !m.hiddenAttr && m.display === 'flex',
        m
      );
      check(
        'P5c the rebuilt badge is still above the account row',
        m.exists && m.aboveAccount === true,
        m
      );
      check(
        'P5d zero page errors through the walk',
        page.__errors.length === 0,
        page.__errors.slice(0, 3)
      );
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
  console.log('PLAN-BADGE GATE GREEN');
})();
