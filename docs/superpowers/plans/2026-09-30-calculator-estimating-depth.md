# Calculator Estimating Depth - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan wave-by-wave. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn the single-item calculator into a planning-grade estimating
workspace - BoQ roll-up, preliminaries, contingency/escalation, cash-flow
curve, concrete accessories takeoff, location packs - without breaking
offline-first or the existing single-item flow.

**Architecture:** Everything new is a pure function beside `computeFor()` in
`js/calculator-page.js`, exposed via the existing `window.__calcEngine`-style
test-hook pattern; UI rides the `data-action` dispatch; state lives in new
localStorage keys (`mmgr_calc_boq`, `mmgr_calc_prelims`, `mmgr_calc_locpacks`);
every wave is one commit behind gates.

**Tech Stack:** Vanilla JS (global namespace, load-order via build.js),
`dist/mmgr.min.css`, Playwright QA harnesses (`tools/qa-calculator-page.cjs`,
`tools/qa-calc-playwright-audit.cjs`), Cloudflare Workers static deploy.

**Spec:** `docs/superpowers/specs/2026-09-30-calculator-estimating-depth-design.md`

## Global Constraints (verbatim, apply to every wave)

- OFFLINE-FIRST: zero network calls for prices; no new external requests.
- No emoji on any served page or JS-rendered string (AGENTS.md gate 7).
- No AI-assistant credit in commits (AGENTS.md gate 8); Conventional Commits
  (`feat(calculator): ...`), subject <= 72 chars, imperative.
- Plain-language copy (plain-language skill): no estimating jargon in user
  faces; label things by what they do ("Site running costs", not "time-related
  preliminaries").
- calculator.html has NO inline scripts: never add one (CSP hashes).
- Any change to css/ or js/calculator-page.js -> `node build.js` then bump
  `?v=` in calculator.html (start at v=11 -> 12 on first wave merge, +1 per
  wave that ships assets).
- Harness rule: new gate consts in `tools/qa-calculator-page.cjs` must use a
  FRESH prefix (B/G/N/doc/TUT/W1,X1,E1,T1 taken; use `bq`, `in`, `pl`, `rg`,
  `cf`, `fa`, `lp` families - one per wave).
- Every wave: `node tools/qa-calculator-page.cjs` + `node
  tools/qa-calc-playwright-audit.cjs` + `npm run verify` green before commit.
- After every wave: update `docs/CI-TEST-COVERAGE.md` if a new harness file is
  added (prefer ADDING SECTIONS to existing harnesses over new files), then
  push and poll the Actions API until green (AGENTS.md lesson 8).
- Test hook pattern (established): `window.__calcEngine = {...}` with comment
  "Test hook (harness-only convenience; harmless in production)."
- Deploy only after CI green via `node tools/deploy.cjs` (build -> verify ->
  staged copy byte-proof -> deploy), then production smoke.

## File Structure

- Modify: `js/calculator-page.js` - pure engine additions (BoQ totals,
  prelims, cashCurve, formwork derivation, location packs), ACTIONS entries,
  render functions, test hooks.
- Modify: `calculator.html` - new cards (Bill of quantities, Site & other
  costs, Cash flow), assets `?v=` bumps.
- Modify: `css/mmgr.css` - styles for new cards (reuse .card/.bcp-* patterns;
  keep new rules in the calculator block ~line 2500+, respect the CSS
  comment-closer trap, AGENTS.md lesson 13).
- Modify: `tools/qa-calculator-page.cjs` - new gate sections per wave.
- Modify: `tools/qa-calc-playwright-audit.cjs` - one mobile gate per new card.
- Modify: `docs/CI-TEST-COVERAGE.md` - only if new harness files appear.

---

### Task 1 (W1): BoQ roll-up - multi-line bill

**Files:** `js/calculator-page.js`, `calculator.html`, `css/mmgr.css`,
`tools/qa-calculator-page.cjs`

**Interfaces:**
- Consumes: `computeFor(st)` (existing pure engine), `readState()`,
  `esc()`, `$()`, ACTIONS dispatch.
- Produces: `boqTotals(lines) -> {perLine:[{name,qty,unit,mat,lab,eq,sub}],
  mat, lab, eq, sub}` (pure); `loadBoq()/saveBoq(list)` on key
  `mmgr_calc_boq` (max 20 bills, 60 lines each); ACTIONS `calcBoqAdd`,
  `calcBoqRemove`, `calcBoqClear`, `calcBoqRecall`, `calcBoqSave`,
  `calcBoqOpen`, `calcBoqDelete`; test hook
  `window.__calcEngine = { computeFor, boqTotals }`.

- [ ] **Step 1: Write failing gates (bq family) in tools/qa-calculator-page.cjs**

```js
// BQ1: engine hook exists and prices two lines to a rolled-up subtotal
var bqT = await ev('JSON.stringify({ t: (function(){ '
  + 'var a = window.__calcEngine.computeFor({work:"slab",d1:"10",d2:"10",d3:"100",units:"metric",currency:"USD",country:"US",quality:"standard",rateMat:"",rateLab:"",rateEq:"",ohPct:"",wastePct:"",piecePrice:"",pieceSize:""}); '
  + 'var b = window.__calcEngine.computeFor({work:"blockwall",d1:"10",d2:"2.4",d3:"",units:"metric",currency:"USD",country:"US",quality:"standard",rateMat:"",rateLab:"",rateEq:"",ohPct:"",wastePct:"",piecePrice:"",pieceSize:""}); '
  + 'var s = window.__calcEngine.boqTotals([{r:a},{r:b}]); '
  + 'return {n:s.perLine.length, sub:s.sub}; })() });');
assert(bqT.perLine && bqT.perLine.length === 2 && bqT.sub > 0, 'BQ1 boqTotals rolls up two lines');
// BQ2: add-line action stores current form state into mmgr_calc_boq
// BQ3: totals row renders per-line rows into #calc-boq-body
// BQ4: recall re-fills the form from a stored line (exact recall)
```

- [ ] **Step 2: Run gates - expect FAIL** (`node tools/qa-calculator-page.cjs`)
- [ ] **Step 3: Implement** - pure `boqTotals()` beside `computeFor()`; BoQ
  card markup in calculator.html after the history card (`#calc-boq-card`,
  table `#calc-boq-body`, "Add current form as a line" button
  `data-action="calcBoqAdd"`); storage helpers on `mmgr_calc_boq`; render +
  ACTIONS entries following the renderEstimates pattern.
- [ ] **Step 4: build + bump** - `node build.js`; `?v=` -> next value.
- [ ] **Step 5: Gates green** - full battery (see Global Constraints).
- [ ] **Step 6: Commit** - `feat(calculator): multi-line bill of quantities`

### Task 2 (W2): Element instances - add-a-wall measurement

**Files:** `js/calculator-page.js`, `calculator.html`, `css/mmgr.css`,
`tools/qa-calculator-page.cjs`

**Interfaces:**
- Consumes: `WORK[key].q`, `computeFor(st)` (extended to honor
  `st.measuredQty`), unit conversion helpers (FT/IN), `esc()`.
- Produces: pure `instancesQty(rows, kind) -> {qty, rows}` where rows are
  `{label, d1, d2?, d3?, n}` (n = identical-repeat count, default 1) and kind
  is `area | volume | run` mapping each row through the SAME conversion rules
  as typed dims; `computeFor(st)` change: when `st.measuredQty > 0`, skip the
  missing-dims error and q(), use measuredQty directly (waste %, quality,
  piece pricing, rates unchanged); DOM: instance rows editor inside the
  dimensions `.bcp-row` (hidden unless the trade matches a group);
  ACTIONS `calcInstAdd`, `calcInstDel`, `calcInstToggle`; test hook
  `window.__calcEngine.instancesQty`.

- [ ] **Step 1: Failing gates (in family)** - in1 `instancesQty` sums wall
  rows with counts (rows [Wall 1 10x2.4 n2, Wall 2 6x2.4] -> 62.4 m2); in2
  `computeFor` with `measuredQty` ignores empty d1/d2 and prices the measured
  area (blockwall 62.4 m2 -> exact mat/lab expected by hand); in3 measured
  quantity still honors waste % and quality (same input + 10% waste + premium
  -> exact values); in4 rows editor shows for blockwall, hidden for rebar;
  in5 override field ("type the total instead") bypasses rows entirely.
- [ ] **Step 2: Gates FAIL** (`node tools/qa-calculator-page.cjs`)
- [ ] **Step 3: Implement** - pure `instancesQty()`; `computeFor` measuredQty
  branch BEFORE the dim-validation error (computeFor lines in the D2 block);
  rows editor markup (label input + dim inputs + count + remove button per
  row, mirror the bcp-row field classes); wire into readState/applyState so
  history + recall keep instances (st.instances JSON string).
- [ ] **Step 4: build + bump** - `node build.js`; `?v=` -> next value.
- [ ] **Step 5: Gates green** - full battery (see Global Constraints).
- [ ] **Step 6: Commit** - `feat(calculator): measure by wall, pour and run instances`

### Task 3 (W3): Statutory labor on-costs (JM-verified) + Contractors Levy note

**Files:** `js/calculator-page.js`, `calculator.html`, `tools/qa-calculator-page.cjs`

**Interfaces:**
- Consumes: labor subtotal inside `computeFor()`.
- Produces: `st.onCostPct` consumed by `computeFor`: `onCost = lab * onCostPct/100`,
  `sub = mat + lab + onCost + eq` (empty/0 = off; cap 25%); breakdown line
  `Labor statutory costs (NIS, NHT, HEART, Education)`; toggle
  `#calc-oncost-toggle` + field `#calc-oncost-pct` (auto-fills 12.5 when the
  country select changes to JM and the toggle is enabled and the field is
  untouched); JM-only static fine-print note `#calc-jm-levy-note` under the
  output (2% Contractors Levy withholding, TAJ, 14 days of month-end).
  Defaults sourced: NIS 3% (J$5M/yr cap) + NHT 3% + HEART 3% + Education Tax
  3.5% = 12.5% of gross payroll (PwC/Dawgen/Skuad/HEART-NSTA, 2026).

- [ ] **Step 1: Failing gates (sx family)** - sx1 off by default (no onCost
  key -> line absent); sx2 12.5% on a known labor subtotal (exact value);
  sx3 cap at 25; sx4 line label renders with pct; sx5 JM levy note shows
  only when country=JM.
- [ ] **Step 2: Gates FAIL** -> **Step 3: Implement** (computeFor math + UI
  near the tax-override field) -> **Step 4: build + bump** ->
  **Step 5: Gates green** -> **Step 6: Commit**
  `feat(calculator): optional employer statutory costs on labor (JM)`

### Task 4 (W4): Preliminaries - site & other costs card

**Files:** `js/calculator-page.js`, `calculator.html`, `css/mmgr.css`,
`tools/qa-calculator-page.cjs`

**Interfaces:**
- Consumes: `boqTotals().sub` (W1) or single-estimate subtotal.
- Produces: pure `prelimsTotal(items, works) -> {perItem:[{name,amount}],
  total}`; items `{id,name,basis:'fixed'|'pct'|'week',value,weeks}` on key
  `mmgr_calc_prelims`; preset `PRELIM_PRESET_RES` (six items summing ~6-7% of
  works: site establishment, permits & approvals, insurance & bonds, site
  supervision, temporary utilities & welfare, demob & clean);
  ACTIONS `calcPrelimPreset`, `calcPrelimAdd`, `calcPrelimRemove`,
  `calcPrelimClear`; hook `window.__calcEngine.prelimsTotal`.

- [ ] **Step 1: Failing gates (pl family)** - pl1 pure total for fixed/pct/week
  bases; pl2 preset = 6 items; pl3 card renders item rows + total into
  `#calc-prelims-body`; pl4 removal persists.

- [ ] **Step 1: Failing gates (pl family)** - pl1 pure total for fixed/pct/week
  bases; pl2 preset = 6 items; pl3 card renders item rows + total into
  `#calc-prelims-body`; pl4 removal persists.
- [ ] **Step 2: Gates FAIL** -> **Step 3: Implement** (card "Site & other
  costs", basis select per item, weeks field shown only for `week` basis)
  -> **Step 4: build + bump** -> **Step 5: Gates green** -> **Step 6: Commit**
  `feat(calculator): preliminaries card for site and other costs`

### Task 5 (W5): Contingency + escalation + duration on the roll-up

**Files:** `js/calculator-page.js`, `calculator.html`, `tools/qa-calculator-page.cjs`

**Interfaces:**
- Produces: pure `rollup({works, prelims, designC, constrC, escPct, months})
  -> {works, prelims, designC, constrC, esc, subtotal}`; escalation = simple
  %/yr applied over months/12 on (works+prelims); order: works -> prelims ->
  design C -> construction C -> escalation; hook
  `window.__calcEngine.rollup`; fields `#calc-design-c`, `#calc-constr-c`,
  `#calc-esc-pct`, `#calc-months` (defaults 10 / 5 / 5 / blank).
- [ ] **Step 1: Failing gates (rg family)** - rg1 pure math (works 100000,
  prelims 6000, 10/5/5%, 12mo -> exact expected values computed by hand);
  rg2 defaults render; rg3 total row shows the full waterfall.
- [ ] **Step 2: FAIL** -> **Step 3: Implement** (fields live in the Site &
  other costs card bottom; fine print gains "planning band" sentence)
  -> **Step 4: build + bump** -> **Step 5: Gates green** -> **Step 6: Commit**
  `feat(calculator): contingency, escalation and duration on the roll-up`

### Task 6 (W6): Cash flow curve (S-curve) + CSV

**Files:** `js/calculator-page.js`, `calculator.html`, `css/mmgr.css`,
`tools/qa-calculator-page.cjs`

**Interfaces:**
- Produces: pure `cashCurve(total, months, mode, steep) ->
  {per:[], cum:[]}`; mode 'straight' | 'scurve'; scurve = normal
  distribution over months normalized to total (steep = sigma factor,
  default 1.5); straight = equal months; hook `window.__calcEngine.cashCurve`;
  ACTIONS `calcCashRender`, `calcCashCsv`; table `#calc-cash-body`.
- [ ] **Step 1: Failing gates (cf family)** - cf1 straight: 12 months ->
  per[i] === total/12 (float-safe compare 2dp); cf2 scurve: per sums to
  total (2dp) and middle months exceed end months; cf3 CSV downloads
  (blob-URL pattern from downloadCsv).
- [ ] **Step 2: FAIL** -> **Step 3: Implement** (card "Cash flow", hidden
  until months set; mode select; monthly + cumulative columns)
  -> **Step 4: build + bump** -> **Step 5: Gates green** -> **Step 6: Commit**
  `feat(calculator): monthly cash flow curve with CSV export`

### Task 7 (W7): Concrete accessories - derived formwork + rebar laps

**Files:** `js/calculator-page.js`, `tools/qa-calculator-page.cjs`

**Interfaces:**
- Consumes: W2 instances (a pour line's rows can feed the derivation).
- Produces: pure `formworkM2(key, d1, d2, d3) -> m2|null` - slab and
  concrete-drive: `2*(d1+d2)*(d3/1000)` (edge formwork); footings:
  `2*(d1+d2)*(d3/1000)` (sides); null for other trades; rebar add-on: waste %
  field on the rebar row (default empty = included in 85 kg/m3, hint text
  carries the 10-18% research band); "Add derived lines to the bill" action
  creates BoQ lines with rate fields prefilled from a new
  `FORM_RATE_DEFAULT = 55` per m2 (comment cites research, editable).
- [ ] **Step 1: Failing gates (fa family)** - fa1 formworkM2 exact values
  (slab 10x10x100mm -> 4.04 m2? NO: 2*(10+10)*0.1 = 4.0 m2; footing
  10m run x 0.5m x 0.5m deep -> 2*(10+0.5)*0.5 = 10.5 m2); fa2 other trades
  -> null; fa3 derived-line add creates two BoQ lines.
- [ ] **Step 2: FAIL** -> **Step 3: Implement** -> **Step 4: build + bump**
  -> **Step 5: Gates green** -> **Step 6: Commit**
  `feat(calculator): derived formwork and rebar lap takeoff`

### Task 8 (W8): Location data packs (offline)

**Files:** `js/calculator-page.js`, `calculator.html`, `tools/qa-calculator-page.cjs`

**Interfaces:**
- Produces: pack `{id,name,currency,taxDefault,index,benchmark}` on key
  `mmgr_calc_locpacks` (max 20); shipped seeds US (index 1.0, benchmark
  line), JM (GCT 15% - PwC; index editable), GB (VAT 20%); index multiplies
  MATERIAL rates only when the user ticks "apply location index" (labor
  stays user-owned); JSON export/import reusing the rate-sheet file flow
  (`calcSheetExport/Import` pattern -> `calcPackExport/Import`).
- [ ] **Step 1: Failing gates (lp family)** - lp1 seeds exist after first
  load; lp2 applying a pack sets currency + tax default and applies index to
  material rates in the engine preview; lp3 export produces JSON with the
  packs; lp4 import merges with skip rules (invalid index ignored).
- [ ] **Step 2: FAIL** -> **Step 3: Implement** -> **Step 4: build + bump**
  -> **Step 5: Gates green** -> **Step 6: Commit**
  `feat(calculator): offline location data packs`

### Task 9 (W9): Integration pass - UI, guide, tour, mobile, docs

**Files:** `js/calculator-page.js`, `calculator.html`, `css/mmgr.css`,
`tools/qa-calc-playwright-audit.cjs`, `docs/` changelog

- [ ] **Step 1: Estimate summary restructure** - grand total waterfall card:
  Works -> Prelims -> Design contingency -> Construction contingency ->
  Escalation -> Subtotal -> Tax -> TOTAL; single-item flow unchanged when no
  BoQ lines exist (regression gate: all 91 existing gates still green).
- [ ] **Step 2: Guide + tour** - GUIDE_STEPS grows to cover the bill, the
  instance rows and site costs cards; TOUR_STEPS gains up to 2 steps (bill,
  site costs); nudge copy
  unchanged; spotlight works on the new cards automatically (body-level
  furniture + tourBlurSet path marking, 2026-09-30 fix).
- [ ] **Step 3: Mobile gates** - M-family additions in the Playwright audit:
  no horizontal scroll at 390 with the bill populated; new cards stack
  single-column; inputs 16px.
- [ ] **Step 4: Docs** - CHANGELOG entry; fine print: "Planning-grade
  (AACE Class 5/4 band): expect roughly -15% to +30% variance until drawings
  are priced." ; spec cross-link.
- [ ] **Step 5: Full battery + build + bump** -> **Step 6: Commit**
  `feat(calculator): estimate workspace integration pass`

### Task 10: Ship loop (per wave, repeated)

- [ ] `node build.js` && `npm run verify`
- [ ] `node tools/qa-calculator-page.cjs` (91 + new) && `node
  tools/qa-calc-playwright-audit.cjs` (36 + new)
- [ ] Push -> poll `api.github.com/repos/garfiel-pixel/My-MaNaGeR/actions`
  until `completed` -> fix harness-vs-app drift first if red (AGENTS.md
  lesson 8) -> `node tools/deploy.cjs` -> production smoke
  (`curl /calculator` + one Playwright pass against production).

## Self-review

- Spec coverage: assessment's real gaps (1.2 items 1-7) map to W1..W5, W6, W3;
  false claims (1.1) are corrected in the spec, not re-implemented.
- Placeholders: none - every gate family has its assertion sketch and every
  module its pure-function signature and storage key.
- Type consistency: `boqTotals(lines[{r}])`, `instancesQty(rows, kind)`,
  `prelimsTotal(items, works)`, `computeFor(st.onCostPct)`,
  `rollup({works,prelims,designC,constrC,escPct,months})`,
  `cashCurve(total,months,mode,steep)`, `formworkM2(key,d1,d2,d3)` used
  consistently across gates and hook exports.
- Reference coverage: tru-estimator pattern (instance rows + identical-count
  multiplier + total-override) lands in Task 2; its phase-2 ideas are parked
  in the spec, not silently dropped.
- Wave numbering: W1..W8 map to Tasks 1..8; ship loop is Task 9.
