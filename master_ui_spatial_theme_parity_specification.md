# Master UI, Spatial & Theme Parity Specification (`My MaNaGeR`)

**Document Status:** Consolidated Architecture & Implementation Plan  
**Scope:** Launcher Drawer (`app.html`), Project Rail & Workspace (`project.html`), Theme Skins (`css/src/86-theme-*.css`), Performance Mode (`data-perf="off"`), and Anti-Slop Hardening  
**Build Requirement:** All CSS edits target `css/src/*.css`; run `node build.js` after changes to regenerate `css/mmgr.css` and `dist/`.

---

## 1. Non-Negotiable Owner Constraints (Preserved)

Before modifying any layout or component rule, the following existing owner decisions in the codebase **must not be overwritten or reversed**:

1. **Mandatory Resting Hairline Outline on `.sec-btn` (`css/src/88-dark-buttons.css`):**
   * The gray hairline outline on inactive section tabs is an explicit owner decision. Do **not** strip borders from `.sec-btn`.
2. **Owner-Confirmed Dark-Mode Active State (`css/src/88-dark-buttons.css`):**
   * The dark-mode active section tab (solid white fill with black label, marked *"kept exactly (owner confirmed)"*) remains untouched.
3. **Single-Column Desktop Rail (`#app-sidebar` in `css/src/20-shell.css`):**
   * `#app-sidebar .sec-btn` is already `width: 100%` (single-column). The multi-column wrapped pill layout visible on narrow viewports belongs specifically to the inline `.sec-nav` (`flex-wrap: wrap` around `css/src/20-shell.css ~1572`), not the desktop rail.
4. **Launcher Rail Identity (`app.html`, `css/src/82-launcher.css`, `js/app/launcher-rail.js`):**
   * Keep the gold crown + navy brand lockup, the 6 expandable navigation groups (`Overview`, `Projects`, `Cloud`, `Administrate`, `Tools`, `Customize`) with per-user persisted collapse states, independent navigation scroll, and the pinned bottom footer (`Premium` badge + user profile + `Sign out`).

---

## 2. Reconciled Findings & Decisions (Audit + Anti-Slop Integration)

| Area | Original Proposal | Code Audit & Anti-Slop Critique | Final Reconciled Rule |
| :--- | :--- | :--- | :--- |
| **Desktop Rail Width (`#app-sidebar`)** | Widen from `240px` to `272px`–`280px`. | Verified at fixed `240px` (`css/src/20-shell.css ~1321`). Widening to `272px` prevents label truncation without breaking layout. | Set `#app-sidebar` width to **`272px`** (`--rail-w: 272px`) on desktop (`≥1024px`). |
| **Inline Mobile `.sec-nav` Wrapping** | Flatten 2-column pills into 1 column everywhere. | `.sec-nav` uses `flex-wrap: wrap` (`20-shell.css ~1572`), causing uneven 2-pill rows on narrow widths. | On narrow/drawer viewports (`<768px`), switch `.sec-nav` to a clean **1-column stack** (`flex-direction: column; gap: 6px`) or an explicit uniform 2-column CSS grid (`grid-template-columns: 1fr 1fr`)—never ragged flex-wrapped pills. |
| **Workspace Gutters & Card Padding** | Blanket `28px 36px` gutters and `44px` table rows everywhere. | `20-shell.css ~1560` currently uses `18px 24px`. Blanket `44px` rows hurt high-density tools (Gantt, BOQ, WBS). | Use **two-tier density tokens**:<br>• **Structural Shell & Cards:** `#app-main` desktop padding `24px 32px`; `.panel` stack gap `20px`; `.card` padding `20px 24px`.<br>• **Dense Data Grids (Gantt, BOQ, WBS, Logs):** Keep compact row heights (`34px–36px`) and `8px 12px` cell padding so scanning stays fast. |
| **Launcher Mobile Drawer (`82-launcher.css`)** | Keep airy spacing. | Large dead gap between `Customize` and `Premium` when all 6 groups are collapsed; `→` arrows don't clearly indicate accordion expansion; short screens risk crowding. | 1. Rotate chevron/arrow indicator (`→` collapsed vs. `↓` expanded) via `[aria-expanded="true"]` in `82-launcher.css`.<br>2. Add subtle group metadata/sub-count or tighten max-height balance on short viewports (`max-height: 100dvh`) so expanded groups scroll smoothly above the sticky footer. |
| **Dark Skin `--sidebar` Bug (`86-theme-*.css`)** | Add missing tokens to skins. | **Confirmed critical bug:** None of the 8 skin files define `--sidebar`. In light appearance, dark skins (`obsidian`, `departure`, `guild`) fall back to `#fdfbf7` (cream rail on dark canvas). Only `guild`, `obsidian`, and `bento` define `--gold-text` / `--dot-*`. | Explicitly define `--sidebar`, `--sidebar-border`, `--text-secondary`, `--gold-text`, and `--dot-*` across **all 8** `86-theme-*.css` files. |
| **Theme + `data-perf="off"` Breakdown** | Adjust glass blur and polarity. | 88 `backdrop-filter` rules exist; content surfaces should be solid, and `body.dark-mode` collides with light skins (`vellum`, `bento`, `permit`, `pegboard`, `editorial`). | Lock intrinsic skin polarity in `js/mmgr-skin.js` and enforce solid `--card` surfaces on content panels when `data-perf="off"` (see Section 3). |
| **Anti-Slop Visual Cleanup** | Add sheen/glow accents. | **Rejected sheen/glow.** Codebase has 88 `backdrop-filter` rules, `6px` glowing status dots (`30-panels.css ~438–450`), 46 gradients, 82 `text-transform: uppercase` rules, and generic `"Good Evening"` header copy. | Strip decorative bloat: remove dot glows, limit `backdrop-filter` to floating chrome, restrict `uppercase` to eyebrow group labels, and replace `"Good Evening"` with contextual project/status text (see Section 5). |

---

## 3. Theme Polarity & `data-perf="off"` Architecture Fix

### 3.1 Root Cause of Theme Breakage When Performance Mode is OFF
1. **Missing `--sidebar` & Semantic Tokens in `css/src/86-theme-*.css`:**
   * Because `--sidebar` is omitted from all 8 skin files, `#app-sidebar` inherits `:root`'s light `#fdfbf7` whenever `body` lacks `.dark-mode`—producing a glaring white sidebar beside dark `obsidian`, `departure`, and `guild` workspaces.
   * Five of the eight skins (`vellum`, `permit`, `pegboard`, `editorial`, `departure`) omit `--gold-text` and `--dot-*`, causing low-contrast badges and status dots.
2. **Dark-Mode vs. Light-Skin Cascade Collision:**
   * Light skins (`vellum`, `bento`, `permit`, `pegboard`, `editorial`) set light paper `--card` values, while `body.dark-mode` overrides (e.g., `body.dark-mode .badge`, `body.dark-mode .sec-btn`) apply white text and white borders (`--lit-white-22`), causing invisible text/borders when a user switches from Dark Mode to a light skin.
3. **Alpha-Channel Bleed When `data-perf="off"`:**
   * `85-performance-mode.css` only forces solid `background: var(--card) !important` when `[data-perf='on']`. When `data-perf="off"`, translucent `--card` / `--surface` values (e.g., `obsidian`'s `rgba(22, 29, 37, 0.9)`) bleed background canvas noise through dense project tables and cards, while `backdrop-filter` runs unnecessarily on non-floating containers.

### 3.2 Concrete Implementation Plan

#### Step A: Skin Polarity Lock (`js/mmgr-skin.js`)
Define an explicit polarity map so selecting any skin automatically aligns `dark-mode` class state (and restores user preference when returning to `default`):
```js
const SKIN_POLARITY = {
  vellum: 'light',
  bento: 'light',
  permit: 'light',
  pegboard: 'light',
  editorial: 'light',
  obsidian: 'dark',
  departure: 'dark',
  guild: 'dark',
};
```
* When `skin !== 'default'`, apply or remove `body.dark-mode` according to `SKIN_POLARITY[skin]` without overwriting the user's saved `default` theme preference in `localStorage`.
* Expose `data-skin-polarity="light|dark"` on `document.body` so CSS rules can target polarity cleanly.

#### Step B: Complete Token Parity Across All 8 Skins (`css/src/86-theme-*.css`)
Add the missing `--sidebar`, `--text-secondary`, `--gold-text`, and flat `--dot-*` tokens to every skin file:

* **Dark Skins (`obsidian`, `departure`, `guild`):**
  * `86-theme-obsidian.css`: `--sidebar: #11161d; --gold-text: #eab308;`
  * `86-theme-departure.css`: `--sidebar: #0e131a; --gold-text: #f59e0b; --dot-green: #22c55e; --dot-amber: #f59e0b; --dot-red: #ef4444;`
  * `86-theme-guild.css`: `--sidebar: #141917;` (already defines `--gold-text` / `--dot-*`; verify contrast $\ge 4.5:1$).
* **Light Skins (`vellum`, `bento`, `permit`, `pegboard`, `editorial`):**
  * Set `--sidebar` to a distinct warm/cool paper step slightly darker than `--card` (e.g., `#f4efe6` for `vellum`, `#f1f5f9` for `bento`, `#eff3f6` for `permit`, `#f3efe8` for `pegboard`, `#f5f2eb` for `editorial`).
  * Set `--gold-text` to high-contrast deep amber/ochre (`#854d0e` or `#92400e`) and flat saturated `--dot-green` (`#15803d`), `--dot-amber` (`#b45309`), `--dot-red` (`#b91c1c`).

#### Step C: Solid Content Surfaces in `data-perf="off"` (`css/src/20-shell.css` & `css/src/85-performance-mode.css`)
* Remove `backdrop-filter` from static layout containers (`.card`, `#app-main`, `#app-sidebar`, `.tbl`, `.evm-tile`) in **both** `data-perf="off"` and `data-perf="on"`.
* Reserve `backdrop-filter` strictly for transient floating chrome: `.dock`, `.modal-backdrop`, `.toast`, and active dropdown popovers.
* Ensure `obsidian` and all other skins resolve `--card` and `--sidebar` to opaque hex colors inside `#app-main` and `#app-sidebar` so text legibility never degrades when Performance Mode is off.

---

## 4. Spatial & Layout Execution Plan (File-by-File)

### 4.1 Tokenized Spacing Scale (`css/src/10-tokens.css`)
Introduce explicit, purpose-built spacing tokens instead of ad-hoc pixel overrides:
```css
:root {
  --rail-w: 272px;
  --workspace-pad-y: 24px;
  --workspace-pad-x: 32px;
  --panel-gap: 20px;
  --card-pad-y: 20px;
  --card-pad-x: 24px;
  --tile-pad-y: 16px;
  --tile-pad-x: 20px;
  --table-cell-y: 9px;
  --table-cell-x: 12px;
}
```
* At `@media (max-width: 900px)`, scale `--workspace-pad-y: 16px; --workspace-pad-x: 16px; --card-pad-y: 16px; --card-pad-x: 16px;`.

### 4.2 Desktop Rail & Mobile Drawer (`css/src/20-shell.css` & `css/src/82-launcher.css`)
1. **Desktop Project Rail (`20-shell.css ~1321`):**
   * Update `#app-sidebar` width from `240px` to `var(--rail-w)` (`272px`).
   * Add `scrollbar-width: thin` and subtle thumb styling so the scrollbar does not crowd `.sec-btn` labels.
   * Keep `.sec-btn` resting hairline borders and owner-confirmed dark-mode active state intact (`88-dark-buttons.css`).
   * Set `.nav-group` vertical spacing to `18px` top margin and `6px` gap between items inside `#app-sidebar`.
2. **Inline Section Nav (`20-shell.css ~1572`):**
   * Replace ragged `flex-wrap: wrap` pills on narrow screens (`<768px`) with `display: flex; flex-direction: column; gap: 6px;` so every button aligns cleanly along a single left axis.
3. **Launcher Sidebar (`82-launcher.css` & `js/app/launcher-rail.js`):**
   * **Accordion Indicator Clarity:** Rotate the directional arrow `90deg` (`transform: rotate(90deg); transition: transform 160ms ease;`) when `[aria-expanded="true"]` so users immediately distinguish expandable groups from direct page links.
   * **Short-Viewport Resilience:** Use `height: 100dvh` on the mobile drawer with `flex: 1 1 auto; overflow-y: auto; min-height: 0;` on the nav list so expanding all 6 groups never pushes `Premium` or `Sign out` off-screen.
   * **Visual Balance:** Add subtle item counts or clean section spacing (`padding: 12px 16px`) so collapsed state feels intentional rather than empty.

### 4.3 Inside-Project Workspace (`css/src/30-panels.css` & `css/src/35-workspace.css`)
1. **Workspace Gutters (`20-shell.css ~1560`):**
   * Change `#app-main` desktop padding from `18px 24px` to `var(--workspace-pad-y) var(--workspace-pad-x)` (`24px 32px`).
2. **Card & Panel Rhythm (`30-panels.css`):**
   * Apply `gap: var(--panel-gap)` (`20px`) between stacked cards/sections inside `.panel.active`.
   * Standardize `.card` padding to `var(--card-pad-y) var(--card-pad-x)` (`20px 24px`) and `.evm-tile` to `var(--tile-pad-y) var(--tile-pad-x)` (`16px 20px`).
   * Keep `.tbl th, .tbl td` at `var(--table-cell-y) var(--table-cell-x)` (`9px 12px`, `~36px` row height) so Gantt, WBS, and BOQ tables stay scannable without excessive vertical scrolling.

---

## 5. Anti-Slop Hardening Checklist

To eliminate generic/AI-template visual noise and unnecessary GPU/CPU overhead:

1. **Eliminate Glowing Status Dots (`css/src/30-panels.css ~438–450`):**
   * Remove the `6px` `box-shadow` glow from status indicator dots. Render crisp, flat `8px` circles (`border-radius: 50%`) using `--dot-green`, `--dot-amber`, `--dot-red` (with an optional `1px` solid ring on light surfaces for contrast).
2. **Audit & Prune `backdrop-filter` (88 rules $\rightarrow$ Floating Chrome Only):**
   * Remove `backdrop-filter` from cards, sidebars, table headers, and static banners. Keep it exclusively on `.dock`, modal overlays, and toast notifications.
3. **Flatten Gratuitous Gradients (46 declarations):**
   * Replace decorative background gradients on cards, headers, and pills with flat theme tokens (`--card`, `--surface-raised`, `--brand-subtle`). Retain gradients only where explicitly part of brand identity (e.g., primary gold CTA button if owner-approved).
4. **Restrict `text-transform: uppercase` (82 rules):**
   * Keep `uppercase` + letter-spacing strictly on small eyebrow/group labels (`.nav-group-label`, table `th` headers, status badges). Convert buttons, section tabs, and card headings to clean sentence case or title case.
5. **Opt-In WebGL Starfield (`js/mmgr-glass.js`):**
   * Gate the Three.js starfield canvas behind an explicit user toggle (default off or static lightweight CSS backdrop) so `data-perf="off"` delivers smooth typography and custom skins without continuous GPU spin.
6. **Replace Generic Greeting Copy (`project.html` / `js/mmgr-render.js`):**
   * Replace the template-style `"Good Evening"` greeting in the project top header with the active **Project Name** or concise **Project Status / Stage summary** (e.g., `Active · Phase 2` or current project title).

---

## 6. Execution Order & Verification Gates

1. **Phase 1 — Theme & `--sidebar` Parity (Zero Risk to Owner Rules):**
   * Update all 8 `css/src/86-theme-*.css` files with `--sidebar`, `--text-secondary`, `--gold-text`, and flat `--dot-*` tokens.
   * Add `SKIN_POLARITY` synchronization to `js/mmgr-skin.js`.
2. **Phase 2 — Tokenized Spacing & Drawer Mechanics:**
   * Add spacing scale tokens to `css/src/10-tokens.css`.
   * Update `#app-sidebar` (`272px`), `#app-main` (`24px 32px`), `.card` (`20px 24px`), and mobile `.sec-nav` single-column stacking in `20-shell.css` and `30-panels.css`—preserving `88-dark-buttons.css` borders and active states.
   * Update `82-launcher.css` chevron rotation (`[aria-expanded="true"]`) and `100dvh` scroll containment.
3. **Phase 3 — Anti-Slop Cleanup:**
   * Remove `box-shadow` dot glows in `30-panels.css`, strip `backdrop-filter` from non-floating panels, scope `uppercase` to eyebrow labels, and replace `"Good Evening"` header copy.
4. **Phase 4 — Build & QA Verification:**
   * Run `node build.js` to compile `css/mmgr.css` and `dist/`.
   * Verify in Playwright/browser across all 8 skins (`vellum`, `bento`, `permit`, `pegboard`, `editorial`, `obsidian`, `departure`, `guild`) with `data-perf="off"` and `data-perf="on"`, plus `375px` mobile and `1440px` desktop viewports.