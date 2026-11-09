#!/usr/bin/env node
/* ============================================================
   tools/qa-process.cjs - guarded transitions gate (Huly-inspired)
   ------------------------------------------------------------
   Runs against a real browser and the real bundle. Proves:
     1. the change register offers the five statuses
     2. approving a submitted change is refused, naming the missing step
     3. review without a name is refused and says where to set it
     4. with a name, review succeeds and the row shows it
     5. rejecting without a reason is refused
     6. with a reason, the rejection is accepted
     7. the happy path writes one history entry per move
     8. an impossible imported status is repaired on the next boot
     9. a viewer's move is refused by the read-only fence
    10. the change id opens its own history, newest last
    11. the project feed lists every move and filters by record type
    12. history survives a reload and the deletion of its record
    13. the Controls form declares a rule and the list reads it back
    14. the rule fires on its own event and the execution log says done
    15. a disabled rule does nothing
    16. a rule that would fire on another rule's action stops and says so
    17. a rule arriving in an imported file lands disabled
    18. the approval pack prints approved changes in date order with the counts
    19. the pack carries the local-time caveat in one plain sentence
    20. a rule's hook posts the small document, owner-gated, no extra fields
    21. a viewer can print the pack (printing is a read, not a write)
    22. no page or console error during the run

   Usage:  node tools/qa-process.cjs
   Env:    QA_BASE (default http://127.0.0.1:8765), CHROME_PATH
   Registry: docs/CI-TEST-COVERAGE.md -> extended-qa row.
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const BASE = (process.env.QA_BASE || 'http://127.0.0.1:8765').replace(/\/$/, '');
const log = s => process.stdout.write('[process] ' + s + '\n');
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
      () => !!(window.MMGR && window.MMGR.App && window.MMGR.Process && window.MMGR.Changes),
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

  // ---- seed a clean register -------------------------------------------
  await page.evaluate(() => {
    window.MMGR.State.updateState(s => {
      s.userName = '';
      s.transitions = [];
      s.changes = [
        {
          id: 'C-1',
          date: '2026-11-01',
          title: 'Extra drainage',
          requester: 'Client',
          schedImpact: '+5 days',
          costImpact: '$4,000',
          status: 'submitted',
          approvedBy: '',
          notes: ''
        },
        {
          id: 'C-2',
          date: '2026-11-02',
          title: 'Upgrade glazing',
          requester: 'Architect',
          schedImpact: '',
          costImpact: '$9,500',
          status: 'submitted',
          approvedBy: '',
          notes: ''
        }
      ];
    });
    window.MMGR.State.save(true);
    window.MMGR.Render.showSection('chg', document.querySelector('.sec-btn[data-section="chg"]'));
  });
  await page.waitForTimeout(400);

  // ---- 1. the five statuses --------------------------------------------
  const options = await page.$$eval(
    '#chg-body tr:nth-child(1) select[data-field="status"] option',
    els => els.map(e => e.textContent.trim())
  );
  check(
    'the change register offers the five statuses',
    JSON.stringify(options) ===
      JSON.stringify(['submitted', 'review', 'approved', 'rejected', 'cancelled']),
    options
  );

  // ---- 2. submitted -> approved is refused -----------------------------
  await page.selectOption('#chg-body tr:nth-child(1) select[data-field="status"]', 'approved');
  await page.waitForTimeout(350);
  const jump = await page.evaluate(() => ({
    status: window.MMGR.State.getState().changes[0].status,
    entries: window.MMGR.State.getState().transitions.length,
    shown: document.querySelector('#chg-body tr:nth-child(1) select[data-field="status"]').value
  }));
  const jumpToast = await toastText();
  check(
    'approving a submitted change is refused, naming the missing step',
    jump.status === 'submitted' &&
      jump.entries === 0 &&
      jump.shown === 'submitted' &&
      /Review it first/.test(jumpToast),
    { jump, jumpToast }
  );

  // ---- 3. review without a name ----------------------------------------
  await page.evaluate(() => window.MMGR.Changes.updChange(0, 'status', 'review'));
  await page.waitForTimeout(300);
  const noName = await page.evaluate(() => window.MMGR.State.getState().changes[0].status);
  const noNameToast = await toastText();
  check(
    'review without a name is refused and says where to set it',
    noName === 'submitted' && /Controls/.test(noNameToast),
    { noName, noNameToast }
  );

  // ---- 4. with a name, review succeeds ---------------------------------
  await page.evaluate(() => {
    window.MMGR.State.updateState(s => {
      s.userName = 'Ana';
    });
    window.MMGR.Changes.updChange(0, 'status', 'review');
  });
  await page.waitForTimeout(350);
  const reviewed = await page.evaluate(() => ({
    status: window.MMGR.State.getState().changes[0].status,
    entries: window.MMGR.State.getState().transitions.length,
    shown: document.querySelector('#chg-body tr:nth-child(1) select[data-field="status"]').value
  }));
  check(
    'with a name, review succeeds and the row shows it',
    reviewed.status === 'review' && reviewed.shown === 'review' && reviewed.entries === 1,
    reviewed
  );

  // ---- 5. reject needs a reason ----------------------------------------
  await page.evaluate(() => window.MMGR.Changes.updChange(0, 'status', 'rejected'));
  await page.waitForTimeout(300);
  const noReason = await page.evaluate(() => window.MMGR.State.getState().changes[0].status);
  const noReasonToast = await toastText();
  check(
    'rejecting without a reason is refused',
    noReason === 'review' && /reason/i.test(noReasonToast),
    { noReason, noReasonToast }
  );
  await page.evaluate(() => {
    window.MMGR.Changes.updChange(0, 'notes', 'Not in the contract.');
    window.MMGR.Changes.updChange(0, 'status', 'rejected');
  });
  await page.waitForTimeout(350);
  const rejected = await page.evaluate(() => ({
    status: window.MMGR.State.getState().changes[0].status,
    entries: window.MMGR.State.getState().transitions.length
  }));
  check(
    'with a reason, the rejection is accepted',
    rejected.status === 'rejected' && rejected.entries === 2,
    rejected
  );

  // ---- 6. the happy path -----------------------------------------------
  await page.evaluate(() => {
    window.MMGR.Changes.updChange(1, 'status', 'review');
    window.MMGR.Changes.updChange(1, 'status', 'approved');
  });
  await page.waitForTimeout(450);
  const approved = await page.evaluate(() => {
    const s = window.MMGR.State.getState();
    const c = s.changes[1];
    return {
      status: c.status,
      approvedBy: c.approvedBy,
      mine: s.transitions.filter(r => r.ref === 'C-2').map(r => r.from + '>' + r.to + ':' + r.by)
    };
  });
  check(
    'the happy path writes one history entry per move and fills the approver',
    approved.status === 'approved' &&
      approved.approvedBy === 'Ana' &&
      JSON.stringify(approved.mine) ===
        JSON.stringify(['submitted>review:Ana', 'review>approved:Ana']),
    approved
  );

  // ---- 8. repair on boot (before the viewer gate, which reloads too) ---
  await page.evaluate(() => {
    window.MMGR.State.updateState(s => {
      s.changes.push({
        id: 'C-9',
        date: '2026-11-03',
        title: 'Legacy record',
        requester: 'Client',
        status: 'archived',
        approvedBy: '',
        notes: ''
      });
    });
    window.MMGR.State.save(true);
  });
  await boot();
  const repaired = await page.evaluate(() => {
    const s = window.MMGR.State.getState();
    const c = s.changes.find(x => x.id === 'C-9');
    const rows = s.transitions.filter(r => r.ref === 'C-9');
    return { status: c && c.status, rows: rows.map(r => r.via + ':' + r.from + '>' + r.to) };
  });
  check(
    'an impossible imported status is repaired on the next boot',
    repaired.status === 'submitted' &&
      JSON.stringify(repaired.rows) === JSON.stringify(['repair:archived>submitted']),
    repaired
  );

  // ---- 7. a viewer cannot move a status ---------------------------------
  await page.evaluate(() => {
    window.MMGR.scope = 'readonly';
    window.MMGR.Render.showSection('chg', document.querySelector('.sec-btn[data-section="chg"]'));
  });
  await page.waitForTimeout(400);
  const beforeViewer = await page.evaluate(() => {
    const s = window.MMGR.State.getState();
    return s.changes.map(c => c.status).join('|') + '#' + s.transitions.length;
  });
  await page
    .selectOption('#chg-body tr:nth-child(3) select[data-field="status"]', 'review')
    .catch(() => {});
  await page.waitForTimeout(350);
  const afterViewer = await page.evaluate(() => {
    const s = window.MMGR.State.getState();
    return s.changes.map(c => c.status).join('|') + '#' + s.transitions.length;
  });
  const viewerToast = await toastText();
  check(
    'a viewer move is refused by the read-only fence',
    beforeViewer === afterViewer && /View-only/.test(viewerToast),
    { beforeViewer, afterViewer, viewerToast }
  );
  await page.evaluate(() => {
    window.MMGR.scope = 'full';
  });

  // ---- 9. the record's own history -------------------------------------
  await page.evaluate(() => {
    window.MMGR.Render.showSection('chg', document.querySelector('.sec-btn[data-section="chg"]'));
  });
  await page.waitForTimeout(300);
  await page.locator('#chg-body button[data-action="chgHistory"]').first().click();
  await page.waitForTimeout(250);
  const detail = await page.evaluate(() => {
    const row = document.querySelector('tr.chg-hist[data-hist="0"]');
    if (!row) {
      return { hidden: true, moves: [], newest: '' };
    }
    const rows = Array.from(row.querySelectorAll('.th-row'));
    return {
      hidden: row.hidden,
      moves: rows.map(r => r.querySelector('.th-mv').textContent),
      newest: rows.length ? rows[rows.length - 1].className : ''
    };
  });
  check(
    'the change id opens its own history, newest last',
    detail.hidden === false &&
      JSON.stringify(detail.moves) ===
        JSON.stringify(['Submitted \u2192 In review', 'In review \u2192 Rejected']) &&
      /is-new/.test(detail.newest),
    detail
  );

  // ---- 10. the project feed --------------------------------------------
  await page.evaluate(() => {
    window.MMGR.State.updateState(s => {
      s.issues = [{ id: 'I-1', description: 'Crack in slab', status: 'open', resolution: '' }];
      window.MMGR.Process.applyMove(s, 'issue', 0, 'resolved', { reason: 'Grouted.' });
    });
    window.MMGR.State.save(true);
    window.MMGR.Render.showSection('log', document.querySelector('.sec-btn[data-section="log"]'));
  });
  await page.waitForTimeout(400);
  const feedAll = await page.$$eval('#tr-feed .tr-row', els => els.length);
  await page.selectOption('#tr-filter', 'issue');
  await page.waitForTimeout(300);
  const feedIssue = await page.$$eval('#tr-feed .tr-row .tr-ref', els =>
    els.map(e => e.textContent)
  );
  await page.selectOption('#tr-filter', 'change');
  await page.waitForTimeout(300);
  const feedChange = await page.$$eval('#tr-feed .tr-row .tr-ref', els =>
    els.map(e => e.textContent)
  );
  check(
    'the project feed lists every move and filters by record type',
    feedAll === 6 &&
      feedIssue.length === 1 &&
      /^Issue /.test(feedIssue[0]) &&
      feedChange.length === 5 &&
      feedChange.every(t => /^Change /.test(t)),
    { feedAll, feedIssue, feedChange }
  );

  // ---- 11. history survives a reload and a deletion --------------------
  await page.evaluate(() => window.MMGR.State.save(true));
  await boot();
  const kept = await page.evaluate(() => {
    const before = window.MMGR.State.getState().transitions.filter(r => r.ref === 'C-1').length;
    window.MMGR.Changes.delChange(0);
    const s = window.MMGR.State.getState();
    return {
      before,
      gone: !s.changes.some(c => c.id === 'C-1'),
      after: s.transitions.filter(r => r.ref === 'C-1').length
    };
  });
  check(
    'history survives a reload and the deletion of its record',
    kept.before === 2 && kept.gone && kept.after === 2,
    kept
  );

  // ---- 13. the Controls form declares a rule ---------------------------
  await page.evaluate(() => {
    window.MMGR.App.openDrw();
    window.MMGR.App.swDtab('ctrl', document.querySelector('.dtab[data-tab="ctrl"]'));
    window.MMGR.Render.renderRules();
  });
  await page.waitForTimeout(500);
  // The Controls accordion starts every section collapsed; the Rules group has
  // to be opened the way a person opens it before its form can be used.
  await page.evaluate(() => {
    const sec = Array.from(document.querySelectorAll('#db-ctrl .ctl-sec')).find(s =>
      /^Rules/.test((s.textContent || '').trim())
    );
    if (sec && !sec.classList.contains('open')) {
      sec.click();
    }
  });
  await page.waitForTimeout(500);
  await page.fill('#rule-name', 'High risk raises an issue');
  await page.selectOption('#rule-kind', 'risk');
  await page.selectOption('#rule-event', 'field');
  await page.selectOption('#rule-c1-field', 'score');
  await page.selectOption('#rule-c1-op', 'gt');
  await page.fill('#rule-c1-val', '6');
  await page.selectOption('#rule-act', 'raiseIssue');
  await page.fill('#rule-act-text', 'Treat the groundwater');
  await page.locator('#rules-body button[data-action="addRule"]').click();
  await page.waitForTimeout(400);
  const declared = await page.evaluate(() => {
    const s = window.MMGR.State.getState();
    const r = (s.rules || [])[0] || {};
    const row = document.querySelector('#rules-body .ru-row');
    return {
      count: (s.rules || []).length,
      trigger: r.trigger,
      enabled: r.enabled,
      cond: (r.conditions || [])[0],
      action: r.action,
      rowText: row ? row.textContent : ''
    };
  });
  check(
    'the Controls form declares a rule and the list reads it back',
    declared.count === 1 &&
      declared.enabled === true &&
      declared.trigger.kind === 'risk' &&
      declared.trigger.event === 'field' &&
      declared.cond.field === 'score' &&
      declared.cond.op === 'gt' &&
      declared.action.type === 'raiseIssue' &&
      /High risk raises an issue/.test(declared.rowText) &&
      /Risk changed a field/.test(declared.rowText) &&
      /Raise an issue/.test(declared.rowText),
    declared
  );

  // ---- 14. the rule fires and the log records it -----------------------
  const fired = await page.evaluate(() => {
    window.MMGR.State.updateState(s => {
      s.risks = [{ id: 'R-1', description: 'Groundwater', probability: 'Low', impact: 'High' }];
      s.issues = [];
      s.ruleLog = [];
    });
    window.MMGR.Risks.updRisk(0, 'probability', 'High');
    window.MMGR.Render.renderRules();
    const s = window.MMGR.State.getState();
    const row = document.querySelector('#rule-log-body .ru-lr');
    return {
      issues: s.issues.map(i => i.status + ':' + (i.sourceRiskId || '')),
      linked: s.risks[0].issueId === s.issues[0].id,
      log: s.ruleLog.map(r => r.event + '/' + r.action + '/' + r.result),
      rowText: row ? row.textContent : ''
    };
  });
  check(
    'the rule fires on its own event and the execution log says done',
    JSON.stringify(fired.issues) === JSON.stringify(['open:R-1']) &&
      fired.linked === true &&
      JSON.stringify(fired.log) === JSON.stringify(['field/raiseIssue/done']) &&
      /High risk raises an issue/.test(fired.rowText) &&
      /done/.test(fired.rowText),
    fired
  );

  // ---- 15. a disabled rule does nothing --------------------------------
  await page.locator('#rules-body input[data-action="tglRule"]').first().click();
  await page.waitForTimeout(350);
  const off = await page.evaluate(() => {
    const before = window.MMGR.State.getState().ruleLog.length;
    window.MMGR.State.updateState(s => {
      s.risks.push({ id: 'R-2', description: 'Rock', probability: 'Low', impact: 'High' });
    });
    window.MMGR.Risks.updRisk(1, 'probability', 'High');
    const s = window.MMGR.State.getState();
    return {
      enabled: s.rules[0].enabled,
      offRow: !!document.querySelector('#rules-body .ru-row.is-off'),
      issues: s.issues.length,
      logBefore: before,
      logAfter: s.ruleLog.length
    };
  });
  check(
    'a disabled rule does nothing',
    off.enabled === false &&
      off.offRow === true &&
      off.issues === 1 &&
      off.logAfter === off.logBefore,
    off
  );

  // ---- 16. a self-triggering rule stops and says so --------------------
  const chained = await page.evaluate(() => {
    window.MMGR.State.updateState(s => {
      s.ruleLog = [];
      s.issues = [];
      s.rules = [
        {
          id: 'r-lift',
          name: 'Lift probability',
          enabled: true,
          trigger: { kind: 'risk', event: 'field' },
          conditions: [{ field: 'probability', op: 'is', value: 'Low' }],
          action: { type: 'setField', field: 'probability', value: 'High' }
        },
        {
          id: 'r-tell',
          name: 'Tell someone',
          enabled: true,
          trigger: { kind: 'risk', event: 'field' },
          conditions: [{ field: 'probability', op: 'is', value: 'High' }],
          action: { type: 'notify', text: 'High risk' }
        }
      ];
      s.risks = [{ id: 'R-3', description: 'Silt', probability: 'Low', impact: 'Low' }];
    });
    window.MMGR.Risks.updRisk(0, 'probability', 'Low');
    window.MMGR.Render.renderRules();
    const s = window.MMGR.State.getState();
    const refused = s.ruleLog.filter(r => r.result === 'refused');
    const row = document.querySelector('#rule-log-body .ru-lr.is-refused');
    return {
      probability: s.risks[0].probability,
      fired: s.ruleLog.filter(r => r.result === 'done').length,
      refused: refused.map(r => r.rule + ':' + r.note),
      rowText: row ? row.textContent : ''
    };
  });
  check(
    "a rule that would fire on another rule's action stops and says so",
    chained.probability === 'High' &&
      chained.fired === 1 &&
      chained.refused.length === 1 &&
      /^r-tell:Chain stopped/.test(chained.refused[0]) &&
      /Chain stopped/.test(chained.rowText),
    chained
  );

  // ---- 17. imported rules land disabled --------------------------------
  const imported = await page.evaluate(() => {
    const copy = JSON.parse(window.MMGR.State.exportState());
    copy.rules = [
      {
        id: 'r-file',
        name: 'From a file',
        enabled: true,
        trigger: { kind: 'risk', event: 'field' },
        conditions: [],
        action: { type: 'raiseIssue', text: 'Raised from a file' }
      }
    ];
    copy.ruleLog = [];
    window.MMGR.State.importState(JSON.stringify(copy));
    window.MMGR.State.updateState(s => {
      s.risks = [{ id: 'R-4', description: 'Wind', probability: 'Low', impact: 'Low' }];
      s.issues = [];
    });
    window.MMGR.Risks.updRisk(0, 'probability', 'High');
    const s = window.MMGR.State.getState();
    return {
      enabled: (s.rules[0] || {}).enabled,
      issues: s.issues.length,
      log: s.ruleLog.length
    };
  });
  check(
    'a rule arriving in an imported file lands disabled',
    imported.enabled === false && imported.issues === 0 && imported.log === 0,
    imported
  );

  // ---- 18. the approval pack ------------------------------------------
  const pack = await page.evaluate(() => {
    window.print = function () {
      /* headless: the print dialog is the only thing this replaces */
    };
    window.MMGR.State.updateState(s => {
      s.projectName = 'Harbour works';
      s.transitions = [];
      s.changes = [
        {
          id: 'C-3',
          date: '2026-11-20',
          title: 'Third',
          requester: 'Client',
          costImpact: '$1,000',
          schedImpact: '+1 day',
          status: 'approved',
          approvedBy: 'Ana',
          notes: 'Within budget.'
        },
        {
          id: 'C-1',
          date: '2026-11-02',
          title: 'First',
          requester: 'Architect',
          costImpact: '$2,000',
          schedImpact: '',
          status: 'approved',
          approvedBy: 'Ana',
          notes: ''
        },
        {
          id: 'C-2',
          date: '2026-11-10',
          title: 'Second',
          requester: 'Client',
          costImpact: '',
          schedImpact: '',
          status: 'review',
          approvedBy: '',
          notes: ''
        }
      ];
    });
    window.MMGR.App.printApprovalPack();
    const host = document.getElementById('pg-pack');
    return {
      titles: Array.from(host.querySelectorAll('.pk-appr .pk-h2')).map(e =>
        (e.textContent || '').trim()
      ),
      foot: (host.querySelector('.pk-foot') || {}).textContent || '',
      printing: document.body.classList.contains('pg-printing')
    };
  });
  check(
    'the approval pack prints approved changes in date order with the counts',
    JSON.stringify(pack.titles) === JSON.stringify(['C-1 \u00b7 First', 'C-3 \u00b7 Third']) &&
      /2 included, 1 excluded/.test(pack.foot) &&
      pack.printing === false,
    pack
  );

  // ---- 19. the caveat --------------------------------------------------
  check(
    'the pack carries the local-time caveat in one plain sentence',
    /Times are shown in this device\u2019s local time\.$/.test(pack.foot),
    pack.foot
  );

  // ---- 20. a rule's hook ----------------------------------------------
  const hook = await page.evaluate(async () => {
    const calls = [];
    const realFetch = window.fetch;
    const realCode = window.MMGR.Cloud.getCode;
    const realPid = window.MMGR.Cloud._pid;
    window.fetch = function (url, opts) {
      calls.push({
        url: String(url),
        method: (opts || {}).method,
        headers: (opts || {}).headers || {},
        body: (opts || {}).body
      });
      return Promise.resolve({
        ok: true,
        status: 200,
        json: function () {
          return Promise.resolve({ ok: true, delivered: 1 });
        }
      });
    };
    window.MMGR.Cloud.getCode = function () {
      return 'OWNER1';
    };
    window.MMGR.Cloud._pid = function () {
      return 'qa-proc';
    };
    const entry = {
      kind: 'change',
      ref: 'C-1',
      from: 'review',
      to: 'approved',
      by: 'Ana',
      at: '2026-11-05T10:00:00.000Z',
      reason: 'a private note'
    };
    window.MMGR.App.dispatchHooks([{ rule: 'Tell the client', entry }]);
    await new Promise(function (r) {
      setTimeout(r, 150);
    });
    window.fetch = realFetch;
    window.MMGR.Cloud.getCode = realCode;
    window.MMGR.Cloud._pid = realPid;
    return calls;
  });
  let sent = null;
  try {
    sent = hook.length ? JSON.parse(hook[0].body) : null;
  } catch (e) {
    sent = null;
  }
  check(
    "a rule's hook posts the small document, owner-gated, no extra fields",
    hook.length === 1 &&
      hook[0].url === '/api/cloud/projects/qa-proc/webhooks/notify' &&
      hook[0].method === 'POST' &&
      hook[0].headers['X-Owner-Code'] === 'OWNER1' &&
      sent &&
      JSON.stringify(Object.keys(sent.payload).sort()) ===
        JSON.stringify(['at', 'by', 'event', 'from', 'kind', 'project', 'ref', 'to']) &&
      sent.payload.reason === undefined &&
      sent.payload.ref === 'C-1',
    { hook, sent }
  );

  // ---- 21. a viewer can print ------------------------------------------
  const viewerPack = await page.evaluate(() => {
    window.MMGR.scope = 'readonly';
    window.print = function () {};
    window.MMGR.App.printApprovalPack();
    const n = document.querySelectorAll('#pg-pack .pk-appr').length;
    const toast = document.querySelector('.toast, #toast, [data-toast]');
    window.MMGR.scope = 'full';
    return { rows: n, toast: toast ? toast.textContent : '' };
  });
  check(
    'a viewer can print the pack (printing is a read, not a write)',
    viewerPack.rows === 2 && !/View-only/.test(viewerPack.toast),
    viewerPack
  );

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
