# BUDGET MAP - 2026-11

H-0 reconnaissance for `BUDGET-BOQ-MCP-DIRECTIVE-2026-11-05.md`. Read-only survey of the
live tree at `164b858`, written before any Wave H code. Every assumption in the directive
gets a verdict here, and every later task says whether it is built "as written" or
"adapted as follows".

The directive's assumptions came from an older copy of the app. Three of them are now
wrong in ways that change the design, and one of them (`A2`) was half-fixed by H-1 before
this map was written - both halves are recorded.

---

## 1. Assumption verdicts

### A1 - Budget lines, envelope, spend log - **TRUE (with extra fields)**

`state.budgetLines[]` holds `id`, `category`, `planned`, `committed`, `actual`, `taskId`,
`curve`, `isContingency`, `waiverStatus`, `waiverReceivedAt`, `notes`.
`state.budgetEnvelope` is a number. `state.spendLog[]` holds `id`, `date`, `budgetLineId`,
`amount`, `notes`.

- Renderer: `js/render/financials.js:163` (`renderBudget`) and `:42` (`renderSpendLog`).
- Defaults: `js/mmgr-state.js:191` (`defaultState`), migration V0->V1 at `:471`.
- There is **no** `source`, `boqRef`, `description`, `qty`, `unit`, `rate`, `rateUnit`,
  `kind` or `phase` on a line today - H-2 adds them.

### A2 - The typed actual box vs the derived actual - **TRUE, and now CHANGED**

`Spend.budgetLineActual` (`js/mmgr-resources.js:290`) derives a line from its own spend
entries once any exist, and falls back to the typed `actual` box otherwise. At the start
of Wave H the Budget cards and bar summed the typed box while the dashboard
(`js/mmgr-render.js:288`), earned value (`js/mmgr-evm.js:27`), pay applications
(`js/mmgr-resources.js:371`) and the financials panel (`js/render/financials.js:182`)
used the derived value - so two screens could disagree about the same project.

H-1 routed the cards, the bar and the remaining figure through `budgetLineActual`. The
**per-line variance and per-line percentage columns still read `l.actual`** and still
print a hard-coded `$` (`js/render/financials.js:299-300`); H-1b closes that.

### A3 - Remaining = envelope - spent, so an empty envelope alarms - **CHANGED**

H-1 replaced it: `baseline = envelope > 0 ? envelope : sum(planned)`, and the overrun
notice only fires when a real envelope is set and the plan exceeds it
(`js/render/financials.js:208-260`). This is P2 in the directive and is already law.

### A4 - A spend entry has only date, line, amount, notes - **TRUE**

`js/render/financials.js:42` renders exactly those four fields plus a delete button.
`js/mmgr-resources.js:312` writes the same four. H-3 extends the record; it does not
replace it.

### A5 - The calculator's bill is local, and the only handoff is a price-free RFQ - **TRUE**

- The bill lives in `localStorage['mmgr_calc_boq']` as `[{st, name, pricedAt, rateSig,
  rateSigKeep}]` - a full form snapshot per line plus a label
  (`js/calculator-page.js:8944` `BKEY2`, `loadBoq`, `persistBoq`).
- Pricing is one pure function, `computeFor(st)` at `js/calculator-page.js:4249`, which
  returns `qty`, `unit`, `mat`, `lab`, `sub`, `oh`, `tax`, `total`, `currency` and the
  basis flags.
- The bill total is `boqTotals(lines).sub` = sum of `mat + lab` (`:9217`).
- The roll-up (`rollup`, `:8764`) adds prelims, discount, design and construction
  contingency and escalation to that works figure and calls the result the **planning
  subtotal (before tax)**.
- The only handoff is `calcBoqRfq` (`:12330`), which writes
  `localStorage['mmgr_rfq_draft'] = {lines:[{name,qty,unit,currency}]}` - quantities, no
  prices - and `js/mmgr-procurement.js:2344` reads it. There is no project handoff at all
  today.

### A6 - Cash flow is a two-week S-curve, nothing weekly - **TRUE**

`renderCashFlowChart` (`js/render/financials.js:78`) buckets the schedule at
`totalDays / 14`, clamped to 6-24 buckets. There is no weekly view anywhere.

### A7 - MCP: `get_budget`, `apply_changes`, section scopes, Premium - **TRUE**

`src/mcp/server.js` defines both tools; `apply_changes` writes a `cloud_reviews` row and
never live state (`:925`). Section scopes live in `src/lib/http.js:1239`
(`CLOUD_SECTIONS`), with the budget section at `:1246` covering `budgetLines`,
`budgetEnvelope`, `spendLog`, `nspid`. Premium gating is `MCP_PREMIUM_REFUSAL` on the
project owner's plan. There is **no** per-key read/write split inside the budget section -
H-5 adds it.

### A8 - Review panel with diffs, accept/reject, changelog revert - **TRUE**

`js/cloud/review.js` lists proposals, toggles a field-diff panel
(`renderDiffPanel`, `:30`), and posts accept (`:231`) / reject (`:290`). The changelog
revert is `js/mmgr-app.js:5170` (`cloudLogRevert`) against
`src/cloud/changelog.js` (`entry_type === 'revert'`, snapshot-key restore). The
presentation is a text diff, not a rendered screen - H-6 replaces the presentation and
keeps the plumbing.

### A9 - The exported project report excludes money - **TRUE**

`js/mmgr-report.js` header: counts only, budget totals only behind the explicit
"Include project context" opt-in (default OFF), verified by
`tools/verify-report-issue.cjs`.

### A10 - Budget screens hard-code "$" - **CHANGED (partly)**

H-1 moved the Budget cards, the bar and the dashboard card onto `U.fmtMoney` with the
project currency. Still hard-coded: the per-line variance column and percentage
(`js/render/financials.js:299-300`), the risk-contingency strip (`:325-336`), the pay
application summary (`:363`), and the cash-flow chart axis (`fmt$` is currency-aware, so
this one is fine). H-1b and H-4 close the rest.

---

## 2. Where project state lives, and how it moves

| Layer | Where | Written by |
|---|---|---|
| Working copy | `localStorage['mmgr_projects']` + one key per project (`js/mmgr-state.js`) | every `State.updateState` |
| Autosave | 400 ms debounce, `saveState()` | `js/mmgr-state.js:1005+` |
| Cloud snapshot | D1 `cloud_projects.state_json` (encrypted envelope) + R2 object | `src/cloud/sync.js`, `POST /api/cloud/save` |
| Sync out | opt-in per project, `js/mmgr-cloud.js` | manual "Save to cloud" / autosave when linked |
| Sync in | pull on open when linked, merge by section | `js/mmgr-sync.js`, `src/lib/http.js` `cloudScopeMerge` |
| Review queue | D1 `cloud_reviews` (`proposal_type`, `diffs`, `status`) | `POST /api/cloud/review`, MCP `apply_changes` |
| Changelog | D1 `cloud_changelog` + R2 snapshot for revert | `src/cloud/changelog.js` |

**State schema migrations** are client-side and versioned: `SCHEMA_VERSION` in
`js/mmgr-state.js:185` (currently **24**), with one function per produced version in the
`migrations` map at `:467`. `migrate()` (`:984`) applies every version above the stored
one and stamps the new number. A new field needs a migration entry **and** a bump - an
old saved project otherwise loads without it and every reader has to guard.

**D1 migrations** are separate and server-side: `migrations/NNNN_name.sql`, applied with
`wrangler d1 migrations apply my-manager-db --remote`. `wrangler deploy` does **not**
apply them; `tools/check-d1-migrations.cjs` is now step 2b of `tools/deploy.cjs` so a
schema behind the code refuses the deploy (added 2026-11-06 after production sat four
migrations behind).

**Calculator bill**: device-local, `mmgr_calc_boq`, described in A5. It is also mirrored
into the cloud calculator workspace (`src/cloud/calc-workspace.js`) for signed-in users.

**Field guide**: `mymanager-field-guide.html`, one lettered sheet per panel/workflow
(A-00 to A-32 today). New feature sheets are added in place, numbered, and the count in
the closing paragraph is updated with them.

**CI coverage**: every harness must be registered in `docs/CI-TEST-COVERAGE.md` with a
status token (`CI` / `EXTENDED` / `TRIAGE` / `MANUAL`), and wired into `ci.yml` or
`.github/workflows/extended-qa.yml`. `tools/verify-test-registry.cjs` fails the build if
a harness is unregistered, and `tools/verify-ci-coverage.cjs` proves the workflow's `run:`
multiset after an edit.

---

## 3. How each later task is built

| Task | Verdict |
|---|---|
| H-1 | **as written** - shipped 2026-11-06 (`8ce7179`), with the per-line columns still open (H-1b). |
| H-2 | **adapted as follows**: the bill is a snapshot list, not a priced document, so the bridge re-prices every line through `computeFor` at send time and sends *derived* quantities, never stored display strings. Budget lines carry `planned` as the authoritative figure and `rate` as `planned / qty` (a display rate, rounded to 6 dp), because a rounded rate times a quantity would drift off the cent. Work lines take `mat + lab` (`sub`), with overhead and tax as their own lines so a work line's rate stays the rate the book quotes. Total therefore equals the roll-up total to the cent: `sum(sub) + sum(oh) + sum(tax) + prelims - discount + contingencies + escalation`. |
| H-3 | **adapted as follows**: the directive's "quantity received" needs a line that carries `qty`/`unit`/`rate` - only BOQ-sourced lines do. Manual lines accept a delivery with the quantity fields hidden and the amount alone, which keeps every existing project usable. Attachments reuse the existing project photo store (`src/cloud/photos.js`, `js/cloud/photos-ui.js`) rather than inventing a second blob path. |
| H-4 | **as written**, reusing `renderCashFlowChart`'s bucketing and the EVM module's maths. The weekly export is a separate owner/editor-only file, because A9's report exclusion is a hard rule. |
| H-5 | **adapted as follows**: the key record already carries a `sections` array; the two budget switches are stored as `budgetRead` / `budgetWrite` booleans on the same record, defaulting false, so no new table and no new endpoint shape. Server-side validation lives in one module shared by the MCP tool and the review endpoint. |
| H-6 | **adapted as follows**: the preview renders the real Budget panel against a deep-cloned state. The renderer is already a pure function of state (`renderBudget` reads `S()`), so the preview swaps `State`'s active state for the clone inside a scoped helper, renders into a detached node, and restores - no second renderer, no drift. |
| H-7 | **as written**, on top of `src/cloud/team.js` roles. Enforcement is server-side in the review and delivery endpoints; the UI only hides. |
| H-8 | **as written**. |
