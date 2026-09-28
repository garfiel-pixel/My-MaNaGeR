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
  slab:       { group: 'Groundworks', d1: 'Length (m)', d2: 'Width (m)', d3: 'Thickness (mm)',
    q: (a, b, c) => ({ qty: a * b * (c / 1000) * 1.05, unit: 'm3', qtyLabel: 'Concrete (incl. 5% waste)' }),
    rate: { mat: 150, lab: 85 }, matDesc: 'C20/25 ready-mix, mesh, vapor barrier' },
  footings:   { group: 'Groundworks', d1: 'Total run (m)', d2: 'Width (mm)', d3: 'Depth (mm)',
    q: (a, b, c) => ({ qty: a * (b / 1000) * (c / 1000) * 1.05, unit: 'm3', qtyLabel: 'Concrete (incl. 5% waste)' }),
    rate: { mat: 155, lab: 90 }, matDesc: 'C20/25, rebar cage allowance' },
  blockwall:  { group: 'Structure', d1: 'Length (m)', d2: 'Height (m)', d3: null,
    q: (a, b) => ({ qty: a * b, unit: 'm2', qtyLabel: 'Wall area' }),
    rate: { mat: 22, lab: 28 }, matDesc: 'Blocks (12.5/m2), mortar, ties' },
  brickwall:  { group: 'Structure', d1: 'Length (m)', d2: 'Height (m)', d3: null,
    q: (a, b) => ({ qty: a * b, unit: 'm2', qtyLabel: 'Wall area' }),
    rate: { mat: 34, lab: 42 }, matDesc: 'Bricks (60/m2), mortar, wall ties' },
  framing:    { group: 'Structure', d1: 'Length (m)', d2: 'Height (m)', d3: null,
    q: (a, b) => ({ qty: a * b, unit: 'm2', qtyLabel: 'Framed area' }),
    rate: { mat: 19, lab: 24 }, matDesc: 'Studs, plates, sheathing' },
  rebar:      { group: 'Structure', d1: 'Concrete volume (m3)', d2: null, d3: null,
    q: (a) => ({ qty: a * 85 / 1000, unit: 't', qtyLabel: 'Steel (85 kg per m3)' }),
    rate: { mat: 950, lab: 380 }, matDesc: 'Bars, ties, chairs, cutting waste' },
  roof:       { group: 'Envelope', d1: 'Length (m)', d2: 'Slope width (m)', d3: null,
    q: (a, b) => ({ qty: a * b * 1.1, unit: 'm2', qtyLabel: 'Sheet area (incl. 10% laps/pitch)' }),
    rate: { mat: 26, lab: 18 }, matDesc: 'Sheets, fixings, flashings' },
  render:     { group: 'Envelope', d1: 'Length (m)', d2: 'Height (m)', d3: null,
    q: (a, b) => ({ qty: a * b, unit: 'm2', qtyLabel: 'Rendered area' }),
    rate: { mat: 11, lab: 19 }, matDesc: 'Two-coat render, bead, primer' },
  paint:      { group: 'Envelope', d1: 'Length (m)', d2: 'Height (m)', d3: null,
    q: (a, b) => ({ qty: a * b * 2 / 10, unit: 'L', qtyLabel: 'Paint (2 coats at 10 m2/L)' }),
    rate: { mat: 14, lab: 11 }, matDesc: 'Emulsion, primer, rollers' },
  drywall:    { group: 'Envelope', d1: 'Length (m)', d2: 'Height (m)', d3: null,
    q: (a, b) => ({ qty: a * b, unit: 'm2', qtyLabel: 'Partition area' }),
    rate: { mat: 12, lab: 17 }, matDesc: 'Boards, studs, tape, screws' },
  tile:       { group: 'Finishes', d1: 'Length (m)', d2: 'Width (m)', d3: null,
    q: (a, b) => ({ qty: a * b * 1.1, unit: 'm2', qtyLabel: 'Tiles (incl. 10% cuts/waste)' }),
    rate: { mat: 24, lab: 32 }, matDesc: 'Tiles, adhesive, grout, trim' },
  'concrete-drive': { group: 'Finishes', d1: 'Length (m)', d2: 'Width (m)', d3: 'Thickness (mm)',
    q: (a, b, c) => ({ qty: a * b * (c / 1000) * 1.05, unit: 'm3', qtyLabel: 'Concrete (incl. 5% waste)' }),
    rate: { mat: 145, lab: 75 }, matDesc: 'C25/30 air-entrained, mesh, cure' },
  fencing:    { group: 'Finishes', d1: 'Total run (m)', d2: 'Height (m)', d3: null,
    q: (a, b) => ({ qty: a, unit: 'm', qtyLabel: 'Fence run' }),
    rate: { mat: (a, b) => 18 + Math.max(0, ((b || 1.8) - 1.2)) * 9, lab: 15 }, matDesc: 'Chain-link, posts, concrete backfill' }
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

// Approximate imperial reading for a metric quantity (display only).
function qtyAlt(qty, unit) {
  if (_units !== 'imperial') return '';
  const map = { m2: ['sq ft', 10.7639], m3: ['cu yd', 1.30795], m: ['ft', 3.28084], L: ['US gal', 0.264172] };
  const c = map[unit];
  if (!c) return '';
  return ' (about ' + (Math.round(qty * c[1] * 10) / 10).toLocaleString() + ' ' + c[0] + ')';
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

function compute() {
  const key = $('calc-work').value;
  const w = WORK[key];
  if (!w) return null;
  const raw1 = num($('calc-d1'));
  const raw2 = w.d2 ? num($('calc-d2')) : null;
  const raw3 = w.d3 ? num($('calc-d3')) : null;
  if (!raw1 || (w.d2 && !raw2) || (w.d3 && !raw3)) return { error: 'Enter the dimensions the form asks for (all three when thickness or depth applies).' };
  // Imperial entry converts to the metric the formulas speak (ft to m,
  // in to mm); metric passes through untouched.
  const imp = _units === 'imperial';
  const d1 = imp ? raw1 * FT : raw1;
  const d2 = w.d2 ? (imp ? raw2 * FT : raw2) : null;
  const d3 = w.d3 ? (imp ? raw3 * IN : raw3) : null;
  const qr = w.q(d1, d2, d3);
  const mr = matRate(w, d1, d2);
  const quality = QUALITY[($('calc-quality') || {}).value] || 1;
  const mat = qr.qty * mr * quality;
  const lab = qr.qty * w.rate.lab * quality;
  const country = ($('calc-country') || {}).value || 'US';
  const overrideRaw = parseFloat(($('calc-tax-override') || {}).value);
  const override = isFinite(overrideRaw) && overrideRaw >= 0 ? overrideRaw : null;
  const taxRate = override !== null ? override : (TAX[country] || 0);
  const sub = mat + lab;
  const tax = sub * taxRate / 100;
  return { key, name: workName(key), qty: qr.qty, unit: qr.unit, qtyLabel: qr.qtyLabel, matDesc: w.matDesc,
    mat, lab, sub, taxRate, tax, total: sub + tax, overrideApplied: override !== null, currency: ($('calc-currency') || {}).value };
}

// ---- Named estimates (F4-3): save / recall / delete, this device only ---
const NKEY = 'mmgr_calc_estimates';
function loadEstimates() { try { return JSON.parse(localStorage.getItem(NKEY) || '[]'); } catch (e) { return []; } }
function persistEstimates(list) { try { localStorage.setItem(NKEY, JSON.stringify(list.slice(0, 30))); } catch (e) { /* storage full - saving is a nicety, never a gate */ } }

function renderEstimates() {
  const wrap = $('calc-estimates');
  if (!wrap) return;
  const list = loadEstimates();
  if (!list.length) { wrap.innerHTML = '<div class="calc-empty">No saved estimates yet. Price something, then Save it with a name.</div>'; return; }
  wrap.innerHTML = list.map(function(est) {
    return '<div class="bcp-est-row">' +
      '<span class="bcp-est-name">' + esc(est.name) + '</span>' +
      '<span class="bcp-est-meta">' + esc(est.at) + ' - ' + esc(est.total) + '</span>' +
      '<button type="button" class="btn btn-n btn-s" data-action="calcOpen" data-id="' + esc(est.id) + '">Open</button>' +
      '<button type="button" class="btn btn-n btn-s" data-action="calcDeleteEst" data-id="' + esc(est.id) + '">Delete</button>' +
    '</div>';
  }).join('');
}

// ---- Export (F4-2): print + CSV of the live breakdown -------------------
function estimateCsv(r) {
  const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const rows = [
    ['Build Cost Calculator - My MaNaGeR'],
    ['Exported', new Date().toISOString().slice(0, 10)],
    ['Name', ($('#calc-save-name') || {}).value || r.name],
    ['Work item', r.name],
    ['Quantity', (Math.round(r.qty * 100) / 100) + ' ' + r.unit + qtyAlt(r.qty, r.unit)],
    ['Rate basis', r.matDesc],
    ['Finish level', ($('calc-quality') || {}).value || 'standard'],
    ['Currency', r.currency],
    ['Country', ($('calc-country') || {}).value || ''],
    ['Units entered', _units],
    ['Materials', Math.round(r.mat)],
    ['Labor', Math.round(r.lab)],
    ['Subtotal', Math.round(r.sub)],
    ['Tax rate %', r.taxRate],
    ['Tax', Math.round(r.tax)],
    ['Estimated total', Math.round(r.total)],
    [],
    ['Planning-grade estimate - not a quote.']
  ];
  return '\uFEFF' + rows.map(function(row) { return row.map(q).join(','); }).join('\r\n');
}

function slug(s) { return String(s || 'estimate').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'estimate'; }

function downloadCsv() {
  if (!lastResult) return;
  const blob = new Blob([estimateCsv(lastResult)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'estimate-' + slug(($('calc-save-name') || {}).value || lastResult.name) + '-' + new Date().toISOString().slice(0, 10) + '.csv';
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
  out.innerHTML =
    '<div class="calc-sum">' +
      '<div class="calc-sum-main"><span class="calc-sum-label">' + r.qtyLabel + '</span>' +
      '<strong class="calc-sum-qty">' + (Math.round(r.qty * 100) / 100) + ' ' + r.unit +
        '<span class="calc-qty-alt">' + esc(qtyAlt(r.qty, r.unit)) + '</span></strong></div>' +
      '<div class="calc-sum-sub">' + r.matDesc + '</div>' +
    '</div>' +
    row('Materials', fmtMoney(r.mat)) +
    row('Labor', fmtMoney(r.lab)) +
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

// ---- Actions (same data-action dispatch convention as the app) ----
const ACTIONS = {
  calcRun: function() {
    const r = render();
    if (r && !r.error) {
      saveHistory({ at: new Date().toISOString().slice(0, 10), name: r.name, qty: r.qty + ' ' + r.unit,
        total: fmtMoney(r.total), work: $('calc-work').value, d1: $('calc-d1').value, d2: ($('calc-d2') || {}).value || '',
        d3: ($('calc-d3') || {}).value || '', currency: r.currency, country: ($('calc-country') || {}).value,
        quality: ($('calc-quality') || {}).value, units: _units, dLabels: currentDimLabels() });
      renderHistory();
    }
  },
  calcClearHistory: function() {
    try { localStorage.removeItem(HKEY); } catch (e) {}
    renderHistory();
  },
  calcRestore: function(el) {
    const h = loadHistory()[parseInt(el.getAttribute('data-idx'), 10)];
    if (!h) return;
    if (h.units) setUnits(h.units, true);
    $('calc-work').value = h.work;
    syncLabels();
    $('calc-d1').value = h.d1 || '';
    if ($('calc-d2')) $('calc-d2').value = h.d2 || '';
    if ($('calc-d3')) $('calc-d3').value = h.d3 || '';
    if ($('calc-currency')) $('calc-currency').value = h.currency || 'USD';
    if ($('calc-country')) $('calc-country').value = h.country || 'US';
    if ($('calc-quality')) $('calc-quality').value = h.quality || 'standard';
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
  tglTheme: function() {
    // Same theme helper every page uses (mmgr-theme.js exposes MMGRTheme);
    // body.dark-mode + persistence are owned there, never duplicated here.
    if (window.MMGRTheme && MMGRTheme.setMode) { MMGRTheme.setMode(MMGRTheme.isDark() ? 'light' : 'dark'); return; }
    document.body.classList.toggle('dark-mode');
    try { localStorage.setItem('mmgr_theme', document.body.classList.contains('dark-mode') ? 'dark' : 'light'); } catch (e) {}
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
    list.unshift({
      id: 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name,
      at: new Date().toISOString().slice(0, 10),
      total: fmtMoney(lastResult.total),
      work: $('calc-work').value,
      d1: $('calc-d1').value, d2: ($('calc-d2') || {}).value || '', d3: ($('calc-d3') || {}).value || '',
      currency: lastResult.currency, country: ($('calc-country') || {}).value,
      quality: ($('calc-quality') || {}).value, units: _units,
      taxOverride: ($('calc-tax-override') || {}).value || ''
    });
    persistEstimates(list);
    if (nameEl) nameEl.value = '';
    renderEstimates();
  },
  calcOpen: function(el) {
    const est = loadEstimates().find(function(x) { return x.id === el.getAttribute('data-id'); });
    if (!est) return;
    if (est.units) setUnits(est.units, true);
    $('calc-work').value = est.work;
    syncLabels();
    $('calc-d1').value = est.d1 || '';
    if ($('calc-d2')) $('calc-d2').value = est.d2 || '';
    if ($('calc-d3')) $('calc-d3').value = est.d3 || '';
    if ($('calc-currency')) $('calc-currency').value = est.currency || 'USD';
    if ($('calc-country')) $('calc-country').value = est.country || 'US';
    if ($('calc-quality')) $('calc-quality').value = est.quality || 'standard';
    if ($('calc-tax-override')) $('calc-tax-override').value = est.taxOverride || '';
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },
  calcDeleteEst: function(el) {
    const id = el.getAttribute('data-id');
    persistEstimates(loadEstimates().filter(function(x) { return x.id !== id; }));
    renderEstimates();
  }
};

document.addEventListener('click', function(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = ACTIONS[el.getAttribute('data-action')];
  if (fn) fn(el);
});

// Print scope is class-scoped; window.print() blocks, so remove the class
// right after it returns (covers the common browsers' dialog lifecycle;
// afterprint is the standards path where it fires).
window.addEventListener('afterprint', function() { document.body.classList.remove('print-estimate'); });

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
}

// Labels as entered right now (stored with history so a recalled row
// re-labels itself in the unit system it was typed in).
function currentDimLabels() {
  const w = WORK[($('calc-work') || {}).value];
  if (!w) return [];
  return [dimLabel(w, 'd1'), dimLabel(w, 'd2'), dimLabel(w, 'd3')].filter(Boolean);
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
  ['calc-currency', 'calc-country', 'calc-quality', 'calc-tax-override', 'calc-d1', 'calc-d2', 'calc-d3']
    .forEach(function(id) { const el = $(id); if (el) el.addEventListener('input', function() { render(); }); });
  // Saved unit system comes back before first interaction; silent keeps the
  // empty-state text until the user actually enters dimensions.
  let savedUnits = 'metric';
  try { savedUnits = localStorage.getItem('mmgr_calc_units') || 'metric'; } catch (e) {}
  setUnits(savedUnits, true);
}
renderHistory();
renderEstimates();
})();
