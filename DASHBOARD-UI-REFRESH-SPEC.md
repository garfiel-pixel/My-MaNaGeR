# DASHBOARD-UI-REFRESH-SPEC.md
**Status: normative — strict protocol.** Every rule marked ⛔ is a hard gate
per `.agents/skills/universal-ui-architect/SKILL.md`. A change that violates
a ⛔ gate does not ship, does not go in a PR, does not go in a demo.

**Audited against:** `github.com/garfiel-pixel/My-MaNaGeR@main` — read
`AGENTS.md`, `css/mmgr.css` (1537 lines, local audit copy), `app.html`
directly. Cross-checked against this repo's own
`MINOR-UI-MODERNIZATION-POLISH-DIRECTIVE.json`, which is the established
precedent for how a UI directive gets written here (cited file:line
findings, `must_not_change` guards, explicit execution order) — this spec
follows that same discipline, in Markdown per the user's request rather
than that file's JSON format.

This spec is **additive**, not a rewrite. It layers a new dark dashboard
treatment on top of the existing token system in `css/mmgr.css`. It does
not touch the gold/green/danger/blue tokens, the glass-surface rules, or
`project.html`'s workspace UI.

---

## 0. Open decision I'm flagging, not deciding for you

**Scope CONFIRMED (2026-08-12, per owner: "start on that isn't implemented").**
Implementation notes recorded here so the shipped build and this spec cannot
silently drift:
- **Scope = `app.html` only** — the project-picker / portfolio dashboard.
  `project.html` (sec-nav pills, tables, WBS, budget grids, RACI) stays on
  its current gold/green/glass system, untouched.
- **Deviation (additive, owner-noted):** the ranked `#portfolio-strip` is
  KEPT, and the 3 metric cards (Active / At-Risk / Avg Health) ship as a NEW
  `.db-metrics` summary row above it — computed by `mmgr-portfolio.js`
  `renderMetrics()` from the same `rank()` data. Replacing the strip outright
  would have removed a working feature, violating this repo's no-removal
  rule; the additive form satisfies the spec's intent with zero loss.
- **Light mode untouched (§5):** all `--db-*` tokens and dashboard rules are
  scoped to `body.dark-mode.db-page`; the new containers default to
  `display:none`, so light mode renders byte-for-byte as before.
- **Sidebar mapped to the real page:** `#db-sidebar` = Overview (`#top`),
  Projects (`#grid`), Admin (`admin.html`) — every link resolves (no dead
  links). Glass on sidebar + header chrome only; cards stay solid (Gate 6.1).
- Shipped + gated by `tools/qa-dashboard-spec.cjs` (`npm run qa:dashboard-spec`,
  58 checks incl. measured WCAG pairs + CSP hash parity + sprite icon refs).

Reasoning, now confirmed against the actual file: `app.html` already has a
comment at the exact spot this redesign targets —
`<!-- ACTION-PLAN 6.1: cross-project portfolio health rollup, ranked by
urgency -->` immediately above `<div class="pf-strip" id="portfolio-strip">`
— confirming this page is already understood, in this codebase's own
planning history, as *the* dashboard/rollup page. That's the anchor point
for this redesign, not an invented mapping.

---

## 1. Source references

- Color combo: `@graphix_theory` "Color Combo 03" — three-swatch card:
  fluorescent blue / thin air / near-black.
- Layout reference: "Clean Dashboard Design" screenshot (DesignGrids) — dark
  SaaS admin template: 240px fixed sidebar, header with welcome text +
  search + profile, 3 metric cards, a sales-trend chart, a transactions
  table.
- User correction: swap the swatch card's near-black (`#001619`) for **jet
  black**. No hex given — spec'd as `#0A0A0A` below (§2.1), not pure
  `#000000`, because `#000000` would crush this app's existing shadow/
  elevation layering (`--glass-shadow`, `--glass-rim`, defined in
  `css/mmgr.css`'s dark-theme block) to invisible. One-token change if you
  actually want literal `#000000`.

---

## 2. Color tokens

### 2.1 New primitive tier — add alongside the existing dark-theme block in
`css/mmgr.css` (confirmed at line 59: `--canvas:#090a0f;--card:#12141c;
--border:#222533;--text:#e2e8f0; ... --gold:#f59e0b;--green:#10b981;
--danger:#ef4444;--blue:#3b82f6;`). Do not edit that line — add new
tokens after it.

| Token | Hex | Source |
|---|---|---|
| `--db-fluor-blue` | `#50E8F4` | swatch card, unedited |
| `--db-thin-air` | `#C7F8FE` | swatch card, unedited |
| `--db-jet-black` | `#0A0A0A` | user override of `#001619`, see §1 |

### 2.2 Semantic tier — dashboard-scoped, `--db-` prefix everywhere so these
can never leak into `project.html` by accident (that page never references
a `--db-*` token, so a stray one there is instantly a review flag):

```css
--db-canvas:         var(--db-jet-black);  /* page background */
--db-surface:         #121212;             /* one step up from canvas — cards/panels */
--db-surface-raised:  #1a1a1a;             /* two steps up — modals/dropdowns */
--db-accent:           var(--db-fluor-blue);  /* active nav, chart line, focus ring, primary CTA */
--db-accent-soft:      var(--db-thin-air);    /* secondary text, hover tint */
--db-border:          #262626;             /* card borders, dividers */
```

Existing tokens this reuses rather than duplicates: `--radius` (8px, line
21), `--squircle-md` (20px, line 39) for card corners — new tokens are only
for what genuinely doesn't exist yet (the dark-dashboard-specific palette).

### 2.3 ⛔ Gate 4.1/4.3 — recorded contrast ratios (computed, not eyeballed)

| Pair | Ratio | WCAG 2.2 result |
|---|---|---|
| `--db-fluor-blue` (#50E8F4) on `--db-canvas` (#0A0A0A) | **13.4:1** | AAA pass (body + large text) |
| `--db-thin-air` (#C7F8FE) on `--db-canvas` (#0A0A0A) | **17.2:1** | AAA pass |
| `--db-fluor-blue` on `--db-surface` (#121212) | 12.9:1 | AAA pass |
| `--db-thin-air` on `--db-surface` (#121212) | 16.6:1 | AAA pass |

⛔ **`--db-fluor-blue` on white is 1.48:1 — automatic fail.** This palette
is dark-surface-only. Never use it as text on `--canvas` (`#f4f5f7`, line
16 — the light theme) or any light card. See §5 for how this interacts
with the existing theme toggle.

---

## 3. Layout structure (desktop, ≥769px)

Mapped onto what `app.html` actually has today, verified by direct read —
not the reference screenshot's literal nav, since this app has no
"Products / Customers / Order Management" entities.

| Reference element | `app.html` equivalent (confirmed by line) |
|---|---|
| 240px fixed sidebar, nav groups | New: **Overview**, **Projects**, **Admin** (link to `admin.html`) — 3 groups, not the reference's 4; this app doesn't have a 4th top-level destination to put there without padding |
| Header: breadcrumbs + search + profile | Existing `#app-header` (`css/mmgr.css:96`) restyled onto dark tokens; breadcrumb is just "Dashboard" — no deeper hierarchy exists on this page |
| 3 metric cards | Existing `#portfolio-strip` (`app.html:168`, fed by `mmgr-portfolio.js`, already labeled in-repo as "ACTION-PLAN 6.1: cross-project portfolio health rollup") restyled into 3 cards: **Active Projects**, **At-Risk Projects**, **Avg Health Score** — data this app already computes |
| Sales trend chart | **Not implemented this pass** — no time-series revenue data exists to chart. Flagged as a non-goal (§6), not faked with placeholder numbers |
| Recent transactions table | Existing `#grid` project-cards grid (`app.html:170`) restyled onto dark surface tokens — kept as cards, not converted to a literal `<table>`; cards already carry more per-project context (health, lock status) than a transaction row would |

⛔ **Gate 6.1** — glass/blur applies only to sidebar and header (chrome).
The project-card grid is dense content, stays on solid `--db-surface`,
never glass — same rule already enforced for `project.html`'s tables/WBS/
budget grids.

---

## 4. Mobile responsiveness (≤768px)

| Element | Rule |
|---|---|
| Sidebar | Collapses off-screen; hamburger in header toggles a slide-in drawer via `transform: translateX(-100%)` → `translateX(0)`, not `display:none` toggling, so it animates |
| Metric cards (`#portfolio-strip`) | Single-column stack, full width, scrollable feed |
| Project grid (`#grid`) | Already single-column on narrow viewports in the current CSS — verify this still holds post-restyle, don't regress it |
| Any future chart/table | `overflow-x:auto` wrapper, `-webkit-overflow-scrolling:touch` — never allowed to clip or force page-level horizontal scroll |

⛔ **Gate — no new horizontal page scroll.** Test at 320px before calling
this done, not just at 768px.

---

## 5. Interaction with the existing theme toggle

This app already has a light/dark switch — `tglTheme`, confirmed present in
both `admin.html`'s `ADMIN_ACTION_MAP` and `app.html`'s `DASH_ACTION_MAP`
during the prior code audit of this repo. This spec is **not a third
theme** — it's what `app.html` looks like specifically in dark mode. The
`--db-*` tokens only resolve under the existing `[data-theme="dark"]`
scope. Light mode keeps `app.html`'s current appearance untouched — dumping
fluorescent blue on the light `--canvas` fails Gate 4.1 (§2.3) outright.

If light-mode dashboard styling is actually wanted, that's a separate
decision requiring a different accent value for that context — say so
explicitly before it's built.

---

## 6. Explicit non-goals for this pass

- No sales/revenue chart — no underlying data model for it; fabricating
  numbers contradicts this codebase's own "no invented metrics" discipline
  (see `MASTER-ACTION-PLAN` history: every dashboard number here traces to
  real computed state).
- No change to `project.html`, its nav, its tokens, or its glass rules.
- No change to `admin.html` beyond CSS variables it inherits automatically
  from `css/mmgr.css`.
- No new theme toggle, no third mode.
- No literal port of "Customers / Order Management / Roles & Permissions"
  nav items — this app has no such entities. Inventing nav items with
  nothing behind them creates dead links, exactly the class of bug
  `.agents/skills/skeptical-code-audit` exists to catch, and exactly the
  class of bug the prior audit of this repo found in production
  (an unwired `syncClientId` input field).

---

## 7. Implementation protocol (strict order)

1. Load skills first, per `AGENTS.md`: `universal-ui-architect` (token/
   contrast/glass gates), `skeptical-code-audit` (verify no orphaned nav
   links or dead `data-action`s get introduced), `pwa-development` (if any
   new asset needs service-worker caching).
2. Add the `--db-*` tokens to `css/mmgr.css`'s dark-theme block (after
   line 59-69, confirmed above). Do not touch the light-theme block
   (lines 16-31).
3. Build the sidebar + header + card-grid markup in `app.html` only.
4. Wire the hamburger/drawer toggle as a new `data-action` (e.g.
   `toggleSidebar`) added to `app.html`'s own `DASH_ACTION_MAP` — **not**
   `mmgr-app.js`'s map, which is `project.html`-scoped. Register it in
   `app.html`'s click-delegation whitelist in the same commit.
5. Restyle `#portfolio-strip` and `#grid` onto `--db-surface` /
   `--db-border` tokens.
6. Regenerate CSP inline-script hashes if any inline `<script>` in
   `app.html` is touched (`AGENTS.md` rule 1) — stale hashes block the page
   with **no visible error**.
7. Run the dual-layer contrast check (`contrast-gate.mjs` pattern from
   `universal-ui-architect`) against every new pair; record ratios as
   comments next to the token definitions, matching §2.3's format.
8. Test the drawer + card stack at 320px, 375px, 768px, desktop.
9. Run `npm run verify` (CSP + service-worker checks) and the relevant
   `qa-*.cjs` harnesses (`qa-glass.cjs` / `qa-glass-visual.cjs` are the
   most relevant given this touches glass-chrome rules).
10. Update this file's §0 to mark the scope decision confirmed once
    signed off, so it stops being an open question for whoever — human or
    agent — picks this up next.

---

## 8. Not flagged, already good (no action needed)

Matching the "what's already right" convention from this repo's own UI
directives: the spring-press micro-interactions, `prefers-reduced-motion`/
`prefers-reduced-transparency` fallbacks, and the glass-blur system in
`css/mmgr.css` are already implemented and don't need touching to support
this dashboard refresh — the new tokens sit on top of that existing
motion/glass infrastructure, they don't replace it.
