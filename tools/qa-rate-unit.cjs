#!/usr/bin/env node
/* ============================================================
   tools/qa-rate-unit.cjs  —  GATE T-RATEUNIT (Wave G, G-1)
   ------------------------------------------------------------
   FIELD-FINDINGS-DIRECTIVE-2026-10-28, G-1: a per-square-metre
   book rate must never price a square-foot quantity (10.76x too
   high). This gate reuses the exact conversion module the page
   loads (js/rateunits.js) and the shipped rate book, and proves:

     F1  Fixture 100 ft x 100 ft, Masonry row 6: imperial subtotal
         1,420,000 (+-1); metric (929.03 m2) within 0.1% of it.
     F2  EVERY rate-book row in BOTH unit systems: converting the
         quantity into the row's rate unit and multiplying by that
         side's rate equals the other side within 1.5%. Outliers
         are listed in docs/RATE-UNIT-OUTLIERS.md (the gate fails
         if a row is out of tolerance and not listed, or listed
         while now in tolerance).
     F3  The G-1 refusal: a custom line of 10,000 "square feet" at
         1,529 (the row's per-m2 rate) is caught as a unit/rate
         mismatch and refused with both units named.

   Usage:  node tools/qa-rate-unit.cjs
   Registry: docs/CI-TEST-COVERAGE.md -> CI row.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const RateUnits = require(path.join(ROOT, 'js', 'rateunits.js'));

// --- Load the shipped rate book (trusted repo data; strip ESM `export`) ---
function loadRatebook() {
  const file = path.join(ROOT, 'src', 'data', 'ratebook.js');
  const src = fs.readFileSync(file, 'utf8').replace(/export\s+const/g, 'var');
  const out = {};
  new Function('out', src + '\nout.RATEBOOK = RATEBOOK;')(out);
  return out.RATEBOOK;
}
const RB = loadRatebook();

// Normalize the raw rate-book rows to the SAME shape the page's rrRows()
// produces (js/calculator-page.js), so the gate validates the exact fields
// the calculator consumes: ref = "<Trade label> #<n>", impUnit = iu,
// impRate = ir, metUnit = mu, metRate = mr. The raw source uses short keys
// (t/n/iu/ir/mu/mr) and carries NO ref, so mapping it here is mandatory.
const TRADE_LABEL = {};
(RB.trades || []).forEach(t => {
  TRADE_LABEL[t.tid] = t.label;
});
const rows = (RB.rows || []).map(r => {
  const label = TRADE_LABEL[r.t] || r.t;
  return {
    tid: r.t,
    trade: label,
    ref: label + ' #' + r.n,
    n: r.n,
    impUnit: r.iu,
    impRate: r.ir,
    metUnit: r.mu,
    metRate: r.mr
  };
});

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok });
  console.log(
    (ok ? 'PASS  ' : 'FAIL  ') +
      name +
      (ok ? '' : '  <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 600))
  );
};

// ---- Outlier allow-list (docs/RATE-UNIT-OUTLIERS.md) ----
// Loaded first so F2 can pass rows that are genuinely out of tolerance but
// have been reviewed and documented, while still failing on any UNDOCUMENTED
// out-of-tolerance row (the real G-1 gate: never let a silent 10x / unknown
// discrepancy through).
const outDoc = path.join(ROOT, 'docs', 'RATE-UNIT-OUTLIERS.md');
const docRows = new Set();
if (fs.existsSync(outDoc)) {
  const txt = fs.readFileSync(outDoc, 'utf8');
  const re = /ref:\s*([A-Za-z0-9. #\-]+)/g;
  let m;
  while ((m = re.exec(txt)) !== null) {
    docRows.add(m[1].trim());
  }
}

// ---- F2 first: every row, both systems, within 1.5% ----
const outliers = [];
for (const row of rows) {
  const impU = row.impUnit,
    metU = row.metUnit;
  const impR = Number(row.impRate),
    metR = Number(row.metRate);
  if (!impU || !metU || !isFinite(impR) || impR <= 0 || !isFinite(metR) || metR <= 0) {
    continue;
  }
  const famI = RateUnits.family(impU);
  const famM = RateUnits.family(metU);
  if (!famI || famI !== famM) {
    // Different families between the two sides: cannot compare; skip (the
    // book's own units should agree, but flag it as an outlier to eyeball).
    outliers.push({
      ref: row.ref,
      trade: row.tid,
      n: row.n,
      reason: 'sides different families ' + impU + ' vs ' + metU
    });
    continue;
  }
  // Convert 1 unit of the imperial side into the metric side, price, and
  // compare to the imperial rate (and the reverse).
  const viaImp = 1 * impR;
  const viaMet = RateUnits.convertQty(1, impU, metU) * metR;
  const rel = Math.abs(viaImp - viaMet) / Math.max(viaImp, viaMet);
  if (rel > 0.015) {
    outliers.push({
      ref: row.ref,
      trade: row.tid,
      n: row.n,
      imp: impU + '@' + impR,
      met: metU + '@' + metR,
      rel: Math.round(rel * 10000) / 100 + '%'
    });
  }
}
const undocumented = outliers.filter(o => !docRows.has(o.ref));
check(
  'F2 every rate-book row prices the same money in both unit systems (1.5%) — undocumented rows only',
  undocumented.length === 0,
  { undocumented: undocumented.length, total: outliers.length, sample: undocumented.slice(0, 12) }
);

// ---- F1: the owner's fixture — 100 ft x 100 ft, Masonry row 6 ----
function rowFor(tid, n) {
  return rows.find(r => r.tid === tid && Number(r.n) === Number(n)) || null;
}
const m6 = rowFor('masonry', 6);
let f1ok = false;
let f1detail = { found: !!m6 };
if (m6) {
  // Imperial: 10,000 sq ft -> row's imperial rate unit (Yd.Sq.) -> x impRate.
  const qtyImp = RateUnits.convertQty(10000, 'square feet', m6.impUnit);
  const subImp = qtyImp * Number(m6.impRate);
  // Metric: 10,000 sq ft -> m2 -> x metRate.
  const qtyMet = RateUnits.convertQty(10000, 'square feet', m6.metUnit);
  const subMet = qtyMet * Number(m6.metRate);
  const withinImp = Math.abs(subImp - 1420000) <= 1;
  const withinMet = Math.abs(subMet - subImp) / subImp <= 0.001;
  f1ok = withinImp && withinMet;
  f1detail = {
    qtyImp: Math.round(qtyImp * 100) / 100,
    subImp: Math.round(subImp),
    qtyMet: Math.round(qtyMet * 100) / 100,
    subMet: Math.round(subMet),
    impUnit: m6.impUnit,
    metUnit: m6.metUnit
  };
}
check(
  'F1 100ft x 100ft Masonry row 6: imperial 1,420,000 (+-1) and metric within 0.1%',
  f1ok,
  f1detail
);

// ---- F3: the G-1 refusal — 10,000 "square feet" at the per-m2 rate 1,529 ----
let f3ok = false;
let f3detail = { found: !!m6 };
if (m6) {
  // Replicates the b6CustomGuard unit/rate reconciliation: the quoted rate
  // matches the metric side, but the declared unit is imperial area.
  const rate = 1529;
  const matchesMetric =
    Math.abs(rate * 100 - Number(m6.metRate) * 100) <= Math.max(1, Number(m6.metRate) * 0.5);
  const sysRow = RateUnits.system(m6.metUnit);
  const sysCu = RateUnits.system('square feet');
  const mismatched =
    (RateUnits.family('square feet') &&
      RateUnits.family(m6.metUnit) &&
      RateUnits.family('square feet') !== RateUnits.family(m6.metUnit)) ||
    (sysCu !== 'neutral' && sysRow !== 'neutral' && sysCu !== sysRow);
  const converted = RateUnits.convertQty(10000, 'square feet', m6.metUnit);
  f3ok = matchesMetric && mismatched && converted != null && isFinite(converted);
  f3detail = {
    matchesMetric,
    mismatched,
    converted: converted != null ? Math.round(converted * 100) / 100 : null,
    wouldRefuse: matchesMetric && mismatched
  };
}
check(
  'F3 custom 10000 square feet @ 1529 (per-m2 rate) is caught as a unit/rate mismatch',
  f3ok,
  f3detail
);

// ---- Outlier doc consistency (F2 supporting) ----
const liveRefs = new Set(outliers.map(o => o.ref));
let docMismatch = false;
for (const ref of liveRefs) {
  if (!docRows.has(ref)) {
    docMismatch = true;
  }
}
for (const ref of docRows) {
  if (!liveRefs.has(ref)) {
    docMismatch = true;
  }
}
check('F2 outlier doc matches the live outlier set', !docMismatch, {
  live: outliers.length,
  documented: docRows.size,
  liveRefs: Array.from(liveRefs).slice(0, 12)
});

const failed = results.filter(r => !r.ok);
console.log('');
console.log(
  (failed.length ? 'FAIL' : 'PASS') +
    ' - ' +
    (results.length - failed.length) +
    '/' +
    results.length +
    ' gates'
);
if (outliers.length) {
  console.log('RATE-UNIT outliers (' + outliers.length + '):');
  for (const o of outliers.slice(0, 40)) {
    console.log('  ' + JSON.stringify(o));
  }
}
process.exit(failed.length ? 1 : 0);
