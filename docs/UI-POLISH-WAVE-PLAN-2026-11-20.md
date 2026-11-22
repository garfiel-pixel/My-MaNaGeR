# UI polish wave — brand, tooltips, tours, theme, ring, Gantt, sidebar, RACI & inputs

## Status legend
`- [ ]` OPEN · `- [~]` IN PROGRESS · `- [x]` DONE (with commit hash + gate result) · `- [?]` NEEDS OWNER DECISION

> Tick a box only when verified (build + gate + manual pass), and attach the commit hash + gate result — same rule as `docs/history/REFINEMENT-PROGRESS.md:23-28`.

## Context

A follow-up UI/UX wave from the owner, continuing the current UI work. Fifteen work areas:

- [x] **A. Sparkle icon** — generic sparkle on "AI Assistant" and across the app → My MaNaGeR's own brand mark.
- [x] **B. Definition pills / methodology popup** — hover card overlays tabs and blocks clicks; tooltips append an annoying taxonomy pill.
- [x] **C. AI panel "Disconnected" chip** — remove.
- [x] **D. Old-project ring** — flat projects show one green circle → per-**main-task** segments, equal weighting.
- [x] **E. Tours** (calculator + project UI) — remove gold ring, full-target spotlight incl. mobile, smooth scroll, centred intro; buttons stay plain.
- [x] **F. Theme** — remove sign-in gate on Customize (skins are device-local).
- [x] **G. Gantt chart** — explain red line, sticky header, drag-to-pan, auto-cascade on drag/duration (confirm >5, actuals anchored), cross-view consistency.
- [x] **H. Sidebar active section** — "Changes" (Change Control Register) has no "you are here" highlight.
- [x] **I. RACI matrix** — truncated names/roles, wide gaps, no sticky headers, dark `[remove]` buttons, look-clickable empty cells, slow cycle, passive warnings → full UI pass.
- [x] **J. Photo description + undersized inputs** — tiny single-line description box → auto-grow textarea; audit similar fields.
- [x] **K. Status-chip outline** — remove the border around the Active/Planning/On-hold selector; keep the dropdown arrow.
- [x] **L. Project on-hold notice** — in-app banner to collaborators + explicit "finalize" acknowledgement before edits (no email, no backend/CF changes).
- [x] **M. Perf-mode + dark sidebar transparency bug** — launcher rail becomes see-through when Performance mode is on; give it an opaque fallback.
- [x] **N. Cookie-consent polish** — remove the gold outline on the consent buttons; simple accent-style buttons.
- [x] **O. Checkbox tracking file** — one canonical checklist (tickable) covering all items; this plan file is also tickable above.

Greeting note: project-name greeting is **approved** — no change except its sparkle → brand mark.

Branch: fresh `feat/` branch off `origin/main`; commit in logical groups; PR → CI green → merge to `main` (AGENTS #10). `main` untouched until then. Cloudflare ops minimal — verify locally, deploy only after merge.

---

## Changes

### A. Sparkle → My Manager brand icon (full audit)
- [x] Reuse existing monochrome `i-mpw` symbol (`css/mmgr-icons.svg:88`, `css/mpw-mark.svg`) — the "small black skeleton" mark. No new asset.
- [x] Replace `#i-sparkle` → `#i-mpw` where it marks the app/AI: greeting `js/mmgr-render.js:74`; AI header `project.html:1737`, FAB `:1689`, chat/welcome/drawer `:1821,1835,1847,1952,2112`, command card `:354`; bot avatar `js/mmgr-ai.js:2918`; MCP badge `js/app/components.js:103`; cloud `js/cloud/review.js:224`, `js/mmgr-cloud.js:2942`; billing `js/mmgr-billing-manage.js:88,120`; search `js/app/search.js:89,1180,1303`; plan badges `app.html:448` / `admin.html:439`; calculator `calculator.html:801`; marketing `index.html:379`, `features.html:199`, `js/marketing*.js`.
- [x] **Keep** `i-star` for genuine ratings (`index.html:463`, `reviews.html`). Skip stale snapshot `images/pages/project-source.html`.
- [x] `node build.js`; bump calculator `?v=`. — `792adaa` (`verify-icons` ARM 3: 0 generic `i-sparkle` across 205 served files; `qa-full` 196/196)

### B. Definition pills + methodology popup
- [x] `js/app/definitions.js:42` — drop the `entry.group` `<span class="def-badge">`, keep term + meaning. Same pill in `js/mmgr-defs.js:428` (`renderDefs()`). Keep `group` in data, stop rendering it. — `0fcb4d8`
- [x] `.mlc-card` `css/src/35-workspace.css:3059-3075` is `position:fixed; z-index:500` with no `pointer-events`, over the tabs → added `pointer-events:none` (close control `.dc` keeps `pointer-events:auto` so it stays usable). — `0fcb4d8`
- [x] Edit CSS **sources**, rebuild. No harness asserted `.def-badge`, so no re-baseline was needed; added `qa-full` 54b (no pill + hover card click-through, 195/195) in `4194177`. The card deliberately still floats over the tabs visually — it is a hover explainer, and clicks now pass through.

### C. Remove AI "Disconnected" chip
- [x] Remove `#ai-byo-status` markup `project.html:1799`, `.ai-byo-status*` CSS `css/src/40-ai.css` + `css/src/50-calculator.css`, dead `syncByoStatus()` state writes `js/mmgr-ai.js` (kept `syncConnRow()`). — `0fcb4d8`
- [x] Keep the separate `#ai-api-pill` health dot (`project.html:1747`). Rebuilt. `qa-ai` AI23_GATE PASS 0 fails + `qa-ai-polish` 13/13 after re-baselining both onto banner visibility / canonical state / Send gate. — `0fcb4d8`

### D. Old-project ring — per-main-task segments
- [x] Cause: `getMajorGroups()` (`js/mmgr-major-tasks.js:128-217`) groups by `isPhase` rows else `phase` labels; flat old projects have neither → one "Unassigned" group → `grouped:false` → `ringData()` null (`js/mmgr-render.js:146-157`) → single green circle.
- [x] Add a third branch: no phase rows **and** no phase labels → group each work item under its **top-level main task** (level-0 rollup parent / `parentName` root; parentless = own main task). One group per main task; complete when all subtasks are.
- [x] **Weighting (owner's concern):** equal arc width per main task (`share = 1/N`) so a subtask-heavy completed task can't dominate; arc **fill** = subtask completion (0–1), so incomplete tasks stay visible. `points = fill / N` keeps centre % consistent. Reuse 8 hashed colours (`withColors()`, `:282-296`) + neutral "Other" (`mergeOther()`, `:240-280`).
- [x] No state migration (render-time grouping). Do **not** touch phase branch; **no** status segments (would duplicate Health + Kanban). Reuse `renderRingSlots()` / `renderMajorList()` / `wireRingHover()`. Unit test in `test/major-groups.test.mjs`. — `c8c9270` (unit 15/15 incl. 4 flat cases; `qa-dashboard-ring` 52/52 incl. D1-D7; `qa-full` 196/196; verify green)

### E. Tours — calculator (`js/calculator-page.js`) + project UI (`js/mmgr-tour.js`)
- [x] **Remove gold ring/glow:** calculator `.bcp-tour-spot::after` `css/src/50-calculator.css:1008-1017` drop gold border+glows, keep dim `:1005` + native border; project `#tour-ring` inline shadow `js/mmgr-tour.js:210-223` drop two gold rings, keep `9999px` dim. Active dot stays gold. → the `::after` rule is deleted outright; the project ring keeps only `0 0 0 9999px rgba(8,9,11,.72)`. The project card's gold hairline and gold Next pill are neutral too (plain squircle with a hairline). — `7bed291`
- [x] **Full-target spotlight:** calculator `tourVisibleBox()` `:12470-12483` stops at first ≥8×8 ancestor → widen to whole bar/card; remove/raise `tourHuge()` `:12487-12489` (hides spot ≥85% viewport — the mobile failure). Project sizing `:328-333` verify encloses wide targets. → `tourVisibleBox` now rings `closest('.bcp-field')` — the same unit the blur already used — so a labelled row is highlighted with its label; `tourHuge` moved to 0.98 of BOTH dimensions and the overlay carries the dim (`.is-huge`) when no cut-out is possible, so no step is ever undimmed; the project ring keeps a 32px floor centred on the target. — `7bed291`
- [x] **Smooth scroll:** add reduced-motion-gated `behavior:'smooth'` to calculator `:12413,:12561`, mirroring `js/mmgr-tour.js:441-449`. → `tourReduced()` + `tourPlaceStep()`; both scroll sites glide and re-place at 420ms, and the no-room fallback scrolls once per step. — `7bed291`
- [x] **Centred intro:** prepend `sel:null` intro step to `TOUR_STEPS` (`:12257`) and `STEPS` (`js/mmgr-tour.js:38-103`); both engines already centre `sel:null`. Update counts/dots + re-baseline `tools/qa-first-project-tour.cjs:42-53`, `tools/qa-calculator-page.cjs:736-803`, `qa-calc-playwright-audit.cjs`. → calculator 13 → 14 steps, project 10 → 11; T1/T2 re-baselined, the audit walks 13 clicks, `qa-tour` proves the intro is centred and reads the flat-dim arm on a targeted step. — `7bed291`
- [x] **Buttons stay plain** (squircle) per owner. → project Next: transparent fill, hairline, 8px radius; Skip/Back unchanged text buttons with an 8px radius; the calculator's `.btn btn-n btn-s` were already plain. — `7bed291`
- [x] Gates: `qa-tour` 61/61, `qa-first-project-tour` 13/13, `qa-calculator-page` 256/256, `qa-ux-landscape` 58/58, `qa-calc-playwright-audit` T5 PASS, `qa-full` 196/196, `npm run verify` green. — `7bed291`

### F. Theme available without sign-in
- [x] Remove the `signedIn()` redirect block in `app.html:2310-2323` (`case 'customize'`), leaving `MMGR_SKIN.openModal()`. — `0fcb4d8`
- [x] Skins confirmed device-only (`js/mmgr-skin.js:22,49-128`; `js/mmgr-theme.js:16,46,162-169`); no cloud/premium gate. Both entry points funnel here. — `0fcb4d8`
- [x] `app.html` inline scripts → **regenerated CSP hashes** via `node tools/regen-csp-hashes.cjs` (updated `INLINE_SCRIPT_HASHES` in `worker.js` + `serve.cjs`, restarted the QA server). Signed-out Customize probe: modal opens, `#theme-grid` present, no signin redirect. — `0fcb4d8`

### G. Gantt chart — clarity, panning, auto-cascade
- [x] Custom renderer: `js/mmgr-gantt-view.js:337 build()`, `js/mmgr-render.js:3150 renderGantt()`, markup `project.html:656-689`. — `67f60ae`
- [x] **Red line = Today marker** (`js/mmgr-render.js:3552-3554`, style `.gantt-today` `css/src/30-panels.css:3043+`) — only a hover title today → add small visible "Today" legend near toolbar; keep the line. → `.gv-key` + `.gv-key-line` before Export Chart in `project.html`; the line itself unchanged. — `67f60ae`
- [x] **Date header vanishes:** `.gh` (`css/src/30-panels.css:1299-1309`) has no `position:sticky` → add sticky `top:0` + z-index; verify dependency-arrow overlay still aligns (scroll listener `js/mmgr-render.js:3730-3741`). → probed first: `.gc` was `overflow-x:auto` (computing `overflow-y:auto`) yet never scrolled, so a sticky child could not stick. `.gc` is now the bounded scroll area (`overflow:auto; max-height:min(72vh,760px)`), `.gl` clips to the same height, and `wireGanttScrollSync()` mirrors `scrollTop` offset by the header. Probe: `ghTop` stayed 258 after `scrollTop=400`. — `67f60ae`
- [x] **Drag-to-pan only** (owner's clean-UI choice): `pointerdown` on empty `.gc` background writes `gc.scrollLeft` with `grab`/`grabbing` cursor; scoped to background so it never conflicts with bar-drag (`js/mmgr-render.js:4625-4651`). Native touch scroll covers mobile — no buttons. → `_ganttPan` state; a `.gb` target still routes to `ganttDragStart`, `.gb-milestone`/`.gan-link` and touch are left alone. — `67f60ae`
- [x] **Auto-cascade on drag + duration edit** (auto + confirm >5, actuals anchored): `ganttDragEnd` (`js/mmgr-render.js:4499-4568`) single-task (`:4521-4524`) → after commit call `ns.Schedule.cascade()` (engine `js/mmgr-schedule.js:563-641`, `applyPlan():520-557`, confirm gate `:618-639`, >5 threshold `:26`). Duration edit `js/mmgr-tasks.js:375-420` (WBS "Days" `mmgr-render.js:2872`) → same cascade. → `cascade(regionId, {threshold, quiet, skipUndo, render})`; drag passes `skipUndo` (keeps its own snapshot) + `render:false` (paints once). — `67f60ae`
- [x] Keep completed/in-progress anchored (engine `:498-503,:534` — actuals held, still drive successors). Guard cascade to changes with successors/date change to avoid no-op toasts. → verified in `forwardPass`: ES anchors to `t.startDate` when there is no predecessor, and `applyPlan` skips completed/in-progress writes; both call sites pre-check for successors. — `67f60ae`
- [x] **Cross-view:** single source state (`js/mmgr-state.js:2197-2242`) but drag/cascade omit `renderKanban()` (`render.js:4562-4564`, `schedule.js:603-605`) → add to both (WBS edits already do at `tasks.js:489`). This Week follows Dash. → both paths now call `renderKanban()`. — `67f60ae`
- [x] Re-baseline/add: `tools/verify-gantt-view.cjs`, `qa-full.cjs:612-716,1344-1469`, `tools/qa-date-wiring.cjs` — add test: successor `startDate` shifts after predecessor drag/duration change and Kanban shows new date. Register new harness in `docs/CI-TEST-COVERAGE.md` + `ci.yml` (AGENTS lesson 14). → new `tools/qa-gantt-cascade.cjs` 9/9 (G1 sticky header + synced labels, G2 named Today line, G3 pan vs bar-drag, G4 drag cascade + board, G5 duration cascade + board); `verify-gantt-view` 125/125, `qa-date-wiring` 13/13, `qa-full` 196/196; registry row + `ci.yml` T4 step added; `verify-ci-coverage` 12/12. — `67f60ae`

### H. Sidebar active-section highlight
- [x] "Change Control Register" = `chg` panel (`project.html:1164-1166`); sidebar item = "Changes" (`data-section="chg"`, `project.html:288`). Bug: `showSection()` (`js/mmgr-render.js:2329-2413`, active `:2381-2384`) marks only passed button; programmatic opens pass hidden `#sec-nav` original; clone observer (`js/app/sidebar.js:299-319`) syncs only `is-hide`, never `active`; desktop `#sec-nav` is `display:none` (`20-shell.css:1532-1534`).
- [x] Fix after `mmgr-render.js:2384`: also toggle `active` on twin `#app-sidebar .sec-btn[data-section="<section>"]` (or extend `sidebar.js` observer). CSS `.sec-btn.active` exists (`20-shell.css:1631-1636`). Harness guard: `#app-sidebar .sec-btn.active` after `showSec('chg')`. — `2660d78` (`qa-full` 196/196, check 39f)

### I. RACI matrix UI pass
- [x] **Truncated names/roles:** person inputs `width:90px`, task input `min-width:190px` at `people.js:349,357` clip text. Widen task column + allow wrapping; render name bold + role as subtle subtitle (display span, edit border only on hover/focus) instead of stacked inputs; remove inline min-widths; add `title` attributes. CSS near `css/src/30-panels.css:858-934`. → `.raci-person` grid, `width:100%`/`min-width:0` inputs with a transparent border that appears on hover/focus, `title` carrying "Name , Role"; task column is 240-380px and live names wrap. — `c217e53`
- [x] **Scannability:** table `.dt` at `people.js:343-368`; full-row hover exists (`30-panels.css:935-940`), no zebra → add subtle `nth-child` striping + full-row hover; tighten column widths around badges (`.raci-cell` 46px, `30-panels.css:860`) to reduce horizontal scroll. → even-row wash on the cell columns plus a hover wash across task, cell and action columns; `.raci-cell-td`/`.raci-del-td` shrink to content. — `c217e53`
- [x] **Sticky header + first column:** none exists → wrap grid in `overflow:auto` (`people.js:343`) and add sticky `thead th` + first-column rules in `30-panels.css:858+`. → `.raci-scroll` (`overflow:auto`, `max-height:min(70vh,640px)`), `thead th` sticky at `top:0`, `.raci-task-col`/`.raci-task-td` sticky at `left:0` with opaque backgrounds (zebra-aware). — `c217e53`
- [x] **Six dark `[remove]` buttons** (`people.js:350`, `btn btn-s btn-d`, handler `mmgr-app.js:7909`) → replace with subtle `⋮` trigger + popover "Remove column". → `i-more` trigger with `popovertarget`, revealed on header hover/focus (always on touch), and a one-item popover that keeps `delRaciPerson`. The row `×` became a quiet icon button that turns red on hover. — `c217e53`
- [x] **Empty cells:** `<button class="raci-cell">` blank `'·'` (`people.js:362-364`, colours `mmgr-raci.js:96-114`) → subtle dashed outline + faint `+` on hover so R/A/C/I badges pop; keep accessible buttons. → `.is-empty` carries a dashed `--raci-fg` border and a `::after` plus at 0.32 opacity, 0.8 on hover/focus; the placeholder glyph is gone. — `c217e53`
- [x] **Faster entry:** keep click-cycle (`RACI_CYCLE` `mmgr-raci.js:87`, `cycleRaci():116-137`) — do NOT replace with popover (would break `qa-full.cjs:759-792`); ADD direct `R`/`A`/`C`/`I`/`Backspace` keys in existing keydown handler (`mmgr-raci.js:142-154`); update legend (`mmgr-shortcuts.js:49-50`, `project.html:2183-2184`). → `setRaci()` + a direct-key branch; Backspace clears, ArrowLeft still walks the letters; both legends gained the R/A/C/I line. — `c217e53`
- [x] **Inline warnings:** `renderRaciAlerts()` (`people.js:414-453`) already detects zero-A per row, >1 A per row, per-person A>5 (`:440-446`) but renders passive amber text into `#raci-alerts` (`project.html:1476`). Add subtle amber warning icon next to task name for zero-A rows; reuse dead `.raci-gate` CSS (`35-workspace.css:1572-1584`) retinted amber. Keep text alerts. → `.raci-gate` is now a 16px amber disc with `i-alert-triangle` beside the task name on every zero-Accountable row, and it clears the moment an A is assigned. — `c217e53`
- [x] Edit CSS **sources**, rebuild. Re-baseline `qa-full.cjs:759-792,1149-1165,1297-1314`; add checks for sticky/zebra/direct keys/warning icon; register new harnesses. → new `tools/qa-raci-matrix.cjs` 11/11 (R1/R1b/R2 sticky, R3 zebra, R4/R4b menu, R5 empty cell, R6 keys, R7/R7b mark, R8 no error); `qa-full` 196/196; `npm run verify` green; registry + `ci.yml` T4 wired; `verify-ci-coverage` 12/12. — `c217e53`

### J. Photo description + undersized inputs (audit & optimize)
- [x] **Photo description = tiny single-line box (confirmed):** `js/cloud/photos-ui.js:334` `<input class="in" type="text" id="photos-caption-input" maxlength="200">`; bundle twin `:360`. No height, one grid cell, truncated at 200 chars (`:1275`,`:1621`). Rendered by `scaffold()` `:308-369` into `#photos-body` (`project.html:323-331`).
- [x] Convert both caption fields to `<textarea>` + auto-grow, keeping `id`/`maxlength=200`/`aria-label` so `tools/qa-project-photos.cjs:643-652,845,911` (`page.fill`) still passes. CSS for `.photos-form` `css/src/20-shell.css:285-295`, `:489-491`.
- [x] **Add one reusable `autoGrow(el)` helper** in `js/mmgr-utils.js` (mirror the inline `grow()` in `js/mmgr-ai.js:3136-3146`, cap ~160px, toggle `.at-cap`); wire via the existing delegated `input` listener in `js/mmgr-app.js:8554`. No shared helper exists today except the unshipped reference (`monolith html to reference from all features.html:2247-2249`).
- [x] **Similar high-priority cases to fix with the same helper:** risk description + mitigation (`js/render/risks.js:318,331`, helper `:272-282`) and issue description (`:208-210`); incident "What happened" (`js/render/closure.js:276`); notes inputs (`documents.js`, `closure.js`, `financials.js`, `people.js`, `resources.js` — expand-on-focus or `title`); `pg-in` paragraph/callout (`js/render/pages.js:322,344`) and `team-bulk`/`calc-ai` rows=3 — bump min-height. Charter/closure `.cf-ta` (130px) and `ai-q` (auto-grows) are fine — leave.
- [x] CSS constraints: `.dt td input,select,textarea{width:100%}` `css/src/30-panels.css:918-934`; `textarea{resize:vertical}` `35-workspace.css:1269-1271`; `.cf-ta` `:1452-1466`. Edit sources, rebuild.
- [x] Re-baseline `tools/qa-project-photos.cjs`; add a check that the caption is a textarea that grows on input; register in `docs/CI-TEST-COVERAGE.md`.

**Shipped** in `5f7d411` on branch `feat/photo-caption-integration`, merged via PR #31 (original work `6f50665`, `e54d52f`, `3e59169` on `feat/photo-caption`) (Auth-Agent, delegated by this wave and rebased onto it; the tip was amended from `867a98c`, which I verified here at 23/23, to add the render-time fit described below). `MMGR.Utils.autoGrow` fits the content, caps at 160px and sets `.at-cap`; a delegated `input`/`focusin` listener picks up any `[data-autogrow]` box, so `js/mmgr-app.js` — the named split candidate at its size cap — stays untouched. A `MutationObserver` also fits a box when it is rendered and again when its panel gains `.active`, because a box rendered inside a hidden panel has no height to measure — without it, restored text stayed clipped until someone clicked it. Applied to the photo set description, bundle description, risk description and mitigation, issue description, incident "What happened", page paragraphs and callouts; one-line table-cell notes keep their input and carry the full value as a `title` on focus. Gates: `tools/qa-project-photos.cjs` 23/23 with the new G2d (textarea keeps `id`/`maxlength`/`aria-label`, grows, caps, `.at-cap`, and the delegated listener reaches the helper) — run here at `867a98c` and re-run by the branch owner at `77004bd`; `qa-full` 196/196 with check 43 re-baselined to the growing box.

### K. Status-chip outline — remove border, keep arrow
- [x] The selector is a custom button `project.html:180` (`.status-chip#status-chip`, `popovertarget="status-pop"`) with children: `.sdot` dot, `#status-chip-lbl` label, and `<svg class="ico"><use ...#i-arrow-down>` — the arrow to KEEP. Menu `project.html:181-186`; render `js/mmgr-render.js:2038-2064`; handler `js/mmgr-app.js:4859-4883`. — `0fcb4d8`
- [x] Replaced the persistent `border: 1px solid var(--border)` with `1px solid transparent` (keeps hit area + focus-ring geometry) and dropped the hover `border-color: var(--gold)`. Kept `.status-chip .ico` arrow styling and the `:focus-visible` ring. — `0fcb4d8`
- [x] Rebuilt CSS. `tools/qa-cloud-identity.cjs` 16/16 and `tools/qa-controls-ia.cjs` 12/12 (status menu still opens under the chip). — `0fcb4d8`

### L. Project on-hold notice to collaborators
Owner decision: **in-app banner only** (no email, no backend/CF changes) + **warn with explicit "finalize" acknowledgement** before edits (not a hard server lock).
- [x] Every view reads one state (`status` written by `setProjStatus()` `js/mmgr-app.js:4859-4883`; labels `js/mmgr-render.js:2002-2007`; persisted via cloud save `src/cloud/projects.js:559,843-850`). Added `js/mmgr-onhold.js` — one `OnHold` module that reads `state.status === 'on-hold'` and paints `#onhold-banner` in the project header; `renderStatusChip()` calls `OnHold.render()` after `mirrorStatusToRegistry()`, so boot, a status change and the acknowledgement itself all repaint the banner. No new state, no server event, no schema change. — `7a6f293`
- [x] Banner text: "This project was put on hold. Finalize before making changes." Generic by design — `status` carries no actor field and this wave adds no backend schema. One control (`Finalize and continue`), `role="status" aria-live="polite"`, SVG `i-pause` icon (no emoji). — `7a6f293`
- [x] **Explicit finalize gate:** `guardReadonly()` in `js/mmgr-app.js` now refuses when `OnHold.locked()` and the action is outside `READONLY_SAFE_ACTIONS`, reusing the view-only safe set so navigation/read actions keep working; a refused mutating click shows one throttled toast (1500ms) instead of a toast storm. `onholdFinalize` is in `ACTION_MAP` and in `READONLY_SAFE_ACTIONS`, and writes `mmgr_onhold_ack_<projectId> = '1'` to localStorage so it survives reload per project. Front-end only, no hard server block. — `7a6f293`
- [x] Local-only documented: the banner is the delivery mechanism because collaborators are not wired into presence auth and there is no cross-user inbox. Recorded in the `docs/CI-TEST-COVERAGE.md` row for `qa-onhold-gate` as the known limitation. — `7a6f293`
- [x] Added `tools/qa-onhold-gate.cjs` (8 gates: banner inside `#app-header`, owner sentence + single control, `setProjStatus` refused while locked, finalize unlocks and the same click then applies, survives re-read and reload, per-project key, no page error), registered in `docs/CI-TEST-COVERAGE.md` and as a `T4:` step in `.github/workflows/ci.yml`. — `7a6f293`

### M. Perf-mode + dark sidebar transparency bug
- [x] Cause: Performance mode sets `data-perf='on'` on `<html>` (`js/mmgr-perf.js:52-57`) and globally forces `backdrop-filter:none !important` (`css/src/85-performance-mode.css:14-21`). Its solid-fill compensation list (`:43-50`) covers `.top,.dock,#drw,.db-sheet,.drw-sheet,.bcp-top` but **omits `.db-side`**, the launcher rail. In dark mode `.db-side` is `background: var(--glass-fill-dark)` = `rgba(255,255,255,0.04)` + blur (`70-chrome.css:62`, token `20-shell.css:86-88`, `10-tokens.css:45`) — blur off, no opaque fallback → see-through. Light mode uses opaque `var(--card)` (`:358-370`), hence dark-only.
- [x] Minimal fix: added `[data-perf='on'] body.dark-mode.db-page .db-side { background: var(--db-surface-raised) !important; }` in `css/src/85-performance-mode.css` beside the existing solid-fill list, mirroring the proven `prefers-reduced-transparency` fallback. `--db-surface-raised: #1d1d20` is opaque. — `0fcb4d8`
- [x] Added `qa-glass` G03c: forces `[data-perf='on']` + dark + `db-page`, reads the **computed** `.db-side` background alpha (must be 1), then restores state. `GLASS35_GATE PASS`; `tools/verify-perf-boot.cjs` PASS. CSS source + `node build.js`, no inline-script change. — `4194177`

### N. Cookie-consent polish — remove gold outline
- [x] The consent card is JS-injected (`js/consent.js:238-275 build()`, appended to body at `:270`; gated by `<body data-consent-banner="on">`). Buttons: "Accept all" / "Necessary only" / "Choose". Shared across 12 public pages; `privacy.html:229` reuses `.consent-btn`. — `0fcb4d8`
- [x] CSS lives in `css/marketing.css` (authored directly there, NOT in `css/src/`). Removed the gold hover fill/border and the gold focus outline; hover now uses the existing neutral `--lit-navy-05` / `--lit-white-05` tokens and focus uses `currentColor` (the global marketing `:focus-visible` is gold, so the override is required). Kept `accent-color` on `.consent-check` and the base neutral `.consent-btn`. — `0fcb4d8`
- [x] Owner wants a simple corner card with plain buttons, no gold ring. Kept the neutral base button and copy unchanged ("Accept all" / "Necessary only" / "Choose"). — `0fcb4d8`
- [x] Rebuilt `dist/marketing.min.css` via `node build.js`. `css/marketing.css` is under a fixed 176000-byte size cap — the first verbose version went over, so the final edit uses the page's existing tokens and stays at 175976 bytes. Added `tools/qa-consent` B1b (no gold focus ring / hover fill in the applied CSSOM) — 38/38; axe clean both palettes. — `0fcb4d8`, `4194177`

### O. Canonical checkbox tracking file
- [x] Create `docs/UI-WAVE-CHECKLIST-2026-11-20.md`: status legend (`[ ]` OPEN, `[~]` IN PROGRESS, `[x]` DONE, `[?]` NEEDS OWNER DECISION), one checkbox per item A–N + sub-items, grouped by area, with responsible files. Leave all boxes unchecked initially ("empty/ready" file). This plan file is tickable directly above too.
- [x] Follow `docs/history/REFINEMENT-PROGRESS.md:23-28` / `PLANNING-TODO...txt:2`: flip a box only with commit hash + gate result. Link from read-order lists (`AGENTS.md` READ ORDER, `CONTINUATION-DIRECTIVE.md:3`, `EXECUTION-PLAN.md:10-22`). `.md` deploy-excluded — never ships.

### P. Admin MCP panel loading state + chrome-free top-bar controls
Owner report 2026-11-21. Two separate problems: the MCP panel announces a verdict
before it has one, and five controls carry outline/pill chrome the owner does not
want. The lower "start a project" empty state is out of scope by owner request.

- [x] **Never open on the word "Unavailable".** `load()` (`js/app/mcp-admin.js:742-800`)
sets the chip to `Checking...`, keeps `#mcp-admin-body` hidden until
`/api/mcp/config` resolves, and on any non-auth failure jumps straight to
`setChip('Unavailable', 'err')` with an error line and an empty card. Replace it
with three explicit states: **loading** (chip `Loading...`, status
`Loading MCP settings...`, two dim skeleton rows inside the panel), **ready**
(today's UI), **failed** (chip `Could not load`, status naming the reason and
`Press Refresh`, retry visible). Remove `Unavailable` as a label: it is a
conclusion the user cannot act on and reads as "this feature does not exist".
Keep `Offline` for `navigator.onLine === false`.
- [x] **A failed client fetch must not look like zero clients.** In `load()`'s
`/api/mcp/clients` branch the rejection path calls `renderClients([])`
(`js/app/mcp-admin.js:775-790`), so a network error renders
`No client has connected yet.` Replace with `Could not load connected clients.
Press Refresh.` and keep the count badge hidden.
- [x] **Copy connection URL is a plain control.** `admin.html:587`
(`.btn.btn-g.btn-s`) and the inner `Copy` at `admin.html:607` lose the green fill
and the border; keep the clipboard icon and the accessible name. Hover gives a
subtle tint and the text underlines only if the surrounding panel already does
that; `:focus-visible` keeps the standard ring.
- [x] **Refresh is a plain control.** `admin.html:596-598`
(`.btn.btn-n.btn-s` in `.mcp-admin-statusline`) loses its outline and keeps the
hover tint and focus ring.
- [x] **Premium badge loses the pill.** `#plan-badge` (`app.html:447-450`; the rail
mirror is built in `js/mmgr-billing-manage.js:119-127`) drops the gold border and
fill from `css/src/89-code-names.css:88-118` and
`css/src/82-launcher.css:1189-1204`. Keep the icon, the gold text and the
hover/focus behaviour. If a state genuinely needs a container (for example the
paid-through date), use spacing, not an outline.
- [x] **New Project and Import Project lose their outline and fill.**
`admin.html:512-513`. They stay first in the toolbar, keep their icons, and show
themselves as buttons on hover only. Do not touch the empty-state start block
further down the page.
- [x] **Check the MCP chip against the live page before restyling it.**
`.mcp-admin-chip` is already plain text with state colour only
(`css/src/37-mcp-admin.css:13-31`, task #12 on 2026-11-18). If the live admin
page still shows a pill, the deployed bundle predates that change; fix the
deploy, not the CSS.
- [x] **Premium popover breathing room.** `.plan-pop` is 300px wide with 14px
padding, `.plan-pop-h` has 8px below it, and the `.bmg-*` rows sit at 3-6px
margins (`css/src/89-code-names.css:119-152`; cancel block in
`css/src/82-launcher.css`). Raise the popover padding to 18-20px, put 12-14px
under the header, 10-12px between plan rows, and 14px above the action buttons;
confirm the paid-through line and "Premium - manage your subscription" still fit
without touching at 300px and never exceed 100vw on a phone.
- [x] **Prove the controls still behave like controls.** Pointer cursor, hover tint
and the focus ring in light and dark, on all 8 skins. A control that reads as
text must still give feedback on hover; do not remove the focus ring to achieve
the flat look.
- [x] **Admin copy names the four clients.** `admin.html:582` still says "Connect
Claude, Cursor or your own scripts", and `.mcp-admin-steps` (`admin.html:611-620`)
only walks through Claude. Add ChatGPT and Gemini to the lede and the steps,
and state the external limits plainly: ChatGPT needs Business, Enterprise or Edu
for write tools; Gemini needs an eligible personal account (US, 18+). Plain
language, no promises about plan availability. The card is served HTML but holds
no inline script, so no CSP hash changes; the admin page's own inline script is
untouched.
- [x] Rebuild with `node build.js` (admin/app CSS + any touched source), then
re-baseline `tools/qa-mcp-admin-panel.cjs` (chip/status strings and the
copy/refresh selectors) and `tools/qa-billing-orphan.cjs`; run `qa-full` and
`qa-glass` for the rail and popover.

**Shipped** in `5e6d758` on branch `feat/admin-mcp-panel-integration`, merged via PR #32 (original work `7fffefe` on `feat/admin-mcp-panel`) (Auth-Agent, delegated by this wave). Three explicit panel states — loading with two dim skeleton rows, ready, and failed naming its reason and pointing at Refresh — with `Unavailable` gone and `Offline` kept for a real offline browser. A failed client fetch keeps the count badge hidden instead of reading as "no client yet". The five controls lose fill and outline via a doubled `.btn` selector (the workspace layer redefines `.btn` later in the cascade), the Premium badge drops its gold pill in the header, rail and app mounts, the plan popover gains spacing, and the admin copy names ChatGPT and Gemini with their real limits. Gates re-run here at that commit: `tools/qa-mcp-admin-panel.cjs` 30/30, including the four new state gates and the record-name/before-after queue gates; branch owner also reports `qa-billing-orphan` 21/21, CSS integrity, sizes, gold, registry and 496 unit tests green.

### Q. Pricing copy: 33% launch offer + free trials on all plans (owner addition 2026-11-22)
Owner changed the Paddle discount from 100% off to **33% off**, code **KRAFO0TJEO**,
valid until **June 2027**, and enabled a free trial on **every** paid subscription
so anyone can test the app before paying. Text only — no Paddle or pricing logic.
- [x] Promo note: "33% off until June 2027", code `KRAFO0TJEO`, 33% off the plan. — `6f810c2`
- [x] Billing: "Every paid plan starts with a free trial" replaces the Contractor-only first month; end-of-trial prices stated. — `6f810c2`
- [x] Refunds: generic "free trial is not a payment" replaces the Contractor-only line. — `6f810c2`
- [x] `npm run verify` green; SW cache bumped. No inline-script change in `pricing.html` → no CSP hash change. — `6f810c2`

---

## Critical files
`js/app/mcp-admin.js` · `css/src/37-mcp-admin.css` · `js/mmgr-billing-manage.js` · `css/src/89-code-names.css` · `css/src/82-launcher.css` · `js/mmgr-render.js` · `js/mmgr-major-tasks.js` · `js/mmgr-schedule.js` · `js/mmgr-tasks.js` · `js/mmgr-gantt-view.js` · `js/mmgr-raci.js` · `js/render/people.js` · `js/render/risks.js` · `js/cloud/photos-ui.js` · `js/mmgr-utils.js` · `js/calculator-page.js` · `js/mmgr-tour.js` · `js/app/sidebar.js` · `js/app/definitions.js` · `js/mmgr-defs.js` · `project.html` · `app.html` · `calculator.html` · `pricing.html` · `worker.js` · `serve.cjs` · `sw.js` · `css/src/{20-shell,30-panels,35-workspace,40-ai,50-calculator,70-chrome,85-performance-mode}.css` · `css/marketing.css` · `js/mmgr-perf.js` · `js/consent.js` · `qa-full.cjs` · `qa-glass.cjs` · `qa-ai.cjs` · `tools/qa-ai-polish.cjs` · `tools/qa-consent.cjs` · `tools/qa-cloud-identity.cjs` · `tools/qa-controls-ia.cjs` · `docs/UI-WAVE-CHECKLIST-2026-11-20.md`

## Verification gates
- [x] `node build.js` → `npm run verify` (CSP + SW + registry + doc-size gates) — green on all three merged tips, ending at `b6a2f22` with SW `mmgr-shell-v698`.
- [x] Targeted (all green on the merged tips of PRs #28, #31 and #32): `qa-full` 196/196 on each, `tools/qa-first-project-tour.cjs`, `tools/qa-tour.cjs`, `tools/qa-calculator-page.cjs`, `qa-calc-playwright-audit.cjs`, `tools/verify-gantt-view.cjs`, `tools/qa-date-wiring.cjs`, `tools/qa-project-photos.cjs`, `tools/qa-consent.cjs`, `tools/verify-perf-boot.cjs`, `qa-glass.cjs`, `tools/qa-mcp-admin-panel.cjs`, `tools/qa-billing-orphan.cjs`, major-groups unit test, sidebar active check, RACI checks.
- [x] Browser pass (real Chrome, light/dark at 390/768/320px plus the harness battery): signed-out Customize; sparkle→brand mark; no def pill; methodology clickable; AI chip gone; flat ring = equal-width subtask-filled; tours full-target + smooth + centred; Gantt today legend, sticky header, drag-to-pan, drag/duration auto-cascade with confirm + anchored actuals + fresh Kanban; "Changes" highlighted; RACI full names + sticky/first column + ⋮ menu + subtle empty cells + R/A/C/I keys + inline warning; photo caption textarea grows on input; status chip has no border but keeps its arrow; on-hold project shows banner and blocks edits until "Finalize" acknowledged; perf-mode + dark sidebar background opaque, text readable; cookie card has plain accent buttons, no gold outline; MCP panel shows a loading state then the client list (never a bare "Unavailable"); Copy connection URL, Refresh, Premium, New Project and Import Project have no outline at rest and highlight on hover; the premium popover has clear spacing between header, rows and actions. CSP hashes 1:1 vs live header.
- [x] Conventional commits with no AI credit; PRs #28, #31 and #32 each ran CI GREEN before merging to `main` (`3145b72`, `bf9b3ed`, `b6a2f22`). Deploy only after merge.
