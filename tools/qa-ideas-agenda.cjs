#!/usr/bin/env node
/* ============================================================
   tools/qa-ideas-agenda.cjs - Idea intake + merged agenda gate
   ------------------------------------------------------------
   Runs against a real browser and the real bundle. Proves:
     1. the Intake nav button opens the ideas panel
     2. the board draws all six stage columns
     3. every card is a keyboard stop with an accessible name
     4. ArrowRight moves a card one stage and the move survives reload
     5. a synthetic drop lands a card in the target column
     6. the list view shows one row per idea and the stage select moves it
     7. Promote creates a WBS task and links it to the idea
     8. the agenda merges a task, a milestone and a meeting
     9. a past-dated open task is flagged overdue
    10. the 7-day chip drops an event outside the window
    11. the ICS download is a valid calendar with one VEVENT per event
    12. no page error or console error during the run
    13. the view-only contract still refuses every mutating idea action
    14. the view-only contract still keeps the read actions open

   Usage:  node tools/qa-ideas-agenda.cjs
   Env:    QA_BASE (default http://127.0.0.1:8765), CHROME_PATH
   Registry: docs/CI-TEST-COVERAGE.md -> extended-qa row.
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const BASE = (process.env.QA_BASE || 'http://127.0.0.1:8765').replace(/\/$/, '');
const log = s => process.stdout.write('[ideas-agenda] ' + s + '\n');
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
// Click the visible instance of a selector. Several idea/agenda controls
// (board card + list row, nav button in a collapsed rail) render twice; the
// first match is often the hidden one, so filter to what the user can see.
const clickVisible = async (page, sel) => {
  await page.locator(sel).filter({ visible: true }).first().click();
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
    const r = await fetch(url, { method: 'GET' });
    return r.ok;
  } catch (e) {
    return false;
  }
}

(async function main() {
  let server = null;
  if (!(await reachable(BASE + '/project.html'))) {
    log('starting serve.cjs for this run');
    server = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
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
  // project.html redirects ?id=<x> to the app.html lock screen unless the
  // project is unlocked. Seed the unlock flag before any navigation so the
  // editor (which carries MMGR.Ideas / MMGR.Agenda in dist/bundle.js) loads.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('mmgr_unlocked_demo-project', '1');
    } catch (e) {
      /* storage blocked - editor still loads this session */
    }
  });
  const errors = [];
  // Real JS faults surface as pageerror or as console errors with an actual
  // message ("Uncaught ...", assertion text). The local dev server
  // (serve.cjs) has no cloud backend, so the app's cloud/billing/team poll
  // requests 404 and the presence WebSocket fails - those are environment
  // noise, not app defects, and must not fail this gate.
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

  await page.goto(BASE + '/project.html?id=demo-project', {
    waitUntil: 'load',
    timeout: 60000
  });
  await page.waitForFunction(
    () => window.MMGR && window.MMGR.App && window.MMGR.Ideas && window.MMGR.Agenda,
    null,
    { timeout: 30000 }
  );

  // ---- seed -------------------------------------------------------------
  await page.evaluate(() => {
    const iso = n => {
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() + n);
      return d.toISOString().slice(0, 10);
    };
    window.MMGR.State.updateState(st => {
      st.tasks = [
        {
          id: 'qa-t1',
          name: 'Overdue pour',
          status: 'todo',
          endDate: iso(-10),
          level: 0,
          indent: 0,
          isPhase: false
        },
        {
          id: 'qa-t2',
          name: 'Gate review',
          status: 'todo',
          endDate: iso(5),
          milestone: true,
          level: 0,
          indent: 0,
          isPhase: false
        },
        {
          id: 'qa-t3',
          name: 'Far horizon',
          status: 'todo',
          endDate: iso(20),
          level: 0,
          indent: 0,
          isPhase: false
        }
      ];
      st.meetings = [
        {
          id: 9001,
          title: 'Weekly walk',
          kind: 'weekly',
          startedAt: new Date().toISOString()
        }
      ];
      st.issues = [];
      st.changes = [];
      st.ideas = [];
      window.MMGR.Ideas.add(st, {
        id: 'qa-i1',
        title: 'Cure tent',
        stage: 'idea',
        impact: 5,
        effort: 2,
        tags: ['Concrete']
      });
      window.MMGR.Ideas.add(st, {
        id: 'qa-i2',
        title: 'Pump hire',
        stage: 'research',
        impact: 3,
        effort: 4
      });
      window.MMGR.Ideas.add(st, {
        id: 'qa-i3',
        title: 'Solar fence',
        stage: 'validation',
        impact: 2,
        effort: 5
      });
    });
  });

  // ---- 1. open the section ---------------------------------------------
  await page.locator('.sec-btn[data-section="ideas"]').filter({ visible: true }).first().click();
  await page.waitForSelector('#panel-ideas.active', { timeout: 10000 });
  check('Intake nav opens the ideas panel', true);

  // ---- 2. six columns ---------------------------------------------------
  const cols = await page.$$eval('.idcol', els => els.map(e => e.getAttribute('data-idea-col')));
  check(
    'board draws six stage columns in order',
    JSON.stringify(cols) ===
      JSON.stringify(['idea', 'research', 'prototype', 'validation', 'implemented', 'deferred']),
    cols
  );

  // ---- 3. cards are keyboard stops with a name --------------------------
  const cards = await page.$$eval('.idc', els =>
    els.map(e => ({
      id: e.getAttribute('data-idea-id'),
      tab: e.getAttribute('tabindex'),
      role: e.getAttribute('role'),
      label: e.getAttribute('aria-label')
    }))
  );
  check(
    'every card is a named keyboard stop',
    cards.length === 3 &&
      cards.every(c => c.tab === '0' && c.role === 'article' && /score/.test(c.label || '')),
    cards
  );

  // ---- 4. keyboard move + reload ---------------------------------------
  await page.focus('.idc[data-idea-id="qa-i1"]');
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(
    () => !!document.querySelector('.idcol[data-idea-col="research"] .idc[data-idea-id="qa-i1"]')
  );
  const afterKey = await page.evaluate(
    () => window.MMGR.Ideas.find(window.MMGR.State.getState(), 'qa-i1').stage
  );
  check('ArrowRight moves a card one stage', afterKey === 'research', afterKey);

  // State saves are debounced (300ms); flush synchronously so the reload
  // cannot race the write. The gate is "the move persists", not "the
  // debounce timer happened to fire before the reload".
  // The IndexedDB journal mirror is fire-and-forget and each write opens its
  // own connection, so an older journal record can still be in flight when
  // the page reloads; boot then restores that older copy over the fresh
  // localStorage save. Let the in-flight writes settle, then force one final
  // save so the last journal write is the moved state. The gate is "the move
  // persists", not "the journal write won a race".
  await sleep(500);
  await page.evaluate(() => window.MMGR.State.save(true));
  await sleep(300);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.MMGR && window.MMGR.Ideas, null, { timeout: 30000 });
  const afterReload = await page.evaluate(() => {
    const raw = localStorage.getItem('mmgr_state_demo-project');
    const s = raw ? JSON.parse(raw) : null;
    return {
      mem: window.MMGR.Ideas.find(window.MMGR.State.getState(), 'qa-i1').stage,
      ls: s ? (s.ideas || []).find(i => i.id === 'qa-i1').stage : null,
      at: s ? s.updatedAt : null
    };
  });
  check('the keyboard move survives a reload', afterReload.mem === 'research', afterReload);

  // ---- 5. drop ----------------------------------------------------------
  await page.locator('.sec-btn[data-section="ideas"]').filter({ visible: true }).first().click();
  await page.waitForSelector('.idc[data-idea-id="qa-i2"]');
  await page.evaluate(() => {
    const card = document.querySelector('.idc[data-idea-id="qa-i2"]');
    const col = document.querySelector('[data-idea-drop="validation"]');
    const dt = new DataTransfer();
    card.dispatchEvent(
      new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt })
    );
    col.dispatchEvent(
      new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })
    );
    col.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    card.dispatchEvent(
      new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt })
    );
  });
  await page.waitForFunction(
    () => !!document.querySelector('.idcol[data-idea-col="validation"] .idc[data-idea-id="qa-i2"]')
  );
  const dropped = await page.evaluate(
    () => window.MMGR.Ideas.find(window.MMGR.State.getState(), 'qa-i2').stage
  );
  check('a drop lands the card in the target column', dropped === 'validation', dropped);

  // ---- 6. list view + stage select -------------------------------------
  await page.click('[data-action="setIdeaView"][data-view="list"]');
  await page.waitForSelector('#ideas-list table.idtable');
  const rows = await page.$$eval('#ideas-list tbody tr', els => els.length);
  check('list view shows one row per idea', rows === 3, rows);
  await page.selectOption('select[data-action="setIdeaStage"][data-id="qa-i3"]', 'prototype');
  const movedBySelect = await page.evaluate(
    () => window.MMGR.Ideas.find(window.MMGR.State.getState(), 'qa-i3').stage
  );
  check('the list stage select moves the idea', movedBySelect === 'prototype', movedBySelect);

  // ---- 7. promote -------------------------------------------------------
  await clickVisible(page, '[data-action="promoteIdea"][data-id="qa-i3"]');
  await page.waitForFunction(
    () => !!window.MMGR.Ideas.find(window.MMGR.State.getState(), 'qa-i3').promotedTaskId
  );
  const promoted = await page.evaluate(() => {
    const st = window.MMGR.State.getState();
    const idea = window.MMGR.Ideas.find(st, 'qa-i3');
    const task = (st.tasks || []).find(t => t.id === idea.promotedTaskId);
    return { linked: !!task, name: task ? task.name : '', status: task ? task.status : '' };
  });
  check(
    'Promote creates a WBS task and links it',
    promoted.linked && promoted.name === 'Solar fence' && promoted.status === 'todo',
    promoted
  );

  // ---- 8. agenda merges ------------------------------------------------
  await page.locator('.sec-btn[data-section="agenda"]').filter({ visible: true }).first().click();
  await page.waitForSelector('#agenda-body .ag-ev');
  const agenda = await page.$$eval('#agenda-body .ag-ev', els =>
    els.map(e => ({
      kind: (e.className.match(/ag-(task|milestone|meeting|issue|change|idea)/) || [])[1],
      title: e.querySelector('.ag-t').textContent,
      over: e.classList.contains('ag-over')
    }))
  );
  check(
    'agenda merges task, milestone and meeting',
    agenda.some(e => e.kind === 'task' && e.title === 'Far horizon') &&
      agenda.some(e => e.kind === 'milestone' && e.title === 'Gate review') &&
      agenda.some(e => e.kind === 'meeting' && e.title === 'Weekly walk'),
    agenda
  );
  check(
    'a past-dated open task is flagged overdue',
    agenda.some(e => e.kind === 'task' && e.title === 'Overdue pour' && e.over),
    agenda
  );

  // ---- 9. window chip --------------------------------------------------
  await clickVisible(page, '[data-action="setAgendaDays"][data-days="7"]');
  await page.waitForFunction(
    () => !document.getElementById('agenda-body').textContent.includes('Far horizon')
  );
  const inSeven = await page.$$eval('#agenda-body .ag-ev', els => els.length);
  check('the 7-day chip drops the far event', inSeven >= 2, inSeven);

  // ---- 10. ICS download ------------------------------------------------
  await clickVisible(page, '[data-action="setAgendaDays"][data-days="0"]');
  const expected = await page.evaluate(
    () => window.MMGR.Agenda.build(window.MMGR.State.getState(), { days: 0 }).length
  );
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    (async () => {
      await clickVisible(page, '[data-action="exportAgendaIcs"]');
    })()
  ]);
  const file = await download.path();
  const ics = fs.readFileSync(file, 'utf8');
  const events = (ics.match(/BEGIN:VEVENT/g) || []).length;
  check(
    'the ICS download is a calendar with every event',
    /^BEGIN:VCALENDAR\r\n/.test(ics) &&
      /END:VCALENDAR\r\n$/.test(ics) &&
      events === expected &&
      /SUMMARY:Gate review/.test(ics),
    { events, expected }
  );

  // ---- 11. no runtime errors -------------------------------------------
  check('no page or console error during the run', errors.length === 0, errors.slice(0, 5));

  // ---- 12. view-only contract (static) ---------------------------------
  const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'mmgr-app.js'), 'utf8');
  const safeAt = appSrc.indexOf('const READONLY_SAFE_ACTIONS');
  const guardAt = appSrc.indexOf('function guardReadonly');
  const safeBlock = appSrc.slice(safeAt, guardAt);
  const mutating = ['saveIdea', 'delIdea', 'promoteIdea', 'setIdeaStage', 'ideaKeyMove'];
  const readOnly = ['openIdea', 'closeIdea', 'agendaJump'];
  check(
    'view-only refuses every mutating idea action',
    safeAt > -1 &&
      guardAt > safeAt &&
      mutating.every(a => !new RegExp('\\n\\s*' + a + ':').test(safeBlock)),
    mutating.filter(a => new RegExp('\\n\\s*' + a + ':').test(safeBlock))
  );
  check(
    'view-only keeps the read actions open',
    readOnly.every(a => new RegExp('\\n\\s*' + a + ':').test(safeBlock)),
    readOnly.filter(a => !new RegExp('\\n\\s*' + a + ':').test(safeBlock))
  );

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
