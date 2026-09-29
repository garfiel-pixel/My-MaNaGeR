# Build Cost Calculator Enhancement Waves + Project Header Regroup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Load `no-slacking` and `verification-before-completion` before starting. Per AGENTS.md, load `universal-ui-architect` + `ui-modernization` before the UI tasks.

**Goal:** Implement the owner-approved calculator review (grouped UX layout, unit-primary hero, editable waste %, piece counts, equipment/overhead lines, rate-sheet transfer, estimate comparison, quote-ready print header) and regroup the project.html header (navigation left, utility toggles right).

**Architecture:** All calculator logic stays in the standalone `js/calculator-page.js` (no bundle, no inline scripts — CSP unchanged). `compute()` is extracted into a pure `computeFor(state)` so live math, exact recall, and comparison share one engine. All styling is token-only additions to the existing `bcp-`/`calc-` block in `css/mmgr.css` (rebuilt by `node build.js`). Header regroup is markup + CSS only in `project.html` — no JS, so CSP hashes stay untouched.

**Tech Stack:** Vanilla JS (global-namespace IIFE), CSS custom-property tokens, localStorage, serve.cjs QA battery (no new dependencies, offline-first preserved).

## Global Constraints (from AGENTS.md — every task inherits these)

- **No emoji** on any served page or in any JS string that renders into a page. Icons are sprite symbols only (`css/mmgr-icons.svg#i-...`). All needed symbols already exist (`i-download`, `i-upload`, `i-bar-chart`, `i-printer`, `i-receipt`) — do not add new ones.
- **No inline scripts** in calculator.html — all JS external. No CSP hash work needed if this holds.
- **Cache-busting:** calculator.html does not register the service worker; its asset URLs ride 1-year immutable HTTP cache. Any change to `dist/mmgr.min.css` or `js/calculator-page.js` MUST bump the `?v=` query in calculator.html (currently CSS `?v=7`, JS `?v=8` — both go to `?v=9`).
- **Rebuild after any source change:** `node build.js` (builds bundles AND minifies CSS). Editing `js/calculator-page.js` alone needs no bundle rebuild, but CSS changes do.
- **Conventional Commits**, subject ≤ 72 chars, imperative, no trailing period. **NO AI-assistant credit footers, ever** (owner hard gate — plain commits only).
- **Offline-first:** everything stays on-device; no network calls added.
- Harness-contract class names (`.calc-empty`, `.calc-line*`, `.calc-sum*`, `.calc-hist*`, `.bcp-est-row`, `.bcp-sheet-row`) must keep working — `tools/qa-calculator-page.cjs` asserts them.
- Verify each wave: `node tools/qa-calculator-page.cjs` (must stay green; extend it with new gates), and at the end `npm run verify` + `tools/qa-calc-playwright-audit.cjs`.

## Review-gap note (do not re-implement what already exists)

The pasted reviews were partly written against the v329-era page. Already shipped since:
- **Conditional piece fields** — `refreshRateFields()` already hides `#calc-piece-wrap` + `#calc-piece-hint` for non-piece trades (`pw.hidden = !w.piece`). Task A1 keeps this and adds a regression gate; it does not re-build it.
- **Editable rates, unit toggle, named estimates, rate sheets, CSV/print** — shipped in v329–v333.
What is genuinely missing and in scope: grouped layout, imperial-primary hero, editable waste, piece counts, equipment + overhead lines, rate-sheet import/export, comparison, quote header. Plus the header regroup from the owner's mid-review message.

---

## File Structure

| File | Responsibility in this plan |
|---|---|
| `calculator.html` | Grouped fieldsets, new inputs (waste, equipment, overhead), compare card, quote-details row, `?v=9` bumps |
| `js/calculator-page.js` | `computeFor()` extraction, waste refactor, `unitConv()`, `pieceCount()`, overhead/equipment math, compare + import/export actions, print head data |
| `css/mmgr.css` | `.bcp-group` sub-card rules, `.bcp-cmp` compare table, `.bcp-quote-head` print-only block, project header regroup rules |
| `project.html` | Header markup regroup (`#hdr-left` wrapper) |
| `tools/qa-calculator-page.cjs` | New gates (G-series) + re-baselined string assertions |
| `docs/CI-TEST-COVERAGE.md` | Registry row update for qa-calculator-page |
| `sw.js` | `CACHE` bump to `mmgr-shell-v336` + version narrative comment |

---

### Task 0: Baseline and assertion inventory

**Files:** none modified (read-only)

- [ ] **Step 1: Confirm green baseline**

```bash
node tools/qa-calculator-page.cjs && node tools/qa-calc-playwright-audit.cjs
```
Expected: both exit 0 (51 gates + 31 gates). If red, stop and fix the baseline first — nothing in this plan may start from a red suite.

- [ ] **Step 2: Inventory harness assertions that will change**

```bash
grep -n "incl\. \|cuts/waste\|laps\|Estimated total\|Subtotal\|calc-sum" tools/qa-calculator-page.cjs tools/qa-calc-playwright-audit.cjs
```
Record every hit — those strings move/change in Tasks B1 (waste suffix leaves `qtyLabel`) and B3 (new rows). Each gets re-baselined in the same task that changes it.

- [ ] **Step 3: Commit** — nothing to commit; this task only produces the inventory (paste it into the Task F commit body).

---

### Task A1: Grouped input card ("Dimensions", "Item & material", "Cost rates & taxes")

**Files:**
- Modify: `calculator.html` (input card only)
- Modify: `css/mmgr.css` (append to the bcp- block, before the print sheet)
- Modify: `tools/qa-calculator-page.cjs` (2 new gates)

- [ ] **Step 1: Restructure the input card into three labeled fieldsets**

Keep every existing id/class (harness contract). Wrap existing rows — move nothing out of the card, change no input ids. Skeleton (comment kept per no-emoji/SVG rules; use existing sprite symbols in group legends):

```html
<fieldset class="bcp-group">
  <legend><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-crosshair"></use></svg> Dimensions &amp; measurement</legend>
  <!-- existing: #calc-units-label seg control, #calc-d1/d2/d3 row, currency + country row -->
</fieldset>
<fieldset class="bcp-group">
  <legend><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-cube"></use></svg> Item &amp; material parameters</legend>
  <!-- existing: #calc-work select, piece wrap + hint, NEW waste field (Task B1 lands here) -->
</fieldset>
<fieldset class="bcp-group">
  <legend><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-dollar"></use></svg> Cost rates &amp; taxes</legend>
  <!-- existing: rates head, rate row, sheets bar, sheets list, quality + tax override row -->
</fieldset>
```
Move the `#calc-work` select into the Item group (it IS the item). Keep the Calculate button after the last fieldset. Fieldset reset is mandatory inside `.card`:

- [ ] **Step 2: Add the group CSS (token-only)**

```css
/* 2026-09-29 owner review: input card grouped into three labeled blocks. */
.bcp-group{border:1px solid var(--border);border-radius:12px;padding:12px 14px 14px;margin:0 0 14px;min-width:0;}
.bcp-group legend{display:inline-flex;align-items:center;gap:6px;padding:0 8px;font-size:.72rem;font-weight:700;letter-spacing:.02em;color:var(--gold);}
.bcp-group legend .ico{width:14px;height:14px;}
.bcp-group .bcp-row:last-child{margin-bottom:0;}
```

- [ ] **Step 3: Regression gate for conditional piece fields (locks existing behavior)**

In `tools/qa-calculator-page.cjs`, add one gate: select `tile` → `#calc-piece-wrap.hidden === false`; select `excav` → `hidden === true`; select `slab` → visible with label containing `Price per bag of mix`. (Behavior already correct since v332 — this makes it un-rottable.)

- [ ] **Step 4: Run** `node tools/qa-calculator-page.cjs` — expected PASS (51 + 1 gates).

- [ ] **Step 5: Commit** `feat(calculator): group estimator inputs into labeled sections`

---

### Task A2: Imperial-primary hero quantity

**Files:** Modify `js/calculator-page.js`, `tools/qa-calculator-page.cjs`

- [ ] **Step 1: Add a direction-aware converter next to `qtyAlt`**

```javascript
// Imperial primary (2026-09-29 review): the hero shows the user's unit system
// first. One conversion table drives both directions.
const UNIT_CONV = {
  m2: { imp: ['sq ft', 10.7639, 0], met: ['m2', 1, 2] },
  m3: { imp: ['cu yd', 1.30795, 1], met: ['m3', 1, 2] },
  m:  { imp: ['ft', 3.28084, 1],    met: ['m', 1, 2] },
  L:  { imp: ['US gal', 0.264172, 1], met: ['L', 1, 2] }
};
function qtyShown(qty, unit) {
  const c = UNIT_CONV[unit];
  if (!c) return { main: (Math.round(qty * 100) / 100) + ' ' + unit, alt: '' }; // 't' and unknown: metric only
  const pick = _units === 'imperial' ? c.imp : c.met;
  const val = Math.round(qty * pick[1] * Math.pow(10, pick[2])) / Math.pow(10, pick[2]);
  const other = _units === 'imperial' ? c.met : c.imp;
  const oval = Math.round(qty * other[1] * Math.pow(10, other[2])) / Math.pow(10, other[2]);
  return { main: val.toLocaleString() + ' ' + pick[0],
           alt: ' (about ' + oval.toLocaleString() + ' ' + other[0] + ')' };
}
```
Refactor `qtyAlt()` to delegate to `qtyShown().alt` (metric mode returns `''`, matching today), and rewrite the `calc-sum-qty` line in `render()` to use `qtyShown(r.qty, r.unit)`. The `.calc-qty-alt` span keeps rendering the secondary reading in both directions (metric users see nothing extra — alt is empty — same as today).

- [ ] **Step 2: CSV + print follow the primary unit**

In `estimateCsv`, the `Quantity` row becomes `qtyShown(r.qty, r.unit).main + qtyShown(...).alt`.

- [ ] **Step 3: Harness gate I1**

Imperial mode + tile 6 m × 6 m → `#calc-output .calc-sum-qty` text starts with a `sq ft` value (~388 sq ft) and contains `(about 36 m2)`; metric mode → starts with `36 m2`. Add to the G-series.

- [ ] **Step 4: Run harness → PASS. Commit** `feat(calculator): hero quantity follows the selected unit system`

---

### Task B1: Editable waste & cuts %

**Files:** Modify `js/calculator-page.js`, `calculator.html`, `tools/qa-calculator-page.cjs`

- [ ] **Step 1: Move waste out of `q()` into a per-trade spec**

`q()` returns BASE quantity; `compute()` applies `(1 + waste/100)`. Exact numbers preserved (defaults = today's baked-in values):

| Trade | old baked | `waste` spec |
|---|---|---|
| slab, footings, concrete-drive | ×1.05 | `waste: { def: 5, lbl: 'Concrete waste' }` |
| roof | ×1.1 | `waste: { def: 10, lbl: 'Laps / pitch allowance' }` |
| tile | ×1.1 | `waste: { def: 10, lbl: 'Cuts / waste' }` |
| all others | — | no `waste` key |

Remove the multipliers from the five `q()` bodies; `qtyLabel` drops the "incl. x%" suffix ("Concrete", "Sheet area", "Tiles"). Excavation's 1.25 **bulking stays inside `q()`** — it is soil swell, not waste.

- [ ] **Step 2: The input** — inside the Item & material fieldset, after the piece hint:

```html
<div class="bcp-field" id="calc-waste-wrap" hidden>
  <label for="calc-waste" id="calc-waste-label">Waste &amp; cuts %</label>
  <input type="number" id="calc-waste" min="0" max="50" step="0.5" inputmode="decimal" placeholder="e.g. 15 for herringbone">
</div>
```
`refreshRateFields()` shows it only for waste trades (`$('calc-waste-wrap').hidden = !w.waste`), sets the label to `w.waste.lbl + ' %'`, and prefills the default when empty (same prefill rule as rates: value lives in `dataset.def`, empty → def). `compute()` reads it: `const wastePct = isFinite(parseFloat(el.value)) ? clamp(parseFloat(el.value), 0, 50) : w.waste.def;` then `const qty = qr.qty * (1 + wastePct / 100);`. Result object gains `wastePct`.

- [ ] **Step 3: Output line + persistence**

`render()` adds, right under the calc-sum block: `row(waste line, wastePct + '%')` — only for waste trades. `readState()` gains `wastePct`; `applyState()` restores it (missing/'' → clear the field so the default prefill rule takes over — reproduces legacy sums exactly). `estimateCsv` gains a `Waste allowance` row.

- [ ] **Step 4: Re-baseline + new gates.** Re-baseline the Task 0 inventory hits that asserted "incl. 10% cuts/waste" etc. New gates W1–W3: tile defaults to 10 and total matches today's 6×6 number exactly (regression: `950-per-tile` R-gate sums unchanged); typing 20 raises the tile count line and total; non-waste trade (blockwall) hides the field.

- [ ] **Step 5: Run harness → PASS. Commit** `feat(calculator): editable waste and cuts allowance per trade`

---

### Task B2: Piece / unit count breakdown

**Files:** Modify `js/calculator-page.js`, `tools/qa-calculator-page.cjs`

- [ ] **Step 1: Pure counter, shared by render + CSV**

```javascript
// Piece count (2026-09-29 review: 'exact count of tiles/boxes required').
// Works with or without a piece PRICE: a size alone shows the count while
// material cost stays on the rate; price too switches to per-piece math.
function pieceCount(qty, unit, spec, sizeStr) {
  if (!spec || !sizeStr) return null;
  if (spec.div === 'volume') {
    const y = parseFloat(sizeStr);
    if (!isFinite(y) || y <= 0) return null;
    const litres = unit === 'm3' ? qty * 1000 : qty; // concrete m3 -> L; paint already L
    return { n: Math.ceil(litres / y), lbl: (unit === 'm3' ? 'bags/units at ' : 'containers at ') + y + ' L' };
  }
  const m = sizeStr.match(/^([\d.]+)\s*(?:x|by|\*)\s*([\d.]+)$/i);
  if (!m) return null;
  const conv = _units === 'imperial' ? (spec.unit === 'm' ? FT : FT * 100) : 1;
  const a = parseFloat(m[1]) * conv, b = parseFloat(m[2]) * conv;
  if (!(a > 0 && b > 0)) return null;
  if (spec.div === 'width') return { n: Math.ceil(qty / a), lbl: spec.plural || 'panels/units' };
  const areaM2 = spec.unit === 'm' ? a * b : (a / 100) * (b / 100);
  return { n: Math.ceil(qty / areaM2), lbl: spec.plural || 'pieces' };
}
```
Add `plural` to the five piece specs (`'tiles'`, `'blocks'`, `'bricks'`, `'sheets'`, `'panels'`; volume specs leave it null). `compute()` calls it with the SAME qty the cost math used (post-waste) and attaches `r.count`. The piece-size input now activates the count **even when the price field is empty** — extend the compute guard so size-only mode skips the per-unit rate override (cost math untouched).

- [ ] **Step 2: Display.** Under the quantity hero in `calc-sum`: `<div class="calc-sum-sub">Order about <strong>N</strong> tiles — 950 per tile covers it</div>` when price present, else `Order about N tiles at 30 x 60 cm`. CSV gains an `Order quantity` row. No new CSS (reuses `.calc-sum-sub`).

- [ ] **Step 3: Gates C1–C2.** Tile 36 m2 + 30×60 + 950 → count = 221 (`ceil(36/0.18)`); slab 10×10×100 mm with yield 20 → `ceil(1050000/20)`… use the harness's own slab numbers and assert the printed count matches `Math.ceil(qtyL/yield)`.

- [ ] **Step 4: Run harness → PASS. Commit** `feat(calculator): show piece and container counts for ordering`

---

### Task B3: Equipment rate + Overhead & margin % (granular itemization)

**Files:** Modify `calculator.html`, `js/calculator-page.js`, `css/mmgr.css` (none needed), `tools/qa-calculator-page.cjs`

Math order (documented in the fine print): `mat/lab/eq = qty × rate × quality`; `sub = mat + lab + eq`; `oh = sub × ohPct`; `tax = (sub + oh) × taxRate`; `total = sub + oh + tax`. Equipment is a third rate field on the same per-unit basis as material/labor (quality applies, consistent with the existing model).

- [ ] **Step 1: Markup.** Cost rates group gains: third field in the rates row `#calc-rate-eq` (label `Equipment / plant hire <per-unit>` — label follows `rateUnitLabel(key)` like the others, placeholder `0 = none`); and in the quality/tax row's group a new field `#calc-oh` `Overhead & margin % (optional)` (`min=0 max=60 step=0.5`).

- [ ] **Step 2: Compute + render.** `compute()` reads both (empty/0 = inactive). Result gains `eq`, `ohPct`, `oh`. `render()` inserts `row('Equipment / plant hire', fmtMoney(r.eq))` only when `r.eq > 0`, and `row('Overhead & margin ' + r.ohPct + '%', fmtMoney(r.oh))` only when `r.ohPct > 0` — defaults stay exactly today's four rows, so existing gates hold untouched. Existing `matDesc` fine print stays truthful — consumables (adhesive/grout) remain inside the material rate; that is already stated by `matDesc`.

- [ ] **Step 3: Persistence.** `readState()` gains `rateEq`, `ohPct`; `applyState()` restores them. Rate sheets extend `rates` to `{ rateMat, rateLab, rateEq?, piecePrice?, pieceSize?, ohPct? }` — `applySheetById` sets the new fields when present, leaves them when absent (old sheets keep working); `calcSheetSave` stores them. `estimateCsv` gains `Equipment`, `Overhead %`, `Overhead` rows.

- [ ] **Step 4: Gates E1–E3.** Equipment 10/unit on slab adds exactly `qty×10×quality` to subtotal; overhead 10% on a known subtotal yields subtotal×0.10 as its own line and tax recomputes on `sub+oh`; old rate sheet (no new keys) applies without breaking.

- [ ] **Step 5: Run harness → PASS. Commit** `feat(calculator): equipment rate and overhead margin lines`

---

### Task D1: Rate sheet import / export (JSON, lossless)

**Files:** Modify `calculator.html`, `js/calculator-page.js`, `tools/qa-calculator-page.cjs`

- [ ] **Step 1: Markup.** Sheets bar gains two buttons (`data-action="calcSheetExport"` icon `i-download`, `data-action="calcSheetImport"` icon `i-upload`) and a hidden `<input type="file" id="calc-sheet-file" accept="application/json,.json" hidden>`, plus a status line `<div class="bcp-piece-hint" id="calc-sheet-msg" hidden></div>` under the bar.

- [ ] **Step 2: Export.** `ACTIONS.calcSheetExport`: if no sheets, show msg "No saved rate sheets to export yet." Otherwise download `mmgr-calc-rate-sheets-<YYYY-MM-DD>.json`:

```javascript
const payload = JSON.stringify({ version: 1, exported: new Date().toISOString().slice(0, 10), sheets: loadSheets() }, null, 2);
```
(Blob + anchor click — same pattern as `downloadCsv`.)

- [ ] **Step 3: Import.** Button clicks the hidden file input; `change` handler parses, validates `Array.isArray(json.sheets)`, and for each item requires `typeof name === 'string'` + numeric-ish `rates.rateMat`/`rates.rateLab`; sanitize name (trim, `slice(0,40)`), drop malformed entries, merge by case-insensitive name (imported replaces existing), newest first, cap 20 via `persistSheets`, re-render, status line reports "Imported N rate sheet(s) (M skipped)." Never `throw` — bad file → msg "That file is not a My MaNaGeR rate sheet export." (Try/catch around parse.)

- [ ] **Step 4: Gates T1–T3.** Export produces JSON containing the saved sheet name; importing a fixture with 1 new + 1 same-name sheet replaces the same-name one and adds the new; importing garbage shows the not-a-export message and leaves storage untouched.

- [ ] **Step 5: Run harness → PASS. Commit** `feat(calculator): import and export rate sheets as JSON`

---

### Task D2: Estimate comparison (Economy vs Standard vs Premium, side by side)

**Files:** Modify `js/calculator-page.js`, `calculator.html`, `css/mmgr.css`, `tools/qa-calculator-page.cjs`

- [ ] **Step 1: Extract the pure engine.** Rename the body of `compute()` into `computeFor(st)` taking a `readState()`-shaped object (work, d1..d3, units, rateMat/rateLab/rateEq, wastePct, piecePrice/pieceSize, currency, country, quality, taxOverride, ohPct). It must touch **no DOM** (currently it reads `$()` directly — mechanical rewrite: read from `st`, keep every formula and the piece/branch logic verbatim). Live path becomes `computeFor(readState())`. This is the load-bearing refactor — every later task depends on it; do not shortcut.

- [ ] **Step 2: Selection UI.** `renderEstimates()` rows gain a leading checkbox `<input type="checkbox" class="bcp-cmp-check" data-cmp-id="..." aria-label="Select for comparison">`. Card head gains a `Compare` button (`data-action="calcCompare"`, icon `i-bar-chart`) plus a new section `#calc-compare` (hidden) under the estimates card:

```html
<section class="card" id="calc-compare-card" aria-labelledby="calc-cmp-h" hidden>
  <h2 id="calc-cmp-h" class="card-title">Compare estimates</h2>
  <div id="calc-compare" class="bcp-cmp"></div>
</section>
```

- [ ] **Step 3: Render.** `ACTIONS.calcCompare`: take checked ids (2–4, cap 4 — extra checks disabled with the earlier ones winning), map to saved estimates, `computeFor(est.st)` each (skip + count any that fail), build a table:

```javascript
// rows: Work item, Quantity, Materials, Labor, Equipment, Subtotal, Tax, Estimated total
// one column per selected estimate; cheapest Estimated total cell gets class bcp-cmp-best
```
CSS (token-only): `.bcp-cmp table{width:100%;border-collapse:collapse;font-size:.82rem;} .bcp-cmp th,.bcp-cmp td{border-bottom:1px solid var(--border);padding:6px 8px;text-align:right;} .bcp-cmp th:first-child,.bcp-cmp td:first-child{text-align:left;color:var(--slate);} .bcp-cmp .bcp-cmp-best{color:var(--gold);font-weight:800;}` — plus `.bcp-cmp-wrap{overflow-x:auto;}` for phones.

- [ ] **Step 4: Gates P1–P3.** Fewer than 2 checked → button shows msg "Tick at least two saved estimates to compare." and renders nothing; two Economy/Premium saves of the same slab → table shows both totals and Economy's total cell carries `bcp-cmp-best`; comparison never mutates the live form (inputs unchanged after comparing).

- [ ] **Step 5: Run harness + `node tools/qa-calc-playwright-audit.cjs` → PASS (the audit drives real recall events — it proves `computeFor` did not break live math). Commit** `feat(calculator): compare saved estimates side by side`

---

### Task D3: Quote-ready print / PDF header

**Files:** Modify `calculator.html`, `js/calculator-page.js`, `css/mmgr.css`, `tools/qa-calculator-page.cjs`

- [ ] **Step 1: Positioning.** The browser's Print dialog is already the PDF path (every OS ships Save-as-PDF); no jsPDF dependency (offline-first, zero new deps). Rename the button label `Print` → `Print / PDF` (icon unchanged).

- [ ] **Step 2: Print-only header block.** In the estimate card, before `#calc-output`:

```html
<div class="bcp-quote-head" aria-hidden="true">
  <div class="bcp-quote-biz" id="calc-quote-biz"></div>
  <div class="bcp-quote-title">Build Estimate</div>
  <div class="bcp-quote-meta" id="calc-quote-meta"></div>
</div>
```
`render()` fills `#calc-quote-meta` with `name — work item — qtyShown main — date` and `#calc-quote-biz` with the saved business name if set. CSS: `.bcp-quote-head{display:none;}` and inside the existing `@media print` block: `body.print-estimate .bcp-quote-head{display:block;border-bottom:2px solid #111;margin-bottom:14px;padding-bottom:10px;}` with title `font-size:1.3rem;font-weight:800;` and meta/biz `color:#444;font-size:.8rem;` (print sheet is hard-coded light paper — match it).

- [ ] **Step 3: Optional business name (client-ready letterhead).** A small row under the result actions: text input `#calc-biz-name` (`maxlength=60`, placeholder `Your business name (appears on printed estimates)`, aria-label same), persisted to `localStorage['mmgr_calc_biz_name']` on input; quote head reads it. **Decision point (owner):** include this field or drop it from scope — recommend include, it is one field + one key and directly serves "client-ready". The rest of D3 is independent of it.

- [ ] **Step 4: Gates Q1–Q2.** `body.print-estimate` + quote head: meta text contains the work item and the estimate name; business name round-trips localStorage → quote head. (Gates assert DOM, not the actual print dialog.)

- [ ] **Step 5: Run harness → PASS. Commit** `feat(calculator): quote header block for printed and PDF estimates`

---

### Task E1: Project header regroup — navigation left, utility right (owner mid-review note)

**Files:** Modify `project.html` (header markup only), `css/mmgr.css`, `tools/qa-calculator-page.cjs` (no), `docs/CI-TEST-COVERAGE.md` (no)

- [ ] **Step 1: Inventory harness coupling before touching markup**

```bash
grep -rn "hdr-right\|greeting\|tab-ctrl\|nav-btn" tools/*.cjs qa-*.cjs | grep -v Binary
```
Re-baseline any structural assertion in the same task (per CI lesson 8: fix the harness WITH the app, verified in-browser, not assumed).

- [ ] **Step 2: Markup regroup.** In `#app-header`, wrap the left cluster in `<div class="hdr-left" id="hdr-left">` containing, in order: `a.hdr-back` (Back to Projects — moved from `.hdr-right`), `#nav-btn` hamburger (moved — it opens section navigation), `#greeting`, `.tab-ctrl`. `.hdr-right` keeps strictly utility: sign-in chip, backup anchor + popover, timeline indicator, presence chip, lock indicator, assistant bell, settings gear. Popover `#bk-pop` stays inside `.bk-anchor` (its positioning anchor moves with it — no CSS anchor change since the whole anchor moves as one node). **No banner rows are touched** — the four scope/safety banners stay full-width rows above the flex row (the `--hdr-h` measuring contract must not change).

- [ ] **Step 3: CSS.** `#app-header` flex layout gets an explicit two-cluster balance:

```css
/* 2026-09-29 header balance review: navigation clusters left, utility right. */
#app-header .hdr-left{display:flex;align-items:center;gap:18px;min-width:0;}
#app-header .hdr-left .tab-ctrl{margin-left:6px;}
#app-header .hdr-right{margin-left:auto;} /* strict right edge, no drifting */
@media (max-width:820px){ #app-header .hdr-left{gap:10px;} }
```
Then audit the existing responsive blocks (≤768px wrap from v327, ≤600px, ≤520px) so: pills wrap below the greeting cleanly, the greeting truncates with ellipsis rather than pushing utility icons out, and the 390px no-overflow fix (v327 `.hdr-right{flex-wrap:wrap}`) still holds with the back link + hamburger gone from that group. Adjust only within the existing media blocks.

- [ ] **Step 4: Verify in a real browser** (serve.cjs on :8765): desktop 1440px (left cluster reads back → hamburger → greeting → pills; utility pinned right), 820px, 768px, 600px, 390px (no horizontal scroll — the v327 regression), dark mode + glass-premium on (header sticky, sidebar flush — v330's contract), banners visible states still push content correctly. Screenshot to `tmp/header-regroup-light.png` / `-dark.png`.

- [ ] **Step 5: Run gates.** `node tools/qa-health-sweep.cjs` (CSSOM truth — catches any rule the regroup orphaned), plus every harness found in Step 1. Commit `refactor(project): regroup header navigation left and utilities right`

---

### Task F: Release wiring, full verification, docs

**Files:** Modify `calculator.html` (?v bumps), `sw.js`, `docs/CI-TEST-COVERAGE.md`

- [ ] **Step 1: Cache-bust.** calculator.html: `dist/mmgr.min.css?v=7` → `?v=9`, `js/calculator-page.js?v=8` → `?v=9`. (Single bump at the end of the wave; intermediate tasks are covered by the local serve.)

- [ ] **Step 2: Service worker.** `sw.js`: `CACHE = 'mmgr-shell-v336'` + prepend the v336 narrative comment (one dense paragraph, repo style): calculator enhancement waves + header regroup, files changed, "no inline scripts, CSP hashes unchanged; shell bump so clients re-fetch".

- [ ] **Step 3: Registry.** Update the `tools/qa-calculator-page.cjs` row in `docs/CI-TEST-COVERAGE.md` (new gate count, mention: grouping, unit-primary hero, waste, piece counts, equipment/overhead, sheet import/export, comparison, quote header).

- [ ] **Step 4: Full battery, in order**

```bash
node build.js
npm run verify
node tools/qa-calculator-page.cjs
node tools/qa-calc-playwright-audit.cjs
node tools/qa-calculator.cjs
node tools/qa-health-sweep.cjs
grep -c "bcp-group" dist/mmgr.min.css   # >= 1 — proves CSS actually rebuilt
```
All must exit 0. Emoji scan on changed served files (calculator.html, project.html): `grep -P "[\x{1F000}-\x{1FAFF}\x{2600}-\x{27BF}\x{2B00}-\x{2BFF}\x{FE0F}]" calculator.html project.html` → no matches.

- [ ] **Step 5: Commit sequence** (one per wave, already made per task) — final squash-check only: `git log --oneline` shows conventional subjects, zero attribution footers.

- [ ] **Step 6: Record in `PLANNING-TODO-2026-09-03.txt`** per CI lesson 8: wave name, harness gate deltas (51 → ~66), re-baselined strings.

---

## Decision points for the owner (default = recommendation, say otherwise at go-ahead)

1. **Business-name letterhead field** (D3 Step 3) — recommend: include.
2. **Quality multiplier applies to equipment hire** (B3) — recommend: yes, consistent with material/labor; simpler mental model.
3. **Comparison source = named estimates only** (D2) — recommend: yes; the auto-history is noise, named saves are the curated client-facing set.
4. **Rate-sheet transfer = JSON only** (D1) — recommend: yes (lossless, no CSV quoting edge cases); CSV stays the estimate-export path.

## Self-review notes

- Spec coverage: every bullet from both pasted reviews maps to a task (conditional fields → A1 gate, grouping → A1, unit hero → A2, waste → B1, counts → B2, equipment/overhead/itemization → B3, PDF/quote → D3, rate-sheet transfer → D1, comparison → D2; header balance → E1). The "tile hardware/consumables allowance" itemization is satisfied by B3's new lines + existing `matDesc` honesty (consumables are inside the material rate — inventing a fake split would fabricate numbers).
- Type consistency: `computeFor(st)` shape, `UNIT_CONV`, `pieceCount()` signatures are used identically in B2/B3/D2/D3 as defined here.
- No placeholders: all code blocks are the real shape; mechanical steps name exact ids/selectors.
