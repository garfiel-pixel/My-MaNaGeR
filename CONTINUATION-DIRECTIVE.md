# My MaNaGeR - Continuation Directive (active, small)

**Read order for every session:** this file first, then `EXECUTION-PLAN.md` for the build order, then the newest `AUDIT-DIRECTIVE-*.md` (now `AUDIT-DIRECTIVE-2026-10-18.md`) plus `IMPROVEMENT-DIRECTIVE-2026-10-22.md` for open work orders. Do NOT open `docs/history/` unless a task cites it: the full history lives in `docs/history/CONTINUATION-DIRECTIVE-ARCHIVE-2026-10-18.md`, old status-log entries in `docs/history/log-YYYY-MM.md`, old reflections in `docs/history/reflection-ARCHIVE-2026-10-18.txt`.

**Size law (gate T8, `tools/verify-doc-size.cjs`):** this file, `AGENTS.md` and `CLAUDE.md` must stay at or under 40,960 bytes. New status entries go to `docs/history/log-YYYY-MM.md`; this file keeps only the newest entries and a one-line rollup of the rest. If the "newest entries" and the byte cap ever conflict, the byte cap wins (recorded in the log 2026-10-18).

---

## Status log (newest at top)

- **2026-10-30** - UI is the top priority (owner): landing improvement pass done (23/43), F1 tenant fence done (19/19, one real leak fixed), then the landing backlog to 43/43 and the CSS coverage number. Two same-day corrections: `qa-landing-ui` launched Playwright's bundled browser, which CI never downloads, so the wave went red on its own new CI step (now pins system Chrome, run `41155753538` 6/6 green), and the coverage tool never rendered the project workspace, so its 31.7% / 28.9% was really 11.8% / 9.7% (below the 15% trigger, so E6.2 deletion is demoted). Next: 1.6 CSS split, then C1 NocoBase. Phase B D-1 and D-4 were done earlier the same day. CI is six parallel jobs (24.4 to 7.6 min). Phase E (repo trim E0 to E5) done: 706 -> 601 tracked files, finished plans in `docs/history/`, `verify-sizes` in CI. F and G queued (see the reliability directive).

---

## LOCKED RULES (owner standing rules, non-negotiable; full set incl. N1-N10 in the audit file)

1. No emoji on any served page or JS string. SVG sprite icons only (`css/mmgr-icons.svg`).
2. No em dash (U+2014) and no en dash (U+2013) in any served copy. Commas, periods, "to".
3. Plain language on user faces. Labels, not paragraphs.
4. Consistency by reference: find the sibling already in the app and match it.
5. Gold is the brand accent (call it gold, not orange).
6. Liquid Glass hierarchy: glass for the functional layer only, never glass on glass; respect `prefers-reduced-motion` and `prefers-reduced-transparency`.
7. Commits are plain Conventional Commits. No AI attribution ever (enforced by the `.githooks/commit-msg` hook). Subject <= 72 chars, imperative, no emoji.
8. Every new feature ships its `mymanager-field-guide.html` entry in the SAME change.
9. `reflection.txt` is rewritten at the end of every session (specific: files, line numbers, verification results).
10. This file gets a STATUS LOG entry after every completed project; full entries go to `docs/history/log-YYYY-MM.md`.
11. Never create a review zip unless the owner asks.
12. Paddle keys and secrets are assumed set; never touch secrets.
13. Deploy only from a clean staging copy under `$HOME/mmgr-deploy` (never `/tmp`, never the repo root). Live probes use `https://mymanagerworkspace.com` only.
14. The owner removed pinned Calculate / Add to bill buttons (2026-10-13). Never re-pin them.
15. Part H decisions stand: Procurement ships behind `data-pack="procurement"`; `proc` is a grantable editor scope; namespace `ns.Proc`; state key `supplierBook`; supplier prices are hand-entered from each supplier's own rates, never from the JIC book.
16. OST offline-first is sacred: the app works with no network; cloud sync stays opt-in per project.
17. `npm run verify` (CSP + SW + all sub-checks) before every deploy; `node build.js` after any `js/` edit (stale `dist/bundle.js` is the #1 silent killer); bump the `sw.js` shell version when served files change and restart `serve.cjs` after inline-script edits.
18. `skills-lock.json` is the source of truth for skills; never hand-edit hashes.

## OPEN WORK REGISTRY (state as of 2026-10-24, every row re-checked against the code)

| # | Task | Status | Next |
|---|---|---|---|
| A | Close the OpenProject books | **DONE 2026-10-29** | Section 3 result; all gates green |
| B1 | **D-3** calculator listbox portal + containment gate | **DONE 2026-10-29** | Section B1 result; `qa-fixed-containment` 8/8, `qa-calc-controls` 94/94, audit 61/61, shortcuts 15/15, `npm run verify` green |
| B2 | **D-2** dictation echo and leading `null` | **DONE 2026-10-29** | Section B2 result; `qa-ai-dictation` 14/14, `qa-ai.cjs`, `qa-ai-win` 22/22, `npm run verify` green |
| B3 | **D-1** AI window, steps 1 to 7 | **DONE 2026-10-30** | `qa-ai-window-layout` 83/83, `qa-ai-win` 23/23, `qa-ai` PASS, `qa-fixed-containment` 10/10, axe, gold, `npm run verify` green |
| B4 | **D-4** CI split into five jobs | **DONE 2026-10-30** | Six jobs green, slowest 7.6 min (baseline 24.4); `verify-ci-coverage` 12/12 |
| E | Repo housekeeping E0 to E6 | **E0-E5 DONE, E6.1 DONE 2026-10-30** | 706 -> 601 tracked files; `_archive` + 42 shots untracked, guards kept; 5 finished plans in `docs/history/`; `verify-sizes` 9/9. E6.1 measured with `tools/measure-css-coverage.cjs`: 816/2,572 mmgr selectors (31.7%) and 152/526 marketing (28.9%) have no DOM or JS evidence, so E6.2 (deletion) and E6.3 (the split) are unlocked |
| 1.1 | UI improvement pass (landing) | **DONE 2026-10-30** | `qa-landing-ui` 8/43 -> 23/43; gold ramp, buttons, pills, header, rail, cards; sw v514 |
| 1.2 | UI backlog (U-02, U-07, U-08, U-09, U-10, U-12, U-13) | **NEXT** | `qa-landing-ui` to 43/43, then CI. Pause leaves the globe; Performance Mode is the 2.2.2 mechanism |
| 1.3 | **F1** cross-tenant isolation | **DONE 2026-10-30** | `qa-tenant-isolation` 19/19 in `cloud-auth`; found and fixed a `claim` existence oracle |
| 1.4-1.6 | E6 CSS coverage, dead rules, layered split | **1.4 DONE** (corrected 11.8% / 9.7%); **1.5 DEMOTED** (below the plan's 15% trigger); **1.6 NEXT** | The split into `css/src/*` layers, one commit per layer; `verify-css-integrity` proves every rule survives into `dist` |
| C1 | NocoBase custom task fields | **QUEUED** | Its DoD; schema v25 |
| C2 | Leantime idea intake + merged agenda | **QUEUED** | Its 16-gate harness; schema v26 |
| C3 | AppFlowy project book | **Needs drafting pass** | Four phases; schema v27 |
| C4 | Platform (workspace as shared workspace) | **QUEUED** | Its DoD; schema v28 |
| C5 | Plane (expense tracking) | **QUEUED** | Its DoD; schema v29 |
| F | Reliability evidence F1 to F5 | **F1 DONE 2026-10-30**; F2-F5 queued | `qa-tenant-isolation` 19/19 in `cloud-auth`, and it found a live existence oracle in `claim` (fixed). No published numbers until F2/F4 measure them |
| G | Market proof G1 to G4 | **OWNER** | G1 rate-book provenance decision unblocks the code half; G4 positioning copy |
| D | parked UI plans (post-launch refinement) | **UNPARKED 2026-10-30** | UI is the owner's top priority; U-02/U-07/U-08/U-09/U-10/U-12/U-13 landed, `qa-landing-ui` 43/43 and now a CI gate |