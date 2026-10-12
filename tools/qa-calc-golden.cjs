/* ============================================================
   qa-calc-golden.cjs - golden-case engine gate (plan v2, E5)
   ------------------------------------------------------------
   The plan's rule: "No test, no ship. Every item ships with a
   hand-calculated expected result. A difference of more than 1
   currency unit rejects it." This harness reads
   tools/calc-golden-cases.json (expecteds HAND-CALCULATED from
   the documented formulas, never read off the engine) and runs
   each case through the real page's pure engine
   (window.__calcEngine.computeFor) in a real browser.

   One case = one gate: quantity (tol 0.02), materials, labor,
   tax and total (tol 1.0 currency unit). New items and engine
   changes are INVALID without a case here - the Phase 0 gate
   ("33 of 33 items have a golden case and pass").

   Usage:  node tools/qa-calc-golden.cjs
           BASE=https://... node tools/qa-calc-golden.cjs  (prod smoke)
   Registry: CI-TEST-COVERAGE.md -> CI row (serve.cjs battery).
   ============================================================ */
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const PORT = 8765;
const BASE = process.env.BASE || 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');
const log = s => process.stdout.write('[calc-golden] ' + s + '\n');
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
        JSON.stringify(detail === undefined ? null : detail).slice(0, 500)
    );
  }
};
function resolvePlaywright() {
  try {
    return require('playwright');
  } catch (e) {}
  const roots = [
    path.join(os.homedir(), 'AppData', 'Local', 'npm-cache', '_npx'),
    path.join(os.homedir(), '.npm', '_npx')
  ];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const dir of fs.readdirSync(root)) {
      const p = path.join(root, dir, 'node_modules', 'playwright');
      if (fs.existsSync(path.join(p, 'index.js'))) return require(p);
    }
  }
  throw new Error('playwright not found - npm i -D playwright');
}
// Playwright demands an ABSOLUTE executablePath (see qa-calc-trade-coverage).
function absolutizeChrome(p) {
  if (!p) return undefined;
  if (path.isAbsolute(p)) return fs.existsSync(p) ? p : undefined;
  const finder = os.platform() === 'win32' ? 'where' : 'command -v';
  try {
    const out = require('child_process')
      .execSync(finder + ' ' + JSON.stringify(p), { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
      .split(/\r?\n/)[0];
    if (out && fs.existsSync(out)) return out;
  } catch (e) {
    /* fall back */
  }
  return undefined;
}
(async () => {
  const file = path.join(ROOT, 'tools', 'calc-golden-cases.json');
  const book = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cases = book.cases || [];
  check('golden case file carries cases (>= 40)', cases.length >= 40, cases.length);

  // ---- Conversion band (owner 2026-10-12, "Fix the wrong Fabric metric rate") --
  // Every metric rate in the shipped book has to sit inside the rounding band of
  // its imperial rate, converted by the rules in JIC_Rate_Book_2025-2027_FULL.md
  // section 6. This is STATIC - it reads the source table out of
  // js/calculator-page.js - so it runs before any browser boots and a boot
  // failure cannot skip it.
  //
  // It exists because Steelwork #6 Fabric shipped 276 per m2 where 125 per yd2
  // converts to 149: the imperial figure had been multiplied by the
  // pounds-to-kilograms factor instead of the square-yard factor, so metric mesh
  // was priced about 85% high. Measured on the fixed table the worst row is now
  // 4.99% (Painting #5/#6 - a rate under JMD 20 where the source's own dollar
  // rounding is worth several percent), so the band is 6%: wide enough to accept
  // every honest row, far tighter than the 85% fault it exists to catch.
  {
    const src = fs.readFileSync(path.join(ROOT, 'js', 'calculator-page.js'), 'utf8');
    const at = src.indexOf('const JIC_RATES = [');
    const open = at < 0 ? -1 : src.indexOf('[', at);
    // Bracket scan that skips strings, so a '[' inside a description cannot end
    // the slice early.
    let depth = 0,
      end = -1,
      quote = '';
    for (let i = open; i >= 0 && i < src.length; i++) {
      const ch = src[i];
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
      } else if (ch === '[') {
        depth++;
      } else if (ch === ']' && --depth === 0) {
        end = i;
        break;
      }
    }
    const slice = end < 0 ? '' : src.slice(open, end + 1);
    const ROW =
      /trade:\s*'([^']*)'[\s\S]*?ref:\s*'([^']*)'[\s\S]*?impUnit:\s*'([^']*)'[\s\S]*?impRate:\s*([\d.]+)[\s\S]*?metRate:\s*([\d.]+)/g;
    const table = [];
    let m;
    while ((m = ROW.exec(slice))) {
      table.push({
        trade: m[1],
        ref: m[2],
        impUnit: m[3],
        impRate: Number(m[4]),
        metRate: Number(m[5])
      });
    }
    // Parsed count must equal the declared count, so a future row that parses
    // differently is a FAILURE rather than a silently skipped row.
    const declared = (slice.match(/trade:\s*'/g) || []).length;
    check(
      'rate table parsed out of js/calculator-page.js (every row, none silently skipped)',
      table.length >= 100 && table.length === declared,
      { parsed: table.length, declared }
    );
    // The documented conversion rules (FULL doc section 6). Units in PLAIN
    // convert at 1.0; any unit in neither list means a NEW basis was added and
    // this gate must be taught it rather than quietly passed.
    const RULES = {
      'Yd.Sq.': 1 / 0.83612736,
      'Yd.Cu.': 1 / 0.764554858,
      'Ft.Run': 1 / 0.3048,
      'Ft.Sq.': 1 / 0.09290304,
      'Lb.': 1 / 0.45359237,
      'In.': 100 / 25.4
    };
    const PLAIN = ['Doz.', 'No.', 'Each', 'Ea.', 'Load'];
    const unknown = table.filter(
      r => RULES[r.impUnit] === undefined && PLAIN.indexOf(r.impUnit) === -1
    );
    check(
      'every imperial unit in the rate table has a documented conversion rule',
      unknown.length === 0,
      unknown.map(r => r.trade + ' ' + r.ref + ' (' + r.impUnit + ')').slice(0, 10)
    );
    const far = [];
    for (const r of table) {
      const f = RULES[r.impUnit];
      const exp = f === undefined ? r.impRate : r.impRate * f;
      if (!exp) {
        continue;
      }
      const pct = (Math.abs(r.metRate - exp) / exp) * 100;
      if (pct > 6) {
        far.push({
          row: r.trade + ' ' + r.ref,
          imp: r.impRate,
          met: r.metRate,
          exp: +exp.toFixed(2),
          pct: +pct.toFixed(1)
        });
      }
    }
    check(
      'every metric rate sits inside the 6% conversion band (JIC conversion gate)',
      far.length === 0,
      far.slice(0, 10)
    );
    // Named row, because a future editor is more likely to widen the band than
    // to notice this one number in it.
    const fab = table.find(r => r.trade === 'Steelwork' && /#6\b/.test(r.ref));
    check(
      'Steelwork #6 Fabric metric rate is the converted 149, not the unit-mixed 276',
      !!fab && fab.metRate === 149,
      fab
    );

    // The shipped book's own footer (owner finding 5, "the footer is wrong"). It
    // claimed 90 line items over a 100-row table. Rather than trust the number
    // that is printed there, count the data rows out of the file and require
    // the footer to agree - and require it to agree with the app's table too,
    // because a book that drifts from the calculator is worse than one that is
    // merely miscounted.
    const md = fs.readFileSync(path.join(ROOT, 'JIC_Rate_Book_2025-2027.md'), 'utf8');
    // Data rows live under a '## Trade' heading, stop at the next heading or
    // the Unit Key, and never carry a 'Ref' header.
    let inKey = false,
      mdRows = 0;
    for (const line of md.split(/\r?\n/)) {
      if (/^### Unit Key/.test(line)) {
        inKey = true;
        continue;
      }
      if (/^---/.test(line)) {
        inKey = false;
      }
      if (/^## /.test(line)) {
        continue;
      }
      if (!inKey && /^\| [A-Za-z0-9]/.test(line) && !/^\| Ref /.test(line)) {
        mdRows++;
      }
    }
    const footer = /\((\d+) pages?, (\d+) line items? across (\d+) trades?\)/.exec(md);
    check(
      'shipped book footer states the row count its table actually holds',
      !!footer && Number(footer[2]) === mdRows,
      { printed: footer ? footer[2] : null, actual: mdRows }
    );
    check(
      'shipped book and the calculator table carry the same rows',
      !!footer && mdRows === table.length && Number(footer[3]) === 11,
      { book: mdRows, app: table.length, trades: footer ? footer[3] : null }
    );
  }

  if (!process.env.BASE) {
    let srv = null;
    try {
      const h = await fetch(BASE + '/calculator.html');
      if (!h.ok) throw 0;
    } catch (e) {
      log('starting serve.cjs for this run');
      srv = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
      for (let i = 0; i < 30; i++) {
        await delay(1000);
        try {
          const h = await fetch(BASE + '/calculator.html');
          if (h.ok) break;
        } catch (e) {}
      }
    }
    global.__srv = srv;
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
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  let consoleErrors = 0;
  page.on('pageerror', () => {
    consoleErrors++;
  });
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const url = (m.location() || {}).url || '';
    if (/Failed to load resource/.test(m.text()) && /\/api\//.test(url)) return; // signed-out probe noise
    consoleErrors++;
  });
  await page.goto(BASE + '/calculator.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(
    function () {
      return !!document.getElementById('calc-work') && !!window.__calcEngine;
    },
    null,
    { timeout: 30000 }
  );
  await page.waitForTimeout(600);

  const near = (a, b, tol) => Math.abs((Number(a) || 0) - (Number(b) || 0)) <= tol;
  let slipFlags = 0;
  for (const c of cases) {
    // Pure unit-factor cases (E3): direct asserts on rateFactor, no engine.
    if (c.pure && c.pure.rateFactor) {
      const rows = c.pure.rateFactor;
      const res = await page.evaluate(
        rows =>
          rows.map(rw => ({
            f: rw[0],
            u: rw[1],
            got: window.__calcEngine.rateFactor(rw[0], rw[1]),
            want: rw[2]
          })),
        rows
      );
      const bad = res.filter(x => Math.abs(x.got - x.want) > 1e-9);
      check(
        '[' + c.id + '] rate-entry unit factors hold (E3)',
        bad.length === 0,
        bad.length ? bad : res.map(x => x.f + '->' + x.u + '=' + x.got).join(' ')
      );
      continue;
    }
    let r = null,
      evalErr = null;
    try {
      r = await page.evaluate(c => {
        const st = {
          work: c.work,
          units: c.units || 'metric',
          d1: (c.dims && c.dims.d1) || '',
          d2: (c.dims && c.dims.d2) || '',
          d3: (c.dims && c.dims.d3) || '',
          currency: c.currency || 'USD',
          country: c.country || 'US',
          quality: c.quality || 'standard',
          wastePct: c.wastePct,
          rateMat: c.rateMat,
          rateLab: c.rateLab,
          rateEq: c.rateEq,
          ohPct: c.ohPct,
          onCostPct: c.onCostPct,
          taxOverride: c.taxOverride,
          piecePrice: c.piecePrice,
          pieceSize: c.pieceSize,
          measuredQty: c.measuredQty,
          measuredUnit: c.measuredUnit,
          openings: c.openings ? JSON.stringify(c.openings) : undefined,
          variant: c.variant,
          labourOnly: c.labourOnly,
          // All-in (JIC combined) + per-day crew basis (owner 2026-10-02).
          allInRate: c.allInRate,
          daysStr: c.days,
          dayRateStr: c.dayRate,
          _matModel: c.matModel,
          _labModel: c.labModel,
          _allInModel: c.allInModel
        };
        const r = window.__calcEngine.computeFor(st);
        if (!r) return { error: 'null result' };
        if (r.error) return { error: r.error };
        // Owner directive 2026-10-01: a golden case is plausible input - the
        // unit-slip guard must flag NOTHING on any of them (zero false positives).
        return {
          qty: r.qty,
          mat: r.mat,
          lab: r.lab,
          tax: r.tax,
          total: r.total,
          sub: r.sub,
          onCost: r.onCost,
          allInCost: r.allInCost,
          days: r.days,
          allIn: r.allIn,
          dayBasis: r.dayBasis,
          labourOnly: r.labourOnly,
          bookFilled: r.bookFilled,
          slips: window.__calcEngine.dimSlips(st)
        };
      }, c);
    } catch (e) {
      evalErr = String((e && e.message) || e).slice(0, 300);
    }
    if (evalErr || !r || r.error) {
      check('[' + c.id + '] runs', false, evalErr || r);
      continue;
    }
    const e = c.expect;
    const parts = [];
    if (e.qty != null && !near(r.qty, e.qty, 0.02)) parts.push('qty ' + r.qty + ' != ' + e.qty);
    if (e.mat != null && !near(r.mat, e.mat, 1)) parts.push('mat ' + r.mat + ' != ' + e.mat);
    if (e.lab != null && !near(r.lab, e.lab, 1)) parts.push('lab ' + r.lab + ' != ' + e.lab);
    if (e.tax != null && !near(r.tax, e.tax, 1)) parts.push('tax ' + r.tax + ' != ' + e.tax);
    if (e.total != null && !near(r.total, e.total, 1))
      parts.push('total ' + r.total + ' != ' + e.total);
    if (e.sub != null && !near(r.sub, e.sub, 1)) parts.push('sub ' + r.sub + ' != ' + e.sub);
    if (e.onCost != null && !near(r.onCost, e.onCost, 1))
      parts.push('onCost ' + r.onCost + ' != ' + e.onCost);
    if (e.allInCost != null && !near(r.allInCost, e.allInCost, 1))
      parts.push('allInCost ' + r.allInCost + ' != ' + e.allInCost);
    if (e.days != null && !near(r.days, e.days, 0.001))
      parts.push('days ' + r.days + ' != ' + e.days);
    if (e.allIn != null && !!r.allIn !== !!e.allIn)
      parts.push('allIn ' + r.allIn + ' != ' + e.allIn);
    if (e.dayBasis != null && !!r.dayBasis !== !!e.dayBasis)
      parts.push('dayBasis ' + r.dayBasis + ' != ' + e.dayBasis);
    if (e.labourOnly != null && !!r.labourOnly !== !!e.labourOnly)
      parts.push('labourOnly ' + r.labourOnly + ' != ' + e.labourOnly);
    if (e.bookFilled != null && !!r.bookFilled !== !!e.bookFilled)
      parts.push('bookFilled ' + r.bookFilled + ' != ' + e.bookFilled);
    // D3: an all-in line must NEVER show a split material/labour money.
    if (e.allIn && r.allIn && (r.mat !== 0 || r.lab !== 0))
      parts.push('all-in line shows a split: mat ' + r.mat + ' / lab ' + r.lab);
    if (r.slips && r.slips.length) {
      parts.push('unit-slip false positive: ' + r.slips.map(s => s.msg).join(' | '));
      slipFlags += r.slips.length;
    }
    check(
      '[' +
        c.id +
        '] hand-calculated result holds' +
        (parts.length ? '' : ' (qty/mat/lab/total, zero slip flags)'),
      parts.length === 0,
      parts.join('; ') || c.note
    );
  }
  check(
    'zero unit-slip flags across every golden case (SLIP2, zero false positives)',
    slipFlags === 0,
    slipFlags
  );
  check('zero console/page errors across all golden cases', consoleErrors === 0, consoleErrors);
  await ctx.close();
  await browser.close();
  if (global.__srv) {
    try {
      global.__srv.kill();
    } catch (e) {}
  }
  log(
    '==== GOLDEN CASES: ' +
      passed +
      ' passed / ' +
      failed +
      ' failed across ' +
      cases.length +
      ' cases ===='
  );
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
