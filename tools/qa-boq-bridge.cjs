#!/usr/bin/env node
/* ============================================================
   T-BOQ - H-2 of BUDGET-BOQ-MCP-DIRECTIVE-2026-11-05
   ------------------------------------------------------------
   The bridge has one job: a bill priced in the calculator becomes budget
   lines whose total is the calculator's total to the cent, and a second send
   of the same bill changes nothing.

   The whole flow is driven in a real browser, both pages, because the defect
   class this pins is "two screens disagree about the same number" - a unit
   test of either side would have missed it.

   Arms:
     Q1  the calculator sends a 3-line bill and reports the total on screen
     Q2  the payload carries 3 work lines plus overhead, tax, site costs,
         the discount and the contingencies
     Q3  the payload total equals the sum of its own lines to the cent
     Q4  the project's From BOQ dialog lists every line
     Q5  Apply creates one budget line per payload line, and the budget total
         equals the calculator total to the cent
     Q6  Baseline 1 is frozen with that total
     Q7  re-sending the same bill says "already matches" and Apply is disabled
     Q8  a changed bill shows one changed line and no duplicates
     Q9  a change cannot be applied without a reason
     Q10 the reason applies it, records one variation, and leaves Baseline 1
         at its original total
     Q11 a manual line on the project is untouched by any of this
     Q12 no page error in the whole run
   Usage:  node tools/qa-boq-bridge.cjs
   Env:    QA_PORT (default 8833)
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const ROOT = path.resolve(__dirname, '..');
const PORT = parseInt(process.env.QA_PORT || '8833', 10);
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
const log = s => process.stdout.write('[boq-bridge] ' + s + '\n');

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

// A bill of three custom lines - the custom path is the one work item that
// needs no dimensions, so the fixture stays readable and the maths is the
// page's own computeFor either way.
function billLines() {
  return [
    {
      boqId: 'Q1-block',
      name: 'Blockwork',
      st: {
        work: 'custom',
        calcCustomName: 'Blockwork',
        calcCustomQty: '100',
        calcCustomRate: '150',
        calcCustomUnit: 'm2',
        currency: 'USD',
        units: 'metric',
        ohPct: '5',
        taxOverride: '10'
      }
    },
    {
      boqId: 'Q2-concrete',
      name: 'Concrete',
      st: {
        work: 'custom',
        calcCustomName: 'Concrete',
        calcCustomQty: '20',
        calcCustomRate: '900',
        calcCustomUnit: 'm3',
        currency: 'USD',
        units: 'metric',
        ohPct: '5',
        taxOverride: '10'
      }
    },
    {
      boqId: 'Q3-labour',
      name: 'Day labour',
      st: {
        work: 'custom',
        calcCustomName: 'Day labour',
        calcCustomQty: '40',
        calcCustomRate: '75',
        calcCustomUnit: 'day',
        currency: 'USD',
        units: 'imperial',
        ohPct: '5',
        taxOverride: '10'
      }
    }
  ];
}

function projectSeed(extra) {
  return Object.assign(
    {
      schemaVersion: 25,
      projectId: 'boq',
      projectName: 'BOQ QA',
      currency: 'USD',
      budgetLines: [],
      budgetEnvelope: 0,
      spendLog: [],
      budgetBaselines: [],
      budgetVariations: [],
      nblid: 1,
      tasks: [],
      resources: [],
      risks: [],
      changes: [],
      stakeholders: [],
      payApps: []
    },
    extra || {}
  );
}

async function main() {
  const server = spawn(process.execPath, [path.join(ROOT, 'serve.cjs')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { MMGR_SERVE_PORT: String(PORT) }),
    stdio: 'ignore'
  });
  const up = await waitFor(BASE + '/calculator.html', 80);
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
  const watch = page => page.on('pageerror', e => errs.push(String(e.message)));

  try {
    // ---- calculator: send the bill -------------------------------------
    const cctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const cpage = await cctx.newPage();
    watch(cpage);
    await cpage.addInitScript(
      ({ lines }) => {
        try {
          localStorage.setItem(
            'mmgr_projects',
            JSON.stringify([{ id: 'boq', title: 'BOQ QA', file: 'project.html?id=boq' }])
          );
          localStorage.setItem('mmgr_calc_boq', JSON.stringify(lines));
          localStorage.setItem('mmgr_calc_tour_done', '1');
          localStorage.setItem('mmgr_calc_guide_open', '0');
          localStorage.setItem('mmgr_calc_biz_name', 'Fairclough Builders');
          localStorage.setItem(
            'mmgr_calc_prelims',
            JSON.stringify([
              { name: 'Site establishment', basis: 'fixed', value: '5000', weeks: '' },
              { name: 'Insurance', basis: 'pct', value: '2', weeks: '' }
            ])
          );
          localStorage.setItem(
            'mmgr_calc_rollup',
            JSON.stringify({
              designC: '10',
              constrC: '5',
              escPct: '0',
              months: '',
              discPct: '0',
              discAmt: '1000'
            })
          );
        } catch (e) {
          /* ignore */
        }
      },
      { lines: billLines() }
    );
    await cpage.goto(BASE + '/calculator.html', { waitUntil: 'domcontentloaded' });
    await cpage.waitForTimeout(1600);
    const calcTotal = await cpage.evaluate(() => {
      const t = (document.getElementById('calc-boq-total') || {}).textContent || '';
      const m = /([\d,]+)/.exec(t.replace(/^[^0-9]*Bill total:[^0-9]*/, ''));
      return { text: t.trim(), n: m ? parseFloat(m[1].replace(/,/g, '')) : 0 };
    });
    check('Q1 the calculator shows a bill total for 3 lines', calcTotal.n > 0, calcTotal);
    await cpage.selectOption('#calc-boq-project', 'boq');
    await cpage.click('[data-action="calcBoqSend"]');
    await cpage.waitForTimeout(300);
    const note = await cpage.evaluate(
      () => (document.getElementById('calc-boq-send-note') || {}).textContent || ''
    );
    check('Q1b the send note names the line count and total', /budget line/.test(note), note);
    const payload = await cpage.evaluate(() => {
      try {
        return JSON.parse(localStorage.getItem('mmgr_boq_handoff') || '{}').boq || null;
      } catch (e) {
        return null;
      }
    });
    check('Q1c a handoff record was written for the project', !!payload, !!payload);
    const kinds = payload ? payload.lines.map(l => l.kind) : [];
    check(
      'Q2 the payload carries work, overhead, tax, site, margin and contingency lines',
      ['work', 'overhead', 'tax', 'site', 'margin', 'contingency'].every(
        k => kinds.indexOf(k) > -1
      ),
      kinds
    );
    const sum = payload
      ? Math.round(payload.lines.reduce((n, l) => n + l.planned, 0) * 100) / 100
      : 0;
    check(
      'Q3 the payload total equals the sum of its own lines to the cent',
      payload && Math.abs(sum - payload.totals.total) < 0.005,
      { sum: sum, total: payload && payload.totals.total }
    );
    const workSum = payload
      ? Math.round(
          payload.lines.filter(l => l.kind === 'work').reduce((n, l) => n + l.planned, 0) * 100
        ) / 100
      : 0;
    check(
      'Q3b the work lines add up to the bill total the calculator printed',
      payload && Math.abs(workSum - calcTotal.n) < 0.02,
      { workSum: workSum, printed: calcTotal.n }
    );

    // ---- project: preview and apply -------------------------------------
    async function openProject(state, handoff) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const page = await ctx.newPage();
      watch(page);
      await page.addInitScript(
        ({ state, handoff }) => {
          try {
            localStorage.setItem(
              'mmgr_projects',
              JSON.stringify([{ id: 'boq', title: 'BOQ QA', file: 'project.html?id=boq' }])
            );
            localStorage.setItem('mmgr_unlocked_boq', '1');
            localStorage.setItem('mmgr_scope_boq', 'full');
            localStorage.setItem('mmgr_state_boq', JSON.stringify(state));
            localStorage.setItem('mmgr_boq_handoff', JSON.stringify({ boq: handoff }));
          } catch (e) {
            /* ignore */
          }
        },
        { state, handoff }
      );
      await page.goto(BASE + '/project.html?id=boq', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1800);
      await page.evaluate(() => {
        const all = Array.prototype.slice.call(
          document.querySelectorAll('.sec-btn[data-section="bud"]')
        );
        const vis = all.filter(b => b.getBoundingClientRect().width > 0);
        (vis[0] || all[0]).click();
      });
      await page.waitForTimeout(600);
      return { ctx, page };
    }
    const p1 = await openProject(projectSeed(), payload);
    await p1.page.click('[data-action="boqImport"]');
    await p1.page.waitForTimeout(300);
    const dlg = await p1.page.evaluate(() => {
      const box = document.getElementById('boq-modal');
      const rows = box ? box.querySelectorAll('.boq-row') : [];
      return {
        open: !!box && box.classList.contains('on'),
        rows: rows.length,
        summary: box ? (box.querySelector('.modal-txt') || {}).textContent || '' : '',
        applyDisabled: (document.getElementById('boq-apply') || {}).disabled
      };
    });
    check(
      'Q4 the From BOQ dialog opens and lists every payload line',
      dlg.open && dlg.rows === payload.lines.length,
      dlg
    );
    await p1.page.click('[data-action="boqApply"]');
    await p1.page.waitForTimeout(600);
    const after = await p1.page.evaluate(() => {
      const s = window.MMGR.State.getState();
      const fmt = window.MMGR.Utils.fmtMoney;
      const total = (s.budgetLines || []).reduce((n, l) => n + (+l.planned || 0), 0);
      const bl = (s.budgetBaselines || [])[0] || null;
      return {
        lines: (s.budgetLines || []).length,
        total: Math.round(total * 100) / 100,
        boqLines: (s.budgetLines || []).filter(l => l.source === 'boq').length,
        baseline: bl ? { n: bl.n, total: bl.total, by: bl.by } : null,
        strip: (document.getElementById('bud-baseline') || {}).textContent || '',
        shown: fmt(total, s.currency || 'USD')
      };
    });
    check(
      'Q5 Apply creates one budget line per payload line',
      after.lines === payload.lines.length && after.boqLines === payload.lines.length,
      after
    );
    check(
      'Q5b the budget total equals the calculator total to the cent',
      Math.abs(after.total - payload.totals.total) < 0.005,
      { budget: after.total, calculator: payload.totals.total }
    );
    check(
      'Q6 Baseline 1 is frozen with the applied total',
      after.baseline &&
        after.baseline.n === 1 &&
        Math.abs(after.baseline.total - payload.totals.total) < 0.005,
      after.baseline
    );
    check(
      'Q6b the baseline strip is visible and names Baseline 1',
      /Baseline 1/.test(after.strip),
      after.strip
    );

    // ---- re-send the same bill -----------------------------------------
    await p1.page.click('[data-action="boqImport"]');
    await p1.page.waitForTimeout(250);
    const same = await p1.page.evaluate(() => {
      const box = document.getElementById('boq-modal');
      return {
        summary: box ? (box.querySelector('.modal-txt') || {}).textContent || '' : '',
        applyDisabled: (document.getElementById('boq-apply') || {}).disabled
      };
    });
    check(
      'Q7 re-sending the same bill says it already matches and disables Apply',
      /already matches/i.test(same.summary) && same.applyDisabled === true,
      same
    );
    await p1.page.click('[data-action="boqClose"]');

    // ---- a changed bill ------------------------------------------------
    const changed = JSON.parse(JSON.stringify(payload));
    const target = changed.lines.find(l => l.boqRef === 'Q2-concrete');
    target.planned = Math.round(target.planned * 1.1 * 100) / 100;
    target.rate = Math.round((target.planned / target.qty) * 1000000) / 1000000;
    changed.totals.total = Math.round(changed.lines.reduce((n, l) => n + l.planned, 0) * 100) / 100;
    const p3 = await openProject(
      await p1.page.evaluate(() => window.MMGR.State.getState()),
      changed
    );
    await p3.page.click('[data-action="boqImport"]');
    await p3.page.waitForTimeout(250);
    const diff = await p3.page.evaluate(() => {
      const box = document.getElementById('boq-modal');
      return {
        rows: box ? box.querySelectorAll('.boq-row').length : 0,
        changed: box ? box.querySelectorAll('.boq-row.boq-chg').length : 0,
        added: box ? box.querySelectorAll('.boq-row.boq-add').length : 0,
        summary: box ? (box.querySelector('.modal-txt') || {}).textContent || '' : ''
      };
    });
    check(
      'Q8 a changed bill shows exactly one changed line and no new lines',
      diff.changed === 1 && diff.added === 0,
      diff
    );
    await p3.page.click('[data-action="boqApply"]');
    await p3.page.waitForTimeout(300);
    const noReason = await p3.page.evaluate(() => {
      const box = document.getElementById('boq-modal');
      const s = window.MMGR.State.getState();
      return {
        stillOpen: !!box && box.classList.contains('on'),
        variations: (s.budgetVariations || []).length
      };
    });
    check(
      'Q9 a change is not applied without a reason',
      noReason.stillOpen === true && noReason.variations === 0,
      noReason
    );
    await p3.page.fill('#boq-reason', 'Bill re-priced after the site visit');
    await p3.page.click('[data-action="boqApply"]');
    await p3.page.waitForTimeout(600);
    const varied = await p3.page.evaluate(() => {
      const s = window.MMGR.State.getState();
      const total = (s.budgetLines || []).reduce((n, l) => n + (+l.planned || 0), 0);
      const bl = (s.budgetBaselines || [])[0] || null;
      return {
        lines: (s.budgetLines || []).length,
        total: Math.round(total * 100) / 100,
        variations: (s.budgetVariations || []).length,
        reason: (s.budgetVariations[0] || {}).reason || '',
        baselineTotal: bl ? bl.total : null
      };
    });
    check(
      'Q10 the reason applies it and records exactly one variation',
      varied.variations === 1 && /site visit/.test(varied.reason) && varied.lines === after.lines,
      varied
    );
    check(
      'Q10b Baseline 1 keeps its original total after the variation',
      Math.abs(varied.baselineTotal - payload.totals.total) < 0.005,
      { baseline: varied.baselineTotal, original: payload.totals.total }
    );
    check(
      'Q10c the budget total moved by the change',
      Math.abs(varied.total - changed.totals.total) < 0.005,
      { budget: varied.total, changed: changed.totals.total }
    );

    // ---- a manual line is never touched --------------------------------
    const manual = projectSeed({
      budgetLines: [
        {
          id: 'B900',
          category: 'My own line',
          planned: 1234,
          actual: 0,
          committed: null,
          notes: '',
          source: 'manual',
          kind: 'manual'
        }
      ],
      nblid: 901
    });
    const p4 = await openProject(manual, payload);
    await p4.page.click('[data-action="boqImport"]');
    await p4.page.waitForTimeout(250);
    await p4.page.click('[data-action="boqApply"]');
    await p4.page.waitForTimeout(500);
    const kept = await p4.page.evaluate(() => {
      const s = window.MMGR.State.getState();
      const mine = (s.budgetLines || []).filter(l => l.source === 'manual');
      return {
        manual: mine.length,
        planned: mine[0] ? mine[0].planned : null,
        total: (s.budgetLines || []).length
      };
    });
    check('Q11 a manual line survives untouched', kept.manual === 1 && kept.planned === 1234, kept);

    check('Q12 no page error in the whole run', errs.length === 0, errs.slice(0, 3));
  } finally {
    await browser.close();
    server.kill();
  }
  log('');
  if (fail) {
    log(fail + ' FAILED (' + pass + ' passed)');
    process.exit(1);
  }
  log('ALL GATES PASSED (' + pass + ')');
}

main().catch(e => {
  log('FATAL ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
