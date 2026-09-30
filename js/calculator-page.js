/* ============================================================
   My MaNaGeR - Build Cost Calculator page (js/calculator-page.js)
   ------------------------------------------------------------
   Client-facing estimator, standalone (owner 2026-09-28): pick a
   work item, enter dimensions, choose currency + country, get
   quantities / labor / materials / tax / total. All math is
   planning-grade public formulas; all data stays on the device
   (history in localStorage). Delegated clicks via data-action,
   same convention as the app. No network. No emoji.

   F4 enhancements (owner 2026-09-28): (1) unit toggle - metric or
   imperial dimension entry, converted to the metric math on input,
   choice remembered per device; (2) Print (ink-friendly @media print
   sheet) and CSV export of the live breakdown; (3) named estimates -
   save/recall/delete named snapshots (localStorage mmgr_calc_estimates)
   beside the automatic 20-row history.

   F4b (owner 2026-09-28 rate-freedom directive): (4) editable material
   + labor rates, prefilled from the model so any company can price at
   its own numbers (low-bid or sustain) with Reset-to-model to come
   back; (5) per-piece pricing for area trades - price per piece +
   piece size (W x L cm) becomes the effective material rate, m2 math
   underneath stays untouched; (6) EXACT RECALL - history and named
   estimates store the full settings state (work, dimensions, units,
   currency, country, quality, tax override, rates, piece pricing) and
   restore all of it, so a recalled row reproduces its sum exactly.
   Legacy history rows without stored settings restore what they carry
   (work/dims/units fall back from dimension magnitudes).
   ============================================================ */
(function() {
'use strict';

// ---- Quantity + cost models (planning-grade; sources in the fine print) --
// q(d1,d2,d3) -> { qty, unit, qtyLabel }  |  rates are { mat, lab } per unit.
// Formulas: slab/footing volume with 5% waste; rebar 85 kg per m3 concrete;
// excavation 1.25 bulking; paint coverage ~10 m2/L per coat (2 coats);
// block/brick 12.5 & 60 units per m2 with mortar allowance.
const WORK = {
  siteprep:   { group: 'Groundworks', d1: 'Length (m)', d2: 'Width (m)', d3: null,
    q: (a, b) => ({ qty: a * b, unit: 'm2', qtyLabel: 'Area to clear' }),
    rate: { mat: 4, lab: 9 }, matDesc: 'Clearing, strip, disposal allowance' },
  excav:      { group: 'Groundworks', d1: 'Length (m)', d2: 'Width (m)', d3: 'Depth (m)',
    q: (a, b, c) => ({ qty: a * b * c * 1.25, unit: 'm3', qtyLabel: 'Excavated volume (incl. 1.25 bulking)' }),
    rate: { mat: 2, lab: 14 }, matDesc: 'Cart-away / disposal' },
  slab:       { group: 'Groundworks', d1: 'Length (m)', d2: 'Width (m)', d3: 'Thickness (mm)', waste: { def: 5, lbl: 'Concrete waste' }, piece: { priceLabel: 'Price per bag of mix', sizeLabel: 'Bag yield (litres)', single: true, div: 'volume', qtyUnit: 'm3', ph: 'e.g. 9200 per bag', phSize: 'e.g. 20' },
    q: (a, b, c) => ({ qty: a * b * (c / 1000), unit: 'm3', qtyLabel: 'Concrete' }),
    rate: { mat: 150, lab: 85 }, matDesc: 'C20/25 ready-mix, mesh, vapor barrier' },
  footings:   { group: 'Groundworks', d1: 'Total run (m)', d2: 'Width (mm)', d3: 'Depth (mm)', waste: { def: 5, lbl: 'Concrete waste' }, piece: { priceLabel: 'Price per bag of mix', sizeLabel: 'Bag yield (litres)', single: true, div: 'volume', qtyUnit: 'm3', ph: 'e.g. 9200 per bag', phSize: 'e.g. 20' },
    q: (a, b, c) => ({ qty: a * (b / 1000) * (c / 1000), unit: 'm3', qtyLabel: 'Concrete' }),
    rate: { mat: 155, lab: 90 }, matDesc: 'C20/25, rebar cage allowance' },
  blockwall:  { group: 'Structure', d1: 'Length (m)', d2: 'Height (m)', d3: null, piece: { priceLabel: 'Price per block', sizeLabel: 'Block size - length x height (cm)', unit: 'cm', div: 'area', ph: 'e.g. 800 per block', phSize: 'e.g. 40 x 20' },
    q: (a, b) => ({ qty: a * b, unit: 'm2', qtyLabel: 'Wall area' }),
    rate: { mat: 22, lab: 28 }, matDesc: 'Blocks (12.5/m2), mortar, ties' },
  brickwall:  { group: 'Structure', d1: 'Length (m)', d2: 'Height (m)', d3: null, piece: { priceLabel: 'Price per brick', sizeLabel: 'Brick size - length x height (cm)', unit: 'cm', div: 'area', ph: 'e.g. 140 per brick', phSize: 'e.g. 20 x 10' },
    q: (a, b) => ({ qty: a * b, unit: 'm2', qtyLabel: 'Wall area' }),
    rate: { mat: 34, lab: 42 }, matDesc: 'Bricks (60/m2), mortar, wall ties' },
  framing:    { group: 'Structure', d1: 'Length (m)', d2: 'Height (m)', d3: null,
    q: (a, b) => ({ qty: a * b, unit: 'm2', qtyLabel: 'Framed area' }),
    rate: { mat: 19, lab: 24 }, matDesc: 'Studs, plates, sheathing' },
  rebar:      { group: 'Structure', d1: 'Concrete volume (m3)', d2: null, d3: null,
    q: (a) => ({ qty: a * 85 / 1000, unit: 't', qtyLabel: 'Steel (85 kg per m3)' }),
    rate: { mat: 950, lab: 380 }, matDesc: 'Bars, ties, chairs, cutting waste' },
  roof:       { group: 'Envelope', d1: 'Length (m)', d2: 'Slope width (m)', d3: null, waste: { def: 10, lbl: 'Laps / pitch allowance' }, piece: { priceLabel: 'Price per sheet', sizeLabel: 'Sheet size - width x length (m)', unit: 'm', div: 'area', ph: 'e.g. 6120 per sheet', phSize: 'e.g. 0.85 x 3.6', plural: 'sheets' },
    q: (a, b) => ({ qty: a * b, unit: 'm2', qtyLabel: 'Sheet area' }),
    rate: { mat: 26, lab: 18 }, matDesc: 'Sheets, fixings, flashings' },
  render:     { group: 'Envelope', d1: 'Length (m)', d2: 'Height (m)', d3: null,
    q: (a, b) => ({ qty: a * b, unit: 'm2', qtyLabel: 'Rendered area' }),
    rate: { mat: 11, lab: 19 }, matDesc: 'Two-coat render, bead, primer' },
  paint:      { group: 'Envelope', d1: 'Length (m)', d2: 'Height (m)', d3: null, piece: { priceLabel: 'Price per container', sizeLabel: 'Container yield (litres)', single: true, div: 'volume', qtyUnit: 'L', ph: 'e.g. 9000 per gallon-can', phSize: 'e.g. 3.785' },
    q: (a, b) => ({ qty: a * b * 2 / 10, unit: 'L', qtyLabel: 'Paint (2 coats at 10 m2/L)' }),
    rate: { mat: 14, lab: 11 }, matDesc: 'Emulsion, primer, rollers' },
  drywall:    { group: 'Envelope', d1: 'Length (m)', d2: 'Height (m)', d3: null,
    q: (a, b) => ({ qty: a * b, unit: 'm2', qtyLabel: 'Partition area' }),
    rate: { mat: 12, lab: 17 }, matDesc: 'Boards, studs, tape, screws' },
  tile:       { group: 'Finishes', d1: 'Length (m)', d2: 'Width (m)', d3: null, waste: { def: 10, lbl: 'Cuts / waste' }, piece: { priceLabel: 'Price per tile', sizeLabel: 'Tile size - width x length (cm)', unit: 'cm', div: 'area', ph: 'e.g. 950 per tile', phSize: 'e.g. 30 x 60', plural: 'tiles' },
    q: (a, b) => ({ qty: a * b, unit: 'm2', qtyLabel: 'Tiles' }),
    rate: { mat: 24, lab: 32 }, matDesc: 'Tiles, adhesive, grout, trim' },
  'concrete-drive': { group: 'Finishes', d1: 'Length (m)', d2: 'Width (m)', d3: 'Thickness (mm)', waste: { def: 5, lbl: 'Concrete waste' }, piece: { priceLabel: 'Price per bag of mix', sizeLabel: 'Bag yield (litres)', single: true, div: 'volume', qtyUnit: 'm3', ph: 'e.g. 9200 per bag', phSize: 'e.g. 20' },
    q: (a, b, c) => ({ qty: a * b * (c / 1000), unit: 'm3', qtyLabel: 'Concrete' }),
    rate: { mat: 145, lab: 75 }, matDesc: 'C25/30 air-entrained, mesh, cure' },
  fencing:    { group: 'Finishes', d1: 'Total run (m)', d2: 'Height (m)', d3: null, piece: { priceLabel: 'Price per panel', sizeLabel: 'Panel size - width x height (m)', unit: 'm', div: 'width', ph: 'e.g. 9500 per panel', phSize: 'e.g. 2.5 x 1.8' },
    q: (a, b) => ({ qty: a, unit: 'm', qtyLabel: 'Fence run' }),
    rate: { mat: (a, b) => 18 + Math.max(0, ((b || 1.8) - 1.2)) * 9, lab: 15 }, matDesc: 'Chain-link, posts, concrete backfill' },
  // ---- Research-backed additions (owner 2026-09-30, spec section 3.4) ----
  // Pipe and conduit work is priced PER LINEAR METER (running meter), never
  // per m2 (owner: 'you don't run pipe by square meters'); fixtures/panels
  // are per-unit counts; shingle roofing is quoted per roofing square
  // (100 sq ft) with a laps/cuts allowance. Rates are planning-grade 2026
  // web benchmarks (Angi PEX installed LF; per-point electrical; buildvision
  // waste table; constructly roofing-square pricing) - editable as always.
  'pipe-supply': { group: 'Plumbing', d1: 'Total run (m)', d2: null, d3: null,
    q: (a) => ({ qty: a, unit: 'm', qtyLabel: 'Supply pipe run (linear)' }),
    rate: { mat: 3, lab: 8 }, matDesc: 'PEX/PVC supply incl. fittings allowance' },
  'pipe-drain':  { group: 'Plumbing', d1: 'Total run (m)', d2: null, d3: null,
    q: (a) => ({ qty: a, unit: 'm', qtyLabel: 'DWV pipe run (linear)' }),
    rate: { mat: 3, lab: 9 }, matDesc: 'PVC drain-waste-vent, slope + fittings allowance' },
  fixture:     { group: 'Plumbing', d1: 'Fixtures to install (count)', d2: null, d3: null,
    q: (a) => ({ qty: a, unit: 'each', qtyLabel: 'Fixtures' }),
    rate: { mat: 130, lab: 150 }, matDesc: 'Toilet/sink/shower set + connect' },
  'bath-rough':{ group: 'Plumbing', d1: 'Bathrooms (count)', d2: null, d3: null,
    q: (a) => ({ qty: a, unit: 'each', qtyLabel: 'Bathroom rough-ins' }),
    rate: { mat: 500, lab: 750 }, matDesc: 'Supply + DWV to one full bathroom' },
  'wire-point':{ group: 'Electrical', d1: 'Wiring points (count)', d2: null, d3: null,
    q: (a) => ({ qty: a, unit: 'point', qtyLabel: 'Wiring points' }),
    rate: { mat: 25, lab: 60 }, matDesc: 'Socket/switch/light point incl. device' },
  conduit:     { group: 'Electrical', d1: 'Total run (m)', d2: null, d3: null,
    q: (a) => ({ qty: a, unit: 'm', qtyLabel: 'Conduit / cable run (linear)' }),
    rate: { mat: 2, lab: 6 }, matDesc: 'Conduit + single-phase cable' },
  panel:       { group: 'Electrical', d1: 'Panels (count)', d2: null, d3: null,
    q: (a) => ({ qty: a, unit: 'each', qtyLabel: 'Panels' }),
    rate: { mat: 450, lab: 650 }, matDesc: 'Consumer board, breakers, labeling' },
  skirt:       { group: 'Finishes', d1: 'Total run (m)', d2: null, d3: null,
    q: (a) => ({ qty: a, unit: 'm', qtyLabel: 'Skirting run (linear)' }),
    rate: { mat: 3, lab: 5 }, matDesc: 'Trim + fixings, miters' },
  'shingle-roof': { group: 'Envelope', d1: 'Length (m)', d2: 'Slope width (m)', d3: null,
    waste: { def: 10, lbl: 'Laps / cuts allowance' },
    q: (a, b) => ({ qty: a * b / 9.2903, unit: 'square', qtyLabel: 'Roofing squares (100 sq ft each)' }),
    rate: { mat: 250, lab: 300 }, matDesc: 'Asphalt shingles, underlayment, starter' }
};

// Country standard tax rates (PwC VAT/GST quick table, 2026). US sales tax
// varies by state - default 0 with the custom override for the client's rate.
const TAX = { US: 0, JM: 15, GB: 20, AU: 10, CA: 5, JP: 10, DE: 19 };
const CURRENCY = { USD: '$', JMD: 'J$', GBP: '\u00A3', EUR: '\u20AC', CAD: 'C$', AUD: 'A$', JPY: '\u00A5' };
const QUALITY = { economy: 0.85, standard: 1, premium: 1.35 };

// ---- Units (F4-1): metric is the math; imperial converts on entry -------
// Dimensions typed in ft/in are converted before the formulas run, so the
// rate models (per m2 / m3 / m) stay untouched. Quantities report their
// native metric unit with an approximate imperial reading beside them.
const FT = 0.3048;          // meters per foot
const IN = 25.4;            // millimeters per inch
let _units = 'metric';

function dimLabel(w, which) {
  let lbl = w[which] || '';
  if (_units === 'imperial') {
    lbl = lbl.replace('(m2)', '(sq ft)').replace('(m3)', '(cu yd)')
             .replace('(m)', '(ft)').replace('(mm)', '(in)');
  }
  return lbl;
}

// Approximate secondary reading for a quantity (display only). Metric mode
// keeps the historical behavior: an imperial aside on metric quantities,
// nothing on 't'. (Owner review 2026-09-29: direction-aware, see qtyShown.)
function qtyAlt(qty, unit) {
  return qtyShown(qty, unit).alt;
}

// A2 (owner review 2026-09-29): the HERO quantity follows the selected unit
// system - imperial users read sq ft / cu yd first with the metric reading
// as the secondary line, metric users read m2 / m3 first as today. One
// conversion table drives both directions. 't' (tonnes) has no imperial
// mapping - it stays primary in both modes, no secondary line.
const UNIT_CONV = {
  m2: { imp: ['sq ft', 10.7639, 0], met: ['m2', 1, 2] },
  m3: { imp: ['cu yd', 1.30795, 1], met: ['m3', 1, 2] },
  m:  { imp: ['ft', 3.28084, 1],    met: ['m', 1, 2] },
  L:  { imp: ['US gal', 0.264172, 1], met: ['L', 1, 2] }
};
function qtyShown(qty, unit) {
  const c = UNIT_CONV[unit];
  if (!c) {
    // 'square' (roofing square, 100 sq ft) is imperial-native: it stays
    // primary in both unit systems with an m2 aside for metric readers.
    if (unit === 'square') {
      const m2 = Math.round(qty * 9.2903 * 100) / 100;
      return { main: (Math.round(qty * 100) / 100).toLocaleString() + ' square',
               alt: ' (about ' + m2.toLocaleString() + ' m2)' };
    }
    // Counts (fixtures, panels, wiring points) are whole numbers.
    if (unit === 'each' || unit === 'point') return { main: Math.round(qty).toLocaleString() + ' ' + unit, alt: '' };
    return { main: (Math.round(qty * 100) / 100) + ' ' + unit, alt: '' };
  }
  const pick = _units === 'imperial' ? c.imp : c.met;
  const other = _units === 'imperial' ? c.met : c.imp;
  const round = (v, dp) => Math.round(v * Math.pow(10, dp)) / Math.pow(10, dp);
  const val = round(qty * pick[1], pick[2]);
  const oval = round(qty * other[1], other[2]);
  return { main: val.toLocaleString() + ' ' + pick[0],
           alt: ' (about ' + oval.toLocaleString() + ' ' + other[0] + ')' };
}

// Tiny local escaper - user-typed estimate names reach innerHTML.
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

const $ = (id) => document.getElementById(id);
const num = (el) => { const v = parseFloat(el && el.value); return isFinite(v) && v > 0 ? v : 0; };

function fmtMoney(v) {
  const cur = CURRENCY[($('calc-currency') || {}).value] || '$';
  const rounded = Math.round(v);
  return cur + rounded.toLocaleString();
}

// The fencing material rate is height-dependent; normalize to a number.
function matRate(w, d1, d2) { return typeof w.rate.mat === 'function' ? w.rate.mat(d1, d2) : w.rate.mat; }

// ---- Model rates (for the rate fields + Reset to model) -----------------
function modelMatRate(key, d1m, d2m) {
  const w = WORK[key];
  if (!w) return '';
  const r = w.rate.mat;
  return typeof r === 'function' ? r(d1m, d2m) : r;
}

// ---- Live settings state (F4b: one shape, saved + restored verbatim) -----
function readState() {
  return {
    work: ($('calc-work') || {}).value || '',
    d1: ($('calc-d1') || {}).value || '',
    d2: ($('calc-d2') || {}).value || '',
    d3: ($('calc-d3') || {}).value || '',
    currency: ($('calc-currency') || {}).value || 'USD',
    country: ($('calc-country') || {}).value || 'US',
    quality: ($('calc-quality') || {}).value || 'standard',
    taxOverride: ($('calc-tax-override') || {}).value || '',
    wastePct: ($('calc-waste') || {}).value || '',
    rateMat: ($('calc-rate-mat') || {}).value || '',
    rateLab: ($('calc-rate-lab') || {}).value || '',
    rateEq: ($('calc-rate-eq') || {}).value || '',
    ohPct: ($('calc-oh') || {}).value || '',
    docType: docType(),
    docTitle: docTitleRaw(),
    piecePrice: ($('calc-piece-price') || {}).value || '',
    pieceSize: ($('calc-piece-size') || {}).value || '',
    units: _units
  };
}

// Restore a settings object written by readState(). Every field is
// restored so a recalled entry reproduces its sum exactly (owner
// directive: recall must re-create the settings that achieved the sum).
function applyState(st) {
  if (!st) return;
  if (st.units) setUnits(st.units, true);
  if (st.work) $('calc-work').value = st.work;
  syncLabels();
  $('calc-d1').value = st.d1 || '';
  if ($('calc-d2')) $('calc-d2').value = st.d2 || '';
  if ($('calc-d3')) $('calc-d3').value = st.d3 || '';
  if ($('calc-currency')) $('calc-currency').value = st.currency || 'USD';
  if ($('calc-country')) $('calc-country').value = st.country || 'US';
  if ($('calc-quality')) $('calc-quality').value = st.quality || 'standard';
  if ($('calc-tax-override')) $('calc-tax-override').value = st.taxOverride || '';
  if ($('calc-waste')) $('calc-waste').value = st.wastePct || '';
  if ($('calc-rate-mat')) $('calc-rate-mat').value = st.rateMat || '';
  if ($('calc-rate-lab')) $('calc-rate-lab').value = st.rateLab || '';
  if ($('calc-rate-eq')) $('calc-rate-eq').value = st.rateEq || '';
  if ($('calc-oh')) $('calc-oh').value = st.ohPct || '';
  if ($('calc-doc-type')) $('calc-doc-type').value = st.docType || 'Estimate';
  if ($('calc-doc-title')) $('calc-doc-title').value = st.docTitle || '';
  if ($('calc-piece-price')) $('calc-piece-price').value = st.piecePrice || '';
  if ($('calc-piece-size')) $('calc-piece-size').value = st.pieceSize || '';
  refreshRateFields();
}

// B2 (owner review 2026-09-29: 'exact count of tile boxes/units required').
// Works with or without a piece PRICE: a size alone shows the order count
// while material cost stays on the rate; a price also switches the per-piece
// math on. Pure - no DOM, shared by the live estimate and the CSV export.
function pieceCount(qty, unit, spec, sizeStr) {
  if (!spec || !sizeStr) return null;
  // Ceil with float-dust guard: 39.6/0.18 must be 220 pieces, not 221
  // (the raw IEEE quotient lands a hair above the integer).
  const ceilClean = (v) => Math.ceil(Math.round(v * 1e6) / 1e6);
  if (spec.div === 'volume') {
    const y = parseFloat(sizeStr);
    if (!isFinite(y) || y <= 0) return null;
    const litres = unit === 'm3' ? qty * 1000 : qty; // concrete m3 -> litres; paint is already L
    return { n: ceilClean(litres / y), lbl: unit === 'm3' ? 'bags/units' : 'containers', sizeTxt: y + ' L' };
  }
  const m = sizeStr.match(/^([\d.]+)\s*(?:x|by|\*)\s*([\d.]+)$/i);
  if (!m) return null;
  const conv = _units === 'imperial' ? (spec.unit === 'm' ? FT : FT * 100) : 1;
  const a = parseFloat(m[1]) * conv, b = parseFloat(m[2]) * conv;
  if (!(a > 0 && b > 0)) return null;
  if (spec.div === 'width') return { n: ceilClean(qty / a), lbl: spec.plural || 'panels', sizeTxt: m[1] + ' x ' + m[2] + ' ' + spec.unit };
  const areaM2 = spec.unit === 'm' ? a * b : (a / 100) * (b / 100);
  return { n: ceilClean(qty / areaM2), lbl: spec.plural || 'pieces', sizeTxt: m[1] + ' x ' + m[2] + ' ' + spec.unit };
}

// D2 (owner review 2026-09-29): PURE estimate engine. Takes a readState()-
// shaped settings object, touches NO DOM, returns the full breakdown. The
// live form (compute), recall fidelity, and the comparison table all run
// through this one function - one math path, zero drift.
function computeFor(st) {
  const key = st.work;
  const w = WORK[key];
  if (!w) return null;
  const raw1 = num({ value: st.d1 });
  const raw2 = w.d2 ? num({ value: st.d2 }) : null;
  const raw3 = w.d3 ? num({ value: st.d3 }) : null;
  if (!raw1 || (w.d2 && !raw2) || (w.d3 && !raw3)) return { error: 'Enter the dimensions the form asks for (all three when thickness or depth applies).' };
  // Imperial entry converts to the metric the formulas speak (ft to m,
  // in to mm); metric passes through untouched.
  const imp = st.units === 'imperial';
  const d1 = imp ? raw1 * FT : raw1;
  const d2 = w.d2 ? (imp ? raw2 * FT : raw2) : null;
  const d3 = w.d3 ? (imp ? raw3 * IN : raw3) : null;
  const qr = w.q(d1, d2, d3);
  // B1 (owner review 2026-09-29): waste/cuts is an editable percentage per
  // trade (tile 10, roof laps 10, concrete 5 defaults = the previously
  // baked-in factors). Empty/invalid falls back to the trade default.
  let wastePct = 0;
  if (w.waste) {
    const wr = parseFloat(st.wastePct);
    wastePct = isFinite(wr) && wr >= 0 && wr <= 50 ? wr : w.waste.def;
  }
  const qty = qr.qty * (1 + wastePct / 100);
  const modelMr = matRate(w, d1, d2);
  // F4b rate freedom: an explicitly typed rate overrides the model. The
  // wrapper passes dataset.model for the live form; a recalled/comparison
  // state has no dataset, so any numeric value it carries IS its rate.
  const matRaw = parseFloat(st.rateMat);
  const labRaw = parseFloat(st.rateLab);
  const matModel = st._matModel != null ? String(st._matModel) : null;
  const labModel = st._labModel != null ? String(st._labModel) : null;
  const matOverride = isFinite(matRaw) && matRaw >= 0 && (matModel === null || String(matRaw) !== matModel);
  const labOverride = isFinite(labRaw) && labRaw >= 0 && (labModel === null || String(labRaw) !== labModel);
  const mr = matOverride ? matRaw : modelMr;
  const lr = labOverride ? labRaw : w.rate.lab;
  // B3: optional third rate (equipment / plant hire) on the same per-unit
  // basis; empty or 0 = inactive. Overhead & margin % applies to the
  // equipment-inclusive subtotal.
  const eqRaw = parseFloat(st.rateEq);
  const eqRate = isFinite(eqRaw) && eqRaw > 0 ? eqRaw : 0;
  const ohRaw = parseFloat(st.ohPct);
  const ohPct = isFinite(ohRaw) && ohRaw > 0 && ohRaw <= 60 ? ohRaw : 0;
  // F4b per-piece pricing: price-per-piece + piece size becomes the
  // effective material rate. Three divisors: AREA (tile, block, brick,
  // roof sheets) -> price / piece area = rate per m2; WIDTH (fencing
  // panels) -> price / panel width = rate per run-meter; VOLUME (concrete
  // bags, paint containers) -> price / yield in litres = rate per litre,
  // which multiplies the litre/m3 quantity directly. Single-value specs
  // (bag yield) take one number, not a W x L pair; imperial entry converts
  // in->cm / ft->m for dimensioned specs (yield specs are unit-free).
  let piece = null;
  const pieceRaw = parseFloat(st.piecePrice);
  // Size-only mode (B2): a piece SIZE without a price still shows the order
  // count; the per-unit rate override stays off until a price is typed too.
  if (w.piece && (!isFinite(pieceRaw) || pieceRaw <= 0) &&
      (st.pieceSize || '').trim() !== '') {
    const countOnly = pieceCount(qty, qr.unit, w.piece, (st.pieceSize || '').trim());
    if (countOnly) piece = { countOnly: true, count: countOnly };
  }
  if (w.piece && isFinite(pieceRaw) && pieceRaw > 0) {
    const spec = w.piece;
    const sizeStr = (st.pieceSize || '').trim();
    if (spec.div === 'volume') {
      const yieldL = parseFloat(sizeStr);
      if (isFinite(yieldL) && yieldL > 0) {
        // Match the quantity's unit: m3 trades need $/m3 (price x 1000 /
        // yield), litre trades need $/L (price / yield).
        const perUnit = spec.qtyUnit === 'm3' ? pieceRaw * 1000 / yieldL : pieceRaw / yieldL;
        piece = { w: yieldL, l: null, unit: 'L', qtyUnit: spec.qtyUnit, div: 'volume', price: pieceRaw, perUnit: perUnit };
      }
    } else {
      const m = sizeStr.match(/^([\d.]+)\s*(?:x|by|\*)\s*([\d.]+)$/i);
      if (m) {
        const conv = st.units === 'imperial' ? (spec.unit === 'm' ? FT : FT * 100) : 1;
        const a = parseFloat(m[1]) * conv, b = parseFloat(m[2]) * conv;
        if (a > 0 && b > 0) {
          if (spec.div === 'width') {
            piece = { w: a, l: b, unit: spec.unit, div: 'width', price: pieceRaw, perUnit: pieceRaw / a };
          } else {
            const areaM2 = spec.unit === 'm' ? a * b : (a / 100) * (b / 100);
            piece = { w: a, l: b, unit: spec.unit, div: 'area', price: pieceRaw, areaM2: areaM2, perUnit: pieceRaw / areaM2 };
          }
        }
      }
    }
  }
  const quality = QUALITY[st.quality] || 1;
  // Area trades: $/m2 x m2 quantity. Fencing width-div: $/run-m x m run.
  // The qty x rate dimension check holds for both.
  const effMat = piece && !piece.countOnly ? piece.perUnit : mr;
  const mat = qty * effMat * quality;
  const lab = qty * lr * quality;
  const eq = qty * eqRate * quality;
  const country = st.country || 'US';
  const overrideRaw = parseFloat(st.taxOverride);
  const override = isFinite(overrideRaw) && overrideRaw >= 0 ? overrideRaw : null;
  const taxRate = override !== null ? override : (TAX[country] || 0);
  const sub = mat + lab + eq;
  const oh = sub * ohPct / 100;
  const tax = (sub + oh) * taxRate / 100;
  const orderCount = pieceCount(qty, qr.unit, w.piece, (st.pieceSize || '').trim());
  // Note: no `name` here - workName() reads the DOM. compute() attaches the
  // live name; the comparison table uses each saved estimate's stored name.
  return { key, qty: qty, baseQty: qr.qty, unit: qr.unit, qtyLabel: qr.qtyLabel, matDesc: w.matDesc,
    orderCount: orderCount,
    wastePct: wastePct, hasWaste: !!w.waste, wasteLbl: w.waste ? w.waste.lbl : null,
    mr, lr, eqRate, eq, ohPct, oh, effMat, modelMr, piece, mat, lab, sub, taxRate, tax, total: sub + oh + tax, overrideApplied: override !== null,
    matOverridden: matOverride, labOverridden: labOverride, currency: st.currency || 'USD' };
}

// Live-form wrapper: snapshot the DOM into a settings object (passing the
// current model-prefill markers so override detection behaves exactly as
// before), run the pure engine, and attach the DOM-derived name.
function compute() {
  const st = readState();
  st._matModel = $('calc-rate-mat') ? $('calc-rate-mat').dataset.model : undefined;
  st._labModel = $('calc-rate-lab') ? $('calc-rate-lab').dataset.model : undefined;
  const r = computeFor(st);
  if (r && !r.error) r.name = workName(st.work);
  return r;
}

// ---- Named estimates (F4-3): save / recall / delete, this device only ---
const NKEY = 'mmgr_calc_estimates';
function loadEstimates() { try { return JSON.parse(localStorage.getItem(NKEY) || '[]'); } catch (e) { return []; } }
function persistEstimates(list) { try { localStorage.setItem(NKEY, JSON.stringify(list.slice(0, 30))); } catch (e) { /* storage full - saving is a nicety, never a gate */ } }

// ---- Rate sheets (owner 2026-09-28: 'low-bid', 'sustain' - companies price
// differently per job, save the whole rate set under a name and switch).
// Stores the current rate fields (material, labor, piece) under a name;
// applying a sheet fills the fields; the model prefill rule is bypassed
// because the fields are non-empty. Device-local, 20 cap.
const RKEY = 'mmgr_calc_rate_sheets';
function applySheetById(id) {
  const sh = loadSheets().find(function(x) { return x.id === id; });
  if (!sh) return;
  const r = sh.rates;
  if ($('calc-rate-mat')) $('calc-rate-mat').value = r.rateMat;
  if ($('calc-rate-lab')) $('calc-rate-lab').value = r.rateLab;
  if ($('calc-piece-price')) $('calc-piece-price').value = r.piecePrice || '';
  if ($('calc-piece-size')) $('calc-piece-size').value = r.pieceSize || '';
  if ($('calc-rate-mat')) $('calc-rate-mat').dataset.sheet = sh.name;
  render();
  const outEl = $('calc-output');
  if (outEl) outEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function loadSheets() { try { return JSON.parse(localStorage.getItem(RKEY) || '[]'); } catch (e) { return []; } }
function persistSheets(list) { try { localStorage.setItem(RKEY, JSON.stringify(list.slice(0, 20))); } catch (e) { /* nicety, never a gate */ } }

// D1 helper: transient status line under the sheets bar (also used by the
// import flow so the user always sees what happened to their file).
function sheetMsg(text) {
  const el = $('calc-sheet-msg');
  if (!el) return;
  el.textContent = text;
  el.hidden = !text;
  if (text) setTimeout(function() { el.hidden = true; }, 5000);
}

// D1: validate + merge an imported sheets payload. Returns how many were
// merged and how many entries were skipped (never throws).
function importSheets(json) {
  if (!json || !Array.isArray(json.sheets)) return null;
  const existing = loadSheets();
  let merged = 0, skipped = 0;
  json.sheets.forEach(function(item) {
    const name = item && typeof item.name === 'string' ? item.name.trim().slice(0, 40) : '';
    const r = item && item.rates ? item.rates : {};
    const mat = parseFloat(r.rateMat), lab = parseFloat(r.rateLab);
    if (!name || !isFinite(mat) || mat < 0 || !isFinite(lab) || lab < 0) { skipped++; return; }
    const sheet = { id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name, at: new Date().toISOString().slice(0, 10),
      rates: { rateMat: String(mat), rateLab: String(lab),
        rateEq: r.rateEq != null && isFinite(parseFloat(r.rateEq)) ? String(r.rateEq) : '',
        piecePrice: r.piecePrice || '', pieceSize: r.pieceSize || '' } };
    const at = existing.findIndex(function(x) { return (x.name || '').toLowerCase() === name.toLowerCase(); });
    if (at > -1) existing[at] = sheet; else existing.unshift(sheet);
    merged++;
  });
  if (merged) { persistSheets(existing); renderSheets(); }
  return { merged: merged, skipped: skipped };
}

function activeSheetName() {
  const matEl = $('calc-rate-mat'), labEl = $('calc-rate-lab');
  if (!matEl || !labEl) return null;
  if (matEl.value === '' || labEl.value === '') return null;
  if (String(parseFloat(matEl.value)) === matEl.dataset.model || String(parseFloat(labEl.value)) === labEl.dataset.model) return null;
  return matEl.dataset.sheet || null;
}

function renderSheets() {
  const wrap = $('calc-sheets');
  const sel = $('calc-sheet-select');
  if (!wrap || !sel) return;
  const list = loadSheets();
  sel.innerHTML = '<option value="">Saved rate sheets' + (list.length ? '...' : ' (none yet)') + '</option>' +
    list.map(function(sh) { return '<option value="' + esc(sh.id) + '">' + esc(sh.name) + '</option>'; }).join('');
  const act = activeSheetName();
  wrap.innerHTML = list.length
    ? list.map(function(sh) {
        return '<div class="bcp-sheet-row">' +
          '<span class="bcp-est-name">' + esc(sh.name) + '</span>' +
          '<span class="bcp-est-meta">mat ' + esc(sh.rates.rateMat) + ' / lab ' + esc(sh.rates.rateLab) +
            (sh.rates.piecePrice ? ' / piece ' + esc(sh.rates.piecePrice) : '') + '</span>' +
          '<button type="button" class="btn btn-n btn-s" data-action="calcSheetApply" data-id="' + esc(sh.id) + '">Apply</button>' +
          '<button type="button" class="btn btn-n btn-s" data-action="calcSheetDelete" data-id="' + esc(sh.id) + '">Delete</button>' +
        '</div>';
      }).join('')
    : '<div class="calc-empty">No saved rate sheets yet. Set your rates above, then Save rate sheet.</div>';
}

function renderEstimates() {
  const wrap = $('calc-estimates');
  if (!wrap) return;
  const list = loadEstimates();
  if (!list.length) { wrap.innerHTML = '<div class="calc-empty">No saved estimates yet. Price something, then Save it with a name.</div>'; return; }
  wrap.innerHTML = list.map(function(est) {
    // D2: leading checkbox opts a saved estimate into the comparison table.
    return '<div class="bcp-est-row">' +
      '<input type="checkbox" class="bcp-cmp-check" data-cmp-id="' + esc(est.id) + '" aria-label="Select ' + esc(est.name) + ' for comparison">' +
      '<span class="bcp-est-name">' + esc(est.name) + '</span>' +
      '<span class="bcp-est-meta">' + esc(est.at) + ' - ' + esc(est.total) + '</span>' +
      '<button type="button" class="btn btn-n btn-s" data-action="calcOpen" data-id="' + esc(est.id) + '">Open</button>' +
      '<button type="button" class="btn btn-n btn-s" data-action="calcDeleteEst" data-id="' + esc(est.id) + '">Delete</button>' +
    '</div>';
  }).join('');
}

// ---- D2 (owner review 2026-09-29): side-by-side comparison of saved ------
// estimates (Economy vs Standard vs Premium for the same dimensions). The
// table recomputes each saved settings state through the SAME pure engine
// as the live form, so a compared total always equals a recalled total.
function renderCompare() {
  const wrap = $('calc-compare'), card = $('calc-compare-card');
  if (!wrap || !card) return;
  const ids = Array.prototype.slice.call(document.querySelectorAll('.bcp-cmp-check:checked')).map(function(c) { return c.getAttribute('data-cmp-id'); });
  if (ids.length < 2) {
    sheetMsg('Tick at least two saved estimates to compare.');
    return;
  }
  const cols = ids.slice(0, 4).map(function(id) {
    const est = loadEstimates().find(function(x) { return x.id === id; });
    if (!est) return null;
    const r = computeFor(est.st || {});
    return r && !r.error ? { name: est.name, r: r } : null;
  }).filter(Boolean);
  if (cols.length < 2) { sheetMsg('Those estimates could not be recomputed - open one to check its settings.'); return; }
  const money = function(v, cur) { return (CURRENCY[cur] || '$') + Math.round(v).toLocaleString(); };
  const best = Math.min.apply(null, cols.map(function(c) { return c.r.total; }));
  const rows = [
    ['Work item', function(c) { return esc(c.r.key); }],
    ['Quantity', function(c) { return esc(qtyShown(c.r.qty, c.r.unit).main); }],
    ['Materials', function(c) { return money(c.r.mat, c.r.currency); }],
    ['Labor', function(c) { return money(c.r.lab, c.r.currency); }],
    ['Equipment', function(c) { return c.r.eq > 0 ? money(c.r.eq, c.r.currency) : '-'; }],
    ['Overhead', function(c) { return c.r.oh > 0 ? money(c.r.oh, c.r.currency) : '-'; }],
    ['Subtotal', function(c) { return money(c.r.sub, c.r.currency); }],
    ['Tax', function(c) { return money(c.r.tax, c.r.currency); }],
    ['Estimated total', function(c) {
      const bestCell = c.r.total === best ? ' class="bcp-cmp-best"' : '';
      return '<strong' + bestCell + '>' + money(c.r.total, c.r.currency) + '</strong>';
    }]
  ];
  wrap.innerHTML = '<div class="bcp-cmp-wrap"><table><thead><tr><th scope="row"></th>' +
    cols.map(function(c) { return '<th scope="col">' + esc(c.name) + '</th>'; }).join('') + '</tr></thead><tbody>' +
    rows.map(function(rowDef) {
      return '<tr><th scope="row">' + rowDef[0] + '</th>' +
        cols.map(function(c) { return '<td>' + rowDef[1](c) + '</td>'; }).join('') + '</tr>';
    }).join('') + '</tbody></table></div>';
  card.hidden = false;
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---- Export (F4-2): print + CSV of the live breakdown -------------------
function estimateCsv(r) {
  const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const rows = [
    ['Build Cost Calculator - My MaNaGeR'],
    ['Exported', new Date().toISOString().slice(0, 10)],
    ['Document type', docType()],
    ['Document title', docTitleRaw()],
    ['Name', ($('#calc-save-name') || {}).value || r.name],
    ['Work item', r.name],
    ['Quantity', qtyShown(r.qty, r.unit).main + qtyShown(r.qty, r.unit).alt],
    ['Waste allowance', r.hasWaste ? r.wastePct + '%' : 'none'],
    ['Order quantity', r.orderCount ? r.orderCount.n.toLocaleString() + ' ' + r.orderCount.lbl + ' at ' + r.orderCount.sizeTxt : ''],
    ['Rate basis', r.matDesc],
    ['Finish level', ($('calc-quality') || {}).value || 'standard'],
    ['Currency', r.currency],
    ['Country', ($('calc-country') || {}).value || ''],
    ['Units entered', _units],
    ['Material rate used', r.piece ? (Math.round(r.effMat * 100) / 100) + ' per m2 (from piece pricing)' : Math.round(r.mr)],
    ['Labor rate used', Math.round(r.lr)],
    ['Equipment rate used', r.eqRate > 0 ? r.eqRate : 'none'],
    ['Overhead & margin %', r.ohPct > 0 ? r.ohPct : 'none'],
    ['Piece pricing', r.piece && !r.piece.countOnly ? (r.piece.div === 'volume'
        ? r.piece.price + ' per ' + r.piece.w + ' L yield (per ' + (Math.round(r.piece.perUnit * 100) / 100) + '/' + r.piece.qtyUnit + ')'
        : r.piece.price + ' per ' + Math.round(r.piece.w) + ' x ' + Math.round(r.piece.l) + ' ' + r.piece.unit + (r.piece.div === 'width' ? ' (per ' + (Math.round(r.piece.perUnit * 100) / 100) + '/m)' : ' (per ' + (Math.round(r.piece.perUnit * 100) / 100) + '/m2)')) : 'no'],
    ['Materials', Math.round(r.mat)],
    ['Labor', Math.round(r.lab)],
    ['Subtotal', Math.round(r.sub)],
    ['Overhead', Math.round(r.oh)],
    ['Tax rate %', r.taxRate],
    ['Tax', Math.round(r.tax)],
    ['Estimated total', Math.round(r.total)],
    [],
    ['Planning-grade estimate - not a quote.']
  ];
  return '\uFEFF' + rows.map(function(row) { return row.map(q).join(','); }).join('\r\n');
}

function slug(s) { return String(s || 'estimate').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'estimate'; }

// ---- OWNER 2026-09-30: export naming (document type + title) -----------
// The type becomes the printed sheet's title; type + title + date form
// the export filename. Empty title falls back to the estimate name, then
// the work item name. Illegal filename characters are stripped.
function docType() { return ($('calc-doc-type') || {}).value || 'Estimate'; }
function docTitleRaw() { return (($('calc-doc-title') || {}).value || '').trim(); }
function docTitleBase() {
  const base = (docTitleRaw() || (($('calc-save-name') || {}).value || '').trim() || (lastResult && lastResult.name) || 'estimate')
    .replace(/[\\/:*?"<>|]/g, '').trim();
  return docType() + ' - ' + (base || 'estimate');
}
// Test hook (harness-only convenience; harmless in production).
window.__calcDocTitleBase = docTitleBase;

document.addEventListener('change', function(e) {
  if (e.target && e.target.id === 'calc-doc-type') render();
});
document.addEventListener('input', function(e) {
  if (e.target && e.target.id === 'calc-doc-title') render();
});

function downloadCsv() {
  if (!lastResult) return;
  const blob = new Blob([estimateCsv(lastResult)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = slug(docTitleBase()) + '-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function() { URL.revokeObjectURL(a.href); }, 500);
}

function workName(key) {
  const sel = $('calc-work');
  const opt = sel && sel.selectedOptions && sel.selectedOptions[0];
  return opt ? opt.textContent.trim() : key;
}

function row(label, value, cls) {
  return '<div class="calc-line' + (cls ? ' ' + cls : '') + '"><span>' + label + '</span><strong>' + value + '</strong></div>';
}

let lastResult = null;

// D3: optional business letterhead for printed/PDF estimates. Device-local
// (mmgr_calc_biz_name); the quote head is display:none on screen.
const BKEY = 'mmgr_calc_biz_name';
function bizName() {
  const el = $('calc-biz-name');
  if (el && el.value.trim()) return el.value.trim();
  try { return localStorage.getItem(BKEY) || ''; } catch (e) { return ''; }
}

function render() {
  const out = $('calc-output');
  if (!out) return;
  const r = compute();
  if (!r || r.error) {
    lastResult = null;
    if ($('calc-out-actions')) $('calc-out-actions').classList.add('is-hide');
  }
  if (!r) { out.innerHTML = '<div class="calc-empty">Pick a work item, enter dimensions, then Calculate.</div>'; return; }
  if (r.error) { out.innerHTML = '<div class="calc-empty">' + r.error + '</div>'; return; }
  lastResult = r;
  if ($('calc-out-actions')) $('calc-out-actions').classList.remove('is-hide');
  const pieceNarr = r.piece && !r.piece.countOnly
    ? (r.piece.div === 'width'
        ? (Math.round(r.piece.perUnit * 100) / 100).toLocaleString() + '/m of run'
        : r.piece.div === 'volume'
        ? (Math.round(r.piece.perUnit * 100) / 100).toLocaleString() + '/' + r.piece.qtyUnit
        : (Math.round(r.piece.perUnit * 100) / 100).toLocaleString() + '/m2')
    : null;
  const pieceDesc = r.piece && !r.piece.countOnly
    ? (r.piece.div === 'volume'
        ? r.piece.price.toLocaleString() + ' per ' + r.piece.w + ' L yield = ' + pieceNarr
        : r.piece.price.toLocaleString() + ' / ' +
          (_units === 'imperial' ? Math.round(r.piece.w / 2.54) + ' x ' + Math.round(r.piece.l / 2.54) + ' in' : r.piece.w + ' x ' + r.piece.l + ' ' + r.piece.unit) + ' = ' + pieceNarr)
    : null;
  const matLabel = r.piece && !r.piece.countOnly
    ? 'Materials - priced per piece at ' + pieceDesc
    : 'Materials' + (r.matOverridden ? ' - your rate' : '');
  const shown = qtyShown(r.qty, r.unit);
  const qh = $('calc-quote-biz'), qm = $('calc-quote-meta'), qt = $('calc-quote-title');
  if (qh) qh.textContent = bizName();
  if (qt) qt.textContent = docType();
  if (qm) qm.textContent = (docTitleRaw() || (($('calc-save-name') || {}).value || r.name)) + '  -  ' + r.name + '  -  ' + shown.main + '  -  ' + new Date().toISOString().slice(0, 10);
  out.innerHTML =
    '<div class="calc-sum">' +
      '<div class="calc-sum-main"><span class="calc-sum-label">' + r.qtyLabel + '</span>' +
      '<strong class="calc-sum-qty">' + esc(shown.main) +
        '<span class="calc-qty-alt">' + esc(shown.alt) + '</span></strong></div>' +
      '<div class="calc-sum-sub">' + r.matDesc + '</div>' +
      (r.orderCount
        ? '<div class="calc-sum-sub">Order about <strong>' + r.orderCount.n.toLocaleString() + '</strong> ' + esc(r.orderCount.lbl + ' at ' + r.orderCount.sizeTxt) + '</div>'
        : '') +
    '</div>' +
    (r.hasWaste ? row(r.wasteLbl + ' allowance', r.wastePct + '%') : '') +
    row(matLabel, fmtMoney(r.mat)) +
    row('Labor' + (r.labOverridden ? ' - your rate' : ''), fmtMoney(r.lab)) +
    (r.eq > 0 ? row('Equipment / plant hire', fmtMoney(r.eq)) : '') +
    (r.ohPct > 0 ? row('Overhead & margin ' + r.ohPct + '%', fmtMoney(r.oh)) : '') +
    row('Subtotal', fmtMoney(r.sub), 'calc-line-sub') +
    row('Tax (' + r.taxRate + '%' + (r.overrideApplied ? ', your rate' : '') + ')', fmtMoney(r.tax)) +
    row('Estimated total', fmtMoney(r.total), 'calc-line-total') +
    '<div class="calc-fine">Planning-grade estimate for ' + r.currency + '. Not a quote - every line becomes editable in the app once the project starts.</div>';
  return r;
}

// ---- History (localStorage, this device only) ----
const HKEY = 'mmgr_calc_history';
function loadHistory() { try { return JSON.parse(localStorage.getItem(HKEY) || '[]'); } catch (e) { return []; } }
function saveHistory(entry) {
  try {
    const h = loadHistory();
    h.unshift(entry);
    localStorage.setItem(HKEY, JSON.stringify(h.slice(0, 20)));
  } catch (e) { /* storage full or blocked - history is a nicety, never a gate */ }
}
function renderHistory() {
  const wrap = $('calc-history');
  if (!wrap) return;
  const h = loadHistory();
  if (!h.length) { wrap.innerHTML = '<div class="calc-empty">Nothing saved yet.</div>'; return; }
  wrap.innerHTML = h.map((e, i) =>
    '<div class="calc-hist-row">' +
      '<span class="calc-hist-date">' + e.at + '</span>' +
      '<span class="calc-hist-work">' + e.name + '</span>' +
      '<span class="calc-hist-total">' + e.total + '</span>' +
      '<button type="button" class="btn btn-n btn-s" data-action="calcRestore" data-idx="' + i + '">Recall</button>' +
      '<button type="button" class="btn btn-n btn-s" data-action="calcDelHist" data-idx="' + i + '" aria-label="Delete this history row">X</button>' +
    '</div>').join('');
}

// ---- How-to guide slider (owner 2026-09-30) ---------------------------
// Eight steps in the form's own top-to-bottom field order (work item
// FIRST, overhead later) so the guide never teaches out of order.
const GUIDE_STEPS = [
  'Pick your work item. Choose what you are pricing - the calculator changes its fields and labels to match.',
  'Choose metric or imperial. Everything converts as you type.',
  'Enter the dimensions. Length, width, depth - whichever the work item asks for.',
  'Pick your currency and country. The country sets the standard tax rate; you can override it.',
  'Choose the finish level. Economy trims about 15%, premium adds about 35%. Add a custom tax % if yours differs.',
  'Overhead and margin. Many builders add about 10% on top for overhead and profit - type your own or leave it at zero.',
  'Your rates. Material, labor and equipment rates come prefilled as planning-grade averages. Change them to yours, and save them as a rate sheet to reuse.',
  'Calculate and export. Hit Calculate, then save it with a name, print or PDF it, or export CSV. Name the document so it prints right.'
];
let guideIdx = 0;
function guideOpenState() { try { return localStorage.getItem('mmgr_calc_guide_open') !== '0'; } catch (e) { return true; } }
function renderGuide() {
  const body = $('calc-guide-body'), reopen = $('calc-guide-reopen'), toggle = $('calc-guide-toggle');
  if (!body) return;
  const open = guideOpenState();
  body.hidden = !open;
  if (reopen) reopen.hidden = open;
  if (toggle) toggle.hidden = !open;
  if (!open) return;
  const c = $('calc-guide-count'), t = $('calc-guide-text'), dots = $('calc-guide-dots');
  if (c) c.textContent = (guideIdx + 1) + ' of ' + GUIDE_STEPS.length;
  if (t) t.textContent = GUIDE_STEPS[guideIdx];
  if (dots) {
    let h = '';
    for (let i = 0; i < GUIDE_STEPS.length; i++) h += '<span class="bcp-guide-dot' + (i === guideIdx ? ' active' : '') + '"></span>';
    dots.innerHTML = h;
  }
}

// ---- First-visit tutorial (owner 2026-09-30) ----------------------------
// Click-to-start spotlight walkthrough in the guide's field order. One
// flag (mmgr_calc_tour_done) gates the nudge; clearing browser data
// removes it, so a wiped device sees the tour again (owner-specified).
const TOUR_STEPS = [
  { sel: '#calc-work', text: 'This is the work item - what you are pricing. Pick one and the form follows.' },
  { sel: '.bcp-seg', text: 'Choose your measurement: metric or imperial. Everything converts as you type.' },
  { sel: '#calc-d1', text: 'Enter the dimensions the form asks for - length, width, depth.' },
  { sel: '#calc-currency', text: 'Your currency, and the country that sets the standard tax rate.' },
  { sel: '#calc-quality', text: 'Finish level: economy trims about 15%, premium adds about 35%.' },
  { sel: '#calc-oh', text: 'Overhead and margin: many builders add about 10% - yours is optional.' },
  { sel: '#calc-rate-mat', text: 'Your rates come prefilled as planning-grade averages. Type your own; save them as rate sheets.' },
  { sel: '.bcp-run', text: 'Hit Calculate and the breakdown lands on the right.' },
  { sel: null, text: "That's it - you're ready to use the calculator." }
];
let tourIdx = -1;
function tourDone() { try { return localStorage.getItem('mmgr_calc_tour_done') === '1'; } catch (e) { return false; } }
function tourFlag() { try { localStorage.setItem('mmgr_calc_tour_done', '1'); } catch (e) {} }
function tourEnd() { tourIdx = -1; tourFlag(); const o = $('calc-tour-overlay'); if (o) o.hidden = true; }
function tourShow() {
  const o = $('calc-tour-overlay'), pop = $('calc-tour-pop');
  if (!o || !pop) return;
  const st = TOUR_STEPS[tourIdx];
  if (!st) { tourEnd(); return; }
  o.hidden = false;
  const c = $('calc-tour-count'), t = $('calc-tour-text'), dots = $('calc-tour-dots');
  if (c) c.textContent = (tourIdx + 1) + ' of ' + TOUR_STEPS.length;
  if (t) t.textContent = st.text;
  if (dots) {
    let h = '';
    for (let i = 0; i < TOUR_STEPS.length; i++) h += '<span class="bcp-guide-dot' + (i === tourIdx ? ' active' : '') + '"></span>';
    dots.innerHTML = h;
  }
  const tEl = st.sel ? document.querySelector(st.sel) : null;
  if (tEl) {
    try { tEl.scrollIntoView({ block: 'center' }); } catch (e) {}
    pop.setAttribute('data-anchor', st.sel);
    positionTourPop(tEl);
  } else {
    pop.removeAttribute('data-anchor');
    pop.style.left = '50%';
    pop.style.top = '50%';
    pop.style.transform = 'translate(-50%,-50%)';
  }
}
function positionTourPop(target) {
  const pop = $('calc-tour-pop');
  if (!pop) return;
  pop.style.transform = 'none';
  const r = target.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  const pw = Math.min(pr.width || 320, window.innerWidth - 24);
  const below = r.bottom + 12 + pr.height < window.innerHeight;
  pop.style.left = Math.max(12, Math.min(r.left, window.innerWidth - pw - 12)) + 'px';
  pop.style.top = (below ? r.bottom + 12 : Math.max(12, r.top - pr.height - 12)) + 'px';
}
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && tourIdx >= 0) tourEnd();
});
window.addEventListener('resize', function() {
  if (tourIdx < 0) return;
  const st = TOUR_STEPS[tourIdx];
  const t = st && st.sel ? document.querySelector(st.sel) : null;
  if (t) positionTourPop(t);
});
// Harness hook (harmless in production).
window.__calcTour = {
  start: function() { ACTIONS.calcTourStart(); },
  skip: function() { tourEnd(); },
  state: function() { return { idx: tourIdx, done: tourDone() }; }
};

// ---- Actions (same data-action dispatch convention as the app) ----
const ACTIONS = {
  // ---- How-to guide slider (owner 2026-09-30): field-order steps -------
  calcGuidePrev: function() { guideIdx = (guideIdx - 1 + GUIDE_STEPS.length) % GUIDE_STEPS.length; renderGuide(); },
  calcGuideNext: function() { guideIdx = (guideIdx + 1) % GUIDE_STEPS.length; renderGuide(); },
  calcGuideClose: function() { try { localStorage.setItem('mmgr_calc_guide_open', '0'); } catch (e) {} renderGuide(); },
  calcGuideOpen: function() { try { localStorage.setItem('mmgr_calc_guide_open', '1'); } catch (e) {} renderGuide(); },
  // ---- First-visit tutorial actions (owner 2026-09-30) ----
  calcTourStart: function() { tourIdx = 0; const n = $('calc-tour-nudge'); if (n) n.hidden = true; tourShow(); },
  calcTourNext: function() { if (tourIdx < 0) return; if (tourIdx >= TOUR_STEPS.length - 1) { tourEnd(); return; } tourIdx++; tourShow(); },
  calcTourPrev: function() { if (tourIdx <= 0) return; tourIdx--; tourShow(); },
  calcTourSkip: function() { tourEnd(); },
  calcTourDismiss: function() { const n = $('calc-tour-nudge'); if (n) n.hidden = true; tourFlag(); },
  calcRun: function() {
    const r = render();
    if (r && !r.error) {
      // F4b exact recall: the row carries the FULL settings state so recall
      // reproduces this sum exactly (owner directive), not a re-skin of it.
      const st = readState();
      saveHistory({ at: new Date().toISOString().slice(0, 10), name: r.name,
        qty: r.qty + ' ' + r.unit, total: fmtMoney(r.total), st: st });
      renderHistory();
      // Playwright UX audit finding (2026-09-28): on phones the result card
      // sits below the fold, so tapping Calculate looked like nothing
      // happened. Bring the estimate into view - explicit action only,
      // NEVER on live typing (that would yank the page mid-edit).
      const outEl = $('calc-output');
      if (outEl) {
        const rect = outEl.getBoundingClientRect();
        if (rect.top < 0 || rect.top > window.innerHeight - 80) {
          const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          outEl.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
        }
      }
    }
  },
  calcClearHistory: function() {
    try { localStorage.removeItem(HKEY); } catch (e) {}
    renderHistory();
  },
  calcRestore: function(el) {
    const h = loadHistory()[parseInt(el.getAttribute('data-idx'), 10)];
    if (!h) return;
    if (h.st) {
      // New rows: restore EVERYTHING the sum was computed with.
      applyState(h.st);
    } else {
      // Legacy rows (pre-F4b): restore what they carry; infer the unit
      // system from dimension magnitudes so the numbers read as typed.
      applyLegacy(h);
    }
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },
  calcDelHist: function(el) {
    const idx = parseInt(el.getAttribute('data-idx'), 10);
    const h = loadHistory();
    if (isNaN(idx) || !h[idx]) return;
    h.splice(idx, 1);
    try { localStorage.setItem(HKEY, JSON.stringify(h)); } catch (e) {}
    renderHistory();
  },
  // F4b: put the model rates back (the escape hatch from your own rates).
  calcRatesReset: function() {
    if ($('calc-rate-mat')) $('calc-rate-mat').value = '';
    if ($('calc-rate-lab')) $('calc-rate-lab').value = '';
    if ($('calc-piece-price')) $('calc-piece-price').value = '';
    if ($('calc-piece-size')) $('calc-piece-size').value = '';
    if ($('calc-waste')) $('calc-waste').value = '';
    refreshRateFields();
    render();
  },
  tglTheme: function() {
    // Same theme helper every page uses (mmgr-theme.js exposes MMGRTheme);
    // body.dark-mode + persistence are owned there, never duplicated here.
    if (window.MMGRTheme && MMGRTheme.setMode) { MMGRTheme.setMode(MMGRTheme.isDark() ? 'light' : 'dark'); return; }
    document.body.classList.toggle('dark-mode');
    try { localStorage.setItem('mmgr_theme', document.body.classList.contains('dark-mode') ? 'dark' : 'light'); } catch (e) {}
  },
  // E2 (owner 2026-09-29 universal back-navigation): Back goes where you
  // came from when this page was opened from inside the site; straight to
  // the app dashboard when it is the entry point (bookmark, PWA icon).
  calcBack: function() {
    let ref = '';
    try { ref = document.referrer || ''; } catch (e) {}
    let sameOrigin = false;
    if (ref) { try { sameOrigin = new URL(ref).origin === window.location.origin; } catch (e) { sameOrigin = false; } }
    if (sameOrigin && window.history.length > 1 && !ref.startsWith(location.href.split('#')[0])) {
      window.history.back();
    } else {
      window.location.href = 'app.html';
    }
  },
  // F4-1: metric / imperial toggle. Inputs convert on entry; labels and the
  // quantity's imperial reading follow. Choice persists per device.
  calcUnits: function(el) {
    setUnits(el.getAttribute('data-units') === 'imperial' ? 'imperial' : 'metric', false);
  },
  // F4-2: export the live breakdown.
  calcPrint: function() {
    if (!lastResult) return;
    document.body.classList.add('print-estimate');
    window.print();
  },
  calcCsv: downloadCsv,
  // F4-3: named estimates.
  calcSave: function() {
    if (!lastResult) return;
    const nameEl = $('calc-save-name');
    const name = ((nameEl && nameEl.value) || '').trim() || (lastResult.name + ' - ' + fmtMoney(lastResult.total));
    const list = loadEstimates();
    list.unshift({ id: 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name, at: new Date().toISOString().slice(0, 10), total: fmtMoney(lastResult.total), st: readState() });
    persistEstimates(list);
    if (nameEl) nameEl.value = '';
    renderEstimates();
  },
  calcOpen: function(el) {
    const est = loadEstimates().find(function(x) { return x.id === el.getAttribute('data-id'); });
    if (!est) return;
    if (est.st) {
      applyState(est.st);
    } else if (est.work) {
      applyLegacy(est);
      if (est.taxOverride && $('calc-tax-override')) $('calc-tax-override').value = est.taxOverride;
    }
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },
  calcDeleteEst: function(el) {
    const id = el.getAttribute('data-id');
    persistEstimates(loadEstimates().filter(function(x) { return x.id !== id; }));
    renderEstimates();
  },
  // ---- D2 comparison ----
  calcCompare: renderCompare,
  calcCompareClose: function() {
    const card = $('calc-compare-card');
    if (card) card.hidden = true;
    document.querySelectorAll('.bcp-cmp-check:checked').forEach(function(c) { c.checked = false; });
  },
  // ---- Rate sheets ----
  calcSheetSave: function() {
    const nameEl = $('calc-sheet-name');
    const name = ((nameEl && nameEl.value) || '').trim();
    if (!name) {
      if (nameEl) { nameEl.focus(); nameEl.placeholder = 'Name it first - e.g. low-bid'; }
      return;
    }
    const matEl = $('calc-rate-mat'), labEl = $('calc-rate-lab');
    if (!matEl || !matEl.value || !labEl || !labEl.value) return;
    const list = loadSheets().filter(function(sh) { return sh.name.toLowerCase() !== name.toLowerCase(); });
    list.unshift({ id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name,
      at: new Date().toISOString().slice(0, 10),
      rates: { rateMat: matEl.value, rateLab: labEl.value,
        piecePrice: ($('calc-piece-price') || {}).value || '', pieceSize: ($('calc-piece-size') || {}).value || '' } });
    persistSheets(list);
    if (nameEl) { nameEl.value = ''; nameEl.placeholder = 'e.g. low-bid, sustain'; }
    matEl.dataset.sheet = name;
    renderSheets();
  },
  calcSheetApply: function(el) {
    applySheetById(el.getAttribute('data-id'));
  },
  calcSheetDelete: function(el) {
    const id = el.getAttribute('data-id');
    persistSheets(loadSheets().filter(function(x) { return x.id !== id; }));
    renderSheets();
  },
  // ---- D1 (owner review 2026-09-29): rate-sheet transfer ----------------
  // Export downloads every saved sheet as a JSON file; import merges a file
  // back in (same-name sheets replace, malformed entries are skipped).
  calcSheetExport: function() {
    const list = loadSheets();
    if (!list.length) { sheetMsg('No saved rate sheets to export yet.'); return; }
    const payload = JSON.stringify({ version: 1, exported: new Date().toISOString().slice(0, 10), sheets: list }, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'mmgr-calc-rate-sheets-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function() { URL.revokeObjectURL(a.href); }, 500);
    sheetMsg('Exported ' + list.length + ' rate sheet(s).');
  },
  calcSheetImport: function() {
    const f = $('calc-sheet-file');
    if (f) f.click();
  },
  calcSheetPick: null
};

document.addEventListener('click', function(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = ACTIONS[el.getAttribute('data-action')];
  if (fn) fn(el);
});

// Rate-sheet quick picker: choosing a sheet in the <select> applies it.
// The select carries the sheet id as its option VALUE (row buttons carry
// data-id) - resolve by value here, then snap back to the placeholder row.
document.addEventListener('change', function(e) {
  const el = e.target.closest('[data-action="calcSheetPick"]');
  if (!el || !el.value) return;
  applySheetById(el.value);
  el.selectedIndex = 0;
});

// D1: the hidden file input behind the Import button. Every failure path
// reports in the status line - a bad file never throws, never clears storage.
document.addEventListener('change', function(e) {
  if (e.target.id !== 'calc-sheet-file') return;
  const file = e.target.files && e.target.files[0];
  e.target.value = ''; // allow re-choosing the same file
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function() {
    let json = null;
    try { json = JSON.parse(String(reader.result)); } catch (err) { json = null; }
    const res = importSheets(json);
    if (res === null) { sheetMsg('That file is not a My MaNaGeR rate sheet export.'); return; }
    sheetMsg('Imported ' + res.merged + ' rate sheet(s)' + (res.skipped ? ' (' + res.skipped + ' skipped - missing name or rates).' : '.'));
  };
  reader.readAsText(file);
});

// Print scope is class-scoped; window.print() blocks, so remove the class
// right after it returns (covers the common browsers' dialog lifecycle;
// afterprint is the standards path where it fires).
window.addEventListener('afterprint', function() { document.body.classList.remove('print-estimate'); });

// D3: persist the business letterhead name on every keystroke. Rendering
// follows through the same input path as every other field.
(function() {
  const el = $('calc-biz-name');
  if (!el) return;
  el.addEventListener('input', function() {
    try { localStorage.setItem(BKEY, el.value.trim()); } catch (e) { /* nicety */ }
    render();
  });
})();

// ---- Rate fields (F4b): prefill from the model, label with units, --------
// piece rows show only on trades that have a piece spec.
function rateUnitLabel(key) {
  const w = WORK[key];
  if (!w) return '';
  const map = { m2: 'per m2', m3: 'per m3', m: 'per m', t: 'per tonne', L: 'per litre' };
  const imp = _units === 'imperial';
  const impMap = { m2: 'per sq ft', m3: 'per cu yd', m: 'per ft', t: 'per tonne', L: 'per litre' };
  return (imp ? impMap : map)[w.q(1, 1, 1).unit] || '';
}

function currentDims() {
  const imp = _units === 'imperial';
  const raw1 = num($('calc-d1'));
  const raw2 = $('calc-d2') && !$('calc-d2').hidden ? num($('calc-d2')) : null;
  return {
    d1: imp ? raw1 * FT : raw1,
    d2: raw2 !== null ? (imp ? raw2 * FT : raw2) : null
  };
}

// Prefill empty rate fields with the model rate; leave typed values alone.
// Reruns on every work/units change so the labels carry the right per-unit.
function refreshRateFields() {
  const key = ($('calc-work') || {}).value;
  const w = WORK[key];
  if (!w) return;
  const d = currentDims();
  const matEl = $('calc-rate-mat'), labEl = $('calc-rate-lab');
  if (!matEl || !labEl) return;
  const modelM = String(Math.round(modelMatRate(key, d.d1, d.d2) * 100) / 100);
  const modelL = String(w.rate.lab);
  // Prefill empty fields; an UNTOUCHED prefill (value === what we last put
  // there) follows the model when dimensions change the model rate. A typed
  // override is never overwritten - that is the rate freedom.
  if (matEl.value === '' || matEl.value === matEl.dataset.model) matEl.value = modelM;
  if (labEl.value === '' || labEl.value === labEl.dataset.model) labEl.value = modelL;
  matEl.dataset.model = modelM;
  labEl.dataset.model = modelL;
  $('calc-rate-mat-label').textContent = 'Material rate ' + rateUnitLabel(key);
  $('calc-rate-lab-label').textContent = 'Labor rate ' + rateUnitLabel(key);
  const eqLbl = $('calc-rate-eq-label');
  if (eqLbl) eqLbl.textContent = 'Equipment / plant hire ' + rateUnitLabel(key);
  // B1 waste field: only trades with a waste spec; label names the allowance,
  // empty field prefills the trade default (typed values are never clobbered).
  const ww = $('calc-waste-wrap'), we = $('calc-waste');
  if (ww && we) {
    ww.hidden = !w.waste;
    if (w.waste) {
      $('calc-waste-label').textContent = w.waste.lbl + ' %';
      if (we.value === '' || we.value === we.dataset.def) {
        we.value = String(w.waste.def);
        we.dataset.def = String(w.waste.def);
      }
      we.dataset.def = String(w.waste.def);
    }
  }
  // Piece rows: only trades with a piece spec; labels follow work + units.
  const pw = $('calc-piece-wrap'), priceEl = $('calc-piece-price'), sizeEl = $('calc-piece-size');
  if (pw) pw.hidden = !w.piece;
  if (w.piece && priceEl && sizeEl) {
    $('calc-piece-price-label').textContent = w.piece.priceLabel;
    // Volume specs take a single yield number (unit-free - a 20 L bag is a
    // 20 L bag in any unit system); dimensioned specs convert cm->in, m->ft.
    $('calc-piece-size-label').textContent = w.piece.div === 'volume'
      ? w.piece.sizeLabel
      : (_units === 'imperial'
        ? w.piece.sizeLabel.replace('(cm)', '(in)').replace('(m)', '(ft)') : w.piece.sizeLabel);
    if (!priceEl.placeholder || priceEl.dataset.phWork !== key) {
      priceEl.placeholder = w.piece.ph;
      sizeEl.placeholder = w.piece.phSize;
      priceEl.dataset.phWork = key;
    }
  }
  const hint = $('calc-piece-hint');
  if (hint) {
    hint.hidden = !w.piece;
    if (w.piece) {
      hint.textContent = w.piece.div === 'volume'
        ? 'Enter the bag or container yield and its price - the estimate prices the exact quantity needed (concrete in m3, paint in litres).'
        : 'Leave empty to price by the square meter with the rate above. Fill it in to price by the piece.';
    }
  }
}

// Live labels follow the work item (the floating calculator's spirit, page form).
function syncLabels() {
  const key = ($('calc-work') || {}).value;
  const w = WORK[key];
  if (!w) return;
  $('calc-d1-label').textContent = dimLabel(w, 'd1');
  $('calc-d2-label').textContent = dimLabel(w, 'd2') || '';
  $('calc-d2-wrap').hidden = !w.d2;
  $('calc-d2').hidden = !w.d2;
  $('calc-d3-label').textContent = dimLabel(w, 'd3') || '';
  $('calc-d3-wrap').hidden = !w.d3;
  $('calc-d3').hidden = !w.d3;
  // Country default tax hint follows selection when no custom override.
  const c = ($('calc-country') || {}).value;
  if ($('calc-country') && !$('calc-tax-override').value) {
    $('calc-country').selectedOptions[0].textContent = countryLabel(c);
  }
  refreshRateFields();
}

// Labels as entered right now (kept for CSV display).
function currentDimLabels() {
  const w = WORK[($('calc-work') || {}).value];
  if (!w) return [];
  return [dimLabel(w, 'd1'), dimLabel(w, 'd2'), dimLabel(w, 'd3')].filter(Boolean);
}

// ---- Legacy recall (pre-F4b rows without a st object) --------------------
// Restores what the old shape carried and infers the unit system from
// dimension magnitudes, so old rows still land close to their original
// inputs instead of being misread through the wrong unit lens.
function applyLegacy(h) {
  const w = WORK[h.work];
  let units = null;
  if (w && h.d1) {
    const v = parseFloat(h.d1);
    if (isFinite(v) && v > 0) {
      const d1s = String(w.d1 || '');
      if (d1s.indexOf('(mm)') > -1) units = v >= 100 ? 'metric' : 'imperial';
      else if (d1s.indexOf('(m2)') > -1 || d1s.indexOf('(m3)') > -1 || d1s.indexOf('(m)') > -1) units = v >= 3 ? 'metric' : 'imperial';
    }
  }
  if (h.units) units = h.units;
  if (units) setUnits(units, true);
  $('calc-work').value = h.work || 'slab';
  syncLabels();
  $('calc-d1').value = h.d1 || '';
  if ($('calc-d2')) $('calc-d2').value = h.d2 || '';
  if ($('calc-d3')) $('calc-d3').value = h.d3 || '';
  if ($('calc-currency')) $('calc-currency').value = h.currency || 'USD';
  if ($('calc-country')) $('calc-country').value = h.country || 'US';
  if ($('calc-quality')) $('calc-quality').value = h.quality || 'standard';
  if ($('calc-rate-mat')) $('calc-rate-mat').value = '';
  if ($('calc-rate-lab')) $('calc-rate-lab').value = '';
  if ($('calc-piece-price')) $('calc-piece-price').value = '';
  if ($('calc-piece-size')) $('calc-piece-size').value = '';
  refreshRateFields();
}

// F4-1 core: switch unit system, re-label, remember, re-render only when
// there is something on the table (a bare form keeps its friendly empty
// state instead of flashing the dimensions error).
function setUnits(mode, silent) {
  _units = mode === 'imperial' ? 'imperial' : 'metric';
  try { localStorage.setItem('mmgr_calc_units', _units); } catch (e) {}
  document.querySelectorAll('.bcp-seg-btn').forEach(function(b) {
    const on = b.getAttribute('data-units') === _units;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  syncLabels();
  const any = ['calc-d1', 'calc-d2', 'calc-d3'].some(function(id) { return $(id) && $(id).value; });
  if (any || silent !== true) render();
}
function countryLabel(code) {
  const map = { US: 'United States (sales tax varies - use the custom field)', JM: 'Jamaica (GCT 15%)',
    GB: 'United Kingdom (VAT 20%)', AU: 'Australia (GST 10%)', CA: 'Canada (GST 5%)', JP: 'Japan (consumption tax 10%)', DE: 'Germany (VAT 19%)' };
  return map[code] || code;
}

// Init: theme comes from the shared helper (mmgr-theme.js, loaded in <head>
// with data-sync="1") which applies the saved mode before first paint - no
// local restore here, a second writer would fight the helper.
if ($('calc-work')) {
  $('calc-work').addEventListener('change', syncLabels);
  ['calc-currency', 'calc-country', 'calc-quality', 'calc-tax-override', 'calc-d1', 'calc-d2', 'calc-d3',
   'calc-rate-mat', 'calc-rate-lab', 'calc-rate-eq', 'calc-oh', 'calc-piece-price', 'calc-piece-size', 'calc-waste']
    .forEach(function(id) { const el = $(id); if (el) el.addEventListener('input', function() { render(); }); });
  // Saved unit system comes back before first interaction; silent keeps the
  // empty-state text until the user actually enters dimensions.
  let savedUnits = 'metric';
  try { savedUnits = localStorage.getItem('mmgr_calc_units') || 'metric'; } catch (e) {}
  setUnits(savedUnits, true);
}
renderHistory();
renderEstimates();
renderSheets();
// How-to guide: paint the first step (open state decides visibility).
renderGuide();
// First-visit tutorial nudge: only when the flag is absent.
(function() { const n = $('calc-tour-nudge'); if (n && !tourDone()) n.hidden = false; })();
// Swipe support on the guide body (40px threshold, horizontal only).
(function() {
  const body = $('calc-guide-body');
  if (!body) return;
  let x0 = null;
  body.addEventListener('touchstart', function(e) { x0 = e.touches[0].clientX; }, { passive: true });
  body.addEventListener('touchend', function(e) {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 40) { if (dx < 0) ACTIONS.calcGuideNext(); else ACTIONS.calcGuidePrev(); }
    x0 = null;
  }, { passive: true });
})();
// D3: restore the saved business name after the listeners are attached.
(function() {
  let saved = '';
  try { saved = localStorage.getItem(BKEY) || ''; } catch (e) {}
  const el = $('calc-biz-name');
  if (el && saved && !el.value) el.value = saved;
})();
})();
