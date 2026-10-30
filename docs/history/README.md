# docs/history - finished work, kept for the record

Moved here from the repo root when a document is finished and nothing outside
this folder references it. The live index stays at the root:
`AGENTS.md`, `CLAUDE.md`, `CONTINUATION-DIRECTIVE.md`, `EXECUTION-PLAN.md`,
`CONTRIBUTING.md`, `SECURITY.md`, `reflection.txt`.

Do not open this folder for guidance. It records what was done, not what to do.

| Document | Moved | Why it was finished |
|---|---|---|
| `2026-10-25-kanban-board-mechanics.md` | 2026-10-30 | `js/mmgr-kanban.js` owns the model (order, WIP limits, filters, lanes, flow metrics) and `boardPosition` is stored on tasks; the board mechanics it plans are shipped. |
| `DIRECTIVE-BILLING-CANCEL-1970-AND-DEADLOCK.md` | 2026-10-30 | `periodEndIso()` is live in `src/billing.js`; the 1970 date, cancel and orphaned-subscription fixes it directs are in the code. |
| `DIRECTIVE-MARKETING-CANVAS-AND-DOT-RAIL.md` | 2026-10-30 | The full-bleed canvas and the dot rail are encoded in `AGENTS.md` rule 9 and held by the registered `qa-dot-rail` gate (LAND-1). |
| `RBAC-DIRECTIVE-2026-10-25.md` | 2026-10-30 | Migrations through `0029_team_enterprise.sql` are applied and `qa-team-rbac` plus `qa-team-enterprise` are registered CI harnesses. |
| `SOURCE-REVIEW.md` | 2026-10-30 | A dated 2026-08-21 live-site review, superseded by the audits that followed it. |
| `CONTINUATION-DIRECTIVE-ARCHIVE-2026-10-18.md` | before 2026-10-30 | The continuation directive's own archive, split out when the live file was cut down to an index. |
| `log-2026-08.md`, `log-2026-09.md`, `log-2026-10.md` | rolling | Session logs, newest entries at the bottom of the current month. |
| `reflection-ARCHIVE-2026-10-18.txt` | before 2026-10-30 | The previous reflection file, kept when the live `reflection.txt` was restarted. |
