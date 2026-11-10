#!/usr/bin/env node
/* ============================================================
   T-WEEK - H-4 of BUDGET-BOQ-MCP-DIRECTIVE-2026-11-05
   ------------------------------------------------------------
   Three weeks of deliveries on four lines. The week on screen, the PDF and
   the spreadsheet must carry the same numbers; the chips must switch at the
   Q5 thresholds; the forecast must equal the hand calculation; and changing
   the selected week must not write anything.

   Arms:
     W1  the week selector lists every week that has money in it
     W2  week 1 reads 10,000 this week and 10,000 to date
     W3  week 2 reads 10,500 this week and 20,500 to date
     W4  week 3 reads 4,500 this week and 28,100 to date
     W5  chips: price above BOQ rate, on track, watch, over
     W6  forecast at completion equals the hand calculation (73,200)
     W7  the PDF carries the same week and total
     W8  the spreadsheet carries the same line names and figures
     W9  changing the selected week never changes saved data
     W10 no page error in the whole run
   Usage:  node tools/qa-weekly.cjs
   Env:    QA_PORT (default 8837)
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const ROOT = path.resolve(__dirname, '..');
const PORT = parseInt(process.env.QA_PORT || '8837', 10);
const BASE = 'http://127.0.0.1:' + PORT;
const OUT = path.join(ROOT, 'tmp', 'qa-weekly');
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
const log = s => process.stdout.write('[weekly] ' + s + '\n');

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

function line(id, category, qty, unit, rate) {
  return {
    id: id,
    category: category,
    planned: qty * rate,
    committed: null,
    actual: 0,
    taskId: '',
    curve: 'linear',
    isContingency: false,
    waiverStatus: 'pending',
    waiverReceivedAt: '',
    notes: '',
    source: 'boq',
    boqRef: 'Q-' + id,
    qty: qty,
    unit: unit,
    rate: rate,
    rateUnit: unit,
    kind: 'work',
    phase: ''
  };
}

function delivery(id, date, lineId, qty, price) {
  return {
    id: id,
    date: date,
    budgetLineId: lineId,
    amount: Math.round(qty * price * 100) / 100,
    qty: qty,
    unitPrice: price,
    status: 'received',
    notes: ''
  };
}

function projectState() {
  return {
    schemaVersion: 25,
    projectId: 'wk',
    projectName: 'Weekly QA',
    currency: 'USD',
    budgetLines: [
      line('B1', 'Gravel', 50, 'load', 1000),
      line('B2', 'Concrete', 20, 'm3', 900),
      line('B3', 'Sand', 10, 'load', 100),
      line('B4', 'Timber', 10, 'm', 200)
    ],
    budgetEnvelope: 0,
    spendLog: [
      delivery('S1', '2026-10-06', 'B1', 10, 1000),
      delivery('S2', '2026-10-13', 'B1', 10, 1050),
      delivery('S3', '2026-10-20', 'B2', 5, 900),
      delivery('S4', '2026-10-20', 'B3', 9, 100),
      delivery('S5', '2026-10-21', 'B4', 11, 200)
    ],
    budgetBaselines: [],
    budgetVariations: [],
    nblid: 5,
    tasks: [],
    resources: [],
    risks: [],
    changes: [],
    stakeholders: [],
    payApps: []
  };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = spawn(process.execPath, [path.join(ROOT, 'serve.cjs')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { MMGR_SERVE_PORT: String(PORT) }),
    stdio: 'ignore'
  });
  const up = await waitFor(BASE + '/project.html?id=wk', 80);
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
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(String(e.message)));
    await page.addInitScript(state => {
      try {
        localStorage.setItem(
          'mmgr_projects',
          JSON.stringify([{ id: 'wk', title: 'Weekly QA', file: 'project.html?id=wk' }])
        );
        localStorage.setItem('mmgr_unlocked_wk', '1');
        localStorage.setItem('mmgr_scope_wk', 'full');
        // This suite drives the weekly card. The first-run tour auto-opens on
        // a clean profile and re-scrolls the page to its current target while
        // it settles, moving the layout under a click.
        localStorage.setItem('mmgr_first_project_tour_v1', '1');
        localStorage.setItem('mmgr_state_wk', JSON.stringify(state));
      } catch (e) {
        /* ignore */
      }
    }, projectState());
    await page.goto(BASE + '/project.html?id=wk', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    await page.evaluate(() => {
      const all = Array.prototype.slice.call(
        document.querySelectorAll('.sec-btn[data-section="bud"]')
      );
      const vis = all.filter(b => b.getBoundingClientRect().width > 0);
      (vis[0] || all[0]).click();
    });
    await page.waitForTimeout(700);

    const opts = await page.evaluate(() => {
      const sel = document.getElementById('bud-week');
      return sel
        ? Array.prototype.map.call(sel.options, o => ({ v: o.value, t: o.textContent.trim() }))
        : [];
    });
    const weeks = opts.map(o => o.v);
    check(
      'W1 the week selector lists every week with money in it',
      ['2026-10-05', '2026-10-12', '2026-10-19'].every(w => weeks.indexOf(w) > -1),
      weeks
    );

    async function week(w) {
      await page.selectOption('#bud-week', w);
      await page.waitForTimeout(400);
      return page.evaluate(() => {
        const t = id => (document.getElementById(id) || {}).textContent || '';
        const cards = Array.prototype.map.call(
          document.querySelectorAll('#bud-weekly-cards .wk-card'),
          c => ({
            k: (c.querySelector('.wk-k') || {}).textContent || '',
            v: (c.querySelector('.wk-v') || {}).textContent || ''
          })
        );
        const rows = Array.prototype.map.call(
          document.querySelectorAll('#bud-weekly-body tr'),
          tr => Array.prototype.map.call(tr.querySelectorAll('td'), td => td.textContent.trim())
        );
        return {
          cards: cards,
          rows: rows,
          sub: t('bud-weekly-sub')
        };
      });
    }
    const w1 = await week('2026-10-05');
    const card = (d, k) => (d.cards.find(c => c.k.indexOf(k) > -1) || {}).v || '';
    check(
      'W2 week 1 reads 10,000 this week',
      /10,000/.test(card(w1, 'Spent this week')),
      card(w1, 'Spent this week')
    );
    check(
      'W2b week 1 reads 10,000 to date',
      /10,000/.test(card(w1, 'Spent to date')),
      card(w1, 'Spent to date')
    );
    const w2 = await week('2026-10-12');
    check(
      'W3 week 2 reads 10,500 this week',
      /10,500/.test(card(w2, 'Spent this week')),
      card(w2, 'Spent this week')
    );
    check(
      'W3b week 2 reads 20,500 to date',
      /20,500/.test(card(w2, 'Spent to date')),
      card(w2, 'Spent to date')
    );
    const w3 = await week('2026-10-19');
    // Week 3 carries three deliveries on three lines: 4,500 + 900 + 2,200.
    check(
      'W4 week 3 reads 7,600 this week',
      /7,600/.test(card(w3, 'Spent this week')),
      card(w3, 'Spent this week')
    );
    check(
      'W4b week 3 reads 28,100 to date',
      /28,100/.test(card(w3, 'Spent to date')),
      card(w3, 'Spent to date')
    );
    const chips = {};
    w3.rows.forEach(r => {
      chips[r[0]] = r[5];
    });
    check(
      'W5 chips switch at the thresholds: price, on track, watch, over',
      chips['Gravel'] === 'Price above BOQ rate' &&
        chips['Concrete'] === 'On track' &&
        chips['Sand'] === 'Watch' &&
        chips['Timber'] === 'Over',
      chips
    );
    check(
      'W6 the forecast equals the hand calculation (73,200)',
      /73,200/.test(card(w3, 'Forecast at completion')),
      card(w3, 'Forecast at completion')
    );

    // W9: switching weeks must not write anything.
    const before = await page.evaluate(() => JSON.stringify(window.MMGR.State.getState()));
    await week('2026-10-05');
    await week('2026-10-19');
    const after = await page.evaluate(() => JSON.stringify(window.MMGR.State.getState()));
    check('W9 changing the selected week never changes saved data', before === after, {
      changed: before !== after
    });

    // W7: the PDF carries the same week and total.
    const pdfWait = page.waitForEvent('download', { timeout: 15000 });
    await page.evaluate(() => {
      const b = document.querySelector('[data-action="weekPdf"]');
      if (b) {
        b.scrollIntoView({ block: 'center' });
        b.click();
      }
    });
    const pdfDl = await pdfWait;
    const pdfPath = path.join(OUT, 'weekly.pdf');
    await pdfDl.saveAs(pdfPath);
    const pdfText = fs.readFileSync(pdfPath).toString('latin1');
    check(
      'W7 the PDF carries the week, the total and the line names',
      /2026-10-19 to 2026-10-25/.test(pdfText) &&
        /28,100/.test(pdfText) &&
        /Gravel/.test(pdfText) &&
        /73,200/.test(pdfText),
      { bytes: pdfText.length }
    );
    // W8: the spreadsheet carries the same rows.
    const xlsWait = page.waitForEvent('download', { timeout: 15000 });
    await page.evaluate(() => {
      const b = document.querySelector('[data-action="weekXlsx"]');
      if (b) {
        b.scrollIntoView({ block: 'center' });
        b.click();
      }
    });
    const xlsDl = await xlsWait;
    const xlsPath = path.join(OUT, 'weekly.xlsx');
    await xlsDl.saveAs(xlsPath);
    const xlsText = fs.readFileSync(xlsPath).toString('latin1');
    check(
      'W8 the spreadsheet carries the same line names and figures',
      /Gravel/.test(xlsText) &&
        /Concrete/.test(xlsText) &&
        /28100/.test(xlsText) &&
        /73200/.test(xlsText),
      { bytes: xlsText.length }
    );

    check('W10 no page error in the whole run', errs.length === 0, errs.slice(0, 3));
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
