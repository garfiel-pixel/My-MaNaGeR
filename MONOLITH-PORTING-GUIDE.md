# My MaNaGeR — Monolith → Modular Porting Guide

**Purpose:** `myMaNaGeR_-_V3_3__7_.html` (the old single-file "V3.3" build) contains
working logic for several features that did not survive the rewrite into the
current modular codebase (`project.html` + `js/mmgr-*.js`). This guide is the
checklist for bringing them back, one at a time, without breaking anything
that currently works.

**Do not delete or archive the monolith file.** Keep
`myMaNaGeR_-_V3_3__7_.html` in your project folder permanently — it is the
source of truth for every feature listed below. Every line number in this
guide refers to that file as it exists today.

---

## 0. How to use this document

Work through the sections in the **Priority Order** below, top to bottom.
For each feature:

1. Open `myMaNaGeR_-_V3_3__7_.html` and jump to the line numbers given.
2. Read the whole function (not just the first few lines) — copy it out to a
   scratch file first so you have the real logic in front of you while you
   adapt it.
3. Follow the "Port it" steps for that feature.
4. Run through that feature's **Test checklist** before moving to the next
   one.
5. Run `node test-headless.js` after every feature — it must still print
   `ALL_HEADLESS_TESTS_PASSED` before you move on. If you add new testable
   logic (pure functions, schedule math, etc.), add a `check(...)` line for
   it in `test-headless.js` in the same pass, not later.
6. Commit / back up your `js/` and `project.html` changes after each feature
   lands cleanly. Small, verified steps — don't batch multiple features into
   one untested change.

**Never work from memory of what the monolith "probably" does.** Always
re-read the actual function body at the line number given — the summaries
below tell you *what to look for*, not the literal code to paste.

---

## 1. The porting pattern (read this once, applies to every feature)

The monolith is one giant `<script>` block: global functions, a global `S`
state object, direct `saveS()` calls, and `onclick="..."` attributes in the
HTML. The modular codebase is different in three specific ways — every port
in this guide has to translate across all three:

| Monolith pattern | Modular equivalent |
|---|---|
| Global function `function addRisk(){ S.risks.push(...); saveS(); renderRisks(); }` | Lives inside a module's IIFE, exported via `ns.Risks = { addRisk, ... }`, calls `ns.State.updateState(s => { s.risks.push(...) })` instead of touching `S` directly |
| `onclick="addRisk()"` in HTML | `data-action="addRisk"` attribute, with `'addRisk': () => window.MMGR.Risks.addRisk()` added to the `ACTION_MAP` in `js/mmgr-app.js` |
| `S` (bare global mutable object) | `ns.State.getState()` to read, `ns.State.updateState(fn)` to write — **never mutate the object returned by `getState()` directly outside of an `updateState` callback**, or your change won't persist/won't trigger a save |
| `renderX()` called manually after each mutation | Same idea, but call the specific `R.renderX()` (or the relevant module's render function) right after `updateState()` — look at how `mmgr-tasks.js` does this for a template |
| Inline `<div id="...">...</div>` markup baked into the monolith's one HTML blob | New markup goes into the matching `<div class="panel" id="panel-...">` section of `project.html` — find the existing panel or add a new `sec-nav` button + panel pair following the DMAIC one as a template (`data-section="dmaic"`) |

**Every new function that touches state must go through `updateState`.**
**Every new interactive element must use `data-action`, never `onclick`.**
**Every new `data-action` you add MUST be added to `ACTION_MAP` in
`js/mmgr-app.js`, or it will silently do nothing when clicked** — this is
exactly the kind of bug `test-headless.js`'s "Scenario 3: data-action
coverage audit" is designed to catch, so let that test do its job.

---

## Priority Order

1. Health Score (core, on your "always maintain" list)
2. Spend Log + Cash-Flow S-Curve (budget data model already half-exists — least wasted effort)
3. KPI Live-Linking
4. EVM (Earned Value Management)
5. RACI cell coloring + export block
6. Resource Leveling view
7. Monte Carlo schedule simulation
8. DMAIC full interactivity
9. WBS bulk collapse/expand
10. Today View
11. Milestone Timeline
12. Charter document upload (file-based, not just paste)

---

## 1. Health Score

**What it does:** Computes a single weighted 0–100 project health score from
schedule status, budget variance, risk exposure, and blocked/overdue tasks,
and renders it as a bar + breakdown, not just raw counts.

**Monolith source:**
- `computeHealthScore()` — line 4115
- `getHealthScore()` — line 4150
- `renderHealthScore()` — line 4151

**Target files:**
- New pure function `computeHealthScore(state)` → `js/mmgr-schedule.js` (or a
  new `js/mmgr-health.js` module if you want to keep it cleanly separated —
  recommended, since it doesn't belong to scheduling logic specifically)
- Render call → `js/mmgr-render.js`, wired into `renderDash()`
- Markup → `project.html`, inside the existing "PROJECT HEALTH" card on the
  Dashboard panel (`#panel-dashboard`) — you're **adding to** an existing
  card, not creating a new panel

**Port it:**
1. Copy `computeHealthScore` out of the monolith. It's a pure calculation —
   confirm it only *reads* from `S` and returns a number/object; it should
   not need any changes beyond swapping `S` for the `state` object passed
   in as a parameter.
2. Add it to a module as an exported pure function, e.g.
   `ns.Health = { compute: computeHealthScore }`.
3. In `renderDash()` (in `mmgr-render.js`), call `ns.Health.compute(s)` and
   feed the result into new markup elements: `#health-bar`,
   `#health-breakdown`, `#health-score-suffix` (these are the exact IDs the
   monolith's `renderHealthScore` already targets at line 4151 — reuse
   those names so you can port the styling too).
4. Add the health-bar markup to `project.html`'s dashboard health card. Copy
   the surrounding HTML structure from the monolith (search for
   `id="health-bar"` in the monolith file to find it) and adapt classes to
   match the current card style used by "Project Completion" next to it.

**Test checklist:**
- [ ] Health score renders on the dashboard with 0 tasks (shouldn't divide
      by zero or show `NaN`)
- [ ] Score changes when you mark a task overdue / add a risk / blow the
      budget envelope
- [ ] `node test-headless.js` still passes; add a `check(...)` asserting
      `MMGR.Health.compute(state)` returns a number between 0–100 for a
      known fixture state

---

## 2. Spend Log + Cash-Flow S-Curve

**What it does:** Dated, per-line spend entries (not just one "actual"
number per budget line) plus a cumulative planned-vs-actual cash flow chart,
with support for linear/front-loaded/back-loaded spend curves per budget
line.

**Why this is second priority:** `mmgr-state.js` already has `spendLog: []`
in the default state schema and already migrates it in from V0→V1 — the
data model is half-built and currently dead weight. This is the
least-wasted-effort win on the list.

**Monolith source:**
- `curveFraction()` — line 3923
- `budgetLineWindow()` — line 3935
- `lineCumulativeAt()` — line 3949
- `budgetCumulativePlannedAt()` — line 3961
- `actualCumulativeAt()` — line 3969
- `budgetLineActual()` — line 3984
- `addSpendEntry()` / `rmSpendEntry()` / `updSpendEntry()` — lines 3989–3995
- `renderCashFlowChart()` — line 4002
- `renderSpendLog()` — line 2694 (also touches `#stk-body` — check that's
  not a stray leftover reference to stakeholders before you port it
  verbatim; verify against the surrounding code)

**Target files:**
- Logic → `js/mmgr-resources.js` (this is where `Budget` module already
  lives — add `Spend` alongside it, or a new `js/mmgr-spend.js` if it gets
  large)
- Render → `js/mmgr-render.js`, new `renderSpendLog()` / `renderCashFlow()`
  hooked into the existing Budget panel's render dispatch
- Markup → `project.html`, inside `#panel-budget`, below the existing
  budget-lines table

**Port it:**
1. Start with the data functions (`curveFraction` through
   `budgetLineActual`) — these are pure math over `budgetLines` +
   `spendLog`, so they port almost unchanged; just replace `S.budgetLines`
   / `S.spendLog` with parameters.
2. Add `addSpendEntry` / `delSpendEntry` / `updSpendEntry` to the `Budget`
   (or new `Spend`) module in `mmgr-resources.js`, following the exact
   pattern `addBudgetLine`/`delBudgetLine`/`updBudgetLine` already use in
   that file — same shape, just operating on `s.spendLog` instead of
   `s.budgetLines`.
3. Wire three new `data-action`s (`addSpendEntry`, `delSpendEntry`,
   `updSpendEntry`) into `ACTION_MAP` in `mmgr-app.js`.
4. Port `renderCashFlowChart` — check what it actually draws with (canvas?
   SVG bars? Check the monolith's `#cashflow-chart` element to see). Keep
   it simple on the port — a basic SVG/HTML bar rendering is fine even if
   the monolith used something fancier; you can always improve visuals
   later once the data plumbing works.
5. Add the spend-log table + cash-flow chart container to `project.html`'s
   Budget panel, below the existing budget lines table.

**Test checklist:**
- [ ] Add a spend entry, confirm it persists after a page reload
      (`localStorage` roundtrip)
- [ ] Cumulative planned vs actual lines diverge visibly on the chart when
      you add spend entries
- [ ] Switching a budget line's curve (linear/front/back-loaded) visibly
      changes the planned curve shape
- [ ] `node test-headless.js` still passes

---

## 3. KPI Live-Linking

**What it does:** A KPI can bind to a live project metric (e.g. "budget
variance", "% complete") instead of being purely manual text, and its status
badge auto-computes from the current project data.

**Monolith source:**
- `kpiMetricLabel()` — line 2158
- `kpiLiveValue()` — line 2159
- `kpiStatus()` — line 2178
- `updKPILink()` — line 2192
- `updKPIDir()` — line 2193
- `kpiExportLine()` — line 2197
- Also check the `KPI_METRICS` constant near line 2135 in the monolith (the
  list of linkable metrics) — you'll need to port this list too.

**Target files:**
- Logic → `js/mmgr-charter.js` (KPI functions already live here —
  `addKPI`/`updKPI`/`delKPI` — you're extending this, not creating new
  scope)
- Render → same file's `renderKpiList()`

**Port it:**
1. Note that the current schema already has a `suggestedLinks` field on
   each KPI (cosmetic display only, in `renderKpiList` around line 49–51 of
   `mmgr-charter.js`) — this is NOT the same thing as live-linking. Don't
   confuse the two; you're adding real computed values, not just a text
   hint.
2. Port the `KPI_METRICS` list from the monolith — it defines which project
   metrics (e.g. `% complete`, `budget variance`, `overdue count`) a KPI can
   bind to.
3. Add a `linkedMetric` and `dir` (direction: "higher is better" vs "lower
   is better") field to each KPI object — extend the object shape used in
   `addKPI()` in `mmgr-charter.js`.
4. Port `kpiLiveValue(metric, state)` as a pure function that pulls the
   current value for a given metric key from state.
5. Port `kpiStatus()` — compares live value against the KPI's `target`,
   respecting `dir`, and returns a status (on-track / at-risk / off-track).
6. Add a `<select>` for "Link to live metric" and one for direction to the
   KPI row markup in `renderKpiList()`, next to the existing category
   dropdown. Wire `updKPILink` / `updKPIDir` as new `data-action`s.

**Test checklist:**
- [ ] Link a KPI to "% complete", set a target, confirm the status badge
      updates automatically when you complete tasks (no manual edit needed)
- [ ] Un-linking a KPI (setting it back to manual) doesn't wipe its
      existing target/name
- [ ] `node test-headless.js` still passes

---

## 4. EVM (Earned Value Management)

**What it does:** Standard EVM metrics — Planned Value, Earned Value, Actual
Cost, SPI (schedule performance index), CPI (cost performance index).

**Monolith source:**
- `computeEVM()` — line 4059
- `renderEVM()` — line 4085

**Target files:**
- Logic → new pure function in `js/mmgr-schedule.js` or a dedicated
  `js/mmgr-evm.js`
- Render → `js/mmgr-render.js`, new panel or a card inside `#panel-budget`
- Markup → `project.html`

**Port it:**
1. This one depends on task `%complete` data and budget planned/actual
   values already present in the current schema, so the underlying data
   this needs already exists — you're purely porting math + display.
2. Copy `computeEVM` — it should be a pure function of `(tasks, budgetLines,
   budgetEnvelope)` → `{ pv, ev, ac, spi, cpi }`. Confirm the monolith
   version doesn't hardcode anything from `S` that doesn't map directly to
   current state field names (compare against `mmgr-state.js`'s schema).
3. Decide where this lives in the UI — the monolith might put it in Budget
   or Dashboard; either works, but pick ONE panel and be consistent, since
   nothing currently reserves space for it.
4. Add SPI/CPI as small stat cards, following the existing `.card m0a`
   pattern already used throughout `project.html` (see the Budget summary
   cards for the exact markup pattern to copy).

**Test checklist:**
- [ ] SPI = 1.0 and CPI = 1.0 when a project is exactly on schedule and on
      budget (verify with a hand-built fixture)
- [ ] Values update live as tasks complete / budget lines change
- [ ] `node test-headless.js` still passes; add a `check(...)` for a known
      EVM fixture (e.g. 50% complete, on-budget → SPI/CPI both ≈1.0)

---

## 5. RACI Cell Coloring + Export Block

**What it does:** Heat-colored R/A/C/I matrix cells (so overload/gaps are
visible at a glance) and a `raciExportBlock()` that generates a
copy-paste-ready text summary of the whole matrix (feeds into your "Copy
All" feature).

**Monolith source:**
- `raciCellBg()` — line 3746
- `raciCellFg()` — line 3747
- `cycleRaciCell()` — line 3748 (compare against the current
  `cycleRaci()` in `mmgr-raci.js` — likely just needs the color logic
  added, not a full rewrite)
- `raciExportBlock()` — line 3578

**Target files:**
- Logic + render → `js/mmgr-raci.js`
- Export → hook into whatever your existing "Copy All" (`cpAllPage`)
  mechanism uses in `mmgr-app.js`, so RACI's copy output matches the same
  pattern as other tabs

**Port it:**
1. `raciCellBg`/`raciCellFg` are almost certainly pure functions of the
   R/A/C/I letter → a color. Port them directly into `mmgr-raci.js` and
   call them from wherever the matrix cells are rendered (check
   `mmgr-render.js` for the RACI table render, since `mmgr-raci.js` only
   has the click/cycle logic currently — the render itself lives
   elsewhere).
2. Apply the returned colors as inline `style` or CSS classes on each cell
   in the matrix render.
3. Port `raciExportBlock()` and wire it into `cpAllPage('raci')` in
   `mmgr-app.js` so "Copy All" on the RACI tab produces this formatted
   block instead of (or in addition to) whatever it currently does — check
   what `cpAllPage` currently does for the RACI section first before you
   change it.

**Test checklist:**
- [ ] Cells visibly color-code by role (R vs A vs C vs I look different)
- [ ] "Copy All" on the RACI tab produces a readable pasted block in Word
- [ ] `node test-headless.js` still passes

---

## 6. Resource Leveling View

**What it does:** A visualization that shows resource over-allocation
across time (not just the pairwise conflict list the current
`findResourceConflicts()` gives you).

**Monolith source:**
- `renderResourceLeveling()` — line 2595
- `resUtil()` — line 2566 (utilization calculation — check if this
  overlaps with anything already in `mmgr-resources.js`'s `updResource`,
  which already tracks a `utilization` field — you may just need the
  *view*, not new math)

**Target files:**
- Logic (if new math needed) → `js/mmgr-resources.js` or
  `js/mmgr-schedule.js` (it needs task dates + assignee, so it's
  schedule-adjacent)
- Render → `js/mmgr-render.js`
- Markup → `project.html`, likely a new sub-section inside `#panel-resources`

**Port it:**
1. Check first whether `resUtil()` duplicates the `utilization` field
   already computed in `mmgr-resources.js`'s `updResource`. If so, you only
   need to port the *rendering* (a timeline/bar view per resource), not the
   math.
2. Port `renderResourceLeveling` targeting a new `#res-leveling` container
   — that's the exact ID the monolith already uses, so reuse it and you can
   port CSS almost unchanged too.
3. Add the container markup to the Resources panel in `project.html`.

**Test checklist:**
- [ ] Two tasks with the same assignee and overlapping dates visibly show
      as over-allocated in the leveling view
- [ ] `node test-headless.js` still passes

---

## 7. Monte Carlo Schedule Simulation

**What it does:** Runs N simulated schedules using triangular distributions
per task duration (optimistic/likely/pessimistic) to produce a probability
distribution of project completion dates.

**Monolith source:**
- `triSample()` — line 3795 (triangular distribution sampler)
- `simulateSchedule()` — line 3800 (one simulation run)
- `runMonteCarlo()` — line 3836 (runs N simulations, aggregates)

**Target files:**
- Logic → `js/mmgr-schedule.js` (it needs to reuse `forwardPass`/`cascade`
  logic already there — this is the most tightly-coupled-to-existing-code
  feature on the list, so read `mmgr-schedule.js` in full before starting)
- Render → `js/mmgr-render.js`
- Markup → `project.html`, new modal or panel (monolith uses `#mc-result`,
  `#mc-headline`, `#mc-percentiles`, `#mc-dist-bar`, `#mc-detail`,
  `#mc-risk-factor`, `#mc-target`, `#mc-error` — reuse these IDs)

**Port it — this is the most involved feature on the list, budget the most time for it:**
1. This needs each task to have optimistic/likely/pessimistic duration
   estimates. Check whether the current task schema has anything like
   this (`confidence: 'high'` exists per task in `mmgr-tasks.js`'s
   `addTask()` — that's a coarse proxy, not three-point estimates). You'll
   likely need to add `optimisticDuration`/`pessimisticDuration` fields to
   the task schema (bump `SCHEMA_VERSION` in `mmgr-state.js` and add a
   migration — follow the existing migration pattern exactly, e.g. V3→V4
   like the `weatherRegion` migration did for V2→V3).
2. Port `triSample` unchanged — it's pure math.
3. Port `simulateSchedule` — this likely calls a schedule-forward-pass
   internally. Check whether it can call the CURRENT `MMGR.Schedule`
   module's `forwardPass` (already proven pure and tested per
   `test-headless.js`) instead of reimplementing its own — that's the
   cleaner port if the function signatures are compatible.
4. Port `runMonteCarlo` to call `simulateSchedule` N times (the monolith's
   N is probably 500 or 1000 — check) and bucket results into percentiles.
5. Build the result UI — percentile bars, a headline ("80% confidence of
   finishing by X"), using the exact element IDs listed above.

**Test checklist:**
- [ ] Running the simulation on a simple 3-task chain produces a sane
      spread of completion dates (not all identical, not wildly random)
- [ ] `node test-headless.js` still passes; add a `check(...)` that
      `triSample` returns a value between its min/max bounds across many
      calls (a statistical sanity check, not exact-value)

---

## 8. DMAIC Full Interactivity

**What it does:** Currently DMAIC is a "simplified overview" per the code
comment in `mmgr-render.js` line ~978. The monolith supports toggling DMAIC
on, expanding/collapsing individual phases, and editing phase content.

**Monolith source:**
- `tglDMAIC()` — line 3860
- `updDMAIC()` — line 3862
- `tglDMAICPhase()` — line 3863
- `renderDMAIC()` — line 3871

**Target files:**
- Logic → `js/mmgr-render.js` (current `renderDmaic` lives here — extend
  it, don't replace it wholesale) or a new `js/mmgr-dmaic.js` if it grows
  enough to deserve its own module
- Markup → `project.html`, `#panel-dmaic`

**Port it:**
1. Read the CURRENT `renderDmaic` in `mmgr-render.js` around line 976–990
   first — understand exactly what "simplified" means today before
   changing it, so you extend rather than duplicate.
2. Port `updDMAIC` (edit phase text/status) and `tglDMAICPhase` (per-phase
   expand/collapse) following the same `updateState` + `data-action`
   pattern as every other module.
3. Add editable fields to each phase's render — likely a textarea per
   phase (Define/Measure/Analyze/Improve/Control) instead of read-only
   text.

**Test checklist:**
- [ ] Switching methodology to Hybrid shows the DMAIC tab (already works
      per current code — confirm you haven't broken this)
- [ ] Editing a phase's content persists after reload
- [ ] `node test-headless.js` still passes

---

## 9. WBS Bulk Collapse/Expand All

**What it does:** One click to collapse or expand every phase in the WBS,
instead of toggling phases one at a time.

**Monolith source:**
- `collapseAll()` — line 1709
- `expandAll()` — line 1710

**Target files:**
- Logic → `js/mmgr-tasks.js` (alongside the existing `tglPhase`)
- Markup → `project.html`, WBS toolbar (near the existing WBS import
  buttons)

**Port it (this is the simplest feature on the list, good warm-up):**
1. Current `tglPhase(id)` in `mmgr-tasks.js` toggles `s.defExpanded[id]`
   for one phase. `collapseAll`/`expandAll` just need to iterate all
   phase-task ids and set every entry in `s.defExpanded` to `false` /
   `true` (or delete the map and let the default "expanded" behavior take
   over for expand-all — check how `tglPhase`'s comment describes the
   default state: "undefined/true = expanded").
2. Add two small buttons to the WBS toolbar with `data-action="collapseAll"`
   / `data-action="expandAll"`, wire both into `ACTION_MAP`.

**Test checklist:**
- [ ] Collapse All hides every phase's children in one click
- [ ] Expand All reverses it
- [ ] `node test-headless.js` still passes

---

## 10. Today View

**What it does:** A dedicated "what's happening today" panel — tasks active
today, due today, or overdue, at a glance, without scrolling the full WBS.

**Monolith source:**
- `renderTodayView()` — line 3783

**Target files:**
- Logic/render → `js/mmgr-render.js`
- Markup → `project.html`, could live on the Dashboard panel as a new card,
  or as its own `sec-nav` tab — monolith uses `#today-body` and
  `#today-date-lbl`, reuse those IDs

**Port it:**
1. This is mostly a filtered re-render of existing task data (similar
   filtering logic to what `mmgr-field.js`'s `generateFieldReportPrompt`
   already does for "today's tasks" — look at that function first, since
   you may be able to reuse its filter logic instead of writing new logic).
2. Port `renderTodayView`, targeting the reused element IDs.
3. Decide placement: Dashboard card (lower friction, always visible) vs.
   dedicated tab (more room). Recommend Dashboard card given your existing
   layout has room in the "NEXT 3 PRIORITY ACTIONS" area.

**Test checklist:**
- [ ] A task with today's date in its start–end range shows up
- [ ] An overdue task is visually distinct from an on-track one
- [ ] `node test-headless.js` still passes

---

## 11. Milestone Timeline

**What it does:** A horizontal timeline visualization of milestone tasks
(distinct from the full Gantt chart — a zoomed-out, milestone-only view).

**Monolith source:**
- `timelineLine()` — line 3570
- `renderMilestoneTimeline()` — line 3877
- `computeTimelineStatus()` — line 4202 (also referenced as
  `renderTimelineStatus` conceptually — check for a matching status-badge
  function nearby)

**Target files:**
- Logic/render → `js/mmgr-render.js`
- Markup → `project.html`, `#milestone-timeline` (reuse the monolith's ID)

**Port it:**
1. Check how the monolith identifies which tasks are "milestones" — likely
   a `duration === 0` or explicit `isMilestone` flag. Confirm which, since
   the current task schema (`mmgr-tasks.js` `addTask()`) has no
   `isMilestone` field — you'll need to add one (another schema
   migration, same pattern as before).
2. Port `computeTimelineStatus` (on-track/at-risk/late per milestone).
3. Port `renderMilestoneTimeline` and `timelineLine`, targeting
   `#milestone-timeline`.
4. Note: you already have `jumpToDashTimeline` wired in the current
   `ACTION_MAP` — check what it currently jumps *to*, since it may already
   assume a timeline element exists at a specific location; don't create a
   second, disconnected timeline.

**Test checklist:**
- [ ] Marking a task as a milestone makes it appear on the timeline
- [ ] Status coloring matches whether the milestone is on-track/late
- [ ] `node test-headless.js` still passes

---

## 12. Charter Document Upload (file-based)

**What it does:** Upload an actual file (Word doc / PDF / text file) for
the charter and auto-extract fields via regex + JSON parsing, instead of
only pasting text into a textarea.

**Monolith source:**
- `uploadCharterDoc()` — line 4272
- `generateCharterFillPrompt()` — line 4335 (compare against current
  `regenChartPrompt()` in `mmgr-charter.js` — likely very similar, may just
  need the file-reading step bolted on)
- `_tryParseCharterJSON()` — line 4372
- `_regexExtractCharter()` — line 4380

**Target files:**
- Logic → `js/mmgr-charter.js` (extends the existing `openChartUp` /
  `applyChartAIOutput` flow — this is additive, not a replacement)
- Markup → `project.html`, inside the charter-upload modal (`#chartup-modal`)

**Port it:**
1. This is lower priority because the current paste-based flow already
   works end-to-end (`openChartUp` → `regenChartPrompt` → user pastes into
   AI → `applyChartAIOutput` parses JSON). You're adding a convenience
   on-ramp, not fixing something broken.
2. Add `<input type="file" id="charter-upload">` to the charter upload
   modal, matching the pattern already used for `#load-file` in
   `project.html` (`accept=".txt,.md"` at minimum; note that reading
   `.docx`/`.pdf` client-side needs a library — check whether the monolith
   actually parsed binary formats or just plain text before promising more
   than you can deliver here).
3. On file select, read the text (`FileReader.readAsText`), drop it into
   the same `#cu-source` textarea the paste flow already uses, and let the
   existing `regenChartPrompt`/`applyChartAIOutput` pipeline handle the
   rest unchanged.

**Test checklist:**
- [ ] Uploading a `.txt` charter file populates the source textarea
- [ ] The rest of the existing AI-fill flow still works unchanged
- [ ] `node test-headless.js` still passes

---

## Final integration pass (do this once, after all 12 are ported)

- [ ] Full `node test-headless.js` run — zero failures
- [ ] Manually click through every new tab/button/modal in a real browser,
      not just the automated test — the headless suite covers logic and
      wiring, not visual layout
- [ ] Bump `SCHEMA_VERSION` in `mmgr-state.js` one final time if you added
      any new fields across these features that didn't already get their
      own migration step, and make sure every new field has a
      `if (!state.x) state.x = ...` migration entry — don't let old saved
      projects break when they load this version
- [ ] Re-run the icon-ID / data-action / getElementById cross-reference
      audit described in the earlier conversation (grep every `#i-xxx`
      icon reference against `mmgr-icons.svg`, every `data-action` against
      `ACTION_MAP`, every `getElementById`/`$()` call against actual page
      IDs) — the same class of bug that broke the "Enter code" popup can
      happen again with new features if a new ID is referenced in JS but
      never added to the HTML, or vice versa
- [ ] Re-zip and re-upload to InfinityFree; hard-refresh (Ctrl+Shift+R) or
      test in incognito to rule out stale browser cache before concluding
      anything is "still broken"
