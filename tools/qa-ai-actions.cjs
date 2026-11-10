#!/usr/bin/env node
/* ============================================================
   T-AI-ACTIONS - Wave 4d of the owner's UI directive (2026-11-10)
   ------------------------------------------------------------
   The assistant inside a project may GUIDE and ASSIST but must never silently
   execute a complex change. This gate pins the bounded-action contract:
     A1  MMGR.AiActions is exposed on the project page
     A2  parseActions extracts a well-formed ACTIONS array
     A3  a malformed block is ignored (null), never thrown
     A4  isComplex flags a re-plan-the-whole-schedule request
     A5  buildPreview builds a table and treats model text as TEXT (no markup
         injection)
     A6  apply runs a bounded op and reports it
     A7  the applied change is one-click reversible (State.undo)
     A8  an unsupported op is skipped with a report entry, not applied
     A9  addRisk appends exactly one risk
     A10 no page error in the run

   Usage:  node tools/qa-ai-actions.cjs
   Env:    QA_PORT (default 8834)
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const ROOT = path.resolve(__dirname, '..');
const PORT = parseInt(process.env.QA_PORT || '8834', 10);
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
  process.stdout.write('[ai-actions] ' + s + '\n');
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
        JSON.stringify([{ id: 'qaai', title: 'AI Actions QA', file: 'project.html?id=qaai' }])
      );
      localStorage.setItem('mmgr_unlocked_qaai', '1');
      localStorage.setItem('mmgr_scope_qaai', 'full');
      localStorage.setItem('mmgr_state_qaai', JSON.stringify(window.__SEED__));
    } catch (e) {
      /* ignore */
    }
  };
}
function projectState() {
  return {
    projectName: 'AI Actions QA',
    schemaVersion: 31,
    tasks: [
      {
        id: 'T1',
        name: 'Foundations',
        startDate: '2026-11-01',
        endDate: '2026-11-05',
        status: 'in-progress',
        duration: 5
      },
      {
        id: 'T2',
        name: 'Framing',
        startDate: '2026-11-06',
        endDate: '2026-11-12',
        status: 'not-started',
        duration: 7
      }
    ],
    budgetLines: [{ id: 'B1', category: 'Concrete', planned: 5000 }],
    risks: [],
    decisions: [],
    spendLog: [],
    resources: [],
    changes: [],
    stakeholders: [],
    payApps: []
  };
}

async function main() {
  const server = spawn(process.execPath, [path.join(ROOT, 'serve.cjs')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { MMGR_SERVE_PORT: String(PORT) }),
    stdio: 'ignore'
  });
  const up = await waitFor(BASE + '/project.html?id=qaai', 80);
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
  await ctx.addInitScript(`window.__SEED__ = ${JSON.stringify(projectState())};`);
  await ctx.addInitScript(seed());
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(String(e.message || e)));
  await page.goto(BASE + '/project.html?id=qaai', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);

  const has = await page.evaluate(() => !!(window.MMGR && window.MMGR.AiActions));
  check('A1 MMGR.AiActions is exposed', has);

  if (has) {
    // A2: a well-formed block parses.
    const parsed = await page.evaluate(() => {
      const t =
        'Sure, I can do that.\nACTIONS: [{"op":"setTaskStatus","taskId":"T1","status":"completed"}]';
      return window.MMGR.AiActions.parseActions(t);
    });
    check(
      'A2 parseActions extracts a well-formed array',
      Array.isArray(parsed) && parsed.length === 1 && parsed[0].op === 'setTaskStatus',
      parsed
    );

    // A3: malformed -> null, no throw.
    const bad = await page.evaluate(() => {
      try {
        return window.MMGR.AiActions.parseActions('ACTIONS: [not json');
      } catch (e) {
        return 'threw';
      }
    });
    check('A3 a malformed block is ignored, never thrown', bad === null, bad);

    // A4: complex request flagged.
    const complex = await page.evaluate(() =>
      window.MMGR.AiActions.isComplex('Please re-plan the whole schedule for me')
    );
    check('A4 isComplex flags a re-plan request', complex === true, complex);

    // A5: preview table, and model text stays text.
    const preview = await page.evaluate(() => {
      const node = window.MMGR.AiActions.buildPreview([
        { op: 'addRisk', title: '<img src=x onerror=alert(1)>' }
      ]);
      return {
        table: !!node.querySelector('table.ai-actions-table'),
        injected: !!node.querySelector('img'),
        text: (node.textContent || '').indexOf('<img') > -1
      };
    });
    check('A5 buildPreview builds a table', preview.table);
    check('A5 model text is never injected as markup', preview.injected === false);
    check('A5 model text is present as plain text', preview.text === true);

    // A6: apply a bounded op.
    const applied = await page.evaluate(() => {
      const out = window.MMGR.AiActions.apply([
        { op: 'setTaskStatus', taskId: 'T1', status: 'completed' }
      ]);
      const s = window.MMGR.State.getState();
      const t = (s.tasks || []).find(x => x.id === 'T1');
      return { out, status: t && t.status };
    });
    check(
      'A6 apply reports one applied change',
      applied.out && applied.out.applied === 1,
      applied.out
    );
    check('A6 the task status really changed', applied.status === 'completed', applied.status);

    // A7: undo reverses it.
    const undone = await page.evaluate(() => {
      window.MMGR.State.undo();
      const s = window.MMGR.State.getState();
      const t = (s.tasks || []).find(x => x.id === 'T1');
      return t && t.status;
    });
    check('A7 undo reverses the applied change', undone === 'in-progress', undone);

    // A8: unsupported op skipped with a report entry.
    const skipped = await page.evaluate(() => {
      const out = window.MMGR.AiActions.apply([{ op: 'rewriteEverything', x: 1 }]);
      return out;
    });
    check(
      'A8 an unsupported op is skipped, not applied',
      skipped &&
        skipped.applied === 0 &&
        skipped.report.length === 1 &&
        skipped.report[0].ok === false,
      skipped
    );

    // A9: addRisk appends one risk.
    const risk = await page.evaluate(() => {
      const before = (window.MMGR.State.getState().risks || []).length;
      const out = window.MMGR.AiActions.apply([{ op: 'addRisk', title: 'Rain delay' }]);
      const after = (window.MMGR.State.getState().risks || []).length;
      return { out, before, after };
    });
    check(
      'A9 addRisk appends exactly one risk',
      risk.out && risk.out.applied === 1 && risk.after === risk.before + 1,
      risk
    );
  }

  check('A10 no page error in the run', errs.length === 0, errs.slice(0, 3));

  await ctx.close();
  await browser.close();
  server.kill();

  log('');
  log('==== AI ACTIONS: ' + pass + ' passed / ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
}

main().catch(e => {
  log('FATAL ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
