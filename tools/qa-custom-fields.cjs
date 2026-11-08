#!/usr/bin/env node
/* ============================================================
   tools/qa-custom-fields.cjs - C1 NocoBase-style custom task fields
   ---------------------------------------------------------------
   The unit suite (test/custom-fields-model.test.mjs) proves the schema
   rules in a vm sandbox. This gate proves the whole feature in a real
   browser: the delegated actions, the sheet, the dynamic WBS header,
   the card chips, the board filter, persistence and the view-only guard.

   Gates:
     C1  a text field added in the Fields sheet becomes a WBS column
     C2  a per-task value persists across reload and stays on its row
     C3  a select field with WBS + Card shows on the card as a chip
     C4  the board filter narrows every column to the chosen value
     C5  clearing the value restores every card
     C6  Required + empty value renders the REQ badge on that row
     C7  removing a field drops the column, the chips and the filter
     C8  view-only: the sheet opens but Add field is refused, and the
         filter selects are disabled
     C9  zero uncaught page errors through the whole walk

   Usage:  node tools/qa-custom-fields.cjs
   Exit:   0 = all gates pass, 1 = any gate failed
   ============================================================ */
'use strict';
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8765);
const BASE = process.env.BASE || 'http://127.0.0.1:' + PORT;
const PID = 'qa-cf-1';
const delay = ms => new Promise(r => setTimeout(r, ms));

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

const seedTasks = () => ({
  tasks: [
    {
      id: 't1',
      name: 'A',
      level: 0,
      indent: 0,
      isPhase: false,
      status: 'todo',
      startDate: '',
      endDate: '',
      duration: '',
      assignee: '',
      critical: false,
      leadTime: false,
      recurring: false,
      weatherExposed: false,
      confidence: 'high',
      predecessors: [],
      notes: '',
      weatherSensitive: false,
      custom: {}
    },
    {
      id: 't2',
      name: 'B',
      level: 0,
      indent: 0,
      isPhase: false,
      status: 'todo',
      startDate: '',
      endDate: '',
      duration: '',
      assignee: '',
      critical: false,
      leadTime: false,
      recurring: false,
      weatherExposed: false,
      confidence: 'high',
      predecessors: [],
      notes: '',
      weatherSensitive: false,
      custom: {}
    },
    {
      id: 't3',
      name: 'C',
      level: 0,
      indent: 0,
      isPhase: false,
      status: 'todo',
      startDate: '',
      endDate: '',
      duration: '',
      assignee: '',
      critical: false,
      leadTime: false,
      recurring: false,
      weatherExposed: false,
      confidence: 'high',
      predecessors: [],
      notes: '',
      weatherSensitive: false,
      custom: {}
    }
  ]
});

(async () => {
  let srv = await ensureServer();
  const { chromium } = require('playwright');
  const browser = await chromium.launch({
    headless: true,
    executablePath: require('./chrome-launcher.cjs').chromePath,
    args: ['--disk-cache-size=0', '--no-sandbox']
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e && e.message ? e.message : e)));

  const url = BASE + '/project.html?id=' + PID;
  // project.html sends a locked visitor back to app.html, and a project in
  // this device's admin working list opens with full scope. Seed that list
  // from a same-origin page before the first project navigation.
  await page.goto(BASE + '/app.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(id => {
    localStorage.setItem('mmgr_admin_projects', JSON.stringify([{ id: id }]));
  }, PID);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.MMGR && window.MMGR.State), null, { timeout: 15000 });

  // Seed three tasks in the persisted state, then reload so the app boots
  // with them (the same path a real project file takes).
  await page.evaluate(seed => {
    const s = window.MMGR.State.getState();
    s.tasks = seed.tasks;
    window.MMGR.State.save(true);
  }, seedTasks());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.MMGR && window.MMGR.CustomFields), null, {
    timeout: 15000
  });

  // The nav rail can be collapsed at boot, so switch sections through the
  // delegated action itself rather than through a visible click target.
  const showSection = async sec => {
    await page.evaluate(s => {
      const el = document.querySelector('[data-action="showSec"][data-section="' + s + '"]');
      if (el) el.click();
    }, sec);
    await delay(300);
  };
  const openWbs = () => showSection('wbs');
  const openKanban = () => showSection('kan');
  const openFields = async () => {
    await page.click('#panel-wbs [data-action="openFields"]', { force: true });
    await delay(150);
  };
  const closeFields = async () => {
    await page.click('#cf-modal [data-action="closeFields"]', { force: true });
    await delay(150);
  };
  const cfKey = async label => {
    const key = await page.evaluate(l => {
      const s = window.MMGR.State.getState();
      const f = window.MMGR.CustomFields.list(s).find(x => x.label === l);
      return f ? f.key : null;
    }, label);
    return key;
  };

  await openWbs();

  // ---- C1: add a text field -> WBS column ----
  await openFields();
  await page.fill('#cf-label', 'Permit no.');
  await page.selectOption('#cf-type', 'text');
  await page.click('[data-action="addCustomField"]', { force: true });
  await delay(250);
  const head1 = await page.textContent('#wbs-head-row');
  check('C1 text field becomes a WBS column', /Permit no\./.test(head1 || ''), head1);

  // ---- C2: per-task value persists across reload ----
  const permitKey = await cfKey('Permit no.');
  await page.fill(`#wbs-body tr[data-id="t1"] td.wbs-cf input`, 'P-104');
  await page.press(`#wbs-body tr[data-id="t1"] td.wbs-cf input`, 'Tab');
  await delay(250);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.MMGR && window.MMGR.CustomFields), null, {
    timeout: 15000
  });
  await openWbs();
  const v1 = await page.inputValue(`#wbs-body tr[data-id="t1"] td.wbs-cf input`);
  const v2 = await page.inputValue(`#wbs-body tr[data-id="t2"] td.wbs-cf input`);
  check('C2 value persists on its row and not on others', v1 === 'P-104' && v2 === '', {
    v1,
    v2
  });

  // ---- C3: select field -> card chip ----
  await openFields();
  await page.fill('#cf-label', 'Zone');
  await page.selectOption('#cf-type', 'select');
  await page.fill('#cf-options', 'North, South');
  await page.check('#cf-wbs');
  await page.check('#cf-card');
  await page.click('[data-action="addCustomField"]', { force: true });
  await delay(250);
  await closeFields();
  const zoneKey = await cfKey('Zone');
  await page.selectOption(`#wbs-body tr[data-id="t1"] td.wbs-cf select`, 'North');
  await page.selectOption(`#wbs-body tr[data-id="t2"] td.wbs-cf select`, 'North');
  await page.selectOption(`#wbs-body tr[data-id="t3"] td.wbs-cf select`, 'South');
  await delay(300);
  await openKanban();
  const cards = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#kc-todo .kc')).map(el => ({
      id: el.getAttribute('data-id'),
      text: el.textContent || ''
    }))
  );
  const cardA = cards.find(c => c.id === 't1');
  const cardC = cards.find(c => c.id === 't3');
  check(
    'C3 select value shows as a card chip',
    !!(cardA && /Zone/.test(cardA.text) && /North/.test(cardA.text)) &&
      !!(cardC && /South/.test(cardC.text)),
    cards
  );

  // ---- C4: board filter narrows every column ----
  await page.selectOption('#kb-cf-key', zoneKey);
  await page.selectOption('#kb-cf-val', 'North');
  await delay(250);
  const filtered = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#kc-todo .kc')).map(el => el.getAttribute('data-id'))
  );
  check(
    'C4 board filter shows only matching cards',
    filtered.length === 2 && filtered.indexOf('t1') > -1 && filtered.indexOf('t2') > -1,
    filtered
  );

  // ---- C5: clearing the value restores every card ----
  await page.selectOption('#kb-cf-val', '');
  await delay(250);
  const restored = await page.evaluate(() => document.querySelectorAll('#kc-todo .kc').length);
  check('C5 clearing the filter restores every card', restored === 3, restored);

  // ---- C6: required + empty -> REQ badge ----
  await openWbs();
  await openFields();
  const reqBox = `#cf-list .cf-row[data-key="${permitKey}"] input[data-prop="required"]`;
  await page.check(reqBox);
  await delay(200);
  await closeFields();
  await page.fill(`#wbs-body tr[data-id="t1"] td.wbs-cf input`, '');
  await page.press(`#wbs-body tr[data-id="t1"] td.wbs-cf input`, 'Tab');
  await delay(300);
  const row1 = await page.textContent('#wbs-body tr[data-id="t1"]');
  check('C6 required + empty shows the REQ badge', /REQ/.test(row1 || ''), row1);

  // ---- C7: removing a field clears column, chips and filter ----
  await openFields();
  await page.click(`#cf-list .cf-row[data-key="${zoneKey}"] [data-action="delCustomField"]`, {
    force: true
  });
  await delay(200);
  await page.click('#cfm-ok', { force: true });
  await delay(350);
  await closeFields();
  const head2 = await page.textContent('#wbs-head-row');
  const filterNow = await page.evaluate(() => {
    const s = window.MMGR.State.getState();
    return window.MMGR.CustomFields.filter(s);
  });
  await openKanban();
  const chipsAfter = await page.evaluate(() => document.querySelectorAll('.kcf-chip').length);
  check(
    'C7 removing the field clears column, chips and filter',
    !/Zone/.test(head2 || '') && chipsAfter === 0 && filterNow.key === '',
    { head2, chipsAfter, filterNow }
  );

  // ---- C8: view-only refuses the mutation and disables the filter ----
  await page.evaluate(id => {
    // A locally-owned project always opens with full scope, so the read-only
    // path is the shared-code path: unlocked, plus the view-only scope flag.
    localStorage.removeItem('mmgr_admin_projects');
    localStorage.setItem('mmgr_unlocked_' + id, '1');
    localStorage.setItem('mmgr_scope_' + id, 'readonly');
  }, PID);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.MMGR && window.MMGR.CustomFields), null, {
    timeout: 15000
  });
  await openWbs();
  await openFields();
  const before = await page.evaluate(
    () => window.MMGR.CustomFields.list(window.MMGR.State.getState()).length
  );
  await page.fill('#cf-label', 'Should not land');
  await page.click('[data-action="addCustomField"]', { force: true });
  await delay(250);
  const after = await page.evaluate(
    () => window.MMGR.CustomFields.list(window.MMGR.State.getState()).length
  );
  await closeFields();
  await openKanban();
  const disabled = await page.evaluate(() => {
    const k = document.getElementById('kb-cf-key');
    const v = document.getElementById('kb-cf-val');
    return !!(k && v && k.disabled && v.disabled);
  });
  check(
    'C8 view-only refuses Add field and disables the filter',
    before === after && disabled === true,
    { before, after, disabled }
  );

  // ---- C9: no uncaught page errors ----
  check('C9 zero uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 4));

  await browser.close();
  if (srv) srv.kill();
  console.log('\n' + pass + ' gates passed, ' + fails.length + ' failed');
  if (fails.length) {
    console.log('Failed: ' + fails.join(' | '));
  }
  process.exit(fails.length ? 1 : 0);
})().catch(e => {
  console.error('HARNESS ERROR: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
