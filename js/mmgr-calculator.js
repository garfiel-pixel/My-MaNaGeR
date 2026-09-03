/* ============================================================
   My MaNaGeR — Floating Draggable Calculator
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
    { id: 'cost', label: 'Cost Est.', icon: 'i-dollar' }
  ];

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
    _icon.style.cssText = 'position:fixed;bottom:80px;right:24px;z-index:1500;display:none;';
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
    var tabsHtml = TABS.map(function(t) {
      return '<button type="button" class="calc-tab' + (t.id === 'general' ? ' active' : '') + '" data-tab="' + t.id + '">' + t.label + '</button>';
    }).join('');

    return '<div class="calc-head">' +
      '<span class="calc-title"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-calculator"></use></svg> Calculator</span>' +
      '<button type="button" class="calc-close" aria-label="Close calculator"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-x"></use></svg></button>' +
      '</div>' +
      '<div class="calc-tabs">' + tabsHtml + '</div>' +
      '<div class="calc-body">' +
        buildGeneralTab() +
        buildPctTab() +
        buildAreaTab() +
        buildConvertTab() +
        buildMarkupTab() +
        buildCostTab() +
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
          '<div class="calc-field"><label for="mc-qty">Quantity</label><input type="number" id="mc-qty" placeholder="0" step="any"></div>' +
          '<div class="calc-field"><label for="mc-rate">Rate ($/unit)</label><input type="number" id="mc-rate" placeholder="0" step="any"></div>' +
        '</div>' +
        '<div class="calc-field"><label for="mc-waste">Waste %</label><input type="number" id="mc-waste" placeholder="10" step="any" value="10"></div>' +
        '<button type="button" class="calc-action" data-calc-action="material-cost">Calculate</button>' +
        '<div class="calc-result" id="mc-result" hidden></div>' +
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
        var mq = parseFloat(document.getElementById('mc-qty').value) || 0;
        var mrate = parseFloat(document.getElementById('mc-rate').value) || 0;
        var mw = parseFloat(document.getElementById('mc-waste').value) || 0;
        var base = mq * mrate;
        var withWaste = base * (1 + mw / 100);
        r = 'Base: ' + fmtDollars(base) + ' | With ' + mw + '% waste: ' + fmtDollars(withWaste);
        showResult('mc-result', r);
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

  function switchTab(tabId) {
    _activeTab = tabId;
    _panel.querySelectorAll('.calc-tab').forEach(function(t) {
      t.classList.toggle('active', t.getAttribute('data-tab') === tabId);
    });
    _panel.querySelectorAll('.calc-section').forEach(function(s) {
      s.classList.toggle('is-hide', s.getAttribute('data-calc') !== tabId);
    });
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
