# App stylesheet layers

`css/mmgr.css` is GENERATED. `node build.js --css` concatenates every `*.css`
in this folder in **filename order** and writes the result to `css/mmgr.css`,
which is the document every page links. Never edit `css/mmgr.css`: the next
build overwrites it and `tools/verify-css-integrity.cjs` (ARM 0) fails on the
mismatch.

## Rules

1. **Filename order is cascade order.** The numeric prefixes are load-bearing:
   moving a rule to another layer can silently reorder it against its
   neighbours. If a rule must move, prove `css/mmgr.css` is unchanged or state
   the intended cascade change in the commit.
2. **Carve, do not rewrite.** The split into these layers was done by slicing
   the original monolith at section boundaries, so the assembled bytes are
   identical to what shipped before. A new layer takes a number between its
   neighbours (for example `36-...` between `35-workspace` and `40-ai`).
3. **No comment closer inside prose.** Writing the two-character comment
   terminator in a comment ends it early and the browser drops the NEXT rule
   with no error. `verify-css-integrity` ARM 1 catches it.
4. **Tokens come from `10-tokens.css`.** No new colour literals; gold is
   `--gold`, never a raw hex.

## Layer map

| Layer | Holds |
|---|---|
| `10-tokens.css` | Design tokens: colour, gold ramp, radius, spacing, type scale, breakpoints, dark-mode remaps |
| `20-shell.css` | App shell and dark mode base: rail, header, glass surfaces, page frame |
| `30-panels.css` | Panel and card language: cards, tables (`.lt-table`), drawers, tabs, form controls |
| `35-workspace.css` | Project workspace: sections, WBS, Kanban, plan panels, workspace print rules |
| `40-ai.css` | Assistant window, composer, history, presets, key popover |
| `50-calculator.css` | Calculator page: input cards, BoQ, rate book, compare, print sheet |
| `60-dashboard.css` | Dashboard bands, forecast toggle, chart labels |
| `70-chrome.css` | Dark dashboard treatment and dashboard chrome |
| `80-auth.css` | Email and password sign-in, account sheets |
| `82-launcher.css` | Launcher (`app.html`): hero chrome, rail, accordion, backup, customize, footer, sign-in modal, launcher dark theme |
| `83-floating-calculator.css` | The floating calculator button and its sheet |
| `84-themes.css` | Rose-gold palette, light and dark |
| `85-performance-mode.css` | Performance Mode switch and its reduced-effects rules |
| `86-assistant-mailbox.css` | Assistant mailbox drawer |
| `87-signin-polish.css` | Sign-in trust line and legal links |
| `88-dark-buttons.css` | Dark button language for project pages |
| `89-code-names.css` | "Which code is this?" trigger and popover |
| `90-calc-owner-wave.css` | Calculator owner wave: app-bar surface, pill icons, listbox, rate book popup |
| `91-design-system.css` | Design-system card and chart spec |
| `92-procurement.css` | Procurement tab: supplier price book, AI quote panel |
| `93-wide-and-export.css` | Wide-monitor layout plus the Gantt export modal |
| `94-procurement-extra.css` | Price-history sparkline, import dry-run, compare matrix |
| `95-gold-buttons.css` | The shared gold fill definition |
| `96-accent-modes.css` | Cyan and magenta accent modes |

## Gates

- `node tools/verify-css-integrity.cjs` (in `npm run verify`): assembly drift,
  stray comment closers, and every source class still present in
  `dist/mmgr.min.css`.
- `node tools/verify-sizes.cjs` (in `npm run verify`): per-file caps.
- `node tools/qa-health-sweep.cjs` (Chrome): no source class missing from the
  live CSSOM.
