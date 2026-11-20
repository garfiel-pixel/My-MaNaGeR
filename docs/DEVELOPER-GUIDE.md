# Developer Guide — Module Map & Code Hotspots

A one-stop map of the `js/` codebase: what each module does, how they load,
and which functions are the largest (split candidates if you need to touch them).

Last refreshed: 2026-09-19 (against `build.js`'s 55-module project bundle).

---

## 1. How the code loads (read this first)

There are **no ES modules and no import graph**. Everything hangs off one
global namespace, `window.MMGR`, and load *order* is the dependency graph.
The order lives in exactly one place:

- **`build.js`** — `APP_MODULES` (project.html, 55 modules), `APP_LAUNCHER_MODULES`
  (app.html), `MARKETING_MODULES`, `ADMIN_MODULES`.
- Pages load `dist/bundle.js` (project) / `dist/app-bundle.js` (launcher), built
  by `node build.js` from those lists. **Editing `js/*.js` without rebuilding is
  the #1 way to lose an hour — always run `node build.js` after source changes.**
- Each module opens with `var MMGR = window.MMGR || {};` and attaches itself to
  the namespace (e.g. `ns.State = {...}`). Cross-module calls are therefore just
  global lookups: `MMGR.Utils.$(...)`, `MMGR.State.getState()`.
- **Stylesheets are generated too.** `node build.js --css` concatenates
  `css/src/*.css` in filename order (that order IS cascade order) into
  `css/mmgr.css`, the file every page links. Edit the layer, never the
  assembled file; the layer map and the rules live in
  [`css/src/README.md`](../css/src/README.md).

### De-facto layers (top = loaded first, can be used by everything below)

| Layer | Modules | Rule |
|---|---|---|
| Foundation | `mmgr-state`, `mmgr-utils`, `mmgr-net`, `mmgr-perf`, `mmgr-theme` | No upward calls. State owns schema + persistence; Utils is shared helpers. |
| Render | `js/render/*`, `mmgr-render` | Read state, write DOM. Called via `MMGR.Render.renderDash()` — which wraps most sub-renderers in `requestAnimationFrame` (see AGENTS.md lesson 3). |
| Domain | `mmgr-tasks`, `mmgr-schedule`, `mmgr-risks`, `mmgr-resources`, `mmgr-bids`, `mmgr-claim`, `mmgr-digest`, `mmgr-decisions`, `mmgr-health`, `mmgr-evm`, … | Mutate state via `State.updateState`, render via `Render`. |
| Controller | `js/app/*`, `mmgr-app` | Boot sequence, delegated event handling (`data-action` → `ACTION_MAP`), drawers, modals, toasts. |
| Platform (optional) | `mmgr-google-auth`, `mmgr-cloud` + `js/cloud/*`, `mmgr-cloud-dash`, `mmgr-pool`, `mmgr-presence`, `mmgr-sync` | Must degrade to fully-offline silently. Cloud sync stays **opt-in per project** (hard rule). |
| AI & extras | `mmgr-ai-key`, `mmgr-ai`, `mmgr-prompts`, `mmgr-voice`, `mmgr-calculator`, `mmgr-glass`, `mmgr-viewport`, `mmgr-dock` | Additive UI/features; AI key lives in sessionStorage only. |

### Event wiring convention

Buttons don't carry `onclick=` handlers. They carry `data-action="..."`, and
`mmgr-app.js`'s delegated listener dispatches through a central `ACTION_MAP`.
So: **the HTML tells you the action name; `mmgr-app.js` tells you the handler.**
Cloud-section buttons follow the same pattern via `mmgr-cloud.js`'s own map.

---

## 2. Module map (alphabetical)

Sizes are line counts at the time of writing. "Extends" = the namespace key it
attaches (e.g. `MMGR.Cloud`).

| Module | ~Lines | Extends | Responsibility |
|---|---|---|---|
| `mmgr-state.js` | 1,216 | `State` | Schema versioning, load/save/persistence, migration, and the **JSDoc typedef block** (Charter, Task, Risk, BudgetLine, Resource… — the canonical state shapes; keep current). `getDefaultState()` seeds the whole schema. |
| `mmgr-utils.js` | 353 | `Utils` | Shared helpers: date parsing (`parseDL`), DOM `$`, formatting, escape, misc. |
| `mmgr-relations.js` | 270 | `Relations` | Work package relation model: typed links, explicit reverse pairs, loop validation, symmetric add and remove, open-blocker queries, and the persisted board lens. Pure functions over the state object, no DOM. Loads before the renderers and the domain modules. |
| `mmgr-kanban.js` | ~430 | `Kanban` | Kanban board model: card membership and order, WIP limits, ephemeral filters, derived swimlanes, lead and cycle time. Pure functions over the state object, no DOM. Loads before the renderer and the domain modules. |
| `mmgr-net.js` | 248 | `Config`, `Net` | Central config object (future API keys/endpoints — empty by design) + fetch wrapper. |
| `mmgr-perf.js` | 95 | `Perf` | Device-level Performance Mode. ON/OFF gates WebGL starfield, 3D tilt, heavy CSS blur layers. Must load before viewport/dock read it. |
| `mmgr-theme.js` | 183 | `Theme` | Light/Dark/System helper, early-load so theme applies before first paint. Shared by every page. |
| `mmgr-render.js` | 2,390 | `Render` | Rendering engine: `renderDash()` (dashboard), `renderWbs()`, `renderGantt()`, `drawDependencyArrows()`, plus RAF-wrapped dispatch of the `js/render/*` sub-renderers. |
| `js/render/*.js` | — | `Render` | Render sub-modules extracted from mmgr-render.js: `financials`, `people`, `closure`, `documents`, `weather`, `kanban`, `ideas`, `risks`, `resources`, `agenda`, `pages`. Each exports exactly one renderer object (`RenderIdeas` -> `renderIdeas`, `RenderAgenda` -> `renderAgenda`, `RenderPages` -> `renderPages`); mmgr-render.js owns the thin wrapper and the `ns.Render` key. Loaded *before* mmgr-render.js which wraps them. |
| `mmgr-app.js` | 2,578 | `App` | Application controller: `init()` boot, access gate, delegated `data-action` dispatch (`ACTION_MAP`), drawers/modals/toast, keyboard shortcuts, mention dropdown, Gantt PNG export. |
| `js/app/*.js` | — | `App` | App sub-modules extracted from mmgr-app.js: `components`, `confirm`, `copy-text`, `sidebar`, `weather`, `backup`, `export`, `history`, `definitions`, `baseline-guard` (Task 2: auto-captures the first baseline + red-dot nudge), `entitlements` (Task 9: the ONE gating seam — `aiAssistant()` reads sign-in; premium flags land inside later, callers never change). |
| `mmgr-tasks.js` | 623 | `Tasks` | WBS/task CRUD: add/edit/indent, `updTaskField` (endDate edits + Gantt drags back-compute duration via `durationFromDates`, Task 1), `validateImportLines` + AI-assisted Import Dates mismatch panel (Task 3). Split-candidate note: `updTaskField` grew — keep an eye. |
| `mmgr-ideas.js` | 575 | `Ideas` | Idea intake model (Leantime-inspired): six canvas stages, record normalisation, add/update/remove, the atomic `applyDrop`, the impact x2 minus effort score, the one-way promote link, `unlink` for a deleted task, and `repair` for imported rows. Pure: no DOM, no storage. |
| `mmgr-agenda.js` | 416 | `Agenda` | Merged date feed over tasks, milestones, meetings, open issues, open changes and live ideas. One window rule, overdue handling, day grouping, and the RFC 5545 `.ics` writer. Pure: no DOM, no storage. |
| `mmgr-pages.js` | 887 | `Pages` | Project book model (AppFlowy-inspired): a flat page tree (`parentId` + `sort`, never nested), typed plain-text blocks, create/rename/remove-with-descendants, a descendant-safe move, block add/edit/toggle/reorder/remove, live task/document blocks resolved at draw time, and template capture/apply. Pure: no DOM, no storage. |
| `mmgr-schedule.js` | 849 | `Schedule` | CPM engine: topological sort, forward/backward pass, float, critical path, weather padding, resource conflicts, `audit()`. **Purity contract**: pass functions are pure — they never mutate live tasks. |
| `mmgr-risks.js` | 298 | `Risks` | Risk & issue CRUD; the issue status write is guarded by `Process`. |
| `mmgr-resources.js` | 428 | `Resources` | Resource & budget management (rates, allocation, utilization, budget lines). |
| `mmgr-stakeholders.js` | 328 | `Stakeholders` | Stakeholder register, change control, logs; the change status write is guarded by `Process`. |
| `mmgr-process.js` | 325 | `Process` | Guarded status edges for changes and issues, the append-only transition history, repair-on-boot, and (from Phase 3) the declared rule engine. Pure: every function takes the state. |
| `mmgr-bids.js` | 848 | `Bids` | Bid leveling + Go/No-Go weighted scoring (packages, leveled grid, per-sub actions). |
| `mmgr-charter.js` | 498 | `Charter` | Project charter & KPI management. |
| `mmgr-custom-fields.js` | ~360 | `CustomFields` | Custom task field schema: the type table, add/update/remove/reorder over `state.fields`, coercion, value reads and writes on `task.custom`, required-field detection, and the persisted board filter. Pure functions over the state object, no DOM. Loads after `mmgr-utils.js` and before the renderers. |
| `mmgr-raci.js` | 248 | `RACI` | RACI matrix. |
| `mmgr-closure.js` | 427 | `Closure` | Closure, comms & document management. |
| `mmgr-defs.js` | 226 | `Defs` | Static plain-language PM glossary (data-only; adding a term touches no logic). |
| `mmgr-field.js` | — | `Field` | Daily field report module. |
| `mmgr-weather.js` | — | `Weather` | Weather analysis. |
| `mmgr-forecast.js` | 250 | `Forecast` | Open-Meteo 7-day forecast + delay log; localStorage cache with 3h TTL. |
| `mmgr-health.js` | 172 | `Health` | `computeHealthScore()` — the single source of truth for the 5-factor weighted score (Completion 30 / Schedule 25 / Budget 20 / Risk 15 / Change 10). Pure function; returns null on insufficient data (no fabricated numbers). |
| `mmgr-evm.js` | — | `EVM` | `computeEVM()` — single source of truth for earned-value numbers (dashboard, KPIs, AI prompts). Same no-fabrication rule. |
| `mmgr-dmaic.js` | — | `DMAIC` | DMAIC workflow phases (persistent via `State.updateState`). |
| `mmgr-meetings.js` | 639 | `Meetings` | Agenda template library + live meeting tracking (start/end, per-item notes, auto-log to Comms). |
| `mmgr-decisions.js` | 173 | `Decisions` | "Today" decision engine — impact-scored top-8 "needs you now" list. Formula is documented in-code; single source of truth. |
| `mmgr-claim.js` | 508 | `Claim` | Evidence/claim pack: `computeSlips()` (baseline-vs-actual deltas with cause tags), `buildClaimPack()` + `claimPackText()` (one-click delay-claim export from live state). |
| `mmgr-digest.js` | 311 | `Digest` | Weekly/daily "what changed" digest — diffs live state against a pinned fingerprint; exact, never invented. |
| `mmgr-report.js` | 166 | `Report` | "Report Issue" zero-network diagnostic export (sanitized snapshot). |
| `mmgr-errors.js` | 166 | `Errors` | Client-side error surface: last 20 errors in `state.errorLog`; hooks `error` + `unhandledrejection`. |
| `mmgr-prompts.js` | 789 | `Prompts` | AI prompt generation from project state. |
| `mmgr-ai.js` | 2,016 | `AI` | AI assistant window + model wiring: preset prompts, context dump (`buildContext`), Tier-A deterministic `localLookup` (zero-fabrication by construction, traceable outputs), relay submit seam. |
| `mmgr-ai-key.js` | — | `AIKey` | BYO AI key vault. **sessionStorage only** (`mmgr_byo_ai`); never localStorage/cookies/state/logs. Rules are load-bearing — do not relax. |
| `mmgr-voice.js` | 1,179 | `Voice` | Voice capture & transcription: MediaRecorder, 10s chunks persisted to IndexedDB on arrival, offline Whisper transcription (vendor/whisper). |
| `mmgr-viewport.js` | 242 | `Viewport` | Viewport-aware layout detection (measured, never UA-sniffing); one dismissible narrow-screen prompt for wide-layout views. |
| `mmgr-glass.js` | 429 | `Glass` | Opt-in premium liquid-glass Three.js backdrop (CSS `backdrop-filter` is the default tier). `activate()` boots the engine. |
| `mmgr-dock.js` | 213 | `Dock` | Shared bottom dock (theme stack + glass toggle) on every app page. External file on purpose — zero CSP hash churn. |
| `mmgr-calculator.js` | 1,507 | `Calculator` | Floating draggable calculator FAB: trades/site tabs, `wireInputs`, and the giant `handleAction` switch. |
| `mmgr-watch.js` | — | `Watch` | Background assistant (Task 6): deterministic watchers (lead-time, budget, resources, weather) writing into `s.aiInbox`; header bell + mailbox. Gated on sign-in via Entitlements (Task 9). Notices are local-only, user-deletable. |
| `mmgr-sync.js` | 299 | `Sync` | Optional Google identity for sync labelling. Never gating. |
| `mmgr-google-auth.js` | 1,798 | `GoogleAuth` | Optional operator identity: GIS load, `showUser`, email+password auth (`wireEmailAuth`, `mountPasswordControl`), marketing-page sign-in sheet. |
| `mmgr-cloud.js` | 2,593 | `Cloud` | Cloud Backup & Recovery section (Controls drawer): owner/editor codes, save/load/recover, changelog+revert, sync bond (`cloudBond`: file exports carry a twin pointer, import detects it, bonded `createProject` probes before forking, `cloudResync` = load + per-field merge). **Strictly opt-in per project.** Server-side scope enforcement is the real gate; UI greying is UX only. |
| `js/cloud/*.js` | — | `Cloud` | Cloud sub-modules: `diffs`, `scope`, `share`, `review`, `webhooks`. |
| `mmgr-cloud-dash.js` | 724 | `CloudDash` | "My Cloud Projects" launcher dashboard (app.html). Self-contained on purpose — loads before mmgr-utils; degrades silently without the Worker. |
| `mmgr-pool.js` | 237 | `Pool` | Cloud shared resource pool client (C23): list/link/unlink pool rows, owner-gated server-side. |
| `mmgr-presence.js` | — | `Presence` | Real-time presence WebSocket (project.html only, opt-in): quiet "N online" chip; hides entirely on any failure. Shares `{name, since}` only. |
| `mmgr-templates.js` | 309 | `Templates` | Save current state as template / apply template to a project (C24). Carries the page tree too: `Pages.captureTree` on save, `Pages.applyTree` on apply. |
| `marketing.js` | 704 | — | Marketing pages (index/features/about/contact): nav dropdowns, contact form, etc. |
| `reviews.js` / `verify.js` / `reset.js` | — | — | Marketing-bundle helpers (reviews wall, code verify, reset flows). |
| `demo-data.js` / `projects-data.js` | — | — | Launcher seed data. |

*(~Lines marked "—" were minor at analysis time; see `wc -l js/*.js` for current numbers.)*

---

### Idea intake and the agenda

`mmgr-ideas.js` and `mmgr-agenda.js` are **pure models**: no DOM, no storage, no timers. Both are tested directly in `test/*.test.mjs` under a `vm` sandbox. The board and the list in `js/render/ideas.js` are two projections of `state.ideas`; they must never hold a copy. The agenda in `js/render/agenda.js` is a read-only projection of six existing record types and owns no record of its own.

Four rules are load-bearing:

1. **One write path per record.** Stage moves go through `Ideas.applyDrop` (drag and arrow keys) or `Ideas.update` (the list select and the sheet). Do not add a third.
2. **Repair saves through `State.save()`, never `State.updateState()`.** A renderer runs inside a change notification; `updateState` there re-enters the listeners. `save()` debounces and stamps `updatedAt`, which is all a repair needs.
3. **Promotion is one-way and does not change the stage.** `Ideas.promote` writes `promotedTaskId`; `Tasks.delTask` calls `Ideas.unlink` in the same update, so a card can never point at a deleted task.
4. **The agenda adds no editable control.** Every row jumps to the panel that owns the record. A second editing surface is how two sources of truth start to disagree.

Per-device preferences (`ideaView`, `ideaTag`, `agendaDays`) live in state but are deliberately **not** in `FIELD_KEYS`, so a cloud merge never carries one user's view choice onto another machine.

### The project book (pages)

`mmgr-pages.js` is a **pure model**: no DOM, no storage, no timers, tested in `test/pages-model.test.mjs` under a `vm` sandbox. `js/render/pages.js` draws the Documents panel's Pages view. The Register is untouched and still owns controlled documents.

Three rules are load-bearing:

1. **Pages are a flat array with a `parentId`, never nested.** A move is one write, "find by id" is a scan not a recursive walk, and a partial cloud merge cannot duplicate a subtree. `Pages.flatten` is the only tree view; `Pages.move` refuses a drop into the page's own descendant.
2. **A block holds plain text and a type, never HTML.** Formatting *is* the block type (heading, bullet, callout, divider). An unknown type from a newer build repairs to a paragraph on read. No sanitiser exists because no HTML is ever stored.
3. **A page is a lens, not a second surface.** Pages may reference tasks and register rows but never create, edit, or delete either. Every write is a `data-action` through `State.updateState`, so the read-only fence covers the surface with no new logic.

**Live blocks read, never write.** A `taskList` or `docList` block stores only its `filter`; the rows are resolved at draw time by `Pages.resolveTasks` / `Pages.resolveDocs` and every row is a `pageJump` link to the owning panel. Nothing is copied into the page, so a task completed in the WBS or a register row removed in Documents is gone the next time the panel draws. A filter edit is a page write (`setBlockFilter`) and is fenced; a viewer gets the same rows and a sentence naming the filter instead of the selects. `emptyFilterText` names the filter — "No data" reads like a bug.

**Templates carry the page tree.** `saveAsTemplate` stores `Pages.captureTree(state)` — ids stripped, each page keeping a local `key` and its parent's `key` — and `applyTemplate` runs `Pages.applyTree` *after* the tasks and budget lines, so a live block resolves against the tasks that just arrived. Fresh ids are minted on apply and parents are remapped in tree order, so applying the same template twice yields two independent branches. A template with no `pages` applies exactly as before.

**The register link and the handover pack.** A register row may carry one optional `pageId`; the link lives on the document, so deleting the page leaves the row and the cell reads as unlinked again. The Pages view's unfiled lens keeps unlinked pages plus the ancestors that hold them (`context: true`), so the tree still reads. `Pages.buildPack(state, rootId)` assembles — never stores — the branch in order, each block, live rows resolved as they stand that moment, and the register rows linked from the branch grouped by type. `printPack` paints it into `#pg-pack` (a direct child of `body`) and adds `body.pg-printing`; the `@media print` rules in `30-panels.css` are the only thing that shows the pack and hides the app. The pack is paper: black on white regardless of theme.

`pages` is project data and **is** in `FIELD_KEYS`; `docsView`, `pageSel` and `pageUnfiled` are per-device and deliberately are not. The migration repairs an imported page inline (the state module loads before the model); the model repairs again on read.

### Guarded status moves (process)

`mmgr-process.js` is a **pure model**: `canMove` judges an edge, `applyMove` writes the status and the history entry together, `repairAll` steps an impossible status back. Three rules:

1. **The guard sits on the write, not the widget.** `Changes.updChange` and `Risks.updIssue` route a `status` field through `Process.applyMove`; the select is only a control. An import, a paste, a rule and a programmatic call all pass through the same judgement.
2. **The history is a flat, append-only collection** (`state.transitions`), not an array on the record. A cloud merge rewrites arrays wholesale, so a nested history could lose an entry; a flat collection keyed by `{kind, ref}` survives, and it survives the deletion of its record on purpose.
3. **A move and its entry land in one `updateState`.** There is no window in which a status is new and unrecorded. A refusal never half-writes: `canMove` is checked before anything is touched.

Repair runs on boot (`App.init`) only when `Process.needsRepair(state)` is true, and each step is recorded with `via:'repair'` — never silently. `requireApproval` sets `secondApproverRequired`; the guard then refuses `review→approved` until a second name is filled.

The history has two views and one source. The change id in the register opens a detail row under the record (oldest first, newest emphasised, `rule`/`repair` tagged); the Log panel's "Recorded moves" card shows the project-wide feed newest first, filtered by record type through `state.trFilter` (per-device, not in `FIELD_KEYS`). Both read `Process.feed`/`Process.historyFor`; neither writes. The written Decision Log stays below the feed, labelled as a person's narrative.

### Declared rules

A rule is **data, not code**: `{trigger:{kind,event}, conditions:[{field,op,value}] (all-of, max two), action:{type,...}}`, one action from `RULE_ACTIONS`. There is no expression language and no outside call — a rule that needs more is a feature request. Four rules:

1. **One pass judges the record as it was.** `runRules` snapshots the record before pass one, so a rule that writes a field cannot change the verdict for a later rule in the same pass. Pass two only detects a rule that *would* now match on a field trigger, logs `Chain stopped`, and stops.
2. **The declared event is part of the trigger.** A rule written for `status` does not fire on `created` or a field edit.
3. **A rule cannot bypass the guard.** `setField` on `status` goes through `applyMove`, so its refusals still apply and the move is recorded `via:'rule'`.
4. **Imported rules arrive disabled.** `importState` sets `enabled:false` on every rule in the file; opening a project cannot start acting on it.

`state.ruleLog` is capped at 300 entries (the UI shows the newest 20). Rules live in `FIELD_KEYS` as flat append-only collections, like `transitions`.

### Cycles (planning)

`mmgr-cycles.js` is a **pure model**. A cycle is a window with a commitment inside it, and it owns no tasks: `task.cycleId` is the pointer, so moving a task is one write and a merge cannot duplicate membership. Four rules:

1. **One active cycle, always.** `activate` demotes the previous active cycle in the same write, so no render can catch two.
2. **The commitment is taken once.** `activate` records `{at, tasks, days}` and nothing recalculates it; the difference between that and the cycle's contents at close is real scope movement, not a reinterpretation.
3. **Closing is a decision.** `close(state, id, 'forward'|'backlog')` refuses an empty choice and refuses while any task has no status. `forward` requires a next open cycle that starts after this one ends; there is no silent third answer.
4. **A closed cycle is history.** Its dates and membership are frozen (`assign` and `updateCycle` refuse), while its name and notes stay editable.

The sprint bar above the board is a **view** of the active cycle, not a second source: `Tasks.loadSprintData` reads the active cycle and falls back to the old singleton only so a project that never opened Planning still shows something. `saveSprint` writes through `Cycles.updateCycle` and never touches `state.sprint`; with no active cycle, a complete name/date edit creates and activates one through the model. `Populate Sprint` writes the active cycle's dates. The Planning section is hidden on a non-agile project by the same rule as the sprint bar (`#plan-nav`).

Migration 30 converts the old sprint into the first cycle and clears a `cycleId` that points at a cycle that no longer exists. `state.cycles` is in `FIELD_KEYS`; `cycSel`/`cycClosing` are view preferences and deliberately are not.

**Analytics restate records, never extrapolate.** `burndown(state, cycle)` walks the cycle window day by day, reads the daily snapshot for each day, and sums the committed durations of the tasks the snapshot still shows unfinished. A day with no snapshot is a **gap**, not a zero, and fewer than two points refuses to draw with a reason. The commitment stores `ids` and `daysById`, so scope change is `current − committed` split into added and removed, and a later duration edit cannot rewrite what was committed. Velocity exists only on a closed cycle with a commitment (`close.doneDays`). `reviewText` is generated once at close and appended to the Decision Log; `reviewLogged` stops a second copy. Snapshots carry `duration` for exactly this purpose.

### The approval pack and the outbound summary

`Process.buildApprovalPack(state,{from,to,statuses})` assembles — never stores — the dated header, every matching change with its impacts, approver and reason, and that change's full history. `App.printApprovalPack` paints it into the shared `#pg-pack` container (same print surface as the handover pack) and prints; the footer states included/excluded and the local-time caveat. Printing is a read, so a viewer may print it.

A rule with `hook:true` asks for the move to leave the device. `Process.buildTransitionSummary` returns exactly eight fields (`event, project, kind, ref, from, to, by, at`) — the record's reason and notes stay on the device. `App.dispatchHooks` posts it to `POST /api/cloud/projects/:id/webhooks/notify`, which rebuilds the document from that fixed key list and relays it to the project's enabled `transition_recorded` subscriptions, signing each delivery with the subscription secret. Owner code required; the checkbox is off by default; a failed send toasts and leaves the history entry untouched.

## 3. Split candidates — largest functions

Brace-matched line counts (>=60 lines, generated by a scratch script; regenerate
with `node tmp/analyze-fns.cjs` if the tool is still present). The top of this
list is where new work should think twice about "just add another case."

| Lines | Location | Function | What it does / why it's big |
|---|---|---|---|
| **439** | `mmgr-calculator.js:801` | `handleAction` | One giant `switch` over every calculator action (percent, trades, site math…), each case parsing inputs and rendering results inline. Classic table-driven refactor: split per-tab handlers (percent/trades/site) or a `actions = { 'pct-of': fn, ... }` map. Lowest-risk split in the codebase — pure UI, no state coupling. |
| **414** | `mmgr-render.js:102` | `renderDash` | The dashboard: progress ring, task counters, alerts, and the RAF-wrapped dispatch of a dozen sub-renderers (weather, leadtime, decisions, aging, baseline narrative, forecast, meetings…). Already partially extracted into `js/render/*`; continuing that extraction is the intended direction. Caution: AGENTS.md lesson 3 — sub-renderers run inside `requestAnimationFrame`, so any test touching it needs the RAF flush. |
| **336** | `mmgr-cloud.js:1556` | `render` | Renders the whole Cloud Backup section: owner-code panel, editor codes, changelog, recovery — one function for four logical UIs. Natural split: one render function per sub-panel (`renderOwner`, `renderEditors`, `renderLog`, `renderRecovery`). |
| **257** | `mmgr-app.js:259` | `init` | Boot: access gate, state load, readonly mode, theme, all DOM wiring. The `js/app/*` extraction exists — more of init's wiring belongs there. |
| **171** | `mmgr-state.js:184` | `getDefaultState` | Not a problem: it's the schema declaration, 171 lines of default fields. Read it as documentation; don't split mechanically. |
| **156** | `mmgr-google-auth.js:626` | `wireEmailAuth` | Email+password form wiring (validation, submit, error surfaces). Could split form-validation from submission transport. |
| **122** | `mmgr-claim.js:276` | `claimPackText` | Renders the claim pack to text. Long but linear/serializing — split only if claim sections change often. |
| **121** | `mmgr-calculator.js:416` | `buildTradesTab` | Builds the trades tab DOM imperatively. Table-driven: data + row factory would halve it. |
| **121** | `mmgr-digest.js:59` | `computeDigest` | Diffs live state against the pinned fingerprint across many state areas. Natural seams: one `computeXDiff()` per area (tasks/risks/budget/schedule), then assemble. |
| **115** | `mmgr-render.js:1318` | `renderGantt` | Gantt chart layout math + DOM. Split layout computation (pure) from DOM emission (impure) — that alone makes it testable. |
| **110** | `mmgr-ai.js:639` | `localLookup` | The deterministic Tier-A answer engine. Each question-type branch is a candidate function; the `trace` output must stay intact (zero-fabrication is by construction). |
| **107** | `mmgr-render.js:1439` | `drawDependencyArrows` | Gantt arrow geometry. Self-contained; only touch when touching Gantt. |
| **105** | `mmgr-decisions.js:43` | `computeTodayDecisions` | Impact scoring across sources. The formula is documented in the header — keep the weights in one place if splitting. |
| **105** | `mmgr-google-auth.js:220` | `showUser` | User-chip UI + menu for all pages. Moderate. |
| **103** | `mmgr-app.js:155` | `initMentionDropdown` | @-mention autocomplete UI. Self-contained. |
| **101** | `marketing.js:395` | `wireNavDropdowns` | Marketing nav behavior. Low priority. |

**Honorable mentions (60–100 lines)**: `mountContactForm` (marketing), `buildClaimPack`,
`renderPkg` (bids), `loadList`/`loadProject` (cloud-dash), `exportGanttPNG` (app),
`updTaskField`/`wiCommit` (tasks), `endMeeting`, `startCapture` (voice), `audit`/`forwardPass`
(schedule), `saveToCloud`/`createProject`/`cloudDeleteConfirm`/`listLog` (cloud), `setupFloatSurface` (ai),
`renderEVM`, `activate` (glass), `mountPasswordControl` (google-auth), `buildSiteTab`/`wireInputs` (calculator).

### Refactor ground rules (from AGENTS.md — apply to any split)

1. **Rebuild after every change**: `node build.js` (or `node build.js --app`).
   Stale bundles make your change invisible.
2. **Keep the namespace pattern**: splits stay IIFEs on `window.MMGR` — do not
   introduce ES modules or a new module system piecemeal.
3. **Load order is a contract**: if you extract a file, add it to the right slot
   in `build.js`'s `APP_MODULES` (before whatever reads it at load time).
4. **Purity contracts exist**: schedule pass functions, `computeHealthScore`,
   `computeEVM` — don't make pure functions impure while moving code.
5. **Verify**: `npm run verify` + the relevant `qa-*.cjs` harness for the area.

## 4. MCP agent surface (MCP-AGENT-FIRST)

Two JSON-RPC MCP surfaces sit in front of the same tool table:

- `POST /api/mcp` — the **app-wide** surface (`src/mcp/appwide.js`), scoped to the
  signed-in owner/account (project list, account, connector/calendar). No
  project id in the path.
- `POST /api/mcp/:projectId` — the **project** surface (`src/mcp/server.js`), the
  write path for a single project's records.

Both assemble their tool list from the shared `TOOLS` table in
`src/mcp/server.js`; a tool declares which surface(s) it belongs to. Auth is a
`Bearer sk-mmgr-…` (project API key) or the owner code. A key carries a `scope`
(array of section ids) plus two money switches, `budgetRead` and `budgetWrite`.

### 4.1 The model (`src/mcp/model.js`)

`getList(cpath)`, `getSection(section)`, `fieldSpec`, `isDeletable()` and the
`MODEL` enums are the single source of truth for every field the agent can touch.
This is where:

- allowed enums live (e.g. `tasks.status` = `todo|inprogress|blocked|completed`,
  `probability/impact` = `Low|Medium|High`) — input is case-insensitive, the
  canonical value is stored;
- the **derived fields** are declared (`critical`, `totalFloat`, `statusSince`,
  `completedDate`, `id`, `totalFloat`, …) so the queue refuses any attempt to
  write them — the app recomputes them, an agent must never smuggle a computed
  value and read it back as if the app had produced it.

### 4.2 Proposal planning (`src/mcp/plan.js`)

`planProposal(a, auth, …)` is the queuer-side validator. It takes the raw
`{diffs, creates, sets, deletes, budget}` and returns `{ops, budget, refused,
warnings, scope}`:

- `ops` is the **v2 op list** (`{v:2, ops:[…]}`) — `set` / `create` / `delete`
  records. This is what gets stored in `cloud_reviews.ops_json` and what the
  accept engine runs (minus budget ops, which stay in `proposal_json`).
- `budget` is the `buildBudgetProposal()` result (`{summary, currency, changes}`);
  every money value is checked on the server, and delivery amounts are computed
  by the server, never trusted from the client.
- Permission gating happens here: a write to a section outside `scope` is
  refused with "outside the granted sections"; a money op without both
  `budgetRead` and `budgetWrite` is refused with "may not propose budget
  changes". Budget-line diffs and envelope sets are re-expressed as budget-array
  ops so one validator (`buildBudgetProposal`) owns every money check.
- Unknown fields, over-length strings, enum misses, and derived-field writes are
  refused with the allowed values. The dry-run tool `validate_changes` runs the
  same code and queues nothing.

### 4.3 Change sets and the never-auto-apply guarantee

A key's same-day proposals share **one change set**: `cs_<UTCdate>_<keyId>`
(`src/mcp/server.js`). The agent queues; the owner decides. Nothing an agent
proposes is ever applied until the owner Accept-all (`POST /api/cloud/projects/
:pid/changesets/:id/accept`) or the single-proposal Accept. This is the core
contract — `apply_changes` returning "Queued N field change(s)" with the live
state left untouched is the assertion every e2e harness pins (`A6`, `C1`).

### 4.4 The accept engine (`src/cloud/applyOps.js`)

`applyOps(liveState, proposals, {model})` returns
`{next, report, derivedChanges, hardFailure, conflicts}`. It is a **pure**
function: it clones the caller's state into `work` and never mutates the input,
so an abandoned or failed accept leaves the blob untouched (proven by the
R2 etag check in `AT05`). The engine's rules, in order:

1. **before-mismatch → `conflict`**: a diff whose `before` no longer matches the
   live value is a conflict; the live record is left unchanged and the report
   names the record + field. The owner UI renders the conflict sentence.
2. **after-already-live → `skipped_already`**: a diff whose `after` already
   equals the live value is a no-op and is not re-applied.
3. **last-op-wins**: two writes to the same record/field in one set — the later
   op supersedes the earlier; this is `applied`, **not** a conflict (AT21's
   colliding `t1.status`).
4. **derived fields nulled for recompute**: every touched record has its
   derived fields (`critical`, `totalFloat`, `statusSince`, `completedDate`) set
   to `null` so the app's schedule pass recomputes them on the next load.
5. **scope violation → `conflict`**: an op whose section is outside the
   proposal's `scope`.
6. **delete guards**: deleting a referenced task, a phase with children, or a
   non-deletable list (`budgetLines`) is refused; a safe delete strips the
   survivor's now-dangling predecessors.
7. **hard failures**: a predecessor **cycle** (`findCycles`, ported from
   `js/mmgr-schedule.js`) or a **bad enum** left in state is a `hardFailure`. On
   a hard failure the whole set is rejected (`422 accept-failed` + `hardFailure`
   in the body), and **every** report row is rewritten to `rolled_back`; the rows
   whose field matches the failure (`predecessors` for a cycle, `status` for a
   bad enum) carry the failure's own code (`CYCLE` / `BAD_ENUM`) plus a reason
   naming the offending ids, so the agent learns which op to fix instead of
   retrying the identical set.

### 4.5 Budget proposals at accept (accept-side shape mismatch)

`buildBudgetProposal()` is the single money validator, but it only understands
the **raw MCP input shape** (`{kind, lineId, field, value, qty, unitPrice, …}`).
The stored `proposal_json.changes` is the **output shape** (`{kind, lineId,
field, before, after, …}`, with delivery details nested under `after`). The
accept path (`src/reviews.js`) re-runs `buildBudgetProposal` on the stored
entries, so `normalizeBudgetChange()` maps the stored shape back to the raw shape
at the boundary before the call. Raw specs (the owner-preview `decision.changes`)
pass through untouched — this is what makes an owner Accept-all of a budget MCP
proposal actually apply instead of returning "No budget changes to apply."

### 4.6 Tool catalog (project surface unless noted)

| Tool | Surface | Purpose |
|---|---|---|
| `get_schema` | both | every field of every table + enums |
| `get_table` / `get_tasks` / `get_risks` / `get_meetings` / `get_budget` | project | read a record list (the dedicated readers are the same data, shaped per list) |
| `get_changes_since` | project | changelog entries since a cursor — the agent's incremental-sync view |
| `get_pending` | project | the owner's pending review queue (status, counts) |
| `get_proposal_status` | project | one proposal's state, `changeSetId`, and whether it was accepted-with-conflicts |
| `get_apply_report` | project | the per-op report of the last accept |
| `apply_changes` | project | queue diffs/creates/sets/deletes/budget for owner review |
| `validate_changes` | project | dry-run of `apply_changes`, queues nothing |
| `withdraw_changes` | project | withdraw the caller's own pending proposal (owns its idempotency key) |
| `run_monte_carlo` / schedule reads | project | read-only analytics |

### 4.7 Testing the surface

- `tools/qa-mcp-agent-first.cjs` — the fake-DB contract harness: permission
  matrix (AT11), derived-field guard (AT04), rollback honesty (AT05), summary
  parity (AT06), create-then-read round trip (AT19). 140/140.
- `tools/qa-appwide-mcp.cjs` — the app-wide OAuth surface, incl. the wbs-only
  member read matrix (W5b). 60/60.
- `tools/qa-mcp-live-e2e.cjs` — the real Worker + headless Chrome end-to-end:
  PATH-A transport, queue gating, never-auto-apply, and the AT21 volume
  scenario (Phase E: 9 `apply_changes` + 1 `validate_changes` over a
  60-task/9-risk/12-line fixture, one shared change set, Accept-all lands mixed
  applied/collision ops + a 24-change budget batch). Runs API-only in CI
  (`MMGR_QA_NO_BROWSER=1`, 36/36) and full browser in `extended-qa.yml`.
- `test/apply-ops.test.mjs` — the pure accept engine, 16/16 (cycle rollback,
  bad-enum, scope, delete guards, derived-field nulling).

### 4.8 Tier limits and the auto-accept gate

Every MCP limit follows the **project owner's** plan (the app-wide surface uses
the account owner's plan), never the caller's. The frozen matrix lives in
exactly one place — `src/mcp/tier-limits.js` — and `limitsFor(tier)` is the ONE
lookup. `pricing.html` is checked against that table by
`test/tier-limits.test.mjs`, so a plan change edits the table and the page
together.

| Tier | MCP | activeApiKeys | pendingPerKey | dailyOpsPerKey | maxOpsPerCall | largeBudgetPerDay | reportRetentionDays |
|---|---|---|---|---|---|---|---|
| `free` | no | 2 | 0 | 0 | 0 | 0 | 30 |
| `estimator` | yes | 2 | 10 | 300 | 100 | 5 | 30 |
| `contractor` | yes | 5 | 25 | 1000 | 250 | 10 | 60 |
| `company` | yes | 10 | 50 | 3000 | 500 | 20 | 90 |
| `enterprise` | yes | 25 | 100 | 10000 | 500 | 50 | 180 |

Rules that matter when reading the table:

- `limitsFor('')` (empty/absent tier) returns `free`. An unrecognised **paid**
  tier (a legacy id, or one the table has not caught up with) returns
  `contractor` — billing treats unknown paid as paid, never as free.
- `upsellFor(tier)` returns the "higher plan raises this limit" sentence for
  estimator/contractor/company, and nothing for enterprise (no step above it).
- `perCallCap(arrayCap, limits)` is the effective per-call ceiling: the tool's
  own array cap, bounded by the tier's `maxOpsPerCall`.

**Auto-accept** is the one sanctioned path for an agent proposal to reach live
state without an owner click, so its gate is deliberately narrow:

- The policy is **per API key** (`cloud_api_keys.auto_accept`), OFF by default
  on every plan, and its only "on" value is `low-risk`. `autoAcceptEligible(ops,
  auth)` (`src/mcp/auto-accept.js`) is the pure, exhaustive check: a proposal is
  eligible only if **every** op is a `set` of a free-text `notes` field (plus
  `risks.mitigation`), ≤ 50 ops, targeting one record/field. One disallowed op
  sends the **whole** proposal to the owner queue; the accept engine still runs
  afterwards and can refuse, leaving it pending, never half-applied.
- Close-out 3b (owner decision): raising that policy is a **Company and Enterprise** feature only. Estimator and Contractor may still use MCP and the owner-reviewed queue, but an agent may not land changes without the owner's click. `autoAcceptPlanAllowed(tier)` (server) and `mcpAutoAccept()` (client,
  `js/app/entitlements.js`) are the two expressions of the same rule. The server
  is authoritative: `handleCloudApiKeyPatch()` in `src/cloud/api-keys.js`
  resolves the owner tier and refuses with `402` `{error:'enterprise_feature',
  upgradeRequired:'company'}` before any UPDATE; turning the policy OFF is
  always allowed, on every plan. The admin control is disabled with the reason
  below Company.
- Gates: `test/tier-limits.test.mjs` pins the matrix and the eligibility-by-plan
  rule; `tools/qa-mcp-agent-first.cjs` (P6o/P6p) checks the server refusal on
  each tier; `tools/qa-autoaccept-ui.cjs` checks the admin control across all
  five plans plus the downgrade path.


## 5. Dashboard, colour and landing conventions (UX-2026-11-19)

Everything in this section is load-bearing for a hard gate. Read it before
touching the dashboard ring, the WBS/Gantt/Kanban renderers, `js/marketing.js`
or `css/marketing.css`.

### 5.1 The major task, defined once

A **major task** is a top-level work item: a task with no parent, or the item a
group of children rolls up to. `MMGR.MajorTasks` (`js/mmgr-major-tasks.js`) is
the ONLY definition of it and of the groups they form. Do not re-derive "is
this a major" anywhere else.

- `getMajorGroups(state)` returns `{ grouped, groups }`. `grouped: false` means
  the project declares no majors at all - a real state, not an error, and the
  ring draws nothing for it.
- A group carries `members` (the task ids it contains). More than eight groups
  collapse into one "Other" group that concatenates every member - no task is
  ever dropped by the collapse.
- `assignments(state)` returns `task id -> slot number`, or `null` when the
  project is ungrouped. The slot is the one `withColors()` gave the group, so a
  task's stripe and its ring arc can never disagree.

**The one metric.** The dashboard's completion figure is computed from the
same group list: each major contributes its own share, weighted by its work,
and the ring's arc length is that share. If you need a second percentage,
compute it from `getMajorGroups` too rather than inventing a parallel count.

### 5.2 Ring and colour rules

- Geometry: `r = 39`, circumference `245`, stroke `14.4px`, SVG rotated
  `-90deg`. The ring lives in `js/render/dashboard.js`.
- Slots: `withColors()` assigns chart slots by FNV-1a hash of the group key with
  first-fit collision avoidance, so a group keeps its colour when others are
  added or removed.
- The colour reaches the rest of the app as `data-major="<slot>"` on the
  element, and the stylesheet maps the slot to a token:
  `[data-major='N'] { --major-row: var(--major-N); }`. Never emit an inline
  custom property for this - `qa-full` check 38 caps `[style]` at 200 and
  `project.html` must have zero (check 37).
- Every slot colour must clear 3:1 on its own card in all nine themes and all
  eight skins; `tools/verify-major-colors.cjs` is the gate.
- The accents are 4px and one-sided: the WBS row's first cell gets an inset
  box-shadow, the Gantt bar a `::before` stripe (so it does not fight the
  lead-time gradient), the Kanban card a top border.

### 5.3 The navigation helper and the link inventory

`MMGR.Nav` (`js/mmgr-utils.js`) is the ONE in-app navigator. Never write a
second one, and never build a `data-action` handler that switches panels
by hand.

- `Nav.go(url, opts)` takes either a URL or an object
  `{ panel, recordId, filter, col, anchor }`. `showSection()` calls
  `Nav.sectionShown()` at the end so the history entry and the URL hash stay
  in step.
- Deep links: `Nav.fromHash()` maps a hash to a section; `Nav.start()` restores
  the entry's panel and scroll position on `popstate`.
- A miss (`Nav.miss`) inserts a one-line notice at the top of the panel for 6s
  instead of silently doing nothing - a dead link must be visible.
- The link inventory is `qa-dashboard-links.cjs`'s fixture: every number on the
  dashboard that opens records. If you add a counter, add it there.
- Markup contract: `data-nav="1"` plus `data-nav-panel` / `-id` / `-filter` /
  `-col` / `-anchor`. `wireDashNav()` in `js/mmgr-app.js` is the single
  delegated listener.
- Filters are keys into `wbsFilterSpec()` in `js/mmgr-render.js`:
  `overdue`, `atrisk`, `blocked`, `done`, `inprogress`, `week-planned`,
  `week-done`, `carryover`, and `ids:a,b,c`. Add a filter by adding a branch
  there, not by passing a predicate through the DOM.

**The concrete inventory.** Every dashboard number that opens records is a door,
and `tools/qa-dashboard-links.cjs` pins the full set (N1: at least 14 links,
N2-N10: each lands, filters, flashes, and returns via the back gesture). Each
link is a `<a data-nav="1" …>` carrying a subset of `data-nav-panel`,
`data-nav-id`, `data-nav-filter`, `data-nav-col` and `data-nav-anchor`, which
`Nav.go({ panel, recordId, filter, col, anchor })` reads:

| Dashboard figure | Target panel | Link kind | What it opens |
|---|---|---|---|
| Overdue tasks | `wbs` | `data-nav-filter="overdue"` | only the overdue rows, with the filter banner |
| Blocked tasks | `wbs` | `data-nav-filter="blocked"` | only the blocked rows |
| At-risk (due soon) | `wbs` | `data-nav-filter="atrisk"` | only the rows inside the near window |
| In progress / done | `wbs` | `data-nav-filter="inprogress"` / `done` | the matching status rows |
| Open issues | `risks` | `data-nav-panel` + `recordId` | the named issue, flashed |
| Active risks | `risks` | `data-nav-panel` + `recordId` | the named risk, flashed |
| COI expiring | `resources` | `data-nav-panel` + `recordId` | the named stakeholder |
| Budget overrun | `budget` | `data-nav-panel` + `recordId` | the named budget line |
| Weather delay | `wbs` | `data-nav-id` + `anchor` | each affected task card, flashed |
| Kanban column counts | `kanban` | `data-nav-col` | the named column, flashed |

`recordId` (the `data-nav-id` attribute) flashes one record; `col` flashes a
Kanban column; `anchor` flashes the card that is a link's destination. A
`recordId` that no longer exists inserts the one-line `Nav.miss` notice (N8) —
it never navigates to an empty panel. View-only mode walks the exact same links
(N9): navigation is not a write, so it is never fenced. When you add a counter
to the dashboard, add its expected row to `qa-dashboard-links.cjs` in the same
change or the inventory gate goes red.

### 5.4 The landing seam is a wave, not a gradient

`css/marketing.css` -> "BAND-TRANSITION SEAM". Each `.band-seam` is the UPPER
band's flat colour, with `::before` masked by an inline-SVG wave
(`--seam-wave`) filled with the LOWER band's colour, and `::after` masked by a
2px cream stroke (`--seam-line`) drawn out of phase. Both layers are 200% wide
and drift on `transform` only (`seam-drift` 30s, `seam-drift-back` 42s,
opposite directions).

- Never reintroduce `--page-progress` or any scroll coupling. Reduced motion
  and `[data-perf='on']` stop the drift and KEEP the drawing.
- Heights are fixed (64px desktop, 48px phone) so the seam contributes no
  layout shift.
- `qa-landing-motion.cjs` (S1-S8) is the gate; `qa-band-seam.cjs` proves the
  structure and the cheapness.

### 5.5 Card motion

`data-motion="card"` opts a card into the shared treatment: the existing `.rv`
reveal (staggered per row via `--rv-i`), then a 180ms hover/focus lift of 4px,
a deeper shadow, and an icon scale of 1.06. On a fine pointer a small
`pointermove` handler tilts it up to 3 degrees; that handler exists only while
the pointer is over that card. Only `transform` and the paint properties
animate - never a box property.

`.rv-done` is added 900ms after the reveal and hands the card the short
transition. `.aud-item` keeps its own 0.7s ring timings (`qa-landing-ui` L-07
is a hard gate) - if you change the shared transition, re-run that harness.

### 5.6 Role cards and the 3D fallback

The four "one tool for everyone" cards are `<button aria-expanded
aria-controls>` disclosures. The description is in the DOM in every state;
collapsed only clips it. One open at a time, Escape closes, hover opens on a
fine pointer, tap toggles on touch.

The figure ships as an inline SVG silhouette. `js/marketing-roles.js` may
replace it with a three.js figure in the open card, and that is optional by
design:

- one canvas, one renderer, moved between cards - never a second WebGL context;
- the vendored r160 at `/vendor/three/three.module.js` only
  (`verify-three-revision.cjs` pins it);
- at most 1,500 triangles per figure, a 150 x 214 CSS box, DPR capped at 1.5;
- render on demand: a ~1.2s pop, one frame per pointer move, then nothing -
  `window.__mmgrRoleFigures.frames()` must not advance while idle;
- loaded only when `#builtfor` comes within one viewport, and the preference
  checks (Performance Mode, reduced motion, save-data) are re-read on every
  open, so turning Performance Mode on stops the figure.

The SVG path is the product. Never make the 3D required for the card to work.
