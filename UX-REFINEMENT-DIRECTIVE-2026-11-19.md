# UX REFINEMENT DIRECTIVE — My MaNaGeR (usability study, completion ring, links, landing motion)

Audience: the terminal AI that writes and runs all code. Date: 2026-11-19.
Basis: three phone screen recordings (Android Chrome, portrait, 480x1040) of the mobile usability test, the test script (`management_test.pdf`), five owner screenshots of the landing page, and a review of the current code. All items below were agreed with the owner in review. Nothing here is a guess: where evidence was weak, the step says "verify first".

Locate everything by symbol or file name. Line numbers are not given on purpose.

---

## 0. Execution rules (binding, no interpretation)

1. Work the parts in order: A, B, C, D. Every step ends with a GATE. When its gate passes, start the next step at once. Do not ask for confirmation between verified steps.
2. Stop and report only if: (a) a gate fails twice after fixes; (b) a step needs a file outside its stated scope; (c) a data-shape change would alter or drop existing saved data; (d) a green check turns red and the cause is unknown.
3. Tests first where a test can fail before the fix. Write the failing test, watch it fail for the stated reason, then fix.
4. If code differs from this file's description, trust the code, record it under "Deviations" in `docs/UX-DIRECTIVE-LOG.md`, and continue with the closest faithful implementation.
5. Preserve these standing owner rules; no step may weaken them:
   - the brand accent is gold, never orange; no new theme colors; Customize themes stay as they are
   - only the percentage lives inside the completion ring (owner decision 2026-09-12, P2-12); the "Completed N of M tasks" text stays outside it
   - the three hero SVG cards and the marketing canvas and dot-rail rules stay in force
   - Performance Mode (`data-perf="on"`) and reduced motion reach every new animation: when either is on, the animation is off and a static version still renders
   - all dynamic text goes through `U.escapeHtml`; no inline `onclick`; use the existing `data-action` delegation; the `mmgr/no-unsanitized-html` ESLint rule must pass
   - local-first: nothing in this directive may add a network call on page load
6. Repo conventions: function declarations, dated comment tags `UX-2026-11-19 <step id>`, Prettier and ESLint gates. New JS files are registered exactly the way a sibling module (for example `js/mmgr-field.js`) is registered: script tags, build manifest and bundles, service-worker precache, size and registry gates. Bump the service-worker `CACHE` version once per part (A, B, C), not per step.
7. Standard gate battery (end of each part): `npm test`; `node tools/verify-eslint.cjs`; `node tools/verify-prettier.cjs`; `node tools/verify-test-registry.cjs`; `node tools/verify-sw-cache.cjs`; `node tools/verify-contrast.cjs`; `node tools/verify-a11y-labels.cjs`; `node tools/verify-marketing-markup.cjs`; `node tools/verify-perf-boot.cjs`; the full `npm run verify`; plus `tools/qa-marketing-layout.cjs`, `tools/qa-landing-ui.cjs`, `tools/qa-landing-ai.cjs`, `tools/qa-theme-perf.cjs`, `tools/qa-a11y-axe.cjs`. Record the baseline before Part A. No gate may be worse than baseline afterwards.
8. Gate hygiene: a cap or threshold changes only to a value you MEASURED, with the number written in the comment and the log. Never raise a limit just to pass.
9. `docs/UX-DIRECTIVE-LOG.md` is the only progress record: one line per step with id, files and gate evidence. A step is PASS only after its gate output was seen in the current session. At the start of every session read the log and git log, re-run the gate of the last PASS step, continue at the first step without PASS.
10. One commit per step. Back-out is `git revert`.
11. You write all code yourself. New test harnesses reuse the headless-browser pattern already used by the existing `tools/qa-*.cjs` files; do not invent new infrastructure.

---

## PART A — Fixes from the usability test

### A1. Reproduce the landscape problem (tests first)
Create `tools/qa-ux-landscape.cjs`. In the headless browser load these pages at three viewports: phone portrait 390x844, phone landscape 844x390, small landscape 740x360: the Projects list, the calculator (`calculator.html`), the project dashboard in a demo project, and the Customize dialog. Record, per page and viewport: horizontal overflow of the document, elements clipped by the viewport edge, the visible height left for content after sticky bars, and (calculator only) the guided-tour card rectangle versus the spotlight rectangle.
Evidence being reproduced: in landscape the tour card sits on top of the control it explains (step 2 covers the Metric/Imperial toggle), and the header, sticky Estimate bar and tour card leave only a thin strip of page. The code has no landscape or short-screen rules at all (no `orientation` media queries, no `max-height` media queries; the viewport helper only detects portrait).
GATE: the harness runs and its landscape tour-overlap and visible-height checks FAIL for the stated reasons. Record the measured numbers.

### A2. Short-screen and landscape rules
Add shared rules in the existing CSS source files (not per-page hacks), targeting `(orientation: landscape) and (max-height: 500px)` and also any viewport under 500px high:
- Sticky chrome shrinks: app header and the calculator's sticky total bar (`.bcp-totalbar` under `body.bcp-sticky-on`) become one slim line (max 44px each), and the total bar stops being sticky if header plus bar would exceed 35% of the viewport height.
- Dialogs and sheets (Customize, drawers, confirm dialogs): `max-height` of the dynamic viewport height minus safe areas, content scrolls inside, header and Done button always visible. Use `dvh` with a `vh` fallback.
- The side drawer and its menu scroll fully; no item is unreachable.
- Respect safe-area insets on all four sides in landscape (notch).
GATE: in `qa-ux-landscape.cjs`, for every page and viewport: no horizontal document overflow; visible content height at least 45% of the viewport height at 844x390 and 740x360; every dialog's Done or close control is inside the viewport.

### A3. Guided tour card never covers its target
In `js/calculator-page.js` (tour state `tourIdx`) and `css/src/50-calculator.css` (`.bcp-tour-*`):
- Position rule: the card is placed on the side of the spotlight with the most free space (below, above, left, right, in that preference). In short viewports it docks to the left or right edge, max width 280px, vertically centred away from the spotlight. It is never allowed to intersect the spotlight rectangle plus 8px.
- If no placement avoids overlap, scroll the target to the upper third of the viewport first, then place the card at the bottom edge.
- Back, Skip tour and Next are always inside the viewport and at least 44x44 CSS px on coarse pointers.
- Recompute placement on orientation change and resize while the tour is open.
GATE: `qa-ux-landscape.cjs` steps through all 13 tour steps at 390x844, 844x390 and 1280x720 and asserts card rectangle and spotlight rectangle (+8px) do not intersect on every step, and that the three buttons are visible and at least 44px on coarse pointer emulation.

### A4. Touch targets and clipped text
Add one shared rule under `@media (pointer: coarse)`: buttons, `[role="button"]`, switches, tabs, menu items, chips and icon buttons have at least 44x44 CSS px hit area (extend the hit area with padding or a pseudo-element when the visual must stay small). Do this centrally, not per element. Inline links inside paragraphs are exempt.
Extend `qa-ux-landscape.cjs`: enumerate visible interactive elements on the four pages at 390x844 and 844x390 and fail on any under 44px (exempt list kept in the harness with a reason per entry), and fail on any element whose text is clipped without an ellipsis (scroll width greater than client width with overflow hidden).
Evidence: testers reported text "almost cut off", wanted larger buttons, and said some controls were small to tap (Performance Mode switch, drawer items, tour buttons).
GATE: harness green; `qa-a11y-axe` and `verify-contrast` not worse than baseline.

### A5. Sign out asks first
Every sign-out entry point must go through one shared confirm dialog: the account row in the sidebar (`js/mmgr-google-auth.js`), the marketing sheet (`js/marketing.js`), the sign-in confirmation block (`js/signin.js`), and `syncSignOut` in `js/mmgr-app.js`. The handler that is called today signs out with no question (tester: "not warned before signing out").
Dialog spec: in-app dialog (not `window.confirm`), title "Sign out?", body "Your work stays saved on this device. Cloud projects stay in your account." Buttons: "Stay signed in" (default focus) and "Sign out". Escape and outside tap choose "Stay signed in". Focus trap, 44px targets, works in landscape (A2).
Unsynced-changes rule: if the sync layer can report changes not yet backed up, the body adds "N changes have not been backed up yet." and a third button "Back up now" that runs the existing backup and then returns to the dialog. If the sync layer cannot report this, do not invent a count; record that in the log.
GATE: new `tools/qa-signout-confirm.cjs`: every entry point opens the dialog; "Stay signed in" and Escape leave the session intact; "Sign out" signs out; existing sign-in and sign-out harnesses (`qa-oauth`, `qa-cloud-phase1`, `qa-cloud-phase2`, `qa-api-keys`) not worse than baseline.

### A6. View-only AI assistant must not fail after the user types
Evidence (seen on screen, not said aloud): in a demo project the user opens the AI Assistant, loads a preset, presses Send, and gets the toast "View-only mode, read-only access. Contact the admin for full access." (guard in `js/mmgr-app.js`).
Decision tree, in this order:
1. Inspect what Send does. If it only reads the project and runs on this device, the guard is too broad: narrow it so asking questions and running presets work in view-only mode. Only actions that WRITE to the project (applying AI-proposed edits) stay blocked, and those show the existing message at the moment of the write.
2. If Send is genuinely blocked for view-only users for a stated reason (cost, permissions), disable the input and Send button up front and show one inline line above them: "Demo projects are view-only. Create your own project to ask the assistant about it." with a "Create a project" button. The user must never be allowed to type and then be refused.
Record which branch applies and why.
GATE: new test in `tools/qa-signout-confirm.cjs` (or a sibling harness) opens the AI panel in a demo project: branch 1 asserts a preset answers without the toast; branch 2 asserts Send is disabled with the inline line and no toast can be triggered.

### A7. Landing "Who we are" says what the product is and who it is for
Tester said the section did not make clear what the app is for and who it is for. In `index.html` (`.who-band`, `.who-head`) make the first sentence of the lead paragraph exactly: "My MaNaGeR is project management software for construction: schedule, budget, risks and site records in one place, built for general contractors, project managers, superintendents and trade leads." Keep the existing local-first sentence after it. Do not change the headings or the cards in this step.
GATE: `verify-marketing-markup`, `qa-landing-ui` green.

### A8. Theme color check (verify only)
A tester may have said the AI button does not follow the chosen theme (low confidence). Verify: for every Customize theme and accent, read the computed color of the AI floating button and the AI panel accent. If any is a hard-coded color instead of the theme accent token, switch it to the token. If it already follows the theme, change nothing and log the evidence. Do not alter any theme's palette.
GATE: a test iterating all themes asserts the AI button color equals the theme accent token.

### A9. Part A close
Run the standard battery.
GATE: battery not worse than baseline; A1 harness now fully green.

---

## PART B — Project dashboard: completion ring, contributors, links

### B1. Major tasks, defined once
Create one pure module `js/mmgr-major-tasks.js` exposing `getMajorGroups(state)`. A "major task" is a headline row with subtasks beneath it (for example "Site preparation" with site grading and temporary fences under it). Use this source order:
1. Rows with `isPhase` true are the majors, in plan order. Their subtasks are rows whose `parentName` equals the major's name or whose `parentId` equals its id (the same match the schedule engine uses in `rollupPhases`). Deeper descendants count toward their top-level ancestor.
2. If no row has `isPhase`, group by each task's `phase` label (the demo project uses labels like planning and procurement), in order of first appearance, with the label capitalised as the name.
3. If neither exists, return no groups and the dashboard keeps today's single ring.
Counting rule (one metric everywhere): a work item is a task that is not a phase row and not a roll-up parent (reuse `workItems` in `js/mmgr-kanban.js`; do not copy it). Completed means status `completed`. For each group return: id, name, total work items, completed work items, completion fraction, share of project (group total divided by project total), points contributed (group completed divided by project total times 100).
The overall figure equals completed work items divided by total work items, which is the number the ring shows today, so the sum of all groups' points equals the center percentage exactly.
GATE: `test/major-groups.test.mjs` (pure, node:test) covers phases with nested subtasks, the `phase`-label fallback, the no-groups fallback, a major with zero work items (omitted), and asserts sum of points equals overall completion.

### B2. Stable colors
Define eight chart color tokens `--major-1` to `--major-8` built only from the existing palette (no new hues beyond what the app already ships), with light and dark values. Each must have at least 3:1 contrast against the card background in every theme (non-text graphics). A major's color index comes from a stable hash of its id, with first-fit collision avoidance among the current groups, so a color does not change when tasks are reordered. More than eight majors: the seven largest keep colors and the rest merge into one neutral "Other" slot.
GATE: extend `tools/verify-contrast.cjs` (or add a sibling check) to cover the eight tokens in every theme; test for color stability under reordering.

### B3. The ring
In `js/mmgr-render.js` (ring renderer near `.pring`, constant `circ = 2*pi*39`) and `css/src/30-panels.css` (`.pring`): replace the single stroke with one SVG arc per group.
- Slot angle is proportional to the group's share of project work items, with a 2-degree gap between slots.
- Each slot has a faint track (its color at about 22% opacity) and a solid arc from the slot start whose length is the group's completion fraction.
- Center shows only the overall percentage (standing rule). Keep the existing one-quarter-turn entry sweep (`ring-in`); it is off under reduced motion and Performance Mode.
- No groups: render exactly as today.
- Accessibility: the SVG has `role="img"` and an `aria-label` summarising overall percentage and the top three contributors; color is never the only carrier of meaning because B4 lists everything in text.
- Tapping or hovering a slot highlights the matching row in B4 and vice versa.
GATE: `tools/qa-dashboard-ring.cjs` on the demo project and on a synthetic project: slot arcs sum to the center percentage within 0.1 point; slot colors match the B2 tokens; no groups gives the old single ring; under Performance Mode no animation runs; light and dark themes pass contrast.

### B4. "What is driving completion" list under the ring
Fill the empty space under the ring with a list: top five majors sorted by points contributed (highest first), then a "Show all (N)" toggle. Each row: color dot, name (escaped), "done of total", a thin bar of that group's own completion, and "+X.X pts" (one decimal). Rows with zero completed sort last. If nothing is completed yet, show "No tasks completed yet" and hide the points. Each row is a link (B5) to that major in the plan. Rows are at least 44px high.
GATE: covered by `qa-dashboard-ring.cjs`: order, one-decimal points, Show all toggle, empty state, 44px row height on coarse pointer.

### B5. One navigation helper and the link inventory
Find how the app switches panels today (sidebar and panel switch code) and add one helper, `Nav.go({panel, recordId, filter})`, that reuses it. Requirements:
- After navigating, the target record is scrolled into view and gets a short outline pulse (none under reduced motion).
- The browser and phone back gesture returns to the dashboard with its scroll position restored (the usability test asked whether getting back was easy). If the app has no history integration for panel switches, add history entries using the existing hash conventions.
- Works in view-only and demo projects.
- A target that no longer exists shows a one-line notice instead of a blank panel.
Make these dashboard items links (whole row is the link, with a chevron, 44px high, record names escaped): every row in Attention (task to its task, blocked to the Kanban blocked column, issue to its issue, risk to its risk, compliance item to its record, budget overrun to its budget line); This Week (the three counters open the task list filtered to that set, and any listed task opens the task); Project Health counters (In Progress, At Risk, Blocked, Done, Overdue, Issues, Compliance open the filtered list); Next 3 Priority Actions (the task); Baseline Variance rows (the task); Earned Value cards (the EVM view); Weather delay affected tasks (the task list for those tasks). Where a destination panel cannot focus a single record or apply a filter, add that capability once in the shared helper, not per panel.
GATE: `tools/qa-dashboard-links.cjs` enumerates every `data-nav` element on the dashboard of the demo project and clicks each: it must land on the right panel, show the record or filter, and the back gesture must return to the dashboard. Zero dead links. `verify-a11y-labels` green.

### B6. Color carry-through
Apply the major's color as a 4px accent on the major's Gantt bar, the WBS row marker, and a top stripe on Kanban cards of that major's subtasks. Nothing else is restyled. It uses the B2 tokens, follows themes, and is hidden when there are no groups.
GATE: visual-smoke assertion in `qa-dashboard-ring.cjs` that the three surfaces use the same color as the ring slot for the same major.

### B7. Part B close
Standard battery.
GATE: not worse than baseline; B harnesses green.

---

## PART C — Landing page motion

### C1. Section seams become a calm drifting wave
Evidence: the six `.band-seam` dividers in `index.html` (and any other marketing page, grep all `*.html`) are 56px full-width strips fading from the dark navy to cream with a gold line and halo that move with scroll (`--page-progress` set in `js/marketing.js`, styles in `css/marketing.css` section "BAND-TRANSITION SEAM"). The owner dislikes the dark band, the straight gold line and the scroll coupling.
Replace them as follows, using only existing color tokens:
- The seam's background is the upper band's color and a wave path filled with the lower band's color forms the boundary, so the boundary itself is a gentle wave (amplitude 10 to 14px desktop, 8px mobile, height 64px desktop and 48px mobile). No gradient fade through black.
- One thin cream stroke (2px, about 55% opacity, cream token) undulates just inside the dark side, out of phase with the edge. It is the "continuous line"; it is quiet, never the dominant element.
- Motion is independent of scrolling: both layers drift sideways slowly in opposite directions (edge about 30s per loop, stroke about 42s) using only `transform` on a pseudo-element twice the width (compositor-only, no paint animation, no JS, no rAF).
- Remove the gold line, the gold halo and every use of `--page-progress` by seams. If nothing else reads `--page-progress`, remove the scroll update that sets it; if something does, leave it.
- Reduced motion and Performance Mode: the wave and stroke render static (not removed).
- Keep the seams `aria-hidden`; fixed height so there is no layout shift.
GATE: `qa-marketing-layout` and `qa-landing-ui` green; `verify-perf-boot` not worse; a new check asserts: keyframes touch only `transform`; computed `animation-name` is `none` under reduced motion and under `data-perf="on"`; no seam consumes `--page-progress`; layout shift contribution of seams is 0.

### C2. Light motion on the four card rows
Rows: the four step cards (`.steps .step`, "Pick your methodology" and the others), the "An account is optional. Your data is not." cards (Export Anytime, Optional Google Sync, Field-Level Merge, No Servers Ever), the solution cards (`.sol-card`), and the why cards (`.why-card`). One shared treatment applied by a `data-motion="card"` attribute:
- Staged reveal reuses the existing `.rv` system (do not add a second one).
- Hover and keyboard focus: lift 4px with a slightly larger shadow, icon scales to 1.06, 180ms.
- Fine pointers only: a tilt of at most 3 degrees following the pointer, driven by one small handler attached only to the hovered card, using `requestAnimationFrame` while the pointer is inside. Disabled on coarse pointers, reduced motion and Performance Mode.
- Only `transform` and `opacity` animate.
Fix the defects visible in the screenshots in the same step:
- The large numerals 01 to 04 on the step cards are clipped by the card's top edge: they must sit fully inside the card.
- The faded decorative glyphs on the account cards (arrow, upload arrow, sync, lock) overlap body text: reserve a corner area for them and keep text out of it, with glyph opacity at most 0.06. The harness asserts the glyph rectangle does not intersect any paragraph rectangle.
- The card rows look left-heavy in the screenshots (larger right margin than left); measure at 1280, 1440 and 1920 widths and center or fill them if the measurement confirms it. If it does not, log "not reproduced".
GATE: `tools/qa-landing-motion.cjs`: no glyph or numeral overlaps text or is clipped, on all four rows at 390, 1280 and 1920 widths; hover lift present on fine pointer and absent on coarse; animations only touch `transform` and `opacity`; none under reduced motion or Performance Mode; `verify-contrast` and `qa-a11y-axe` not worse.

### C3. Role cards with 3D silhouettes
The role cards are the four `.audience .aud-item` cards in `index.html`: General Contractors, Project Managers, Superintendents, Sub and Trade Leads. Today each is an icon, a title and one line.
Behavior:
- Hover, keyboard focus or tap makes the card pop (scale about 1.06 with a gentle 3D tilt) and open a detail area with: the role title, a two-sentence description, and a silhouette figure.
- Cards are real buttons (`aria-expanded`), Enter or Space toggles, Escape closes, only one open at a time. On touch, tap opens and a second tap closes. Collapsed state looks as today. The description text is always in the DOM and readable, not hover-only.
- Descriptions, exactly (owner may edit later):
  - General Contractors: "You carry the whole job. See schedule, budget, risks and site records on one screen, and know where the project stands before the owner asks."
  - Project Managers: "You keep the plan honest. Dates cascade when the schedule moves, budgets track earned value, and reports write themselves from live numbers."
  - Superintendents: "You run the day on site. Log work, weather delays and field reality, and see what is due this week without leaving the job."
  - Sub and Trade Leads: "You own your scope. See your tasks and who is responsible, with clear roles and handoffs between trades."
- Silhouettes (owner's direction): Project Manager in a suit holding a tablet; General Contractor in a hard hat at a laptop; Superintendent in a hard hat and hi-vis vest with a clipboard; Sub and Trade Lead in a hard hat with a tool belt holding a level.
3D build (light by design):
- Reuse the vendored three.js already used by `js/marketing-globe.js`; never load a second copy; keep `verify-three-revision` green.
- One shared canvas and one renderer for all four figures, created only after page load when the Built For section is within one viewport of the screen (IntersectionObserver). Nothing loads before first paint or affects LCP.
- Figures are low-poly primitives, flat-shaded, ink-dark silhouette with a thin gold rim light (gold, not orange). Budget: at most 1,500 triangles per figure. Canvas at most 280x340 CSS px, device pixel ratio capped at 1.5.
- Render on demand: animate only during the roughly 1.2s pop transition and while the pointer moves, then stop. No idle `requestAnimationFrame` loop.
- Fallback (no WebGL, reduced motion, Performance Mode, data saver, or a failed load): author four inline SVG silhouettes with the same poses and show them with the CSS-only pop. The page must be complete and attractive without any 3D.
- Added JS (excluding three.js) at most 25 KB gzipped, measured and recorded; no new network request before idle.
- Figures are decorative (`aria-hidden`).
GATE: `tools/qa-landing-motion.cjs` (role section): all four cards open and close by mouse, touch emulation and keyboard; only one open at a time; description text is present in the DOM for all four while collapsed; the 3D canvas does not exist before the section nears the viewport; no `requestAnimationFrame` activity when idle (instrumented); with Performance Mode on and with WebGL disabled the SVG fallback renders; `verify-perf-boot` and `verify-marketing-markup` not worse; measured JS size recorded.

### C4. Part C close
Standard battery.
GATE: not worse than baseline; C harnesses green.

---

## PART D — Registry, CI, docs

### D1. Wire the new harnesses
New files: `tools/qa-ux-landscape.cjs`, `tools/qa-signout-confirm.cjs`, `tools/qa-dashboard-ring.cjs`, `tools/qa-dashboard-links.cjs`, `tools/qa-landing-motion.cjs`, `test/major-groups.test.mjs`. Add each to `.github/workflows/ci.yml` next to similar landing and dashboard harnesses, and to `docs/CI-TEST-COVERAGE.md` using the tags the registry gate expects (if the file is missing from the repo, record that and create it in the format the gate reads). If a headless harness takes longer than 90 seconds, put it in the extended and nightly workflows and record the measured time.
GATE: `verify-test-registry` green; every new harness is referenced by name in a workflow file (confirm by search).

### D2. Docs and final report
Update `docs/DEVELOPER-GUIDE.md`: major-task definition and the one metric, ring and color rules, navigation helper and link inventory, seam wave, card motion, role cards and the 3D fallback rules. Finish `docs/UX-DIRECTIVE-LOG.md` with the Deviations section.
Final report to the owner, plain text, at most 25 lines: what changed per part, deviations, measured values for any changed cap, which A6 branch applied, whether A8 found anything, and whether the card-row alignment issue reproduced.
GATE: full `npm run verify` green and not worse than baseline anywhere.

---

## Definition of done
1. Every step PASS in the log with gate evidence from the current session.
2. In landscape the tour never covers its target, visible content height meets the thresholds, and no page overflows horizontally.
3. Sign out always asks first; the AI assistant never lets a view-only user type into a dead end.
4. The completion ring shows one colored slot per major task, the center percentage equals the sum of solid arcs, and the contributors list sits under it with working links; every dashboard number listed in B5 opens its records and the back gesture returns to the dashboard.
5. The scroll seams are calm drifting cream waves with no black band and no scroll coupling; all four card rows have light motion; the four role cards open with silhouettes, with a full SVG fallback.
6. No gate is worse than baseline; the new harnesses are in CI.
