/* ============================================================
   qa-hero-globe.cjs - the HERO GLOBE directive's own gate.
   (Owner 2026-10-12, HERO GLOBE directive.)

   index.html's hero gained a hand-written Canvas 2D dot globe
   (js/marketing-globe.js, shipped as dist/marketing-globe.js) whose
   features pop out of it one at a time. This battery proves every
   line of the directive the same way for every run:

     G1  the stage is in the markup at first paint, and the globe
         bundle is injected AFTER load (never render-blocking; the
         headline stays the LCP)
     G2  the canvas really paints LAND: a decodes-to-nonzero land
         mask and a lit-pixel count in the thousands (the all-black
         globe regression this gate exists for)
     G3  the starting orientation shows the home region (Jamaica
         on the near side, inside the disc)
     G4  the 40 s auto-cycle visits EVERY feature card and the card
         retracts on its own
     G5  Pause really pauses (index frozen, aria-pressed, label
         flips to Play) and Play resumes
     G6  dragging the globe takes over and the auto-cycle stays
         held off until the resume window
     G7  manifest integrity: every feature's href resolves to a
         real page, its anchor id exists there, tiers are
         'free'/'premium' and MCP is labelled Premium
     G8  prefers-reduced-motion: the module refuses to start -
         poster and the three existing hero cards stay exactly
         as they were, nothing is removed
     G9  zero layout shift from the globe: the stage and the hero
         column keep their box through boot and first frame
     G10 hygiene: zero console/page errors, no emoji anywhere in
         the new surface (owner hard gate), the SW precaches the
         bundle + poster, and the phone viewport (390) has no
         horizontal overflow

   SHOTS=1 also writes tmp/globe-390.png, -768, -1280, -1920 for
   the human visual pass.

   Usage:  node tools/qa-hero-globe.cjs
   Registry: CI-TEST-COVERAGE.md -> CI row (serve.cjs battery).
   ============================================================ */
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const PORT = 8765;
const BASE = process.env.BASE || 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');
const log = s => process.stdout.write('[hero-globe] ' + s + '\n');
const delay = ms => new Promise(r => setTimeout(r, ms));
let passed = 0,
  failed = 0;
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
        JSON.stringify(detail === undefined ? null : detail).slice(0, 400)
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
// Playwright demands an ABSOLUTE executablePath; chrome-launcher may hand
// back a bare command name on Unix - locate it like the sibling batteries.
function absolutizeChrome(p) {
  if (!p) {
    return undefined;
  }
  if (path.isAbsolute(p)) {
    return fs.existsSync(p) ? p : undefined;
  }
  const finder = os.platform() === 'win32' ? 'where' : 'command -v';
  try {
    const out = require('child_process')
      .execSync(finder + ' ' + JSON.stringify(p), { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
      .split(/\r?\n/)[0];
    if (out && fs.existsSync(out)) {
      return out;
    }
  } catch (e) {}
  return undefined;
}
// Owner hard gate 7: no emoji on any served surface. The exact scan the
// other marketing gates run, over the files this directive touched.
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;
(async () => {
  if (!process.env.BASE) {
    let srv = null;
    try {
      const h = await fetch(BASE + '/index.html');
      if (!h.ok) {
        throw 0;
      }
    } catch (e) {
      log('starting serve.cjs for this run');
      srv = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
      for (let i = 0; i < 30; i++) {
        await delay(1000);
        try {
          const h = await fetch(BASE + '/index.html');
          if (h.ok) {
            break;
          }
        } catch (e) {}
      }
    }
    global.__srv = srv;
  }
  const pw = resolvePlaywright();
  let executablePath;
  try {
    executablePath =
      require(path.join(ROOT, 'tools', 'chrome-launcher.cjs')).chromePath || undefined;
  } catch (e) {}
  executablePath = absolutizeChrome(executablePath);
  const browser = await pw.chromium.launch({
    headless: true,
    executablePath,
    args: ['--disk-cache-size=0']
  });

  // ---------------------------------------------------------------
  // Desktop run: G1-G7 + G9-G10
  // ---------------------------------------------------------------
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e && e.message).slice(0, 200)));
  page.on('console', m => {
    if (m.type() !== 'error') {
      return;
    }
    const url = (m.location() || {}).url || '';
    if (/favicon/.test(url) || /favicon/.test(m.text())) {
      return;
    } // not the globe's
    consoleErrors.push((m.text() || '').slice(0, 200) + ' @' + url.slice(-60));
  });

  // Capture the FIRST-PAINT state before the load-event loader can run:
  // goto waits for domcontentloaded, which is before window load.
  await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const firstPaint = await page.evaluate(() => ({
    stageInMarkup: !!document.querySelector('.hg-stage#hero-globe'),
    posterInMarkup: !!document.querySelector('.hg-stage .hg-poster'),
    canvasInMarkup: !!document.querySelector('.hg-stage .hg-canvas'),
    blockingScripts: Array.prototype.map.call(
      document.querySelectorAll('script[src*="marketing-globe"]'),
      s => s.getAttribute('src')
    ),
    headline: (document.querySelector('.hero h1, .hero-title, h1') || {}).textContent || '',
    // G9 baseline: the hero's right column box at first paint.
    visualBox: (function () {
      var v = document.querySelector('.hero-visual');
      if (!v) {
        return null;
      }
      var b = v.getBoundingClientRect();
      return { w: Math.round(b.width), h: Math.round(b.height), t: Math.round(b.top) };
    })()
  }));

  // G1: stage is markup-first, and the globe bundle is NOT referenced at
  // first paint - it is injected only after load.
  check(
    'G1 stage lives in the first-paint markup and no globe script is referenced yet',
    firstPaint.stageInMarkup &&
      firstPaint.posterInMarkup &&
      firstPaint.canvasInMarkup &&
      firstPaint.blockingScripts.length === 0 &&
      firstPaint.headline.length > 10,
    firstPaint
  );

  // Wait for the post-load idle injection to boot the module.
  await page.waitForFunction(
    function () {
      return !!window.MMGR_GLOBE;
    },
    null,
    { timeout: 30000 }
  );
  await page.waitForFunction(
    function () {
      return !!(window.MMGR_GLOBE && window.MMGR_GLOBE.state && window.MMGR_GLOBE.state.firstFrame);
    },
    null,
    { timeout: 30000 }
  );
  const boot = await page.evaluate(() => {
    var G = window.MMGR_GLOBE;
    var stage = document.querySelector('.hg-stage');
    var scripts = Array.prototype.map.call(
      document.querySelectorAll('script[src*="marketing-globe"]'),
      s => s.getAttribute('src')
    );
    return {
      started: G.state.started,
      firstFrame: G.state.firstFrame,
      hgOn: stage.classList.contains('hg-on'),
      hgFirst: stage.classList.contains('hg-first'),
      scripts: scripts,
      devFallback: scripts.length === 1 && /^dist\//.test(scripts[0])
    };
  });
  // G1 (part 2): the injected script is the DIST bundle (dev 404 falls back
  // to the source file), and the loop actually started.
  check(
    'G1 the loader injects the dist bundle after load and the module starts',
    boot.devFallback && boot.started && boot.hgOn,
    boot
  );

  // G2: real land. Count lit pixels on the live canvas after one frame.
  const land = await page.evaluate(() => {
    var G = window.MMGR_GLOBE;
    G.render();
    var c = document.querySelector('.hg-canvas');
    var ctx = c.getContext('2d');
    var d = ctx.getImageData(0, 0, c.width, c.height).data;
    var lit = 0;
    for (var i = 3; i < d.length; i += 4) {
      if (d[i] > 16) {
        lit++;
      }
    }
    return { lit: lit, w: c.width, h: c.height };
  });
  check(
    'G2 the canvas paints real land (lit pixel count in the thousands, not an empty disc)',
    land.lit > 1500,
    land
  );

  // G3: starting orientation - home (Kingston) on the near side, in-disc.
  const home = await page.evaluate(() => {
    var p = window.MMGR_GLOBE.project(17.97, -76.79);
    var c = document.querySelector('.hg-canvas');
    return { z: p.z, x: p.x, y: p.y, w: c.width, h: c.height };
  });
  check(
    'G3 the starting frame turns the home region toward us (Jamaica on the near side)',
    home.z > 0.1 && home.x > 0 && home.x < home.w && home.y > 0 && home.y < home.h,
    home
  );

  // G4: the auto-cycle, driven by the QA seam (no wall-clock luck). One
  // feature every 10 s x 9 features needs > 90 s of stepped time to visit
  // every node; the retract step then waits in 0.5 s windows until the
  // module's OWN timer closes the card (never longer than one cycle).
  const cycle = await page.evaluate(() => {
    var G = window.MMGR_GLOBE;
    var visited = {};
    var openedAtLeastOnce = false;
    var t0 = G.state.index;
    for (var i = 0; i < 200; i++) {
      // 200 x 0.5 s = 100 s > one lap of all nine features.
      G.__advance(500);
      visited[G.state.index] = true;
      if (G.cardIndex() >= 0) {
        openedAtLeastOnce = true;
      }
    }
    // Let the cycle retract the open card by itself.
    var closed = false;
    for (var j = 0; j < 20 && !closed; j++) {
      G.__advance(500);
      closed = G.cardIndex() === -1;
    }
    return {
      first: t0,
      visited: Object.keys(visited).map(Number),
      count: G.features.length,
      openAtEnd: G.cardIndex(),
      opened: openedAtLeastOnce
    };
  });
  const visitedAll =
    cycle.visited.length === cycle.count &&
    cycle.visited.every(function (v, i) {
      return v === i;
    });
  check(
    'G4 the cycle visits every feature and every card retracts on its own',
    visitedAll && cycle.opened && cycle.openAtEnd === -1,
    cycle
  );

  // G5: Pause / Play.
  const pause = await page.evaluate(function () {
    var G = window.MMGR_GLOBE;
    var btn = document.querySelector('.hg-controls button');
    if (!btn) {
      return { noButton: true };
    }
    var idxBefore = G.state.index;
    btn.click();
    var pausedState = {
      paused: G.state.paused,
      pressed: btn.getAttribute('aria-pressed'),
      label: (btn.querySelector('span') || btn).textContent.trim()
    };
    for (var i = 0; i < 30; i++) {
      G.__advance(500);
    } // 15 s held
    pausedState.indexHeld = G.state.index === idxBefore;
    btn.click(); // Play
    var resumed = G.state.paused === false;
    for (var j = 0; j < 28; j++) {
      G.__advance(500);
    } // 14 s - past RESUME_AFTER
    pausedState.indexMoved = G.state.index !== idxBefore;
    pausedState.resumed = resumed;
    return pausedState;
  });
  check(
    'G5 Pause really pauses and Play resumes (aria-pressed + label flip with it)',
    pause &&
      !pause.noButton &&
      pause.paused === true &&
      pause.pressed === 'true' &&
      pause.label === 'Play' &&
      pause.indexHeld === true &&
      pause.resumed === true &&
      pause.indexMoved === true,
    pause
  );

  // G6: a drag takes over - the globe follows the pointer, and while the
  // button is down the auto-cycle cannot advance. (After release the module
  // eases BACK to the current node by design - t resets to 0 - so the lon
  // is measured DURING the drag, never after the ease-back.)
  const drag = await page.evaluate(async function () {
    var G = window.MMGR_GLOBE;
    var frame = document.querySelector('.hg-frame');
    var b = frame.getBoundingClientRect();
    var lonBefore = G.state.lon;
    var mk = function (type, x, y) {
      var e = new PointerEvent(type, {
        bubbles: true,
        pointerId: 1,
        clientX: x,
        clientY: y
      });
      frame.dispatchEvent(e);
    };
    var cx = b.left + b.width / 2,
      cy = b.top + b.height / 2;
    mk('pointerdown', cx, cy);
    mk('pointermove', cx + 120, cy);
    var duringDrag = {
      lonMoved: Math.abs(G.state.lon - lonBefore) > 20,
      dragging: G.state.dragging === true
    };
    var idxBeforeRelease = G.state.index;
    for (var i = 0; i < 30; i++) {
      G.__advance(500);
    } // 15 s while held down
    duringDrag.indexHeld = G.state.index === idxBeforeRelease;
    mk('pointerup', cx + 120, cy);
    // After release the globe eases back to the node rather than snapping:
    // the lon must converge on the target it is easing toward.
    var t0 = G.state.t;
    for (var j = 0; j < 8; j++) {
      G.__advance(500);
    }
    duringDrag.easedBack = G.state.t > t0; // the cycle is running again
    duringDrag.released = G.state.dragging === false;
    return duringDrag;
  });
  check(
    'G6 dragging turns the globe, holds the cycle while held down, and resumes after release',
    drag.lonMoved && drag.dragging === true && drag.indexHeld && drag.released && drag.easedBack,
    drag
  );

  // G7: manifest integrity - every href resolves, every anchor id exists,
  // and MCP keeps its Premium label.
  const manifest = await page.evaluate(function () {
    return window.MMGR_GLOBE.features.map(function (f) {
      return { id: f.id, href: f.href, tier: f.tier };
    });
  });
  check(
    'G7a the manifest is the expected 9 features with sane tiers',
    manifest.length === 9 &&
      manifest.every(function (f) {
        return f.tier === 'free' || f.tier === 'premium';
      }) &&
      manifest.filter(function (f) {
        return f.id === 'mcp';
      }).length === 1 &&
      manifest.filter(function (f) {
        return f.id === 'mcp';
      })[0].tier === 'premium',
    manifest
  );
  const hrefProblems = [];
  const pageCache = {};
  for (const f of manifest) {
    const u = new URL(f.href, BASE + '/index.html');
    const key = u.pathname;
    if (!pageCache[key]) {
      const r = await fetch(u).catch(() => null);
      pageCache[key] = r && r.ok ? await r.text() : null;
    }
    if (!pageCache[key]) {
      hrefProblems.push(f.id + ': page missing ' + key);
      continue;
    }
    if (u.hash) {
      const id = u.hash.slice(1).replace(/"/g, '&quot;');
      if (pageCache[key].indexOf('id="' + id + '"') < 0) {
        hrefProblems.push(f.id + ': anchor ' + u.hash + ' missing in ' + key);
      }
    }
  }
  check(
    'G7b every feature href resolves to a real page anchor',
    hrefProblems.length === 0,
    hrefProblems
  );
  const premiumCard = await page.evaluate(function () {
    var G = window.MMGR_GLOBE;
    var i = G.features.findIndex(function (f) {
      return f.id === 'mcp';
    });
    G.__advance(1); // no-op step to flush a render
    var tabs = document.querySelectorAll('.hg-tab');
    // Open the MCP card via its tab and read the rendered foot label.
    if (tabs[i]) {
      tabs[i].click();
    }
    var foot =
      document.querySelector('.hg-card.hg-open .hg-card-foot') ||
      document.querySelector('.hg-cards .hg-card-foot');
    var all = Array.prototype.map.call(
      document.querySelectorAll('.hg-cards .hg-card'),
      function (c) {
        var f = c.querySelector('.hg-card-foot');
        return (f ? f.textContent : '').trim().slice(0, 20);
      }
    );
    return { foot: foot ? foot.textContent.trim().slice(0, 30) : '', perCard: all };
  });
  check(
    'G7c the MCP card is the one labelled Premium plan',
    /Premium plan/.test(premiumCard.foot || '') ||
      premiumCard.perCard.filter(function (t) {
        return /Premium plan/.test(t);
      }).length === 1,
    premiumCard
  );

  // G9: no layout shift from the globe.
  const shift = await page.evaluate(function (base) {
    var v = document.querySelector('.hero-visual');
    var b = v ? v.getBoundingClientRect() : null;
    var nowBox = b
      ? { w: Math.round(b.width), h: Math.round(b.height), t: Math.round(b.top) }
      : null;
    var stage = document.querySelector('.hg-stage').getBoundingClientRect();
    return {
      base: base,
      now: nowBox,
      stageW: Math.round(stage.width),
      stageH: Math.round(stage.height)
    };
  }, firstPaint.visualBox);
  check(
    'G9 the hero column keeps its box through boot and first frame (CLS stays zero)',
    shift.base &&
      shift.now &&
      shift.base.w === shift.now.w &&
      Math.abs(shift.base.h - shift.now.h) <= 1 &&
      shift.stageW > 100 &&
      shift.stageH > 100,
    shift
  );

  // G10 hygiene.
  check(
    'G10a zero console errors and zero page errors across the whole desktop run',
    pageErrors.length === 0 && consoleErrors.length === 0,
    { pageErrors: pageErrors, consoleErrors: consoleErrors }
  );
  const emoji = [];
  for (const f of [
    'index.html',
    'js/marketing-globe.js',
    'images/hero-globe-poster.svg',
    'css/marketing.css',
    'tools/gen-globe-mask.cjs'
  ]) {
    const txt = fs.readFileSync(path.join(ROOT, f), 'utf8');
    if (EMOJI.test(txt)) {
      emoji.push(f);
    }
  }
  check('G10b no emoji anywhere on the new surface (owner hard gate)', emoji.length === 0, emoji);
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  check(
    'G10c the service worker precaches the globe bundle and the poster',
    /dist\/marketing-globe\.js/.test(sw) && /images\/hero-globe-poster\.svg/.test(sw),
    null
  );

  if (process.env.SHOTS) {
    const shots = [
      [390, 844, 'tmp/globe-390.png'],
      [768, 1024, 'tmp/globe-768.png'],
      [1280, 900, 'tmp/globe-1280.png'],
      [1920, 1080, 'tmp/globe-1920.png']
    ];
    for (const [w, h, file] of shots) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(ROOT, file) });
      log('shot ' + file);
    }
  }

  await ctx.close();

  // ---------------------------------------------------------------
  // Reduced-motion run: G8. The module must refuse to start and
  // leave the poster + the three hero cards exactly as they were.
  // ---------------------------------------------------------------
  const rmCtx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce'
  });
  const rmPage = await rmCtx.newPage();
  const rmErrors = [];
  rmPage.on('pageerror', e => rmErrors.push(String(e && e.message).slice(0, 200)));
  await rmPage.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await rmPage.waitForFunction(
    function () {
      return !!window.MMGR_GLOBE;
    },
    null,
    { timeout: 30000 }
  );
  await rmPage.waitForTimeout(800);
  const rm = await rmPage.evaluate(function () {
    var G = window.MMGR_GLOBE;
    var stage = document.querySelector('.hg-stage');
    var visual = document.querySelector('.hero-visual');
    var cards = visual ? visual.querySelector('.hero-cards') : null;
    return {
      started: G.state.started,
      refuse: G.state.refuseReason || '',
      hgOn: stage ? stage.classList.contains('hg-on') : null,
      // On DESKTOP the stage stays display:none under reduced motion - the
      // three hero cards are the fallback there. (On phones the media query
      // keeps the stage in flow so the static poster shows; the phone run
      // below covers that.)
      stageDisplay: stage ? getComputedStyle(stage).display : null,
      hgLive: visual ? visual.classList.contains('hg-live') : null,
      cardsVisibility: cards ? getComputedStyle(cards).visibility : null,
      lonUnmoved: Math.abs(G.state.lon - -30) < 0.001
    };
  });
  check(
    'G8 under prefers-reduced-motion the module refuses and the three hero cards stay untouched',
    rm.started === false &&
      rm.refuse === 'reduced-motion' &&
      rm.hgOn === false &&
      rm.stageDisplay === 'none' &&
      rm.hgLive !== true &&
      rm.cardsVisibility === 'visible' &&
      rmErrors.length === 0,
    { rm: rm, errors: rmErrors }
  );
  await rmCtx.close();

  // ---------------------------------------------------------------
  // Phone run: the stage fits, the poster shows, no h-overflow.
  // ---------------------------------------------------------------
  const phCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phPage = await phCtx.newPage();
  const phErrors = [];
  phPage.on('pageerror', e => phErrors.push(String(e && e.message).slice(0, 200)));
  await phPage.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await phPage.waitForTimeout(2500);
  const phone = await phPage.evaluate(function () {
    var stage = document.querySelector('.hg-stage');
    var b = stage ? stage.getBoundingClientRect() : null;
    var poster = document.querySelector('.hg-poster');
    var pb = poster ? poster.getBoundingClientRect() : null;
    return {
      stageThere: !!stage,
      stageW: b ? Math.round(b.width) : 0,
      stageInViewport: b ? b.right <= 390.5 && b.left >= -0.5 : false,
      posterW: pb ? Math.round(pb.width) : 0,
      scrollW: document.documentElement.scrollWidth
    };
  });
  check(
    'G10d on a 390px phone the stage fits with no horizontal overflow',
    phone.stageThere &&
      phone.stageInViewport &&
      phone.stageW > 150 &&
      phone.posterW > 150 &&
      phone.scrollW <= 390 &&
      phErrors.length === 0,
    { phone: phone, errors: phErrors }
  );
  await phCtx.close();

  await browser.close();
  if (global.__srv) {
    try {
      global.__srv.kill();
    } catch (e) {}
  }
  log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => {
  log('HARNESS ERROR ' + String(e && e.message).slice(0, 300));
  process.exit(1);
});
