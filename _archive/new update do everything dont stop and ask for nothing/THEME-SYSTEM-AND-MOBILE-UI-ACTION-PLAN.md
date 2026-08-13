# My MaNaGeR — Theme System + Mobile UI Action Plan
**Single source of instructions for coders / Claude / Cloudflare deployment**  
Created: 2026-08-11  
Status: READY FOR IMPLEMENTATION (do not edit application code until this plan is followed)

---

## 0. Non-Negotiables (Read First)

1. **No feature may be removed, disabled, moved, or destroyed.**  
   This work is strictly additive: bug fixes + theme system + mobile-friendly shell improvements. Every existing panel, AI tool, voice, Gantt, RACI, EVM, decisions, meetings, sync, access codes, etc. must continue to work exactly as before.

2. **Default theme on first visit = current gold / amber system.**  
   Cyan is an optional alternative theme, not a replacement.

3. **Every page must respect the active theme.**  
   App pages, project workspace, admin, marketing pages — all of them. Mandatory.

4. **Light mode and dark mode both remain.**  
   Every theme must define values that work in light mode **and** dark mode. Colors may (and should) adapt between light and dark for best contrast and appearance.

5. **Theme preference storage preference order**  
   - **Primary**: Backend (Cloudflare Worker / user profile / sync store). When the user selects a theme, the choice is saved server-side so it follows the user.  
   - **Fallback / cache**: `localStorage` so the theme is available offline and applies instantly on load.  
   - On load: try backend → fall back to localStorage → fall back to `"default"`.

6. **This document is the only instruction set.**  
   Previous UI-redesign notes that treated cyan as a full brand replacement are superseded by this plan. The Claude bug-audit document remains valid and independent.

---

## 1. Goals

| Goal | Description |
|------|-------------|
| Multi-theme system | Users can switch between the default gold theme and the new cyan theme (and future themes). |
| Universal token layer | One set of CSS custom-property names. Themes only swap values. |
| Mobile-first shell improvement | Hamburger icon opens a left sidebar / drawer. Existing navigation groups stay usable on small screens. |
| Zero regression | No working feature is broken or removed. |
| Fast implementation | Strict, ordered steps so a coder can apply the changes quickly. |

---

## 2. Architecture

### 2.1 Theme attribute

Apply the theme via a data attribute on the root element:

```html
<html data-theme="default">   <!-- or "cyan" -->
```

or on `<body>` if that is cleaner with the existing dark-mode class:

```html
<body class="dark-mode" data-theme="cyan">
```

**Recommendation**: put `data-theme` on `<html>` so it is available as early as possible and does not fight with `body.dark-mode`.

### 2.2 CSS structure (do not invent new token names)

Keep the existing token names (`--canvas`, `--card`, `--gold`, `--text`, `--border`, `--green`, etc.).  
Themes only override the values.

```css
/* ===== DEFAULT THEME (current gold system) ===== */
:root {
  /* existing light tokens already in mmgr.css */
}
body.dark-mode {
  /* existing dark tokens already in mmgr.css */
}

/* ===== CYAN THEME ===== */
[data-theme="cyan"] {
  /* light-mode cyan values – see Section 3 */
}
[data-theme="cyan"] body.dark-mode,
body.dark-mode[data-theme="cyan"] {
  /* dark-mode cyan values – see Section 3 */
}
```

(Adjust the exact selector to match whichever element receives `data-theme`.)

### 2.3 Persistence flow

```
User selects theme
       ↓
1. Write to backend (preferred) – user preference endpoint / sync store
2. Write to localStorage key:  mmgr_theme   value: "default" | "cyan"
3. Set document.documentElement.dataset.theme = value   (immediate visual update)
```

On every page load (as early as possible, ideally in a small inline or first script):

```
1. Read from backend if authenticated / available
2. Else read localStorage.mmgr_theme
3. Else use "default"
4. Apply data-theme attribute before first paint if practical
```

### 2.4 Future themes

Adding Theme #3 later requires only:

1. A new `[data-theme="name"]` block with the same token names.
2. An entry in the theme picker UI.
3. Backend acceptance of the new string value.

No component CSS changes required if everything already uses tokens.

---

## 3. Cyan Theme Token Values

Map the user-supplied palette onto the **existing token names** so the rest of the stylesheet continues to work.

### 3.1 Light mode – `[data-theme="cyan"]`

| Existing Token     | Cyan Light Value     | Notes |
|--------------------|----------------------|-------|
| `--canvas`         | `#F0FDFF` or very light cyan-gray | Page background |
| `--card`           | `#FFFFFF`            | Cards stay clean white |
| `--border`         | `#B8E8EF`            | Soft cyan border |
| `--text`           | `#001619`            | Blue Charcoal for strong text |
| `--slate` / secondary text | `#3D6B73`     | Muted |
| `--gold` (primary accent) | `#0D9488` → better: use Fluorescent Blue `#50E8F4` for accent role | Primary accent becomes fluorescent blue |
| `--on-gold`        | `#001619`            | Text on primary accent buttons |
| `--green` (positive) | keep or shift slightly toward teal | Semantic success |
| `--danger`         | keep existing red    | Do not change semantic danger |
| `--tile-bg`        | soft cyan tint       | Stat tiles |
| `--track-bg`       | soft cyan track      | Progress tracks |

**Practical mapping recommendation for accent**:
- Treat `--gold` as the “primary brand accent” token even when the theme is cyan.
- Under cyan theme, set `--gold: #50E8F4` and `--on-gold: #001619`.
- This way every place that already uses `var(--gold)` automatically becomes fluorescent blue without rewriting component rules.

### 3.2 Dark mode – cyan + dark

| Existing Token     | Cyan Dark Value      | Notes |
|--------------------|----------------------|-------|
| `--canvas`         | `#001619`            | Blue Charcoal |
| `--card`           | `#0A2A2E` or `#0D2226` | Slightly lifted from charcoal |
| `--border`         | `rgba(80,232,244,0.18)` | Thin fluorescent edge |
| `--text`           | `#C7F8FE` or `#E0FBFF` | Thin Air / near-white cyan |
| `--slate`          | `#7AB8C0`            | Muted cyan-gray |
| `--gold` (accent)  | `#50E8F4`            | Fluorescent Blue |
| `--on-gold`        | `#001619`            | Dark text on bright accent |
| `--green`          | keep or slight cyan shift | |
| `--danger`         | keep existing        | |
| Glass tokens       | Adjust fill/border to cyan-tinted frosted glass if glass is still used | |

Exact hex values may be refined for WCAG AA, but the above mapping is the starting contract.

### 3.3 Semantic colours

`--danger`, `--success` / `--green`, warning colours stay recognisable across themes. Only the brand accent (`--gold` role) and surfaces change.

---

## 4. UI Locations

### 4.1 Theme toggle

- Place the control **next to the existing sun / dark-mode control** (and also expose it inside Settings if a Settings drawer already exists).
- Simple segmented control or two/three icon buttons: Default | Cyan (future themes appear here later).
- On change: write backend + localStorage + update `data-theme` immediately.

### 4.2 Hamburger + Sidebar (mobile improvement)

- Add a hamburger icon in the header (visible primarily on smaller viewports, or always if design prefers).
- Clicking it opens a left sidebar / off-canvas drawer that contains the navigation groups.
- Existing section navigation content is reused inside the drawer — do not delete the current nav, only give it a mobile-friendly container.
- Desktop can keep the current horizontal / pill navigation or also adopt a persistent sidebar; choose the least disruptive path that improves mobile. Preferred: persistent or collapsible sidebar on desktop, drawer on mobile.
- AI tool entry point remains visible and functional.

### 4.3 What stays untouched

- All panels, modals, Gantt, RACI, EVM, decision log, meetings, voice, AI window, access-code flows, sync, cloud, admin tools, etc.
- Focus Mode behaviour.
- Existing keyboard and accessibility patterns.

---

## 5. Implementation Checklist (Strict Order)

Perform the steps in sequence. Do not skip.

### Phase A — Bug fixes (from Claude audit, independent)

1. Add `'syncClientId'` to the **change** event whitelist in `js/mmgr-app.js` so the Google OAuth Client ID field actually persists.
2. Add `@keyframes shake` and `.shake` class to `css/mmgr.css`. Wire the existing wrong-code modal trigger so the animation plays.
3. Add `#i-plus` symbol to `css/mmgr-icons.svg`.
4. Add `#i-shield` symbol to `css/mmgr-icons.svg`.
5. Smoke-test the four fixes.

### Phase B — Theme infrastructure

6. Decide and document the exact element that will carry `data-theme` (`<html>` recommended).
7. Add the cyan theme CSS blocks (light + dark) to `css/mmgr.css`, overriding only the token values listed in Section 3. Do not change component selectors yet.
8. Add the same cyan overrides to `css/marketing.css` (or shared token file) so marketing pages also respect the theme.
9. Create a tiny early-load helper (inline or first script) that:
   - Reads backend preference if available
   - Else reads `localStorage.mmgr_theme`
   - Else uses `"default"`
   - Sets `data-theme` on the root element
10. Implement the backend write/read path for the theme preference (Cloudflare Worker / user store). Keep localStorage in sync as cache.
11. Add the theme toggle UI next to the dark-mode control and in Settings. On change: backend write + localStorage write + live `data-theme` update.

### Phase C — Mobile shell (hamburger + sidebar)

12. Add hamburger icon to the header.
13. Implement left sidebar / drawer that houses the existing navigation groups.
14. On viewports ≤ 768 px the sidebar becomes an off-canvas drawer opened by the hamburger.
15. Ensure the AI entry point, lock indicator, and other header controls remain reachable.
16. Verify Focus Mode still hides the correct chrome.

### Phase D — Cleanup & safety

17. Search the entire codebase for remaining hard-coded gold/amber hexes that bypass tokens; replace with `var(--gold)` or the appropriate token so themes can control them.
18. Confirm no feature was removed or disabled.
19. Test every core page (index, app, project, admin, marketing) in:
    - default theme + light
    - default theme + dark
    - cyan theme + light
    - cyan theme + dark
    - after refresh (persistence)
    - offline (localStorage fallback)
20. Contrast check critical text/background pairs under cyan + dark.

### Phase E — Documentation & hand-off

21. Update any internal notes that still describe cyan as a full brand replacement.
22. Leave a short comment in the CSS and the theme helper stating how to add a future theme.

---

## 6. What Must Never Happen

- Removing or hiding any existing panel, button, AI feature, voice feature, or admin capability.
- Making cyan the new permanent default.
- Breaking light/dark mode.
- Relying only on localStorage when a backend path is available (backend is preferred).
- Shipping a theme that fails WCAG AA on primary text.

---

## 7. Testing Checklist (copy into PR / QA run)

- [ ] Default theme loads on first visit
- [ ] Switching to Cyan updates all pages immediately
- [ ] Refresh keeps the selected theme
- [ ] Backend preference wins when user is authenticated
- [ ] localStorage works offline / when backend is unreachable
- [ ] Light + Cyan looks correct
- [ ] Dark + Cyan looks correct (Blue Charcoal canvas, Fluorescent Blue accents)
- [ ] Hamburger opens sidebar/drawer on mobile
- [ ] All existing navigation targets still reachable
- [ ] AI tool still opens and functions
- [ ] Wrong-access-code modal shakes
- [ ] Google OAuth Client ID field persists
- [ ] `#i-plus` and `#i-shield` icons render
- [ ] No console errors on theme switch
- [ ] Marketing pages respect the active theme

---

## 8. Future Theme Recipe (for later)

1. Choose a short id (`"ocean"`, `"forest"`, …).
2. Add `[data-theme="ocean"]` and dark variant blocks that only set the same token names.
3. Add the option to the theme picker.
4. Teach the backend to accept the new string.
5. Done.

---

## 9. Reference Palette (user-supplied)

```json
{
  "fluorescent_blue": { "hex": "#50E8F4", "usage": "Primary Accents, Active States, Highlights" },
  "thin_air":         { "hex": "#C7F8FE", "usage": "Secondary Accents, Light Text, Subtle Background Highlights" },
  "blue_charcoal":    { "hex": "#001619", "usage": "Main Background, Deep Container Surfaces" }
}
```

These map onto the existing token system as described in Section 3. They do not replace the default gold theme.

---

*End of action plan. Apply in the order given. Do not invent extra scope. Preserve every working feature.*
