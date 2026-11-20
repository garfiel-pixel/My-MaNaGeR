/* ============================================================
   REVIEW-ARTIFACTS/capture-shots.cjs
   ------------------------------------------------------------
   Accountability close-out, STEP 4. Captures every screenshot the
   directive lists into REVIEW-ARTIFACTS/shots/ using headless Chrome
   through Playwright. This is evidence only - it changes no app code
   and is excluded from the deployable asset bundle (.assetsignore).

   Shots:
     - six wave seams (band-seam) at 1280
     - four card rows at 390 / 1280 / 1920
     - four role cards open, 3D, and again with Performance Mode
     - completion ring + contributors: demo-filled at 390/1280, and
       a synthetic project with more than eight majors
     - the sign-out dialog
     - the AI view-only notice in both wordings
     - the calculator tour at steps 2 and 5 in landscape 844x390

   Usage: node REVIEW-ARTIFACTS/capture-shots.cjs
   ============================================================ */
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(__dirname, 'shots');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8765';
const delay = ms => new Promise(r => setTimeout(r, ms));
const FLUSH_RAF = `new Promise(function (res) {
  requestAnimationFrame(function () { requestAnimationFrame(function () { res(1); }); });
})`;

let count = 0;
async function save(target, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const file = path.join(SHOTS, name);
  await target.screenshot({ path: file, timeout: 30000 });
  const size = fs.statSync(file).size;
  if (size < 1000) throw new Error('suspiciously small shot: ' + name + ' (' + size + ' bytes)');
  count++;
  process.stdout.write('[shot] ' + name + '  ' + size + ' bytes\n');
}

function resolvePlaywright() {
  try {
    return require('playwright');
  } catch (e) {}
  const roots = [
    path.join(os.homedir(), 'AppData', 'Local', 'npm-cache', '_npx'),
    path.join(os.homedir(), '.npm', '_npx')
  ];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const dir of fs.readdirSync(root)) {
      const p = path.join(root, dir, 'node_modules', 'playwright');
      if (fs.existsSync(path.join(p, 'index.js'))) return require(p);
    }
  }
  throw new Error('playwright not found');
}

const FAKE_SESSION = `(function () {
  var real = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/api/auth/me') !== -1) {
      return Promise.resolve(new Response(JSON.stringify({
        ok: true, user: { name: 'QA Operator', email: 'qa@example.com' }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    return real(input, init);
  };
})();`;

// More than eight major groups, each with a distinct contribution so the
// contributors list has a real order (matches the ring harness fixture shape).
const MULTI = `[
  { id: 'g1', name: 'Pre-Construction', isPhase: true },
  { id: 'g1a', name: 'Charter', parentId: 'g1', status: 'completed' },
  { id: 'g1b', name: 'Permits', parentId: 'g1', status: 'completed' },
  { id: 'g2', name: 'Site Works', isPhase: true },
  { id: 'g2a', name: 'Clear', parentId: 'g2', status: 'completed' },
  { id: 'g2b', name: 'Grade', parentId: 'g2', status: 'todo' },
  { id: 'g3', name: 'Foundation', isPhase: true },
  { id: 'g3a', name: 'Excavate', parentId: 'g3', status: 'completed' },
  { id: 'g3b', name: 'Rebar', parentId: 'g3', status: 'todo' },
  { id: 'g4', name: 'Structure', isPhase: true },
  { id: 'g4a', name: 'Columns', parentId: 'g4', status: 'completed' },
  { id: 'g4b', name: 'Slab', parentId: 'g4', status: 'todo' },
  { id: 'g5', name: 'Envelope', isPhase: true },
  { id: 'g5a', name: 'Roof', parentId: 'g5', status: 'completed' },
  { id: 'g5b', name: 'Glazing', parentId: 'g5', status: 'todo' },
  { id: 'g6', name: 'Services', isPhase: true },
  { id: 'g6a', name: 'Rough-in', parentId: 'g6', status: 'todo' },
  { id: 'g7', name: 'Finishes', isPhase: true },
  { id: 'g7a', name: 'Paint', parentId: 'g7', status: 'todo' },
  { id: 'g8', name: 'External Works', isPhase: true },
  { id: 'g8a', name: 'Paving', parentId: 'g8', status: 'todo' },
  { id: 'g9', name: 'Commissioning', isPhase: true },
  { id: 'g9a', name: 'Testing', parentId: 'g9', status: 'completed' },
  { id: 'g10', name: 'Handover', isPhase: true },
  { id: 'g10a', name: 'Snag', parentId: 'g10', status: 'todo' }
]`;

(async () => {
  let srv = null;
  const { chromium } = resolvePlaywright();
  let executablePath;
  try {
    executablePath = require(path.join(ROOT, 'tools', 'chrome-launcher.cjs')).chromePath || undefined;
  } catch (e) {}
  let browser = null;
  try {
    let up = false;
    try {
      up = (await fetch(BASE + '/manifest.webmanifest')).ok;
    } catch (e) {}
    if (!up) {
      process.stdout.write('[shot] starting serve.cjs\n');
      srv = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
      for (let i = 0; i < 80 && !up; i++) {
        await delay(250);
        try {
          up = (await fetch(BASE + '/manifest.webmanifest')).ok;
        } catch (e) {}
      }
    }
    if (!up) throw new Error('serve.cjs did not answer on ' + BASE);
    browser = await chromium.launch({
      headless: true,
      executablePath,
      args: ['--disk-cache-size=0', '--enable-unsafe-swiftshader']
    });

    async function context(opts) {
      const o = opts || {};
      const ctx = await browser.newContext({
        viewport: o.viewport || { width: 1280, height: 900 },
        reducedMotion: 'no-preference'
      });
      if (o.init) await ctx.addInitScript(o.init);
      const page = await ctx.newPage();
      return { ctx, page };
    }

    // ---- 1. Six wave seams ---------------------------------------
    {
      const { ctx, page } = await context();
      await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
      await delay(1300);
      const seams = page.locator('.band-seam');
      const n = await seams.count();
      if (n !== 6) throw new Error('expected 6 band seams, found ' + n);
      for (let i = 0; i < n; i++) {
        const kind = await seams.nth(i).getAttribute('data-seam');
        await save(seams.nth(i), 'seam-' + (i + 1) + '-' + kind + '.png');
      }
      await ctx.close();
    }

    // ---- 2. Four card rows at three widths -----------------------
    const ROWS = [
      ['steps', '.steps'],
      ['audience', '#data .audience'],
      ['why', '.why-grid'],
      ['solutions', '.solutions']
    ];
    for (const w of [390, 1280, 1920]) {
      const { ctx, page } = await context({ viewport: { width: w, height: 900 } });
      await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
      await delay(1300);
      for (const [label, sel] of ROWS) {
        const row = page.locator(sel);
        await row.scrollIntoViewIfNeeded();
        await delay(950); // let the .rv stagger finish
        await save(row, 'cardrow-' + label + '-' + w + '.png');
      }
      await ctx.close();
    }

    // ---- 3. Four role cards open: 3D, then Performance Mode ------
    const ROLES = [
      ['gc', 'general-contractors'],
      ['pm', 'project-managers'],
      ['super', 'superintendents'],
      ['sub', 'trade-leads']
    ];
    for (const perf of [false, true]) {
      const { ctx, page } = await context({
        init: perf ? `try { localStorage.setItem('mmgr_perf_mode', 'on'); } catch (e) {}` : null
      });
      await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
      await page.locator('#builtfor').scrollIntoViewIfNeeded();
      await delay(2400); // intersection observer + dynamic three.js import
      if (perf) {
        await page.evaluate(() => document.documentElement.setAttribute('data-perf', 'on'));
        await delay(400);
      }
      for (const [key, label] of ROLES) {
        await page.locator('.role-card[data-role="' + key + '"] .role-btn').click();
        if (perf) {
          await delay(900);
          const c = await page.locator('canvas.role-canvas').count();
          if (c !== 0) throw new Error('Performance Mode must keep the canvas away');
        } else {
          // The 3D canvas is attached on the mmgr:roleopen event and the pop
          // animation runs ~1.2s; wait for has-canvas, then let it settle.
          await page.waitForFunction(
            r => {
              var host = document.querySelector('.role-card[data-role="' + r + '"] .role-fig');
              return !!host && host.classList.contains('has-canvas');
            },
            key,
            { timeout: 8000 }
          );
          await delay(1400);
        }
        await save(
          page.locator('.role-card[data-role="' + key + '"]'),
          'role-' + label + '-' + (perf ? 'perf' : '3d') + '.png'
        );
      }
      const canvases = await page.locator('canvas.role-canvas').count();
      process.stdout.write(
        '[shot] role ' + (perf ? 'perf' : '3d') + ' final canvas count: ' + canvases + '\n'
      );
      await ctx.close();
    }

    // ---- 4. Completion ring + contributors -----------------------
    // 4a. demo-filled at 390 and 1280
    for (const w of [390, 1280]) {
      const { ctx, page } = await context({
        viewport: { width: w, height: 900 },
        init: `try {
          localStorage.setItem('mmgr_unlocked_demo-filled', '1');
          localStorage.removeItem('mmgr_scope_demo-filled');
        } catch (e) {}`
      });
      // The filled demo's state is seeded by app.html's DOMContentLoaded, so
      // visit there first (same context/localStorage), then open the project.
      await page.goto(BASE + '/app.html', { waitUntil: 'domcontentloaded' });
      await delay(1200);
      await page.goto(BASE + '/project.html?id=demo-filled', { waitUntil: 'domcontentloaded' });
      await delay(1800);
      await page.evaluate(FLUSH_RAF);
      await delay(400);
      const demoMore = await page.locator('#major-list .major-more').count();
      if (demoMore) {
        await page.evaluate(() => MMGR.Render.toggleMajorList());
        await page.evaluate(FLUSH_RAF);
        await delay(400);
      }
      process.stdout.write(
        '[shot] demo-filled major rows: ' +
          (await page.locator('#major-list .major-row').count()) +
          '\n'
      );
      await save(page.locator('#completion-card'), 'ring-demo-filled-' + w + '.png');
      await ctx.close();
    }
    // 4b. synthetic project with more than eight majors
    for (const w of [390, 1280]) {
      const { ctx, page } = await context({
        viewport: { width: w, height: 900 },
        init: `try { localStorage.setItem('mmgr_unlocked_shot-multi', '1'); } catch (e) {}`
      });
      await page.goto(BASE + '/project.html?id=shot-multi', { waitUntil: 'domcontentloaded' });
      await delay(1300);
      await page.evaluate(`(function () {
        MMGR.State.updateState(function (s) { s.tasks = ${MULTI}; });
        MMGR.Render.renderDash();
      })();`);
      await page.evaluate(FLUSH_RAF);
      await delay(700);
      const multiMore = await page.locator('#major-list .major-more').count();
      process.stdout.write('[shot] synthetic show-all control: ' + multiMore + '\n');
      if (multiMore) {
        await page.evaluate(() => MMGR.Render.toggleMajorList());
        await page.evaluate(FLUSH_RAF);
        await delay(400);
      }
      const majors = await page.locator('#major-list .major-row').count();
      process.stdout.write('[shot] synthetic major rows (expanded): ' + majors + '\n');
      if (majors < 8) throw new Error('synthetic project must show at least 8 major rows');
      await save(page.locator('#completion-card'), 'ring-multi-major-' + w + '.png');
      await ctx.close();
    }

    // ---- 5. Sign-out dialog --------------------------------------
    {
      const { ctx, page } = await context({
        init:
          FAKE_SESSION +
          `\ntry { localStorage.setItem('mmgr_unlocked_demo-project', '1'); } catch (e) {}`
      });
      await page.goto(BASE + '/project.html?id=demo-project', { waitUntil: 'domcontentloaded' });
      await delay(1400);
      await page.evaluate('MMGR.GoogleAuth.confirmSignOut(function () {});');
      await page.evaluate(FLUSH_RAF);
      await delay(400);
      const open = await page.evaluate(() => {
        const d = document.getElementById('soc');
        return !!d && !d.hidden;
      });
      if (!open) throw new Error('sign-out dialog did not open');
      await save(page.locator('#soc'), 'signout-dialog.png');
      await ctx.close();
    }

    // ---- 6. AI view-only notice in both wordings -----------------
    const VO = [
      [
        'demo',
        `try {
          localStorage.setItem('mmgr_unlocked_demo-filled', '1');
          localStorage.removeItem('mmgr_scope_demo-filled');
        } catch (e) {}`,
        '/project.html?id=demo-filled'
      ],
      [
        'viewer',
        `try {
          localStorage.setItem('mmgr_unlocked_viewer-fixture', '1');
          localStorage.setItem('mmgr_scope_viewer-fixture', 'readonly');
        } catch (e) {}`,
        '/project.html?id=viewer-fixture'
      ]
    ];
    for (const [label, init, url] of VO) {
      const { ctx, page } = await context({ init });
      await page.goto(BASE + url, { waitUntil: 'domcontentloaded' });
      await delay(1400);
      await page.evaluate(() => {
        if (window.MMGR && MMGR.AiWin) MMGR.AiWin.open();
      });
      await page.evaluate(FLUSH_RAF);
      await delay(700);
      const voMode = await page.evaluate(() => {
        const w = document.getElementById('ai-win');
        return !!w && w.classList.contains('ai-viewonly-mode');
      });
      if (!voMode) throw new Error(label + ' AI notice not shown');
      await save(page.locator('#ai-win'), 'ai-viewonly-' + label + '.png');
      await ctx.close();
    }

    // ---- 7. Calculator tour steps 2 and 5 at 844x390 -------------
    for (const step of [2, 5]) {
      const { ctx, page } = await context({
        viewport: { width: 844, height: 390 },
        init: `try {
          localStorage.removeItem('mmgr_calc_tour_done');
          localStorage.setItem('mmgr_first_project_tour_v1', '1');
        } catch (e) {}`
      });
      await page.goto(BASE + '/calculator.html', { waitUntil: 'domcontentloaded' });
      await delay(1400);
      await page.waitForFunction(() => window.__calcTour, null, { timeout: 10000 });
      await page.evaluate(() => window.__calcTour.start());
      await delay(500);
      for (let i = 1; i < step; i++) {
        await page.locator('[data-action="calcTourNext"]').click();
        await delay(350);
      }
      const idx = await page.evaluate(() => window.__calcTour.state().idx);
      if (idx !== step - 1) throw new Error('tour step expected ' + (step - 1) + ', got ' + idx);
      await save(page, 'calc-tour-step' + step + '-844x390.png');
      await ctx.close();
    }

    process.stdout.write('[shot] DONE - ' + count + ' screenshots in ' + SHOTS + '\n');
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {}
    }
    if (srv) {
      try {
        srv.kill();
      } catch (e) {}
    }
  }
})().catch(e => {
  process.stderr.write('[shot] ERROR ' + ((e && e.stack) || e) + '\n');
  process.exit(1);
});
