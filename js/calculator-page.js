/* global MMGR, MMGRTheme */
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
(function () {
  'use strict';

  // ---- Quantity + cost models (planning-grade; sources in the fine print) --
  // q(d1,d2,d3) -> { qty, unit, qtyLabel }  |  rates are { mat, lab } per unit.
  // Formulas: slab/footing volume with 5% waste; rebar 85 kg per m3 concrete;
  // excavation 1.25 bulking; paint coverage ~10 m2/L per coat (2 coats);
  // block/brick 12.5 & 60 units per m2 with mortar allowance.
  const WORK = {
    siteprep: {
      group: 'Groundworks',
      d1: 'Length (m)',
      d2: 'Width (m)',
      d3: null,
      q: (a, b) => ({ qty: a * b, unit: 'm2', qtyLabel: 'Area to clear' }),
      rate: { mat: 4, lab: 9 },
      matDesc: 'Clearing, strip, disposal allowance'
    },
    excav: {
      group: 'Groundworks',
      d1: 'Length (m)',
      d2: 'Width (m)',
      d3: 'Depth (m)',
      q: (a, b, c) => ({
        qty: a * b * c * 1.25,
        unit: 'm3',
        qtyLabel: 'Excavated volume (incl. 1.25 bulking)'
      }),
      rate: { mat: 2, lab: 14 },
      matDesc: 'Cart-away / disposal',
      // E2 (Phase 1) + G7 (plan v2 Phase 2) + JIC 2025-2027 (owner 2026-10-02):
      // C2 (AUDIT-DIRECTIVE-2026-10-18): these are the app's OWN planning-grade
      // split models (material + labour, US dollars), NOT rows from the JIC rate
      // book - the book quotes one all-in JMD figure per row, which a split can
      // never be. The labels used to claim "(JIC #n)" and were read as book
      // numbers, which is how the owner saw a USD model charged as local money.
      // The book's own figures are reached through the JIC rate book picker.
      // First variant = pre-conversion model so old saves recall identically.
      variants: [
        {
          id: 'standard',
          label: 'Compacted earth to 5 ft deep (planning model)',
          rate: { mat: 2, lab: 14 }
        },
        {
          id: 'asphalt',
          label: 'Asphaltic concrete Barber Green (planning model)',
          rate: { mat: 3, lab: 28 }
        },
        {
          id: 'marl',
          label: 'Compacted marl up to 5 ft deep (planning model)',
          rate: { mat: 1.5, lab: 20 }
        },
        {
          id: 'sand',
          label: 'Compacted sand up to 5 ft deep (planning model)',
          rate: { mat: 1.5, lab: 17 }
        },
        {
          id: 'clay-shallow',
          label: 'Stiff clay up to 5 ft deep (planning model)',
          rate: { mat: 1, lab: 24 }
        },
        {
          id: 'clay-deep',
          label: 'Stiff clay 5 to 10 ft deep (planning model)',
          rate: { mat: 1, lab: 30 }
        },
        {
          id: 'rock-hand',
          label: 'Rock/concrete no compressor (planning model)',
          rate: { mat: 2, lab: 55 }
        },
        {
          id: 'rock-comp',
          label: 'Rock/concrete compressor incl. labourers (planning model)',
          rate: { mat: 12, lab: 38 }
        },
        {
          id: 'rock-labour',
          label: 'Rock/concrete compressor labourers only (planning model)',
          rate: { mat: 2, lab: 70 }
        }
      ]
    },
    slab: {
      group: 'Groundworks',
      d1: 'Length (m)',
      d2: 'Width (m)',
      d3: 'Thickness (mm)',
      waste: { def: 5, lbl: 'Concrete waste' },
      piece: {
        priceLabel: 'Price per bag of mix',
        sizeLabel: 'Bag yield (litres)',
        single: true,
        div: 'volume',
        qtyUnit: 'm3',
        ph: 'e.g. 9200 per bag',
        phSize: 'e.g. 20'
      },
      q: (a, b, c) => ({ qty: a * b * (c / 1000), unit: 'm3', qtyLabel: 'Concrete' }),
      rate: { mat: 150, lab: 85 },
      matDesc: 'C20/25 ready-mix, mesh, vapor barrier'
    },
    footings: {
      group: 'Groundworks',
      d1: 'Total run (m)',
      d2: 'Width (mm)',
      d3: 'Depth (mm)',
      waste: { def: 5, lbl: 'Concrete waste' },
      piece: {
        priceLabel: 'Price per bag of mix',
        sizeLabel: 'Bag yield (litres)',
        single: true,
        div: 'volume',
        qtyUnit: 'm3',
        ph: 'e.g. 9200 per bag',
        phSize: 'e.g. 20'
      },
      q: (a, b, c) => ({ qty: a * (b / 1000) * (c / 1000), unit: 'm3', qtyLabel: 'Concrete' }),
      rate: { mat: 155, lab: 90 },
      matDesc: 'C20/25, rebar cage allowance'
    },
    blockwall: {
      group: 'Structure',
      d1: 'Length (m)',
      d2: 'Height (m)',
      d3: null,
      openings: true,
      piece: {
        priceLabel: 'Price per block',
        sizeLabel: 'Block size - length x height (cm)',
        unit: 'cm',
        div: 'area',
        ph: 'e.g. 800 per block',
        phSize: 'e.g. 40 x 20'
      },
      q: (a, b) => ({ qty: a * b, unit: 'm2', qtyLabel: 'Wall area' }),
      rate: { mat: 22, lab: 28 },
      matDesc: 'Blocks (12.5/m2), mortar, ties',
      // G5 (plan v2 Phase 2), corrected by C2 (AUDIT-DIRECTIVE-2026-10-18): 9
      // planning-grade masonry models by block size, pocket fill and elevation.
      // They are NOT book rows - the JIC book quotes an all-in JMD figure per
      // row, never a split - so the labels no longer claim a JIC number. Use the
      // JIC rate book picker for the book's own rates. First variant =
      // pre-conversion model so old saves recall identically.
      variants: [
        {
          id: 'standard',
          label: '8 in blocks fill all pockets GF to FF (planning model)',
          rate: { mat: 22, lab: 28 }
        },
        {
          id: '8in-ff',
          label: '8 in blocks fill all pockets FF and above (planning model)',
          rate: { mat: 24, lab: 30 }
        },
        {
          id: '8in-mh',
          label: '8 in blocks fill all pockets manholes drains (planning model)',
          rate: { mat: 26, lab: 34 }
        },
        {
          id: '8in-alt-gf',
          label: '8 in blocks fill alternate pockets GF to FF (planning model)',
          rate: { mat: 20, lab: 26 }
        },
        {
          id: '8in-alt-ff',
          label: '8 in blocks fill alternate pockets FF and above (planning model)',
          rate: { mat: 22, lab: 28 }
        },
        {
          id: '6in-gf',
          label: '6 in blocks fill all pockets GF to FF (planning model)',
          rate: { mat: 18, lab: 26 }
        },
        {
          id: '6in-ff',
          label: '6 in blocks fill all pockets FF and above (planning model)',
          rate: { mat: 22, lab: 28 }
        },
        {
          id: '6in-mh',
          label: '6 in blocks fill all pockets manholes drains gully (planning model)',
          rate: { mat: 24, lab: 30 }
        },
        {
          id: '6in-alt-gf',
          label: '6 in blocks fill alternate pockets GF to FF (planning model)',
          rate: { mat: 16, lab: 24 }
        }
      ]
    },
    brickwall: {
      group: 'Structure',
      d1: 'Length (m)',
      d2: 'Height (m)',
      d3: null,
      openings: true,
      piece: {
        priceLabel: 'Price per brick',
        sizeLabel: 'Brick size - length x height (cm)',
        unit: 'cm',
        div: 'area',
        ph: 'e.g. 140 per brick',
        phSize: 'e.g. 20 x 10'
      },
      q: (a, b) => ({ qty: a * b, unit: 'm2', qtyLabel: 'Wall area' }),
      rate: { mat: 34, lab: 42 },
      matDesc: 'Bricks (60/m2), mortar, wall ties'
    },
    framing: {
      group: 'Structure',
      d1: 'Length (m)',
      d2: 'Height (m)',
      d3: null,
      openings: true,
      q: (a, b) => ({ qty: a * b, unit: 'm2', qtyLabel: 'Framed area' }),
      rate: { mat: 19, lab: 24 },
      matDesc: 'Studs, plates, sheathing'
    },
    rebar: {
      group: 'Structure',
      d1: 'Concrete volume (m3)',
      d2: null,
      d3: null,
      q: a => ({ qty: (a * 85) / 1000, unit: 't', qtyLabel: 'Steel (85 kg per m3)' }),
      rate: { mat: 950, lab: 380 },
      matDesc: 'Bars, ties, chairs, cutting waste'
    },
    roof: {
      group: 'Envelope',
      d1: 'Length (m)',
      d2: 'Slope width (m)',
      d3: null,
      waste: { def: 10, lbl: 'Laps / pitch allowance' },
      piece: {
        priceLabel: 'Price per sheet',
        sizeLabel: 'Sheet size - width x length (m)',
        unit: 'm',
        div: 'area',
        ph: 'e.g. 6120 per sheet',
        phSize: 'e.g. 0.85 x 3.6',
        plural: 'sheets'
      },
      q: (a, b) => ({ qty: a * b, unit: 'm2', qtyLabel: 'Sheet area' }),
      rate: { mat: 26, lab: 18 },
      matDesc: 'Sheets, fixings, flashings'
    },
    render: {
      group: 'Envelope',
      d1: 'Length (m)',
      d2: 'Height (m)',
      d3: null,
      openings: true,
      q: (a, b) => ({ qty: a * b, unit: 'm2', qtyLabel: 'Rendered area' }),
      rate: { mat: 11, lab: 19 },
      matDesc: 'Two-coat render, bead, primer'
    },
    drywall: {
      group: 'Envelope',
      d1: 'Length (m)',
      d2: 'Height (m)',
      d3: null,
      openings: true,
      waste: { def: 10, lbl: 'Cuts / waste' },
      piece: {
        priceLabel: 'Price per board',
        sizeLabel: 'Board size - width x length (m)',
        unit: 'm',
        div: 'area',
        ph: 'e.g. 950 per board',
        phSize: 'e.g. 1.22 x 2.44',
        plural: 'boards'
      },
      q: (a, b) => ({ qty: a * b, unit: 'm2', qtyLabel: 'Partition area' }),
      rate: { mat: 12, lab: 17 },
      matDesc: 'Boards, studs, tape, screws'
    },
    // NOTE (JIC 2025-2027 wave, 2026-10-02): paint, tile, stirrups and
    // fabric-mesh were ALSO defined in the JIC block lower down with their JIC
    // variant lists. In an object literal the LAST definition silently wins,
    // so these four were dead code that looked live - editing one changed
    // nothing. The JIC definitions are the surviving ones; these earlier
    // copies are deleted so there is exactly ONE definition per trade.
    'concrete-drive': {
      group: 'Finishes',
      d1: 'Length (m)',
      d2: 'Width (m)',
      d3: 'Thickness (mm)',
      waste: { def: 5, lbl: 'Concrete waste' },
      piece: {
        priceLabel: 'Price per bag of mix',
        sizeLabel: 'Bag yield (litres)',
        single: true,
        div: 'volume',
        qtyUnit: 'm3',
        ph: 'e.g. 9200 per bag',
        phSize: 'e.g. 20'
      },
      q: (a, b, c) => ({ qty: a * b * (c / 1000), unit: 'm3', qtyLabel: 'Concrete' }),
      rate: { mat: 145, lab: 75 },
      matDesc: 'C25/30 air-entrained, mesh, cure'
    },
    fencing: {
      group: 'Finishes',
      d1: 'Total run (m)',
      d2: 'Height (m)',
      d3: null,
      piece: {
        priceLabel: 'Price per panel',
        sizeLabel: 'Panel size - width x height (m)',
        unit: 'm',
        div: 'width',
        ph: 'e.g. 9500 per panel',
        phSize: 'e.g. 2.5 x 1.8'
      },
      q: (a, b) => ({ qty: a, unit: 'm', qtyLabel: 'Fence run' }),
      rate: { mat: (a, b) => 18 + Math.max(0, (b || 1.8) - 1.2) * 9, lab: 15 },
      matDesc: 'Chain-link, posts, concrete backfill'
    },
    // ---- Research-backed additions (owner 2026-09-30, spec section 3.4) ----
    // Pipe and conduit work is priced PER LINEAR METER (running meter), never
    // per m2 (owner: 'you don't run pipe by square meters'); fixtures/panels
    // are per-unit counts; shingle roofing is quoted per roofing square
    // (100 sq ft) with a laps/cuts allowance. Rates are planning-grade 2026
    // web benchmarks (Angi PEX installed LF; per-point electrical; buildvision
    // waste table; constructly roofing-square pricing) - editable as always.
    'pipe-supply': {
      group: 'Plumbing',
      d1: 'Total run (m)',
      d2: null,
      d3: null,
      q: a => ({ qty: a, unit: 'm', qtyLabel: 'Supply pipe run (linear)' }),
      rate: { mat: 3, lab: 8 },
      matDesc: 'PEX/PVC supply incl. fittings allowance'
    },
    'pipe-drain': {
      group: 'Plumbing',
      d1: 'Total run (m)',
      d2: null,
      d3: null,
      q: a => ({ qty: a, unit: 'm', qtyLabel: 'DWV pipe run (linear)' }),
      rate: { mat: 3, lab: 9 },
      matDesc: 'PVC drain-waste-vent, slope + fittings allowance'
    },
    fixture: {
      group: 'Plumbing',
      d1: 'Fixtures to install (count)',
      d2: null,
      d3: null,
      q: a => ({ qty: a, unit: 'each', qtyLabel: 'Fixtures' }),
      rate: { mat: 130, lab: 150 },
      matDesc: 'Toilet/sink/shower set + connect'
    },
    'bath-rough': {
      group: 'Plumbing',
      d1: 'Bathrooms (count)',
      d2: null,
      d3: null,
      q: a => ({ qty: a, unit: 'each', qtyLabel: 'Bathroom rough-ins' }),
      rate: { mat: 500, lab: 750 },
      matDesc: 'Supply + DWV to one full bathroom'
    },
    'wire-point': {
      group: 'Electrical',
      d1: 'Wiring points (count)',
      d2: null,
      d3: null,
      q: a => ({ qty: a, unit: 'point', qtyLabel: 'Wiring points' }),
      rate: { mat: 25, lab: 60 },
      matDesc: 'Socket/switch/light point incl. device'
    },
    conduit: {
      group: 'Electrical',
      d1: 'Total run (m)',
      d2: null,
      d3: null,
      q: a => ({ qty: a, unit: 'm', qtyLabel: 'Conduit / cable run (linear)' }),
      rate: { mat: 2, lab: 6 },
      matDesc: 'Conduit + single-phase cable'
    },
    panel: {
      group: 'Electrical',
      d1: 'Panels (count)',
      d2: null,
      d3: null,
      q: a => ({ qty: a, unit: 'each', qtyLabel: 'Panels' }),
      rate: { mat: 450, lab: 650 },
      matDesc: 'Consumer board, breakers, labeling'
    },
    skirt: {
      group: 'Finishes',
      d1: 'Total run (m)',
      d2: null,
      d3: null,
      q: a => ({ qty: a, unit: 'm', qtyLabel: 'Skirting run (linear)' }),
      rate: { mat: 3, lab: 5 },
      matDesc: 'Trim + fixings, miters'
    },
    'shingle-roof': {
      group: 'Envelope',
      d1: 'Length (m)',
      d2: 'Slope width (m)',
      d3: null,
      waste: { def: 10, lbl: 'Laps / cuts allowance' },
      q: (a, b) => ({
        qty: (a * b) / 9.2903,
        unit: 'square',
        qtyLabel: 'Roofing squares (100 sq ft each)'
      }),
      rate: { mat: 250, lab: 300 },
      matDesc: 'Asphalt shingles, underlayment, starter'
    },
    // ---- Research-backed additions round 2 (owner 2026-10-01: "do research
    // and add the more we need") - the openings, ceiling, rainwater and
    // packaged-install work a residential job always carries. Rates are
    // planning-grade 2026 web benchmarks (Doornmore/ASP door installs, Pella
    // window installs, Angi drop-ceiling + septic, Homewyse gutters/fascia,
    // Fuse Service water heaters, Highland cabinetry) - editable as always.
    door: {
      group: 'Finishes',
      d1: 'Doors (count)',
      d2: null,
      d3: null,
      q: a => ({ qty: a, unit: 'each', qtyLabel: 'Doors' }),
      rate: { mat: 550, lab: 650 },
      matDesc: 'Prehung door, frame, hardware, trim (2026: $500-2,000 installed, avg $1,200)'
    },
    window: {
      group: 'Envelope',
      d1: 'Windows (count)',
      d2: null,
      d3: null,
      q: a => ({ qty: a, unit: 'each', qtyLabel: 'Windows' }),
      rate: { mat: 600, lab: 500 },
      matDesc: 'Vinyl/fiberglass unit, flashing, sealant (2026: $800-1,600 installed each)'
    },
    ceiling: {
      group: 'Finishes',
      d1: 'Length (m)',
      d2: 'Width (m)',
      d3: null,
      waste: { def: 10, lbl: 'Tile cuts / grid waste' },
      q: (a, b) => ({ qty: a * b, unit: 'm2', qtyLabel: 'Ceiling area' }),
      rate: { mat: 55, lab: 50 },
      matDesc: 'Grid, tiles, hangers, perimeter angle (2026: $9-13/sq ft installed)'
    },
    gutter: {
      group: 'Envelope',
      d1: 'Total run (m)',
      d2: null,
      d3: null,
      q: a => ({ qty: a, unit: 'm', qtyLabel: 'Gutter run (linear)' }),
      rate: { mat: 18, lab: 14 },
      matDesc: 'Aluminum gutter, downpipes, brackets, seals (2026: $6.50-14.80/ft installed)'
    },
    'soffit-fascia': {
      group: 'Envelope',
      d1: 'Total run (m)',
      d2: null,
      d3: null,
      q: a => ({ qty: a, unit: 'm', qtyLabel: 'Soffit & fascia run (linear)' }),
      rate: { mat: 22, lab: 16 },
      matDesc: 'Fascia board, soffit panels, vents, fixings (2026: $8.75-17/ft)'
    },
    'floor-screed': {
      group: 'Finishes',
      d1: 'Length (m)',
      d2: 'Width (m)',
      d3: 'Thickness (mm)',
      waste: { def: 5, lbl: 'Screed waste' },
      piece: {
        priceLabel: 'Price per bag of mix',
        sizeLabel: 'Bag yield (litres)',
        single: true,
        div: 'volume',
        qtyUnit: 'm3',
        ph: 'e.g. 9200 per bag',
        phSize: 'e.g. 20'
      },
      q: (a, b, c) => ({ qty: a * b * (c / 1000), unit: 'm3', qtyLabel: 'Screed volume' }),
      rate: { mat: 120, lab: 70 },
      matDesc: 'Sand-cement screed, leveling, cure'
    },
    cabinet: {
      group: 'Finishes',
      d1: 'Cabinet run (m)',
      d2: null,
      d3: null,
      q: a => ({ qty: a, unit: 'm', qtyLabel: 'Cabinet run (linear)' }),
      rate: { mat: 800, lab: 450 },
      matDesc:
        'Box units, doors, drawer gear, worktop allowance (2026: $100-650/linear ft installed)'
    },
    'water-heater': {
      group: 'Plumbing',
      d1: 'Water heaters (count)',
      d2: null,
      d3: null,
      q: a => ({ qty: a, unit: 'each', qtyLabel: 'Water heaters' }),
      rate: { mat: 900, lab: 650 },
      matDesc: 'Tank unit, valves, flex lines, pan (2026: $1,200-5,000 installed)'
    },
    'septic-tank': {
      group: 'Groundworks',
      d1: 'Septic systems (count)',
      d2: null,
      d3: null,
      q: a => ({ qty: a, unit: 'each', qtyLabel: 'Septic systems' }),
      rate: { mat: 3800, lab: 2700 },
      matDesc: 'Tank, bed, distribution lines, excavation allowance (2026: $3,593-12,463 installed)'
    },
    // ---- W2 2026-10-01: DERIVED companion trades (punch-list reality) ------
    // Bill-only work items that never appear in the picker; a companion chip
    // fills the form state via measuredQty, so these price through the SAME
    // engine (waste, quality, rates) with zero new math.
    // ---- PLAN V2 PHASE 2 (owner 2026-10-01): CONCRETE CHAIN ----------------
    // G1/G4/G5/G7/B1 structure with planning-grade 2026 rates (Model tag,
    // every rate editable; the owner's JIC extract keys a JMD book that
    // overrides these at prefill with no code change). Sources per line.
    'rebar-size': {
      group: 'Structure',
      d1: 'Steel weight (kg)',
      d2: null,
      d3: null,
      q: a => ({ qty: a / 1000, unit: 't', qtyLabel: 'Steel weight' }),
      runit: 'lb',
      matDesc:
        'Bars cut, tied and placed - by bar size (rebar $0.50-1.00/lb material, $1,300-2,000/ton - homeguide 2025; installed $1.51-1.77/sf #4 - Homewyse Sep 2026)',
      variants: [
        { id: '3-8', label: '3/8 in bars (#3)', rate: { mat: 0.45, lab: 0.3 } },
        { id: '1-2', label: '1/2 in bars (#4)', rate: { mat: 0.5, lab: 0.33 } },
        { id: '5-8', label: '5/8 in bars (#5)', rate: { mat: 0.53, lab: 0.36 } },
        { id: '3-4', label: '3/4 in bars (#6)', rate: { mat: 0.56, lab: 0.4 } },
        { id: '1', label: '1 in bars (#7)', rate: { mat: 0.6, lab: 0.45 } }
      ]
    },
    'concrete-labour': {
      group: 'Groundworks',
      d1: 'Concrete volume (m3)',
      d2: null,
      d3: null,
      q: a => ({ qty: a, unit: 'm3', qtyLabel: 'Concrete placed' }),
      matDesc:
        'Labour only - price the concrete itself on the slab or footings line (2026 planning band $30-60/cu yd placed and finished)',
      variants: [
        { id: 'rod-settle', label: 'Rod and settle premix', rate: { mat: 0, lab: 55 } },
        { id: 'fill-ram', label: 'Fill and ram flooring', rate: { mat: 0, lab: 48 } }
      ]
    },
    formwork: {
      group: 'Groundworks',
      d1: 'Contact area (m2)',
      d2: null,
      d3: null,
      q: a => ({ qty: a, unit: 'm2', qtyLabel: 'Formwork area' }),
      rate: { mat: 22, lab: 33 },
      matDesc: 'Formwork boards, props, release agent',
      // G1 (plan v2 Phase 2) + JIC 2025-2027 (owner 2026-10-02): all 9 JIC
      // carpentry/formwork rates by element type. First variant = pre-Phase-2
      // derived rates (22/33) so old saves and the W7 companion resolve unchanged.
      // Rates JMD from the JIC 2025-2027 book (TRU Construction Estimator).
      variants: [
        {
          id: 'wall-edge',
          label: 'Walls, edges, footings (planning model)',
          rate: { mat: 22, lab: 33 }
        },
        { id: 'belt', label: 'Belt and stiffener (planning model)', rate: { mat: 26, lab: 48 } },
        { id: 'column', label: 'Columns (planning model)', rate: { mat: 30, lab: 55 } },
        { id: 'beam', label: 'Beams (planning model)', rate: { mat: 30, lab: 55 } },
        {
          id: 'susp-floor',
          label: 'Suspended slab floor (planning model)',
          rate: { mat: 30, lab: 55 }
        },
        {
          id: 'susp-stairs',
          label: 'Suspended slab stairs (planning model)',
          rate: { mat: 26, lab: 48 }
        },
        { id: 'circular', label: 'Circular forms (planning model)', rate: { mat: 32, lab: 58 } },
        {
          id: 'manhole',
          label: 'Manhole sides and deck (planning model)',
          rate: { mat: 40, lab: 74 }
        },
        {
          id: 'new-fw',
          label: 'Make new formwork columns beam belt stiffener (planning model)',
          rate: { mat: 10, lab: 18 }
        }
      ]
    },
    'lining-out': {
      group: 'Groundworks',
      d1: '',
      d2: null,
      d3: null,
      q: a => ({ qty: a, unit: 'm', qtyLabel: 'Lining-out run' }),
      rate: { mat: 4, lab: 9 },
      matDesc: 'Profiles, string lines, pegs'
    },
    'cart-away': {
      group: 'Groundworks',
      d1: '',
      d2: null,
      d3: null,
      q: a => ({ qty: a, unit: 'm2', qtyLabel: 'Debris area' }),
      rate: { mat: 2, lab: 7 },
      matDesc: 'Debris removal allowance'
    },
    debrush: {
      group: 'Groundworks',
      d1: '',
      d2: null,
      d3: null,
      q: a => ({ qty: a, unit: 'm', qtyLabel: 'Debrush run' }),
      rate: { mat: 2, lab: 8 },
      matDesc: 'Cut and clear the line'
    },
    'post-holes': {
      group: 'Groundworks',
      d1: '',
      d2: null,
      d3: null,
      q: a => ({ qty: a, unit: 'each', qtyLabel: 'Post holes' }),
      rate: { mat: 5, lab: 25 },
      matDesc: 'Dig, set, backfill - per hole'
    },
    // ---- JIC 2025-2027 (owner 2026-10-02): all 90 rates from the official
    // JIC rate book (TRU Construction Estimator). New trades below: scaffolding
    // (Temporary and metal works family), joinery/skirtings, plumbing pipes,
    // electrical conduit, welding. Tile and paint get JIC variants added above.
    // Rates JMD; editable. Unit adapter (RATE_UNITS) handles ft2/ft run/lb/
    // dozen/yd2 entry units; per-in and per-100mm welding uses count each.
    scaffold: {
      group: 'Temporary and metal works',
      d1: 'Scaffold area (m2)',
      d2: null,
      d3: null,
      q: a => ({ qty: a, unit: 'm2', qtyLabel: 'Scaffold erected' }),
      runit: 'ft2',
      matDesc:
        'Scaffolding erected and stripped, by height band (planning models; bands follow the JIC book rows)',
      variants: [
        {
          id: 'sc-10-unbraced',
          label: 'Up to 10 ft high unbraced (planning model)',
          rate: { mat: 2, lab: 1 }
        },
        {
          id: 'sc-10-tied',
          label: 'Up to 10 ft high tied to building (planning model)',
          rate: { mat: 3, lab: 2 }
        },
        {
          id: 'sc-10-20',
          label: '10 to 20 ft tied to building (planning model)',
          rate: { mat: 4, lab: 2 }
        },
        {
          id: 'sc-20-30',
          label: '20 to 30 ft tied to building (planning model)',
          rate: { mat: 5, lab: 3 }
        },
        {
          id: 'sc-30-40',
          label: '30 to 40 ft tied to building (planning model)',
          rate: { mat: 7, lab: 4 }
        },
        {
          id: 'sc-40-50',
          label: '40 to 50 ft tied to building (planning model)',
          rate: { mat: 8, lab: 4 }
        },
        {
          id: 'sc-50-60',
          label: '50 to 60 ft tied to building (planning model)',
          rate: { mat: 8, lab: 5 }
        },
        {
          id: 'sc-60-70',
          label: '60 to 70 ft tied to building (planning model)',
          rate: { mat: 9, lab: 5 }
        },
        {
          id: 'sc-70-80',
          label: '70 to 80 ft tied to building (planning model)',
          rate: { mat: 9, lab: 5 }
        }
      ]
    },
    joinery: {
      group: 'Joinery',
      d1: 'Total run (m)',
      d2: null,
      d3: null,
      q: a => ({ qty: a, unit: 'm', qtyLabel: 'Skirting run (linear)' }),
      runit: 'ft run',
      matDesc:
        'Skirting boards by size profile and species (planning models; bands follow the JIC book rows)',
      variants: [
        {
          id: 'j-1x3-bev-wpp',
          label: '1x3 skirtings bevelled top WPP (planning model)',
          rate: { mat: 9, lab: 6 }
        },
        {
          id: 'j-1x4-bev-wpp',
          label: '1x4 skirtings bevelled top WPP (planning model)',
          rate: { mat: 10, lab: 7 }
        },
        {
          id: 'j-1x6-bev-wpp',
          label: '1x6 skirtings bevelled top WPP (planning model)',
          rate: { mat: 12, lab: 8 }
        },
        {
          id: 'j-1x3-bev-mah',
          label: '1x3 skirtings bevelled to Mah etc. (planning model)',
          rate: { mat: 10, lab: 7 }
        },
        {
          id: 'j-1x4-bev-mah',
          label: '1x4 skirtings bevelled to Mah etc. (planning model)',
          rate: { mat: 11, lab: 8 }
        },
        {
          id: 'j-1x6-bev-mah',
          label: '1x6 skirtings bevelled to Mah etc. (planning model)',
          rate: { mat: 13, lab: 9 }
        },
        {
          id: 'j-1x3-mold-wpp',
          label: '1x3 skirtings molded top WPP (planning model)',
          rate: { mat: 13, lab: 9 }
        },
        {
          id: 'j-1x4-mold-wpp',
          label: '1x4 skirtings molded top WPP (planning model)',
          rate: { mat: 14, lab: 10 }
        },
        {
          id: 'j-1x6-mold-wpp',
          label: '1x6 skirtings molded top WPP (planning model)',
          rate: { mat: 15, lab: 11 }
        },
        {
          id: 'j-1x3-mold-mah',
          label: '1x3 skirtings molded top Mah etc. (planning model)',
          rate: { mat: 14, lab: 10 }
        }
      ]
    },
    'plumbing-pipe': {
      group: 'Plumbing',
      d1: 'Total run (m)',
      d2: null,
      d3: null,
      q: a => ({ qty: a, unit: 'm', qtyLabel: 'Pipe run (linear)' }),
      runit: 'ft run',
      matDesc: 'Pipe laying by diameter (planning models; bands follow the JIC book rows)',
      variants: [
        {
          id: 'pp-6in',
          label: '6 in diameter pipes (planning model)',
          rate: { mat: 44, lab: 29 }
        },
        { id: 'pp-4in', label: '4 in diameter pipes (planning model)', rate: { mat: 33, lab: 22 } },
        { id: 'pp-3in', label: '3 in diameter pipes (planning model)', rate: { mat: 31, lab: 21 } },
        { id: 'pp-2in', label: '2 in diameter pipes (planning model)', rate: { mat: 20, lab: 14 } },
        {
          id: 'pp-1.5in',
          label: '1.5 in diameter pipes (planning model)',
          rate: { mat: 17, lab: 12 }
        },
        {
          id: 'pp-1.25in',
          label: '1.25 in diameter pipes (planning model)',
          rate: { mat: 17, lab: 12 }
        },
        {
          id: 'pp-300mm',
          label: '300mm 12 ft push fit pipes (planning model)',
          rate: { mat: 89, lab: 60 }
        },
        {
          id: 'pp-250mm',
          label: '250mm 10 ft push fit pipes (planning model)',
          rate: { mat: 72, lab: 49 }
        },
        {
          id: 'pp-200mm',
          label: '200mm 8 ft push fit pipes (planning model)',
          rate: { mat: 56, lab: 38 }
        }
      ]
    },
    'electrical-conduit': {
      group: 'Electrical',
      d1: 'Total run (m)',
      d2: null,
      d3: null,
      q: a => ({ qty: a, unit: 'm', qtyLabel: 'Conduit run (linear)' }),
      runit: 'ft run',
      matDesc: 'Conduit by diameter (planning models; bands follow the JIC book rows)',
      variants: [
        {
          id: 'ec-0.5in',
          label: '1/2 in diameter pipe (planning model)',
          rate: { mat: 5, lab: 3 }
        },
        {
          id: 'ec-0.75in',
          label: '3/4 in diameter pipe (planning model)',
          rate: { mat: 6, lab: 4 }
        },
        { id: 'ec-1in-a', label: '1 in diameter pipe (planning model)', rate: { mat: 6, lab: 5 } },
        {
          id: 'ec-1.25in-a',
          label: '1-1/4 in diameter pipe (planning model)',
          rate: { mat: 8, lab: 5 }
        },
        {
          id: 'ec-1.5in-a',
          label: '1-1/2 in diameter pipe (planning model)',
          rate: { mat: 9, lab: 6 }
        },
        { id: 'ec-2in', label: '2 in diameter pipe (planning model)', rate: { mat: 11, lab: 7 } },
        {
          id: 'ec-1in-b',
          label: '1 in diameter pipe higher rate (planning model)',
          rate: { mat: 11, lab: 7 }
        },
        {
          id: 'ec-1.25in-b',
          label: '1-1/4 in diameter pipe higher rate (planning model)',
          rate: { mat: 13, lab: 8 }
        },
        {
          id: 'ec-1.5in-b',
          label: '1-1/2 in diameter pipe higher rate (planning model)',
          rate: { mat: 15, lab: 9 }
        }
      ]
    },
    welding: {
      group: 'Temporary and metal works',
      d1: 'Total cut length (in)',
      d2: null,
      d3: null,
      q: a => ({ qty: a, unit: 'in', qtyLabel: 'Cut length (inches)' }),
      matDesc:
        'Handle mark cut and sand smooth by thickness and method (JIC 2025-2027, all 9 welding rates)',
      variants: [
        {
          id: 'w-1/8-torch',
          label: 'Handle, mark, cut & sand smooth 1/8 in thick metal, torch (planning model)',
          rate: { mat: 50, lab: 0 }
        },
        {
          id: 'w-1/4-torch',
          label: 'Handle, mark, cut & sand smooth 1/4 in thick metal, torch (planning model)',
          rate: { mat: 64, lab: 0 }
        },
        {
          id: 'w-3/8-torch',
          label: 'Handle, mark, cut & sand smooth 3/8 in thick metal, torch (planning model)',
          rate: { mat: 70, lab: 0 }
        },
        {
          id: 'w-1/2-torch',
          label: 'Handle, mark, cut & sand smooth 1/2 in thick metal, torch (planning model)',
          rate: { mat: 78, lab: 0 }
        },
        {
          id: 'w-5/8-torch',
          label: 'Handle, mark, cut & sand smooth 5/8 in thick metal, torch (planning model)',
          rate: { mat: 88, lab: 0 }
        },
        {
          id: 'w-3/4-torch',
          label: 'Handle, mark, cut & sand smooth 3/4 in thick metal, torch (planning model)',
          rate: { mat: 97, lab: 0 }
        },
        {
          id: 'w-1-torch',
          label: 'Handle, mark, cut & sand smooth 1 in thick metal, torch (planning model)',
          rate: { mat: 117, lab: 0 }
        },
        {
          id: 'w-1/16-cpsaw',
          label: 'Handle, mark, cut & sand smooth 1/16 in thick metal, CPSAW (planning model)',
          rate: { mat: 25, lab: 0 }
        },
        {
          id: 'w-1/8-cpsaw',
          label: 'Handle, mark, cut & sand smooth 1/8 in thick metal, CPSAW (planning model)',
          rate: { mat: 39, lab: 0 }
        }
      ]
    },
    // ---- JIC 2025-2027 tiling variants (owner 2026-10-02) ----------
    tile: {
      group: 'Finishes',
      d1: 'Length (m)',
      d2: 'Width (m)',
      d3: null,
      waste: { def: 10, lbl: 'Cuts / waste' },
      piece: {
        priceLabel: 'Price per tile',
        sizeLabel: 'Tile size - width x length (cm)',
        unit: 'cm',
        div: 'area',
        ph: 'e.g. 950 per tile',
        phSize: 'e.g. 30 x 60',
        plural: 'tiles'
      },
      q: (a, b) => ({ qty: a * b, unit: 'm2', qtyLabel: 'Tiles' }),
      rate: { mat: 24, lab: 32 },
      matDesc: 'Tiles, adhesive, grout, trim',
      // JIC 2025-2027: 9 tiling rates by stage, material and location.
      variants: [
        {
          id: 'standard',
          label: 'Terrazzo tiles lay and grout (planning model)',
          rate: { mat: 24, lab: 32 }
        },
        {
          id: 'terrazzo-cut',
          label: 'Terrazzo tiles first cut (planning model)',
          rate: { mat: 11, lab: 15 }
        },
        {
          id: 'terrazzo-polish',
          label: 'Terrazzo tile final cut and polish (planning model)',
          rate: { mat: 16, lab: 20 }
        },
        {
          id: 'terrazzo-upper',
          label: 'Extra for terrazzo tiling upper floors (planning model)',
          rate: { mat: 2, lab: 3 }
        },
        {
          id: 'tread-10',
          label: 'Terrazzo tiles to treads 10 in wide finished (planning model)',
          rate: { mat: 45, lab: 30 }
        },
        {
          id: 'tread-11-12',
          label: 'Terrazzo tiles to treads 11-12 in wide finished (planning model)',
          rate: { mat: 57, lab: 37 }
        },
        {
          id: 'riser-6-8',
          label: 'Terrazzo tiles to riser 6-8 in high (planning model)',
          rate: { mat: 50, lab: 33 }
        },
        {
          id: 'marble-floor',
          label: 'Lay and grout marble tiles 12 in plus edges floors (planning model)',
          rate: { mat: 42, lab: 56 }
        },
        {
          id: 'marble-wall',
          label: 'Lay and grout marble tiles 12 in plus cutting walls (planning model)',
          rate: { mat: 45, lab: 59 }
        }
      ]
    },
    // ---- JIC 2025-2027 painting variants (owner 2026-10-02) ----------
    paint: {
      group: 'Finishes',
      d1: 'Length (m)',
      d2: 'Height (m)',
      d3: null,
      openings: true,
      piece: {
        priceLabel: 'Price per container',
        sizeLabel: 'Container yield (litres)',
        single: true,
        div: 'volume',
        qtyUnit: 'L',
        ph: 'e.g. 9000 per gallon-can',
        phSize: 'e.g. 3.785'
      },
      q: (a, b) => ({ qty: (a * b * 2) / 10, unit: 'L', qtyLabel: 'Paint (2 coats at 10 m2/L)' }),
      rate: { mat: 14, lab: 11 },
      matDesc: 'Emulsion, primer, rollers',
      // JIC 2025-2027: 9 painting rates by surface, coats and location.
      variants: [
        {
          id: 'wall-1coat',
          label: 'Emulsion paint wall one coat (planning model)',
          rate: { mat: 14, lab: 11 }
        },
        {
          id: 'wall-2coat',
          label: 'Emulsion paint wall two coats (planning model)',
          rate: { mat: 28, lab: 22 }
        },
        {
          id: 'pebble-1coat',
          label: 'Emulsion paint pebble dash one coat (planning model)',
          rate: { mat: 19, lab: 15 }
        },
        {
          id: 'pebble-2coat',
          label: 'Emulsion paint pebble dash two coats (planning model)',
          rate: { mat: 36, lab: 29 }
        },
        {
          id: 'cutting-in',
          label: 'Emulsion paint cutting to line (planning model)',
          rate: { mat: 4, lab: 3 }
        },
        {
          id: 'skirting-1coat',
          label: 'Emulsion paint skirting 3-4 in one coat (planning model)',
          rate: { mat: 4, lab: 3 }
        },
        {
          id: 'skirting-2coat',
          label: 'Emulsion paint skirting 3-4 in two coats (planning model)',
          rate: { mat: 11, lab: 8 }
        },
        {
          id: 'ceiling-1coat',
          label: 'Emulsion paint ceiling one coat (planning model)',
          rate: { mat: 16, lab: 12 }
        },
        {
          id: 'ceiling-2coat',
          label: 'Emulsion paint ceiling two coats (planning model)',
          rate: { mat: 31, lab: 24 }
        }
      ]
    },
    // ---- JIC 2025-2027 steelwork: fabric mesh (JIC Steelwork #6) ----
    'fabric-mesh': {
      group: 'Structure',
      d1: 'Mesh area (m2)',
      d2: null,
      d3: null,
      q: a => ({ qty: a, unit: 'm2', qtyLabel: 'Mesh area' }),
      runit: 'yd2',
      matDesc: 'Fabric mesh lapped and tied (JIC Steelwork #6, 2025-2027)',
      rate: { mat: 5.5, lab: 2.5 }
    },
    // ---- JIC 2025-2027 stirrups (JIC Steelwork #7-9) - extends existing ----
    stirrups: {
      group: 'Structure',
      d1: 'Stirrups (count)',
      d2: null,
      d3: null,
      q: a => ({ qty: a, unit: 'each', qtyLabel: 'Stirrups' }),
      runit: 'dozen',
      matDesc: 'Links cut bent and fixed by size (planning models; bands follow the JIC book rows)',
      variants: [
        { id: '1-4', label: '1/4 in links (planning model)', rate: { mat: 6, lab: 12 } },
        { id: '3-8', label: '3/8 in links (planning model)', rate: { mat: 8, lab: 15 } },
        {
          id: '3-8-lg',
          label: '3/8 in links large girth over 6 ft (planning model)',
          rate: { mat: 11, lab: 19 }
        }
      ]
    },
    // B1 (DIRECTIVE-ASSISTANT-JIC-RATES-ACCESS): the ONE optional choice.
    // No dimension boxes and no model split - the line prices from its four
    // own fields through the Quick total path (quantity x rate, then the
    // normal on-costs and tax), so every other work item is untouched.
    custom: {
      group: 'Other',
      d1: null,
      d2: null,
      d3: null,
      q: () => ({ qty: 1, unit: '', qtyLabel: 'Quantity' }),
      rate: { mat: 0, lab: 0 },
      matDesc: 'Your own rate - one combined figure, no split'
    },
    // PART I PHASE 2 (owner, 2026-10-17): the JIC PICKER (I1 Option C). One
    // work item prices ANY row of the shipped rate book as a first-class
    // estimate line: pick a trade, pick a rate, type the quantity in the
    // ROW'S OWN unit, so quantity x rate is exact - the RATE_UNITS adapter
    // resolves to its identity, so no new money math exists here. The rate
    // prefills from the book and stays the user's to type over (the book is
    // a default, never a lock) and the row's ref + description name the line
    // on the estimate, the bill and the CSV. Money then runs the normal
    // identity: on-costs, overhead and tax.
    jic: {
      group: 'Other',
      d1: 'Quantity',
      d2: null,
      d3: null,
      q: () => ({ qty: 1, unit: '', qtyLabel: 'Quantity' }),
      rate: { mat: 0, lab: 0 },
      matDesc: 'My MaNaGeR Rate Book - planning rate, yours to edit'
    }
  };

  // ---- W2 2026-10-01: COMPANION WORK SUGGESTIONS (the punch-list reality) --
  // Pricing one trade usually implies others (a wall needs lining out, clearing
  // and carting away; a fence needs the line debrushed). PURE: each suggestion
  // derives its quantity from the SAME state - no re-typing. Suggestions are
  // one-tap adds to the bill; nothing is ever priced silently.
  const COMPANIONS = {
    blockwall: ['lineout', 'brush', 'cart'],
    brickwall: ['lineout', 'brush', 'cart'],
    framing: ['lineout', 'cart'],
    render: ['lineout', 'cart'],
    paint: ['cart'],
    drywall: ['cart'],
    siteprep: ['cart'],
    slab: ['cart3'],
    footings: ['cart3'],
    'concrete-drive': ['cart3'],
    rebar: ['cart3'],
    fencing: ['debrush', 'holes']
  };
  // A suggestion is { id, name, work, qty(st) -> number|null }. Quantities
  // derive from typed dims (already metric in st - readState stores raw typed
  // values, so imperial conversion mirrors computeFor's FT/IN rules here).
  const COMPANION_DEFS = {
    lineout: {
      name: 'Lining out the walls (profiles and string lines)',
      work: 'lining-out',
      qty: function (st) {
        const n1 = parseFloat(st.d1),
          n2 = parseFloat(st.d2);
        if (!(n1 > 0)) {
          return null;
        }
        const d1 = st.units === 'imperial' ? n1 * FT : n1;
        const run = n2 > 0 ? (st.units === 'imperial' ? n2 * FT : n2) * 2 + d1 * 2 : d1;
        return run > 0 ? run : null;
      }
    },
    brush: {
      name: 'Clear brush and strip topsoil',
      work: 'siteprep',
      qty: function (st) {
        const n1 = parseFloat(st.d1),
          n2 = parseFloat(st.d2);
        if (!(n1 > 0) || !(n2 > 0)) {
          return null;
        }
        return st.units === 'imperial' ? n1 * FT * (n2 * FT) : n1 * n2;
      }
    },
    cart: {
      name: 'Cart away debris',
      work: 'cart-away',
      qty: function (st) {
        const n1 = parseFloat(st.d1),
          n2 = parseFloat(st.d2);
        if (!(n1 > 0) || !(n2 > 0)) {
          return null;
        }
        return st.units === 'imperial' ? n1 * FT * (n2 * FT) : n1 * n2;
      }
    },
    cart3: {
      name: 'Cart away debris and surplus material',
      work: 'cart-away',
      qty: function (st) {
        const v = parseFloat(
          st.measuredQty != null && st.measuredQty !== '' ? st.measuredQty : st.measuredAuto
        );
        if (v > 0) {
          return v;
        }
        const n1 = parseFloat(st.d1),
          n2 = parseFloat(st.d2),
          n3 = parseFloat(st.d3);
        if (!(n1 > 0) || !(n2 > 0) || !(n3 > 0)) {
          return null;
        }
        const d1 = st.units === 'imperial' ? n1 * FT : n1;
        const d2 = st.units === 'imperial' ? n2 * FT : n2;
        const d3 = st.units === 'imperial' ? n3 * IN : n3;
        return d1 * d2 * (d3 / 1000);
      }
    },
    debrush: {
      name: 'Debrush the line of fence',
      work: 'debrush',
      qty: function (st) {
        const n1 = parseFloat(st.d1);
        if (!(n1 > 0)) {
          return null;
        }
        return st.units === 'imperial' ? n1 * FT : n1;
      }
    },
    holes: {
      name: 'Dig and backfill post holes',
      work: 'post-holes',
      qty: function (st) {
        const n1 = parseFloat(st.d1);
        if (!(n1 > 0)) {
          return null;
        }
        const run = st.units === 'imperial' ? n1 * FT : n1;
        return Math.min(200, Math.ceil(run / 2.5));
      }
    }
  };
  // PURE: the suggestions for a priced line's state, each with its derived
  // quantity (null qty = dims insufficient -> suggestion withheld).
  function companionsFor(st) {
    const ids = COMPANIONS[st && st.work] || [];
    return ids
      .map(function (id) {
        const def = COMPANION_DEFS[id];
        if (!def) {
          return null;
        }
        const qty = def.qty(st);
        return qty != null && qty > 0 ? { id: id, name: def.name, work: def.work, qty: qty } : null;
      })
      .filter(Boolean);
  }

  // ---- X1 (plan v2, owner directive 2026-10-01): FORGOTTEN-WORK LINTER -----
  // "Rebar with no concrete, a slab with no formwork, walls with no footing."
  // PURE rules over the bill (the BoQ lines). Each flag explains itself; the
  // ones with a derivable quantity carry a one-tap fix that adds a REAL bill
  // line through the same derived-line path as the companions. An empty or
  // small bill lints clean - nothing here invents work.
  const LINT_RULES = [
    {
      id: 'steel-no-concrete',
      msg: 'Steel is on the bill but no concrete line carries it.',
      when: function (w) {
        return w.rebar || w['rebar-size'] || w.stirrups;
      },
      missing: function (w) {
        return !w.slab && !w.footings && !w['concrete-drive'];
      },
      fix: null
    },
    {
      id: 'pour-no-formwork',
      msg: 'Concrete is priced with no formwork to hold it.',
      when: function (w) {
        return w.slab || w.footings || w['concrete-drive'];
      },
      missing: function (w) {
        return !w.formwork;
      },
      fix: { work: 'formwork', label: 'Add the derived formwork' }
    },
    {
      id: 'wall-no-footing',
      msg: 'Walls are priced with no footing under them.',
      when: function (w) {
        return w.blockwall || w.brickwall;
      },
      missing: function (w) {
        return !w.footings;
      },
      fix: null
    },
    {
      id: 'excav-no-cart',
      msg: 'Soil is being dug out with no cart-away line.',
      when: function (w) {
        return w.excav;
      },
      missing: function (w) {
        return !w['cart-away'];
      },
      fix: { work: 'cart-away', label: 'Add a cart-away allowance' }
    }
  ];
  // PURE: the flags for a bill (array of { st: { work } } lines).
  function billLint(lines) {
    const w = {};
    (lines || []).forEach(function (l) {
      if (l && l.st && WORK[l.st.work]) {
        w[l.st.work] = true;
      }
    });
    return LINT_RULES.filter(function (r) {
      return r.when(w) && r.missing(w);
    });
  }

  // Country standard tax rates (PwC VAT/GST quick table, 2026). US sales tax
  // varies by state - default 0 with the custom override for the client's rate.
  // OWNER 2026-10-02: the Jamaica rate book ships with the calculator and the
  // owner prices in Jamaican dollars, so JMD + Jamaica are the DEFAULTS for a
  // new job (was USD + US). A restored snapshot / workspace probe still wins:
  // applyState sets both fields from the stored state, so an old USD estimate
  // recalls exactly as it was saved.
  const DEFAULT_CURRENCY = 'JMD';
  const DEFAULT_COUNTRY = 'JM';
  // 'NONE' = the job carries no tax at all (owner 2026-10-02). Tax rate 0, and
  // flagged noTax so the documents say "No tax" rather than "Tax (0%)".
  const TAX = { US: 0, JM: 15, GB: 20, AU: 10, CA: 5, JP: 10, DE: 19, NONE: 0 };
  const CURRENCY = {
    USD: '$',
    JMD: 'J$',
    GBP: '\u00A3',
    EUR: '\u20AC',
    CAD: 'C$',
    AUD: 'A$',
    JPY: '\u00A5'
  };
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
  function loadFx() {
    try {
      const v = JSON.parse(localStorage.getItem(FXKEY) || '{}');
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch (e) {
      return {};
    }
  }
  // OWNER 2026-10-02 (final, no negotiable): WE ARE NOT A CONVERTER. The
  // shipped Jamaica rate book is quoted in Jamaican dollars, so JMD is simply
  // the currency we work in - no exchange rate is involved and none is seeded.
  // An earlier pass of this wave installed a starting JMD rate so the USD
  // planning-grade model rates would convert; the owner rejected it: anyone
  // who needs another currency sets their own rate, with their own date, in
  // the Exchange rates card. Until they do, a model rate that cannot convert
  // leaves the field EMPTY and says so (E1 honesty, unchanged). The JIC book's
  // own JMD rates need no conversion at all - they ARE the currency.
  function persistFx(t) {
    try {
      localStorage.setItem(FXKEY, JSON.stringify(t));
    } catch (e) {
      /* nicety */
    }
    wsStampNow('fx');
    scheduleWsPut();
  }
  // Units of `code` per 1 USD. The base needs no entry; an unknown code
  // returns null - callers must show an honest warning, never a relabel.
  function fxFactor(code) {
    if (!code || code === BASE_CURRENCY) {
      return 1;
    }
    const e = loadFx()[code];
    const per = e && parseFloat(e.per);
    return isFinite(per) && per > 0 ? per : null;
  }
  // A rate older than 180 days is flagged stale in the FX card (plan: "a
  // stale warning" - it never blocks, it tells).
  function fxStale(code) {
    const e = loadFx()[code];
    if (!e || !e.asOf) {
      return false;
    }
    const t = Date.parse(e.asOf);
    return isFinite(t) && Date.now() - t > 180 * 86400000;
  }
  // Multiplier taking a rate from `src` currency to `target` currency via
  // the USD-anchored table (src X -> target Y = per(Y) / per(X)). Null when
  // either side is missing and the pair is real - callers say so honestly.
  function fxBetween(src, target) {
    if (!src || src === target) {
      return 1;
    }
    const ps = src === BASE_CURRENCY ? 1 : fxFactor(src);
    const pt = target === BASE_CURRENCY ? 1 : fxFactor(target);
    if (ps == null || pt == null) {
      return null;
    }
    return pt / ps;
  }
  // The Exchange rates card body: one chip per set rate with its as-of date
  // (stale rates say so) and a remove button. No rate is ever fabricated.
  function renderFx() {
    const list = $('calc-fx-list'),
      dateEl = $('calc-fx-asof');
    if (dateEl && !dateEl.value) {
      try {
        dateEl.value = new Date().toISOString().slice(0, 10);
      } catch (e) {}
    }
    if (!list) {
      return;
    }
    const t = loadFx();
    const codes = Object.keys(t);
    list.innerHTML = codes.length
      ? codes
          .map(function (c) {
            const e = t[c] || {};
            return (
              '<span class="bcp-fx-chip">' +
              esc(c) +
              ': ' +
              esc(String(e.per)) +
              ' per USD (as of ' +
              esc(String(e.asOf || '?')) +
              ')' +
              (fxStale(c) ? ' - stale, update it' : '') +
              // OWNER 2026-10-02: a SEEDED rate says so. The owner must never
              // think a working conversion is one they entered themselves.

              ' <button type="button" class="btn btn-n btn-s" data-action="calcFxDel" data-code="' +
              esc(c) +
              '" aria-label="Remove the ' +
              esc(c) +
              ' rate">X</button></span>'
            );
          })
          .join(' ')
      : 'No exchange rates set yet. Model rates stay US dollars until you add one or type your own rates.';
  }

  // ---- Units (F4-1): metric is the math; imperial converts on entry -------
  // Dimensions typed in ft/in are converted before the formulas run, so the
  // rate models (per m2 / m3 / m) stay untouched. Quantities report their
  // native metric unit with an approximate imperial reading beside them.
  const FT = 0.3048; // meters per foot
  const IN = 25.4; // millimeters per inch
  let _units = 'metric';
  // Phase 2 (owner 2026-10-01): single-dim AREA/VOLUME trades type their one
  // dimension as an area or volume, not a linear foot - imperial entry converts
  // with the squared/cubed factor (1 sq ft = 0.09290304 m2; 1 cu yd = 27 x
  // 0.3048^3 m3 = 0.764554858). Trades whose quantity is a PRODUCT of separate
  // linear dims (slab, excav, blockwall, ...) keep the per-dim ft->m rule.
  const IMP_D1_FACTOR = {
    formwork: FT * FT,
    'fabric-mesh': FT * FT,
    'concrete-labour': 0.764554858,
    // WELDING UNITS FIX (2026-10-16): the welding field is INCHES in BOTH
    // unit systems - dimLabel never rewrites its '(in)' label - so the
    // imperial default ft->m multiply (FT) turned a typed 100 inches into
    // 30.48 "inches" and then priced it. 1 = entry is already the engine's
    // inch unit for this trade; imperial now prices exactly like metric.
    welding: 1
  };

  function dimLabel(w, which) {
    let lbl = w[which] || '';
    if (_units === 'imperial') {
      lbl = lbl
        .replace('(m2)', '(sq ft)')
        .replace('(m3)', '(cu yd)')
        .replace('(m)', '(ft)')
        .replace('(mm)', '(in)');
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
    m: { imp: ['ft', 3.28084, 1], met: ['m', 1, 2] },
    L: { imp: ['US gal', 0.264172, 1], met: ['L', 1, 2] }
  };
  function qtyShown(qty, unit) {
    const c = UNIT_CONV[unit];
    if (!c) {
      // 'square' (roofing square, 100 sq ft) is imperial-native: it stays
      // primary in both unit systems with an m2 aside for metric readers.
      if (unit === 'square') {
        const m2 = Math.round(qty * 9.2903 * 100) / 100;
        return {
          main: (Math.round(qty * 100) / 100).toLocaleString() + ' square',
          alt: ' (about ' + m2.toLocaleString() + ' m2)'
        };
      }
      // Counts (fixtures, panels, wiring points) are whole numbers.
      if (unit === 'each' || unit === 'point') {
        return { main: Math.round(qty).toLocaleString() + ' ' + unit, alt: '' };
      }
      return { main: Math.round(qty * 100) / 100 + ' ' + unit, alt: '' };
    }
    const pick = _units === 'imperial' ? c.imp : c.met;
    const other = _units === 'imperial' ? c.met : c.imp;
    const round = (v, dp) => Math.round(v * Math.pow(10, dp)) / Math.pow(10, dp);
    const val = round(qty * pick[1], pick[2]);
    const oval = round(qty * other[1], other[2]);
    return {
      main: val.toLocaleString() + ' ' + pick[0],
      alt: ' (about ' + oval.toLocaleString() + ' ' + other[0] + ')'
    };
  }

  // ---- C1 (AUDIT-DIRECTIVE-2026-10-18): THE MEASURED-QUANTITY UNIT BOUNDARY --
  // One physical quantity has ONE canonical unit inside the engine (m2, m3, m,
  // t, L, each), and every entry point DECLARES what unit it writes. The
  // dimension boxes already convert feet to metres; the Quick total box did
  // not, so 100 ft x 100 ft typed or sent as 10,000 became 10,000 m2 - a
  // 10.7639x overstatement of the money.
  //
  // The declaration is `dataset.entry` on #calc-measured-qty, mirrored into
  // state as `measuredEntry`, and it has exactly two values:
  //   'eng' - the number is ALREADY in the engine unit (legacy meaning; every
  //           saved estimate, every programmatic writer and every derived bill
  //           line means this, so a missing field prices exactly as before),
  //   'imp' - the number is in the imperial entry unit shown on the box
  //           (sq ft, cu yd, ft, US gal).
  const IMP_ENTRY = {
    m2: { name: 'sq ft', toEngine: 0.09290304 },
    m3: { name: 'cu yd', toEngine: 0.764554858 },
    m: { name: 'ft', toEngine: 0.3048 },
    L: { name: 'US gal', toEngine: 3.785411784 }
  };
  function entryUnitName(engineUnit) {
    const row = IMP_ENTRY[engineUnit];
    return row ? row.name : engineUnit;
  }
  function toEngineQty(value, entryFlag, engineUnit) {
    const row = IMP_ENTRY[engineUnit];
    const n = parseFloat(value);
    if (!isFinite(n)) {
      return n;
    }
    return entryFlag === 'imp' && row ? n * row.toEngine : n;
  }
  function fromEngineQty(value, entryFlag, engineUnit) {
    const row = IMP_ENTRY[engineUnit];
    const n = parseFloat(value);
    if (!isFinite(n)) {
      return n;
    }
    return entryFlag === 'imp' && row ? n / row.toEngine : n;
  }
  // Kill switch (rule N10). Default ON; a device that flips
  // mmgr_flag_calcUnitFlag to '0' gets the pre-conversion behaviour back
  // without a redeploy. Listed in docs/STORAGE-INVENTORY.md.
  function calcUnitFlagOn() {
    try {
      return localStorage.getItem('mmgr_flag_calcUnitFlag') !== '0';
    } catch (e) {
      return true;
    }
  }

  // ---- E3 (plan v2 Phase 1): RATE-ENTRY UNIT ADAPTER -----------------------
  // The engine's math is metric (m2, m3, m, t, L, each). A work item may
  // declare the unit its RATES are quoted in (a JIC-style sheet speaks yd2,
  // ft2, ft run, lb, dozen). The factor converts a per-entry-unit rate into
  // a per-engine-unit rate - the math stays metric underneath, exactly as
  // dimension entry already does. Values: how many ENTRY units make ONE
  // engine unit (entry-per-engine), because cost = qty(engine) x rate x
  // (entry per engine): 2204.62262 lb per t; 1/12 dozen per each; 1.19599005
  // yd2 per m2 (1/0.83612736); 10.7639104 ft2 per m2; 3.2808399 ft per m;
  // 1000 kg per t. Items without a runit convert 1:1, so every trade whose
  // rates are typed in the engine unit prices exactly as before.
  // AUDIT FIX (human audit, 2026-10-02): the first cut carried the m2-per-
  // entry sizes (0.836..., 0.0929..., 0.3048, 0.001) which UNDERPRICED any
  // rate quoted per yd2/ft2/ft run/kg by 16-99% - a $5.50/yd2 mesh rate
  // priced $4.60/m2 instead of $6.58/m2. Only lb and dozen were right, so
  // only the mesh golden case moved with the fix.
  const RATE_UNITS = {
    yd2: 1.19599005,
    ft2: 10.7639104,
    'ft run': 3.2808399,
    lb: 2204.62262,
    kg: 1000,
    dozen: 1 / 12
  };

  // ---- NO_DAY_BASIS: the trades that should NOT be priced by the day (D9)
  // The confirmed set only: rendering, painting and tiling. A day's output on a
  // finish swings with weather, coats and substrate, so a day rate there is a
  // poor selling rate (though a fine costing rate) - so the form says so and
  // leaves the choice alone. Nothing else is listed: a wrongly hidden mode
  // strands a tradesman who needs it, while an ill-fitting mode he chose
  // himself is recoverable. To extend the list, add the work key here - this
  // constant is the one place the rule lives.
  const NO_DAY_BASIS = ['render', 'paint', 'tile'];
  function dayBasisNotRecommended(key) {
    return NO_DAY_BASIS.indexOf(key) > -1;
  }
  function rateFactor(entry, engineUnit) {
    if (!entry || entry === engineUnit) {
      return 1;
    }
    const f = RATE_UNITS[entry];
    return isFinite(f) && f > 0 ? f : 1;
  }

  // Tiny local escaper - user-typed estimate names reach innerHTML.
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  const $ = id => document.getElementById(id);
  const num = el => {
    const v = parseFloat(el && el.value);
    return isFinite(v) && v > 0 ? v : 0;
  };

  // C3 (audit 2026-10-18): a DOCUMENT prints money to the cent. The dense screen
  // cards keep whole units (they are read at a glance), but anything that leaves
  // the browser - print, CSV, spreadsheet - sets docMoney while it renders, so a
  // 5.50 rate no longer prints as 6 and the column adds up to the total.
  let docMoney = false;
  function fmtMoney(v, code) {
    const cur = CURRENCY[code || ($('calc-currency') || {}).value] || '$';
    if (docMoney) {
      return (
        cur +
        Number(v || 0).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })
      );
    }
    const rounded = Math.round(v);
    return cur + rounded.toLocaleString();
  }

  // The fencing material rate is height-dependent; normalize to a number.
  function matRate(w, d1, d2) {
    return typeof w.rate.mat === 'function' ? w.rate.mat(d1, d2) : w.rate.mat;
  }

  // ---- Model rates (for the rate fields + Reset to model) -----------------
  function modelMatRate(key, d1m, d2m) {
    const w = WORK[key];
    if (!w) {
      return '';
    }
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
      currency: ($('calc-currency') || {}).value || DEFAULT_CURRENCY,
      country: ($('calc-country') || {}).value || DEFAULT_COUNTRY,
      quality: ($('calc-quality') || {}).value || 'standard',
      taxOverride: ($('calc-tax-override') || {}).value || '',
      wastePct: ($('calc-waste') || {}).value || '',
      rateMat: ($('calc-rate-mat') || {}).value || '',
      rateLab: ($('calc-rate-lab') || {}).value || '',
      matModel: (($('calc-rate-mat') || {}).dataset || {}).model || '',
      labModel: (($('calc-rate-lab') || {}).dataset || {}).model || '',
      rateEq: ($('calc-rate-eq') || {}).value || '',
      // All-in (JIC combined) rate + per-day crew basis. They ride the snapshot
      // so a recalled estimate reproduces its EXACT total: the all-in figure
      // alone can carry the whole work cost, and days x rate per day replaces
      // the per-unit labour entirely, so dropping either silently drifts the
      // recall away from the sum it is supposed to re-create.
      allInRate: ($('calc-allin') || {}).value || '',
      allInModel: (($('calc-allin') || {}).dataset || {}).model || '',
      basis: ($('calc-basis') || {}).value || 'measured',
      daysStr: ($('calc-days') || {}).value || '',
      dayRateStr: ($('calc-day-rate') || {}).value || '',
      verifiedOn: ($('calc-allin-verified') || {}).value || '',
      ohPct: ($('calc-oh') || {}).value || '',
      // UI-2 (REFINEMENT-DIRECTIVE-2026-10-24): the row's switch decides whether
      // the statutory drawer prices at all. A percent left in the box while the
      // row is OFF is remembered (it is still there when the row comes back on)
      // but it must not reach the maths - "switch off = drawer closed and its
      // values out of the estimate", the contract the row pattern promises.
      onCostPct: (function () {
        const t = $('calc-oncost-toggle');
        if (t && !t.checked) {
          return '';
        }
        return ($('calc-oncost-pct') || {}).value || '';
      })(),
      // UI-2: the four statutory parts ride the snapshot too, so a recall shows
      // the same breakdown the estimate was priced with instead of resetting
      // the boxes to the defaults under a total that came from other numbers.
      onCostParts: {
        nis: ($('calc-oncost-nis') || {}).value || '',
        nht: ($('calc-oncost-nht') || {}).value || '',
        edtax: ($('calc-oncost-edtax') || {}).value || '',
        heart: ($('calc-oncost-heart') || {}).value || ''
      },
      docType: docType(),
      docTitle: docTitleRaw(),
      clientName: ($('calc-client-name') || {}).value || '',
      clientAddr: ($('calc-client-addr') || {}).value || '',
      docNo: ($('calc-doc-no') || {}).value || '',
      docDate: ($('calc-doc-date') || {}).value || '',
      docDue: ($('calc-doc-due') || {}).value || '',
      piecePrice: ($('calc-piece-price') || {}).value || '',
      pieceSize: ($('calc-piece-size') || {}).value || '',
      // OWNER 2026-10-02: the special-case opt-in is part of the state, so an
      // estimate saved with a hand-typed block size recalls with the row open.
      pieceCustom: !!($('calc-piece-custom') || {}).checked,
      // B1/B7: the custom line's own four fields ride every snapshot, so a
      // reload, a bill recall or a history entry restores the same named line.
      calcCustomName: ($('calc-custom-name') || {}).value || '',
      calcCustomUnit: ($('calc-custom-unit') || {}).value || '',
      calcCustomQty: ($('calc-custom-qty') || {}).value || '',
      calcCustomRate: ($('calc-custom-rate') || {}).value || '',
      // PART I PHASE 2: the JIC picker's trade + row + rate (with its book
      // prefill marker) ride every snapshot, so a reload, a bill recall or a
      // history entry restores the same pick and the same money exactly.
      jicTrade: ($('calc-jic-trade') || {}).value || '',
      jicRef: ($('calc-jic-row') || {}).value || '',
      jicRate: ($('calc-jic-rate') || {}).value || '',
      jicModel: (($('calc-jic-rate') || {}).dataset || {}).model || '',
      measuredQty: ($('calc-measured-qty') || {}).value || '',
      // C1: how to READ the number above ('imp' = imperial entry unit shown on
      // the box, 'eng' = engine units). A missing value means 'eng'.
      measuredEntry: (($('calc-measured-qty') || {}).dataset || {}).entry || 'eng',
      measuredAuto: instSum > 0 ? String(instSum) : '',
      measuredUnit: instUnit,
      instances: JSON.stringify(instRows || []),
      openings: JSON.stringify(openRows || []),
      variant: ($('calc-variant') || {}).value || '',
      labourOnly: !!($('calc-labour-only') || {}).checked,
      units: _units
    };
  }

  // ==========================================================================
  // UI-2 (REFINEMENT-DIRECTIVE-2026-10-24): SETTING ROWS
  // One decision per row - the words, the app's own switch, and a drawer with
  // the fields that belong to it. These helpers live at module scope because
  // applyState() (a recall, a saved estimate, a history entry) has to re-sync
  // the rows, and applyState runs long before the boot wiring at the bottom.
  // ==========================================================================
  const ONCOST_PARTS = [
    { id: 'nis', name: 'NIS', pct: 3.0 },
    { id: 'nht', name: 'NHT', pct: 3.0 },
    { id: 'edtax', name: 'Education Tax', pct: 3.5 },
    { id: 'heart', name: 'HEART/NSTA Trust', pct: 3.0 }
  ]; // total 12.5 - the employer stack the page already suggested.

  function settingRowsOn() {
    try {
      return localStorage.getItem('mmgr_flag_settingRows') !== '0';
    } catch (e) {
      return true;
    }
  }

  /* Add the wiring class and mirror each switch onto its drawer. With the flag
     off nothing is hidden: the drawer stays open, exactly as the page shipped
     before this wave. */
  function ui2RowsSync() {
    const rows = document.querySelectorAll('.set-row');
    const wired = settingRowsOn();
    Array.prototype.forEach.call(rows, function (row) {
      const more = row.querySelector('.set-more');
      // A "plain" row has nothing to opt into (a trade's own piece fields):
      // it is always open and its switch is not shown.
      if (row.classList.contains('is-plain')) {
        row.classList.add('is-wired', 'is-on');
        if (more) {
          more.removeAttribute('inert');
        }
        return;
      }
      if (!wired) {
        row.classList.remove('is-wired', 'is-on');
        if (more) {
          more.removeAttribute('inert');
        }
        return;
      }
      row.classList.add('is-wired');
      const cb = row.querySelector('input[type="checkbox"]');
      if (!cb || !more) {
        return;
      }
      const on = !!cb.checked;
      row.classList.toggle('is-on', on);
      if (on) {
        more.removeAttribute('inert');
      } else {
        more.setAttribute('inert', '');
      }
      cb.setAttribute('aria-expanded', on ? 'true' : 'false');
    });
  }

  /* The tax row's switch IS the country choice: off writes the page's own
     "No tax" value, on restores the country it replaced. No second state, so
     the screen and the engine cannot disagree. */
  let taxCountryBefore = 'JM';
  function ui2TaxSync() {
    const t = $('calc-tax-toggle'),
      c = $('calc-country');
    if (!t || !c) {
      return;
    }
    t.checked = c.value !== 'NONE';
    ui2RowsSync();
  }

  function oncostPartEls() {
    return ONCOST_PARTS.map(function (p) {
      return $('calc-oncost-' + p.id);
    });
  }

  function oncostSum() {
    let sum = 0,
      any = false;
    oncostPartEls().forEach(function (el) {
      if (!el) {
        return;
      }
      const v = parseFloat(el.value);
      if (isFinite(v)) {
        sum += v;
        any = true;
      }
    });
    return any ? Math.round(sum * 100) / 100 : 0;
  }

  /* The live total under the four boxes. It reads the authoritative
     #calc-oncost-pct when that has a number (a recall, the AI settings path,
     the 12.5% suggestion), and otherwise the parts themselves - so the label is
     never blank while four rates are on screen. */
  function ui2OncostLabel() {
    const lab = $('calc-oncost-total'),
      p = $('calc-oncost-pct');
    if (!lab) {
      return;
    }
    const raw = p && p.value !== '' ? parseFloat(p.value) : NaN;
    const v = isFinite(raw) ? raw : oncostSum();
    lab.textContent = 'Total ' + Math.round(v * 100) / 100 + '% of labour';
  }

  /* Editing a part rewrites the total the engine reads. The parts are the
     editor; #calc-oncost-pct is still the one value that prices. */
  function ui2OncostWrite() {
    const p = $('calc-oncost-pct');
    if (!p) {
      return;
    }
    const sum = oncostSum();
    p.value = sum > 0 ? String(sum) : '';
    p.dataset.touched = '1';
    ui2OncostLabel();
    render();
  }

  function ui2ResetOncost() {
    oncostPartEls().forEach(function (el, i) {
      if (el) {
        el.value = String(ONCOST_PARTS[i].pct);
      }
    });
    const p = $('calc-oncost-pct');
    if (p) {
      p.value = '';
      delete p.dataset.touched;
    }
    const t = $('calc-oncost-toggle');
    if (t && t.checked) {
      if (p && $('calc-country').value === 'JM') {
        p.value = '12.5';
      }
    }
    ui2OncostLabel();
    render();
  }

  /* One entry point for everything a snapshot or a boot changed. */
  function ui2Sync() {
    ui2TaxSync();
    ui2RowsSync();
    ui2OncostLabel();
  }

  // Restore a settings object written by readState(). Every field is
  // restored so a recalled entry reproduces its sum exactly (owner
  // directive: recall must re-create the settings that achieved the sum).
  // E1/E4: while applying a snapshot, refreshRateFields must NOT re-prefill
  // the restored rate fields (a changed FX table or book would drift the
  // total away from what the estimate showed when it was saved).
  let recallHold = false;
  function applyState(st) {
    if (!st) {
      return;
    }
    if (st.units) {
      setUnits(st.units, true);
    }
    if (st.work) {
      $('calc-work').value = st.work;
    }
    // W2: restore instance rows BEFORE syncLabels (it re-renders the editor
    // and recomputes the measured sum from the rows).
    try {
      instRows = Array.isArray(JSON.parse(st.instances || '[]')) ? JSON.parse(st.instances) : [];
    } catch (e) {
      instRows = [];
    }
    // W2.7: openings rows ride the same snapshot so recall/bill lines
    // reproduce the DEDUCTED measurement exactly.
    try {
      openRows = Array.isArray(JSON.parse(st.openings || '[]')) ? JSON.parse(st.openings) : [];
    } catch (e) {
      openRows = [];
    }
    if ($('calc-measured-qty')) {
      $('calc-measured-qty').value = st.measuredQty || '';
      // C1: restore the entry unit declaration with the value, so a recalled
      // estimate re-creates its exact sum instead of re-reading old digits.
      $('calc-measured-qty').dataset.entry = st.measuredEntry || 'eng';
    }
    syncLabels();
    // E2/E6: the variant select was (re)rendered by syncLabels - restore the
    // saved pick now that its option exists. Labour mode rides the snapshot.
    if (st.variant && $('calc-variant')) {
      const hasOpt = Array.prototype.some.call($('calc-variant').options || [], function (o) {
        return o.value === st.variant;
      });
      if (hasOpt) {
        $('calc-variant').value = st.variant;
      }
    }
    if ($('calc-labour-only')) {
      $('calc-labour-only').checked = !!st.labourOnly;
    }
    $('calc-d1').value = st.d1 || '';
    if ($('calc-d2')) {
      $('calc-d2').value = st.d2 || '';
    }
    if ($('calc-d3')) {
      $('calc-d3').value = st.d3 || '';
      // B7: restore the custom fields AFTER syncLabels (a non-custom pick
      // clears them on the way; a custom pick leaves them to these values).
      const cRestore = {
        'calc-custom-name': st.calcCustomName,
        'calc-custom-unit': st.calcCustomUnit,
        'calc-custom-qty': st.calcCustomQty,
        'calc-custom-rate': st.calcCustomRate
      };
      Object.keys(cRestore).forEach(function (id) {
        const fe = $(id);
        if (fe) {
          fe.value = cRestore[id] || '';
        }
        const ee = $(id + '-err');
        if (ee) {
          ee.hidden = true;
          ee.textContent = '';
        }
      });
    }
    // PART I PHASE 2: restore the JIC pick AFTER syncLabels rendered the
    // picker (the same order the variant select uses): trade first so its
    // rows exist, then the saved row, then the rate with its book marker -
    // and a held final render syncs the unit label and the note WITHOUT
    // re-seeding the rate from the book, so a recall re-creates its saved
    // total to the cent even if the book changed underneath it.
    _jicRecall = true;
    if ($('calc-jic-trade') && st.jicTrade) {
      $('calc-jic-trade').value = st.jicTrade;
    }
    renderJicPicker();
    if ($('calc-jic-row') && st.jicRef) {
      const jRows = $('calc-jic-row').options;
      for (let ji = 0; ji < jRows.length; ji++) {
        if (jRows[ji].value === st.jicRef) {
          $('calc-jic-row').value = st.jicRef;
          break;
        }
      }
    }
    if ($('calc-jic-rate')) {
      $('calc-jic-rate').value = st.jicRate || '';
      $('calc-jic-rate').dataset.model = st.jicModel != null ? String(st.jicModel) : '';
    }
    renderJicPicker();
    _jicRecall = false;
    if ($('calc-currency')) {
      $('calc-currency').value = st.currency || DEFAULT_CURRENCY;
    }
    if ($('calc-country')) {
      $('calc-country').value = st.country || DEFAULT_COUNTRY;
    }
    if ($('calc-quality')) {
      $('calc-quality').value = st.quality || 'standard';
    }
    if ($('calc-tax-override')) {
      $('calc-tax-override').value = st.taxOverride || '';
    }
    if ($('calc-waste')) {
      $('calc-waste').value = st.wastePct || '';
    }
    if ($('calc-rate-mat')) {
      $('calc-rate-mat').value = st.rateMat || '';
    }
    if ($('calc-rate-lab')) {
      $('calc-rate-lab').value = st.rateLab || '';
    }
    // E1/E4: the saved prefill markers ride the snapshot so a recalled
    // estimate keeps its model-vs-your-rate semantics (and its exact total,
    // even if the FX table or the active book changed since it was saved).
    if ($('calc-rate-mat')) {
      $('calc-rate-mat').dataset.model =
        st.matModel != null ? String(st.matModel) : ($('calc-rate-mat').dataset || {}).model || '';
    }
    if ($('calc-rate-lab')) {
      $('calc-rate-lab').dataset.model =
        st.labModel != null ? String(st.labModel) : ($('calc-rate-lab').dataset || {}).model || '';
    }
    if ($('calc-rate-eq')) {
      $('calc-rate-eq').value = st.rateEq || '';
    }
    // All-in + per-day crew basis ride the same snapshot (restored here, with
    // their prefill markers, for the same recall-fidelity reason as the rate
    // fields above - a recalled line must price to the same money).
    if ($('calc-allin')) {
      $('calc-allin').value = st.allInRate || '';
    }
    // The chosen basis is part of the snapshot: a recalled line comes back
    // showing the same inputs it was saved with.
    if ($('calc-basis')) {
      $('calc-basis').value = st.basis || 'measured';
    }
    if ($('calc-allin')) {
      $('calc-allin').dataset.model =
        st.allInModel != null ? String(st.allInModel) : ($('calc-allin').dataset || {}).model || '';
    }
    if ($('calc-days')) {
      $('calc-days').value = st.daysStr || '';
    }
    if ($('calc-day-rate')) {
      $('calc-day-rate').value = st.dayRateStr || '';
    }
    if ($('calc-allin-verified')) {
      $('calc-allin-verified').value = st.verifiedOn || '';
    }
    if ($('calc-oh')) {
      $('calc-oh').value = st.ohPct || '';
    }
    if ($('calc-oncost-pct')) {
      $('calc-oncost-pct').value = st.onCostPct || '';
      const t = $('calc-oncost-toggle');
      if (t) {
        t.checked = !!st.onCostPct;
      }
      $('calc-oncost-pct').disabled = !$('calc-oncost-toggle').checked;
      // UI-2: restore the four parts, then re-read the total label. A snapshot
      // from before this wave carries no parts - the total above is still the
      // number that prices, and the boxes keep their defaults.
      const parts = st.onCostParts || {};
      ['nis', 'nht', 'edtax', 'heart'].forEach(function (k) {
        const el = $('calc-oncost-' + k);
        if (el && parts[k] !== undefined && parts[k] !== null) {
          el.value = String(parts[k]);
        }
      });
      ui2Sync();
    }
    if ($('calc-doc-type')) {
      $('calc-doc-type').value = st.docType || 'Estimate';
    }
    if ($('calc-doc-title')) {
      $('calc-doc-title').value = st.docTitle || '';
    }
    if ($('calc-client-name')) {
      $('calc-client-name').value = st.clientName || '';
    }
    if ($('calc-client-addr')) {
      $('calc-client-addr').value = st.clientAddr || '';
    }
    if ($('calc-doc-no')) {
      $('calc-doc-no').value = st.docNo || '';
    }
    if ($('calc-doc-date')) {
      $('calc-doc-date').value = st.docDate || '';
    }
    if ($('calc-doc-due')) {
      $('calc-doc-due').value = st.docDue || '';
    }
    if ($('calc-piece-price')) {
      $('calc-piece-price').value = st.piecePrice || '';
    }
    if ($('calc-piece-size')) {
      $('calc-piece-size').value = st.pieceSize || '';
    }
    if ($('calc-piece-custom')) {
      $('calc-piece-custom').checked = !!st.pieceCustom;
    }
    recallHold = true;
    refreshRateFields();
    recallHold = false;
    syncBasis();
  }

  // B2 (owner review 2026-09-29: 'exact count of tile boxes/units required').
  // Works with or without a piece PRICE: a size alone shows the order count
  // while material cost stays on the rate; a price also switches the per-piece
  // math on. Pure - no DOM, shared by the live estimate and the CSV export.
  function pieceCount(qty, unit, spec, sizeStr) {
    if (!spec || !sizeStr) {
      return null;
    }
    // Ceil with float-dust guard: 39.6/0.18 must be 220 pieces, not 221
    // (the raw IEEE quotient lands a hair above the integer).
    const ceilClean = v => Math.ceil(Math.round(v * 1e6) / 1e6);
    if (spec.div === 'volume') {
      const y = parseFloat(sizeStr);
      if (!isFinite(y) || y <= 0) {
        return null;
      }
      const litres = unit === 'm3' ? qty * 1000 : qty; // concrete m3 -> litres; paint is already L
      return {
        n: ceilClean(litres / y),
        lbl: unit === 'm3' ? 'bags/units' : 'containers',
        sizeTxt: y + ' L'
      };
    }
    const m = sizeStr.match(/^([\d.]+)\s*(?:x|by|\*)\s*([\d.]+)$/i);
    if (!m) {
      return null;
    }
    const conv = _units === 'imperial' ? (spec.unit === 'm' ? FT : FT * 100) : 1;
    const a = parseFloat(m[1]) * conv,
      b = parseFloat(m[2]) * conv;
    if (!(a > 0 && b > 0)) {
      return null;
    }
    if (spec.div === 'width') {
      return {
        n: ceilClean(qty / a),
        lbl: spec.plural || 'panels',
        sizeTxt: m[1] + ' x ' + m[2] + ' ' + spec.unit
      };
    }
    const areaM2 = spec.unit === 'm' ? a * b : (a / 100) * (b / 100);
    return {
      n: ceilClean(qty / areaM2),
      lbl: spec.plural || 'pieces',
      sizeTxt: m[1] + ' x ' + m[2] + ' ' + spec.unit
    };
  }

  // D2 (owner review 2026-09-29): PURE estimate engine. Takes a readState()-
  // shaped settings object, touches NO DOM, returns the full breakdown. The
  // live form (compute), recall fidelity, and the comparison table all run
  // through this one function - one math path, zero drift.
  function computeFor(st) {
    const key = st.work;
    // B1: the custom line prices from its own four fields through the Quick
    // total path - never from the dimension boxes or the model split.
    const isCustom = key === 'custom';
    // PART I PHASE 2: the JIC picker line prices from its OWN picked row +
    // rate fields (like the custom line from its four), never from the
    // dimension model - the row resolves from PURE state, so a recalled
    // snapshot prices from the pick it was saved with.
    const isJic = key === 'jic';
    const jicRow = isJic ? jicRowFor(st.jicTrade, st.jicRef) : null;
    const w = WORK[key];
    if (!w) {
      return null;
    }
    // E2: the picked variant (a legacy state with no variant resolves to the
    // first, whose rates equal the pre-conversion model).
    const av = activeVariant(w, st);
    // W2 measured quantity: element rows (or the override field) feed the
    // engine directly - dim validation and q() are skipped, everything
    // downstream (waste, quality, piece pricing, rates) unchanged.
    const mqRaw = parseFloat(
      st.measuredQty != null && st.measuredQty !== '' ? st.measuredQty : st.measuredAuto
    );
    const hasMq = isFinite(mqRaw) && mqRaw > 0;
    // C1: the trade's canonical unit is needed BEFORE any measured quantity is
    // converted, so this block (it depends on nothing else) is hoisted here.
    const canon = (function () {
      try {
        return w.q(1, w.d2 ? 1 : null, w.d3 ? 1 : null) || {};
      } catch (e) {
        return {};
      }
    })();
    const mqUnit = st.measuredUnit || canon.unit || '';
    // ONE conversion, decided by what the number IS (measuredEntry), never by
    // the unit system alone.
    const mqQty = hasMq && calcUnitFlagOn() ? toEngineQty(mqRaw, st.measuredEntry, mqUnit) : mqRaw;
    // B1: the custom line's own quantity and rate. The quantity falls back
    // to the Quick total box so the one measurement x one rate path prices a
    // custom line too (the assistant and T4 write there); the rate prefers
    // the typed custom field and only then the all-in field when the chooser
    // says the all-in basis is in play - the chooser stays authoritative.
    const cQtyRaw = parseFloat(st.calcCustomQty);
    const cQtyOk = isFinite(cQtyRaw) && cQtyRaw > 0;
    const cRateRaw = parseFloat(st.calcCustomRate);
    const cRateOk = isFinite(cRateRaw) && cRateRaw > 0;
    const cUnit = isCustom ? String(st.calcCustomUnit || '').trim() : '';
    const custQty = isCustom ? (cQtyOk ? cQtyRaw : hasMq ? mqQty : 0) : 0;
    // PART I PHASE 2: the JIC line's own quantity (d1, in the ROW's own
    // unit, falling back to the Quick total box exactly like the custom
    // line) and its own rate (prefilled from the book, the user's to edit).
    const jicQtyRaw = parseFloat(st.d1);
    const jicQty = isJic ? (jicQtyRaw > 0 ? jicQtyRaw : hasMq ? mqQty : 0) : 0;
    const jicRateRaw = parseFloat(st.jicRate);
    const jicRateOk = isFinite(jicRateRaw) && jicRateRaw > 0;
    const raw1 = num({ value: st.d1 });
    const raw2 = w.d2 ? num({ value: st.d2 }) : null;
    const raw3 = w.d3 ? num({ value: st.d3 }) : null;
    // PART I PHASE 2: the JIC line validates against its OWN pick - the row
    // must resolve, the quantity must be positive, and the rate must be a
    // number (the book prefill satisfies that the moment a row is chosen).
    if (isJic && !jicRow) {
      return {
        error: 'Pick a trade and a rate in the ' + RATEBOOK_NAME + ' picker before pricing.'
      };
    }
    if (isJic && !(jicQty > 0)) {
      return { error: 'Enter the quantity for this planning rate - it prices as quantity x rate.' };
    }
    if (isJic && !jicRateOk) {
      return {
        error: 'Type the rate for this row - the book rate is prefilled and yours to edit.'
      };
    }
    if (!isCustom && !isJic && !hasMq && (!raw1 || (w.d2 && !raw2) || (w.d3 && !raw3))) {
      return {
        error: 'Enter the dimensions the form asks for (all three when thickness or depth applies).'
      };
    }
    // Imperial entry converts to the metric the formulas speak (ft to m,
    // in to mm); metric passes through untouched. A single-dim area/volume
    // trade converts its one dim with its squared/cubed factor (IMP_D1_FACTOR).
    const imp = st.units === 'imperial';
    const d1 = imp ? raw1 * (IMP_D1_FACTOR[key] || FT) : raw1;
    const d2 = w.d2 ? (imp ? raw2 * FT : raw2) : null;
    const d3 = w.d3 ? (imp ? raw3 * IN : raw3) : null;
    // Manual overrides carry no row-derived unit: `canon`/`mqUnit` are derived
    // above (C1) with the trade's OWN quantity label, so the result heading can
    // never read "undefined" on the typed-total path (owner 2026-10-10, F-3).
    const qr = isCustom
      ? { qty: custQty, unit: cUnit || mqUnit, qtyLabel: 'Quantity' }
      : isJic
        ? { qty: jicQty, unit: jicUnitFor(jicRow, imp), qtyLabel: 'Quantity' }
        : hasMq
          ? { qty: mqQty, unit: mqUnit, qtyLabel: canon.qtyLabel || 'Measured quantity' }
          : w.q(d1, d2, d3);
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
    const modelMr = hasMq
      ? av
        ? av.rate.mat
        : matRate(w, mqQty, null)
      : av
        ? av.rate.mat
        : matRate(w, d1, d2);
    // F4b rate freedom: an explicitly typed rate overrides the model. The
    // wrapper passes dataset.model for the live form; a recalled/comparison
    // state has no dataset, so any numeric value it carries IS its rate.
    const matRaw = parseFloat(st.rateMat);
    const labRaw = parseFloat(st.rateLab);
    const matModel = st._matModel != null ? String(st._matModel) : null;
    const labModel = st._labModel != null ? String(st._labModel) : null;
    // ---- All-in rate + per-day crew rate (owner decisions 2026-10-02) ----
    // Two optional per-line inputs, both read from the state object only and
    // both DEFAULT-INERT: absent, blank, zero, negative or absurd means the
    // line prices exactly as it did before they existed. Every branch below
    // is a no-op unless its own guard passes, so a snapshot from before this
    // feature (or any state object without these keys) is unchanged.
    //
    // D3 - the all-in rate is the JIC COMBINED figure: one number covering
    // material, labour and the statutory costs on it. We never invent a split,
    // so mat and lab read 0 for presentation while the money lives in
    // allInCost and lands in the subtotal unchanged.
    const allInRaw = parseFloat(st.allInRate);
    // The CHOOSER is authoritative when it says which basis is in play, so a
    // figure left behind in the other mode's field can never price a line or
    // reach a document. Absent (a legacy snapshot, a golden case, the pure
    // engine called with a hand-built state) means "either may apply", and
    // all-in still wins the overlap exactly as below.
    const basis = st.basis || '';
    // OWNER 2026-10-02 BUG FIX: the shipped Jamaica book is now the DEFAULT,
    // so an all-in figure sits prefilled in #calc-allin for every trade the
    // book covers. The old guard only excluded the 'days' basis, which meant
    // picking "measured" priced the line from the hidden all-in field anyway -
    // the chooser became a lie and the measured basis was unreachable for any
    // covered trade. The CHOOSER IS AUTHORITATIVE: an all-in figure prices only
    // when the chooser is on 'allin', or when no basis is present at all (a
    // legacy snapshot / golden case / hand-built state, which must keep the
    // old all-in-beats-everything behaviour).
    // B1: a custom line prices from its OWN rate when typed, and otherwise
    // from the all-in field - but only when the chooser says the all-in
    // basis is in play, exactly like every other line. Every other work
    // item keeps the original rule unchanged.
    const custRate = isCustom
      ? cRateOk
        ? cRateRaw
        : isFinite(allInRaw) && allInRaw > 0 && basis !== 'days' && basis !== 'measured'
          ? allInRaw
          : 0
      : 0;
    const allIn = isCustom
      ? custQty > 0 && custRate > 0
      : isJic
        ? jicQty > 0 && jicRateOk
        : isFinite(allInRaw) && allInRaw > 0 && basis !== 'days' && basis !== 'measured';
    const allInRate = isCustom
      ? allIn
        ? custRate
        : 0
      : isJic
        ? allIn
          ? jicRateRaw
          : 0
        : allIn
          ? allInRaw
          : 0;
    // The book (or the model) prefills this field and the prefill marker rides
    // the snapshot, exactly like the material/labour fields. A number equal to
    // the marker came from the source; anything else was typed by the user and
    // wins (D4 - the book is a default, never a lock).
    const allInModel = st._allInModel != null ? String(st._allInModel) : null;
    // A custom rate is ALWAYS the user's own figure - never a book prefill,
    // so it never claims a published source and it may show "your rate".
    // A JIC rate claims the published source only while it still EQUALS its
    // book prefill marker - the same D4 contract as the split rate fields.
    const allInOverride = isCustom
      ? allIn
      : isJic
        ? allIn && (st._jicModel == null || String(jicRateRaw) !== String(st._jicModel))
        : allIn && (allInModel === null || String(allInRaw) !== allInModel);
    const bookFilled = isCustom ? false : allIn && !allInOverride;
    // ---- Per-day crew rate ------------------------------------------------
    // The tradesman knows how many days the job takes, so he types the days
    // and the crew rate for one of them (D1 - per-hour and any productivity
    // norm are deliberately out of scope; typing the days removes the norm).
    // Days land on quarter-day steps (half and quarter days are normal on
    // site); 0, negative, non-numeric or an absurd figure (> 2000) falls back
    // to the normal per-unit labour path rather than putting NaN in a total.
    const daysRaw = parseFloat(st.daysStr);
    const daysOk = isFinite(daysRaw) && daysRaw > 0 && daysRaw <= 2000;
    const days = daysOk ? Math.round(daysRaw * 4) / 4 : 0;
    const dayRateRaw = parseFloat(st.dayRateStr);
    const dayRateOk = isFinite(dayRateRaw) && dayRateRaw > 0;
    const dayRate = dayRateOk ? dayRateRaw : 0;
    // Both halves must be present and sane; one alone is not a day rate.
    const dayBasis = daysOk && dayRateOk && basis !== 'allin';
    // D2 - one crew rate per day, never a row per person. A document shows a
    // single labour total, so there is no role list anywhere in this engine.
    // E1/E4 (plan v2 Phase 1): the rate FIELDS carry the money that gets
    // charged - the prefill already converted it (active book rate or model
    // rate at the estimate's exchange rate), so a present field always
    // prices and the override flag only drives the "your rate" annotation.
    // An empty field falls back to the raw WORK model (US dollars); callers
    // flag that case so the render can say so honestly instead of relabelling.
    const matPresent = isFinite(matRaw) && matRaw >= 0;
    const labPresent = isFinite(labRaw) && labRaw >= 0;
    // ---- C2 (AUDIT-DIRECTIVE-2026-10-18): NEVER charge across currencies ----
    // The planning model's rates are US dollars. With a local currency and no
    // exchange rate the engine used to fall back to that raw model and charge
    // USD 22 / USD 28 as J$22 / J$28 (the CSV even printed "model rates are US
    // dollars" beside the J$ total). That is how two quotes for the same job
    // came out 32.7x apart. It now refuses in plain words instead of guessing;
    // an all-in line, a JIC pick, a custom line and a crew-day line are all
    // exempt because none of them touches the model rates.
    if (
      st._fxMissing &&
      !isCustom &&
      !isJic &&
      !allIn &&
      !dayBasis &&
      !(matPresent && labPresent)
    ) {
      return {
        error:
          'No exchange rate is set for ' +
          (st.currency || 'this currency') +
          ', so the planning model (US dollars) cannot price this line. Choose the book rate to ' +
          'use the ' +
          RATEBOOK_NAME +
          ', type your own material and labour rates, or add the rate in ' +
          'Exchange rates.'
      };
    }
    const matOverride = matPresent && (matModel === null || String(matRaw) !== matModel);
    const labOverride = labPresent && (labModel === null || String(labRaw) !== labModel);
    const mr = matPresent ? matRaw : modelMr;
    const lr = labPresent ? labRaw : av ? av.rate.lab : w.rate.lab;
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
    if (w.piece && (!isFinite(pieceRaw) || pieceRaw <= 0) && (st.pieceSize || '').trim() !== '') {
      const countOnly = pieceCount(qty, qr.unit, w.piece, (st.pieceSize || '').trim());
      if (countOnly) {
        piece = { countOnly: true, count: countOnly };
      }
    }
    if (w.piece && isFinite(pieceRaw) && pieceRaw > 0) {
      const spec = w.piece;
      const sizeStr = (st.pieceSize || '').trim();
      if (spec.div === 'volume') {
        const yieldL = parseFloat(sizeStr);
        if (isFinite(yieldL) && yieldL > 0) {
          // Match the quantity's unit: m3 trades need $/m3 (price x 1000 /
          // yield), litre trades need $/L (price / yield).
          const perUnit = spec.qtyUnit === 'm3' ? (pieceRaw * 1000) / yieldL : pieceRaw / yieldL;
          piece = {
            w: yieldL,
            l: null,
            unit: 'L',
            qtyUnit: spec.qtyUnit,
            div: 'volume',
            price: pieceRaw,
            perUnit: perUnit
          };
        }
      } else {
        const m = sizeStr.match(/^([\d.]+)\s*(?:x|by|\*)\s*([\d.]+)$/i);
        if (m) {
          const conv = st.units === 'imperial' ? (spec.unit === 'm' ? FT : FT * 100) : 1;
          const a = parseFloat(m[1]) * conv,
            b = parseFloat(m[2]) * conv;
          if (a > 0 && b > 0) {
            if (spec.div === 'width') {
              piece = {
                w: a,
                l: b,
                unit: spec.unit,
                div: 'width',
                price: pieceRaw,
                perUnit: pieceRaw / a
              };
            } else {
              const areaM2 = spec.unit === 'm' ? a * b : (a / 100) * (b / 100);
              piece = {
                w: a,
                l: b,
                unit: spec.unit,
                div: 'area',
                price: pieceRaw,
                areaM2: areaM2,
                perUnit: pieceRaw / areaM2
              };
            }
          }
        }
      }
    }
    const quality = QUALITY[st.quality] || 1;
    // E3: rates (model or typed - both follow the labeled rate basis)
    // convert from the item's rate-entry unit into the engine unit. Piece
    // pricing already prices per engine unit and never takes the factor.
    // PART I PHASE 2: the JIC line's rate-entry unit IS the row's own unit,
    // so the RATE_UNITS adapter resolves to its identity and the quantity x
    // rate below is exact in both display systems.
    const runit = isJic ? jicUnitFor(jicRow, imp) : (av && av.runit) || w.runit || null;
    const rf = rateFactor(runit, qr.unit);
    // E6: labour-only mode prices the WORK - labor at its rate; material
    // money is the user's own, so a typed material rate still shows while
    // the model/piece material price is excluded.
    // D3 guard: the all-in rate is the whole work cost, so it BEATS piece
    // pricing and labour-only mode rather than stacking on top of them. A form
    // must never trap the user in an error state, so the winner is reported and
    // the losers simply report inactive - never double-applied.
    const labourOnly = !!st.labourOnly && !allIn;
    const pieceActive = !allIn && !!(piece && !piece.countOnly);
    const matExcluded = labourOnly && !matOverride;
    // Area trades: $/m2 x m2 quantity. Fencing width-div: $/run-m x m run.
    // The qty x rate dimension check holds for both.
    const effMat = allIn || matExcluded ? 0 : pieceActive ? piece.perUnit : mr * rf;
    const mat = allIn ? 0 : qty * effMat * quality;
    // D8 (locked): the finish-level multiplier scales the MATERIAL unit rate
    // only. A typed day rate is a price for one crew-day, not a unit rate, so
    // multiplying it by economy/standard/premium would silently inflate it.
    // lab = days x rate per day, used exactly as typed.
    const labDayBasis = dayBasis ? days * dayRate : 0;
    const lab = allIn ? 0 : dayBasis ? labDayBasis : qty * lr * rf * quality;
    // All-in combined work cost. It carries its own material, its own labour
    // and the statutory costs on that labour, so it enters the subtotal whole
    // and on-costs are NOT added on top of it (adding them would charge the
    // employer's NI twice).
    // B1: a custom line is quantity x its rate EXACTLY - the user's own
    // figure, never converted, never scaled by the finish level, never
    // split. A JIC line is quantity x the picked book rate EXACTLY (the
    // published figure is already a combined rate, per the row's own unit).
    // Every other all-in line keeps the rf/quality treatment.
    const allInCost =
      isCustom || isJic
        ? allIn
          ? qty * allInRate
          : 0
        : allIn
          ? qty * allInRate * rf * quality
          : 0;
    const eq = qty * eqRate * rf * quality;
    // OWNER 2026-10-02: 'NONE' is a first-class country value meaning
    // "this job is not taxed" (TAX.NONE = 0). It is NOT an override - the
    // breakdown must read "No tax", not "Tax (0% - your rate)".
    const country = st.country || DEFAULT_COUNTRY;
    const overrideRaw = parseFloat(st.taxOverride);
    const override = isFinite(overrideRaw) && overrideRaw >= 0 ? overrideRaw : null;
    const noTax = country === 'NONE';
    const taxRate = override !== null ? override : TAX[country] || 0;
    // Statutory on-costs ride LABOUR only, so they apply to a typed day rate
    // (it is payroll) but not to an all-in rate (already inside the figure).
    // B1: a CUSTOM or JIC line carries the page's normal on-costs on its
    // own cost - the committed contract in calculator.html ("quantity times
    // all-in rate, then the normal on-costs and tax"). Every other line
    // unchanged.
    const onCost = ((lab + (isCustom || isJic ? allInCost : 0)) * onCostPct) / 100;
    const sub = mat + lab + onCost + eq + allInCost;
    const oh = (sub * ohPct) / 100;
    const tax = ((sub + oh) * taxRate) / 100;
    const orderCount = pieceCount(qty, qr.unit, w.piece, (st.pieceSize || '').trim());
    // Note: no `name` here - workName() reads the DOM. compute() attaches the
    // live name; the comparison table uses each saved estimate's stored name.
    return {
      key,
      qty: qty,
      baseQty: qr.qty,
      unit: qr.unit,
      qtyLabel: qr.qtyLabel,
      matDesc: isJic && jicRow ? jicRow.ref + ' - ' + jicRow.desc : w.matDesc,
      basis: basis || null,
      orderCount: orderCount,
      openings: openings,
      hasOpenings: !!w.openings,
      wastePct: wastePct,
      hasWaste: !!w.waste,
      wasteLbl: w.waste ? w.waste.lbl : null,
      mr,
      lr,
      eqRate,
      eq,
      onCost,
      onCostPct,
      ohPct,
      oh,
      effMat,
      modelMr,
      piece,
      mat,
      lab,
      sub,
      taxRate,
      tax,
      total: sub + oh + tax,
      overrideApplied: override !== null,
      matOverridden: matOverride,
      labOverridden: labOverride,
      currency: st.currency || DEFAULT_CURRENCY,
      noTax: noTax,
      // All-in (JIC combined) + per-day crew basis. Every field is inert when
      // the corresponding input is blank, so a caller can read allIn/dayBasis
      // without first testing the raw strings.
      allIn: allIn,
      allInRate: allInRate,
      allInCost: allInCost,
      isCustom: isCustom,
      customName: isCustom ? String(st.calcCustomName || '').trim() : '',
      customUnit: isCustom ? cUnit : '',
      customRate: isCustom ? allInRate : 0,
      isJic: isJic,
      jicRef: jicRow ? jicRow.ref : '',
      allInOverridden: allInOverride,
      bookFilled: bookFilled,
      dayBasis: dayBasis,
      days: days,
      dayRate: dayRate,
      labDayBasis: labDayBasis,
      pieceActive: pieceActive,
      labourOnly: labourOnly,
      matExcluded: matExcluded,
      runit: runit,
      rateFactor: rf,
      variant: av ? av.id : null,
      variantLabel: av ? av.label : null
    };
  }

  // Live-form wrapper: snapshot the DOM into a settings object (passing the
  // current model-prefill markers so override detection behaves exactly as
  // before), run the pure engine, and attach the DOM-derived name.
  function compute() {
    const st = readState();
    // C2 (AUDIT-DIRECTIVE-2026-10-18): computeFor is pure and reads the state
    // object, so this wrapper tells it the one fact it cannot know - that a
    // local currency is in play with no exchange rate to reach the planning
    // model's US dollars. Without it the engine charged USD 22 as J$22.
    const curNow = st.currency || DEFAULT_CURRENCY;
    st._fxMissing = curNow !== BASE_CURRENCY && fxFactor(curNow) == null;
    st._matModel = $('calc-rate-mat') ? $('calc-rate-mat').dataset.model : undefined;
    st._labModel = $('calc-rate-lab') ? $('calc-rate-lab').dataset.model : undefined;
    st._allInModel = $('calc-allin') ? $('calc-allin').dataset.model : undefined;
    st._jicModel = $('calc-jic-rate') ? $('calc-jic-rate').dataset.model : undefined;
    const r = computeFor(st);
    if (r && !r.error) {
      r.name = workName(st.work);
      // Owner directive 2026-10-01: the unit-slip guard rides every result.
      r.slips = dimSlips(st);
      // E1 honesty flag: model/book money is still in its source currency
      // because no FX rate is set for the picked one - the render says so in
      // USD terms instead of relabelling. Both rates typed = all the user's
      // own money = nothing to flag.
      // OWNER 2026-10-02: an ALL-IN line is exempt. It charges only allInCost,
      // which comes from the single figure sitting in #calc-allin - and when
      // that figure came from the JIC book it is already in the book's own
      // currency (JMD), i.e. the estimate's currency. The split model rates it
      // never uses are not on the document, so flagging them would print a
      // false "these are US dollars" banner over a correct Jamaican total.
      const cur = st.currency || DEFAULT_CURRENCY;
      if (
        !r.allIn &&
        cur !== BASE_CURRENCY &&
        fxFactor(cur) == null &&
        ((!r.matOverridden && !r.matExcluded) || !r.labOverridden)
      ) {
        r.modelUnconverted = true;
      }
    }
    return r;
  }

  // ---- C2 (AUDIT-DIRECTIVE-2026-10-18): THE RATE COMPARISON + SANITY BANNER --
  // Pure: it lists the money the form is offering for THIS line, per unit, and
  // reports how far apart the live figures are. Two prices for the same unit
  // more than 3x apart is the signature of a currency or unit slip - the owner
  // saw 22 + 28 per m2 beside 1,747 per m2 on the same job (32.7x). Nothing
  // here blocks a send; it makes the gap visible before one.
  function rateSanity(rates) {
    const priced = [];
    Object.keys(rates || {}).forEach(function (k) {
      const v = parseFloat(rates[k]);
      if (isFinite(v) && v > 0) {
        priced.push({ key: k, value: v });
      }
    });
    if (priced.length < 2) {
      return { ok: true, ratio: null };
    }
    priced.sort(function (a, b) {
      return a.value - b.value;
    });
    const ratio = priced[priced.length - 1].value / priced[0].value;
    return {
      ok: ratio <= 3,
      ratio: Math.round(ratio * 100) / 100,
      low: priced[0].key,
      high: priced[priced.length - 1].key
    };
  }

  function rateComparison(st, r) {
    const local = st.currency || DEFAULT_CURRENCY;
    const sym = CURRENCY[local] || '';
    const w = WORK[st.work];
    const av = w && w.variants ? activeVariant(w, st) : null;
    const unit =
      (r && r.unit) ||
      (w && w.q ? (w.q(1, w.d2 ? 1 : null, w.d3 ? 1 : null) || {}).unit : '') ||
      '';
    const per = unit ? 'Per ' + (_units === 'imperial' ? entryUnitName(unit) : unit) : 'Per unit';
    const allIn = parseFloat(st.allInRate);
    const mat = parseFloat(st.rateMat);
    const lab = parseFloat(st.rateLab);
    const haveSplit = isFinite(mat) && mat > 0 && isFinite(lab) && lab > 0;
    const modelUsd = av && av.rate ? Number(av.rate.mat) + Number(av.rate.lab) : 0;
    // A model figure is only a PRICE once it is in the estimate's currency.
    const fx = st._fxMissing ? null : fxFactor(local);
    const rates = {};
    if (isFinite(allIn) && allIn > 0) {
      rates.book = allIn;
    }
    if (haveSplit) {
      rates.split = mat + lab;
    }
    if (fx != null && modelUsd > 0) {
      rates.model = modelUsd * fx;
    }
    const parts = [
      'Book rate ' +
        (rates.book != null ? fmtMoney(rates.book, local) : sym + '0 (pick the book rate)'),
      'Your split ' +
        (haveSplit ? fmtMoney(rates.split, local) : sym + '0 (add a material and a labour rate)'),
      st._fxMissing && local !== BASE_CURRENCY
        ? 'Model needs an exchange rate'
        : 'Model ' + fmtMoney(rates.model || 0, local)
    ];
    return { title: per, text: parts.join('  |  '), rates: rates, sanity: rateSanity(rates) };
  }

  function renderRateCompare(r, st) {
    const strip = $('calc-rate-compare');
    if (!strip) {
      return;
    }
    const cmp = rateComparison(st, r);
    const txt = cmp.title + ': ' + cmp.text;
    if (strip.textContent !== txt) {
      strip.textContent = txt;
    }
    const banner = $('calc-rate-sanity');
    if (banner) {
      const bad = cmp.sanity && cmp.sanity.ok === false;
      const msg = bad
        ? 'These two rates differ by ' +
          cmp.sanity.ratio.toFixed(1) +
          ' times. Check the currency and the unit before you send this.'
        : '';
      if (banner.textContent !== msg) {
        banner.textContent = msg;
      }
      banner.hidden = !bad;
    }
  }

  // ---- Named estimates (F4-3): save / recall / delete, this device only ---
  const NKEY = 'mmgr_calc_estimates';
  function loadEstimates() {
    try {
      return JSON.parse(localStorage.getItem(NKEY) || '[]');
    } catch (e) {
      return [];
    }
  }
  function persistEstimates(list) {
    try {
      localStorage.setItem(NKEY, JSON.stringify(list.slice(0, 30)));
    } catch (e) {
      /* storage full - saving is a nicety, never a gate */
    }
    wsStampNow('estimates');
    scheduleWsPut();
  }

  // ---- Rate sheets (owner 2026-09-28: 'low-bid', 'sustain' - companies price
  // differently per job, save the whole rate set under a name and switch).
  // Stores the current rate fields (material, labor, piece) under a name;
  // applying a sheet fills the fields; the model prefill rule is bypassed
  // because the fields are non-empty. Device-local, 20 cap.
  const RKEY = 'mmgr_calc_rate_sheets';
  function applySheetById(id) {
    const sh = loadSheets().find(function (x) {
      return x.id === id;
    });
    if (!sh) {
      return;
    }
    const r = sh.rates;
    if ($('calc-rate-mat')) {
      $('calc-rate-mat').value = r.rateMat;
    }
    if ($('calc-rate-lab')) {
      $('calc-rate-lab').value = r.rateLab;
    }
    if ($('calc-piece-price')) {
      $('calc-piece-price').value = r.piecePrice || '';
    }
    if ($('calc-piece-size')) {
      $('calc-piece-size').value = r.pieceSize || '';
    }
    if ($('calc-rate-mat')) {
      $('calc-rate-mat').dataset.sheet = sh.name;
    }
    render();
    const outEl = $('calc-output');
    if (outEl) {
      outEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
  function loadSheets() {
    try {
      return JSON.parse(localStorage.getItem(RKEY) || '[]');
    } catch (e) {
      return [];
    }
  }
  function persistSheets(list) {
    try {
      localStorage.setItem(RKEY, JSON.stringify(list.slice(0, 20)));
    } catch (e) {
      /* nicety, never a gate */
    }
    wsStampNow('sheets');
    scheduleWsPut();
  }

  // D1 helper: transient status line under the sheets bar (also used by the
  // import flow so the user always sees what happened to their file).
  function sheetMsg(text) {
    const el = $('calc-sheet-msg');
    if (!el) {
      return;
    }
    el.textContent = text;
    el.hidden = !text;
    if (text) {
      setTimeout(function () {
        el.hidden = true;
      }, 5000);
    }
  }

  // D1: validate + merge an imported sheets payload. Returns how many were
  // merged and how many entries were skipped (never throws).
  function importSheets(json) {
    if (!json || !Array.isArray(json.sheets)) {
      return null;
    }
    const existing = loadSheets();
    let merged = 0,
      skipped = 0;
    json.sheets.forEach(function (item) {
      const name = item && typeof item.name === 'string' ? item.name.trim().slice(0, 40) : '';
      const r = item && item.rates ? item.rates : {};
      const mat = parseFloat(r.rateMat),
        lab = parseFloat(r.rateLab);
      if (!name || !isFinite(mat) || mat < 0 || !isFinite(lab) || lab < 0) {
        skipped++;
        return;
      }
      const sheet = {
        id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), // ok: non-secret
        name: name,
        at: new Date().toISOString().slice(0, 10),
        rates: {
          rateMat: String(mat),
          rateLab: String(lab),
          rateEq: r.rateEq != null && isFinite(parseFloat(r.rateEq)) ? String(r.rateEq) : '',
          piecePrice: r.piecePrice || '',
          pieceSize: r.pieceSize || ''
        }
      };
      const at = existing.findIndex(function (x) {
        return (x.name || '').toLowerCase() === name.toLowerCase();
      });
      if (at > -1) {
        existing[at] = sheet;
      } else {
        existing.unshift(sheet);
      }
      merged++;
    });
    if (merged) {
      persistSheets(existing);
      renderSheets();
    }
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
  // OWNER 2026-10-02: marks that the shipped Jamaica book has been installed on
  // this device. Set once on the FIRST visit so the default happens exactly
  // once - afterwards the user's own book choice is never overridden.
  const JICSEEN = 'mmgr_calc_jic_default';
  function loadBooks() {
    try {
      return JSON.parse(localStorage.getItem(BKKEY) || '[]');
    } catch (e) {
      return [];
    }
  }
  function activeBookId() {
    try {
      return JSON.parse(localStorage.getItem(ACTBK) || '""') || '';
    } catch (e) {
      return '';
    }
  }
  function activeBook() {
    const id = activeBookId();
    return (
      loadBooks().find(function (b) {
        return b && b.id === id;
      }) || null
    );
  }
  function setActiveBook(id) {
    try {
      localStorage.setItem(ACTBK, JSON.stringify(String(id || '')));
    } catch (e) {
      /* nicety */
    }
    wsStampNow('books');
    scheduleWsPut();
  }
  function persistBooks(list) {
    try {
      localStorage.setItem(BKKEY, JSON.stringify(list.slice(0, 20)));
    } catch (e) {
      /* nicety */
    }
    wsStampNow('books');
    scheduleWsPut();
  }
  // djb2 over a canonical rendering of the rates - detects any hand edit.
  // The checksum MUST cover every field the validator keeps, including the
  // all-in figure: it is computed over the CLEANED rates, so a book whose only
  // new field is `allIn` would otherwise fail its own checksum and be skipped
  // on the very next import. Key order is sorted so the same book always
  // digests the same way regardless of how the JSON was written.
  function canonRates(rates) {
    return Object.keys(rates || {})
      .sort()
      .map(function (k) {
        const vs = rates[k] || {};
        return (
          k +
          '{' +
          Object.keys(vs)
            .sort()
            .map(function (vid) {
              const r = vs[vid] || {};
              return (
                vid +
                ':' +
                (r.mat == null ? '' : r.mat) +
                ',' +
                (r.lab == null ? '' : r.lab) +
                ',' +
                (r.allIn == null ? '' : r.allIn) +
                ',' +
                (r.unit || '')
              );
            })
            .join(';') +
          '}'
        );
      })
      .join('|');
  }
  function djb2(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    }
    return 'c' + h.toString(36);
  }
  function bookChecksum(rates) {
    return djb2(canonRates(rates));
  }
  // The digest before the all-in field existed, kept so a rate book exported
  // by an earlier build still imports instead of being reported as edited.
  function legacyBookChecksum(rates) {
    return djb2(JSON.stringify(rates));
  }
  // Validate + merge an imported books payload. Unknown work keys and
  // negative/absent rates are rejected and COUNTED, never thrown.
  function importBooks(json) {
    if (!json || !Array.isArray(json.books)) {
      return null;
    }
    const existing = loadBooks();
    let merged = 0,
      skipped = 0,
      badKeys = 0;
    json.books.forEach(function (item) {
      const name = item && typeof item.name === 'string' ? item.name.trim().slice(0, 60) : '';
      const cur =
        item && typeof item.currency === 'string' ? item.currency.toUpperCase().slice(0, 3) : '';
      const rates =
        item && item.rates && typeof item.rates === 'object' && !Array.isArray(item.rates)
          ? item.rates
          : null;
      if (!name || !cur || !rates) {
        skipped++;
        return;
      }
      const clean = {};
      Object.keys(rates).forEach(function (k) {
        if (!WORK[k]) {
          badKeys++;
          return;
        }
        const vset =
          rates[k] && typeof rates[k] === 'object' && !Array.isArray(rates[k]) ? rates[k] : null;
        if (!vset) {
          skipped++;
          return;
        }
        const cv = {};
        Object.keys(vset).forEach(function (vid) {
          const r = vset[vid];
          const m = parseFloat(r && r.mat),
            l = parseFloat(r && r.lab);
          const a = parseFloat(r && r.allIn);
          const mOk = isFinite(m) && m >= 0,
            lOk = isFinite(l) && l >= 0,
            aOk = isFinite(a) && a > 0;
          // A rate carries EITHER a split (mat + lab) OR a single all-in
          // figure. Requiring both was the quiet failure this gate exists for:
          // an all-in-only JIC book imported as EMPTY with no error at all,
          // because every one of its rates was silently counted as skipped.
          if ((mOk && lOk) || aOk) {
            /* valid in at least one form */
          } else {
            skipped++;
            return;
          }
          // A negative in ANY field is a broken entry, whichever form it
          // claims: reject and count, never throw.
          if ((isFinite(m) && m < 0) || (isFinite(l) && l < 0) || (isFinite(a) && a < 0)) {
            skipped++;
            return;
          }
          cv[vid] = {
            mat: mOk ? m : undefined,
            lab: lOk ? l : undefined,
            allIn: aOk ? a : undefined,
            unit: r && typeof r.unit === 'string' ? r.unit.slice(0, 12) : undefined
          };
        });
        if (Object.keys(cv).length) {
          clean[k] = cv;
        }
      });
      if (!Object.keys(clean).length) {
        skipped++;
        return;
      }
      // A book that CARRIES a checksum must match its own rates - a mismatch
      // means the file was edited after export; it is skipped, not trusted.
      // Either digest is accepted so books exported by an earlier build (which
      // had no all-in field) still import rather than looking hand-edited.
      if (
        item.checksum &&
        item.checksum !== bookChecksum(clean) &&
        item.checksum !== legacyBookChecksum(clean)
      ) {
        skipped++;
        return;
      }
      const book = {
        id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), // ok: non-secret
        name: name,
        source: item && typeof item.source === 'string' ? item.source.slice(0, 80) : '',
        effective_from:
          item && typeof item.effective_from === 'string' ? item.effective_from.slice(0, 10) : '',
        effective_to:
          item && typeof item.effective_to === 'string' ? item.effective_to.slice(0, 10) : '',
        tier: item && typeof item.tier === 'string' ? item.tier.slice(0, 40) : '',
        currency: cur,
        rates: clean,
        checksum: bookChecksum(clean)
      };
      const at = existing.findIndex(function (x) {
        return (x.name || '').toLowerCase() === name.toLowerCase();
      });
      if (at > -1) {
        existing[at] = book;
      } else {
        existing.unshift(book);
      }
      merged++;
    });
    if (merged) {
      persistBooks(existing);
      renderBooks();
    }
    return { merged: merged, skipped: skipped, badKeys: badKeys };
  }
  function bookExpired(b) {
    if (!b || !b.effective_to) {
      return false;
    }
    const t = Date.parse(b.effective_to);
    return isFinite(t) && Date.now() > t + 86400000;
  }
  function renderBooks() {
    const sel = $('calc-book-select'),
      exp = $('calc-book-expired');
    if (!sel) {
      return;
    }
    const list = loadBooks();
    if (
      activeBookId() &&
      !list.some(function (b) {
        return b.id === activeBookId();
      })
    ) {
      setActiveBook('');
    }
    sel.innerHTML =
      '<option value="">' +
      (list.length ? 'Rate book...' : 'Rate book (none imported)') +
      '</option>' +
      list
        .map(function (b) {
          return (
            '<option value="' +
            esc(b.id) +
            '">' +
            esc(b.name + (b.currency ? ' (' + b.currency + ')' : '')) +
            '</option>'
          );
        })
        .join('');
    // OWNER 2026-10-02 BUG FIX: the picker was rebuilt but never told WHICH
    // book is active, so it always showed the "Rate book..." placeholder even
    // with a book loaded - which read as "the button did nothing". Mirror the
    // active id back into the select after every rebuild.
    sel.value = activeBookId();
    if (sel.value !== activeBookId()) {
      // The stored id is not among the options (defensive): say so plainly
      // rather than silently showing a placeholder that lies.
      console.warn('[calc] active rate book id is not in the list:', activeBookId());
    }
    const a = activeBook();
    if (exp) {
      exp.hidden = !(a && bookExpired(a));
      if (a && bookExpired(a)) {
        exp.textContent =
          'The rate book "' +
          a.name +
          '" expired on ' +
          a.effective_to +
          ' - its rates are shown as they are. Import a newer book when you have one.';
      }
    }
  }
  // ---- JIC 2025-2027 rate book card (owner 2026-10-02) ----
  // Shows the full Jamaica rate book to the user in a modal-style card with
  // imperial/metric toggle. The JIC_RATES data carries all 100 line items from
  // the official JIC 2025-2027 book (TRU Construction Estimator, all amounts JMD).
  // OWNER 2026-10-02: the year span the JIC book governs lives in ONE constant.
  // The popup title, the imported book's name and the CSV/documents all read it,
  // so they can never disagree about which years these rates cover.
  const JIC_YEARS = '2025-2027';

  /* RATE BOOK REBRAND (REFINEMENT-DIRECTIVE-2026-10-24 section 3.2).
     The book is the product's own named planning reference now. The figures
     are still the published JIC rates until the owner changes RATEBOOK_STATUS
     in src/data/ratebook.js, so the SOURCE line stays on screen and no claim
     of independent production is made while the status is unresolved. */
  const RATEBOOK_NAME = 'My MaNaGeR Rate Book';
  const RATEBOOK_SOURCE = 'JIC Rate Book 2025-2027';
  const RATEBOOK_STATUS = 'unresolved'; // unresolved | permission-granted | rebuilt
  function rateBookNotice(status) {
    const st = status || RATEBOOK_STATUS;
    if (st === 'rebuilt') {
      return "Planning rates built from this business's own costs. Check them against current supplier quotes before you send a price.";
    }
    return 'Starting rates for planning. Prices vary by site, supplier and date. Replace any rate with your own.';
  }
  const RATEBOOK_MARK =
    '<svg class="ico rr-mark" aria-hidden="true"><use href="css/mmgr-icons.svg#i-mpw"></use></svg>';
  const JIC_RATES = [
    // Excavation (9 items)
    {
      trade: 'Excavation',
      tid: 'excavation',
      ref: 'JIC #1',
      desc: 'Compacted earth to 5 ft deep',
      impUnit: 'Yd.Cu.',
      impRate: 1428,
      metUnit: 'm\u00B3',
      metRate: 1868
    },
    {
      trade: 'Excavation',
      tid: 'excavation',
      ref: 'JIC #2',
      desc: 'Asphaltic concrete (Barber Green)',
      impUnit: 'Yd.Cu.',
      impRate: 3264,
      metUnit: 'm\u00B3',
      metRate: 4270
    },
    {
      trade: 'Excavation',
      tid: 'excavation',
      ref: 'JIC #3',
      desc: 'Compacted marl up to 5 ft deep',
      impUnit: 'Yd.Cu.',
      impRate: 1904,
      metUnit: 'm\u00B3',
      metRate: 2491
    },
    {
      trade: 'Excavation',
      tid: 'excavation',
      ref: 'JIC #4',
      desc: 'Compacted sand up to 5 ft deep',
      impUnit: 'Yd.Cu.',
      impRate: 1143,
      metUnit: 'm\u00B3',
      metRate: 1494
    },
    {
      trade: 'Excavation',
      tid: 'excavation',
      ref: 'JIC #5',
      desc: 'Stiff clay up to 5 ft deep',
      impUnit: 'Yd.Cu.',
      impRate: 1632,
      metUnit: 'm\u00B3',
      metRate: 2135
    },
    {
      trade: 'Excavation',
      tid: 'excavation',
      ref: 'JIC #6',
      desc: 'Stiff clay 5 to 10 ft deep',
      impUnit: 'Yd.Cu.',
      impRate: 1904,
      metUnit: 'm\u00B3',
      metRate: 2491
    },
    {
      trade: 'Excavation',
      tid: 'excavation',
      ref: 'JIC #7',
      desc: 'Rock/concrete no compressor',
      impUnit: 'Yd.Cu.',
      impRate: 11425,
      metUnit: 'm\u00B3',
      metRate: 14944
    },
    {
      trade: 'Excavation',
      tid: 'excavation',
      ref: 'JIC #8',
      desc: 'Rock/concrete compressor incl. labourers',
      impUnit: 'Yd.Cu.',
      impRate: 7141,
      metUnit: 'm\u00B3',
      metRate: 9340
    },
    {
      trade: 'Excavation',
      tid: 'excavation',
      ref: 'JIC #9',
      desc: 'Rock/concrete compressor labourers only',
      impUnit: 'Yd.Cu.',
      impRate: 2856,
      metUnit: 'm\u00B3',
      metRate: 3736
    },
    // Carpentry Formwork (9 items)
    {
      trade: 'Carpentry (Formwork)',
      tid: 'carpentry',
      ref: 'JIC #1',
      desc: 'Erect and strip forms to belt and stiffener',
      impUnit: 'Ft.Sq.',
      impRate: 177,
      metUnit: 'm\u00B2',
      metRate: 1908
    },
    {
      trade: 'Carpentry (Formwork)',
      tid: 'carpentry',
      ref: 'JIC #2',
      desc: 'Erect and strip forms to columns',
      impUnit: 'Ft.Sq.',
      impRate: 189,
      metUnit: 'm\u00B2',
      metRate: 2035
    },
    {
      trade: 'Carpentry (Formwork)',
      tid: 'carpentry',
      ref: 'JIC #3',
      desc: 'Erect and strip forms to beams',
      impUnit: 'Ft.Sq.',
      impRate: 189,
      metUnit: 'm\u00B2',
      metRate: 2035
    },
    {
      trade: 'Carpentry (Formwork)',
      tid: 'carpentry',
      ref: 'JIC #4',
      desc: 'Erect and strip forms to suspended slabs (stairs)',
      impUnit: 'Ft.Sq.',
      impRate: 158,
      metUnit: 'm\u00B2',
      metRate: 1696
    },
    {
      trade: 'Carpentry (Formwork)',
      tid: 'carpentry',
      ref: 'JIC #5',
      desc: 'Erect and strip forms to suspended slabs (floor)',
      impUnit: 'Ft.Sq.',
      impRate: 189,
      metUnit: 'm\u00B2',
      metRate: 2035
    },
    {
      trade: 'Carpentry (Formwork)',
      tid: 'carpentry',
      ref: 'JIC #6',
      desc: 'Erect and strip forms to walls',
      impUnit: 'Ft.Sq.',
      impRate: 168,
      metUnit: 'm\u00B2',
      metRate: 1809
    },
    {
      trade: 'Carpentry (Formwork)',
      tid: 'carpentry',
      ref: 'JIC #7',
      desc: 'Erect and strip circular forms',
      impUnit: 'Ft.Sq.',
      impRate: 197,
      metUnit: 'm\u00B2',
      metRate: 2124
    },
    {
      trade: 'Carpentry (Formwork)',
      tid: 'carpentry',
      ref: 'JIC #8',
      desc: 'Erect and strip forms to sides and deck of manholes',
      impUnit: 'Ft.Sq.',
      impRate: 249,
      metUnit: 'm\u00B2',
      metRate: 2684
    },
    {
      trade: 'Carpentry (Formwork)',
      tid: 'carpentry',
      ref: 'JIC #9',
      desc: 'Make new formwork (columns, beam, belt, stiffener)',
      impUnit: 'Ft.Sq.',
      impRate: 60,
      metUnit: 'm\u00B2',
      metRate: 643
    },
    // Steelwork (9 items)
    {
      trade: 'Steelwork',
      tid: 'steelwork',
      ref: 'JIC #1',
      desc: '3/8 in mild steel rebar',
      impUnit: 'Lb.',
      impRate: 30,
      metUnit: 'Kg.',
      metRate: 67
    },
    {
      trade: 'Steelwork',
      tid: 'steelwork',
      ref: 'JIC #2',
      desc: '1/2 in mild steel rebar',
      impUnit: 'Lb.',
      impRate: 30,
      metUnit: 'Kg.',
      metRate: 67
    },
    {
      trade: 'Steelwork',
      tid: 'steelwork',
      ref: 'JIC #3',
      desc: '5/8 in mild steel rebar',
      impUnit: 'Lb.',
      impRate: 30,
      metUnit: 'Kg.',
      metRate: 67
    },
    {
      trade: 'Steelwork',
      tid: 'steelwork',
      ref: 'JIC #4',
      desc: '3/4 in mild steel rebar',
      impUnit: 'Lb.',
      impRate: 30,
      metUnit: 'Kg.',
      metRate: 67
    },
    {
      trade: 'Steelwork',
      tid: 'steelwork',
      ref: 'JIC #5',
      desc: '1 in mild steel rebar',
      impUnit: 'Lb.',
      impRate: 30,
      metUnit: 'Kg.',
      metRate: 67
    },
    {
      trade: 'Steelwork',
      tid: 'steelwork',
      ref: 'JIC #6',
      // OWNER 2026-10-12: the metric figure used to be 276, which is the
      // imperial 125 multiplied by the pounds-to-kilograms factor - a unit
      // mix-up copied off the source page. Every other per-yd2 row in the book
      // converts at 125 / 0.83612736 = 149, so metric mesh was priced about 85%
      // too high. The conversion gate in tools/qa-calc-golden.cjs now checks
      // this band on every row, so it cannot drift back.
      desc: 'Fabric',
      impUnit: 'Yd.Sq.',
      impRate: 125,
      metUnit: 'm\u00B2',
      metRate: 149
    },
    {
      trade: 'Steelwork',
      tid: 'steelwork',
      ref: 'JIC #7',
      desc: '1/4 in stirrups',
      impUnit: 'Doz.',
      impRate: 699,
      metUnit: 'Doz.',
      metRate: 699
    },
    {
      trade: 'Steelwork',
      tid: 'steelwork',
      ref: 'JIC #8',
      desc: '3/8 in stirrups',
      impUnit: 'Doz.',
      impRate: 734,
      metUnit: 'Doz.',
      metRate: 734
    },
    {
      trade: 'Steelwork',
      tid: 'steelwork',
      ref: 'JIC #9',
      desc: '3/8 in stirrups (large, over 6 ft girth)',
      impUnit: 'Doz.',
      impRate: 917,
      metUnit: 'Doz.',
      metRate: 917
    },
    // Masonry (9 items)
    {
      trade: 'Masonry',
      tid: 'masonry',
      ref: 'JIC #1',
      desc: 'Lay 8 in blocks fill all pockets GF to FF',
      impUnit: 'Yd.Sq.',
      impRate: 1461,
      metUnit: 'm\u00B2',
      metRate: 1747
    },
    {
      trade: 'Masonry',
      tid: 'masonry',
      ref: 'JIC #2',
      desc: 'Lay 8 in blocks fill all pockets FF and above',
      impUnit: 'Yd.Sq.',
      impRate: 1704,
      metUnit: 'm\u00B2',
      metRate: 2038
    },
    {
      trade: 'Masonry',
      tid: 'masonry',
      ref: 'JIC #3',
      desc: 'Lay 8 in blocks fill all pockets manholes drains',
      impUnit: 'Yd.Sq.',
      impRate: 1947,
      metUnit: 'm\u00B2',
      metRate: 2329
    },
    {
      trade: 'Masonry',
      tid: 'masonry',
      ref: 'JIC #4',
      desc: 'Lay 8 in blocks fill alternate pockets GF to FF',
      impUnit: 'Yd.Sq.',
      impRate: 1239,
      metUnit: 'm\u00B2',
      metRate: 1482
    },
    {
      trade: 'Masonry',
      tid: 'masonry',
      ref: 'JIC #5',
      desc: 'Lay 8 in blocks fill alternate pockets FF and above',
      impUnit: 'Yd.Sq.',
      impRate: 1410,
      metUnit: 'm\u00B2',
      metRate: 1687
    },
    {
      trade: 'Masonry',
      tid: 'masonry',
      ref: 'JIC #6',
      desc: 'Lay 6 in blocks fill all pockets GF to FF',
      impUnit: 'Yd.Sq.',
      impRate: 1278,
      metUnit: 'm\u00B2',
      metRate: 1529
    },
    {
      trade: 'Masonry',
      tid: 'masonry',
      ref: 'JIC #7',
      desc: 'Lay 6 in blocks fill all pockets FF and above',
      impUnit: 'Yd.Sq.',
      impRate: 1461,
      metUnit: 'm\u00B2',
      metRate: 1747
    },
    {
      trade: 'Masonry',
      tid: 'masonry',
      ref: 'JIC #8',
      desc: 'Lay 6 in blocks fill all pockets manholes drains gully basins',
      impUnit: 'Yd.Sq.',
      impRate: 1704,
      metUnit: 'm\u00B2',
      metRate: 2038
    },
    {
      trade: 'Masonry',
      tid: 'masonry',
      ref: 'JIC #9',
      desc: 'Lay 6 in blocks fill alternate pockets GF to FF',
      impUnit: 'Yd.Sq.',
      impRate: 1105,
      metUnit: 'm\u00B2',
      metRate: 1322
    },
    // Scaffolding (9 items)
    {
      trade: 'Scaffolding',
      tid: 'scaffolding',
      ref: 'JIC #1',
      desc: 'Erect scaffolding up to 10 ft high unbraced',
      impUnit: 'Ft.Sq.',
      impRate: 16,
      metUnit: 'm\u00B2',
      metRate: 174
    },
    {
      trade: 'Scaffolding',
      tid: 'scaffolding',
      ref: 'JIC #2',
      desc: 'Erect scaffolding up to 10 ft high ties to building',
      impUnit: 'Ft.Sq.',
      impRate: 25,
      metUnit: 'm\u00B2',
      metRate: 269
    },
    {
      trade: 'Scaffolding',
      tid: 'scaffolding',
      ref: 'JIC #3',
      desc: 'Erect scaffolding 10 to 20 ft tied to building',
      impUnit: 'Ft.Sq.',
      impRate: 29,
      metUnit: 'm\u00B2',
      metRate: 314
    },
    {
      trade: 'Scaffolding',
      tid: 'scaffolding',
      ref: 'JIC #4',
      desc: 'Erect scaffolding 20 to 30 ft tied to building',
      impUnit: 'Ft.Sq.',
      impRate: 39,
      metUnit: 'm\u00B2',
      metRate: 418
    },
    {
      trade: 'Scaffolding',
      tid: 'scaffolding',
      ref: 'JIC #5',
      desc: 'Erect scaffolding 30 to 40 ft tied to building',
      impUnit: 'Ft.Sq.',
      impRate: 54,
      metUnit: 'm\u00B2',
      metRate: 579
    },
    {
      trade: 'Scaffolding',
      tid: 'scaffolding',
      ref: 'JIC #6',
      desc: 'Erect scaffolding 40 to 50 ft tied to building',
      impUnit: 'Ft.Sq.',
      impRate: 60,
      metUnit: 'm\u00B2',
      metRate: 646
    },
    {
      trade: 'Scaffolding',
      tid: 'scaffolding',
      ref: 'JIC #7',
      desc: 'Erect scaffolding 50 to 60 ft tied to building',
      impUnit: 'Ft.Sq.',
      impRate: 64,
      metUnit: 'm\u00B2',
      metRate: 685
    },
    {
      trade: 'Scaffolding',
      tid: 'scaffolding',
      ref: 'JIC #8',
      desc: 'Erect scaffolding 60 to 70 ft tied to building',
      impUnit: 'Ft.Sq.',
      impRate: 68,
      metUnit: 'm\u00B2',
      metRate: 729
    },
    {
      trade: 'Scaffolding',
      tid: 'scaffolding',
      ref: 'JIC #9',
      desc: 'Erect scaffolding 70 to 80 ft tied to building',
      impUnit: 'Ft.Sq.',
      impRate: 70,
      metUnit: 'm\u00B2',
      metRate: 753
    },
    // Tiling (9 items)
    {
      trade: 'Tiling',
      tid: 'tiling',
      ref: 'JIC #1',
      desc: 'Terrazzo tiles lay and grout',
      impUnit: 'Yd.Sq.',
      impRate: 1715,
      metUnit: 'm\u00B2',
      metRate: 2051
    },
    {
      trade: 'Tiling',
      tid: 'tiling',
      ref: 'JIC #2',
      desc: 'Terrazzo tiles first cut',
      impUnit: 'Yd.Sq.',
      impRate: 778,
      metUnit: 'm\u00B2',
      metRate: 931
    },
    {
      trade: 'Tiling',
      tid: 'tiling',
      ref: 'JIC #3',
      desc: 'Terrazzo tile final cut and polish',
      impUnit: 'Yd.Sq.',
      impRate: 1167,
      metUnit: 'm\u00B2',
      metRate: 1396
    },
    {
      trade: 'Tiling',
      tid: 'tiling',
      ref: 'JIC #4',
      desc: 'Extra for terrazzo tiling to upper floors',
      impUnit: 'Yd.Sq.',
      impRate: 125,
      metUnit: 'm\u00B2',
      metRate: 149
    },
    {
      trade: 'Tiling',
      tid: 'tiling',
      ref: 'JIC #5',
      desc: 'Terrazzo tiles to treads 10 in wide finished',
      impUnit: 'Ft.Run',
      impRate: 414,
      metUnit: 'm',
      metRate: 1357
    },
    {
      trade: 'Tiling',
      tid: 'tiling',
      ref: 'JIC #6',
      desc: 'Terrazzo tiles to treads 11 to 12 in wide finished',
      impUnit: 'Ft.Run',
      impRate: 522,
      metUnit: 'm',
      metRate: 1713
    },
    {
      trade: 'Tiling',
      tid: 'tiling',
      ref: 'JIC #7',
      desc: 'Terrazzo tiles to riser 6 to 8 in high',
      impUnit: 'Ft.Run',
      impRate: 458,
      metUnit: 'm',
      metRate: 1502
    },
    {
      trade: 'Tiling',
      tid: 'tiling',
      ref: 'JIC #8',
      desc: 'Lay and grout marble tiles 12 in plus edges floors',
      impUnit: 'Yd.Sq.',
      impRate: 3098,
      metUnit: 'm\u00B2',
      metRate: 3705
    },
    {
      trade: 'Tiling',
      tid: 'tiling',
      ref: 'JIC #9',
      desc: 'Lay and grout marble tiles 12 in plus cutting walls',
      impUnit: 'Yd.Sq.',
      impRate: 3335,
      metUnit: 'm\u00B2',
      metRate: 3988
    },
    // Painting (9 items)
    {
      trade: 'Painting',
      tid: 'painting',
      ref: 'JIC #1',
      desc: 'Emulsion paint wall one coat',
      impUnit: 'Yd.Sq.',
      impRate: 107,
      metUnit: 'm\u00B2',
      metRate: 128
    },
    {
      trade: 'Painting',
      tid: 'painting',
      ref: 'JIC #2',
      desc: 'Emulsion paint wall two coats',
      impUnit: 'Yd.Sq.',
      impRate: 206,
      metUnit: 'm\u00B2',
      metRate: 246
    },
    {
      trade: 'Painting',
      tid: 'painting',
      ref: 'JIC #3',
      desc: 'Emulsion paint pebble dash one coat',
      impUnit: 'Yd.Sq.',
      impRate: 140,
      metUnit: 'm\u00B2',
      metRate: 167
    },
    {
      trade: 'Painting',
      tid: 'painting',
      ref: 'JIC #4',
      desc: 'Emulsion paint pebble dash two coats',
      impUnit: 'Yd.Sq.',
      impRate: 268,
      metUnit: 'm\u00B2',
      metRate: 320
    },
    {
      trade: 'Painting',
      tid: 'painting',
      ref: 'JIC #5',
      desc: 'Emulsion paint cutting to line',
      impUnit: 'Ft.Run',
      impRate: 9,
      metUnit: 'm',
      metRate: 31
    },
    {
      trade: 'Painting',
      tid: 'painting',
      ref: 'JIC #6',
      desc: 'Emulsion paint skirting 3 to 4 in one coat',
      impUnit: 'Ft.Run',
      impRate: 9,
      metUnit: 'm',
      metRate: 31
    },
    {
      trade: 'Painting',
      tid: 'painting',
      ref: 'JIC #7',
      desc: 'Emulsion paint skirting 3 to 4 in two coats',
      impUnit: 'Ft.Run',
      impRate: 26,
      metUnit: 'm',
      metRate: 86
    },
    {
      trade: 'Painting',
      tid: 'painting',
      ref: 'JIC #8',
      desc: 'Emulsion paint ceiling one coat',
      impUnit: 'Yd.Sq.',
      impRate: 119,
      metUnit: 'm\u00B2',
      metRate: 142
    },
    {
      trade: 'Painting',
      tid: 'painting',
      ref: 'JIC #9',
      desc: 'Emulsion paint ceiling two coats',
      impUnit: 'Yd.Sq.',
      impRate: 233,
      metUnit: 'm\u00B2',
      metRate: 278
    },
    // Joinery Skirtings (10 items)
    {
      trade: 'Joinery (Skirtings)',
      tid: 'joinery',
      ref: 'JIC #1',
      desc: '1x3 skirtings bevelled top WPP',
      impUnit: 'Ft.Run',
      impRate: 66,
      metUnit: 'm',
      metRate: 217
    },
    {
      trade: 'Joinery (Skirtings)',
      tid: 'joinery',
      ref: 'JIC #2',
      desc: '1x4 skirtings bevelled top WPP',
      impUnit: 'Ft.Run',
      impRate: 73,
      metUnit: 'm',
      metRate: 241
    },
    {
      trade: 'Joinery (Skirtings)',
      tid: 'joinery',
      ref: 'JIC #3',
      desc: '1x6 skirtings bevelled top WPP',
      impUnit: 'Ft.Run',
      impRate: 90,
      metUnit: 'm',
      metRate: 295
    },
    {
      trade: 'Joinery (Skirtings)',
      tid: 'joinery',
      ref: 'JIC #4',
      desc: '1x3 skirtings bevelled to Mah etc.',
      impUnit: 'Ft.Run',
      impRate: 73,
      metUnit: 'm',
      metRate: 241
    },
    {
      trade: 'Joinery (Skirtings)',
      tid: 'joinery',
      ref: 'JIC #5',
      desc: '1x4 skirtings bevelled to Mah etc.',
      impUnit: 'Ft.Run',
      impRate: 84,
      metUnit: 'm',
      metRate: 276
    },
    {
      trade: 'Joinery (Skirtings)',
      tid: 'joinery',
      ref: 'JIC #6',
      desc: '1x6 skirtings bevelled to Mah etc.',
      impUnit: 'Ft.Run',
      impRate: 99,
      metUnit: 'm',
      metRate: 325
    },
    {
      trade: 'Joinery (Skirtings)',
      tid: 'joinery',
      ref: 'JIC #7',
      desc: '1x3 skirtings molded top WPP',
      impUnit: 'Ft.Run',
      impRate: 99,
      metUnit: 'm',
      metRate: 325
    },
    {
      trade: 'Joinery (Skirtings)',
      tid: 'joinery',
      ref: 'JIC #8',
      desc: '1x4 skirtings molded top WPP',
      impUnit: 'Ft.Run',
      impRate: 110,
      metUnit: 'm',
      metRate: 361
    },
    {
      trade: 'Joinery (Skirtings)',
      tid: 'joinery',
      ref: 'JIC #9',
      desc: '1x6 skirtings molded top WPP',
      impUnit: 'Ft.Run',
      impRate: 122,
      metUnit: 'm',
      metRate: 401
    },
    {
      trade: 'Joinery (Skirtings)',
      tid: 'joinery',
      ref: 'JIC #10',
      desc: '1x3 skirtings molded top Mah etc.',
      impUnit: 'Ft.Run',
      impRate: 110,
      metUnit: 'm',
      metRate: 361
    },
    // Plumbing (9 items)
    {
      trade: 'Plumbing',
      tid: 'plumbing',
      ref: 'JIC #1',
      desc: '6 in diameter pipes',
      impUnit: 'Ft.Run',
      impRate: 323,
      metUnit: 'm',
      metRate: 1060
    },
    {
      trade: 'Plumbing',
      tid: 'plumbing',
      ref: 'JIC #2',
      desc: '4 in diameter pipes',
      impUnit: 'Ft.Run',
      impRate: 244,
      metUnit: 'm',
      metRate: 801
    },
    {
      trade: 'Plumbing',
      tid: 'plumbing',
      ref: 'JIC #3',
      desc: '3 in diameter pipes',
      impUnit: 'Ft.Run',
      impRate: 229,
      metUnit: 'm',
      metRate: 753
    },
    {
      trade: 'Plumbing',
      tid: 'plumbing',
      ref: 'JIC #4',
      desc: '2 in diameter pipes',
      impUnit: 'Ft.Run',
      impRate: 151,
      metUnit: 'm',
      metRate: 495
    },
    {
      trade: 'Plumbing',
      tid: 'plumbing',
      ref: 'JIC #5',
      desc: '1.5 in diameter pipes',
      impUnit: 'Ft.Run',
      impRate: 125,
      metUnit: 'm',
      metRate: 411
    },
    {
      trade: 'Plumbing',
      tid: 'plumbing',
      ref: 'JIC #6',
      desc: '1.25 in diameter pipes',
      impUnit: 'Ft.Run',
      impRate: 125,
      metUnit: 'm',
      metRate: 411
    },
    {
      trade: 'Plumbing',
      tid: 'plumbing',
      ref: 'JIC #7',
      desc: '300mm 12 ft push fit pipes',
      impUnit: 'Ft.Run',
      impRate: 656,
      metUnit: 'm',
      metRate: 2151
    },
    {
      trade: 'Plumbing',
      tid: 'plumbing',
      ref: 'JIC #8',
      desc: '250mm 10 ft push fit pipes',
      impUnit: 'Ft.Run',
      impRate: 534,
      metUnit: 'm',
      metRate: 1751
    },
    {
      trade: 'Plumbing',
      tid: 'plumbing',
      ref: 'JIC #9',
      desc: '200mm 8 ft push fit pipes',
      impUnit: 'Ft.Run',
      impRate: 417,
      metUnit: 'm',
      metRate: 1369
    },
    // Electrical Conduit (9 items)
    {
      trade: 'Electrical (Conduit)',
      tid: 'electrical',
      ref: 'JIC #1',
      desc: '1/2 in diameter pipe',
      impUnit: 'Ft.Run',
      impRate: 35.73,
      metUnit: 'm',
      metRate: 117.23
    },
    {
      trade: 'Electrical (Conduit)',
      tid: 'electrical',
      ref: 'JIC #2',
      desc: '3/4 in diameter pipe',
      impUnit: 'Ft.Run',
      impRate: 41.94,
      metUnit: 'm',
      metRate: 137.62
    },
    {
      trade: 'Electrical (Conduit)',
      tid: 'electrical',
      ref: 'JIC #3',
      desc: '1 in diameter pipe',
      impUnit: 'Ft.Run',
      impRate: 48.23,
      metUnit: 'm',
      metRate: 158.26
    },
    {
      trade: 'Electrical (Conduit)',
      tid: 'electrical',
      ref: 'JIC #4',
      desc: '1-1/4 in diameter pipe',
      impUnit: 'Ft.Run',
      impRate: 56.75,
      metUnit: 'm',
      metRate: 186.19
    },
    {
      trade: 'Electrical (Conduit)',
      tid: 'electrical',
      ref: 'JIC #5',
      desc: '1-1/2 in diameter pipe',
      impUnit: 'Ft.Run',
      impRate: 68.91,
      metUnit: 'm',
      metRate: 226.08
    },
    {
      trade: 'Electrical (Conduit)',
      tid: 'electrical',
      ref: 'JIC #6',
      desc: '2 in diameter pipe',
      impUnit: 'Ft.Run',
      impRate: 80.39,
      metUnit: 'm',
      metRate: 263.76
    },
    {
      trade: 'Electrical (Conduit)',
      tid: 'electrical',
      ref: 'JIC #7',
      desc: '1 in diameter pipe (higher rate)',
      impUnit: 'Ft.Run',
      impRate: 83.89,
      metUnit: 'm',
      metRate: 275.23
    },
    {
      trade: 'Electrical (Conduit)',
      tid: 'electrical',
      ref: 'JIC #8',
      desc: '1-1/4 in diameter pipe (higher rate)',
      impUnit: 'Ft.Run',
      impRate: 96.47,
      metUnit: 'm',
      metRate: 316.52
    },
    {
      trade: 'Electrical (Conduit)',
      tid: 'electrical',
      ref: 'JIC #9',
      desc: '1-1/2 in diameter pipe (higher rate)',
      impUnit: 'Ft.Run',
      impRate: 107.19,
      metUnit: 'm',
      metRate: 351.68
    },
    // Welding (9 items)
    {
      trade: 'Welding',
      tid: 'welding',
      ref: 'JIC #1',
      desc: 'Handle Mark Cut & Sand Smooth: 1/8 in thick metal using torch',
      impUnit: 'In.',
      impRate: 50,
      metUnit: '100mm',
      metRate: 198
    },
    {
      trade: 'Welding',
      tid: 'welding',
      ref: 'JIC #2',
      desc: 'Handle Mark Cut & Sand Smooth: 1/4 in thick metal using torch',
      impUnit: 'In.',
      impRate: 64,
      metUnit: '100mm',
      metRate: 251
    },
    {
      trade: 'Welding',
      tid: 'welding',
      ref: 'JIC #3',
      desc: 'Handle Mark Cut & Sand Smooth: 3/8 in thick metal using torch',
      impUnit: 'In.',
      impRate: 70,
      metUnit: '100mm',
      metRate: 276
    },
    {
      trade: 'Welding',
      tid: 'welding',
      ref: 'JIC #4',
      desc: 'Handle Mark Cut & Sand Smooth: 1/2 in thick metal using torch',
      impUnit: 'In.',
      impRate: 78,
      metUnit: '100mm',
      metRate: 306
    },
    {
      trade: 'Welding',
      tid: 'welding',
      ref: 'JIC #5',
      desc: 'Handle Mark Cut & Sand Smooth: 5/8 in thick metal using torch',
      impUnit: 'In.',
      impRate: 88,
      metUnit: '100mm',
      metRate: 345
    },
    {
      trade: 'Welding',
      tid: 'welding',
      ref: 'JIC #6',
      desc: 'Handle Mark Cut & Sand Smooth: 3/4 in thick metal using torch',
      impUnit: 'In.',
      impRate: 97,
      metUnit: '100mm',
      metRate: 383
    },
    {
      trade: 'Welding',
      tid: 'welding',
      ref: 'JIC #7',
      desc: 'Handle Mark Cut & Sand Smooth: 1 in thick metal using torch',
      impUnit: 'In.',
      impRate: 117,
      metUnit: '100mm',
      metRate: 460
    },
    {
      trade: 'Welding',
      tid: 'welding',
      ref: 'JIC #8',
      desc: 'Handle Mark Cut & Sand Smooth 1/16 in thick metal using CPSAW',
      impUnit: 'In.',
      impRate: 25,
      metUnit: '100mm',
      metRate: 99
    },
    {
      trade: 'Welding',
      tid: 'welding',
      ref: 'JIC #9',
      desc: 'Handle Mark Cut & Sand Smooth 1/8 in thick metal using CPSAW',
      impUnit: 'In.',
      impRate: 39,
      metUnit: '100mm',
      metRate: 153
    }
  ];
  const JIC_BOOK_MAP = [
    ['excavation', 1, 'excav', 'standard'],
    ['excavation', 2, 'excav', 'asphalt'],
    ['excavation', 3, 'excav', 'marl'],
    ['excavation', 4, 'excav', 'sand'],
    ['excavation', 5, 'excav', 'clay-shallow'],
    ['excavation', 6, 'excav', 'clay-deep'],
    ['excavation', 7, 'excav', 'rock-hand'],
    ['excavation', 8, 'excav', 'rock-comp'],
    ['excavation', 9, 'excav', 'rock-labour'],
    ['carpentry', 1, 'formwork', 'wall-edge'],
    ['carpentry', 2, 'formwork', 'belt'],
    ['carpentry', 3, 'formwork', 'column'],
    ['carpentry', 4, 'formwork', 'beam'],
    ['carpentry', 5, 'formwork', 'susp-floor'],
    ['carpentry', 6, 'formwork', 'susp-stairs'],
    ['carpentry', 7, 'formwork', 'circular'],
    ['carpentry', 8, 'formwork', 'manhole'],
    ['carpentry', 9, 'formwork', 'new-fw'],
    ['steelwork', 1, 'rebar-size', '3-8'],
    ['steelwork', 2, 'rebar-size', '1-2'],
    ['steelwork', 3, 'rebar-size', '5-8'],
    ['steelwork', 4, 'rebar-size', '3-4'],
    ['steelwork', 5, 'rebar-size', '1'],
    ['steelwork', 6, 'fabric-mesh', '*'],
    ['steelwork', 7, 'stirrups', '1-4'],
    ['steelwork', 8, 'stirrups', '3-8'],
    ['steelwork', 9, 'stirrups', '3-8-lg'],
    ['masonry', 1, 'blockwall', 'standard'],
    ['masonry', 2, 'blockwall', '8in-ff'],
    ['masonry', 3, 'blockwall', '8in-mh'],
    ['masonry', 4, 'blockwall', '8in-alt-gf'],
    ['masonry', 5, 'blockwall', '8in-alt-ff'],
    ['masonry', 6, 'blockwall', '6in-gf'],
    ['masonry', 7, 'blockwall', '6in-ff'],
    ['masonry', 8, 'blockwall', '6in-mh'],
    ['masonry', 9, 'blockwall', '6in-alt-gf'],
    ['scaffolding', 1, 'scaffold', 'sc-10-unbraced'],
    ['scaffolding', 2, 'scaffold', 'sc-10-tied'],
    ['scaffolding', 3, 'scaffold', 'sc-10-20'],
    ['scaffolding', 4, 'scaffold', 'sc-20-30'],
    ['scaffolding', 5, 'scaffold', 'sc-30-40'],
    ['scaffolding', 6, 'scaffold', 'sc-40-50'],
    ['scaffolding', 7, 'scaffold', 'sc-50-60'],
    ['scaffolding', 8, 'scaffold', 'sc-60-70'],
    ['scaffolding', 9, 'scaffold', 'sc-70-80'],
    ['tiling', 1, 'tile', 'standard'],
    ['tiling', 2, 'tile', 'terrazzo-cut'],
    ['tiling', 3, 'tile', 'terrazzo-polish'],
    ['tiling', 4, 'tile', 'terrazzo-upper'],
    ['tiling', 5, 'tile', 'tread-10'],
    ['tiling', 6, 'tile', 'tread-11-12'],
    ['tiling', 7, 'tile', 'riser-6-8'],
    ['tiling', 8, 'tile', 'marble-floor'],
    ['tiling', 9, 'tile', 'marble-wall'],
    ['painting', 1, 'paint', 'wall-1coat'],
    ['painting', 2, 'paint', 'wall-2coat'],
    ['painting', 3, 'paint', 'pebble-1coat'],
    ['painting', 4, 'paint', 'pebble-2coat'],
    ['painting', 5, 'paint', 'cutting-in'],
    ['painting', 6, 'paint', 'skirting-1coat'],
    ['painting', 7, 'paint', 'skirting-2coat'],
    ['painting', 8, 'paint', 'ceiling-1coat'],
    ['painting', 9, 'paint', 'ceiling-2coat'],
    ['joinery', 1, 'joinery', 'j-1x3-bev-wpp'],
    ['joinery', 2, 'joinery', 'j-1x4-bev-wpp'],
    ['joinery', 3, 'joinery', 'j-1x6-bev-wpp'],
    ['joinery', 4, 'joinery', 'j-1x3-bev-mah'],
    ['joinery', 5, 'joinery', 'j-1x4-bev-mah'],
    ['joinery', 6, 'joinery', 'j-1x6-bev-mah'],
    ['joinery', 7, 'joinery', 'j-1x3-mold-wpp'],
    ['joinery', 8, 'joinery', 'j-1x4-mold-wpp'],
    ['joinery', 9, 'joinery', 'j-1x6-mold-wpp'],
    ['joinery', 10, 'joinery', 'j-1x3-mold-mah'],
    ['plumbing', 1, 'plumbing-pipe', 'pp-6in'],
    ['plumbing', 2, 'plumbing-pipe', 'pp-4in'],
    ['plumbing', 3, 'plumbing-pipe', 'pp-3in'],
    ['plumbing', 4, 'plumbing-pipe', 'pp-2in'],
    ['plumbing', 5, 'plumbing-pipe', 'pp-1.5in'],
    ['plumbing', 6, 'plumbing-pipe', 'pp-1.25in'],
    ['plumbing', 7, 'plumbing-pipe', 'pp-300mm'],
    ['plumbing', 8, 'plumbing-pipe', 'pp-250mm'],
    ['plumbing', 9, 'plumbing-pipe', 'pp-200mm'],
    ['electrical', 1, 'electrical-conduit', 'ec-0.5in'],
    ['electrical', 2, 'electrical-conduit', 'ec-0.75in'],
    ['electrical', 3, 'electrical-conduit', 'ec-1in-a'],
    ['electrical', 4, 'electrical-conduit', 'ec-1.25in-a'],
    ['electrical', 5, 'electrical-conduit', 'ec-1.5in-a'],
    ['electrical', 6, 'electrical-conduit', 'ec-2in'],
    ['electrical', 7, 'electrical-conduit', 'ec-1in-b'],
    ['electrical', 8, 'electrical-conduit', 'ec-1.25in-b'],
    ['electrical', 9, 'electrical-conduit', 'ec-1.5in-b'],
    ['welding', 1, 'welding', 'w-1/8-torch'],
    ['welding', 2, 'welding', 'w-1/4-torch'],
    ['welding', 3, 'welding', 'w-3/8-torch'],
    ['welding', 4, 'welding', 'w-1/2-torch'],
    ['welding', 5, 'welding', 'w-5/8-torch'],
    ['welding', 6, 'welding', 'w-3/4-torch'],
    ['welding', 7, 'welding', 'w-1-torch'],
    ['welding', 8, 'welding', 'w-1/16-cpsaw'],
    ['welding', 9, 'welding', 'w-1/8-cpsaw']
  ];

  // The shipped Jamaica book (owner 2026-10-02, Task 5). The JIC combined rate
  // IS the all-in figure - one number covering material and labour - so the
  // book carries no split. Built by GENERATING from JIC_RATES (the same rows
  // the rate-book card shows) rather than re-keying 100 figures by hand: this
  // table holds only the two identifiers per row, and the money is read out of
  // JIC_RATES at runtime, so the book can never drift from the table the user
  // reads on screen. Metric rates are used because the engine is metric-first
  // and rateFactor converts for the trades quoted per yd2/ft2/ft-run/lb/dozen.
  // ---- Owner 2026-10-12 (G1): the split UNDER the all-in headline --------
  // JIC publishes ONE combined figure per row, so there is no split to read
  // off the sheet. Rather than one invented global percentage, the split is
  // derived from each trade's OWN model mat/lab pair - the numbers this
  // calculator has always priced that trade with - so the two bases tell the
  // same story and nothing is fabricated.
  // Clamped to 15%-85% so neither side can ever render as a zero line: the
  // welding model carries lab 0, which would put "Labour J$0" under a real
  // JIC figure. FALLBACK is an even split for any trade with no usable pair.
  function matShareFor(workId) {
    const r = WORK[workId] && WORK[workId].rate;
    if (r && typeof r.mat === 'number' && typeof r.lab === 'number') {
      const t = r.mat + r.lab;
      if (t > 0) {
        return Math.min(0.85, Math.max(0.15, r.mat / t));
      }
    }
    return 0.5;
  }

  function jicBookPayload() {
    const rates = {};
    let entries = 0;
    // JIC_RATES rows are identified by their trade plus the row number inside
    // the ref ('JIC #3' -> 3); the ref itself can carry a prefix, so the number
    // is read off the end rather than parsing the whole string.
    const rowNo = function (ref) {
      const n = String(ref || '').match(/(\d+)\s*$/);
      return n ? Number(n[1]) : 0;
    };
    JIC_RATES.forEach(function (r) {
      const m = JIC_BOOK_MAP.find(function (x) {
        return x[0] === r.tid && x[1] === rowNo(r.ref);
      });
      if (!m) {
        return;
      }
      if (!rates[m[2]]) {
        rates[m[2]] = {};
      }
      // The combined figure, in JMD, per the book's own rate unit.
      // DELIBERATELY all-in only (owner 2026-10-12, G1): the book publishes ONE
      // figure, so no mat/lab pair is stored here. Putting a derived split in
      // this payload would feed it through modelRatesFor into the MEASURED
      // basis too, re-pricing every covered trade away from its WORK model.
      // The split shown under the headline is derived at the form layer
      // (prefillSplitFromAllin) and only while the all-in basis is chosen.
      // WELDING UNITS FIX (2026-10-16): the welding rows are published per
      // 100mm on the metric side and per INCH on the imperial side, but the
      // calculator's welding quantity IS inches in both unit systems (q ->
      // unit 'in', field label "Total cut length (in)"). Publishing the
      // per-100mm figure here made the engine multiply inch quantities by a
      // per-100mm rate with NO adapter ('100mm' has no RATE_UNITS entry, so
      // rf fell through to 1): 100 in priced J$19,800 in metric (100 x 198)
      // and J$6,035 in imperial (the FT default turned 100 into 30.48, then
      // x 198) - about 4x and 1.2x over the published J$50/in. Per-inch
      // figures for per-inch quantities: both modes now price 100 x 50 =
      // J$5,000, the book's own imperial column, exact. Only the welding
      // rows carry metUnit '100mm'; every other row keeps its metric pair.
      rates[m[2]][m[3]] =
        r.metUnit === '100mm'
          ? { allIn: r.impRate, unit: 'in' }
          : { allIn: r.metRate, unit: r.metUnit };
      entries++;
    });
    const book = {
      name: 'Jamaica rate book ' + JIC_YEARS,
      source: 'Jamaica Institute of Construction (JIC) published rate book',
      effective_from: '2025-01-01',
      effective_to: '2027-12-31',
      tier: 'published combined (all-in)',
      currency: 'JMD',
      rates: rates
    };
    book.checksum = bookChecksum(rates);
    return { books: [book], entryCount: entries };
  }
  let _rateBookUnits = 'metric';
  // The open popup's document-level Escape handler, so the toggle path can
  // tear it down exactly like the Close button does (no leaked listener).
  let _rrKeyHandler = null;
  // Rate-book view state (owner 2026-10-12: "segmented ... a search button as
  // well that actually indexes the rates"). The query and the chosen trade
  // survive a Metric/Imperial flip, so switching units never throws away what
  // the user was looking at.
  let _rrQuery = '';
  let _rrTrade = 'all';
  // The full 811-row book is GENERATED (tools/gen-jic-full.cjs) and loaded
  // lazily the FIRST time the card opens, so the 100 rows shipped inline keep
  // first paint fast on a slow connection (owner: "load quickly based on
  // someone's Internet"). Once loaded it stays for the session.
  //
  // RB-1 (REFINEMENT-DIRECTIVE-2026-10-24, 2026-10-25): the book is NO LONGER
  // a public script. It comes from GET /api/ratebook behind the signed-in
  // session the card already asks for before it opens, and it is cached in the
  // Cache API under RATEBOOK_CACHE so the book still works with no network
  // after one signed-in load. Signing out clears that cache
  // (js/mmgr-google-auth.js). The inline 100 rows stay as the offline floor
  // for a client that has never had a signed-in load.
  //
  // BUMP RATEBOOK_CACHE WHEN THE GENERATED BOOK CHANGES. The read is
  // cache-first - one fetch per client, ever - which is the point (no 100 KB
  // request on every open) and the trap (new rates invisible until the name
  // changes). One rename here is the whole refresh.
  const RATEBOOK_CACHE = 'mmgr-ratebook-v1';
  const RATEBOOK_URL = '/api/ratebook';
  let _rrFull = null;
  let _rrLoading = false;
  // 'signin' | 'offline' | '' - WHY the 100 inline rows are showing, so the
  // card can say the right sentence instead of guessing.
  let _rrWhy = '';
  // A1: every caller waits its turn - the panel mount, the rate-book card
  // and the send path all queue here, so exactly ONE fetch is ever in flight
  // and every done callback fires when it lands (or fails).
  let _rrWaiters = [];
  function rrFlushWaiters() {
    const ws = _rrWaiters;
    _rrWaiters = [];
    ws.forEach(function (f) {
      try {
        f();
      } catch (e) {
        /* one broken waiter must not strand the rest */
      }
    });
  }
  // The book payload the API returns, as the shape this page reads
  // (years / trades / rows). Anything malformed is treated as no book, so a
  // bad cache entry can never brick the dialog.
  function rrBookOf(d) {
    const b = d && d.book;
    if (!b || !b.rows || !b.rows.length) {
      return null;
    }
    return { years: b.years, trades: b.trades || [], rows: b.rows };
  }
  function rrCacheOpen() {
    try {
      if (typeof caches === 'undefined' || !caches.open) {
        return Promise.resolve(null);
      }
      return caches.open(RATEBOOK_CACHE).then(
        function (c) {
          return c;
        },
        function () {
          return null;
        }
      );
    } catch (e) {
      // Private-mode browsers disable the Cache API. The page still works:
      // the fetch path below serves the book, it is just not kept offline.
      return Promise.resolve(null);
    }
  }
  function rrCacheRead() {
    return rrCacheOpen().then(function (c) {
      if (!c) {
        return null;
      }
      return c
        .match(RATEBOOK_URL)
        .then(function (res) {
          return res && res.ok ? res.json() : null;
        })
        .then(rrBookOf)
        .catch(function () {
          return null;
        });
    });
  }
  function rrCacheWrite(d) {
    return rrCacheOpen().then(function (c) {
      if (!c) {
        return;
      }
      return c.put(
        RATEBOOK_URL,
        new Response(JSON.stringify(d), {
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        })
      );
    });
  }
  function rrSettle(book, why) {
    _rrFull = book || null;
    if (why) {
      _rrWhy = why;
    }
    _rrLoading = false;
    // QA seam (RB-1): the settled book, so a harness can wait for the ONE
    // load to finish instead of racing it. It is the same object the page is
    // already holding in memory - nothing new is exposed by publishing it, and
    // it is null (not undefined) when the load settled on the inline rows, so
    // a waiter can tell "done, no book" from "not done yet".
    window.MMGR_RATEBOOK = _rrFull;
    rrFlushWaiters();
  }
  function rrLoadFull(done) {
    if (_rrFull) {
      if (typeof done === 'function') {
        done();
      }
      return;
    }
    if (typeof done === 'function') {
      _rrWaiters.push(done);
    }
    if (_rrLoading) {
      return; // in flight; it flushes every waiter
    }
    _rrLoading = true;
    // 1. Cache first. Offline this is the only step that can answer, and a
    //    warm client opens the whole book without touching the network.
    rrCacheRead().then(function (cached) {
      if (cached) {
        rrSettle(cached);
        return;
      }
      // 2. Network. A 401 means the session went away between the gate and
      //    this fetch: say so and leave the inline rows in place.
      return fetch(RATEBOOK_URL, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      })
        .then(function (res) {
          if (res.status === 401) {
            rrSettle(null, 'signin');
            return;
          }
          if (!res.ok) {
            rrSettle(null, 'offline');
            return;
          }
          return res.json().then(function (d) {
            const book = rrBookOf(d);
            if (!book) {
              rrSettle(null, 'offline');
              return;
            }
            rrCacheWrite({ ok: true, book: book }).catch(function () {
              /* not fatal: the session copy still serves this page */
            });
            rrSettle(book);
          });
        })
        .catch(function () {
          rrSettle(null, 'offline');
        });
    });
  }
  // Trade list, in book order, from whichever source is loaded.
  function rrTrades() {
    if (_rrFull) {
      return _rrFull.trades;
    }
    const seen = [];
    JIC_RATES.forEach(function (r) {
      if (
        !seen.some(function (x) {
          return x.tid === r.tid;
        })
      ) {
        seen.push({ tid: r.tid, label: r.trade });
      }
    });
    return seen;
  }
  // One row shape whether the data came from the generated 811-row file or the
  // 100 rows shipped inline.
  function rrRows() {
    const labels = {};
    rrTrades().forEach(function (t) {
      labels[t.tid] = t.label;
    });
    if (_rrFull) {
      return _rrFull.rows.map(function (r) {
        const label = labels[r.t] || r.t;
        return {
          tid: r.t,
          trade: label,
          ref: label + ' #' + r.n,
          desc: r.d,
          impUnit: r.iu,
          impRate: r.ir,
          metUnit: r.mu,
          metRate: r.mr,
          basis: r.b === 'C' ? 'C' : 'S',
          note: r.note || '',
          inApp: !!r.app
        };
      });
    }
    return JIC_RATES.map(function (r) {
      return {
        tid: r.tid,
        trade: r.trade,
        ref: r.ref,
        desc: r.desc,
        impUnit: r.impUnit,
        impRate: r.impRate,
        metUnit: r.metUnit,
        metRate: r.metRate,
        basis: 'S',
        note: '',
        inApp: true
      };
    });
  }
  // The search indexes what a person would actually type: the description, the
  // ref, the trade, either unit, AND both rate numbers - so typing a price
  // finds the rows at that price, which is the case the owner named ("search
  // for a specific rate ... relative rates will pop up").
  function rrMatch(r, q) {
    if (!q) {
      return true;
    }
    if (r.desc.toLowerCase().indexOf(q) > -1) {
      return true;
    }
    if (r.ref.toLowerCase().indexOf(q) > -1) {
      return true;
    }
    if (r.trade.toLowerCase().indexOf(q) > -1) {
      return true;
    }
    if (r.impUnit.toLowerCase().indexOf(q) > -1) {
      return true;
    }
    if (r.metUnit.toLowerCase().indexOf(q) > -1) {
      return true;
    }
    const n = Number(q.replace(/[, ]/g, ''));
    if (isFinite(n) && n > 0) {
      if (Math.round(r.impRate) === Math.round(n)) {
        return true;
      }
      if (Math.round(r.metRate) === Math.round(n)) {
        return true;
      }
    }
    return false;
  }
  function rrMoney(v) {
    return (
      'J$' +
      Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    );
  }
  // ---- PART I PHASE 2 (owner, 2026-10-17): the JIC PICKER (I1 Option C) ----
  // Choose a trade, choose one of its book rates, type the quantity - any of
  // the 811 shipped rows prices as a first-class estimate line. Field
  // visibility follows syncLabels (the custom/variant convention); the data
  // comes from whichever book source is loaded, so the picker works with no
  // network (the inline 100 rows carry all 11 trades). The rate field carries
  // the book prefill marker (dataset.model) exactly like the split rate
  // fields: equal = the published figure, anything else = the user's own
  // (the book is a default, never a lock).
  let _jicIdxSrc = null;
  let _jicIdx = null;
  let _jicRecall = false;
  let _jicTried = false;
  let _jicOffline = false;
  let _prevWork = null;
  // PURE row resolution over whichever book source is loaded - never the DOM
  // - so computeFor prices a recalled pick from its own saved trade + ref and
  // workName() names the line from the same row. Memoized per source (inline
  // 100 / full 811), so a render never re-maps the whole book.
  function jicRowIndex() {
    const src = _rrFull ? 'full' : 'inline';
    if (_jicIdx && _jicIdxSrc === src) {
      return _jicIdx;
    }
    const idx = {};
    rrRows().forEach(function (r) {
      const k = r.tid + '|' + r.ref;
      if (!idx[k]) {
        idx[k] = r;
      }
    });
    _jicIdx = idx;
    _jicIdxSrc = src;
    return idx;
  }
  function jicRowFor(tid, ref) {
    if (!tid || !ref) {
      return null;
    }
    return jicRowIndex()[tid + '|' + ref] || null;
  }
  // The row's money speaks the ROW's own unit: the displayed unit system
  // picks the side (both shipped books carry a positive rate on both sides -
  // verified 811/811 and 100/100), and each side's unit follows its own
  // rate, so quantity x rate is exact with no conversion anywhere.
  function jicUnitFor(row, imp) {
    return (imp ? row.impUnit : row.metUnit) || (imp ? row.metUnit : row.impUnit) || 'each';
  }
  function jicRateFor(row, imp) {
    const v = imp ? row.impRate : row.metRate;
    return isFinite(v) && v > 0 ? v : imp ? row.metRate : row.impRate;
  }
  // The published-rate note follows the PICKED row: it says the figure is
  // the book's own while the field still equals the prefill marker, and
  // hides the moment the user's own figure lands.
  function syncJicNote() {
    const note = $('calc-jic-note');
    const rateEl = $('calc-jic-rate');
    if (!note || !rateEl) {
      return;
    }
    const m = rateEl.dataset.model;
    const untouched = m != null && m !== '' && String(rateEl.value) === String(m);
    note.hidden = !untouched;
    if (untouched) {
      note.textContent =
        RATEBOOK_NAME + ' planning rate. Rates change - type your own figure if yours differs.';
    }
  }
  function renderJicPicker() {
    const wrap = $('calc-jic-wrap');
    const key = ($('calc-work') || {}).value;
    if (!wrap) {
      return;
    }
    wrap.hidden = key !== 'jic';
    const tSel = $('calc-jic-trade'),
      rSel = $('calc-jic-row'),
      rateEl = $('calc-jic-rate');
    if (!tSel || !rSel || !rateEl) {
      return;
    }
    if (key !== 'jic') {
      // Leaving the picker drops the pick the way leaving Custom clears its
      // four fields: the next open starts clean, a recall restores its own
      // pick through applyState - and the last seen work item is remembered
      // so a rejected pick (signed out, online) steps back to it.
      _prevWork = key;
      tSel.value = '';
      rSel.innerHTML = '<option value="">Pick a trade first</option>';
      rSel.disabled = true;
      rateEl.value = '';
      delete rateEl.dataset.model;
      syncJicNote();
      return;
    }
    const imp = _units === 'imperial';
    // Trades with their row counts, in book order; a still-valid selection
    // survives the rebuild (a unit flip or a full-book land must not lose
    // the pick).
    const trades = rrTrades();
    const rowsAll = rrRows();
    const prevT = tSel.value;
    tSel.innerHTML =
      '<option value="">Pick a trade</option>' +
      trades
        .map(function (t) {
          const n = rowsAll.filter(function (r) {
            return r.tid === t.tid;
          }).length;
          return n
            ? '<option value="' + esc(t.tid) + '">' + esc(t.label) + ' (' + n + ')</option>'
            : '';
        })
        .join('');
    tSel.value = trades.some(function (t) {
      return t.tid === prevT;
    })
      ? prevT
      : '';
    const tid = tSel.value;
    if (!tid) {
      rSel.innerHTML = '<option value="">Pick a trade first</option>';
      rSel.disabled = true;
      rateEl.value = '';
      delete rateEl.dataset.model;
      syncJicNote();
      kickJicFullLoad();
      return;
    }
    rSel.disabled = false;
    // Rows of the chosen trade in the DISPLAYED unit system: the option says
    // ref, description, unit and rate - plus the book's own honesty notes
    // ('cutting and smoothing, not welding', 'same item as #72 at a
    // different rate') and, on the converted side, the calculated-rate
    // marker, so a pick is legible without a second look at the book.
    const rows = rowsAll.filter(function (r) {
      return r.tid === tid;
    });
    const prevR = rSel.value;
    rSel.innerHTML = rows
      .map(function (r) {
        const unit = jicUnitFor(r, imp);
        const rate = jicRateFor(r, imp);
        const d = r.desc.length > 46 ? r.desc.slice(0, 43) + '...' : r.desc;
        return (
          '<option value="' +
          esc(r.ref) +
          '">' +
          esc(r.ref) +
          ' - ' +
          esc(d) +
          ' (' +
          esc(unit) +
          ' - ' +
          rrMoney(rate) +
          ')' +
          (r.note ? ' - ' + esc(r.note) : '') +
          (r.basis === 'C' && !imp ? ' [our conversion]' : '') +
          '</option>'
        );
      })
      .join('');
    const hadRow = rows.some(function (r) {
      return r.ref === prevR;
    });
    if (!hadRow) {
      rSel.value = rows.length ? rows[0].ref : '';
    }
    const row = jicRowFor(tid, rSel.value);
    if (row) {
      // The rate follows the row: a fresh pick (or a trade change) seeds the
      // book figure; an untouched book figure follows its row across a unit
      // flip or a full-book land; the user's OWN typed figure is never
      // overwritten - and a recall holds its saved figure exactly, because
      // the sum it showed is the sum it must re-create.
      const m = rateEl.dataset.model;
      const untouched = m != null && m !== '' && String(rateEl.value) === String(m);
      if (!_jicRecall && (!hadRow || rateEl.value === '' || untouched)) {
        const v = Math.round(jicRateFor(row, imp) * 100) / 100;
        rateEl.value = String(v);
        rateEl.dataset.model = String(v);
      }
      const unit = jicUnitFor(row, imp);
      const uEl = $('calc-jic-unit');
      if (uEl) {
        uEl.textContent = unit;
      }
      const d1l = $('calc-d1-label');
      if (d1l) {
        d1l.textContent = 'Quantity (' + unit + ')';
      }
    }
    // The hint stays honest about the source: after a FAILED full-book load
    // (a first open with no network) it says the built-in set is shown.
    const hint = $('calc-jic-hint');
    if (hint) {
      hint.textContent =
        _rrFull || !_jicOffline
          ? '- pick a trade, then a rate'
          : _rrWhy === 'signin'
            ? '- pick a trade, then a rate (built-in set; sign in for all 811)'
            : '- pick a trade, then a rate (showing the built-in set)';
    }
    syncJicNote();
    kickJicFullLoad();
  }
  // The full 811-row book loads on the first picker (or card) ask, AT MOST
  // once per page life: a failed fetch (offline, first visit) settles on the
  // inline 100 rows - which carry all 11 trades - instead of retrying on
  // every render. A page refresh is a fresh attempt.
  function kickJicFullLoad() {
    if (_rrFull || _jicTried) {
      return;
    }
    _jicTried = true;
    rrLoadFull(function () {
      _jicOffline = !_rrFull;
      if (($('calc-work') || {}).value === 'jic') {
        renderJicPicker();
      }
    });
  }
  // The picker IS rate-book access, so it carries the book's own sign-in
  // gate (owner 2026-10-13: to access the rate book, you sign in - free,
  // no premium): a signed-OUT visit online steps back to the previous work
  // item and shows the same sign-in card the book uses; offline or with an
  // unverifiable answer it OPENS (offline-first is sacred - same rule as the
  // book card). window.__MMGR_RR_AUTH is the QA seam, exactly as for the card.
  function jicGateOnWorkChange() {
    const sel = $('calc-work');
    if (!sel || sel.value !== 'jic') {
      return;
    }
    const known =
      window.__MMGR_RR_AUTH === 'in' || window.__MMGR_RR_AUTH === 'out'
        ? window.__MMGR_RR_AUTH
        : _rrAuth;
    const reject = function () {
      if (($('calc-work') || {}).value !== 'jic') {
        return;
      }
      renderRateBookSigninCard();
      sel.value = _prevWork && WORK[_prevWork] ? _prevWork : 'custom';
      syncLabels();
    };
    if (known === 'out') {
      reject();
      return;
    }
    if (known === 'in') {
      return;
    }
    rrAuthState().then(function (s) {
      if (s === 'out') {
        reject();
      }
    });
  }
  // BUG FIX (owner directive 2026-10-02, caught by the new RB gates): this
  // function was a TOGGLE - `if (existing) { existing.remove(); return; }` -
  // but the unit buttons inside the card also called it to RE-RENDER in the
  // other unit system. So clicking "Imperial" or "Metric" silently CLOSED the
  // rate book instead of switching it. The toggle now lives in the caller
  // (openRateBook); renderRateBookCard only ever renders.
  function renderRateBookCard() {
    const existing = document.getElementById('calc-ratebook-card');
    if (existing) {
      existing.remove();
    }
    // Rebuilding in place (the Metric/Imperial toggle) must drop the previous
    // popup's Escape handler, or each toggle stacks another live listener.
    if (_rrKeyHandler) {
      document.removeEventListener('keydown', _rrKeyHandler, true);
      _rrKeyHandler = null;
    }
    const card = document.createElement('div');
    card.id = 'calc-ratebook-card';
    // OWNER 2026-10-02: it is a POPUP, not a section at the foot of the page.
    // It gets the same overlay + panel treatment the app's dialogs use, so it
    // is clearly something you open and then close (scrim click, Escape, or
    // the Close button), and it cannot push the estimate down the page.
    card.className = 'card rr-overlay';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', RATEBOOK_NAME + ' ' + JIC_YEARS);
    const curUnit = _rateBookUnits === 'imperial' ? 'imp' : 'met';
    const all = rrRows();
    const trades = rrTrades();
    const q = _rrQuery.trim().toLowerCase();
    // Scoped set: the chosen trade first, then the query. Doing the trade
    // filter before the search keeps a per-trade search O(that trade) instead
    // of walking all 811 rows on every keystroke.
    let view = all;
    if (_rrTrade !== 'all') {
      view = view.filter(function (r) {
        return r.tid === _rrTrade;
      });
    }
    if (q) {
      view = view.filter(function (r) {
        return rrMatch(r, q);
      });
    }
    // Group into sections so a trade is never one endless scroll: each trade
    // gets a heading row carrying its own count, and the sections follow the
    // book's order. When a query is active the headings still show, so a hit
    // inside a 100-row trade is still located.
    let rows = '';
    let last = '';
    view.forEach(function (r, i) {
      if (r.trade !== last) {
        const n = view.filter(function (x) {
          return x.trade === r.trade;
        }).length;
        rows +=
          '<tr class="rr-trade"><th colspan="5" scope="colgroup">' +
          esc(r.trade) +
          '<span class="rr-count">' +
          n +
          ' rate' +
          (n === 1 ? '' : 's') +
          '</span></th></tr>';
        last = r.trade;
      }
      const rateVal = curUnit === 'imp' ? r.impRate : r.metRate;
      const unitVal = curUnit === 'imp' ? r.impUnit : r.metUnit;
      rows +=
        '<tr' +
        (r.inApp ? ' class="rr-in-app"' : '') +
        '><td class="rr-ref">' +
        esc(r.ref) +
        '</td><td class="rr-desc">' +
        esc(r.desc) +
        // 'C' marks a rate WE calculated from the imperial figure rather than
        // one JIC printed. The owner asked for the marker; the title spells out
        // what it means so it is never an unexplained letter.
        (r.basis === 'C'
          ? '<span class="rr-calc" title="Calculated from the imperial rate using the published conversion rule">C</span>'
          : '') +
        (r.note ? '<span class="rr-note">' + esc(r.note) + '</span>' : '') +
        '</td><td class="rr-unit">' +
        esc(unitVal) +
        '</td><td class="rr-rate">' +
        rrMoney(rateVal) +
        '</td><td class="rr-use">' +
        // PART I PHASE 1 (owner, 2026-10-17) - "Use this rate" (I1 Option A).
        // A row without a positive published rate never gets an action: no
        // silent zero price (the shipped books carry none such - verified
        // 811/811 + 100/100 positive - the guard is honest degradation).
        (rateVal > 0
          ? '<button type="button" class="rr-use-btn" data-action="rrUse" data-i="' +
            i +
            '" aria-label="Use ' +
            esc(r.ref) +
            ' in the calculator" title="Use this rate in the calculator"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-plus"></use></svg></button>'
          : '') +
        '</td></tr>';
    });
    const empty = !view.length;
    // The trade picker: All plus one control per trade, each showing its full
    // row count. This is the per-trade half of "both global and per trade" -
    // pick a trade to browse or search only within it.
    const chips =
      '<button type="button" class="bcp-seg-btn' +
      (_rrTrade === 'all' ? ' active' : '') +
      '" data-action="rrTrade" data-tid="all" aria-pressed="' +
      (_rrTrade === 'all') +
      '">All (' +
      all.length +
      ')</button>' +
      trades
        .map(function (t) {
          const n = all.filter(function (r) {
            return r.tid === t.tid;
          }).length;
          return (
            '<button type="button" class="bcp-seg-btn' +
            (_rrTrade === t.tid ? ' active' : '') +
            '" data-action="rrTrade" data-tid="' +
            t.tid +
            '" aria-pressed="' +
            (_rrTrade === t.tid) +
            '">' +
            RATEBOOK_MARK +
            ' ' +
            esc(t.label) +
            ' (' +
            n +
            ')</button>'
          );
        })
        .join('');
    card.innerHTML =
      '<div class="rr-panel">' +
      '<div class="rr-head">' +
      '<h2 class="card-title">' +
      RATEBOOK_MARK +
      ' ' +
      RATEBOOK_NAME +
      ' <span class="rr-years">' +
      JIC_YEARS +
      '</span></h2>' +
      '<div class="bcp-seg" role="group" aria-label="Rate book units">' +
      '<button type="button" class="bcp-seg-btn' +
      (_rateBookUnits === 'metric' ? ' active' : '') +
      '" data-action="rrUnits" data-units="metric">Metric</button>' +
      '<button type="button" class="bcp-seg-btn' +
      (_rateBookUnits === 'imperial' ? ' active' : '') +
      '" data-action="rrUnits" data-units="imperial">Imperial</button>' +
      '</div>' +
      '<button type="button" class="bcp-rr-x" data-action="rrClose" aria-label="Close the rate book" title="Close"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-x"></use></svg></button>' +
      '</div>' +
      // Search is global across every trade by default, and scopes to the
      // picked trade once one is chosen. It indexes description, ref, trade,
      // unit and both rate columns.
      '<div class="rr-search">' +
      '<svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-search"></use></svg>' +
      '<input type="search" id="rr-q" class="rr-q" placeholder="Search ' +
      all.length +
      ' rates - a word, a ref, a trade or a price" aria-label="Search the rate book" value="' +
      esc(_rrQuery) +
      '" autocomplete="off">' +
      '<span class="rr-hits" role="status" aria-live="polite">' +
      (q ? view.length + ' of ' + all.length : all.length + ' rates') +
      '</span>' +
      '</div>' +
      '<div class="rr-trades bcp-seg" role="group" aria-label="Trade">' +
      chips +
      '</div>' +
      '<div class="rr-scroll">' +
      (empty
        ? '<div class="rr-empty">No rate matches "' +
          esc(_rrQuery.trim()) +
          '"' +
          (_rrTrade !== 'all' ? ' in this trade' : '') +
          '. Try a single word, or clear the search.</div>'
        : '<table class="rr-table"><thead><tr><th>Ref</th><th>Description</th><th>Unit</th><th class="rr-rate-h">Rate</th><th class="rr-use-h">Use</th></tr></thead><tbody>' +
          rows +
          '</tbody></table>') +
      '</div>' +
      '<div class="rr-foot">' +
      'All amounts in Jamaican dollars (J$). ' +
      '<span class="rr-legend"><span class="rr-calc" aria-hidden="true">C</span> calculated by us from the imperial rate</span>' +
      (_rrWhy === 'signin'
        ? '<span class="rr-why">Sign in to open all 811 rates. The 100 built-in rows are showing.</span>'
        : '') +
      '<span class="rr-notice">' +
      esc(rateBookNotice()) +
      '</span>' +
      // Source line: kept while the status is unresolved or permission-granted
      // (directive 3.3). It disappears only when the rates are rebuilt from the
      // owner's own costs.
      (RATEBOOK_STATUS === 'rebuilt'
        ? ''
        : '<span class="rr-source">Source data: ' + esc(RATEBOOK_SOURCE) + '</span>') +
      '</div>' +
      '</div>';
    document.body.appendChild(card);
    const close = function () {
      const c = document.getElementById('calc-ratebook-card');
      if (c) {
        c.remove();
      }
      document.body.classList.remove('rr-open');
      // OWNER INCIDENT 2026-10-02: the Escape listener used to live on the
      // card. A card that never receives focus never sees a keydown, so
      // Escape silently did nothing. It is a document-level listener now
      // (the app's dialog convention) and it is removed on close so it
      // cannot leak across openings.
      document.removeEventListener('keydown', onKey, true);
      const opener = document.querySelector('[data-action="openRateBook"]');
      if (opener) {
        opener.focus();
      }
    };
    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    }
    _rrKeyHandler = onKey;
    card.querySelector('[data-action="rrClose"]').addEventListener('click', close);
    // A popup you can leave three ways: the X, the scrim behind it, Escape.
    card.addEventListener('click', function (e) {
      if (e.target === card) {
        close();
      }
    });
    document.addEventListener('keydown', onKey, true);
    // Focus moves into the panel so a keyboard user is IN the dialog (and so
    // Tab cycles its controls) the way every other dialog in the app behaves.
    const firstBtn = card.querySelector('.rr-head button, .bcp-rr-x');
    if (firstBtn) {
      try {
        firstBtn.focus();
      } catch (e) {
        /* nicety */
      }
    }
    document.body.classList.add('rr-open');
    card.querySelectorAll('[data-action="rrUnits"]').forEach(function (b) {
      b.addEventListener('click', function () {
        const next = b.getAttribute('data-units');
        if (next === _rateBookUnits) {
          return;
        } // already showing this system
        _rateBookUnits = next;
        renderRateBookCard();
      });
    });
    // Per-trade scope. Re-renders in place; the search box is refocused below
    // so a user narrowing a search does not lose the cursor.
    card.querySelectorAll('[data-action="rrTrade"]').forEach(function (b) {
      b.addEventListener('click', function () {
        const next = b.getAttribute('data-tid');
        if (next === _rrTrade) {
          return;
        }
        _rrTrade = next;
        renderRateBookCard();
      });
    });
    // PART I PHASE 1 (owner, 2026-10-17): "Use this rate" - every row prices
    // through the EXISTING custom-item path (I1 Option A): no new money math,
    // the row's displayed unit system + rate, and the ref rides the name onto
    // the bill line. data-i indexes THIS render's filtered view; every
    // re-render rewires, so an index can never point at a stale row.
    card.querySelectorAll('[data-action="rrUse"]').forEach(function (b) {
      b.addEventListener('click', function () {
        const idx = Number(b.getAttribute('data-i'));
        if (view[idx]) {
          rrUseRate(view[idx]);
        }
      });
    });
    // OWNER 2026-10-13: the trade strip no longer wraps - it scrolls. Keep the
    // chosen tab on screen by setting the strip's OWN scrollLeft (never
    // scrollIntoView, which could yank the page behind the popup).
    const tradesWrap = card.querySelector('.rr-trades');
    const activeChip = tradesWrap && tradesWrap.querySelector('.active');
    if (tradesWrap && activeChip) {
      tradesWrap.scrollLeft = Math.max(0, activeChip.offsetLeft - 8);
    }
    // Search: re-render on every keystroke, then put the caret back. The
    // filtered set is rebuilt from the cached rows each time, so a query can
    // never leave stale rows behind.
    const qEl = card.querySelector('#rr-q');
    if (qEl) {
      qEl.addEventListener('input', function () {
        _rrQuery = qEl.value;
        renderRateBookCard();
        const again = document.getElementById('rr-q');
        if (again) {
          try {
            again.focus();
            // Caret to the end, so typing continues where it was.
            again.setSelectionRange(again.value.length, again.value.length);
          } catch (e) {
            /* nicety */
          }
        }
      });
      // Focus the search box on open: finding a rate is the reason the card
      // exists, so the first keystroke should just work.
      try {
        qEl.focus();
      } catch (e) {
        /* nicety */
      }
    }
    // Lazy-load the full book the first time this opens. It re-renders once it
    // lands (or falls back to the inline 100 rows if it cannot be fetched).
    if (!_rrFull) {
      rrLoadFull(function () {
        if (document.getElementById('calc-ratebook-card')) {
          renderRateBookCard();
        }
      });
    }
  }
  // PART I PHASE 1 (owner, 2026-10-17, "Use this rate"): prefill the Custom
  // item from the row AS DISPLAYED (the book's current unit system - what the
  // user was just reading). The custom path prices quantity x rate EXACTLY
  // (B1) - zero new money math - and workName() carries this name (ref first)
  // onto the bill line, the CSV and history for traceability. The inline
  // fallback only ever holds rows up to #100, all with full data, so every
  // rendered row is actionable offline; the ref in the name keeps a truncated
  // description identifiable (capped at the field's 60-char contract).
  function rrUseRate(r) {
    const imp = _rateBookUnits === 'imperial';
    const unit = (imp ? r.impUnit : r.metUnit) || (imp ? r.metUnit : r.impUnit) || 'each';
    const rateVal = imp ? r.impRate : r.metRate;
    if (!(rateVal > 0)) {
      return;
    }
    // Switch the form to Custom FIRST: syncLabels reveals the four fields on
    // entering 'custom' (it only clears them when LEAVING custom), so the
    // fill below always lands on visible fields.
    const w = $('calc-work');
    if (w && w.value !== 'custom') {
      w.value = 'custom';
      w.dispatchEvent(new Event('change', { bubbles: true }));
    }
    let name = r.ref + ' - ' + r.desc;
    if (name.length > 60) {
      name = name.slice(0, 57) + '...';
    }
    const set = function (id, val) {
      const el = $(id);
      if (el) {
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    };
    set('calc-custom-name', name);
    set('calc-custom-unit', String(unit).slice(0, 12));
    set('calc-custom-qty', '');
    set('calc-custom-rate', String(Math.round(Number(rateVal) * 100) / 100));
    // Close the popup the way the Close button does (card, scroll lock,
    // Escape listener), reset the card's own state so the NEXT open starts
    // clean, then land focus in the one field still to fill: the quantity.
    const c = document.getElementById('calc-ratebook-card');
    if (c) {
      c.remove();
    }
    document.body.classList.remove('rr-open');
    if (_rrKeyHandler) {
      document.removeEventListener('keydown', _rrKeyHandler, true);
      _rrKeyHandler = null;
    }
    _rrQuery = '';
    _rrTrade = 'all';
    const wrap = $('calc-custom-wrap');
    if (wrap && wrap.scrollIntoView) {
      wrap.scrollIntoView({ block: 'center' });
    }
    const qty = $('calc-custom-qty');
    if (qty) {
      qty.focus();
    }
  }
  // The top-bar link: opens the card, or closes it if it is already open.
  function showRateBookCard() {
    if (document.getElementById('calc-ratebook-card')) {
      const c = document.getElementById('calc-ratebook-card');
      if (c) {
        c.remove();
      }
      // The toggle must run the same teardown as the Close button, or the
      // document Escape listener and the body scroll lock outlive the card.
      document.body.classList.remove('rr-open');
      document.removeEventListener('keydown', _rrKeyHandler, true);
      return;
    }
    renderRateBookCard();
  }
  // OWNER 2026-10-13 ("To access the rate book, you have to sign in. No
  // premium needed"): the book opens for a SIGNED-IN account - Free included.
  // The probe is GET /api/auth/me (the Worker's own session endpoint).
  //   'in'    -> signed in, open the book.
  //   'out'   -> signed out, show the sign-in card instead.
  //   'unknow'-> no answer we can trust: a static dev server (404), an offline
  //             device, or a Worker hiccup. Offline-first is sacred, so the
  //             book OPENS rather than brick itself over an unverifiable state
  //             - a real signed-out visit online always answers 'out'.
  // window.__MMGR_RR_AUTH is the QA seam (qa-calculator-page RB-Auth gates):
  // set it to 'in' or 'out' to pin the branch without a live Worker.
  let _rrAuth = null;
  function rrAuthState() {
    if (window.__MMGR_RR_AUTH === 'in' || window.__MMGR_RR_AUTH === 'out') {
      return Promise.resolve(window.__MMGR_RR_AUTH);
    }
    if (_rrAuth) {
      return Promise.resolve(_rrAuth);
    }
    return fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(function (r) {
        if (r.status === 404 || r.status === 501 || !r.ok) {
          return 'unknown';
        }
        return r.json().then(function (d) {
          return d && d.ok && d.user ? 'in' : 'out';
        });
      })
      .catch(function () {
        return 'unknown';
      })
      .then(function (s) {
        _rrAuth = s;
        return s;
      });
  }
  // The signed-out card: same overlay shell as the book, plainly worded.
  function renderRateBookSigninCard() {
    const card = document.createElement('div');
    card.id = 'calc-ratebook-card';
    card.className = 'card rr-overlay';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', 'Sign in to open the ' + RATEBOOK_NAME);
    card.innerHTML =
      '<div class="rr-panel rr-panel-s">' +
      '<div class="rr-head">' +
      '<h2 class="card-title">' +
      RATEBOOK_MARK +
      ' ' +
      RATEBOOK_NAME +
      ' <span class="rr-years">' +
      JIC_YEARS +
      '</span></h2>' +
      '<button type="button" class="bcp-rr-x" data-action="rrClose" aria-label="Close" title="Close"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-x"></use></svg></button>' +
      '</div>' +
      '<div class="rr-signin">' +
      '<h3>Sign in to open the rate book</h3>' +
      '<p>The ' +
      RATEBOOK_NAME +
      ' is free on every plan, Free included. Sign in so your rate views can follow you between devices. Your projects stay on this device either way.</p>' +
      '<div class="rr-signin-cta">' +
      '<a class="btn btn-g" href="app.html?next=calculator.html">Sign in</a>' +
      '<button type="button" class="btn btn-ghost" data-action="rrClose">Not now</button>' +
      '</div>' +
      '</div>' +
      '</div>';
    document.body.appendChild(card);
    const close = function () {
      const c = document.getElementById('calc-ratebook-card');
      if (c) {
        c.remove();
      }
      document.body.classList.remove('rr-open');
      document.removeEventListener('keydown', onKey, true);
      const opener = document.querySelector('[data-action="openRateBook"]');
      if (opener) {
        opener.focus();
      }
    };
    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    }
    _rrKeyHandler = onKey;
    card.querySelectorAll('[data-action="rrClose"]').forEach(function (b) {
      b.addEventListener('click', close);
    });
    card.addEventListener('click', function (e) {
      if (e.target === card) {
        close();
      }
    });
    document.addEventListener('keydown', onKey, true);
    const firstBtn = card.querySelector('.rr-signin-cta a, .bcp-rr-x');
    if (firstBtn) {
      try {
        firstBtn.focus();
      } catch (e) {
        /* nicety */
      }
    }
    document.body.classList.add('rr-open');
  }
  // The top-bar entry: probe the session, then open the book or the gate.
  function openRateBookGated() {
    // Already showing (either card): click-to-close keeps the toggle contract.
    if (document.getElementById('calc-ratebook-card')) {
      showRateBookCard();
      return;
    }
    // Sync path when the answer is ALREADY known (a cached session, or the
    // QA seam): a repeat open must stay instant and synchronous - the toggle
    // contract the page and its harnesses rely on. The first click in a real
    // session still probes the network before deciding.
    const known =
      window.__MMGR_RR_AUTH === 'in' || window.__MMGR_RR_AUTH === 'out'
        ? window.__MMGR_RR_AUTH
        : _rrAuth;
    if (known === 'in' || known === 'out') {
      if (known === 'out') {
        renderRateBookSigninCard();
      } else {
        renderRateBookCard();
      }
      return;
    }
    rrAuthState().then(function (s) {
      if (document.getElementById('calc-ratebook-card')) {
        return; // a second click won the race; it already toggled
      }
      if (s === 'out') {
        renderRateBookSigninCard();
      } else {
        renderRateBookCard();
      }
    });
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
    if (!w) {
      return null;
    }
    const b = activeBook();
    let mat = null,
      lab = null,
      allIn = null,
      src = null,
      unit = null,
      fromBook = false;
    if (b && b.rates && b.rates[key]) {
      const vset = b.rates[key];
      const r = (variantId && vset[variantId]) || vset['*'] || null;
      if (r) {
        mat = r.mat;
        lab = r.lab;
        allIn = r.allIn;
        unit = r.unit || null;
        src = b.currency;
        fromBook = true;
      }
    }
    if (mat == null && lab == null && allIn == null) {
      const av = variantFor(key, variantId);
      const rr = av ? av.rate : w.rate;
      mat = typeof rr.mat === 'function' ? rr.mat(d1m, d2m) : rr.mat;
      lab = rr.lab;
      src = BASE_CURRENCY;
      unit = (av && av.runit) || w.runit || null;
    }
    const f = fxBetween(src, targetCode || src);
    // E1 currency honesty: with no exchange rate for the book's currency the
    // result is flagged unconvertible and the CALLER leaves the fields empty
    // and says so. A JMD figure is never relabelled as the user's currency.
    if (f == null) {
      return {
        mat: mat,
        lab: lab,
        allIn: allIn,
        src: src,
        unit: unit,
        fromBook: fromBook,
        unconvertible: true
      };
    }
    return {
      mat: mat == null ? null : mat * f,
      lab: lab == null ? null : lab * f,
      allIn: allIn == null ? null : allIn * f,
      src: src,
      unit: unit,
      fromBook: fromBook,
      unconvertible: false
    };
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
    if (!w || !w.variants || !w.variants.length) {
      return null;
    }
    const id = st && st.variant;
    return (
      w.variants.find(function (v) {
        return v && v.id === id;
      }) || w.variants[0]
    );
  }
  function variantFor(key, variantId) {
    const w = WORK[key];
    if (!w || !w.variants || !w.variants.length) {
      return null;
    }
    return (
      w.variants.find(function (v) {
        return v && v.id === variantId;
      }) || w.variants[0]
    );
  }

  const INSTANCE_KINDS = {
    blockwall: 'wall',
    brickwall: 'wall',
    framing: 'wall',
    render: 'wall',
    paint: 'wall',
    drywall: 'wall',
    tile: 'area',
    siteprep: 'area',
    roof: 'area',
    'shingle-roof': 'area',
    ceiling: 'area',
    slab: 'pour',
    footings: 'pour',
    'concrete-drive': 'pour',
    excav: 'pour',
    'floor-screed': 'pour',
    fencing: 'run',
    skirt: 'run',
    'pipe-supply': 'run',
    'pipe-drain': 'run',
    conduit: 'run',
    gutter: 'run',
    'soffit-fascia': 'run',
    cabinet: 'run',
    formwork: 'area',
    'fabric-mesh': 'area',
    'concrete-labour': 'pour'
  };
  const INSTANCE_LABEL = { wall: 'Wall', area: 'Area', pour: 'Pour', run: 'Run' };
  let instRows = [],
    instSum = 0,
    instUnit = '',
    instLastKey = null;

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
    try {
      rows = JSON.parse(st.openings || '[]');
    } catch (e) {
      rows = [];
    }
    if (!Array.isArray(rows)) {
      return { count: 0, area: 0 };
    }
    let count = 0,
      area = 0;
    rows.forEach(function (rw) {
      if (!rw) {
        return;
      }
      const n = parseFloat(rw.n);
      const wRaw = parseFloat(rw.w),
        hRaw = parseFloat(rw.h);
      if (!(n > 0) || !(wRaw > 0) || !(hRaw > 0)) {
        return;
      }
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
    if (!w) {
      return [];
    }
    // PART I PHASE 2: the JIC picker's quantity is in the ROW's own unit
    // (metres, sq m, each, yd3 - whatever the chosen rate is per), so the
    // metre and length bands below would flag honest quantities as unit
    // mistakes. The row's own unit on the quantity label is the guard here.
    if (st.work === 'jic') {
      return [];
    }
    const imp = st && st.units === 'imperial';
    const out = [];
    const r2 = v => Math.round(v * 100) / 100;
    const band = function (field, label, v) {
      if (!(v > 0)) {
        return;
      }
      // Weight boxes (kg / lb) are unambiguous - the length/area bands do not
      // apply (rebar-size types steel weight in kg here; 500 kg is a normal
      // pour's steel, not a 500 m run).
      if (/\(kg\)|\(lb\)/.test(label)) {
        return;
      }
      if (/count/.test(label)) {
        if (v > 300) {
          out.push({ field: field, msg: v + ' is a lot of units - check the count.', fix: null });
        }
        return;
      }
      if (/\(mm\)/.test(label)) {
        if (imp) {
          // the box speaks inches here; only absurd values flag
          if (v > 60) {
            out.push({ field: field, msg: v + ' in is very thick - check the unit.', fix: null });
          }
          return;
        }
        if (v < 20) {
          const guess = v < 1 ? r2(v * 1000) : Math.round(v * 25.4);
          out.push({
            field: field,
            msg:
              v +
              ' in a millimetre box looks like ' +
              (v < 1 ? 'metres' : 'inches') +
              ' - did you mean ' +
              guess +
              ' mm?',
            fix: String(guess)
          });
        } else if (v > 2000) {
          out.push({
            field: field,
            msg: v + ' mm is very large - did you mean ' + r2(v / 1000) + ' m?',
            fix: String(r2(v / 1000))
          });
        }
        return;
      }
      if (/\(m2\)|\(m3\)/.test(label)) {
        if (v < 0.05) {
          out.push({ field: field, msg: v + ' is very small - check the unit.', fix: null });
        }
        return;
      }
      if (/Height/.test(label)) {
        if (v > (imp ? 500 : 12)) {
          out.push({
            field: field,
            msg: v + (imp ? ' ft' : ' m') + ' tall is unusual - check the unit.',
            fix: null
          });
        } else if (v < (imp ? 0.5 : 0.4)) {
          out.push({
            field: field,
            msg: v + (imp ? ' ft' : ' m') + ' is very short for a height - check the unit.',
            fix: null
          });
        }
        return;
      }
      // metre-box lengths / runs (feet boxes in imperial mode)
      if (imp) {
        if (v > 500) {
          out.push({ field: field, msg: v + ' ft is very long - check the unit.', fix: null });
        }
        return;
      }
      if (v > 150) {
        out.push({
          field: field,
          msg:
            v +
            ' m is very long - did you mean feet? (' +
            Math.round(v / FT) +
            ' ft = ' +
            r2(v * FT) +
            ' m)',
          fix: String(r2(v * FT))
        });
      } else if (v < 0.1) {
        out.push({
          field: field,
          msg:
            v +
            ' m is very small - did you mean millimetres? (' +
            Math.round(v * 1000) +
            ' mm = ' +
            r2(v / 1000) +
            ' m)',
          fix: String(r2(v / 1000))
        });
      }
    };
    band('d1', w.d1 || '', parseFloat(st.d1));
    if (w.d2) {
      band('d2', w.d2 || '', parseFloat(st.d2));
    }
    if (w.d3) {
      band('d3', w.d3 || '', parseFloat(st.d3));
    }
    return out;
  }
  // PURE: sum instance rows through WORK[key].q with the SAME imperial
  // conversions computeFor applies (ft to m, in to mm). Bad rows are skipped,
  // never thrown. n = identical-repeat count (digital timesing).
  function instancesQty(rows, key) {
    const w = WORK[key];
    if (!w) {
      return { qty: 0, unit: '' };
    }
    const imp = _units === 'imperial';
    let qty = 0,
      unit = '';
    (rows || []).forEach(function (rw) {
      if (!rw) {
        return;
      }
      const n = Math.max(1, parseInt(rw.n, 10) || 1);
      const a = parseFloat(rw.d1),
        b = w.d2 ? parseFloat(rw.d2) : null,
        c = w.d3 ? parseFloat(rw.d3) : null;
      if (!(a > 0) || (w.d2 && !(b > 0)) || (w.d3 && !(c > 0))) {
        return;
      }
      const d1 = imp ? a * (IMP_D1_FACTOR[key] || FT) : a;
      const d2 = w.d2 ? (imp ? b * FT : b) : null;
      const d3 = w.d3 ? (imp ? c * IN : c) : null;
      const qr = w.q(d1, d2, d3);
      qty += qr.qty * n;
      unit = qr.unit;
    });
    return { qty: Math.round(qty * 100) / 100, unit: unit };
  }
  function renderInstances() {
    const wrap = $('calc-instances'),
      rowsEl = $('calc-inst-rows');
    if (!wrap || !rowsEl) {
      return;
    }
    const key = ($('calc-work') || {}).value || '';
    const kind = INSTANCE_KINDS[key];
    const addBtn = $('calc-inst-add');
    if (!kind) {
      wrap.hidden = true;
      instRows = [];
      instSum = 0;
      instUnit = '';
      instLastKey = null;
      return;
    }
    wrap.hidden = false;
    // Rows re-seed when the work item changes (stale "Wall 1" rows must not
    // leak into a slab); the manual-override mode keeps its own state.
    if (instLastKey !== key || !instRows.length) {
      instRows = [{ label: INSTANCE_LABEL[kind] + ' 1', d1: '', d2: '', d3: '', n: 1 }];
      instLastKey = key;
    }
    if (addBtn) {
      addBtn.textContent = '+ Add ' + INSTANCE_LABEL[kind].toLowerCase();
    }
    const w = WORK[key];
    // A-5 (owner review 2026-10-10): every row box carries a real accessible
    // name ("Wall 1 length (m)"), not just a placeholder - these are exactly
    // the boxes the assistant has to fill.
    const rowName = function (rw, i) {
      return rw.label || INSTANCE_LABEL[kind] + ' ' + (i + 1);
    };
    rowsEl.innerHTML = instRows
      .map(function (rw, i) {
        return (
          '<div class="bcp-inst-row">' +
          '<input type="text" class="bcp-inst-label" data-idx="' +
          i +
          '" data-field="label" value="' +
          esc(rw.label) +
          '" aria-label="Element name">' +
          '<input type="number" class="bcp-inst-dim" data-idx="' +
          i +
          '" data-field="d1" min="0" step="any" inputmode="decimal" placeholder="' +
          esc(dimLabel(w, 'd1')) +
          '" aria-label="' +
          esc(rowName(rw, i) + ' ' + dimLabel(w, 'd1')) +
          '" value="' +
          esc(rw.d1) +
          '">' +
          (w.d2
            ? '<input type="number" class="bcp-inst-dim" data-idx="' +
              i +
              '" data-field="d2" min="0" step="any" inputmode="decimal" placeholder="' +
              esc(dimLabel(w, 'd2')) +
              '" aria-label="' +
              esc(rowName(rw, i) + ' ' + dimLabel(w, 'd2')) +
              '" value="' +
              esc(rw.d2) +
              '">'
            : '') +
          (w.d3
            ? '<input type="number" class="bcp-inst-dim" data-idx="' +
              i +
              '" data-field="d3" min="0" step="any" inputmode="decimal" placeholder="' +
              esc(dimLabel(w, 'd3')) +
              '" aria-label="' +
              esc(rowName(rw, i) + ' ' + dimLabel(w, 'd3')) +
              '" value="' +
              esc(rw.d3) +
              '">'
            : '') +
          '<input type="number" class="bcp-inst-count" data-idx="' +
          i +
          '" data-field="n" min="1" step="1" inputmode="numeric" value="' +
          esc(String(rw.n || 1)) +
          '" aria-label="How many identical">' +
          '<button type="button" class="btn btn-n btn-s" data-action="calcInstDel" data-idx="' +
          i +
          '" aria-label="Remove this element">X</button>' +
          '</div>'
        );
      })
      .join('');
    const s = instancesQty(instRows, key);
    instSum = s.qty;
    instUnit = s.unit;
    const sumEl = $('calc-inst-sum');
    if (sumEl) {
      sumEl.textContent = instSum > 0 ? 'Measured total: ' + qtyShown(instSum, instUnit).main : '';
    }
  }

  // W2.7: the openings editor - visibility follows the trade (wall-area
  // trades only), rows carry type + width x height + count, and the sum line
  // names the deducted area in the current unit system.
  function renderOpenings() {
    const wrap = $('calc-openings'),
      rowsEl = $('calc-openings-rows');
    if (!wrap || !rowsEl) {
      return;
    }
    const key = ($('calc-work') || {}).value || '';
    const w = WORK[key];
    if (!w || !w.openings) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    rowsEl.innerHTML = openRows
      .map(function (rw, i) {
        const opts = Object.keys(OPENING_TYPES)
          .map(function (k) {
            return (
              '<option value="' +
              k +
              '"' +
              (rw.type === k ? ' selected' : '') +
              '>' +
              OPENING_TYPES[k] +
              '</option>'
            );
          })
          .join('');
        return (
          '<div class="bcp-inst-row bcp-open-row">' +
          '<select class="bcp-open-type" data-idx="' +
          i +
          '" data-field="type" aria-label="Opening type">' +
          opts +
          '</select>' +
          '<input type="number" class="bcp-inst-dim" data-idx="' +
          i +
          '" data-field="w" min="0" step="any" inputmode="decimal" placeholder="Width (m)" value="' +
          esc(String(rw.w || '')) +
          '" aria-label="Opening width">' +
          '<input type="number" class="bcp-inst-dim" data-idx="' +
          i +
          '" data-field="h" min="0" step="any" inputmode="decimal" placeholder="Height (m)" value="' +
          esc(String(rw.h || '')) +
          '" aria-label="Opening height">' +
          '<input type="number" class="bcp-inst-count" data-idx="' +
          i +
          '" data-field="n" min="1" step="1" inputmode="numeric" value="' +
          esc(String(rw.n || 1)) +
          '" aria-label="How many identical">' +
          '<button type="button" class="btn btn-n btn-s" data-action="calcOpenDel" data-idx="' +
          i +
          '" aria-label="Remove this opening">X</button>' +
          '</div>'
        );
      })
      .join('');
    const a = openingsArea({ openings: JSON.stringify(openRows) }, _units === 'imperial');
    const sumEl = $('calc-open-sum');
    if (sumEl) {
      sumEl.textContent =
        a.count > 0
          ? 'Deducts ' +
            qtyShown(a.area, 'm2').main +
            ' across ' +
            a.count +
            ' opening' +
            (a.count === 1 ? '' : 's')
          : '';
    }
  }

  function activeSheetName() {
    const matEl = $('calc-rate-mat'),
      labEl = $('calc-rate-lab');
    if (!matEl || !labEl) {
      return null;
    }
    if (matEl.value === '' || labEl.value === '') {
      return null;
    }
    if (
      String(parseFloat(matEl.value)) === matEl.dataset.model ||
      String(parseFloat(labEl.value)) === labEl.dataset.model
    ) {
      return null;
    }
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
  function loadPrelims() {
    try {
      return JSON.parse(localStorage.getItem(PKEY) || '[]');
    } catch (e) {
      return [];
    }
  }
  function persistPrelims(list) {
    try {
      localStorage.setItem(PKEY, JSON.stringify(list.slice(0, 30)));
    } catch (e) {
      /* nicety, never a gate */
    }
  }
  // PURE: item amounts by basis. fixed = the amount; pct = % of works; week =
  // weekly rate x weeks. Negative inputs clamp to 0; bad numbers are 0.
  function prelimsTotal(items, works) {
    const perItem = [];
    let total = 0;
    (items || []).forEach(function (it) {
      const v = parseFloat(it.value);
      let amt = 0;
      if (it.basis === 'fixed' && isFinite(v)) {
        amt = v;
      } else if (it.basis === 'pct' && isFinite(v)) {
        amt = works > 0 ? (works * v) / 100 : 0;
      } else if (it.basis === 'week' && isFinite(v)) {
        const wks = parseFloat(it.weeks);
        amt = v * (isFinite(wks) && wks > 0 ? wks : 0);
      }
      if (!(amt > 0)) {
        amt = 0;
      }
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
    if (typeof worksOverride === 'number') {
      return worksOverride;
    }
    const lines = loadBoq();
    if (lines.length) {
      return boqTotals(lines).sub;
    }
    const r = computeFor(readState());
    return r && !r.error ? r.sub : 0;
  }
  function renderPrelims(worksOverride) {
    const wrap = $('calc-prelims-body'),
      totalEl = $('calc-prelims-total');
    if (!wrap) {
      return;
    }
    const works = prelimWorks(worksOverride);
    const t = prelimsTotal(prelimItems, works);
    const cur = works > 0 ? CURRENCY[lastResult && lastResult.currency] || '$' : '$';
    if (totalEl) {
      totalEl.textContent = prelimItems.length
        ? 'On top of the works (' +
          cur +
          Math.round(works).toLocaleString() +
          '): ' +
          cur +
          Math.round(t.total).toLocaleString()
        : '';
    }
    wrap.innerHTML = prelimItems.length
      ? prelimItems
          .map(function (it, i) {
            const amt = t.perItem[i] ? t.perItem[i].amount : 0;
            return (
              '<div class="bcp-prelim-row">' +
              '<input type="text" data-idx="' +
              i +
              '" data-field="name" value="' +
              esc(it.name) +
              '" aria-label="Item name">' +
              '<select data-idx="' +
              i +
              '" data-field="basis" aria-label="How this item is charged">' +
              '<option value="fixed"' +
              (it.basis === 'fixed' ? ' selected' : '') +
              '>Fixed amount</option>' +
              '<option value="pct"' +
              (it.basis === 'pct' ? ' selected' : '') +
              '>% of works</option>' +
              '<option value="week"' +
              (it.basis === 'week' ? ' selected' : '') +
              '>Weekly</option>' +
              '</select>' +
              '<input type="number" data-idx="' +
              i +
              '" data-field="value" min="0" step="any" inputmode="decimal" placeholder="' +
              (it.basis === 'pct' ? '%' : 'amount') +
              '" value="' +
              esc(it.value) +
              '" aria-label="Value">' +
              '<input type="number" data-idx="' +
              i +
              '" data-field="weeks" min="0" step="1" inputmode="numeric" placeholder="weeks" value="' +
              esc(it.weeks || '') +
              '"' +
              (it.basis === 'week' ? '' : ' hidden') +
              ' aria-label="Weeks">' +
              '<span class="bcp-prelim-amt">' +
              (CURRENCY[lastResult && lastResult.currency] || '$') +
              Math.round(amt).toLocaleString() +
              '</span>' +
              '<button type="button" class="btn btn-n btn-s" data-action="calcPrelimRemove" data-idx="' +
              i +
              '" aria-label="Remove this item">X</button>' +
              '</div>'
            );
          })
          .join('')
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
    if (key !== 'slab' && key !== 'concrete-drive' && key !== 'footings') {
      return null;
    }
    const a = parseFloat(d1),
      b = parseFloat(d2),
      c = parseFloat(d3);
    if (!(a > 0) || !(b > 0) || !(c > 0)) {
      return null;
    }
    const perimeter = 2 * (a + b);
    const height = c / 1000; // thickness/depth is always typed in mm
    return Math.round(perimeter * height * 100) / 100;
  }
  function renderAccessories() {
    const box = $('calc-formwork-box');
    if (!box) {
      return;
    }
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
      const msg =
        'Derived formwork for this ' +
        (st.work === 'footings' ? 'footing run' : 'slab') +
        ': ' +
        m2.toLocaleString() +
        ' m2 - about ' +
        cur +
        Math.round(m2 * rate).toLocaleString() +
        ' at ' +
        cur +
        rate +
        '/m2 (editable).';
      if (txt) {
        txt.textContent = msg;
      } else {
        box.textContent = msg;
      }
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
    {
      id: 'pack-us',
      name: 'United States (baseline)',
      currency: 'USD',
      taxDefault: 0,
      index: 1,
      benchmark:
        'Baseline - rates as entered. US averages vary widely by state; sanity-check your bill by area x local benchmark.'
    },
    {
      id: 'pack-jm',
      name: 'Jamaica',
      currency: 'JMD',
      taxDefault: 15,
      index: 1,
      benchmark:
        'GCT 15% on the works (PwC). Planning guidance: standard-spec residential builds have recently ranged roughly US$65-121 per sq ft - check your bill total against floor area x benchmark.'
    },
    {
      id: 'pack-gb',
      name: 'United Kingdom',
      currency: 'GBP',
      taxDefault: 20,
      index: 1,
      benchmark: 'VAT 20% applies on the works (PwC). Rates as entered.'
    }
  ];
  function loadPacks() {
    try {
      return JSON.parse(localStorage.getItem(PKKEY) || '[]');
    } catch (e) {
      return [];
    }
  }
  function persistPacks(list) {
    try {
      localStorage.setItem(PKKEY, JSON.stringify(list.slice(0, 20)));
    } catch (e) {
      /* nicety */
    }
    wsStampNow('packs');
    scheduleWsPut();
  }
  function ensurePackSeeds() {
    if (!loadPacks().length) {
      persistPacks(PACK_SEEDS.slice());
    }
  }
  function renderPacks() {
    const sel = $('calc-pack-select'),
      note = $('calc-pack-note');
    if (!sel) {
      return;
    }
    const list = loadPacks();
    sel.innerHTML =
      '<option value="">Location pack' +
      (list.length ? '...' : ' (none yet)') +
      '</option>' +
      list
        .map(function (p) {
          return '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>';
        })
        .join('');
    if (note && note.dataset.forId) {
      const p = list.find(function (x) {
        return x.id === note.dataset.forId;
      });
      note.hidden = !p;
      if (p) {
        note.textContent = p.benchmark || '';
      }
    }
  }
  function applyPackById(id) {
    const p = loadPacks().find(function (x) {
      return x.id === id;
    });
    if (!p) {
      return;
    }
    if ($('calc-currency') && p.currency) {
      $('calc-currency').value = p.currency;
    }
    if ($('calc-tax-override') && p.taxDefault != null && p.taxDefault !== '') {
      $('calc-tax-override').value = String(p.taxDefault);
    }
    const mat = $('calc-rate-mat');
    if (p.index && p.index !== 1 && mat && mat.value) {
      const v = parseFloat(mat.value);
      if (isFinite(v)) {
        mat.value = String(Math.round(v * p.index * 100) / 100);
      }
    }
    const note = $('calc-pack-note');
    if (note) {
      note.dataset.forId = p.id;
      note.hidden = !p.benchmark;
      note.textContent = p.benchmark || '';
    }
    render();
  }
  // Export every pack as JSON; import merges by name (invalid entries skipped).
  function importPacks(json) {
    if (!json || !Array.isArray(json.packs)) {
      return null;
    }
    const existing = loadPacks();
    let merged = 0,
      skipped = 0;
    json.packs.forEach(function (item) {
      const name = item && typeof item.name === 'string' ? item.name.trim().slice(0, 40) : '';
      const idx = parseFloat(item && item.index);
      const td = parseFloat(item && item.taxDefault);
      if (!name || !item.currency) {
        skipped++;
        return;
      }
      const pack = {
        id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), // ok: non-secret
        name: name,
        currency: String(item.currency).toUpperCase().slice(0, 3),
        taxDefault: isFinite(td) && td >= 0 ? td : 0,
        index: isFinite(idx) && idx > 0 ? idx : 1,
        benchmark: typeof item.benchmark === 'string' ? item.benchmark.slice(0, 300) : ''
      };
      const at = existing.findIndex(function (x) {
        return (x.name || '').toLowerCase() === name.toLowerCase();
      });
      if (at > -1) {
        existing[at] = pack;
      } else {
        existing.unshift(pack);
      }
      merged++;
    });
    if (merged) {
      persistPacks(existing);
      renderPacks();
    }
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
  function loadRollupPrefs() {
    try {
      return JSON.parse(localStorage.getItem(RKEY2) || '{}');
    } catch (e) {
      return {};
    }
  }
  function persistRollupPrefs(p) {
    try {
      localStorage.setItem(RKEY2, JSON.stringify(p));
    } catch (e) {
      /* nicety */
    }
    wsStampNow('rollup');
    scheduleWsPut();
  }
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
    const discount = Math.min(pool, amt > 0 ? amt : (pool * pct) / 100);
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
    const designC = (base * Math.max(0, parseFloat(o.designC) || 0)) / 100;
    const constrC = (base * Math.max(0, parseFloat(o.constrC) || 0)) / 100;
    const escPct = Math.max(0, parseFloat(o.escPct) || 0);
    const months = Math.max(0, parseFloat(o.months) || 0);
    const esc = base * (escPct / 100) * (months / 12);
    const subtotal = base + designC + constrC + esc;
    return {
      works: works,
      prelims: prelims,
      discount: d.discount,
      base: base,
      designC: designC,
      constrC: constrC,
      escPct: escPct,
      months: months,
      esc: esc,
      subtotal: subtotal
    };
  }
  function rollupPrefs() {
    const p = loadRollupPrefs();
    return {
      designC:
        ($('calc-design-c') || {}).value != null && $('calc-design-c')
          ? $('calc-design-c').value
          : p.designC != null
            ? p.designC
            : '10',
      constrC: $('calc-constr-c') ? $('calc-constr-c').value : p.constrC != null ? p.constrC : '5',
      escPct: $('calc-esc-pct') ? $('calc-esc-pct').value : p.escPct != null ? p.escPct : '5',
      months: $('calc-months') ? $('calc-months').value : p.months != null ? p.months : '',
      discPct: $('calc-disc-pct') ? $('calc-disc-pct').value : p.discPct != null ? p.discPct : '',
      discAmt: $('calc-disc-amt') ? $('calc-disc-amt').value : p.discAmt != null ? p.discAmt : ''
    };
  }
  function renderRollup() {
    const body = $('calc-rollup-body');
    if (!body) {
      return;
    }
    const works = prelimWorks();
    if (!(works > 0)) {
      body.innerHTML = '';
      return;
    }
    const pref = rollupPrefs();
    const r = rollup({
      works: works,
      prelims: prelimsTotal(prelimItems, works).total,
      designC: pref.designC,
      constrC: pref.constrC,
      escPct: pref.escPct,
      months: pref.months,
      discPct: pref.discPct,
      discAmt: pref.discAmt
    });
    const cur = CURRENCY[lastResult && lastResult.currency] || '$';
    const line = function (label, val) {
      return (
        '<div class="calc-line"><span>' +
        label +
        '</span><strong>' +
        cur +
        Math.round(val).toLocaleString() +
        '</strong></div>'
      );
    };
    body.innerHTML =
      line('Works (the priced bill)', r.works) +
      line('Site &amp; other costs', r.prelims) +
      (r.discount > 0
        ? line(
            'Discount' +
              ((parseFloat(pref.discPct) || 0) > 0 && !(parseFloat(pref.discAmt) > 0)
                ? ' (' + pref.discPct + '% off)'
                : '') +
              (parseFloat(pref.discAmt) > 0 ? ' (amount off)' : ''),
            -r.discount
          )
        : '') +
      line('Design contingency (' + (parseFloat(pref.designC) || 0) + '%)', r.designC) +
      line('Construction contingency (' + (parseFloat(pref.constrC) || 0) + '%)', r.constrC) +
      (r.esc > 0
        ? line('Escalation (' + r.escPct + '%/yr over ' + r.months + ' months)', r.esc)
        : '') +
      '<div class="calc-line calc-line-total"><span>Planning subtotal (before tax)</span><strong>' +
      cur +
      Math.round(r.subtotal).toLocaleString() +
      '</strong></div>';
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
      const sigma =
        m / (isFinite(parseFloat(steep)) && parseFloat(steep) > 0 ? parseFloat(steep) : 3.2);
      const mid = (m - 1) / 2;
      const bell = [];
      let sum = 0;
      for (let i = 0; i < m; i++) {
        const w = Math.exp(-Math.pow(i - mid, 2) / (2 * sigma * sigma));
        bell.push(w);
        sum += w;
      }
      for (let i = 0; i < m; i++) {
        per.push((T * bell[i]) / sum);
      }
    } else {
      for (let i = 0; i < m; i++) {
        per.push(T / m);
      }
    }
    const cum = [];
    let run = 0;
    for (let i = 0; i < m; i++) {
      run += per[i];
      cum.push(run);
    }
    return { per: per, cum: cum };
  }
  function renderCash() {
    const body = $('calc-cash-body');
    if (!body) {
      return;
    }
    const months = parseInt(($('calc-months') || {}).value, 10);
    const mode = ($('calc-cash-mode') || {}).value || 'scurve';
    if (!(months > 0)) {
      body.innerHTML =
        '<div class="calc-empty">Set the build duration above to see the monthly cash plan.</div>';
      return;
    }
    const works = prelimWorks();
    const pref = rollupPrefs();
    const r = rollup({
      works: works,
      prelims: prelimsTotal(prelimItems, works).total,
      designC: pref.designC,
      constrC: pref.constrC,
      escPct: pref.escPct,
      months: months,
      discPct: pref.discPct,
      discAmt: pref.discAmt
    });
    const c = cashCurve(r.subtotal, months, mode, '3.2');
    const cur = CURRENCY[lastResult && lastResult.currency] || '$';
    let rows = '';
    for (let i = 0; i < c.per.length; i++) {
      rows +=
        '<div class="calc-line"><span>Month ' +
        (i + 1) +
        '</span><strong>' +
        cur +
        Math.round(c.per[i]).toLocaleString() +
        ' <span class="bcp-hist-note">(cum ' +
        cur +
        Math.round(c.cum[i]).toLocaleString() +
        ')</span></strong></div>';
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
      const opt = Array.prototype.slice.call(sel.options || []).find(function (o) {
        return o.value === key;
      });
      if (opt) {
        return opt.textContent.trim();
      }
    }
    return key;
  }
  function loadBoq() {
    try {
      return JSON.parse(localStorage.getItem(BKEY2) || '[]');
    } catch (e) {
      return [];
    }
  }
  function persistBoq(lines) {
    try {
      localStorage.setItem(BKEY2, JSON.stringify(lines.slice(0, 60)));
    } catch (e) {
      /* nicety, never a gate */
    }
    wsStampNow('boq');
    scheduleWsPut();
  }
  // PURE: per-line priced rows + rolled-up totals. No DOM. Shared by render,
  // the cash-flow wave and the CSV export.
  function boqTotals(lines) {
    const perLine = [];
    let mat = 0,
      lab = 0;
    (lines || []).forEach(function (line) {
      const r = computeFor(line.st || {});
      if (!r || r.error) {
        return;
      }
      mat += r.mat;
      lab += r.lab;
      perLine.push({
        name: line.name || workLabel(r.key),
        qty: qtyShown(r.qty, r.unit).main,
        unit: r.unit,
        mat: r.mat,
        lab: r.lab,
        total: r.total,
        currency: r.currency
      });
    });
    return { perLine: perLine, mat: mat, lab: lab, sub: mat + lab };
  }
  function renderBoq() {
    const wrap = $('calc-boq-body'),
      card = $('calc-boq-card'),
      total = $('calc-boq-total');
    if (!wrap) {
      return;
    }
    const lines = loadBoq();
    if (card) {
      card.hidden = lines.length === 0 && !$('calc-boq-open');
    }
    const t = boqTotals(lines);
    if (total) {
      total.textContent = lines.length
        ? 'Bill total: ' +
          (CURRENCY[t.perLine[0].currency] || '$') +
          Math.round(t.sub).toLocaleString() +
          ' across ' +
          lines.length +
          ' line' +
          (lines.length === 1 ? '' : 's')
        : '';
    }
    renderLint(lines);
    wrap.innerHTML = lines.length
      ? lines
          .map(function (line, i) {
            const st0 = line.st || {};
            const r = computeFor(st0);
            const money =
              r && !r.error
                ? (CURRENCY[r.currency] || '$') + Math.round(r.total).toLocaleString()
                : 'check settings';
            const qty = r && !r.error ? qtyShown(r.qty, r.unit).main : '';
            // B1: a CUSTOM line must also carry its rate on the bill, so the
            // row reads name, quantity with the user's unit, rate and total.
            // Every other work item keeps its exact old shape.
            let meta = qty + ' - ' + money;
            if (
              r &&
              !r.error &&
              st0.work === 'custom' &&
              isFinite(r.allInRate) &&
              r.allInRate > 0
            ) {
              meta =
                qty +
                ' x ' +
                (CURRENCY[r.currency] || '$') +
                Math.round(r.allInRate).toLocaleString() +
                ' - ' +
                money;
            }
            return (
              '<div class="bcp-est-row bcp-boq-line">' +
              '<span class="bcp-est-name">' +
              esc(line.name || workLabel((line.st || {}).work)) +
              '</span>' +
              '<span class="bcp-est-meta">' +
              esc(meta) +
              '</span>' +
              '<button type="button" class="btn btn-n btn-s" data-action="calcBoqRecall" data-idx="' +
              i +
              '">Edit</button>' +
              '<button type="button" class="btn btn-n btn-s" data-action="calcBoqRemove" data-idx="' +
              i +
              '" aria-label="Remove this line from the bill">X</button>' +
              '</div>'
            );
          })
          .join('')
      : '<div class="calc-empty">No lines yet. Price something above, then Add to bill.</div>';
  }

  // X1: the check-your-bill block - one row per forgotten-work flag, with a
  // one-tap fix where the quantity can be derived from the bill itself.
  function renderLint(lines) {
    const box = $('calc-lint');
    if (!box) {
      return;
    }
    const flags = billLint(lines);
    if (!flags.length) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    box.hidden = false;
    box.innerHTML =
      '<div class="bcp-cp-title">Check your bill</div>' +
      flags
        .map(function (f) {
          return (
            '<div class="bcp-est-row"><span class="bcp-est-name">' +
            esc(f.msg) +
            '</span>' +
            (f.fix
              ? '<button type="button" class="btn btn-n btn-s" data-action="calcLintFix" data-fix="' +
                esc(f.fix.work) +
                '">' +
                esc(f.fix.label) +
                '</button>'
              : '') +
            '</div>'
          );
        })
        .join('');
  }

  function renderSheets() {
    const wrap = $('calc-sheets');
    const sel = $('calc-sheet-select');
    if (!wrap || !sel) {
      return;
    }
    const list = loadSheets();
    sel.innerHTML =
      '<option value="">Saved rate sheets' +
      (list.length ? '...' : ' (none yet)') +
      '</option>' +
      list
        .map(function (sh) {
          return '<option value="' + esc(sh.id) + '">' + esc(sh.name) + '</option>';
        })
        .join('');
    const act = activeSheetName();
    wrap.innerHTML = list.length
      ? list
          .map(function (sh) {
            return (
              '<div class="bcp-sheet-row">' +
              '<span class="bcp-est-name">' +
              esc(sh.name) +
              '</span>' +
              '<span class="bcp-est-meta">mat ' +
              esc(sh.rates.rateMat) +
              ' / lab ' +
              esc(sh.rates.rateLab) +
              (sh.rates.piecePrice ? ' / piece ' + esc(sh.rates.piecePrice) : '') +
              '</span>' +
              '<button type="button" class="btn btn-n btn-s" data-action="calcSheetApply" data-id="' +
              esc(sh.id) +
              '">Apply</button>' +
              '<button type="button" class="btn btn-n btn-s" data-action="calcSheetDelete" data-id="' +
              esc(sh.id) +
              '">Delete</button>' +
              '</div>'
            );
          })
          .join('')
      : '<div class="calc-empty">No saved rate sheets yet. Set your rates above, then Save rate sheet.</div>';
  }

  function renderEstimates() {
    const wrap = $('calc-estimates');
    if (!wrap) {
      return;
    }
    const list = loadEstimates();
    if (!list.length) {
      wrap.innerHTML =
        '<div class="calc-empty">No saved estimates yet. Price something, then Save it with a name.</div>';
      return;
    }
    wrap.innerHTML = list
      .map(function (est) {
        // D2: leading checkbox opts a saved estimate into the comparison table.
        return (
          '<div class="bcp-est-row">' +
          '<input type="checkbox" class="bcp-cmp-check" data-cmp-id="' +
          esc(est.id) +
          '" aria-label="Select ' +
          esc(est.name) +
          ' for comparison">' +
          '<span class="bcp-est-name">' +
          esc(est.name) +
          '</span>' +
          '<span class="bcp-est-meta">' +
          esc(est.at) +
          ' - ' +
          esc(est.total) +
          '</span>' +
          '<button type="button" class="btn btn-n btn-s" data-action="calcOpen" data-id="' +
          esc(est.id) +
          '">Open</button>' +
          '<button type="button" class="btn btn-n btn-s" data-action="calcDeleteEst" data-id="' +
          esc(est.id) +
          '">Delete</button>' +
          '</div>'
        );
      })
      .join('');
  }

  // ---- D2 (owner review 2026-09-29): side-by-side comparison of saved ------
  // estimates (Economy vs Standard vs Premium for the same dimensions). The
  // table recomputes each saved settings state through the SAME pure engine
  // as the live form, so a compared total always equals a recalled total.
  function renderCompare() {
    const wrap = $('calc-compare'),
      card = $('calc-compare-card');
    if (!wrap || !card) {
      return;
    }
    const ids = Array.prototype.slice
      .call(document.querySelectorAll('.bcp-cmp-check:checked'))
      .map(function (c) {
        return c.getAttribute('data-cmp-id');
      });
    if (ids.length < 2) {
      sheetMsg('Tick at least two saved estimates to compare.');
      return;
    }
    const cols = ids
      .slice(0, 4)
      .map(function (id) {
        const est = loadEstimates().find(function (x) {
          return x.id === id;
        });
        if (!est) {
          return null;
        }
        const r = computeFor(est.st || {});
        return r && !r.error ? { name: est.name, r: r } : null;
      })
      .filter(Boolean);
    if (cols.length < 2) {
      sheetMsg('Those estimates could not be recomputed - open one to check its settings.');
      return;
    }
    const money = function (v, cur) {
      return (CURRENCY[cur] || '$') + Math.round(v).toLocaleString();
    };
    const best = Math.min.apply(
      null,
      cols.map(function (c) {
        return c.r.total;
      })
    );
    const rows = [
      [
        'Work item',
        function (c) {
          return esc(c.r.key);
        }
      ],
      [
        'Quantity',
        function (c) {
          return esc(qtyShown(c.r.qty, c.r.unit).main);
        }
      ],
      // D3: for an all-in column these two say the money is inside the combined
      // figure - they never print a split that was invented from one number.
      [
        'Materials',
        function (c) {
          return c.r.allIn ? ALLIN_INCLUDED : money(c.r.mat, c.r.currency);
        }
      ],
      [
        'Labor',
        function (c) {
          return c.r.allIn ? ALLIN_INCLUDED : money(c.r.lab, c.r.currency);
        }
      ],
      // D2: the day basis shows ONE labour total; the note carries the days and
      // the rate per day so the number is checkable, never itemised per person.
      [
        'Labor basis',
        function (c) {
          return c.r.dayBasis ? esc(dayBasisNote(c.r)) : '-';
        }
      ],
      [
        'Work rate (all-in)',
        function (c) {
          return c.r.allIn ? '<strong>' + money(c.r.allInCost, c.r.currency) + '</strong>' : '-';
        }
      ],
      [
        'Equipment',
        function (c) {
          return c.r.eq > 0 ? money(c.r.eq, c.r.currency) : '-';
        }
      ],
      [
        'Overhead',
        function (c) {
          return c.r.oh > 0 ? money(c.r.oh, c.r.currency) : '-';
        }
      ],
      [
        'Subtotal',
        function (c) {
          return money(c.r.sub, c.r.currency);
        }
      ],
      [
        'Tax',
        function (c) {
          return money(c.r.tax, c.r.currency);
        }
      ],
      [
        'Estimated total',
        function (c) {
          const bestCell = c.r.total === best ? ' class="bcp-cmp-best"' : '';
          return '<strong' + bestCell + '>' + money(c.r.total, c.r.currency) + '</strong>';
        }
      ]
    ];
    wrap.innerHTML =
      '<div class="bcp-cmp-wrap"><table><thead><tr><th scope="row"></th>' +
      cols
        .map(function (c) {
          return '<th scope="col">' + esc(c.name) + '</th>';
        })
        .join('') +
      '</tr></thead><tbody>' +
      rows
        .map(function (rowDef) {
          return (
            '<tr><th scope="row">' +
            rowDef[0] + // ok: row labels are string literals in the rows definition table
            '</th>' +
            cols
              .map(function (c) {
                return '<td>' + rowDef[1](c) + '</td>'; // ok: each cell formatter renders money()/escaped text
              })
              .join('') +
            '</tr>'
          );
        })
        .join('') +
      '</tbody></table></div>';
    card.hidden = false;
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---- Export (F4-2): print + CSV of the live breakdown -------------------
  // C4 (audit 2026-10-18): ONE flat schema for machines, and a real spreadsheet
  // for people. The old export mixed 2- and 3-column rows with blank spacer
  // rows, so Excel opened it as a mess and no reader could sum a column. Every
  // row now carries the same eight fields, numbers are plain numerics (no
  // thousands separators, no units inside the number cell), and dates are ISO.
  var CSV_COLS = ['section', 'item', 'detail', 'quantity', 'unit', 'rate', 'amount', 'currency'];

  function num2(v) {
    if (v === null || v === undefined || v === '' || !isFinite(Number(v))) {
      return '';
    }
    return Number(v).toFixed(2);
  }

  // The one source of truth for both exports. A row is
  // [section, item, detail, quantity, unit, rate, amount, currency].
  function exportRows(r) {
    var rows = [];
    var add = function (section, item, detail, qty, unit, rate, amount) {
      rows.push([section, item, detail, qty, unit, rate, amount, r.currency]);
    };
    var qty = r.qty;

    add('Document', 'Title', docTitleBase(), '', '', '', '');
    add('Document', 'Type', docType(), '', '', '', '');
    add('Document', 'Date', new Date().toISOString().slice(0, 10), '', '', '', '');
    add('Document', 'Document no', ($('calc-doc-no') || {}).value || '', '', '', '', '');
    add('Document', 'Client', ($('calc-client-name') || {}).value || '', '', '', '', '');
    add('Document', 'Project address', ($('calc-client-addr') || {}).value || '', '', '', '', '');
    add('Document', 'Business', bizName(), '', '', '', '');

    // ---- cost breakdown, in the order the money is built -------------------
    // C3: items, subtotal BEFORE overhead, overhead, subtotal AFTER, tax, total.
    // The old export printed "Subtotal" after the overhead row while carrying
    // the pre-overhead figure, so a reader adding down was 80,250 short.
    if (r.allIn) {
      add(
        'Cost',
        ALLIN_ROW_LABEL,
        r.runit ? 'per ' + r.runit : '',
        num2(qty),
        r.unit,
        num2(r.allInRate),
        num2(r.allInCost)
      );
    } else {
      add(
        'Cost',
        'Materials',
        r.matExcluded ? 'excluded (labour only)' : r.matDesc || '',
        num2(qty),
        r.unit,
        num2(r.mr),
        num2(r.mat)
      );
      add(
        'Cost',
        'Labor',
        r.dayBasis ? dayBasisNote(r) : '',
        num2(qty),
        r.unit,
        num2(r.lr),
        num2(r.lab)
      );
    }
    if (r.onCost > 0) {
      add('Cost', 'Labor statutory costs', r.onCostPct + '%', '', '', '', num2(r.onCost));
    }
    if (r.eq > 0) {
      add('Cost', 'Equipment / plant hire', '', num2(qty), r.unit, num2(r.eqRate), num2(r.eq));
    }
    add('Cost', 'Subtotal (before overhead and margin)', '', '', '', '', num2(r.sub));
    if (r.ohPct > 0) {
      add('Cost', 'Overhead & margin', r.ohPct + '%', '', '', '', num2(r.oh));
      add('Cost', 'Subtotal after overhead', '', '', '', '', num2(r.sub + r.oh));
    }
    add(
      'Cost',
      r.noTax ? 'No tax on this job' : 'Tax',
      r.noTax ? 'this job is not taxed' : r.taxRate + '%',
      '',
      '',
      '',
      num2(r.tax)
    );
    add('Total', 'ESTIMATED TOTAL', '', '', '', '', num2(r.total));

    // ---- assumptions -------------------------------------------------------
    var qtyShownRow = qtyShown(r.qty, r.unit);
    var countryEl = ($('calc-country') || {}).value || '';
    add('Assumption', 'Work item', r.name, '', '', '', '');
    add('Assumption', 'Quantity', qtyShownRow.main + qtyShownRow.alt, num2(qty), r.unit, '', '');
    add('Assumption', 'Rate basis', r.matDesc || '', '', '', '', '');
    add('Assumption', 'Variant', r.variantLabel || '-', '', '', '', '');
    add(
      'Assumption',
      'Country / tax',
      countryEl === 'NONE'
        ? 'No tax on this job'
        : countryEl + (r.noTax ? '' : ' at ' + r.taxRate + '%'),
      '',
      '',
      '',
      ''
    );
    add(
      'Assumption',
      'Finish level',
      ($('calc-quality') || {}).value || 'standard',
      '',
      '',
      '',
      ''
    );
    add('Assumption', 'Units entered', _units, '', '', '', '');
    add('Assumption', 'Waste allowance', r.hasWaste ? r.wastePct + '%' : 'none', '', '', '', '');
    add(
      'Assumption',
      'Openings deducted',
      r.hasOpenings && r.openings && r.openings.count
        ? r.openings.count + ' (' + r.openings.area + ' m2)'
        : 'none',
      '',
      '',
      '',
      ''
    );
    add(
      'Assumption',
      'Order quantity',
      r.orderCount
        ? r.orderCount.n.toLocaleString() + ' ' + r.orderCount.lbl + ' at ' + r.orderCount.sizeTxt
        : '-',
      '',
      '',
      '',
      ''
    );
    add(
      'Assumption',
      'Material rate used',
      r.allIn
        ? ALLIN_INCLUDED
        : r.piece
          ? Math.round(r.effMat * 100) / 100 + ' per m2 (from piece pricing)'
          : Math.round(r.mr),
      '',
      '',
      '',
      ''
    );
    add(
      'Assumption',
      'Labor rate used',
      r.allIn ? ALLIN_INCLUDED : Math.round(r.lr),
      '',
      '',
      '',
      ''
    );
    add('Assumption', 'Days on site', r.dayBasis ? r.days : '-', '', '', '', '');
    add(
      'Assumption',
      'Crew rate per day',
      r.dayBasis ? Math.round(r.dayRate) : '-',
      '',
      '',
      '',
      ''
    );
    add(
      'Assumption',
      'All-in rate used',
      r.allIn
        ? (r.runit ? 'per ' + r.runit + ' - ' : '') +
            Math.round(r.allInRate) +
            (r.allInOverridden ? ' (your rate)' : r.bookFilled ? ' (JIC rate book)' : '')
        : '-',
      '',
      '',
      '',
      ''
    );
    add('Assumption', 'Piece pricing', pieceNote(r), '', '', '', '');
    add(
      'Assumption',
      'Labor statutory costs %',
      r.onCostPct > 0 ? r.onCostPct : 'none',
      '',
      '',
      '',
      ''
    );
    add('Assumption', 'Equipment rate used', r.eqRate > 0 ? r.eqRate : 'none', '', '', '', '');
    add('Assumption', 'Overhead & margin %', r.ohPct > 0 ? r.ohPct : 'none', '', '', '', '');
    add('Assumption', 'Currency', r.currency, '', '', '', '');
    add(
      'Assumption',
      'Exchange rate',
      r.currency === BASE_CURRENCY ? 'not needed (base currency)' : 'see Exchange rates card',
      '',
      '',
      '',
      ''
    );
    add('Assumption', 'Planning note', 'Planning-grade estimate - not a quote.', '', '', '', '');

    // ---- bill of quantities -------------------------------------------------
    if (r.bill && r.bill.length) {
      (Array.isArray(r.bill) ? r.bill : []).forEach(function (ln) {
        add('Bill', ln.name || '', ln.qtyLabel || '', '', '', '', num2(ln.total));
      });
    }

    // ---- roll-up (works + site costs, less discount) -----------------------
    // C3: rollup() never carried overhead, margin or tax. The maths is right
    // and stays; the row says what it is so it cannot read as a second total.
    var roll = rollup({
      works: prelimWorks(),
      prelims: prelimsTotal(prelimItems, prelimWorks()).total,
      designC: '0',
      constrC: '0',
      escPct: '0',
      months: '0',
      discPct: rollupPrefs().discPct,
      discAmt: rollupPrefs().discAmt
    });
    add(
      'Roll-up',
      'Bill + site costs, less discount (before overhead and margin)',
      'discount ' + (rollupPrefs().discPct || '0') + '% / ' + (rollupPrefs().discAmt || '0'),
      '',
      '',
      '',
      num2(roll.subtotal)
    );
    return rows;
  }

  function csvCell(v) {
    var s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // C4: numbers stay bare so a spreadsheet reads them as numbers; every TEXT
  // cell is quoted, which keeps a label with a comma or a bracket intact.
  function csvQuote(v) {
    if (v === null || v === undefined || v === '') {
      return '';
    }
    // Every value is quoted: a machine reader (csv/pandas) is unaffected, and a
    // reader that greps the file for a label plus its figure still finds them
    // side by side. The figures carry no separators and no units.
    return '"' + String(v).split('"').join('""') + '"';
  }

  // The piece-pricing sentence, kept verbatim from the pre-C4 export so the
  // document says HOW a per-piece figure became a per-area rate.
  function pieceNote(r) {
    if (!r.piece || r.piece.countOnly) {
      return 'no';
    }
    var per = Math.round(r.piece.perUnit * 100) / 100;
    if (r.piece.div === 'volume') {
      return (
        r.piece.price + ' per ' + r.piece.w + ' L yield (per ' + per + '/' + r.piece.qtyUnit + ')'
      );
    }
    return (
      r.piece.price +
      ' per ' +
      Math.round(r.piece.w) +
      ' x ' +
      Math.round(r.piece.l) +
      ' ' +
      r.piece.unit +
      (r.piece.div === 'width' ? ' (per ' + per + '/m)' : ' (per ' + per + '/m2)')
    );
  }

  function estimateCsv(r) {
    var rows = exportRows(r);
    return (
      '\uFEFF' +
      CSV_COLS.join(',') +
      '\r\n' +
      rows
        .map(function (row) {
          return row.map(csvQuote).join(',');
        })
        .join('\r\n') +
      '\r\n'
    );
  }

  // ---- C4: the spreadsheet ------------------------------------------------
  // Four sheets with real number formats and a frozen header row. The writer is
  // vendored (js/xlsx-lite.js): the CSP is script-src 'self', so no CDN.
  function xlsxSheets(r) {
    var rows = exportRows(r);
    var bySection = function (name) {
      return rows.filter(function (row) {
        return row[0] === name;
      });
    };
    var moneyRow = function (row) {
      return [row[1], row[2], row[6] === '' ? '' : Number(row[6])];
    };

    var summary = [
      ['My MaNaGeR estimate', ''],
      ['Document', docTitleBase()],
      ['Type', docType()],
      ['Work item', r.name],
      ['Currency', r.currency],
      ['Quantity', r.qty],
      ['Unit', r.unit]
    ];
    bySection('Cost')
      .concat(bySection('Total'))
      .forEach(function (row) {
        summary.push([row[1], row[6] === '' ? row[2] : Number(row[6])]);
      });
    summary.push(['Planning-grade estimate - not a quote.', '']);

    var breakdown = [['Line', 'Detail', 'Amount']].concat(
      bySection('Cost').concat(bySection('Total')).map(moneyRow)
    );
    var assumptions = [['Setting', 'Value']].concat(
      bySection('Assumption').map(function (row) {
        return [row[1], row[2] || row[3]];
      })
    );
    var bill = [['Section', 'Item', 'Detail', 'Amount']].concat(
      bySection('Bill').map(function (row) {
        return [row[0], row[1], row[2], row[3] === '' ? '' : Number(row[6])];
      })
    );

    return [
      { name: 'Summary', rows: summary, widths: [44, 22], money: [1], bold: [0] },
      { name: 'Cost breakdown', rows: breakdown, widths: [40, 26, 18], money: [2], bold: [0] },
      { name: 'Assumptions', rows: assumptions, widths: [26, 52], bold: [0] },
      { name: 'Bill of quantities', rows: bill, widths: [12, 44, 30, 18], money: [3], bold: [0] }
    ];
  }

  function buildXlsx(proposal) {
    var res = proposal ? previewProposal(proposal) : lastResult;
    if (!res) {
      return { ok: false, reason: 'nothing priced' };
    }
    var lib = window.MMGR && window.MMGR.XlsxLite;
    if (!lib || typeof lib.build !== 'function') {
      return { ok: false, reason: 'the spreadsheet writer did not load' };
    }
    var bytes = lib.build(xlsxSheets(res));
    return {
      ok: true,
      name: slug(docTitleBase()) + '-' + new Date().toISOString().slice(0, 10) + '.xlsx',
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      bytes: bytes
    };
  }

  function slug(s) {
    return (
      String(s || 'estimate')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'estimate'
    );
  }

  // ---- OWNER 2026-09-30: export naming (document type + title) -----------
  // The type becomes the printed sheet's title; type + title + date form
  // the export filename. Empty title falls back to the estimate name, then
  // the work item name. Illegal filename characters are stripped.
  function docType() {
    return ($('calc-doc-type') || {}).value || 'Estimate';
  }
  function docTitleRaw() {
    return (($('calc-doc-title') || {}).value || '').trim();
  }
  function docTitleBase() {
    const base = (
      docTitleRaw() ||
      (($('calc-save-name') || {}).value || '').trim() ||
      (lastResult && lastResult.name) ||
      'estimate'
    )
      .replace(/[\\/:*?"<>|]/g, '')
      .trim();
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
    setPlan: function (p) {
      this._plan = typeof p === 'string' && p ? p : 'free';
    },
    plan: function () {
      return this._plan;
    },
    can: function (feature) {
      return !!CALC_FEATURES[feature];
    }
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
  let wsPutTimer = null,
    wsPutNoLogo = false,
    wsSignedOut = false,
    wsInFlight = false,
    wsMerging = false;
  function wsStampsLoad() {
    try {
      const v = JSON.parse(localStorage.getItem(WSTAMPS_KEY) || '{}');
      return v && typeof v === 'object' ? v : {};
    } catch (e) {
      return {};
    }
  }
  function wsStampNow(section) {
    const s = wsStampsLoad();
    s[section] = Date.now();
    try {
      localStorage.setItem(WSTAMPS_KEY, JSON.stringify(s));
    } catch (e) {
      /* nicety */
    }
    return s[section];
  }
  // Every persist path calls this (after its localStorage write) so a signed-in
  // device pushes its workspace without any user action.
  function scheduleWsPut() {
    if (wsSignedOut || wsMerging) {
      return;
    }
    if (wsPutTimer) {
      clearTimeout(wsPutTimer);
    }
    wsPutTimer = setTimeout(wsPut, WS_DEBOUNCE_MS);
  }
  // Pure-ish collector: the seven synced sections with their stamps.
  function wsCollect() {
    const stamps = wsStampsLoad();
    const sec = function (section, val) {
      return { val: val, updatedAt: stamps[section] || 0 };
    };
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
    if (!cloudVal || typeof cloudVal !== 'object') {
      return localVal;
    }
    if (
      localVal === null ||
      localVal === undefined ||
      (typeof localVal === 'object' &&
        !Array.isArray(localVal) &&
        Object.keys(localVal).length === 0) ||
      (Array.isArray(localVal) && localVal.length === 0)
    ) {
      return cloudVal;
    }
    return (cloudStamp || 0) > (localStamp || 0) ? cloudVal : localVal;
  }
  // Pure application of a probe payload: sets the plan, merges each section
  // into localStorage, returns what happened (no network, no rendering).
  function wsApplyProbe(data) {
    if (!data || typeof data !== 'object') {
      return { ok: false };
    }
    Entitlements.setPlan(data.plan);
    const ws = data.ws;
    if (!ws || typeof ws !== 'object') {
      return { ok: true, merged: [] };
    }
    const stamps = wsStampsLoad();
    const merged = [];
    // Applying a cloud section routes through the persist helpers, which stamp
    // + schedule a push of their own - suppressed here so adopting cloud data
    // never immediately bounces back to the server.
    wsMerging = true;
    const sections = [
      [
        'estimates',
        ws.estimates,
        function (v) {
          persistEstimates(v);
        }
      ],
      [
        'boq',
        ws.boq,
        function (v) {
          persistBoq(v);
          renderBoq();
        }
      ],
      [
        'history',
        ws.history,
        function (v) {
          try {
            localStorage.setItem(HKEY, JSON.stringify((v || []).slice(0, 20)));
          } catch (e) {}
          renderHistory();
        }
      ],
      [
        'packs',
        ws.packs,
        function (v) {
          persistPacks(v);
          renderPacks();
        }
      ],
      [
        'rollup',
        ws.rollup,
        function (v) {
          persistRollupPrefs(v);
          renderRollup();
        }
      ],
      [
        'brand',
        ws.brand,
        function (v) {
          try {
            localStorage.setItem(BRKEY, JSON.stringify(v));
          } catch (e) {}
          renderBrand();
        }
      ],
      [
        'sheets',
        ws.sheets,
        function (v) {
          persistSheets(v);
          renderSheets();
        }
      ],
      [
        'docCounter',
        ws.docCounter,
        function (v) {
          try {
            localStorage.setItem(DOCNO_KEY, JSON.stringify(v));
          } catch (e) {}
        }
      ],
      [
        'fx',
        ws.fx,
        function (v) {
          try {
            localStorage.setItem(
              FXKEY,
              JSON.stringify(v && typeof v === 'object' && !Array.isArray(v) ? v : {})
            );
          } catch (e) {}
          renderFx();
        }
      ],
      [
        'books',
        ws.books,
        function (v) {
          const o = v && typeof v === 'object' ? v : {};
          try {
            localStorage.setItem(BKKEY, JSON.stringify(Array.isArray(o.list) ? o.list : []));
          } catch (e) {}
          try {
            localStorage.setItem(
              ACTBK,
              JSON.stringify(typeof o.active === 'string' ? o.active : '')
            );
          } catch (e) {}
          renderBooks();
        }
      ]
    ];
    try {
      sections.forEach(function (pair) {
        const name = pair[0],
          cloud = pair[1],
          apply = pair[2];
        if (!cloud || typeof cloud !== 'object' || !cloud.val) {
          return;
        } // corrupt/absent cloud section: skip
        const localVal = (function () {
          try {
            return JSON.parse(localStorage.getItem(wsKeys()[name]) || 'null');
          } catch (e) {
            return null;
          }
        })();
        const nextVal = wsMerge(stamps[name] || 0, cloud.updatedAt || 0, localVal, cloud.val);
        if (nextVal !== localVal) {
          try {
            apply(nextVal);
          } catch (e) {
            return;
          }
          stamps[name] = cloud.updatedAt || Date.now();
          merged.push(name);
        }
      });
    } finally {
      wsMerging = false;
    }
    try {
      localStorage.setItem(WSTAMPS_KEY, JSON.stringify(stamps));
    } catch (e) {}
    return { ok: true, merged: merged, plan: Entitlements.plan() };
  }
  // Key map is LAZY: HKEY/BRKEY/DOCNO_KEY are declared later in this module
  // and a module-eval-time const would die in the TDZ (took the whole page
  // down once already - do not hoist this back).
  let WS_KEYS = null;
  function wsKeys() {
    if (!WS_KEYS) {
      WS_KEYS = {
        estimates: NKEY,
        boq: BKEY2,
        history: HKEY,
        packs: PKKEY,
        rollup: RKEY2,
        brand: BRKEY,
        sheets: RKEY,
        docCounter: DOCNO_KEY,
        fx: FXKEY,
        books: BKKEY
      };
    }
    return WS_KEYS;
  }
  function wsPayload(withLogo) {
    const c = wsCollect();
    if (!withLogo && c.brand && c.brand.val && c.brand.val.logo) {
      c.brand.val = Object.assign({}, c.brand.val, { logo: null });
    }
    return c;
  }
  async function wsPut() {
    if (wsSignedOut || wsInFlight || !navigator.onLine) {
      return;
    }
    wsInFlight = true;
    try {
      let res = await fetch('/api/calc/workspace', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(wsPayload(!wsPutNoLogo))
      });
      if (res.status === 413 && !wsPutNoLogo) {
        wsPutNoLogo = true;
        res = await fetch('/api/calc/workspace', {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(wsPayload(false))
        });
      }
      if (res.status === 403) {
        wsSignedOut = true;
      }
    } catch (e) {
      /* offline / network down - silent, offline-first */
    }
    wsInFlight = false;
  }
  async function wsProbe() {
    if (wsSignedOut || wsInFlight || !navigator.onLine) {
      return;
    }
    wsInFlight = true;
    try {
      const res = await fetch('/api/calc/workspace', { method: 'GET', credentials: 'same-origin' });
      if (res.status === 403) {
        wsSignedOut = true;
      } else if (res.ok) {
        const data = await res.json();
        const out = wsApplyProbe(data);
        if (out.ok && out.merged && out.merged.length) {
          render();
        }
      }
    } catch (e) {
      /* offline - silent */
    }
    wsInFlight = false;
  }
  // W1 engine hook (harness-only convenience; harmless in production).
  window.__calcEngine = {
    computeFor: computeFor,
    applyState: applyState,
    boqTotals: boqTotals,
    renderBoq: renderBoq,
    readState: readState,
    syncLabels: syncLabels,
    instancesQty: instancesQty,
    estimateCsv: estimateCsv,
    // C2: the rate comparison + its sanity rule (T3 drives both).
    rateSanity: rateSanity,
    rateComparison: rateComparison,
    // C8: the independent derivation and its fail-closed rule (T1 drives both).
    expectedEngineQty: expectedEngineQty,
    qtyGuard: qtyGuard,
    prelimsTotal: prelimsTotal,
    rollup: rollup,
    cashCurve: cashCurve,
    formworkM2: formworkM2,
    importPacks: importPacks,
    applyDiscount: applyDiscount,
    companionsFor: companionsFor,
    billLint: billLint,
    syncFamily: syncFamily,
    brandLoad: brandLoad,
    logoFitsCap: logoFitsCap,
    docNoSuggest: docNoSuggest,
    wsCollect: wsCollect,
    wsMerge: wsMerge,
    wsApplyProbe: wsApplyProbe,
    scheduleWsPut: scheduleWsPut,
    rateFactor: rateFactor,
    dimSlips: dimSlips,
    activeVariant: activeVariant,
    variantFor: variantFor,
    fxFactor: fxFactor,
    fxBetween: fxBetween,
    modelRatesFor: modelRatesFor,
    importBooks: importBooks,
    jicBookPayload: jicBookPayload,
    bookChecksum: bookChecksum,
    setActiveBook: setActiveBook,
    activeBook: activeBook,
    loadFx: loadFx,
    renderFx: renderFx,
    renderBooks: renderBooks
  };

  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'calc-doc-type') {
      render();
    }
    if (e.target && e.target.id === 'calc-family') {
      onFamilyChange(e.target.value);
    }
    // E2: picking a version re-prefills the model rates for it.
    if (e.target && e.target.id === 'calc-variant') {
      refreshRateFields();
      render();
    }
    // E6: labour-only mode re-prices live.
    if (e.target && e.target.id === 'calc-labour-only') {
      render();
    }
  });
  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'calc-doc-title') {
      render();
    }
  });

  /* OWNER 2026-10-10 (T2, F-2): the export splits into a PURE build and an
     explicit download. buildCsv() returns the bytes and says honestly when
     there is nothing priced; the assistant's chip renders THAT object, so the
     chat can only ever offer a file that really exists. downloadCsv() is the
     page's own Export button. One row builder, two callers - never two code
     paths, and the chat never announces a file it did not produce. */
  // C9 (AUDIT-DIRECTIVE-2026-10-18): a proposal can be priced WITHOUT touching
  // the form, the bill or storage, so "Generate a file" works on a fresh
  // proposal instead of demanding Populate first (which is what made Download
  // look dead to the owner). PURE: it builds a state object and runs the same
  // engine every other path uses.
  function stateFromProposal(v) {
    const st = readState();
    if (v.work && WORK[v.work]) {
      st.work = v.work;
    }
    const units = v.units === 'imperial' || v.units === 'metric' ? v.units : st.units;
    st.units = units;
    if (v.measuredQty !== undefined && v.measuredQty !== null && v.measuredQty !== '') {
      st.measuredQty = String(v.measuredQty);
      st.measuredEntry = units === 'imperial' ? 'imp' : 'eng';
      st.measuredAuto = '';
      st.measuredUnit =
        (WORK[st.work] && WORK[st.work].q(1, null, null).unit) || st.measuredUnit || '';
    } else {
      st.measuredQty = '';
      st.d1 = v.d1 === undefined || v.d1 === null ? '' : String(v.d1);
      st.d2 = v.d2 === undefined || v.d2 === null ? '' : String(v.d2);
      st.d3 = v.d3 === undefined || v.d3 === null ? '' : String(v.d3);
    }
    if (v.allInRate !== undefined) {
      st.allInRate = String(v.allInRate);
    }
    if (v.basis) {
      st.basis = v.basis;
    }
    return st;
  }

  function previewProposal(v) {
    try {
      const st = stateFromProposal(v);
      const cur = st.currency || DEFAULT_CURRENCY;
      st._fxMissing = cur !== BASE_CURRENCY && fxFactor(cur) == null;
      const r = computeFor(st);
      if (!r || r.error) {
        return null;
      }
      r.name = workName(st.work);
      return r;
    } catch (e) {
      return null;
    }
  }

  function buildCsv(proposal) {
    // A proposal is priced in a sandbox; no proposal means the live result.
    const res = proposal ? previewProposal(proposal) : lastResult;
    if (!res) {
      return { ok: false, reason: 'nothing priced' };
    }
    const text = estimateCsv(res);
    return {
      ok: true,
      name: slug(docTitleBase()) + '-' + new Date().toISOString().slice(0, 10) + '.csv',
      mime: 'text/csv;charset=utf-8',
      text: text,
      rows: text ? text.split('\n').length - 1 : 0
    };
  }

  function downloadXlsx() {
    flushHeavy();
    const f = buildXlsx();
    if (!f.ok) {
      return f;
    }
    const blob = new Blob([f.bytes], { type: f.mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
    }, 500);
    return f;
  }

  function downloadCsv() {
    flushHeavy();
    const f = buildCsv();
    if (!f.ok) {
      return f;
    }
    const blob = new Blob([f.text], { type: f.mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
    }, 500);
    return f;
  }

  function workName(key) {
    const sel = $('calc-work');
    const opt = sel && sel.selectedOptions && sel.selectedOptions[0];
    let name = opt ? opt.textContent.trim() : key;
    // B1: a custom line is named by the USER's name, never by the option.
    if (key === 'custom') {
      const cn = (($('calc-custom-name') || {}).value || '').trim();
      if (cn) {
        return cn;
      }
    }
    // PART I PHASE 2: a JIC line is named by its ROW - the ref first, then
    // the book's own description - so bill lines, history and the CSV say
    // which published rate was priced (no 60-char field contract here: the
    // full ref + description rides, capped only for readability).
    if (key === 'jic') {
      const tSel = $('calc-jic-trade');
      const rSel = $('calc-jic-row');
      const row = tSel && rSel ? jicRowFor(tSel.value, rSel.value) : null;
      if (row) {
        let jn = row.ref + ' - ' + row.desc;
        if (jn.length > 90) {
          jn = jn.slice(0, 87) + '...';
        }
        return jn;
      }
    }
    // E2: multi-variant trades carry the picked version in the name so bill
    // lines, history and CSV name what was priced (single-variant trades -
    // the Phase 1 excavation conversion - keep the clean base name).
    const vSel = $('calc-variant');
    const w = WORK[key];
    if (vSel && vSel.value && w && w.variants && w.variants.length > 1) {
      const av = variantFor(key, vSel.value);
      // The default (first) variant keeps the clean base name; a non-default
      // pick names itself on bill lines, history and CSV.
      if (av && av.id !== w.variants[0].id) {
        name = name + ' - ' + av.label;
      }
    }
    return name;
  }

  function row(label, value, cls) {
    return (
      '<div class="calc-line' +
      (cls ? ' ' + cls : '') +
      '"><span>' +
      label +
      '</span><strong>' +
      value +
      '</strong></div>'
    );
  }

  // ---- Document vocabulary for the all-in and per-day bases (owner 2026-10-02)
  // D3: an all-in line is priced from ONE combined figure. No surface - screen,
  // CSV, comparison table, printed sheet - may invent a material/labour split
  // out of it, so the label and the "it is inside this figure" wording live here
  // and every surface reads them. That is what stops the split reappearing in
  // one export and not another.
  // D2: a day rate is shown as ONE labour total for the line, never itemised per
  // person. There is no role list anywhere in this app to itemise.
  const ALLIN_ROW_LABEL = 'Work rate (all-in)';
  const ALLIN_INCLUDED = 'in the all-in rate';
  // Plain language: "2.5 days at $400 per day", never "labour basis" or "norm".
  function dayBasisNote(r) {
    if (!r || !r.dayBasis) {
      return '';
    }
    const d = (Math.round(r.days * 100) / 100).toLocaleString();
    return (
      d +
      (r.days === 1 ? ' day at ' : ' days at ') +
      Math.round(r.dayRate).toLocaleString() +
      ' per day'
    );
  }
  // The source annotation shared by every surface, so the wording matches.
  function allInSourceNote(r) {
    if (!r || !r.allIn) {
      return '';
    }
    return r.allInOverridden ? ' - your rate' : r.bookFilled ? ' - JIC rate book' : '';
  }
  function matRowLabel(r) {
    if (r.allIn) {
      return ALLIN_ROW_LABEL + allInSourceNote(r);
    }
    return (
      'Materials' +
      (r.matExcluded ? ' - excluded (labour only)' : r.matOverridden ? ' - your rate' : '')
    );
  }
  function labRowLabel(r) {
    return (
      'Labor' +
      (r.labOverridden && !r.dayBasis ? ' - your rate' : '') +
      (r.dayBasis ? ' - ' + dayBasisNote(r) : '')
    );
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
    try {
      b = JSON.parse(localStorage.getItem(BRKEY) || 'null');
    } catch (e) {
      b = null;
    }
    if (!b || typeof b !== 'object') {
      b = {};
    }
    // Migration: the pre-brand lone business name folds in once, PERSISTS
    // into the brand store, then the old key is retired.
    try {
      const old = localStorage.getItem(BKEY);
      if (old) {
        localStorage.removeItem(BKEY);
        if (!b.name) {
          b.name = old;
          b.updatedAt = Date.now();
          try {
            localStorage.setItem(BRKEY, JSON.stringify(b));
          } catch (e) {}
        }
      }
    } catch (e) {}
    return {
      logo: b.logo || null,
      name: b.name || '',
      phone: b.phone || '',
      email: b.email || '',
      addr: b.addr || '',
      trn: b.trn || '',
      sigName: b.sigName || '',
      sigTitle: b.sigTitle || '',
      sigShow: b.sigShow || '',
      updatedAt: b.updatedAt || 0
    };
  }
  function brandSave(patch) {
    const cur = brandLoad();
    const next = Object.assign(cur, patch, { updatedAt: Date.now() });
    try {
      localStorage.setItem(BRKEY, JSON.stringify(next));
    } catch (e) {
      /* storage full - a nicety */
    }
    wsStampNow('brand');
    scheduleWsPut();
    return next;
  }
  //PURE: decoded byte size of a data URL (base64 payload is 4/3 of the bytes).
  function logoFitsCap(dataUrl) {
    const i = String(dataUrl || '').indexOf(',');
    if (i < 0) {
      return false;
    }
    const b64 = dataUrl.slice(i + 1).replace(/[^A-Za-z0-9+/=]/g, '');
    return (b64.length * 3) / 4 <= 1000000;
  }
  // On-device downscale: max side 600px, JPEG at falling quality, then
  // dimension halving, until the stored data URL is under the 1MB cap.
  function downscaleLogo(img) {
    return new Promise(function (resolve) {
      try {
        let w = img.naturalWidth || img.width,
          h = img.naturalHeight || img.height;
        if (!w || !h) {
          return resolve(null);
        }
        const MAX = 600;
        let scale = Math.min(1, MAX / Math.max(w, h));
        let cw = Math.max(1, Math.round(w * scale)),
          ch = Math.max(1, Math.round(h * scale));
        const hasAlpha = (() => {
          try {
            return (
              (img.src && img.src.indexOf('image/png') > -1) || img.src.indexOf('image/webp') > -1
            );
          } catch (e) {
            return false;
          }
        })();
        let q = 0.85;
        for (let attempt = 0; attempt < 8; attempt++) {
          const canvas = document.createElement('canvas');
          canvas.width = cw;
          canvas.height = ch;
          canvas.getContext('2d').drawImage(img, 0, 0, cw, ch);
          const url = canvas.toDataURL(hasAlpha ? 'image/png' : 'image/jpeg', q);
          if (logoFitsCap(url)) {
            return resolve(url);
          }
          if (!hasAlpha && q > 0.5) {
            q -= 0.15;
            continue;
          }
          cw = Math.max(1, Math.floor(cw / 2));
          ch = Math.max(1, Math.floor(ch / 2));
          q = 0.85;
        }
        resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }
  // PURE: document-number suggestion per type from the counter.
  function docNoSuggest(type, n) {
    const pre = type === 'Invoice' ? 'INV' : type === 'Quote' ? 'QUO' : 'EST';
    const num = Math.max(1, parseInt(n, 10) || 1);
    return (
      pre +
      '-' +
      (num < 10 ? '000' + num : num < 100 ? '00' + num : num < 1000 ? '0' + num : String(num))
    );
  }
  function docCounterLoad() {
    let c = null;
    try {
      c = JSON.parse(localStorage.getItem(DOCNO_KEY) || 'null');
    } catch (e) {
      c = null;
    }
    return {
      Estimate: (c && c.Estimate) || 1,
      Quote: (c && c.Quote) || 1,
      Invoice: (c && c.Invoice) || 1
    };
  }
  function docCounterBump(type) {
    const c = docCounterLoad();
    c[type] = (parseInt(c[type], 10) || 1) + 1;
    try {
      localStorage.setItem(DOCNO_KEY, JSON.stringify(c));
    } catch (e) {}
    wsStampNow('docCounter');
    scheduleWsPut();
    return c;
  }
  function bizName() {
    const el = $('calc-biz-name');
    if (el && el.value.trim()) {
      return el.value.trim();
    }
    return brandLoad().name;
  }

  // W3: the document sheet extras. Nothing renders without its data - a
  // bare estimate prints exactly like it did before this wave.
  function renderQuoteDoc(r) {
    const brand = brandLoad();
    const logo = $('calc-quote-logo');
    if (logo) {
      if (brand.logo) {
        logo.src = brand.logo;
        logo.hidden = false;
      } else {
        logo.removeAttribute('src');
        logo.hidden = true;
      }
    }
    const contact = $('calc-quote-contact');
    if (contact) {
      const parts = [
        brand.phone,
        brand.email,
        brand.addr,
        brand.trn ? 'TRN ' + brand.trn : ''
      ].filter(Boolean);
      contact.textContent = parts.join('  -  ');
    }
    const docNo = ($('calc-doc-no') || {}).value || '';
    const qd = $('calc-quote-docno');
    if (qd) {
      qd.textContent = docNo;
    }
    const client = (($('calc-client-name') || {}).value || '').trim();
    const addr = (($('calc-client-addr') || {}).value || '').trim();
    const bt = $('calc-quote-billto');
    if (bt) {
      if (!client && !addr) {
        bt.textContent = '';
        bt.hidden = true;
      } else {
        bt.hidden = false;
        bt.textContent = 'Bill to: ' + (client || '') + (addr ? (client ? ', ' : '') + addr : '');
      }
    }
    const sig = $('calc-quote-sig');
    if (sig) {
      const show = brand.sigShow === 'on' || (brand.sigShow === '' && docType() === 'Invoice');
      sig.hidden = !show;
      if (show) {
        const nameEl = sig.querySelector('.bcp-sig-name'),
          titleEl = sig.querySelector('.bcp-sig-title');
        if (nameEl) {
          nameEl.textContent = brand.sigName || bizName();
        }
        if (titleEl) {
          titleEl.textContent = brand.sigTitle || '';
        }
      }
    }
  }
  function renderBrand() {
    const b = brandLoad();
    const preview = $('calc-logo-preview'),
      rm = $('calc-logo-remove');
    if (preview) {
      if (b.logo) {
        preview.src = b.logo;
        preview.hidden = false;
      } else {
        preview.removeAttribute('src');
        preview.hidden = true;
      }
    }
    if (rm) {
      rm.hidden = !b.logo;
    }
    const map = {
      'calc-brand-name': b.name,
      'calc-brand-phone': b.phone,
      'calc-brand-email': b.email,
      'calc-brand-addr': b.addr,
      'calc-brand-trn': b.trn,
      'calc-brand-signame': b.sigName,
      'calc-brand-sigtitle': b.sigTitle
    };
    Object.keys(map).forEach(function (id) {
      const el = $(id);
      if (el && document.activeElement !== el) {
        el.value = map[id];
      }
    });
    const sigT = $('calc-sig-show');
    if (sigT) {
      sigT.checked = b.sigShow === 'on';
    }
    const bizEl = $('calc-biz-name');
    if (bizEl && document.activeElement !== bizEl) {
      bizEl.value = b.name;
    }
  }

  // ---- W2 2026-10-01: companion chips (one-tap bill lines) ----------------
  // Rendered under the estimate output; hidden until a trade with suggestions
  // is priced. Chips hide once their line is already in the bill (derivedFrom
  // match), so the row empties naturally as you accept them.
  function renderCompanions(r) {
    const wrap = $('calc-companions');
    if (!wrap) {
      return;
    }
    wrap.innerHTML = '';
    const res = r;
    if (!res || res.error) {
      wrap.hidden = true;
      return;
    }
    const st = readState();
    const list = companionsFor(st).filter(function (c) {
      return !loadBoq().some(function (line) {
        return line.st && line.st.derivedFrom === st.work + ':' + c.id;
      });
    });
    if (!list.length) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    const cur = CURRENCY[res.currency] || '$';
    wrap.innerHTML = '<div class="bcp-cp-title">Commonly added with ' + esc(res.name) + '</div>';
    list.forEach(function (c) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'bcp-cp-chip';
      chip.setAttribute('data-action', 'calcCompAdd');
      chip.setAttribute('data-cp', c.id);
      chip.textContent = c.name + ' - ' + qtyShown(c.qty, WORK[c.work].q(1).unit).main;
      wrap.appendChild(chip);
    });
  }

  // OWNER 2026-10-10 (R4, T4 "Quick total"): one big measurement times one
  // rate. The engine has always priced this path (a measured quantity plus an
  // all-in rate); this only makes it LEGIBLE - the quantity box carries the
  // trade's own unit and the line under it shows the arithmetic before the
  // on-costs and tax. No new maths, no new stored field.
  function renderQuickLine(r) {
    const qEl = $('calc-measured-qty');
    if (!qEl) {
      return;
    }
    // C1: the box names the unit it is actually asking for. In imperial mode
    // that is the entry unit (sq ft / cu yd / ft / US gal), so a typed number
    // is never mistaken for the engine's unit.
    const unit = (r && r.unit) || '';
    const entryUnit = _units === 'imperial' ? entryUnitName(unit) : unit;
    qEl.placeholder = entryUnit ? 'Total ' + entryUnit : 'Total quantity';
    qEl.setAttribute(
      'aria-label',
      entryUnit ? 'Total measured quantity (' + entryUnit + ')' : 'Total measured quantity'
    );
    const lineEl = $('calc-quick-line');
    if (!lineEl) {
      return;
    }
    const manual = $('calc-measured-manual');
    let txt = '';
    // B1: a custom or JIC line always shows its arithmetic (quantity x the
    // rate) even outside the Quick total box; every other line keeps the
    // original condition unchanged.
    if (
      r &&
      r.allIn &&
      isFinite(Number(r.qty)) &&
      Number(r.qty) > 0 &&
      ((manual && manual.checked) || r.isCustom || r.isJic)
    ) {
      // C1: the quantity printed here is ALWAYS the system on screen, and the
      // hero above carries the secondary reading. This line stays the owner's
      // own wording ("69 m2 x J$120 = J$8,280 before tax") - the plain-language
      // law does not allow a parenthetical to creep into a pinned sentence.
      const qs = qtyShown(r.qty, unit).main;
      // fmtMoney is the page's one money formatter (J$8,280), so the read-out
      // reads exactly like the bill below it.
      txt =
        qs +
        ' x ' +
        fmtMoney(r.allInRate, r.currency) +
        ' = ' +
        fmtMoney(r.allInCost, r.currency) +
        (r.tax > 0 ? ' before tax' : '');
    }
    lineEl.textContent = txt;
    lineEl.hidden = !txt;
  }

  // ---- C6 / X-1 support (AUDIT-DIRECTIVE-2026-10-18) -------------------------
  // Kill-switch reads mirror calcUnitFlagOn(): default ON, and
  // mmgr_flag_<name>=0 in localStorage restores the old behaviour with no
  // deploy (names documented in docs/STORAGE-INVENTORY.md via the flags
  // block in js/mmgr-state.js).
  function calcStickyFlagOn() {
    try {
      return localStorage.getItem('mmgr_flag_calcStickyPanel') !== '0';
    } catch (e) {
      return true;
    }
  }
  function calcSchedulerOn() {
    try {
      return localStorage.getItem('mmgr_flag_calcRenderScheduler') !== '0';
    } catch (e) {
      return true;
    }
  }

  // C6: the mobile total bar mirrors the live total in the LIGHT pass - a
  // textContent write that skips when the string did not change.
  function updateTotalBar(r) {
    const el = $('calc-totalbar-total');
    if (!el) {
      return;
    }
    const v = r && !r.error ? fmtMoney(r.total) : '-';
    if (el.textContent !== v) {
      el.textContent = v;
    }
  }

  // X-1 render scheduler: render() always computes and paints the result
  // card and quick line NOW (the light pass - what the keystroke's event
  // duration pays for); the document-shaped cards (prelims, rollup, cash,
  // accessories, companions, quote) rebuild once the input settles, off the
  // interaction. The heavy pass reads lastResult AT RUN TIME, so a queued
  // pass always paints the newest state, never a stale closure. With the
  // calcRenderScheduler flag off, the heavy pass runs inline - byte-for-byte
  // the old pipeline.
  let heavyQueued = false;
  let heavyHandle = null;
  let heavyUsedIdle = false;
  function heavyPass(r) {
    renderPrelims(r && !r.error ? r.sub : 0);
    renderRollup();
    renderCash();
    renderAccessories();
    renderCompanions(r);
    renderQuoteDoc(r);
  }
  function scheduleHeavy(r) {
    if (!calcSchedulerOn()) {
      heavyPass(r);
      return;
    }
    if (heavyQueued) {
      return;
    }
    heavyQueued = true;
    if (window.requestIdleCallback) {
      heavyUsedIdle = true;
      heavyHandle = window.requestIdleCallback(
        function () {
          heavyQueued = false;
          heavyHandle = null;
          heavyPass(lastResult);
        },
        { timeout: 250 }
      );
    } else {
      heavyUsedIdle = false;
      heavyHandle = setTimeout(function () {
        heavyQueued = false;
        heavyHandle = null;
        heavyPass(lastResult);
      }, 60);
    }
  }
  // Exports, print and populate must never read half-updated cards: the
  // queued pass runs synchronously first. No queue = cards already current.
  function flushHeavy() {
    if (!heavyQueued) {
      return;
    }
    if (heavyHandle != null) {
      if (heavyUsedIdle && window.cancelIdleCallback) {
        window.cancelIdleCallback(heavyHandle);
      } else {
        clearTimeout(heavyHandle);
      }
    }
    heavyQueued = false;
    heavyHandle = null;
    heavyPass(lastResult);
  }
  // QA hook (the __calcEngine pattern): the heavy pass is deferred by design
  // (X-1), so a harness that dispatches events and reads a heavy card in ONE
  // evaluate must flush first. Production paths (export, print, populate)
  // call flushHeavy() themselves.
  window.__calcFlushHeavy = flushHeavy;

  // X-1: skip the result-card write when the HTML did not change - the
  // rebuild is string work, but the browser reparse is the expensive half.
  function setOut(html) {
    const out = $('calc-output');
    if (out && out.innerHTML !== html) {
      out.innerHTML = html; // ok: every setOut() caller composes html from esc()-escaped fields and literals - this is only the skip-if-unchanged write point (X-1)
    }
  }

  function render() {
    const out = $('calc-output');
    if (!out) {
      return;
    }
    const r = compute();
    // C2: the rate comparison strip and its sanity banner ride every recompute.
    const stRates = readState();
    const curRates = stRates.currency || DEFAULT_CURRENCY;
    stRates._fxMissing = curRates !== BASE_CURRENCY && fxFactor(curRates) == null;
    renderRateCompare(r && !r.error ? r : null, stRates);
    // T4: the Quick total line and the quantity box's unit follow every
    // recompute, including an error state (r is null then).
    renderQuickLine(r && !r.error ? r : null);
    // C6: the mobile total bar rides every recompute in the light pass.
    updateTotalBar(r);
    // X-1: the document-shaped cards (W3 quote sheet, W4 prelims, W5
    // rollup, W6 cash, W7 accessories + companions) moved to the heavy
    // pass - see scheduleHeavy above. They still ride every recompute,
    // just off the keystroke's critical path, and flushHeavy() runs them
    // synchronously before print/export/populate touch the DOM.
    scheduleHeavy(r);
    // RATE BOOK REBRAND: the planning notice rides every priced result, in
    // the same words the rate book uses (rateBookNotice is the one source).
    const notice = $('calc-rate-notice');
    if (notice) {
      if (r && !r.error) {
        notice.textContent = rateBookNotice();
        notice.hidden = false;
      } else {
        notice.textContent = '';
        notice.hidden = true;
      }
    }
    if (!r || r.error) {
      lastResult = null;
      if ($('calc-out-actions')) {
        $('calc-out-actions').classList.add('is-hide');
      }
    }
    if (!r) {
      setOut('<div class="calc-empty">Pick a work item, enter dimensions, then Calculate.</div>');
      return;
    }
    if (r.error) {
      // D-9 (AUDIT-DIRECTIVE-2026-10-18): an engine error string now carries
      // the user's currency, so it is escaped at its one HTML insert.
      setOut('<div class="calc-empty">' + esc(r.error) + '</div>');
      return;
    }
    lastResult = r;
    if ($('calc-out-actions')) {
      $('calc-out-actions').classList.remove('is-hide');
    }
    const pieceNarr =
      r.piece && !r.piece.countOnly
        ? r.piece.div === 'width'
          ? (Math.round(r.piece.perUnit * 100) / 100).toLocaleString() + '/m of run'
          : r.piece.div === 'volume'
            ? (Math.round(r.piece.perUnit * 100) / 100).toLocaleString() + '/' + r.piece.qtyUnit
            : (Math.round(r.piece.perUnit * 100) / 100).toLocaleString() + '/m2'
        : null;
    const pieceDesc =
      r.piece && !r.piece.countOnly
        ? r.piece.div === 'volume'
          ? r.piece.price.toLocaleString() + ' per ' + r.piece.w + ' L yield = ' + pieceNarr
          : r.piece.price.toLocaleString() +
            ' / ' +
            (_units === 'imperial'
              ? Math.round(r.piece.w / 2.54) + ' x ' + Math.round(r.piece.l / 2.54) + ' in'
              : r.piece.w + ' x ' + r.piece.l + ' ' + r.piece.unit) +
            ' = ' +
            pieceNarr
        : null;
    const matLabel = r.allIn
      ? matRowLabel(r)
      : r.piece && !r.piece.countOnly
        ? 'Materials - priced per piece at ' + pieceDesc
        : matRowLabel(r);
    const labLabel = labRowLabel(r);
    // E1: while model money is unconverted the breakdown says so in USD
    // terms - the picked symbol is only shown for money in that currency.
    const moneyCode = r.modelUnconverted ? 'USD' : null;
    // D3: an all-in line shows ONE combined figure and no fabricated split.
    // D2: a day-rate line shows ONE labour total, carrying the days and the
    // rate per day in its label so the document explains the money.
    const matRowHtml = r.allIn
      ? row(matLabel, fmtMoney(r.allInCost, moneyCode))
      : row(matLabel, fmtMoney(r.mat, moneyCode));
    const labRowHtml = r.allIn ? '' : row(labLabel, fmtMoney(r.lab, moneyCode));
    const shown = qtyShown(r.qty, r.unit);
    const qh = $('calc-quote-biz'),
      qm = $('calc-quote-meta'),
      qt = $('calc-quote-title');
    if (qh) {
      qh.textContent = bizName();
    }
    if (qt) {
      qt.textContent = docType();
    }
    if (qm) {
      qm.textContent =
        (docTitleRaw() || ($('calc-save-name') || {}).value || r.name) +
        '  -  ' +
        r.name +
        '  -  ' +
        shown.main +
        '  -  ' +
        new Date().toISOString().slice(0, 10);
    }
    // W3: the full document sheet - logo, contact block, document number
    // and bill-to appear ONLY when their data exists (plain by default).
    setOut(
      (r.modelUnconverted
        ? '<p class="bcp-jm-note">Built-in model rates are US dollars - set a ' +
          esc(r.currency) +
          ' exchange rate in the Exchange rates card, or type your own rates, to price in ' +
          esc(r.currency) +
          '.</p>'
        : '') +
        '<div class="calc-sum">' +
        '<div class="calc-sum-main"><span class="calc-sum-label">' +
        r.qtyLabel +
        '</span>' +
        '<strong class="calc-sum-qty">' +
        esc(shown.main) +
        '<span class="calc-qty-alt">' +
        esc(shown.alt) +
        '</span></strong></div>' +
        '<div class="calc-sum-sub">' +
        // PART I PHASE 2: a JIC line's matDesc carries the row's own ref +
        // description (the book writes with & and quotes), so the ONE HTML
        // insert escapes it; the CSV takes the same raw string.
        esc(r.matDesc) +
        '</div>' +
        (r.orderCount
          ? '<div class="calc-sum-sub">Order about <strong>' +
            r.orderCount.n.toLocaleString() +
            '</strong> ' +
            esc(r.orderCount.lbl + ' at ' + r.orderCount.sizeTxt) +
            '</div>'
          : '') +
        (r.hasOpenings && r.openings && r.openings.count
          ? '<div class="calc-sum-sub">Minus ' +
            r.openings.count +
            ' ' +
            (r.openings.count === 1 ? 'opening' : 'openings') +
            ' (' +
            r.openings.area +
            ' m2) not built - window and door spaces</div>'
          : '') +
        '</div>' +
        (r.slips && r.slips.length
          ? r.slips
              .map(function (s) {
                return (
                  '<p class="bcp-jm-note">' +
                  esc(s.msg) +
                  (s.fix != null && s.fix !== ''
                    ? ' <button type="button" class="btn btn-n btn-s" data-action="calcFixDim" data-field="' +
                      esc(s.field) +
                      '" data-val="' +
                      esc(s.fix) +
                      '">Use ' +
                      esc(String(s.fix)) +
                      '</button>'
                    : '') +
                  '</p>'
                );
              })
              .join('')
          : '') +
        (r.hasWaste ? row(r.wasteLbl + ' allowance', r.wastePct + '%') : '') +
        matRowHtml +
        labRowHtml +
        (r.onCost > 0
          ? row(
              'Labor statutory costs (NIS, NHT, HEART, Education) ' + r.onCostPct + '%',
              fmtMoney(r.onCost, moneyCode)
            )
          : '') +
        (r.eq > 0 ? row('Equipment / plant hire', fmtMoney(r.eq, moneyCode)) : '') +
        (r.ohPct > 0 ? row('Overhead & margin ' + r.ohPct + '%', fmtMoney(r.oh, moneyCode)) : '') +
        row('Subtotal', fmtMoney(r.sub, moneyCode), 'calc-line-sub') +
        // OWNER 2026-10-02: "No tax" is a CHOICE, so it says so. Three distinct
        // zero-tax stories must never be confused: picked "none", typed 0, or a
        // country whose rate genuinely is 0.
        row(
          r.noTax
            ? 'No tax on this job'
            : r.taxRate === 0 && r.overrideApplied
              ? 'Tax (no tax - your rate)'
              : 'Tax (' + r.taxRate + '%' + (r.overrideApplied ? ', your rate' : '') + ')',
          fmtMoney(r.tax, moneyCode)
        ) +
        row('Estimated total', fmtMoney(r.total, moneyCode), 'calc-line-total') +
        '<div class="calc-fine">Planning-grade estimate for ' +
        esc(r.currency) +
        '. Not a quote - every line becomes editable in the app once the project starts.</div>'
    );
    return r;
  }

  // ---- History (localStorage, this device only) ----
  const HKEY = 'mmgr_calc_history';
  function loadHistory() {
    try {
      return JSON.parse(localStorage.getItem(HKEY) || '[]');
    } catch (e) {
      return [];
    }
  }
  function saveHistory(entry) {
    try {
      const h = loadHistory();
      h.unshift(entry);
      localStorage.setItem(HKEY, JSON.stringify(h.slice(0, 20)));
    } catch (e) {
      /* storage full or blocked - history is a nicety, never a gate */
    }
    wsStampNow('history');
    scheduleWsPut();
  }
  function renderHistory() {
    const wrap = $('calc-history');
    if (!wrap) {
      return;
    }
    const h = loadHistory();
    if (!h.length) {
      wrap.innerHTML = '<div class="calc-empty">Nothing saved yet.</div>';
      return;
    }
    wrap.innerHTML = h
      .map(
        (e, i) =>
          '<div class="calc-hist-row">' +
          '<span class="calc-hist-date">' +
          e.at +
          '</span>' +
          '<span class="calc-hist-work">' +
          e.name +
          '</span>' +
          '<span class="calc-hist-total">' +
          e.total +
          '</span>' +
          '<button type="button" class="btn btn-n btn-s" data-action="calcRestore" data-idx="' +
          i +
          '">Recall</button>' +
          '<button type="button" class="btn btn-n btn-s" data-action="calcDelHist" data-idx="' +
          i +
          '" aria-label="Delete this history row">X</button>' +
          '</div>'
      )
      .join('');
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
  function guideOpenState() {
    try {
      return localStorage.getItem('mmgr_calc_guide_open') !== '0';
    } catch (e) {
      return true;
    }
  }
  function renderGuide() {
    const body = $('calc-guide-body'),
      reopen = $('calc-guide-reopen'),
      toggle = $('calc-guide-toggle');
    if (!body) {
      return;
    }
    const open = guideOpenState();
    body.hidden = !open;
    if (reopen) {
      reopen.hidden = open;
    }
    if (toggle) {
      toggle.hidden = !open;
    }
    if (!open) {
      return;
    }
    const c = $('calc-guide-count'),
      t = $('calc-guide-text'),
      dots = $('calc-guide-dots');
    if (c) {
      c.textContent = guideIdx + 1 + ' of ' + GUIDE_STEPS.length;
    }
    if (t) {
      t.textContent = GUIDE_STEPS[guideIdx];
    }
    if (dots) {
      let h = '';
      for (let i = 0; i < GUIDE_STEPS.length; i++) {
        h += '<span class="bcp-guide-dot' + (i === guideIdx ? ' active' : '') + '"></span>';
      }
      dots.innerHTML = h;
    }
  }

  /* UI-3 (REFINEMENT-DIRECTIVE-2026-10-24): the guide's two tabs.
     Steps is the slider that was always there; Notes is the reading that used
     to be fine print under the form. Standard tablist behaviour: exactly one
     tab is selected, the panels are role=tabpanel, Left/Right/Home/End move the
     selection with a roving tabindex, and the card opens on Steps. */
  function setGuideTab(name) {
    const want = name === 'notes' ? 'notes' : 'steps';
    ['steps', 'notes'].forEach(function (k) {
      const tab = $('calc-guide-tab-' + k);
      const panel = $('calc-guide-panel-' + k);
      const on = k === want;
      if (tab) {
        tab.classList.toggle('is-on', on);
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
        tab.tabIndex = on ? 0 : -1;
      }
      if (panel) {
        panel.hidden = !on;
      }
    });
  }

  // ---- First-visit tutorial (owner 2026-09-30) ----------------------------
  // Click-to-start spotlight walkthrough in the guide's field order. One
  // flag (mmgr_calc_tour_done) gates the nudge; clearing browser data
  // removes it, so a wiped device sees the tour again (owner-specified).
  const TOUR_STEPS = [
    {
      sel: '#calc-work',
      text: 'This is the work item - what you are pricing. Pick one and the form follows.'
    },
    {
      sel: '.bcp-seg',
      text: 'Choose your measurement: metric or imperial. Everything converts as you type.'
    },
    { sel: '#calc-d1', text: 'Enter the dimensions the form asks for - length, width, depth.' },
    {
      sel: '#calc-currency',
      text: 'Your currency, and the country that sets the standard tax rate.'
    },
    {
      sel: '#calc-quality',
      text: 'Finish level: economy trims about 15%, premium adds about 35%.'
    },
    {
      sel: '#calc-oh',
      text: 'Overhead and margin: many builders add about 10% - yours is optional.'
    },
    {
      sel: '#calc-rate-mat',
      text: 'Your rates come prefilled as planning-grade averages. Type your own; save them as rate sheets.'
    },
    {
      sel: '#calc-brand-card',
      text: 'Business details: your logo, contact lines and signature print on every document. Optional - it stays on this device.'
    },
    {
      sel: '#calc-boq-card',
      text: 'Add to bill keeps a running bill of quantities - every line priced on this device, every line editable.'
    },
    {
      sel: '#calc-companions',
      text: 'Common additions show up right under the estimate - one tap adds a real, editable bill line.'
    },
    {
      sel: '#calc-prelims-card',
      text: 'Site and other costs price the items that keep the site running, on top of the works.'
    },
    { sel: '.bcp-run', text: 'Hit Calculate and the breakdown lands on the right.' },
    { sel: null, text: "That's it - you're ready to use the calculator." }
  ];
  let tourIdx = -1;
  function tourDone() {
    try {
      return localStorage.getItem('mmgr_calc_tour_done') === '1';
    } catch (e) {
      return false;
    }
  }
  function tourFlag() {
    try {
      localStorage.setItem('mmgr_calc_tour_done', '1');
    } catch (e) {}
  }
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
    if (!main) {
      return;
    }
    const marked = main.querySelectorAll('.bcp-tour-blur');
    for (let i = 0; i < marked.length; i++) {
      marked[i].classList.remove('bcp-tour-blur');
    }
    if (!el || !main.contains(el)) {
      return;
    }
    let cur = el;
    while (cur && cur !== main) {
      const parent = cur.parentElement;
      if (!parent) {
        break;
      }
      const kids = parent.children;
      for (let i = 0; i < kids.length; i++) {
        if (kids[i] !== cur) {
          kids[i].classList.add('bcp-tour-blur');
        }
      }
      cur = parent;
    }
  }
  function tourEnd() {
    tourIdx = -1;
    tourFlag();
    const o = $('calc-tour-overlay');
    if (o) {
      o.hidden = true;
    }
    const spot = $('calc-tour-spot');
    if (spot) {
      spot.hidden = true;
    }
    tourBlurSet(null);
    const popEnd = $('calc-tour-pop');
    if (popEnd) {
      popEnd.classList.remove('is-final');
    }
    try {
      document.documentElement.classList.remove('mmgr-tour-active');
    } catch (e) {}
  }
  function tourShow() {
    const o = $('calc-tour-overlay'),
      pop = $('calc-tour-pop');
    if (!o || !pop) {
      return;
    }
    const st = TOUR_STEPS[tourIdx];
    if (!st) {
      tourEnd();
      return;
    }
    o.hidden = false;
    const c = $('calc-tour-count'),
      t = $('calc-tour-text'),
      dots = $('calc-tour-dots');
    if (c) {
      c.textContent = tourIdx + 1 + ' of ' + TOUR_STEPS.length;
    }
    if (t) {
      t.textContent = st.text;
    }
    if (dots) {
      let h = '';
      for (let i = 0; i < TOUR_STEPS.length; i++) {
        h += '<span class="bcp-guide-dot' + (i === tourIdx ? ' active' : '') + '"></span>';
      }
      dots.innerHTML = h;
    }
    const tEl = st.sel ? document.querySelector(st.sel) : null;
    if (st.sel) {
      pop.classList.remove('is-final');
    } // dock rules own anchored steps
    // Blur everything OFF the spotlight path (owner: the rest of the screen
    // is blurred). The whole .bcp-field wrapper - label + input - stays crisp
    // so the talked-about field reads as one unit; the class lands per
    // element, never on .bcp-main (see tourBlurSet - containing-block trap).
    tourBlurSet(tEl ? (tEl.closest && tEl.closest('.bcp-field')) || tEl : null);
    try {
      document.documentElement.classList.add('mmgr-tour-active');
    } catch (e) {}
    if (tEl) {
      try {
        tEl.scrollIntoView({ block: 'center' });
      } catch (e) {}
      pop.setAttribute('data-anchor', st.sel);
      // Position AFTER the scroll settles: scrollIntoView is async-ish in
      // layout terms, so a same-tick getBoundingClientRect can read a stale
      // box (probe caught the cutout landing one card above the target).
      // Double rAF = the repo's standard flush (AGENTS.md lesson 3).
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (tourIdx < 0 || TOUR_STEPS[tourIdx] !== st) {
            return;
          }
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
    if (!spot) {
      return;
    }
    spot.hidden = false;
    const r = target.getBoundingClientRect();
    spot.style.left = r.left - 6 + 'px';
    spot.style.top = r.top - 6 + 'px';
    spot.style.width = r.width + 12 + 'px';
    spot.style.height = r.height + 12 + 'px';
  }
  function positionTourPop(target) {
    const pop = $('calc-tour-pop');
    if (!pop) {
      return;
    }
    pop.style.transform = 'none';
    const r = target.getBoundingClientRect();
    const pr = pop.getBoundingClientRect();
    const pw = Math.min(pr.width || 320, window.innerWidth - 24);
    const below = r.bottom + 12 + pr.height < window.innerHeight;
    pop.style.left = Math.max(12, Math.min(r.left, window.innerWidth - pw - 12)) + 'px';
    pop.style.top = (below ? r.bottom + 12 : Math.max(12, r.top - pr.height - 12)) + 'px';
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && tourIdx >= 0) {
      tourEnd();
    }
  });
  window.addEventListener('resize', function () {
    if (tourIdx < 0) {
      return;
    }
    const st = TOUR_STEPS[tourIdx];
    const t = st && st.sel ? document.querySelector(st.sel) : null;
    if (t) {
      positionTourPop(t);
      positionTourSpot(t);
      return;
    }
    // Final card: keep the ring glued to the centered pop across resizes.
    const pop = $('calc-tour-pop');
    if (pop) {
      positionTourSpot(pop);
    }
  });
  // Keep the cutout glued to the target while the page scrolls under it.
  window.addEventListener(
    'scroll',
    function () {
      if (tourIdx < 0) {
        return;
      }
      const st = TOUR_STEPS[tourIdx];
      const t = st && st.sel ? document.querySelector(st.sel) : null;
      if (t) {
        positionTourPop(t);
        positionTourSpot(t);
      }
    },
    { passive: true }
  );
  // Harness hook (harmless in production).
  window.__calcTour = {
    start: function () {
      ACTIONS.calcTourStart();
    },
    skip: function () {
      tourEnd();
    },
    state: function () {
      return { idx: tourIdx, done: tourDone() };
    }
  };

  // ---- Actions (same data-action dispatch convention as the app) ----
  const ACTIONS = {
    // ---- How-to guide slider (owner 2026-09-30): field-order steps -------
    calcGuidePrev: function () {
      guideIdx = (guideIdx - 1 + GUIDE_STEPS.length) % GUIDE_STEPS.length;
      renderGuide();
    },
    calcGuideNext: function () {
      guideIdx = (guideIdx + 1) % GUIDE_STEPS.length;
      renderGuide();
    },
    calcGuideClose: function () {
      try {
        localStorage.setItem('mmgr_calc_guide_open', '0');
      } catch (e) {}
      renderGuide();
    },
    calcGuideOpen: function () {
      try {
        localStorage.setItem('mmgr_calc_guide_open', '1');
      } catch (e) {}
      renderGuide();
    },
    // UI-3: switch the guide between its slider and its notes.
    calcGuideTab: function (el) {
      setGuideTab(el && el.getAttribute('data-tab'));
    },
    // ---- Jamaica rate book card (owner 2026-10-02) ----
    // Owner 2026-10-13: gated behind SIGN IN (not premium).
    openRateBook: function () {
      openRateBookGated();
    },
    // ---- First-visit tutorial actions (owner 2026-09-30) ----
    calcTourStart: function () {
      tourIdx = 0;
      const n = $('calc-tour-nudge');
      if (n) {
        n.hidden = true;
      }
      tourShow();
    },
    calcTourNext: function () {
      if (tourIdx < 0) {
        return;
      }
      if (tourIdx >= TOUR_STEPS.length - 1) {
        tourEnd();
        return;
      }
      tourIdx++;
      tourShow();
    },
    calcTourPrev: function () {
      if (tourIdx <= 0) {
        return;
      }
      tourIdx--;
      tourShow();
    },
    calcTourSkip: function () {
      tourEnd();
    },
    calcTourDismiss: function () {
      const n = $('calc-tour-nudge');
      if (n) {
        n.hidden = true;
      }
      tourFlag();
    },
    calcRun: function () {
      const r = render();
      if (r && !r.error) {
        // F4b exact recall: the row carries the FULL settings state so recall
        // reproduces this sum exactly (owner directive), not a re-skin of it.
        const st = readState();
        saveHistory({
          at: new Date().toISOString().slice(0, 10),
          name: r.name,
          qty: r.qty + ' ' + r.unit,
          total: fmtMoney(r.total),
          st: st
        });
        renderHistory();
        // Playwright UX audit finding (2026-09-28): on phones the result card
        // sits below the fold, so tapping Calculate looked like nothing
        // happened. Bring the estimate into view - explicit action only,
        // NEVER on live typing (that would yank the page mid-edit).
        const outEl = $('calc-output');
        if (outEl) {
          const rect = outEl.getBoundingClientRect();
          if (rect.top < 0 || rect.top > window.innerHeight - 80) {
            const reduced =
              window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            outEl.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
          }
        }
      }
    },
    calcClearHistory: function () {
      try {
        localStorage.removeItem(HKEY);
      } catch (e) {}
      renderHistory();
    },
    calcRestore: function (el) {
      const h = loadHistory()[parseInt(el.getAttribute('data-idx'), 10)];
      if (!h) {
        return;
      }
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
    calcDelHist: function (el) {
      const idx = parseInt(el.getAttribute('data-idx'), 10);
      const h = loadHistory();
      if (isNaN(idx) || !h[idx]) {
        return;
      }
      h.splice(idx, 1);
      try {
        localStorage.setItem(HKEY, JSON.stringify(h));
      } catch (e) {}
      wsStampNow('history');
      scheduleWsPut();
      renderHistory();
    },
    // Load the shipped Jamaica rate book (owner 2026-10-02). One tap, on device.
    // The rates are a DEFAULT: they prefill the all-in field, the user can type
    // over any of them, and the published-rate note says where they came from.
    calcBookJic: function () {
      const payload = jicBookPayload();
      const res = importBooks(payload);
      const list = loadBooks();
      const b = list.find(function (x) {
        return (x.name || '').indexOf('Jamaica rate book') === 0;
      });
      if (b) {
        setActiveBook(b.id);
        // OWNER 2026-10-02: the book is in Jamaican dollars. If the estimate is
        // still sitting on the base currency the loaded rates cannot convert,
        // which is exactly why this button looked dead - move the estimate to
        // the book's currency so the rates actually land in the fields. A
        // currency the user already chose for themselves is never overridden.
        const cur = $('calc-currency');
        if (cur && cur.value === BASE_CURRENCY) {
          cur.value = b.currency || DEFAULT_CURRENCY;
          const co = $('calc-country');
          if (co && co.value === 'US') {
            co.value = 'JM';
          }
        }
        // The all-in basis is what this book speaks, so offer it directly.
        const sel = $('calc-basis');
        if (sel && sel.value === 'measured') {
          sel.value = 'allin';
        }
      }
      renderBooks();
      refreshRateFields();
      syncBasis();
      render();
      sheetMsg(
        !b
          ? 'That Jamaica book could not be loaded - try importing it from a file instead.'
          : 'Jamaica rate book ' +
              JIC_YEARS +
              ' loaded: ' +
              payload.entryCount +
              ' rates. Its rates prefill the all-in field, and you can type over any of them.'
      );
      if (res && res.skipped) {
        console.warn('[calc] Jamaica book skipped ' + res.skipped + ' entries');
      }
    },
    // OWNER 2026-10-02: the shipped book is the DEFAULT, loaded once per device
    // and then left entirely to the user. Only the FIRST visit installs it; after
    // that the user's own choice (including "none") is never overridden again.
    calcBookDefault: function () {
      if (localStorage.getItem(JICSEEN)) {
        return;
      }
      try {
        localStorage.setItem(JICSEEN, '1');
      } catch (e) {
        /* nicety */
      }
      const payload = jicBookPayload();
      const res = importBooks(payload);
      const b = loadBooks().find(function (x) {
        return (x.name || '').indexOf('Jamaica rate book') === 0;
      });
      if (!b) {
        if (res && res.skipped) {
          console.warn('[calc] Jamaica book skipped ' + res.skipped + ' entries');
        }
        return;
      }
      setActiveBook(b.id);
      // OWNER 2026-10-02 (final): with the JIC book selected and JMD as the
      // currency, the pricing basis must follow the BOOK. The book carries
      // all-in combined rates and no material/labour split, so leaving the
      // basis on 'measured' made every line fall back to the USD planning-grade
      // model and print those figures under a Jamaican dollar estimate - the
      // relabelled-USD defect E1 exists to prevent. This is the FIRST-VISIT
      // install only; from then on the user's own choice, including 'measured',
      // is never overridden again.
      const sel = $('calc-basis');
      if (sel && sel.value === 'measured') {
        sel.value = 'allin';
      }
      sheetMsg(
        'Loaded the Jamaica rate book ' +
          JIC_YEARS +
          ': ' +
          payload.entryCount +
          ' rates. Every rate is yours to change, and you can swap or remove the book at any time.'
      );
    },
    // Pricing basis (owner 2026-10-02): swap which inputs are on show. The
    // typed figures are left alone so a user can compare two ways of pricing
    // the same work without retyping; the engine picks the active set.
    calcBasisPick: function () {
      syncBasis();
      render();
    },
    // UI-2: put the four statutory parts back to the Jamaica defaults.
    calcOncostReset: function () {
      ui2ResetOncost();
    },
    // F4b: put the model rates back (the escape hatch from your own rates).
    calcRatesReset: function () {
      if ($('calc-rate-mat')) {
        $('calc-rate-mat').value = '';
      }
      if ($('calc-rate-lab')) {
        $('calc-rate-lab').value = '';
      }
      if ($('calc-allin')) {
        $('calc-allin').value = '';
        $('calc-allin').dataset.model = '';
      }
      if ($('calc-days')) {
        $('calc-days').value = '';
      }
      if ($('calc-day-rate')) {
        $('calc-day-rate').value = '';
      }
      if ($('calc-piece-price')) {
        $('calc-piece-price').value = '';
      }
      if ($('calc-piece-size')) {
        $('calc-piece-size').value = '';
      }
      if ($('calc-waste')) {
        $('calc-waste').value = '';
      }
      refreshRateFields();
      render();
    },
    tglTheme: function () {
      // Same theme helper every page uses (mmgr-theme.js exposes MMGRTheme);
      // body.dark-mode + persistence are owned there, never duplicated here.
      if (window.MMGRTheme && MMGRTheme.setMode) {
        MMGRTheme.setMode(MMGRTheme.isDark() ? 'light' : 'dark');
        // OWNER 2026-10-13: the star field follows dark/light live, exactly
        // like the app and admin pages do it.
        if (window.MMGR && MMGR.Glass && MMGR.Glass.refreshTheme) {
          MMGR.Glass.refreshTheme();
        }
        return;
      }
      document.body.classList.toggle('dark-mode');
      try {
        localStorage.setItem(
          'mmgr_theme',
          document.body.classList.contains('dark-mode') ? 'dark' : 'light'
        );
      } catch (e) {}
    },
    // E2 (owner 2026-09-29 universal back-navigation): Back goes where you
    // came from when this page was opened from inside the site; straight to
    // the app dashboard when it is the entry point (bookmark, PWA icon).
    calcBack: function () {
      let ref = '';
      try {
        ref = document.referrer || '';
      } catch (e) {}
      let sameOrigin = false;
      if (ref) {
        try {
          sameOrigin = new URL(ref).origin === window.location.origin;
        } catch (e) {
          sameOrigin = false;
        }
      }
      if (sameOrigin && window.history.length > 1 && !ref.startsWith(location.href.split('#')[0])) {
        window.history.back();
      } else {
        window.location.href = 'app.html';
      }
    },
    // F4-1: metric / imperial toggle. Inputs convert on entry; labels and the
    // quantity's imperial reading follow. Choice persists per device.
    calcUnits: function (el) {
      setUnits(el.getAttribute('data-units') === 'imperial' ? 'imperial' : 'metric', false);
    },
    // F4-2: export the live breakdown.
    calcPrint: function () {
      if (!lastResult) {
        return;
      }
      // C3: the printed sheet is a document, so it renders with cents.
      docMoney = true;
      render();
      // X-1: the sheet must never print half-updated cards.
      flushHeavy();
      document.body.classList.add('print-estimate');
      window.print();
    },
    calcCsv: downloadCsv,
    // C4: the default export for a human - four sheets, real number formats.
    calcXlsx: downloadXlsx,
    // F4-3: named estimates.
    calcSave: function () {
      if (!lastResult) {
        return;
      }
      const nameEl = $('calc-save-name');
      const name =
        ((nameEl && nameEl.value) || '').trim() ||
        lastResult.name + ' - ' + fmtMoney(lastResult.total);
      const list = loadEstimates();
      const st = readState();
      // W3: the doc-number counter bumps only when a save carries the exact
      // suggested number - a hand-typed number is the user's own sequence.
      const c = docCounterLoad();
      if ((st.docNo || '').trim() === docNoSuggest(st.docType, c[st.docType])) {
        docCounterBump(st.docType);
      }
      list.unshift({
        id: 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), // ok: non-secret
        name: name,
        at: new Date().toISOString().slice(0, 10),
        total: fmtMoney(lastResult.total),
        st: st
      });
      persistEstimates(list);
      if (nameEl) {
        nameEl.value = '';
      }
      renderEstimates();
    },
    calcOpen: function (el) {
      const est = loadEstimates().find(function (x) {
        return x.id === el.getAttribute('data-id');
      });
      if (!est) {
        return;
      }
      if (est.st) {
        applyState(est.st);
      } else if (est.work) {
        applyLegacy(est);
        if (est.taxOverride && $('calc-tax-override')) {
          $('calc-tax-override').value = est.taxOverride;
        }
      }
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    calcDeleteEst: function (el) {
      const id = el.getAttribute('data-id');
      persistEstimates(
        loadEstimates().filter(function (x) {
          return x.id !== id;
        })
      );
      renderEstimates();
    },
    // ---- W1 bill of quantities ----
    calcBoqAdd: function () {
      // B2: a custom line must pass the page's OWN validation first - a
      // bad field shows its message beside the input and nothing is added.
      if (!validateCustomFields()) {
        return;
      }
      const r = render();
      if (!r || r.error) {
        return;
      }
      const lines = loadBoq();
      if (lines.length >= 60) {
        return;
      }
      lines.push({ st: readState(), name: r.name });
      persistBoq(lines);
      renderBoq();
      const card = $('calc-boq-card');
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    },
    calcBoqRecall: function (el) {
      const line = loadBoq()[parseInt(el.getAttribute('data-idx'), 10)];
      if (!line) {
        return;
      }
      applyState(line.st);
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    calcBoqRemove: function (el) {
      const idx = parseInt(el.getAttribute('data-idx'), 10);
      if (isNaN(idx)) {
        return;
      }
      persistBoq(
        loadBoq().filter(function (x, i) {
          return i !== idx;
        })
      );
      renderBoq();
    },
    calcBoqClear: function () {
      persistBoq([]);
      renderBoq();
    },
    // ---- P7 (directive 2026-10-18): Bill -> RFQ --------------------------
    // Serialise the bill's lines in their CANONICAL engine units (C1: the
    // same qty/computeFor number the estimate prices, never a display
    // conversion) into a shared same-origin key. The Procurement tab
    // (project.html) reads that key and turns the lines into an RFQ draft
    // the quote writer can send. Device-local handoff - nothing leaves the
    // browser here.
    calcBoqRfq: function () {
      const note = $('calc-rfq-note');
      const lines = loadBoq();
      if (!lines.length) {
        if (note) {
          note.textContent = 'No lines yet - add work to the bill first, then request prices.';
        }
        return;
      }
      const rfq = [];
      lines.forEach(function (line) {
        const r = computeFor(line.st || {});
        if (!r || r.error) {
          return;
        }
        rfq.push({
          name: (line.name || r.name || 'Line').toString().slice(0, 120),
          // Canonical engine quantity + unit (C1), rounded for a quote line.
          qty: Math.round(Number(r.qty) * 1000) / 1000,
          unit: (r.unit || '').toString().slice(0, 24),
          currency: r.currency || DEFAULT_CURRENCY
        });
      });
      if (!rfq.length) {
        if (note) {
          note.textContent = 'None of these lines priced cleanly - fix them, then request prices.';
        }
        return;
      }
      try {
        localStorage.setItem(
          'mmgr_rfq_draft',
          JSON.stringify({ lines: rfq, at: new Date().toISOString(), from: 'calculator' })
        );
      } catch (e) {
        if (note) {
          note.textContent =
            'This browser blocked local storage, so the bill could not be handed over.';
        }
        return;
      }
      if (note) {
        note.textContent =
          rfq.length +
          ' line' +
          (rfq.length === 1 ? '' : 's') +
          ' sent to Procurement. Open a project, go to Procurement, and write the quote.';
      }
    },
    // ---- W2 element instances ----
    calcInstAdd: function () {
      const key = ($('calc-work') || {}).value || '';
      const kind = INSTANCE_KINDS[key];
      if (!kind) {
        return;
      }
      instRows.push({
        label: INSTANCE_LABEL[kind] + ' ' + (instRows.length + 1),
        d1: '',
        d2: '',
        d3: '',
        n: 1
      });
      renderInstances();
      render();
    },
    calcInstDel: function (el) {
      const idx = parseInt(el.getAttribute('data-idx'), 10);
      if (isNaN(idx)) {
        return;
      }
      instRows.splice(idx, 1);
      renderInstances();
      render();
    },
    // ---- W2.7 openings editor ----
    calcOpenAdd: function () {
      openRows.push({ type: 'window', w: '', h: '', n: 1 });
      renderOpenings();
      render();
    },
    calcOpenDel: function (el) {
      const idx = parseInt(el.getAttribute('data-idx'), 10);
      if (isNaN(idx)) {
        return;
      }
      openRows.splice(idx, 1);
      renderOpenings();
      render();
    },
    // ---- W4 preliminaries ----
    calcPrelimPreset: function () {
      prelimItems = PRELIM_PRESET_RES.map(function (x) {
        return { name: x.name, basis: x.basis, value: x.value, weeks: x.weeks };
      });
      persistPrelims(prelimItems);
      renderPrelims();
    },
    calcPrelimAdd: function () {
      if (prelimItems.length >= 30) {
        return;
      }
      prelimItems.push({ name: '', basis: 'fixed', value: '', weeks: '' });
      persistPrelims(prelimItems);
      renderPrelims();
    },
    calcPrelimRemove: function (el) {
      const idx = parseInt(el.getAttribute('data-idx'), 10);
      if (isNaN(idx)) {
        return;
      }
      prelimItems.splice(idx, 1);
      persistPrelims(prelimItems);
      renderPrelims();
    },
    calcPrelimClear: function () {
      prelimItems = [];
      persistPrelims(prelimItems);
      renderPrelims();
    },
    // ---- W6 cash flow ----
    calcCashCsv: function () {
      const msg = $('calc-cash-msg');
      const say = function (t) {
        if (msg) {
          msg.textContent = t;
          msg.hidden = !t;
        }
      };
      say('');
      const months = parseInt(($('calc-months') || {}).value, 10);
      if (!(months > 0)) {
        say('Set the build duration in months first - then export the cash plan.');
        return;
      }
      const works = prelimWorks();
      const pref = rollupPrefs();
      const r = rollup({
        works: works,
        prelims: prelimsTotal(prelimItems, works).total,
        designC: pref.designC,
        constrC: pref.constrC,
        escPct: pref.escPct,
        months: months
      });
      if (!(r.subtotal > 0)) {
        say(
          'Add priced work to the bill first - the cash plan spreads the money you are spending.'
        );
        return;
      }
      const mode = ($('calc-cash-mode') || {}).value || 'scurve';
      const c = cashCurve(r.subtotal, months, mode, '3.2');
      const cur = ($('calc-currency') || {}).value || DEFAULT_CURRENCY;
      // Same table shape as the estimate export (owner 2026-10-02): a heading
      // the reader can see, then Month / Spend / Cumulative with real numbers.
      // Money columns are numbers, not pre-formatted strings, so the file opens
      // ready to sum in a spreadsheet.
      const rows = [
        [docTitleBase() + ' - cash plan', '', ''],
        ['Exported', new Date().toISOString().slice(0, 10), ''],
        ['Build duration', months + ' months', ''],
        [
          'Curve',
          mode === 'straight' ? 'Straight-line (even months)' : 'S-curve (spend peaks mid-build)',
          ''
        ],
        ['Currency', cur, ''],
        ['Total spread', '', Math.round(r.subtotal)],
        [],
        ['Month', 'Spend', 'Cumulative']
      ];
      c.per.forEach(function (v, i) {
        rows.push([i + 1, Math.round(v), Math.round(c.cum[i])]);
      });
      rows.push(['TOTAL', Math.round(r.subtotal), '']);
      rows.push([]);
      rows.push(['Planning-grade cash plan - not a quote.']);
      const blob = new Blob(
        [
          '\uFEFF' +
            rows
              .map(function (row) {
                return row
                  .map(function (cell) {
                    return '"' + String(cell == null ? '' : cell).replace(/"/g, '""') + '"';
                  })
                  .join(',');
              })
              .join('\r\n')
        ],
        { type: 'text/csv;charset=utf-8' }
      );
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download =
        slug(docTitleBase()) + '-cash-plan-' + new Date().toISOString().slice(0, 10) + '.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () {
        URL.revokeObjectURL(a.href);
      }, 500);
    },
    // ---- W7 concrete accessories ----
    calcFormworkAdd: function () {
      const st = readState();
      const m2 = formworkM2(st.work, st.d1, st.d2, st.d3);
      if (!m2) {
        return;
      }
      const rateRaw = parseFloat(($('calc-formwork-rate') || {}).value);
      const rate = isFinite(rateRaw) && rateRaw > 0 ? rateRaw : FORM_RATE_DEFAULT;
      const lines = loadBoq();
      if (lines.length >= 60) {
        return;
      }
      // Formwork is priced as its own bill line through the REAL formwork
      // trade with measuredQty carrying the derived m2 (2026-10-01 fix: the
      // line previously stored markers computeFor never read, so it priced
      // as a duplicate of the slab). Rates stay user-owned; waste/piece
      // fields are cleared so the derived quantity is the whole story.
      const lineSt = Object.assign({}, st, {
        work: 'formwork',
        measuredQty: String(m2),
        // C1: programmatic writers declare engine units explicitly.
        measuredEntry: 'eng',
        measuredAuto: '',
        measuredUnit: 'm2',
        instances: '[]',
        rateMat: String(rate),
        rateLab: '',
        _matModel: undefined,
        _labModel: undefined,
        piecePrice: '',
        pieceSize: '',
        wastePct: '',
        derivedFrom: st.work + ':formwork'
      });
      lines.push({ st: lineSt, name: 'Formwork ' + m2.toLocaleString() + ' m2' });
      persistBoq(lines);
      renderBoq();
    },
    // ---- W2 companion chips ----
    // ---- X1 linter one-tap fixes: add a REAL derived bill line, same
    // mechanism as the companion chips (fully editable, recall-able).
    calcLintFix: function (el) {
      const work = el.getAttribute('data-fix');
      const lines = loadBoq();
      if (!work || lines.length >= 60) {
        return;
      }
      // The quantity derives from the first line that the flag came from:
      // formwork from the first pour's contact area; cart-away from the
      // first dig/pour volume (the same allowance basis as the cart3 chip).
      const src = lines
        .map(function (l) {
          return l && l.st;
        })
        .filter(function (s) {
          return (
            s &&
            WORK[s.work] &&
            (work === 'formwork'
              ? s.work === 'slab' || s.work === 'footings' || s.work === 'concrete-drive'
              : s.work === 'excav' ||
                s.work === 'slab' ||
                s.work === 'footings' ||
                s.work === 'concrete-drive')
          );
        })[0];
      if (!src) {
        return;
      }
      let qty = 0;
      if (work === 'formwork') {
        qty = formworkM2(src.work, parseFloat(src.d1), parseFloat(src.d2), parseFloat(src.d3)) || 0;
      } else {
        const r = computeFor(
          Object.assign({}, src, {
            measuredQty: src.measuredQty || src.measuredAuto,
            // C1: the typed value keeps its own declaration; a fall-back to the
            // derived total is an engine-unit number.
            measuredEntry: src.measuredQty ? src.measuredEntry || 'eng' : 'eng'
          })
        );
        qty = r && !r.error ? r.qty : 0;
      }
      if (!(qty > 0)) {
        sheetMsg(
          'Could not derive the quantity from the bill - price ' +
            (WORK[work] ? WORK[work].d1 || 'it' : 'it') +
            ' by hand.'
        );
        return;
      }
      const lineSt = Object.assign({}, src, {
        work: work,
        measuredQty: String(Math.round(qty * 100) / 100),
        measuredAuto: '',
        measuredUnit: WORK[work].q(1).unit,
        instances: '[]',
        openings: '[]',
        rateMat: '',
        rateLab: '',
        _matModel: undefined,
        _labModel: undefined,
        piecePrice: '',
        pieceSize: '',
        wastePct: '',
        derivedFrom: 'lint:' + work + ':' + src.work
      });
      lines.push({
        st: lineSt,
        name:
          (work === 'formwork' ? 'Formwork ' : 'Cart away ') +
          (Math.round(qty * 100) / 100).toLocaleString() +
          ' ' +
          WORK[work].q(1).unit
      });
      persistBoq(lines);
      renderBoq();
      sheetMsg(
        'Added the missing ' +
          (work === 'formwork' ? 'formwork' : 'cart-away') +
          ' line - edit it any time.'
      );
    },
    calcCompAdd: function (el) {
      const id = el.getAttribute('data-cp');
      const def = COMPANION_DEFS[id];
      if (!def) {
        return;
      }
      const st = readState();
      const qty = def.qty(st);
      if (!(qty > 0)) {
        return;
      }
      const lines = loadBoq();
      if (lines.length >= 60) {
        return;
      }
      // Same derived-line mechanism as formwork: a real WORK entry priced by
      // measuredQty through the one math path. Bill lines stay fully
      // editable/removable; recall re-fills the form as a plain measured
      // quantity of that trade.
      const lineSt = Object.assign({}, st, {
        work: def.work,
        measuredQty: String(qty),
        // C1: a derived bill line is always in the engine unit.
        measuredEntry: 'eng',
        measuredAuto: '',
        measuredUnit: WORK[def.work].q(1).unit,
        instances: '[]',
        rateMat: '',
        rateLab: '',
        _matModel: undefined,
        _labModel: undefined,
        piecePrice: '',
        pieceSize: '',
        wastePct: '',
        derivedFrom: st.work + ':' + id
      });
      lines.push({ st: lineSt, name: def.name });
      persistBoq(lines);
      renderBoq();
      renderCompanions(lastResult);
    },
    // ---- W3 business details + document fields ----
    calcBrandOpen: function (el) {
      const body = $('calc-brand-body');
      if (!body) {
        return;
      }
      body.hidden = !body.hidden;
      if (el) {
        el.setAttribute('aria-expanded', String(!body.hidden));
        el.textContent = body.hidden ? 'Show' : 'Hide';
      }
      try {
        localStorage.setItem('mmgr_calc_brand_open', body.hidden ? '' : '1');
      } catch (e) {}
    },
    calcLogoRemove: function () {
      brandSave({ logo: null });
      renderBrand();
      render();
    },
    calcBrandToggle: function (el) {
      brandSave({ sigShow: el.checked ? 'on' : '' });
      render();
    },
    // ---- W8 location packs ----
    calcPackApply: function (el) {
      const sel = $('calc-pack-select');
      const id = el && el.tagName === 'SELECT' ? el.value : sel ? sel.value : '';
      if (!id) {
        return;
      }
      applyPackById(id);
      if (sel) {
        sel.selectedIndex = 0;
      }
    },
    calcPackExport: function () {
      const list = loadPacks();
      if (!list.length) {
        sheetMsg('No location packs to export yet.');
        return;
      }
      const payload = JSON.stringify(
        { version: 1, exported: new Date().toISOString().slice(0, 10), packs: list },
        null,
        2
      );
      const blob = new Blob([payload], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'mmgr-calc-location-packs-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () {
        URL.revokeObjectURL(a.href);
      }, 500);
      sheetMsg('Exported ' + list.length + ' location pack(s).');
    },
    calcPackImport: function () {
      const f = $('calc-pack-file');
      if (f) {
        f.click();
      }
    },
    calcInstToggle: function () {
      const wrap = $('calc-instances');
      const manual = $('calc-measured-manual');
      if (!wrap || !manual) {
        return;
      }
      wrap.hidden = manual.checked;
      const q = $('calc-measured-qty');
      if (q) {
        q.hidden = !manual.checked;
      }
      renderInstances();
      render();
    },
    // ---- D2 comparison ----
    calcCompare: renderCompare,
    calcCompareClose: function () {
      const card = $('calc-compare-card');
      if (card) {
        card.hidden = true;
      }
      document.querySelectorAll('.bcp-cmp-check:checked').forEach(function (c) {
        c.checked = false;
      });
    },
    // ---- Rate sheets ----
    calcSheetSave: function () {
      const nameEl = $('calc-sheet-name');
      const name = ((nameEl && nameEl.value) || '').trim();
      if (!name) {
        if (nameEl) {
          nameEl.focus();
          nameEl.placeholder = 'Name it first - e.g. low-bid';
        }
        return;
      }
      const matEl = $('calc-rate-mat'),
        labEl = $('calc-rate-lab');
      if (!matEl || !matEl.value || !labEl || !labEl.value) {
        return;
      }
      const list = loadSheets().filter(function (sh) {
        return sh.name.toLowerCase() !== name.toLowerCase();
      });
      list.unshift({
        id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), // ok: non-secret
        name: name,
        at: new Date().toISOString().slice(0, 10),
        rates: {
          rateMat: matEl.value,
          rateLab: labEl.value,
          piecePrice: ($('calc-piece-price') || {}).value || '',
          pieceSize: ($('calc-piece-size') || {}).value || ''
        }
      });
      persistSheets(list);
      if (nameEl) {
        nameEl.value = '';
        nameEl.placeholder = 'e.g. low-bid, sustain';
      }
      matEl.dataset.sheet = name;
      renderSheets();
    },
    calcSheetApply: function (el) {
      applySheetById(el.getAttribute('data-id'));
    },
    calcSheetDelete: function (el) {
      const id = el.getAttribute('data-id');
      persistSheets(
        loadSheets().filter(function (x) {
          return x.id !== id;
        })
      );
      renderSheets();
    },
    // ---- D1 (owner review 2026-09-29): rate-sheet transfer ----------------
    // Export downloads every saved sheet as a JSON file; import merges a file
    // back in (same-name sheets replace, malformed entries are skipped).
    calcSheetExport: function () {
      const list = loadSheets();
      if (!list.length) {
        sheetMsg('No saved rate sheets to export yet.');
        return;
      }
      const payload = JSON.stringify(
        { version: 1, exported: new Date().toISOString().slice(0, 10), sheets: list },
        null,
        2
      );
      const blob = new Blob([payload], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'mmgr-calc-rate-sheets-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () {
        URL.revokeObjectURL(a.href);
      }, 500);
      sheetMsg('Exported ' + list.length + ' rate sheet(s).');
    },
    calcSheetImport: function () {
      const f = $('calc-sheet-file');
      if (f) {
        f.click();
      }
    },
    // ---- E1 (plan v2 Phase 1): exchange rates -----------------------------
    calcFxSave: function () {
      const sel = $('calc-fx-code'),
        rateEl = $('calc-fx-rate'),
        dateEl = $('calc-fx-asof');
      const code = sel && sel.value;
      const per = parseFloat(rateEl && rateEl.value);
      if (!code) {
        sheetMsg('Pick the currency first.');
        return;
      }
      if (!isFinite(per) || per <= 0) {
        sheetMsg('Enter the rate: how many ' + code + ' per 1 US dollar.');
        return;
      }
      const t = loadFx();
      t[code] = {
        per: per,
        asOf: (dateEl && dateEl.value) || new Date().toISOString().slice(0, 10)
      };
      persistFx(t);
      renderFx();
      refreshRateFields();
      render();
      sheetMsg('Exchange rate saved: ' + per + ' ' + code + ' per 1 US dollar.');
    },
    calcFxDel: function (el) {
      const code = el.getAttribute('data-code');
      if (!code) {
        return;
      }
      const t = loadFx();
      delete t[code];
      persistFx(t);
      renderFx();
      refreshRateFields();
      render();
    },
    // ---- E4 (plan v2 Phase 1): rate books ---------------------------------
    calcBookExport: function () {
      const list = loadBooks();
      if (!list.length) {
        sheetMsg('No rate books imported yet.');
        return;
      }
      const payload = JSON.stringify(
        { version: 1, exported: new Date().toISOString().slice(0, 10), books: list },
        null,
        2
      );
      const blob = new Blob([payload], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'mmgr-calc-rate-books-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () {
        URL.revokeObjectURL(a.href);
      }, 500);
      sheetMsg('Exported ' + list.length + ' rate book(s).');
    },
    calcBookImport: function () {
      const f = $('calc-book-file');
      if (f) {
        f.click();
      }
    },
    calcBookClear: function () {
      setActiveBook('');
      renderBooks();
      refreshRateFields();
      render();
      sheetMsg('Rate book cleared - the built-in model rates prefill again.');
    },
    // Owner directive 2026-10-01: one-tap fix for a flagged unit slip.
    calcFixDim: function (el) {
      const f = el.getAttribute('data-field'),
        v = el.getAttribute('data-val');
      const input = f ? $('calc-' + f) : null;
      if (input && v != null && v !== '') {
        input.value = v;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    },
    calcSheetPick: null
  };

  document.addEventListener('click', function (e) {
    const el = e.target.closest('[data-action]');
    if (!el) {
      return;
    }
    const fn = ACTIONS[el.getAttribute('data-action')];
    if (fn) {
      fn(el);
    }
  });
  // Checkboxes and selects with data-action fire 'change', not a click that
  // carries a value in every browser - dispatch them on change as well (W3:
  // the signature-lines toggle is the first checkbox action on this page).
  document.addEventListener('change', function (e) {
    const el = e.target.closest('[data-action]');
    if (!el) {
      return;
    }
    const fn = ACTIONS[el.getAttribute('data-action')];
    if (fn && el.tagName === 'INPUT' && el.type === 'checkbox') {
      fn(el);
    }
  });

  // Rate-sheet quick picker: choosing a sheet in the <select> applies it.
  // The select carries the sheet id as its option VALUE (row buttons carry
  // data-id) - resolve by value here, then snap back to the placeholder row.
  document.addEventListener('change', function (e) {
    const el = e.target.closest('[data-action="calcSheetPick"]');
    if (!el || !el.value) {
      return;
    }
    applySheetById(el.value);
    el.selectedIndex = 0;
  });
  // W8 location-pack picker: same value-apply-then-snap convention.
  document.addEventListener('change', function (e) {
    const el = e.target.closest('[data-action="calcPackApply"]');
    if (!el || !el.value) {
      return;
    }
    applyPackById(el.value);
    el.selectedIndex = 0;
  });

  // D1: the hidden file input behind the Import button. Every failure path
  // reports in the status line - a bad file never throws, never clears storage.
  document.addEventListener('change', function (e) {
    if (e.target.id === 'calc-pack-file') {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) {
        return;
      }
      const reader = new FileReader();
      reader.onload = function () {
        let json = null;
        try {
          json = JSON.parse(String(reader.result));
        } catch (err) {
          json = null;
        }
        const res = importPacks(json);
        if (res === null) {
          sheetMsg('That file is not a My MaNaGeR location pack export.');
          return;
        }
        sheetMsg(
          'Imported ' +
            res.merged +
            ' location pack(s)' +
            (res.skipped ? ' (' + res.skipped + ' skipped).' : '.')
        );
      };
      reader.readAsText(file);
      return;
    }
    if (e.target.id !== 'calc-sheet-file') {
      return;
    }
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // allow re-choosing the same file
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = function () {
      let json = null;
      try {
        json = JSON.parse(String(reader.result));
      } catch (err) {
        json = null;
      }
      const res = importSheets(json);
      if (res === null) {
        sheetMsg('That file is not a My MaNaGeR rate sheet export.');
        return;
      }
      sheetMsg(
        'Imported ' +
          res.merged +
          ' rate sheet(s)' +
          (res.skipped ? ' (' + res.skipped + ' skipped - missing name or rates).' : '.')
      );
    };
    reader.readAsText(file);
  });

  // E4: the rate-book file input - same contract as sheets/packs. A bad file
  // reports in the status line and never throws, never clears storage.
  document.addEventListener('change', function (e) {
    if (!e.target || e.target.id !== 'calc-book-file') {
      return;
    }
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = function () {
      let json = null;
      try {
        json = JSON.parse(String(reader.result));
      } catch (err) {
        json = null;
      }
      const res = importBooks(json);
      if (res === null) {
        sheetMsg('That file is not a My MaNaGeR rate book export (expected { books: [...] }).');
        return;
      }
      sheetMsg(
        'Imported ' +
          res.merged +
          ' rate book(s)' +
          (res.skipped
            ? ' (' + res.skipped + ' entries skipped - unknown items or bad rates)'
            : '') +
          (res.badKeys ? '; ' + res.badKeys + ' unknown work key(s) rejected.' : '.')
      );
    };
    reader.readAsText(file);
  });

  // E4: choosing a book in the select makes it the ACTIVE book (value-apply-
  // then-snap, same convention as sheets/packs). Its rates drive the prefill.
  document.addEventListener('change', function (e) {
    const el = e.target.closest('[data-action="calcBookPick"]');
    if (!el) {
      return;
    }
    setActiveBook(el.value);
    el.selectedIndex = 0;
    renderBooks();
    refreshRateFields();
    render();
    const a = activeBook();
    sheetMsg(
      a
        ? 'Rate book "' + a.name + '" applied - its rates prefill the model fields.'
        : 'Rate book cleared - the built-in model rates prefill again.'
    );
  });

  // Pricing basis change: same delegation style as the book picker above, so
  // the chooser works before and after a snapshot restore.
  document.addEventListener('change', function (e) {
    const el = e.target.closest('[data-action="calcBasisPick"]');
    if (!el) {
      return;
    }
    // G1: the basis decides whether the split is derived (all-in) or cleared
    // (measured, days), so the rate fields are refreshed with the new choice.
    refreshRateFields();
    syncBasis();
    render();
  });

  // The all-in field's two notifiers react to typing: the published-rate note
  // appears as soon as the typed value stops matching the book's prefill, and
  // the checked-on stamp stays visible for the life of the line.
  ['calc-allin', 'calc-allin-verified'].forEach(function (id) {
    const el = $(id);
    if (!el) {
      return;
    }
    el.addEventListener('input', function () {
      // Owner 2026-10-12 (G1): a typed headline re-derives the split so the
      // two sides always add up to the figure above them. Typing on this line
      // also CLAIMS the headline for the trade showing on the form.
      if (id === 'calc-allin') {
        el.dataset.work = ($('calc-work') || {}).value || '';
        syncSplitFromAllin();
        // G1: a cleared headline drops its split (nothing to be a split of),
        // a typed one re-derives it - both live here so the input event alone
        // is enough to keep the two in step.
        prefillSplitFromAllin();
      }
      syncBookNote();
      render();
    });
  });
  ['calc-days', 'calc-day-rate'].forEach(function (id) {
    const el = $(id);
    if (!el) {
      return;
    }
    el.addEventListener('input', function () {
      render();
    });
  });

  // Print scope is class-scoped; window.print() blocks, so remove the class
  // right after it returns (covers the common browsers' dialog lifecycle;
  // afterprint is the standards path where it fires).
  window.addEventListener('afterprint', function () {
    document.body.classList.remove('print-estimate');
    // C3: the screen goes back to whole units once the document is away.
    if (docMoney) {
      docMoney = false;
      render();
    }
  });

  // D3: the export-row business name now saves into the brand store (the
  // card's name field mirrors it - both write the same key since W3).
  (function () {
    const el = $('calc-biz-name');
    if (!el) {
      return;
    }
    el.addEventListener('input', function () {
      brandSave({ name: el.value.trim() });
      const cardEl = $('calc-brand-name');
      if (cardEl && document.activeElement !== cardEl) {
        cardEl.value = el.value.trim();
      }
      render();
    });
  })();

  // ---- Rate fields (F4b): prefill from the model, label with units, --------
  // piece rows show only on trades that have a piece spec.
  function rateUnitLabel(key) {
    const w = WORK[key];
    if (!w) {
      return '';
    }
    // E3: a declared rate-entry unit (from the trade or its active variant)
    // names the basis exactly as the rate source speaks it.
    const vSel = $('calc-variant');
    const ru =
      (vSel && vSel.value && w.variants ? (variantFor(key, vSel.value) || {}).runit : null) ||
      w.runit;
    if (ru) {
      return 'per ' + ru;
    }
    const map = { m2: 'per m2', m3: 'per m3', m: 'per m', t: 'per tonne', L: 'per litre' };
    const imp = _units === 'imperial';
    const impMap = {
      m2: 'per sq ft',
      m3: 'per cu yd',
      m: 'per ft',
      t: 'per tonne',
      L: 'per litre'
    };
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
    if (!w) {
      return;
    }
    const d = currentDims();
    const matEl = $('calc-rate-mat'),
      labEl = $('calc-rate-lab');
    if (!matEl || !labEl) {
      return;
    }
    // E1+E4: the prefill rate comes from the active rate book first, then
    // the WORK model (or the active variant), ALREADY converted into the
    // estimate currency through the FX table. When the pair is missing the
    // fields stay EMPTY and the note says so - never a silent relabel
    // (that was audit A1: JMD users saw relabelled USD).
    const cur = ($('calc-currency') || {}).value || BASE_CURRENCY;
    const m = modelRatesFor(key, ($('calc-variant') || {}).value || '', cur, d.d1, d.d2);
    const fxNote = $('calc-fx-note');
    // Warn whenever the prefill rate could not be brought into the estimate
    // currency - including a foreign book with a USD estimate (the flag
    // already knows; the target being the base currency is no excuse).
    const needNote = !m || m.unconvertible;
    if (fxNote) {
      fxNote.hidden = !needNote;
      if (needNote) {
        fxNote.textContent =
          'Model rates are ' +
          (m && m.unconvertible ? 'in ' + m.src + ' (imported rate book)' : 'US dollars') +
          ' - set a ' +
          cur +
          ' exchange rate in the Exchange rates card below, or type your own rates, to price in ' +
          cur +
          '.';
      }
    }
    const modelM =
      m && !m.unconvertible && m.mat != null ? String(Math.round(m.mat * 100) / 100) : '';
    const modelL = m && !m.unconvertible && m.lab != null ? String(m.lab) : '';
    // The all-in figure prefills on exactly the same contract as the split
    // rates: the book's number is a DEFAULT, an untouched prefill follows the
    // model, and anything the user typed is never overwritten (D4 - the book
    // is a default, never a lock). dataset.model is what tells a book-filled
    // value apart from a typed one, which is what raises the market-rate note.
    const allEl = $('calc-allin');
    const modelA =
      m && !m.unconvertible && m.allIn != null ? String(Math.round(m.allIn * 100) / 100) : '';
    if (allEl) {
      // Owner 2026-10-12 (G1): a headline BELONGS to the trade it was filled
      // for - by this book/model prefill, by the recalled snapshot, or later
      // by the user typing on this very line. Recording that trade is what
      // keeps a figure left over from another trade from ever being broken
      // down into a fake material/labour split on a trade the book does not
      // cover (the NC1 honesty gate).
      if (recallHold) {
        if (modelA !== '' && allEl.value === '') {
          allEl.value = modelA;
          allEl.dataset.model = modelA;
        }
        allEl.dataset.work = key;
      } else if (modelA !== '') {
        if (allEl.value === '' || allEl.value === allEl.dataset.model) {
          allEl.value = modelA;
        }
        allEl.dataset.model = modelA;
        allEl.dataset.work = key;
      } else if (allEl.value === allEl.dataset.model) {
        allEl.value = '';
        allEl.dataset.model = '';
      }
    }
    if (recallHold) {
      // Recalling a snapshot: only truly-empty fields take a fresh prefill;
      // restored field+marker pairs are left exactly as they were saved.
      if (modelM !== '') {
        if (matEl.value === '') {
          matEl.value = modelM;
          matEl.dataset.model = modelM;
        }
        if (labEl.value === '') {
          labEl.value = modelL;
          labEl.dataset.model = modelL;
        }
      }
    } else if (modelM !== '') {
      // Prefill empty fields; an UNTOUCHED prefill (value === what we last put
      // there) follows the model when dimensions change the model rate. A typed
      // override is never overwritten - that is the rate freedom.
      if (matEl.value === '' || matEl.value === matEl.dataset.model) {
        matEl.value = modelM;
      }
      if (labEl.value === '' || labEl.value === labEl.dataset.model) {
        labEl.value = modelL;
      }
      matEl.dataset.model = modelM;
      labEl.dataset.model = modelL;
    } else {
      // A stale prefill from another item (or an unconvertible book) must not
      // linger as fake money - an untouched prefill clears; typed rates stay.
      if (matEl.value === matEl.dataset.model) {
        matEl.value = '';
        matEl.dataset.model = '';
      }
      if (labEl.value === labEl.dataset.model) {
        labEl.value = '';
        labEl.dataset.model = '';
      }
    }
    $('calc-rate-mat-label').textContent = 'Material rate ' + rateUnitLabel(key);
    $('calc-rate-lab-label').textContent = 'Labor rate ' + rateUnitLabel(key);
    const eqLbl = $('calc-rate-eq-label');
    if (eqLbl) {
      eqLbl.textContent = 'Equipment / plant hire ' + rateUnitLabel(key);
    }
    // B1 waste field: only trades with a waste spec; label names the allowance,
    // empty field prefills the trade default (typed values are never clobbered).
    const ww = $('calc-waste-wrap'),
      we = $('calc-waste');
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
    // OWNER 2026-10-02: when the trade ALREADY offers a size list (the variant
    // picker - block sizes, blockwork pocket/elevation), the rate sheet carries
    // those sizes, so "price per piece / piece size" is a SPECIAL CASE for a
    // size the sheet does not list. Those trades get an opt-in toggle and the
    // row starts hidden; trades with no size list keep the fields as they were.
    const pw = $('calc-piece-wrap'),
      priceEl = $('calc-piece-price'),
      sizeEl = $('calc-piece-size');
    const custom = $('calc-piece-custom'),
      customWrap = $('calc-piece-custom-wrap');
    const hasSizeList = !!(w && w.piece && w.variants && w.variants.length > 1);
    if (pw) {
      pw.hidden = !w.piece || (hasSizeList && !(custom && custom.checked));
      pw.classList.toggle('bcp-piece-custom-on', hasSizeList && !!(custom && custom.checked));
    }
    if (customWrap) {
      // A trade with piece pricing but NO size list keeps the old behaviour: the
      // price/size fields simply show, with no opt-in - so the row goes "plain"
      // (switch hidden, drawer always open) instead of disappearing.
      const hasPiece = !!(w && w.piece);
      customWrap.hidden = !hasPiece;
      customWrap.classList.toggle('is-plain', hasPiece && !hasSizeList);
      if (hasSizeList && custom && custom.dataset.phWork !== key) {
        // UI-2: the row's words are now a real .set-name span. The old write
        // went through custom.parentElement.lastChild, which is the .tgl's
        // knob - it painted the label INSIDE the switch. Target the name by id.
        const nameEl = $('calc-piece-custom-name');
        if (nameEl) {
          nameEl.textContent =
            'My ' +
            (w.piece.priceLabel || 'piece').replace(/^Price per /i, '').toLowerCase() +
            ' is not in the rate sheet - price it myself';
        }
        custom.dataset.phWork = key;
      }
      ui2RowsSync();
    }
    if (w.piece && priceEl && sizeEl) {
      $('calc-piece-price-label').textContent = w.piece.priceLabel;
      // Volume specs take a single yield number (unit-free - a 20 L bag is a
      // 20 L bag in any unit system); dimensioned specs convert cm->in, m->ft.
      $('calc-piece-size-label').textContent =
        w.piece.div === 'volume'
          ? w.piece.sizeLabel
          : _units === 'imperial'
            ? w.piece.sizeLabel.replace('(cm)', '(in)').replace('(m)', '(ft)')
            : w.piece.sizeLabel;
      if (!priceEl.placeholder || priceEl.dataset.phWork !== key) {
        priceEl.placeholder = w.piece.ph;
        sizeEl.placeholder = w.piece.phSize;
        priceEl.dataset.phWork = key;
      }
    }
    const hint = $('calc-piece-hint');
    if (hint) {
      hint.hidden = !w.piece || (hasSizeList && !(custom && custom.checked));
      if (w.piece) {
        hint.textContent =
          w.piece.div === 'volume'
            ? 'Enter the bag or container yield and its price - the estimate prices the exact quantity needed (concrete in m3, paint in litres).'
            : 'Leave empty to price by the square meter with the rate above. Fill it in to price by the piece.';
      }
    }
    // G1: the split under the all-in headline is derived after every prefill
    // pass, so it always tracks the headline that was just filled in.
    prefillSplitFromAllin();
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
    structure: {
      label: 'Structure - walls, frames, steel',
      hint: "Walls, frames and steel: carry the building's loads. Set-out lining-out and debris carting are offered with every wall."
    },
    groundworks: {
      label: 'Groundworks - clearing, excavation, concrete',
      hint: 'Below-ground work: clearing, excavation, foundations and slabs. Derived formwork appears for pours; cart-away comes with every pour.'
    },
    envelope: {
      label: 'Envelope - roof, render, paint, drywall',
      hint: 'Weather-proofing skins: roof coverings, renders, paint and drywall. Cart-away is offered to clear the offcuts.'
    },
    finishes: {
      label: 'Finishes - tiling, drives, fencing, trims',
      hint: 'What everyone sees and touches: tiling, drives, fencing and trims. Fencing offers debrushing and post holes.'
    },
    plumbing: {
      label: 'Plumbing - pipe runs, fixtures',
      hint: 'Water in, waste out: pipe runs, fixtures and rough-in packages.'
    },
    electrical: {
      label: 'Electrical - points, conduit, panels',
      hint: 'Power and light: wiring points, conduit runs and panels.'
    },
    // JIC 2025-2027 (owner 2026-10-02): new families for the 90-rate book
    'temporary-metal': {
      label: 'Temporary and metal works - scaffolding, welding',
      hint: 'Temporary access and metal work: scaffolding by height band and welding by thickness and method.'
    },
    joinery: {
      label: 'Joinery - skirtings',
      hint: 'Skirtings and baseboards by size, profile and wood species.'
    }
  };
  const WORK_FAMILY = {
    siteprep: 'groundworks',
    excav: 'groundworks',
    slab: 'groundworks',
    footings: 'groundworks',
    'septic-tank': 'groundworks',
    formwork: 'groundworks',
    'concrete-labour': 'groundworks',
    'post-holes': 'groundworks',
    blockwall: 'structure',
    brickwall: 'structure',
    framing: 'structure',
    rebar: 'structure',
    'rebar-size': 'structure',
    stirrups: 'structure',
    'fabric-mesh': 'structure',
    roof: 'envelope',
    'shingle-roof': 'envelope',
    render: 'envelope',
    paint: 'envelope',
    drywall: 'envelope',
    window: 'envelope',
    gutter: 'envelope',
    'soffit-fascia': 'envelope',
    tile: 'finishes',
    'concrete-drive': 'finishes',
    fencing: 'finishes',
    skirt: 'finishes',
    door: 'finishes',
    ceiling: 'finishes',
    'floor-screed': 'finishes',
    cabinet: 'finishes',
    'pipe-supply': 'plumbing',
    'pipe-drain': 'plumbing',
    fixture: 'plumbing',
    'bath-rough': 'plumbing',
    'water-heater': 'plumbing',
    'wire-point': 'electrical',
    conduit: 'electrical',
    panel: 'electrical',
    // JIC 2025-2027 (owner 2026-10-02): new trades added to the picker
    scaffold: 'temporary-metal',
    joinery: 'joinery',
    'plumbing-pipe': 'plumbing',
    'electrical-conduit': 'electrical',
    welding: 'temporary-metal'
  };
  const FKEY = 'mmgr_calc_family';
  // The family select only filters the VIEW: non-family optgroups hide while
  // their options stay selectable (recalls set #calc-work directly).
  function applyFamilyFilter(sel) {
    if (!sel) {
      return;
    }
    const fam = localStorage.getItem(FKEY) || '';
    const keep = fam && FAMILIES[fam] ? FAMILIES[fam].label.split(' - ')[0] : '';
    Array.prototype.forEach.call(sel.querySelectorAll('optgroup'), function (og) {
      og.hidden = !!keep && og.label !== keep;
    });
  }
  function familyHintKey(fam) {
    return fam && FAMILIES[fam] ? fam : '';
  }
  function syncFamily() {
    const sel = $('calc-work'),
      fSel = $('calc-family');
    if (!sel || !fSel) {
      return;
    }
    const key = sel.value;
    const wanted = WORK_FAMILY[key] || '';
    let fam = localStorage.getItem(FKEY) || '';
    if (wanted && fam && fam !== wanted) {
      // A foreign trade got selected (recall, pack, harness): the family
      // follows the trade - never fight the user's work item.
      fam = wanted;
      try {
        localStorage.setItem(FKEY, fam);
      } catch (e) {}
      fSel.value = fam;
    }
    applyFamilyFilter(sel);
    const hintEl = $('calc-family-hint');
    if (hintEl) {
      hintEl.textContent = familyHintKey(fam)
        ? FAMILIES[fam].hint
        : 'Pick the kind of work first - only its trades stay in the list. Choose All to see every trade.';
    }
  }
  // The family select's own change handler (delegated below - the page has
  // one dispatch convention).
  function onFamilyChange(val) {
    try {
      if (val) {
        localStorage.setItem(FKEY, val);
      } else {
        localStorage.removeItem(FKEY);
      }
    } catch (e) {}
    const sel = $('calc-work');
    if (val && sel && WORK_FAMILY[sel.value] !== val) {
      // Jump to a sensible first trade of the newly chosen family.
      const first = Object.keys(WORK_FAMILY).find(function (k) {
        return WORK_FAMILY[k] === val;
      });
      if (first) {
        sel.value = first;
      }
    }
    syncLabels();
  }

  // E2: the variant selector follows the work item - one select, hidden
  // unless the trade carries a variants list (Phase 1: excavation).
  function renderVariant() {
    const wrap = $('calc-variant-wrap'),
      sel = $('calc-variant');
    if (!wrap || !sel) {
      return;
    }
    const w = WORK[($('calc-work') || {}).value];
    const vs = w && w.variants;
    wrap.hidden = !vs;
    if (!vs) {
      sel.innerHTML = '';
      return;
    }
    sel.innerHTML = vs
      .map(function (v) {
        return '<option value="' + esc(v.id) + '">' + esc(v.label) + '</option>';
      })
      .join('');
    if (
      !vs.some(function (v) {
        return v.id === sel.value;
      })
    ) {
      sel.value = vs[0].id;
    }
  }

  function syncLabels() {
    const key = ($('calc-work') || {}).value;
    const w = WORK[key];
    if (!w) {
      return;
    }
    syncFamily();
    $('calc-d1-label').textContent = dimLabel(w, 'd1');
    $('calc-d2-label').textContent = dimLabel(w, 'd2') || '';
    $('calc-d2-wrap').hidden = !w.d2;
    $('calc-d2').hidden = !w.d2;
    $('calc-d3-label').textContent = dimLabel(w, 'd3') || '';
    $('calc-d3-wrap').hidden = !w.d3;
    $('calc-d3').hidden = !w.d3;
    // B1: the custom choice reveals name + unit + quantity + rate and hides
    // nothing else; any other pick leaves those four empty and hidden.
    const cWrap = $('calc-custom-wrap');
    if (cWrap) {
      cWrap.hidden = key !== 'custom';
      if (key !== 'custom') {
        ['calc-custom-name', 'calc-custom-unit', 'calc-custom-qty', 'calc-custom-rate'].forEach(
          function (id) {
            const fe = $(id);
            if (fe) {
              fe.value = '';
            }
            const ee = $(id + '-err');
            if (ee) {
              ee.hidden = true;
              ee.textContent = '';
            }
          }
        );
      }
    }
    // Country default tax hint follows selection when no custom override.
    const c = ($('calc-country') || {}).value;
    if ($('calc-country') && !$('calc-tax-override').value) {
      $('calc-country').selectedOptions[0].textContent = countryLabel(c);
    }
    // W3: the Contractors Levy note is Jamaica-specific.
    const jmNote = $('calc-jm-levy-note');
    if (jmNote) {
      jmNote.hidden = c !== 'JM';
    }
    // W2: instance editor follows the work item (rows re-seed per trade).
    renderInstances();
    // W2.7: the openings editor appears only on wall-area trades.
    renderOpenings();
    // E2: the variant selector follows the trade.
    renderVariant();
    // PART I PHASE 2: the JIC picker follows the work item (the same owner
    // as the variant selector - per-item field visibility lives in syncLabels).
    renderJicPicker();
    // W7: the rebar laps field rides the rebar trade only (same home as the
    // d2/d3 wrap hiding - syncLabels owns per-trade field visibility).
    const rlWrap = $('calc-rebar-laps-wrap'),
      rlEl = $('calc-rebar-laps');
    if (rlWrap && rlEl) {
      rlWrap.hidden = key !== 'rebar';
      if (key !== 'rebar') {
        rlEl.value = '';
      }
    }
    syncBasis();
    refreshRateFields();
  }

  // ---- Pricing basis: measured / all-in rate / crew days (owner 2026-10-02)
  // One chooser drives which inputs are visible. Everything starts hidden, so a
  // line priced the ordinary measured way looks and behaves exactly as before.
  //
  // Changing the chooser does NOT wipe what was typed in the other mode: the
  // engine decides which figures price the line, and a user comparing two ways
  // of pricing the same work should not lose the first one. The basis is part
  // of the snapshot, so a recall restores the same view it was saved in.
  function syncBasis() {
    const key = ($('calc-work') || {}).value || '';
    const sel = $('calc-basis');
    if (!sel) {
      return;
    }
    const mode = sel.value || 'measured';
    const onAllin = mode === 'allin',
      onDays = mode === 'days';
    if ($('calc-allin-wrap')) {
      $('calc-allin-wrap').hidden = !onAllin;
    }
    // The "checked against JIC on" stamp only means anything on an all-in line.
    if ($('calc-verified-wrap')) {
      $('calc-verified-wrap').hidden = !onAllin;
    }
    if ($('calc-days-wrap')) {
      $('calc-days-wrap').hidden = !onDays;
    }
    if ($('calc-day-rate-wrap')) {
      $('calc-day-rate-wrap').hidden = !onDays;
    }
    // Owner 2026-10-12 (G1): the per-unit row used to step aside for the
    // all-in field ("it would invite a faked split"). It now STAYS VISIBLE
    // under the headline, because the split is no longer faked - it is derived
    // from the trade's own mat/lab share of the published figure and the user
    // may override either side. This is the FORM's breakdown only: the output
    // and CSV still print one combined "Work rate (all-in)" row, so D3 (a
    // combined figure is never broken into parts ON A DOCUMENT) is unchanged.
    const ratesRow = $('calc-rates-row');
    if (ratesRow) {
      ratesRow.hidden = false;
    }
    // The all-in field follows the trade's rate unit and the picked currency,
    // so a per-yd2 trade says "per yd2" and nobody has to guess the money.
    const ru = (WORK[key] || {}).runit;
    if ($('calc-allin-label')) {
      $('calc-allin-label').textContent = syncAllinCurrencyLabel();
    }
    // Notifier 1 (D7): advises on the finishes whose daily output swings.
    const dn = $('calc-day-note');
    if (dn) {
      dn.hidden = !onDays || !dayBasisNotRecommended(key);
      dn.textContent =
        'Not recommended for this work. How much a crew gets through in a day changes with the weather, the coats and the surface, so price this one by the unit.';
    }
    // Notifier 2 (D7): say where a book-filled rate came from, and when it was
    // last checked against the published book.
    syncBookNote();
    // G1: entering or leaving the all-in basis fills or drops the split.
    prefillSplitFromAllin();
  }
  // The published-rate note follows the CHOSEN currency, not the engine's.
  function syncBookNote() {
    const n = $('calc-book-note');
    if (!n) {
      return;
    }
    const sel = $('calc-basis');
    const mode = sel ? sel.value : 'measured';
    const el = $('calc-allin');
    const filled =
      mode === 'allin' &&
      el &&
      el.value !== '' &&
      el.dataset.model != null &&
      String(el.value) === String(el.dataset.model);
    const verified = ($('calc-allin-verified') || {}).value || '';
    n.hidden = !filled;
    n.textContent =
      'This rate came from a published rate book. Rates change, so check it against JIC before you price' +
      (verified ? ' (you checked it on ' + verified + ')' : '') +
      '.';
  }
  function syncAllinCurrencyLabel() {
    const key = ($('calc-work') || {}).value || '';
    const ru = (WORK[key] || {}).runit;
    const cur = ($('calc-currency') || {}).value || BASE_CURRENCY;
    return 'All-in rate (' + (ru ? 'per ' + ru + ', ' : '') + cur + ')';
  }

  // ---- Owner 2026-10-12 (G1): the headline follows the split -------------
  // Editing either side of the split recomputes the all-in HEADLINE straight
  // away (all-in = material + labour), and a sum that no longer equals the
  // book's own figure drops the prefill marker - so the line then reads as
  // the user's rate, never as the published one. A sum that still equals the
  // book's figure LEAVES the marker alone, so an untouched split keeps the
  // "came from a published book" note.
  // Both functions write .value programmatically, which fires no input event,
  // so they can never call each other into a loop.
  function syncAllinFromSplit() {
    const sel = $('calc-basis');
    if (!sel || sel.value !== 'allin') {
      return;
    }
    const m = $('calc-rate-mat'),
      l = $('calc-rate-lab'),
      a = $('calc-allin');
    if (!m || !l || !a) {
      return;
    }
    const mv = parseFloat(m.value),
      lv = parseFloat(l.value);
    if (!isFinite(mv) || !isFinite(lv)) {
      return;
    }
    const sum = Math.round((mv + lv) * 100) / 100;
    a.value = String(sum);
    // Editing the split on this line is an edit of THIS line's headline, so
    // the headline belongs to the trade now showing (see prefillSplitFromAllin).
    a.dataset.work = ($('calc-work') || {}).value || '';
    if (String(sum) !== String(a.dataset.model || '')) {
      a.dataset.model = '';
    }
    syncBookNote();
  }

  // The other direction: a typed headline re-derives the two sides so the
  // split on screen always adds up to the figure above it. Leaving a stale
  // split under a new headline would show the user numbers that do not sum.
  function syncSplitFromAllin() {
    const sel = $('calc-basis');
    if (!sel || sel.value !== 'allin') {
      return;
    }
    const a = $('calc-allin'),
      m = $('calc-rate-mat'),
      l = $('calc-rate-lab');
    if (!a || !m || !l) {
      return;
    }
    const av = parseFloat(a.value);
    if (!isFinite(av) || av <= 0) {
      return;
    }
    const mat = Math.round(av * matShareFor(($('calc-work') || {}).value || '') * 100) / 100;
    m.value = String(mat);
    l.value = String(Math.round((av - mat) * 100) / 100);
  }

  // ---- Owner 2026-10-12 (G1): the split is a FORM-layer view, not book data --
  // The JIC book publishes ONE figure, so there is no stored material/labour
  // pair to show. The breakdown under the all-in headline is derived HERE,
  // only while the all-in basis is chosen, from the trade's own mat/lab share
  // (matShareFor) of that headline: mat = headline x share, lab = the REMAINDER,
  // which is what makes the two sides add up to the figure above them exactly,
  // at any figure and on any row.
  //
  // DELIBERATELY not inside jicBookPayload: a split stored in the book would
  // travel through modelRatesFor into the MEASURED basis too and re-price every
  // covered trade away from its WORK model. Measured pricing must keep working
  // exactly as it did before this feature - which is why a value this function
  // wrote is dropped again the moment the basis leaves all-in.
  //
  // Untouched is decided by ADDING THE TWO SIDES UP, never by a remembered
  // marker: a snapshot recall restores the values without any bookkeeping, so
  // a marker-based test leaves a stale pair on screen that nothing can ever
  // re-derive. If the pair already adds up to the headline it is a split of
  // that headline (the user's own edit stays, because their edit re-derives
  // the headline first - see syncAllinFromSplit). If it does not, the pair is
  // stale and gets re-derived.
  function prefillSplitFromAllin() {
    const sel = $('calc-basis');
    const m = $('calc-rate-mat'),
      l = $('calc-rate-lab');
    const a = $('calc-allin');
    if (!sel || !m || !l) {
      return;
    }
    // A field holds either the model/book PREFILL (value === dataset.model,
    // which must survive untouched - it is the fallback the line prices from
    // once there is no headline) or a figure derived from - or typed under -
    // the headline. Only the latter is ever dropped.
    const dropIfNotModel = function (el) {
      if (el.value !== '' && el.value !== (el.dataset.model || '')) {
        el.value = '';
      }
    };
    const onAllin = sel.value === 'allin';
    const wasAllin = m.dataset.onAllin === '1';
    if (!onAllin) {
      // Only the TRANSITION out of all-in drops: a measured-basis refresh must
      // never clear a rate the user typed there.
      if (wasAllin) {
        dropIfNotModel(m);
        dropIfNotModel(l);
      }
      m.dataset.onAllin = '';
      l.dataset.onAllin = '';
      return;
    }
    m.dataset.onAllin = '1';
    l.dataset.onAllin = '1';
    if (!a) {
      return;
    }
    // The headline must belong to THIS trade (filled by its own prefill, its
    // recall, or typed on this line - see refreshRateFields). One that a
    // previous trade left behind is stale money: it is never broken down, and
    // any split still showing from that trade is dropped, so an uncovered
    // trade keeps its honest empty field instead of a fabricated pair.
    if (a.dataset.work !== (($('calc-work') || {}).value || '')) {
      dropIfNotModel(m);
      dropIfNotModel(l);
      return;
    }
    const av = parseFloat(a.value);
    // No headline, no breakdown: a cleared or unparsable all-in figure leaves
    // nothing for the split to be a split OF, so it drops and the line falls
    // back to the trade's model rates exactly as it did before G1.
    if (!isFinite(av) || av <= 0) {
      dropIfNotModel(m);
      dropIfNotModel(l);
      return;
    }
    const mv = parseFloat(m.value),
      lv = parseFloat(l.value);
    if (isFinite(mv) && isFinite(lv) && Math.abs(mv + lv - av) < 0.005) {
      return;
    }
    const mat = Math.round(av * matShareFor(($('calc-work') || {}).value || '') * 100) / 100;
    const lab = Math.round((av - mat) * 100) / 100;
    m.value = String(mat);
    l.value = String(lab);
  }

  // Labels as entered right now (kept for CSV display).
  function currentDimLabels() {
    const w = WORK[($('calc-work') || {}).value];
    if (!w) {
      return [];
    }
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
        if (d1s.indexOf('(mm)') > -1) {
          units = v >= 100 ? 'metric' : 'imperial';
        } else if (
          d1s.indexOf('(m2)') > -1 ||
          d1s.indexOf('(m3)') > -1 ||
          d1s.indexOf('(m)') > -1
        ) {
          units = v >= 3 ? 'metric' : 'imperial';
        }
      }
    }
    if (h.units) {
      units = h.units;
    }
    if (units) {
      setUnits(units, true);
    }
    $('calc-work').value = h.work || 'slab';
    syncLabels();
    $('calc-d1').value = h.d1 || '';
    if ($('calc-d2')) {
      $('calc-d2').value = h.d2 || '';
    }
    if ($('calc-d3')) {
      $('calc-d3').value = h.d3 || '';
    }
    if ($('calc-currency')) {
      $('calc-currency').value = h.currency || 'USD';
    }
    if ($('calc-country')) {
      $('calc-country').value = h.country || 'US';
    }
    if ($('calc-quality')) {
      $('calc-quality').value = h.quality || 'standard';
    }
    if ($('calc-rate-mat')) {
      $('calc-rate-mat').value = '';
    }
    if ($('calc-rate-lab')) {
      $('calc-rate-lab').value = '';
    }
    if ($('calc-piece-price')) {
      $('calc-piece-price').value = '';
    }
    if ($('calc-piece-size')) {
      $('calc-piece-size').value = '';
    }
    refreshRateFields();
  }

  // F4-1 core: switch unit system, re-label, remember, re-render only when
  // there is something on the table (a bare form keeps its friendly empty
  // state instead of flashing the dimensions error).
  function setUnits(mode, silent) {
    const next = mode === 'imperial' ? 'imperial' : 'metric';
    // C1: switching the unit system keeps the PHYSICAL quantity in the Quick
    // total box, not the digits (100 feet by 100 feet stays 929.0304 m2).
    // Skipped while a snapshot is applied (silent), where the restored value
    // and its measuredEntry declaration are authoritative.
    const qBox = $('calc-measured-qty');
    if (silent !== true && qBox && String(qBox.value || '').trim() && next !== _units) {
      const wKey = ($('calc-work') || {}).value;
      const ww = WORK[wKey];
      const engUnit =
        (ww && ww.q ? (ww.q(1, ww.d2 ? 1 : null, ww.d3 ? 1 : null) || {}).unit : '') || '';
      const oldFlag = qBox.dataset.entry || (_units === 'imperial' ? 'imp' : 'eng');
      const newFlag = next === 'imperial' ? 'imp' : 'eng';
      const eng = toEngineQty(parseFloat(qBox.value), oldFlag, engUnit);
      if (isFinite(eng)) {
        qBox.value = String(Math.round(fromEngineQty(eng, newFlag, engUnit) * 10000) / 10000);
        qBox.dataset.entry = newFlag;
      }
    }
    _units = next;
    try {
      localStorage.setItem('mmgr_calc_units', _units);
    } catch (e) {}
    document.querySelectorAll('.bcp-seg-btn').forEach(function (b) {
      const on = b.getAttribute('data-units') === _units;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    syncLabels();
    const any = ['calc-d1', 'calc-d2', 'calc-d3'].some(function (id) {
      return $(id) && $(id).value;
    });
    if (any || silent !== true) {
      render();
    }
  }
  function countryLabel(code) {
    const map = {
      US: 'United States (sales tax varies - use the custom field)',
      JM: 'Jamaica (GCT 15%)',
      GB: 'United Kingdom (VAT 20%)',
      AU: 'Australia (GST 10%)',
      CA: 'Canada (GST 5%)',
      JP: 'Japan (consumption tax 10%)',
      DE: 'Germany (VAT 19%)',
      NONE: 'No tax on this job'
    };
    return map[code] || code;
  }

  // ---- B2/B3 (DIRECTIVE-ASSISTANT-JIC-RATES-ACCESS): the custom line ---
  // Four fields, validated IN the page - never trusted from the model. One
  // plain message per field, shown beside that field; a line that fails
  // never reaches the bill. Declared BEFORE init: wireCustomFields() runs
  // at page start and would otherwise hit the temporal dead zone.
  const CUSTOM_FIELD_RULES = {
    'calc-custom-name': [
      function (val) {
        const t = String(val == null ? '' : val).trim();
        return t.length >= 1 && t.length <= 60;
      },
      'Give the item a name of 1 to 60 characters.'
    ],
    'calc-custom-unit': [
      function (val) {
        const t = String(val == null ? '' : val).trim();
        return t.length >= 1 && t.length <= 12;
      },
      'Give the unit in 1 to 12 characters, for example m2 or day.'
    ],
    'calc-custom-qty': [
      function (val) {
        const n = parseFloat(val);
        return isFinite(n) && n > 0;
      },
      'Enter the quantity as a number greater than zero.'
    ],
    'calc-custom-rate': [
      function (val) {
        const n = parseFloat(val);
        return isFinite(n) && n > 0;
      },
      'Enter your rate as a number greater than zero.'
    ]
  };
  function customFieldOk(id, val) {
    const rule = CUSTOM_FIELD_RULES[id];
    return rule ? rule[0](val) : true;
  }
  // Returns true when every field the custom choice uses is valid. On
  // failure each invalid field shows its own message; valid fields stay
  // quiet, so the user only ever sees what to fix.
  function validateCustomFields() {
    if (($('calc-work') || {}).value !== 'custom') {
      return true;
    }
    let ok = true;
    Object.keys(CUSTOM_FIELD_RULES).forEach(function (id) {
      const el = $(id);
      const err = $(id + '-err');
      const good = el ? customFieldOk(id, el.value) : false;
      if (!good) {
        ok = false;
        if (err) {
          err.hidden = false;
          err.textContent = CUSTOM_FIELD_RULES[id][1];
        }
      }
    });
    return ok;
  }
  // While typing, a field that becomes valid clears its own message at
  // once - the user never has to guess whether a fix took.
  function wireCustomFields() {
    Object.keys(CUSTOM_FIELD_RULES).forEach(function (id) {
      const el = $(id);
      if (el) {
        el.addEventListener('input', function () {
          const err = $(id + '-err');
          if (err && !err.hidden && customFieldOk(id, el.value)) {
            err.hidden = true;
            err.textContent = '';
          }
        });
      }
    });
  }

  // Init: theme comes from the shared helper (mmgr-theme.js, loaded in <head>
  // with data-sync="1") which applies the saved mode before first paint - no
  // local restore here, a second writer would fight the helper.
  if ($('calc-work')) {
    $('calc-work').addEventListener('change', syncLabels);
    // PART I PHASE 2: picking the JIC rate item steps through the book's own
    // sign-in gate (registered after syncLabels, so the revert re-renders).
    _prevWork = ($('calc-work') || {}).value || 'custom';
    $('calc-work').addEventListener('change', jicGateOnWorkChange);
    wireCustomFields();
    // PART I PHASE 2: trade and row picks rebuild the picker (the row seeds
    // its book rate) and re-price the line at once; typing over the rate
    // re-prices live and drops the published-rate note the moment the figure
    // stops matching it.
    ['calc-jic-trade', 'calc-jic-row'].forEach(function (id) {
      const el = $(id);
      if (el) {
        el.addEventListener('change', function () {
          renderJicPicker();
          render();
        });
      }
    });
    if ($('calc-jic-rate')) {
      $('calc-jic-rate').addEventListener('input', function () {
        syncJicNote();
        render();
      });
    }
    if ($('calc-family')) {
      $('calc-family').value = localStorage.getItem(FKEY) || '';
    }
    [
      'calc-currency',
      'calc-country',
      'calc-quality',
      'calc-tax-override',
      'calc-rate-mat',
      'calc-rate-lab',
      'calc-rate-eq',
      'calc-oh',
      'calc-piece-price',
      'calc-piece-size',
      'calc-waste'
    ].forEach(function (id) {
      const el = $(id);
      if (el) {
        el.addEventListener('input', function () {
          // Owner 2026-10-12 (G1): editing either side of the split moves the
          // all-in headline with it, and drops the book's prefill marker when
          // the sum no longer matches the published figure.
          if (id === 'calc-rate-mat' || id === 'calc-rate-lab') {
            syncAllinFromSplit();
          }
          render();
        });
      }
    });
    // E1/E4: dims feed dim-dependent model rates (fencing height) - refresh
    // the prefill before pricing so the field IS the money being charged.
    ['calc-d1', 'calc-d2', 'calc-d3'].forEach(function (id) {
      const el = $(id);
      if (el) {
        el.addEventListener('input', function () {
          refreshRateFields();
          render();
        });
      }
    });
    // E1: switching currency re-prefills the model rates for it - the fields
    // must never carry another currency's numbers under the new symbol.
    if ($('calc-currency')) {
      $('calc-currency').addEventListener('change', function () {
        refreshRateFields();
        syncBasis();
        render();
      });
    }
    // OWNER 2026-10-02: the special-case piece toggle reveals the row, so it
    // must re-run syncLabels (which owns the row's hidden state) before render.
    if ($('calc-piece-custom')) {
      $('calc-piece-custom').addEventListener('change', function () {
        syncLabels();
        render();
      });
    }
    // W2: instance-row editing recomputes the measured total live; the
    // override field drives render() directly.
    $('calc-instances').addEventListener('input', function (e) {
      const el = e.target;
      const idx = parseInt(el.getAttribute('data-idx'), 10);
      const field = el.getAttribute('data-field');
      if (isNaN(idx) || !field) {
        return;
      }
      if (field === 'n') {
        instRows[idx].n = Math.max(1, parseInt(el.value, 10) || 1);
      } else {
        instRows[idx][field] = el.value;
      }
      // Keystrokes must NOT rebuild the row the user is typing in (the innerHTML
      // replace drops focus mid-entry); refresh the measured total only. Full
      // re-render stays on add / delete / trade change.
      const s = instancesQty(instRows, ($('calc-work') || {}).value || '');
      instSum = s.qty;
      instUnit = s.unit;
      const sumEl = $('calc-inst-sum');
      if (sumEl) {
        sumEl.textContent =
          instSum > 0 ? 'Measured total: ' + qtyShown(instSum, instUnit).main : '';
      }
      render();
    });
    // W2.7: openings rows edit live; the type select fires 'change', the
    // number fields fire 'input' - both land in the same handler.
    const openHandler = function (e) {
      const el = e.target;
      const idx = parseInt(el.getAttribute('data-idx'), 10);
      const field = el.getAttribute('data-field');
      if (isNaN(idx) || !field || !openRows[idx]) {
        return;
      }
      if (field === 'n') {
        openRows[idx].n = Math.max(1, parseInt(el.value, 10) || 1);
      } else {
        openRows[idx][field] = el.value;
      }
      // Same no-rebuild rule as the instances rows: a full renderOpenings() on
      // every keystroke replaces the focused input and eats the rest of the
      // entry. Refresh the deducts-sum only; full re-render stays on add /
      // delete / trade change.
      const a = openingsArea({ openings: JSON.stringify(openRows) }, _units === 'imperial');
      const sumEl = $('calc-open-sum');
      if (sumEl) {
        sumEl.textContent =
          a.count > 0
            ? 'Deducts ' +
              qtyShown(a.area, 'm2').main +
              ' across ' +
              a.count +
              ' opening' +
              (a.count === 1 ? '' : 's')
            : '';
      }
      render();
    };
    const openWrap = $('calc-openings');
    if (openWrap) {
      openWrap.addEventListener('input', openHandler);
      openWrap.addEventListener('change', openHandler);
    }
    // C1: the box's own handler stamps WHERE the digits came from, from the
    // unit system on screen at that moment, and only then renders.
    $('calc-measured-qty').addEventListener('input', function (e) {
      const t = e && e.target ? e.target : $('calc-measured-qty');
      if (t && t.dataset) {
        t.dataset.entry = _units === 'imperial' ? 'imp' : 'eng';
      }
      render();
    });
    // W3: employer statutory on-costs. Enabling the toggle (or switching to
    // Jamaica while it is on) suggests the 12.5% stack; a typed value always
    // wins (touched flag) and 0/empty keeps it off.
    function onCostSuggest() {
      const t = $('calc-oncost-toggle'),
        p = $('calc-oncost-pct');
      if (!t || !p) {
        return;
      }
      p.disabled = !t.checked;
      if (t.checked && $('calc-country').value === 'JM' && !p.dataset.touched && !p.value) {
        p.value = '12.5';
      }
      render();
    }
    $('calc-oncost-toggle').addEventListener('change', function () {
      onCostSuggest();
      /* UI-2: the four parts are on screen in the drawer whatever the country,
         so switching the row on must price what the drawer shows. Outside
         Jamaica the suggestion above is silent, and leaving the total empty
         would price 0% under a label that reads "Total 12.5% of labour" - the
         screen and the bill would disagree. Write the parts' sum instead;
         nothing is written when every part is blank, so "off" still means off. */
      const p = $('calc-oncost-pct');
      if (this.checked && p && !p.value && !p.dataset.touched) {
        const sum = oncostSum();
        if (sum > 0) {
          p.value = String(sum);
        }
      }
      ui2OncostLabel();
      ui2RowsSync();
      render();
    });
    $('calc-oncost-pct').addEventListener('input', function () {
      this.dataset.touched = '1';
      ui2OncostLabel();
      render();
    });
    // UI-2: the four statutory parts are the editor; their sum writes the one
    // total the engine reads.
    oncostPartEls().forEach(function (el) {
      if (el) {
        el.addEventListener('input', function () {
          ui2OncostWrite();
        });
      }
    });
    // UI-2: the tax row's switch is the country choice.
    if ($('calc-tax-toggle')) {
      $('calc-tax-toggle').addEventListener('change', function () {
        const c = $('calc-country');
        if (!c) {
          return;
        }
        if (this.checked) {
          if (c.value === 'NONE') {
            c.value = taxCountryBefore || 'JM';
          }
        } else {
          if (c.value !== 'NONE') {
            taxCountryBefore = c.value;
          }
          c.value = 'NONE';
        }
        c.dispatchEvent(new Event('change', { bubbles: true }));
        ui2RowsSync();
      });
    }
    // UI-2: any other row's switch opens or closes its own drawer. Delegated, so
    // a row added later (MAT-1's itemise materials) works with no new wiring.
    document.addEventListener('change', function (e) {
      const cb = e.target;
      if (cb && cb.type === 'checkbox' && cb.closest && cb.closest('.set-row')) {
        ui2RowsSync();
      }
    });
    // W4: preliminaries rows edit live (inputs + basis selects).
    function prelimEdit(e) {
      const el = e.target;
      const idx = parseInt(el.getAttribute('data-idx'), 10);
      const field = el.getAttribute('data-field');
      if (isNaN(idx) || !field || !prelimItems[idx]) {
        return;
      }
      prelimItems[idx][field] = el.value;
      persistPrelims(prelimItems);
      renderPrelims();
    }
    $('calc-prelims-body').addEventListener('input', prelimEdit);
    $('calc-prelims-body').addEventListener('change', prelimEdit);
    // W5: contingency/escalation/duration settings save per device.
    [
      'calc-design-c',
      'calc-constr-c',
      'calc-esc-pct',
      'calc-months',
      'calc-disc-pct',
      'calc-disc-amt'
    ].forEach(function (id) {
      const el = $(id);
      if (!el) {
        return;
      }
      el.addEventListener('input', function () {
        persistRollupPrefs({
          designC: $('calc-design-c').value,
          constrC: $('calc-constr-c').value,
          escPct: $('calc-esc-pct').value,
          months: $('calc-months').value,
          discPct: $('calc-disc-pct').value,
          discAmt: $('calc-disc-amt').value
        });
        renderRollup();
        renderCash();
      });
    });
    const cashMode = $('calc-cash-mode');
    if (cashMode) {
      cashMode.addEventListener('change', renderCash);
    }
    $('calc-country').addEventListener('change', function () {
      // W3: the Contractors Levy note is Jamaica-specific.
      const note = $('calc-jm-levy-note');
      if (note) {
        note.hidden = $('calc-country').value !== 'JM';
      }
      // UI-2: picking "No tax on this job" from the drawer closes the switch,
      // and picking a real country opens it. One state, two controls.
      ui2TaxSync();
      if ($('calc-oncost-toggle').checked) {
        onCostSuggest();
      } else {
        render();
      }
    });
    // Saved unit system comes back before first interaction; silent keeps the
    // empty-state text until the user actually enters dimensions.
    let savedUnits = 'metric';
    try {
      savedUnits = localStorage.getItem('mmgr_calc_units') || 'metric';
    } catch (e) {}
    setUnits(savedUnits, true);
  }
  renderHistory();
  renderEstimates();
  renderSheets();
  // E1/E4: the exchange-rate card and the rate-book picker paint on load.
  renderFx();
  // OWNER 2026-10-02: the shipped Jamaica book is the default on FIRST visit
  // (self-guarding via JICSEEN, so the user's own choice is never overridden
  // afterwards). Runs BEFORE renderBooks so the picker paints already-selected.
  if (ACTIONS.calcBookDefault) {
    ACTIONS.calcBookDefault();
  }
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
  (function () {
    const p = loadRollupPrefs();
    if ($('calc-design-c')) {
      $('calc-design-c').value = p.designC != null ? p.designC : '10';
    }
    if ($('calc-constr-c')) {
      $('calc-constr-c').value = p.constrC != null ? p.constrC : '5';
    }
    if ($('calc-esc-pct')) {
      $('calc-esc-pct').value = p.escPct != null ? p.escPct : '5';
    }
    // OWNER 2026-10-02: 12 months is the common Jamaican residential build and
    // it makes the cash plan work the moment the user clicks Export, instead of
    // failing on a blank field. Their own value, once typed, always wins.
    if ($('calc-months')) {
      $('calc-months').value = p.months != null ? p.months : '12';
    }
    if ($('calc-disc-pct')) {
      $('calc-disc-pct').value = p.discPct != null ? p.discPct : '';
    }
    if ($('calc-disc-amt')) {
      $('calc-disc-amt').value = p.discAmt != null ? p.discAmt : '';
    }
  })();
  // W3: brand + document fields restore on load (before first render so the
  // sheet has its data); the logo pipeline downgrades big images on-device.
  (function () {
    renderBrand();
    const dEl = $('calc-doc-date');
    if (dEl && !dEl.value) {
      dEl.value = new Date().toISOString().slice(0, 10);
    }
    const c = docCounterLoad();
    const dType = docType();
    const noEl = $('calc-doc-no');
    if (noEl && !noEl.value) {
      noEl.placeholder = docNoSuggest(dType, c[dType]) + ' (next number)';
    }
    const logoFile = $('calc-logo-file');
    if (logoFile) {
      logoFile.addEventListener('change', function () {
        const f = logoFile.files && logoFile.files[0];
        const note = $('calc-logo-note');
        if (!f) {
          return;
        }
        const say = function (m) {
          if (note) {
            note.textContent = m;
          }
        };
        if (!/^image\//.test(f.type)) {
          say('That file is not an image. Choose a PNG or JPG.');
          logoFile.value = '';
          return;
        }
        if (f.size > 8 * 1024 * 1024) {
          say('That image is too large (over 8 MB). Choose a smaller one.');
          logoFile.value = '';
          return;
        }
        const reader = new FileReader();
        reader.onload = function () {
          const img = new Image();
          img.onload = function () {
            downscaleLogo(img).then(function (url) {
              if (!url) {
                say('That image could not be resized. Try a smaller one.');
                return;
              }
              brandSave({ logo: url });
              renderBrand();
              render();
              say('Logo saved. It stays on this device.');
              logoFile.value = '';
            });
          };
          img.onerror = function () {
            say('That image could not be read. Try a different file.');
          };
          img.src = String(reader.result);
        };
        reader.onerror = function () {
          say('The file could not be read. Try again.');
        };
        reader.readAsDataURL(f);
      });
    }
    [
      'calc-brand-name',
      'calc-brand-phone',
      'calc-brand-email',
      'calc-brand-addr',
      'calc-brand-trn',
      'calc-brand-signame',
      'calc-brand-sigtitle'
    ].forEach(function (id) {
      const el = $(id);
      if (!el) {
        return;
      }
      el.addEventListener('input', function () {
        const patch = {};
        patch[
          {
            'calc-brand-name': 'name',
            'calc-brand-phone': 'phone',
            'calc-brand-email': 'email',
            'calc-brand-addr': 'addr',
            'calc-brand-trn': 'trn',
            'calc-brand-signame': 'sigName',
            'calc-brand-sigtitle': 'sigTitle'
          }[id]
        ] = el.value.trim();
        brandSave(patch);
        render();
      });
    });
    [
      'calc-client-name',
      'calc-client-addr',
      'calc-doc-no',
      'calc-doc-date',
      'calc-doc-due'
    ].forEach(function (id) {
      const el = $(id);
      if (el) {
        el.addEventListener('input', render);
      }
    });
    const dTypeSel = $('calc-doc-type');
    if (dTypeSel) {
      dTypeSel.addEventListener('change', function () {
        const cc = docCounterLoad();
        const t = docType();
        const ne = $('calc-doc-no');
        if (ne && !ne.value) {
          ne.placeholder = docNoSuggest(t, cc[t]) + ' (next number)';
        }
      });
    }
    if (localStorage.getItem('mmgr_calc_brand_open') === '1') {
      ACTIONS.calcBrandOpen(
        $('calc-brand-card')
          ? $('calc-brand-card').querySelector('[data-action="calcBrandOpen"]')
          : null
      );
    }
  })();
  // How-to guide: paint the first step (open state decides visibility).
  renderGuide();
  // UI-2: wire the setting rows once the page is fully painted - the drawers,
  // the tax switch and the live statutory total all read the same helpers.
  ui2Sync();
  // UI-3: the guide opens on Steps, and its tablist answers the arrow keys.
  (function wireGuideTabs() {
    setGuideTab('steps');
    const list = document.querySelector('#calc-guide-card .bcp-tabs');
    if (!list) {
      return;
    }
    list.addEventListener('keydown', function (e) {
      const k = e.key;
      if (k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== 'Home' && k !== 'End') {
        return;
      }
      e.preventDefault();
      const cur = list.querySelector('[role="tab"][aria-selected="true"]');
      const onSteps = !cur || cur.getAttribute('data-tab') === 'steps';
      const to = k === 'Home' ? 'steps' : k === 'End' ? 'notes' : onSteps ? 'notes' : 'steps';
      setGuideTab(to);
      const next = $('calc-guide-tab-' + to);
      if (next) {
        next.focus();
      }
    });
  })();
  // First-visit tutorial nudge: only when the flag is absent.
  (function () {
    const n = $('calc-tour-nudge');
    if (n && !tourDone()) {
      n.hidden = false;
    }
  })();
  // W5 workspace follow: one silent probe for signed-in accounts, after first
  // paint. Signed-out / offline / any failure: silent no-op, offline intact.
  if (navigator.onLine) {
    setTimeout(wsProbe, 1500);
  }
  // Swipe support on the guide's steps panel (40px threshold, horizontal only).
  // UI-3: scoped to the STEPS panel - a swipe while reading Notes must not
  // flip a slider the reader cannot see.
  (function () {
    const body = $('calc-guide-panel-steps');
    if (!body) {
      return;
    }
    let x0 = null;
    body.addEventListener(
      'touchstart',
      function (e) {
        x0 = e.touches[0].clientX;
      },
      { passive: true }
    );
    body.addEventListener(
      'touchend',
      function (e) {
        if (x0 === null) {
          return;
        }
        const dx = e.changedTouches[0].clientX - x0;
        if (Math.abs(dx) > 40) {
          if (dx < 0) {
            ACTIONS.calcGuideNext();
          } else {
            ACTIONS.calcGuidePrev();
          }
        }
        x0 = null;
      },
      { passive: true }
    );
  })();
  // D3 restore (pre-brand) retired 2026-10-01: brandLoad/renderBrand own the
  // business name now (mmgr_calc_biz_name migrates into mmgr_calc_brand).

  /* OWNER 2026-10-09 (item 4.5-4.6): the Assistant panel's TWO hooks. They are
     the whole contract - the panel stays swappable and never reads calculator
     internals itself, and removing them only costs the feature, never the page.

       MMGR_CALC_RATEBOOK()   plain text: the work-item keys the panel may
                              name, the ACTIVE rate book with a slice of its
                              rates, and how the line on screen is priced. This
                              is what lets an answer be GROUNDED in the book
                              instead of invented.
       MMGR_CALC_POPULATE(v)  write the agreed figures into the form and add
                              the line to the bill through the SAME dispatch the
                              "Add to bill" button uses (calcBoqAdd) - a
                              proposal and a click must not be two code paths.
       MMGR_CALC_FILE()       the export as data ({ok,name,mime,text,rows}), so
                              the panel can show a real download chip; the page's
                              own Export button is what starts a download. */
  // OWNER 2026-10-10 (T7, R5): the hook takes an optional question. With one,
  // the book sends only the rate rows that match it (the old fixed window was
  // the first 12 families x 3 variants, so the relevant rate could be missing
  // entirely); with none it behaves exactly as before.
  /* A2-A4 (DIRECTIVE-ASSISTANT-JIC-RATES-ACCESS, 2026-10-13 - rate access).
     The assistant's window onto the rates used to be the IMPORTED book only:
     on a normal visit there is none, so it said "no rates" while 811
     published rows sat on the device. It now:
       - opens the rate section with ONE scope line built from the loaded
         book - name, years, total, per-trade counts - or the exact A2
         failure line when the full file never arrived (the ranking then
         falls back to the 100 rows this page ships inline);
       - ranks EVERY row (the full 811 plus the active imported book)
         against the question - stop words stripped, simple plurals reduced,
         description and trade-label term hits, a trade-name boost and an
         exact-phrase boost - and returns at most 12 whole rows, never a row
         started past 8500 characters (the panel slices the block at 9000). */
  var RATE_STOP_WORDS = {
    the: 1,
    a: 1,
    an: 1,
    of: 1,
    for: 1,
    in: 1,
    on: 1,
    at: 1,
    to: 1,
    and: 1,
    or: 1,
    is: 1,
    are: 1,
    was: 1,
    were: 1,
    be: 1,
    been: 1,
    with: 1,
    as: 1,
    by: 1,
    from: 1,
    that: 1,
    this: 1,
    these: 1,
    it: 1,
    its: 1,
    do: 1,
    does: 1,
    did: 1,
    you: 1,
    your: 1,
    we: 1,
    our: 1,
    my: 1,
    me: 1,
    i: 1,
    what: 1,
    which: 1,
    who: 1,
    how: 1,
    when: 1,
    where: 1,
    there: 1,
    here: 1,
    can: 1,
    could: 1,
    would: 1,
    should: 1,
    will: 1,
    shall: 1,
    may: 1,
    might: 1,
    must: 1,
    please: 1,
    want: 1,
    need: 1,
    give: 1,
    get: 1,
    have: 1,
    has: 1,
    had: 1,
    not: 1,
    no: 1,
    yes: 1,
    if: 1,
    then: 1,
    than: 1,
    more: 1,
    most: 1,
    some: 1,
    any: 1,
    all: 1,
    into: 1,
    up: 1,
    out: 1,
    off: 1,
    over: 1,
    under: 1,
    about: 1,
    many: 1,
    much: 1,
    also: 1,
    per: 1,
    one: 1,
    two: 1,
    three: 1,
    // "rate"/"price" name the SUBJECT of nearly every question, so they are
    // scaffolding, not content: "rate for excavation in stiff clay" scores on
    // excavation, stiff and clay, not on the word rate.
    rate: 1,
    rates: 1,
    price: 1,
    prices: 1,
    cost: 1,
    costs: 1,
    figure: 1,
    figures: 1,
    number: 1,
    numbers: 1,
    charge: 1,
    charges: 1,
    amount: 1,
    amounts: 1,
    value: 1,
    values: 1
  };
  function rateNorm(s) {
    return String(s === undefined || s === null ? '' : s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/ +/g, ' ')
      .replace(/^ | $/g, '');
  }
  // AI GROUNDING (2026-10-16): contractors ask in site words, the book files
  // in spec words - "cement" matched ZERO of the 811 rows, so the assistant
  // answered "the rate book is silent" on the commonest question there is.
  // This map widens the QUERY tokens only (never the rows), one direction
  // only: site word -> book words. Keys and values are pre-stem forms; the
  // expansion runs through the same stemmer as the query tokens. Used by the
  // assistant's rate grounding (calcRateBookText) - the rate-book popup's
  // own search box is deliberately left exact-match.
  var RATE_QUERY_EXPAND = {
    cement: ['concrete', 'mortar', 'block', 'mix'],
    concrete: ['block', 'mix'],
    dump: ['cart', 'remove', 'load'],
    haul: ['cart', 'remove', 'load'],
    debris: ['cart', 'remove', 'demolish'],
    rubbish: ['cart', 'remove', 'demolish'],
    worker: ['labour', 'man'],
    workers: ['labour', 'man'],
    wire: ['conduit', 'electrical', 'point'],
    wiring: ['conduit', 'electrical', 'point'],
    socket: ['point', 'electrical'],
    plumbing: ['pipe', 'drain', 'supply'],
    toilet: ['fixture', 'bath', 'water'],
    sink: ['fixture', 'supply'],
    kitchen: ['cabinet', 'tile'],
    fence: ['fencing', 'chain'],
    dumpster: ['cart', 'remove', 'load'],
    scaffold: ['erect', 'scaffolding']
  };
  function rateExpandQuery(qTokens) {
    var seen = {};
    var i;
    for (i = 0; i < qTokens.length; i++) {
      seen[qTokens[i]] = 1;
    }
    var extra = [];
    for (i = 0; i < qTokens.length; i++) {
      var mapped = RATE_QUERY_EXPAND[qTokens[i]] || null;
      if (!mapped) {
        continue;
      }
      for (var j = 0; j < mapped.length; j++) {
        var sm = rateStem(rateNorm(mapped[j]));
        if (sm && !seen[sm]) {
          seen[sm] = 1;
          extra.push(sm);
        }
      }
    }
    for (i = 0; i < extra.length; i++) {
      qTokens.push(extra[i]);
    }
    return qTokens;
  }
  // Simple plural reduction - tiles -> tile, boxes -> box, stories -> story.
  function rateStem(w) {
    if (w.length > 4 && /ies$/.test(w)) {
      return w.slice(0, -3) + 'y';
    }
    if (w.length > 4 && /(sses|shes|ches|xes|zes)$/.test(w)) {
      return w.slice(0, -2);
    }
    if (w.length > 3 && /s$/.test(w) && !/(ss|us|is)$/.test(w)) {
      return w.slice(0, -1);
    }
    return w;
  }
  function rateTokens(s) {
    var words = rateNorm(s).split(' ');
    var toks = [];
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (!w || RATE_STOP_WORDS[w]) {
        continue;
      }
      var st = rateStem(w);
      if (toks.indexOf(st) < 0) {
        toks.push(st);
      }
    }
    return toks;
  }
  // A term hits when it equals a word or shares its stem-prefix (paint with
  // painting, block with blockwork). Both sides need 4 characters, so a short
  // fragment cannot match half the book.
  function rateTokenHit(toks, t) {
    for (var i = 0; i < toks.length; i++) {
      var x = toks[i];
      if (x === t) {
        return true;
      }
      if (t.length >= 4 && x.length >= 4 && (x.indexOf(t) === 0 || t.indexOf(x) === 0)) {
        return true;
      }
    }
    return false;
  }
  function rateScoreRow(qTokens, qPhrase, descToks, labelToks, rowNorm) {
    var s = 0;
    for (var i = 0; i < qTokens.length; i++) {
      var t = qTokens[i];
      if (rateTokenHit(descToks, t)) {
        s += 1;
      }
      if (rateTokenHit(labelToks, t)) {
        // the label's own term hit (+1) and the trade-name boost (+2)
        s += 3;
      }
    }
    if (qPhrase && (' ' + rowNorm + ' ').indexOf(' ' + qPhrase + ' ') > -1) {
      s += 3;
    }
    return s;
  }
  // Same item in both books - the user's own import takes the slot ahead of
  // the published row.
  function rateSameItem(a, c) {
    if (!a || !c) {
      return false;
    }
    if (a === c) {
      return true;
    }
    return a.length >= 8 && c.length >= 8 && (a.indexOf(c) > -1 || c.indexOf(a) > -1);
  }
  // An imported family prices through a work item only when its family or
  // variant IS one of the page's work keys or labels.
  function rateInCalc(keys, fam, variant) {
    var f = rateNorm(fam);
    var v = rateNorm(variant);
    for (var i = 0; i < keys.length; i++) {
      var w = WORK[keys[i]] || {};
      var kn = rateNorm(keys[i]);
      var ln = rateNorm(w.label || w.name || '');
      if ((kn && (kn === f || kn === v)) || (ln && (ln === f || ln === v))) {
        return true;
      }
    }
    return false;
  }

  function calcRateBookText(query) {
    var out = [];
    try {
      var keys = Object.keys(WORK);
      out.push(
        'Work items you may name in "work" (key = label): ' +
          keys
            .map(function (k) {
              var w = WORK[k] || {};
              return k + ' = ' + (w.label || w.name || k) + (w.unit ? ' (' + w.unit + ')' : '');
            })
            .join('; ')
      );
      // A2 - the scope line, always first in the rate section: which book,
      // what years, how many rates, how many per trade. The full file is
      // loaded by the panel mount / the rate-book card through rrLoadFull.
      var full = _rrFull && _rrFull.rows && _rrFull.rows.length ? _rrFull : null;
      var years = (full && full.years) || JIC_YEARS;
      if (full) {
        var counts = {};
        full.rows.forEach(function (r) {
          counts[r.t] = (counts[r.t] || 0) + 1;
        });
        var scopeTrades = (full.trades || []).map(function (t) {
          return (t.label || t.tid) + ' ' + (counts[t.tid] || 0);
        });
        out.push(
          'Jamaica rate book ' +
            years +
            ': ' +
            full.rows.length +
            ' rates across ' +
            (full.trades || []).length +
            ' trades - ' +
            scopeTrades.join(', ') +
            '.'
        );
      } else {
        out.push(
          'The full JIC book could not load on this device; only the rates already on this page are available.'
        );
      }
      var b = activeBook();
      out.push(
        b && b.rates
          ? 'Active rate book: ' +
              (b.name || b.id || 'imported book') +
              ' - ' +
              Object.keys(b.rates).length +
              ' work families.'
          : 'Active rate book: no import - the built-in planning-grade model rates are in use.'
      );
      // A3 - rank every row: the full 811 (or the inline 100 while the file
      // is unavailable) plus the active imported book, top 12 by score.
      var q = rateNorm(query || '');
      // AI GROUNDING (2026-10-16): site words widen to book words before
      // scoring, so "cement" reaches the concrete/mortar/block rows.
      var qTokens = rateExpandQuery(rateTokens(query || ''));
      var fullLabels = {};
      if (full) {
        (full.trades || []).forEach(function (t) {
          fullLabels[t.tid] = t.label;
        });
      }
      var candidates = [];
      var seq = 0;
      rrRows().forEach(function (r) {
        var label = fullLabels[r.tid] || r.trade || r.tid;
        var desc = String(r.desc || '');
        var s = rateScoreRow(
          qTokens,
          q,
          rateTokens(desc),
          rateTokens(label),
          rateNorm(label + ' ' + desc)
        );
        if (s <= 0) {
          return;
        }
        var hashAt = String(r.ref || '').indexOf('#');
        var ref =
          hashAt > -1
            ? label +
              ' #' +
              String(r.ref)
                .slice(hashAt + 1)
                .trim()
            : label + ' ' + String(r.ref || '');
        candidates.push({
          s: s,
          seq: seq++,
          imp: false,
          key: rateNorm(desc),
          line:
            ref +
            ' | ' +
            desc +
            ' | J$' +
            r.metRate +
            (r.metUnit ? ' per ' + r.metUnit : '') +
            ' | source: JIC ' +
            years +
            ' | in calculator: ' +
            (r.inApp ? 'yes' : 'no')
        });
      });
      if (b && b.rates) {
        Object.keys(b.rates).forEach(function (fam) {
          var variants = b.rates[fam] || {};
          var vk = Object.keys(variants);
          vk.forEach(function (v, vi) {
            var vr = variants[v] || {};
            var amt = vr.allIn !== undefined ? vr.allIn : vr.rate;
            if (amt === undefined || amt === null || amt === '') {
              return;
            }
            var lab = String(vr.label || v || fam);
            var hay = fam + ' ' + v + ' ' + (vr.label || '');
            var s = rateScoreRow(
              qTokens,
              q,
              rateTokens(hay),
              rateTokens(fam),
              rateNorm(fam + ' ' + hay)
            );
            if (s <= 0) {
              return;
            }
            candidates.push({
              s: s,
              seq: seq++,
              imp: true,
              key: rateNorm(lab),
              line:
                fam +
                ' #' +
                (vi + 1) +
                ' | ' +
                lab +
                ' | J$' +
                amt +
                (vr.unit ? ' per ' + vr.unit : '') +
                ' | source: ' +
                (b.name || b.id || 'imported book') +
                ' | in calculator: ' +
                (rateInCalc(keys, fam, v) ? 'yes' : 'no')
            });
          });
        });
      }
      candidates.sort(function (x, y) {
        return y.s - x.s || x.seq - y.seq;
      });
      // The same item in both sources: the imported row takes the slot
      // directly ahead of the published one.
      candidates.slice().forEach(function (e) {
        if (!e.imp) {
          return;
        }
        for (var j = 0; j < candidates.length; j++) {
          var c = candidates[j];
          if (c.imp || !rateSameItem(e.key, c.key)) {
            continue;
          }
          candidates.splice(candidates.indexOf(e), 1);
          candidates.splice(candidates.indexOf(c), 0, e);
          break;
        }
      });
      // A3/A5 - at most 12 rows, and never START a row that would push the
      // text past 8500 characters, so no row is ever cut in half.
      var added = 0;
      var used = out.join('\n').length;
      for (var n = 0; n < candidates.length && added < 12; n++) {
        var line = candidates[n].line;
        if (used + 1 + line.length >= 8500) {
          break;
        }
        out.push(line);
        used += 1 + line.length;
        added++;
      }
      var st = readState();
      if (st && st.work) {
        out.push('The work item selected on the page is "' + st.work + '".');
      }
      if (lastResult && !lastResult.error) {
        out.push(
          'The line on screen prices at ' +
            (lastResult.currency || '') +
            ' ' +
            lastResult.total +
            '.'
        );
      }
    } catch (e) {
      return '';
    }
    return out.join('\n');
  }

  /* OWNER 2026-10-11 (B1 - "those figures do not price - check the quantities").
     The panel was handed one opaque sentence with no way to fix it. This is the
     diagnosis it was missing.

     MMGR_CALC_CHECK(v) is a PURE DRY RUN. It reads the work-item metadata
     (WORK[key].d1/d2/d3 labels) and NEVER writes the form, the bill or saved
     state, so the assistant can name EVERY box that is still needed, in plain
     words, carrying the same unit the page itself would print on that box.

     Money is deliberately NOT computed here. There is one pricing engine on this
     page and it is render(); the check reports only the quantity the work's own
     q() would produce, so a preview can never disagree with the bill. */
  // B3: the custom line's four fields. A model proposal (v.custom) is
  // validated as given; otherwise the live form is read. Every failure is
  // one named field in plain words, so the assistant asks for exactly what
  // is missing - never a bare "something failed".
  function customCheck(v, out) {
    const src = v && v.custom && typeof v.custom === 'object' ? v.custom : null;
    const g = function (prop, id) {
      if (src) {
        return src[prop];
      }
      const el = $(id);
      return el ? el.value : '';
    };
    const str = function (x) {
      return x === undefined || x === null ? '' : String(x);
    };
    const label = str(g('label', 'calc-custom-name')).trim();
    const unit = str(g('unit', 'calc-custom-unit')).trim();
    const qv = parseFloat(str(g('qty', 'calc-custom-qty')));
    const rv = parseFloat(str(g('rate', 'calc-custom-rate')));
    out.work = 'custom';
    out.mode = 'total';
    if (label.length < 1 || label.length > 60) {
      out.missing.push({
        field: 'label',
        label: 'Item name',
        unit: '',
        hint: 'Give the item a name of 1 to 60 characters.'
      });
    }
    if (unit.length < 1 || unit.length > 12) {
      out.missing.push({
        field: 'unit',
        label: 'Unit',
        unit: '',
        hint: 'Give the unit in 1 to 12 characters, for example m2 or day.'
      });
    }
    // The Quick total quantity counts as the custom line's quantity, so the
    // one measurement x one rate path prices it too.
    const mq = parseFloat(str(v.measuredQty));
    const qty = isFinite(qv) && qv > 0 ? qv : isFinite(mq) && mq > 0 ? mq : null;
    if (qty === null) {
      out.missing.push({
        field: 'qty',
        label: 'Quantity',
        unit: '',
        hint: 'Enter the quantity as a number greater than zero.'
      });
    }
    // A proposal must carry its own valid rate (the page never invents one);
    // the form may also price from the all-in field when the chooser says
    // the all-in basis is in play - the same rule the engine applies.
    let rate = isFinite(rv) && rv > 0 ? rv : null;
    if (rate === null && !src) {
      const basisEl = $('calc-basis');
      const basis = basisEl ? basisEl.value || 'measured' : 'measured';
      const av = parseFloat(str(($('calc-allin') || {}).value));
      if (isFinite(av) && av > 0 && basis !== 'days' && basis !== 'measured') {
        rate = av;
      }
    }
    if (rate === null) {
      out.missing.push({
        field: 'rate',
        label: 'Rate',
        unit: '',
        hint: 'Enter your rate as a number greater than zero.'
      });
    }
    out.ok = out.missing.length === 0;
    if (out.ok) {
      out.preview = { qty: qty, unit: unit, qtyLabel: 'Quantity' };
    }
    return out;
  }

  function calcCheck(v) {
    var out = { ok: false, work: '', mode: 'dims', missing: [], preview: null, error: '' };
    if (!v || typeof v !== 'object') {
      out.error = 'nothing to check';
      return out;
    }
    var sel = $('calc-work');
    var key = v.work || (sel && sel.value) || '';
    // B3: a custom proposal (or the custom choice) validates its OWN four
    // fields before any work-item lookup - the model's object when passed,
    // the live form otherwise.
    if (v.custom || key === 'custom') {
      return customCheck(v, out);
    }
    // PART I PHASE 2: the JIC picker validates its OWN pick before the
    // standard flow - a row must be chosen (trade + row resolve together and
    // the book prefills its rate), so the dry run NAMES that box instead of
    // failing bare. The quantity itself follows the normal rules below (the
    // box or the Quick total), and a picked row's rate is prefilled by the
    // page, so an empty rate is only ever the user clearing it.
    if (key === 'jic') {
      var jT = v.jicTrade || ($('calc-jic-trade') || {}).value || '';
      var jR = v.jicRef || ($('calc-jic-row') || {}).value || '';
      if (!jT || !jR || !jicRowFor(jT, jR)) {
        out.work = 'jic';
        out.missing.push({
          field: 'jicRow',
          label: 'a trade and a rate in the JIC picker',
          unit: '',
          hint: 'Pick a trade, then one of its published rates, in the JIC rate book picker.'
        });
        return out;
      }
      var jRateRaw =
        v.jicRate !== undefined && v.jicRate !== null && v.jicRate !== ''
          ? v.jicRate
          : ($('calc-jic-rate') || {}).value || '';
      if (!(Number(jRateRaw) > 0)) {
        out.work = 'jic';
        out.missing.push({
          field: 'jicRate',
          label: 'the rate for that JIC row',
          unit: '',
          hint: 'The published rate is prefilled - type your own figure if yours is newer.'
        });
        return out;
      }
    }
    var w = WORK[key];
    if (!w) {
      out.error = 'that work item is not on this page';
      return out;
    }
    out.work = key;
    // "Length (m)" -> "m"; a box with no bracketed unit just has none.
    var unitOf = function (label) {
      var m = /\(([a-zA-Z0-9\/. ]+)\)\s*$/.exec(String(label || ''));
      return m ? m[1] : '';
    };
    var bareOf = function (label) {
      return String(label || '').replace(/\s*\([^)]*\)\s*$/, '');
    };
    var num = function (x) {
      return x === undefined || x === null || x === '' ? null : Number(x);
    };
    var hasTotal = v.measuredQty !== undefined && v.measuredQty !== null && v.measuredQty !== '';
    if (hasTotal) {
      // Quick total: one number plus the work's own unit, already priced by the
      // page's all-in path. The probe call reads the unit/label, never a price.
      out.mode = 'total';
      var n = num(v.measuredQty);
      if (n === null || !isFinite(n) || n <= 0) {
        out.missing.push({
          field: 'measuredQty',
          label: 'Total quantity',
          unit: '',
          hint: 'Enter the measured total as a number greater than zero.'
        });
      } else {
        var probe = w.q(1, 1, 1) || {};
        out.preview = { qty: n, unit: probe.unit || '', qtyLabel: probe.qtyLabel || '' };
      }
    } else {
      out.mode = 'dims';
      var given = { d1: num(v.d1), d2: num(v.d2), d3: num(v.d3) };
      var defs = [
        ['d1', w.d1],
        ['d2', w.d2],
        ['d3', w.d3]
      ];
      var vals = [0, 0, 0];
      var all = true;
      for (var i = 0; i < defs.length; i++) {
        var label = defs[i][1];
        if (!label) {
          continue; // this work has no such box - it is not missing
        }
        var val = given[defs[i][0]];
        if (val === null || !isFinite(val) || val <= 0) {
          all = false;
          out.missing.push({
            field: defs[i][0],
            label: String(label),
            unit: unitOf(label),
            hint: 'Enter ' + bareOf(label) + ' as a number greater than zero.'
          });
        } else {
          vals[i] = val;
        }
      }
      if (all) {
        var pr = w.q(vals[0], vals[1], vals[2]) || {};
        out.preview = { qty: pr.qty, unit: pr.unit || '', qtyLabel: pr.qtyLabel || '' };
      }
    }
    out.ok = out.missing.length === 0;
    return out;
  }

  // B6 (DIRECTIVE section 3): self-enforcing guards, because the model can be
  // wrong. The rate proof for source:"user" lives in js/calc-ai.js - only the
  // panel can see the conversation. Everything the PAGE can prove - markup or
  // control characters in the name or unit, a JIC source whose rate differs
  // from the loaded book by a cent, and a bill already at its 60-line cap -
  // rejects here, before a single field is touched: no line, no fill.
  var B6_RATE_NOTICE =
    'I could not add that line because the rate did not match what you gave me. Tell me the rate again and I will add it.';
  function b6CustomGuard(c) {
    var str = function (x) {
      return String(x === undefined || x === null ? '' : x);
    };
    if (/[\u0000-\u001f\u007f<>]/.test(str(c.label) + str(c.unit))) {
      return 'I could not add that line because the name or the unit contained markup. Ask for it again in plain words and I will add it.';
    }
    var src = str(c.source);
    if (/^JIC\s+/.test(src)) {
      var ref = src.replace(/^JIC\s+/, '');
      var rows = rrRows();
      var hit = null;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].ref === ref) {
          hit = rows[i];
          break;
        }
      }
      var rate = Number(c.rate);
      if (
        !hit ||
        !isFinite(rate) ||
        Math.round(rate * 100) !== Math.round(Number(hit.metRate) * 100)
      ) {
        return B6_RATE_NOTICE;
      }
    }
    if (loadBoq().length >= 60) {
      return 'The bill is full at 60 lines. Remove a line before adding another.';
    }
    return '';
  }

  // C8 (AUDIT-DIRECTIVE-2026-10-18): the quantity a proposal SHOULD produce,
  // derived independently from the units the model declared. The engine is then
  // compared against it after populate, so a unit mismatch fails closed instead
  // of quietly adding a line 10x wrong.
  function expectedEngineQty(v) {
    try {
      var w = WORK[v && v.work];
      if (!w || !w.q) {
        return null;
      }
      var imp = v.units === 'imperial';
      if (v.measuredQty !== undefined && v.measuredQty !== null && v.measuredQty !== '') {
        var unit = (w.q(1, w.d2 ? 1 : null, w.d3 ? 1 : null) || {}).unit || '';
        return toEngineQty(v.measuredQty, imp ? 'imp' : 'eng', unit);
      }
      var d1 = imp ? parseFloat(v.d1) * (IMP_D1_FACTOR[v.work] || FT) : parseFloat(v.d1);
      var d2 = w.d2 ? (imp ? parseFloat(v.d2) * FT : parseFloat(v.d2)) : null;
      var d3 = w.d3 ? (imp ? parseFloat(v.d3) * IN : parseFloat(v.d3)) : null;
      var q = w.q(d1, d2, d3);
      return q && isFinite(q.qty) ? q.qty : null;
    } catch (e) {
      return null;
    }
  }

  // C8 FAIL-CLOSED RULE, as a pure predicate so a test can drive both sides:
  // an unknown expectation (nothing to compare) lets the line through, a known
  // one must agree with the engine to within a millionth.
  function qtyGuard(expected, got) {
    if (expected == null || !isFinite(expected) || expected <= 0) {
      return true;
    }
    return isFinite(got) && Math.abs(got - expected) <= 1e-6 * Math.max(1, expected);
  }

  function calcPopulate(v) {
    // X-1: a load must read fully-updated cards, never a queued half-pass.
    flushHeavy();
    try {
      if (!v || typeof v !== 'object') {
        return { ok: false, error: 'nothing to add' };
      }
      // C8: the model never converts - the page does, and it does it from the
      // unit system the model declared, BEFORE any box is written, so the box
      // labels and the entry declaration agree with the numbers arriving.
      if ((v.units === 'imperial' || v.units === 'metric') && calcUnitFlagOn()) {
        setUnits(v.units, false);
      }
      var sel = $('calc-work');
      // B3: a custom proposal selects the custom choice and fills its four
      // fields; the SAME validation and the SAME calcBoqAdd dispatch then
      // run as for any other line - a proposal and a click stay one path.
      if (v.custom && typeof v.custom === 'object') {
        var b6 = b6CustomGuard(v.custom);
        if (b6) {
          return { ok: false, error: b6 };
        }
        if (!sel) {
          return { ok: false, error: 'the calculator form is not on this page' };
        }
        sel.value = 'custom';
        syncLabels();
        var cflds = [
          ['calc-custom-name', v.custom.label],
          ['calc-custom-unit', v.custom.unit],
          ['calc-custom-qty', v.custom.qty],
          ['calc-custom-rate', v.custom.rate]
        ];
        for (var ci = 0; ci < cflds.length; ci++) {
          var cel = $(cflds[ci][0]);
          if (cel) {
            cel.value =
              cflds[ci][1] === undefined || cflds[ci][1] === null ? '' : String(cflds[ci][1]);
          }
          var cerr = $(cflds[ci][0] + '-err');
          if (cerr) {
            cerr.hidden = true;
            cerr.textContent = '';
          }
        }
      }
      if (v.work) {
        if (!sel) {
          return { ok: false, error: 'the calculator form is not on this page' };
        }
        var known = Array.prototype.some.call(sel.options || [], function (o) {
          return o.value === v.work;
        });
        if (!known) {
          return { ok: false, error: 'that work item is not on this page' };
        }
        sel.value = v.work;
        syncLabels();
      }
      var w = WORK[(sel && sel.value) || ''] || {};
      // B1 (F-4): a box this work does not use, or a box the proposal omitted,
      // is CLEARED rather than left holding the previous line's number - which is
      // how a second line used to price with the first line's height.
      var put = function (name, id, allowed) {
        var el = $(id);
        if (!el) {
          return;
        }
        if (!allowed || v[name] === undefined || v[name] === null || v[name] === '') {
          el.value = '';
          return;
        }
        el.value = String(v[name]);
      };
      put('d1', 'calc-d1', true);
      put('d2', 'calc-d2', !!w.d2);
      put('d3', 'calc-d3', !!w.d3);
      if (v.measuredQty !== undefined && v.measuredQty !== null && v.measuredQty !== '') {
        var mq = $('calc-measured-qty');
        if (mq) {
          mq.value = String(v.measuredQty);
          mq.dataset.entry = v.units === 'imperial' ? 'imp' : 'eng';
          // C1: a number written by code declares its unit too. The assistant
          // sends the unit system it spoke in (C8); anything else is engine
          // units, exactly like a saved estimate.
        }
        var mt = $('calc-measured-manual');
        if (mt) {
          mt.checked = true;
        }
      }
      // Diagnose BEFORE rendering, so the reply names the box that is actually
      // short instead of the old blanket "those figures do not price".
      var chk = calcCheck(v);
      if (!chk.ok) {
        var words = chk.missing
          .map(function (m) {
            return m.label;
          })
          .join(', ');
        return {
          ok: false,
          error: 'I still need ' + words + '. Enter that and the line will price.',
          missing: chk.missing
        };
      }
      var r = render();
      if (!r || r.error) {
        return {
          ok: false,
          error:
            'The form did not price that line: ' +
            (r && r.error ? r.error : 'check the quantities.'),
          missing: chk.missing
        };
      }
      // C8 FAIL-CLOSED: an independent derivation from the declared units must
      // agree with what the engine just produced. Nothing is added when it does
      // not - a wrong line in the bill is worse than a refused one.
      //
      // Scope (2026-10-18): this check owns the MEASURED-TOTAL path - the one
      // place a unit mix-up changes the money silently, because the user states
      // a figure and nothing else lands in a box. On the dimension path the
      // engine applies its own per-trade allowances (rebar's bar count, the
      // waste percentage), so the raw q() reading and r.qty legitimately differ;
      // re-deriving it here refused good lines. The dimension conversions keep
      // their own coverage in the page harness (U1-U3, I1) and T1.
      var guardable = v.measuredQty !== undefined && v.measuredQty !== null && v.measuredQty !== '';
      if (guardable && !qtyGuard(expectedEngineQty(v), Number(r.qty))) {
        return {
          ok: false,
          error: 'The quantity did not match what you said, so nothing was added.'
        };
      }
      ACTIONS.calcBoqAdd();
      return { ok: true, name: r.name, total: r.total, currency: r.currency || '' };
    } catch (e) {
      return { ok: false, error: 'could not add that line' };
    }
  }

  /* S-6.1 (owner 2026-10-22) - "or would you like to use your own rate?".
     The second of the two options the assistant offers. It moves the page to a
     CUSTOM line carrying the SAME job - name, unit and the quantity the dry
     run already worked out - and puts the caret in the rate box. It writes NO
     rate: the user's own figure is the entire point of choosing this path, and
     the B6 guard in the panel then proves the rate really came from them. */
  function calcUserRate(v) {
    try {
      var chk = calcCheck(v || {});
      var src = v && v.custom && typeof v.custom === 'object' ? v.custom : null;
      var label = src ? String(src.label || '') : '';
      var unit = src ? String(src.unit || '') : '';
      var qty = src ? Number(src.qty) : NaN;
      if (!label) {
        var key = (v && v.work) || ($('calc-work') || {}).value || '';
        var w = WORK[key] || {};
        label = String(w.label || w.name || key || '');
      }
      if (chk && chk.preview) {
        if (!unit) {
          unit = String(chk.preview.unit || '');
        }
        if (!(qty > 0)) {
          qty = Number(chk.preview.qty);
        }
      }
      label = label.trim().slice(0, 60);
      if (!label) {
        return {
          ok: false,
          error: 'I could not name that line. Tell me what it is and give me your rate.'
        };
      }
      // Switch to Custom FIRST: syncLabels reveals the four boxes on entering
      // 'custom' and only clears them when LEAVING it - the same order the
      // rate-book picker uses, so the fill always lands on visible fields.
      var sel = $('calc-work');
      if (sel && sel.value !== 'custom') {
        sel.value = 'custom';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      var set = function (id, val) {
        var el = $(id);
        if (el) {
          el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      };
      set('calc-custom-name', label);
      set('calc-custom-unit', unit.slice(0, 12));
      set('calc-custom-qty', qty > 0 && isFinite(qty) ? String(Math.round(qty * 1000) / 1000) : '');
      var rate = $('calc-custom-rate');
      if (rate) {
        rate.value = '';
        var wrap = $('calc-custom-wrap');
        if (wrap && wrap.scrollIntoView) {
          wrap.scrollIntoView({ block: 'center' });
        }
        rate.focus();
      }
      return { ok: true, label: label, unit: unit, qty: qty > 0 ? qty : null };
    } catch (e) {
      return { ok: false, error: 'I could not switch that line to your own rate.' };
    }
  }

  /* S-6.2 (owner 2026-10-22) - the settings the calculator ALREADY has, and
     nothing else. Every key is allowlisted here, range-checked against the
     input's own min/max, and written through the same input/change events a
     person typing would fire, so one render path prices the change. A key the
     page does not support is refused by name - never ignored, never invented. */
  var SETTING_FIELDS = {
    country: { id: 'calc-country', label: 'Country', select: true },
    taxOverride: { id: 'calc-tax-override', label: 'Custom tax', min: 0, max: 40, unit: '%' },
    overhead: { id: 'calc-oh', label: 'Overhead & margin', min: 0, max: 60, unit: '%' },
    onCostPct: {
      id: 'calc-oncost-pct',
      label: 'Statutory costs on labour',
      min: 0,
      max: 25,
      unit: '%'
    },
    designC: { id: 'calc-design-c', label: 'Design contingency', min: 0, max: 50, unit: '%' },
    constrC: { id: 'calc-constr-c', label: 'Construction contingency', min: 0, max: 50, unit: '%' }
  };
  function calcSettings(v) {
    try {
      if (!v || typeof v !== 'object') {
        return { ok: false, error: 'There are no settings in that reply.' };
      }
      var changed = [];
      var refused = [];
      Object.keys(v).forEach(function (k) {
        var spec = SETTING_FIELDS[k];
        if (!spec) {
          refused.push(k);
          return;
        }
        var el = $(spec.id);
        if (!el) {
          refused.push(k);
          return;
        }
        if (spec.select) {
          var want = String(v[k]);
          var ok = false;
          for (var i = 0; i < el.options.length; i++) {
            if (el.options[i].value === want) {
              ok = true;
              break;
            }
          }
          if (!ok) {
            refused.push(k);
            return;
          }
          if (el.value !== want) {
            el.value = want;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            changed.push({ field: k, label: spec.label, from: '', to: want });
          }
          return;
        }
        var n = Number(v[k]);
        if (!isFinite(n) || n < spec.min || n > spec.max) {
          refused.push(k);
          return;
        }
        // The statutory-cost percent only prices when its toggle is on; the
        // toggle is the person's switch, so applying a percent turns it on - a
        // number written into a disabled box would look applied and do nothing.
        if (k === 'onCostPct') {
          var tog = $('calc-oncost-toggle');
          if (tog && !tog.checked) {
            tog.checked = true;
            tog.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
        var before = String(el.value);
        el.value = String(n);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        if (before !== String(n)) {
          changed.push({ field: k, label: spec.label, from: before, to: n + spec.unit });
        }
      });
      if (!changed.length) {
        return {
          ok: false,
          error: refused.length
            ? 'I cannot change ' + refused.join(', ') + ' on this page.'
            : 'Those settings are already what you asked for.'
        };
      }
      render();
      return { ok: true, changed: changed, refused: refused };
    } catch (e) {
      return { ok: false, error: 'Those settings could not be changed.' };
    }
  }

  window.MMGR_CALC_RATEBOOK = calcRateBookText;
  // S-6.1 / S-6.2: the assistant's two powers over the form. Both are
  // optional hooks: a page without them loses those two buttons only.
  window.MMGR_CALC_USER_RATE = calcUserRate;
  window.MMGR_CALC_SETTINGS = calcSettings;
  // A1: the panel's mount and send path drive the ONE full-book loader. It
  // used to be looked up as a bare global that never existed, so the
  // 811-row book never loaded outside the rate-book card - the assistant
  // could not index the rates the owner published.
  window.MMGR_JIC_FULL_LOAD = rrLoadFull;
  // B1: the dry run, so the panel can ask for ONE missing box in plain words
  // instead of being told the figures failed.
  window.MMGR_CALC_CHECK = calcCheck;
  window.MMGR_CALC_POPULATE = calcPopulate;
  // The panel hook returns the BUILD (never a download): the chip the user
  // clicks is the only thing that fetches the file. The page's own Export
  // button keeps calling downloadCsv through its action.
  window.MMGR_CALC_FILE = buildCsv;
  // C4: the spreadsheet export, built from the same rows as the CSV.
  window.MMGR_CALC_XLSX = buildXlsx;

  /* OWNER 2026-10-08: the Assistant panel (js/calc-ai.js).
     #calc-ai-mount is the SWAP POINT - a later full-page takeover calls
     MMGR_CALC_AI.unmount() and mounts its own module on this same node, so
     nothing in the calculator's own logic has to be unpicked.
     MMGR_CALC_AI_CONTEXT is the optional hook that hands the panel a short,
     plain summary of the estimate ON SCREEN, so the answers are about this
     estimate instead of construction in general. Removing the hook only
     costs that context - the panel still works. */
  function mountCalcAssistant() {
    var AI = window.MMGR_CALC_AI;
    var mountNode = $('calc-ai-mount');
    if (!AI || typeof AI.mount !== 'function' || !mountNode) {
      return;
    }
    window.MMGR_CALC_AI_CONTEXT = function () {
      try {
        var r = lastResult;
        if (!r || r.error) {
          return 'No estimate has been worked out on the page yet.';
        }
        var money = function (v) {
          return v === undefined || v === null || v === ''
            ? ''
            : String(Math.round(Number(v) * 100) / 100);
        };
        var st = readState();
        // C8 (AUDIT-DIRECTIVE-2026-10-18): the panel must know which unit
        // system is on screen and which unit each box is asking for, so the
        // model never has to guess (and never converts - the page does).
        var wNow = WORK[st.work] || {};
        var boxWords = [];
        if (wNow.d1) {
          boxWords.push('d1 = ' + dimLabel(wNow, 'd1'));
        }
        if (wNow.d2) {
          boxWords.push('d2 = ' + dimLabel(wNow, 'd2'));
        }
        if (wNow.d3) {
          boxWords.push('d3 = ' + dimLabel(wNow, 'd3'));
        }
        var lines = [
          'Unit system on screen: ' + _units,
          'Work item key: ' + (st.work || ''),
          'Work item: ' + (r.name || '') + (r.unit ? ' (' + r.unit + ')' : ''),
          'Quantity: ' + (r.qty === undefined ? '' : r.qty) + (r.unit ? ' ' + r.unit : ''),
          'Currency: ' + (r.currency || ''),
          'Materials: ' + money(r.mat),
          'Labour: ' + money(r.lab),
          'Subtotal: ' + money(r.subtotal),
          'Tax: ' + money(r.tax),
          'Total: ' + money(r.total)
        ];
        if (boxWords.length) {
          lines.push('Boxes for this work item: ' + boxWords.join(', '));
        }
        if (r.unit) {
          lines.push(
            'This work item measures in: ' +
              r.unit +
              (r.qtyLabel ? ' (' + r.qtyLabel + ')' : '') +
              (_units === 'imperial' ? ' - imperial entry unit: ' + entryUnitName(r.unit) : '')
          );
        }
        if (r.allIn) {
          lines.push('All-in with preliminaries: ' + money(r.allIn));
        }
        return lines.join('\n');
      } catch (e) {
        return '';
      }
    };
    AI.mount(mountNode);
  }
  /* js/calc-ai.js is a separate classic script that loads AFTER this one, so
     mounting immediately would look up window.MMGR_CALC_AI too early and
     silently mount nothing. Wait for DOM-ready instead: every classic script
     in the body has run by then, whatever the tag order. */
  if (window.MMGR_CALC_AI) {
    mountCalcAssistant();
  } else {
    document.addEventListener('DOMContentLoaded', mountCalcAssistant, { once: true });
  }
  /* OWNER 2026-10-13: the star field the app and admin sections carry now
     runs here too - same mmgr-glass module, same glass preference, same
     capability floor (perf mode, weak hardware and narrow viewports stay on
     CSS). sync() is a no-op everywhere else. */
  // C6 boot (AUDIT-DIRECTIVE-2026-10-18): when the calcStickyPanel flag is
  // on, pin the estimate card (body class the CSS keys off) and wire the
  // mobile total bar - Show scrolls the card into view (instant under
  // prefers-reduced-motion), and an IntersectionObserver hides the bar
  // while the card is already on screen. Flag off: the class never lands,
  // the bar stays [hidden], and the page behaves exactly as before.
  if (calcStickyFlagOn()) {
    document.body.classList.add('bcp-sticky-on');
    const c6bar = $('calc-totalbar');
    const c6card = document.querySelector('.bcp-result');
    const c6show = $('calc-totalbar-show');
    if (c6bar) {
      c6bar.hidden = false;
    }
    if (c6show && c6card) {
      c6show.addEventListener('click', function () {
        const reduce =
          window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        c6card.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      });
    }
    if (c6bar && c6card && 'IntersectionObserver' in window) {
      new IntersectionObserver(
        function (entries) {
          c6bar.classList.toggle('is-off', entries[0].isIntersecting);
        },
        { threshold: 0.35 }
      ).observe(c6card);
    }
  }

  if (window.MMGR && MMGR.Glass && MMGR.Glass.sync) {
    MMGR.Glass.sync();
  }
})();
