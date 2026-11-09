#!/usr/bin/env node
/* ============================================================
   tools/qa-pages.cjs - project book gate (AppFlowy-inspired)
   ------------------------------------------------------------
   Runs against a real browser and the real bundle. Proves:
     1. the Documents panel carries the Register / Pages switcher
     2. switching to Pages shows the tree
     3. a page is created and its title is focused for immediate typing
     4. renaming updates the tree in place
     5. pages nest three deep
     6. siblings reorder
     7. the tree survives a reload identically
     8. a move into the page's own descendant is refused
     9. all six block types can be added
    10. block text persists in state
    11. a checklist item toggles
    12. a block moves up
    13. a block is removed
    14. deleting a parent reports the child count and removes the descendants
    15. a task block lists the tasks the WBS holds
    16. a filter narrows a live block without touching the WBS
    17. completing a task in the WBS empties the filtered block
    18. removing a register row drops it from the document block
    19. read-only refuses a write with the standard toast
    20. read-only still lets a viewer open and select pages
    21. a viewer sees the live lists and no filter controls
    22. no page or console error during the run

   Usage:  node tools/qa-pages.cjs
   Env:    QA_BASE (default http://127.0.0.1:8765), CHROME_PATH
   Registry: docs/CI-TEST-COVERAGE.md -> extended-qa row.
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const BASE = (process.env.QA_BASE || 'http://127.0.0.1:8765').replace(/\/$/, '');
const log = s => process.stdout.write('[pages] ' + s + '\n');
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
  // project.html redirects ?id=<x> to the app lock screen unless the project
  // is unlocked; the first-run tour would also sit over the panel.
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

  const dialogs = [];
  page.on('dialog', async d => {
    dialogs.push(d.message());
    await d.accept();
  });

  await page.goto(BASE + '/project.html?id=demo-project', {
    waitUntil: 'load',
    timeout: 60000
  });
  await page.waitForFunction(
    () => !!(window.MMGR && window.MMGR.App && window.MMGR.Pages && window.MMGR.RenderPages),
    null,
    { timeout: 30000 }
  );
  await sleep(800);

  // ---- seed an empty book ----------------------------------------------
  await page.evaluate(() => {
    window.MMGR.State.updateState(s => {
      s.pages = [];
      s.pageSel = '';
      s.docsView = 'pages';
    });
    window.MMGR.State.save(true);
    window.MMGR.Render.showSection('docs', document.querySelector('.sec-btn[data-section="docs"]'));
  });
  await sleep(300);

  // ---- 1. switcher ------------------------------------------------------
  const switcher = await page.$$eval('[data-action="setDocsView"]', els =>
    els.map(e => ({ view: e.getAttribute('data-view'), pressed: e.getAttribute('aria-pressed') }))
  );
  check(
    'the Documents panel carries the Register / Pages switcher',
    switcher.length === 2 &&
      switcher.some(s => s.view === 'register') &&
      switcher.some(s => s.view === 'pages'),
    switcher
  );

  // ---- 2. pages view ----------------------------------------------------
  await page.waitForSelector('#docs-pages:not([hidden])', { timeout: 10000 });
  check('switching to Pages shows the tree container', true);

  // ---- 3. create + focus ------------------------------------------------
  await page.locator('[data-action="addPage"]').filter({ visible: true }).first().click();
  await page.waitForSelector('#pg-title');
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.id);
  const created = await page.evaluate(() => window.MMGR.State.getState().pages.length);
  check('a new page is created with its title focused', created === 1 && focused === 'pg-title', {
    created,
    focused
  });

  // ---- 4. rename --------------------------------------------------------
  await page.fill('#pg-title', 'Project book');
  await page.locator('#pg-title').evaluate(el => el.blur());
  await sleep(350);
  const renamed = await page.evaluate(() => ({
    state: window.MMGR.State.getState().pages[0].title,
    label: document.querySelector('[data-page-row] .pg-tw').textContent
  }));
  check(
    'renaming updates the tree in place',
    renamed.state === 'Project book' && renamed.label === 'Project book',
    renamed
  );

  // ---- 5. nest three deep ----------------------------------------------
  const rootId = await page.evaluate(() => window.MMGR.State.getState().pages[0].id);
  const scopeId = await page.evaluate(id => {
    window.MMGR.App.addPage(id);
    return window.MMGR.State.getState().pageSel;
  }, rootId);
  await page.waitForTimeout(250);
  await page.fill('#pg-title', 'Scope');
  await page.locator('#pg-title').evaluate(el => el.blur());
  await sleep(250);
  await page.evaluate(id => window.MMGR.App.addPage(id), scopeId);
  await page.waitForTimeout(250);
  await page.fill('#pg-title', 'Method statements');
  await page.locator('#pg-title').evaluate(el => el.blur());
  await sleep(250);
  const nested = await page.evaluate(() =>
    window.MMGR.Pages.flatten(window.MMGR.State.getState()).map(r => [r.page.title, r.depth])
  );
  check(
    'pages nest three deep',
    JSON.stringify(nested) ===
      JSON.stringify([
        ['Project book', 0],
        ['Scope', 1],
        ['Method statements', 2]
      ]),
    nested
  );

  // ---- 6. reorder siblings ---------------------------------------------
  await page.evaluate(id => window.MMGR.App.addPage(id), scopeId);
  await page.waitForTimeout(200);
  await page.fill('#pg-title', 'Inspections');
  await page.locator('#pg-title').evaluate(el => el.blur());
  await sleep(250);
  const beforeOrder = await page.evaluate(() =>
    window.MMGR.Pages.flatten(window.MMGR.State.getState())
      .filter(r => r.depth === 2)
      .map(r => r.page.title)
  );
  const inspectionsId = await page.evaluate(
    () =>
      window.MMGR.Pages.flatten(window.MMGR.State.getState()).find(
        r => r.page.title === 'Inspections'
      ).page.id
  );
  await page.evaluate(id => window.MMGR.App.movePageSibling(id, 'up'), inspectionsId);
  await page.waitForTimeout(250);
  const afterOrder = await page.evaluate(() =>
    window.MMGR.Pages.flatten(window.MMGR.State.getState())
      .filter(r => r.depth === 2)
      .map(r => r.page.title)
  );
  check(
    'a sibling reorders within its parent',
    JSON.stringify(beforeOrder) === JSON.stringify(['Method statements', 'Inspections']) &&
      JSON.stringify(afterOrder) === JSON.stringify(['Inspections', 'Method statements']),
    { beforeOrder, afterOrder }
  );

  // ---- 7. reload identical ---------------------------------------------
  await page.evaluate(() => window.MMGR.State.save(true));
  await sleep(400);
  const beforeReload = await page.evaluate(() =>
    window.MMGR.Pages.flatten(window.MMGR.State.getState()).map(r => [r.page.title, r.depth])
  );
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(
    () => !!(window.MMGR && window.MMGR.Pages && window.MMGR.RenderPages),
    null,
    { timeout: 30000 }
  );
  await sleep(500);
  const afterReload = await page.evaluate(() =>
    window.MMGR.Pages.flatten(window.MMGR.State.getState()).map(r => [r.page.title, r.depth])
  );
  check(
    'the tree survives a reload identically',
    JSON.stringify(beforeReload) === JSON.stringify(afterReload),
    { beforeReload, afterReload }
  );

  // A reload boots to the dashboard; reopen Documents for the rest of the run.
  await page.evaluate(() => {
    window.MMGR.Render.showSection('docs', document.querySelector('.sec-btn[data-section="docs"]'));
  });
  await page.waitForTimeout(400);

  // ---- 8. refuse a move into a descendant -------------------------------
  const descendantId = await page.evaluate(
    () =>
      window.MMGR.Pages.flatten(window.MMGR.State.getState()).find(
        r => r.page.title === 'Method statements'
      ).page.id
  );
  const refused = await page.evaluate(
    ([root, child]) => {
      const res = window.MMGR.App.movePage(root, child);
      const page = window.MMGR.Pages.find(window.MMGR.State.getState(), root);
      return { res, parentId: page.parentId };
    },
    [rootId, descendantId]
  );
  check(
    'a move into the page own descendant is refused',
    refused.res && refused.res.ok === false && refused.res.reason === 'descendant',
    refused
  );

  // ---- 9-13. blocks -----------------------------------------------------
  await page.evaluate(id => window.MMGR.App.selectPage(id), rootId);
  await page.waitForTimeout(250);
  for (const type of ['heading', 'bullet', 'checklist', 'callout', 'divider']) {
    await page
      .locator('[data-action="addBlock"][data-type="' + type + '"]')
      .filter({ visible: true })
      .first()
      .click();
    await page.waitForTimeout(120);
  }
  const types = await page.evaluate(() =>
    window.MMGR.Pages.find(
      window.MMGR.State.getState(),
      window.MMGR.State.getState().pageSel
    ).blocks.map(b => b.type)
  );
  check(
    'all six block types can be added',
    JSON.stringify(types) ===
      JSON.stringify(['paragraph', 'heading', 'bullet', 'checklist', 'callout', 'divider']),
    types
  );

  // Type into the paragraph and the heading.
  const textareas = page.locator('.pg-blocks textarea');
  const taCount = await textareas.count();
  if (taCount >= 2) {
    await textareas.nth(0).fill('The reasoning behind the price.');
    await textareas.nth(1).fill('Method statement');
    await page.locator('#pg-title').evaluate(el => el.blur());
    await sleep(400);
  }
  const typed = await page.evaluate(() =>
    window.MMGR.Pages.find(window.MMGR.State.getState(), window.MMGR.State.getState().pageSel)
      .blocks.filter(b => b.text)
      .map(b => b.text)
  );
  check(
    'block text persists in state',
    typed.indexOf('The reasoning behind the price.') > -1 && typed.indexOf('Method statement') > -1,
    typed
  );

  // Checklist toggle.
  const cb = page.locator('.pg-b-checklist input[type="checkbox"]').first();
  await cb.check();
  await sleep(300);
  const done = await page.evaluate(() => {
    const p = window.MMGR.Pages.find(
      window.MMGR.State.getState(),
      window.MMGR.State.getState().pageSel
    );
    const b = p.blocks.find(x => x.type === 'checklist');
    return b ? b.done : null;
  });
  check('a checklist item toggles', done === true, done);

  // Move the divider up one and remove it.
  const dividerId = await page.evaluate(() => {
    const p = window.MMGR.Pages.find(
      window.MMGR.State.getState(),
      window.MMGR.State.getState().pageSel
    );
    return p.blocks.find(b => b.type === 'divider').id;
  });
  await page.evaluate(
    id => window.MMGR.App.moveBlock(window.MMGR.State.getState().pageSel, id, 'up'),
    dividerId
  );
  await sleep(250);
  const movedTypes = await page.evaluate(() =>
    window.MMGR.Pages.find(
      window.MMGR.State.getState(),
      window.MMGR.State.getState().pageSel
    ).blocks.map(b => b.type)
  );
  check('a block moves up', movedTypes.indexOf('divider') === movedTypes.length - 2, movedTypes);
  await page.evaluate(
    id => window.MMGR.App.delBlock(window.MMGR.State.getState().pageSel, id),
    dividerId
  );
  await sleep(250);
  const removedTypes = await page.evaluate(() =>
    window.MMGR.Pages.find(
      window.MMGR.State.getState(),
      window.MMGR.State.getState().pageSel
    ).blocks.map(b => b.type)
  );
  check('a block is removed', removedTypes.indexOf('divider') < 0, removedTypes);

  // ---- 14. delete a parent ---------------------------------------------
  await page.evaluate(() => {
    window.MMGR.State.updateState(s => {
      const p = window.MMGR.Pages.newPage(s, { title: 'Handover' });
      window.MMGR.Pages.newPage(s, { parentId: p.id, title: 'Index' });
      window.MMGR.Pages.newPage(s, { parentId: p.id, title: 'Certificates' });
      s.pageSel = p.id;
    });
  });
  await page.waitForTimeout(300);
  const handoverId = await page.evaluate(
    () =>
      window.MMGR.Pages.flatten(window.MMGR.State.getState()).find(r => r.page.title === 'Handover')
        .page.id
  );
  await page.evaluate(id => window.MMGR.App.delPage(id), handoverId);
  await page.waitForTimeout(400);
  const deleteResult = await page.evaluate(
    id => ({
      gone: window.MMGR.Pages.find(window.MMGR.State.getState(), id) === null,
      titles: window.MMGR.Pages.flatten(window.MMGR.State.getState()).map(r => r.page.title)
    }),
    handoverId
  );
  const confirmMsg = dialogs[dialogs.length - 1] || '';
  check(
    'deleting a parent reports the child count and removes the descendants',
    /2 child pages/.test(confirmMsg) &&
      deleteResult.gone &&
      deleteResult.titles.indexOf('Index') < 0 &&
      deleteResult.titles.indexOf('Certificates') < 0,
    { confirmMsg, deleteResult }
  );

  // ---- 15-18. live blocks ----------------------------------------------
  // A live block reads the owning panel at draw time: nothing is copied into
  // the page, so a change in the WBS or the register shows up on return.
  const liveIds = await page.evaluate(() => {
    let pageId = '';
    const ids = {};
    window.MMGR.State.updateState(s => {
      const row = (id, name, level, isPhase, status, assignee, endDate) => ({
        id,
        name,
        level,
        indent: level,
        isPhase,
        status,
        startDate: '2026-11-02',
        endDate,
        duration: '5',
        assignee,
        critical: false,
        leadTime: false,
        recurring: false,
        weatherExposed: false,
        confidence: 'high',
        predecessors: [],
        notes: '',
        weatherSensitive: false
      });
      s.tasks = [
        row('T-phase', 'Structure', 0, true, 'todo', '', ''),
        row('T-setup', 'Site setup', 1, false, 'inprogress', 'Ana', '2026-11-20'),
        row('T-pour', 'Blast and pour', 1, false, 'todo', 'Ben', '2026-12-04')
      ];
      s.documents = [
        {
          id: 'D-1',
          docNo: 'A-101',
          title: 'Foundation drawing',
          type: 'Drawing',
          status: 'current'
        },
        {
          id: 'D-2',
          docNo: 'C-200',
          title: 'Main contract',
          type: 'Contract',
          status: 'pending-review'
        }
      ];
      const p = window.MMGR.Pages.newPage(s, { title: 'Live lens' });
      pageId = p.id;
      ids.task = window.MMGR.Pages.addBlock(s, p.id, 'taskList').id;
      ids.doc = window.MMGR.Pages.addBlock(s, p.id, 'docList').id;
      s.pageSel = p.id;
      s.docsView = 'pages';
    });
    window.MMGR.State.save(true);
    window.MMGR.Render.showSection('docs', document.querySelector('.sec-btn[data-section="docs"]'));
    window.MMGR.Render.renderPages();
    return { pageId, task: ids.task, doc: ids.doc };
  });
  await page.waitForTimeout(400);

  const taskRows = await page.$$eval('.pg-b-taskList .pg-lr .pg-lt', els =>
    els.map(e => e.textContent)
  );
  check(
    'a task block lists the tasks the WBS holds',
    JSON.stringify(taskRows) === JSON.stringify(['Site setup', 'Blast and pour']),
    taskRows
  );

  await page.selectOption('.pg-b-taskList .pg-f[data-key="status"]', 'todo');
  await page.waitForTimeout(400);
  const narrowed = await page.$$eval('.pg-b-taskList .pg-lr .pg-lt', els =>
    els.map(e => e.textContent)
  );
  const wbsIntact = await page.evaluate(
    () => window.MMGR.State.getState().tasks.filter(t => !t.isPhase).length
  );
  check(
    'a filter narrows a live block without touching the WBS',
    JSON.stringify(narrowed) === JSON.stringify(['Blast and pour']) && wbsIntact === 2,
    { narrowed, wbsIntact }
  );

  await page.evaluate(() => {
    window.MMGR.State.updateState(s => {
      const t = s.tasks.find(x => x.id === 'T-pour');
      if (t) {
        t.status = 'completed';
      }
    });
    window.MMGR.State.save(true);
  });
  // The block is a lens: it re-reads the WBS when the reader comes back.
  await page.evaluate(() => {
    window.MMGR.Render.showSection('wbs', document.querySelector('.sec-btn[data-section="wbs"]'));
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    window.MMGR.Render.showSection('docs', document.querySelector('.sec-btn[data-section="docs"]'));
  });
  await page.waitForTimeout(400);
  const afterComplete = await page.$$eval('.pg-b-taskList .pg-lr .pg-lt', els =>
    els.map(e => e.textContent)
  );
  const taskEmpty = await page
    .$eval('.pg-b-taskList .pg-empty', e => e.textContent)
    .catch(() => '');
  check(
    'completing a task in the WBS empties the filtered block',
    afterComplete.length === 0 && /To do/.test(taskEmpty),
    { afterComplete, taskEmpty }
  );

  const docBefore = await page.$$eval('.pg-b-docList .pg-lr .pg-lt', els =>
    els.map(e => e.textContent)
  );
  await page.evaluate(() => {
    window.MMGR.State.updateState(s => {
      s.documents = s.documents.filter(d => d.docNo !== 'C-200');
    });
    window.MMGR.State.save(true);
    window.MMGR.Render.showSection('wbs', document.querySelector('.sec-btn[data-section="wbs"]'));
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    window.MMGR.Render.showSection('docs', document.querySelector('.sec-btn[data-section="docs"]'));
  });
  await page.waitForTimeout(400);
  const docAfter = await page.$$eval('.pg-b-docList .pg-lr .pg-lt', els =>
    els.map(e => e.textContent)
  );
  check(
    'removing a register row drops it from the document block',
    docBefore.length === 2 && docAfter.indexOf('Main contract') < 0,
    { docBefore, docAfter }
  );

  // ---- 19-21. read-only -------------------------------------------------
  await page.evaluate(() => {
    window.MMGR.scope = 'readonly';
  });
  const countBefore = await page.evaluate(() => window.MMGR.State.getState().pages.length);
  await page.evaluate(() => window.MMGR.App.addPage(''));
  await sleep(300);
  const countAfter = await page.evaluate(() => window.MMGR.State.getState().pages.length);
  const toast = await page.evaluate(() => {
    const t = document.querySelector('.toast, #toast, [data-toast]');
    return t ? t.textContent : '';
  });
  check(
    'read-only refuses a write with the standard toast',
    countAfter === countBefore && /View-only/.test(toast),
    { countBefore, countAfter, toast }
  );
  await page.evaluate(id => window.MMGR.App.selectPage(id), liveIds.pageId);
  await page.waitForTimeout(350);
  const viewer = await page.evaluate(() => ({
    selects: document.querySelectorAll('.pg-b-taskList .pg-f, .pg-b-docList .pg-f').length,
    notes: document.querySelectorAll('.pg-fnote').length,
    rows: document.querySelectorAll('.pg-b-taskList .pg-lr').length
  }));
  check(
    'a viewer sees the live lists and no filter controls',
    viewer.selects === 0 && viewer.notes === 2,
    viewer
  );
  const selected = await page.evaluate(id => {
    window.MMGR.App.selectPage(id);
    return window.MMGR.State.getState().pageSel === id;
  }, rootId);
  check('read-only still lets a viewer open and select pages', selected, selected);
  await page.evaluate(() => {
    window.MMGR.scope = 'full';
  });

  // ---- 22. no runtime errors -------------------------------------------
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
