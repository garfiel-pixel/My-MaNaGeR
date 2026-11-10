#!/usr/bin/env node
/* ============================================================
   T-SKELETONS - Wave 5 of the owner's UI directive (2026-11-10)
   ------------------------------------------------------------
   A loading state must mirror the shape it is about to reveal, not generic
   grey blocks. This gate pins:
     S1  the boot splash still mirrors the header, section nav and panel grid
     S2  the boot splash no longer draws a sidebar rail (Wave 0 made it
         off-canvas, so a rail in the skeleton would be a lie)
     S3  MMGR.Skeleton is exposed with every section template
     S4  every section template carries at least one .skel-box
     S5  each section template uses its own shape class (dash metrics, wbs
         table, kanban board, budget table, risks cards, photos grid,
         meetings list, team list, bill table, launcher cards, cloud cards)
     S6  paint() marks the target busy and clear() restores it
     S7  at 390px the skeleton grids collapse to one column
     S8  no page error in the run

   Usage:  node tools/qa-skeletons.cjs
   Env:    QA_PORT (default 8835)
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const ROOT = path.resolve(__dirname, '..');
const PORT = parseInt(process.env.QA_PORT || '8835', 10);
const BASE = 'http://127.0.0.1:' + PORT;

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log('  PASS  ' + name);
  } else {
    fail++;
    console.log('  FAIL  ' + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : ''));
  }
}
function log(s) {
  process.stdout.write('[skeletons] ' + s + '\n');
}
function waitFor(url, tries) {
  return new Promise(resolve => {
    const attempt = n => {
      const req = http.get(url, res => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => {
        if (n <= 1) return resolve(false);
        setTimeout(() => attempt(n - 1), 250);
      });
      req.setTimeout(1500, () => req.destroy());
    };
    attempt(tries || 60);
  });
}
function seed() {
  return function () {
    try {
      localStorage.setItem(
        'mmgr_projects',
        JSON.stringify([{ id: 'skel', title: 'Skeleton QA', file: 'project.html?id=skel' }])
      );
      localStorage.setItem('mmgr_unlocked_skel', '1');
      localStorage.setItem('mmgr_scope_skel', 'full');
      localStorage.setItem(
        'mmgr_state_skel',
        JSON.stringify({
          projectName: 'Skeleton QA',
          schemaVersion: 31,
          tasks: [],
          budgetLines: []
        })
      );
    } catch (e) {
      /* ignore */
    }
  };
}

async function main() {
  const server = spawn(process.execPath, [path.join(ROOT, 'serve.cjs')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { MMGR_SERVE_PORT: String(PORT) }),
    stdio: 'ignore'
  });
  const up = await waitFor(BASE + '/project.html?id=skel', 80);
  if (!up) {
    log('server did not start');
    server.kill();
    process.exit(1);
  }

  const { chromium } = require('playwright');
  const launch = { headless: true, args: ['--no-sandbox'] };
  const cp = require('./chrome-launcher.cjs').chromePath;
  if (cp) launch.executablePath = cp;
  else launch.channel = 'chrome';
  const browser = await chromium.launch(launch);

  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addInitScript(seed());
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(String(e.message || e)));
  await page.goto(BASE + '/project.html?id=skel', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);

  // S1/S2: the boot splash shape.
  const boot = await page.evaluate(() => {
    const s = document.getElementById('boot-splash');
    if (!s) return null;
    return {
      header: !!s.querySelector('.bs-skel-header'),
      nav: !!s.querySelector('.bs-skel-nav'),
      grid: !!s.querySelector('.skel-boot-grid'),
      rail: !!s.querySelector('.bs-skel-rail')
    };
  });
  check(
    'S1 the boot splash mirrors header, nav and panel grid',
    !!boot && boot.header && boot.nav && boot.grid,
    boot
  );
  check('S2 the boot splash draws no sidebar rail', !!boot && boot.rail === false, boot);

  // S3: the module is exposed with every section.
  const sections = await page.evaluate(() =>
    window.MMGR && window.MMGR.Skeleton ? window.MMGR.Skeleton.skeletonSections : null
  );
  const want = [
    'dash',
    'wbs',
    'kanban',
    'budget',
    'risks',
    'photos',
    'meetings',
    'team',
    'bill',
    'launcher',
    'cloud'
  ];
  check(
    'S3 MMGR.Skeleton exposes every section template',
    Array.isArray(sections) && want.every(k => sections.indexOf(k) > -1),
    sections
  );

  // S4/S5: each template has boxes and its own shape class.
  const shapes = await page.evaluate(() => {
    const out = {};
    if (!window.MMGR || !window.MMGR.Skeleton) return out;
    [
      'dash',
      'wbs',
      'kanban',
      'budget',
      'risks',
      'photos',
      'meetings',
      'team',
      'bill',
      'launcher',
      'cloud'
    ].forEach(k => {
      const h = window.MMGR.Skeleton.skeletonHtml(k);
      const d = document.createElement('div');
      d.innerHTML = h;
      out[k] = {
        boxes: d.querySelectorAll('.skel-box').length,
        cls: Array.prototype.slice
          .call(d.querySelectorAll('*'))
          .map(n => n.className)
          .join(' ')
      };
    });
    return out;
  });
  const shapeClass = {
    dash: 'skel-metrics',
    wbs: 'skel-table',
    kanban: 'skel-board',
    budget: 'skel-metrics',
    risks: 'skel-cards',
    photos: 'skel-grid',
    meetings: 'skel-list',
    team: 'skel-list',
    bill: 'skel-table',
    launcher: 'skel-cards',
    cloud: 'skel-cards'
  };
  want.forEach(k => {
    const s = shapes[k] || { boxes: 0, cls: '' };
    check('S4 ' + k + ' carries skeleton boxes', s.boxes > 0, s.boxes);
    check('S5 ' + k + ' uses its shape class', s.cls.indexOf(shapeClass[k]) > -1, shapeClass[k]);
  });

  // S6: paint/clear round-trip.
  const roundTrip = await page.evaluate(() => {
    const d = document.createElement('div');
    d.innerHTML = '<p id="keep">real</p>';
    document.body.appendChild(d);
    const clear = window.MMGR.Skeleton.skeletonPaint('dash', d);
    const busy = d.getAttribute('aria-busy');
    const painted = !!d.querySelector('.skel-metrics');
    clear();
    const restored = !!d.querySelector('#keep') && d.getAttribute('aria-busy') === null;
    d.remove();
    return { busy, painted, restored };
  });
  check(
    'S6 paint marks the target busy and paints the shape',
    roundTrip.busy === 'true' && roundTrip.painted,
    roundTrip
  );
  check('S6 clear restores the previous content', roundTrip.restored === true, roundTrip);

  // S7: mobile collapses the grids to one column.
  await page.setViewportSize({ width: 390, height: 900 });
  await page.waitForTimeout(300);
  const cols = await page.evaluate(() => {
    const d = document.createElement('div');
    d.innerHTML = window.MMGR.Skeleton.skeletonHtml('dash');
    document.body.appendChild(d);
    const m = d.querySelector('.skel-metrics');
    const c = getComputedStyle(m).gridTemplateColumns;
    d.remove();
    return c;
  });
  check(
    'S7 at 390px the metric grid is one column',
    String(cols).trim().split(/\s+/).length === 1,
    cols
  );

  check('S8 no page error in the run', errs.length === 0, errs.slice(0, 3));

  await ctx.close();
  await browser.close();
  server.kill();
  log('');
  log('==== SKELETONS: ' + pass + ' passed / ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
}

main().catch(e => {
  log('FATAL ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
