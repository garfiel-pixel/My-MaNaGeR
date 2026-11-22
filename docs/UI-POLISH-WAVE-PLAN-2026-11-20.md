# UI polish wave — brand, tooltips, tours, theme, ring, Gantt, sidebar, RACI & inputs

## Status legend
`- [ ]` OPEN · `- [~]` IN PROGRESS · `- [x]` DONE (with commit hash + gate result) · `- [?]` NEEDS OWNER DECISION

> Tick a box only when verified (build + gate + manual pass), and attach the commit hash + gate result — same rule as `docs/history/REFINEMENT-PROGRESS.md:23-28`.

## Context

A follow-up UI/UX wave from the owner, continuing the current UI work. Fifteen work areas:

- [ ] **A. Sparkle icon** — generic sparkle on "AI Assistant" and across the app → My MaNaGeR's own brand mark.
- [ ] **B. Definition pills / methodology popup** — hover card overlays tabs and blocks clicks; tooltips append an annoying taxonomy pill.
- [ ] **C. AI panel "Disconnected" chip** — remove.
- [ ] **D. Old-project ring** — flat projects show one green circle → per-**main-task** segments, equal weighting.
- [ ] **E. Tours** (calculator + project UI) — remove gold ring, full-target spotlight incl. mobile, smooth scroll, centred intro; buttons stay plain.
- [ ] **F. Theme** — remove sign-in gate on Customize (skins are device-local).
- [ ] **G. Gantt chart** — explain red line, sticky header, drag-to-pan, auto-cascade on drag/duration (confirm >5, actuals anchored), cross-view consistency.
- [ ] **H. Sidebar active section** — "Changes" (Change Control Register) has no "you are here" highlight.
- [ ] **I. RACI matrix** — truncated names/roles, wide gaps, no sticky headers, dark `[remove]` buttons, look-clickable empty cells, slow cycle, passive warnings → full UI pass.
- [ ] **J. Photo description + undersized inputs** — tiny single-line description box → auto-grow textarea; audit similar fields.
- [ ] **K. Status-chip outline** — remove the border around the Active/Planning/On-hold selector; keep the dropdown arrow.
- [ ] **L. Project on-hold notice** — in-app banner to collaborators + explicit "finalize" acknowledgement before edits (no email, no backend/CF changes).
- [ ] **M. Perf-mode + dark sidebar transparency bug** — launcher rail becomes see-through when Performance mode is on; give it an opaque fallback.
- [ ] **N. Cookie-consent polish** — remove the gold outline on the consent buttons; simple accent-style buttons.
- [ ] **O. Checkbox tracking file** — one canonical checklist (tickable) covering all items; this plan file is also tickable above.

Greeting note: project-name greeting is **approved** — no change except its sparkle → brand mark.

Branch: fresh `feat/` branch off `origin/main`; commit in logical groups; PR → CI green → merge to `main` (AGENTS #10). `main` untouched until then. Cloudflare ops minimal — verify locally, deploy only after merge.

---

## Changes

### A. Sparkle → My Manager brand icon (full audit)
- [ ] Reuse existing monochrome `i-mpw` symbol (`css/mmgr-icons.svg:88`, `css/mpw-mark.svg`) — the "small black skeleton" mark. No new asset.
- [ ] Replace `#i-sparkle` → `#i-mpw` where it marks the app/AI: greeting `js/mmgr-render.js:74`; AI header `project.html:1737`, FAB `:1689`, chat/welcome/drawer `:1821,1835,1847,1952,2112`, command card `:354`; bot avatar `js/mmgr-ai.js:2918`; MCP badge `js/app/components.js:103`; cloud `js/cloud/review.js:224`, `js/mmgr-cloud.js:2942`; billing `js/mmgr-billing-manage.js:88,120`; search `js/app/search.js:89,1180,1303`; plan badges `app.html:448` / `admin.html:439`; calculator `calculator.html:801`; marketing `index.html:379`, `features.html:199`, `js/marketing*.js`.
- [ ] **Keep** `i-star` for genuine ratings (`index.html:463`, `reviews.html`). Skip stale snapshot `images/pages/project-source.html`.
- [ ] `node build.js`; bump calculator `?v=`.

### B. Definition pills + methodology popup
- [ ] `js/app/definitions.js:42` — drop the `entry.group` `<span class="def-badge">`, keep term + meaning. Same pill in `js/mmgr-defs.js:428` (`renderDefs()`). Keep `group` in data, stop rendering it.
- [ ] `.mlc-card` `css/src/35-workspace.css:3059-3075` is `position:fixed; z-index:500` with no `pointer-events`, over the tabs → add `pointer-events:none` and shift below tab row (def-tooltip already does this at `30-panels.css:2800`).
- [ ] Edit CSS **sources**, rebuild. Re-baseline `qa-full.cjs:1329-1342` (no `.def-badge`) + add methodology-tab-clickable check.

### C. Remove AI "Disconnected" chip
- [ ] Remove `#ai-byo-status` markup `project.html:1799`, `.ai-byo-status*` CSS `css/src/40-ai.css:1183-1208`, dead `syncByoStatus()` state writes `js/mmgr-ai.js:937-963`.
- [ ] Keep the separate `#ai-api-pill` health dot (`project.html:1747`). Rebuild.

### D. Old-project ring — per-main-task segments
- [ ] Cause: `getMajorGroups()` (`js/mmgr-major-tasks.js:128-217`) groups by `isPhase` rows else `phase` labels; flat old projects have neither → one "Unassigned" group → `grouped:false` → `ringData()` null (`js/mmgr-render.js:146-157`) → single green circle.
- [ ] Add a third branch: no phase rows **and** no phase labels → group each work item under its **top-level main task** (level-0 rollup parent / `parentName` root; parentless = own main task). One group per main task; complete when all subtasks are.
- [ ] **Weighting (owner's concern):** equal arc width per main task (`share = 1/N`) so a subtask-heavy completed task can't dominate; arc **fill** = subtask completion (0–1), so incomplete tasks stay visible. `points = fill / N` keeps centre % consistent. Reuse 8 hashed colours (`withColors()`, `:282-296`) + neutral "Other" (`mergeOther()`, `:240-280`).
- [ ] No state migration (render-time grouping). Do **not** touch phase branch; **no** status segments (would duplicate Health + Kanban). Reuse `renderRingSlots()` / `renderMajorList()` / `wireRingHover()`. Unit test in `test/major-groups.test.mjs`.

### E. Tours — calculator (`js/calculator-page.js`) + project UI (`js/mmgr-tour.js`)
- [ ] **Remove gold ring/glow:** calculator `.bcp-tour-spot::after` `css/src/50-calculator.css:1008-1017` drop gold border+glows, keep dim `:1005` + native border; project `#tour-ring` inline shadow `js/mmgr-tour.js:210-223` drop two gold rings, keep `9999px` dim. Active dot stays gold.
- [ ] **Full-target spotlight:** calculator `tourVisibleBox()` `:12470-12483` stops at first ≥8×8 ancestor → widen to whole bar/card; remove/raise `tourHuge()` `:12487-12489` (hides spot ≥85% viewport — the mobile failure). Project sizing `:328-333` verify encloses wide targets.
- [ ] **Smooth scroll:** add reduced-motion-gated `behavior:'smooth'` to calculator `:12413,:12561`, mirroring `js/mmgr-tour.js:441-449`.
- [ ] **Centred intro:** prepend `sel:null` intro step to `TOUR_STEPS` (`:12257`) and `STEPS` (`js/mmgr-tour.js:38-103`); both engines already centre `sel:null`. Update counts/dots + re-baseline `tools/qa-first-project-tour.cjs:42-53`, `tools/qa-calculator-page.cjs:736-803`, `qa-calc-playwright-audit.cjs`.
- [ ] **Buttons stay plain** (squircle) per owner.

### F. Theme available without sign-in
- [ ] Remove the `signedIn()` redirect block in `app.html:2310-2323` (`case 'customize'`), leaving `MMGR_SKIN.openModal()`.
- [ ] Skins are device-only (`js/mmgr-skin.js:22,49-128`; `js/mmgr-theme.js:16,46,162-169`); no cloud/premium gate. Both entry points (`app.html:427,:494`) funnel here.
- [ ] `app.html` inline scripts → **regenerate CSP hashes** (worker.js header command; update `INLINE_SCRIPT_HASHES` + `serve.cjs`). Check: signed-out Customize opens modal, no redirect.

### G. Gantt chart — clarity, panning, auto-cascade
- [ ] Custom renderer: `js/mmgr-gantt-view.js:337 build()`, `js/mmgr-render.js:3150 renderGantt()`, markup `project.html:656-689`.
- [ ] **Red line = Today marker** (`js/mmgr-render.js:3552-3554`, style `.gantt-today` `css/src/30-panels.css:3043+`) — only a hover title today → add small visible "Today" legend near toolbar; keep the line.
- [ ] **Date header vanishes:** `.gh` (`css/src/30-panels.css:1299-1309`) has no `position:sticky` → add sticky `top:0` + z-index; verify dependency-arrow overlay still aligns (scroll listener `js/mmgr-render.js:3730-3741`).
- [ ] **Drag-to-pan only** (owner's clean-UI choice): `pointerdown` on empty `.gc` background writes `gc.scrollLeft` with `grab`/`grabbing` cursor; scoped to background so it never conflicts with bar-drag (`js/mmgr-render.js:4625-4651`). Native touch scroll covers mobile — no buttons.
- [ ] **Auto-cascade on drag + duration edit** (auto + confirm >5, actuals anchored): `ganttDragEnd` (`js/mmgr-render.js:4499-4568`) single-task (`:4521-4524`) → after commit call `ns.Schedule.cascade()` (engine `js/mmgr-schedule.js:563-641`, `applyPlan():520-557`, confirm gate `:618-639`, >5 threshold `:26`). Duration edit `js/mmgr-tasks.js:375-420` (WBS "Days" `mmgr-render.js:2872`) → same cascade.
- [ ] Keep completed/in-progress anchored (engine `:498-503,:534` — actuals held, still drive successors). Guard cascade to changes with successors/date change to avoid no-op toasts.
- [ ] **Cross-view:** single source state (`js/mmgr-state.js:2197-2242`) but drag/cascade omit `renderKanban()` (`render.js:4562-4564`, `schedule.js:603-605`) → add to both (WBS edits already do at `tasks.js:489`). This Week follows Dash.
- [ ] Re-baseline/add: `tools/verify-gantt-view.cjs`, `qa-full.cjs:612-716,1344-1469`, `tools/qa-date-wiring.cjs` — add test: successor `startDate` shifts after predecessor drag/duration change and Kanban shows new date. Register new harness in `docs/CI-TEST-COVERAGE.md` + `ci.yml` (AGENTS lesson 14).

### H. Sidebar active-section highlight
- [ ] "Change Control Register" = `chg` panel (`project.html:1164-1166`); sidebar item = "Changes" (`data-section="chg"`, `project.html:288`). Bug: `showSection()` (`js/mmgr-render.js:2329-2413`, active `:2381-2384`) marks only passed button; programmatic opens pass hidden `#sec-nav` original; clone observer (`js/app/sidebar.js:299-319`) syncs only `is-hide`, never `active`; desktop `#sec-nav` is `display:none` (`20-shell.css:1532-1534`).
- [ ] Fix after `mmgr-render.js:2384`: also toggle `active` on twin `#app-sidebar .sec-btn[data-section="<section>"]` (or extend `sidebar.js` observer). CSS `.sec-btn.active` exists (`20-shell.css:1631-1636`). Harness guard: `#app-sidebar .sec-btn.active` after `showSec('chg')`.

### I. RACI matrix UI pass
- [ ] **Truncated names/roles:** person inputs `width:90px`, task input `min-width:190px` at `people.js:349,357` clip text. Widen task column + allow wrapping; render name bold + role as subtle subtitle (display span, edit border only on hover/focus) instead of stacked inputs; remove inline min-widths; add `title` attributes. CSS near `css/src/30-panels.css:858-934`.
- [ ] **Scannability:** table `.dt` at `people.js:343-368`; full-row hover exists (`30-panels.css:935-940`), no zebra → add subtle `nth-child` striping + full-row hover; tighten column widths around badges (`.raci-cell` 46px, `30-panels.css:860`) to reduce horizontal scroll.
- [ ] **Sticky header + first column:** none exists → wrap grid in `overflow:auto` (`people.js:343`) and add sticky `thead th` + first-column rules in `30-panels.css:858+`.
- [ ] **Six dark `[remove]` buttons** (`people.js:350`, `btn btn-s btn-d`, handler `mmgr-app.js:7909`) → replace with subtle `⋮` trigger + popover "Remove column".
- [ ] **Empty cells:** `<button class="raci-cell">` blank `'·'` (`people.js:362-364`, colours `mmgr-raci.js:96-114`) → subtle dashed outline + faint `+` on hover so R/A/C/I badges pop; keep accessible buttons.
- [ ] **Faster entry:** keep click-cycle (`RACI_CYCLE` `mmgr-raci.js:87`, `cycleRaci():116-137`) — do NOT replace with popover (would break `qa-full.cjs:759-792`); ADD direct `R`/`A`/`C`/`I`/`Backspace` keys in existing keydown handler (`mmgr-raci.js:142-154`); update legend (`mmgr-shortcuts.js:49-50`, `project.html:2183-2184`).
- [ ] **Inline warnings:** `renderRaciAlerts()` (`people.js:414-453`) already detects zero-A per row, >1 A per row, per-person A>5 (`:440-446`) but renders passive amber text into `#raci-alerts` (`project.html:1476`). Add subtle amber warning icon next to task name for zero-A rows; reuse dead `.raci-gate` CSS (`35-workspace.css:1572-1584`) retinted amber. Keep text alerts.
- [ ] Edit CSS **sources**, rebuild. Re-baseline `qa-full.cjs:759-792,1149-1165,1297-1314`; add checks for sticky/zebra/direct keys/warning icon; register new harnesses.

### J. Photo description + undersized inputs (audit & optimize)
- [ ] **Photo description = tiny single-line box (confirmed):** `js/cloud/photos-ui.js:334` `<input class="in" type="text" id="photos-caption-input" maxlength="200">`; bundle twin `:360`. No height, one grid cell, truncated at 200 chars (`:1275`,`:1621`). Rendered by `scaffold()` `:308-369` into `#photos-body` (`project.html:323-331`).
- [ ] Convert both caption fields to `<textarea>` + auto-grow, keeping `id`/`maxlength=200`/`aria-label` so `tools/qa-project-photos.cjs:643-652,845,911` (`page.fill`) still passes. CSS for `.photos-form` `css/src/20-shell.css:285-295`, `:489-491`.
- [ ] **Add one reusable `autoGrow(el)` helper** in `js/mmgr-utils.js` (mirror the inline `grow()` in `js/mmgr-ai.js:3136-3146`, cap ~160px, toggle `.at-cap`); wire via the existing delegated `input` listener in `js/mmgr-app.js:8554`. No shared helper exists today except the unshipped reference (`monolith html to reference from all features.html:2247-2249`).
- [ ] **Similar high-priority cases to fix with the same helper:** risk description + mitigation (`js/render/risks.js:318,331`, helper `:272-282`) and issue description (`:208-210`); incident "What happened" (`js/render/closure.js:276`); notes inputs (`documents.js`, `closure.js`, `financials.js`, `people.js`, `resources.js` — expand-on-focus or `title`); `pg-in` paragraph/callout (`js/render/pages.js:322,344`) and `team-bulk`/`calc-ai` rows=3 — bump min-height. Charter/closure `.cf-ta` (130px) and `ai-q` (auto-grows) are fine — leave.
- [ ] CSS constraints: `.dt td input,select,textarea{width:100%}` `css/src/30-panels.css:918-934`; `textarea{resize:vertical}` `35-workspace.css:1269-1271`; `.cf-ta` `:1452-1466`. Edit sources, rebuild.
- [ ] Re-baseline `tools/qa-project-photos.cjs`; add a check that the caption is a textarea that grows on input; register in `docs/CI-TEST-COVERAGE.md`.

### K. Status-chip outline — remove border, keep arrow
- [ ] The selector is a custom button `project.html:180` (`.status-chip#status-chip`, `popovertarget="status-pop"`) with children: `.sdot` dot, `#status-chip-lbl` label, and `<svg class="ico"><use ...#i-arrow-down>` — the arrow to KEEP. Menu `project.html:181-186`; render `js/mmgr-render.js:2038-2064`; handler `js/mmgr-app.js:4859-4883`.
- [ ] Remove the persistent `border: 1px solid var(--border)` at `css/src/20-shell.css:999` and the now-redundant hover `border-color: var(--gold)` at `:1012`. Keep `.status-chip .ico` arrow styling (`:1019-1023`) and the `:focus-visible` focus ring (`:1015-1018`, accessibility). No JS/markup change.
- [ ] Rebuild CSS. Harnesses to sanity-check: `tools/qa-cloud-identity.cjs:121-153`, `tools/qa-controls-ia.cjs:357-375`, `tools/qa-ux-landscape.cjs:314` (hit-area unaffected).

### L. Project on-hold notice to collaborators
Owner decision: **in-app banner only** (no email, no backend/CF changes) + **warn with explicit "finalize" acknowledgement** before edits (not a hard server lock).
- [ ] Every view reads one state (`status` written by `setProjStatus()` `js/mmgr-app.js:4859-4883`; labels `js/mmgr-render.js:2002-2007`; persisted via cloud save `src/cloud/projects.js:559,843-850`). Add a persistent in-app banner rendered when `state.status === 'on-hold'`, shown to anyone who opens/loads the held project — reuse the local `s.aiInbox` watcher/message pattern (`js/mmgr-watch.js:1-11`, panel `project.html:1690-1702`) or a dedicated banner in the project header. No server event needed since status is already in shared state.
- [ ] Banner text: "This project was put on hold. Finalize before making changes." Include who set it if that's recorded; otherwise keep generic (status is currently set locally without an actor field — do not add backend schema for this wave).
- [ ] **Explicit finalize gate:** require a deliberate "I understand / Finalize" acknowledgement in the banner before edits are allowed; persist the acknowledgement in local state per project so it survives reload. Gate client-side save/edit actions while on-hold and unacknowledged (front-end only, matching the "warn + require finalize" choice — no hard server block).
- [ ] Local-only: because team members aren't wired into the presence WebSocket auth (`src/cloud/presence.js:78-116`) and there's no cross-user inbox, the banner is the delivery mechanism; collaborators see it when they next open/pull the project. Document this limitation in the tracker item.
- [ ] Re-baseline/add QA: opening an on-hold project shows the banner; edits are blocked until "Finalize" clicked; acknowledgement persists on reload. No harness exists today for on-hold — register any new one in `docs/CI-TEST-COVERAGE.md`.

### M. Perf-mode + dark sidebar transparency bug
- [ ] Cause: Performance mode sets `data-perf='on'` on `<html>` (`js/mmgr-perf.js:52-57`) and globally forces `backdrop-filter:none !important` (`css/src/85-performance-mode.css:14-21`). Its solid-fill compensation list (`:43-50`) covers `.top,.dock,#drw,.db-sheet,.drw-sheet,.bcp-top` but **omits `.db-side`**, the launcher rail. In dark mode `.db-side` is `background: var(--glass-fill-dark)` = `rgba(255,255,255,0.04)` + blur (`70-chrome.css:62`, token `20-shell.css:86-88`, `10-tokens.css:45`) — blur off, no opaque fallback → see-through. Light mode uses opaque `var(--card)` (`:358-370`), hence dark-only.
- [ ] Minimal fix: add `[data-perf='on'] body.dark-mode.db-page .db-side { background: var(--db-surface-raised) !important; }` in `css/src/85-performance-mode.css` beside `:43-50`, mirroring the proven `prefers-reduced-transparency` fallback (`70-chrome.css:344-350`). Check obsidian skin: its `--glass-fill-dark` is translucent (`86-theme-obsidian.css:44`) but `--card` is forced opaque (`:23-26`) — verify the chosen token is opaque across all 8 skins.
- [ ] Add a QA assertion: `[data-perf='on']` + dark → computed `.db-side` background is opaque (alpha = 1), text readable. Extend `tools/verify-perf-boot.cjs` / `qa-glass.cjs` (no existing check covers this). Edit CSS source + `node build.js` (no inline-script change → no CSP regen needed).

### N. Cookie-consent polish — remove gold outline
- [ ] The consent card is JS-injected (`js/consent.js:238-275 build()`, appended to body at `:270`; gated by `<body data-consent-banner="on">`). Buttons at `js/consent.js:254-258`: "Accept all" / "Necessary only" / "Choose". Shared across 12 public pages (index/about/contact/features/reviews/privacy/terms/refund/pricing/signin/team-accept); `privacy.html:229` reuses `.consent-btn`.
- [ ] CSS lives in `css/marketing.css:5488-5644` (authored directly there, NOT in `css/src/`). Remove the gold bits: `.consent-btn:hover` `border-color: var(--gold)` + `--gold-50` bg (`:5550-5553`), dark hover `border-color: var(--gold-300)` (`:5622-5625`), and the literal `.consent-btn:focus-visible { outline: 2px solid var(--gold-deep) }` (`:5554-5557`) — replace focus with a neutral accessible ring (`var(--focus-ring)`). Keep `accent-color` on `.consent-check` (`:5577`) or switch to the accent token.
- [ ] Owner wants a simple corner card with plain accent buttons. Use the standard marketing accent CTA `.btn-gold` (`:995-1012`) / base `.btn` (`:973-991`) styling for the primary action rather than bespoke gold outlines; note public pages' accent IS gold, so "regular accent button" reads as the normal filled CTA, not a gold ring. Keep the neutral base `.consent-btn` (`:5537-5549`) for the other actions. No copy change (labels stay "Accept all" / "Necessary only" / "Choose").
- [ ] Rebuild `dist/marketing.min.css` via `node build.js`. Re-baseline `tools/qa-consent.cjs:521-529` (B1 asserts exact labels) and axe (`:920-939`); add a check that no gold border/outline is computed on `.consent-btn`.

### O. Canonical checkbox tracking file
- [ ] Create `docs/UI-WAVE-CHECKLIST-2026-11-20.md`: status legend (`[ ]` OPEN, `[~]` IN PROGRESS, `[x]` DONE, `[?]` NEEDS OWNER DECISION), one checkbox per item A–N + sub-items, grouped by area, with responsible files. Leave all boxes unchecked initially ("empty/ready" file). This plan file is tickable directly above too.
- [ ] Follow `docs/history/REFINEMENT-PROGRESS.md:23-28` / `PLANNING-TODO...txt:2`: flip a box only with commit hash + gate result. Link from read-order lists (`AGENTS.md` READ ORDER, `CONTINUATION-DIRECTIVE.md:3`, `EXECUTION-PLAN.md:10-22`). `.md` deploy-excluded — never ships.

### P. Admin MCP panel loading state + chrome-free top-bar controls
Owner report 2026-11-21. Two separate problems: the MCP panel announces a verdict
before it has one, and five controls carry outline/pill chrome the owner does not
want. The lower "start a project" empty state is out of scope by owner request.

- [ ] **Never open on the word "Unavailable".** `load()` (`js/app/mcp-admin.js:742-800`)
sets the chip to `Checking...`, keeps `#mcp-admin-body` hidden until
`/api/mcp/config` resolves, and on any non-auth failure jumps straight to
`setChip('Unavailable', 'err')` with an error line and an empty card. Replace it
with three explicit states: **loading** (chip `Loading...`, status
`Loading MCP settings...`, two dim skeleton rows inside the panel), **ready**
(today's UI), **failed** (chip `Could not load`, status naming the reason and
`Press Refresh`, retry visible). Remove `Unavailable` as a label: it is a
conclusion the user cannot act on and reads as "this feature does not exist".
Keep `Offline` for `navigator.onLine === false`.
- [ ] **A failed client fetch must not look like zero clients.** In `load()`'s
`/api/mcp/clients` branch the rejection path calls `renderClients([])`
(`js/app/mcp-admin.js:775-790`), so a network error renders
`No client has connected yet.` Replace with `Could not load connected clients.
Press Refresh.` and keep the count badge hidden.
- [ ] **Copy connection URL is a plain control.** `admin.html:587`
(`.btn.btn-g.btn-s`) and the inner `Copy` at `admin.html:607` lose the green fill
and the border; keep the clipboard icon and the accessible name. Hover gives a
subtle tint and the text underlines only if the surrounding panel already does
that; `:focus-visible` keeps the standard ring.
- [ ] **Refresh is a plain control.** `admin.html:596-598`
(`.btn.btn-n.btn-s` in `.mcp-admin-statusline`) loses its outline and keeps the
hover tint and focus ring.
- [ ] **Premium badge loses the pill.** `#plan-badge` (`app.html:447-450`; the rail
mirror is built in `js/mmgr-billing-manage.js:119-127`) drops the gold border and
fill from `css/src/89-code-names.css:88-118` and
`css/src/82-launcher.css:1189-1204`. Keep the icon, the gold text and the
hover/focus behaviour. If a state genuinely needs a container (for example the
paid-through date), use spacing, not an outline.
- [ ] **New Project and Import Project lose their outline and fill.**
`admin.html:512-513`. They stay first in the toolbar, keep their icons, and show
themselves as buttons on hover only. Do not touch the empty-state start block
further down the page.
- [ ] **Check the MCP chip against the live page before restyling it.**
`.mcp-admin-chip` is already plain text with state colour only
(`css/src/37-mcp-admin.css:13-31`, task #12 on 2026-11-18). If the live admin
page still shows a pill, the deployed bundle predates that change; fix the
deploy, not the CSS.
- [ ] **Premium popover breathing room.** `.plan-pop` is 300px wide with 14px
padding, `.plan-pop-h` has 8px below it, and the `.bmg-*` rows sit at 3-6px
margins (`css/src/89-code-names.css:119-152`; cancel block in
`css/src/82-launcher.css`). Raise the popover padding to 18-20px, put 12-14px
under the header, 10-12px between plan rows, and 14px above the action buttons;
confirm the paid-through line and "Premium - manage your subscription" still fit
without touching at 300px and never exceed 100vw on a phone.
- [ ] **Prove the controls still behave like controls.** Pointer cursor, hover tint
and the focus ring in light and dark, on all 8 skins. A control that reads as
text must still give feedback on hover; do not remove the focus ring to achieve
the flat look.
- [ ] **Admin copy names the four clients.** `admin.html:582` still says "Connect
Claude, Cursor or your own scripts", and `.mcp-admin-steps` (`admin.html:611-620`)
only walks through Claude. Add ChatGPT and Gemini to the lede and the steps,
and state the external limits plainly: ChatGPT needs Business, Enterprise or Edu
for write tools; Gemini needs an eligible personal account (US, 18+). Plain
language, no promises about plan availability. The card is served HTML but holds
no inline script, so no CSP hash changes; the admin page's own inline script is
untouched.
- [ ] Rebuild with `node build.js` (admin/app CSS + any touched source), then
re-baseline `tools/qa-mcp-admin-panel.cjs` (chip/status strings and the
copy/refresh selectors) and `tools/qa-billing-orphan.cjs`; run `qa-full` and
`qa-glass` for the rail and popover.

---

## Critical files
`js/app/mcp-admin.js` · `css/src/37-mcp-admin.css` · `js/mmgr-billing-manage.js` · `css/src/89-code-names.css` · `css/src/82-launcher.css` · `js/mmgr-render.js` · `js/mmgr-major-tasks.js` · `js/mmgr-schedule.js` · `js/mmgr-tasks.js` · `js/mmgr-gantt-view.js` · `js/mmgr-raci.js` · `js/render/people.js` · `js/render/risks.js` · `js/cloud/photos-ui.js` · `js/mmgr-utils.js` · `js/calculator-page.js` · `js/mmgr-tour.js` · `js/app/sidebar.js` · `js/app/definitions.js` · `js/mmgr-defs.js` · `project.html` · `app.html` · `calculator.html` · `worker.js` · `serve.cjs` · `css/src/{20-shell,30-panels,35-workspace,40-ai,50-calculator,70-chrome,85-performance-mode}.css` · `css/marketing.css` · `js/mmgr-perf.js` · `js/consent.js` · `docs/UI-WAVE-CHECKLIST-2026-11-20.md`

## Verification gates
- [ ] `node build.js` → `npm run verify` (CSP + SW + registry + doc-size gates).
- [ ] Targeted: `qa-full`, `tools/qa-first-project-tour.cjs`, `tools/qa-tour.cjs`, `tools/qa-calculator-page.cjs`, `qa-calc-playwright-audit.cjs`, `tools/verify-gantt-view.cjs`, `tools/qa-date-wiring.cjs`, `tools/qa-project-photos.cjs`, `tools/qa-consent.cjs`, `tools/verify-perf-boot.cjs`, `qa-glass.cjs`, `tools/qa-mcp-admin-panel.cjs`, `tools/qa-billing-orphan.cjs`, major-groups unit test, sidebar active check, RACI checks.
- [ ] Manual browser pass (local `serve.cjs`): signed-out Customize; sparkle→brand mark; no def pill; methodology clickable; AI chip gone; flat ring = equal-width subtask-filled; tours full-target + smooth + centred; Gantt today legend, sticky header, drag-to-pan, drag/duration auto-cascade with confirm + anchored actuals + fresh Kanban; "Changes" highlighted; RACI full names + sticky/first column + ⋮ menu + subtle empty cells + R/A/C/I keys + inline warning; photo caption textarea grows on input; status chip has no border but keeps its arrow; on-hold project shows banner and blocks edits until "Finalize" acknowledged; perf-mode + dark sidebar background opaque, text readable; cookie card has plain accent buttons, no gold outline; MCP panel shows a loading state then the client list (never a bare "Unavailable"); Copy connection URL, Refresh, Premium, New Project and Import Project have no outline at rest and highlight on hover; the premium popover has clear spacing between header, rows and actions. CSP hashes 1:1 vs live header.
- [ ] Commit (Conventional, no AI credit), push branch, PR → CI GREEN → merge. Verify locally; deploy only after merge.
