# Build Cost Calculator Polish Wave — Design Spec

Date: 2026-09-30 · Owner: Garfield Fairclough · Status: APPROVED (design review 2026-09-30, owner answered all 6 decision questions + approved all 7 sections)

## 1. Problem (owner directives, 2026-09-30 session)

1. **Top bar**: the calculator's header row (text "Back" button, brand link, text "Theme" button) is not in the app's design language. Owner wants one rounded rectangle across the top that mirrors the app page's top bar: icon-only highlighted Back button at far left, "My MaNaGeR" + "Build Cost Calculator" title, and a sun/moon icon-only theme button on the right (no "Theme" text).
2. **Bug — icons vanish after Back**: app.html → calculator.html → click Back → several app page SVG icons are not rendered. Root cause PROVEN by Playwright probe (this session): the return to app.html restores from Chrome's back/forward cache (`pageshow.persisted === true`), and on bfcache restores the external sprite `<use href="css/mmgr-icons.svg#i-...">` references lose their rendered shadow content. Zero-size/blank hosts observed: 20 of 58 on restore-path inspection; paint-level `getBBox` confirms blank-but-sized hosts are the failure class (fresh loads paint all 38 visible icons fine).
3. **"How to use" guide**: a step guide at the top of the calculator page, following the calculator's own field order (work item FIRST — never overhead before work item).
4. **Measurement bases are misrepresented**: no plumbing, no per-linear-meter (running meter) work, no electrical. Owner: "you don't run pipe by square meters." Research-verified conventions must drive the item list.
5. **Export naming**: when exporting as an invoice (or quote), the user must be able to name the document.
6. **First-visit tutorial**: one-time-per-device spotlight walkthrough that teaches the calculator's fields in order, ending with "you're ready to use the calculator." Reappears only if browser data is cleared.
7. **Mobile**: "the little tiny box at the top just looks ugly on mobile... ensure you optimize the view for mobile, especially for the calculator... quick and easy on a phone."

Owner decisions (ask_user, 2026-09-30): full app-style bar (not sticky) · step slider guide · title + type picker for exports · overhead stays 0 default, tutorial/guide explains the ~10% convention · add research-backed items (table approved in this spec) · mobile pass is first-class.

## 2. Scope

**In:** `calculator.html`, `js/calculator-page.js`, `js/mmgr-icon-restore.js` (new), `css/mmgr.css` (bcp- block + icon-restore needs nothing), `build.js` (module lists), `app.html`/`app-bundle` wiring via build only, `tools/qa-calculator-page.cjs`, `tools/qa-calc-playwright-audit.cjs`, `docs/CI-TEST-COVERAGE.md` (row updates), `sw.js` shell bump, `PLANNING-TODO-2026-09-03.txt` record.

**Out:** the floating in-app calculator (`mmgr-calculator.js`), project.html, pricing beyond planning-grade updates, admin.html (icon-restore wiring optional follow-up), any backend/Worker change. Offline-first untouched: no new network calls anywhere.

## 3. Section designs

### 3.1 App-style top bar (replaces `.bcp-top` current content)

```
[ (←) ]  [logo] My MaNaGeR  ·  Build Cost Calculator          [ (moon|sun) ]
```

- One `<header class="bcp-top">` rounded bar: `background:var(--tile-bg)`, `border:1px solid var(--border)`, `border-radius:var(--radius-lg,16px)`, padding 10px 14px, flex, space-between. Sits at the top of `.bcp-main`; scrolls away normally (owner chose non-sticky).
- **Back button**: `.bcp-back` becomes icon-only 40×40 gold-highlighted pill: `background:color-mix(in oklch,var(--gold) 16%,transparent)`, `color:var(--gold)`, `border:1px solid color-mix(in oklch,var(--gold) 35%,transparent)`; `i-arrow-left` sprite; `aria-label="Back"`. Same `calcBack` handler unchanged.
- **Brand + title**: `i-mpw` logo + "My MaNaGeR" (bold, `.95rem`) + separator "·" + "Build Cost Calculator" (slate). This block becomes the page `<h1>` (the current `.bcp-head` big-title block is REMOVED; the lede paragraph moves directly under the bar). Page keeps exactly one `<h1>`.
- **Theme button**: icon-only 40×40, right side. Shows `i-sun` in dark mode, `i-moon` in light mode (icon names the mode you switch to) — pure CSS: both `<use>` icons in the button, `body.dark-mode .ico-sun{display:block}` pattern toggles. Same `tglTheme` handler. `aria-label` swaps via CSS-independent dual spans (or static "Toggle dark mode"; final wording in plan, no JS).
- Mobile ≤600px: bar stays full-width with 12px padding; title truncates (`text-overflow:ellipsis`); brand text may drop to "My MaNaGeR" only if needed; all hit targets ≥44×44px. No horizontal scroll at 375px.

### 3.2 Bug fix: bfcache icon restore (`js/mmgr-icon-restore.js`, new ~40-line module)

- IIFE on `window.MMGRIconRestore` (namespace pattern, no ES modules). On `window.addEventListener('pageshow', ...)` where `event.persisted === true`: for every `svg use` in the document, force re-resolution of the external sprite reference — capture `href` (and legacy `xlink:href`), clear, force reflow (`void el.getBoundingClientRect()`), restore. Idempotent, zero-refs → no-op.
- Also exposes `MMGRIconRestore.restore()` for tests to call directly (harness gate dispatches a synthetic `pageshow` with `persisted:true`).
- Wired into `build.js`: appended to BOTH `APP_MODULES` (project bundle) and `APP_LAUNCHER_MODULES` (app bundle) at the END (no load-order dependency; it only touches the DOM). `calculator.html` gets a plain `<script src="js/mmgr-icon-restore.js?v=10">` tag (standalone page, no bundle, no CSP hash impact — external script only).
- **No inline scripts anywhere** → CSP `INLINE_SCRIPT_HASHES` untouched; `serve.cjs` mirror untouched.
- Gates: `qa-calc-playwright-audit.cjs` adds the persisted-pageshow gate (icons blank-simulated → restored); `qa-calculator-page.cjs` static gate: module exists, registered in `docs/CI-TEST-COVERAGE.md`.

### 3.3 "How to use" guide — step slider

- New card `#calc-guide-card` directly under the top bar (before `.bcp-grid`): compact, collapsible, open by default on first visit; "How to use" chip in its head collapses/reopens it (state remembered per device alongside the tutorial flag, separate key `mmgr_calc_guide_open`).
- Slider: one step visible, numbered "3 of 8", Prev/Next buttons (icon+text), dot indicators, keyboard arrows work when focused, `aria-live="polite"` on the step text. Swipe left/right on touch.
- Steps (FINAL COPY — plain language, field order matches the form top-to-bottom):
  1. **Pick your work item.** Choose what you're pricing — the calculator changes its fields and labels to match.
  2. **Choose metric or imperial.** Everything converts as you type.
  3. **Enter the dimensions.** Length, width, depth — whichever the work item asks for.
  4. **Pick your currency and country.** The country sets the standard tax rate; you can override it.
  5. **Choose the finish level.** Economy trims about 15%, premium adds about 35%. Add a custom tax % if yours differs.
  6. **Overhead and margin.** Many builders add about 10% on top for overhead and profit — type your own or leave it at zero.
  7. **Your rates.** Material, labor and equipment rates come prefilled as planning-grade averages. Change them to yours, and save them as a rate sheet to reuse.
  8. **Calculate and export.** Hit Calculate, then save it with a name, print or PDF it, or export CSV. Name the document so it prints right.
- Step text that names a field highlights nothing (no scroll-hijack); plain text only. No emoji; sprite icons only (i-arrow-left/i-arrow-right/i-x).

### 3.4 Work items — research-backed list (ALL rates planning-grade USD, editable per device)

Conventions verified from web research (RICS NRM2 ordering: cubic → square → linear; Angi 2026 PEX $1.50–4/LF installed; terrapincg 2026 commercial plumbing $14–42/LF; universe/rtdelectric 2026 residential wiring $4–9/sq ft with per-point $75–150; buildvisionai waste factors: concrete 3–5%, tile 10% (25% herringbone), drywall 5%; constructly/roofing-calculator: shingles per roofing square 100 sq ft, waste 10–15%; build-folio/next "10-and-10" O&P convention). Every new item: `matDesc` cites the basis in one short line. Dropdown labels state the measurement basis explicitly, e.g. "Water supply pipe run (per m — linear)".

**Existing 15 items: UNCHANGED math; only dropdown labels gain the basis suffix.** (siteprep m2, excav m3, slab m2 slab→m3 concrete, footings per m run, blockwall/brickwall/framing/rebar m2-m3-t, roof m2, render/paint/drywall m2-L, tile m2, concrete-drive m3, fencing per m run.)

**New items (9):**

| Value | Group | Label (dropdown) | Inputs | Qty math | Unit | Waste def | Rates mat/lab | Notes |
|---|---|---|---|---|---|---|---|---|
| `pipe-supply` | Plumbing | Water supply pipe run (per m — linear) | Total run (m) | run | m | none | 3 / 8 | PEX/type supply incl. fittings allowance |
| `pipe-drain` | Plumbing | Drain-waste-vent pipe run (per m — linear) | Total run (m) | run | m | none | 3 / 9 | PVC DWV, slope fittings allowance |
| `fixture` | Plumbing | Fixture install (each) | Count | count | each | none | 130 / 150 | Toilet/sink/shower set + connect |
| `bath-rough` | Plumbing | Bathroom rough-in package (each) | Count of bathrooms | count | each | none | 500 / 750 | Supply+DWV to one full bathroom |
| `wire-point` | Electrical | Wiring point (per point) | Count of points | count | point | none | 25 / 60 | Socket/switch/light point incl. device |
| `conduit` | Electrical | Conduit / cable run (per m — linear) | Total run (m) | run | m | none | 2 / 6 | Conduit + single-phase cable |
| `panel` | Electrical | Consumer panel / breaker box (each) | Count | count | each | none | 450 / 650 | Board, breakers, labeling |
| `skirt` | Finishes | Skirting / baseboard (per m — linear) | Total run (m) | run | m | 5% cuts | 3 / 5 | Trim + fixings, miters |
| `shingle-roof` | Envelope | Asphalt shingle roof (per roofing square) | Length (m), Slope width (m) | m2 ÷ 9.2903 | square | 10% laps/cuts | 250 / 300 | 1 square = 100 sq ft; pitch guidance in hint |

Implementation notes: new optgroups Plumbing + Electrical in the select; `WORK` map entries follow the existing shape (`d1/d2/d3` labels, `q` fn, `rate`, `matDesc`, optional `waste`, optional `piece` — none of the new items need piece pricing except none; `qtyShown` gains `square: { imp:['sq ft'... no — squares are already imperial-native: `square` unit shows as-is in both modes with an m2 aside). History/estimates/rate sheets carry the new values with zero schema change (they already store full settings + work id).

### 3.5 Export naming — document type + title

- In `#calc-out-actions` (visible only when a result exists): **Document type** select (`#calc-doc-type`: Estimate / Quote / Invoice; default Estimate) + **Document title** text input (`#calc-doc-title`, maxlength 80, placeholder "e.g. Kitchen renovation - Smith").
- Print sheet (`@media print`, `.bcp-quote-head`): title line becomes the selected TYPE ("Invoice"), your title beneath it, date + business name as today. Screen layout unchanged.
- Filenames (print PDF suggestion + CSV download): `[Type] - [Title or estimate name] - [YYYY-MM-DD]` (sanitized: strip `/\:*?"<>|`). CSV header row gains `document_type` + `document_title` columns.
- Settings state (`readState`/`applyState`) stores both fields → exact recall reproduces them. Existing "Name this estimate" save flow untouched.

### 3.6 First-visit tutorial — spotlight walkthrough (one-time per device)

- Trigger: first load of calculator.html with `localStorage.mmgr_calc_tour_done` absent. A "Take the 60-second tour" toast/mini-card appears bottom-center; starting it begins the tour. Dismiss = flag set (never auto-start without a click — no consent traps).
- Flow: page dims + blurs (`backdrop-filter` on an overlay, `pointer-events:none` on content except the spotlight target); a popover anchors to each target IN THE GUIDE'S ORDER: work item select → unit toggle → dimensions row → currency/country row → finish/tax row → overhead field (copy: "many builders add about 10% — yours is optional") → rates row → Calculate button → final center card "You're ready to use the calculator." (9 popovers total).
- Each popover: plain-language line (mirrors guide copy, shortened), Prev/Next, "Skip tour", dot progress. Esc = skip. Keyboard operable: popover focus-trapped while open; focus returns to target on close. Scroll target into view per step.
- Reduced motion: no blur animation, overlay appears instantly (repo `prefers-reduced-motion` pattern).
- Flag set on completion OR skip. Clearing browser data removes the flag → tutorial offers again (owner-specified behavior). Reduced-motion + both themes verified.
- Mobile: popover positions clamp to viewport; on ≤600px the popover docks bottom-sheet style above the target when space is tight.

### 3.7 Mobile optimization pass

- Top bar per 3.1 mobile rules; single-column field stack already exists — verify paddings.
- **Sticky Calculate**: at ≤600px, `.bcp-run` becomes `position:sticky; bottom:12px;` with a solid card background + shadow so it never scrolls out of thumb reach mid-form. `@media print` unaffected (already hidden).
- Inputs: 16px font-size on ≤600px (kills iOS focus zoom-jump); number inputs keep `inputmode=decimal`.
- Guide slider: swipe gestures; dots sized ≥6px; buttons ≥44px.
- Tutorial: per 3.6 mobile docking.
- Playwright audit: 375 / 768 / 1280 viewports × light/dark on: bar layout, no horizontal scroll, sticky button visible after 600px scroll, guide swipe, tutorial step reachability.

## 4. Data & persistence

No schema migrations. New localStorage keys: `mmgr_calc_tour_done` ("1"), `mmgr_calc_guide_open` ("0"/"1"). Existing keys (`mmgr_calc_history`, `mmgr_calc_estimates`, `mmgr_calc_sheets`, units, theme) unchanged. All new state fields ride `readState()`/`applyState()` (exact recall) — settings object grows two optional fields; legacy rows ignore them.

## 5. Error handling

- Guide/tutorial: any missing element id → step skipped silently (fail-soft, never blocks the calculator).
- Icon restore: try/catch per `<use>`; a failed re-resolution logs to console only.
- Export naming: empty title → falls back to estimate name → falls back to work item label. Filename sanitization strips illegal characters.
- Tutorial: `localStorage` in private mode throws → try/catch, tour may re-offer per load (acceptable).

## 6. Testing & verification (per wave + final)

- After any `js/` edit: `node build.js`. After CSS: bundle + `?v=` bumps in calculator.html (`?v=9` → `?v=10` for css+js, + new module tag at `?v=10`).
- `npm run verify` (CSP + SW + registry + css-integrity + hidden gates) before every push.
- `node tools/qa-calculator-page.cjs` — extended gates: guide card + 8 steps, doc type/title fields, new WORK items present with basis labels, tutorial flag wiring, icon-restore module presence.
- `node tools/qa-calc-playwright-audit.cjs` — extended: synthetic persisted-pageshow → icons restored; bar layout both themes; guide slider next/prev; tutorial start + skip sets flag; mobile viewports per 3.7.
- `node tools/qa-health-sweep.cjs` (serve.cjs on :8765) after CSS waves.
- Emoji scan on every touched served file (hard gate). `sw.js` shell bump (bundle-bearing pages changed) with version-narrative comment.
- Conventional Commits per wave (`feat(calculator): ...`, `fix(app): restore sprite icons after bfcache restore`, ...), no AI attribution footers.

## 7. Wave order (each wave = build + verify + harness + commit)

1. **fix(app): icon restore module** (bug fix first — smallest, independent, shippable alone)
2. **feat(calculator): app-style top bar** (+ h1 consolidation, lede move)
3. **feat(calculator): how-to guide slider**
4. **feat(calculator): new work items + basis labels** (table in 3.4)
5. **feat(calculator): document type + title on exports**
6. **feat(calculator): first-visit tutorial**
7. **feat(calculator): mobile pass** (sticky Calculate, 16px inputs, clamp checks) — final full battery + shell bump + tracker record

## 8. Self-review

- No placeholders; every rate cited from 2026 research snippets; owner's 6 answers mapped (bar=3.1, slider=3.3, naming=3.5, overhead-explain-only=3.3 step 6 + guide copy, items=3.4, mobile=3.7).
- Internal consistency: h1 consolidation in 3.1 vs lede retention stated; tutorial order == guide order (owner requirement) — both use work-item-first.
- Scope: 7 waves is large but each is independently shippable; the implementation plan will carry per-task steps.
- Ambiguity check: theme icon direction (sun-in-dark) is explicitly chosen; non-sticky bar explicitly chosen; tutorial is click-to-start (not auto) — deliberate, stated.
