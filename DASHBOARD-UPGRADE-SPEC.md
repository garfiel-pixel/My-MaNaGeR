# DASHBOARD-UPGRADE-SPEC.md — Reference-Based Dashboard Redesign
**Source:** Reviewed against a real-estate presales dashboard mockup (Riverside
Residences) supplied by the owner. Explicitly NOT a 1:1 port — this spec separates what
to steal, what to leave, and what needs a decision first, based on direct owner review
and cross-check against this app's own architecture and existing plan files.

**Status: DEFERRED, not active.** Per the standing rule already governing this project,
UI/visual work stays paused until DIR-1 through DIR-4
(`WORKABILITY-AND-RETENTION-PRIORITY-DIRECTIVES.json`) and the currently open bug queue
(`LIVE-TESTING-BUG-AND-UX-DIRECTIVES.md`, `CLOUD-PUBLISH-AND-SCOPED-ACCESS-DIRECTIVES.md`)
are resolved. This file exists so the idea isn't lost, not to be started now. Whoever
picks this up next should re-verify the bug queue is actually clear before starting.

---

## STEAL — genuinely good, worth building

### 1. Condensed phase-strip Schedule Overview
**What it is:** a compact row per project phase (e.g. Design / Site Prep / Foundation /
Structure / Interior / Completion), each showing a progress bar and a date range, sitting
on the main Dashboard — an at-a-glance summary distinct from the full detailed Gantt.
**Why it's worth building:** this app has a full, real critical-path Gantt already, but
nothing this condensed for a quick glance. Real gap, not a duplicate of existing UI.
**Data source:** derives directly from the existing `tasks`/phase grouping already in
the schedule engine — no new data model, this is a new summary view over data that
already exists.
**Acceptance:** dashboard shows one row per phase (not per task), each with a progress
percentage and start/end date range, computed from the existing task/phase data — no
new fields required on the task schema itself.

### 2. Metric cards with trend sparklines
**What it is:** existing dashboard number cards (health, budget, tasks, etc.) upgraded
to include a small trend sparkline instead of a flat number.
**Why it's worth building:** pure presentation upgrade on data already computed and
displayed elsewhere in the app — low risk, no new logic.
**Data source:** needs a short historical series per metric — verify whether the app
already retains enough history (e.g. via `updatedAt` snapshots or changelog entries) to
plot a real trend, or whether a small rolling-history log needs to be added first. Do
not fabricate a sparkline from a single data point — if history isn't available yet,
this item is blocked on that first.

### 3. AI Assistant "Quick Action" cards
**What it is:** replacing the current preset dropdown/list with large, clickable tile
cards (Project Digest / Performance Report / Risk Audit / etc.) directly in the AI
panel.
**Why it's worth building:** the single best idea in the reference — the presets already
exist and work (Rank 2.3, confirmed built). This is purely a front-end treatment change
on top of already-working functionality, not new logic.
**Acceptance:** every existing AI preset is reachable as a one-click tile; no preset is
removed or hidden in the process; clicking a tile behaves identically to the current
dropdown-triggered action.

### 4. EVM trend line chart (PV / AC / EV over time)
**What it is:** a line chart plotting Planned Value, Actual Cost, and Earned Value
across the project timeline, instead of (or alongside) the existing static EVM table.
**Requires verification before starting:** confirm whether the app currently stores
EVM values only as current-snapshot numbers, or as a real time series. If only a
snapshot exists today, this item needs a small historical-tracking addition first (store
a dated EVM snapshot at each save/recalculation) before a trend line is even possible —
do not fake a trend from a single point.
**Acceptance:** chart renders real historical PV/AC/EV points, not interpolated or
fabricated values.

### 5. Recent Updates unified activity feed
**What it is:** a single chronological feed on the dashboard combining events from
multiple existing logs (Decision Log, Change Log, Comms Log, and optionally Meetings)
instead of requiring a user to check three separate tabs.
**Why it's worth building:** directly matches item #29 from
`MARKET-FEATURE-ROADMAP.md` (Section C) — a rollup of dated/logged events across
modules. Validated as a real, cited market pattern, not just borrowed from this one
mockup.
**Acceptance:** feed shows entries from at least Decision Log, Change Log, and Comms Log
in a single reverse-chronological list, each entry clearly labeled with its source
module so it's traceable back to the original record, not just floating text.

---

## REJECT — do not build these, and why

### 6. Live camera site-feed widget
**Rejected outright.** Requires physical camera hardware and a streaming vendor —
Section B territory (`MARKET-FEATURE-ROADMAP.md`), explicitly not to be started without
the owner naming it and confirming hardware/vendor is ready. Owner's own read on this
during review: "I think it's bloat." Agreed — do not build, do not revisit unless the
owner explicitly reopens it by name.

### 7. Units Sold / Unit Status Distribution (Available / Reserved / Sold)
**Rejected — wrong product category.** This is a real-estate presales dashboard pattern
for tracking condo/unit sales to buyers, not a construction PM pattern. This app is not
selling units to end buyers; porting this section would import an entire unrelated
feature category (sales pipeline, buyer records, unit inventory) that has no basis
anywhere in this app's existing scope or plan files. Do not build any part of this
section.

---

## NEEDS A DECISION FIRST — don't build until scoped

### 8. "Onsite Workers" headcount metric
**Open question, not yet resolved:** is this meant to be a simple manual daily-log entry
(cheap, Section A — someone types in a headcount once a day), or is it meant to be tied
to real attendance-tracking hardware/badges (Section B — needs hardware and a vendor,
same caution as item 6)? **Do not build either version until this is explicitly
decided** — building the hardware-dependent version without being asked would repeat
the exact mistake this whole owner/3rd-party-gating discipline exists to prevent.

---

## Cross-cutting requirement for ALL items above

**Card density and viewport behavior.** This reference mockup is card-heavy by design,
which works on a wide desktop layout but risks reintroducing the exact clutter problem
already identified and partly fixed in this project (BUG-9, the hamburger-nav rework).
**Every item in the STEAL section must be built with the existing viewport-aware
layout system (Rank 3.4/3.5) in mind from the start** — do not build a wide-desktop-only
version of any of these cards and treat mobile/narrow-viewport adaptation as a separate
follow-up. Build both from the same pass.

---

## Sequencing

This entire spec is **deferred**. Before any item here is started:
1. Confirm `LIVE-TESTING-BUG-AND-UX-DIRECTIVES.md`'s remaining open items (BUG-6, BUG-8,
   and anything else still open at that time) are resolved.
2. Confirm `CLOUD-PUBLISH-AND-SCOPED-ACCESS-DIRECTIVES.md`'s two items are resolved.
3. Confirm DIR-1 through DIR-4 in `WORKABILITY-AND-RETENTION-PRIORITY-DIRECTIVES.json`
   are complete or explicitly deferred by the owner in writing.

Once cleared, build order within this spec: **item 3 (AI Quick Action cards) first** —
smallest, safest, highest-leverage, reuses fully-working functionality. Then item 1
(phase-strip schedule). Items 2 and 4 are blocked on confirming historical-data
availability per their own notes above, so resolve that question before scheduling
them. Item 5 (unified activity feed) can proceed independently of 2/4's blocker.
