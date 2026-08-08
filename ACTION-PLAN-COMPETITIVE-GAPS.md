# My MaNaGeR — Competitive Gap-Closing Action Plan

**Purpose:** Close feature gaps found in Asana, Primavera P6, and Procore by extending
My MaNaGeR's existing data model (Health Score, Agenda templates, Risk register, Budget,
WBS, RACI, Access Control). Written for execution via Claude Code, one phase at a time.

**Hosting constraint:** InfinityFree (static + PHP + MySQL, no websockets, no long-running
processes, no reliable cron). Every feature below must run client-side or on-request via
PHP. Do NOT build anything that assumes a persistent server process. Flag any place a
feature is faking backend behavior with localStorage/PHP-on-request so it's a clean
find-and-replace when the app migrates off InfinityFree later.

**Do not break existing functionality.** Before starting any phase, confirm current state
against `/areas/mymanager-app.md` context: access-control system, Health Score, RACI
porting, EVM/Spend Log porting, glass UI pass, and structural IA fixes may be in-flight or
complete — check the live codebase, don't assume.

---

## Phase 0 — Pre-flight (do this first, every session)

- [ ] Pull current zip/repo state, diff against last known state in memory
- [ ] Confirm which of the "already delivered" items in project memory are actually live
      on https://mymanager-garack.wuaze.com/
- [ ] Re-run the skeptical-code-audit skill methodology before claiming any phase "done" —
      no feature is complete until data-action/getElementById/event-handler wiring is
      verified, not just visually spot-checked

---

## Phase 1 — Foundational aggregators (highest leverage, lowest new-surface risk)

These reuse 100% existing data. No new schema needed.

### 1.1 Today Decision Engine
- New view aggregating: overdue risks, budget variance flags, stalled WBS items, open
  action items — ranked by impact score, not due date
- Impact scoring: simple weighted formula (schedule days late × weight + budget variance %
  × weight + risk severity × weight) — document the formula in-code as a comment block
- Acceptance: opening the app lands a user on a ranked "needs you now" list pulling from
  ≥3 existing data sources, updates live as underlying data changes

### 1.2 Meeting-to-Action Closed Loop
- Auto-generate action items from Agenda notes at meeting close
- Next meeting of same template type shows a "Last meeting's promises" ribbon: which
  action items are done/overdue since last time
- Acceptance: closing a Weekly Progress Review with unresolved action items surfaces them
  automatically when the next Weekly Progress Review is opened

### 1.3 Narrative Health Score
- Rule-based sentence generator (no AI call needed) explaining WHY the score moved:
  template strings keyed to which inputs changed (risks unmitigated, budget variance
  crossed threshold, schedule slip, etc.)
- Acceptance: Health Score card shows a 1-2 sentence plain-English explanation alongside
  the number, regenerated whenever underlying inputs change

**Phase 1 exit criteria:** all three features live, wired into existing dashboard, no
regressions in Health Score/Agenda/Risk/Budget tabs (re-run skeptical-code-audit).

---

## Phase 2 — Cross-linking existing modules (medium new-surface, high differentiation)

### 2.1 Dependency-Aware Risk Propagation
- Link WBS task slip → flag downstream dependent tasks + any risk whose trigger condition
  references the same task/phase
- Acceptance: marking a WBS task late visibly flags dependents and matching risks

### 2.2 Change Control Ripple Calculator
- On Change Control item creation/approval, compute affected downstream WBS dates and
  budget lines before approval is finalized
- Acceptance: change control modal shows a "this affects: X days, Y budget lines" summary
  before the approve button is enabled

### 2.3 Procurement Lead-Time Tracker
- Tie Procurement checklist items (from Kickoff template) to WBS need-by dates; flag when
  lead time pushes past the dependent task's start
- Acceptance: a procurement item with lead time > days-until-needed shows a schedule-risk
  flag automatically

### 2.4 RACI Conflict Detection
- Validate RACI grid on save: zero Accountable, multiple Accountable, or Responsible-not-
  elsewhere-referenced
- Acceptance: invalid RACI configurations show inline warnings, don't block save (data
  entry in progress is valid), but surface on the project's Health Score inputs

### 2.5 Risk-to-Budget Contingency Linkage
- Each risk register entry gets optional cost-impact-estimate field; sum expected value
  (probability × impact) against budget contingency line
- Acceptance: Budget tab shows contingency-vs-risk-exposure comparison

**Phase 2 exit criteria:** all cross-links live, existing tabs still function standalone
(cross-linking must degrade gracefully if one side's data is empty).

---

## Phase 3 — Retention and habit mechanics

### 3.1 Action Item Aging + Escalating Visibility
- Visual escalation (color/position) for action items open past their committed date
- Acceptance: an action item 1 week overdue looks visually distinct from one 1 day overdue

### 3.2 Stakeholder Sentiment Pulse
- 3-second emoji/thumbs pulse per attendee at end of Weekly Progress Review, tracked over
  time as a simple sparkline
- Acceptance: sentiment history visible per project, doesn't block meeting close if skipped

### 3.3 PM Consistency Streaks
- Track: weekly review completed on time, risk register reviewed weekly, action items
  closed before next meeting — subtle non-gamey streak indicator
- Acceptance: streak counter visible on dashboard, resets cleanly on a missed week, no
  guilt-tripping copy

### 3.4 Baseline Snapshot Diffing
- Weekly auto-diff: tasks slipped, budget variance delta, new risks — plain English,
  feeds directly into Copy All
- Acceptance: "What changed this week" block generates correctly and is included in
  existing Copy All output

**Phase 3 exit criteria:** habit mechanics are additive/optional, never gate core
functionality, tone stays professional (no cheap gamification).

---

## Phase 4 — Access control extensions (monetization-adjacent)

### 4.1 Client-Safe Read-Only Scoped Codes
- Extend existing admin-generated code system: new code type = scoped read-only
  (dashboard + schedule visible, budget/risk detail hidden)
- Must reuse existing SHA-256-hash + localStorage-unlock pattern, not a parallel system
- Acceptance: a scoped code unlocks a visibly reduced view; admin panel shows code type
  at generation and in the management list

### 4.2 RACI-to-Workload Heatmap
- Cross-reference RACI "Accountable" assignments with open task counts per person
- Acceptance: heatmap view shows overload risk per person, driven by existing RACI +
  WBS/task data, no new data entry required

**Phase 4 exit criteria:** access control changes pass a full re-audit of the existing
code-generation/unlock flow (this is security-sensitive — do not regress it).

---

## Phase 5 — Export and onboarding polish (low effort, high perceived value)

### 5.1 Copy All → Multi-Format
- Add Slack/email-digest format and printable client-facing PDF summary alongside existing
  Word format
- Acceptance: three format options available from the same Copy All entry point

### 5.2 Definitions Tab → Contextual Tooltips
- Every jargon term (RACI, EVM, WBS, baseline, float, etc.) in-app becomes a hover/tap
  tooltip pulling from existing Definitions data — single source of truth, no duplicated
  copy
- Acceptance: at least the top 10 most-used terms have live tooltips sourced from
  Definitions tab content

### 5.3 Onboarding-Aware Empty States
- Empty states deep-link to the matching Field Guide sheet on the companion onboarding
  site instead of generic "no data yet" copy
- Acceptance: at least 3 major empty states (Risk register, Budget, RACI) link out
  correctly

**Phase 5 exit criteria:** no new data model, this phase is purely presentation/export.

---

## Phase 6 — Portfolio view (requires Phase 1 first)

### 6.1 Cross-Project Portfolio Health Rollup
- Project Dashboard ranks clickable projects by urgency (using Health Score /
  Today Decision Engine impact scoring from 1.1), not alphabetically
- Acceptance: dashboard with 3+ projects shows highest-urgency project first, with visible
  reason why

---

## Explicitly deferred — do not start until off InfinityFree

- Real-time multi-user collaboration (needs websockets)
- Monte Carlo simulation / resource leveling at scale (needs real compute)
- Full document/file vault (RFIs, submittals) at Procore's scale
- Offline-first field mode with IndexedDB sync (bigger lift — revisit after Phase 1-3
  prove out, only if still on InfinityFree)

---

## Working agreement for Claude Code sessions

1. One phase at a time. Do not start Phase N+1 until Phase N's exit criteria are checked.
2. Every feature touching existing tabs (Budget, RACI, Agenda, Risk, Access Control) must
   be verified with the skeptical-code-audit methodology before being marked done —
   check data-action wiring, getElementById matches, and CSS class parity, not just visual
   inspection.
3. Comment every place a feature is simulating backend behavior (localStorage-as-database,
   PHP-on-request instead of a real job queue) so the future migration off InfinityFree is
   a clean lift.
4. Update `/areas/mymanager-app.md`-equivalent project notes after each phase with what
   shipped, what broke and got fixed, and what's still open — this file is the source of
   truth for sequencing, not a memory of intent.
