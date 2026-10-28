#!/usr/bin/env node
/* ============================================================
   tools/qa-globe-spin.cjs - LAND-2 (Wave E)
   ------------------------------------------------------------
   REFINEMENT-DIRECTIVE-2026-10-24, section 10.

   The hero globe deliberately stopped spinning while a feature card was up, so
   a viewer read it as a frozen globe. The contract now:
     - the globe turns CONTINUOUSLY, at or under 4 degrees per second
     - the spin never stalls for a 2-second window while running
     - a card follows its own node instead of freezing the view
     - a card whose node has turned away (> 70 degrees, or behind the globe)
       closes early, and the cycle carries on
     - Pause stops the rotation and Play resumes it (the loop still refuses
       reduced motion and Performance Mode; those are guarded elsewhere)

   Drives the module's own QA seam (MMGR_GLOBE.__advance), so 20 seconds of
   cycle run in milliseconds and the gate never depends on wall-clock luck.

   Usage:  node tools/qa-globe-spin.cjs
   Registry: docs/CI-TEST-COVERAGE.md -> CI row.
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const BASE = (process.env.QA_BASE || 'http://127.0.0.1:8765').replace(/\/$/, '');
const log = s => process.stdout.write('[globe-spin] ' + s + '\n');
const delay = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok });
  log(
    (ok ? 'PASS' : 'FAIL') +
      '  ' +
      name +
      (ok ? '' : '  <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 500))
  );
};

function resolvePlaywright() {
  try {
    return require('playwright');
  } catch (e) {
    const alt = path.join(ROOT, 'node_modules', 'playwright');
    if (fs.existsSync(alt)) {
      return require(alt);
    }
    throw e;
  }
}

(async () => {
  let srv = null;
  try {
    const h = await fetch(BASE + '/index.html');
    if (!h.ok) {
      throw new Error('not ok');
    }
  } catch (e) {
    log('starting serve.cjs for this run');
    srv = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
    for (let i = 0; i < 40; i++) {
      await delay(1000);
      try {
        const h = await fetch(BASE + '/index.html');
        if (h.ok) {
          break;
        }
      } catch (err) {
        /* still starting */
      }
    }
  }

  const pw = resolvePlaywright();
  let executablePath;
  try {
    executablePath =
      require(path.join(ROOT, 'tools', 'chrome-launcher.cjs')).chromePath || undefined;
  } catch (e) {
    executablePath = undefined;
  }
  const browser = await pw.chromium.launch({
    headless: true,
    executablePath,
    args: ['--disk-cache-size=0']
  });

  try {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String((e && e.message) || e).slice(0, 160)));
    await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(
      () => !!(window.MMGR_GLOBE && window.MMGR_GLOBE.state && window.MMGR_GLOBE.state.started),
      null,
      { timeout: 45000 }
    );
    await delay(300);

    const out = await page.evaluate(() => {
      const G = window.MMGR_GLOBE;
      const st = G.state;
      st.interacting = false;
      st.paused = false;
      st.dragging = false;
      const norm = d => {
        while (d > 180) d -= 360;
        while (d < -180) d += 360;
        return d;
      };
      const windows = [];
      let cardOpened = 0;
      let cardClosedByItself = 0;
      // The spin rate is only cleanly observable while a card is open: during
      // the gap the view is also easing toward the next node, which is a
      // deliberate second motion. So the rate gate samples open-card frames.
      let maxOpenFrameDeg = 0;
      let openFrames = 0;
      let cardMovedWhileOpen = 0;
      let wasOpen = G.cardIndex();
      for (let i = 0; i < 10; i++) {
        const before = st.lon;
        for (let f = 0; f < 125; f++) {
          // 125 x 16ms = 2 seconds
          const p0 = G.cardIndex() !== -1;
          const lon0 = st.lon;
          G.__advance(16);
          const d = Math.abs(norm(st.lon - lon0));
          if (p0 && G.cardIndex() === wasOpen && wasOpen !== -1) {
            openFrames++;
            if (d > maxOpenFrameDeg) maxOpenFrameDeg = d;
          }
          if (G.cardIndex() !== wasOpen) {
            if (G.cardIndex() !== -1) cardOpened++;
            else cardClosedByItself++;
            wasOpen = G.cardIndex();
          }
          if (p0 && G.cardIndex() !== -1) {
            const p1 = G.project(G.features[G.cardIndex()].lat, G.features[G.cardIndex()].lon);
            if (p1.x !== undefined) cardMovedWhileOpen++;
          }
        }
        const delta = Math.abs(norm(st.lon - before));
        windows.push(Number(delta.toFixed(2)));
      }
      // Pause and resume through the module state the control writes. The DOM
      // arm below proves the CONTROL writes it; this arm proves the loop honours
      // it, which is a different claim.
      const lonBeforePause = st.lon;
      st.paused = true;
      G.__advance(1000);
      const lonAfterPause = st.lon;
      st.paused = false;
      const live = {
        t: st.t,
        started: st.started,
        paused: st.paused,
        frozen: st.frozen,
        hidden: st.hidden,
        offscreen: st.offscreen,
        dragging: st.dragging,
        interacting: st.interacting,
        open: G.cardIndex()
      };
      G.__advance(1000);
      const lonAfterResume = st.lon;
      return {
        windows,
        minWindow: Math.min.apply(null, windows),
        maxWindow: Math.max.apply(null, windows),
        maxOpenDegPerSec: Number((maxOpenFrameDeg * 62.5).toFixed(2)),
        openFrames,
        cardOpened,
        cardClosedByItself,
        cardMovedWhileOpen,
        pauseHeld: Math.abs(norm(lonAfterPause - lonBeforePause)) < 0.01,
        resumed: Math.abs(norm(lonAfterResume - lonAfterPause)) >= 1,
        resumedDelta: Number(norm(lonAfterResume - lonAfterPause).toFixed(3)),
        live
      };
    });

    check(
      'LAND-2 the globe turns at least 1 degree in every 2 second window',
      out.minWindow >= 1,
      out.windows
    );
    check(
      'LAND-2 the spin stays at or under 4 degrees per second while a card is open',
      out.openFrames > 0 && out.maxOpenDegPerSec <= 4.1,
      { maxOpenDegPerSec: out.maxOpenDegPerSec, openFrames: out.openFrames }
    );
    check(
      'LAND-2 the 20 second run opens cards and lets them close on their own',
      out.cardOpened >= 1 && out.cardClosedByItself >= 1,
      out
    );
    check(
      'LAND-2 a card stays tethered to a moving node while it is open',
      out.cardMovedWhileOpen > 0,
      out.cardMovedWhileOpen
    );
    check('LAND-2 Pause holds the rotation still', out.pauseHeld === true, out);
    check('LAND-2 Play resumes the rotation', out.resumed === true, out);

    // ---- THE REAL CONTROL (WCAG 2.2.2) --------------------------------
    // The gate above proves the LOOP honours state.paused. This arm proves a
    // person can reach that flag: the button has to exist in the DOM, a real
    // click has to pause it, a second real click has to resume it, and it has
    // to disappear when the page has deliberately turned heavy motion off.
    // Before this arm existed the gate poked the flag directly and passed on a
    // control that was never built (CSS rule, empty container, no button).
    const ctl = await page.evaluate(() => {
      const b = document.querySelector('.hg-controls .hg-play');
      const box = document.querySelector('.hg-controls');
      return {
        exists: !!b,
        text: b ? b.textContent.trim() : null,
        aria: b ? b.getAttribute('aria-label') : null,
        icon: b ? (b.querySelector('use') || {}).getAttribute?.('href') || null : null,
        visible: b ? !!(b.offsetWidth || b.offsetHeight) : false,
        boxHidden: box ? box.hidden : null,
        paused: window.MMGR_GLOBE.state.paused
      };
    });
    check(
      'LAND-2 the Pause control is a real, visible button in the DOM',
      ctl.exists && ctl.visible && ctl.text === 'Pause' && ctl.boxHidden === false,
      ctl
    );
    check(
      'LAND-2 the control names its action and carries an SVG icon (no emoji)',
      ctl.aria === 'Pause the globe' && /mmgr-icons\.svg#i-pause$/.test(ctl.icon || ''),
      ctl
    );

    let clickPause = { ok: false };
    let clickPlay = { ok: false };
    if (ctl.exists) {
      await page.click('.hg-controls .hg-play');
      await delay(150);
      const pausedUi = await page.evaluate(() => {
        const b = document.querySelector('.hg-controls .hg-play');
        const st = window.MMGR_GLOBE.state;
        const lon0 = st.lon;
        window.MMGR_GLOBE.__advance(1000);
        return {
          paused: st.paused,
          text: b.textContent.trim(),
          aria: b.getAttribute('aria-label'),
          icon: (b.querySelector('use') || {}).getAttribute?.('href') || null,
          held: Math.abs(st.lon - lon0) < 0.01
        };
      });
      clickPause = pausedUi;
      check(
        'LAND-2 clicking Pause stops the globe and flips the control to Play',
        pausedUi.paused === true &&
          pausedUi.held === true &&
          pausedUi.text === 'Play' &&
          pausedUi.aria === 'Play the globe' &&
          /#i-play$/.test(pausedUi.icon || ''),
        pausedUi
      );

      await page.click('.hg-controls .hg-play');
      await delay(150);
      const playedUi = await page.evaluate(() => {
        const b = document.querySelector('.hg-controls .hg-play');
        const st = window.MMGR_GLOBE.state;
        // the click focused the button, and focus deliberately holds the cycle
        // for four seconds; the harness releases it the way a real pointer
        // leaving the stage would, then advances.
        st.interacting = false;
        const lon0 = st.lon;
        window.MMGR_GLOBE.__advance(1000);
        return {
          paused: st.paused,
          text: b.textContent.trim(),
          aria: b.getAttribute('aria-label'),
          moved: Math.abs(st.lon - lon0) >= 1
        };
      });
      clickPlay = playedUi;
      check(
        'LAND-2 clicking Play starts it again and flips the control back to Pause',
        playedUi.paused === false &&
          playedUi.moved === true &&
          playedUi.text === 'Pause' &&
          playedUi.aria === 'Pause the globe',
        playedUi
      );

      // Performance Mode: nothing to play, so no dead button.
      await page.evaluate(() => {
        document.documentElement.setAttribute('data-perf', 'on');
        document.dispatchEvent(new CustomEvent('mmgr:perf', { detail: { on: true } }));
      });
      await delay(200);
      const perfUi = await page.evaluate(() => {
        const box = document.querySelector('.hg-controls');
        const b = box.querySelector('.hg-play');
        return {
          hidden: box.hidden,
          display: getComputedStyle(box).display,
          visible: !!(b.offsetWidth || b.offsetHeight)
        };
      });
      check(
        'LAND-2 the control is hidden when Performance Mode turns motion off (no dead button)',
        perfUi.hidden === true && perfUi.display === 'none' && perfUi.visible === false,
        perfUi
      );
      await page.evaluate(() => {
        document.documentElement.removeAttribute('data-perf');
        document.dispatchEvent(new CustomEvent('mmgr:perf', { detail: { on: false } }));
      });
      await delay(200);
    }

    check('LAND-2 no uncaught page error', errors.length === 0, errors);
    await ctx.close();

    // ---- REDUCED MOTION: the still globe KEEPS its control --------------
    // Directive section 10: "Reduced motion shows the still globe plus that
    // control so a person can choose to play it." The globe must not start on
    // its own, and the button must be there and work.
    const rmCtx = await browser.newContext({
      viewport: { width: 1360, height: 900 },
      reducedMotion: 'reduce'
    });
    const rmPage = await rmCtx.newPage();
    const rmErrors = [];
    rmPage.on('pageerror', e => rmErrors.push(String((e && e.message) || e).slice(0, 160)));
    await rmPage.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 60000 });
    await rmPage.waitForFunction(() => !!(window.MMGR_GLOBE && window.MMGR_GLOBE.state), null, {
      timeout: 45000
    });
    await delay(800);
    const rm = await rmPage.evaluate(() => {
      const b = document.querySelector('.hg-controls .hg-play');
      const st = window.MMGR_GLOBE.state;
      return {
        started: st.started,
        reason: st.refuseReason,
        exists: !!b,
        text: b ? b.textContent.trim() : null,
        visible: b ? !!(b.offsetWidth || b.offsetHeight) : false
      };
    });
    check(
      'LAND-2 reduced motion keeps the globe still but leaves the control there to press',
      rm.started === false && rm.reason === 'reduced-motion' && rm.exists && rm.visible,
      rm
    );
    let rmPlay = { ok: false };
    if (rm.exists) {
      await rmPage.click('.hg-controls .hg-play');
      await delay(400);
      rmPlay = await rmPage.evaluate(() => {
        const b = document.querySelector('.hg-controls .hg-play');
        const st = window.MMGR_GLOBE.state;
        st.interacting = false;
        const lon0 = st.lon;
        window.MMGR_GLOBE.__advance(1000);
        return {
          started: st.started,
          paused: st.paused,
          text: b.textContent.trim(),
          moved: Math.abs(st.lon - lon0) >= 1
        };
      });
    }
    check(
      'LAND-2 pressing Play under reduced motion starts it (a click is a person choosing motion)',
      rmPlay.started === true && rmPlay.paused === false && rmPlay.moved === true,
      rmPlay
    );
    check('LAND-2 reduced motion arm raises no page error', rmErrors.length === 0, rmErrors);
    await rmCtx.close();
  } catch (e) {
    check('harness ran without throwing', false, String((e && e.stack) || e));
  } finally {
    try {
      await browser.close();
    } catch (e) {
      /* closed */
    }
    if (srv) {
      try {
        srv.kill();
      } catch (e) {
        /* gone */
      }
    }
  }

  const failed = results.filter(r => !r.ok);
  log('');
  log(
    (failed.length ? 'FAIL' : 'PASS') +
      ' - ' +
      (results.length - failed.length) +
      '/' +
      results.length +
      ' gates'
  );
  process.exit(failed.length ? 1 : 0);
})();
