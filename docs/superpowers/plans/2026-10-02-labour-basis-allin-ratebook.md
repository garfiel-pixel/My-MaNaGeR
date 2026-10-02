# Plan — All-in (JIC) rate + per-day labour basis

> **For agentic workers:** REQUIRED SUB-SKILL: use `executing-plans` to work this
> plan task by task. Load `no-slacking` + `verification-before-completion` first;
> load `universal-ui-architect` + `ui-modernization` before touching UI, and
> `plain-language-copy` before writing any visible string.

**Goal:** let a tradesman price work the way the trade actually prices it —
either an **all-in rate** (the JIC combined figure, no faked material/labour
split) or a **per-day crew rate** they type themselves — while the JIC book
stays the default and any typed rate wins. Every document (screen, CSV, print,
quote) shows **one labour total per line**, never a row per person.

**Architecture:** two new optional, per-line pricing inputs on the existing form.
Both are pure additions to `computeFor` (the single pure engine every surface
already calls), so screen, CSV, print, quote, comparison table, history recall
and bill lines all inherit them from one place. The JIC rates stop being
hardcoded per-trade variant numbers and become a real **rate book** through the
existing import mechanism, so there is one code path for "a source of rates".

**Tech stack:** vanilla ES5-style JS in `js/calculator-page.js` (no framework, no
new dependency), existing `data-action` delegation, existing CSS token blocks in
`css/mmgr.css`, existing rate-books/FX/snapshot machinery. **No inline scripts**
(CSP hashes stay untouched), **no emoji**, offline-first unchanged.

---

## Decisions LOCKED by the owner (2026-10-02 discussion)

These were agreed in conversation. Do not re-litigate; do not invert them.

| # | Decision | Rationale |
|---|---|---|
| D1 | **Per-day only.** Per-hour and any productivity/norm table are **out of scope**. | The tradesman knows how many days the job takes. Typing the days removes the norm entirely — and with it the risk that our band is wrong for their ground. |
| D2 | **No per-person role itemisation.** One crew rate per day. | A document must show a total labour rate, never individual pay. Also a privacy win: a client invoice should not itemise a crew. Deferred, not deleted. |
| D3 | **All-in rate, never a faked split.** The book supplies one combined figure; the split is not invented. | The industry already prices this way, and material is not free — it is inside the rate. |
| D4 | **Book is the default; typed always wins.** No lock. | Already the engine contract (`matOverridden`/`labOverridden`, gated by `RF1`). Reuse it; add no new switch. |
| D5 | **Rate fields are always COST; Overhead & margin % always converts cost → price** — one consistent rule, including for book-filled lines. | A published market rate read as a *selling* price would silently double-count margin. Uniform rule under-quotes (recoverable) rather than over-quotes (never learned). |
| D6 | **Per-day offered per trade**, not globally — rendering/painting stay measurement-only. | A day's output swings with weather/coats/substrate; it is a poor selling rate and a fine costing rate. |
| D7 | Both notifiers ship: *"not recommended for this work"* and *"verify against JIC"*. | Owner's explicit ask. |

---

## Global constraints (every task inherits)

- **No inline scripts.** All new UI via existing `data-action` delegation in
  `js/calculator-page.js` + markup in `calculator.html`. `INLINE_SCRIPT_HASHES`
  in `worker.js` **and** `serve.cjs` must remain byte-identical to disk
  (`npm run verify:csp`). No `.html` `<script>` body may be added.
- **`[hidden]` guard gate.** Any element this plan hides by default needs a
  `[hidden]{display:none}` rule whenever an author display rule exists, or
  `verify:hidden` fails.
- **Bundle staleness (AGENTS.md lesson 2).** `js/calculator-page.js` is loaded
  **standalone** by `calculator.html` — it is in no bundle. Rebuild
  (`node build.js`) for `dist/mmgr.min.css`, and re-verify the CSS gate; the JS
  itself is served directly.
- **New syntax gate.** `tools/verify-js-syntax.cjs` (added this session) must
  stay green — it is what catches an unquoted hyphenated object key in this
  exact file. **Always quote hyphenated keys.**
- **No emoji** on any served page or rendered string (AGENTS.md rule 7).
- **Plain language.** No jargon in any visible string: say "days", "rate per
  day", "all-in rate" — not "labour basis", "norm", "basis mode".
- **Service worker:** bump `const CACHE` in `sw.js` (v352 → v353) with a
  narrative comment, or `verify:sw` fails.
- **Registry rule (lesson 14).** Any new/edited harness touches three places:
  the harness, its `docs/CI-TEST-COVERAGE.md` row, and `ci.yml` /
  `extended-qa.yml`.
- **Golden cases** (`tools/calc-golden-cases.json`) must pass and must **grow**
  for each new pricing path.
- **Deploy only on the owner's go.** This plan ships code + CI green, not a
  production release.
- **Commits:** Conventional Commits, ≤72-char subject, **no AI attribution
  footer** (AGENTS.md rule 8).

---

## The engine seam (verified against current source)

Everything lands in `computeFor` (pure; every surface already calls it):

```js
const rf    = rateFactor(runit, qr.unit);            // existing RATE_UNITS adapter
const mat   = qty * effMat * quality;                // existing
const lab   = qty * lr  * rf * quality;              // existing
const eq    = qty * eqRate * rf * quality;           // existing
const onCost= lab * onCostPct / 100;                 // statutory on payroll
const sub   = mat + lab + onCost + eq;
const oh    = sub * ohPct / 100;                     // D5: margin on COST
const tax   = (sub + oh) * taxRate / 100;
const total = sub + oh + tax;
```

Two additions, both additive and both default-inert:

- **All-in** — when an all-in rate is present, the line's combined work cost is
  `qty * allIn * rf * quality` and `lab` is `0` **for presentation only**; `sub`
  stays correct. Expose `allIn: true`, `allInRate`, `allInCost`, `bookFilled`.
  Mirrors the existing `piece` mechanic (a single user figure that *is* the
  price), so it is a familiar shape for this codebase.
- **Per-day** — when a day rate is present, `lab = days * dayRate` instead of
  `qty * lr * rf`. `onCost` still applies (it is payroll). `mat` is untouched,
  so a line can carry **bought material + crew days** — owner's point 3.

> **Open item for the owner (do not guess):** does the Finish-level multiplier
> apply to a typed day rate? Recommendation: **no** — `quality` scales a unit
> rate, but a crew's day rate is a price, not a unit rate. Ask before Task 4.

---

## File structure

| File | Change |
|---|---|
| `js/calculator-page.js` | All-in + per-day maths in `computeFor`; snapshot fields; new controls; the two notifiers; document rendering; the JIC book object |
| `calculator.html` | Two new field blocks (all-in rate; days + rate per day) + the mode selector, all `hidden` by default; no new inline script |
| `css/mmgr.css` | Token-driven styles for the new fields, the *not recommended* note and the *published market rate* note; `[hidden]` guards |
| `tools/calc-golden-cases.json` | New cases: all-in line, per-day line, material+days, all-in recall round-trip |
| `tools/qa-calculator-page.cjs` | New `AB` (all-in) + `DB` (day basis) gate families; extend FM/lookup gates |
| `docs/CI-TEST-COVERAGE.md` | Registry rows updated in the same wave |

No migration, no new dependency, no new Wrangler binding, no schema change to
the cloud sync (the new fields ride inside existing estimate snapshots).

---

### Task 0 — Baseline + inventory

- [ ] `node build.js && npm run verify` → **ALL CHECKS PASSED** (includes the new `verify:js`). If red, fix baseline before starting.
- [ ] `node tools/qa-calculator-page.cjs` → 195/195, `node tools/qa-calc-golden.cjs` → 61/61, `node tools/qa-calc-trade-coverage.cjs` → 88/88.
- [ ] Inventory every assertion that touches the rate fields or the document rows:
  ```bash
  grep -n "rate-mat\|rate-lab\|calc-oh\|Materials\|'Labor'\|matOverridden\|effMat" tools/qa-calculator-page.cjs tools/qa-calc-golden.cjs | head -40
  ```
  Record every hit. Any gate asserting an exact CSV row count or an exact
  "Materials"/"Labor" pair is re-baselined **in the task that changes it**.

### Task 1 — Pure maths only (no UI yet)

- [ ] Add to `computeFor`, reading only from the state object:
  `allInRate`, `daysStr`, `dayRateStr`. Default-inert: absent/blank → identical output to today.
- [ ] Implement the all-in branch and the per-day branch per the seam above.
- [ ] Extend the returned object: `allIn`, `allInRate`, `allInCost`, `bookFilled`, `dayBasis`, `days`, `dayRate`.
- [ ] **Guard:** `allIn` must not combine with `piece` pricing or `labourOnly` — if both are present, all-in wins and the others report as inactive (never silently double-apply). Cover with a golden case.
- [ ] **Guard:** `days` accepts 0.25 steps and rejects 0/negative/absurd (>2000) by falling back to the normal per-unit labour path — never `NaN` into a total.
- [ ] Add `__calcEngine` exports if the harness needs them (it already exports `computeFor`, `readState`, `billLint`).
- [ ] Run `node tools/verify-js-syntax.cjs` (104/104 expected) — **quote every new hyphenated key.**

### Task 2 — Snapshot fidelity (exact recall)

- [ ] Add `allIn`, `days`, `dayRate` to `readState()` and `applyState()` — **together in the same task**, or a recalled estimate silently drifts.
- [ ] Prove it: a golden case that saves an all-in line and an all-in+days line, recalls them, and asserts byte-identical totals.
- [ ] Confirm the cloud workspace needs **no new section** (the fields ride inside existing snapshots). If any `wsCollect`/`wsApplyProbe` mapping enumerates fields explicitly, add them there and re-baseline the `WS1` section-count gate.

### Task 3 — Document rendering (screen, CSV, print, quote, comparison)

This is the task the owner specifically called out; the invoice must show a
**total labour rate, never per-person rows** (D2 — satisfied by construction
here, since no role list exists).

- [ ] **Breakdown (screen):** when `r.allIn`, render **one** combined line
  (`'Work rate (all-in)'`) instead of the Materials + Labour pair. When
  `r.dayBasis`, render `Labor` as the single total plus a quiet
  `days x rate per day` sub-note. Reuse the existing annotation pattern at
  ~line 2509 (`' - your rate'`) so the vocabulary matches.
- [ ] **CSV (~line 2050–2070):** `allIn` → replace the `Materials` + `Labor`
  rows with one `Work rate (all-in)` row; `dayBasis` → add `Days` and
  `Labor rate per day` rows above the single `Labor` total. Row count changes,
  so re-baseline any gate counting CSV rows.
- [ ] **Comparison table (~line 2005):** same rule — one `Work (all-in)` row,
  never a fabricated Materials/Labor split.
- [ ] **Print / quote sheet:** confirm `@media print` uses the same breakdown
  function; a line that reads correctly on screen must not split on paper.
- [ ] Gate: assert a printed/CSV all-in line contains the combined figure and
  **does not** contain a fabricated material or labour sub-total.

### Task 4 — Controls + the two notifiers

- [ ] `calculator.html`: add (all `hidden` by default, revealed by JS)
  - `#calc-allin-wrap` with `#calc-allin` + label
  - `#calc-day-wrap` with `#calc-days` and `#calc-day-rate`
  - a per-trade basis chooser, defaulting to measurement
- [ ] Basis is **per trade**, gated by a `dayWork` opt-out on the `WORK` entries
  where a day is a poor unit — **owner must sign off the list** (rendering and
  painting are the named examples). Trades that are not opted out offer per-day.
- [ ] Notifier 1 — *"not recommended for this work"* on trades in the opt-out
  list **and** on the margin field when such a trade is priced per-day.
- [ ] Notifier 2 — *"these rates change — confirm against JIC before you
  price"*, shown wherever the book filled a line, with a **"verified on"**
  stamp the user can set (per-line, stored with the estimate).
- [ ] `css/mmgr.css`: token-driven styles; both notifiers use existing
  `--status-warning` / `--status-success` so light + dark both hold; add the
  `[hidden]{display:none}` guards and re-run `verify:hidden`.
- [ ] Load `ui-modernization` before this task; check WCAG 2.2 contrast on both
  note styles in light **and** dark.

### Task 5 — The JIC book becomes a real rate book

- [ ] **The validator currently HARD-REQUIRES both halves.** In `importBooks`
  (~line 1094) the per-rate guard is
  `if (!isFinite(m) || m < 0 || !isFinite(l) || l < 0) { skipped++; return; }`
  — an `allIn`-only entry has no `mat`/`lab`, so it would be **silently skipped**
  and the book would import as empty. Change the guard to accept a rate that
  carries **either** a valid split **or** a valid `allIn`, and still reject a
  rate carrying neither (and any negative value). Keep the reject-and-count
  discipline; never throw.
- [ ] **`bookChecksum` must cover `allIn`.** The checksum is computed over the
  *cleaned* rate object (`item.checksum !== bookChecksum(clean)`), so a book
  whose only new field is `allIn` would fail its own checksum unless the
  checksum function includes it. Update `bookChecksum` and re-verify the export
  → import round-trip.
- [ ] Extend the rate-book schema with an optional `allIn` per rate entry
  (`{mat?, lab?, allIn?, unit?}`). Unknown/invalid entries are rejected and
  counted exactly like unknown work keys today.
- [ ] Build the shipped JIC book from `JIC_RATES` (JMD, effective 2025-2027,
  100 entries). This data is **verified 100/100 against the owner's extract**
  (`JIC_Rate_Book_2025-2027.md`) — do not re-key it by hand; generate it.
- [ ] **Currency honesty (the easy mistake here).** The book is JMD; the engine
  base is USD. Convert through the user's date-stamped FX table (`fxBetween`).
  With **no JMD rate set, leave the field EMPTY and show the existing honest
  note** — never relabel JMD as the user's currency. This is the E1 rule; reuse
  the path rather than inventing one.
- [ ] Book fills the all-in field as the **default**; typing wins (D4). Keep the
  `RF1` typed-rate-wins contract and extend it to the all-in field.
- [ ] Set `bookFilled` when the number came from the book — this drives the
  *published market rate* note (D5/D7). The note is informational; the maths
  stays the uniform cost→price rule.
- [ ] **Ship-side test that would have caught the silent skip:** import the JIC
  book and assert `merged` counts 100 rates with `skipped === 0`. If the
  validator rejects them, this gate fails immediately.

### Task 6 — Gates + release wiring

- [ ] New `AB` gates (all-in): prefill from book; typed wins; clearing falls
  back to the split; no fabricated Materials/Labour on any document; recall
  round-trip; interaction with `piece` and `labourOnly`.
- [ ] New `DB` gates (day basis): days × rate lands in `lab`; `onCost` still
  applies; material + days coexist; quarter-days; blank/invalid days fall back
  safely; per-trade availability; the *not recommended* note.
- [ ] Golden cases: ≥4 new (all-in metric; all-in imperial; per-day; material +
  days). Re-baseline any existing case the document change touches.
- [ ] `sw.js` bump → **v353** with narrative.
- [ ] Full battery, in order:
  ```bash
  node build.js && npm run verify \
    && node tools/qa-calculator-page.cjs \
    && node tools/qa-calc-golden.cjs \
    && node tools/qa-calc-trade-coverage.cjs \
    && node tools/qa-calc-playwright-audit.cjs \
    && node tools/qa-health-sweep.cjs
  ```
  All exit 0. Emoji scan over both changed sources.
- [ ] Browser truth: both themes, 390px, one all-in line and one per-day line
  priced and read back off the printed sheet.
- [ ] Update `docs/CI-TEST-COVERAGE.md` in the same commit.
- [ ] Conventional Commit, **no AI footer**. Push, poll CI, fix any red step
  before stopping. **Do not deploy without the owner's go.**

---

## Decision points (default = recommendation)

1. **Quality multiplier on a typed day rate** — **do not apply** (a crew's day
   rate is a price, not a unit rate). *Needs the owner's confirmation.*
2. **Per-trade day-mode opt-out list** — default: opted **out** for rendering,
   painting, tiling and any other finish whose daily output swings with
   conditions. *Needs the owner's sign-off on the exact list.*
3. **Days granularity** — 0.25 steps (half-days and quarter-days are normal on
   site), reject 0/negative/>2000.
4. **All-in beats `piece`/`labourOnly`** when combined, rather than erroring —
   a form should never trap the user in an error state.
5. **`verifiedOn` stamp** — per line (rides the estimate) rather than global.

## Self-review

- **Spec coverage:** D1–D7 each map to a task (D1→Task 1/4, D2→Task 3, D3→Task 1/3,
  D4→Task 5, D5→Task 1 + Task 5 note, D6→Task 4 list, D7→Task 4 notifiers).
  The owner's invoice requirement (one labour total, never per-person) is Task 3.
  The owner's material point (bought material is inside the rate and shows on the
  invoice) is Task 1's material+days path and Task 5's all-in line.
- **Bloat check:** the whole wave is two optional inputs on an existing form and
  one rate-book schema field. No new dependency, no migration, no new workspace
  section, no new sync path. The per-hour/norm design was explicitly cut.
- **Failure modes pre-listed:** no FX rate (empty + honest note), blank days
  (fallback), all-in + piece (all-in wins, reported), invalid all-in (ignored),
  a per-day line on an opted-out trade (note, not a block).
- **The quietest failure in this wave:** the book validator at `importBooks`
  (~line 1094) requires both `mat` and `lab`, so an `allIn`-only JIC book imports
  as **empty with no error** — a whole rate book that simply does not arrive.
  Task 5 names the exact guard, the `bookChecksum` dependency, and requires a
  merge-count assertion so it cannot regress silently.
- **Known risk:** changing CSV row structure can break any gate that counts
  rows; Task 0 inventories those *before* Task 3 changes them.
- **Verified against source before writing:** `computeFor` is the single pure
  engine (7 call sites, exported on `__calcEngine`); the typed-rate-wins flags
  `matOverridden`/`labOverridden` and the `RF1` gate already exist; the `piece`
  single-figure mechanic the all-in field mirrors is in place; `fxBetween` and
  the book validator are where the plan says they are; `sw.js` is at v352.