/* ============================================================
   qa-relations.cjs - Work package relations (plan-openproject)
   ------------------------------------------------------------
   The regression net for the whole relations feature, in the
   plan's own step order. It proves, in a real browser against
   serve.cjs:

     (1) the WBS Links badge exists at ZERO links and opens the
         task-links sheet - the door must exist before the first
         link does, or the feature has no entry point;
     (2) adding "A blocks B" from the sheet lists the link and
         B's WBS badge reads "Blocked 1";
     (3) B's Kanban card carries the same "Blocked 1" badge;
     (4) the board lens narrows the board: "Blocked only" shows
         exactly B (with the empty-lens note elsewhere), "Ready
         only" shows A and C and never B;
     (5) dragging B into In Progress warns "Blocked by A" and
         the move still happens (a block warns, never locks);
     (6) the relation AND the lens both survive a reload
         (State.updateState -> debounced save);
     (7) a view-only session can OPEN the sheet, but "Add link"
         is refused with the standard view-only toast;
     (8) no uncaught page error during the run.

   Usage:  node tools/qa-relations.cjs
   Registry: docs/CI-TEST-COVERAGE.md -> CI row (T4 battery).
   ============================================================ */
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const PORT = Number(process.env.PORT || 8765);
const BASE = process.env.BASE || 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');
const log = s => process.stdout.write('[relations] ' + s + '\n');
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
        JSON.stringify(detail === undefined ? null : detail).slice(0, 600)
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
  } catch (e) {
    /* fall back */
  }
  return undefined;
}
const toastText = page =>
  page.evaluate(() => (document.querySelector('.toast') || {}).textContent || '');
const goWbs = page =>
  page.evaluate(() =>
    document.querySelector('[data-action="showSec"][data-section="wbs"]').click()
  );
const goKan = page =>
  page.evaluate(() =>
    document.querySelector('[data-action="showSec"][data-section="kan"]').click()
  );

(async () => {
  if (!process.env.BASE) {
    let up = false;
    try {
      up = (await fetch(BASE + '/project.html')).ok;
    } catch (e) {}
    if (!up) {
      log('starting serve.cjs for this run');
      global.__srv = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
      for (let i = 0; i < 30; i++) {
        await delay(1000);
        try {
          if ((await fetch(BASE + '/project.html')).ok) {
            break;
          }
        } catch (e) {}
      }
    }
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
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  let pageErrors = 0;
  page.on('pageerror', e => {
    pageErrors++;
    log('page error: ' + String((e && e.message) || e).slice(0, 200));
  });

  // ---- boot: seed-test writes the demo projects, then a real workspace ----
  await page.goto(BASE + '/seed-test.html', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(
    () =>
      /project\.html/.test(location.pathname + location.search) && window.MMGR && window.MMGR.App,
    null,
    { timeout: 45000 }
  );
  const url = page.url();
  const pid = await page.evaluate(() => window.MMGR.projectId);

  // Three plain todo tasks, no links, fresh lens - the plan's fixture.
  await page.evaluate(() => {
    window.MMGR.State.updateState(s => {
      s.tasks = [
        {
          id: 'A',
          name: 'A',
          status: 'todo',
          level: 0,
          indent: 0,
          predecessors: [],
          relations: []
        },
        {
          id: 'B',
          name: 'B',
          status: 'todo',
          level: 0,
          indent: 0,
          predecessors: [],
          relations: []
        },
        { id: 'C', name: 'C', status: 'todo', level: 0, indent: 0, predecessors: [], relations: [] }
      ];
      s.relLens = 'all';
    });
    window.MMGR.Render.renderWbs();
    window.MMGR.Render.renderKanban();
  });
  await page.waitForTimeout(500);
  await goWbs(page);
  await page.waitForTimeout(400);

  // ---- (1) the zero-link badge opens the sheet ----
  const g1 = await page.evaluate(() => {
    const badge = document.querySelector('[data-action="openRel"][data-id="A"]');
    if (!badge) {
      return { exists: false };
    }
    badge.click();
    const modal = document.getElementById('rel-modal');
    return {
      exists: true,
      label: badge.textContent.trim(),
      opened:
        !!modal && modal.classList.contains('on') && getComputedStyle(modal).display !== 'none'
    };
  });
  check(
    'the Links badge exists with zero links and opens the task-links sheet',
    g1.exists && g1.opened && g1.label === 'Links',
    g1
  );

  // ---- (2) add "A blocks B"; the sheet lists it; B reads "Blocked 1" ----
  const g2 = await page.evaluate(() => {
    document.getElementById('rel-type').value = 'blocks';
    document.getElementById('rel-target').value = 'B';
    document.querySelector('[data-action="addRel"]').click();
    const rows = Array.from(document.querySelectorAll('#rel-list .rel-row')).map(r =>
      r.textContent.trim()
    );
    const bBadge = document.querySelector('[data-action="openRel"][data-id="B"]');
    const aSide = (window.MMGR.State.getState().tasks || []).find(t => t.id === 'A');
    return {
      rows,
      bLabel: bBadge ? bBadge.textContent.trim() : null,
      aLinks: aSide ? (aSide.relations || []).length : -1
    };
  });
  check(
    "adding A blocks B lists the link and B's WBS badge reads Blocked 1",
    g2.rows.length === 1 &&
      /Blocks/.test(g2.rows[0]) &&
      /B/.test(g2.rows[0]) &&
      g2.bLabel === 'Blocked 1' &&
      g2.aLinks === 1,
    g2
  );

  // ---- (3) B's Kanban card carries the same badge ----
  await goKan(page);
  await page.waitForTimeout(400);
  const g3 = await page.evaluate(() => {
    const card = document.querySelector('.kc[data-id="B"]');
    return card ? { found: true, text: card.textContent } : { found: false };
  });
  check("B's Kanban card carries Blocked 1", g3.found && /Blocked 1/.test(g3.text), g3);

  // ---- (4) the lens narrows the board both ways ----
  await page.selectOption('#kb-lens', 'blocked');
  await page.waitForTimeout(300);
  const g4a = await page.evaluate(() => ({
    ids: Array.from(document.querySelectorAll('.kc[data-id]')).map(c => c.getAttribute('data-id')),
    notes: Array.from(document.querySelectorAll('#kc-ip .es, #kc-bl .es, #kc-dn .es'))
      .map(n => n.textContent)
      .join(' '),
    lens: window.MMGR.State.getState().relLens
  }));
  await page.selectOption('#kb-lens', 'ready');
  await page.waitForTimeout(300);
  const g4b = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.kc[data-id]')).map(c => c.getAttribute('data-id'))
  );
  check(
    'Blocked only shows exactly B with an empty-lens note; Ready only shows A and C, never B',
    g4a.lens === 'blocked' &&
      g4a.ids.length === 1 &&
      g4a.ids[0] === 'B' &&
      /lens/.test(g4a.notes) &&
      g4b.includes('A') &&
      g4b.includes('C') &&
      !g4b.includes('B'),
    { blocked: g4a, ready: g4b }
  );

  // ---- (5) drag B -> In Progress: warns with A, still moves ----
  // B is hidden under "Ready only", so put the lens back where B shows.
  await page.selectOption('#kb-lens', 'blocked');
  await page.waitForTimeout(300);
  const g5 = await page.evaluate(() => {
    const card = document.querySelector('.kc[data-drag-id="B"]');
    const col = document.querySelector('[data-drop-status="inprogress"]');
    if (!card || !col) {
      return { ok: false, why: 'card or column missing' };
    }
    const dt = new DataTransfer();
    card.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    col.dispatchEvent(
      new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true })
    );
    col.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    const b = (window.MMGR.State.getState().tasks || []).find(t => t.id === 'B');
    return { ok: true, status: b && b.status };
  });
  await page.waitForTimeout(300);
  const g5toast = await toastText(page);
  check(
    'moving blocked B into In Progress warns "Blocked by A" and still moves',
    g5.ok && g5.status === 'inprogress' && /Blocked by A/.test(g5toast),
    { g5, toast: g5toast }
  );

  // ---- (6) reload: the relation AND the lens survived ----
  await page.waitForTimeout(700);
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.MMGR && window.MMGR.App && window.MMGR.Render, null, {
    timeout: 45000
  });
  await goKan(page);
  await page.waitForTimeout(500);
  const g6 = await page.evaluate(() => {
    const s = window.MMGR.State.getState();
    const a = (s.tasks || []).find(t => t.id === 'A');
    const b = (s.tasks || []).find(t => t.id === 'B');
    return {
      relLens: s.relLens,
      select: document.getElementById('kb-lens').value,
      aLinks: a ? (a.relations || []).length : -1,
      bStatus: b && b.status,
      cards: Array.from(document.querySelectorAll('.kc[data-id]')).map(c =>
        c.getAttribute('data-id')
      )
    };
  });
  check(
    'reload keeps the relation, the move, and the lens',
    g6.relLens === 'blocked' &&
      g6.select === 'blocked' &&
      g6.aLinks === 1 &&
      g6.bStatus === 'inprogress' &&
      g6.cards.length === 1 &&
      g6.cards[0] === 'B',
    g6
  );

  // ---- (7) view-only: the badge opens, "Add link" is refused ----
  await page.evaluate(id => localStorage.setItem('mmgr_scope_' + id, 'readonly'), pid);
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.MMGR && window.MMGR.App && window.MMGR.Render, null, {
    timeout: 45000
  });
  await goWbs(page);
  await page.waitForTimeout(400);
  const g7 = await page.evaluate(() => {
    const badge = document.querySelector('[data-action="openRel"][data-id="B"]');
    if (!badge) {
      return { exists: false };
    }
    badge.click();
    const modal = document.getElementById('rel-modal');
    const opened =
      !!modal && modal.classList.contains('on') && getComputedStyle(modal).display !== 'none';
    const before = (window.MMGR.State.getState().tasks || []).reduce(
      (n, t) => n + (t.relations || []).length,
      0
    );
    document.querySelector('[data-action="addRel"]').click();
    const after = (window.MMGR.State.getState().tasks || []).reduce(
      (n, t) => n + (t.relations || []).length,
      0
    );
    return { exists: true, opened, before, after };
  });
  await page.waitForTimeout(200);
  const g7toast = await toastText(page);
  check(
    'view-only: the badge opens the sheet, Add link is refused with the view-only toast',
    g7.exists && g7.opened && g7.before === 2 && g7.after === 2 && /View-only mode/.test(g7toast),
    { g7, toast: g7toast }
  );

  // ---- (8) no uncaught page error during the run ----
  check('no uncaught page error during the run', pageErrors === 0, pageErrors);

  await browser.close();
  if (global.__srv) {
    try {
      global.__srv.kill();
    } catch (e) {}
  }
  log('');
  log('RESULT  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => {
  log('HARNESS ERROR ' + String((e && e.stack) || e).slice(0, 800));
  process.exit(1);
});
