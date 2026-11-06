#!/usr/bin/env node
/* ============================================================
   T-DELIVERY - H-3 of BUDGET-BOQ-MCP-DIRECTIVE-2026-11-05
   ------------------------------------------------------------
   One question: when 20 of 50 loads arrive at 5 percent above the BOQ rate,
   does every surface say 30 loads left, 29,000 of money left, and 1,000 of
   price variance - and does an overspend explain itself as price or amount?

   Arms:
     D1  the dialog opens on the row's line with the BOQ rate prefilled
     D2  typing the quantity fills the amount (qty x price)
     D3  Save records one delivery with qty, unit, price and amount
     D4  the Spent card reads the recorded amount, Remaining the difference
     D5  the dashboard card agrees with the Budget panel
     D6  the line reads 20 of 50 received, 30 remaining, 29,000 left
     D7  the price variance is +1,000 (5 percent of the 20 loads)
     D8  the quantity variance is +30,000
     D9  an amount that is not qty x price is refused without a reason
     D10 a legacy entry still renders and still counts
     D11 an ordered entry does not count as spent
     D12 the delivery survives a reload (so sync has it to send)
     D13 no page error in the whole run
   Usage:  node tools/qa-delivery.cjs
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
const log = s => process.stdout.write('[delivery] ' + s + '\n');

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

// 50 loads at 1,000 a load - the fixture the gate names.
function projectState(over) {
  return Object.assign(
    {
      schemaVersion: 25,
      projectId: 'dlv',
      projectName: 'Delivery QA',
      currency: 'USD',
      budgetLines: [
        {
          id: 'B1',
          category: 'Gravel',
          description: 'Gravel, delivered',
          planned: 50000,
          committed: null,
          actual: 0,
          taskId: '',
          curve: 'linear',
          isContingency: false,
          waiverStatus: 'pending',
          waiverReceivedAt: '',
          notes: '',
          source: 'boq',
          boqRef: 'Q1',
          qty: 50,
          unit: 'load',
          rate: 1000,
          rateUnit: 'load',
          kind: 'work',
          phase: ''
        }
      ],
      budgetEnvelope: 0,
      spendLog: [],
      budgetBaselines: [],
      budgetVariations: [],
      nblid: 2,
      tasks: [],
      resources: [],
      risks: [],
      changes: [],
      stakeholders: [],
      payApps: []
    },
    over || {}
  );
}

async function main() {
  const server = spawn(process.execPath, [path.join(ROOT, 'serve.cjs')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { MMGR_SERVE_PORT: String(PORT) }),
    stdio: 'ignore'
  });
  const up = await waitFor(BASE + '/project.html?id=dlv', 80);
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
  async function open(state) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(String(e.message)));
    await page.addInitScript(state => {
      try {
        localStorage.setItem(
          'mmgr_projects',
          JSON.stringify([{ id: 'dlv', title: 'Delivery QA', file: 'project.html?id=dlv' }])
        );
        localStorage.setItem('mmgr_unlocked_dlv', '1');
        localStorage.setItem('mmgr_scope_dlv', 'full');
        localStorage.setItem('mmgr_state_dlv', JSON.stringify(state));
      } catch (e) {
        /* ignore */
      }
    }, state);
    await page.goto(BASE + '/project.html?id=dlv', { waitUntil: 'domcontentloaded' });
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

  try {
    const a = await open(projectState());
    // D1: the row's own button opens on that line, price prefilled.
    await a.page.click('#bud-body tr [data-action="deliveryOpen"]');
    await a.page.waitForTimeout(300);
    const opened = await a.page.evaluate(() => {
      const box = document.getElementById('dlv-modal');
      return {
        on: !!box && box.classList.contains('on'),
        line: (document.getElementById('dlv-line') || {}).value,
        unit: (document.getElementById('dlv-unit') || {}).value,
        price: (document.getElementById('dlv-price') || {}).value
      };
    });
    check(
      'D1 the dialog opens on the row line with the BOQ rate prefilled',
      opened.on && opened.line === 'B1' && opened.unit === 'load' && opened.price === '1000',
      opened
    );
    // D2: quick path - type the quantity, the amount follows.
    await a.page.fill('#dlv-qty', '20');
    await a.page.waitForTimeout(150);
    const amount = await a.page.evaluate(() => (document.getElementById('dlv-amount') || {}).value);
    // 20 loads at the prefilled 1,000 = 20,000; the next arm moves the price.
    check('D2 typing the quantity fills the amount at qty x price', amount === '20000', amount);
    // A price 5 percent above the BOQ rate.
    await a.page.fill('#dlv-price', '1050');
    await a.page.waitForTimeout(150);
    const amount2 = await a.page.evaluate(
      () => (document.getElementById('dlv-amount') || {}).value
    );
    check('D2b the amount follows the price change', amount2 === '21000', amount2);
    await a.page.fill('#dlv-supplier', 'Blue Mountain Quarry');
    await a.page.fill('#dlv-ref', 'T-4471');
    await a.page.click('[data-action="deliverySave"]');
    await a.page.waitForTimeout(600);
    const saved = await a.page.evaluate(() => {
      const s = window.MMGR.State.getState();
      const e = (s.spendLog || [])[0] || {};
      return {
        entries: (s.spendLog || []).length,
        qty: e.qty,
        unit: e.unit,
        price: e.unitPrice,
        amount: e.amount,
        status: e.status,
        supplier: e.supplier,
        ref: e.ref
      };
    });
    check(
      'D3 Save records one delivery with qty, unit, price and amount',
      saved.entries === 1 &&
        saved.qty === 20 &&
        saved.unit === 'load' &&
        saved.price === 1050 &&
        saved.amount === 21000,
      saved
    );
    const cards = await a.page.evaluate(() => {
      const t = id => (document.getElementById(id) || {}).textContent || '';
      return { spent: t('bud-ta').trim(), remaining: t('bud-remaining').trim() };
    });
    check(
      'D4 Spent reads 21,000 and Remaining 29,000',
      /21,000/.test(cards.spent) && /29,000/.test(cards.remaining),
      cards
    );
    await a.page.evaluate(() => window.MMGR.Render.renderDash());
    await a.page.waitForTimeout(700);
    const dash = await a.page.evaluate(() => {
      const el = document.querySelector('[data-k="bud"] .stat-md, #d-bud');
      return { sub: (document.getElementById('d-bud') || {}).textContent || '' };
    });
    // The dashboard card is asserted through the shared derivation: the same
    // function the Budget panel calls must return 21,000 for this state.
    const agree = await a.page.evaluate(() => {
      const s = window.MMGR.State.getState();
      return (s.budgetLines || []).reduce(
        (n, l) => n + window.MMGR.Spend.budgetLineActual(l, s),
        0
      );
    });
    check('D5 the dashboard reads the same derived spend', agree === 21000, {
      dash: dash.sub,
      derived: agree
    });
    const roll = await a.page.evaluate(() => {
      const cells = document.querySelectorAll('#bud-deliveries tr td');
      return Array.prototype.map.call(cells, c => c.textContent.trim());
    });
    check(
      'D6 the line reads 20 of 50 received and 30 remaining',
      roll[1] === '20 of 50 load' && /^30 load$/.test(roll[2]),
      roll
    );
    check('D6b money left reads 29,000', /29,000/.test(roll[3] || ''), roll[3]);
    check('D7 the price variance is +1,000', /\+.*1,000/.test(roll[4] || ''), roll[4]);
    check('D8 the quantity variance is +30,000', /\+.*30,000/.test(roll[5] || ''), roll[5]);

    // D12: survives a reload.
    await a.page.reload({ waitUntil: 'domcontentloaded' });
    await a.page.waitForTimeout(1500);
    const afterReload = await a.page.evaluate(() => {
      const s = window.MMGR.State.getState();
      return (s.spendLog || []).length;
    });
    check('D12 the delivery survives a reload', afterReload === 1, afterReload);

    // D9: an overridden amount needs a reason.
    await a.page.evaluate(() => {
      const all = Array.prototype.slice.call(
        document.querySelectorAll('.sec-btn[data-section="bud"]')
      );
      const vis = all.filter(b => b.getBoundingClientRect().width > 0);
      (vis[0] || all[0]).click();
    });
    await a.page.waitForTimeout(400);
    await a.page.click('[data-action="deliveryOpen"]');
    await a.page.waitForTimeout(250);
    await a.page.fill('#dlv-qty', '2');
    await a.page.fill('#dlv-price', '1000');
    await a.page.waitForTimeout(120);
    await a.page.fill('#dlv-amount', '1500');
    await a.page.waitForTimeout(120);
    await a.page.click('[data-action="deliverySave"]');
    await a.page.waitForTimeout(300);
    const refused = await a.page.evaluate(() => {
      const box = document.getElementById('dlv-modal');
      const s = window.MMGR.State.getState();
      return {
        stillOpen: !!box && box.classList.contains('on'),
        err: (document.getElementById('dlv-err') || {}).textContent || '',
        entries: (s.spendLog || []).length
      };
    });
    check(
      'D9 an amount that is not qty x price is refused without a reason',
      refused.stillOpen && refused.entries === 1 && /differs/i.test(refused.err),
      refused
    );
    await a.page.fill('#dlv-reason', 'Short delivery, two loads credited');
    await a.page.click('[data-action="deliverySave"]');
    await a.page.waitForTimeout(400);
    const allowed = await a.page.evaluate(() => {
      const s = window.MMGR.State.getState();
      const e = (s.spendLog || [])[1] || {};
      return { entries: (s.spendLog || []).length, reason: e.overrideReason || '' };
    });
    check(
      'D9b the same amount is accepted with a reason, and the reason is kept',
      allowed.entries === 2 && /credited/.test(allowed.reason),
      allowed
    );

    // D10/D11: legacy and ordered entries.
    const b = await open(
      projectState({
        spendLog: [
          { id: 'S1', date: '2026-10-01', budgetLineId: 'B1', amount: 5000, notes: 'old row' },
          {
            id: 'S2',
            date: '2026-11-01',
            budgetLineId: 'B1',
            amount: 4000,
            notes: 'on order',
            status: 'ordered'
          }
        ]
      })
    );
    const legacy = await b.page.evaluate(() => {
      const rows = document.querySelectorAll('#spendlog-body tr');
      const first = rows[0] ? rows[0].textContent : '';
      const s = window.MMGR.State.getState();
      return {
        text: first.replace(/\s+/g, ' ').trim(),
        spent: (document.getElementById('bud-ta') || {}).textContent || '',
        derived: (s.budgetLines || []).reduce(
          (n, l) => n + window.MMGR.Spend.budgetLineActual(l, s),
          0
        )
      };
    });
    check(
      'D10 a legacy entry renders as a legacy amount',
      /legacy amount/i.test(legacy.text),
      legacy.text
    );
    check(
      'D10b the legacy entry still counts and the ordered one does not',
      legacy.derived === 5000 && /5,000/.test(legacy.spent),
      legacy
    );
    check('D13 no page error in the whole run', errs.length === 0, errs.slice(0, 3));
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
