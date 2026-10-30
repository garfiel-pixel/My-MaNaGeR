# My MaNaGeR - Continuation Directive (active, small)

**Read order for every session:** this file first, then `EXECUTION-PLAN.md` for the build order, then the newest `AUDIT-DIRECTIVE-*.md` (now `AUDIT-DIRECTIVE-2026-10-18.md`) plus `IMPROVEMENT-DIRECTIVE-2026-10-22.md` for open work orders. Do NOT open `docs/history/` unless a task cites it: the full history lives in `docs/history/CONTINUATION-DIRECTIVE-ARCHIVE-2026-10-18.md`, old status-log entries in `docs/history/log-YYYY-MM.md`, old reflections in `docs/history/reflection-ARCHIVE-2026-10-18.txt`.

**Size law (gate T8, `tools/verify-doc-size.cjs`):** this file, `AGENTS.md` and `CLAUDE.md` must stay at or under 40,960 bytes. New status entries go to `docs/history/log-YYYY-MM.md`; this file keeps only the newest entries and a one-line rollup of the rest. If the "newest entries" and the byte cap ever conflict, the byte cap wins (recorded in the log 2026-10-18).

---

## Status log (newest at top)

- **2026-10-29** - Phase A closed, then D-3, D-2 done. D-1 pending.

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
| B3 | **D-1** AI window, steps 1 to 7 | **NEXT** | `qa-ai-window-layout` matrix; `qa-ai-win` re-baseline; axe; gold; `npm run verify` |
| B4 | **D-4** CI from about 25 minutes to about 6-8 | **QUEUED** | Measure first (section 4.0), then split into 5 jobs |
| C1 | NocoBase custom task fields | **QUEUED** | Its DoD; schema v25 |
| C2 | Leantime idea intake + merged agenda | **QUEUED** | Its 16-gate harness; schema v26 |
| C3 | AppFlowy project book | **Needs drafting pass** | Four phases; schema v27 |
| C4 | Platform (workspace as shared workspace) | **QUEUED** | Its DoD; schema v28 |
| C5 | Plane (expense tracking) | **QUEUED** | Its DoD; schema v29 |
| D | parked UI plans (post-launch refinement) | **QUEUED** | No current owner-provided spec |