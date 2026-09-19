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
| `mmgr-net.js` | 248 | `Config`, `Net` | Central config object (future API keys/endpoints — empty by design) + fetch wrapper. |
| `mmgr-perf.js` | 95 | `Perf` | Device-level Performance Mode. ON/OFF gates WebGL starfield, 3D tilt, heavy CSS blur layers. Must load before viewport/dock read it. |
| `mmgr-theme.js` | 183 | `Theme` | Light/Dark/System helper, early-load so theme applies before first paint. Shared by every page. |
| `mmgr-render.js` | 2,390 | `Render` | Rendering engine: `renderDash()` (dashboard), `renderWbs()`, `renderGantt()`, `drawDependencyArrows()`, plus RAF-wrapped dispatch of the `js/render/*` sub-renderers. |
| `js/render/*.js` | — | `Render` | Render sub-modules extracted from mmgr-render.js: `financials`, `people`, `closure`, `documents`, `weather`, `kanban`, `risks`, `resources`. Loaded *before* mmgr-render.js which wraps them. |
| `mmgr-app.js` | 2,578 | `App` | Application controller: `init()` boot, access gate, delegated `data-action` dispatch (`ACTION_MAP`), drawers/modals/toast, keyboard shortcuts, mention dropdown, Gantt PNG export. |
| `js/app/*.js` | — | `App` | App sub-modules extracted from mmgr-app.js: `components`, `confirm`, `copy-text`, `sidebar`, `weather`, `backup`, `export`, `history`, `definitions`. |
| `mmgr-tasks.js` | 623 | `Tasks` | WBS/task CRUD: add/edit/indent, `updTaskField`, `wiCommit` (work-item commit). |
| `mmgr-schedule.js` | 849 | `Schedule` | CPM engine: topological sort, forward/backward pass, float, critical path, weather padding, resource conflicts, `audit()`. **Purity contract**: pass functions are pure — they never mutate live tasks. |
| `mmgr-risks.js` | 215 | `Risks` | Risk & issue CRUD. |
| `mmgr-resources.js` | 428 | `Resources` | Resource & budget management (rates, allocation, utilization, budget lines). |
| `mmgr-stakeholders.js` | 198 | `Stakeholders` | Stakeholder register, change control, logs. |
| `mmgr-bids.js` | 848 | `Bids` | Bid leveling + Go/No-Go weighted scoring (packages, leveled grid, per-sub actions). |
| `mmgr-charter.js` | 498 | `Charter` | Project charter & KPI management. |
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
| `mmgr-sync.js` | 299 | `Sync` | Optional Google identity for sync labelling. Never gating. |
| `mmgr-google-auth.js` | 1,798 | `GoogleAuth` | Optional operator identity: GIS load, `showUser`, email+password auth (`wireEmailAuth`, `mountPasswordControl`), marketing-page sign-in sheet. |
| `mmgr-cloud.js` | 2,423 | `Cloud` | Cloud Backup & Recovery section (Controls drawer): owner/editor codes, save/load/recover, changelog+revert. **Strictly opt-in per project.** Server-side scope enforcement is the real gate; UI greying is UX only. |
| `js/cloud/*.js` | — | `Cloud` | Cloud sub-modules: `diffs`, `scope`, `share`, `review`, `webhooks`. |
| `mmgr-cloud-dash.js` | 724 | `CloudDash` | "My Cloud Projects" launcher dashboard (app.html). Self-contained on purpose — loads before mmgr-utils; degrades silently without the Worker. |
| `mmgr-pool.js` | 237 | `Pool` | Cloud shared resource pool client (C23): list/link/unlink pool rows, owner-gated server-side. |
| `mmgr-presence.js` | — | `Presence` | Real-time presence WebSocket (project.html only, opt-in): quiet "N online" chip; hides entirely on any failure. Shares `{name, since}` only. |
| `mmgr-templates.js` | 217 | `Templates` | Save current state as template / apply template to a project (C24). |
| `marketing.js` | 704 | — | Marketing pages (index/features/about/contact): nav dropdowns, contact form, etc. |
| `reviews.js` / `verify.js` / `reset.js` | — | — | Marketing-bundle helpers (reviews wall, code verify, reset flows). |
| `demo-data.js` / `projects-data.js` | — | — | Launcher seed data. |

*(~Lines marked "—" were minor at analysis time; see `wc -l js/*.js` for current numbers.)*

---

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
