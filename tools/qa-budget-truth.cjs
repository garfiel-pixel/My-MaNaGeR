#!/usr/bin/env node
/* ============================================================
   T-BUD-TRUTH - H-1 of BUDGET-BOQ-MCP-DIRECTIVE-2026-11-05
   ------------------------------------------------------------
   One question: do every budget surface agree about the same money?

   The defect this pins (A2/A3 in the directive): the Budget panel summed the
   TYPED actual box while the dashboard, earned value and pay applications
   derived the figure from the Spend Log, and Remaining was `envelope - spent`,
   so a project with no envelope read "Over budget" the moment it recorded a
   single delivery.

   Arms:
     B1  planned 10,000 + one 3,000 spend: Spent card reads 3,000
     B2  Remaining reads 7,000 with NO envelope, and says "Tracking"
     B3  the bar is 30 percent, not 100 or 0
     B4  no over-budget alarm and no overrun notice with no envelope
     B5  the dashboard card names the same Spent figure
     B6  envelope 8,000 with planned 10,000: the quiet "planned exceeds the
         envelope" notice appears and there is STILL no over-budget alarm
     B7  envelope 8,000 and spent 3,000: Remaining reads 5,000
     B8  a JMD project prints J$, not $

   Usage:  node tools/qa-budget-truth.cjs
   Env:    QA_PORT (default 8831)
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const PORT = parseInt(process.env.QA_PORT || '8831', 10);
const BASE = 'http://127.0.0.1:' + PORT;

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log('  PASS  ' + name);
  } else {
    fail++;
    console.log('  FAIL  ' + name + (detail ? '  ' + JSON.stringify(detail) : ''));
  }
}
const log = s => process.stdout.write('[budget-truth] ' + s + '\n');

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
        JSON.stringify([{ id: 'bud', title: 'Budget QA', file: 'project.html?id=bud' }])
      );
      localStorage.setItem('mmgr_unlocked_bud', '1');
      localStorage.setItem('mmgr_scope_bud', 'full');
      localStorage.setItem('mmgr_state_bud', JSON.stringify(window.__SEED__));
    } catch (e) {
      /* ignore */
    }
  };
}

function projectState(overrides) {
  const base = {
    projectName: 'Budget QA',
    schemaVersion: 24,
    budgetLines: [
      {
        id: 'B1',
        category: 'Gravel',
        planned: 10000,
        committed: '',
        actual: 999,
        unit: 'load',
        qty: 50,
        rate: 200
      }
    ],
    spendLog: [
      { id: 'S1', date: '2026-11-01', budgetLineId: 'B1', amount: 3000, notes: '20 loads' }
    ],
    tasks: [],
    resources: [],
    risks: [],
    changes: [],
    stakeholders: [],
    payApps: []
  };
  return Object.assign(base, overrides || {});
}

async function main() {
  const server = spawn(process.execPath, [path.join(ROOT, 'serve.cjs')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { MMGR_SERVE_PORT: String(PORT) }),
    stdio: 'ignore'
  });
  const up = await waitFor(BASE + '/project.html?id=bud', 80);
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
  async function openBudget(state) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await ctx.addInitScript(`window.__SEED__ = ${JSON.stringify(state)};`);
    await ctx.addInitScript(seed());
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(String(e.message)));
    await page.goto(BASE + '/project.html?id=bud', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    // The section nav exists twice (rail and drawer); click the visible one.
    await page.evaluate(() => {
      const all = Array.prototype.slice.call(
        document.querySelectorAll('.sec-btn[data-section="bud"]')
      );
      const vis = all.filter(b => b.getBoundingClientRect().width > 0);
      (vis[0] || all[0]).click();
    });
    await page.waitForTimeout(700);
    return { ctx, page };
  }

  try {
    // ---- no envelope ----
    const a = await openBudget(projectState());
    const a1 = await a.page.evaluate(() => {
      const t = id => (document.getElementById(id) || {}).textContent || '';
      const bar = document.getElementById('bud-bar');
      const overrun = document.getElementById('bud-overrun-alert');
      return {
        spent: t('bud-ta').trim(),
        spentPct: t('bud-spent-pct').trim(),
        remaining: t('bud-remaining').trim(),
        remainingPct: t('bud-remaining-pct').trim(),
        barWidth: bar ? bar.style.width : '',
        overrunHidden: overrun ? overrun.classList.contains('is-hide') : null,
        overrunText: t('bud-overrun-alert').trim(),
        barWarnHidden: (
          document.getElementById('bud-bar-warn') || { classList: { contains: () => null } }
        ).classList.contains('is-hide')
      };
    });
    check('B1 Spent reads the Spend Log total, 3,000', /\b3,000\b/.test(a1.spent), a1.spent);
    check(
      'B2 Remaining reads 7,000 against the planned total',
      /\b7,000\b/.test(a1.remaining),
      a1.remaining
    );
    check(
      'B2b with no envelope it says Tracking, never Over budget',
      /tracking/i.test(a1.remainingPct) && !/over budget/i.test(a1.remainingPct),
      a1.remainingPct
    );
    check('B3 the bar is 30 percent', /^30(\.\d+)?%$/.test(a1.barWidth), a1.barWidth);
    check('B4 no overrun notice and no over-budget warning', a1.overrunHidden === true, a1);
    check(
      'B4b the spent percentage names the planned baseline',
      /30% of planned/.test(a1.spentPct),
      a1.spentPct
    );

    // dashboard
    await a.page.evaluate(() => {
      const all = Array.prototype.slice.call(
        document.querySelectorAll('.sec-btn[data-section="dash"]')
      );
      const vis = all.filter(b => b.getBoundingClientRect().width > 0);
      (vis[0] || all[0]).click();
    });
    await a.page.waitForTimeout(700);
    const dash = await a.page.evaluate(() => ({
      sub: ((document.getElementById('dw-bud-sub') || {}).textContent || '').trim()
    }));
    check('B5 the dashboard card names the same 3,000 actual', /3,000/.test(dash.sub), dash.sub);
    await a.ctx.close();

    // ---- envelope 8,000, planned 10,000 ----
    const b = await openBudget(projectState({ budgetEnvelope: 8000 }));
    const b1 = await b.page.evaluate(() => {
      const t = id => (document.getElementById(id) || {}).textContent || '';
      const overrun = document.getElementById('bud-overrun-alert');
      return {
        remaining: t('bud-remaining').trim(),
        remainingPct: t('bud-remaining-pct').trim(),
        overrunHidden: overrun ? overrun.classList.contains('is-hide') : null,
        overrunAmt: t('bud-overrun-amt').trim(),
        barWidth: (document.getElementById('bud-bar') || {}).style.width || ''
      };
    });
    check(
      'B6 Remaining reads 5,000 against the 8,000 envelope',
      /\b5,000\b/.test(b1.remaining),
      b1
    );
    check(
      'B6b planned 10,000 above an 8,000 envelope shows the quiet notice',
      b1.overrunHidden === false && /2,000/.test(b1.overrunAmt),
      b1
    );
    check(
      'B6c the notice is a plan notice, not an over-budget alarm',
      !/over budget/i.test(b1.remainingPct),
      b1.remainingPct
    );
    check('B7 the bar is 37.5 percent of the envelope', /^37\.5%$/.test(b1.barWidth), b1.barWidth);
    await b.ctx.close();

    // ---- currency ----
    const c = await openBudget(projectState({ currency: 'JMD' }));
    const c1 = await c.page.evaluate(() => ({
      spent: ((document.getElementById('bud-ta') || {}).textContent || '').trim()
    }));
    check('B8 a JMD project prints J$, not $', /^J\$/.test(c1.spent), c1.spent);
    await c.ctx.close();

    check('B9 no page error in the whole run', errs.length === 0, errs.slice(0, 3));
  } finally {
    await browser.close();
    server.kill();
  }

  log('');
  log(fail === 0 ? 'ALL GATES PASSED (' + pass + ')' : fail + ' FAILED (' + pass + ' passed)');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => {
  log('FATAL ' + ((e && e.stack) || e));
  process.exit(1);
});
