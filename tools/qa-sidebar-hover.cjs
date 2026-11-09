// T-SIDEBAR-HOVER gate (Wave I, I-14 hover-open launcher rail).
//   - hovering an icon opens the rail as an OVERLAY within 200 ms
//   - moving between icons keeps it open (no flicker)
//   - leaving the rail closes it
//   - keyboard focus opens it, Escape closes it
//   - the in-panel hamburger dismisses a hover-only rail instead of pinning it
//   - the page does not move (no layout shift) while the overlay is open
//   - touch / phone keeps today's tap-only drawer
//   - Performance Mode keeps the behaviour and drops the transition
// Runs against the shared QA server (:8765 by default, MMGR_BASE to override).

const { chromium } = require('playwright');

const BASE = process.env.MMGR_BASE || 'http://127.0.0.1:8765';
const URL = BASE + '/app.html';

let pass = 0;
let fail = 0;
const fails = [];
function ok(n) {
  pass++;
  console.log('  PASS', n);
}
function bad(n, d) {
  fail++;
  fails.push(n + ': ' + d);
  console.log('  FAIL', n, '-', d);
}

const launchOpts = {
  headless: true,
  ...(function () {
    try {
      const cp = require('./chrome-launcher.cjs').chromePath;
      return cp ? { executablePath: cp } : {};
    } catch (e) {
      return {};
    }
  })()
};

// addInitScript serialises the function source - closure variables do NOT
// survive, so the perf flag must travel as the call argument.
function seed(perf) {
  try {
    localStorage.setItem('mmgr_theme', 'dark');
    localStorage.setItem('mmgr_rail_nudge', '1');
    localStorage.setItem('mmgr_perf_mode', perf ? 'on' : 'off');
    localStorage.setItem(
      'mmgr_consent',
      JSON.stringify({ v: 1, iv: 3, analytics: false, ts: new Date().toISOString() })
    );
  } catch (e) {}
}

async function openRail(page) {
  return page.evaluate(() => document.body.classList.contains('rail-hover-open'));
}
async function panelRect(page) {
  return page.evaluate(() => {
    const s = document.getElementById('db-sidebar');
    if (!s) return null;
    const r = s.getBoundingClientRect();
    return { left: r.left, right: r.right, width: r.width };
  });
}
async function wrapLeft(page) {
  return page.evaluate(() => {
    const w = document.querySelector('.wrap');
    return w ? Math.round(w.getBoundingClientRect().left) : null;
  });
}
async function stripBox(page, index) {
  const icons = page.locator('#sidebar-icons .sidebar-icon');
  return icons.nth(index).boundingBox();
}

(async () => {
  const browser = await chromium.launch(launchOpts);

  // ---------- desktop: hover / keyboard / no layout shift ----------
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(seed, false);
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(400);

  // The closed strip is the hover affordance and must be on screen.
  const stripVisible = await page.evaluate(() => {
    const s = document.getElementById('sidebar-icons');
    if (!s) return false;
    const cs = getComputedStyle(s);
    return cs.visibility === 'visible' && parseFloat(cs.opacity) > 0.5;
  });
  if (stripVisible) ok('strip-visible-closed');
  else bad('strip-visible-closed', 'icon strip is not visible while the rail is closed');

  const before = await wrapLeft(page);
  const box = await stripBox(page, 0);
  if (!box) {
    bad('icon-box', 'first strip icon has no box');
  } else {
    const t0 = Date.now();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    let opened = false;
    try {
      await page.waitForFunction(() => document.body.classList.contains('rail-hover-open'), null, {
        timeout: 2000,
        polling: 16
      });
      opened = true;
    } catch (e) {}
    const elapsed = Date.now() - t0;
    if (opened && elapsed <= 200) ok('hover-opens-under-200ms');
    else if (opened) bad('hover-opens-under-200ms', 'opened after ' + elapsed + ' ms');
    else bad('hover-opens-under-200ms', 'rail never opened on hover');

    await page.waitForTimeout(320); // let the slide settle
    const pr = await panelRect(page);
    if (pr && Math.abs(pr.left) <= 1 && pr.width > 200) ok('overlay-visible');
    else bad('overlay-visible', JSON.stringify(pr));

    const after = await wrapLeft(page);
    if (after === before) ok('no-layout-shift');
    else bad('no-layout-shift', 'wrap left ' + before + ' -> ' + after);

    const pinned = await page.evaluate(() => document.body.classList.contains('side-open'));
    if (!pinned) ok('hover-not-pinned');
    else bad('hover-not-pinned', 'hover set body.side-open (content would shift)');

    // Moving between icons keeps it open - with real intermediate steps so the
    // pointer crosses the gaps between the tiles.
    const box2 = await stripBox(page, 4);
    if (!box2) {
      bad('move-between-icons', 'fifth strip icon has no box');
    } else {
      await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2, { steps: 12 });
      await page.waitForTimeout(260); // longer than the 150 ms close delay
      const still = await openRail(page);
      if (still) ok('move-between-icons');
      else bad('move-between-icons', 'rail closed while the pointer stayed on the strip');
    }

    // Leaving closes it.
    await page.mouse.move(700, 320, { steps: 8 });
    await page.waitForTimeout(400);
    const closed = await openRail(page);
    if (!closed) ok('leave-closes');
    else bad('leave-closes', 'rail stayed open after the pointer left');

    // Keyboard focus opens it.
    await page.evaluate(() => {
      const b = document.querySelector('#sidebar-icons .sidebar-icon');
      if (b) b.focus();
    });
    await page.waitForTimeout(80);
    if (await openRail(page)) ok('focus-opens');
    else bad('focus-opens', 'focusing a strip icon did not open the rail');

    // Escape closes it.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(80);
    if (!(await openRail(page))) ok('escape-closes');
    else bad('escape-closes', 'Escape left the rail open');

    // The in-panel hamburger dismisses a hover-only rail (never pins it).
    // Open from the first icon and wait for the class, then invoke the control
    // directly: Playwright's actionability loop waits for the sliding panel to
    // settle, and the rail's 150 ms close timer can win that race on a slow
    // runner (the click then finds the panel off-canvas). The handler under
    // test is the same one a real click reaches.
    await page.mouse.move(700, 320);
    await page.waitForTimeout(250);
    const b3 = await stripBox(page, 0);
    await page.mouse.move(b3.x + b3.width / 2, b3.y + b3.height / 2, { steps: 6 });
    let railUp = false;
    try {
      await page.waitForFunction(() => document.body.classList.contains('rail-hover-open'), null, {
        timeout: 2000,
        polling: 16
      });
      railUp = true;
    } catch (e) {}
    if (railUp) {
      await page.evaluate(() => {
        const btn = document.querySelector('#db-sidebar .db-side-close');
        if (btn) btn.click();
      });
      await page.waitForTimeout(300);
      const st = await page.evaluate(() => ({
        hover: document.body.classList.contains('rail-hover-open'),
        pin: document.body.classList.contains('side-open')
      }));
      const left = await wrapLeft(page);
      if (!st.hover && !st.pin && left === before) ok('panel-hamburger-dismisses');
      else bad('panel-hamburger-dismisses', JSON.stringify(st) + ' wrapLeft=' + left);
    } else {
      bad('panel-hamburger-dismisses', 'rail did not open before the click');
    }
  }
  await ctx.close();

  // ---------- touch: unchanged tap-only drawer ----------
  const tctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true
  });
  await tctx.addInitScript(seed, false);
  const tpage = await tctx.newPage();
  await tpage.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await tpage.waitForTimeout(400);
  const touch = await tpage.evaluate(() => {
    const s = document.getElementById('sidebar-icons');
    const side = document.getElementById('db-sidebar');
    return {
      stripDisplay: s ? getComputedStyle(s).display : null,
      stripVisible: s
        ? getComputedStyle(s).visibility === 'visible' &&
          parseFloat(getComputedStyle(s).opacity) > 0.1
        : false,
      hover: document.body.classList.contains('rail-hover-open'),
      pin: document.body.classList.contains('side-open'),
      panelRight: side ? side.getBoundingClientRect().right : null
    };
  });
  // On a phone the strip is not an affordance: it is either display:none or
  // fully hidden (visibility/opacity), never hoverable or tappable.
  if (touch.stripDisplay === 'none' || !touch.stripVisible) ok('touch-no-strip');
  else
    bad('touch-no-strip', 'strip display=' + touch.stripDisplay + ' visible=' + touch.stripVisible);
  if (!touch.hover) ok('touch-no-hover-open');
  else bad('touch-no-hover-open', 'rail-hover-open is set on a touch viewport');
  if (touch.panelRight !== null && touch.panelRight <= 1) ok('touch-drawer-closed');
  else bad('touch-drawer-closed', 'panel right=' + touch.panelRight);
  await tctx.close();

  // ---------- Performance Mode: behaviour kept, transition dropped ----------
  const pctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await pctx.addInitScript(seed, true);
  const ppage = await pctx.newPage();
  await ppage.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await ppage.waitForTimeout(400);
  const perfAttr = await ppage.evaluate(() => document.documentElement.getAttribute('data-perf'));
  if (perfAttr === 'on') ok('perf-attribute');
  else bad('perf-attribute', 'data-perf=' + perfAttr);
  const dur = await ppage.evaluate(() => {
    const s = document.getElementById('db-sidebar');
    return s ? getComputedStyle(s).transitionDuration : null;
  });
  if (dur === '0s') ok('perf-no-transition');
  else bad('perf-no-transition', 'transition-duration=' + dur);
  const pbox = await stripBox(ppage, 0);
  await ppage.mouse.move(pbox.x + pbox.width / 2, pbox.y + pbox.height / 2);
  await ppage.waitForTimeout(120);
  if (await openRail(ppage)) ok('perf-still-opens');
  else bad('perf-still-opens', 'hover did not open the rail in Performance Mode');
  await pctx.close();

  await browser.close();
  console.log('\nT-SIDEBAR-HOVER: ' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) {
    console.log('FAILURES:\n - ' + fails.join('\n - '));
    process.exit(1);
  }
  console.log('T-SIDEBAR-HOVER PASS');
})().catch(e => {
  console.error('T-SIDEBAR-HOVER harness error:', e);
  process.exit(2);
});
