# My MaNaGeR — App Hub Theme Pack Plan

> Derived from `new trheme packs/THEME_DIRECTIVE.md` (the owner's theme-pack
> spec) **and** a direct audit of the current codebase. The directive was
> written against an older screenshot; per its own rule *"where a mockup and
> the real app disagree, the real app wins"*, every hook below is re-grounded
> in the live `app.html` / `css/src` / `js/mmgr-theme.js`.
>
> **This is a plan only. No code is implemented here.**

---

## 0. What this is, and what it is NOT

- **A theme pack = a skin.** It re-draws the existing launcher hub with new
  tokens, component skins and (for some skins) rail relocation. It **never
  adds, removes, renames, reorders, relabels or re-targets** anything the app
  already has. The default look stays byte-for-byte untouched when no skin is
  selected.
- This **supersedes** the broad launcher UI-overhaul described in the separate
  wave plan for the launcher's *visual* treatment. The prior waves already
  shipped the real DOM (collapsed rail + peek, tour, card band, cloud cards).
  The theme pack layers on top of that current DOM; it does not restructure it.
- **Scope = the launcher hub only** (`app.html`, body class `db-page`). Nothing
  inside a project (`project.html` + its panels), `admin.html`, the marketing
  pages, `signin.html`, or the in-project rail (`#app-sidebar`) is touched.

---

## 1. Reconciliation: directive assumptions vs. the real app

The directive's "canonical inventory" (§2) is stale. The real launcher is:

| Directive assumed | Real app (verified in `app.html`) |
|---|---|
| 8 rail icons: Lightbulb → Folder → Calculator → Shield → Cloud → Upload → Moon → Person | 8 real icons in `#sidebar-icons`: **Dashboard (i-orb) → All Projects (i-folder) → Build Cost Calculator (i-calculator) → Admin panel (i-shield) → Cloud Projects (i-cloud) → Backup & Restore (i-upload) → Appearance (i-moon) → Account/Sign in (i-user)**. No Lightbulb, no separate Person; "Moon" is the **Appearance** entry, not a bare dark toggle. |
| 3 sections: local, demo, code | **7+ sections**: local grid, demo grid, cloud dash (`#cloud-dash-list` / `#shared-list`), Have-a-code (`#code-entry-in`/`#code-entry-btn`), recover (`#recover-list`), recent (`#recent-list`), plus the Customize panel (`#rail-customize`). All must be skinned. |
| Status = only `active` / `planning` (green/blue) | Code uses **4** values: `active`→green, `completed`→green, `planning`→blue, `on-hold`→amber (`app.html:938,972`). Owner colour rule (see §3) forbids recolouring status dots. |
| New theme attribute `data-theme="<slug>"` on `<html>` | `data-theme` is **already taken** by the accent axis (`cyan`/`magenta`) in `css/src/96-accent-modes.css`, and `body.dark-mode` carries light/dark. A second, separate attribute is required (see §2). |
| Theme picker "find where appearance settings live" | Already exists: the **Customize / Appearance** rail panel `#rail-customize` (opened by the 7th strip icon, `data-nav="customize"`). No new rail icon needed. |
| Default look = "frosted light + dark" | Still true, but now also includes the collapsed-rail/peek shell and the card gold band that prior waves shipped. |

**Rule applied throughout:** the directive's banned list (§3 — no invented
titles, nav labels, statuses, percentages, progress rings, typos, duplicate
buttons, dropped lock/help/Open-project, fake dates, rainbow/neon/emoji/stock
imagery) is kept verbatim and extended by the real-DOM facts above.

---

## 2. Architecture (reconcile with the existing theme system)

The repo already has a theme mechanism — do not invent a new one:

- `js/mmgr-theme.js` — device-only appearance axis: `mmgr_theme` =
  `light|dark|system|cyan|magenta`. Sets `body.dark-mode` and, for accents,
  `html[data-theme="cyan"|"magenta"]`. Default = light, never syncs to account.
- `css/src/84-themes.css` — a dormant `rose-gold` token block (commented
  *"PRESERVED-CODE-OFF … not surfaced"*). Pattern to copy for new token skins.
- `css/src/96-accent-modes.css` — the `cyan`/`magenta` accent skins.

### Decision A — separate attribute for full skins
The THEME_DIRECTIVE skins are a **different axis** from the accent modes
(they are full redesigns, not just brand retints). To avoid colliding with the
existing `data-theme` accent axis and to keep the default theme byte-for-byte
intact, skins use a **new attribute**:

```
<html data-skin="obsidian">   <!-- absent = default theme, untouched -->
```

CSS for every skin is scoped to `body.db-page[data-skin="<slug>"] …`, which
guarantees **zero leak** into `project.html` / `admin.html` / marketing pages
(none of them carry the launcher's `body.db-page`). The two axes compose:
a skin may also force its own light/dark base via a declared `singleMode`.

### Decision B — picker is a modal, not a sidebar dropdown
The current `#rail-customize` is a small inline dropdown in the rail. It cannot
hold themes + previews + performance mode + other toggles. **Replace it with a
full Customize modal** opened by the same entry point (the Appearance strip
icon `data-nav="customize"`, and the rail's "Customize" link). No new rail icon
is added (directive decision #2 still satisfied — we reuse the existing
Appearance entry, just change its target from a dropdown to a modal).

**Customize modal (`#customize-modal`, `role="dialog" aria-modal="true"`):**
- A centred/edge overlay in front of the app, dismissible by ESC, the X/✕
  button, a "Done" button, and click-outside. Focus is trapped; opening moves
  focus to the first control, closing returns it to the Appearance trigger.
- **Sections (the modal is the home for multiple customization groups, not just
  themes):**
  1. **Themes** — grid of theme cards (see Decision E for the live preview).
  2. **Performance** — the existing `data-perf='on'` perf toggle, surfaced as a
     real control here (today it is only set via `html[data-perf='on']` in CSS;
     wire a开关 that sets/clears `mmgr_perf` + the attribute, consistent with
     the `mmgr_theme`/`mmgr_skin` persistence pattern).
  3. **Appearance** — the existing light/dark/system + cyan/magenta accent
     choices (currently in `#rail-customize`), migrated into the modal so the
     whole customization surface lives in one place.
  4. Room for more later (e.g., reduced-motion, density) — the modal is the
     agreed container, so future toggles go here, never back in the rail.
- The modal is **static HTML in `app.html`** (no new inline `<script>`), so no
  `INLINE_SCRIPT_HASHES` churn. Its open/close + swatch logic is external
  (`js/mmgr-skin.js`, CSP `'self'`).

### Decision E — live theme preview snippets
Each theme in the Themes grid is a **preview card** that renders a tiny mock of
the launcher using that skin's own tokens, so the user sees the look before
committing:
- Build the preview by applying the skin's attribute to **just the preview
  node**: `<div class="theme-preview" data-skin="vellum">…mini card…</div>`. The
  skin CSS already scopes to `body.db-page[data-skin=…]`, so the preview reuses
  the same rules by also scoping the preview to `[data-skin=…]` (add
  `body.db-page, .theme-preview` to each skin's selector root — see §4).
- **Hover** a preview → apply `data-skin` to `<html>` live (instant preview on
  the real page behind the modal); **mouseleave** → revert to the currently
  saved skin. **Click** → persist `mmgr_skin` + keep it applied, mark the card
  selected. "Default" card clears `data-skin`. User closes the modal and the
  chosen skin is already showing.
- Previews are decorative: each carries `aria-hidden` on the mock chrome; the
  real, accessible control is the labelled button (e.g., "Vellum — preview and
  apply"). Focus/keyboard users apply via Enter/click, not hover.
- No emoji, SVG sprite icons only, motion wrapped in `prefers-reduced-motion`.

### Decision C — persistence (mirror `mmgr-theme.js`)
- Storage key: `mmgr_skin` (device-only, like `mmgr_theme`; never rides the
  Google account).
- Early-load helper (extend `js/mmgr-theme.js` or a tiny `js/mmgr-skin.js`)
  reads `mmgr_skin` and sets `data-skin` on `<html>` **before first paint**,
  exactly as `mmgr-theme.js` does for the appearance axis. CSP-friendly: it is
  an external `<script src>` (covered by `script-src 'self'`), so no inline-hash
  churn.

### Decision D — single-mode themes (directive decision #1)
A skin may declare `singleMode: 'dark' | 'light'`. When the active skin is
single-mode, the moon/Appearance control stays **visible but disabled** with a
tooltip *"This theme has one mode."* (recommended handling). Implemented by
having the skin helper read the active skin's declared mode and toggle
`disabled`+tooltip on the moon control. The appearance axis is not removed.

---

## 3. Canonical DOM inventory (real, from `app.html`)

**Rail strip `#sidebar-icons` — 8 buttons, this exact order, icons-only + tooltip:**
1. Dashboard — `i-orb`
2. All Projects — `i-folder`
3. Build Cost Calculator — `i-calculator`
4. Admin panel — `i-shield`
5. Cloud Projects — `i-cloud`
6. Backup & Restore — `i-upload`
7. Appearance — `i-moon` (opens the **Customize modal**; currently `#rail-customize`, replaced by the modal per Decision B)
8. Account — `i-user` (hidden until signed in) / Sign in — `i-user`

Skins that *relocate* the rail (bento / editorial / pegboard) keep this same
single element, same 8 icons, same order, same tooltips; only the container
position changes. Hamburger still opens/closes the rail.

**Header:** `db-hero-title` = *"My MaNaGeR Projects"* (exact casing); search
input `#ps-input`; appearance/moon toggle; **one** primary `+ New Project`
(`a.db-new-project` → `admin.html?new=1`).

**Sections (all skinned; none removed):**
- Local grid — `.pcard[data-id]`, `.pc-status` (`.sdot` + word), `.pc-cta` "→ Open"
- Demo grid — `.pcard`, lightbulb marker, `.pc-cta` "→ Explore"
- Cloud dash — `#cloud-dash-list`, `#shared-list` (My Cloud Projects / Shared)
- Have a code — `#code-entry-in` (placeholder `XXXX-XXXX-XXXX-XXXX`),
  `#code-entry-btn` "Open project", "Which code is this?" popover
- Recover — `#recover-list`; Recent — `#recent-list`
- Customize entry — opens the **Customize modal** (Decision B), which hosts the
  Themes grid, Performance toggle and Appearance choices

**Status (owner colour rule — dot colour is sacred, never retinted):**
`active`→green, `completed`→green, `planning`→blue, `on-hold`→amber. Skins may
restyle the *container/skin* (small-caps word, hanging tag, CSS ring, gem
`clip-path`) but must keep the semantic dot colour and the real word. All four
values must render (the directive only designed for two — see open decision §6.3).

---

## 4. Per-skin build spec

Follows the directive §6 tokens/slots exactly, with the forced reconciliations
from §1/§3 (real 8-icon set, 7 sections, 4 statuses, `body.db-page[data-skin=…]`
scope). Build order (directive §7): **vellum → obsidian → permit → bento →
pegboard → editorial → departure → guild**.

| Skin | Type | Rail | Notes / forced reconciliation |
|---|---|---|---|
| `vellum` | light, Newsreader | strip (active = red-pencil bar) | Cards: square 1px + counter "P-01". Status small-caps. **4 statuses** must map to the small-caps treatment. |
| `obsidian` | dark, Inter Tight, gold | strip (gold hairline circles) | Closest to default structure — skin only. Keep status dots' green/blue/amber. |
| `permit` | light, Public Sans/Roboto Mono | 44px squares | Hanging `clip-path` tag for status (ACTIVE/PLANNING words only) — extend tag styling to `completed`/`on-hold` without inventing them. |
| `bento` | light, Figtree | **relocated** floating pill dock, bottom-center | 6-col grid; all cards same size; CSS ring status (solid/dashed) → extend to 4 states (e.g., ring style per status). Search expands in place (reuse `#ps-input`). |
| `pegboard` | light, Chivo | **relocated** bottom row of 40px plates | Label-card skin, hooks at corners, tape status. |
| `editorial` | light, Playfair/Source Serif/Inter | **relocated** centered top row, icons only | Single-column list rows; dateline decoration `<weekday, d Month yyyy> · <N> projects` computed live (real date, real count). |
| `departure` | dark, DM Mono | strip (active = amber block) | Full-width board rows, 4 cols; status tiles show the real word (amber/white), keep it accessible. Live HH:MM clock decoration. |
| `guild` | dark, Cinzel/Source Serif | strip, timber panels | **Build last.** Painted illustration (chest, gears, vines, gems) is unbuildable in CSS — do CSS-only: wood-grain `repeating-linear-gradient`, parchment card w/ corner `clip-path` curl, gem `clip-path` status, brass borders. If too thin without art, say so (open decision §6.2). |

Every skin file: `css/src/86-theme-<slug>.css`, first selector group
`body.db-page[data-skin="<slug>"], .theme-preview[data-skin="<slug>"]`, then
token overrides + component skins targeting the §3 hooks only. The
`.theme-preview` twin lets the modal render live preview snippets with the same
rules (Decision E). No raster images, no canvas, no emoji, SVG sprite icons
only, motion wrapped in `prefers-reduced-motion`.

---

## 5. Cross-cutting gates (from directive §5 + repo rules)

- **DOM/text parity** — for each skin, list every button/link/input by
  accessible name; the list must equal the default theme's list (only rail
  *position* may change, never membership). No invented data.
- **Contrast** — body ≥ 4.5:1, large ≥ 3:1, visible focus ring per theme
  (restyled, never removed). Run `qa-a11y-axe` + the existing gold/contrast gates.
- **Responsive** — 1920 / 1280 / 768 / 390 with no horizontal scroll; 44px
  targets on touch.
- **Build** — `node build.js` bundles `css/src/*.css` → `css/mmgr.css`; prove the
  new selectors landed with `grep -c 'data-skin="obsidian"' css/mmgr.css`
  (or `dist` equivalent). Re-run `npm run verify` → exit 0.
- **CSP** — the Customize modal is static HTML in `app.html` (no new inline
  `<script>`), so no `INLINE_SCRIPT_HASHES` churn. The open/close + preview/swatch
  logic is an early-load external script (`js/mmgr-skin.js`), CSP `'self'`.
- **sw.js** — CSS-only changes are served via the bundle; confirm whether a
  `sw.js` shell-version bump is needed for the cached `css/mmgr.css`
  (`mmgr-shell-v…`); bump if the cached copy would mask the new skin.
- **Regression musts** — default theme untouched; no project/admin/marketing page
  changes; existing `cyan`/`magenta` accent modes still work alongside any skin.

---

## 6. Open decisions for the owner (do not assume)

1. **Attribute name** — recommended `data-skin` (separate from the existing
   `data-theme` accent axis). Alternative: reuse `data-theme` with slug
   namespaces (`vellum`, `obsidian`, …) and accept that a skin and an accent
   mode can't both be active on one attribute.
2. **`guild`** — build last as a restrained CSS-only interpretation (no painted
   illustration). Owner confirms whether to ship it at all.
3. **4-status rendering** — the directive only designed status skins for
   `active`/`planning`. Recommended: every skin handles all four
   (`active`/`completed`/`planning`/`on-hold`), keeping the owner's dot colours.

---

## 7. Acceptance checklist (every skin, no exceptions)

1. DOM parity: button/link/input set identical to default (rail position excepted).
2. Text parity: visible text = default text + only this skin's declared decoration.
3. Counts: 8 rail icons, 1 "+ New Project", 1 code input, 1 "Open project",
   every project card rendered exactly once.
4. No invented data (no %, no overdue/blocked, no hardcoded names, real date/count).
5. Behaviour intact: hamburger, search, moon, each card action, New Project,
   Open project, and the **Customize entry opening the modal** (not the old
   dropdown) all work as before; ESC / ✕ / click-outside / Done close it and
   return focus to the Appearance trigger.
6. Visual: screenshots at 1920/1280/768/390 — nothing clipped, overlapped
   (watch status tags over text), or horizontally scrolling.
7. A11y: contrast measured, focus ring visible, reduced-motion respected.
8. Regression: default theme unchanged; no project-page change; accent modes
   still compose with skins.

Build one skin at a time, finish + verify + report the checklist, then the next.

---

## 8. Sequencing / verification per skin

1. Author `css/src/86-theme-<slug>.css` (scoped to `body.db-page[data-skin=slug]`).
2. Add the skin's preview card to the **Customize modal's Themes grid** (Decision
   E); wire `mmgr_skin` set/clear + live hover-preview in the early-load helper
   (`js/mmgr-skin.js`), and migrate the existing light/dark/accent + `data-perf`
   controls into the modal's Appearance/Performance sections.
3. `node build.js` → `grep -c` the new selector in the bundle.
4. `npm run verify` → exit 0.
5. Screenshot + contrast + `qa-a11y-axe` at 390/768/1280/1920.
6. Run the §7 checklist; report before starting the next skin.
7. Commit (Conventional, no AI-attribution footer). **No push / merge / deploy
   without the owner's word.**

Optional: add a `qa-theme-pack` extended harness (DOM-parity + screenshot diff
vs. default) and register it in `docs/CI-TEST-COVERAGE.md` + the appropriate
CI workflow, so the parity gate can't drift.
