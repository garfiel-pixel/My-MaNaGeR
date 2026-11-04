#!/usr/bin/env node
/* ============================================================
   tools/qa-first-project-tour.cjs - B8 FIRST-PROJECT WALKTHROUGH
   ------------------------------------------------------------
   Owner (audit 2026-11-01, B8): "a small tour on the first project opened
   or created: a summary of each section, then out", with the calculator's
   first-run guide as the reference.

   What this pins, in a real browser against serve.cjs:

     T0  the workspace boots (rail rendered, splash cleared)
     T1  the tour opens BY ITSELF on the first project
     T2  it walks the owner's eight sections IN ORDER, and every step's
         target is a real, visible control (overview, plan, collaborate,
         control panel, notifications, AI, calculator, methodologies)
     T3  it is keyboard operable: ArrowRight advances, ArrowLeft goes back
     T4  Escape closes it
     T5  storage records that it was shown (mmgr_first_project_tour_v1)
     T6  a second open is SILENT (never re-shown automatically)
     T7  it is still reachable later from the help surface
         (Settings > Features > Replay, data-action="startTour")
     T8  with reduced motion the CONTENT still shows - only the animation
         is dropped, never a step
     T9  zero uncaught page errors through the whole walk

   The step list is declared HERE as well as in the module on purpose: a
   module that quietly drops a section cannot pass by redefining itself.

   Usage:  node tools/qa-first-project-tour.cjs
   Registry: docs/CI-TEST-COVERAGE.md -> CI row (browser-calc).
   ============================================================ */
'use strict';
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8765);
const BASE = process.env.BASE || 'http://127.0.0.1:' + PORT;
const delay = ms => new Promise(r => setTimeout(r, ms));
const FLAG = 'mmgr_first_project_tour_v1';

// The owner's list, in the order the directive gives it.
const EXPECTED = [
  { title: 'Overview', sel: '.sec-btn[data-section="dash"]' },
  { title: 'Plan', sel: '.sec-btn[data-section="wbs"]' },
  { title: 'Collaborate', sel: '.sec-btn[data-section="stk"]' },
  { title: 'Control panel', sel: '[data-action="openDrw"]' },
  { title: 'Notifications', sel: '#ai-bell' },
  { title: 'AI assistant', sel: '#ai-fab' },
  { title: 'Calculator', sel: '.sec-btn[data-section="bud"]' },
  // The methodology SECTION button is hidden until the method pack is on, so
  // the tour points at the always-visible Waterfall/Agile/Hybrid switcher.
  { title: 'Methodologies', sel: '[data-action="swMeth"]' }
];

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
        (detail === undefined ? '' : '  <-- ' + JSON.stringify(detail).slice(0, 700))
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

// Boot completion, not namespace presence: App.init() renders the rail and
// clears #boot-splash, and a fixture/tour check before that races the boot
// (the qa-relations flake of 2026-11-03 was exactly this).
const BOOTED = () => {
  const sp = document.getElementById('boot-splash');
  return (
    /project\.html/.test(location.pathname + location.search) &&
    window.MMGR &&
    window.MMGR.App &&
    !!document.querySelector('#sec-nav .sec-btn') &&
    (!sp || sp.classList.contains('off'))
  );
};

const tourVisible = page =>
  page.evaluate(() => {
    const r = document.getElementById('tour-root');
    return !!r && getComputedStyle(r).display !== 'none';
  });

const tourState = page =>
  page.evaluate(() => {
    const g = id => {
      const el = document.getElementById(id);
      return el ? el.textContent.trim() : null;
    };
    return {
      count: g('tour-count'),
      title: g('tour-title'),
      text: g('tour-text'),
      next: g('tour-next'),
      flagged: (function () {
        try {
          return localStorage.getItem('mmgr_first_project_tour_v1') === '1';
        } catch (e) {
          return null;
        }
      })()
    };
  });

(async () => {
  const srv = await ensureServer();
  const pw = require('playwright');
  const executablePath = require('./chrome-launcher.cjs').chromePath || undefined;
  const browser = await pw.chromium.launch({ executablePath, headless: true });
  const errors = [];
  const watch = p =>
    p.on('pageerror', e => errors.push(String((e && e.message) || e).slice(0, 200)));

  // ---- session A: the first project, on a clean device ---------------------
  const ctxA = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const a = await ctxA.newPage();
  watch(a);
  await a.goto(BASE + '/seed-test.html', { waitUntil: 'load', timeout: 60000 });
  await a.waitForFunction(BOOTED, null, { timeout: 45000 });
  check('T0 the workspace boots (rail rendered, splash cleared)', true);

  // T1: it opens by itself.
  let opened = false;
  for (let i = 0; i < 40; i++) {
    if (await tourVisible(a)) {
      opened = true;
      break;
    }
    await a.waitForTimeout(150);
  }
  const first = await tourState(a);
  check('T1 the tour opens by itself on the first project', opened, first);
  check(
    'T1b the opening card names the project and offers the walk',
    /Step 1 of \d+/.test(first.count || '') && !!first.text,
    first
  );

  // T2: the walk covers the owner's eight sections, in order, with real targets.
  const steps = await a.evaluate(() =>
    window.MMGR.Tour && window.MMGR.Tour.steps ? window.MMGR.Tour.steps : null
  );
  const declared = Array.isArray(steps) ? steps : [];
  const missing = EXPECTED.filter(e => !declared.some(s => s.sel === e.sel && s.title === e.title));
  check(
    'T2 the walk declares every section the owner named, in order',
    declared.length > 0 &&
      missing.length === 0 &&
      // the eight appear in the directive's order relative to each other
      (function () {
        const pos = EXPECTED.map(e => declared.findIndex(s => s.sel === e.sel));
        return pos.every((p, i) => p > -1 && (i === 0 || p > pos[i - 1]));
      })(),
    { declared: declared.map(s => ({ t: s.title, s: s.sel })), missing }
  );

  // Walk every step with the keyboard and confirm the spotlight actually sits
  // on the control the step describes. Hit-testing is no good here (the tour's
  // own overlay is what elementFromPoint returns), so the ring's box is
  // compared with the declared target's box.
  const walk = [];
  for (let guard = 0; guard < 40; guard++) {
    if (!(await tourVisible(a))) {
      break;
    }
    // The spotlight is placed on the frame after the scroll lands, so wait
    // for the ring rather than reading a box that has not been set yet.
    for (let w = 0; w < 20; w++) {
      const placed = await a.evaluate(() => {
        const ring = document.getElementById('tour-ring');
        return !!ring && getComputedStyle(ring).display !== 'none' && ring.offsetWidth > 0;
      });
      if (placed) {
        break;
      }
      await a.waitForTimeout(100);
    }
    const live = await a.evaluate(() => {
      const steps = (window.MMGR.Tour && window.MMGR.Tour.steps) || [];
      const count = (document.getElementById('tour-count') || {}).textContent || '';
      const m = count.match(/Step (\d+) of/);
      const i = m ? Number(m[1]) - 1 : -1;
      const st = i >= 0 ? steps[i] : null;
      const ring = document.getElementById('tour-ring');
      const rr =
        ring && getComputedStyle(ring).display !== 'none' ? ring.getBoundingClientRect() : null;
      // The visible match, not querySelector's first hit: the workspace
      // renders each section button twice (compact rail + desktop rail) and
      // the first is hidden at this width. A step may name candidates.
      let tr = null;
      const sels = st && st.sel ? (Array.isArray(st.sel) ? st.sel : [st.sel]) : [];
      for (let s = 0; s < sels.length && !tr; s++) {
        const list = document.querySelectorAll(sels[s]);
        for (let k = 0; k < list.length; k++) {
          const r = list[k].getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            tr = r;
            break;
          }
        }
      }
      const overlap =
        rr && tr
          ? !(rr.right < tr.left || rr.left > tr.right || rr.bottom < tr.top || rr.top > tr.bottom)
          : false;
      return {
        i,
        title: (document.getElementById('tour-title') || {}).textContent || '',
        sel: st ? st.sel : null,
        centred: !st || !st.sel,
        overlap,
        sized: tr ? tr.width > 0 && tr.height > 0 : false,
        onScreen: tr ? tr.top >= -4 && tr.bottom <= window.innerHeight + 4 : false
      };
    });
    walk.push(live);
    // Last card: pressing Next finishes the tour, so do not press through it
    // here - T3 closes it deliberately.
    if (walk.length > 1 && !live.sel) {
      break;
    }
    await a.keyboard.press('ArrowRight');
    await a.waitForTimeout(250);
  }
  const seenTitles = walk.map(w => (EXPECTED.find(e => e.title === w.title) || {}).title);
  const covered = EXPECTED.filter(e => seenTitles.indexOf(e.title) > -1);
  check(
    'T2b walking the tour reaches all eight named sections in order',
    covered.length === EXPECTED.length &&
      walk
        .filter(w => EXPECTED.some(e => e.title === w.title))
        .every(
          (w, i, arr) =>
            i === 0 ||
            EXPECTED.findIndex(e => e.title === arr[i - 1].title) <
              EXPECTED.findIndex(e => e.title === w.title)
        ),
    { walk, covered: covered.map(c => c.title) }
  );
  check(
    'T2c every spotlight lands on its visible control (no orphaned step)',
    walk.length >= EXPECTED.length + 2 &&
      walk.filter(w => !w.centred).every(w => w.overlap && w.sized && w.onScreen),
    {
      walked: walk.length,
      bad: walk
        .filter(w => !w.centred && !(w.overlap && w.sized && w.onScreen))
        .map(w => ({
          t: w.title,
          sel: w.sel,
          overlap: w.overlap,
          sized: w.sized,
          onScreen: w.onScreen
        }))
    }
  );

  // T3: keyboard operable - the walk just advanced by keyboard; now prove
  // ArrowLeft goes back one step.
  const beforeBack = await tourState(a);
  await a.keyboard.press('ArrowLeft');
  await a.waitForTimeout(250);
  const afterBack = await tourState(a);
  check(
    'T3 the walk is keyboard operable (ArrowRight forward, ArrowLeft back)',
    !!afterBack.count && afterBack.count !== beforeBack.count,
    { beforeBack: beforeBack.count, afterBack: afterBack.count }
  );

  // T4/T5: Escape closes and storage records it.
  await a.keyboard.press('Escape');
  await a.waitForTimeout(250);
  const closed = !(await tourVisible(a));
  const afterEsc = await tourState(a);
  check('T4 Escape closes the tour', closed, { closed });
  check('T5 storage records that it was shown', afterEsc.flagged === true, {
    flag: afterEsc.flagged,
    key: FLAG
  });

  // T6: a second open is silent.
  await a.reload({ waitUntil: 'load', timeout: 60000 });
  await a.waitForFunction(BOOTED, null, { timeout: 45000 });
  await a.waitForTimeout(1500);
  const secondOpen = await tourVisible(a);
  check('T6 a second open is silent (never re-shown automatically)', secondOpen === false, {
    secondOpen
  });

  // T7: still reachable from the help surface.
  await a.evaluate(() => {
    const open = document.querySelector('[data-action="openDrw"]');
    if (open) {
      open.click();
    }
  });
  await a.waitForTimeout(400);
  const replayClickable = await a.evaluate(() => {
    const b = document.querySelector('[data-action="startTour"]');
    if (!b) {
      return false;
    }
    b.click();
    return true;
  });
  await a.waitForTimeout(400);
  const replayOpen = await tourVisible(a);
  check(
    'T7 the tour is reachable later from Settings > Features (Replay)',
    replayClickable && replayOpen,
    { replayClickable, replayOpen }
  );
  await a.keyboard.press('Escape');
  await a.waitForTimeout(200);

  // ---- session B: reduced motion keeps the CONTENT -------------------------
  const ctxB = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    reducedMotion: 'reduce'
  });
  const b = await ctxB.newPage();
  watch(b);
  await b.goto(BASE + '/seed-test.html', { waitUntil: 'load', timeout: 60000 });
  await b.waitForFunction(BOOTED, null, { timeout: 45000 });
  let reducedOpen = false;
  for (let i = 0; i < 40; i++) {
    if (await tourVisible(b)) {
      reducedOpen = true;
      break;
    }
    await b.waitForTimeout(150);
  }
  const reducedState = await tourState(b);
  const reducedWalk = await b.evaluate(() => {
    const cardText = (document.getElementById('tour-text') || {}).textContent || '';
    const ring = document.getElementById('tour-ring');
    return {
      text: cardText.length,
      spotlight: !!ring && getComputedStyle(ring).display !== 'none'
    };
  });
  check(
    'T8 reduced motion drops the animation, never the content',
    reducedOpen &&
      !!(reducedState.count && reducedState.title && reducedState.text) &&
      reducedWalk.text > 20 &&
      reducedWalk.spotlight,
    { reducedOpen, reducedState, reducedWalk }
  );
  await b.keyboard.press('Escape');

  check('T9 zero uncaught page errors through the walk', errors.length === 0, errors);

  await browser.close();
  if (srv) {
    try {
      srv.kill();
    } catch (e) {}
  }
  console.log('');
  console.log('RESULT  ' + pass + ' passed, ' + fails.length + ' failed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => {
  console.log('HARNESS ERROR ' + String((e && e.stack) || e).slice(0, 900));
  process.exit(1);
});
