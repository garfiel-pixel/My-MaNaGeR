/* ============================================================
   My MaNaGeR - Floating Draggable Calculator
   ============================================================
   A floating calculator that can be dragged anywhere on screen.
   Toggle from Controls drawer or section calculator icons.
   Tap to expand, X to retract. Smooth spring animations.
   ============================================================ */
(function() {
  'use strict';

  var ns = window.MMGR = window.MMGR || {};
  ns.Calculator = ns.Calculator || {};

  var _icon = null;      // the draggable circular FAB
  var _panel = null;     // the calculator panel
  var _open = false;
  var _dragging = false;
  var _dragOffset = { x: 0, y: 0 };
  var _activeTab = 'general';
  var _history = [];     // recent calculations

  /* ── Calculator categories ── */
  var TABS = [
    { id: 'general', label: 'General', icon: 'i-calculator' },
    { id: 'pct', label: 'Percent', icon: 'i-percent' },
    { id: 'area', label: 'Area', icon: 'i-ruler' },
    { id: 'convert', label: 'Convert', icon: 'i-swap' },
    { id: 'markup', label: 'Markup', icon: 'i-tag' },
    { id: 'cost', label: 'Cost Est.', icon: 'i-dollar' },
    // Phase 5 (owner D1/A1-A8): construction trades, bid & finance,
    // site & geometry, and project EVM. General is always on; every
    // other tab can be toggled in the panel-head gear (Settings).
    { id: 'trades', label: 'Trades', icon: 'i-hardhat' },
    { id: 'finance', label: 'Bid & Fin.', icon: 'i-trending-up' },
    { id: 'site', label: 'Site & Geo', icon: 'i-crosshair' },
    { id: 'evm', label: 'EVM', icon: 'i-bar-chart' }
  ];

  /* ── Phase 5 settings: which tabs are enabled (owner D1/A5) ── */
  // General is always on (it is the arithmetic core); every other tab is
  // toggleable. Persisted as a JSON array of enabled tab ids. Non-construction
  // users can switch the trade calculators off entirely.
  var CALC_SETTINGS_KEY = 'mmgr_calc_tabs';
  var _enabledTabs = null;

  function loadEnabledTabs() {
    if (_enabledTabs !== null) return _enabledTabs;
    // Default: every tab on. General is the arithmetic core and is never
    // stored (it is always on); the others persist as a JSON array.
    var names = ['general'].concat(TABS.map(function(t) { return t.id; }).filter(function(id) { return id !== 'general'; }));
    try {
      var stored = localStorage.getItem(CALC_SETTINGS_KEY);
      if (stored) {
        var arr = JSON.parse(stored);
        if (Array.isArray(arr)) {
          arr = arr.filter(function(id) {
            return id !== 'general' && TABS.some(function(t) { return t.id === id; });
          });
          arr.unshift('general');
          names = arr;
        }
      }
    } catch (e) { /* storage unavailable - keep defaults */ }
    _enabledTabs = names;
    return _enabledTabs;
  }

  function saveEnabledTabs(list) {
    _enabledTabs = list;
    try { localStorage.setItem(CALC_SETTINGS_KEY, JSON.stringify(list)); } catch (e) { /* quota/denied - in-memory only */ }
  }

  function isTabVisible(id) {
    return id === 'general' || loadEnabledTabs().indexOf(id) > -1;
  }

  /* ── Unit conversions (factor = multiply input to get output) ── */
  var CONVERSIONS = {
    length: [
      { from: 'ft', to: 'm', factor: 0.3048 },
      { from: 'm', to: 'ft', factor: 3.28084 },
      { from: 'in', to: 'cm', factor: 2.54 },
      { from: 'cm', to: 'in', factor: 0.393701 },
      { from: 'yd', to: 'm', factor: 0.9144 },
      { from: 'm', to: 'yd', factor: 1.09361 },
      { from: 'mi', to: 'km', factor: 1.60934 },
      { from: 'km', to: 'mi', factor: 0.621371 }
    ],
    area: [
      { from: 'sqft', to: 'sqm', factor: 0.092903 },
      { from: 'sqm', to: 'sqft', factor: 10.7639 },
      { from: 'acre', to: 'ha', factor: 0.404686 },
      { from: 'ha', to: 'acre', factor: 2.47105 },
      { from: 'sqyd', to: 'sqm', factor: 0.836127 },
      { from: 'sqm', to: 'sqyd', factor: 1.19599 }
    ],
    weight: [
      { from: 'lb', to: 'kg', factor: 0.453592 },
      { from: 'kg', to: 'lb', factor: 2.20462 },
      { from: 'ton', to: 'kg', factor: 907.185 },
      { from: 'kg', to: 'ton', factor: 0.00110231 },
      { from: 'oz', to: 'g', factor: 28.3495 },
      { from: 'g', to: 'oz', factor: 0.035274 }
    ],
    volume: [
      { from: 'gal', to: 'L', factor: 3.78541 },
      { from: 'L', to: 'gal', factor: 0.264172 },
      { from: 'cuft', to: 'cum', factor: 0.0283168 },
      { from: 'cum', to: 'cuft', factor: 35.3147 },
      { from: 'bbl', to: 'L', factor: 158.987 }
    ],
    concrete: [
      { from: 'cuft', to: 'cuyd', factor: 0.037037 },
      { from: 'cuyd', to: 'cuft', factor: 27 },
      { from: 'sqft_4in', to: 'cuyd', factor: 0.0123457 },
      { from: 'sqft_6in', to: 'cuyd', factor: 0.0185185 }
    ]
  };

  /* ── Build the DOM ── */
  function build() {
    if (_icon) return;

    // FAB icon
    _icon = document.createElement('button');
    _icon.type = 'button';
    _icon.id = 'calc-fab';
    _icon.className = 'calc-fab';
    _icon.setAttribute('aria-label', 'Open calculator');
    _icon.setAttribute('title', 'Calculator');
    _icon.innerHTML = '<svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-calculator"></use></svg>';
    // bottom clears the shared bottom dock (--dock-h) so the FAB never hides
    // behind it on any screen width (owner D3, 2026-09-03).
    _icon.style.cssText = 'position:fixed;bottom:calc(var(--dock-h, 120px) + 18px);right:24px;z-index:1500;display:none;';
    document.body.appendChild(_icon);

    // Calculator panel
    _panel = document.createElement('div');
    _panel.id = 'calc-panel';
    _panel.className = 'calc-panel';
    _panel.setAttribute('role', 'dialog');
    _panel.setAttribute('aria-label', 'Calculator');
    _panel.innerHTML = buildPanelHTML();
    document.body.appendChild(_panel);

    // Event listeners
    _icon.addEventListener('mousedown', onIconMouseDown);
    _icon.addEventListener('touchstart', onIconTouchStart, { passive: false });
    _icon.addEventListener('click', onIconClick);

    // Panel close button
    _panel.querySelector('.calc-close').addEventListener('click', close);

    // Tab switching
    _panel.querySelectorAll('.calc-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        switchTab(tab.getAttribute('data-tab'));
      });
    });

    // Wire up all calculator inputs
    wireInputs();
  }

  function buildPanelHTML() {
    var visible = TABS.filter(function(t) { return isTabVisible(t.id); });
    var tabsHtml = visible.map(function(t) {
      return '<button type="button" class="calc-tab' + (t.id === 'general' ? ' active' : '') + '" data-tab="' + t.id + '">' + t.label + '</button>';
    }).join('');

    return '<div class="calc-head">' +
      '<span class="calc-title"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-calculator"></use></svg> Calculator</span>' +
      '<span class="calc-head-actions">' +
        '<button type="button" class="calc-gear" id="calc-gear" aria-label="Calculator settings" aria-expanded="false" aria-controls="calc-settings-section" title="Calculator settings"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-settings"></use></svg></button>' +
        '<button type="button" class="calc-close" aria-label="Close calculator"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-x"></use></svg></button>' +
      '</span>' +
      '</div>' +
      '<div class="calc-tabs">' + tabsHtml + '</div>' +
      '<div class="calc-body">' +
        buildGeneralTab() +
        buildPctTab() +
        buildAreaTab() +
        buildConvertTab() +
        buildMarkupTab() +
        buildCostTab() +
        buildTradesTab() +
        buildFinanceTab() +
        buildSiteTab() +
        buildEvmTab() +
        buildSettingsTab() +
      '</div>' +
      '<div class="calc-history" id="calc-history" hidden></div>';
  }

  /* ── General (basic arithmetic) ── */
  function buildGeneralTab() {
    return '<div class="calc-section" data-calc="general">' +
      '<div class="calc-display"><input type="text" id="calc-display" class="calc-display-input" readonly value="0" aria-label="Calculator display"></div>' +
      '<div class="calc-grid">' +
        '<button type="button" class="calc-btn calc-fn" data-gc="clear">C</button>' +
        '<button type="button" class="calc-btn calc-fn" data-gc="backspace">&#9003;</button>' +
        '<button type="button" class="calc-btn calc-fn" data-gc="percent">%</button>' +
        '<button type="button" class="calc-btn calc-op" data-gc="op" data-op="/">÷</button>' +
        '<button type="button" class="calc-btn calc-num" data-gc="num" data-n="7">7</button>' +
        '<button type="button" class="calc-btn calc-num" data-gc="num" data-n="8">8</button>' +
        '<button type="button" class="calc-btn calc-num" data-gc="num" data-n="9">9</button>' +
        '<button type="button" class="calc-btn calc-op" data-gc="op" data-op="*">×</button>' +
        '<button type="button" class="calc-btn calc-num" data-gc="num" data-n="4">4</button>' +
        '<button type="button" class="calc-btn calc-num" data-gc="num" data-n="5">5</button>' +
        '<button type="button" class="calc-btn calc-num" data-gc="num" data-n="6">6</button>' +
        '<button type="button" class="calc-btn calc-op" data-gc="op" data-op="-">−</button>' +
        '<button type="button" class="calc-btn calc-num" data-gc="num" data-n="1">1</button>' +
        '<button type="button" class="calc-btn calc-num" data-gc="num" data-n="2">2</button>' +
        '<button type="button" class="calc-btn calc-num" data-gc="num" data-n="3">3</button>' +
        '<button type="button" class="calc-btn calc-op" data-gc="op" data-op="+">+</button>' +
        '<button type="button" class="calc-btn calc-num calc-wide" data-gc="num" data-n="0">0</button>' +
        '<button type="button" class="calc-btn calc-num" data-gc="decimal">.</button>' +
        '<button type="button" class="calc-btn calc-eq" data-gc="equals">=</button>' +
      '</div>' +
    '</div>';
  }

  /* ── Percentage calculator ── */
  function buildPctTab() {
    return '<div class="calc-section is-hide" data-calc="pct">' +
      '<div class="calc-card">' +
        '<div class="calc-card-title">What is X% of Y?</div>' +
        '<div class="calc-field"><label for="pct-x">Percentage</label><input type="number" id="pct-x" placeholder="16.5" step="any"></div>' +
        '<div class="calc-field"><label for="pct-y">of</label><input type="number" id="pct-y" placeholder="900000000" step="any"></div>' +
        '<button type="button" class="calc-action" data-calc-action="pct-of">Calculate</button>' +
        '<div class="calc-result" id="pct-result" hidden></div>' +
      '</div>' +
      '<div class="calc-card">' +
        '<div class="calc-card-title">X is what % of Y?</div>' +
        '<div class="calc-field"><label for="pct-a">Value</label><input type="number" id="pct-a" placeholder="150" step="any"></div>' +
        '<div class="calc-field"><label for="pct-b">of</label><input type="number" id="pct-b" placeholder="1000" step="any"></div>' +
        '<button type="button" class="calc-action" data-calc-action="pct-is-what">Calculate</button>' +
        '<div class="calc-result" id="pct-result2" hidden></div>' +
      '</div>' +
      '<div class="calc-card">' +
        '<div class="calc-card-title">% Change from A to B</div>' +
        '<div class="calc-field"><label for="pct-from">From</label><input type="number" id="pct-from" placeholder="800" step="any"></div>' +
        '<div class="calc-field"><label for="pct-to">To</label><input type="number" id="pct-to" placeholder="960" step="any"></div>' +
        '<button type="button" class="calc-action" data-calc-action="pct-change">Calculate</button>' +
        '<div class="calc-result" id="pct-result3" hidden></div>' +
      '</div>' +
    '</div>';
  }

  /* ── Area calculator ── */
  function buildAreaTab() {
    return '<div class="calc-section is-hide" data-calc="area">' +
      '<div class="calc-card">' +
        '<div class="calc-card-title">Rectangle</div>' +
        '<div class="calc-field-row">' +
          '<div class="calc-field"><label for="area-rect-w">Width</label><input type="number" id="area-rect-w" placeholder="0" step="any"></div>' +
          '<div class="calc-field"><label for="area-rect-h">Height</label><input type="number" id="area-rect-h" placeholder="0" step="any"></div>' +
        '</div>' +
        '<button type="button" class="calc-action" data-calc-action="area-rect">Calculate</button>' +
        '<div class="calc-result" id="area-rect-result" hidden></div>' +
      '</div>' +
      '<div class="calc-card">' +
        '<div class="calc-card-title">Triangle (3 sides)</div>' +
        '<div class="calc-field-row">' +
          '<div class="calc-field"><label for="area-tri-a">Side A</label><input type="number" id="area-tri-a" placeholder="0" step="any"></div>' +
          '<div class="calc-field"><label for="area-tri-b">Side B</label><input type="number" id="area-tri-b" placeholder="0" step="any"></div>' +
          '<div class="calc-field"><label for="area-tri-c">Side C</label><input type="number" id="area-tri-c" placeholder="0" step="any"></div>' +
        '</div>' +
        '<button type="button" class="calc-action" data-calc-action="area-tri">Calculate</button>' +
        '<div class="calc-result" id="area-tri-result" hidden></div>' +
      '</div>' +
      '<div class="calc-card">' +
        '<div class="calc-card-title">Circle</div>' +
        '<div class="calc-field"><label for="area-circ-r">Radius</label><input type="number" id="area-circ-r" placeholder="0" step="any"></div>' +
        '<button type="button" class="calc-action" data-calc-action="area-circle">Calculate</button>' +
        '<div class="calc-result" id="area-circle-result" hidden></div>' +
      '</div>' +
      '<div class="calc-card">' +
        '<div class="calc-card-title">Trapezoid</div>' +
        '<div class="calc-field-row">' +
          '<div class="calc-field"><label for="area-trap-a">Parallel A</label><input type="number" id="area-trap-a" placeholder="0" step="any"></div>' +
          '<div class="calc-field"><label for="area-trap-b">Parallel B</label><input type="number" id="area-trap-b" placeholder="0" step="any"></div>' +
        '</div>' +
        '<div class="calc-field"><label for="area-trap-h">Height</label><input type="number" id="area-trap-h" placeholder="0" step="any"></div>' +
        '<button type="button" class="calc-action" data-calc-action="area-trap">Calculate</button>' +
        '<div class="calc-result" id="area-trap-result" hidden></div>' +
      '</div>' +
    '</div>';
  }

  /* ── Unit conversion ── */
  function buildConvertTab() {
    var lengthOpts = CONVERSIONS.length.map(function(c) {
      return '<option value="' + c.from + '-' + c.to + '">' + c.from.toUpperCase() + ' → ' + c.to.toUpperCase() + '</option>';
    }).join('');
    var areaOpts = CONVERSIONS.area.map(function(c) {
      return '<option value="' + c.from + '-' + c.to + '">' + c.from.toUpperCase() + ' → ' + c.to.toUpperCase() + '</option>';
    }).join('');
    var weightOpts = CONVERSIONS.weight.map(function(c) {
      return '<option value="' + c.from + '-' + c.to + '">' + c.from.toUpperCase() + ' → ' + c.to.toUpperCase() + '</option>';
    }).join('');
    var volOpts = CONVERSIONS.volume.map(function(c) {
      return '<option value="' + c.from + '-' + c.to + '">' + c.from.toUpperCase() + ' → ' + c.to.toUpperCase() + '</option>';
    }).join('');
    var concOpts = CONVERSIONS.concrete.map(function(c) {
      return '<option value="' + c.from + '-' + c.to + '">' + c.from + ' → ' + c.to + '</option>';
    }).join('');

    return '<div class="calc-section is-hide" data-calc="convert">' +
      '<div class="calc-card">' +
        '<div class="calc-card-title">Unit Conversion</div>' +
        '<div class="calc-field"><label for="conv-cat">Category</label>' +
          '<select id="conv-cat"><option value="length">Length</option><option value="area">Area</option><option value="weight">Weight</option><option value="volume">Volume</option><option value="concrete">Concrete</option></select></div>' +
        '<div class="calc-field"><label for="conv-pair">Conversion</label>' +
          '<select id="conv-pair">' + lengthOpts + '</select></div>' +
        '<div class="calc-field"><label for="conv-val">Value</label><input type="number" id="conv-val" placeholder="0" step="any"></div>' +
        '<button type="button" class="calc-action" data-calc-action="convert">Convert</button>' +
        '<div class="calc-result" id="conv-result" hidden></div>' +
      '</div>' +
      '<div class="calc-card">' +
        '<div class="calc-card-title">Concrete Volume</div>' +
        '<div class="calc-field-row">' +
          '<div class="calc-field"><label for="conc-l">Length</label><input type="number" id="conc-l" placeholder="ft" step="any"></div>' +
          '<div class="calc-field"><label for="conc-w">Width</label><input type="number" id="conc-w" placeholder="ft" step="any"></div>' +
        '</div>' +
        '<div class="calc-field-row">' +
          '<div class="calc-field"><label for="conc-d">Depth</label><input type="number" id="conc-d" placeholder="in" step="any"></div>' +
          '<div class="calc-field"><label for="conc-waste">Waste %</label><input type="number" id="conc-waste" placeholder="10" step="any" value="10"></div>' +
        '</div>' +
        '<button type="button" class="calc-action" data-calc-action="conc-vol">Calculate</button>' +
        '<div class="calc-result" id="conc-result" hidden></div>' +
      '</div>' +
    '</div>';
  }

  /* ── Markup & margin ── */
  function buildMarkupTab() {
    return '<div class="calc-section is-hide" data-calc="markup">' +
      '<div class="calc-card">' +
        '<div class="calc-card-title">Markup % on Cost</div>' +
        '<div class="calc-field"><label for="mk-cost">Cost</label><input type="number" id="mk-cost" placeholder="0" step="any"></div>' +
        '<div class="calc-field"><label for="mk-pct">Markup %</label><input type="number" id="mk-pct" placeholder="15" step="any" value="15"></div>' +
        '<button type="button" class="calc-action" data-calc-action="markup">Calculate</button>' +
        '<div class="calc-result" id="mk-result" hidden></div>' +
      '</div>' +
      '<div class="calc-card">' +
        '<div class="calc-card-title">Margin % on Selling Price</div>' +
        '<div class="calc-field"><label for="mg-cost">Cost</label><input type="number" id="mg-cost" placeholder="0" step="any"></div>' +
        '<div class="calc-field"><label for="mg-pct">Margin %</label><input type="number" id="mg-pct" placeholder="20" step="any" value="20"></div>' +
        '<button type="button" class="calc-action" data-calc-action="margin">Calculate</button>' +
        '<div class="calc-result" id="mg-result" hidden></div>' +
      '</div>' +
      '<div class="calc-card">' +
        '<div class="calc-card-title">Discount</div>' +
        '<div class="calc-field"><label for="disc-price">Price</label><input type="number" id="disc-price" placeholder="0" step="any"></div>' +
        '<div class="calc-field"><label for="disc-pct">Discount %</label><input type="number" id="disc-pct" placeholder="10" step="any" value="10"></div>' +
        '<button type="button" class="calc-action" data-calc-action="discount">Calculate</button>' +
        '<div class="calc-result" id="disc-result" hidden></div>' +
      '</div>' +
      '<div class="calc-card">' +
        '<div class="calc-card-title">Tax</div>' +
        '<div class="calc-field"><label for="tax-amt">Amount</label><input type="number" id="tax-amt" placeholder="0" step="any"></div>' +
        '<div class="calc-field"><label for="tax-pct">Tax %</label><input type="number" id="tax-pct" placeholder="8.5" step="any" value="8.5"></div>' +
        '<button type="button" class="calc-action" data-calc-action="tax">Calculate</button>' +
        '<div class="calc-result" id="tax-result" hidden></div>' +
      '</div>' +
    '</div>';
  }

  /* ── Cost estimation ── */
  function buildCostTab() {
    return '<div class="calc-section is-hide" data-calc="cost">' +
      '<div class="calc-card">' +
        '<div class="calc-card-title">Unit Cost</div>' +
        '<div class="calc-field-row">' +
          '<div class="calc-field"><label for="uc-qty">Quantity</label><input type="number" id="uc-qty" placeholder="0" step="any"></div>' +
          '<div class="calc-field"><label for="uc-rate">Rate ($/unit)</label><input type="number" id="uc-rate" placeholder="0" step="any"></div>' +
        '</div>' +
        '<button type="button" class="calc-action" data-calc-action="unit-cost">Calculate</button>' +
        '<div class="calc-result" id="uc-result" hidden></div>' +
      '</div>' +
      '<div class="calc-card">' +
        '<div class="calc-card-title">Labor Cost</div>' +
        '<div class="calc-field-row">' +
          '<div class="calc-field"><label for="lc-hrs">Hours</label><input type="number" id="lc-hrs" placeholder="0" step="any"></div>' +
          '<div class="calc-field"><label for="lc-rate">Rate ($/hr)</label><input type="number" id="lc-rate" placeholder="0" step="any"></div>' +
        '</div>' +
        '<div class="calc-field-row">' +
          '<div class="calc-field"><label for="lc-people">Workers</label><input type="number" id="lc-people" placeholder="1" step="1" value="1"></div>' +
          '<div class="calc-field"><label for="lc-days">Days</label><input type="number" id="lc-days" placeholder="1" step="1" value="1"></div>' +
        '</div>' +
        '<button type="button" class="calc-action" data-calc-action="labor-cost">Calculate</button>' +
        '<div class="calc-result" id="lc-result" hidden></div>' +
      '</div>' +
      '<div class="calc-card">' +
        '<div class="calc-card-title">Material Cost (with waste)</div>' +
        '<div class="calc-field-row">' +
          '<div class="calc-field"><label for="mat-qty">Quantity</label><input type="number" id="mat-qty" placeholder="0" step="any"></div>' +
          '<div class="calc-field"><label for="mat-rate">Rate ($/unit)</label><input type="number" id="mat-rate" placeholder="0" step="any"></div>' +
        '</div>' +
        '<div class="calc-field"><label for="mat-waste">Waste %</label><input type="number" id="mat-waste" placeholder="10" step="any" value="10"></div>' +
        '<button type="button" class="calc-action" data-calc-action="material-cost">Calculate</button>' +
        '<div class="calc-result" id="mat-result" hidden></div>' +
      '</div>' +
      '<div class="calc-card">' +
        '<div class="calc-card-title">Contingency</div>' +
        '<div class="calc-field"><label for="ct-base">Base Cost</label><input type="number" id="ct-base" placeholder="0" step="any"></div>' +
        '<div class="calc-field"><label for="ct-pct">Contingency %</label><input type="number" id="ct-pct" placeholder="10" step="any" value="10"></div>' +
        '<button type="button" class="calc-action" data-calc-action="contingency">Calculate</button>' +
        '<div class="calc-result" id="ct-result" hidden></div>' +
      '</div>' +
    '</div>';
  }

  /* ── Construction trades (Phase 5 / A1) ── */
  function buildTradesTab() {
    return '<div class="calc-section is-hide" data-calc="trades">' +
      '<div class="calc-card">' +
        '<div class="calc-card-title">Concrete - Slab / Footing / Wall volume</div>' +
        '<div class="calc-field-row">' +
          '<div class="calc-field"><label for="tr-l">Length</label><input type="number" id="tr-l" placeholder="ft" step="any"></div>' +
          '<div class="calc-field"><label for="tr-w">Width</label><input type="number" id="tr-w" placeholder="ft" step="any"></div>' +
        '</div>' +
        '<div class="calc-field-row">' +
          '<div class="calc-field"><label for="tr-t">Thickness</label><input type="number" id="tr-t" placeholder="in" step="any"></div>' +
          '<div class="calc-field"><label for="tr-waste">Waste %</label><input type="number" id="tr-waste" placeholder="5" step="any" value="5"></div>' +
        '</div>' +
        '<button type="button" class="calc-action" data-calc-action="tr-pour">Calculate</button>' +
        '<div class="calc-result" id="tr-pour-result" hidden></div>' +
      '</div>' +
      '<div class="calc-card">' +
        '<div class="calc-card-title">Concrete - Column / Cylinder</div>' +
        '<div class="calc-field-row">' +
          '<div class="calc-field"><label for="tr-col-d">Diameter</label><input type="number" id="tr-col-d" placeholder="ft" step="any"></div>' +
          '<div class="calc-field"><label for="tr-col-h">Height</label><input type="number" id="tr-col-h" placeholder="ft" step="any"></div>' +
        '</div>' +
        '<div class="calc-field"><label for="tr-col-n">Number of columns</label><input type="number" id="tr-col-n" placeholder="1" step="1" value="1"></div>' +
        '<button type="button" class="calc-action" data-calc-action="tr-cylinder">Calculate</button>' +
        '<div class="calc-result" id="tr-cylinder-result" hidden></div>' +
      '</div>' +
      '<div class="calc-card">' +
        '<div class="calc-card-title">Masonry - Block / Brick count + mortar</div>' +
        '<div class="calc-field-row">' +
          '<div class="calc-field"><label for="tr-mw">Wall width</label><input type="number" id="tr-mw" placeholder="ft" step="any"></div>' +
          '<div class="calc-field"><label for="tr-mh">Wall height</label><input type="number" id="tr-mh" placeholder="ft" step="any"></div>' +
        '</div>' +
        '<div class="calc-field-row">' +
          '<div class="calc-field"><label for="tr-msz">Unit</label><select id="tr-msz"><option value="block16">16x8x8 block</option><option value="block8">8x8x8 block</option><option value="brick">Brick (3.6x2.3)</option></select></div>' +
          '<div class="calc-field"><label for="tr-mwaste">Waste %</label><input type="number" id="tr-mwaste" placeholder="5" step="any" value="5"></div>' +
        '</div>' +
        '<button type="button" class="calc-action" data-calc-action="tr-masonry">Calculate</button>' +
        '<div class="calc-result" id="tr-masonry-result" hidden></div>' +
      '</div>' +
      '<div class="calc-card">' +
        '<div class="calc-card-title">Earthwork - Cut / Fill + swell factor</div>' +
        '<div class="calc-field-row">' +
          '<div class="calc-field"><label for="tr-el">Length</label><input type="number" id="tr-el" placeholder="ft" step="any"></div>' +
          '<div class="calc-field"><label for="tr-ew">Width</label><input type="number" id="tr-ew" placeholder="ft" step="any"></div>' +
        '</div>' +
        '<div class="calc-field-row">' +
          '<div class="calc-field"><label for="tr-ed">Depth</label><input type="number" id="tr-ed" placeholder="ft" step="any"></div>' +
          '<div class="calc-field"><label for="tr-eswell">Swell %</label><input type="number" id="tr-eswell" placeholder="20" step="any" value="20"></div>' +
        '</div>' +
        '<button type="button" class="calc-action" data-calc-action="tr-earth">Calculate</button>' +
        '<div class="calc-result" id="tr-earth-result" hidden></div>' +
      '</div>' +
      '<div class="calc-card">' +
        '<div class="calc-card-title">Roofing - Pitch to slope, area, squares</div>' +
        '<div class="calc-field-row">' +
          '<div class="calc-field"><label for="tr-ff">Footprint area</label><input type="number" id="tr-ff" placeholder="sq ft" step="any"></div>' +
          '<div class="calc-field"><label for="tr-rise">Rise (in per 12)</label><input type="number" id="tr-rise" placeholder="6" step="any" value="6"></div>' +
        '</div>' +
        '<button type="button" class="calc-action" data-calc-action="tr-roof">Calculate</button>' +
        '<div class="calc-result" id="tr-roof-result" hidden></div>' +
      '</div>' +
      '<div class="calc-card">' +
        '<div class="calc-card-title">Framing - Studs, plates, rafters</div>' +
        '<div class="calc-field-row">' +
          '<div class="calc-field"><label for="tr-fw">Wall length</label><input type="number" id="tr-fw" placeholder="ft" step="any"></div>' +
          '<div class="calc-field"><label for="tr-fh">Wall height</label><input type="number" id="tr-fh" placeholder="ft" step="any"></div>' +
        '</div>' +
        '<div class="calc-field-row">' +
          '<div class="calc-field"><label for="tr-foc">Spacing (in)</label><select id="tr-foc"><option value="16">16 in</option><option value="24">24 in</option></select></div>' +
          '<div class="calc-field"><label for="tr-fwaste">Waste %</label><input type="number" id="tr-fwaste" placeholder="10" step="any" value="10"></div>' +
        '</div>' +
        '<button type="button" class="calc-action" data-calc-action="tr-framing">Calculate</button>' +
        '<div class="calc-result" id="tr-framing-result" hidden></div>' +
      '</div>' +
      '<div class="calc-card">' +
        '<div class="calc-card-title">Stairs - Risers, treads, stringer</div>' +
        '<div class="calc-field-row">' +
          '<div class="calc-field"><label for="tr-sr">Total rise</label><input type="number" id="tr-sr" placeholder="in" step="any"></div>' +
          '<div class="calc-field"><label for="tr-srun">Total run</label><input type="number" id="tr-srun" placeholder="in" step="any"></div>' +
        '</div>' +
        '<div class="calc-field"><label for="tr-smax">Max riser</label><input type="number" id="tr-smax" placeholder="7.75" step="any" value="7.75"></div>' +
        '<button type="button" class="calc-action" data-calc-action="tr-stairs">Calculate</button>' +
        '<div class="calc-result" id="tr-stairs-result" hidden></div>' +
      '</div>' +
      '<div class="calc-card">' +
        '<div class="calc-card-title">Finish - Paint, drywall, tile</div>' +
        '<div class="calc-field-row">' +
          '<div class="calc-field"><label for="tr-paint-sf">Paint area</label><input type="number" id="tr-paint-sf" placeholder="sq ft" step="any"></div>' +
          '<div class="calc-field"><label for="tr-paint-coat">Coats</label><input type="number" id="tr-paint-coat" placeholder="2" step="1" value="2"></div>' +
        '</div>' +
        '<button type="button" class="calc-action" data-calc-action="tr-paint">Calculate paint</button>' +
        '<div class="calc-result" id="tr-paint-result" hidden></div>' +
        '<div class="calc-field-row" style="margin-top:8px">' +
          '<div class="calc-field"><label for="tr-dry-sf">Drywall area</label><input type="number" id="tr-dry-sf" placeholder="sq ft" step="any"></div>' +
        '</div>' +
        '<button type="button" class="calc-action" data-calc-action="tr-drywall">Calculate drywall</button>' +
        '<div class="calc-result" id="tr-drywall-result" hidden></div>' +
        '<div class="calc-field-row" style="margin-top:8px">' +
          '<div class="calc-field"><label for="tr-tile-sf">Floor area</label><input type="number" id="tr-tile-sf" placeholder="sq ft" step="any"></div>' +
          '<div class="calc-field"><label for="tr-tile-sz">Tile (in)</label><select id="tr-tile-sz"><option value="12">12 x 12</option><option value="18">18 x 18</option><option value="24">24 x 24</option><option value="6">6 x 6</option></select></div>' +
        '</div>' +
        '<button type="button" class="calc-action" data-calc-action="tr-tile">Calculate tile</button>' +
        '<div class="calc-result" id="tr-tile-result" hidden></div>' +
      '</div>' +
      '<div class="calc-card">' +
        '<div class="calc-card-title">Paving - Asphalt tonnage, trench volume</div>' +
        '<div class="calc-field-row">' +
          '<div class="calc-field"><label for="tr-asp-sf">Pave area</label><input type="number" id="tr-asp-sf" placeholder="sq ft" step="any"></div>' +
          '<div class="calc-field"><label for="tr-asp-t">Thickness</label><input type="number" id="tr-asp-t" placeholder="in" step="any"></div>' +
        '</div>' +
        '<button type="button" class="calc-action" data-calc-action="tr-asphalt">Asphalt tons</button>' +
        '<div class="calc-result" id="tr-asphalt-result" hidden></div>' +
        '<div class="calc-field-row" style="margin-top:8px">' +
          '<div class="calc-field"><label for="tr-tren-l">Trench len</label><input type="number" id="tr-tren-l" placeholder="ft" step="any"></div>' +
          '<div class="calc-field"><label for="tr-tren-w">Width</label><input type="number" id="tr-tren-w" placeholder="ft" step="any"></div>' +
        '</div>' +
        '<div class="calc-field"><label for="tr-tren-d">Depth</label><input type="number" id="tr-tren-d" placeholder="ft" step="any"></div>' +
        '<button type="button" class="calc-action" data-calc-action="tr-trench">Trench cu yd</button>' +
        '<div class="calc-result" id="tr-trench-result" hidden></div>' +
      '</div>' +
    '</div>';
  }

  /* ── Bid & finance math (Phase 5 / A2) ── */
  function buildFinanceTab() {
    return '<div class="calc-section is-hide" data-calc="finance">' +
      '<div class="calc-card">' +
        '<div class="calc-card-title">Bid build-up - cost + overhead + profit</div>' +
        '<div class="calc-field"><label for="fi-cost">Direct cost</label><input type="number" id="fi-cost" placeholder="0" step="any"></div>' +
        '<div class="calc-field-row">' +
          '<div class="calc-field"><label for="fi-oh">Overhead %</label><input type="number" id="fi-oh" placeholder="10" step="any" value="10"></div>' +
          '<div class="calc-field"><label for="fi-profit">Profit %</label><input type="number" id="fi-profit" placeholder="10" step="any" value="10"></div>' +
        '</div>' +
        '<button type="button" class="calc-action" data-calc-action="fi-bid">Build bid</button>' +
        '<div class="calc-result" id="fi-bid-result" hidden></div>' +
      '</div>' +
      '<div class="calc-card">' +
        '<div class="calc-card-title">Break-even units</div>' +
        '<div class="calc-field-row">' +
          '<div class="calc-field"><label for="fi-be-fix">Fixed cost</label><input type="number" id="fi-be-fix" placeholder="0" step="any"></div>' +
          '<div class="calc-field"><label for="fi-be-unit">Cost / unit</label><input type="number" id="fi-be-unit" placeholder="0" step="any"></div>' +
        '</div>' +
        '<div class="calc-field"><label for="fi-be-price">Price / unit</label><input type="number" id="fi-be-price" placeholder="0" step="any"></div>' +
        '<button type="button" class="calc-action" data-calc-action="fi-break">Break-even</button>' +
        '<div class="calc-result" id="fi-break-result" hidden></div>' +
      '</div>' +
      '<div class="calc-card">' +
        '<div class="calc-card-title">Loan / amortization - monthly payment</div>' +
        '<div class="calc-field"><label for="fi-loan-p">Principal / amount</label><input type="number" id="fi-loan-p" placeholder="0" step="any"></div>' +
        '<div class="calc-field-row">' +
          '<div class="calc-field"><label for="fi-loan-r">Annual rate %</label><input type="number" id="fi-loan-r" placeholder="6" step="any" value="6"></div>' +
          '<div class="calc-field"><label for="fi-loan-y">Years</label><input type="number" id="fi-loan-y" placeholder="30" step="1" value="30"></div>' +
        '</div>' +
        '<button type="button" class="calc-action" data-calc-action="fi-loan">Amortize</button>' +
        '<div class="calc-result" id="fi-loan-result" hidden></div>' +
      '</div>' +
    '</div>';
  }

  /* ── Site & geometry math (Phase 5 / A3) ── */
  function buildSiteTab() {
    return '<div class="calc-section is-hide" data-calc="site">' +
      '<div class="calc-card">' +
        '<div class="calc-card-title">Slope / grade - rise, run, %, degrees</div>' +
        '<div class="calc-field-row">' +
          '<div class="calc-field"><label for="si-rise">Rise</label><input type="number" id="si-rise" placeholder="ft" step="any"></div>' +
          '<div class="calc-field"><label for="si-run">Run</label><input type="number" id="si-run" placeholder="ft" step="any"></div>' +
        '</div>' +
        '<button type="button" class="calc-action" data-calc-action="si-slope">Calculate</button>' +
        '<div class="calc-result" id="si-slope-result" hidden></div>' +
      '</div>' +
      '<div class="calc-card">' +
        '<div class="calc-card-title">Arc / chord</div>' +
        '<div class="calc-field-row">' +
          '<div class="calc-field"><label for="si-rad">Radius</label><input type="number" id="si-rad" placeholder="ft" step="any"></div>' +
          '<div class="calc-field"><label for="si-ang">Angle (deg)</label><input type="number" id="si-ang" placeholder="0" step="any"></div>' +
        '</div>' +
        '<button type="button" class="calc-action" data-calc-action="si-arc">Calculate</button>' +
        '<div class="calc-result" id="si-arc-result" hidden></div>' +
      '</div>' +
      '<div class="calc-card">' +
        '<div class="calc-card-title">Odd volumes - prismoid / frustum / trench</div>' +
        '<div class="calc-field-row">' +
          '<div class="calc-field"><label for="si-a1">End area 1</label><input type="number" id="si-a1" placeholder="sq ft" step="any"></div>' +
          '<div class="calc-field"><label for="si-a2">End area 2</label><input type="number" id="si-a2" placeholder="sq ft" step="any"></div>' +
        '</div>' +
        '<div class="calc-field-row">' +
          '<div class="calc-field"><label for="si-am">Mid area</label><input type="number" id="si-am" placeholder="sq ft" step="any"></div>' +
          '<div class="calc-field"><label for="si-len">Length</label><input type="number" id="si-len" placeholder="ft" step="any"></div>' +
        '</div>' +
        '<button type="button" class="calc-action" data-calc-action="si-prismoid">Prismoid volume</button>' +
        '<div class="calc-result" id="si-prismoid-result" hidden></div>' +
        '<div class="calc-field-row" style="margin-top:8px">' +
          '<div class="calc-field"><label for="si-fr-top">Top area</label><input type="number" id="si-fr-top" placeholder="sq ft" step="any"></div>' +
          '<div class="calc-field"><label for="si-fr-bot">Bottom area</label><input type="number" id="si-fr-bot" placeholder="sq ft" step="any"></div>' +
        '</div>' +
        '<div class="calc-field"><label for="si-fr-h">Height</label><input type="number" id="si-fr-h" placeholder="ft" step="any"></div>' +
        '<button type="button" class="calc-action" data-calc-action="si-frustum">Frustum volume</button>' +
        '<div class="calc-result" id="si-frustum-result" hidden></div>' +
      '</div>' +
      '<div class="calc-card">' +
        '<div class="calc-card-title">Extra conversions - temperature / pressure / flow / speed</div>' +
        '<div class="calc-field-row">' +
          '<div class="calc-field" style="flex:1.4"><label for="si-cv">Conversion</label>' +
            '<select id="si-cv">' +
              '<option value="f-c">Fahrenheit to Celsius</option>' +
              '<option value="c-f">Celsius to Fahrenheit</option>' +
              '<option value="psi-kpa">psi to kPa</option>' +
              '<option value="kpa-psi">kPa to psi</option>' +
              '<option value="gpm-lpm">GPM to L/min</option>' +
              '<option value="lpm-gpm">L/min to GPM</option>' +
              '<option value="mph-kph">mph to km/h</option>' +
              '<option value="kph-mph">km/h to mph</option>' +
            '</select></div>' +
          '<div class="calc-field"><label for="si-cv-val">Value</label><input type="number" id="si-cv-val" placeholder="0" step="any"></div>' +
        '</div>' +
        '<button type="button" class="calc-action" data-calc-action="si-conv">Convert</button>' +
        '<div class="calc-result" id="si-conv-result" hidden></div>' +
      '</div>' +
    '</div>';
  }

  /* ── Project metrics / EVM (Phase 5 / A4) - reuses ns.Evm when the
       project state is available so answers match the dashboard ── */
  function buildEvmTab() {
    return '<div class="calc-section is-hide" data-calc="evm">' +
      '<div class="calc-card">' +
        '<div class="calc-card-title">EVM from current project</div>' +
        '<button type="button" class="calc-action" data-calc-action="evm-live">Use current project</button>' +
        '<div class="calc-result" id="evm-live-result" hidden></div>' +
      '</div>' +
      '<div class="calc-card">' +
        '<div class="calc-card-title">Manual EVM - SPI / CPI / EAC / ETC</div>' +
        '<div class="calc-field-row">' +
          '<div class="calc-field"><label for="evm-bac">BAC</label><input type="number" id="evm-bac" placeholder="0" step="any"></div>' +
          '<div class="calc-field"><label for="evm-pv-calc">PV</label><input type="number" id="evm-pv-calc" placeholder="0" step="any"></div>' +
        '</div>' +
        '<div class="calc-field-row">' +
          '<div class="calc-field"><label for="evm-ev-calc">EV</label><input type="number" id="evm-ev-calc" placeholder="0" step="any"></div>' +
          '<div class="calc-field"><label for="evm-ac-calc">AC</label><input type="number" id="evm-ac-calc" placeholder="0" step="any"></div>' +
        '</div>' +
        '<button type="button" class="calc-action" data-calc-action="evm-manual">Calculate EVM</button>' +
        '<div class="calc-result" id="evm-manual-result" hidden></div>' +
      '</div>' +
    '</div>';
  }

  /* ── Settings (Phase 5 / A5) - one checkbox per toggleable tab ── */
  function buildSettingsTab() {
    var TITLE = { trades: 'Construction trades', finance: 'Bid & finance', site: 'Site & geometry', evm: 'Project EVM (SPI/CPI)', pct: 'Percent', area: 'Area', convert: 'Convert', markup: 'Markup', cost: 'Cost estimate' };
    var rows = TABS.filter(function(t) { return t.id !== 'general'; }).map(function(t) {
      return '<label class="calc-set-row"><input type="checkbox" data-calc-toggle="' + t.id + '" ' + (isTabVisible(t.id) ? 'checked' : '') + '> <span>' + (TITLE[t.id] || t.label) + '</span></label>';
    }).join('');
    return '<div class="calc-section is-hide" data-calc="settings">' +
      '<div class="calc-card">' +
        '<div class="calc-card-title">Calculator settings</div>' +
        '<p class="calc-set-note">Turn off categories you do not need. The General tab stays always on. Changes apply instantly.</p>' +
        rows +
      '</div>' +
    '</div>';
  }

  /* ── Wire all calculator action buttons ── */
  function wireInputs() {
    // General calculator buttons
    _panel.querySelectorAll('[data-gc]').forEach(function(btn) {
      btn.addEventListener('click', function() { handleGeneralCalc(btn); });
    });

    // Category-specific actions
    _panel.querySelectorAll('[data-calc-action]').forEach(function(btn) {
      btn.addEventListener('click', function() { handleAction(btn.getAttribute('data-calc-action')); });
    });

    // Unit conversion category change
    var convCat = document.getElementById('conv-cat');
    if (convCat) {
      convCat.addEventListener('change', function() {
        updateConvPairs(this.value);
      });
    }

    // Settings gear (Phase 5 / A5): open the settings section
    var gear = document.getElementById('calc-gear');
    if (gear) {
      gear.addEventListener('click', function() {
        if (switchTab('settings') !== false) {
          gear.classList.add('active');
          gear.setAttribute('aria-expanded', 'true');
        }
      });
    }

    // Settings checkboxes: persist the enabled set and rebuild tabs
    _panel.querySelectorAll('[data-calc-toggle]').forEach(function(cb) {
      cb.addEventListener('change', function() {
        var id = cb.getAttribute('data-calc-toggle');
        var list = loadEnabledTabs().slice();
        var idx = list.indexOf(id);
        if (cb.checked && idx === -1) { list.push(id); }
        if (!cb.checked && idx > -1) { list.splice(idx, 1); }
        saveEnabledTabs(list);
        renderTabButtons();
        // If the currently visible tab just got disabled, fall back to General.
        var tabEls = _panel.querySelectorAll('.calc-tab');
        var hasActive = false;
        tabEls.forEach(function(t) { if (t.classList.contains('active')) hasActive = true; });
        if (!hasActive) switchTab('general');
      });
    });

    // Enter key on inputs triggers calculate
    _panel.querySelectorAll('input[type="number"]').forEach(function(inp) {
      inp.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          var card = inp.closest('.calc-card');
          if (card) {
            var actionBtn = card.querySelector('[data-calc-action]');
            if (actionBtn) actionBtn.click();
          }
        }
      });
    });
  }

  /* ── General calculator logic ── */
  var _gcState = { display: '0', prev: null, op: null, fresh: true };

  function handleGeneralCalc(btn) {
    var action = btn.getAttribute('data-gc');
    var disp = document.getElementById('calc-display');
    if (!disp) return;

    if (action === 'num') {
      var n = btn.getAttribute('data-n');
      if (_gcState.fresh) { _gcState.display = n; _gcState.fresh = false; }
      else { _gcState.display = _gcState.display === '0' ? n : _gcState.display + n; }
    } else if (action === 'decimal') {
      if (_gcState.fresh) { _gcState.display = '0.'; _gcState.fresh = false; }
      else if (_gcState.display.indexOf('.') === -1) { _gcState.display += '.'; }
    } else if (action === 'op') {
      if (_gcState.prev !== null && _gcState.op && !_gcState.fresh) {
        _gcState.display = String(calc(parseFloat(_gcState.prev), parseFloat(_gcState.display), _gcState.op));
      }
      _gcState.prev = _gcState.display;
      _gcState.op = btn.getAttribute('data-op');
      _gcState.fresh = true;
    } else if (action === 'equals') {
      if (_gcState.prev !== null && _gcState.op) {
        var result = calc(parseFloat(_gcState.prev), parseFloat(_gcState.display), _gcState.op);
        addHistory(_gcState.prev + ' ' + opSymbol(_gcState.op) + ' ' + _gcState.display + ' = ' + result);
        _gcState.display = String(result);
        _gcState.prev = null;
        _gcState.op = null;
        _gcState.fresh = true;
      }
    } else if (action === 'clear') {
      _gcState.display = '0'; _gcState.prev = null; _gcState.op = null; _gcState.fresh = true;
    } else if (action === 'backspace') {
      if (!_gcState.fresh && _gcState.display.length > 1) {
        _gcState.display = _gcState.display.slice(0, -1);
      } else { _gcState.display = '0'; _gcState.fresh = true; }
    } else if (action === 'percent') {
      _gcState.display = String(parseFloat(_gcState.display) / 100);
      _gcState.fresh = true;
    }
    disp.value = formatNum(_gcState.display);
  }

  function calc(a, b, op) {
    if (op === '+') return a + b;
    if (op === '-') return a - b;
    if (op === '*') return a * b;
    if (op === '/') return b !== 0 ? a / b : 0;
    return b;
  }

  function opSymbol(op) {
    if (op === '+') return '+';
    if (op === '-') return '-';
    if (op === '*') return 'x';
    if (op === '/') return '/';
    return op;
  }

  /* ── Action handlers ── */
  function handleAction(action) {
    var r = '';
    switch (action) {
      case 'pct-of': {
        var x = parseFloat(document.getElementById('pct-x').value) || 0;
        var y = parseFloat(document.getElementById('pct-y').value) || 0;
        var res = (x / 100) * y;
        r = x + '% of ' + fmtNum(y) + ' = ' + fmtNum(res);
        showResult('pct-result', r);
        addHistory(r);
        break;
      }
      case 'pct-is-what': {
        var a = parseFloat(document.getElementById('pct-a').value) || 0;
        var b = parseFloat(document.getElementById('pct-b').value) || 0;
        var pct = b !== 0 ? (a / b) * 100 : 0;
        r = a + ' is ' + pct.toFixed(2) + '% of ' + fmtNum(b);
        showResult('pct-result2', r);
        addHistory(r);
        break;
      }
      case 'pct-change': {
        var from = parseFloat(document.getElementById('pct-from').value) || 0;
        var to = parseFloat(document.getElementById('pct-to').value) || 0;
        var chg = from !== 0 ? ((to - from) / Math.abs(from)) * 100 : 0;
        var dir = chg >= 0 ? 'increase' : 'decrease';
        r = Math.abs(chg).toFixed(2) + '% ' + dir + ' from ' + fmtNum(from) + ' to ' + fmtNum(to);
        showResult('pct-result3', r);
        addHistory(r);
        break;
      }
      case 'area-rect': {
        var w = parseFloat(document.getElementById('area-rect-w').value) || 0;
        var h = parseFloat(document.getElementById('area-rect-h').value) || 0;
        r = 'Area = ' + fmtNum(w * h) + ' sq units';
        showResult('area-rect-result', r);
        addHistory(r);
        break;
      }
      case 'area-tri': {
        var sa = parseFloat(document.getElementById('area-tri-a').value) || 0;
        var sb = parseFloat(document.getElementById('area-tri-b').value) || 0;
        var sc = parseFloat(document.getElementById('area-tri-c').value) || 0;
        var s = (sa + sb + sc) / 2;
        var area = Math.sqrt(Math.max(0, s * (s - sa) * (s - sb) * (s - sc)));
        r = 'Area = ' + fmtNum(area) + ' sq units (Heron\'s formula)';
        showResult('area-tri-result', r);
        addHistory(r);
        break;
      }
      case 'area-circle': {
        var rad = parseFloat(document.getElementById('area-circ-r').value) || 0;
        var ca = Math.PI * rad * rad;
        r = 'Area = ' + fmtNum(ca) + ' sq units | Circumference = ' + fmtNum(2 * Math.PI * rad);
        showResult('area-circle-result', r);
        addHistory(r);
        break;
      }
      case 'area-trap': {
        var pa = parseFloat(document.getElementById('area-trap-a').value) || 0;
        var pb = parseFloat(document.getElementById('area-trap-b').value) || 0;
        var ph = parseFloat(document.getElementById('area-trap-h').value) || 0;
        r = 'Area = ' + fmtNum((pa + pb) / 2 * ph) + ' sq units';
        showResult('area-trap-result', r);
        addHistory(r);
        break;
      }
      case 'convert': {
        var pair = document.getElementById('conv-pair').value;
        var val = parseFloat(document.getElementById('conv-val').value) || 0;
        var parts = pair.split('-');
        var allConvs = CONVERSIONS.length.concat(CONVERSIONS.area).concat(CONVERSIONS.weight).concat(CONVERSIONS.volume).concat(CONVERSIONS.concrete);
        var conv = allConvs.find(function(c) { return c.from === parts[0] && c.to === parts[1]; });
        if (conv) {
          var res = val * conv.factor;
          r = fmtNum(val) + ' ' + parts[0].toUpperCase() + ' = ' + fmtNum(res) + ' ' + parts[1].toUpperCase();
          showResult('conv-result', r);
          addHistory(r);
        }
        break;
      }
      case 'conc-vol': {
        var cl = parseFloat(document.getElementById('conc-l').value) || 0;
        var cw = parseFloat(document.getElementById('conc-w').value) || 0;
        var cd = parseFloat(document.getElementById('conc-d').value) || 0;
        var waste = parseFloat(document.getElementById('conc-waste').value) || 0;
        var volFt = cl * cw * (cd / 12);
        var volYd = volFt / 27;
        var withWaste = volYd * (1 + waste / 100);
        r = volFt.toFixed(2) + ' cu ft = ' + volYd.toFixed(3) + ' cu yd' + (waste > 0 ? ' (' + waste + '% waste = ' + withWaste.toFixed(3) + ' cu yd)' : '');
        showResult('conc-result', r);
        addHistory(r);
        break;
      }
      case 'markup': {
        var cost = parseFloat(document.getElementById('mk-cost').value) || 0;
        var mp = parseFloat(document.getElementById('mk-pct').value) || 0;
        var price = cost * (1 + mp / 100);
        var profit = price - cost;
        r = 'Price: ' + fmtDollars(price) + ' | Profit: ' + fmtDollars(profit) + ' (' + mp + '% markup)';
        showResult('mk-result', r);
        addHistory(r);
        break;
      }
      case 'margin': {
        var mc = parseFloat(document.getElementById('mg-cost').value) || 0;
        var mgp = parseFloat(document.getElementById('mg-pct').value) || 0;
        var sp = mgp < 100 ? mc / (1 - mgp / 100) : 0;
        r = 'Selling Price: ' + fmtDollars(sp) + ' | Profit: ' + fmtDollars(sp - mc) + ' (' + mgp + '% margin)';
        showResult('mg-result', r);
        addHistory(r);
        break;
      }
      case 'discount': {
        var dp = parseFloat(document.getElementById('disc-price').value) || 0;
        var dpct = parseFloat(document.getElementById('disc-pct').value) || 0;
        var saved = dp * dpct / 100;
        r = 'Final: ' + fmtDollars(dp - saved) + ' | Saved: ' + fmtDollars(saved);
        showResult('disc-result', r);
        addHistory(r);
        break;
      }
      case 'tax': {
        var ta = parseFloat(document.getElementById('tax-amt').value) || 0;
        var tp = parseFloat(document.getElementById('tax-pct').value) || 0;
        var taxAmt = ta * tp / 100;
        r = 'Tax: ' + fmtDollars(taxAmt) + ' | Total: ' + fmtDollars(ta + taxAmt);
        showResult('tax-result', r);
        addHistory(r);
        break;
      }
      case 'unit-cost': {
        var uq = parseFloat(document.getElementById('uc-qty').value) || 0;
        var ur = parseFloat(document.getElementById('uc-rate').value) || 0;
        r = 'Total: ' + fmtDollars(uq * ur) + ' (' + uq + ' x $' + ur.toFixed(2) + ')';
        showResult('uc-result', r);
        addHistory(r);
        break;
      }
      case 'labor-cost': {
        var lh = parseFloat(document.getElementById('lc-hrs').value) || 0;
        var lr = parseFloat(document.getElementById('lc-rate').value) || 0;
        var lp = parseInt(document.getElementById('lc-people').value) || 1;
        var ld = parseInt(document.getElementById('lc-days').value) || 1;
        var total = lh * lr * lp * ld;
        r = 'Total: ' + fmtDollars(total) + ' (' + lp + ' workers x ' + lh + ' hrs/day x ' + ld + ' days x $' + lr.toFixed(2) + '/hr)';
        showResult('lc-result', r);
        addHistory(r);
        break;
      }
      case 'material-cost': {
        var mq = parseFloat(document.getElementById('mat-qty').value) || 0;
        var mrate = parseFloat(document.getElementById('mat-rate').value) || 0;
        var mw = parseFloat(document.getElementById('mat-waste').value) || 0;
        var base = mq * mrate;
        var withWaste = base * (1 + mw / 100);
        r = 'Base: ' + fmtDollars(base) + ' | With ' + mw + '% waste: ' + fmtDollars(withWaste);
        showResult('mat-result', r);
        addHistory(r);
        break;
      }
      case 'contingency': {
        var cb = parseFloat(document.getElementById('ct-base').value) || 0;
        var cp = parseFloat(document.getElementById('ct-pct').value) || 0;
        var cont = cb * cp / 100;
        r = 'Contingency: ' + fmtDollars(cont) + ' | Total with contingency: ' + fmtDollars(cb + cont);
        showResult('ct-result', r);
        addHistory(r);
        break;
      }
      /* ── Construction trades (Phase 5 / A1) ── */
      case 'tr-pour': {
        var l = parseFloat(document.getElementById('tr-l').value) || 0;
        var w = parseFloat(document.getElementById('tr-w').value) || 0;
        var t = parseFloat(document.getElementById('tr-t').value) || 0;
        var waste = parseFloat(document.getElementById('tr-waste').value) || 0;
        var volFt = l * w * (t / 12);
        var volYd = volFt / 27;
        var bags = Math.ceil(volYd * 27 / 0.6); // 60 lb bag @ 0.45 cu ft
        var withWaste = volYd * (1 + waste / 100);
        r = volFt.toFixed(1) + ' cu ft = ' + withWaste.toFixed(2) + ' cu yd' + (waste > 0 ? ' (incl. ' + waste + '% waste)' : '') + ' ~ ' + bags + ' x 60 lb bags';
        showResult('tr-pour-result', r);
        addHistory(r);
        break;
      }
      case 'tr-cylinder': {
        var d = parseFloat(document.getElementById('tr-col-d').value) || 0;
        var h = parseFloat(document.getElementById('tr-col-h').value) || 0;
        var n = parseInt(document.getElementById('tr-col-n').value) || 1;
        var rad = d / 2;
        var oneYd = (Math.PI * rad * rad * h) / 27;
        var totalYd = oneYd * n;
        r = n + ' column(s): ' + totalYd.toFixed(2) + ' cu yd total (' + oneYd.toFixed(3) + ' each)';
        showResult('tr-cylinder-result', r);
        addHistory(r);
        break;
      }
      case 'tr-masonry': {
        var mw = parseFloat(document.getElementById('tr-mw').value) || 0;
        var mh = parseFloat(document.getElementById('tr-mh').value) || 0;
        var msz = document.getElementById('tr-msz').value;
        var mwaste = parseFloat(document.getElementById('tr-mwaste').value) || 0;
        var sf = mw * mh;
        var units, mortar;
        if (msz === 'block16') { units = sf * 0.75; mortar = sf / 100 * 0.3; }
        else if (msz === 'block8') { units = sf * 1.5; mortar = sf / 100 * 0.3; }
        else { units = sf * 6.5; mortar = sf / 100 * 0.3; }
        units = units * (1 + mwaste / 100);
        r = 'Area: ' + Math.round(sf) + ' sq ft | ' + Math.ceil(units) + ' units' + (mwaste > 0 ? ' (incl. ' + mwaste + '% waste)' : '') + ' | ~' + mortar.toFixed(1) + ' cu yd mortar';
        showResult('tr-masonry-result', r);
        addHistory(r);
        break;
      }
      case 'tr-earth': {
        var el = parseFloat(document.getElementById('tr-el').value) || 0;
        var ew = parseFloat(document.getElementById('tr-ew').value) || 0;
        var ed = parseFloat(document.getElementById('tr-ed').value) || 0;
        var swell = parseFloat(document.getElementById('tr-eswell').value) || 0;
        var cutYd = (el * ew * ed) / 27;
        var swellYd = cutYd * (1 + swell / 100);
        r = 'Cut: ' + cutYd.toFixed(2) + ' cu yd | Loose (compacted + ' + swell + '% swell): ' + swellYd.toFixed(2) + ' cu yd';
        showResult('tr-earth-result', r);
        addHistory(r);
        break;
      }
      case 'tr-roof': {
        var ff = parseFloat(document.getElementById('tr-ff').value) || 0;
        var rise = parseFloat(document.getElementById('tr-rise').value) || 0;
        var slope = Math.sqrt(144 + rise * rise) / 12;
        var roofSf = ff * slope;
        var squares = roofSf / 100;
        r = 'Slope factor: ' + slope.toFixed(2) + ' | Roof area: ' + Math.round(roofSf) + ' sq ft | ' + squares.toFixed(1) + ' squares (per 100 sq ft)';
        showResult('tr-roof-result', r);
        addHistory(r);
        break;
      }
      case 'tr-framing': {
        var fw = parseFloat(document.getElementById('tr-fw').value) || 0;
        var fh = parseFloat(document.getElementById('tr-fh').value) || 0;
        var foc = parseInt(document.getElementById('tr-foc').value) || 16;
        var fwaste = parseFloat(document.getElementById('tr-fwaste').value) || 0;
        var studs = Math.ceil((fw * 12) / foc) + 1;
        // plates: top + bottom + (optional) second top plate
        var plates = 3;
        var studs2x = studs * (1 + fwaste / 100);
        r = 'Studs: ' + Math.ceil(studs2x) + ' (' + foc + '" oc, ' + Math.round(fw * fh) + ' sq ft wall) | Plates: ' + plates + ' x ' + Math.ceil(fw) + ' ft';
        showResult('tr-framing-result', r);
        addHistory(r);
        break;
      }
      case 'tr-stairs': {
        var sr = parseFloat(document.getElementById('tr-sr').value) || 0;
        var srun = parseFloat(document.getElementById('tr-srun').value) || 0;
        var smax = parseFloat(document.getElementById('tr-smax').value) || 7.75;
        var risers = Math.ceil(sr / smax);
        var riseEach = sr / risers;
        var treads = risers - 1;
        var treadEach = srun / treads;
        var stringer = Math.sqrt((sr * sr) + (srun * srun)) / 12;
        r = risers + ' risers @ ' + riseEach.toFixed(2) + '" | ' + treads + ' treads @ ' + treadEach.toFixed(2) + '" | Stringer: ' + stringer.toFixed(1) + ' ft';
        showResult('tr-stairs-result', r);
        addHistory(r);
        break;
      }
      case 'tr-paint': {
        var psf = parseFloat(document.getElementById('tr-paint-sf').value) || 0;
        var coats = parseInt(document.getElementById('tr-paint-coat').value) || 2;
        var gal = Math.ceil((psf * coats) / 350);
        r = 'Area: ' + Math.round(psf) + ' sq ft x ' + coats + ' coat(s) ~ ' + gal + ' gallon(s) (350 sq ft/gal)';
        showResult('tr-paint-result', r);
        addHistory(r);
        break;
      }
      case 'tr-drywall': {
        var dsf = parseFloat(document.getElementById('tr-dry-sf').value) || 0;
        var sheets = Math.ceil(dsf / 32); // 4x8 sheet
        r = 'Drywall area: ' + Math.round(dsf) + ' sq ft ~ ' + sheets + ' x 4x8 sheets (+cut waste)';
        showResult('tr-drywall-result', r);
        addHistory(r);
        break;
      }
      case 'tr-tile': {
        var tsf = parseFloat(document.getElementById('tr-tile-sf').value) || 0;
        var tsz = parseInt(document.getElementById('tr-tile-sz').value) || 12;
        var perSf = 144 / (tsz * tsz);
        var tiles = Math.ceil(tsf * perSf * 1.1 - 1e-9); // 10% cut waste (float guard)
        r = 'Floor: ' + Math.round(tsf) + ' sq ft | ~' + tiles + ' x ' + tsz + 'x' + tsz + ' tiles (incl. 10% cut waste)';
        showResult('tr-tile-result', r);
        addHistory(r);
        break;
      }
      case 'tr-asphalt': {
        var asf = parseFloat(document.getElementById('tr-asp-sf').value) || 0;
        var at = parseFloat(document.getElementById('tr-asp-t').value) || 0;
        var tons = (asf * (at / 12)) * 0.083; // ~145 lb/cu ft / 2000
        r = 'Asphalt: ~' + tons.toFixed(2) + ' tons (' + Math.round(asf) + ' sq ft @ ' + at + '" thick)';
        showResult('tr-asphalt-result', r);
        addHistory(r);
        break;
      }
      case 'tr-trench': {
        var tl = parseFloat(document.getElementById('tr-tren-l').value) || 0;
        var tw = parseFloat(document.getElementById('tr-tren-w').value) || 0;
        var td = parseFloat(document.getElementById('tr-tren-d').value) || 0;
        var yd = (tl * tw * td) / 27;
        r = 'Trench volume: ' + yd.toFixed(2) + ' cu yd (' + Math.round(tl) + ' ft x ' + tw + ' ft x ' + td + ' ft)';
        showResult('tr-trench-result', r);
        addHistory(r);
        break;
      }
      /* ── Bid & finance (Phase 5 / A2) ── */
      case 'fi-bid': {
        var cost = parseFloat(document.getElementById('fi-cost').value) || 0;
        var oh = parseFloat(document.getElementById('fi-oh').value) || 0;
        var prof = parseFloat(document.getElementById('fi-profit').value) || 0;
        var withOh = cost * (1 + oh / 100);
        var bid = withOh * (1 + prof / 100);
        r = 'Direct: ' + fmtDollars(cost) + ' + OH ' + oh + '% = ' + fmtDollars(withOh) + ' | Bid: ' + fmtDollars(bid) + ' (profit ' + fmtDollars(bid - withOh) + ')';
        showResult('fi-bid-result', r);
        addHistory(r);
        break;
      }
      case 'fi-break': {
        var fix = parseFloat(document.getElementById('fi-be-fix').value) || 0;
        var cunit = parseFloat(document.getElementById('fi-be-unit').value) || 0;
        var price = parseFloat(document.getElementById('fi-be-price').value) || 0;
        var be = price > cunit ? fix / (price - cunit) : null;
        r = be !== null ? 'Break-even: ' + Math.ceil(be) + ' units (' + fmtDollars(be * cunit + fix) + ' total)' : 'Price must exceed cost per unit';
        showResult('fi-break-result', r);
        addHistory(r);
        break;
      }
      case 'fi-loan': {
        var P = parseFloat(document.getElementById('fi-loan-p').value) || 0;
        var annual = parseFloat(document.getElementById('fi-loan-r').value) || 0;
        var yrs = parseInt(document.getElementById('fi-loan-y').value) || 1;
        var rn = annual / 100 / 12;
        var n = yrs * 12;
        var pay = (rn > 0 && n > 0) ? P * rn * Math.pow(1 + rn, n) / (Math.pow(1 + rn, n) - 1) : P / Math.max(1, n);
        var total = pay * n;
        r = 'Monthly: ' + fmtDollars(pay) + ' | Total: ' + fmtDollars(total) + ' | Interest: ' + fmtDollars(total - P);
        showResult('fi-loan-result', r);
        addHistory(r);
        break;
      }
      /* ── Site & geometry (Phase 5 / A3) ── */
      case 'si-slope': {
        var rise = parseFloat(document.getElementById('si-rise').value) || 0;
        var run = parseFloat(document.getElementById('si-run').value) || 0;
        var pct = run !== 0 ? (rise / run) * 100 : 0;
        var deg = run !== 0 ? Math.atan2(rise, run) * 180 / Math.PI : 0;
        r = rise + ' ft over ' + run + ' ft = ' + pct.toFixed(2) + '% grade | ' + deg.toFixed(2) + ' degrees';
        showResult('si-slope-result', r);
        addHistory(r);
        break;
      }
      case 'si-arc': {
        var rad = parseFloat(document.getElementById('si-rad').value) || 0;
        var ang = parseFloat(document.getElementById('si-ang').value) || 0;
        var arc = 2 * Math.PI * rad * (ang / 360);
        // chord = 2r sin(theta/2)
        var chord = 2 * rad * Math.sin((ang * Math.PI / 180) / 2);
        r = 'Arc length: ' + arc.toFixed(2) + ' | Chord: ' + chord.toFixed(2) + ' ft (radius ' + rad + ', ' + ang + ' deg)';
        showResult('si-arc-result', r);
        addHistory(r);
        break;
      }
      case 'si-prismoid': {
        var a1 = parseFloat(document.getElementById('si-a1').value) || 0;
        var a2 = parseFloat(document.getElementById('si-a2').value) || 0;
        var am = parseFloat(document.getElementById('si-am').value) || 0;
        var L = parseFloat(document.getElementById('si-len').value) || 0;
        var vol = (L / 6) * (a1 + 4 * am + a2);
        r = 'Prismoid volume: ' + vol.toFixed(2) + ' cu ft (' + (vol / 27).toFixed(2) + ' cu yd)';
        showResult('si-prismoid-result', r);
        addHistory(r);
        break;
      }
      case 'si-frustum': {
        var ftop = parseFloat(document.getElementById('si-fr-top').value) || 0;
        var fbot = parseFloat(document.getElementById('si-fr-bot').value) || 0;
        var fh = parseFloat(document.getElementById('si-fr-h').value) || 0;
        var vol = (fh / 3) * (ftop + fbot + Math.sqrt(ftop * fbot));
        r = 'Frustum volume: ' + vol.toFixed(2) + ' cu ft (' + (vol / 27).toFixed(2) + ' cu yd)';
        showResult('si-frustum-result', r);
        addHistory(r);
        break;
      }
      case 'si-conv': {
        var kind = document.getElementById('si-cv').value;
        var v = parseFloat(document.getElementById('si-cv-val').value) || 0;
        var out, unit;
        if (kind === 'f-c') { out = (v - 32) * 5 / 9; unit = 'C'; }
        else if (kind === 'c-f') { out = v * 9 / 5 + 32; unit = 'F'; }
        else if (kind === 'psi-kpa') { out = v * 6.89476; unit = 'kPa'; }
        else if (kind === 'kpa-psi') { out = v / 6.89476; unit = 'psi'; }
        else if (kind === 'gpm-lpm') { out = v * 3.78541; unit = 'L/min'; }
        else if (kind === 'lpm-gpm') { out = v / 3.78541; unit = 'GPM'; }
        else if (kind === 'mph-kph') { out = v * 1.60934; unit = 'km/h'; }
        else { out = v / 1.60934; unit = 'mph'; }
        r = fmtNum(v) + ' -> ' + fmtNum(out) + ' ' + unit;
        showResult('si-conv-result', r);
        addHistory(r);
        break;
      }
      /* ── EVM (Phase 5 / A4) - reuse ns.Evm.compute when state exists ── */
      case 'evm-live': {
        var evm = window.MMGR && window.MMGR.Evm && window.MMGR.Evm.compute ? window.MMGR.Evm.compute() : null;
        if (!evm) {
          r = 'No current project state to compute. Open a project with tasks + budget, or use the manual EVM card.';
        } else {
          var tcp = evm.tcpi !== null ? evm.tcpi.toFixed(2) : 'N/A';
          r = 'SPI ' + (evm.spi !== null ? evm.spi.toFixed(2) : 'N/A') + ' | CPI ' + (evm.cpi !== null ? evm.cpi.toFixed(2) : 'N/A') +
            ' | EV ' + fmtDollars(evm.ev) + ' | PV ' + fmtDollars(evm.pv) + ' | AC ' + fmtDollars(evm.ac) +
            ' | EAC ' + (evm.eac !== null ? fmtDollars(evm.eac) : 'N/A') + ' | ETC ' + (evm.etc !== null ? fmtDollars(evm.etc) : 'N/A') +
            ' | VAC ' + (evm.vac !== null ? fmtDollars(evm.vac) : 'N/A') + ' | TCPI ' + tcp;
        }
        showResult('evm-live-result', r);
        addHistory(r);
        break;
      }
      case 'evm-manual': {
        var bac = parseFloat(document.getElementById('evm-bac').value) || 0;
        var pv = parseFloat(document.getElementById('evm-pv-calc').value) || 0;
        var ev = parseFloat(document.getElementById('evm-ev-calc').value) || 0;
        var ac = parseFloat(document.getElementById('evm-ac-calc').value) || 0;
        var spi = pv !== 0 ? ev / pv : null;
        var cpi = ac !== 0 ? ev / ac : null;
        var eac = cpi ? ac + (bac - ev) / cpi : null;
        var etc = eac !== null ? eac - ac : null;
        var vac = eac !== null ? bac - eac : null;
        r = 'SPI ' + (spi !== null ? spi.toFixed(2) : 'N/A') + ' | CPI ' + (cpi !== null ? cpi.toFixed(2) : 'N/A') +
          ' | EAC ' + (eac !== null ? fmtDollars(eac) : 'N/A') + ' | ETC ' + (etc !== null ? fmtDollars(etc) : 'N/A') + ' | VAC ' + (vac !== null ? fmtDollars(vac) : 'N/A');
        showResult('evm-manual-result', r);
        addHistory(r);
        break;
      }
    }
  }

  /* ── Helpers ── */
  function showResult(id, text) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    el.classList.add('calc-result-show');
    // Copy to clipboard
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text.replace(/^[^=]*=\s*/, '')).catch(function() {});
    }
  }

  function formatNum(val) {
    var n = parseFloat(val);
    if (isNaN(n)) return val;
    if (Math.abs(n) >= 1e12) return n.toExponential(4);
    if (Number.isInteger(n) && Math.abs(n) < 1e15) return n.toLocaleString('en-US');
    return n.toLocaleString('en-US', { maximumFractionDigits: 8 });
  }

  function fmtNum(n) {
    if (Math.abs(n) >= 1e12) return n.toExponential(4);
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtDollars(n) {
    return '$' + fmtNum(n);
  }

  function updateConvPairs(category) {
    var pairSel = document.getElementById('conv-pair');
    if (!pairSel) return;
    var pairs = CONVERSIONS[category] || [];
    pairSel.innerHTML = pairs.map(function(c) {
      return '<option value="' + c.from + '-' + c.to + '">' + c.from.toUpperCase() + ' → ' + c.to.toUpperCase() + '</option>';
    }).join('');
  }

  function addHistory(text) {
    _history.unshift(text);
    if (_history.length > 10) _history.pop();
    renderHistory();
  }

  function renderHistory() {
    var el = document.getElementById('calc-history');
    if (!el || !_history.length) return;
    el.hidden = false;
    el.innerHTML = '<div class="calc-history-title">Recent</div>' +
      _history.map(function(h) {
        return '<div class="calc-history-item" title="Click to copy">' + h.replace(/</g, '&lt;') + '</div>';
      }).join('');
    el.querySelectorAll('.calc-history-item').forEach(function(item) {
      item.addEventListener('click', function() {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(item.textContent).then(function() {
            item.classList.add('calc-history-copied');
            setTimeout(function() { item.classList.remove('calc-history-copied'); }, 600);
          });
        }
      });
    });
  }

  /* Re-render the tab buttons from the enabled set (Phase 5 / A5) */
  function renderTabButtons() {
    var visible = TABS.filter(function(t) { return isTabVisible(t.id); });
    var tabsEl = _panel.querySelector('.calc-tabs');
    if (!tabsEl) return;
    tabsEl.innerHTML = visible.map(function(t) {
      return '<button type="button" class="calc-tab' + (t.id === _activeTab ? ' active' : '') + '" data-tab="' + t.id + '">' + t.label + '</button>';
    }).join('');
    tabsEl.querySelectorAll('.calc-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        switchTab(tab.getAttribute('data-tab'));
      });
    });
  }

  function switchTab(tabId) {
    // Never enter a disabled tab (Phase 5 / A5). Settings is reachable via
    // the gear only; General is always available.
    if (tabId !== 'settings' && !isTabVisible(tabId)) {
      tabId = 'general';
    }
    _activeTab = tabId;
    _panel.querySelectorAll('.calc-tab').forEach(function(t) {
      t.classList.toggle('active', t.getAttribute('data-tab') === tabId && tabId !== 'settings');
    });
    var gear = document.getElementById('calc-gear');
    if (gear) {
      var inSettings = tabId === 'settings';
      gear.classList.toggle('active', inSettings);
      gear.setAttribute('aria-expanded', String(inSettings));
    }
    _panel.querySelectorAll('.calc-section').forEach(function(s) {
      var sid = s.getAttribute('data-calc');
      var hidden = sid !== tabId;
      if (sid !== 'settings' && sid !== 'general' && !isTabVisible(sid)) hidden = true;
      s.classList.toggle('is-hide', hidden);
    });
    // A taller tab changes the panel height AFTER the open-time clamp, so
    // re-clamp on every switch (Live-eyeball fix, Phase 5).
    requestAnimationFrame(clampPanelInViewport);
    return tabId;
  }

  /* ── Drag logic ── */
  function onIconMouseDown(e) {
    if (e.button !== 0) return;
    startDrag(e.clientX, e.clientY);
    e.preventDefault();
  }

  function onIconTouchStart(e) {
    if (e.touches.length !== 1) return;
    var t = e.touches[0];
    startDrag(t.clientX, t.clientY);
    e.preventDefault();
  }

  function startDrag(cx, cy) {
    _dragging = false;
    var rect = _icon.getBoundingClientRect();
    _dragOffset.x = cx - rect.left;
    _dragOffset.y = cy - rect.top;
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
    document.addEventListener('touchmove', onDragMoveTouch, { passive: false });
    document.addEventListener('touchend', onDragEndTouch);
  }

  function onDragMove(e) {
    _dragging = true;
    moveIcon(e.clientX, e.clientY);
  }

  function onDragMoveTouch(e) {
    if (e.touches.length !== 1) return;
    _dragging = true;
    var t = e.touches[0];
    moveIcon(t.clientX, t.clientY);
    e.preventDefault();
  }

  function moveIcon(cx, cy) {
    var x = cx - _dragOffset.x;
    var y = cy - _dragOffset.y;
    x = Math.max(0, Math.min(window.innerWidth - 48, x));
    y = Math.max(0, Math.min(window.innerHeight - 48, y));
    _icon.style.left = x + 'px';
    _icon.style.top = y + 'px';
    _icon.style.right = 'auto';
    _icon.style.bottom = 'auto';
  }

  function onDragEnd() {
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
    // Short delay so click doesn't fire after drag
    setTimeout(function() { _dragging = false; }, 50);
  }

  function onDragEndTouch() {
    document.removeEventListener('touchmove', onDragMoveTouch);
    document.removeEventListener('touchend', onDragEndTouch);
    setTimeout(function() { _dragging = false; }, 50);
  }

  function onIconClick() {
    if (_dragging) return;
    if (_open) close(); else open();
  }

  /* ── Open / Close ── */
  function open() {
    build();
    _open = true;
    _panel.classList.add('calc-open');
    _icon.classList.add('calc-fab-active');
    _panel.style.display = 'flex';
    // Position panel near the icon
    var rect = _icon.getBoundingClientRect();
    var pw = Math.min(380, window.innerWidth - 20);
    var px = Math.min(rect.left, window.innerWidth - pw - 10);
    var py = Math.max(10, rect.top - 500);
    _panel.style.left = px + 'px';
    _panel.style.top = py + 'px';
    _panel.style.width = pw + 'px';
    // Live-eyeball fix (Phase 5): the panel auto-grows up to its max-height
    // on tall tabs (Trades stacks 9 cards), and the icon-anchored py could
    // push the panel's tail below the viewport fold. Re-measure and clamp
    // so the whole panel (scrollable body included) stays on screen.
    var ph = _panel.offsetHeight;
    if (py + ph > window.innerHeight - 8) {
      _panel.style.top = Math.max(8, window.innerHeight - ph - 8) + 'px';
    }
  }

  // Shared clamp used after open() AND after every tab switch (a taller tab
  // grows the panel after the open-time measurement, so a tab click must
  // re-clamp or the new content's tail lands below the fold).
  function clampPanelInViewport() {
    if (!_panel || !_open) return;
    var cur = parseFloat(_panel.style.top) || 0;
    var ph = _panel.offsetHeight;
    if (cur + ph > window.innerHeight - 8) {
      _panel.style.top = Math.max(8, window.innerHeight - ph - 8) + 'px';
    }
  }

  function close() {
    _open = false;
    _panel.classList.remove('calc-open');
    _icon.classList.remove('calc-fab-active');
    setTimeout(function() { _panel.style.display = 'none'; }, 300);
  }

  function toggle() {
    // Toggle the PANEL open/closed (not the FAB's visibility) - the Controls
    // drawer's "Open" button and the Ctrl+Shift+C shortcut both route here,
    // and both promise to open/close the calculator (FIX 2026-09-02: the old
    // implementation flipped the floating button's display instead, so "Open"
    // never opened anything). The FAB itself stays available via show().
    build();
    show();
    if (_open) close(); else open();
  }

  function show() {
    build();
    _icon.style.display = 'flex';
  }

  function hide() {
    if (_icon) _icon.style.display = 'none';
    if (_open) close();
  }

  /* ── Public API ── */
  ns.Calculator.toggle = toggle;
  ns.Calculator.show = show;
  ns.Calculator.hide = hide;
  ns.Calculator.open = open;
  ns.Calculator.close = close;

  /* Auto-show FAB on load */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    show();
    document.addEventListener('keydown', function(e) {
      if (e.ctrlKey && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        toggle();
      } else if (e.key === 'Escape' && _open) {
        close();
      }
    });
  }

})();
