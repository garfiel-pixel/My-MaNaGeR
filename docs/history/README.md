# docs/history - finished work, kept for the record

Moved here from the repo root when a document is finished and nothing outside
this folder references it. The live index stays at the root:
`AGENTS.md`, `CLAUDE.md`, `CONTINUATION-DIRECTIVE.md`, `EXECUTION-PLAN.md`,
`MCP-AGENT-FIRST-DIRECTIVE.md` (current plan), `CONTRIBUTING.md`, `SECURITY.md`,
`reflection.txt`.

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
| `AUDIT-DIRECTIVE-2026-10-18.md` | 2026-11-13 | Dated audit work order; its gates (T-1..T-3, S2, X-3) are live in `ci.yml`/`extended-qa.yml`. |
| `AUDIT-DIRECTIVE-2026-11-01.md` | 2026-11-13 | Dated audit work order; completed. |
| `BUDGET-BOQ-MCP-DIRECTIVE-2026-11-05.md` | 2026-11-13 | Budget/BOQ + MCP wave shipped; gates live in `ci.yml` (I-6/I-7/I-8). |
| `CUSTOM-DOMAIN-OWNER-REVIEW.md` | 2026-11-13 | Owner review doc for the custom-domain work; finished. |
| `DIRECTIVE-ASSISTANT-RATE-ACCESS.md` | 2026-11-13 | Assistant rate-access directive; shipped. |
| `FIELD-FINDINGS-DIRECTIVE-2026-10-28.md` | 2026-11-13 | Field-findings directive; shipped. |
| `IMPLEMENTATION-PLAN-REMAINING.md` | 2026-11-13 | Remaining-implementation plan; completed. |
| `IMPROVEMENT-DIRECTIVE-2026-10-22.md` | 2026-11-13 | Improvement directive; completed. |
| `MYMANAGER-ESTIMATOR-DIRECTIVE-2026-10.md` | 2026-11-13 | Estimator directive; shipped. |
| `OWNER-REVIEW.md` | 2026-11-13 | Owner review notes; finished. |
| `PADDLE-GO-LIVE-DIRECTIVE.md` | 2026-11-13 | Paddle go-live directive; shipped. |
| `PLAN-ASSISTANT-INTAKE-FILES-QUICKTOTAL-2026-10-10.md` | 2026-11-13 | Intake/quick-total plan; shipped. |
| `PLAN-ESTIMATOR-2026-10-09-RESEARCHED.md` | 2026-11-13 | Estimator research plan; shipped. |
| `PLAN-P10-AND-REPO-AUDIT.md` | 2026-11-13 | P10 + repo audit plan; completed. |
| `PLAN-WAVE-2026-10-09-MERGED.md` | 2026-11-13 | Merged wave plan; completed. |
| `PLANNING-TODO-2026-10-06-wave6-step1-facts.md` | 2026-11-13 | Wave-6 planning facts; completed. |
| `PLANNING-TODO-2026-09-03.txt` | 2026-11-13 | CI-repair tracker; superseded by the standing loop in `AGENTS.md`. |
| `PLANNING-TODO-2026-09-09.txt` | 2026-11-13 | Planning tracker; completed. |
| `PLANNING-TODO-2026-10-06.txt` | 2026-11-13 | Planning tracker; completed. |
| `PROJECT-API-KEY-AUDIT-AND-DIRECTIVE-2026-09-16.md` | 2026-11-13 | API-key audit directive; shipped (`qa-api-keys`). |
| `RBAC-NOTES.md` | 2026-11-13 | RBAC working notes; the directive shipped and is already archived. |
| `REFINEMENT-DIRECTIVE-2026-10-24.md` | 2026-11-13 | Refinement waves shipped; gates live in `ci.yml`. |
| `REFINEMENT-PROGRESS.md` | 2026-11-13 | Refinement progress log; completed. |
| `SECURITY-HYGIENE-DIRECTIVE.md` | 2026-11-13 | Security-hygiene directive; shipped. |
| `SECURITY-FIXES-PLAN.txt` | 2026-11-13 | Security-fixes plan; completed. |
| `THEME-PACK-PLAN.md` | 2026-11-13 | Theme pack shipped (8 skins). |
