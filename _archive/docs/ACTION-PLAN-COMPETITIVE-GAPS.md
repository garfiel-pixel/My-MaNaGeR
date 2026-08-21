# My MaNaGeR — Action Plan: Competitive Gaps

> **RECONSTRUCTION (2026-08-12)** — the original file was missing from the repo.
> Rebuilt as a faithful record from the surviving cross-references in
> `ACTION-PLAN-COMPETITIVE-GAPS-v2-ADDENDUM.md` (which states "Phases 1-6 in the
> original file are unchanged" and cites phase numbers) and the absorption notes in
> `MASTER-ACTION-PLAN-v3-STRICT.md` (Rank 10: "Everything else from the original
> 25-gap list not already absorbed above"). Phase-level detail for the cited
> sub-items lives in the master plan; this file is the index/record of what the
> original analysis contained. Per plan-continuity-guardian §4: flagged as a
> reconstruction — treat the master plan as the source of truth for ranking.

## Purpose

25-gap competitive analysis of My MaNaGeR against Asana, Primavera P6, and Procore
(oriented primarily at the construction-project-management space), identifying
differentiators worth building. **Superseded in ranking by MASTER-ACTION-PLAN-v3-STRICT.md**
— this file records the analysis; the master plan owns build priority.

## Phases (1–6, unchanged by the v2 addendum)

- **Phase 1 — Today Decision Engine / Meeting-to-Action Loop / Narrative Health
  Score** (cited by addendum as "Phase 1.1" — the Today Decision Engine; it "must
  exist first" for weather tagging to wire in). Absorbed into
  MASTER-ACTION-PLAN-v3 Rank 2 (digest engine) territory; implemented in
  `js/mmgr-meetings.js` + `js/mmgr-health.js`.
- **Phase 2 — Schedule/Planning + Procurement** (addendum cites "Phase 2.3 —
  Procurement Lead-Time Tracker"; §23 extends it with rolling material lead-time
  forecast). Absorbed into MASTER-ACTION-PLAN-v3 Rank 1/2 adjacent workstreams.
- **Phase 3 — PM Consistency / Field Habits** (addendum cites "Phase 3.3 — PM
  Consistency" as the habit the weather daily log pairs with). Absorbed into
  MASTER-ACTION-PLAN-v3 Rank 2 (daily field report preset) + Rank 7.
- **Phase 4** — (no surviving cross-reference; see master plan absorption notes —
  Rank 4 PWA/offline hardening is the nearest surviving workstream).
- **Phase 5** — (no surviving cross-reference; master plan Rank 5 portfolio
  explainability is the nearest surviving workstream).
- **Phase 6 — Cross-Project Portfolio Health Rollup** (addendum cites "Phase 6.1" —
  the portfolio health rollup; §7.6's portfolio-level weather dashboard feeds it).
  Implemented as the `#portfolio-strip` on app.html (`js/mmgr-portfolio.js`
  `rank()`/`render()`); the dashboard refresh spec closed the metrics row on top.

## Gap items

- **1–20** — the original 20 gaps (content not preserved in any in-repo source).
  Per MASTER-ACTION-PLAN-v3 Rank 10, every item not explicitly absorbed into
  Ranks 1–9 remains valid and un-discarded, pulled from the backlog
  opportunistically — no silent scope creep.
- **21–25** — added by the v2 addendum (2026-08-12, weather research pass):
  21. Heat/Cold Safety Alert (LTIR reduction angle) — ✅ IMPLEMENTED + PROMOTED 2026-08-13
  22. Schedule Reliability Index (SRI) card — ✅ IMPLEMENTED
  23. Rolling Material Lead-Time Forecast (extends Phase 2.3) — ✅ IMPLEMENTED
  24. Subcontractor Weather Notification (closes BuilderTrend's actual gap) — ✅ IMPLEMENTED
  25. On-Site Manual Weather Override — ✅ IMPLEMENTED
  Weather workstream (Phase 7) is absorbed into MASTER-ACTION-PLAN-v3 **Rank 7** —
  implemented (`js/mmgr-weather.js`, weather-exposed task tagging, forecast panel,
  daily log). Remaining backlog items (safety alerts, SRI, sub notifications, manual
  override) sit in Rank 10 per the master plan. **Rank 10 CLOSED 2026-08-13** — every
  item verified shipped in code (see MASTER-ACTION-PLAN-v3-STRICT.md Rank 10 notes);
  the safety alert is now also a page-top `#safety-banner` (project.html +
  `renderSafetyBanner()` in js/mmgr-render.js).

## Status

SUPERSEDED for ranking purposes by `MASTER-ACTION-PLAN-v3-STRICT.md` (the source of
truth for what to build next). This file + the v2 addendum are the record of the
original analysis. Do not implement anything from here directly — pull from the
master plan's Ranks instead.
