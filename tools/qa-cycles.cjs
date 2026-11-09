#!/usr/bin/env node
/* ============================================================
   tools/qa-cycles.cjs - cycles gate (Plane-inspired)
   ------------------------------------------------------------
   Runs against a real browser and the real bundle. Proves:
     1. the Planning section opens with no cycles
     2. an end date before the start is refused, naming the rule
     3. adding a cycle shows it Planned
     4. activating a cycle shows it Active and mirrors it in the sprint bar
     5. activating a second cycle demotes the first, so exactly one is active
     6. a backlog task joins the selected cycle and leaves the backlog
     7. the membership survives a reload
     8. closing asks the question with the counts before it acts
     9. carry forward moves the unfinished work into the next planned cycle
    10. the closed cycle keeps its own membership and its close record
    11. a viewer cannot add, activate or close a cycle
    12. no page or console error during the run

   Usage:  node tools/qa-cycles.cjs
   Env:    QA_BASE (default http://127.0.0.1:8765), CHROME_PATH
   Registry: docs/CI-TEST-COVERAGE.md -> extended-qa row.
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const BASE = (process.env.QA_BASE || 'http://127.0.0.1:8765').replace(/\/$/, '');
const log = s => process.stdout.write('[cycles] ' + s + '\n');
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok });
  log(
    (ok ? 'PASS' : 'FAIL') +
      '  ' +
      name +
      (ok ? '' : '  <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 400))
  );
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

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

function chromePath() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  try {
    return require(path.join(ROOT, 'tools', 'chrome-launcher.cjs')).chromePath || undefined;
  } catch (e) {
    return undefined;
  }
}

async function reachable(url) {
  try {
    const res = await fetch(url, { method: 'GET' });
    return res.ok || res.status === 404;
  } catch (e) {
    return false;
  }
}

(async () => {
  let server = null;
  if (!(await reachable(BASE + '/project.html'))) {
    log('starting serve.cjs for this run');
    server = spawn(process.execPath, ['serve.cjs'], {
      cwd: ROOT,
      stdio: 'ignore',
      env: Object.assign({}, process.env)
    });
    for (let i = 0; i < 40; i++) {
      if (await reachable(BASE + '/project.html')) {
        break;
      }
      await sleep(500);
    }
  }
  if (!(await reachable(BASE + '/project.html'))) {
    log('FATAL: no server answered on ' + BASE);
    process.exit(1);
  }

  const pw = resolvePlaywright();
  const browser = await pw.chromium.launch({
    headless: true,
    executablePath: chromePath(),
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    serviceWorkers: 'block'
  });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    try {
      localStorage.setItem('mmgr_unlocked_demo-project', '1');
      localStorage.setItem('mmgr_first_project_tour_v1', '1');
    } catch (e) {
      /* storage blocked - the page still loads */
    }
  });
  const errors = [];
  const benign = t =>
    /Failed to load resource/.test(t) ||
    /WebSocket connection.*presence/i.test(t) ||
    /api\/cloud|api\/billing|api\/team/i.test(t) ||
    /favicon|manifest\.webmanifest|sw\.js|apple-touch/i.test(t);
  page.on('pageerror', e => errors.push('pageerror: ' + String(e)));
  page.on('console', m => {
    if (m.type() === 'error' && !benign(m.text())) {
      errors.push('console: ' + m.text());
    }
  });
  page.on('dialog', async d => {
    await d.accept();
  });

  const boot = async () => {
    await page.goto(BASE + '/project.html?id=demo-project', {
      waitUntil: 'load',
      timeout: 60000
    });
    await page.waitForFunction(
      () => !!(window.MMGR && window.MMGR.App && window.MMGR.Cycles && window.MMGR.RenderCycles),
      null,
      { timeout: 30000 }
    );
    await sleep(700);
  };
  const toastText = () =>
    page.evaluate(() => {
      const t = document.querySelector('.toast, #toast, [data-toast]');
      return t ? t.textContent : '';
    });

  await boot();

  // ---- seed a clean project -------------------------------------------
  await page.evaluate(() => {
    window.MMGR.State.updateState(s => {
      s.cycles = [];
      s.cycSel = '';
      s.cycClosing = '';
      s.methodology = 'agile';
      s.tasks = [
        {
          id: 'T1',
          name: 'Pour slab',
          status: 'todo',
          duration: '5',
          startDate: '2026-11-02',
          endDate: '2026-11-06',
          cycleId: ''
        },
        {
          id: 'T2',
          name: 'Set out',
          status: 'todo',
          duration: '3',
          startDate: '2026-11-02',
          endDate: '2026-11-04',
          cycleId: ''
        },
        {
          id: 'T3',
          name: 'Mobilise',
          status: 'completed',
          duration: '2',
          startDate: '2026-10-28',
          endDate: '2026-10-29',
          cycleId: ''
        }
      ];
    });
    window.MMGR.State.save(true);
    window.MMGR.Render.showSection('plan', document.querySelector('.sec-btn[data-section="plan"]'));
    window.MMGR.Render.renderCycles();
  });
  await page.waitForTimeout(500);

  // ---- 1. the section opens empty -------------------------------------
  const empty = await page.evaluate(() => ({
    visible: !document.getElementById('panel-plan').classList.contains('is-hide'),
    rows: document.querySelectorAll('#cyc-body tr').length,
    text: (document.getElementById('cyc-body') || {}).textContent || ''
  }));
  check(
    'the Planning section opens with no cycles',
    empty.visible === true && empty.rows === 1 && /No cycles yet/.test(empty.text),
    empty
  );

  // ---- 2. an end before the start is refused ---------------------------
  await page.fill('#cyc-name', 'Sprint A');
  await page.fill('#cyc-start', '2026-11-14');
  await page.fill('#cyc-end', '2026-11-01');
  await page.locator('button[data-action="cycAdd"]').click();
  await page.waitForTimeout(350);
  const bad = await page.evaluate(() => window.MMGR.State.getState().cycles.length);
  const badToast = await toastText();
  check(
    'an end date before the start is refused, naming the rule',
    bad === 0 && /before the start/.test(badToast),
    { bad, badToast }
  );

  // ---- 3. adding a cycle ----------------------------------------------
  await page.fill('#cyc-start', '2026-11-01');
  await page.fill('#cyc-end', '2026-11-14');
  await page.locator('button[data-action="cycAdd"]').click();
  await page.waitForTimeout(350);
  const added = await page.evaluate(() => ({
    n: window.MMGR.State.getState().cycles.length,
    row: (document.querySelector('#cyc-body tr') || {}).textContent || ''
  }));
  check(
    'adding a cycle shows it Planned',
    added.n === 1 && /Sprint A/.test(added.row) && /Planned/.test(added.row),
    added
  );

  // ---- 4. activating it ------------------------------------------------
  await page.locator('#cyc-body button[data-action="cycActivate"]').click();
  await page.waitForTimeout(400);
  const active = await page.evaluate(() => {
    const s = window.MMGR.State.getState();
    return {
      state: s.cycles[0].state,
      commitment: s.cycles[0].commitment,
      barName: (document.getElementById('sp-nm') || {}).value,
      row: (document.querySelector('#cyc-body tr') || {}).textContent || ''
    };
  });
  check(
    'activating a cycle shows it Active and mirrors it in the sprint bar',
    active.state === 'active' &&
      active.barName === 'Sprint A' &&
      /Active/.test(active.row) &&
      active.commitment &&
      active.commitment.tasks === 0,
    active
  );

  // ---- 5. a second cycle demotes the first -----------------------------
  await page.evaluate(() => {
    window.MMGR.State.updateState(s => {
      window.MMGR.Cycles.newCycle(s, {
        name: 'Sprint B',
        start: '2026-11-15',
        end: '2026-11-28'
      });
    });
    window.MMGR.Render.renderCycles();
  });
  await page.waitForTimeout(300);
  await page.locator('#cyc-body tr:nth-child(2) button[data-action="cycActivate"]').click();
  await page.waitForTimeout(400);
  const two = await page.evaluate(() => {
    const s = window.MMGR.State.getState();
    return {
      states: s.cycles.map(c => c.name + ':' + c.state),
      activeCount: s.cycles.filter(c => c.state === 'active').length,
      barName: (document.getElementById('sp-nm') || {}).value
    };
  });
  check(
    'activating a second cycle demotes the first, so exactly one is active',
    two.activeCount === 1 &&
      JSON.stringify(two.states) === JSON.stringify(['Sprint A:planned', 'Sprint B:active']) &&
      two.barName === 'Sprint B',
    two
  );

  // ---- 6. a backlog task joins the selected cycle ----------------------
  await page.locator('#cyc-body button[data-action="cycSelect"]').first().click();
  await page.waitForTimeout(300);
  const beforeAssign = await page.$$eval('#cyc-backlog .cyc-bl', els => els.length);
  for (let i = 0; i < 3; i++) {
    await page.locator('#cyc-backlog button[data-action="cycAssign"]').first().click();
    await page.waitForTimeout(250);
  }
  const assigned = await page.evaluate(() => {
    const s = window.MMGR.State.getState();
    const a = s.cycles.find(c => c.name === 'Sprint A');
    return {
      inA: s.tasks.filter(t => t.cycleId === a.id).length,
      backlog: window.MMGR.Cycles.backlog(s).length,
      rows: document.querySelectorAll('#cyc-detail tbody tr').length
    };
  });
  check(
    'a backlog task joins the selected cycle and leaves the backlog',
    beforeAssign === 3 && assigned.inA === 3 && assigned.backlog === 0 && assigned.rows === 3,
    { beforeAssign, assigned }
  );

  // ---- 7. the membership survives a reload -----------------------------
  await page.evaluate(() => window.MMGR.State.save(true));
  await boot();
  await page.evaluate(() => {
    window.MMGR.Render.showSection('plan', document.querySelector('.sec-btn[data-section="plan"]'));
    window.MMGR.Render.renderCycles();
  });
  await page.waitForTimeout(400);
  const kept = await page.evaluate(() => {
    const s = window.MMGR.State.getState();
    const a = s.cycles.find(c => c.name === 'Sprint A');
    return { inA: s.tasks.filter(t => t.cycleId === a.id).length, cycles: s.cycles.length };
  });
  check('the membership survives a reload', kept.inA === 3 && kept.cycles === 2, kept);

  // ---- 8. closing asks the question -----------------------------------
  await page.locator('#cyc-body button[data-action="cycSelect"]').first().click();
  await page.waitForTimeout(300);
  await page.locator('#cyc-body button[data-action="cycClose"]').first().click();
  await page.waitForTimeout(350);
  const asked = await page.evaluate(() => {
    const box = document.querySelector('#cyc-detail .cyc-close');
    return {
      shown: !!box,
      text: box ? box.textContent : '',
      forward: !!document.querySelector('button[data-action="cycCloseForward"]'),
      backlog: !!document.querySelector('button[data-action="cycCloseBacklog"]'),
      closed: window.MMGR.State.getState().cycles.filter(c => c.state === 'closed').length
    };
  });
  check(
    'closing asks the question with the counts before it acts',
    asked.shown &&
      asked.forward &&
      asked.backlog &&
      /2 unfinished/.test(asked.text) &&
      /8 working days/.test(asked.text) &&
      asked.closed === 0,
    asked
  );

  // ---- 9. carry forward ------------------------------------------------
  await page.locator('button[data-action="cycCloseForward"]').click();
  await page.waitForTimeout(450);
  const carried = await page.evaluate(() => {
    const s = window.MMGR.State.getState();
    const a = s.cycles.find(c => c.name === 'Sprint A');
    const b = s.cycles.find(c => c.name === 'Sprint B');
    return {
      a: a.state,
      aTasks: s.tasks.filter(t => t.cycleId === a.id).map(t => t.id),
      bTasks: s.tasks.filter(t => t.cycleId === b.id).map(t => t.id),
      close: a.close
    };
  });
  check(
    'carry forward moves the unfinished work into the next planned cycle',
    carried.a === 'closed' &&
      JSON.stringify(carried.aTasks) === JSON.stringify(['T3']) &&
      JSON.stringify(carried.bTasks) === JSON.stringify(['T1', 'T2']),
    carried
  );

  // ---- 10. the closed cycle keeps its record ---------------------------
  check(
    'the closed cycle keeps its own membership and its close record',
    carried.close &&
      carried.close.choice === 'forward' &&
      carried.close.carried === 2 &&
      carried.close.carriedDays === 8 &&
      carried.close.done === 1 &&
      carried.close.tasks === 3,
    carried.close
  );

  // ---- 11. the read-only fence -----------------------------------------
  const viewer = await page.evaluate(() => {
    window.MMGR.scope = 'readonly';
    window.MMGR.Render.renderCycles();
    const before = window.MMGR.State.getState().cycles.length;
    document.getElementById('cyc-name').value = 'Viewer cycle';
    document.getElementById('cyc-start').value = '2026-12-01';
    document.getElementById('cyc-end').value = '2026-12-14';
    window.MMGR.App.cycAdd();
    const s = window.MMGR.State.getState();
    const b = s.cycles.find(c => c.name === 'Sprint B');
    window.MMGR.App.cycActivate(b.id);
    const toast = document.querySelector('.toast, #toast, [data-toast]');
    window.MMGR.scope = 'full';
    return {
      cycles: s.cycles.length,
      before,
      bState: b.state,
      toast: toast ? toast.textContent : ''
    };
  });
  check(
    'a viewer cannot add, activate or close a cycle',
    viewer.cycles === viewer.before && viewer.bState === 'active' && /View-only/.test(viewer.toast),
    viewer
  );

  // ---- 12. no runtime errors -------------------------------------------
  check('no page or console error during the run', errors.length === 0, errors.slice(0, 5));

  await browser.close();
  if (server) {
    server.kill();
  }

  const failed = results.filter(r => !r.ok);
  log('');
  log(results.length - failed.length + '/' + results.length + ' gates passed');
  process.exit(failed.length ? 1 : 0);
})().catch(err => {
  log('FATAL: ' + (err && err.stack ? err.stack : String(err)));
  process.exit(1);
});
