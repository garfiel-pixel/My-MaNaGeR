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
    rate: { mat: 2, lab: 14 }, matDesc: 'Cart-away / disposal',
    // E2 (plan v2 Phase 1): excavation converted to the variant structure
    // with ONE variant whose rates equal the pre-conversion model - old
    // saves recall to the same total (Phase 1 exit gate). Phase 2 fills the
    // real JIC soil/depth-band variant sets from the official sheet.
    variants: [{ id: 'standard', label: 'Standard dig', rate: { mat: 2, lab: 14 } }] },
  slab:       { group: 'Groundworks', d1: 'Length (m)', d2: 'Width (m)', d3: 'Thickness (mm)', waste: { def: 5, lbl: 'Concrete waste' }, piece: { priceLabel: 'Price per bag of mix', sizeLabel: 'Bag yield (litres)', single: true, div: 'volume', qtyUnit: 'm3', ph: 'e.g. 9200 per bag', phSize: 'e.g. 20' },
    q: (a, b, c) => ({ qty: a * b * (c / 1000), unit: 'm3', qtyLabel: 'Concrete' }),
    rate: { mat: 150, lab: 85 }, matDesc: 'C20/25 ready-mix, mesh, vapor barrier' },
  footings:   { group: 'Groundworks', d1: 'Total run (m)', d2: 'Width (mm)', d3: 'Depth (mm)', waste: { def: 5, lbl: 'Concrete waste' }, piece: { priceLabel: 'Price per bag of mix', sizeLabel: 'Bag yield (litres)', single: true, div: 'volume', qtyUnit: 'm3', ph: 'e.g. 9200 per bag', phSize: 'e.g. 20' },
    q: (a, b, c) => ({ qty: a * (b / 1000) * (c / 1000), unit: 'm3', qtyLabel: 'Concrete' }),
    rate: { mat: 155, lab: 90 }, matDesc: 'C20/25, rebar cage allowance' },
  blockwall:  { group: 'Structure', d1: 'Length (m)', d2: 'Height (m)', d3: null, openings: true, piece: { priceLabel: 'Price per block', sizeLabel: 'Block size - length x height (cm)', unit: 'cm', div: 'area', ph: 'e.g. 800 per block', phSize: 'e.g. 40 x 20' },
    q: (a, b) => ({ qty: a * b, unit: 'm2', qtyLabel: 'Wall area' }),
    rate: { mat: 22, lab: 28 }, matDesc: 'Blocks (12.5/m2), mortar, ties' },
  brickwall:  { group: 'Structure', d1: 'Length (m)', d2: 'Height (m)', d3: null, openings: true, piece: { priceLabel: 'Price per brick', sizeLabel: 'Brick size - length x height (cm)', unit: 'cm', div: 'area', ph: 'e.g. 140 per brick', phSize: 'e.g. 20 x 10' },
    q: (a, b) => ({ qty: a * b, unit: 'm2', qtyLabel: 'Wall area' }),
    rate: { mat: 34, lab: 42 }, matDesc: 'Bricks (60/m2), mortar, wall ties' },
  framing:    { group: 'Structure', d1: 'Length (m)', d2: 'Height (m)', d3: null, openings: true,
    q: (a, b) => ({ qty: a * b, unit: 'm2', qtyLabel: 'Framed area' }),
    rate: { mat: 19, lab: 24 }, matDesc: 'Studs, plates, sheathing' },
  rebar:      { group: 'Structure', d1: 'Concrete volume (m3)', d2: null, d3: null,
    q: (a) => ({ qty: a * 85 / 1000, unit: 't', qtyLabel: 'Steel (85 kg per m3)' }),
    rate: { mat: 950, lab: 380 }, matDesc: 'Bars, ties, chairs, cutting waste' },
  roof:       { group: 'Envelope', d1: 'Length (m)', d2: 'Slope width (m)', d3: null, waste: { def: 10, lbl: 'Laps / pitch allowance' }, piece: { priceLabel: 'Price per sheet', sizeLabel: 'Sheet size - width x length (m)', unit: 'm', div: 'area', ph: 'e.g. 6120 per sheet', phSize: 'e.g. 0.85 x 3.6', plural: 'sheets' },
    q: (a, b) => ({ qty: a * b, unit: 'm2', qtyLabel: 'Sheet area' }),
    rate: { mat: 26, lab: 18 }, matDesc: 'Sheets, fixings, flashings' },
  render:     { group: 'Envelope', d1: 'Length (m)', d2: 'Height (m)', d3: null, openings: true,
    q: (a, b) => ({ qty: a * b, unit: 'm2', qtyLabel: 'Rendered area' }),
    rate: { mat: 11, lab: 19 }, matDesc: 'Two-coat render, bead, primer' },
  paint:      { group: 'Envelope', d1: 'Length (m)', d2: 'Height (m)', d3: null, openings: true, piece: { priceLabel: 'Price per container', sizeLabel: 'Container yield (litres)', single: true, div: 'volume', qtyUnit: 'L', ph: 'e.g. 9000 per gallon-can', phSize: 'e.g. 3.785' },
    q: (a, b) => ({ qty: a * b * 2 / 10, unit: 'L', qtyLabel: 'Paint (2 coats at 10 m2/L)' }),
    rate: { mat: 14, lab: 11 }, matDesc: 'Emulsion, primer, rollers' },
  drywall:    { group: 'Envelope', d1: 'Length (m)', d2: 'Height (m)', d3: null, openings: true, waste: { def: 10, lbl: 'Cuts / waste' }, piece: { priceLabel: 'Price per board', sizeLabel: 'Board size - width x length (m)', unit: 'm', div: 'area', ph: 'e.g. 950 per board', phSize: 'e.g. 1.22 x 2.44', plural: 'boards' },
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
    rate: { mat: 250, lab: 300 }, matDesc: 'Asphalt shingles, underlayment, starter' },
  // ---- Research-backed additions round 2 (owner 2026-10-01: "do research
  // and add the more we need") - the openings, ceiling, rainwater and
  // packaged-install work a residential job always carries. Rates are
  // planning-grade 2026 web benchmarks (Doornmore/ASP door installs, Pella
  // window installs, Angi drop-ceiling + septic, Homewyse gutters/fascia,
  // Fuse Service water heaters, Highland cabinetry) - editable as always.
  door:        { group: 'Finishes', d1: 'Doors (count)', d2: null, d3: null,
    q: (a) => ({ qty: a, unit: 'each', qtyLabel: 'Doors' }),
    rate: { mat: 550, lab: 650 }, matDesc: 'Prehung door, frame, hardware, trim (2026: $500-2,000 installed, avg $1,200)' },
  window:      { group: 'Envelope', d1: 'Windows (count)', d2: null, d3: null,
    q: (a) => ({ qty: a, unit: 'each', qtyLabel: 'Windows' }),
    rate: { mat: 600, lab: 500 }, matDesc: 'Vinyl/fiberglass unit, flashing, sealant (2026: $800-1,600 installed each)' },
  ceiling:     { group: 'Finishes', d1: 'Length (m)', d2: 'Width (m)', d3: null,
    waste: { def: 10, lbl: 'Tile cuts / grid waste' },
    q: (a, b) => ({ qty: a * b, unit: 'm2', qtyLabel: 'Ceiling area' }),
    rate: { mat: 55, lab: 50 }, matDesc: 'Grid, tiles, hangers, perimeter angle (2026: $9-13/sq ft installed)' },
  gutter:      { group: 'Envelope', d1: 'Total run (m)', d2: null, d3: null,
    q: (a) => ({ qty: a, unit: 'm', qtyLabel: 'Gutter run (linear)' }),
    rate: { mat: 18, lab: 14 }, matDesc: 'Aluminum gutter, downpipes, brackets, seals (2026: $6.50-14.80/ft installed)' },
  'soffit-fascia': { group: 'Envelope', d1: 'Total run (m)', d2: null, d3: null,
    q: (a) => ({ qty: a, unit: 'm', qtyLabel: 'Soffit & fascia run (linear)' }),
    rate: { mat: 22, lab: 16 }, matDesc: 'Fascia board, soffit panels, vents, fixings (2026: $8.75-17/ft)' },
  'floor-screed': { group: 'Finishes', d1: 'Length (m)', d2: 'Width (m)', d3: 'Thickness (mm)', waste: { def: 5, lbl: 'Screed waste' }, piece: { priceLabel: 'Price per bag of mix', sizeLabel: 'Bag yield (litres)', single: true, div: 'volume', qtyUnit: 'm3', ph: 'e.g. 9200 per bag', phSize: 'e.g. 20' },
    q: (a, b, c) => ({ qty: a * b * (c / 1000), unit: 'm3', qtyLabel: 'Screed volume' }),
    rate: { mat: 120, lab: 70 }, matDesc: 'Sand-cement screed, leveling, cure' },
  cabinet:     { group: 'Finishes', d1: 'Cabinet run (m)', d2: null, d3: null,
    q: (a) => ({ qty: a, unit: 'm', qtyLabel: 'Cabinet run (linear)' }),
    rate: { mat: 800, lab: 450 }, matDesc: 'Box units, doors, drawer gear, worktop allowance (2026: $100-650/linear ft installed)' },
  'water-heater': { group: 'Plumbing', d1: 'Water heaters (count)', d2: null, d3: null,
    q: (a) => ({ qty: a, unit: 'each', qtyLabel: 'Water heaters' }),
    rate: { mat: 900, lab: 650 }, matDesc: 'Tank unit, valves, flex lines, pan (2026: $1,200-5,000 installed)' },
  'septic-tank': { group: 'Groundworks', d1: 'Septic systems (count)', d2: null, d3: null,
    q: (a) => ({ qty: a, unit: 'each', qtyLabel: 'Septic systems' }),
    rate: { mat: 3800, lab: 2700 }, matDesc: 'Tank, bed, distribution lines, excavation allowance (2026: $3,593-12,463 installed)' },
  // ---- W2 2026-10-01: DERIVED companion trades (punch-list reality) ------
  // Bill-only work items that never appear in the picker; a companion chip
  // fills the form state via measuredQty, so these price through the SAME
  // engine (waste, quality, rates) with zero new math.
  formwork:    { group: 'Groundworks', d1: '', d2: null, d3: null,
    q: (a) => ({ qty: a, unit: 'm2', qtyLabel: 'Formwork area' }),
    rate: { mat: 22, lab: 33 }, matDesc: 'Formwork boards, props, release agent' },
  'lining-out': { group: 'Groundworks', d1: '', d2: null, d3: null,
    q: (a) => ({ qty: a, unit: 'm', qtyLabel: 'Lining-out run' }),
    rate: { mat: 4, lab: 9 }, matDesc: 'Profiles, string lines, pegs' },
  'cart-away': { group: 'Groundworks', d1: '', d2: null, d3: null,
    q: (a) => ({ qty: a, unit: 'm2', qtyLabel: 'Debris area' }),
    rate: { mat: 2, lab: 7 }, matDesc: 'Debris removal allowance' },
  debrush:     { group: 'Groundworks', d1: '', d2: null, d3: null,
    q: (a) => ({ qty: a, unit: 'm', qtyLabel: 'Debrush run' }),
    rate: { mat: 2, lab: 8 }, matDesc: 'Cut and clear the line' },
  'post-holes': { group: 'Groundworks', d1: '', d2: null, d3: null,
    q: (a) => ({ qty: a, unit: 'each', qtyLabel: 'Post holes' }),
    rate: { mat: 5, lab: 25 }, matDesc: 'Dig, set, backfill - per hole' }
};

// ---- W2 2026-10-01: COMPANION WORK SUGGESTIONS (the punch-list reality) --
// Pricing one trade usually implies others (a wall needs lining out, clearing
// and carting away; a fence needs the line debrushed). PURE: each suggestion
// derives its quantity from the SAME state - no re-typing. Suggestions are
// one-tap adds to the bill; nothing is ever priced silently.
const COMPANIONS = {
  blockwall: ['lineout', 'brush', 'cart'],
  brickwall: ['lineout', 'brush', 'cart'],
  framing:   ['lineout', 'cart'],
  render:    ['lineout', 'cart'],
  paint:     ['cart'],
  drywall:   ['cart'],
  siteprep:  ['cart'],
  slab:      ['cart3'],
  footings:  ['cart3'],
  'concrete-drive': ['cart3'],
  rebar:     ['cart3'],
  fencing:   ['debrush', 'holes']
};
// A suggestion is { id, name, work, qty(st) -> number|null }. Quantities
// derive from typed dims (already metric in st - readState stores raw typed
// values, so imperial conversion mirrors computeFor's FT/IN rules here).
const COMPANION_DEFS = {
  lineout: { name: 'Lining out the walls (profiles and string lines)', work: 'lining-out',
    qty: function(st) {
      const n1 = parseFloat(st.d1), n2 = parseFloat(st.d2);
      if (!(n1 > 0)) return null;
      const d1 = st.units === 'imperial' ? n1 * FT : n1;
      const run = (n2 > 0) ? (st.units === 'imperial' ? n2 * FT : n2) * 2 + d1 * 2 : d1;
      return run > 0 ? run : null;
    } },
  brush: { name: 'Clear brush and strip topsoil', work: 'siteprep',
    qty: function(st) {
      const n1 = parseFloat(st.d1), n2 = parseFloat(st.d2);
      if (!(n1 > 0) || !(n2 > 0)) return null;
      return st.units === 'imperial' ? (n1 * FT) * (n2 * FT) : n1 * n2;
    } },
  cart: { name: 'Cart away debris', work: 'cart-away',
    qty: function(st) {
      const n1 = parseFloat(st.d1), n2 = parseFloat(st.d2);
      if (!(n1 > 0) || !(n2 > 0)) return null;
      return st.units === 'imperial' ? (n1 * FT) * (n2 * FT) : n1 * n2;
    } },
  cart3: { name: 'Cart away debris and surplus material', work: 'cart-away',
    qty: function(st) {
      const v = parseFloat(st.measuredQty != null && st.measuredQty !== '' ? st.measuredQty : st.measuredAuto);
      if (v > 0) return v;
      const n1 = parseFloat(st.d1), n2 = parseFloat(st.d2), n3 = parseFloat(st.d3);
      if (!(n1 > 0) || !(n2 > 0) || !(n3 > 0)) return null;
      const d1 = st.units === 'imperial' ? n1 * FT : n1;
      const d2 = st.units === 'imperial' ? n2 * FT : n2;
      const d3 = st.units === 'imperial' ? n3 * IN : n3;
      return d1 * d2 * (d3 / 1000);
    } },
  debrush: { name: 'Debrush the line of fence', work: 'debrush',
    qty: function(st) {
      const n1 = parseFloat(st.d1);
      if (!(n1 > 0)) return null;
      return st.units === 'imperial' ? n1 * FT : n1;
    } },
  holes: { name: 'Dig and backfill post holes', work: 'post-holes',
    qty: function(st) {
      const n1 = parseFloat(st.d1);
      if (!(n1 > 0)) return null;
      const run = st.units === 'imperial' ? n1 * FT : n1;
      return Math.min(200, Math.ceil(run / 2.5));
    } }
};
// PURE: the suggestions for a priced line's state, each with its derived
// quantity (null qty = dims insufficient -> suggestion withheld).
function companionsFor(st) {
  const ids = COMPANIONS[st && st.work] || [];
  return ids.map(function(id) {
    const def = COMPANION_DEFS[id];
    if (!def) return null;
    const qty = def.qty(st);
    return qty != null && qty > 0 ? { id: id, name: def.name, work: def.work, qty: qty } : null;
  }).filter(Boolean);
}

// Country standard tax rates (PwC VAT/GST quick table, 2026). US sales tax
// varies by state - default 0 with the custom override for the client's rate.
const TAX = { US: 0, JM: 15, GB: 20, AU: 10, CA: 5, JP: 10, DE: 19 };
const CURRENCY = { USD: '$', JMD: 'J$', GBP: '\u00A3', EUR: '\u20AC', CAD: 'C$', AUD: 'A$', JPY: '\u00A5' };
const QUALITY = { economy: 0.85, standard: 1, premium: 1.35 };

// ---- E1 (plan v2 Phase 1): CURRENCY BASE + FX TABLE ----------------------
// Model rates in the WORK table are planning-grade figures written in US
// dollars (declared base; audit A1: a JMD user was shown relabelled USD).
// The engine itself never converts - the rate FIELDS carry the money that
// gets charged. Prefill (refreshRateFields, via modelRatesFor) converts a
// model/book rate through this user-maintained, date-stamped FX table; a
// typed rate is always the user's own money in the picked currency and is
// never touched. No rate is ever guessed: the user or an imported rate
// book supplies it with an as-of date (plan section 4). Device-local,
// synced with the workspace like every other calculator store.
const BASE_CURRENCY = 'USD';
const FXKEY = 'mmgr_calc_fx';
function loadFx() { try { const v = JSON.parse(localStorage.getItem(FXKEY) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch (e) { return {}; } }
function persistFx(t) { try { localStorage.setItem(FXKEY, JSON.stringify(t)); } catch (e) { /* nicety */ } wsStampNow('fx'); scheduleWsPut(); }
// Units of `code` per 1 USD. The base needs no entry; an unknown code
// returns null - callers must show an honest warning, never a relabel.
function fxFactor(code) {
  if (!code || code === BASE_CURRENCY) return 1;
  const e = loadFx()[code];
  const per = e && parseFloat(e.per);
  return isFinite(per) && per > 0 ? per : null;
}
// A rate older than 180 days is flagged stale in the FX card (plan: "a
// stale warning" - it never blocks, it tells).
function fxStale(code) {
  const e = loadFx()[code];
  if (!e || !e.asOf) return false;
  const t = Date.parse(e.asOf);
  return isFinite(t) && (Date.now() - t) > 180 * 86400000;
}
// Multiplier taking a rate from `src` currency to `target` currency via
// the USD-anchored table (src X -> target Y = per(Y) / per(X)). Null when
// either side is missing and the pair is real - callers say so honestly.
function fxBetween(src, target) {
  if (!src || src === target) return 1;
  const ps = src === BASE_CURRENCY ? 1 : fxFactor(src);
  const pt = target === BASE_CURRENCY ? 1 : fxFactor(target);
  if (ps == null || pt == null) return null;
  return pt / ps;
}
// The Exchange rates card body: one chip per set rate with its as-of date
// (stale rates say so) and a remove button. No rate is ever fabricated.
function renderFx() {
  const list = $('calc-fx-list'), dateEl = $('calc-fx-asof');
  if (dateEl && !dateEl.value) { try { dateEl.value = new Date().toISOString().slice(0, 10); } catch (e) {} }
  if (!list) return;
  const t = loadFx();
  const codes = Object.keys(t);
  list.innerHTML = codes.length
    ? codes.map(function(c) {
        const e = t[c] || {};
        return '<span class="bcp-fx-chip">' + esc(c) + ': ' + esc(String(e.per)) + ' per USD (as of ' + esc(String(e.asOf || '?')) + ')' + (fxStale(c) ? ' - stale, update it' : '') +
          ' <button type="button" class="btn btn-n btn-s" data-action="calcFxDel" data-code="' + esc(c) + '" aria-label="Remove the ' + esc(c) + ' rate">X</button></span>';
      }).join(' ')
    : 'No exchange rates set yet. Model rates stay US dollars until you add one or type your own rates.';
}

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

// ---- E3 (plan v2 Phase 1): RATE-ENTRY UNIT ADAPTER -----------------------
// The engine's math is metric (m2, m3, m, t, L, each). A work item may
// declare the unit its RATES are quoted in (a JIC-style sheet speaks yd2,
// ft2, ft run, lb, dozen). The factor converts a per-entry-unit rate into
// a per-engine-unit rate - the math stays metric underneath, exactly as
// dimension entry already does. Values: the size of one entry unit in the
// engine unit (1 yd2 = 0.83612736 m2; 1 ft2 = 0.09290304 m2; 1 ft run =
// 0.3048 m; steel prices per lb convert to the tonne the engine uses:
// 2204.62262 lb/t; 1 dozen = 12 each). Items without a runit convert 1:1,
// so every existing trade prices exactly as before (golden cases hold).
const RATE_UNITS = {
  'yd2': 0.83612736, 'ft2': 0.09290304, 'ft run': 0.3048,
  'lb': 2204.62262, 'kg': 0.001, 'dozen': 1 / 12
};
function rateFactor(entry, engineUnit) {
  if (!entry || entry === engineUnit) return 1;
  const f = RATE_UNITS[entry];
  return isFinite(f) && f > 0 ? f : 1;
}

// Tiny local escaper - user-typed estimate names reach innerHTML.
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

const $ = (id) => document.getElementById(id);
const num = (el) => { const v = parseFloat(el && el.value); return isFinite(v) && v > 0 ? v : 0; };

function fmtMoney(v, code) {
  const cur = CURRENCY[code || (($('calc-currency') || {}).value)] || '$';
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
    matModel: (($('calc-rate-mat') || {}).dataset || {}).model || '',
    labModel: (($('calc-rate-lab') || {}).dataset || {}).model || '',
    rateEq: ($('calc-rate-eq') || {}).value || '',
    ohPct: ($('calc-oh') || {}).value || '',
    onCostPct: ($('calc-oncost-pct') || {}).value || '',
    docType: docType(),
    docTitle: docTitleRaw(),
    clientName: ($('calc-client-name') || {}).value || '',
    clientAddr: ($('calc-client-addr') || {}).value || '',
    docNo: ($('calc-doc-no') || {}).value || '',
    docDate: ($('calc-doc-date') || {}).value || '',
    docDue: ($('calc-doc-due') || {}).value || '',
    piecePrice: ($('calc-piece-price') || {}).value || '',
    pieceSize: ($('calc-piece-size') || {}).value || '',
    measuredQty: ($('calc-measured-qty') || {}).value || '',
    measuredAuto: instSum > 0 ? String(instSum) : '',
    measuredUnit: instUnit,
    instances: JSON.stringify(instRows || []),
    openings: JSON.stringify(openRows || []),
    variant: ($('calc-variant') || {}).value || '',
    labourOnly: !!(($('calc-labour-only') || {}).checked),
    units: _units
  };
}

// Restore a settings object written by readState(). Every field is
// restored so a recalled entry reproduces its sum exactly (owner
// directive: recall must re-create the settings that achieved the sum).
// E1/E4: while applying a snapshot, refreshRateFields must NOT re-prefill
// the restored rate fields (a changed FX table or book would drift the
// total away from what the estimate showed when it was saved).
let recallHold = false;
function applyState(st) {
  if (!st) return;
  if (st.units) setUnits(st.units, true);
  if (st.work) $('calc-work').value = st.work;
  // W2: restore instance rows BEFORE syncLabels (it re-renders the editor
  // and recomputes the measured sum from the rows).
  try { instRows = Array.isArray(JSON.parse(st.instances || '[]')) ? JSON.parse(st.instances) : []; } catch (e) { instRows = []; }
  // W2.7: openings rows ride the same snapshot so recall/bill lines
  // reproduce the DEDUCTED measurement exactly.
  try { openRows = Array.isArray(JSON.parse(st.openings || '[]')) ? JSON.parse(st.openings) : []; } catch (e) { openRows = []; }
  if ($('calc-measured-qty')) $('calc-measured-qty').value = st.measuredQty || '';
  syncLabels();
  // E2/E6: the variant select was (re)rendered by syncLabels - restore the
  // saved pick now that its option exists. Labour mode rides the snapshot.
  if (st.variant && $('calc-variant')) {
    const hasOpt = Array.prototype.some.call($('calc-variant').options || [], function(o) { return o.value === st.variant; });
    if (hasOpt) $('calc-variant').value = st.variant;
  }
  if ($('calc-labour-only')) $('calc-labour-only').checked = !!st.labourOnly;
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
  // E1/E4: the saved prefill markers ride the snapshot so a recalled
  // estimate keeps its model-vs-your-rate semantics (and its exact total,
  // even if the FX table or the active book changed since it was saved).
  if ($('calc-rate-mat')) $('calc-rate-mat').dataset.model = st.matModel != null ? String(st.matModel) : (($('calc-rate-mat').dataset || {}).model || '');
  if ($('calc-rate-lab')) $('calc-rate-lab').dataset.model = st.labModel != null ? String(st.labModel) : (($('calc-rate-lab').dataset || {}).model || '');
  if ($('calc-rate-eq')) $('calc-rate-eq').value = st.rateEq || '';
  if ($('calc-oh')) $('calc-oh').value = st.ohPct || '';
  if ($('calc-oncost-pct')) {
    $('calc-oncost-pct').value = st.onCostPct || '';
    const t = $('calc-oncost-toggle');
    if (t) t.checked = !!(st.onCostPct);
    $('calc-oncost-pct').disabled = !$('calc-oncost-toggle').checked;
  }
  if ($('calc-doc-type')) $('calc-doc-type').value = st.docType || 'Estimate';
  if ($('calc-doc-title')) $('calc-doc-title').value = st.docTitle || '';
  if ($('calc-client-name')) $('calc-client-name').value = st.clientName || '';
  if ($('calc-client-addr')) $('calc-client-addr').value = st.clientAddr || '';
  if ($('calc-doc-no')) $('calc-doc-no').value = st.docNo || '';
  if ($('calc-doc-date')) $('calc-doc-date').value = st.docDate || '';
  if ($('calc-doc-due')) $('calc-doc-due').value = st.docDue || '';
  if ($('calc-piece-price')) $('calc-piece-price').value = st.piecePrice || '';
  if ($('calc-piece-size')) $('calc-piece-size').value = st.pieceSize || '';
  recallHold = true;
  refreshRateFields();
  recallHold = false;
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
  // E2: the picked variant (a legacy state with no variant resolves to the
  // first, whose rates equal the pre-conversion model).
  const av = activeVariant(w, st);
  // W2 measured quantity: element rows (or the override field) feed the
  // engine directly - dim validation and q() are skipped, everything
  // downstream (waste, quality, piece pricing, rates) unchanged.
  const mqRaw = parseFloat(st.measuredQty != null && st.measuredQty !== '' ? st.measuredQty : st.measuredAuto);
  const hasMq = isFinite(mqRaw) && mqRaw > 0;
  const raw1 = num({ value: st.d1 });
  const raw2 = w.d2 ? num({ value: st.d2 }) : null;
  const raw3 = w.d3 ? num({ value: st.d3 }) : null;
  if (!hasMq && (!raw1 || (w.d2 && !raw2) || (w.d3 && !raw3))) return { error: 'Enter the dimensions the form asks for (all three when thickness or depth applies).' };
  // Imperial entry converts to the metric the formulas speak (ft to m,
  // in to mm); metric passes through untouched.
  const imp = st.units === 'imperial';
  const d1 = imp ? raw1 * FT : raw1;
  const d2 = w.d2 ? (imp ? raw2 * FT : raw2) : null;
  const d3 = w.d3 ? (imp ? raw3 * IN : raw3) : null;
  // Manual overrides carry no row-derived unit - derive the trade's canonical
  // unit from q() itself (unit math never depends on the dimension values).
  const mqUnit = st.measuredUnit || (function() { try { return w.q(1, w.d2 ? 1 : null, w.d3 ? 1 : null).unit; } catch (e) { return ''; } })();
  const qr = hasMq ? { qty: mqRaw, unit: mqUnit } : w.q(d1, d2, d3);
  // B1 (owner review 2026-09-29): waste/cuts is an editable percentage per
  // trade (tile 10, roof laps 10, concrete 5 defaults = the previously
  // baked-in factors). Empty/invalid falls back to the trade default.
  let wastePct = 0;
  if (w.waste) {
    const wr = parseFloat(st.wastePct);
    wastePct = isFinite(wr) && wr >= 0 && wr <= 50 ? wr : w.waste.def;
  }
  // W2.7 openings: the window/door space leaves the measurement before
  // waste (you don't lay block in it, and waste applies to what you lay).
  // Only wall-area trades carry the editor; floored at zero.
  const openings = w.openings ? openingsArea(st, imp) : { count: 0, area: 0 };
  const netQty = Math.max(0, qr.qty - openings.area);
  const qty = netQty * (1 + wastePct / 100);
  // W2: with a measured quantity the per-dim rate inputs do not apply;
  // fencing's height-dependent rate falls back to its 1.8 m default here -
  // an explicit rate override always wins anyway.
  const modelMr = hasMq ? (av ? av.rate.mat : matRate(w, mqRaw, null)) : (av ? av.rate.mat : matRate(w, d1, d2));
  // F4b rate freedom: an explicitly typed rate overrides the model. The
  // wrapper passes dataset.model for the live form; a recalled/comparison
  // state has no dataset, so any numeric value it carries IS its rate.
  const matRaw = parseFloat(st.rateMat);
  const labRaw = parseFloat(st.rateLab);
  const matModel = st._matModel != null ? String(st._matModel) : null;
  const labModel = st._labModel != null ? String(st._labModel) : null;
  // E1/E4 (plan v2 Phase 1): the rate FIELDS carry the money that gets
  // charged - the prefill already converted it (active book rate or model
  // rate at the estimate's exchange rate), so a present field always
  // prices and the override flag only drives the "your rate" annotation.
  // An empty field falls back to the raw WORK model (US dollars); callers
  // flag that case so the render can say so honestly instead of relabelling.
  const matPresent = isFinite(matRaw) && matRaw >= 0;
  const labPresent = isFinite(labRaw) && labRaw >= 0;
  const matOverride = matPresent && (matModel === null || String(matRaw) !== matModel);
  const labOverride = labPresent && (labModel === null || String(labRaw) !== labModel);
  const mr = matPresent ? matRaw : modelMr;
  const lr = labPresent ? labRaw : (av ? av.rate.lab : w.rate.lab);
  // B3: optional third rate (equipment / plant hire) on the same per-unit
  // basis; empty or 0 = inactive. Overhead & margin % applies to the
  // equipment-inclusive subtotal.
  const eqRaw = parseFloat(st.rateEq);
  const eqRate = isFinite(eqRaw) && eqRaw > 0 ? eqRaw : 0;
  const ohRaw = parseFloat(st.ohPct);
  const ohPct = isFinite(ohRaw) && ohRaw > 0 && ohRaw <= 60 ? ohRaw : 0;
  // W3 (owner 2026-09-30): optional employer statutory on-costs on LABOR.
  // Jamaica planning default 12.5% of gross payroll = NIS 3% (insurable
  // earnings cap J$5,000,000/yr) + NHT 3% + HEART/NSTA 3% + Education Tax
  // 3.5% (PwC Worldwide Tax Summaries; Dawgen; Skuad; HEART-NSTA, 2026).
  // Off unless explicitly enabled; capped at 25% as a typo guard. Labor
  // billed per hour here is usually a contractor price that ALREADY carries
  // these costs, so this is opt-in, never a silent default.
  const ocRaw = parseFloat(st.onCostPct);
  const onCostPct = isFinite(ocRaw) && ocRaw > 0 ? Math.min(ocRaw, 25) : 0;
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
  // E3: rates (model or typed - both follow the labeled rate basis)
  // convert from the item's rate-entry unit into the engine unit. Piece
  // pricing already prices per engine unit and never takes the factor.
  const runit = (av && av.runit) || w.runit || null;
  const rf = rateFactor(runit, qr.unit);
  // E6: labour-only mode prices the WORK - labor at its rate; material
  // money is the user's own, so a typed material rate still shows while
  // the model/piece material price is excluded.
  const labourOnly = !!st.labourOnly;
  const matExcluded = labourOnly && !matOverride;
  // Area trades: $/m2 x m2 quantity. Fencing width-div: $/run-m x m run.
  // The qty x rate dimension check holds for both.
  const effMat = matExcluded ? 0 : ((piece && !piece.countOnly && !labourOnly) ? piece.perUnit : mr * rf);
  const mat = qty * effMat * quality;
  const lab = qty * lr * rf * quality;
  const eq = qty * eqRate * rf * quality;
  const country = st.country || 'US';
  const overrideRaw = parseFloat(st.taxOverride);
  const override = isFinite(overrideRaw) && overrideRaw >= 0 ? overrideRaw : null;
  const taxRate = override !== null ? override : (TAX[country] || 0);
  const onCost = lab * onCostPct / 100;
  const sub = mat + lab + onCost + eq;
  const oh = sub * ohPct / 100;
  const tax = (sub + oh) * taxRate / 100;
  const orderCount = pieceCount(qty, qr.unit, w.piece, (st.pieceSize || '').trim());
  // Note: no `name` here - workName() reads the DOM. compute() attaches the
  // live name; the comparison table uses each saved estimate's stored name.
  return { key, qty: qty, baseQty: qr.qty, unit: qr.unit, qtyLabel: qr.qtyLabel, matDesc: w.matDesc,
    orderCount: orderCount,
    openings: openings, hasOpenings: !!w.openings,
    wastePct: wastePct, hasWaste: !!w.waste, wasteLbl: w.waste ? w.waste.lbl : null,
    mr, lr, eqRate, eq, onCost, onCostPct, ohPct, oh, effMat, modelMr, piece, mat, lab, sub, taxRate, tax, total: sub + oh + tax, overrideApplied: override !== null,
    matOverridden: matOverride, labOverridden: labOverride, currency: st.currency || 'USD',
    labourOnly: labourOnly, matExcluded: matExcluded, runit: runit, rateFactor: rf,
    variant: av ? av.id : null, variantLabel: av ? av.label : null };
}

// Live-form wrapper: snapshot the DOM into a settings object (passing the
// current model-prefill markers so override detection behaves exactly as
// before), run the pure engine, and attach the DOM-derived name.
function compute() {
  const st = readState();
  st._matModel = $('calc-rate-mat') ? $('calc-rate-mat').dataset.model : undefined;
  st._labModel = $('calc-rate-lab') ? $('calc-rate-lab').dataset.model : undefined;
  const r = computeFor(st);
  if (r && !r.error) {
    r.name = workName(st.work);
    // Owner directive 2026-10-01: the unit-slip guard rides every result.
    r.slips = dimSlips(st);
    // E1 honesty flag: model/book money is still in its source currency
    // because no FX rate is set for the picked one - the render says so in
    // USD terms instead of relabelling. Both rates typed = all the user's
    // own money = nothing to flag.
    const cur = st.currency || BASE_CURRENCY;
    if (cur !== BASE_CURRENCY && fxFactor(cur) == null &&
        ((!r.matOverridden && !r.matExcluded) || !r.labOverridden)) {
      r.modelUnconverted = true;
    }
  }
  return r;
}

// ---- Named estimates (F4-3): save / recall / delete, this device only ---
const NKEY = 'mmgr_calc_estimates';
function loadEstimates() { try { return JSON.parse(localStorage.getItem(NKEY) || '[]'); } catch (e) { return []; } }
function persistEstimates(list) { try { localStorage.setItem(NKEY, JSON.stringify(list.slice(0, 30))); } catch (e) { /* storage full - saving is a nicety, never a gate */ } wsStampNow('estimates'); scheduleWsPut(); }

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
function persistSheets(list) { try { localStorage.setItem(RKEY, JSON.stringify(list.slice(0, 20))); } catch (e) { /* nicety, never a gate */ } wsStampNow('sheets'); scheduleWsPut(); }

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

// ---- E4 (plan v2 Phase 1): RATE BOOKS v2 ---------------------------------
// A whole-book object the way the plan writes it: { id, name, source,
// effective_from, effective_to, tier, currency, rates: { workKey: {
// variantId or '*': { mat, lab, unit } } }, checksum }. Import/export as
// JSON through the same pattern as rate sheets; validation rejects
// unknown work keys and negative rates; an expired book shows a banner.
// The ACTIVE book feeds the model prefill (book rate first, WORK model
// second), so a full JIC-style schedule switches as ONE object - fixing
// audit A4 ("rate sheets are not rate books"). The official JIC sheet is
// a paid IMAJ publication: we ship STRUCTURE with no built-in rates and
// each user imports the book they bought (the licensing-safe route from
// plan section 4). The schema is identical either way.
const BKKEY = 'mmgr_calc_books';
const ACTBK = 'mmgr_calc_book_active';
function loadBooks() { try { return JSON.parse(localStorage.getItem(BKKEY) || '[]'); } catch (e) { return []; } }
function activeBookId() { try { return JSON.parse(localStorage.getItem(ACTBK) || '""') || ''; } catch (e) { return ''; } }
function activeBook() { const id = activeBookId(); return loadBooks().find(function(b) { return b && b.id === id; }) || null; }
function setActiveBook(id) { try { localStorage.setItem(ACTBK, JSON.stringify(String(id || ''))); } catch (e) { /* nicety */ } wsStampNow('books'); scheduleWsPut(); }
function persistBooks(list) { try { localStorage.setItem(BKKEY, JSON.stringify(list.slice(0, 20))); } catch (e) { /* nicety */ } wsStampNow('books'); scheduleWsPut(); }
// djb2 over the canonical rates JSON - detects any hand edit of a book.
function bookChecksum(rates) {
  let h = 5381;
  const s = JSON.stringify(rates);
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return 'c' + h.toString(36);
}
// Validate + merge an imported books payload. Unknown work keys and
// negative/absent rates are rejected and COUNTED, never thrown.
function importBooks(json) {
  if (!json || !Array.isArray(json.books)) return null;
  const existing = loadBooks();
  let merged = 0, skipped = 0, badKeys = 0;
  json.books.forEach(function(item) {
    const name = item && typeof item.name === 'string' ? item.name.trim().slice(0, 60) : '';
    const cur = item && typeof item.currency === 'string' ? item.currency.toUpperCase().slice(0, 3) : '';
    const rates = item && item.rates && typeof item.rates === 'object' && !Array.isArray(item.rates) ? item.rates : null;
    if (!name || !cur || !rates) { skipped++; return; }
    const clean = {};
    Object.keys(rates).forEach(function(k) {
      if (!WORK[k]) { badKeys++; return; }
      const vset = rates[k] && typeof rates[k] === 'object' && !Array.isArray(rates[k]) ? rates[k] : null;
      if (!vset) { skipped++; return; }
      const cv = {};
      Object.keys(vset).forEach(function(vid) {
        const r = vset[vid];
        const m = parseFloat(r && r.mat), l = parseFloat(r && r.lab);
        if (!isFinite(m) || m < 0 || !isFinite(l) || l < 0) { skipped++; return; }
        cv[vid] = { mat: m, lab: l, unit: (r && typeof r.unit === 'string') ? r.unit.slice(0, 12) : undefined };
      });
      if (Object.keys(cv).length) clean[k] = cv;
    });
    if (!Object.keys(clean).length) { skipped++; return; }
    // A book that CARRIES a checksum must match its own rates - a mismatch
    // means the file was edited after export; it is skipped, not trusted.
    if (item.checksum && item.checksum !== bookChecksum(clean)) { skipped++; return; }
    const book = { id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name, source: (item && typeof item.source === 'string') ? item.source.slice(0, 80) : '',
      effective_from: (item && typeof item.effective_from === 'string') ? item.effective_from.slice(0, 10) : '',
      effective_to: (item && typeof item.effective_to === 'string') ? item.effective_to.slice(0, 10) : '',
      tier: (item && typeof item.tier === 'string') ? item.tier.slice(0, 40) : '', currency: cur,
      rates: clean, checksum: bookChecksum(clean) };
    const at = existing.findIndex(function(x) { return (x.name || '').toLowerCase() === name.toLowerCase(); });
    if (at > -1) existing[at] = book; else existing.unshift(book);
    merged++;
  });
  if (merged) { persistBooks(existing); renderBooks(); }
  return { merged: merged, skipped: skipped, badKeys: badKeys };
}
function bookExpired(b) {
  if (!b || !b.effective_to) return false;
  const t = Date.parse(b.effective_to);
  return isFinite(t) && Date.now() > t + 86400000;
}
function renderBooks() {
  const sel = $('calc-book-select'), exp = $('calc-book-expired');
  if (!sel) return;
  const list = loadBooks();
  if (activeBookId() && !list.some(function(b) { return b.id === activeBookId(); })) setActiveBook('');
  sel.innerHTML = '<option value="">' + (list.length ? 'Rate book...' : 'Rate book (none imported)') + '</option>' +
    list.map(function(b) { return '<option value="' + esc(b.id) + '">' + esc(b.name + (b.currency ? ' (' + b.currency + ')' : '')) + '</option>'; }).join('');
  const a = activeBook();
  if (exp) {
    exp.hidden = !(a && bookExpired(a));
    if (a && bookExpired(a)) exp.textContent = 'The rate book "' + a.name + '" expired on ' + a.effective_to + ' - its rates are shown as they are. Import a newer book when you have one.';
  }
}
// E1+E4 together: the rate a fresh prefill should show for a work item,
// ALREADY in the estimate currency. Order: active book rate (workKey ->
// variantId or '*'), else the WORK model (or the active variant's rate).
// Both sources carry a currency (book.currency, or USD for the model);
// conversion goes through the FX table. When the pair is missing the
// result is flagged unconvertible - the caller leaves the fields empty
// and says so honestly (never a silent relabel).
function modelRatesFor(key, variantId, targetCode, d1m, d2m) {
  const w = WORK[key];
  if (!w) return null;
  const b = activeBook();
  let mat = null, lab = null, src = null, unit = null, fromBook = false;
  if (b && b.rates && b.rates[key]) {
    const vset = b.rates[key];
    const r = (variantId && vset[variantId]) || vset['*'] || null;
    if (r) { mat = r.mat; lab = r.lab; unit = r.unit || null; src = b.currency; fromBook = true; }
  }
  if (mat == null) {
    const av = variantFor(key, variantId);
    const rr = av ? av.rate : w.rate;
    mat = typeof rr.mat === 'function' ? rr.mat(d1m, d2m) : rr.mat;
    lab = rr.lab;
    src = BASE_CURRENCY;
    unit = (av && av.runit) || w.runit || null;
  }
  const f = fxBetween(src, targetCode || src);
  if (f == null) return { mat: mat, lab: lab, src: src, unit: unit, fromBook: fromBook, unconvertible: true };
  return { mat: mat * f, lab: lab * f, src: src, unit: unit, fromBook: fromBook, unconvertible: false };
}

// ---- W2 (owner 2026-09-30): ELEMENT INSTANCES - measure by element ------
// Instead of one generic L x W, dimension-driven trades take repeated named
// rows ("Wall 1" x2 identical, "Wall 2") - the add-a-wall pattern. Rows sum
// through the trade's OWN q() formula (same conversions as typed dims), so
// block counts, waste and piece pricing all still apply. A total-override
// field ("type the total instead") bypasses rows when the sum is known.
// ---- E2 (plan v2 Phase 1): VARIANT ENGINE --------------------------------
// One work item, many priced versions (block 6 vs 8 inch, pipe by
// diameter, scaffolding by height band): an optional variants list on a
// WORK entry, each { id, label, rate: {mat, lab}, runit? }. The form shows
// ONE selector; the active variant's rates feed the model prefill and the
// engine fallback. A legacy save (or a state with no variant) resolves to
// the FIRST variant, whose rates must equal the pre-conversion model - so
// old recalls reproduce the same total (Phase 1 exit gate). Phase 2 fills
// the real JIC variant sets from the official sheet; no invented numbers.
function activeVariant(w, st) {
  if (!w || !w.variants || !w.variants.length) return null;
  const id = st && st.variant;
  return w.variants.find(function(v) { return v && v.id === id; }) || w.variants[0];
}
function variantFor(key, variantId) {
  const w = WORK[key];
  if (!w || !w.variants || !w.variants.length) return null;
  return w.variants.find(function(v) { return v && v.id === variantId; }) || w.variants[0];
}

const INSTANCE_KINDS = {
  blockwall: 'wall', brickwall: 'wall', framing: 'wall', render: 'wall', paint: 'wall', drywall: 'wall',
  tile: 'area', siteprep: 'area', roof: 'area', 'shingle-roof': 'area', ceiling: 'area',
  slab: 'pour', footings: 'pour', 'concrete-drive': 'pour', excav: 'pour', 'floor-screed': 'pour',
  fencing: 'run', skirt: 'run', 'pipe-supply': 'run', 'pipe-drain': 'run', conduit: 'run',
  gutter: 'run', 'soffit-fascia': 'run', cabinet: 'run'
};
const INSTANCE_LABEL = { wall: 'Wall', area: 'Area', pour: 'Pour', run: 'Run' };
let instRows = [], instSum = 0, instUnit = '', instLastKey = null;

// ---- W2.7 (owner 2026-10-01): OPENINGS DEDUCTION --------------------------
// "You wouldn't lay block in the window space." Wall-area trades carry an
// openings editor - windows, doors, other voids - and each row's area leaves
// the wall measurement BEFORE waste (waste applies to what you actually
// lay). The mechanism is spread across every trade that measures the same
// wall: block, brick, framing, render, paint, drywall. Floored at zero -
// an oversized deduction can never go negative.
const OPENING_TYPES = { window: 'Window', door: 'Door', other: 'Other opening' };
let openRows = [];
// PURE: total deducted area (m2) + opening count from a state's openings
// rows. Imperial entry converts ft -> m for both edges (width/height read
// like the d1/d2 dims, not the in-based depth). Bad rows are skipped.
function openingsArea(st, imperial) {
  let rows = [];
  try { rows = JSON.parse(st.openings || '[]'); } catch (e) { rows = []; }
  if (!Array.isArray(rows)) return { count: 0, area: 0 };
  let count = 0, area = 0;
  rows.forEach(function(rw) {
    if (!rw) return;
    const n = parseFloat(rw.n);
    const wRaw = parseFloat(rw.w), hRaw = parseFloat(rw.h);
    if (!(n > 0) || !(wRaw > 0) || !(hRaw > 0)) return;
    const w = imperial ? wRaw * FT : wRaw;
    const h = imperial ? hRaw * FT : hRaw;
    count += n;
    area += n * w * h;
  });
  return { count: Math.round(count * 100) / 100, area: Math.round(area * 100) / 100 };
}

// ---- E3 companion (owner directive 2026-10-01): UNIT-SLIP GUARD ----------
// "Flag any dimension outside a plausible band for that item and ask 'did
// you mean 150 mm?'" - the classic slips are a metric thickness typed as
// metres (0.15), inches in a millimetre box (6), feet in a metre box, or
// a wildly large count. PURE: returns [{ field, msg, fix }] - empty on
// plausible input; the 45 golden cases must ALL pass with zero flags
// (zero false positives). A flag explains itself and offers a one-tap
// fix; nothing is ever changed silently.
function dimSlips(st) {
  const w = WORK[st && st.work];
  if (!w) return [];
  const imp = st && st.units === 'imperial';
  const out = [];
  const r2 = (v) => Math.round(v * 100) / 100;
  const band = function(field, label, v) {
    if (!(v > 0)) return;
    if (/count/.test(label)) {
      if (v > 300) out.push({ field: field, msg: v + ' is a lot of units - check the count.', fix: null });
      return;
    }
    if (/\(mm\)/.test(label)) {
      if (imp) { // the box speaks inches here; only absurd values flag
        if (v > 60) out.push({ field: field, msg: v + ' in is very thick - check the unit.', fix: null });
        return;
      }
      if (v < 20) {
        const guess = v < 1 ? r2(v * 1000) : Math.round(v * 25.4);
        out.push({ field: field, msg: v + ' in a millimetre box looks like ' + (v < 1 ? 'metres' : 'inches') + ' - did you mean ' + guess + ' mm?', fix: String(guess) });
      } else if (v > 2000) {
        out.push({ field: field, msg: v + ' mm is very large - did you mean ' + r2(v / 1000) + ' m?', fix: String(r2(v / 1000)) });
      }
      return;
    }
    if (/\(m2\)|\(m3\)/.test(label)) {
      if (v < 0.05) out.push({ field: field, msg: v + ' is very small - check the unit.', fix: null });
      return;
    }
    if (/Height/.test(label)) {
      if (v > (imp ? 500 : 12)) out.push({ field: field, msg: v + (imp ? ' ft' : ' m') + ' tall is unusual - check the unit.', fix: null });
      else if (v < (imp ? 0.5 : 0.4)) out.push({ field: field, msg: v + (imp ? ' ft' : ' m') + ' is very short for a height - check the unit.', fix: null });
      return;
    }
    // metre-box lengths / runs (feet boxes in imperial mode)
    if (imp) {
      if (v > 500) out.push({ field: field, msg: v + ' ft is very long - check the unit.', fix: null });
      return;
    }
    if (v > 150) out.push({ field: field, msg: v + ' m is very long - did you mean feet? (' + Math.round(v / FT) + ' ft = ' + r2(v * FT) + ' m)', fix: String(r2(v * FT)) });
    else if (v < 0.1) out.push({ field: field, msg: v + ' m is very small - did you mean millimetres? (' + Math.round(v * 1000) + ' mm = ' + r2(v / 1000) + ' m)', fix: String(r2(v / 1000)) });
  };
  band('d1', w.d1 || '', parseFloat(st.d1));
  if (w.d2) band('d2', w.d2 || '', parseFloat(st.d2));
  if (w.d3) band('d3', w.d3 || '', parseFloat(st.d3));
  return out;
}
// PURE: sum instance rows through WORK[key].q with the SAME imperial
// conversions computeFor applies (ft to m, in to mm). Bad rows are skipped,
// never thrown. n = identical-repeat count (digital timesing).
function instancesQty(rows, key) {
  const w = WORK[key];
  if (!w) return { qty: 0, unit: '' };
  const imp = _units === 'imperial';
  let qty = 0, unit = '';
  (rows || []).forEach(function(rw) {
    if (!rw) return;
    const n = Math.max(1, parseInt(rw.n, 10) || 1);
    const a = parseFloat(rw.d1), b = w.d2 ? parseFloat(rw.d2) : null, c = w.d3 ? parseFloat(rw.d3) : null;
    if (!(a > 0) || (w.d2 && !(b > 0)) || (w.d3 && !(c > 0))) return;
    const d1 = imp ? a * FT : a;
    const d2 = w.d2 ? (imp ? b * FT : b) : null;
    const d3 = w.d3 ? (imp ? c * IN : c) : null;
    const qr = w.q(d1, d2, d3);
    qty += qr.qty * n;
    unit = qr.unit;
  });
  return { qty: Math.round(qty * 100) / 100, unit: unit };
}
function renderInstances() {
  const wrap = $('calc-instances'), rowsEl = $('calc-inst-rows');
  if (!wrap || !rowsEl) return;    const key = ($('calc-work') || {}).value || '';
    const kind = INSTANCE_KINDS[key];
    const addBtn = $('calc-inst-add');
    if (!kind) {
      wrap.hidden = true;
      instRows = []; instSum = 0; instUnit = ''; instLastKey = null;
      return;
    }
  wrap.hidden = false;
  // Rows re-seed when the work item changes (stale "Wall 1" rows must not
  // leak into a slab); the manual-override mode keeps its own state.
  if (instLastKey !== key || !instRows.length) {
    instRows = [{ label: INSTANCE_LABEL[kind] + ' 1', d1: '', d2: '', d3: '', n: 1 }];
    instLastKey = key;
  }
  if (addBtn) addBtn.textContent = '+ Add ' + INSTANCE_LABEL[kind].toLowerCase();
  const w = WORK[key];
  rowsEl.innerHTML = instRows.map(function(rw, i) {
    return '<div class="bcp-inst-row">' +
      '<input type="text" class="bcp-inst-label" data-idx="' + i + '" data-field="label" value="' + esc(rw.label) + '" aria-label="Element name">' +
      '<input type="number" class="bcp-inst-dim" data-idx="' + i + '" data-field="d1" min="0" step="any" inputmode="decimal" placeholder="' + esc(dimLabel(w, 'd1')) + '" value="' + esc(rw.d1) + '">' +
      (w.d2 ? '<input type="number" class="bcp-inst-dim" data-idx="' + i + '" data-field="d2" min="0" step="any" inputmode="decimal" placeholder="' + esc(dimLabel(w, 'd2')) + '" value="' + esc(rw.d2) + '">' : '') +
      (w.d3 ? '<input type="number" class="bcp-inst-dim" data-idx="' + i + '" data-field="d3" min="0" step="any" inputmode="decimal" placeholder="' + esc(dimLabel(w, 'd3')) + '" value="' + esc(rw.d3) + '">' : '') +
      '<input type="number" class="bcp-inst-count" data-idx="' + i + '" data-field="n" min="1" step="1" inputmode="numeric" value="' + esc(String(rw.n || 1)) + '" aria-label="How many identical">' +
      '<button type="button" class="btn btn-n btn-s" data-action="calcInstDel" data-idx="' + i + '" aria-label="Remove this element">X</button>' +
    '</div>';
  }).join('');
  const s = instancesQty(instRows, key);
  instSum = s.qty; instUnit = s.unit;
  const sumEl = $('calc-inst-sum');
  if (sumEl) sumEl.textContent = instSum > 0 ? 'Measured total: ' + qtyShown(instSum, instUnit).main : '';
}

// W2.7: the openings editor - visibility follows the trade (wall-area
// trades only), rows carry type + width x height + count, and the sum line
// names the deducted area in the current unit system.
function renderOpenings() {
  const wrap = $('calc-openings'), rowsEl = $('calc-openings-rows');
  if (!wrap || !rowsEl) return;
  const key = ($('calc-work') || {}).value || '';
  const w = WORK[key];
  if (!w || !w.openings) { wrap.hidden = true; return; }
  wrap.hidden = false;
  rowsEl.innerHTML = openRows.map(function(rw, i) {
    const opts = Object.keys(OPENING_TYPES).map(function(k) {
      return '<option value="' + k + '"' + (rw.type === k ? ' selected' : '') + '>' + OPENING_TYPES[k] + '</option>';
    }).join('');
    return '<div class="bcp-inst-row bcp-open-row">' +
      '<select class="bcp-open-type" data-idx="' + i + '" data-field="type" aria-label="Opening type">' + opts + '</select>' +
      '<input type="number" class="bcp-inst-dim" data-idx="' + i + '" data-field="w" min="0" step="any" inputmode="decimal" placeholder="Width (m)" value="' + esc(String(rw.w || '')) + '" aria-label="Opening width">' +
      '<input type="number" class="bcp-inst-dim" data-idx="' + i + '" data-field="h" min="0" step="any" inputmode="decimal" placeholder="Height (m)" value="' + esc(String(rw.h || '')) + '" aria-label="Opening height">' +
      '<input type="number" class="bcp-inst-count" data-idx="' + i + '" data-field="n" min="1" step="1" inputmode="numeric" value="' + esc(String(rw.n || 1)) + '" aria-label="How many identical">' +
      '<button type="button" class="btn btn-n btn-s" data-action="calcOpenDel" data-idx="' + i + '" aria-label="Remove this opening">X</button>' +
    '</div>';
  }).join('');
  const a = openingsArea({ openings: JSON.stringify(openRows) }, _units === 'imperial');
  const sumEl = $('calc-open-sum');
  if (sumEl) sumEl.textContent = a.count > 0 ? 'Deducts ' + qtyShown(a.area, 'm2').main + ' across ' + a.count + ' opening' + (a.count === 1 ? '' : 's') : '';
}

function activeSheetName() {
  const matEl = $('calc-rate-mat'), labEl = $('calc-rate-lab');
  if (!matEl || !labEl) return null;
  if (matEl.value === '' || labEl.value === '') return null;
  if (String(parseFloat(matEl.value)) === matEl.dataset.model || String(parseFloat(labEl.value)) === labEl.dataset.model) return null;
  return matEl.dataset.sheet || null;
}

// ---- W4 (owner 2026-09-30): PRELIMINARIES - site & other costs ----------
// Indirect, project-wide costs priced on top of the works: one-time items
// (establishment, permits, insurance, demob) and running items (supervision,
// welfare, temporary utilities) as weekly x weeks. Sources: prelims typically
// 5-15% of contract value, residential 5-8% (Plexa/Procore/RIB, 2026) - the
// preset sums to 7% as guidance; every value is user-editable. Device-local.
const PKEY = 'mmgr_calc_prelims';
let prelimItems = [];
function loadPrelims() { try { return JSON.parse(localStorage.getItem(PKEY) || '[]'); } catch (e) { return []; } }
function persistPrelims(list) { try { localStorage.setItem(PKEY, JSON.stringify(list.slice(0, 30))); } catch (e) { /* nicety, never a gate */ } }
// PURE: item amounts by basis. fixed = the amount; pct = % of works; week =
// weekly rate x weeks. Negative inputs clamp to 0; bad numbers are 0.
function prelimsTotal(items, works) {
  const perItem = [];
  let total = 0;
  (items || []).forEach(function(it) {
    const v = parseFloat(it.value);
    let amt = 0;
    if (it.basis === 'fixed' && isFinite(v)) amt = v;
    else if (it.basis === 'pct' && isFinite(v)) amt = (works > 0 ? works * v / 100 : 0);
    else if (it.basis === 'week' && isFinite(v)) {
      const wks = parseFloat(it.weeks);
      amt = v * (isFinite(wks) && wks > 0 ? wks : 0);
    }
    if (!(amt > 0)) amt = 0;
    total += amt;
    perItem.push({ name: it.name, amount: Math.round(amt * 100) / 100 });
  });
  return { perItem: perItem, total: Math.round(total * 100) / 100 };
}
// Typical residential set (guidance, 5-8% research band): all pct-of-works
// so the set scales with the job; customize freely.
const PRELIM_PRESET_RES = [
  { name: 'Site establishment & facilities', basis: 'pct', value: '2', weeks: '' },
  { name: 'Permits & approvals', basis: 'pct', value: '1', weeks: '' },
  { name: 'Insurance & bonds', basis: 'pct', value: '1', weeks: '' },
  { name: 'Site supervision', basis: 'pct', value: '1.5', weeks: '' },
  { name: 'Temporary utilities & welfare', basis: 'pct', value: '1', weeks: '' },
  { name: 'Demobilization & clean', basis: 'pct', value: '0.5', weeks: '' }
];
function prelimWorks(worksOverride) {
  if (typeof worksOverride === 'number') return worksOverride;
  const lines = loadBoq();
  if (lines.length) return boqTotals(lines).sub;
  const r = computeFor(readState());
  return r && !r.error ? r.sub : 0;
}
function renderPrelims(worksOverride) {
  const wrap = $('calc-prelims-body'), totalEl = $('calc-prelims-total');
  if (!wrap) return;
  const works = prelimWorks(worksOverride);
  const t = prelimsTotal(prelimItems, works);
  const cur = works > 0 ? (CURRENCY[lastResult && lastResult.currency] || '$') : '$';
  if (totalEl) totalEl.textContent = prelimItems.length
    ? 'On top of the works (' + cur + Math.round(works).toLocaleString() + '): ' + cur + Math.round(t.total).toLocaleString()
    : '';
  wrap.innerHTML = prelimItems.length
    ? prelimItems.map(function(it, i) {
        const amt = t.perItem[i] ? t.perItem[i].amount : 0;
        return '<div class="bcp-prelim-row">' +
          '<input type="text" data-idx="' + i + '" data-field="name" value="' + esc(it.name) + '" aria-label="Item name">' +
          '<select data-idx="' + i + '" data-field="basis" aria-label="How this item is charged">' +
            '<option value="fixed"' + (it.basis === 'fixed' ? ' selected' : '') + '>Fixed amount</option>' +
            '<option value="pct"' + (it.basis === 'pct' ? ' selected' : '') + '>% of works</option>' +
            '<option value="week"' + (it.basis === 'week' ? ' selected' : '') + '>Weekly</option>' +
          '</select>' +
          '<input type="number" data-idx="' + i + '" data-field="value" min="0" step="any" inputmode="decimal" placeholder="' + (it.basis === 'pct' ? '%' : 'amount') + '" value="' + esc(it.value) + '" aria-label="Value">' +
          '<input type="number" data-idx="' + i + '" data-field="weeks" min="0" step="1" inputmode="numeric" placeholder="weeks" value="' + esc(it.weeks || '') + '"' + (it.basis === 'week' ? '' : ' hidden') + ' aria-label="Weeks">' +
          '<span class="bcp-prelim-amt">' + (CURRENCY[lastResult && lastResult.currency] || '$') + Math.round(amt).toLocaleString() + '</span>' +
          '<button type="button" class="btn btn-n btn-s" data-action="calcPrelimRemove" data-idx="' + i + '" aria-label="Remove this item">X</button>' +
        '</div>';
      }).join('')
    : '<div class="calc-empty">No site & other costs yet. Add the items that keep the site running.</div>';
}

// ---- W7 (owner 2026-09-30): CONCRETE ACCESSORIES - formwork + rebar laps --
// Formwork is DERIVED, not estimated: for the trades this calculator prices,
// the contact area comes straight from dimensions already entered - slab and
// driveway edge formwork 2(L+W) x thickness, footing side formwork 2(L+W) x
// depth (metric dims; for a measured pour the average dims are unknown, so
// derivation needs typed dims). Rate default 55/m2 is a planning-grade
// supply-and-fix figure (editable like every rate). The rebar laps add-on
// exposes the laps/cuts/offcuts allowance explicitly (research band 10-18%);
// empty keeps the 85 kg/m3 norm as the all-in figure it has always been.
const FORM_RATE_DEFAULT = 55;
function formworkM2(key, d1, d2, d3) {
  if (key !== 'slab' && key !== 'concrete-drive' && key !== 'footings') return null;
  const a = parseFloat(d1), b = parseFloat(d2), c = parseFloat(d3);
  if (!(a > 0) || !(b > 0) || !(c > 0)) return null;
  const perimeter = 2 * (a + b);
  const height = c / 1000;   // thickness/depth is always typed in mm
  return Math.round(perimeter * height * 100) / 100;
}
function renderAccessories() {
  const box = $('calc-formwork-box');
  if (!box) return;
  const st = readState();
  const m2 = formworkM2(st.work, st.d1, st.d2, st.d3);
  if (m2) {
    const cur = CURRENCY[st.currency] || '$';
    const rateRaw = parseFloat(($('calc-formwork-rate') || {}).value);
    const rate = isFinite(rateRaw) && rateRaw > 0 ? rateRaw : FORM_RATE_DEFAULT;
    box.hidden = false;
    // Write into the text span only - the box also holds the rate input
    // and the Add button, which a textContent wipe would destroy.
    const txt = $('calc-formwork-text');
    const msg = 'Derived formwork for this ' + (st.work === 'footings' ? 'footing run' : 'slab') + ': ' +
      m2.toLocaleString() + ' m2 - about ' + cur + Math.round(m2 * rate).toLocaleString() + ' at ' + cur + rate + '/m2 (editable).';
    if (txt) txt.textContent = msg; else box.textContent = msg;
  } else {
    box.hidden = true;
  }
}

// ---- W8 (owner 2026-09-30): LOCATION DATA PACKS (offline) ---------------
// The on-device answer to a server-side rate book: a named pack carries the
// currency, the standard tax default, an optional material-rate index, and a
// whole-house benchmark note. Seeds: US baseline, Jamaica (GCT 15%, PwC),
// UK (VAT 20%). Index stays 1.0 on seeds - the JM benchmark research diverged
// too widely (US$65-121/ft2) to bake a multiplier; users/import set their own.
// Applying: currency + tax default + (index != 1) scales the material rate
// (locality adjustment = your rate; labor stays user-owned). JSON in/out
// like rate sheets. Device-local, 20 cap.
const PKKEY = 'mmgr_calc_locpacks';
const PACK_SEEDS = [
  { id: 'pack-us', name: 'United States (baseline)', currency: 'USD', taxDefault: 0, index: 1, benchmark: 'Baseline - rates as entered. US averages vary widely by state; sanity-check your bill by area x local benchmark.' },
  { id: 'pack-jm', name: 'Jamaica', currency: 'JMD', taxDefault: 15, index: 1, benchmark: 'GCT 15% on the works (PwC). Planning guidance: standard-spec residential builds have recently ranged roughly US$65-121 per sq ft - check your bill total against floor area x benchmark.' },
  { id: 'pack-gb', name: 'United Kingdom', currency: 'GBP', taxDefault: 20, index: 1, benchmark: 'VAT 20% applies on the works (PwC). Rates as entered.' }
];
function loadPacks() { try { return JSON.parse(localStorage.getItem(PKKEY) || '[]'); } catch (e) { return []; } }
function persistPacks(list) { try { localStorage.setItem(PKKEY, JSON.stringify(list.slice(0, 20))); } catch (e) { /* nicety */ } wsStampNow('packs'); scheduleWsPut(); }
function ensurePackSeeds() { if (!loadPacks().length) persistPacks(PACK_SEEDS.slice()); }
function renderPacks() {
  const sel = $('calc-pack-select'), note = $('calc-pack-note');
  if (!sel) return;
  const list = loadPacks();
  sel.innerHTML = '<option value="">Location pack' + (list.length ? '...' : ' (none yet)') + '</option>' +
    list.map(function(p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>'; }).join('');
  if (note && note.dataset.forId) {
    const p = list.find(function(x) { return x.id === note.dataset.forId; });
    note.hidden = !p;
    if (p) note.textContent = p.benchmark || '';
  }
}
function applyPackById(id) {
  const p = loadPacks().find(function(x) { return x.id === id; });
  if (!p) return;
  if ($('calc-currency') && p.currency) $('calc-currency').value = p.currency;
  if ($('calc-tax-override') && p.taxDefault != null && p.taxDefault !== '') $('calc-tax-override').value = String(p.taxDefault);
  const mat = $('calc-rate-mat');
  if (p.index && p.index !== 1 && mat && mat.value) {
    const v = parseFloat(mat.value);
    if (isFinite(v)) mat.value = String(Math.round(v * p.index * 100) / 100);
  }
  const note = $('calc-pack-note');
  if (note) { note.dataset.forId = p.id; note.hidden = !(p.benchmark); note.textContent = p.benchmark || ''; }
  render();
}
// Export every pack as JSON; import merges by name (invalid entries skipped).
function importPacks(json) {
  if (!json || !Array.isArray(json.packs)) return null;
  const existing = loadPacks();
  let merged = 0, skipped = 0;
  json.packs.forEach(function(item) {
    const name = item && typeof item.name === 'string' ? item.name.trim().slice(0, 40) : '';
    const idx = parseFloat(item && item.index); const td = parseFloat(item && item.taxDefault);
    if (!name || !item.currency) { skipped++; return; }
    const pack = { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name, currency: String(item.currency).toUpperCase().slice(0, 3),
      taxDefault: isFinite(td) && td >= 0 ? td : 0,
      index: isFinite(idx) && idx > 0 ? idx : 1,
      benchmark: typeof item.benchmark === 'string' ? item.benchmark.slice(0, 300) : '' };
    const at = existing.findIndex(function(x) { return (x.name || '').toLowerCase() === name.toLowerCase(); });
    if (at > -1) existing[at] = pack; else existing.unshift(pack);
    merged++;
  });
  if (merged) { persistPacks(existing); renderPacks(); }
  return { merged: merged, skipped: skipped };
}

// ---- W5 (owner 2026-09-30): CONTINGENCY + ESCALATION + DURATION ---------
// The planning waterfall: works -> site & other costs -> design contingency
// -> construction contingency -> escalation over the build duration.
// Defaults from the research: design contingency 10%, construction 5%
// (AACE contingency guidance), escalation 5%/yr (2026 consensus 4-6%).
// Device-level settings (not per-estimate). Works basis is the priced bill
// subtotal (pre-tax); tax is added at invoice where applicable.
const RKEY2 = 'mmgr_calc_rollup';
function loadRollupPrefs() { try { return JSON.parse(localStorage.getItem(RKEY2) || '{}'); } catch (e) { return {}; } }
function persistRollupPrefs(p) { try { localStorage.setItem(RKEY2, JSON.stringify(p)); } catch (e) { /* nicety */ } wsStampNow('rollup'); scheduleWsPut(); }
// ---- W1 (owner 2026-10-01): DISCOUNT on the roll-up ---------------------
// A percent-off or fixed-amount-off line between the priced work and the
// risk money. PURE: fixed wins when both are set; the discount never
// exceeds works+prelims and never goes below zero; contingencies and
// escalation land on the DISCOUNTED base (discount before risk money).
function applyDiscount(works, prelims, discPct, discAmt) {
  const w = Math.max(0, parseFloat(works) || 0);
  const p = Math.max(0, parseFloat(prelims) || 0);
  const pool = w + p;
  const pct = Math.max(0, parseFloat(discPct) || 0);
  const amt = Math.max(0, parseFloat(discAmt) || 0);
  const discount = Math.min(pool, amt > 0 ? amt : pool * pct / 100);
  return { works: w, prelims: p, discount: discount, base: pool - discount };
}
// PURE: the waterfall math. Contingencies are % of the discounted base
// (works + prelims - discount); escalation is simple %/yr over months/12
// on the same base. No DOM.
function rollup(o) {
  const works = Math.max(0, parseFloat(o.works) || 0);
  const prelims = Math.max(0, parseFloat(o.prelims) || 0);
  const d = applyDiscount(works, prelims, o.discPct, o.discAmt);
  const base = d.base;
  const designC = base * (Math.max(0, parseFloat(o.designC) || 0)) / 100;
  const constrC = base * (Math.max(0, parseFloat(o.constrC) || 0)) / 100;
  const escPct = Math.max(0, parseFloat(o.escPct) || 0);
  const months = Math.max(0, parseFloat(o.months) || 0);
  const esc = base * (escPct / 100) * (months / 12);
  const subtotal = base + designC + constrC + esc;
  return { works: works, prelims: prelims, discount: d.discount, base: base,
    designC: designC, constrC: constrC, escPct: escPct, months: months,
    esc: esc, subtotal: subtotal };
}
function rollupPrefs() {
  const p = loadRollupPrefs();
  return {
    designC: ($('calc-design-c') || {}).value != null && $('calc-design-c') ? $('calc-design-c').value : (p.designC != null ? p.designC : '10'),
    constrC: $('calc-constr-c') ? $('calc-constr-c').value : (p.constrC != null ? p.constrC : '5'),
    escPct: $('calc-esc-pct') ? $('calc-esc-pct').value : (p.escPct != null ? p.escPct : '5'),
    months: $('calc-months') ? $('calc-months').value : (p.months != null ? p.months : ''),
    discPct: $('calc-disc-pct') ? $('calc-disc-pct').value : (p.discPct != null ? p.discPct : ''),
    discAmt: $('calc-disc-amt') ? $('calc-disc-amt').value : (p.discAmt != null ? p.discAmt : '')
  };
}
function renderRollup() {
  const body = $('calc-rollup-body');
  if (!body) return;
  const works = prelimWorks();
  if (!(works > 0)) { body.innerHTML = ''; return; }
  const pref = rollupPrefs();
  const r = rollup({ works: works, prelims: prelimsTotal(prelimItems, works).total,
    designC: pref.designC, constrC: pref.constrC, escPct: pref.escPct, months: pref.months,
    discPct: pref.discPct, discAmt: pref.discAmt });
  const cur = CURRENCY[lastResult && lastResult.currency] || '$';
  const line = function(label, val) {
    return '<div class="calc-line"><span>' + label + '</span><strong>' + cur + Math.round(val).toLocaleString() + '</strong></div>';
  };
  body.innerHTML =
    line('Works (the priced bill)', r.works) +
    line('Site &amp; other costs', r.prelims) +
    (r.discount > 0 ? line('Discount' +
      ((parseFloat(pref.discPct) || 0) > 0 && !(parseFloat(pref.discAmt) > 0) ? ' (' + pref.discPct + '% off)' : '') +
      ((parseFloat(pref.discAmt) > 0) ? ' (amount off)' : ''), -r.discount) : '') +
    line('Design contingency (' + (parseFloat(pref.designC) || 0) + '%)', r.designC) +
    line('Construction contingency (' + (parseFloat(pref.constrC) || 0) + '%)', r.constrC) +
    (r.esc > 0 ? line('Escalation (' + r.escPct + '%/yr over ' + r.months + ' months)', r.esc) : '') +
    '<div class="calc-line calc-line-total"><span>Planning subtotal (before tax)</span><strong>' + cur + Math.round(r.subtotal).toLocaleString() + '</strong></div>';
}

// ---- W6 (owner 2026-09-30): CASH FLOW - monthly curve + CSV -------------
// Distributes the planning subtotal over the build duration: straight-line
// (equal months) or S-curve (normal distribution, low start/end, heavy
// middle - the standard construction spend shape; AICRE method). Retention
// and progress billing are out of scope; this is the owner's own cash plan.
function cashCurve(total, months, mode, steep) {
  const m = Math.max(1, Math.min(120, Math.round(parseFloat(months) || 0)));
  const T = Math.max(0, parseFloat(total) || 0);
  const per = [];
  if (mode === 'scurve') {
    const sigma = m / (isFinite(parseFloat(steep)) && parseFloat(steep) > 0 ? parseFloat(steep) : 3.2);
    const mid = (m - 1) / 2;
    const bell = [];
    let sum = 0;
    for (let i = 0; i < m; i++) {
      const w = Math.exp(-Math.pow(i - mid, 2) / (2 * sigma * sigma));
      bell.push(w); sum += w;
    }
    for (let i = 0; i < m; i++) per.push(T * bell[i] / sum);
  } else {
    for (let i = 0; i < m; i++) per.push(T / m);
  }
  const cum = [];
  let run = 0;
  for (let i = 0; i < m; i++) { run += per[i]; cum.push(run); }
  return { per: per, cum: cum };
}
function renderCash() {
  const body = $('calc-cash-body');
  if (!body) return;
  const months = parseInt(($('calc-months') || {}).value, 10);
  const mode = ($('calc-cash-mode') || {}).value || 'scurve';
  if (!(months > 0)) {
    body.innerHTML = '<div class="calc-empty">Set the build duration above to see the monthly cash plan.</div>';
    return;
  }
  const works = prelimWorks();
  const pref = rollupPrefs();
  const r = rollup({ works: works, prelims: prelimsTotal(prelimItems, works).total,
    designC: pref.designC, constrC: pref.constrC, escPct: pref.escPct, months: months,
    discPct: pref.discPct, discAmt: pref.discAmt });
  const c = cashCurve(r.subtotal, months, mode, '3.2');
  const cur = CURRENCY[lastResult && lastResult.currency] || '$';
  let rows = '';
  for (let i = 0; i < c.per.length; i++) {
    rows += '<div class="calc-line"><span>Month ' + (i + 1) + '</span><strong>' + cur + Math.round(c.per[i]).toLocaleString() +
      ' <span class="bcp-hist-note">(cum ' + cur + Math.round(c.cum[i]).toLocaleString() + ')</span></strong></div>';
  }
  body.innerHTML = rows;
}

// ---- W1 (owner 2026-09-30): BILL OF QUANTITIES roll-up ------------------
// A named bill collects lines; each line is a full readState() snapshot
// priced by the SAME pure engine as the live form (one math path, zero
// drift - the D2 rule). Lines keep exact-recall: recalling re-fills the
// whole form from the line's stored state. Device-local storage, one bill
// (the working bill) with up to 60 lines.
const BKEY2 = 'mmgr_calc_boq';
function workLabel(key) {
  const sel = $('calc-work');
  if (sel) {
    const opt = Array.prototype.slice.call(sel.options || []).find(function(o) { return o.value === key; });
    if (opt) return opt.textContent.trim();
  }
  return key;
}
function loadBoq() { try { return JSON.parse(localStorage.getItem(BKEY2) || '[]'); } catch (e) { return []; } }
function persistBoq(lines) { try { localStorage.setItem(BKEY2, JSON.stringify(lines.slice(0, 60))); } catch (e) { /* nicety, never a gate */ } wsStampNow('boq'); scheduleWsPut(); }
// PURE: per-line priced rows + rolled-up totals. No DOM. Shared by render,
// the cash-flow wave and the CSV export.
function boqTotals(lines) {
  const perLine = [];
  let mat = 0, lab = 0;
  (lines || []).forEach(function(line) {
    const r = computeFor(line.st || {});
    if (!r || r.error) return;
    mat += r.mat; lab += r.lab;
    perLine.push({ name: line.name || workLabel(r.key), qty: qtyShown(r.qty, r.unit).main,
      unit: r.unit, mat: r.mat, lab: r.lab, total: r.total, currency: r.currency });
  });
  return { perLine: perLine, mat: mat, lab: lab, sub: mat + lab };
}
function renderBoq() {
  const wrap = $('calc-boq-body'), card = $('calc-boq-card'), total = $('calc-boq-total');
  if (!wrap) return;
  const lines = loadBoq();
  if (card) card.hidden = lines.length === 0 && !$('calc-boq-open');
  const t = boqTotals(lines);
  if (total) total.textContent = lines.length ? 'Bill total: ' + (CURRENCY[t.perLine[0].currency] || '$') + Math.round(t.sub).toLocaleString() + ' across ' + lines.length + ' line' + (lines.length === 1 ? '' : 's') : '';
  wrap.innerHTML = lines.length
    ? lines.map(function(line, i) {
        const r = computeFor(line.st || {});
        const money = r && !r.error ? (CURRENCY[r.currency] || '$') + Math.round(r.total).toLocaleString() : 'check settings';
        const qty = r && !r.error ? qtyShown(r.qty, r.unit).main : '';
        return '<div class="bcp-est-row bcp-boq-line">' +
          '<span class="bcp-est-name">' + esc(line.name || workLabel((line.st || {}).work)) + '</span>' +
          '<span class="bcp-est-meta">' + esc(qty + ' - ' + money) + '</span>' +
          '<button type="button" class="btn btn-n btn-s" data-action="calcBoqRecall" data-idx="' + i + '">Edit</button>' +
          '<button type="button" class="btn btn-n btn-s" data-action="calcBoqRemove" data-idx="' + i + '" aria-label="Remove this line from the bill">X</button>' +
        '</div>';
      }).join('')
    : '<div class="calc-empty">No lines yet. Price something above, then Add to bill.</div>';
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
    ['Openings deducted', r.hasOpenings && r.openings && r.openings.count ? r.openings.count + ' (' + r.openings.area + ' m2)' : 'none'],
    ['Order quantity', r.orderCount ? r.orderCount.n.toLocaleString() + ' ' + r.orderCount.lbl + ' at ' + r.orderCount.sizeTxt : ''],
    ['Rate basis', r.matDesc],
    ['Variant', r.variantLabel || ''],
    ['Rate unit', r.runit ? 'per ' + r.runit : ''],
    ['Exchange rate', (function() {
      const c = r.currency || BASE_CURRENCY;
      if (c === BASE_CURRENCY) return 'base currency';
      const f = fxFactor(c);
      return f != null ? f + ' ' + c + ' per USD as of ' + ((loadFx()[c] || {}).asOf || '?') : 'not set - model rates are US dollars';
    })()],
    ['Finish level', ($('calc-quality') || {}).value || 'standard'],
    ['Currency', r.currency],
    ['Country', ($('calc-country') || {}).value || ''],
    ['Units entered', _units],
    ['Material rate used', r.piece ? (Math.round(r.effMat * 100) / 100) + ' per m2 (from piece pricing)' : Math.round(r.mr)],
    ['Labor rate used', Math.round(r.lr)],
    ['Labor statutory costs %', r.onCostPct > 0 ? r.onCostPct : 'none'],
    ['Equipment rate used', r.eqRate > 0 ? r.eqRate : 'none'],
    ['Overhead & margin %', r.ohPct > 0 ? r.ohPct : 'none'],
    ['Piece pricing', r.piece && !r.piece.countOnly ? (r.piece.div === 'volume'
        ? r.piece.price + ' per ' + r.piece.w + ' L yield (per ' + (Math.round(r.piece.perUnit * 100) / 100) + '/' + r.piece.qtyUnit + ')'
        : r.piece.price + ' per ' + Math.round(r.piece.w) + ' x ' + Math.round(r.piece.l) + ' ' + r.piece.unit + (r.piece.div === 'width' ? ' (per ' + (Math.round(r.piece.perUnit * 100) / 100) + '/m)' : ' (per ' + (Math.round(r.piece.perUnit * 100) / 100) + '/m2)')) : 'no'],
    ['Materials', r.matExcluded ? 'excluded (labour only)' : Math.round(r.mat)],
    ['Labor', Math.round(r.lab)],
    ['Subtotal', Math.round(r.sub)],
    ['Overhead', Math.round(r.oh)],
    ['Tax rate %', r.taxRate],
    ['Tax', Math.round(r.tax)],
    ['Estimated total', Math.round(r.total)],
    [],
    ['Discount % / amount', (rollupPrefs().discPct || '0') + ' / ' + (rollupPrefs().discAmt || '0')],
    ['Roll-up (bill + site costs, less discount)', Math.round(rollup({ works: prelimWorks(), prelims: prelimsTotal(prelimItems, prelimWorks()).total, designC: '0', constrC: '0', escPct: '0', months: '0', discPct: rollupPrefs().discPct, discAmt: rollupPrefs().discAmt }).subtotal)],
    [],
    ['Business', bizName()],
    ['Contact', (function() { const b = brandLoad(); return [b.phone, b.email, b.addr, b.trn ? 'TRN ' + b.trn : ''].filter(Boolean).join(' - '); })()],
    ['Client / bill to', (($('calc-client-name') || {}).value || '')],
    ['Project address', (($('calc-client-addr') || {}).value || '')],
    ['Document no', (($('calc-doc-no') || {}).value || '')],
    ['Document date', (($('calc-doc-date') || {}).value || '')],
    ['Due date', (($('calc-doc-due') || {}).value || '')],
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
// ---- W4 2026-10-01: ENTITLEMENT SEAM -------------------------------------
// The calculator's optional cloud features are gated behind a plan check so
// paid tiers can switch them off later WITHOUT touching feature code. Today
// every known feature is free: the plan source is the workspace probe
// response only (W5), 'free' until one arrives, and feature code reads
// Entitlements.can() - never the plan directly.
const CALC_FEATURES = { cloudFollow: true, logoSync: true };
const Entitlements = {
  _plan: 'free',
  setPlan: function(p) { this._plan = typeof p === 'string' && p ? p : 'free'; },
  plan: function() { return this._plan; },
  can: function(feature) { return !!(CALC_FEATURES[feature]); }
};
window.__calcEntitlements = Entitlements; // harness-only convenience

// ---- W5 2026-10-01: WORKSPACE FOLLOWS THE ACCOUNT -------------------------
// Optional background sync for signed-in accounts: after first render a
// silent GET /api/calc/workspace probes the account's stored workspace,
// merges per-section by updatedAt stamps (newer wins, corrupt skipped), and
// every later persist schedules a debounced PUT. Signed-out (403) never
// retries this session; every failure is silent. Zero required network -
// the calculator stays fully offline-first.
const WSTAMPS_KEY = 'mmgr_calc_wstamps';
const WS_DEBOUNCE_MS = 2000;
let wsPutTimer = null, wsPutNoLogo = false, wsSignedOut = false, wsInFlight = false, wsMerging = false;
function wsStampsLoad() { try { const v = JSON.parse(localStorage.getItem(WSTAMPS_KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } }
function wsStampNow(section) {
  const s = wsStampsLoad(); s[section] = Date.now();
  try { localStorage.setItem(WSTAMPS_KEY, JSON.stringify(s)); } catch (e) { /* nicety */ }
  return s[section];
}
// Every persist path calls this (after its localStorage write) so a signed-in
// device pushes its workspace without any user action.
function scheduleWsPut() {
  if (wsSignedOut || wsMerging) return;
  if (wsPutTimer) clearTimeout(wsPutTimer);
  wsPutTimer = setTimeout(wsPut, WS_DEBOUNCE_MS);
}
// Pure-ish collector: the seven synced sections with their stamps.
function wsCollect() {
  const stamps = wsStampsLoad();
  const sec = function(section, val) { return { val: val, updatedAt: stamps[section] || 0 }; };
  return {
    estimates: sec('estimates', loadEstimates()),
    boq: sec('boq', loadBoq()),
    history: sec('history', loadHistory()),
    packs: sec('packs', loadPacks()),
    rollup: sec('rollup', loadRollupPrefs()),
    brand: sec('brand', brandLoad()),
    sheets: sec('sheets', loadSheets()),
    docCounter: sec('docCounter', docCounterLoad()),
    fx: sec('fx', loadFx()),
    books: sec('books', { list: loadBooks(), active: activeBookId() })
  };
}
// PURE merge decision: newer stamp wins; empty local adopts cloud; equal
// stamps keep local; corrupt (non-object) cloud sections are skipped.
function wsMerge(localStamp, cloudStamp, localVal, cloudVal) {
  if (!cloudVal || typeof cloudVal !== 'object') return localVal;
  if (localVal === null || localVal === undefined || (typeof localVal === 'object' && !Array.isArray(localVal) && Object.keys(localVal).length === 0) || (Array.isArray(localVal) && localVal.length === 0)) return cloudVal;
  return (cloudStamp || 0) > (localStamp || 0) ? cloudVal : localVal;
}
// Pure application of a probe payload: sets the plan, merges each section
// into localStorage, returns what happened (no network, no rendering).
function wsApplyProbe(data) {
  if (!data || typeof data !== 'object') return { ok: false };
  Entitlements.setPlan(data.plan);
  const ws = data.ws;
  if (!ws || typeof ws !== 'object') return { ok: true, merged: [] };
  const stamps = wsStampsLoad();
  const merged = [];
  // Applying a cloud section routes through the persist helpers, which stamp
  // + schedule a push of their own - suppressed here so adopting cloud data
  // never immediately bounces back to the server.
  wsMerging = true;
  const sections = [
    ['estimates', ws.estimates, function(v) { persistEstimates(v); }],
    ['boq', ws.boq, function(v) { persistBoq(v); renderBoq(); }],
    ['history', ws.history, function(v) { try { localStorage.setItem(HKEY, JSON.stringify((v || []).slice(0, 20))); } catch (e) {} renderHistory(); }],
    ['packs', ws.packs, function(v) { persistPacks(v); renderPacks(); }],
    ['rollup', ws.rollup, function(v) { persistRollupPrefs(v); renderRollup(); }],
    ['brand', ws.brand, function(v) { try { localStorage.setItem(BRKEY, JSON.stringify(v)); } catch (e) {} renderBrand(); }],
    ['sheets', ws.sheets, function(v) { persistSheets(v); renderSheets(); }],
    ['docCounter', ws.docCounter, function(v) { try { localStorage.setItem(DOCNO_KEY, JSON.stringify(v)); } catch (e) {} }],
    ['fx', ws.fx, function(v) { try { localStorage.setItem(FXKEY, JSON.stringify(v && typeof v === 'object' && !Array.isArray(v) ? v : {})); } catch (e) {} renderFx(); }],
    ['books', ws.books, function(v) {
      const o = v && typeof v === 'object' ? v : {};
      try { localStorage.setItem(BKKEY, JSON.stringify(Array.isArray(o.list) ? o.list : [])); } catch (e) {}
      try { localStorage.setItem(ACTBK, JSON.stringify(typeof o.active === 'string' ? o.active : '')); } catch (e) {}
      renderBooks();
    }]
  ];
  try {
    sections.forEach(function(pair) {
      const name = pair[0], cloud = pair[1], apply = pair[2];
      if (!cloud || typeof cloud !== 'object' || !cloud.val) return; // corrupt/absent cloud section: skip
      const localVal = (function() { try { return JSON.parse(localStorage.getItem(wsKeys()[name]) || 'null'); } catch (e) { return null; } })();
      const nextVal = wsMerge(stamps[name] || 0, cloud.updatedAt || 0, localVal, cloud.val);
      if (nextVal !== localVal) {
        try { apply(nextVal); } catch (e) { return; }
        stamps[name] = cloud.updatedAt || Date.now();
        merged.push(name);
      }
    });
  } finally { wsMerging = false; }
  try { localStorage.setItem(WSTAMPS_KEY, JSON.stringify(stamps)); } catch (e) {}
  return { ok: true, merged: merged, plan: Entitlements.plan() };
}
// Key map is LAZY: HKEY/BRKEY/DOCNO_KEY are declared later in this module
// and a module-eval-time const would die in the TDZ (took the whole page
// down once already - do not hoist this back).
let WS_KEYS = null;
function wsKeys() {
  if (!WS_KEYS) WS_KEYS = { estimates: NKEY, boq: BKEY2, history: HKEY, packs: PKKEY, rollup: RKEY2, brand: BRKEY, sheets: RKEY, docCounter: DOCNO_KEY, fx: FXKEY, books: BKKEY };
  return WS_KEYS;
}
function wsPayload(withLogo) {
  const c = wsCollect();
  if (!withLogo && c.brand && c.brand.val && c.brand.val.logo) { c.brand.val = Object.assign({}, c.brand.val, { logo: null }); }
  return c;
}
async function wsPut() {
  if (wsSignedOut || wsInFlight || !navigator.onLine) return;
  wsInFlight = true;
  try {
    let res = await fetch('/api/calc/workspace', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(wsPayload(!wsPutNoLogo)) });
    if (res.status === 413 && !wsPutNoLogo) { wsPutNoLogo = true; res = await fetch('/api/calc/workspace', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(wsPayload(false)) }); }
    if (res.status === 403) wsSignedOut = true;
  } catch (e) { /* offline / network down - silent, offline-first */ }
  wsInFlight = false;
}
async function wsProbe() {
  if (wsSignedOut || wsInFlight || !navigator.onLine) return;
  wsInFlight = true;
  try {
    const res = await fetch('/api/calc/workspace', { method: 'GET', credentials: 'same-origin' });
    if (res.status === 403) { wsSignedOut = true; }
    else if (res.ok) {
      const data = await res.json();
      const out = wsApplyProbe(data);
      if (out.ok && out.merged && out.merged.length) render();
    }
  } catch (e) { /* offline - silent */ }
  wsInFlight = false;
}
// W1 engine hook (harness-only convenience; harmless in production).
window.__calcEngine = { computeFor: computeFor, boqTotals: boqTotals, readState: readState, syncLabels: syncLabels, instancesQty: instancesQty, estimateCsv: estimateCsv, prelimsTotal: prelimsTotal, rollup: rollup, cashCurve: cashCurve, formworkM2: formworkM2, importPacks: importPacks, applyDiscount: applyDiscount, companionsFor: companionsFor, syncFamily: syncFamily, brandLoad: brandLoad, logoFitsCap: logoFitsCap, docNoSuggest: docNoSuggest, wsCollect: wsCollect, wsMerge: wsMerge, wsApplyProbe: wsApplyProbe, scheduleWsPut: scheduleWsPut, rateFactor: rateFactor, dimSlips: dimSlips, activeVariant: activeVariant, variantFor: variantFor, fxFactor: fxFactor, fxBetween: fxBetween, modelRatesFor: modelRatesFor, importBooks: importBooks, setActiveBook: setActiveBook, activeBook: activeBook, loadFx: loadFx, renderFx: renderFx, renderBooks: renderBooks };

document.addEventListener('change', function(e) {
  if (e.target && e.target.id === 'calc-doc-type') render();
  if (e.target && e.target.id === 'calc-family') onFamilyChange(e.target.value);
  // E2: picking a version re-prefills the model rates for it.
  if (e.target && e.target.id === 'calc-variant') { refreshRateFields(); render(); }
  // E6: labour-only mode re-prices live.
  if (e.target && e.target.id === 'calc-labour-only') render();
});document.addEventListener('input', function(e) {
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
  let name = opt ? opt.textContent.trim() : key;
  // E2: multi-variant trades carry the picked version in the name so bill
  // lines, history and CSV name what was priced (single-variant trades -
  // the Phase 1 excavation conversion - keep the clean base name).
  const vSel = $('calc-variant');
  const w = WORK[key];
  if (vSel && vSel.value && w && w.variants && w.variants.length > 1) {
    const av = variantFor(key, vSel.value);
    if (av) name = name + ' - ' + av.label;
  }
  return name;
}

function row(label, value, cls) {
  return '<div class="calc-line' + (cls ? ' ' + cls : '') + '"><span>' + label + '</span><strong>' + value + '</strong></div>';
}

let lastResult = null;

// D3: optional business letterhead for printed/PDF estimates. Device-local
// (mmgr_calc_biz_name); the quote head is display:none on screen.
const BKEY = 'mmgr_calc_biz_name';
// ---- W3 2026-10-01: BUSINESS DETAILS (brand) + DOCUMENT FIELDS ----------
// One brand object (logo + letterhead + signature identity) feeds the
// printed sheet; the logo is downscaled on-device to <= 1MB before it is
// stored. The old lone business-name input migrates into the brand object
// on first load. Per-document fields (client, number, dates) ride the
// saved estimate so recall restores the whole document.
const BRKEY = 'mmgr_calc_brand';
const DOCNO_KEY = 'mmgr_calc_doccounter';
function brandLoad() {
  let b = null;
  try { b = JSON.parse(localStorage.getItem(BRKEY) || 'null'); } catch (e) { b = null; }
  if (!b || typeof b !== 'object') b = {};
  // Migration: the pre-brand lone business name folds in once, PERSISTS
  // into the brand store, then the old key is retired.
  try {
    const old = localStorage.getItem(BKEY);
    if (old) {
      localStorage.removeItem(BKEY);
      if (!b.name) {
        b.name = old;
        b.updatedAt = Date.now();
        try { localStorage.setItem(BRKEY, JSON.stringify(b)); } catch (e) {}
      }
    }
  } catch (e) {}
  return { logo: b.logo || null, name: b.name || '', phone: b.phone || '', email: b.email || '',
    addr: b.addr || '', trn: b.trn || '', sigName: b.sigName || '', sigTitle: b.sigTitle || '',
    sigShow: b.sigShow || '', updatedAt: b.updatedAt || 0 };
}
function brandSave(patch) {
  const cur = brandLoad();
  const next = Object.assign(cur, patch, { updatedAt: Date.now() });
  try { localStorage.setItem(BRKEY, JSON.stringify(next)); } catch (e) { /* storage full - a nicety */ }
  wsStampNow('brand'); scheduleWsPut();
  return next;
}
//PURE: decoded byte size of a data URL (base64 payload is 4/3 of the bytes).
function logoFitsCap(dataUrl) {
  const i = String(dataUrl || '').indexOf(',');
  if (i < 0) return false;
  const b64 = dataUrl.slice(i + 1).replace(/[^A-Za-z0-9+/=]/g, '');
  return (b64.length * 3 / 4) <= 1000000;
}
// On-device downscale: max side 600px, JPEG at falling quality, then
// dimension halving, until the stored data URL is under the 1MB cap.
function downscaleLogo(img) {
  return new Promise(function(resolve) {
    try {
      let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      if (!w || !h) return resolve(null);
      const MAX = 600;
      let scale = Math.min(1, MAX / Math.max(w, h));
      let cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
      const hasAlpha = (() => { try { return img.src && img.src.indexOf('image/png') > -1 || img.src.indexOf('image/webp') > -1; } catch (e) { return false; } })();
      let q = 0.85;
      for (let attempt = 0; attempt < 8; attempt++) {
        const canvas = document.createElement('canvas');
        canvas.width = cw; canvas.height = ch;
        canvas.getContext('2d').drawImage(img, 0, 0, cw, ch);
        const url = canvas.toDataURL(hasAlpha ? 'image/png' : 'image/jpeg', q);
        if (logoFitsCap(url)) return resolve(url);
        if (!hasAlpha && q > 0.5) { q -= 0.15; continue; }
        cw = Math.max(1, Math.floor(cw / 2)); ch = Math.max(1, Math.floor(ch / 2));
        q = 0.85;
      }
      resolve(null);
    } catch (e) { resolve(null); }
  });
}
// PURE: document-number suggestion per type from the counter.
function docNoSuggest(type, n) {
  const pre = type === 'Invoice' ? 'INV' : (type === 'Quote' ? 'QUO' : 'EST');
  const num = Math.max(1, parseInt(n, 10) || 1);
  return pre + '-' + (num < 10 ? '000' + num : num < 100 ? '00' + num : num < 1000 ? '0' + num : String(num));
}
function docCounterLoad() {
  let c = null;
  try { c = JSON.parse(localStorage.getItem(DOCNO_KEY) || 'null'); } catch (e) { c = null; }
  return { Estimate: c && c.Estimate || 1, Quote: c && c.Quote || 1, Invoice: c && c.Invoice || 1 };
}
function docCounterBump(type) {
  const c = docCounterLoad();
  c[type] = (parseInt(c[type], 10) || 1) + 1;
  try { localStorage.setItem(DOCNO_KEY, JSON.stringify(c)); } catch (e) {}
  wsStampNow('docCounter'); scheduleWsPut();
  return c;
}
function bizName() {
  const el = $('calc-biz-name');
  if (el && el.value.trim()) return el.value.trim();
  return brandLoad().name;
}

// W3: the document sheet extras. Nothing renders without its data - a
// bare estimate prints exactly like it did before this wave.
function renderQuoteDoc(r) {
  const brand = brandLoad();
  const logo = $('calc-quote-logo');
  if (logo) { if (brand.logo) { logo.src = brand.logo; logo.hidden = false; } else { logo.removeAttribute('src'); logo.hidden = true; } }
  const contact = $('calc-quote-contact');
  if (contact) {
    const parts = [brand.phone, brand.email, brand.addr, brand.trn ? 'TRN ' + brand.trn : ''].filter(Boolean);
    contact.textContent = parts.join('  -  ');
  }
  const docNo = ($('calc-doc-no') || {}).value || '';
  const qd = $('calc-quote-docno');
  if (qd) qd.textContent = docNo;
  const client = (($('calc-client-name') || {}).value || '').trim();
  const addr = (($('calc-client-addr') || {}).value || '').trim();
  const bt = $('calc-quote-billto');
  if (bt) {
    if (!client && !addr) { bt.textContent = ''; bt.hidden = true; }
    else { bt.hidden = false; bt.textContent = 'Bill to: ' + (client || '') + (addr ? (client ? ', ' : '') + addr : ''); }
  }
  const sig = $('calc-quote-sig');
  if (sig) {
    const show = brand.sigShow === 'on' || (brand.sigShow === '' && docType() === 'Invoice');
    sig.hidden = !show;
    if (show) {
      const nameEl = sig.querySelector('.bcp-sig-name'), titleEl = sig.querySelector('.bcp-sig-title');
      if (nameEl) nameEl.textContent = brand.sigName || bizName();
      if (titleEl) titleEl.textContent = brand.sigTitle || '';
    }
  }
}
function renderBrand() {
  const b = brandLoad();
  const preview = $('calc-logo-preview'), rm = $('calc-logo-remove');
  if (preview) { if (b.logo) { preview.src = b.logo; preview.hidden = false; } else { preview.removeAttribute('src'); preview.hidden = true; } }
  if (rm) rm.hidden = !b.logo;
  const map = { 'calc-brand-name': b.name, 'calc-brand-phone': b.phone, 'calc-brand-email': b.email,
    'calc-brand-addr': b.addr, 'calc-brand-trn': b.trn, 'calc-brand-signame': b.sigName, 'calc-brand-sigtitle': b.sigTitle };
  Object.keys(map).forEach(function(id) { const el = $(id); if (el && document.activeElement !== el) el.value = map[id]; });
  const sigT = $('calc-sig-show');
  if (sigT) sigT.checked = b.sigShow === 'on';
  const bizEl = $('calc-biz-name');
  if (bizEl && document.activeElement !== bizEl) bizEl.value = b.name;
}

// ---- W2 2026-10-01: companion chips (one-tap bill lines) ----------------
// Rendered under the estimate output; hidden until a trade with suggestions
// is priced. Chips hide once their line is already in the bill (derivedFrom
// match), so the row empties naturally as you accept them.
function renderCompanions(r) {
  const wrap = $('calc-companions');
  if (!wrap) return;
  wrap.innerHTML = '';
  const res = r;
  if (!res || res.error) { wrap.hidden = true; return; }
  const st = readState();
  const list = companionsFor(st).filter(function(c) {
    return !loadBoq().some(function(line) {
      return line.st && line.st.derivedFrom === st.work + ':' + c.id;
    });
  });
  if (!list.length) { wrap.hidden = true; return; }
  wrap.hidden = false;
  const cur = CURRENCY[res.currency] || '$';
  wrap.innerHTML = '<div class="bcp-cp-title">Commonly added with ' + esc(res.name) + '</div>';
  list.forEach(function(c) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'bcp-cp-chip';
    chip.setAttribute('data-action', 'calcCompAdd');
    chip.setAttribute('data-cp', c.id);
    chip.textContent = c.name + ' - ' + qtyShown(c.qty, WORK[c.work].q(1).unit).main;
    wrap.appendChild(chip);
  });
}

function render() {
  const out = $('calc-output');
  if (!out) return;
  const r = compute();
  // W3: the document sheet extras (logo, contact, doc number, bill-to,
  // signature) follow their own fields on EVERY recompute - even before
  // dims price. A document header is data-driven, not price-driven, and
  // with no data it stays hidden (plain by default).
  renderQuoteDoc(r);
  // W4: the preliminaries amounts ride every recompute (works basis moves).
  renderPrelims(r && !r.error ? r.sub : 0);
  // W5: the planning waterfall follows the same works basis.
  renderRollup();
  // W6: the cash plan re-spreads whenever the numbers move.
  renderCash();
  // W7: the derived formwork box follows dims + trade.
  renderAccessories();
  renderCompanions(r);
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
    : 'Materials' + (r.matExcluded ? ' - excluded (labour only)' : r.matOverridden ? ' - your rate' : '');
  // E1: while model money is unconverted the breakdown says so in USD
  // terms - the picked symbol is only shown for money in that currency.
  const moneyCode = r.modelUnconverted ? 'USD' : null;
  const shown = qtyShown(r.qty, r.unit);
  const qh = $('calc-quote-biz'), qm = $('calc-quote-meta'), qt = $('calc-quote-title');
  if (qh) qh.textContent = bizName();
  if (qt) qt.textContent = docType();
  if (qm) qm.textContent = (docTitleRaw() || (($('calc-save-name') || {}).value || r.name)) + '  -  ' + r.name + '  -  ' + shown.main + '  -  ' + new Date().toISOString().slice(0, 10);
  // W3: the full document sheet - logo, contact block, document number
  // and bill-to appear ONLY when their data exists (plain by default).
  out.innerHTML =
    (r.modelUnconverted
      ? '<p class="bcp-jm-note">Built-in model rates are US dollars - set a ' + esc(r.currency) + ' exchange rate in the Exchange rates card, or type your own rates, to price in ' + esc(r.currency) + '.</p>'
      : '') +
    '<div class="calc-sum">' +
      '<div class="calc-sum-main"><span class="calc-sum-label">' + r.qtyLabel + '</span>' +
      '<strong class="calc-sum-qty">' + esc(shown.main) +
        '<span class="calc-qty-alt">' + esc(shown.alt) + '</span></strong></div>' +
      '<div class="calc-sum-sub">' + r.matDesc + '</div>' +
      (r.orderCount
        ? '<div class="calc-sum-sub">Order about <strong>' + r.orderCount.n.toLocaleString() + '</strong> ' + esc(r.orderCount.lbl + ' at ' + r.orderCount.sizeTxt) + '</div>'
        : '') +
      (r.hasOpenings && r.openings && r.openings.count
        ? '<div class="calc-sum-sub">Minus ' + r.openings.count + ' ' + (r.openings.count === 1 ? 'opening' : 'openings') + ' (' + r.openings.area + ' m2) not built - window and door spaces</div>'
        : '') +
    '</div>' +
    (r.slips && r.slips.length
      ? r.slips.map(function(s) {
          return '<p class="bcp-jm-note">' + esc(s.msg) + (s.fix != null && s.fix !== ''
            ? ' <button type="button" class="btn btn-n btn-s" data-action="calcFixDim" data-field="' + esc(s.field) + '" data-val="' + esc(s.fix) + '">Use ' + esc(String(s.fix)) + '</button>'
            : '') + '</p>';
        }).join('')
      : '') +
    (r.hasWaste ? row(r.wasteLbl + ' allowance', r.wastePct + '%') : '') +
    row(matLabel, fmtMoney(r.mat, moneyCode)) +
    row('Labor' + (r.labOverridden ? ' - your rate' : ''), fmtMoney(r.lab, moneyCode)) +
    (r.onCost > 0 ? row('Labor statutory costs (NIS, NHT, HEART, Education) ' + r.onCostPct + '%', fmtMoney(r.onCost, moneyCode)) : '') +
    (r.eq > 0 ? row('Equipment / plant hire', fmtMoney(r.eq, moneyCode)) : '') +
    (r.ohPct > 0 ? row('Overhead & margin ' + r.ohPct + '%', fmtMoney(r.oh, moneyCode)) : '') +
    row('Subtotal', fmtMoney(r.sub, moneyCode), 'calc-line-sub') +
    row(r.taxRate === 0 && r.overrideApplied ? 'Tax (no tax - your rate)' : 'Tax (' + r.taxRate + '%' + (r.overrideApplied ? ', your rate' : '') + ')', fmtMoney(r.tax, moneyCode)) +
    row('Estimated total', fmtMoney(r.total, moneyCode), 'calc-line-total') +
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
  wsStampNow('history'); scheduleWsPut();
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
  'Your rates. Rates come prefilled from the model, a rate book you imported, or the model converted at your exchange rate. Change them to yours, save them as a rate sheet to reuse, and pick a version where the trade offers one (like excavation).',
  'Your business on the sheet. Open Business details to add your logo, contact lines and signature - they print on every document you make here. It stays on this device.',
  'Measure the whole job. Add each wall, pour or run as its own row with a repeat count, or type the total if you know it. Add the priced result to the bill and keep pricing the next item.',
  'Site and other costs. Add the items that keep the site running - permits, supervision, temporary facilities. Typical residential jobs carry about 5 to 8 percent here, and the button loads a set you can edit.',
  'Contingency, discount and timing. Design and construction contingency cover what drawings do not show yet; escalation covers price movement over the build months. One-tap companion suggestions appear as you price a trade - accepting one adds a real bill line. A discount (percent or fixed amount) sits between site costs and contingencies. The planning subtotal sits before tax.',
  'Calculate and export. Hit Calculate, then save it with a name, print or PDF it, or export CSV. Name the document so it prints right.',
  'The document sheet. Pick Estimate, Quote or Invoice, add the client, the document number and the dates, and the printed sheet becomes a client-ready document - invoices carry signature lines by default.'
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
  { sel: '#calc-brand-card', text: 'Business details: your logo, contact lines and signature print on every document. Optional - it stays on this device.' },
  { sel: '#calc-boq-card', text: 'Add to bill keeps a running bill of quantities - every line priced on this device, every line editable.' },
  { sel: '#calc-companions', text: 'Common additions show up right under the estimate - one tap adds a real, editable bill line.' },
  { sel: '#calc-prelims-card', text: 'Site and other costs price the items that keep the site running, on top of the works.' },
  { sel: '.bcp-run', text: 'Hit Calculate and the breakdown lands on the right.' },
  { sel: null, text: "That's it - you're ready to use the calculator." }
];
let tourIdx = -1;
function tourDone() { try { return localStorage.getItem('mmgr_calc_tour_done') === '1'; } catch (e) { return false; } }
function tourFlag() { try { localStorage.setItem('mmgr_calc_tour_done', '1'); } catch (e) {} }
// Spotlight blur (owner 2026-09-30: highlight the field, blur the rest).
// Marks the siblings of the target's ancestor path with .bcp-tour-blur;
// CSS blurs exactly those while the target - its whole .bcp-field wrapper,
// label included - and its ancestors stay crisp. NEVER blur .bcp-main as a
// whole: a filter there made the container the containing block for the
// tour's position:fixed furniture, so the cutout's viewport coordinates
// were re-read relative to the page box (the ring landed ~94px right of
// the field at desktop width and drifted further off with every step at
// phone width), and the highlighted field itself blurred with the page.
function tourBlurSet(el) {
  const main = document.querySelector('.bcp-main');
  if (!main) return;
  const marked = main.querySelectorAll('.bcp-tour-blur');
  for (let i = 0; i < marked.length; i++) marked[i].classList.remove('bcp-tour-blur');
  if (!el || !main.contains(el)) return;
  let cur = el;
  while (cur && cur !== main) {
    const parent = cur.parentElement;
    if (!parent) break;
    const kids = parent.children;
    for (let i = 0; i < kids.length; i++) {
      if (kids[i] !== cur) kids[i].classList.add('bcp-tour-blur');
    }
    cur = parent;
  }
}
function tourEnd() {
  tourIdx = -1;
  tourFlag();
  const o = $('calc-tour-overlay');
  if (o) o.hidden = true;
  const spot = $('calc-tour-spot');
  if (spot) spot.hidden = true;
  tourBlurSet(null);
  const popEnd = $('calc-tour-pop');
  if (popEnd) popEnd.classList.remove('is-final');
  try { document.documentElement.classList.remove('mmgr-tour-active'); } catch (e) {}
}
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
  if (st.sel) pop.classList.remove('is-final'); // dock rules own anchored steps
  // Blur everything OFF the spotlight path (owner: the rest of the screen
  // is blurred). The whole .bcp-field wrapper - label + input - stays crisp
  // so the talked-about field reads as one unit; the class lands per
  // element, never on .bcp-main (see tourBlurSet - containing-block trap).
  tourBlurSet(tEl ? ((tEl.closest && tEl.closest('.bcp-field')) || tEl) : null);
  try { document.documentElement.classList.add('mmgr-tour-active'); } catch (e) {}
  if (tEl) {
    try { tEl.scrollIntoView({ block: 'center' }); } catch (e) {}
    pop.setAttribute('data-anchor', st.sel);
    // Position AFTER the scroll settles: scrollIntoView is async-ish in
    // layout terms, so a same-tick getBoundingClientRect can read a stale
    // box (probe caught the cutout landing one card above the target).
    // Double rAF = the repo's standard flush (AGENTS.md lesson 3).
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        if (tourIdx < 0 || TOUR_STEPS[tourIdx] !== st) return;
        positionTourPop(tEl);
        positionTourSpot(tEl);
      });
    });
  } else {
    // Final card: no field to highlight - the centered card itself becomes
    // the spotlight target (gold ring + dim around it, page unblurred).
    pop.removeAttribute('data-anchor');
    pop.classList.add('is-final');
    pop.style.left = '50%';
    pop.style.top = '50%';
    pop.style.transform = 'translate(-50%,-50%)';
    positionTourSpot(pop);
  }
}
// The spotlight cutout: a transparent box over the target whose huge
// box-shadow spread paints the dim layer everywhere EXCEPT the hole
// (owner 2026-09-30: 'the specific field it's talking about isn't being
// highlighted'). Grows 6px around the target so the gold ring sits clear
// of the field's own border.
function positionTourSpot(target) {
  const spot = $('calc-tour-spot');
  if (!spot) return;
  spot.hidden = false;
  const r = target.getBoundingClientRect();
  spot.style.left = (r.left - 6) + 'px';
  spot.style.top = (r.top - 6) + 'px';
  spot.style.width = (r.width + 12) + 'px';
  spot.style.height = (r.height + 12) + 'px';
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
  if (t) { positionTourPop(t); positionTourSpot(t); return; }
  // Final card: keep the ring glued to the centered pop across resizes.
  const pop = $('calc-tour-pop');
  if (pop) positionTourSpot(pop);
});
// Keep the cutout glued to the target while the page scrolls under it.
window.addEventListener('scroll', function() {
  if (tourIdx < 0) return;
  const st = TOUR_STEPS[tourIdx];
  const t = st && st.sel ? document.querySelector(st.sel) : null;
  if (t) { positionTourPop(t); positionTourSpot(t); }
}, { passive: true });
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
    wsStampNow('history'); scheduleWsPut();
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
    const st = readState();
    // W3: the doc-number counter bumps only when a save carries the exact
    // suggested number - a hand-typed number is the user's own sequence.
    const c = docCounterLoad();
    if ((st.docNo || '').trim() === docNoSuggest(st.docType, c[st.docType])) docCounterBump(st.docType);
    list.unshift({ id: 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name, at: new Date().toISOString().slice(0, 10), total: fmtMoney(lastResult.total), st: st });
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
  // ---- W1 bill of quantities ----
  calcBoqAdd: function() {
    const r = render();
    if (!r || r.error) return;
    const lines = loadBoq();
    if (lines.length >= 60) return;
    lines.push({ st: readState(), name: r.name });
    persistBoq(lines);
    renderBoq();
    const card = $('calc-boq-card');
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  },
  calcBoqRecall: function(el) {
    const line = loadBoq()[parseInt(el.getAttribute('data-idx'), 10)];
    if (!line) return;
    applyState(line.st);
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },
  calcBoqRemove: function(el) {
    const idx = parseInt(el.getAttribute('data-idx'), 10);
    if (isNaN(idx)) return;
    persistBoq(loadBoq().filter(function(x, i) { return i !== idx; }));
    renderBoq();
  },
  calcBoqClear: function() {
    persistBoq([]);
    renderBoq();
  },
  // ---- W2 element instances ----
  calcInstAdd: function() {
    const key = ($('calc-work') || {}).value || '';
    const kind = INSTANCE_KINDS[key];
    if (!kind) return;
    instRows.push({ label: INSTANCE_LABEL[kind] + ' ' + (instRows.length + 1), d1: '', d2: '', d3: '', n: 1 });
    renderInstances();
    render();
  },
  calcInstDel: function(el) {
    const idx = parseInt(el.getAttribute('data-idx'), 10);
    if (isNaN(idx)) return;
    instRows.splice(idx, 1);
    renderInstances();
    render();
  },
  // ---- W2.7 openings editor ----
  calcOpenAdd: function() {
    openRows.push({ type: 'window', w: '', h: '', n: 1 });
    renderOpenings();
    render();
  },
  calcOpenDel: function(el) {
    const idx = parseInt(el.getAttribute('data-idx'), 10);
    if (isNaN(idx)) return;
    openRows.splice(idx, 1);
    renderOpenings();
    render();
  },
  // ---- W4 preliminaries ----
  calcPrelimPreset: function() {
    prelimItems = PRELIM_PRESET_RES.map(function(x) { return { name: x.name, basis: x.basis, value: x.value, weeks: x.weeks }; });
    persistPrelims(prelimItems);
    renderPrelims();
  },
  calcPrelimAdd: function() {
    if (prelimItems.length >= 30) return;
    prelimItems.push({ name: '', basis: 'fixed', value: '', weeks: '' });
    persistPrelims(prelimItems);
    renderPrelims();
  },
  calcPrelimRemove: function(el) {
    const idx = parseInt(el.getAttribute('data-idx'), 10);
    if (isNaN(idx)) return;
    prelimItems.splice(idx, 1);
    persistPrelims(prelimItems);
    renderPrelims();
  },
  calcPrelimClear: function() {
    prelimItems = [];
    persistPrelims(prelimItems);
    renderPrelims();
  },
  // ---- W6 cash flow ----
  calcCashCsv: function() {
    const months = parseInt(($('calc-months') || {}).value, 10);
    if (!(months > 0)) { sheetMsg('Set the build duration first - then export the cash plan.'); return; }
    const works = prelimWorks();
    const pref = rollupPrefs();
    const r = rollup({ works: works, prelims: prelimsTotal(prelimItems, works).total,
      designC: pref.designC, constrC: pref.constrC, escPct: pref.escPct, months: months });
    const c = cashCurve(r.subtotal, months, ($('calc-cash-mode') || {}).value || 'scurve', '3.2');
    const rows = [['Month', 'Spend', 'Cumulative']];
    c.per.forEach(function(v, i) { rows.push([String(i + 1), String(Math.round(v)), String(Math.round(c.cum[i]))]); });
    rows.push([]);
    rows.push(['Planning-grade cash plan - not a quote.']);
    const blob = new Blob(['\uFEFF' + rows.map(function(row) { return row.map(function(cell) { return '"' + String(cell == null ? '' : cell).replace(/"/g, '""') + '"'; }).join(','); }).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = slug(docTitleBase()) + '-cash-plan-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function() { URL.revokeObjectURL(a.href); }, 500);
  },
  // ---- W7 concrete accessories ----
  calcFormworkAdd: function() {
    const st = readState();
    const m2 = formworkM2(st.work, st.d1, st.d2, st.d3);
    if (!m2) return;
    const rateRaw = parseFloat(($('calc-formwork-rate') || {}).value);
    const rate = isFinite(rateRaw) && rateRaw > 0 ? rateRaw : FORM_RATE_DEFAULT;
    const lines = loadBoq();
    if (lines.length >= 60) return;
    // Formwork is priced as its own bill line through the REAL formwork
    // trade with measuredQty carrying the derived m2 (2026-10-01 fix: the
    // line previously stored markers computeFor never read, so it priced
    // as a duplicate of the slab). Rates stay user-owned; waste/piece
    // fields are cleared so the derived quantity is the whole story.
    const lineSt = Object.assign({}, st, {
      work: 'formwork',
      measuredQty: String(m2),
      measuredAuto: '',
      measuredUnit: 'm2',
      instances: '[]',
      rateMat: String(rate),
      rateLab: '',
      _matModel: undefined,
      _labModel: undefined,
      piecePrice: '', pieceSize: '', wastePct: '',
      derivedFrom: st.work + ':formwork'
    });
    lines.push({ st: lineSt, name: 'Formwork ' + m2.toLocaleString() + ' m2' });
    persistBoq(lines);
    renderBoq();
  },
  // ---- W2 companion chips ----
  calcCompAdd: function(el) {
    const id = el.getAttribute('data-cp');
    const def = COMPANION_DEFS[id];
    if (!def) return;
    const st = readState();
    const qty = def.qty(st);
    if (!(qty > 0)) return;
    const lines = loadBoq();
    if (lines.length >= 60) return;
    // Same derived-line mechanism as formwork: a real WORK entry priced by
    // measuredQty through the one math path. Bill lines stay fully
    // editable/removable; recall re-fills the form as a plain measured
    // quantity of that trade.
    const lineSt = Object.assign({}, st, {
      work: def.work,
      measuredQty: String(qty),
      measuredAuto: '',
      measuredUnit: WORK[def.work].q(1).unit,
      instances: '[]',
      rateMat: '', rateLab: '',
      _matModel: undefined,
      _labModel: undefined,
      piecePrice: '', pieceSize: '', wastePct: '',
      derivedFrom: st.work + ':' + id
    });
    lines.push({ st: lineSt, name: def.name });
    persistBoq(lines);
    renderBoq();
    renderCompanions(lastResult);
  },
  // ---- W3 business details + document fields ----
  calcBrandOpen: function(el) {
    const body = $('calc-brand-body');
    if (!body) return;
    body.hidden = !body.hidden;
    if (el) { el.setAttribute('aria-expanded', String(!body.hidden)); el.textContent = body.hidden ? 'Show' : 'Hide'; }
    try { localStorage.setItem('mmgr_calc_brand_open', body.hidden ? '' : '1'); } catch (e) {}
  },
  calcLogoRemove: function() {
    brandSave({ logo: null });
    renderBrand();
    render();
  },
  calcBrandToggle: function(el) {
    brandSave({ sigShow: el.checked ? 'on' : '' });
    render();
  },
  // ---- W8 location packs ----
  calcPackApply: function(el) {
    const sel = $('calc-pack-select');
    const id = el && el.tagName === 'SELECT' ? el.value : (sel ? sel.value : '');
    if (!id) return;
    applyPackById(id);
    if (sel) sel.selectedIndex = 0;
  },
  calcPackExport: function() {
    const list = loadPacks();
    if (!list.length) { sheetMsg('No location packs to export yet.'); return; }
    const payload = JSON.stringify({ version: 1, exported: new Date().toISOString().slice(0, 10), packs: list }, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'mmgr-calc-location-packs-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function() { URL.revokeObjectURL(a.href); }, 500);
    sheetMsg('Exported ' + list.length + ' location pack(s).');
  },
  calcPackImport: function() { const f = $('calc-pack-file'); if (f) f.click(); },
  calcInstToggle: function() {
    const wrap = $('calc-instances');
    const manual = $('calc-measured-manual');
    if (!wrap || !manual) return;
    wrap.hidden = manual.checked;
    const q = $('calc-measured-qty');
    if (q) q.hidden = !manual.checked;
    renderInstances();
    render();
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
  // ---- E1 (plan v2 Phase 1): exchange rates -----------------------------
  calcFxSave: function() {
    const sel = $('calc-fx-code'), rateEl = $('calc-fx-rate'), dateEl = $('calc-fx-asof');
    const code = sel && sel.value;
    const per = parseFloat(rateEl && rateEl.value);
    if (!code) { sheetMsg('Pick the currency first.'); return; }
    if (!isFinite(per) || per <= 0) { sheetMsg('Enter the rate: how many ' + code + ' per 1 US dollar.'); return; }
    const t = loadFx();
    t[code] = { per: per, asOf: (dateEl && dateEl.value) || new Date().toISOString().slice(0, 10) };
    persistFx(t);
    renderFx();
    refreshRateFields();
    render();
    sheetMsg('Exchange rate saved: ' + per + ' ' + code + ' per 1 US dollar.');
  },
  calcFxDel: function(el) {
    const code = el.getAttribute('data-code');
    if (!code) return;
    const t = loadFx();
    delete t[code];
    persistFx(t);
    renderFx();
    refreshRateFields();
    render();
  },
  // ---- E4 (plan v2 Phase 1): rate books ---------------------------------
  calcBookExport: function() {
    const list = loadBooks();
    if (!list.length) { sheetMsg('No rate books imported yet.'); return; }
    const payload = JSON.stringify({ version: 1, exported: new Date().toISOString().slice(0, 10), books: list }, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'mmgr-calc-rate-books-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function() { URL.revokeObjectURL(a.href); }, 500);
    sheetMsg('Exported ' + list.length + ' rate book(s).');
  },
  calcBookImport: function() { const f = $('calc-book-file'); if (f) f.click(); },
  calcBookClear: function() {
    setActiveBook('');
    renderBooks();
    refreshRateFields();
    render();
    sheetMsg('Rate book cleared - the built-in model rates prefill again.');
  },
  // Owner directive 2026-10-01: one-tap fix for a flagged unit slip.
  calcFixDim: function(el) {
    const f = el.getAttribute('data-field'), v = el.getAttribute('data-val');
    const input = f ? $('calc-' + f) : null;
    if (input && v != null && v !== '') {
      input.value = v;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  },
  calcSheetPick: null
};

document.addEventListener('click', function(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = ACTIONS[el.getAttribute('data-action')];
  if (fn) fn(el);
});
// Checkboxes and selects with data-action fire 'change', not a click that
// carries a value in every browser - dispatch them on change as well (W3:
// the signature-lines toggle is the first checkbox action on this page).
document.addEventListener('change', function(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = ACTIONS[el.getAttribute('data-action')];
  if (fn && el.tagName === 'INPUT' && el.type === 'checkbox') fn(el);
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
// W8 location-pack picker: same value-apply-then-snap convention.
document.addEventListener('change', function(e) {
  const el = e.target.closest('[data-action="calcPackApply"]');
  if (!el || !el.value) return;
  applyPackById(el.value);
  el.selectedIndex = 0;
});

// D1: the hidden file input behind the Import button. Every failure path
// reports in the status line - a bad file never throws, never clears storage.
document.addEventListener('change', function(e) {
  if (e.target.id === 'calc-pack-file') {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function() {
      let json = null;
      try { json = JSON.parse(String(reader.result)); } catch (err) { json = null; }
      const res = importPacks(json);
      if (res === null) { sheetMsg('That file is not a My MaNaGeR location pack export.'); return; }
      sheetMsg('Imported ' + res.merged + ' location pack(s)' + (res.skipped ? ' (' + res.skipped + ' skipped).' : '.'));
    };
    reader.readAsText(file);
    return;
  }
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

// E4: the rate-book file input - same contract as sheets/packs. A bad file
// reports in the status line and never throws, never clears storage.
document.addEventListener('change', function(e) {
  if (!e.target || e.target.id !== 'calc-book-file') return;
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function() {
    let json = null;
    try { json = JSON.parse(String(reader.result)); } catch (err) { json = null; }
    const res = importBooks(json);
    if (res === null) { sheetMsg('That file is not a My MaNaGeR rate book export (expected { books: [...] }).'); return; }
    sheetMsg('Imported ' + res.merged + ' rate book(s)' + (res.skipped ? ' (' + res.skipped + ' entries skipped - unknown items or bad rates)' : '') + (res.badKeys ? '; ' + res.badKeys + ' unknown work key(s) rejected.' : '.'));
  };
  reader.readAsText(file);
});

// E4: choosing a book in the select makes it the ACTIVE book (value-apply-
// then-snap, same convention as sheets/packs). Its rates drive the prefill.
document.addEventListener('change', function(e) {
  const el = e.target.closest('[data-action="calcBookPick"]');
  if (!el) return;
  setActiveBook(el.value);
  el.selectedIndex = 0;
  renderBooks();
  refreshRateFields();
  render();
  const a = activeBook();
  sheetMsg(a ? 'Rate book "' + a.name + '" applied - its rates prefill the model fields.' : 'Rate book cleared - the built-in model rates prefill again.');
});

// Print scope is class-scoped; window.print() blocks, so remove the class
// right after it returns (covers the common browsers' dialog lifecycle;
// afterprint is the standards path where it fires).
window.addEventListener('afterprint', function() { document.body.classList.remove('print-estimate'); });

// D3: the export-row business name now saves into the brand store (the
// card's name field mirrors it - both write the same key since W3).
(function() {
  const el = $('calc-biz-name');
  if (!el) return;
  el.addEventListener('input', function() {
    brandSave({ name: el.value.trim() });
    const cardEl = $('calc-brand-name');
    if (cardEl && document.activeElement !== cardEl) cardEl.value = el.value.trim();
    render();
  });
})();

// ---- Rate fields (F4b): prefill from the model, label with units, --------
// piece rows show only on trades that have a piece spec.
function rateUnitLabel(key) {
  const w = WORK[key];
  if (!w) return '';
  // E3: a declared rate-entry unit (from the trade or its active variant)
  // names the basis exactly as the rate source speaks it.
  const vSel = $('calc-variant');
  const ru = ((vSel && vSel.value && w.variants ? (variantFor(key, vSel.value) || {}).runit : null) || w.runit);
  if (ru) return 'per ' + ru;
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
  // E1+E4: the prefill rate comes from the active rate book first, then
  // the WORK model (or the active variant), ALREADY converted into the
  // estimate currency through the FX table. When the pair is missing the
  // fields stay EMPTY and the note says so - never a silent relabel
  // (that was audit A1: JMD users saw relabelled USD).
  const cur = (($('calc-currency') || {}).value) || BASE_CURRENCY;
  const m = modelRatesFor(key, ($('calc-variant') || {}).value || '', cur, d.d1, d.d2);
  const fxNote = $('calc-fx-note');
  // Warn whenever the prefill rate could not be brought into the estimate
  // currency - including a foreign book with a USD estimate (the flag
  // already knows; the target being the base currency is no excuse).
  const needNote = !m || m.unconvertible;
  if (fxNote) {
    fxNote.hidden = !needNote;
    if (needNote) fxNote.textContent = 'Model rates are ' + (m && m.unconvertible ? 'in ' + m.src + ' (imported rate book)' : 'US dollars') + ' - set a ' + cur + ' exchange rate in the Exchange rates card below, or type your own rates, to price in ' + cur + '.';
  }
  const modelM = (m && !m.unconvertible) ? String(Math.round(m.mat * 100) / 100) : '';
  const modelL = (m && !m.unconvertible) ? String(m.lab) : '';
  if (recallHold) {
    // Recalling a snapshot: only truly-empty fields take a fresh prefill;
    // restored field+marker pairs are left exactly as they were saved.
    if (modelM !== '') {
      if (matEl.value === '') { matEl.value = modelM; matEl.dataset.model = modelM; }
      if (labEl.value === '') { labEl.value = modelL; labEl.dataset.model = modelL; }
    }
  } else if (modelM !== '') {
    // Prefill empty fields; an UNTOUCHED prefill (value === what we last put
    // there) follows the model when dimensions change the model rate. A typed
    // override is never overwritten - that is the rate freedom.
    if (matEl.value === '' || matEl.value === matEl.dataset.model) matEl.value = modelM;
    if (labEl.value === '' || labEl.value === labEl.dataset.model) labEl.value = modelL;
    matEl.dataset.model = modelM;
    labEl.dataset.model = modelL;
  } else {
    // A stale prefill from another item (or an unconvertible book) must not
    // linger as fake money - an untouched prefill clears; typed rates stay.
    if (matEl.value === matEl.dataset.model) { matEl.value = ''; matEl.dataset.model = ''; }
    if (labEl.value === labEl.dataset.model) { labEl.value = ''; labEl.dataset.model = ''; }
  }
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
// ---- W2.5 (owner 2026-10-01): WORK FAMILIES -----------------------------
// The flat 24-trade picker was doing too much at once. Families split the
// choice in two: what are you building (six trades), then which trade. The
// family select only VISUALLY filters the trade picker (optgroups hide; the
// options stay in the DOM), so every existing recall / harness / pack path
// that sets #calc-work directly keeps working - syncLabels flips the family
// back on when a foreign trade is selected.
const FAMILIES = {
  structure: { label: 'Structure - walls, frames, steel', hint: 'Walls, frames and steel: carry the building\'s loads. Set-out lining-out and debris carting are offered with every wall.' },
  groundworks: { label: 'Groundworks - clearing, excavation, concrete', hint: 'Below-ground work: clearing, excavation, foundations and slabs. Derived formwork appears for pours; cart-away comes with every pour.' },
  envelope: { label: 'Envelope - roof, render, paint, drywall', hint: 'Weather-proofing skins: roof coverings, renders, paint and drywall. Cart-away is offered to clear the offcuts.' },
  finishes: { label: 'Finishes - tiling, drives, fencing, trims', hint: 'What everyone sees and touches: tiling, drives, fencing and trims. Fencing offers debrushing and post holes.' },
  plumbing: { label: 'Plumbing - pipe runs, fixtures', hint: 'Water in, waste out: pipe runs, fixtures and rough-in packages.' },
  electrical: { label: 'Electrical - points, conduit, panels', hint: 'Power and light: wiring points, conduit runs and panels.' }
};
const WORK_FAMILY = {
  siteprep: 'groundworks', excav: 'groundworks', slab: 'groundworks', footings: 'groundworks', 'septic-tank': 'groundworks',
  blockwall: 'structure', brickwall: 'structure', framing: 'structure', rebar: 'structure',
  roof: 'envelope', 'shingle-roof': 'envelope', render: 'envelope', paint: 'envelope', drywall: 'envelope',
  window: 'envelope', gutter: 'envelope', 'soffit-fascia': 'envelope',
  tile: 'finishes', 'concrete-drive': 'finishes', fencing: 'finishes', skirt: 'finishes',
  door: 'finishes', ceiling: 'finishes', 'floor-screed': 'finishes', cabinet: 'finishes',
  'pipe-supply': 'plumbing', 'pipe-drain': 'plumbing', fixture: 'plumbing', 'bath-rough': 'plumbing', 'water-heater': 'plumbing',
  'wire-point': 'electrical', conduit: 'electrical', panel: 'electrical'
};
const FKEY = 'mmgr_calc_family';
// The family select only filters the VIEW: non-family optgroups hide while
// their options stay selectable (recalls set #calc-work directly).
function applyFamilyFilter(sel) {
  if (!sel) return;
  const fam = localStorage.getItem(FKEY) || '';
  const keep = fam && FAMILIES[fam] ? FAMILIES[fam].label.split(' - ')[0] : '';
  Array.prototype.forEach.call(sel.querySelectorAll('optgroup'), function(og) {
    og.hidden = !!keep && og.label !== keep;
  });
}
function familyHintKey(fam) { return fam && FAMILIES[fam] ? fam : ''; }
function syncFamily() {
  const sel = $('calc-work'), fSel = $('calc-family');
  if (!sel || !fSel) return;
  const key = sel.value;
  const wanted = WORK_FAMILY[key] || '';
  let fam = localStorage.getItem(FKEY) || '';
  if (wanted && fam && fam !== wanted) {
    // A foreign trade got selected (recall, pack, harness): the family
    // follows the trade - never fight the user's work item.
    fam = wanted;
    try { localStorage.setItem(FKEY, fam); } catch (e) {}
    fSel.value = fam;
  }
  applyFamilyFilter(sel);
  const hintEl = $('calc-family-hint');
  if (hintEl) hintEl.textContent = familyHintKey(fam) ? FAMILIES[fam].hint : 'Pick the kind of work first - only its trades stay in the list. Choose All to see every trade.';
}
// The family select's own change handler (delegated below - the page has
// one dispatch convention).
function onFamilyChange(val) {
  try {
    if (val) localStorage.setItem(FKEY, val); else localStorage.removeItem(FKEY);
  } catch (e) {}
  const sel = $('calc-work');
  if (val && sel && WORK_FAMILY[sel.value] !== val) {
    // Jump to a sensible first trade of the newly chosen family.
    const first = Object.keys(WORK_FAMILY).find(function(k) { return WORK_FAMILY[k] === val; });
    if (first) sel.value = first;
  }
  syncLabels();
}

// E2: the variant selector follows the work item - one select, hidden
// unless the trade carries a variants list (Phase 1: excavation).
function renderVariant() {
  const wrap = $('calc-variant-wrap'), sel = $('calc-variant');
  if (!wrap || !sel) return;
  const w = WORK[($('calc-work') || {}).value];
  const vs = w && w.variants;
  wrap.hidden = !vs;
  if (!vs) { sel.innerHTML = ''; return; }
  sel.innerHTML = vs.map(function(v) { return '<option value="' + esc(v.id) + '">' + esc(v.label) + '</option>'; }).join('');
  if (!vs.some(function(v) { return v.id === sel.value; })) sel.value = vs[0].id;
}

function syncLabels() {
  const key = ($('calc-work') || {}).value;
  const w = WORK[key];
  if (!w) return;
  syncFamily();
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
  // W3: the Contractors Levy note is Jamaica-specific.
  const jmNote = $('calc-jm-levy-note');
  if (jmNote) jmNote.hidden = c !== 'JM';
  // W2: instance editor follows the work item (rows re-seed per trade).
  renderInstances();
  // W2.7: the openings editor appears only on wall-area trades.
  renderOpenings();
  // E2: the variant selector follows the trade.
  renderVariant();
  // W7: the rebar laps field rides the rebar trade only (same home as the
  // d2/d3 wrap hiding - syncLabels owns per-trade field visibility).
  const rlWrap = $('calc-rebar-laps-wrap'), rlEl = $('calc-rebar-laps');
  if (rlWrap && rlEl) {
    rlWrap.hidden = key !== 'rebar';
    if (key !== 'rebar') rlEl.value = '';
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
  if ($('calc-family')) $('calc-family').value = localStorage.getItem(FKEY) || '';
  ['calc-currency', 'calc-country', 'calc-quality', 'calc-tax-override',
   'calc-rate-mat', 'calc-rate-lab', 'calc-rate-eq', 'calc-oh', 'calc-piece-price', 'calc-piece-size', 'calc-waste']
    .forEach(function(id) { const el = $(id); if (el) el.addEventListener('input', function() { render(); }); });
  // E1/E4: dims feed dim-dependent model rates (fencing height) - refresh
  // the prefill before pricing so the field IS the money being charged.
  ['calc-d1', 'calc-d2', 'calc-d3'].forEach(function(id) {
    const el = $(id); if (el) el.addEventListener('input', function() { refreshRateFields(); render(); });
  });
  // E1: switching currency re-prefills the model rates for it - the fields
  // must never carry another currency's numbers under the new symbol.
  if ($('calc-currency')) $('calc-currency').addEventListener('change', function() { refreshRateFields(); render(); });
  // W2: instance-row editing recomputes the measured total live; the
  // override field drives render() directly.
  $('calc-instances').addEventListener('input', function(e) {
    const el = e.target;
    const idx = parseInt(el.getAttribute('data-idx'), 10);
    const field = el.getAttribute('data-field');
    if (isNaN(idx) || !field) return;
    if (field === 'n') instRows[idx].n = Math.max(1, parseInt(el.value, 10) || 1);
    else instRows[idx][field] = el.value;
    // Keystrokes must NOT rebuild the row the user is typing in (the innerHTML
    // replace drops focus mid-entry); refresh the measured total only. Full
    // re-render stays on add / delete / trade change.
    const s = instancesQty(instRows, ($('calc-work') || {}).value || '');
    instSum = s.qty; instUnit = s.unit;
    const sumEl = $('calc-inst-sum');
    if (sumEl) sumEl.textContent = instSum > 0 ? 'Measured total: ' + qtyShown(instSum, instUnit).main : '';
    render();
  });
  // W2.7: openings rows edit live; the type select fires 'change', the
  // number fields fire 'input' - both land in the same handler.
  const openHandler = function(e) {
    const el = e.target;
    const idx = parseInt(el.getAttribute('data-idx'), 10);
    const field = el.getAttribute('data-field');
    if (isNaN(idx) || !field || !openRows[idx]) return;
    if (field === 'n') openRows[idx].n = Math.max(1, parseInt(el.value, 10) || 1);
    else openRows[idx][field] = el.value;
    // Same no-rebuild rule as the instances rows: a full renderOpenings() on
    // every keystroke replaces the focused input and eats the rest of the
    // entry. Refresh the deducts-sum only; full re-render stays on add /
    // delete / trade change.
    const a = openingsArea({ openings: JSON.stringify(openRows) }, _units === 'imperial');
    const sumEl = $('calc-open-sum');
    if (sumEl) sumEl.textContent = a.count > 0 ? 'Deducts ' + qtyShown(a.area, 'm2').main + ' across ' + a.count + ' opening' + (a.count === 1 ? '' : 's') : '';
    render();
  };
  const openWrap = $('calc-openings');
  if (openWrap) { openWrap.addEventListener('input', openHandler); openWrap.addEventListener('change', openHandler); }
  $('calc-measured-qty').addEventListener('input', render);
  // W3: employer statutory on-costs. Enabling the toggle (or switching to
  // Jamaica while it is on) suggests the 12.5% stack; a typed value always
  // wins (touched flag) and 0/empty keeps it off.
  function onCostSuggest() {
    const t = $('calc-oncost-toggle'), p = $('calc-oncost-pct');
    if (!t || !p) return;
    p.disabled = !t.checked;
    if (t.checked && $('calc-country').value === 'JM' && !p.dataset.touched && !p.value) {
      p.value = '12.5';
    }
    render();
  }
  $('calc-oncost-toggle').addEventListener('change', onCostSuggest);
  $('calc-oncost-pct').addEventListener('input', function() { this.dataset.touched = '1'; render(); });
  // W4: preliminaries rows edit live (inputs + basis selects).
  function prelimEdit(e) {
    const el = e.target;
    const idx = parseInt(el.getAttribute('data-idx'), 10);
    const field = el.getAttribute('data-field');
    if (isNaN(idx) || !field || !prelimItems[idx]) return;
    prelimItems[idx][field] = el.value;
    persistPrelims(prelimItems);
    renderPrelims();
  }
  $('calc-prelims-body').addEventListener('input', prelimEdit);
  $('calc-prelims-body').addEventListener('change', prelimEdit);
  // W5: contingency/escalation/duration settings save per device.
  ['calc-design-c', 'calc-constr-c', 'calc-esc-pct', 'calc-months', 'calc-disc-pct', 'calc-disc-amt'].forEach(function(id) {
    const el = $(id);
    if (!el) return;
    el.addEventListener('input', function() {
      persistRollupPrefs({ designC: $('calc-design-c').value, constrC: $('calc-constr-c').value,
        escPct: $('calc-esc-pct').value, months: $('calc-months').value,
        discPct: $('calc-disc-pct').value, discAmt: $('calc-disc-amt').value });
      renderRollup();
      renderCash();
    });
  });
  const cashMode = $('calc-cash-mode');
  if (cashMode) cashMode.addEventListener('change', renderCash);
  $('calc-country').addEventListener('change', function() {
    // W3: the Contractors Levy note is Jamaica-specific.
    const note = $('calc-jm-levy-note');
    if (note) note.hidden = $('calc-country').value !== 'JM';
    if ($('calc-oncost-toggle').checked) onCostSuggest(); else render();
  });
  // Saved unit system comes back before first interaction; silent keeps the
  // empty-state text until the user actually enters dimensions.
  let savedUnits = 'metric';
  try { savedUnits = localStorage.getItem('mmgr_calc_units') || 'metric'; } catch (e) {}
  setUnits(savedUnits, true);
}
renderHistory();
renderEstimates();
renderSheets();
// E1/E4: the exchange-rate card and the rate-book picker paint on load.
renderFx();
renderBooks();
// W1 bill of quantities: paint the stored bill on load.
renderBoq();
// W4 site & other costs: restore the stored items on load.
prelimItems = loadPrelims();
renderPrelims();
// W8 location packs: seed the first run, paint the picker.
ensurePackSeeds();
renderPacks();
// W5 waterfall: restore the saved contingency/escalation settings.
(function() {
  const p = loadRollupPrefs();
  if ($('calc-design-c')) $('calc-design-c').value = p.designC != null ? p.designC : '10';
  if ($('calc-constr-c')) $('calc-constr-c').value = p.constrC != null ? p.constrC : '5';
  if ($('calc-esc-pct')) $('calc-esc-pct').value = p.escPct != null ? p.escPct : '5';
  if ($('calc-months')) $('calc-months').value = p.months != null ? p.months : '';
  if ($('calc-disc-pct')) $('calc-disc-pct').value = p.discPct != null ? p.discPct : '';
  if ($('calc-disc-amt')) $('calc-disc-amt').value = p.discAmt != null ? p.discAmt : '';
})();
// W3: brand + document fields restore on load (before first render so the
// sheet has its data); the logo pipeline downgrades big images on-device.
(function() {
  renderBrand();
  const dEl = $('calc-doc-date');
  if (dEl && !dEl.value) dEl.value = new Date().toISOString().slice(0, 10);
  const c = docCounterLoad();
  const dType = docType();
  const noEl = $('calc-doc-no');
  if (noEl && !noEl.value) noEl.placeholder = docNoSuggest(dType, c[dType]) + ' (next number)';
  const logoFile = $('calc-logo-file');
  if (logoFile) logoFile.addEventListener('change', function() {
    const f = logoFile.files && logoFile.files[0];
    const note = $('calc-logo-note');
    if (!f) return;
    const say = function(m) { if (note) note.textContent = m; };
    if (!/^image\//.test(f.type)) { say('That file is not an image. Choose a PNG or JPG.'); logoFile.value = ''; return; }
    if (f.size > 8 * 1024 * 1024) { say('That image is too large (over 8 MB). Choose a smaller one.'); logoFile.value = ''; return; }
    const reader = new FileReader();
    reader.onload = function() {
      const img = new Image();
      img.onload = function() {
        downscaleLogo(img).then(function(url) {
          if (!url) { say('That image could not be resized. Try a smaller one.'); return; }
          brandSave({ logo: url });
          renderBrand();
          render();
          say('Logo saved. It stays on this device.');
          logoFile.value = '';
        });
      };
      img.onerror = function() { say('That image could not be read. Try a different file.'); };
      img.src = String(reader.result);
    };
    reader.onerror = function() { say('The file could not be read. Try again.'); };
    reader.readAsDataURL(f);
  });
  ['calc-brand-name', 'calc-brand-phone', 'calc-brand-email', 'calc-brand-addr', 'calc-brand-trn', 'calc-brand-signame', 'calc-brand-sigtitle'].forEach(function(id) {
    const el = $(id);
    if (!el) return;
    el.addEventListener('input', function() {
      const patch = {}; patch[{ 'calc-brand-name': 'name', 'calc-brand-phone': 'phone', 'calc-brand-email': 'email',
        'calc-brand-addr': 'addr', 'calc-brand-trn': 'trn', 'calc-brand-signame': 'sigName', 'calc-brand-sigtitle': 'sigTitle' }[id]] = el.value.trim();
      brandSave(patch);
      render();
    });
  });
  ['calc-client-name', 'calc-client-addr', 'calc-doc-no', 'calc-doc-date', 'calc-doc-due'].forEach(function(id) {
    const el = $(id);
    if (el) el.addEventListener('input', render);
  });
  const dTypeSel = $('calc-doc-type');
  if (dTypeSel) dTypeSel.addEventListener('change', function() {
    const cc = docCounterLoad();
    const t = docType();
    const ne = $('calc-doc-no');
    if (ne && !ne.value) ne.placeholder = docNoSuggest(t, cc[t]) + ' (next number)';
  });
  if (localStorage.getItem('mmgr_calc_brand_open') === '1') ACTIONS.calcBrandOpen($('calc-brand-card') ? $('calc-brand-card').querySelector('[data-action="calcBrandOpen"]') : null);
})();
// How-to guide: paint the first step (open state decides visibility).
renderGuide();
// First-visit tutorial nudge: only when the flag is absent.
(function() { const n = $('calc-tour-nudge'); if (n && !tourDone()) n.hidden = false; })();
// W5 workspace follow: one silent probe for signed-in accounts, after first
// paint. Signed-out / offline / any failure: silent no-op, offline intact.
if (navigator.onLine) setTimeout(wsProbe, 1500);
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
// D3 restore (pre-brand) retired 2026-10-01: brandLoad/renderBrand own the
// business name now (mmgr_calc_biz_name migrates into mmgr_calc_brand).
})();
