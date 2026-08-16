# MARKET-FEATURE-ROADMAP.md — Buildable Now vs. Needs Owner/3rd-Party Setup
**Purpose:** Every feature from market research, sorted into two hard categories.
**Section A features have ZERO external dependency** — no API key, no third-party
account, no hardware. These can be built and shipped immediately.
**Section B features REQUIRE the owner to set up a third-party account, API key, or
hardware first** — these are explicitly NOT to be started until the owner says so.
Do not begin any Section B item without an explicit go-ahead naming that specific item.

---

# STATUS LEGEND (audit run 2026-08-15, checked against live code)

| Marker | Meaning |
|---|---|
| ✅ DONE | Verified present in the codebase (file/line cited) |
| ⚠️ PARTIAL | Exists in some form; a documented gap remains |
| ⬜ OPEN | Not implemented — candidate for the next zero-dependency build pass |
| 🚫 BLOCKED | Requires a 3rd-party account, API key, hardware, or owner/legal review |
| 🗑 REMOVED | De-scoped as bloat by the owner (2026-08-16) — not to be built without the owner explicitly re-opening it |

**Audit trail:** every claim below was checked directly against the current tree
(`js/*.js`, `project.html`, `css/mmgr.css`), not assumed from the roadmap text.
Section C was previously unverified — it is now cross-checked per the file's own
"Required next step".

---

# PHASE NOTE — STABILIZATION MODE (owner directive, 2026-08-16)

**Feature builds are FROZEN.** The owner's directive: stop adding breadth,
stabilize the app completely, and the owner will use it naturally as a budget
manager — annoyances they report become the roadmap. Items marked 🗑 below are
DE-SCOPED (bloat): not coming back unless the owner re-opens them. Remaining ⬜
OPEN items are FROZEN — not to be started without the owner naming one. De-scoped
elsewhere (they live in MASTER-ACTION-PLAN-v3-STRICT.md / the continuation
directive, not this file): the webhooks + external API tier, real-time presence
(Durable Objects), and the billing/subscription tier. The ONLY active work items
this phase: the delete-link coherence fix (local delete must visibly remove the
linked cloud project everywhere, incl. the admin Cloud Projects list) and the
reviews star-input UI — both recorded in CONTINUATION-DIRECTIVE.md STATUS LOG.

---

# SECTION A — Build now, zero third-party dependency

These are all just new fields, new state, and new UI on top of modules that already
exist (Stakeholders, Risk, Budget, Charter, Claim Pack). No new subsystem, no API key.

## A1. Subcontractor prequalification tracking (COI/insurance expiry) — ⬜ OPEN → ✅ SHIPPED 2026-08-15
**Status:** now implemented — `coiExpiry` / `licenseExpiry` fields on every Stakeholder
record (`js/mmgr-stakeholders.js`), a Compliance column set in the Stakeholder table
(`js/mmgr-render.js renderStakeholders`), an expiring-compliance count on the
Stakeholders nav badge + the Dashboard Project Health card, and the pure
`getExpiringCompliance()` helper. See the priority note below (A1 + A5 shipped as one pass).
**Market gap:** "Insurance certificates expire without notice... nobody updated the
record" — named as the single most common manual pain point in subcontractor
management research.

**What it is:** add expiry-tracked fields to each Stakeholder record, with a
computed "at risk" flag the existing Health/Dashboard logic can surface.

```js
// Extend the existing stakeholder record shape (mmgr-stakeholders.js)
{
  id: 'stk_001',
  name: 'ABC Electrical Ltd',
  role: 'Subcontractor',
  // NEW fields — all optional, backward-compatible with existing records
  coiExpiry: '2026-11-30',      // Certificate of Insurance expiry date
  licenseExpiry: '2027-03-15',  // Trade license expiry date
  emr: 0.92,                    // Experience Modification Rate (see A5)
  emrVerifiedAt: '2026-08-01'
}

// New pure function — no dependencies, same pattern as existing schedule audit()
function getExpiringCompliance(stakeholders, withinDays = 30) {
  const now = new Date();
  const soon = new Date(now.getTime() + withinDays * 86400000);
  return stakeholders.filter(function(s) {
    var coi = s.coiExpiry ? new Date(s.coiExpiry) : null;
    var lic = s.licenseExpiry ? new Date(s.licenseExpiry) : null;
    return (coi && coi <= soon) || (lic && lic <= soon);
  }).map(function(s) {
    return {
      id: s.id, name: s.name,
      coiExpiring: s.coiExpiry && new Date(s.coiExpiry) <= soon,
      licenseExpiring: s.licenseExpiry && new Date(s.licenseExpiry) <= soon
    };
  });
}
```
**UI:** a small red badge on the Stakeholders tab + a line item in the existing
Dashboard "Project Health" card, same visual pattern as the current risk counts.

---

## A2. Lien waiver status tracking — ⬜ OPEN → ✅ SHIPPED 2026-08-15
**Status:** now implemented — `waiverStatus` / `waiverReceivedAt` fields on every
Budget line item (`js/mmgr-resources.js addBudgetLine`), a Waiver Status select +
Waiver Received date column in the Budget table (`js/mmgr-render.js renderBudget`),
and a "Waivers" summary line in the Budget summary cards. Labels stay US-convention
with the Jamaica-verification note below (B7) still pending — the tracking mechanism
is what was built, per the file's own instruction.
**Market gap:** named as its own dedicated software category (conditional/
unconditional, partial/final waivers tied to payment).
**⚠️ Legal note carried over from earlier in this project:** Jamaica's lien-waiver
equivalent (if any) needs verification separately — build the tracking mechanism now,
but don't assume US-style waiver categories map 1:1 to local law without checking.

```js
// New field on the existing Budget/payment line item
{
  id: 'pay_004',
  vendor: 'ABC Electrical Ltd',
  amount: 45000,
  waiverStatus: 'pending', // 'pending' | 'conditional' | 'unconditional' | 'not_required'
  waiverReceivedAt: null
}
```
**UI:** a status column on the existing Budget table — same table, one more column,
same rendering pattern already used for other status fields.

---

## A3. Bid leveling / side-by-side sub-bid comparison — ⬜ OPEN → ✅ SHIPPED 2026-08-15
**Status:** now implemented — new `js/mmgr-bids.js` module (same pattern as
`mmgr-risks.js` / `mmgr-stakeholders.js`) with bid packages, per-vendor amounts,
scope notes + qualified flags, a lowest-bid + scope-gap flag per the roadmap's
`flagScopeGaps()`, and a side-by-side comparison table rendered in the Stakeholders
panel ("Bid Leveling" card).
**Market gap:** "where most of the risk in subcontractor award actually lives" —
named as a major pain point across multiple sources.

```js
// New standalone record type, own module (mmgr-bids.js) following the exact
// pattern of mmgr-risks.js / mmgr-stakeholders.js
{
  id: 'bid_002',
  package: 'Electrical — Phase 1',
  bids: [
    { vendor: 'ABC Electrical Ltd', amount: 45000, scopeNotes: 'Includes fixtures', qualified: true },
    { vendor: 'XYZ Wiring Co', amount: 41000, scopeNotes: 'Excludes fixtures', qualified: true }
  ]
}

// Simple comparison helper — normalizes scope gaps into a visible flag rather
// than pretending two different-scope bids are directly comparable
function flagScopeGaps(bids) {
  return bids.map(function(b, i) {
    return Object.assign({}, b, {
      lowestAmount: b.amount === Math.min.apply(null, bids.map(function(x){return x.amount;}))
    });
  });
}
```
**UI:** a simple side-by-side table, reusing the `comparison_card_display_v0`-style
layout pattern already established elsewhere in this project's tooling.

---

## A4. Go/No-Go bid scoring — ⬜ OPEN → ✅ SHIPPED 2026-08-15
**Status:** now implemented — same `js/mmgr-bids.js` module adds scored Go/No-Go
checklists (label + 0/0.5/1 score per criterion), the roadmap's `goNoGoScore()`
(≥75% GO / ≥50% REVIEW / else NO-GO) with a live recommendation badge, and a
"Go / No-Go Scorecard" card in the Stakeholders panel, same visual language as the
Charter form.
**Market gap:** named as its own category (ContraVault and others) — a structured
checklist deciding whether an opportunity is worth pursuing before committing estimator
time to it.

```js
// A small scored checklist, similar shape to the existing Charter intake
{
  id: 'gonogo_001',
  projectName: 'Riverside Tower Phase 2',
  criteria: [
    { label: 'Bonding capacity available', score: 1 },   // 1 = yes, 0 = no, 0.5 = maybe
    { label: 'Client payment history known/good', score: 1 },
    { label: 'Schedule realistic for crew capacity', score: 0.5 },
    { label: 'Scope matches core competency', score: 1 }
  ]
}

function goNoGoScore(criteria) {
  var total = criteria.reduce(function(sum, c){ return sum + c.score; }, 0);
  var pct = total / criteria.length;
  return { pct: pct, recommendation: pct >= 0.75 ? 'GO' : pct >= 0.5 ? 'REVIEW' : 'NO-GO' };
}
```
**UI:** a simple new small module/modal, same visual language as the existing
Charter form.

---

## A5. EMR (Experience Modification Rate) tracking — ⬜ OPEN → ✅ SHIPPED 2026-08-15
**Status:** now implemented as part of the A1 pass — `emr` + `emrVerifiedAt` fields on
Stakeholder records, an EMR column in the Stakeholder table that flags stale values
(never verified = stale; older than 365 days = stale) via the roadmap's
`isEmrStale()`, with a "Stale EMR" badge per row.
**Market gap:** flagged as a field that goes stale in spreadsheets — "the sub you used
last year with an EMR of 0.9 now has an EMR of 1.8 and nobody updated the record."
Already included as a field in A1's schema above — this item is really just the
"verified stale after N months" alert logic on top of it:

```js
function isEmrStale(stakeholder, staleAfterDays = 365) {
  if (!stakeholder.emrVerifiedAt) return true; // never verified = stale by definition
  var verified = new Date(stakeholder.emrVerifiedAt);
  var ageDays = (Date.now() - verified.getTime()) / 86400000;
  return ageDays > staleAfterDays;
}
```

---

## A6. Job-cost-to-actual real-time comparison — ✅ DONE (verified present)
**Status:** already shipped — the main Dashboard already carries a full
"Earned Value Management" card (`project.html #evm-card`) with SPI / CPI / EV / SV /
CV / PV / AC tiles plus EAC / ETC / VAC / TCPI, and a "Budget Variance" stat card
("Planned vs Actual") in the same top row (`#dw-bud-card`, filled by
`js/mmgr-render.js renderDash`). A separate "live tile" would be redundant — the EVM
numbers are already always-visible without clicking into the EVM tab.
**Market gap:** "Real-Time Visibility Wins Projects... GCs who see daily job cost
actuals, change orders, and schedule variance in real-time make better decisions" —
named as the trend replacing weekly/monthly reporting.
**Note:** the underlying data (Budget, EVM) already exists in this app — this is a
presentation-layer addition, not new data collection.

```js
// A live variance calculation, reusing existing EVM fields (no new state needed)
function liveJobCostVariance(evm) {
  // evm already has plannedValue, earnedValue, actualCost per the existing
  // mmgr-evm.js module — this just surfaces it as a single always-visible
  // dashboard number instead of requiring a user to open the EVM tab.
  return {
    costVariance: evm.earnedValue - evm.actualCost,
    costVarianceLabel: (evm.earnedValue - evm.actualCost) >= 0 ? 'Under budget' : 'Over budget'
  };
}
```
**UI:** promote one existing EVM number onto the main Dashboard as a live tile,
rather than requiring a click into the EVM tab to see it.

---

## A7. AI-drafted RFP/proposal clause compliance check — ⬜ OPEN → ✅ SHIPPED 2026-08-15
**Status:** now implemented — new `complianceCheck` AI preset (PRESET label
"Claim Compliance") in `js/mmgr-prompts.js` following the roadmap's exact prompt
shape (delay narrative / supporting evidence / cost impact / contractual basis /
requested relief), auto-appearing as a chip in the AI window Presets tab
(`ns.Prompts.list()` drives the chips), plus a zero-key LOCAL tier builder in
`js/mmgr-ai.js LOCAL_BUILDERS` that checks the assembled claim-pack data
deterministically with no model call.
**Market gap:** VisibleThread's entire product is "does this proposal miss a
required clause" — a lighter version of this fits directly on top of the AI presets
already built in Rank 2.3.

```js
// A new AI preset, following the exact pattern of the existing presets in
// mmgr-prompts.js — no new AI infrastructure, just a new prompt template
const COMPLIANCE_CHECK_PRESET = {
  id: 'complianceCheck',
  label: 'Check Claim Pack for missing elements',
  buildPrompt: function(claimPackText) {
    return 'Review this claim package against a standard checklist: delay ' +
      'narrative, supporting evidence references, cost impact breakdown, ' +
      'contractual basis, and requested relief. List anything missing or ' +
      'unclear, in plain language, without inventing content that isn\'t ' +
      'already in the document.\n\n' + claimPackText;
  }
};
```
**UI:** one more entry in the existing AI Presets tab — zero new UI surface needed.

---

# SECTION B — Requires 3rd-party account, API key, hardware, or owner legal review

**DO NOT START ANY ITEM BELOW without the owner explicitly naming it and confirming
the required account/key/hardware is ready.** These are documented so they're not
forgotten, not so they get built opportunistically.

## B1. PPE / hazard detection from photos — 🚫 BLOCKED (needs vision API key)
**Requires:** a computer-vision API (e.g. a vision-capable AI model call, or a
dedicated safety-vision vendor). Real ongoing per-image cost.
**Owner must first:** decide which vision provider/API to use and obtain a key.

## B2. Live camera-based site monitoring — 🚫 BLOCKED (hardware + vendor)
**Requires:** physical cameras, a hosting/streaming vendor, likely a monthly
subscription (e.g. TrueLook-style service). Significant recurring cost.
**Owner must first:** decide if this is even in scope for a solo-dev tool at all —
this is arguably outside this app's category entirely (it's a hardware+monitoring
product, not a PM tool feature).

## B3. Wearable / fatigue-alert integration — 🚫 BLOCKED (vendor API)
**Requires:** a specific wearable vendor's API (varies per device — Kinetic, StrongArm,
etc.), which the owner would need to select and obtain access to.
**Owner must first:** pick a wearable vendor, if pursuing this at all — likely a
much later-stage item.

## B4. As-planned vs. as-built photo comparison (AI-analyzed) — 🚫 BLOCKED (AI vision cost)
**Requires:** if done with true AI image comparison (not just side-by-side display),
needs a vision-capable AI API with real per-call cost.
**Note:** a *simple* side-by-side photo viewer with no AI comparison is actually a
Section A item — flag this distinction to the owner before starting, since "just show
two photos next to each other" needs nothing extra, but "have AI detect differences"
does.

## B5. Environmental/site sensor integration (noise, dust, air quality) — 🚫 BLOCKED (hardware)
**Requires:** physical IoT sensors + whichever vendor's API exposes their readings.
**Owner must first:** decide on and purchase sensor hardware, if pursuing this.

## B6. Digital twin / BIM-lite visualization — 🚫 BLOCKED (large scope; owner go-ahead)
**Requires:** likely a 3D rendering library at minimum (feasible without a paid API,
but a real, larger scoped build) — flag to owner as "buildable without 3rd party, but
large scope" rather than a quick add, separate from the true hardware-dependent items
above.

## B7. Lien waiver — legal format verification for Jamaica — 🚫 BLOCKED (legal review)
**Requires:** the owner (or legal counsel) to confirm what Jamaica's actual
equivalent framework is, before A2's tracking categories can be trusted as legally
meaningful rather than just US-convention labels borrowed without verification.

---

# Priority suggestion for Section A (build order)
1. **A1 (COI/license expiry)** and **A5 (EMR staleness)** — same module, same PR,
   highest-cited pain point, smallest scope. ✅ shipped 2026-08-15
2. **A6 (live job-cost tile)** — pure presentation layer on data that already exists,
   very low risk. ✅ already present (Dashboard EVM card)
3. **A7 (AI compliance-check preset)** — one new prompt template, reuses everything.
   ✅ shipped 2026-08-15
4. **A2 (lien waiver status)** — straightforward, but tag it clearly as "US-convention
   labels, Jamaica-verification pending" per B7 until that's resolved.
   ✅ shipped 2026-08-15 (tracking only; B7 still open)
5. **A3 (bid leveling)** and **A4 (Go/No-Go scoring)** — genuinely new modules, more
   scope than the others, but still zero third-party dependency. ✅ shipped 2026-08-15

**Section B stays untouched until the owner names a specific item and confirms the
required account/key/hardware is actually ready.**

---

# SECTION C — 30 additional features, from a second market research pass
**Source note:** pulled from a dedicated search across current (2026) construction PM
software coverage (Procore, Fieldwire, Autodesk Build, Access Fonn, Projectmates, and
industry roundups). **Cross-checked against the codebase 2026-08-15** — statuses below
are verified against live code, not assumed.
**Do not assume Tier 1 items are missing just because they're listed here — verify
first**, the same discipline applied everywhere else in this project.

## Tier 1 — treated as baseline by every competitor source (verify presence first)
1. **RFI (Request for Information) tracking** — ⬜ OPEN → ✅ SHIPPED 2026-08-15.
   Full RFI Register (question → routing → response → ball-in-court lifecycle) in
   the Documents panel: `state.rfis` + `ns.Rfis` CRUD (`js/mmgr-closure.js`),
   `renderRfis` (`js/mmgr-render.js`), statuses open/routed/responded/closed + a
   "Ball in Court" field naming whose turn it is. The glossary definition
   (`js/mmgr-defs.js`) already existed.
2. **Submittal tracking** — ⬜ OPEN → ✅ SHIPPED 2026-08-15. Submittal Register in
   the Documents panel (material/shop-drawing approval workflow, distinct from
   RFIs): `state.submittals` + `ns.Submittals` CRUD (`js/mmgr-closure.js`),
   `renderSubmittals` (`js/mmgr-render.js`), statuses pending/review/approved/
   approved-comments/rejected + response date + ball-in-court.
3. **Punch list module** — ⚠️ PARTIAL → ✅ SHIPPED 2026-08-15. Dedicated Punch List
   card at the top of the Closure panel with location + assignee + category
   (Defect/Snag/Touch-up/Safety/Other) + priority + open/in-progress/done status:
   `state.punchList` + `ns.PunchList` CRUD (`js/mmgr-closure.js`),
   `renderPunchList` (`js/mmgr-render.js`). The existing Closeout Checklist and
   "Defects at Handover" KPI remain for broad closeout items. (Roadmap's photo
   field intentionally omitted — zero-dependency; the item row carries location
   instead.)
4. **Daily log / site report** — ⚠️ PARTIAL. `js/mmgr-field.js` has snapshots, a daily
   snapshot diff, and a daily field-report prompt with weather/temp/crew/safety/
   materials placeholders; `weatherLog` records daily weather. No structured daily-log
   entry UI (labor count / deliveries / photos) that persists as its own record.
5. **Drawing/document version control with markup** — ⚠️ PARTIAL. Documents module
   (`js/mmgr-closure.js` + `renderDocuments`) tracks doc number / type / version /
   status / date issued. No redline/markup tool, no sheet-version comparison.
6. **Ball-in-court tracking** — ⬜ OPEN → ✅ SHIPPED 2026-08-15. Cross-module
   "whose turn is it" rollup card at the top of the Documents panel:
   `getBallInCourt` (js/mmgr-closure.js) aggregates every open RFI / submittal
   / issue with its ball-in-court holder, sorted by due date; `renderBallInCourt`
   (js/mmgr-render.js).

## Tier 2 — schedule & procurement depth
7. **Lookahead scheduling (2–3 week rolling view)** — ⬜ OPEN → ✅ SHIPPED 2026-08-15.
   "2-Week Lookahead" card on the Dashboard right under Today's Focus: every open
   task starting/finishing in the next 14 days grouped as Overdue Carryover / This
   Week / Next Week with assignee + weather flags + inline status dropdown — pure
   `lookaheadTasks()` helper (`js/mmgr-schedule.js`), `renderLookahead`
   (`js/mmgr-render.js`). Distinct from the full Gantt; Lead-Time Tracker + Today's
   Focus remain as-is.
8. **Percent Plan Complete (PPC)** — ⬜ OPEN → ✅ SHIPPED 2026-08-15. "Percent Plan
   Complete (PPC)" card on the Dashboard: current-week figure + 4-week history bars
   + overdue-carryover note. Pure `computePpc()`/`isoWeekStart()` (`js/mmgr-schedule.js`),
   `renderPpc` (`js/mmgr-render.js`). Basis is stated honestly on the card
   (end-date-in-week vs completion status); a week with no planned work shows a dash,
   never a fabricated 0%.
9. **Submittal turnaround time / RFI cycle time** as tracked metrics — ⬜ OPEN.
10. **Procurement/material tracking** — ⚠️ PARTIAL. Lead-Time tasks
    (`js/mmgr-tasks.js tglLeadTime`, Kanban lead-time lane, rolling 3-month material
    lead-time window in `renderLeadtimeTracker`) track vendor waits; no dedicated
    procurement log.
11. **Drawing distribution log** — ⬜ OPEN → ✅ SHIPPED 2026-08-15. Card in the
    Documents panel: `state.drawingLog` + `ns.DrawingLog` CRUD (js/mmgr-closure.js),
    `renderDrawLog` (js/mmgr-render.js) — date / drawing no. / rev / distributed-to
    / method (email, print, portal, hand) / notes.

## Tier 3 — financial depth beyond current Budget/EVM
12. **Committed cost tracking** — ⚠️ PARTIAL → ✅ SHIPPED 2026-08-15. Per-line
    `committed` bucket on Budget lines (blank defaults to planned — pre-C12
    behavior preserved; 0 drops a planning-stage line out of the commitment
    total), a Committed column in the table, and a committed-but-not-spent
    sub-label under the summary card (`bud-committed-gap`, js/mmgr-render.js).
13. **Pay application / draw request generation** — ⬜ OPEN → ✅ SHIPPED 2026-08-15.
    Pay Applications card in the Budget panel: `state.payApps` + `ns.PayApps`
    CRUD (js/mmgr-resources.js), `genPayApp` drafts the current period at the
    live spend figure, `renderPayApps` walks draft → submitted → approved.
14. **Cost-to-complete forecasting** — ⚠️ PARTIAL. EVM card already surfaces
    EAC / ETC / VAC / TCPI (`js/mmgr-evm.js`) + the AI Forecast preset; no dedicated
    burn-rate projection view.
15. **Change order financial impact rollup** — ⚠️ PARTIAL. Each Change carries
    `costImpact` + a ripple estimate in `renderChanges`; no single cumulative rollup.

## Tier 4 — quality & inspections
16. **Inspection checklists** — ⬜ OPEN → ✅ SHIPPED 2026-08-15. Trade/phase
    inspection card in the Risk & Issue panel: `state.inspections` + `ns.Inspections`
    CRUD (js/mmgr-risks.js) with pass/fail item rows — all items checked
    auto-advances the inspection to passed, a failed item reopens it.
    Deliberately separate from DMAIC.
17. **Quality/safety incident reporting with corrective-action tracking** — ⚠️ PARTIAL
    → ✅ SHIPPED 2026-08-15. Incident Register in the Risk & Issue panel:
    `state.incidents` + `ns.Incidents` CRUD (js/mmgr-risks.js) with the
    corrective-action closure loop — status walk open → investigation → action →
    closed, closing stamps closedDate, root cause + corrective action on record.
18. **Handover/closeout package generator** — ⚠️ PARTIAL → ✅ SHIPPED 2026-08-15.
    Handover Package card in the Closure panel: `state.handover` + `ns.Handover`
    CRUD (js/mmgr-closure.js) bundling O&M / warranty / as-built / certificates /
    sign-off items, each walking required → ready → filed.

## Tier 5 — collaboration & client-facing
19. **Client portal / limited external view** — ⚠️ PARTIAL. View-only access codes +
    published projects (admin publish flow, `app.html` cloud dash); no branded
    client-facing summary page.
20. **Meeting minutes as a distinct artifact from transcripts** — ✅ DONE.
    `copyMeetingMinutes()` (`js/mmgr-meetings.js`) renders a Word-ready minutes block
    per meeting + auto-logs every ended meeting to Comms.
21. **@mention / assignment notifications within comments** — ⬜ OPEN. (Batched/
    non-spam constraint noted — nothing to extend yet.)

## Tier 6 — portfolio & scale
22. **Multi-project portfolio dashboard** — ✅ DONE. `js/mmgr-portfolio.js` + the
    dark dashboard on `app.html` (`#db-metrics`, `renderMetrics`) rank all projects
    by urgency/health with plain-English reasons + weather-risk input.
23. **Cross-project resource allocation view** — 🗑 REMOVED (de-scoped
    2026-08-16). Portfolio machinery is not needed for the single-user
    stabilization phase; not to be built without the owner re-opening it.
24. **Template library** — ⚠️ PARTIAL. Meeting templates (`MEET_TEMPLATES` in
    `js/mmgr-meetings.js`) exist; no reusable WBS/schedule/budget templates.

## Tier 7 — smaller, likely easy wins
25. **Sheet/drawing comparison (redline diff between two revisions)** — ⬜ OPEN.
26. **Warranty period tracker** — ⬜ OPEN → ✅ SHIPPED 2026-08-15. Warranty
    Tracker card in the Closure panel: `state.warrantyItems` + `ns.Warranty` CRUD
    (js/mmgr-closure.js) with start/end dates and a live time-left badge; feeds
    the C29 expiry rollup.
27. **Time tracking / labor hours log** — ⚠️ PARTIAL. Resources track
    `hoursAllocated` + rate + utilization (`js/mmgr-resources.js`); no per-task
    clock-in/clock-out log.
28. **Equipment/asset log** — ⚠️ PARTIAL. Resources `type` includes "Equipment";
    no dedicated equipment log with rental/ownership fields.
29. **Document expiry/renewal dashboard** — ⬜ OPEN → ✅ SHIPPED 2026-08-15.
    Expiry & Renewals card on the Dashboard: `getExpiryRollup` (js/mmgr-stakeholders.js)
    rolls up COI/license expiries + EMR staleness + warranty end dates + permit
    expiries due inside 60 days (or overdue) with days-left badges;
    `renderExpiryCard` hides the card entirely when nothing is due.
30. **Permit tracking** — ⚠️ PARTIAL → ✅ SHIPPED 2026-08-15. Dedicated Permit
    Register card in the Documents panel: `state.permits` + `ns.Permits` CRUD
    (js/mmgr-closure.js) with permit no. / type / agency / issued / expiry /
    status walk applied → active → expiring → expired + days-left flags; feeds
    the C29 expiry rollup.

## Required next step before any of Section C is scoped further
Cross-check items 1–6 specifically against the actual codebase — the same
function-by-function discipline used for the original monolith audit — before treating
any of them as confirmed-missing. Some may already exist under a different name (the
same false-positive risk that showed up repeatedly during the monolith parity check).
Do not add duplicate modules for anything already covered.
**✅ Status: this cross-check has been done (2026-08-15) and is recorded in the
markers above.**

**FROZEN as of 2026-08-16 (stabilization mode):** every ⬜ OPEN / ⚠️ PARTIAL item
above is on hold — no new feature builds until the owner's natural-usage pass is
done. See the PHASE NOTE at the top of this file.
