/* ============================================================
   tools/qa-scrub-controls.cjs - ScrubNumber and SmartTime
   ------------------------------------------------------------
   Gates for js/app/scrub-number.js (2026-11-19):
     S1  click vs scrub: a sub-dead-zone click never changes a value,
         and typing still works.
     S2  drag physics: a horizontal drag moves by whole steps inside
         the bounds, and the deferred commit fires change exactly once
         on pointerup, never during pointermove.
     S3  Escape cancels an active drag and restores the initial value.
     S4  preset chips set a value and commit; SmartTime Now picks the
         current quarter hour.
     S5  focus survives the commit, and the popover is a viewport-safe
         body portal, never clipped inside a panel.
     S6  ARIA: spinbutton value attributes and one polite live region.

   Usage:   node tools/qa-scrub-controls.cjs
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
const log = s => process.stdout.write('[qa-scrub] ' + s + '\n');
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
        JSON.stringify(detail === undefined ? null : detail).slice(0, 1200)
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

const FIXTURE = `(function () {
  var old = document.getElementById('scrub-fixture');
  if (old) { old.parentNode.removeChild(old); }
  var box = document.createElement('div');
  box.id = 'scrub-fixture';
  box.setAttribute('data-qa', 'scrub-fixture');
  box.innerHTML =
    '<input type="number" id="q-scrub" value="2" data-scrub="hours" data-scrub-step="0.25" data-scrub-min="0" data-scrub-max="24" data-scrub-presets="4,8,+0.5,clear">' +
    '<input type="text" id="q-time" value="09:00" data-smart-time="clock" data-time-pair="#q-time-end">' +
    '<input type="text" id="q-time-end" value="10:00" data-smart-time="clock">' +
    '<input type="date" id="q-date" data-smart-date>';
  box.style.cssText =
    'position:fixed;left:24px;top:120px;z-index:9999;display:flex;gap:8px;' +
    'align-items:center;background:#ffffff;color:#111111;padding:10px;' +
    'border:1px solid #888888;border-radius:8px;';
  Array.prototype.forEach.call(box.querySelectorAll('input'), function (el) {
    el.style.cssText = 'width:90px;height:32px;font-size:14px;';
  });
  document.body.appendChild(box);
  window.__scrubChanges = 0;
  window.__scrubInputs = 0;
  document.getElementById('q-scrub').addEventListener('change', function () { window.__scrubChanges++; });
  document.getElementById('q-scrub').addEventListener('input', function () { window.__scrubInputs++; });
  return true;
})()`;

async function center(page, sel) {
  const box = await page.locator(sel).boundingBox();
  if (!box) {
    throw new Error('no box for ' + sel);
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

async function drag(page, sel, dx, opts) {
  const c = await center(page, sel);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(c.x + (dx * i) / steps, c.y, { steps: 1 });
    await delay(opts && opts.slow ? 22 : 4);
  }
  return c;
}

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
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(
      "try { localStorage.setItem('mmgr_unlocked_demo-project','1'); } catch (e) {}"
    );
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE + '/project.html?id=demo-project', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => !!(window.MMGR && window.MMGR.Scrub && window.MMGR.App),
      null,
      {
        timeout: 15000
      }
    );
    await delay(600);
    await page.evaluate(FIXTURE);
    await delay(150);

    // S0: the shipped meeting planning aid and the engine are present.
    const shipped = await page.evaluate(() => ({
      engine: !!(window.MMGR && window.MMGR.Scrub),
      clock: document.querySelectorAll('[data-smart-time]').length,
      live: !!document.getElementById('scrub-live-region')
    }));
    check('S0 engine booted and live region created', shipped.engine && shipped.live, shipped);
    check('S0 shipped clock planning aid present', shipped.clock >= 2, shipped);

    // S1: a sub-dead-zone click does not scrub, typing still works.
    await page.evaluate(() => {
      window.__scrubChanges = 0;
    });
    const c1 = await center(page, '#q-scrub');
    await page.mouse.move(c1.x, c1.y);
    await page.mouse.down();
    await page.mouse.move(c1.x + 3, c1.y, { steps: 1 });
    await page.mouse.up();
    await delay(120);
    const afterClick = await page.inputValue('#q-scrub');
    check('S1 a 3px click leaves the value alone', afterClick === '2', { afterClick });
    await page.click('#q-scrub', { clickCount: 3 });
    await page.keyboard.type('6.75');
    await page.keyboard.press('Enter');
    await delay(150);
    const typed = await page.inputValue('#q-scrub');
    check('S1 typing 6.75 commits 6.75', typed === '6.75', { typed });

    // S2: drag moves by whole steps and commits once on pointerup.
    await page.evaluate(() => {
      var el = document.getElementById('q-scrub');
      el.value = '2';
      window.__scrubChanges = 0;
      window.__scrubInputs = 0;
    });
    await drag(page, '#q-scrub', 80, { slow: true });
    const midChanges = await page.evaluate(() => window.__scrubChanges);
    await page.mouse.up();
    await delay(180);
    const afterDrag = await page.evaluate(() => ({
      value: document.getElementById('q-scrub').value,
      changes: window.__scrubChanges,
      inputs: window.__scrubInputs,
      scrubbing: document.body.classList.contains('is-scrubbing')
    }));
    const v = parseFloat(afterDrag.value);
    check('S2 drag changed the value upward', v > 2, afterDrag);
    check(
      'S2 drag landed on a 0.25 step',
      Math.abs(v / 0.25 - Math.round(v / 0.25)) < 1e-9,
      afterDrag
    );
    check('S2 value stays inside 0 to 24', v >= 0 && v <= 24, afterDrag);
    check('S2 no change event during pointermove', midChanges === 0, { midChanges });
    check('S2 exactly one change event on pointerup', afterDrag.changes === 1, afterDrag);
    check('S2 live input fired during the drag', afterDrag.inputs > 0, afterDrag);
    check('S2 scrub classes removed on release', !afterDrag.scrubbing, afterDrag);

    // S3: Escape during a drag restores the initial value.
    await page.evaluate(() => {
      var el = document.getElementById('q-scrub');
      el.value = '3';
      window.__scrubChanges = 0;
    });
    await drag(page, '#q-scrub', 100, { slow: true });
    await page.keyboard.press('Escape');
    await delay(60);
    await page.mouse.up();
    await delay(150);
    const afterEsc = await page.evaluate(() => ({
      value: document.getElementById('q-scrub').value,
      changes: window.__scrubChanges
    }));
    check('S3 Escape restores the initial value', afterEsc.value === '3', afterEsc);
    check('S3 Escape suppresses the commit', afterEsc.changes === 0, afterEsc);

    // S4: preset chip commits, and SmartTime Now picks the quarter hour.
    await page.evaluate(() => {
      document.getElementById('q-scrub').value = '2';
      window.__scrubChanges = 0;
      if (document.activeElement && document.activeElement.blur) {
        document.activeElement.blur();
      }
    });
    await page.click('#q-scrub');
    await delay(120);
    const chips = await page.locator('.scrub-pop .scrub-chip').allTextContents();
    const eight = page.locator('.scrub-pop .scrub-chip', { hasText: '8h' }).first();
    let eightOk = false;
    if ((await eight.count()) > 0) {
      await eight.click();
      await delay(150);
      eightOk = (await page.inputValue('#q-scrub')) === '8';
    }
    const eightChanges = await page.evaluate(() => window.__scrubChanges);
    check('S4 hours popover offers 4h, 8h, +0.5h and Clear', chips.length === 4, { chips });
    check('S4 the 8h chip sets 8', eightOk, { chips });
    check('S4 the 8h chip commits once', eightChanges === 1, { eightChanges });

    await page.click('#q-time');
    await delay(120);
    const nowChip = page.locator('.scrub-pop .scrub-chip', { hasText: 'Now' }).first();
    let nowOk = false;
    let expected = '';
    if ((await nowChip.count()) > 0) {
      expected = await page.evaluate(() => {
        var d = new Date();
        var m = Math.round((d.getHours() * 60 + d.getMinutes()) / 15) * 15;
        m = ((m % 1440) + 1440) % 1440;
        return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
      });
      await nowChip.click();
      await delay(150);
      const got = await page.inputValue('#q-time');
      const toMin = s => parseInt(s.slice(0, 2), 10) * 60 + parseInt(s.slice(3), 10);
      nowOk = Math.abs(toMin(got) - toMin(expected)) <= 15;
    }
    check('S4 SmartTime Now picks the current quarter hour', nowOk, { expected });

    // S4b: a scrubbed start time shifts the linked end time by the same
    // amount, so the planned duration is preserved.
    await page.evaluate(() => {
      document.getElementById('q-time').value = '09:00';
      document.getElementById('q-time-end').value = '10:00';
    });
    await drag(page, '#q-time', 48, { slow: true });
    await page.mouse.up();
    await delay(180);
    const linked = await page.evaluate(() => {
      function toMin(s) {
        return parseInt(s.slice(0, 2), 10) * 60 + parseInt(s.slice(3), 10);
      }
      var a = document.getElementById('q-time').value;
      var b = document.getElementById('q-time-end').value;
      return { start: a, end: b, gap: toMin(b) - toMin(a) };
    });
    check('S4b scrubbing the start moved the start', linked.start !== '09:00', linked);
    check('S4b linked end time preserves the one hour gap', linked.gap === 60, linked);

    // S5: focus survives a commit and the popover is a body portal.
    await page.click('#q-scrub');
    await delay(120);
    const popInfo = await page.evaluate(() => {
      var p = document.querySelector('.scrub-pop');
      if (!p) {
        return { present: false };
      }
      var r = p.getBoundingClientRect();
      return {
        present: true,
        parentIsBody: p.parentNode === document.body,
        fixed: getComputedStyle(p).position === 'fixed',
        inPanel: !!p.closest('.panel'),
        inside:
          r.left >= 0 &&
          r.top >= 0 &&
          r.right <= window.innerWidth + 1 &&
          r.bottom <= window.innerHeight + 1
      };
    });
    check('S5 popover is a body portal', popInfo.present && popInfo.parentIsBody, popInfo);
    check('S5 popover is fixed and viewport clamped', popInfo.fixed && popInfo.inside, popInfo);
    check('S5 popover is not nested in a panel', popInfo.inPanel === false, popInfo);
    const chip4 = page.locator('.scrub-pop .scrub-chip', { hasText: '4h' }).first();
    if ((await chip4.count()) > 0) {
      await chip4.click();
      await delay(120);
    }
    const focusOk = await page.evaluate(
      () => document.activeElement && document.activeElement.id === 'q-scrub'
    );
    check('S5 focus stays on the field after a preset commit', focusOk, {});

    // S6: ARIA attributes and one polite live region.
    const aria = await page.evaluate(() => {
      var el = document.getElementById('q-scrub');
      var live = document.getElementById('scrub-live-region');
      return {
        role: el.getAttribute('role') || 'native',
        now: el.getAttribute('aria-valuenow'),
        min: el.getAttribute('aria-valuemin'),
        max: el.getAttribute('aria-valuemax'),
        text: el.getAttribute('aria-valuetext'),
        liveCount: document.querySelectorAll('#scrub-live-region').length,
        polite: live ? live.getAttribute('aria-live') : ''
      };
    });
    check('S6 value bounds are exposed', aria.min === '0' && aria.max === '24', aria);
    check('S6 aria-valuenow follows the value', aria.now === '4', aria);
    check('S6 one polite live region', aria.liveCount === 1 && aria.polite === 'polite', aria);

    check('S7 no page errors', errors.length === 0, errors.slice(0, 3));

    await ctx.close();
    log(passed + ' passed, ' + failed + ' failed');
    if (srv) {
      srv.kill();
    }
    process.exit(failed === 0 ? 0 : 1);
  } catch (e) {
    if (srv) {
      srv.kill();
    }
    if (browser) {
      await browser.close().catch(() => {});
    }
    log('HARNESS ERROR: ' + (e && e.message));
    process.exit(1);
  }
})();
