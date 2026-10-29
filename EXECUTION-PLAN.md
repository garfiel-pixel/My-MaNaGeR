# EXECUTION PLAN — My MaNaGeR

**Status date: 2026-10-29.** This file replaces `FINAL-EXECUTION-PLAN.md`,
`IMPLEMENTATION-PLAN.md`, `IMPLEMENTATION-REINFORCEMENT.md` and
`IMPLEMENTATION-STRATEGY.md`, which were removed on the owner's instruction:
they restated each other, their "critical blocking" item (commit authorship) was
resolved on 2026-10-29, parts of their text were corrupted, and their
parallel-multi-team sequencing does not describe this repo (one branch, one
agent — everything is sequential). The real specifications are the plans in
`the last update towrads maintainance mode/`.

---

## 1. Where the repo stands

- **CI: green.** Local `npm run verify` green; GitHub Actions green on the
  current history (116/116 steps, 0 failed, 0 skipped).
- **History: clean.** One author everywhere —
  `Garfield Fairclough <garfieldprocis@gmail.com>`; zero AI attribution
  footers (`Generated with …` / `Co-Authored-By …`) anywhere in history.
  The `.githooks/commit-msg` hook enforces Conventional Commits.
- **Schema:** `SCHEMA_VERSION = 23` (the Kanban mechanics wave took 23).
  **D1 migrations:** through `0029_team_enterprise.sql`.
- **Service worker:** `mmgr-shell-v500`.
- **Shipped recently:** Kanban board model, soft WIP limits, card ordering /
  keyboard moves / quick add; per-suite rate-limit client addresses for the
  cloud harnesses; `qa-full` lead-time gate re-baselined to the new
  same-column-reorder contract; sidebar scroll containment (owner 2026-10-29:
  wheeling past the sidebar's edge no longer drags the page).

## 2. Parked by the owner: the UI plans

`UI-FIXES-SPEC.md` (+ `qa-landing-ui.cjs`, 43-check gate) and `plan-ui.md`
are **parked**. The owner has reviewed the current UI against them and they do
not cover everything he wants; he will extend them later. Nothing from either
plan executes until the extended versions land. When they do:

- `UI-FIXES-SPEC` runs in its §14 wave order (0→6), one commit per wave,
  with its stated gate updates in the same commit that breaks them.
- `plan-ui.md` runs phases 1→4 and should land **before** the feature plans
  write new markup, so the type/spacing scale and panel header already exist
  for that markup to inherit. If it lands later, its phases 3–4 sweep
  whatever arrived in between.

## 3. Active track: the feature plans, one at a time

Order and reason:

| # | Plan | State of the plan | Notes |
|---|---|---|---|
| 1 | **plan-openproject.md** (relations + blocked-by lens) | code-complete: full module, model tests, browser harness | Smallest complete plan; proves the renumber/re-anchor workflow below. **IN PROGRESS.** |
| 2 | plan-nocobase.md (custom task fields) | code-complete, with an errata section | Must follow its own "Remaining work": build the Fields sheet on the existing house modal (not a bespoke overlay) and map its draft CSS to real tokens — the draft names four tokens that do not exist. |
| 3 | plan-leantime.md (idea intake + merged agenda) | code-complete, largest (~1900 new lines, 6 new files) | Two pure models, two renderers, one 16-gate harness. |
| 4 | plan-appflowy.md (project book) | prose-only, 4 phases | Needs a drafting pass to the task-by-task level before execution. |
| 5 | plan-platform.md (guarded transitions, audit, rules) | prose-only, 4 phases | Same drafting pass needed. |
| 6 | plan-plane.md (cycles, modules) | prose-only, 4 phases | Same drafting pass needed. |

### Rules of engagement (every plan, every task)

1. **Re-derive every anchor.** Plans were written against schema v22, SW
   cache v481 and old line numbers; the repo is at v500 with later waves
   (Kanban) having rewritten the same regions. The plan's *intent* is the
   contract; quoted line numbers are not. The OpenProject plan's
   `K.columnTasks` alternative branch is the live one — the Kanban wave landed.
2. **Migration numbering.** Every plan claims migration 23, already taken.
   The next plan takes **24** (`SCHEMA_VERSION` and the migration key move
   together), then 25, 26… One migration number per landing plan.
3. **One commit per task**, Conventional Commits, **no AI attribution lines**
   (hard gate), and stop at each plan checkpoint until the owner confirms.
4. **Build ritual per task:** `node build.js`, bump `sw.js` `CACHE`,
   `npm run verify`, plus the plan's explicit gates (`verify-actions`,
   `verify-render-exports`, model tests, the new harness).
5. **Regenerate CSP hashes** whenever an inline script block changes
   (`node tools/regen-csp-hashes.cjs`, commit `worker.js` + `serve.cjs`).
6. **New harness = three places:** harness file, registry row in
   `docs/CI-TEST-COVERAGE.md` with a status token, and the CI workflow step.
7. **Read-only stays read-only:** mutating actions out of
   `READONLY_SAFE_ACTIONS`; `guardReadonly()` covers them.

### Known cross-plan collisions (re-anchor, don't paste)

- OpenProject and NocoBase both insert their sheet "after the Kanban panel",
  both add a badge at the same WBS name-cell anchor, both add handlers beside
  `tglLeadtimeLane`, and both add `relations` / `custom` to the same
  `addTask()` push object.
- Leantime adds the `Intake` nav group between `Plan` and `Collaborate` and
  also touches `addTask()` / `delTask()`.
- Whichever lands second re-derives its anchors against the first and
  renumbers its migration.

## 4. Definition of done for this plan file

- The active plan's tasks are checked off here as they land.
- CI stays green after every push (poll the Actions run — a green local run
  is not the truth; the remote run is).

## 5. Progress log

- **2026-10-29** — Repo stabilized: attribution + footer history rewrite
  (CI green), wrapper docs replaced by this file, sidebar scroll containment
  shipped (`9ccbf72`).
- **Next:** plan-openproject Task 1 (relation model, migration 24).
