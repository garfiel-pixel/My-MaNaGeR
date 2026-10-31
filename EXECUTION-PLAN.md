# EXECUTION PLAN - My MaNaGeR

**Status date: 2026-10-29 (aligned).** This file is the single build order for
the maintenance-mode build-out. It replaces the stale sequencing in its own
earlier version and the stale "NEXT SESSION" block in
`CONTINUATION-DIRECTIVE.md`.

## 0. Sources and authority

Read in this order:

1. `CONTINUATION-DIRECTIVE.md` - locked rules and owner standing rules.
2. **This file** - what runs, in what order, with which gates.
3. `adittion to scope/UI-CI-DIRECTIVE.md` (v2) - task detail for D-3, D-2, D-1, D-4.
4. `adittion to scope/REPO-RELIABILITY-DIRECTIVE-2026-10-30.md` - repo trim
   (E), reliability evidence (F), market proof (G). Verified 2026-10-30.
5. `the last update towrads maintainance mode/plan-*.md` - task detail for the
   five feature plans.
6. The code - when an anchor has drifted, the code wins; re-derive by selector
   or function name and record the drift in the log.
7. `AUDIT-DIRECTIVE-2026-10-18.md` and `IMPROVEMENT-DIRECTIVE-2026-10-22.md` -
   open audit rows only after a state check proves the row is still open.

**Un-parked 2026-10-30 (owner: UI is the top priority):** `UI-FIXES-SPEC.md`,
`plan-ui.md` and `qa-landing-ui.cjs` are live again. The spec's U-02 to U-14
items landed in Wave 1.1/1.2, and `qa-landing-ui` is now a CI step in
`browser-app` (43/43). `plan-ui.md`'s type/spacing scale still waits for the
`tokens` layer in phase 1.6.

**Never stage:** `adittion to scope/`, `the last update towrads maintainance
mode/`, `AUTHORS-FIX-ISSUE.md` (stale: history is already clean; one author
everywhere), and `.githooks/pre-commit` unless the task is the hook itself.

## 1. Where the repo stands

Verified 2026-10-29 at HEAD `9d703e0`:

| Fact | Value |
|---|---|
| CI | Green; run `40948194942` on `9d703e0` is 117/117 steps, 0 failed, 0 skipped. `ci.yml` is 871 lines, one `verify` job, 111 named steps (116 in the GitHub UI), 84 `id:` fields, 24 wrangler-start gates |
| Client schema | `SCHEMA_VERSION = 24` (`js/mmgr-state.js`) |
| D1 migrations | Through `0029_team_enterprise.sql` |
| Service worker | `mmgr-shell-v504` |
| OpenProject plan | **Landed**: `4323f91` model, `0b56f69` badges/sheet, `fddfd69` blocked-by lens, `24b44ff` browser gate + registry + CI |
| New harnesses from the scope addition | None yet: `qa-fixed-containment`, `qa-ai-dictation`, `qa-ai-window-layout`, `verify-ci-coverage` |
| Untracked, owner files | `adittion to scope/`, `the last update towrads maintainance mode/`, `AUTHORS-FIX-ISSUE.md` |

OpenProject is code-complete but its untracked spec still shows unticked
Definition of Done boxes. Phase A below closes that book with evidence; it is
not new feature work.

## 2. The queue, by wave and phase

One order. Each row is a shippable phase with its own gate, so a session that
stops mid-wave leaves the next one an exact position. **Position: Wave 1,
phases 1.1 to 1.4 done; 1.6 (the CSS split into `css/src/*` layers) is next.
1.5 (dead-rule removal) was demoted when the corrected measurement came in at
11.8% / 9.7%, below the 15% trigger this plan set.** UI is the owner's top priority
(2026-10-30) and leads the wave; the wave's other purpose is to freeze the
ground every later plan builds on (the tenant fence, then the stylesheet split).

### 1.7 - Owner UI audit batch: S1-S3 DONE 2026-10-31, S4-S7 open

Twelve findings from the owner's live walk. No commit has touched any of them:
`JIC rate book` is still user-facing in `js/calculator-page.js` and
`calculator.html`, the admin header still carries `.escrow-badge` pills,
`.hdr-back` still has box chrome, and `.card-title > div` has no gap.

**S1 (quiet chrome), S2 (the rate book's name plus a zero-occurrence gate) and
S3 (toolbar gaps, dot states) shipped 2026-10-31: `qa-chrome` 82/82,
`qa-toolbar-spacing` 12/12, `verify-ratebook-wording` 12/12, shell v517. S4
(theme/perf coupling), S5 (cloud refresh), S6 (assistant float) and S7
(enterprise diagnostic) are still open.**

**The order, the scope, the gate and the verified/disproved claims live in
[`docs/SPRINTS.md`](docs/SPRINTS.md).** It supersedes the untracked
`IMPLEMENTATION-PLAN-2026-10-30.md`, `FINAL-IMPLEMENTATION-PLAN.md` and
`TOOLS-CHECKLIST.md`, which were written without reading the code (they call a
shipped, gated team panel "missing", cite `mmgr-ai.js:4284` as proof of a float
bug when it is the pin sync, and call a `saveFloatState()` that does not exist).

### Wave 1 - ground and gates (in progress)

| # | Phase | Status | Gate / evidence |
|---|---|---|---|
| 1.1 | **UI improvement pass**, landing first (gold ramp, one button language, no pills, header scroll state, dot-rail tone, card art/icons) | **DONE 2026-10-30** | `qa-landing-ui` **8/43 -> 23/43**; `qa-dot-rail` 15/15 with the raised rest-opacity threshold; `verify-gold` green; `npm run verify` green; sw v514 |
| 1.2 | **UI backlog, landing** - the seven deferred items: U-02 icon pack + manifest + og, U-07 grouped dropdown, U-08 delete fallback hero cards, U-09 globe hover/spin fix, U-10 remove on-globe Pause (page-wide Performance Mode is the WCAG 2.2.2 mechanism), U-12 bento grid, U-13 phase rail | **DONE 2026-10-30** | `qa-landing-ui` **23/43 -> 43/43**, now a CI step (`browser-app`). Re-baselined in the same commit: `qa-hero-globe` G5/G8 (no widget control; the footer switch stops the globe), `qa-globe-spin` (switch arm, reduced-motion arm), `qa-scurve` (dead hero-card arms replaced), `qa-hero-cards` **retired** (it tested cards that no longer exist). `verify-gold` green (one real regression caught: the dark pop-out label at 2.82:1). Surprise pass: the two bento hero panels carry the accent surface |
| 1.3 | **F1 cross-tenant isolation** | **DONE 2026-10-30** | `qa-tenant-isolation` **19/19** in the `cloud-auth` job. Found and fixed a live existence oracle in `claim` |
| 1.4 | **E6.1 CSS coverage measurement** | **DONE 2026-10-30, corrected the same day** | `tools/measure-css-coverage.cjs` (MANUAL, read-only): **303 / 2,572 class-id selectors in `css/mmgr.css` (11.8%)** and **51 / 526 in `css/marketing.css` (9.7%)** carry no evidence in the rendered DOM of 16 pages plus the unlocked project workspace, or in `js/`. **The first number was 31.7% / 28.9% and was wrong**: the tool loaded `project.html` with no project id, so it 307'd to `app.html?locked=default` and the whole workspace contributed nothing, and it measured only `index.html` of the 13 pages that link `marketing.css`. It now unlocks the workspace, measures every marketing page, reports any page that fails or redirects, and exits non-zero when incomplete (teeth proven: 31.6% returns with the unlock removed). DevTools `startRuleUsageTracking` was rejected as the metric: it reported 319 rules for a 3,139-block file |
| 1.5 | **E6.2 dead-rule removal** | **DEMOTED 2026-10-30: below the 15% trigger, not a wave of its own** | The plan's own rule was "above 15% unlocks deletion". The honest measurement is 11.8% / 9.7%, so there is no 300-selector purge to run. The remaining candidates are states only reached by clicking (modals, drawers, tabs) that no load-time render proves, and a deletion pass would be guesswork. Take them opportunistically: any rule a later change proves dead goes in that change, with `verify-css-integrity` + `qa-health-sweep` + the visual gates |
| 1.6 | **E6.3 CSS split** into `css/src/*` layers (tokens, shell, panels, tables, calculator, ai, print) bundled by `build.js`; the type/spacing/breakpoint tokens land here as the `tokens` layer | **NEXT** | `verify-css-integrity` proves every source rule survives into `dist`; `verify-sizes`; one commit per layer |

### Wave 2 - feature plans (schema order is the contract)

| # | Phase | Status | Gate / evidence |
|---|---|---|---|
| 2.1 | **C1 NocoBase** custom task fields, schema v25 | Queued | Its DoD; write JSDoc on the new fields as they land |
| 2.2 | **E7 `checkJs`** on state, cloud, billing | Queued - immediately after 2.1 | `npm run typecheck` in `static`; no silencer casts |
| 2.3 | **C2 Leantime** idea intake + merged agenda, v26 | Queued - **split at its own phase boundary first** (4,634 lines, 60 tasks) | Its 16-gate harness |
| 2.4 | **C4 Platform** guarded transitions, audit, rules, v28 | Queued after 2.3 | Its DoD |
| 2.5 | **C3 AppFlowy** project book, v27 | Needs drafting pass, then build | Drafting pass first: anchors from code, task-level steps, gates |
| 2.6 | **C5 Plane** cycles and modules, v29 | Needs drafting pass, then build | Same |

### Wave 3 - evidence, then customers

| # | Phase | Status | Gate / evidence |
|---|---|---|---|
| 3.1 | **F2 load test** (local wrangler + D1 first, staging later) | Queued | p50/p95/p99 per scenario committed under `load/results/` |
| 3.2 | **F4 D1 backup restore drill** | Queued - before any pilot | `docs/RESTORE-DRILL-*.md`, timed, owner access |
| 3.3 | **F5 targets + incident log** | Queued (targets may be written now; no published number before 3.1/3.2) | `docs/RELIABILITY-TARGETS.md`, `docs/INCIDENTS.md` |
| 3.4 | **G3 activation/retention/tickets + feedback button** | Queued after 2.1 (schema collision) | In-app surface reusing the notice pattern |
| 3.5 | **G1 provenance decision, then G4 currency/market copy** | **Owner** | G4 currently blocked: `JMD`, `J$`, `Jamaica` appear zero times on index/pricing/features |
| 3.6 | **G2 pilots** (5-10 contractors) | **Owner**, last | Only after 1.3, 3.2 and the deploy |

### Closed

| # | Phase | Closed | Evidence |
|---|---|---|---|
| A | Close the OpenProject books | 2026-10-29 | all gates green |
| B1 | D-3 calculator listbox portal | 2026-10-29 | `qa-fixed-containment` 8/8 |
| B2 | D-2 dictation echo + leading `null` | 2026-10-29 | `qa-ai-dictation` 14/14 |
| B3 | D-1 AI window | 2026-10-30 | `qa-ai-window-layout` 83/83 |
| B4 | D-4 CI split | 2026-10-30 | six jobs, slowest 7.6 min |
| B5 | Phase B close: deploy + live probe | 2026-10-30 | version `cb60a457`, sw v513 live, `/project` 200 |
| E | E0-E5 repo housekeeping | 2026-10-30 | 706 -> 601 tracked files; `verify-sizes` 9/9 |
| D | Parked UI plans | **UNPARKED 2026-10-30** - UI is now top priority | Absorbed into 1.1 / 1.2 |

### Why this order

1. **D-3 before D-1.** D-3 fixes a real defect and installs the permanent
   fixed-descendant containment gate. D-1 adds `container-type: inline-size`
   to `.ai-main`, which creates the same containing-block condition; the gate
   must already exist before that lands.
2. **D-2 before D-1.** Dictation is a small independent fix in the same window.
   Fix its base behaviour before the composer card is rebuilt around it.
3. **D-1 before the feature plans.** The AI window is the one shared surface
   the feature plans do not touch. Stabilise it first, then no later plan has
   to re-derive its markup.
4. **D-4 before the feature plans.** The split turns a 24-minute feedback loop
   into a 6 to 8 minute one for every remaining plan. It must run after D-1 so
   the three new browser harnesses are placed by the split, not appended to it.
5. **Code-complete plans before prose plans.** NocoBase and Leantime already
   carry task-level steps; AppFlowy, Platform and Plane need a drafting pass
   first. NocoBase runs before Leantime because both touch `addTask()`,
   `delTask()`, `project.html` and the nav, and the smaller complete plan goes
   first so the larger one re-derives against a landed baseline.
6. **Parked UI last.** `plan-ui.md` should ideally land before new markup, but
   the owner has parked it. It now sweeps later. Recorded, not re-litigated.

### Open audit rows are not a second queue

`CONTINUATION-DIRECTIVE.md`'s Open Work Registry still lists items that are not
part of this build order: C6/C7, X-1/X-2/X-4, G4, M-3/M-4/M-6, S-6, the
architecture survey, T-8's remaining order-sensitivity, and the
`IMPROVEMENT-DIRECTIVE-2026-10-22` waves. They are state-check rows, not plans.

- Do not start one mid-plan.
- At each phase boundary, state-check the row against the code. A row that is
  already fixed is closed with evidence; a row that blocks a queued plan jumps
  the queue with its own exit gate.
- A row the owner wants promoted gets a named place in section 2 first.
- `PART I Phase 3` and the Dashboard F1 double-system suggestion stay parked by
  owner decision; do not reopen them without a new owner instruction.

---

## 3. Phase A - close the OpenProject books

The code is already in `4323f91..24b44ff`, with `109760c` and `9d703e0` as
test follow-ups. Do this before starting D-3:

1. Run the plan's own gates: `node --test test/relations-model.test.mjs`,
   `node tools/qa-relations.cjs` (against `node serve.cjs`), `npm run verify`,
   `node tools/verify-actions.cjs`, `node tools/verify-render-exports.cjs`.
2. Walk the plan's section 5 Definition of Done list: badges on WBS and card,
   remove from either side removes both, `Blocked only` / `Ready only` lens,
   blocked move warning, view-only refusal, reload persistence, developer
   guide row, field-guide card.
3. Poll the Actions API for the run on `9d703e0`. A green local run is not the
   truth; the remote run is.
4. Record the result in section 10 here. If a gate fails, fix it under
   OpenProject before touching D-3; do not carry a red gate forward.
5. No commit unless a real fix is needed. The close is a record, not churn.

Exit: every DoD line has evidence, or a named blocker.

**Result (2026-10-29): CLOSED.** Evidence:

| DoD line | Evidence |
|---|---|
| Relation model tests | `node --test test/relations-model.test.mjs` 12/12 |
| Browser gate | `node tools/qa-relations.cjs` 9/9 (the missing removal and view-only-remove arms were added to the harness while closing this book) |
| Full battery | `npm run verify` exit 0: 171/171 unit tests, registry 145/145, all static gates green |
| Action + export contracts | `verify-actions` and `verify-render-exports` green |
| Badge on WBS and Kanban | qa-relations checks 2 and 3 |
| Remove from either side removes both | qa-relations check 8 plus the model test's symmetric remove |
| Blocked only / Ready only | qa-relations check 4 |
| Blocked move warns and still moves | qa-relations check 5 |
| View-only can open, cannot add or remove | qa-relations check 7 |
| Reload keeps relation and lens | qa-relations check 6 |
| Developer guide + field guide | `docs/DEVELOPER-GUIDE.md` row and `mymanager-field-guide.html` "Task links" card present |
| Remote CI | Run `40948194942` on `9d703e0`: 117/117 steps, 0 failed, 0 skipped |

No app code changed. The harness gained two browser arms (removal, view-only
removal) so the DoD is gated rather than inspected.

---

## 4. Phase B - the scope addition (D-3, D-2, D-1, D-4)

Read `adittion to scope/UI-CI-DIRECTIVE.md` before each task. Its anchors were
verified at `9d703e0`; the code has not moved since. If it moves, re-derive by
selector and log the drift. The directive's section 2 build ritual, git
hygiene, three-edit harness rule and CI repair loop all apply.

### B1. D-3 - calculator dropdowns detach and scroll with the page

The cause is real and confirmed: `.card { contain: layout paint }`
(`css/mmgr.css:2075`), `.mmcb-pop { position: fixed }` (`:17970`), and
`wrap.appendChild(pop)` (`js/mmgr-combobox.js:128`). The card becomes the
containing block for the fixed popup.

Land exactly the directive's section 3.2 changes:

- Portal the popup to `document.body`; put `data-for` on the popup as well as
  the wrapper; make outside-click test both trees.
- Add the `requestAnimationFrame` tracker, `visualViewport` listeners, the
  8 px horizontal clamp, and the orphan cleanup.
- Keep every existing id: `aria-controls`, `aria-labelledby`,
  `mmcb-list-<uid>`, `.mmcb-input`.
- Bump `js/mmgr-combobox.js?v=1` to `?v=2` in `calculator.html:963`; bump the
  `sw.js` cache.
- Do **not** use `.card:has(.mmcb) { contain: none }`; it restores the cost the
  X-2 change removed.

New gate `tools/qa-fixed-containment.cjs` plus
`tools/fixed-containment-allow.json` (empty unless an offender is proven
intentional, one-line reason each). It loads `calculator.html`, `project.html`
and `app.html`, opens the AI window and the calculator lists where applicable,
walks every `position: fixed` element, and fails on a `contain:
layout|paint`, `transform`, `filter`, `backdrop-filter`, `perspective`,
`container-type` or `will-change` ancestor that is not allow-listed.

Same-commit harness updates: `qa-calc-controls` lines 310, 317, 410, 419 and
`qa-calc-playwright-audit` line 115 move from the wrapper-child selector to
`document.querySelector('.mmcb-pop[data-for="calc-work"]')` (same for
`calc-family`). Verify `qa-shortcuts` still passes; change nothing unless it
fails. The existing 63 checks stay green.

Placement note: the directive's section 3.3 says to put the new harness in the
`browser-app` group, while its D4.2 table puts `qa-fixed-containment` in
`browser-calc`. Follow D4.2, the later and more specific instruction, because
both calculator pages live there. Record the discrepancy in the log rather than
silently choosing.

Commit: `fix(calc): portal the listbox out of the contained card`.
Deploy is not required per task; Phase B deploys once at the end.

**Result (2026-10-29): DONE.** Evidence:

| Gate | Result |
|---|---|
| `node tools/qa-fixed-containment.cjs` | 8/8, allowlist empty (no offender exists) |
| `node tools/qa-calc-controls.cjs` | 94/94 (31 new UI-5 gates: mount, geometry, 4 viewports x 2 pickers, frame lock, orphan, dark tokens) |
| `node tools/qa-calc-playwright-audit.cjs` | 61/61 |
| `node tools/qa-shortcuts.cjs` | 15/15 (its option wait moved to the portal selector; it did fail on the old one) |
| `npm run verify` | exit 0, 171 unit tests, registry 146/146 |
| Teeth | reverting the portal into the card turns `qa-fixed-containment` red with `div.mmcb-pop in section#calc-input-card.card (contain: layout paint)` |

Two additions beyond the directive's letter, both recorded: the frame loop
also stops when the popup or wrapper leaves the document (the orphan sweep
removes the node, and a loop still writing to a detached node would spin
forever), and removing a control now detaches the portal's document/window
listeners as well. The gate group follows D4.2 (`browser-calc`); the D4.2
table and section 3.3 disagree, and D4.2 is the later, more specific rule.

### B2. D-2 - voice dictation echoes and starts with `null`

Confirmed: `rec.onresult` at `js/mmgr-voice.js:1549` builds `q.value` from the
interim text already in the field, and `_aiBase` is `null` until the first
final result (`:1609`, declared `:1618`). The mic tooltip at
`project.html:1614` also lies about Whisper.

Land the directive's section 4.2 changes:

- Add `aiJoin(a, b)`; commit final chunks into `_aiBase`; render
  `aiJoin(_aiBase, interim)`; never concatenate `null`.
- One named `aiOnType` listener, added at start and removed in
  `stopAiDictation()`; the synthetic input event is untrusted and must not
  overwrite the base.
- De-duplicate an identical final within 1 second.
- Tooltip becomes `Voice input (browser speech recognition)`.

New gate `tools/qa-ai-dictation.cjs` with the directive's nine checks: interim
then final, no `null`, pre-typed prefix, mid-dictation typing, `onend` restart,
final without interim, duplicate final, tooltip text, and a net-zero listener
count after stop. Stub `webkitSpeechRecognition` before page scripts; click the
real `#ai-voice-btn`; assert on `#ai-q`.

Gate: new harness green, `qa-ai.cjs` and `qa-ai-win` 22/22.
Commit: `fix(ai): stop dictation echo and the leading null`.

**Result (2026-10-29): DONE.** Evidence:

| Gate | Result |
|---|---|
| `node tools/qa-ai-dictation.cjs` | 14/14 (the nine contract checks plus five no-page-error gates) |
| `node qa-ai.cjs` | PASS (AI23_GATE) |
| `node tools/qa-ai-win.cjs` | PASS 22/22 |
| Teeth | restoring `q.value + chunk` reproduces the echo (`it's echoing it's echoing`) and fails gate 1; restoring `_aiBase = null` fails the typed-prefix gate |
| `npm run verify` | exit 0 |

One addition beyond the directive's letter, recorded: `aiJoin` coerces its base,
so a `null` base can never be stringified even if a future call site forgets to
seed it. The typing listener is also removed when `rec.start()` throws, so a
failed start cannot leave it attached.

### B3. D-1 - AI window fits any width, one slim header, one composer card

Precondition: B1 and B2 committed, CI green. Read the directive's section 5
and the mockup in the same folder. The mockup is a visual reference only:

- It uses Tabler icons and hardcoded hex colours. This app uses the SVG sprite
  (`css/mmgr-icons.svg#i-*`) and existing gold tokens only. No new colour
  variables, no icon font.
- Read the real preset list from `mmgr-ai.js` `open()`; do not copy the
  mockup's labels.
- No em dash or en dash in any new string.

The directive's must-not-change list is a hard gate: every existing id and
`data-action` stays (`ai-win`, `ai-q`, `ai-send`, `ai-send-wrap`, `ai-tier`,
`ai-voice-btn`, `ai-hist`, `ai-hist-btn`, `ai-max-btn`, `ai-pin-btn`,
`ai-engine-pill`, `ai-api-pill`, `ai-api-pill-label`, `ai-cfg-cloud`,
`ai-byo-*`, `ai-welcome`, `ai-quick-presets`, `ai-presets`, `ai-seg-*`,
`ai-pane-*`, `ai-ctx`, `ai-out`, `ai-trace`). Docking regimes, resize strip,
`Ctrl+.`, history in project state, Enter/Shift+Enter all stay.

Seven steps, one commit each:

1. **History threshold.** `AI_HIST_INLINE_MIN` 480 to 720. Re-baseline the one
   `qa-ai-win` check into two: at 520 the History button is visible and
   `hist-inline` is false; at 760 or Maximise it is true and `#ai-hist` is
   visible. If the owner answers Q2 "keep 480", skip this step and delete the
   re-baseline.
2. **Slim header.** One row, at most 56 px: sparkle, title, status dot; New,
   History, Maximise, More, Close as 32x32 icon buttons. `#ai-api-pill`
   becomes the dot; keep `#ai-api-pill-label` visually hidden and mirror its
   text to title and aria-label. Move the engine pill into the More menu.
   Add `#ai-more-btn` / `aiMoreToggle` to `ACTION_MAP`; menu is `absolute`,
   `role="menu"`, Esc returns focus, arrows move. Move Float into the menu in
   `setupFloatSurface`. Radii move to `var(--radius-control)`.
3. **Connection row only when needed.** One dismissible banner when the tier
   is Cloud and the key is not connected; extend the existing `syncSettingsUI`
   `is-hide` condition; do not add a second mechanism.
4. **Composer card.** One card: `#ai-q` on top, `.ai-composer-tools` below
   with `#ai-tier`, `#ai-voice-btn`, send at the right edge. Auto-grow cap
   120 to 160 px. Send right edge at least 8 px inside the window.
5. **Empty state.** Centred mark, "What are we working on?", four full-width
   rows generated from the same four presets as `#ai-quick-presets`. Clicking
   a row does what the chip does. First message hides the welcome block and
   the chip strip; the Presets tab stays.
6. **"What the assistant can see".** Keep the `<details>`; restyle as one
   collapsed line under the composer; contents unchanged.
7. **Thread and responsive tiers.** `container: aiwin / inline-size` on
   `.ai-main`; compact under 440, regular 440 to 599, wide 600 and up. No
   `position: fixed` descendant inside `.ai-main`; the More menu and the key
   popover are `absolute`. D-3's gate is the permanent check.

New gate `tools/qa-ai-window-layout.cjs`: sheet 360/420/480; docked at 1440
with 480/520/658/900; Max at 1900; light and dark. Assert no horizontal
overflow, header at most 56 px and one row, composer proportions, no radius
99 px or more outside avatar/status, `hist-inline` only at 720+, accessible
names and Tab order, welcome block present/absent, Esc focus return. Save the
directive's screenshot set (360, 420, 480, 520, 900, 1400, light and dark)
under `tmp/ai-layout/`, do not commit them.

Same-commit harness updates: `qa-ai-win` history check;
`tools/qa-ai-polish.cjs` 139-149 container names (stay TRIAGE); note
`qa-ai.cjs:792` keeps passing because the ids remain. Update the field guide
text that describes the removed pills or the old header. Run `qa-ai`,
`qa-ai-win`, `qa-ai-relay`, `qa-ai-badge-e2e`, `qa-a11y-axe`, `verify:gold`,
`audit-action-map`, the action contract gate, and `npm run verify`.

Commits: one per step, `feat(ai): ...`; fixes as `fix(ai): ...`.

**Result (2026-10-30): DONE.** Evidence:

| Gate | Result |
|---|---|
| `node tools/qa-ai-window-layout.cjs` | 83/83 (sheet 360/420/480, docked 480/520/658/900, Maximise 1900, light and dark; screenshots in `tmp/ai-layout/`) |
| `node tools/qa-ai-win.cjs` | 23/23 (the old single history check replaced by two) |
| `node qa-ai.cjs` | PASS (AI23_GATE) |
| `node tools/qa-ai-dictation.cjs` | 14/14 |
| `node tools/qa-fixed-containment.cjs` | 10/10 (the More menu and the key popover are scanned open) |
| `node tools/qa-ai-relay.cjs`, `qa-ai-badge-e2e` | RELAY_GATE PASS, API phase 5/5 |
| `node tools/qa-a11y-axe.cjs` | 7/7 |
| `npm run verify:gold` | all checks passed |
| `audit-action-map`, `verify-actions` | no missing handler; T-2 ACTION CONTRACT PASS |
| `npm run verify` | exit 0, registry 148/148 |

Commits, one per coherent step: `feb6a5f` threshold, `15e8108` header + banner,
`76bc5a8` composer + empty state, `e71716b` context row, `cd4341e` container
tiers, `3cf1d3f` the two defects the gate found, `eb9e7d8` the gate itself.

Drift and additions to the directive's letter, all recorded:

1. **Steps 2 and 3 share `15e8108`**, and **4 and 5 share `76bc5a8`**. The
   banner is part of the same header block and the same sync function, and the
   empty state is rendered by the same preset builder as the composer chips;
   splitting them would have meant committing a half-wired intermediate state.
2. **`AI_W_MAX` is 720**, so the directive's "docked at 900" lands at 720. That
   is also exactly the new inline-history threshold, so the 900 case proves the
   boundary. The gate asserts `hist-inline` is true exactly when the window is
   720 or wider.
3. **The radius check forced nine radii changes**, not the three the directive
   named: `.ai-pill`, `.ai-clear-btn`, `.ai-tier-badge`, `.ai-seg-btn`,
   `.ai-copy-btn`, `.ai-chip`, `.ai-send`, `.ai-hist-new`, `.ai-byo-gear` and
   `.ai-byo-status` all moved from 100px to `var(--radius-control)`. Without
   that, a document-wide "no pill radius" gate could never be green.
4. **Two real defects surfaced while building the gate** (fixed in `3cf1d3f`):
   the workspace's document Escape handler (`mmgr-app.js`) closes the assistant,
   so one Esc in the More menu closed the menu AND the window; the assistant's
   inner layers now `stopImmediatePropagation`. And the generic `.mb` modal cap
   (`max-height: 82vh`) clamped the drawer, leaving a dead page-coloured strip
   under the composer at every width; `#ai-win .mb` now clears it. The gate
   measures both (`boxGap <= 1`, Esc focus return).
5. **The key popover is absolute** and inset 12px inside the banner, so it can
   never leave the window; the More menu is absolute inside the header.
6. **The engine pill kept its id** and now lives in the More menu as a
   read-only row; `#ai-api-pill` became a 10px dot button, still click-to-check,
   with `#ai-api-pill-label` visually hidden and mirrored to `title` and
   `aria-label`, so `qa-ai` A16 keeps passing unchanged.

### B4. D-4 - CI from about 25 minutes to about 6 to 8

Run only after B1 to B3 are committed. Follow the directive's section 6.

1. **Measure first (D4.0).** Pull the latest green run and its jobs from the
   Actions API, record every step with `started_at` and `completed_at` in
   `tmp/ci-baseline.md`. If the measurements differ from the directive's
   estimate by more than 25 percent, rebuild the split from the measurements
   and say so in the log.
2. **Split into five jobs.** `static`, `cloud-core`, `cloud-auth`,
   `browser-calc`, `browser-app`, per the directive's table, with a final
   `summary` job using `needs` and `if: always()`. Move the new harnesses with
   the split: `qa-fixed-containment` in `browser-calc`,
   `qa-ai-dictation` and `qa-ai-window-layout` in `browser-app`,
   `verify-ci-coverage` in `static`.
3. **Classify every T2 step mechanically** by grepping its harness and env for
   `8787`, `WRANGLER_DEV_URL`, `QA_BASE` and wrangler spawns. Steps that need
   the shared wrangler stay with it; steps that spawn their own on a unique
   port can move, but their `if: steps.wrangler-start.outcome == 'success'`
   proxy must be removed if that id is not in the same job. Keep the restart
   boundary and `Controls admin` together. Keep each suite's rate-limit client
   address and `.dev.vars` write.
4. **Prove it.** New `tools/verify-ci-coverage.cjs`: the `run:` multiset equals
   the old workflow modulo the per-job setup lines; every
   `steps.<id>.outcome` reference points to an id in the same job; all 36
   `T4:` steps still exist. Add `yaml` as a devDependency only if no YAML
   parser is already present.
5. **Branch route (Q1 default).** Direct pushes to `main` for B1 to B3; D-4 on
   `ci-split`, widen the trigger in the first branch commit, remove it before
   merging, fast-forward `main`. No force push, no `reset --hard`.
6. **Close.** Live run shows every step executed, zero skipped; slowest job at
   most 8 minutes; summary populated. Update `AGENTS.md` section 8 and
   `docs/CI-TEST-COVERAGE.md` for five jobs, under the 40,960-byte cap.

Commit style: `ci: ...`, one commit per coherent step, explicit paths.
No service-worker bump: `.github/`, `tools/` and `docs/` are not served assets.

**Result (2026-10-30): DONE.** Evidence:

| Gate | Result |
|---|---|
| `node tools/verify-ci-coverage.cjs` | 12/12 (and teeth: deleting `qa-shortcuts` fails it by name) |
| Run `41014918383` on `3bd9325` (first split) | 6/6 jobs green, 0 failed, 0 skipped |
| Run `41015996950` on `1d60df7` (rebalanced) | 6/6 jobs green, 0 failed, 0 skipped |
| Slowest job | 457s (7.6 min) `cloud-core`; then 437s app, 383s calc, 379s auth, 53s static |
| Baseline to beat | 24.4 min single job, 1531 step-seconds |
| Summary job | `needs` all five, `if: always()`, one row per job |

Measured baseline (`tmp/ci-baseline.md`, not committed): 24.4 min wall clock,
T2 770s, T4 630s, T3 67s, static 64s; Team RBAC alone 256s.

The split: `static` (53s), `cloud-core` (shared :8787, 7.6 min), `cloud-auth`
(its own :8787, 6.3 min), `browser-calc` (own `serve.cjs`, 6.4 min),
`browser-app` (own `serve.cjs`, 7.3 min), `summary`.

Notes and additions:

1. **`yaml` added as a devDependency** (it was the only way to parse both
   workflows in `verify-ci-coverage`, and nothing in the tree could).
2. **Team RBAC moved to `cloud-core`** and **Sync bond to `browser-calc`**
   after the first measured run (cloud-auth was 8.2 min). The rebalanced run
   puts every job under 8 minutes.
3. **The two browser jobs each start and stop their own `serve.cjs`** and each
   run the `install test deps` step; the coverage gate allowlists exactly those
   three repeated step names. `cloud-core` and `cloud-auth` each own a
   `wrangler-start` (auth needs it for the restart + Controls admin pair).
4. **The old single CI Summary block was replaced**, not preserved: the
   summary job reads `needs.<job>.result`, and each job writes its own status
   row to `$GITHUB_STEP_SUMMARY`, so per-step detail stays on each job page.
5. **`docs/CI-TEST-COVERAGE.md` now documents the six jobs** instead of the old
   static/T1/T2/T3/T4-only list, and `AGENTS.md` section 8 gained item 6b.

### Phase B close

`node build.js`, `npm run verify`, full affected browser battery, CI green,
commit, then deploy from `$HOME/mmgr-deploy` and live-probe
`https://mymanagerworkspace.com`. D-3, D-2 and D-1 are user-facing; D-4 is not.
The deploy carries the three fixes and the window redesign; the CI split goes
out as workflow-only change.

---

## 5. Phase C - the five feature plans

Rules for every plan:

1. **Re-derive every anchor.** The plans were written against schema v22, SW
   v481 and old line numbers. The repo is at schema v24 and SW v504. The plan's
   intent is the contract; quoted lines are hints. Note every drift in the log.
2. **Take the next schema number from the ledger below.** Never paste the
   plan's claimed number.
3. **One commit per task**, Conventional Commits, no AI attribution, explicit
   paths only.
4. **Build ritual per task:** `node build.js`, bump `sw.js` cache, regen CSP
   hashes if an inline script changed, restart `serve.cjs`, `npm run verify`,
   the plan's own gates.
5. **New harness = three edits:** harness file, registry row in
   `docs/CI-TEST-COVERAGE.md` with a status token, step in `ci.yml` inside the
   job that owns its environment. After D-4 that is a specific job, not the old
   `verify` job.
6. **Field guide** entry in the same change for every user-facing feature.
7. **Read-only stays read-only:** mutating actions stay out of
   `READONLY_SAFE_ACTIONS`; `guardReadonly()` covers them.
8. **Plan end:** full battery, CI green on `main`, deploy from staging, live
   probe, progress log entry. Then start the next plan without waiting for a
   second permission round unless a gate is red or an owner decision is
   missing.

### C1. NocoBase - custom task fields (schema v25)

Code-complete with an errata section. Follow its own "Remaining work before
this plan is implemented":

- Build the Fields sheet on the existing house modal, not a bespoke overlay.
- Map the draft CSS to real tokens. The draft names four tokens that do not
  exist; use the actual token set and prove every `var()` resolves.
- Type is immutable after creation; a change creates a new field and copies
  values.
- `custom` joins the `addTask()` push object; `fields` and `cfFilter` join
  `FIELD_KEYS`; `js/mmgr-custom-fields.js` loads after `mmgr-utils.js`.
- WBS cells, Kanban chips and the board filter share one field list.
- New model tests and the browser harness, three edits, field-guide card.
- Migration takes **schema v25**, not the plan's v23.

### C2. Leantime - idea intake and merged agenda (schema v26)

The largest plan: two pure models, two renderers, one 16-gate harness, roughly
1,900 new lines and six new files. It adds the `Intake` nav group between
`Plan` and `Collaborate`, and touches `addTask()` / `delTask()`. Re-derive
those anchors against the NocoBase landing; whichever of C1 and C2 lands
second re-derives the shared push object and the nav insertion point.
Migration takes **schema v26**.

### C3. AppFlowy - the project book (schema v27)

Prose-only, four phases: page tree and body; blocks that read the project;
templates that carry pages; the project book and handover pack. Before code,
do a drafting pass that turns each phase into numbered tasks with files, exact
steps, gates and commit subjects, saved in the plan file itself. No code until
that pass is done. Migration takes **schema v27**.

### C4. Platform - guarded transitions, audit, rules (schema v28)

Prose-only, four phases: guarded transitions; transition history; rules; the
approval pack and outbound summary. Same drafting pass first. Rules run after
the triggering change, never veto it; fixed action vocabulary; imported rules
arrive disabled. Migration takes **schema v28**.

### C5. Plane - cycles and modules (schema v29)

Prose-only, four phases: cycles as records; backlog and cycle board; modules;
honest cycle analytics and review. Same drafting pass first. The existing
sprint object converts into the first cycle and stays readable for one
release. Migration takes **schema v29**.

### Cross-plan collisions

- NocoBase and Leantime both insert a sheet after the Kanban panel, add a badge
  at the same WBS name-cell anchor, add handlers beside `tglLeadtimeLane`, and
  add keys to the same `addTask()` push object. The second one re-derives.
- Leantime adds `Intake` between `Plan` and `Collaborate`; re-derive after
  NocoBase's nav work.
- AppFlowy does not add custom fields; NocoBase owns them. Two field systems on
  one task record is a guaranteed disagreement.
- Platform's rules and Plane's cycle close both write log entries; use the
  existing log surface, do not add a second feed.
- D-1's `.ai-main` containment and D-3's gate bind every later panel: no new
  `position: fixed` descendant inside a contained ancestor.

---

## 5b. Phase E, F, G - the 2026-10-30 review

Source: `adittion to scope/REPO-RELIABILITY-DIRECTIVE-2026-10-30.md`, written
from the owner's review note and verified against the tree before it was
queued. Measured baseline: 706 tracked files, 40 root `.md`/`.txt`, 48
`tools/*.png`, `_archive/` 12 MB (67 files), `vendor/` 16 MB, `css/mmgr.css`
20,016 lines / 484 KB, `js/calculator-page.js` 562 KB. No load test, no
cross-tenant probe, no uptime or error tracking, no D1 restore drill, no
file-size gate, no type checking.

**E (housekeeping, this queue).** E0 parked material ignored; E1 finished plans
into `docs/history/` under three explicit conditions; E2 the history index;
E3 `_archive/` untracked with its deny rule and exclude lists kept; E4
`tools/*.png` per-file, referenced shots moved and their docs updated; E5
`tools/verify-sizes.cjs` with caps taken from today's sizes. E6 (CSS split)
needs its coverage number first; E7 (`checkJs` on state, cloud, billing) comes
after C1. One commit per task, `chore(repo): ...`.

**F (reliability, after C2).** F1 cross-tenant isolation harness (tenant A
against B on every cloud endpoint, refusals generic, no bytes leak) is the one
that changes what we may claim. F2 load test with p50/p95/p99 published, F3
uptime plus error tracking plus a status page (owner picks vendors; the CSP
allows one origin per provider), F4 one timed D1 restore written up as a
runbook, F5 targets (99.9 percent on `/api/health`, p95 under 300 ms) and an
incident log. No marketing number until F2 and F4 exist.

**G (market, owner).** G1 rate-book provenance: permission for the JIC data or
a fully rebranded book from the owner's own site data; `pricing.html` already
says "My MaNaGeR Rate Book", the calculator is the last place that says "JIC".
G2 pilot contractors. G3 activation, week-4 retention, tickets, feedback
button (queued after C1 so it does not share schema v25). G4 (added by the
second review pass): the landing and pricing copy never names the currency or
the market - "JMD", "J$" and "Jamaica" appear zero times on `index.html`,
`pricing.html` and `features.html`, while offline-first is already the
headline. Small copy task, blocked by G1's wording decision.

---

## 6. Phase D - parked UI plans

`UI-FIXES-SPEC.md` (43-check `qa-landing-ui`) and `plan-ui.md` are parked. The
owner will extend them. When the extended versions land:

- Run `plan-ui.md` phases 1 to 4 first, so the type and spacing scale and the
  panel header exist before new markup inherits them.
- Then run `UI-FIXES-SPEC` in its section 14 wave order 0 to 6, one commit per
  wave, with the stated gate updates in the same commit that breaks them.
- If they land after C1 to C5, phases 3 and 4 sweep the markup those plans
  added; that is accepted cost, not a reason to reorder now.
- `qa-landing-ui.cjs` stays in the parked folder until the spec is alive; when
  promoted it needs the three edits.

---

## 7. Ledgers

### Client schema numbers

| Plan | Takes |
|---|---|
| Current | `SCHEMA_VERSION = 24` |
| NocoBase | 25 |
| Leantime | 26 |
| AppFlowy | 27 |
| Platform | 28 |
| Plane | 29 |

Every plan's "migration 23" means this client migration, not a D1 SQL file.
Move `SCHEMA_VERSION` and the `migrate()` key together. One number per landing
plan.

### D1 migrations

Through `0029_team_enterprise.sql`. None of C1 to C5 needs a D1 file by
default; they are local project state, synced as blobs. If a plan does add
server-side data, it takes **0030** and every later one shifts by one. Apply to
remote D1 before the Worker deploy; never renumber an applied migration.

### Service worker and CSP

- `mmgr-shell-v504` now. Bump one integer per commit that changes a served
  file. D-4 does not bump.
- Any inline `<script>` edit: `node tools/regen-csp-hashes.cjs`, commit
  `worker.js` + `serve.cjs`, restart `serve.cjs`, and prove the live header's
  hashes match disk before trusting a browser gate.

### Harness placement after D-4

| Job | Harnesses added by this plan |
|---|---|
| `static` | `verify-ci-coverage` |
| `cloud-core` | none new |
| `cloud-auth` | none new |
| `browser-calc` | `qa-fixed-containment`, `qa-relations` per the split, calc suites |
| `browser-app` | `qa-ai-dictation`, `qa-ai-window-layout`, AI and full batteries |

Later plan harnesses go into the job that owns their environment. The registry
row alone does not run a harness.

---

## 8. Decisions

The scope addition asks its five questions once. Do not open a second round:
if the owner has not overridden a default before the task that needs it, apply
the default and record the assumption in the log. These defaults apply until
the owner overrides them here; an override before D-1 step 1 changes only that
step, nothing else.

| # | Question | Default |
|---|---|---|
| Q1 | CI branch route and direct pushes | D-3, D-2, D-1 direct to `main`; D-4 on `ci-split` with a temporary trigger, fast-forward after green |
| Q2 | Raise inline history threshold 480 to 720 | Yes, with the one `qa-ai-win` re-baseline |
| Q3 | Move Pin and Float into a More menu, two pills to one dot | Yes, ids kept, engine text into the menu |
| Q4 | Dictation engine | Keep browser speech recognition |
| Q5 | Top-layer popover plus anchor positioning | No; portal and JS tracking only |

**Flow rule.** Inside a plan: continue while gates are green; do not stop
between tasks. Stop only when a gate is red and the fix would change a
must-not-change item, when an owner decision is genuinely missing, or when the
owner says stop. A plan checkpoint is a report, not a permission gate. Phase B
also has a deploy checkpoint because three user-facing fixes are waiting.

**Deploy rule.** Deploy at the end of Phase B and at the end of each feature
plan, never mid-plan. CI green first, clean staging under `$HOME/mmgr-deploy`,
live probe, then log.

---

## 9. Definition of done

**A task** is done when its stated gate is green, the build ran, the service
worker bumped if a served file changed, CSP hashes regenerated if an inline
script changed, the commit is plain Conventional Commits with no attribution,
and the relevant harness is registered and wired.

**A plan** is done when every task is checked off here, the plan's own
Definition of Done is satisfied, `npm run verify` and the full affected
browser battery are green, the remote CI run is green, the field guide and
developer guide are updated, and the deploy plus live probe are recorded.

**A phase** is done when its plans are done and a status entry exists in
`CONTINUATION-DIRECTIVE.md` (one line, under the 40,960-byte cap) plus the full
entry in `docs/history/log-2026-10.md`. `reflection.txt` is rewritten at the end
of every session.

---

## 10. Progress log

- **2026-10-29 - plan aligned.** OpenProject landed (`4323f91`, `0b56f69`,
  `fddfd69`, `24b44ff`; schema v24; SW v504). The scope addition
  `adittion to scope/UI-CI-DIRECTIVE.md` is queued as Phase B (D-3, D-2, D-1,
  D-4). The five feature plans follow, in the order in section 2. This
  supersedes the old "plan-openproject IN PROGRESS" line.
- **2026-10-29 - Phase A closed.** `qa-relations` 9/9 (removal and view-only
  removal arms added), model tests 12/12, `npm run verify` green (171 unit,
  registry 145/145), `verify-actions` and `verify-render-exports` green, remote
  CI `40948194942` 117/117. No app code changed.
- **2026-10-29 - B1 D-3 done.** The listbox is portalled to `<body>` with a
  per-frame tracker, `visualViewport` listeners, a horizontal clamp and an
  orphan sweep that stops the frame loop. New `qa-fixed-containment` (8/8,
  empty allowlist, teeth proven) is in CI; `qa-calc-controls` 94/94,
  `qa-calc-playwright-audit` 61/61, `qa-shortcuts` 15/15, `npm run verify`
  green (171 unit, registry 146/146). Schema unchanged; SW v505.
- **2026-10-29 - B2 D-2 done.** Dictation commits each final chunk once into a
  seeded base, renders the interim from that base, and can no longer paint
  `null` (`aiJoin` coerces). The mic tooltip now says browser speech
  recognition. New `qa-ai-dictation` (14/14, teeth proven both ways) is in CI;
  `qa-ai` and `qa-ai-win` 22/22 green. Schema unchanged; SW v507.
- **2026-10-30 - B3 D-1 done.** The assistant is one 56px header row, one
  composer card, and three width tiers measured on `.ai-main` itself. History
  goes inline only at 720, so the 520 dock default keeps its full reading
  column. New `qa-ai-window-layout` (83/83, light and dark, eight widths) is in
  CI; `qa-ai-win` 23/23, `qa-ai` PASS, `qa-ai-dictation` 14/14,
  `qa-fixed-containment` 10/10, axe, gold, action contract and
  `npm run verify` green (registry 148/148). The gate found two real defects
  (Esc fell through to the workspace handler and closed the window; the 82vh
  modal cap left a dead strip), both fixed. SW v513. Schema unchanged.
- **2026-10-30 - B4 D-4 done on `ci-split`, merged.** Five parallel jobs plus
  a summary. Baseline 24.4 min to 7.6 min slowest job (`cloud-core`); all six
  jobs green in run `41015996950`, 0 skipped. New `verify-ci-coverage` (12/12,
  teeth proven) is in `static`. `yaml` added as a devDependency. CI-only: no
  served file changed, so no service-worker bump.
- **2026-10-30 - Wave 1.1 to 1.4 done, then two corrections.** The landing UI
  pass and its backlog landed (`qa-landing-ui` 8/43 to 43/43, now a CI step),
  F1 tenant isolation 19/19 with a live existence oracle fixed, and the CSS
  coverage measurement ran. Two things it got wrong were caught the same day:
  (a) `qa-landing-ui` launched Playwright's bundled browser, which CI never
  downloads, so the first green-looking wave went RED on the new step (run
  `41095901556`); it now pins system Chrome like every other Playwright gate
  (`59f05a7`, run `41155753538` 6/6 jobs green, slowest 458s). (b) the coverage
  tool reported 31.7% / 28.9% dead CSS because it never rendered the project
  workspace (`project.html` gate-redirected to `app.html?locked=...`) and
  measured one of the 13 marketing pages; corrected, it is **11.8% / 9.7%**,
  below the 15% trigger, so E6.2 deletion is demoted and the CSS split (1.6)
  is the next real work.
- **Next:** 1.6 CSS split into `css/src/*` layers, then Wave 2 C1 NocoBase.
  The landing wave's deploy is recorded under Wave 1 in the log.
