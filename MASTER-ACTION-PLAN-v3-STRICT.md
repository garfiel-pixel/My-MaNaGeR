# My MaNaGeR — MASTER ACTION PLAN (STRICT PROTOCOL)

**Classification:** Execution doctrine for Claude Code. This supersedes nothing already
shipped — it SEQUENCES and RANKS everything currently on the table:
ACTION-PLAN-COMPETITIVE-GAPS.md, its v2 weather addendum, STRUCTURAL-IA-FIXES-SPEC.md,
and the two strategy documents just absorbed (Evidence/Claim positioning +
Local-First/Zero-Server architecture doctrine). Nothing below contradicts prior specs;
where they overlap, this file is the tie-breaker on ORDER, not on content.

**Standing rule:** no phase begins until the prior phase's exit criteria are verified —
not assumed, not "looks done," VERIFIED, the way the jsdom project-run audit verified
Health Score / RACI / save-persistence against the live codebase, not against intent.
No phase is reported complete until it passes the skeptical-code-audit methodology.

**Non-negotiable architecture constraints (apply to every phase, no exceptions):**

1. **Unified state only.** Every new feature reads/writes the SAME project document
   (current schema v11 lineage). No feature gets its own side-store, no feature
   fragments the schema. If a feature can't be expressed as fields on the existing
   project object, the feature design is wrong — fix the design, not the rule.
2. **Zero mandatory server cost.** Core functionality (WBS, schedule, budget, EVM,
   risk, RACI, claim log) must work with $0 in server hosting. Optional network calls
   (weather, AI) must be circuit-broken — their absence never breaks core function.
3. **No notification spam.** No push, no unsolicited background network calls, no
   real-time alert floods. Intelligence surfaces as digests the user requests or opens,
   not interruptions.
4. **Offline-first is a hard requirement, not an enhancement.** 100% of core operations
   (task edit, budget entry, risk log, claim log entry) must function with zero network
   connectivity. This is now a release gate, not a nice-to-have.
5. **Portable data.** The project must remain exportable as a single `.json` file the
   user owns outright, with no server dependency to read it back.

Any implementation proposal that violates one of these five gets rejected at design
review — no exceptions for "just this once, it's easier."

---

## RANK ORDER (why this order, not the order features were originally conceived)

Money and legal exposure create the strongest retention gravity known in this market —
stronger than habit mechanics, stronger than UI polish. Rank reflects that, not
build-order convenience.

| Rank | Workstream | Retention mechanism |
|------|-----------|---------------------|
| 1 | Evidence / Claim Pack | User cannot leave without rebuilding their legal defense file |
| 2 | Weekly/Daily Digest Engine | Habit loop outside the app (forwarded email/Slack digest) |
| 3 | Progressive Disclosure / Anti-Bloat | Removes the #1 churn reason (learning curve) before scaling features further |
| 4 | PWA + Offline Durability Hardening | Field reliability — the thing enterprise tools still get wrong |
| 5 | Portfolio Explainability | Multi-project users open this tool first every morning |
| 6 | Offline Feedback/Patch Loop | Support without a server, keeps dev velocity honest |
| 7 | Weather-Aware Scheduling (prior Phase 7) | Feeds Rank 1 and Rank 5 directly — folds in here, not standalone anymore |
| 8 | UI Polish: Projects List Visual Gap | Cosmetic — real, but ranked correctly against substance |
| 9 | API/Webhook Layer | Only after digests prove the habit loop works manually first |
| 10 | Everything else from the original 25-gap list not already absorbed above | Backlog, sequence opportunistically |

**Explicit ruling on prior phase numbering:** the old Phase 1 (Today Decision Engine,
Meeting-to-Action Loop, Narrative Health Score) is NOT abandoned — it is
PREREQUISITE INFRASTRUCTURE for Rank 1 and Rank 2 below, not a competing rank. Build
it first as foundation; it doesn't get its own rank because it's not a retention driver
on its own, it's plumbing for the things that are.

---

## PHASE 0 — Foundation (prerequisite, blocks everything else)

Confirm before touching anything in Rank 1:

- [ ] `mmgr-state.js` unload-safety fix (beforeunload/pagehide/visibilitychange flush)
      is live in the working codebase — CONFIRMED shipped, verify it survived the last
      zip re-upload, don't assume.
- [ ] Today Decision Engine, Meeting-to-Action Closed Loop, Narrative Health Score
      (original Phase 1) exist and are wired into the dashboard. These are the data
      aggregation primitives every later rank depends on. If not built yet, BUILD THESE
      FIRST, before Rank 1 below, even though they're not separately ranked.
- [ ] Re-run the jsdom full-project-simulation harness (already built, in
      `/home/claude/check/mymanager-fixed/run-project.mjs` pattern) after Phase 0 work
      lands, before proceeding to Rank 1. Zero regressions is the gate, not "should be
      fine."

**Exit criteria:** a simulated flat WBS project run produces correct Health Score,
correct dashboard aggregation, and correct persistence with zero data loss on
immediate-close simulation.

---

## RANK 1 — Evidence / Claim Pack (highest priority, do not skip ahead)

**Why first, explicitly:** this is the single feature that makes leaving the tool cost
the user something real — their claim/dispute defense file. Nothing else on this list
creates that kind of lock-in, and it's not manipulative lock-in — it's genuine value
(their actual legal/financial protection) that happens to also be sticky.

### 1.1 One-click Claim/Delay Package
- Data sources (ALL must be pulled from the existing unified state, zero new schema
  fragmentation): weather delay log (Phase 7 daily log), affected WBS tasks, LD/contract
  exposure value, baseline vs. actual schedule delta, change control log, meeting
  decisions/action items tied to the delay window
- Output: single export (PDF via existing Copy All infrastructure, extended) containing:
  narrative summary + supporting table + dates + affected WBS + baseline delta
- Acceptance: selecting a date range on a project generates a complete, counsel-usable
  package with zero manual data re-entry — everything pulled live from state

### 1.2 Baseline vs. Actual Delta as a First-Class Object
- Not just a sparkline (per earlier spec) — a structured record: which tasks slipped,
  by how many days, tagged with cause (weather / predecessor / change order / unknown)
- This is prerequisite data for 1.1 — build before or alongside, not after
- Acceptance: every schedule slip has a queryable cause tag, defaulting to "unknown"
  if not set, never silently blank

### 1.3 LD Exposure Field + Rollup
- Optional field already scoped in the weather addendum (Phase 7.5) — promote to Rank 1
  since it's core to the claim pack, not a weather-only feature
- Acceptance: Budget tab shows LD exposure avoided vs. incurred, driven by 1.2's cause
  tags, not just weather tags

**Phase exit criteria:** a full claim package can be generated end-to-end from a
simulated project with weather delays, schedule slips, and an active LD clause, with
zero hand-typed content in the output beyond the narrative wrapper text.

---

## RANK 2 — Weekly/Daily Digest Engine

### 2.1 Automatic "What Changed" Digest
- Tasks slipped/recovered, new high-severity risks, budget variance movement, open
  decisions/promises from meetings — auto-generated, not manually compiled
- Delivery: local generation only — copy/download/print, NO server-side email sending
  required for v1 (per zero-server-cost constraint)
- Acceptance: opening the digest for any project with activity in the trailing 7 days
  produces a complete, accurate summary with zero missed changes (spot-check against
  raw state diff)

### 2.2 Intelligence Panel Preset Prompts (grounds the existing AI window)
- Preset templates: "claim narrative," "weekly digest," "schedule audit" — all reasoning
  strictly over attached project state, never inventing dates or figures not present
  in state
- Acceptance: AI window output for each preset is traceable line-by-line back to actual
  state fields — no hallucinated dates, no invented figures, ever. This is a hard
  correctness gate, not a style preference.

**Phase exit criteria:** digest generation and AI presets both run correctly against
the Phase 0 simulated project with zero fabricated content.

---

## RANK 3 — Progressive Disclosure / Anti-Bloat

### 3.1 Core Mode vs. Advanced Packs
- Default "Core" surface on project open: Dashboard + WBS + Kanban + Charter only
- Advanced packs, toggled on explicitly, never on by default for a new project:
  - Schedule Science pack (Gantt / critical path / Monte Carlo)
  - Money pack (Budget / EVM)
  - Governance pack (RACI / Risk / Changes)
  - Field pack (Weather / Meetings / Claim log)
  - Quality pack (DMAIC)
- Acceptance: a brand-new project's first-open surface shows ONLY Core; toggling a pack
  on is a single action, not a settings-menu excavation

### 3.2 Time-to-First-Task Gate
- Metric: under 60 seconds from cold app launch to first task created, on an empty
  project, Core mode only
- This is a HARD acceptance number, not aspirational — test it with a stopwatch against
  the actual deployed build before calling this phase done

### 3.3 Inline Contextual Definitions (supersedes/extends prior tooltip spec)
- `data-def` attributes + existing Definitions tab data source, no duplicated copy
- Acceptance: every jargon term in Core mode has a live inline definition; Advanced
  pack terms get definitions on pack activation, not before

**Phase exit criteria:** stopwatch-verified sub-60-second time to first task; a
first-time user (or simulated cold-state run) never sees an Advanced-pack panel before
explicitly enabling it.

---

## RANK 4 — PWA + Offline Durability Hardening

### 4.1 PWA Manifest + Cache-First Service Worker
- App shell (HTML/CSS/JS) cached for instant, network-independent load
- Network calls (Open-Meteo, AI endpoint) explicitly circuit-broken from core logic —
  their failure must never block or degrade core CRUD operations

### 4.2 Persistent Local Transaction Queue
- Guarantee complete data retention through unexpected tab crashes, not just clean
  unload (Phase 0's beforeunload fix covers clean unload; this covers the crash case)
- Acceptance: simulate an abrupt process kill mid-edit (not a clean close) and confirm
  no data loss on next load — this is a materially different test than the Phase 0
  unload fix and must be verified separately, not assumed covered

### 4.3 100% Offline Core Operation Verification
- Acceptance: full WBS/Gantt/EVM/risk/claim-log operation with the network tab
  disabled entirely in devtools (or equivalent) — zero broken panels, zero silent
  no-ops

**Phase exit criteria:** offline test suite (manual or scripted) passes with zero
network connectivity and zero data loss across a simulated crash.

---

## RANK 5 — Portfolio Explainability

(Absorbs prior Phase 6.1 cross-project rollup — folds weather-risk ranking from the v2
addendum in as one input, not a separate dashboard.)

### 5.1 Explainable Urgency Ranking
- Rank projects by: overdue task count, open high-severity issues, budget variance
  severity, weather-risk days in next 7 (if Field pack enabled) — combined into one
  score with a plain-English "why this is ranked here" line, not just a number
- Acceptance: portfolio dashboard with 3+ projects always shows the highest-urgency
  project first, with a visible one-line reason, sourced from real state, not a
  black-box score

**Phase exit criteria:** ranking logic is inspectable — every ranking decision traces
back to specific state fields a user can verify themselves.

---

## RANK 6 — Offline Feedback / Patch Loop

### 6.1 Sanitized Bug/Feature Report Export
- User-facing: "Report issue" packages a sanitized snapshot (active panel id, feature
  flags active, error log slice, non-sensitive counts) into a downloadable/copyable
  block — NOT full private project notes by default
- Acceptance: exported payload never includes budget dollar figures, risk descriptions,
  or personal names unless the user explicitly opts to include full context

### 6.2 Developer-Side Replay
- Reuse existing `qa-*.cjs` / headless-test patterns already in the codebase as the
  local sandbox replay mechanism — do not build a separate patch-store product
- Acceptance: a submitted sanitized payload can be replayed locally to reproduce the
  reported state shape, without needing the user's real private data

**Phase exit criteria:** this stays lightweight — if implementation is trending toward
a full ticketing platform, STOP, that's scope creep past what a zero-server product
needs.

---

## RANK 7 — Weather-Aware Scheduling (prior Phase 7, re-ranked, not re-scoped)

All content from ACTION-PLAN-COMPETITIVE-GAPS-v2-ADDENDUM.md Phase 7 stands as written.
Sequencing change only: this now runs feeding INTO Rank 1 (claim pack) and Rank 5
(portfolio ranking) rather than as an independent phase. Build order: items 7.1/7.2
(forecast panel, task tagging) can proceed in parallel with Rank 3/4 work since they're
mostly additive; items 7.4/7.5 (daily log, LD exposure) should land no later than
immediately before Rank 1.3, since Rank 1 depends on them.

---

## RANK 8 — UI Polish: Projects List Visual Gap (confirmed from screenshots)

**Finding, stated plainly:** the Projects list page (screenshot reviewed) has a large
dead white area to the right of the project cards — the page reads as unbalanced and
breaks the "liquid glass" visual identity established elsewhere in the app (the
marketing/field-guide site's hero section, by contrast, has strong visual weight —
gradient background, glowing card accents, a crane photo — while the in-app projects
list is flat white with no imagery or glow at all).

### 8.1 Add Visual Weight to the Projects List Background
- Do NOT introduce new colors outside the existing glass token set (this constraint
  carries over from the earlier structural-IA-fixes non-goals — stay consistent)
- Options to evaluate (pick one, don't stack all three):
  - A subtle radial glow behind the project grid, using existing accent color tokens
    at low opacity — matches the "glow" the user asked for without new palette entries
  - A muted background image/texture (blueprint-grid pattern, matching the marketing
    site's blueprint motif already used for empty-state overlays elsewhere) sitting
    behind the glass cards at low opacity so it doesn't compete with card content
  - Per-project thumbnail imagery on each card itself (a generic construction-site
    photo placeholder if no project photo is set) — highest effort, highest payoff,
    directly answers "I want some images there"
- Acceptance: the projects list no longer reads as a flat white page when compared
  side-by-side with the marketing site's hero section; glass cards remain the clear
  visual focus, background treatment supports rather than competes

### 8.2 Consistency Check
- Confirm the fix doesn't regress the existing glass card contrast/readability (dark
  text on cards must still pass a basic contrast check against the new background)
- Acceptance: no readability regression on the unlocked/locked project cards, admin
  link, or lock icon

**Phase exit criteria:** side-by-side screenshot comparison (before/after) shows the
projects list visually consistent with the rest of the product's identity, not a
disconnected flat page.

---

## RANK 9 — API / Webhook Layer

Do not start until Rank 2 (digest engine) has been used manually for at least one real
project cycle — the API layer's entire value proposition (Zapier/Make digests leaving
the browser, owner-portal read access, accounting export) is worthless if the
underlying digest content itself hasn't been validated as useful first.

### 9.1 Stable JSON Resource Shape
- Tasks, baseline, risks, weather log, EVM snapshot, portfolio score — read-only shapes
  first, before any write-capable endpoint

### 9.2 Webhook Triggers (optional, opt-in only)
- "Project health dropped," "weather risk day tomorrow" — user-configured, off by
  default, never spontaneous

**Phase exit criteria:** explicitly deferred — do not begin design work on this rank
until Ranks 1–5 are shipped and in real use.

---

## RANK 10 — Backlog (everything else)

Every item from the original 25-gap competitive analysis not explicitly absorbed into
Ranks 1–9 above remains valid and un-discarded. Pull from backlog opportunistically once
Rank 1–5 are done. Do not let backlog items jump the queue without an explicit,
deliberate re-ranking decision — no silent scope creep.

**✅ EXECUTED (2026-08-13, owner go-ahead):** the surviving backlog items 21–25 (the v2
addendum's weather pass — the original 1–20 content is not preserved in-repo and was
absorbed into Ranks 1–9) are ALL verified shipped in code, and item 21 was additionally
promoted this session (see below). Rank 10 is CLOSED.

- 21. **Heat/Cold Safety Alert** — `js/mmgr-forecast.js` `heatColdAlert()` (HEAT_C=32 /
  COLD_C=0, first heat/cold risk day) rendered in-panel as `.wfr-alert.wfr-heat/wfr-cold`
  (visually distinct danger/blue tints + i-alert-triangle vs the amber schedule flags)
  in `js/mmgr-render.js` `renderWeatherForecast()`. **PROMOTED 2026-08-13:** a full-width
  page-top `#safety-banner` (role=status polite live region, `.is-hide` pattern, non-sticky)
  rendered by new `renderSafetyBanner()` from the SAME `heatColdAlert()` source so the two
  can never disagree; degrades gracefully (no location/forecast → hidden).
- 22. **Schedule Reliability Index (SRI) card** — `mmgr-forecast.js` `sri()` (weather-delay
  days vs elapsed scheduled days) rendered in the LD/SRI strip (`#ld-sri-strip`,
  `renderWeatherLog()`), documented in `js/mmgr-defs.js` (Schedule Reliability Index).
- 23. **Rolling Material Lead-Time Forecast** — `js/mmgr-tasks.js` lead-time review stamp
  (`tglLeadtimeReview`, `lastLeadtimeReview` in schema) + `js/mmgr-render.js`
  `renderLeadtimeTracker()` rolling 3-month window with a weekly-cadence `stale` badge.
- 24. **Subcontractor Weather Notification** — `mmgr-forecast.js` `subcontractorNotice()`
  (next 3 risk days + affected tasks, copy-paste text) wired as the `wxCopyNotice` action
  in `js/mmgr-app.js` (manual-trigger first, per the plan's own v1 constraint).
- 25. **On-Site Manual Weather Override** — `mmgr-forecast.js` `logWeatherDay()` with
  `manual:true` (manual entry when no forecast / hyperlocal reality beats the API) feeding
  the same `weatherLog` the export + LD/SRI read.

QA evidence: qa-full.cjs gates 58–61 (forecast panel, thresholds incl. heat alert, SRI
strip, 7d/16d toggle) + the standing two-tier verification (npm run verify GREEN, CSP
11/11, SW mmgr-shell-v78, 16/16 skills; node --check clean; browser smoke 2026-08-13).
See CONTINUATION-DIRECTIVE.md STATUS LOG 2026-08-13 (RANK-10-CLOSED + SAFETY-BANNER).

---

## STANDING VERIFICATION PROTOCOL (applies at every phase boundary)

1. Re-run the full simulated-project harness after every rank's implementation work.
   Zero regressions is the gate.
2. Every claim of "done" gets the skeptical-code-audit pass — action wiring, DOM id
   matches, CSS class parity — not a visual glance.
3. Every new feature is checked against the five non-negotiable architecture
   constraints at the top of this file before merge. A feature that violates one is
   rejected, no matter how far along it is.
4. Update the living project memory notes after each rank ships: what shipped, what
   broke and got fixed, what's still open. This file is the sequencing source of truth;
   memory notes are the historical record — they serve different purposes, don't
   collapse them into one document.

**This is the order. Do not skip ranks. Do not let a lower-ranked item jump the queue
because it looks easier — ease of implementation is not a ranking criterion here, user
retention leverage is.**
