# UX Refinement Directive - execution log

Directive: `UX-REFINEMENT-DIRECTIVE-2026-11-19.md` (Parts A-D).
Rule: one commit per step. A step is PASS only after its gate output was seen in
the current session.

## Baseline (recorded 2026-11-19, before Part A)

| Gate | Result |
|---|---|
| `npm run verify` | exit 0 |
| `npm test` (inside verify) | pass |
| `tools/verify-eslint.cjs` | 0 errors, 1006 warnings (ceiling 1286) |
| `tools/verify-prettier.cjs` | pass |
| `tools/verify-test-registry.cjs` | pass |
| `tools/verify-sw-cache.cjs` | `mmgr-shell-v672` newer than all 63 assets |
| `tools/verify-contrast.cjs` | 16 passed, **2 pre-existing failures** (`gold on card` 2.10:1 in two palettes). Not wired into `npm run verify`; recorded as the baseline, not fixed - the standing owner rule forbids changing a palette. |
| `tools/verify-a11y-labels.cjs` | pass |
| `tools/verify-marketing-markup.cjs` | pass |
| `tools/verify-perf-boot.cjs` | pass |
| `tools/qa-marketing-layout.cjs` | 6 FAIL - dot rail (`majorW >= 12`); see A0 below |
| `tools/qa-landing-ui.cjs` | 70/70 |
| `tools/qa-landing-ai.cjs` | 20/20 |
| `tools/qa-theme-perf.cjs` | 21/21 |
| `tools/qa-a11y-axe.cjs` | 7/7 |

### A0 (pre-step, harness re-baseline)

`qa-marketing-layout` demanded a major dot of at least 12px. The owner shrank it
to 8px on 2026-11-01 ("the bigger dots can be cut down ... the smaller one looks
fine") and the harness was never updated. It also measured the PAINTED rect, so
the active dot's 1.5x scale made the same dot read 5px or 8px depending on which
section was active.

Re-baselined to layout width (`offsetWidth`) and to the owner's ranks
(major 8, minor 5, major > minor). No app change. `MARKETING LAYOUT PASS`.

## PART A

### A1 - landscape reproduction (tests first)

`tools/qa-ux-landscape.cjs` created. Pages: projects list (`app.html`),
`calculator.html`, project dashboard (`project.html?id=demo-project`), Customize
dialog. Viewports: 390x844, 844x390, 740x360, 1280x720.

First run: **34 passed, 6 failed** - the gate the directive asked for.

Measured failures:

- `L2b` tour card share of viewport height: **45% at 844x390, 49% at 740x360**
  (limit 35%). The card is a full-width block over a 360-390px screen.
- `L3` tour card vs spotlight (+8px): **13 of 13 steps flagged in every
  viewport**. Two distinct causes:
  - the card is placed 6px below the spotlight's own edge, which is inside the
    8px clearance the directive requires (portrait, every step);
  - in landscape there is no room above or below, so `positionTourPop()` clamps
    to `top: 12` and the card lands on the control (step 2 at 740x360: card
    12..167, spotlight 156..241).
- `L3` buttons: Back / Skip / Next measure **28px high** at every viewport on a
  coarse pointer.
- `L3` step 1 spotlight is degenerate: `#calc-work` measures 0x0 at (0,0), so the
  cutout sits in the corner and highlights nothing (the native select is hidden
  behind the custom picker; the visible box is its `.bcp-field` wrapper).

`L1` (horizontal overflow) and `L2` (content height with chrome) pass at every
page and viewport, so the "thin strip" is the tour card, not the chrome alone.

Commit: `test(ux): reproduce the landscape tour and short-screen defects`.

### A2 - short-screen and landscape rules

One shared block at the end of `css/src/93-wide-and-export.css` (loaded after
the shell, panels, calculator and chrome layers, so it wins on equal
specificity), scoped to `@media (max-height: 500px)`:

- `#app-header` and `.bcp-top` are capped at **44px** by shrinking their
  tallest children (the 38px hamburger, the 40px methodology pill row, the
  34px settings cluster) - no control is hidden; the greeting alone collapses to
  `max-width: 0` because it carries no action and stays in the a11y tree.
- `.bcp-totalbar` drops to **41px** measured (was 57px).
- Header + bar = 85px of 360 = **24%**, inside the 35% budget, so the bar never
  needs un-sticking.
- `.cm-dialog` uses `100dvh` minus safe areas with `.cm-body` scrolling inside;
  `.cm-head` / `.cm-foot` stay on screen.
- `#drw` and its `.db` body use `100dvh` and the bottom safe-area inset.
- Safe-area insets on all four sides of both headers and the total bar.

Measured after: header 41px (project), 41px (calculator), total bar 41px at
740x360; visible content 89% at 740x360 (was 84%), 100% at 844x390.

Gate: `L1`, `L2`, `L2a`, `L4`, `L5` all PASS. `L2b`/`L3` still fail - those are
A3's.

Commit: `fix(ux): one slim chrome line and dvh dialogs on short screens`.

### A3 - the tour card never covers its target

`js/calculator-page.js` `positionTourPop` rewritten: a scored choice over
below / above / right / left with a 10px gap on a spotlight already grown 6px
(the directive's 8px clearance then holds by construction); a short viewport
docks the card to a side edge at 280px; when no side has room the card is
capped to the free space and its copy scrolls inside; a target that fills the
viewport drops the cutout instead of breaking the rule. `tourVisibleBox()`
walks up from a hidden target to the first ancestor with a real rect - step 1
was spotlighting a 0x0 box at the origin. Back/Skip/Next are 44px on a coarse
pointer. `calculator.html` cache-buster 55 -> 56.

Gate: `qa-ux-landscape` 46/46.

Commit: `fix(ux): the tour card never covers the control it explains`.

### A4 - touch targets and clipped text

One `@media (pointer: coarse)` block at the end of
`css/src/91-design-system.css`: every listed control gets a transparent
`::after` box of `max(100%, 44px)` centred on it. It paints nothing, adds no
layout, and leaves the compact 32px visuals (and the 44px header cap from A2)
intact. Inline links in prose are exempt.

New `L6` in `qa-ux-landscape` enumerates every visible control on the four
pages at all four viewports and fails when the effective box (own rect or
`::after`) is under 44px. `L5` (clipped text without an ellipsis) was already
green once the screen-reader helpers were excluded.

Gate: `qa-ux-landscape` **58/58**; `qa-a11y-axe` 7/7; `verify-contrast` at the
2-failure baseline.

Commit: `fix(ux): 44px touch targets on every coarse pointer`.

### A5 - sign out asks first

Tester report: "not warned before signing out". Four entry points existed and
every one signed out on the first click: the account row
(`js/mmgr-google-auth.js`), the marketing sheet (`js/marketing.js`), the
sign-in confirmation block (`js/signin.js`) and the sync panel
(`js/mmgr-app.js` -> `js/mmgr-sync.js`).

One dialog, built once by `ensureSignOutDialog()` in
`js/mmgr-google-auth.js` and appended to `<body>`, so every page that loads
the auth module gets the same host without 13 copies of the markup:
`#soc` + backdrop + card, title "Sign out?", body "Your work stays saved on
this device. Cloud projects stay in your account.", buttons "Stay signed in"
(default focus), "Sign out" and a conditional "Back up now".

- Escape, an outside tap and "Stay signed in" all close it and touch nothing.
- Focus is trapped between the visible buttons.
- The sync panel's `signOut()` was split: `applySignOut()` does the work, and
  `signOut()` now asks first. The toast fires only after the confirm.
- The marketing sheet's handler was moved OUT of the `signinBtns.length`
  guard. That block requires a `.signin-trigger` element, and NO marketing
  page carries one, so the sheet's Sign out button had no handler at all -
  the directive's "marketing sheet" entry point was dead markup. The sheet +
  the auth module are now the only requirements.
- Styles: `css/src/87-signin-polish.css` for the app, and a deliberate twin in
  `css/marketing.css` (the marketing pages link their own bundle). The
  buttons use `.soc-btn` rather than a page's button system, because the two
  stylesheets define `.btn` differently. The two blocks must stay identical.

Unsynced work: the sync layer exposes a dirty FLAG (`State.isDirty()`), not a
count, so the note reads "Some changes have not been backed up yet." and never
invents a number - recorded here as the directive requires. "Back up now" is
offered only when dirty AND `MMGR.Cloud.autoSaveToCloud` exists; it runs the
existing backup and closes the dialog.

Size gate: `css/mmgr.css` 627000 -> 631000 (629248 measured),
`css/marketing.css` 166000 -> 169000 (167637 measured).

Gate: `tools/qa-signout-confirm.cjs` **42/42** (new); `qa-oauth`,
`qa-cloud-phase1` 29/29, `qa-cloud-phase2`, `qa-api-keys` at baseline;
`npm run verify` green.

Commit: `fix(ux): every sign-out asks first`.

### A6 - the assistant answers in view-only mode

Tester report: in a demo project the assistant was opened, a preset loaded,
Send pressed, and the toast "View-only mode , read-only access. Contact the
admin for full access." appeared. That is the one thing the directive
forbids: the user was allowed to type and then refused.

Branch 1 applies. `runQuestion()` reads the project (`buildContext()`),
runs on this device or through the BYO-key relay, and writes only the
assistant transcript (`state.aiOutputs[type]` + the conversation history) -
never a project record. So the guard was too broad, and `aiRun` /
`aiRunPreset` now sit on `READONLY_SAFE_ACTIONS` in `js/mmgr-app.js`.

What stays blocked: applying an AI-proposed edit (the MCP accept engine) and
every `aiSet*` control, which writes `state.config`. `addRisk` is used as the
negative control in the harness and still refuses.

Not fixed, out of scope: on the LOCAL tier some presets have no generator and
answer "Local tier has no generator for this preset , run it on the Cloud
tier instead." That is the local engine's coverage, identical for a
full-access user, and not a view-only refusal.

Harness re-baseline: `tools/qa-ai-win.cjs` gained the repo's standard RAF
flush + 150ms settle after installing its session stubs. A5 makes every page
build the sign-out dialog host at boot, and the first command-bar click could
land mid-boot, so the three session checks raced a document swap and read
`window.__qa` as undefined (3/3 reproducible before the settle, 27/27 twice
after). App contract unchanged; registry row updated 22/22 -> 27/27.

Gate: `tools/qa-ai-viewonly.cjs` **7/7** (new; proven to bite - removing the
two keys turns V2/V3 red with the tester's exact message);
`qa-ai-actions` 13/13; `qa-ai-relay` RELAY_GATE PASS; `qa-ai-win` 27/27.

Commit: `fix(ux): the assistant answers in view-only mode`.

### A7 - the landing "Who we are" says what it is and who it is for

Tester: the section did not make clear what the app is for or who it is for.
The lead paragraph in `.who-band` (`.who-head`) now opens with the
directive's sentence, verbatim:

> My MaNaGeR is project management software for construction: schedule,
> budget, risks and site records in one place, built for general
> contractors, project managers, superintendents and trade leads.

The existing local-first sentence stays immediately after it. Headings and
the three cards are untouched, as the step requires.

`sw.js` CACHE `mmgr-shell-v672` -> `v673` (the service-worker gate fails any
shell asset newer than the last bump).

Gate: `verify-marketing-markup` PASS; `qa-landing-ui` 70/70.

Commit: `fix(marketing): the landing page says what it is and who it is for`.
