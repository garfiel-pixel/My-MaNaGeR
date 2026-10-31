#!/usr/bin/env node
/* ============================================================
   tools/verify-export.cjs - T2 (AUDIT-DIRECTIVE-2026-10-18, C3 + C4)
   ------------------------------------------------------------
   C3: the printed rows ADD UP to the printed total, to the cent, and the
       ladder reads in the order the money is built.
   C4: the spreadsheet is a real .xlsx - a valid ZIP whose Summary total
       equals ESTIMATED TOTAL - and the CSV is ONE flat schema where every
       row carries the same eight fields.

   The artefact is checked the way a user's machine checks it: Python's
   zipfile.testzip() must return None, ElementTree must parse the sheet,
   and csv.DictReader must find exactly the eight columns on every row.

   Exit 0 = documents reconcile and the spreadsheet opens, 1 = drift.
   ============================================================ */
'use strict';
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(ROOT, 'tmp');
const PORT = 8765;
const BASE = 'http://127.0.0.1:' + PORT;
const delay = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const log = s => process.stdout.write('[verify-export] ' + s + '\n');
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  log((ok ? 'PASS' : 'FAIL') + '  ' + name + (ok ? '' : '   <-- ' + JSON.stringify(detail)));
}

function resolvePlaywright() {
  return require('playwright');
}

async function ensureServer() {
  try {
    const h = await fetch(BASE + '/calculator.html');
    if (h.ok) return null;
  } catch (e) {
    /* not up */
  }
  log('serve.cjs not answering - starting one for this run');
  const srv = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 30; i++) {
    await delay(1000);
    try {
      const h = await fetch(BASE + '/calculator.html');
      if (h.ok) return srv;
    } catch (e) {
      /* keep waiting */
    }
  }
  throw new Error('serve.cjs did not come up');
}

// The five golden estimates the directive names, each priced from PURE state so
// no earlier gate can move the numbers.
const GOLDEN = [
  {
    name: 'blockwork all-in (book rate)',
    st: {
      work: 'blockwall',
      d1: '10',
      d2: '2.4',
      wastePct: '0',
      basis: 'allin',
      allIn: '1747',
      currency: 'JMD',
      country: 'JM',
      taxOverride: '',
      units: 'metric'
    }
  },
  {
    name: 'blockwork split in USD',
    st: {
      work: 'blockwall',
      d1: '10',
      d2: '2.4',
      wastePct: '0',
      basis: 'measured',
      rateMat: '22',
      rateLab: '28',
      currency: 'USD',
      country: 'US',
      taxOverride: '',
      units: 'metric'
    }
  },
  {
    name: 'labour only',
    st: {
      work: 'blockwall',
      d1: '10',
      d2: '2.4',
      wastePct: '0',
      basis: 'measured',
      rateMat: '0',
      rateLab: '40',
      labourOnly: true,
      currency: 'USD',
      country: 'US',
      units: 'metric'
    }
  },
  {
    name: 'day basis (crew days)',
    st: {
      work: 'blockwall',
      d1: '10',
      d2: '2.4',
      wastePct: '0',
      basis: 'days',
      days: '2',
      dayRate: '400',
      currency: 'USD',
      country: 'US',
      units: 'metric'
    }
  },
  {
    // A book picker line prices from ITS OWN picked row + typed rate. The trade
    // and reference are resolved from the page's picker, because inventing a
    // ref would test a line the book cannot resolve.
    name: 'Book picker line',
    book: true,
    st: {
      work: 'book',
      measuredQty: '69',
      measuredEntry: 'eng',
      basis: 'allin',
      bookRate: '120',
      currency: 'JMD',
      country: 'JM',
      taxOverride: '',
      units: 'metric'
    }
  }
];

(async function main() {
  fs.mkdirSync(TMP, { recursive: true });
  const srv = await ensureServer();
  const { chromium } = resolvePlaywright();
  const browser = await chromium.launch({
    headless: true,
    executablePath: require('./chrome-launcher.cjs').chromePath,
    args: ['--disk-cache-size=0', '--no-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 160)));

  try {
    await page.addInitScript(() => {
      try {
        localStorage.setItem(
          'mmgr_calc_fx',
          JSON.stringify({ JMD: { per: '158', asOf: '2026-01-15', seeded: true } })
        );
      } catch (e) {}
    });
    await page.goto(BASE + '/calculator.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      'window.__calcEngine && window.__calcEngine.computeFor && window.MMGR_CALC_FILE',
      null,
      { timeout: 20000 }
    );

    const xlsxOk = await page.evaluate(
      () => !!(window.MMGR && window.MMGR.XlsxLite && window.MMGR_CALC_XLSX)
    );
    check('C4 the spreadsheet writer and the export hook both loaded', xlsxOk);

    for (const g of GOLDEN) {
      if (g.book) {
        // The picker's trade list only renders for an entitled session; the page
        // reads the same seam the other harnesses set.
        await page.evaluate(() => {
          window.__MMGR_RR_AUTH = 'in';
          const w = document.getElementById('calc-work');
          w.value = 'book';
          w.dispatchEvent(new Event('change', { bubbles: true }));
        });
      }
      const out = await page.evaluate(
        ([st, isJic]) => {
          if (isJic) {
            const t = document.getElementById('calc-book-trade');
            const r = document.getElementById('calc-book-row');
            if (t && r && !r.options.length && t.options.length) {
              t.dispatchEvent(new Event('change', { bubbles: true }));
            }
            // option 0 is the "pick a trade" placeholder
            const firstTrade = t && t.options.length > 1 ? t.options[1].value : '';
            if (t && firstTrade) {
              t.value = firstTrade;
              t.dispatchEvent(new Event('change', { bubbles: true }));
            }
            const firstRow = r && r.options.length ? r.options[0].value : '';
            if (r && firstRow) {
              r.value = firstRow;
              r.dispatchEvent(new Event('change', { bubbles: true }));
            }
            st = Object.assign({}, st, { bookTrade: firstTrade, bookRef: firstRow });
          }
          __calcEngine.applyState(st);
          // The exports read `lastResult`, which only the real Run path sets, so
          // press the page's own button - never a private assignment.
          const run = document.querySelector('[data-action="calcRun"]');
          if (run) {
            run.click();
          }
          const r = window.__calcEngine.computeFor(window.__calcEngine.readState());
          if (!r || r.error) {
            return { error: r && r.error ? String(r.error) : 'no result' };
          }
          const csv = window.MMGR_CALC_FILE();
          const book = window.MMGR_CALC_XLSX();
          let b64 = '';
          if (book && book.ok && book.bytes) {
            let s = '';
            const chunk = 0x8000;
            for (let i = 0; i < book.bytes.length; i += chunk) {
              s += String.fromCharCode.apply(null, book.bytes.subarray(i, i + chunk));
            }
            b64 = btoa(s);
          }
          return {
            total: r.total,
            sub: r.sub,
            oh: r.oh,
            tax: r.tax,
            csv: csv && csv.ok ? csv.text : '',
            csvOk: !!(csv && csv.ok),
            xlsxOk: !!(book && book.ok),
            xlsxName: book && book.name,
            xlsxB64: b64,
            xlsxRows: book && book.rows
          };
        },
        [g.st, !!g.book]
      );

      if (out.error) {
        check(g.name + ': prices', false, out.error);
        continue;
      }

      // ---- C3: every printed cost row is a real number, and they add up ----
      const lines = String(out.csv || '')
        .split(/\r\n/)
        .filter(Boolean);
      const header = String(lines.shift() || '').replace(/^﻿/, '');
      const cells = lines.map(l => parseCsvLine(l));
      const badShape = cells.filter(r => r.length !== 8);
      check(
        g.name + ': every CSV row carries the eight fields',
        badShape.length === 0,
        badShape[0]
      );

      const cost = cells.filter(r => r[0] === 'Cost');
      const printedTotal = cells.filter(r => r[0] === 'Total');
      const byItem = name => {
        const row = cost.find(r => r[1] === name);
        return row ? Number(row[6]) : null;
      };
      // The ladder, in order: subtotal before, overhead, subtotal after, tax.
      const order = cost.map(r => r[1]);
      const iSub = order.indexOf('Subtotal (before overhead and margin)');
      const iOh = order.indexOf('Overhead & margin');
      const iAfter = order.indexOf('Subtotal after overhead');
      const iTax = order.findIndex(n => n === 'Tax' || n === 'No tax on this job');
      check(
        g.name + ': the rows read subtotal, then overhead (when charged), then tax',
        iSub > -1 &&
          iTax > iSub &&
          (iOh === -1 ? iAfter === -1 : iOh > iSub && iAfter > iOh && iTax > iAfter),
        order
      );

      const sub = byItem('Subtotal (before overhead and margin)');
      const oh = byItem('Overhead & margin') || 0;
      const after = byItem('Subtotal after overhead');
      const taxRowName = cost.some(r => r[1] === 'Tax') ? 'Tax' : 'No tax on this job';
      const tax = byItem(taxRowName) || 0;
      const total = printedTotal.length ? Number(printedTotal[0][6]) : null;
      const cents = (a, b) => Math.abs(a - b) <= 0.005;
      check(
        g.name + ': subtotal + overhead + tax = the printed total',
        sub != null &&
          total != null &&
          cents(sub + oh + tax, total) &&
          (after == null || cents(after, sub + oh)) &&
          cents(total, Number(out.total)),
        { sub, oh, after, tax, total, engine: out.total }
      );

      // ---- C4: the spreadsheet is a real workbook ------------------------
      const safe = g.name.replace(/[^a-z0-9]+/gi, '-');
      const xlsxPath = path.join(TMP, 'export-' + safe + '.xlsx');
      fs.writeFileSync(xlsxPath, Buffer.from(out.xlsxB64, 'base64'));
      const probe = spawnSync(
        'python',
        [path.join(ROOT, 'tools', 'xlsx-probe.py'), xlsxPath, String(out.total)],
        { encoding: 'utf8' }
      );
      const probeOut = (probe.stdout || '').trim();
      check(
        g.name + ': the .xlsx opens as a ZIP and its Summary total equals the estimate',
        probe.status === 0,
        probeOut.slice(-400) || (probe.stderr || '').slice(-400)
      );
      check(g.name + ': the file is named .xlsx', /\.xlsx$/.test(out.xlsxName || ''), out.xlsxName);
      check(
        g.name + ': every CSV header cell is accounted for',
        header === 'section,item,detail,quantity,unit,rate,amount,currency',
        header
      );
    }

    // ---- C3: the PRINTED sheet is a document, so it carries cents ----------
    // C3's second half had no gate: money leaves at two decimals for print while
    // the dense card stays whole units. window.print() is a no-op in headless,
    // and the page renders BEFORE it is called, so the render is what is checked.
    const printMoney = await page.evaluate(() => {
      const out = document.getElementById('calc-output');
      const before = out.textContent;
      document.querySelector('[data-action="calcPrint"]').click();
      const during = out.textContent;
      const inPrintMode = document.body.classList.contains('print-estimate');
      window.dispatchEvent(new Event('afterprint'));
      return { before, during, after: out.textContent, inPrintMode };
    });
    check(
      'C3 the print sheet renders money to the cent',
      printMoney.inPrintMode && /[0-9][.,][0-9]{2}(?![0-9])/.test(printMoney.during),
      printMoney.during.slice(0, 160)
    );
    check(
      'C3 the screen returns to whole units after printing',
      printMoney.after === printMoney.before,
      { before: printMoney.before.slice(0, 100), after: printMoney.after.slice(0, 100) }
    );

    check('the page threw no errors while exporting', errors.length === 0, errors.slice(0, 2));
  } finally {
    await browser.close();
    if (srv) {
      try {
        srv.kill();
      } catch (e) {}
    }
  }

  const failed = results.filter(r => !r.ok);
  log('========================================');
  log(results.length + ' checks, ' + failed.length + ' failed');
  process.exit(failed.length ? 1 : 0);
})();

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        q = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      q = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}
