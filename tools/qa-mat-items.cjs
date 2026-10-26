/* ============================================================
   qa-mat-items.cjs - MAT-1 itemised materials (T-ACC gate)
   ------------------------------------------------------------
   REFINEMENT-DIRECTIVE-2026-10-24, MAT-1. The material rate of a
   trade used to be ONE number the user could not see into
   ("Boards, studs, tape, screws"). This gate proves the split:

     (1) per trade with a list, the itemised material cost per unit
         is within 15 percent of the lump rate it replaces, and the
         trade's own `refLump` is the rate the split was calibrated
         against - so the table cannot invent or lose money;
     (2) with the switch OFF the result equals the pre-change (lump)
         value, to the cent, and equals the given-state value a
         caller that knows nothing about MAT-1 produces;
     (3) turning ONE line off lowers the total by exactly its line;
     (4) with a local currency and no exchange rate the planning
         prices show blank and the lines are not priced (rule N3);
     (5) the CSV, the spreadsheet rows and the card reconcile to the
         cent, and the printed rows sum to the total (rule N2);
     (6) the drawer itself: one row per line, every box named, the
         switch opens it, add / remove / reset work, an all-in or
         labour-only line hides it, and a saved estimate recalls
         its own lines.

   Usage:  node tools/qa-mat-items.cjs
   Registry: docs/CI-TEST-COVERAGE.md -> CI row (T4 browser battery).
   ============================================================ */
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const PORT = Number(process.env.PORT || 8765);
const BASE = process.env.BASE || 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');
const log = s => process.stdout.write('[mat-items] ' + s + '\n');
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
const near = (a, b, tol) => Math.abs((Number(a) || 0) - (Number(b) || 0)) <= tol;

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

// ---- the shipped table, read out of the source (static, before any browser) --
const SRC = fs.readFileSync(path.join(ROOT, 'js', 'calculator-page.js'), 'utf8');
function sliceBlock(text, needle) {
  const at = text.indexOf(needle);
  if (at < 0) {
    return '';
  }
  const open = text.indexOf('{', at);
  let depth = 0,
    quote = '';
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') {
        i++;
      } else if (ch === quote) {
        quote = '';
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return text.slice(open, i + 1);
      }
    }
  }
  return '';
}
const ACC_SRC = sliceBlock(SRC, 'const ACCESSORIES = {');
const WORK_SRC = sliceBlock(SRC, 'const WORK = {');
const keysOf = src =>
  (src.match(/^ {4}["']?[A-Za-z][\w-]*["']?: \{/gm) || []).map(
    s => s.match(/["']?([A-Za-z][\w-]*)["']?/)[1]
  );
const accKeys = keysOf(ACC_SRC);
const noneEntries = (ACC_SRC.match(/accessoriesNone: ["']/g) || []).length;

(async () => {
  check(
    'ACCESSORIES table parsed from source (>= 40 trades)',
    accKeys.length >= 40,
    accKeys.length
  );
  check(
    'the table carries itemised trades and trades with a written reason',
    (ACC_SRC.match(/items: \[/g) || []).length >= 30 && noneEntries >= 10,
    { items: (ACC_SRC.match(/items: \[/g) || []).length, none: noneEntries }
  );

  if (!process.env.BASE) {
    let up = false;
    try {
      const h = await fetch(BASE + '/calculator.html');
      up = h.ok;
    } catch (e) {
      up = false;
    }
    if (!up) {
      log('starting serve.cjs for this run');
      global.__srv = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
      for (let i = 0; i < 30; i++) {
        await delay(1000);
        try {
          const h = await fetch(BASE + '/calculator.html');
          if (h.ok) {
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
  await page.goto(BASE + '/calculator.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(
    function () {
      return !!document.getElementById('calc-work') && !!window.__calcEngine;
    },
    null,
    { timeout: 30000 }
  );
  await page.waitForTimeout(700);
  check('calculator page boots with the engine live', pageErrors === 0, pageErrors);

  // ---------------------------------------------------------------- T-ACC (1)
  // The reconciliation table: the itemised material cost per unit against the
  // lump rate it replaces. USD, so the planning prices need no conversion.
  const workKeys = await page.evaluate(() => Object.keys(window.__calcEngine.work()));
  const table = await page.evaluate(() => window.__calcEngine.accessories());
  check(
    'the trade table reaches the harness (>= 45 trades)',
    workKeys.length >= 45,
    workKeys.length
  );
  const missing = workKeys.filter(k => !table[k]);
  check(
    'every trade carries its own material decision (a list or a written reason)',
    missing.length === 0,
    missing
  );
  const withItems = Object.keys(table).filter(k => table[k].items && table[k].items.length);
  check('the table carries itemised trades (>= 30)', withItems.length >= 30, withItems.length);

  const rows = await page.evaluate(list => {
    const WORK = window.__calcEngine.work();
    const out = [];
    list.forEach(key => {
      const t = window.__calcEngine.accessories()[key];
      const w = WORK[key];
      // A geometry that satisfies every trade: the dims it asks for, 400 mm
      // where the label says millimetres. Fencing is the one trade whose rate is
      // a function of height, and its split was calibrated at the 1.8 m standard
      // height. Rates are per PRICED unit (the book's own ft2/ft rows convert
      // before they price), so both sides of the comparison are per priced unit.
      const mm = s => /\(mm\)/.test(s || '');
      const st = {
        work: key,
        units: 'metric',
        d1: '8',
        d2: w.d2 ? (mm(w.d2) ? '400' : '4') : '',
        d3: w.d3 ? (mm(w.d3) ? '150' : '0.15') : '',
        currency: 'USD',
        country: 'US',
        quality: 'standard',
        basis: 'measured',
        matMode: 'items',
        acc: '{}',
        _accFx: 1
      };
      if (key === 'fencing') {
        st.d2 = '1.8';
      }
      const r = window.__calcEngine.computeFor(st);
      if (!r || r.error) {
        out.push({ key: key, error: r ? r.error : 'null' });
        return;
      }
      const perUnit = r.effMat + (r.qty > 0 ? r.accTotal / r.qty : 0);
      const lump = r.modelMr * r.rateFactor;
      out.push({
        key: key,
        qty: r.qty,
        lines: r.accessories.length,
        want: t.items.length,
        refLump: t.refLump,
        lump: lump,
        perUnit: perUnit,
        diffPct: lump > 0 ? ((perUnit - lump) / lump) * 100 : NaN,
        share: r.primaryShare,
        accTotal: r.accTotal,
        mat: r.mat,
        total: r.total
      });
    });
    return out;
  }, withItems);

  const broke = rows.filter(r => r.error);
  check('every itemised trade prices from its dims', broke.length === 0, broke.slice(0, 5));
  const wrongCount = rows.filter(r => !r.error && r.lines !== r.want);
  check(
    'all default lines are switched on and priced',
    wrongCount.length === 0,
    wrongCount.slice(0, 5)
  );
  const badRef = rows.filter(r => !r.error && Math.abs(r.refLump - r.lump) > 0.01);
  check(
    'each trade records the lump rate its split was calibrated against',
    badRef.length === 0,
    badRef.slice(0, 5)
  );
  const outOfBand = rows.filter(r => !r.error && !(Math.abs(r.diffPct) <= 15));
  check(
    'T-ACC (1): itemised material per unit is within 15% of the lump it replaces',
    outOfBand.length === 0,
    outOfBand
      .sort((a, b) => Math.abs(b.diffPct) - Math.abs(a.diffPct))
      .slice(0, 6)
      .map(r => r.key + ' ' + r.diffPct.toFixed(2) + '%')
  );
  log(
    'reconciliation worst case: ' +
      rows
        .slice()
        .sort((a, b) => Math.abs(b.diffPct) - Math.abs(a.diffPct))
        .slice(0, 3)
        .map(r => r.key + ' ' + r.diffPct.toFixed(3) + '%')
        .join(', ')
  );

  // Fencing is height-dependent: the split has to hold across the heights the
  // trade actually prices, not only at the calibration height.
  const fence = await page.evaluate(() => {
    const out = [];
    [1.2, 1.8, 2.4, 3].forEach(h => {
      const r = window.__calcEngine.computeFor({
        work: 'fencing',
        units: 'metric',
        d1: '20',
        d2: String(h),
        currency: 'USD',
        country: 'US',
        quality: 'standard',
        basis: 'measured',
        matMode: 'items',
        acc: '{}',
        _accFx: 1
      });
      const perUnit = r.effMat + r.accTotal / r.qty;
      const lump = r.modelMr * r.rateFactor;
      out.push({ h: h, diffPct: ((perUnit - lump) / lump) * 100 });
    });
    return out;
  });
  check(
    'T-ACC (1b): fencing holds across 1.2 to 3 m (its rate is a function of height)',
    fence.every(f => Math.abs(f.diffPct) <= 15),
    fence
  );

  // ---------------------------------------------------------- T-ACC (2) and (3)
  const offEq = await page.evaluate(list => {
    const out = [];
    list.forEach(key => {
      const base = {
        work: key,
        units: 'metric',
        d1: '8',
        d2: key === 'fencing' ? '1.8' : '4',
        d3: '150',
        currency: 'USD',
        country: 'US',
        quality: 'standard',
        basis: 'measured',
        acc: '{}',
        _accFx: 1
      };
      const bare = window.__calcEngine.computeFor(Object.assign({}, base));
      const lump = window.__calcEngine.computeFor(Object.assign({}, base, { matMode: 'lump' }));
      // Every line switched off by hand, which must land on the same money.
      const store = {};
      (window.__calcEngine.accessories()[key].items || []).forEach(it => {
        store[key + '|' + it.id] = { on: false };
      });
      const allOff = window.__calcEngine.computeFor(
        Object.assign({}, base, { matMode: 'items', acc: JSON.stringify(store) })
      );
      out.push({
        key: key,
        bare: bare.total,
        lump: lump.total,
        allOff: allOff.total,
        items: window.__calcEngine.computeFor(Object.assign({}, base, { matMode: 'items' }))
          .accTotal
      });
    });
    return out;
  }, withItems);
  const offBad = offEq.filter(r => !near(r.bare, r.lump, 0.005));
  check(
    'T-ACC (2): switch off equals the pre-change lump total, to the cent',
    offBad.length === 0,
    offBad.slice(0, 5)
  );
  check(
    'T-ACC (2b): the switch ON carries real money in every itemised trade',
    offEq.every(r => r.items > 0),
    offEq.filter(r => !(r.items > 0)).slice(0, 5)
  );
  // Every line switched off is NOT the lump: the main material keeps its share
  // of the rate and the removed lines take exactly their own money out. That is
  // the contract the directive asks for, and it is asserted here so a future
  // change cannot quietly make "line off" mean "lump on".
  const allOffDiff = offEq.filter(r => !(r.allOff < r.lump - 0.005));
  check(
    'every line off leaves the main material at its share (below the lump)',
    allOffDiff.length === 0,
    allOffDiff.slice(0, 5)
  );

  const oneOff = await page.evaluate(() => {
    const st = {
      work: 'drywall',
      units: 'metric',
      d1: '10',
      d2: '3',
      currency: 'USD',
      country: 'US',
      quality: 'standard',
      basis: 'measured',
      _accFx: 1
    };
    const all = window.__calcEngine.computeFor(
      Object.assign({}, st, { matMode: 'items', acc: '{}' })
    );
    const line = all.accessories[1];
    const store = {};
    store['drywall|' + line.id] = { on: false };
    const off = window.__calcEngine.computeFor(
      Object.assign({}, st, { matMode: 'items', acc: JSON.stringify(store) })
    );
    return {
      line: line,
      allTotal: all.total,
      offTotal: off.total,
      allAcc: all.accTotal,
      offAcc: off.accTotal,
      offLines: off.accessories.length
    };
  });
  check(
    'T-ACC (3): switching one line off lowers the total by exactly its line',
    near(oneOff.allTotal - oneOff.offTotal, oneOff.line.total, 0.005) &&
      near(oneOff.allAcc - oneOff.offAcc, oneOff.line.total, 0.005) &&
      oneOff.offLines === 4,
    oneOff
  );

  // ----------------------------------------------------------------- T-ACC (4)
  // A local currency with no exchange rate: the planning prices are US dollars,
  // so they show blank and the lines are not priced rather than charged as JMD.
  const noFx = await page.evaluate(() => {
    const st = {
      work: 'drywall',
      units: 'metric',
      d1: '10',
      d2: '3',
      currency: 'JMD',
      country: 'JM',
      quality: 'standard',
      basis: 'measured',
      rateMat: '2500',
      rateLab: '1800',
      matMode: 'items',
      acc: '{}',
      _accFx: null
    };
    const r = window.__calcEngine.computeFor(st);
    return {
      error: r && r.error,
      unpriced: r && r.accUnpriced,
      lines: r && r.accessories.length,
      prices: r && r.accessories.map(a => a.price),
      accTotal: r && r.accTotal,
      mat: r && r.mat,
      qty: r && r.qty,
      share: r && r.primaryShare
    };
  });
  check(
    'T-ACC (4): no exchange rate blanks every planning price (N3)',
    !noFx.error &&
      noFx.lines === 5 &&
      noFx.unpriced === 5 &&
      noFx.prices.every(p => p === null) &&
      noFx.accTotal === 0,
    noFx
  );
  check(
    'T-ACC (4b): the primary material still prices (the typed rate is JMD, not USD)',
    !noFx.error && noFx.mat > 0 && near(noFx.mat / noFx.qty / 2500, noFx.share, 0.001),
    { mat: noFx.mat, qty: noFx.qty, share: noFx.share }
  );

  // ----------------------------------------------------------------- T-ACC (5)
  // The exports and the card carry the same money: the CSV Cost rows, the
  // spreadsheet's Cost breakdown rows, and the total the document states.
  const exports1 = await page.evaluate(() => {
    const st = {
      work: 'drywall',
      units: 'metric',
      d1: '10',
      d2: '3',
      currency: 'USD',
      country: 'US',
      quality: 'standard',
      basis: 'measured',
      matMode: 'items',
      acc: '{}',
      _accFx: 1
    };
    const r = window.__calcEngine.computeFor(st);
    r.name = 'Plasterboard partition';
    const rows = window.__calcEngine.exportRows(r);
    const csv = window.__calcEngine.estimateCsv(r);
    const sheets = window.__calcEngine.xlsxSheets(r);
    const cost = rows.filter(x => x[0] === 'Cost');
    const names = r.accessories.map(a => a.name);
    const exported = cost.filter(x => names.indexOf(x[1]) >= 0);
    const sum = exported.reduce((s, x) => s + Number(x[6] || 0), 0);
    const totalRow = rows.filter(x => x[0] === 'Total').pop();
    const breakdown = (sheets.find(s => s.name === 'Cost breakdown') || { rows: [] }).rows;
    const bs = breakdown
      .filter(row => names.indexOf(row[0]) >= 0)
      .reduce((s, row) => s + Number(row[2] || 0), 0);
    // Rule N2: what is printed has to add up. The Cost rows ABOVE the first
    // subtotal row are the money that builds it, so their amount must equal that
    // subtotal to the cent - with the accessory lines included as rows.
    const subAt = cost.findIndex(x => /^Subtotal \(before/.test(x[1]));
    const before = cost.slice(0, subAt);
    return {
      accTotal: r.accTotal,
      exportedSum: sum,
      breakdownSum: bs,
      counted: exported.length,
      lines: r.accessories.length,
      csvHasLines: names.filter(n => csv.indexOf(n) >= 0).length,
      csvTotal: csv.indexOf(String(totalRow[6])) >= 0,
      total: r.total,
      sub: r.sub,
      documentTotal: totalRow[6],
      rowsSum: before.reduce((s, x) => s + Number(x[6] || 0), 0),
      statedSub: subAt >= 0 ? Number(cost[subAt][6]) : null
    };
  });
  check(
    'T-ACC (5): the CSV, the spreadsheet and the engine carry the same line money',
    exports1.counted === exports1.lines &&
      near(exports1.exportedSum, exports1.accTotal, 0.005) &&
      near(exports1.breakdownSum, exports1.accTotal, 0.005) &&
      exports1.csvHasLines === exports1.lines,
    exports1
  );
  check(
    'T-ACC (5b): the export total row is the engine total, to the cent',
    near(exports1.documentTotal, exports1.total, 0.005) && exports1.csvTotal,
    exports1
  );
  check(
    'T-ACC (5c): the printed rows sum to the stated subtotal (rule N2)',
    near(exports1.rowsSum, exports1.statedSub, 0.011) &&
      near(exports1.statedSub, exports1.sub, 0.011),
    exports1
  );

  // ------------------------------------------------------------------ the drawer
  // Drive the real page: pick drywall, switch the row on, and read the drawer.
  const drawer = await page.evaluate(async () => {
    const $ = id => document.getElementById(id);
    const flush = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    $('calc-work').value = 'drywall';
    $('calc-work').dispatchEvent(new Event('change', { bubbles: true }));
    $('calc-d1').value = '10';
    $('calc-d1').dispatchEvent(new Event('input', { bubbles: true }));
    $('calc-d2').value = '3';
    $('calc-d2').dispatchEvent(new Event('input', { bubbles: true }));
    $('calc-currency').value = 'USD';
    $('calc-currency').dispatchEvent(new Event('change', { bubbles: true }));
    $('calc-country').value = 'US';
    $('calc-country').dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    const row = $('row-itemise');
    const sw = $('calc-itemise');
    const before = {
      rowPresent: !!row,
      switchPresent: !!sw,
      role: sw ? sw.getAttribute('role') : null,
      inSetRow: !!(sw && sw.closest('.set-row') === row),
      drawerClosed: row ? !row.classList.contains('is-on') : null
    };
    sw.checked = true;
    sw.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    const rowsEls = Array.prototype.slice.call(
      document.querySelectorAll('#calc-acc-list .acc-row')
    );
    const named = rowsEls.every(r =>
      Array.prototype.every.call(r.querySelectorAll('input'), i => !!i.getAttribute('aria-label'))
    );
    const lineText = Array.prototype.map.call(
      document.querySelectorAll('#calc-acc-list .acc-line'),
      e => e.textContent
    );
    return {
      before: before,
      open: row.classList.contains('is-on'),
      onSwitch: sw.checked,
      expanded: sw.getAttribute('aria-expanded'),
      rows: rowsEls.length,
      firstKeys: rowsEls.map(r => r.getAttribute('data-key')).slice(0, 3),
      named: named,
      switches: document.querySelectorAll('#calc-acc-list [data-acc-on]').length,
      qtyBoxes: document.querySelectorAll('#calc-acc-list [data-acc-qty]').length,
      priceBoxes: document.querySelectorAll('#calc-acc-list [data-acc-price]').length,
      lineText: lineText,
      totalLabel: ($('calc-acc-total') || {}).textContent || '',
      note: ($('calc-acc-note') || {}).textContent || '',
      state: JSON.parse(JSON.stringify(window.__calcEngine.readState()))
    };
  });
  check(
    'the itemise row exists as a setting row with the app switch',
    drawer.before.rowPresent &&
      drawer.before.switchPresent &&
      drawer.before.role === 'switch' &&
      drawer.before.inSetRow &&
      drawer.before.drawerClosed === true,
    drawer.before
  );
  check(
    'the switch opens the drawer and its aria-expanded follows',
    drawer.open && drawer.onSwitch && drawer.expanded === 'true',
    { open: drawer.open, expanded: drawer.expanded }
  );
  check(
    'one row per material line, each with a switch, a quantity and a price',
    drawer.rows === 5 && drawer.switches === 5 && drawer.qtyBoxes === 5 && drawer.priceBoxes === 5,
    drawer
  );
  check('every box in the drawer carries an accessible name', drawer.named === true, drawer.named);
  check(
    'each line shows the money it adds',
    drawer.lineText.filter(t => t && t !== 'no rate').length === 5,
    drawer.lineText
  );
  check(
    'the readout names the main material and the line count',
    /Plasterboards/.test(drawer.totalLabel) && /5 lines/.test(drawer.totalLabel),
    drawer.totalLabel
  );
  check(
    'the snapshot carries the switch and the line store (recall fidelity)',
    drawer.state.matMode === 'items' &&
      typeof drawer.state.acc === 'string' &&
      typeof JSON.parse(drawer.state.acc) === 'object',
    { matMode: drawer.state.matMode, acc: drawer.state.acc }
  );

  // The card: the accessory rows print under the material row, and the total on
  // the card is the engine total to the cent.
  const card = await page.evaluate(async () => {
    const flush = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    document.querySelector('[data-action="calcRun"]').click();
    await new Promise(res => setTimeout(res, 200));
    const lines = Array.prototype.map.call(
      document.querySelectorAll('#calc-output .calc-line-acc'),
      e => e.textContent
    );
    const totalEl = Array.prototype.slice
      .call(document.querySelectorAll('#calc-output .calc-line'))
      .find(e => /Estimated total/.test(e.textContent));
    return {
      cardLines: lines.length,
      lines: lines,
      totalText: totalEl ? totalEl.textContent : '',
      engine: window.__calcEngine.computeFor(window.__calcEngine.readState()),
      note: document.querySelector('#calc-output .bcp-jm-note')
        ? document.querySelector('#calc-output .bcp-jm-note').textContent
        : ''
    };
  });
  check(
    'the card lists the itemised lines under the material row',
    card.cardLines === 5,
    card.lines
  );
  // The card rounds to the currency unit on screen (the printed sheet carries
  // cents), so the comparison is the engine total rounded the same way.
  check(
    'the card total is the engine total (rows sum to the total, rule N2)',
    card.engine && card.totalText.replace(/[^0-9.]/g, '') !== ''
      ? near(Number(card.totalText.replace(/[^0-9.]/g, '')), Math.round(card.engine.total), 0.51)
      : false,
    { totalText: card.totalText, engineTotal: card.engine && card.engine.total }
  );

  // Add / edit / remove the user's own line, and switch a planning line off.
  const own = await page.evaluate(async () => {
    const $ = id => document.getElementById(id);
    const flush = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    const totalNow = () => window.__calcEngine.computeFor(window.__calcEngine.readState()).total;
    const before = totalNow();
    document.querySelector('[data-action="calcAccAdd"]').click();
    await flush();
    const mine = document.querySelector('#calc-acc-list .acc-row.is-mine');
    const nameIn = mine.querySelector('.acc-name-in');
    nameIn.value = 'Corner tape extra';
    nameIn.dispatchEvent(new Event('input', { bubbles: true }));
    const unitIn = mine.querySelector('.acc-unit-in');
    unitIn.value = 'each';
    unitIn.dispatchEvent(new Event('input', { bubbles: true }));
    const qty = mine.querySelector('[data-acc-qty]');
    qty.value = '4';
    qty.dispatchEvent(new Event('input', { bubbles: true }));
    const price = mine.querySelector('[data-acc-price]');
    price.value = '2.5';
    price.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
    const withMine = totalNow();
    const rowsAfterAdd = document.querySelectorAll('#calc-acc-list .acc-row').length;
    // Now switch a planning line off by clicking its switch.
    const first = document.querySelector('#calc-acc-list .acc-row:not(.is-mine) [data-acc-on]');
    const key = first.closest('.acc-row').getAttribute('data-key');
    // The line's own money comes from the ENGINE's result - one derivation, the
    // one the card and the total use (a hand-computed qty here would be a second
    // copy of the arithmetic that could drift).
    const engineBefore = window.__calcEngine.computeFor(window.__calcEngine.readState());
    const lineTotal = engineBefore.accessories.find(a => a.key === key).total;
    first.checked = false;
    first.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    const afterOff = totalNow();
    const offClass = first.closest('.acc-row').classList.contains('is-off');
    // Remove the user's own line again.
    document.querySelector('#calc-acc-list .is-mine [data-action="calcAccDel"]').click();
    await flush();
    const afterDel = totalNow();
    return {
      before: before,
      withMine: withMine,
      lineTotal: lineTotal,
      mine: 4 * 2.5,
      afterOff: afterOff,
      afterDel: afterDel,
      rowsAfterAdd: rowsAfterAdd,
      offClass: offClass,
      mineGone: !document.querySelector('#calc-acc-list .is-mine')
    };
  });
  check(
    'Add my own item adds a line that prices at its own quantity x price',
    own.rowsAfterAdd === 6 && near(own.withMine - own.before, own.mine, 0.005),
    own
  );
  check(
    'a line switch takes exactly that line out of the total',
    own.offClass && near(own.withMine - own.afterOff, own.lineTotal, 0.005),
    own
  );
  check(
    'removing the user’s own line takes its money back out',
    own.mineGone && near(own.afterDel, own.afterOff - own.mine, 0.005),
    own
  );

  // Labour only hides the drawer; the all-in basis hides it too (neither splits
  // material); Reset returns the planning allowances.
  const hide = await page.evaluate(async () => {
    const $ = id => document.getElementById(id);
    const flush = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    document.querySelector('[data-action="calcAccReset"]').click();
    await flush();
    const resetRows = document.querySelectorAll('#calc-acc-list .acc-row').length;
    $('calc-labour-only').checked = true;
    $('calc-labour-only').dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    const hiddenLabour = $('row-itemise').hidden;
    $('calc-labour-only').checked = false;
    $('calc-labour-only').dispatchEvent(new Event('change', { bubbles: true }));
    $('calc-basis').value = 'allin';
    $('calc-basis').dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    const hiddenAllIn = $('row-itemise').hidden;
    $('calc-basis').value = 'measured';
    $('calc-basis').dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    return { resetRows: resetRows, hiddenLabour: hiddenLabour, hiddenAllIn: hiddenAllIn };
  });
  check('reset returns the planning allowances for this trade', hide.resetRows === 5, hide);
  check(
    'labour-only and the all-in basis both hide the drawer (no material to split)',
    hide.hiddenLabour === true && hide.hiddenAllIn === true,
    hide
  );

  // A recall: leave the trade, come back through applyState, and the saved
  // lines must be the ones that price.
  const recall = await page.evaluate(async () => {
    const $ = id => document.getElementById(id);
    const flush = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    const st = window.__calcEngine.readState();
    st.matMode = 'items';
    st.acc = JSON.stringify({ 'drywall|compound': { on: false }, 'drywall|screws': { qty: '22' } });
    window.__calcEngine.applyState(st);
    await flush();
    const r = window.__calcEngine.computeFor(window.__calcEngine.readState());
    return {
      mode: window.__calcEngine.readState().matMode,
      switchOn: $('calc-itemise').checked,
      lines: r.accessories.length,
      compounds: r.accessories.filter(a => a.id === 'compound').length,
      screws: (r.accessories.find(a => a.id === 'screws') || {}).qty,
      drawerRows: document.querySelectorAll('#calc-acc-list .acc-row').length
    };
  });
  check(
    'a recalled estimate prices its own lines (one off, one edited)',
    recall.mode === 'items' &&
      recall.switchOn === true &&
      recall.lines === 4 &&
      recall.compounds === 0 &&
      recall.screws === 22 &&
      recall.drawerRows === 5,
    recall
  );

  check('no uncaught page error during the wave', pageErrors === 0, pageErrors);

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
