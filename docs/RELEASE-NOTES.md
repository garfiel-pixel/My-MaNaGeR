# Release Notes — My MaNaGeR

A running, human-readable log of what changed for users and operators, newest
first. Commit-level detail lives in `git log`; this file records the shape of
each release — what a person will notice, and the notable decisions behind it.

Deploy fingerprint: the live build is identified by the service-worker cache
version in `sw.js` (`const CACHE = 'mmgr-shell-vNNN'`).

---

## Unreleased — UI, Spatial & Theme Parity (branch `feat/ui-spatial-theme-parity`)

Implements `master_ui_spatial_theme_parity_specification.md` in full. Not yet
merged or deployed.

### Themes and skins

- **Every theme-pack skin now carries the full semantic token set.** All eight
  skins (`vellum`, `bento`, `permit`, `pegboard`, `editorial`, `obsidian`,
  `departure`, `guild`) define `--sidebar`, `--sidebar-border`,
  `--text-secondary`, `--gold-text`, and the flat `--dot-*` status hues. Before
  this, the dark skins fell back to the cream `:root` rail and several light
  skins left status badges and dots unresolved.
- **Intrinsic skin polarity.** A skin now locks its own light/dark appearance:
  the five paper skins are always light, `obsidian`/`departure`/`guild` are
  always dark. `body.dark-mode` is decided in one place (`js/mmgr-theme.js`),
  which consults the active skin's polarity. Your saved Light/Dark/System/Cyan/
  Magenta choice is never overwritten — it is restored the moment you return to
  the default skin. A new `data-skin-polarity="light|dark"` attribute is exposed
  on `<html>` and `<body>` for CSS.
- **Opaque content surfaces.** `obsidian`'s card surface is now an opaque hex
  (it was `rgba(...,0.9)`), so dense tables stay legible with Performance Mode
  on *or* off instead of letting the canvas bleed through.

### Spatial system

- **Tokenised spacing scale** (`css/src/10-tokens.css`): rail width, workspace
  gutters, panel gap, card/tile padding and table-cell padding are now tokens
  (`--rail-w`, `--workspace-pad-*`, `--panel-gap`, `--card-pad-*`,
  `--tile-pad-*`, `--table-cell-*`), tightened automatically at ≤900px.
- **Desktop rail** widened to `272px` (from `240px`) so section labels stop
  truncating, with a thin, quiet scrollbar. The owner-approved `.sec-btn`
  resting hairline and dark-mode active tab are untouched.
- **Mobile section nav** stacks to a single clean column at ≤768px instead of a
  ragged flex-wrap of uneven pills.

### Anti-slop cleanup

- **Flat status dots.** The 6px coloured halos are gone from every status
  indicator (`.sdot`, the WBS dirty indicator and its cloud-backed variant). The
  true hue stays; only the decorative glow was dropped.
- **Contextual header copy.** The template-style "Good Morning / Afternoon /
  Evening" greeting is replaced by the active project name (falling back to a
  concise status word when the project is unnamed).

### Deliberately scoped out

- The spec's blanket "strip `backdrop-filter` from all static panels" and
  "restrict all `uppercase`" items were **not** applied as mass edits: the
  brand's glass identity is an owner decision, and the X-2 paint gate already
  keeps blur-applying rules under its < 25 target. The WebGL starfield was
  already opt-in / default-off, so §5.5 needed no change.

### Verification

- `npm run verify` green (CSP hashes unchanged, CSS integrity, sizes, contrast).
- Skin matrix probe: 8 skins × Performance Mode on/off × 1440px desktop and
  375px mobile — 414/414 checks (polarity, opaque tokens, tokenised spacing,
  stored-preference preservation, zero exceptions, zero CSP violations).
- `qa-theme-perf` 21/21, `verify-theme-cdp` OK, `qa-health-sweep` 15/15 pages
  with all 2007 CSS rules live, `verify-calc-s2` 75/75, `qa-chrome` 122/122.
- Service-worker cache bumped to `mmgr-shell-v686`.

---

## v685 — WBS Hybrid Add Model & Chunky Completion Ring

- **First task is a main task; later adds become subtasks.** Creating a project
  seeds a top-level task. A plain "+ Add Task" then adds a subtask of the most
  recent main task. Two explicit controls remove the guesswork: **"+ Main Task"**
  always starts a top-level row, and every main row carries a permanent
  **"+ Subtask"** button that inserts under that specific main task. The indent/
  outdent arrows remain as correction escape hatches.
- **Thicker, more legible completion ring.** The per-major-task ring is chunkier
  (radius 37, 20px stroke, ~25px apparent) with wider segment gaps and a
  stronger track, so each major task's contribution reads at a glance.

## v680 — ScrubNumber & SmartTime

- **Scrub-to-adjust numbers.** Numeric fields in the calculator and project
  surfaces can be dragged to change value, with a solid quick-value popover,
  coarse-pointer support, and reduced-motion / transparency / Performance Mode
  fallbacks.
- **Smart time entry.** Time fields accept natural shorthand and resolve it to a
  clean value, with the same accessibility and Performance Mode fallbacks.
