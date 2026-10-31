#!/usr/bin/env node
/* ============================================================
   tools/qa-ai-float.cjs - the assistant's float and pin, gated
   ------------------------------------------------------------
   Owner report (audit 2026-10-31, finding 4): "float does not work and the
   pin icon does not show a state change". NOTHING in this repo covered
   `.float-mode`: qa-appshell mentions the word in a comment and qa-ai-win /
   qa-ai-window-layout never touch it. A control nobody measures is a control
   that can break for months while every gate stays green, so this harness
   exists first and the fix (if any) follows what it proves.

   The contract, all on the unlocked workspace:

     F1  the Float control exists in the assistant's More menu and carries
         its name (word + aria-label)
     F2  clicking it floats the window: `.float-mode` lands, the window
         leaves the dock column, is fully inside the viewport, and is sized
         around the documented 66vw x 80vh
     F3  dragging the header moves the window and it stays inside the
         viewport, even when dragged past an edge
     F4  a press that starts on a header BUTTON does not drag the window
     F5  pressing Float again docks it: the class goes, the window returns
         to its docked geometry and the layout regime is restored
     F6  the Pin row reports its state honestly: aria-pressed AND
         aria-checked flip, the label changes, and the state survives a
         reload
     F7  Escape still closes a floating window (the D-1 regression guard)
     F8  zero page errors through the whole walk

   Usage:  node tools/qa-ai-float.cjs
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

// The More menu is a toggle: clicking its button while it is open CLOSES it,
// which hides the rows. Every step that needs a row goes through this.
async function openMenu(page) {
  if (await page.isVisible('#ai-more-menu')) {
    return;
  }
  await page.click('#ai-more-btn');
  await page.waitForSelector('#ai-more-menu', { state: 'visible', timeout: 5000 });
}
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

const WIN = () => {
  const el = document.getElementById('ai-win');
  if (!el) {
    return null;
  }
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return {
    open: el.classList.contains('open'),
    float: el.classList.contains('float-mode'),
    x: Math.round(r.left),
    y: Math.round(r.top),
    w: Math.round(r.width),
    h: Math.round(r.height),
    position: cs.position,
    styleLeft: el.style.left,
    styleTop: el.style.top,
    styleRight: el.style.right
  };
};

const PIN = () => {
  const btn = document.getElementById('ai-pin-btn');
  if (!btn) {
    return null;
  }
  return {
    pressed: btn.getAttribute('aria-pressed'),
    checked: btn.getAttribute('aria-checked'),
    label: btn.getAttribute('aria-label'),
    text: btn.textContent.trim()
  };
};

(async () => {
  const srv = await ensureServer();
  const { chromium } = require('playwright');
  const browser = await chromium.launch({
    headless: true,
    executablePath: require('./chrome-launcher.cjs').chromePath,
    args: ['--disk-cache-size=0', '--no-sandbox']
  });

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String((e && e.message) || e).slice(0, 200)));

  try {
    // The assistant is part of the signed-in experience (same QA seam
    // qa-fixed-containment and qa-ai-win install).
    await page.addInitScript(() => {
      let tries = 0;
      const iv = setInterval(() => {
        if (window.MMGR && window.MMGR.Entitlements) {
          window.MMGR.Entitlements.aiAssistant = function () {
            return true;
          };
          clearInterval(iv);
        }
        if (++tries > 400) {
          clearInterval(iv);
        }
      }, 25);
      // Page-side readers for the composite probes below: a Playwright
      // evaluate serialises ONE function, so a Node-side helper is not in the
      // page's scope (that is what threw "WIN is not defined" on the first
      // run of this gate).
      window.__qaWin = function () {
        const el = document.getElementById('ai-win');
        if (!el) {
          return null;
        }
        const r = el.getBoundingClientRect();
        return {
          open: el.classList.contains('open'),
          float: el.classList.contains('float-mode'),
          x: Math.round(r.left),
          y: Math.round(r.top),
          w: Math.round(r.width),
          h: Math.round(r.height),
          position: getComputedStyle(el).position,
          styleLeft: el.style.left,
          styleTop: el.style.top
        };
      };
    });
    await page.goto(BASE + '/seed-test.html', { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.MMGR && window.MMGR.AiWin, null, { timeout: 60000 });
    await page.evaluate(() => {
      try {
        localStorage.removeItem('mmgr_ai_float_ai-win');
        localStorage.removeItem('mmgr_ai_float_drw');
      } catch (e) {
        /* storage is a preference */
      }
    });
    await page.evaluate(() => window.MMGR.AiWin.open());
    await delay(900);

    // ---- F1: the control exists in the More menu -------------------------
    await openMenu(page);
    await delay(350);
    const ctl = await page.evaluate(() => {
      const b = document.querySelector('#ai-more-menu [data-float-toggle="ai-win"]');
      const menu = document.getElementById('ai-more-menu');
      return b
        ? {
            present: true,
            text: b.textContent.trim(),
            aria: b.getAttribute('aria-label'),
            inMenu: !!menu && menu.contains(b),
            visible: !!(b.offsetWidth || b.offsetHeight)
          }
        : { present: false };
    });
    check(
      'F1 the Float control is a visible row in the More menu and carries its name',
      ctl.present && ctl.inMenu && ctl.visible && /Float/.test(ctl.text) && !!ctl.aria,
      ctl
    );

    const docked = await page.evaluate(WIN);
    check(
      'F2a the window starts docked, not floating',
      docked && docked.open && docked.float === false,
      docked
    );

    // ---- F2: floating ----------------------------------------------------
    await page.click('#ai-more-menu [data-float-toggle="ai-win"]');
    await delay(700);
    const floated = await page.evaluate(() => {
      const w = window.__qaWin();
      return {
        win: w,
        viewport: { w: window.innerWidth, h: window.innerHeight },
        body: document.body.classList.contains('ai-float-open'),
        insideViewport:
          w.x >= 0 && w.y >= 0 && w.x + w.w <= window.innerWidth && w.y + w.h <= window.innerHeight,
        expectW: Math.round(window.innerWidth * 0.66),
        expectH: Math.round(window.innerHeight * 0.8)
      };
    });
    check(
      'F2b float-mode lands and the window leaves its dock geometry',
      floated.win.float === true &&
        floated.win.position === 'fixed' &&
        (floated.win.x !== docked.x || floated.win.w !== docked.w),
      floated
    );
    check(
      'F2c the floating window is fully inside the viewport at its designed size',
      floated.insideViewport === true &&
        Math.abs(floated.win.w - floated.expectW) <= 40 &&
        Math.abs(floated.win.h - floated.expectH) <= 40,
      floated
    );

    // ---- F3: drag the header --------------------------------------------
    const before = await page.evaluate(WIN);
    const head = await page.locator('#ai-win .ai-head').first().boundingBox();
    await page.mouse.move(
      head.x + Math.round(head.width / 2),
      head.y + Math.round(head.height / 2)
    );
    await page.mouse.down();
    await page.mouse.move(
      head.x + Math.round(head.width / 2) + 120,
      head.y + Math.round(head.height / 2) + 90,
      { steps: 8 }
    );
    await page.mouse.up();
    await delay(400);
    const moved = await page.evaluate(WIN);
    check(
      'F3a dragging the header moves the floating window',
      moved && Math.abs(moved.x - before.x) > 60 && Math.abs(moved.y - before.y) > 40,
      { before: before, after: moved }
    );

    // Drag far past the corner: the clamp must keep it on screen.
    const head2 = await page.locator('#ai-win .ai-head').first().boundingBox();
    await page.mouse.move(head2.x + 40, head2.y + 10);
    await page.mouse.down();
    await page.mouse.move(head2.x + 500, head2.y + 300, { steps: 6 });
    await page.mouse.up();
    await delay(400);
    const clamped = await page.evaluate(() => {
      const w = window.__qaWin();
      return {
        win: w,
        // The documented rule: x is fully inside, and y stops at
        // innerHeight - 48 so the header stays reachable (the body may sit
        // below the fold by design). Anything outside those bounds is a
        // window the owner cannot get back.
        onScreen:
          w.x >= 0 && w.x + w.w <= window.innerWidth && w.y >= 0 && w.y <= window.innerHeight - 48
      };
    });
    check(
      'F3b a drag past the edge keeps the window header and full width on screen',
      clamped.onScreen === true,
      clamped
    );

    // ---- F4: a press that starts on a header button does not drag --------
    const beforeBtn = await page.evaluate(WIN);
    const btnBox = await page.locator('#ai-win .ai-icon-btn').first().boundingBox();
    await page.mouse.move(
      btnBox.x + Math.round(btnBox.width / 2),
      btnBox.y + Math.round(btnBox.height / 2)
    );
    await page.mouse.down();
    await page.mouse.move(btnBox.x + 140, btnBox.y + 120, { steps: 5 });
    await page.mouse.up();
    await delay(400);
    const afterBtn = await page.evaluate(WIN);
    check(
      'F4 a press on a header button never drags the window',
      afterBtn && afterBtn.x === beforeBtn.x && afterBtn.y === beforeBtn.y,
      { before: beforeBtn, after: afterBtn }
    );

    // ---- F6: the pin reports its state honestly --------------------------
    await openMenu(page);
    await delay(300);
    const pin0 = await page.evaluate(PIN);
    await page.click('#ai-pin-btn');
    await delay(400);
    const pin1 = await page.evaluate(PIN);
    check(
      'F6a the Pin row flips both aria states and its spoken label',
      pin0 &&
        pin1 &&
        pin0.pressed === 'false' &&
        pin1.pressed === 'true' &&
        pin1.checked === 'true' &&
        pin1.label !== pin0.label,
      { before: pin0, after: pin1 }
    );

    await page.reload({ waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.MMGR && window.MMGR.AiWin, null, { timeout: 60000 });
    await delay(800);
    await page.evaluate(() => window.MMGR.AiWin.open());
    await delay(700);
    await page.click('#ai-more-btn');
    await delay(300);
    const pin2 = await page.evaluate(PIN);
    check(
      'F6b the pin state survives a reload',
      pin2 && pin2.pressed === 'true' && pin2.checked === 'true',
      pin2
    );

    // ---- F5: dock it again ----------------------------------------------
    // After the reload the window is docked, so float it first, then press
    // the same row a second time and prove it returns.
    const preF5 = await page.evaluate(() => window.__qaWin());
    if (!preF5.float) {
      if (!(await page.isVisible('#ai-more-menu'))) {
        await page.click('#ai-more-btn');
        await delay(250);
      }
      await page.click('#ai-more-menu [data-float-toggle="ai-win"]');
      await delay(600);
    }
    if (!(await page.isVisible('#ai-more-menu'))) {
      await page.click('#ai-more-btn');
      await delay(250);
    }
    await page.click('#ai-more-menu [data-float-toggle="ai-win"]');
    await delay(700);
    const redocked = await page.evaluate(() => {
      const w = window.__qaWin();
      return { win: w, floatPosSaved: !!localStorage.getItem('mmgr_ai_float_ai-win') };
    });
    check(
      'F5 pressing Float again docks the window and clears its float geometry',
      redocked.win.float === false &&
        redocked.win.styleLeft === '' &&
        redocked.floatPosSaved === false,
      redocked
    );

    // ---- F7: Escape still closes a floating window -----------------------
    await openMenu(page);
    await delay(250);
    await page.click('#ai-more-menu [data-float-toggle="ai-win"]');
    await delay(600);
    // D-1: the More menu is an inner layer and Escape closes IT first, so
    // dismiss the menu before testing the window's own Escape.
    await page.mouse.click(8, 8);
    await delay(250);
    await page.keyboard.press('Escape');
    await delay(500);
    const closed = await page.evaluate(() => {
      const el = document.getElementById('ai-win');
      return {
        open: el && el.classList.contains('open'),
        float: el && el.classList.contains('float-mode')
      };
    });
    check(
      'F7 Escape closes the assistant while it floats',
      closed.open === false && closed.float === false,
      closed
    );

    check('F8 zero page errors through the float walk', errors.length === 0, errors.slice(0, 4));
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
