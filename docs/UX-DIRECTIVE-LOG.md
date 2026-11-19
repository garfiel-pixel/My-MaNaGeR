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
| `tools/verify-contrast.cjs` | pass |
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
