/* ============================================================
   js/rateunits.js — unit conversion for rate-book quantities.
   ------------------------------------------------------------
   G-1 (FIELD-FINDINGS-DIRECTIVE-2026-10-28): a per-square-metre
   book rate must never price a square-foot quantity (and vice
   versa). This module is the single source of truth for:

     - normalizing the many rate-book unit strings ("Yd.Sq.",
       "Ft.Run", "100 Sq.Ft.", "square feet", "m2" ...) to a
       canonical key,
     - the FAMILY (area / length / volume / mass / count) and
       SYSTEM (imperial / metric / neutral) of a unit,
     - converting a quantity from one unit to another WITHIN a
       family, failing closed (null) on an unknown unit or a
       family mismatch so a wrong line can never be silently
       priced 10x wrong.

   Loaded in the browser as MMGR.RateUnits (the page bundle is a
   simple concatenation, not a bundler) and require()-able in
   Node so the T-RATEUNIT gate reuses the exact same logic.
   ============================================================ */
(function (global) {
  'use strict';

  // Canonical families. The canonical unit of each family is the metric one
  // the engine already speaks (m2 / m / m3 / kg / each), which keeps the
  // numbers everyone has reviewed untouched.

  // Normalise an arbitrary unit label to one of the canonical keys below.
  // Lower-cased, collapsed whitespace, then alias lookup. Anything the book
  // or a model might send lands here.
  var ALIAS = {
    // area
    m2: 'm2',
    'sq m': 'm2',
    sqm: 'm2',
    'sq. m': 'm2',
    metre2: 'm2',
    meter2: 'm2',
    'square metre': 'm2',
    'square meter': 'm2',
    'm²': 'm2',
    yd2: 'yd2',
    'yd.sq.': 'yd2',
    'sq yd': 'yd2',
    'square yard': 'yd2',
    'yd²': 'yd2',
    ft2: 'ft2',
    'ft.sq.': 'ft2',
    'f.sq.': 'ft2',
    'sq ft': 'ft2',
    sqft: 'ft2',
    'square foot': 'ft2',
    'square feet': 'ft2',
    'ft²': 'ft2',
    '100 sq.ft.': 'ft2x100',
    '100 sq ft': 'ft2x100',
    '100 s q.ft.': 'ft2x100',
    '100 f.s.': 'ft2x100',
    '100 ft.sq.': 'ft2x100',
    '100 sqft': 'ft2x100',
    '100 f s': 'ft2x100',
    // length
    m: 'm',
    metre: 'm',
    meter: 'm',
    km: 'km',
    cm: 'cm',
    ft: 'ft',
    'ft run': 'ft',
    'ft.run': 'ft',
    foot: 'ft',
    feet: 'ft',
    yd: 'yd',
    'yd run': 'yd',
    'yd.run': 'yd',
    yard: 'yd',
    in: 'in',
    'in.': 'in',
    inch: 'in',
    inches: 'in',
    '100mm': 'mmx100',
    '100 mm': 'mmx100',
    // volume
    m3: 'm3',
    'm³': 'm3',
    'cu m': 'm3',
    cum: 'm3',
    metre3: 'm3',
    yd3: 'yd3',
    'yd.cu.': 'yd3',
    'cu yd': 'yd3',
    ft3: 'ft3',
    'ft.cu.': 'ft3',
    'cu ft': 'ft3',
    'cubic foot': 'ft3',
    'cubic feet': 'ft3',
    'cubic metre': 'm3',
    // mass
    kg: 'kg',
    'kg.': 'kg',
    kilogram: 'kg',
    kilograms: 'kg',
    lb: 'lb',
    'lb.': 'lb',
    'l b.': 'lb',
    lbs: 'lb',
    pound: 'lb',
    pounds: 'lb',
    // count
    each: 'each',
    ea: 'each',
    'ea.': 'each',
    no: 'each',
    'no.': 'each',
    number: 'each',
    item: 'each',
    set: 'each',
    doz: 'dozen',
    dozen: 'dozen',
    'doz.': 'dozen',
    load: 'load',
    truckload: 'load',
    'truck load': 'load',
    lump: 'lump',
    lot: 'lump'
  };

  // Value of ONE unit in its family's canonical unit.
  //   area:   1 m2 = 10.7639 ft2 = 1.19599 yd2 = 0.107639 (100 sq ft)
  //   length: 1 m  = 3.28084 ft = 1.09361 yd = 39.3701 in = 0.01 (100mm)
  //   volume: 1 m3 = 35.3147 ft3 = 1.30795 yd3
  //   mass:   1 kg = 2.20462 lb
  //   count:  each = 1, dozen = 12, load/lump = 1
  var TO_CANON = {
    m2: 1,
    yd2: 0.83612736,
    ft2: 0.09290304,
    ft2x100: 9.290304,
    m: 1,
    km: 1000,
    cm: 0.01,
    ft: 0.3048,
    yd: 0.9144,
    in: 0.0254,
    mmx100: 0.1,
    m3: 1,
    ft3: 0.028316846592,
    yd3: 0.764554857984,
    kg: 1,
    lb: 0.45359237,
    each: 1,
    dozen: 12,
    load: 1,
    lump: 1
  };

  var FAMILY = {
    m2: 'area',
    yd2: 'area',
    ft2: 'area',
    ft2x100: 'area',
    m: 'length',
    km: 'length',
    cm: 'length',
    ft: 'length',
    yd: 'length',
    in: 'length',
    mmx100: 'length',
    m3: 'volume',
    ft3: 'volume',
    yd3: 'volume',
    kg: 'mass',
    lb: 'mass',
    each: 'count',
    dozen: 'count',
    load: 'count',
    lump: 'count'
  };

  var SYSTEM = {
    m2: 'metric',
    yd2: 'imp',
    ft2: 'imp',
    ft2x100: 'imp',
    m: 'metric',
    km: 'metric',
    cm: 'metric',
    ft: 'imp',
    yd: 'imp',
    in: 'imp',
    mmx100: 'metric',
    m3: 'metric',
    ft3: 'imp',
    yd3: 'imp',
    kg: 'metric',
    lb: 'imp',
    each: 'neutral',
    dozen: 'neutral',
    load: 'neutral',
    lump: 'neutral'
  };

  function normalize(u) {
    if (u == null) {
      return null;
    }
    var key = String(u).trim().toLowerCase().replace(/\s+/g, ' ');
    return ALIAS[key] || null;
  }
  function family(u) {
    var n = normalize(u);
    return n ? FAMILY[n] || null : null;
  }
  function system(u) {
    var n = normalize(u);
    return n ? SYSTEM[n] || 'neutral' : 'neutral';
  }
  // Quantity -> canonical unit of its family, or null if unknown.
  function toCanon(qty, u) {
    var n = normalize(u);
    if (!n || !TO_CANON[n]) {
      return null;
    }
    return qty * TO_CANON[n];
  }
  // Convert qty from one unit to another within the SAME family. Returns null
  // (fail closed) when either unit is unknown or the families differ - never a
  // silent 10x error.
  function convertQty(qty, from, to) {
    var nf = normalize(from);
    var nt = normalize(to);
    if (!nf || !nt) {
      return null;
    }
    if (FAMILY[nf] !== FAMILY[nt]) {
      return null;
    }
    var cf = TO_CANON[nf];
    var ct = TO_CANON[nt];
    if (!cf || !ct) {
      return null;
    }
    return (qty * cf) / ct;
  }

  // Human-readable label for a canonical unit key, used in the refusal
  // message so the user sees "square metre" rather than "m2".
  var LABEL = {
    m2: 'square metre',
    yd2: 'square yard',
    ft2: 'square foot',
    ft2x100: '100 square feet',
    m: 'metre',
    km: 'kilometre',
    cm: 'centimetre',
    ft: 'foot',
    yd: 'yard',
    in: 'inch',
    mmx100: '100 millimetre',
    m3: 'cubic metre',
    ft3: 'cubic foot',
    yd3: 'cubic yard',
    kg: 'kilogram',
    lb: 'pound',
    each: 'each',
    dozen: 'dozen',
    load: 'load',
    lump: 'lump'
  };
  function label(u) {
    var n = normalize(u);
    if (!n) {
      return String(u == null ? '' : u);
    }
    return LABEL[n] || n;
  }

  var RateUnits = {
    normalize: normalize,
    family: family,
    system: system,
    toCanon: toCanon,
    convertQty: convertQty,
    label: label,
    FAMILY: FAMILY,
    SYSTEM: SYSTEM,
    TO_CANON: TO_CANON,
    ALIAS: ALIAS,
    LABEL: LABEL
  };

  // Browser: attach to the global MMGR namespace. Node: export for the gate.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = RateUnits;
  }
  var root = typeof window !== 'undefined' ? window : global;
  if (root.MMGR && typeof root.MMGR === 'object') {
    root.MMGR.RateUnits = RateUnits;
  } else {
    root.MMGR = root.MMGR || {};
    root.MMGR.RateUnits = RateUnits;
  }
})(typeof window !== 'undefined' ? window : globalThis);
