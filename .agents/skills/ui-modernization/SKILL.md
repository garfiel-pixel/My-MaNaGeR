---
name: ui-modernization
description: Modernize UI of existing web apps — typography, cards, buttons, banners, admin panels, marketing pages. Applies clean design principles with token-driven theming, dark mode support, and accessibility. Use when asked to "modernize UI", "update styling", "make it look modern", "refresh the design", or "improve the visual design" of an existing application.
---

# UI Modernization Skill

A systematic approach to modernizing the visual design of existing web applications while preserving functionality, accessibility, and theming support.

## Core Principles

1. **Token-first**: All colors, spacing, and typography use design tokens (CSS custom properties). Never hardcode values.
2. **Dark mode parity**: Every change must work in both light and dark themes. Test both.
3. **No emoji on served pages**: Icons are SVG only (sprite symbols or inline SVG). Never use emoji as icons.
4. **Accessibility**: WCAG 2.2 AA contrast, proper focus states, aria labels.
5. **Minimal changes**: Modify existing files. Don't create new ones unless necessary.

## OWNER DESIGN DOCTRINE (2026-08-17) — READ BEFORE ANY MARKETING OR WORKSPACE UI CHANGE

> The owner's standing answer to "what colors and surfaces do we use". Recorded 2026-08-17
> after reviewing the live site ("the color we're using is dark and it's not lively at all").
> This is a hard gate: follow it for every new or edited surface. It supersedes any
> gold/navy examples elsewhere in this skill for the marketing + workspace surfaces.

### 1. Color law — three simple colors
- **Front page / marketing site: BRIGHT BLUE + WHITE + BLACK TEXT.** Blue is the single
  accent (buttons, eyebrows, links, icon tiles, focus rings). Black/near-black text on white.
  The blue must be DECENTLY BRIGHT (e.g. #2563EB primary, #1D4ED8 text-accent on white,
  #3B82F6 hover) — never muted or muddy. The site's "navy" surfaces (footer, page-hero,
  guide band, photo overlays) use a DEEP BLUE (e.g. #1E3A8A), not near-black.
- **Inside the workspace / app: CYAN + WHITE + BLACK TEXT** (the existing cyan palette is
  the base; the app default palette should trend toward cyan + white + black text).
- **Dark mode:** accent brightens further (e.g. #60A5FA on dark) so it stays vivid; text is
  light, surfaces are dark. ⛔ NEVER ship dark-on-dark: a dark theme must re-map BOTH the
  surface tokens AND the text tokens in the same change. Black text on a black/dark
  background is a hard gate violation. Always measure the new pairs (WCAG 2.2 AA floor).
- Keep the palette simple: accent + white + black (or accent + dark + light). No rainbow.

### 2. Glass law — turn DOWN, never up
- Glass = the functional/navigation layer ONLY: sticky header, floating controls, sheets,
  modals. The header glass structure is good and stays.
- Content is SOLID, always: hero text, feature cards, steps, FAQ, forms, tables. The home
  page was "too glassy" — hero preview cards are SOLID white cards with a border + shadow,
  never translucent backdrop-filter cards. When a surface is decorative AND sits over a
  photo, a solid card still wins (Gate 6.1: glass never carries content).

### 3. Image protocol — request, never fabricate
- When a section would showcase better with real imagery (hero topics, feature showcases),
  REQUEST the images in chat and let the owner drop them into the repo (e.g. `images/`),
  then wire them in. Never generate, hotlink, or fake an image. Never ship a broken <img>
  src — either the asset is in the repo or the section stays text/mock.
- Pending (2026-08-17): the owner is creating three images for the three homepage hero
  topics (EVM / schedule-project / AI) — wire them into the hero showcase when they land.

### 4. Copy law
- No em/en dashes in any visible copy — use commas, periods, or colons. No "tagline
  tangles": eyebrow micro-copy that just repeats the headline gets removed.
- No emoji glyphs on served pages (SVG sprite only).

### 5. Scroll tracker (section indicator)
- Pages with sections carry a mini section tracker (scroll-spy). It must:
  (a) track the CURRENT section accurately (most-visible wins), (b) LOCK IN sections the
  reader has already passed (a filled stick / dimmed label persists), so it reads as a
  progress trail that follows the reader down the page, (c) show its labels without
  requiring hover (a tracker you cannot read is not a tracker).

### 6. Nav dropdowns
- Hover dropdowns ONLY for small topics (Features, About, Contact, Reviews). NEVER for a
  huge topic (the Field Guide — it is a whole destination, not a menu).
- A dropdown is a SIMPLE light box: solid white/light card, rounded, soft shadow, plain
  text rows in columns. When one opens, BLUR the page behind it (a fixed backdrop-filter
  scrim) so the reader focuses on the menu. The scrim is the close affordance (click it),
  plus Escape and picking an item.

### 7. Feature lists
- Long feature lists render as a FLAT HORIZONTAL BAR that auto-ticks one card at a time,
  looping continuously while the page is in view. The reader can steer it (prev/next) but
  never has to. Auto-tick pauses on hover/focus/touch and dies under
  prefers-reduced-motion (the bar stays manually scrollable). Undocumented real features
  get added to the bar so the list stays honest and full.

## Step-by-Step Process

### Phase 1: Audit Current State
1. Read all CSS files (main + page-specific)
2. Read all HTML pages (identify inline styles vs class-based)
3. Read JS files that render UI (action maps, render functions)
4. Identify the token system (CSS custom properties)
5. Check dark mode token overrides

### Phase 2: Typography Modernization
1. Update font stack to include Inter or similar modern sans-serif
2. Add font-feature-settings for better character rendering
3. Establish clear hierarchy:
   - Headings: 700-800 weight, tight letter-spacing (-0.01 to -0.025em)
   - Body: 400 weight, 1.5-1.6 line-height
   - Labels: 600-700 weight, uppercase with letter-spacing
   - Small text: 0.72-0.78rem with muted color

### Phase 3: Card System
Modern cards should have:
- Clean white/light background (var(--card) or var(--glass-fill-dark))
- Subtle border (1px solid var(--border))
- Rounded corners (use existing radius tokens)
- Subtle shadow on hover (not always visible)
- Consistent padding (18-28px)
- Smooth transitions (120-180ms)

```css
.card {
  background: var(--glass-fill-dark);
  border: var(--glass-border);
  border-radius: var(--squircle-md);
  padding: 20px;
  transition: border-color var(--tr), box-shadow var(--tr);
}
.card:hover {
  box-shadow: 0 4px 20px rgba(16, 24, 40, 0.08);
}
```

### Phase 4: Button Hierarchy
Three tiers of buttons:
1. **Primary** (`.btn-g`): Solid color, subtle shadow, hover deepens
2. **Secondary** (`.btn-n`): Ghost/outline, transparent background
3. **Destructive** (`.btn-d`): Red outline, hover fills red

```css
.btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 16px; border-radius: var(--radius);
  font-size: 0.8rem; font-weight: 600;
  transition: all var(--tr);
}
.btn:active { transform: scale(0.98); }
.btn-g {
  background: var(--green); color: #fff;
  box-shadow: 0 1px 3px rgba(4, 120, 87, 0.25);
}
.btn-g:hover {
  background: #03644f;
  box-shadow: 0 2px 8px rgba(4, 120, 87, 0.35);
}
.btn-n {
  background: transparent; border: 1px solid var(--border);
  color: var(--slate);
}
.btn-n:hover {
  border-color: var(--gold); color: var(--gold);
  background: rgba(var(--gold-rgb), 0.04);
}
.btn-d {
  background: transparent; border: 1px solid rgba(220, 53, 69, 0.3);
  color: var(--danger);
}
.btn-d:hover {
  background: rgba(220, 53, 69, 0.08);
  border-color: var(--danger);
}
```

### Phase 5: Admin Panel Modernization
1. **Sticky header**: `position: sticky; top: 0; z-index: 100; background: var(--card);`
2. **Project rows**: Card-like with hover state, clear title/description/meta hierarchy
3. **Hidden technical docs**: Use accordion pattern (click to expand/collapse)
4. **Button hierarchy**: Primary for adding, secondary for actions, destructive for delete
5. **Masked codes**: Show dots by default, toggle to reveal, copy button

### Phase 6: Marketing Pages
1. **Feature cards**: Consistent padding, icon + title + description + tag
2. **Contact tiles**: Icon + heading + description, hover lift
3. **Photo bands**: Full-width image with overlay, solid content layer
4. **Footer**: Clean grid layout, brand + columns

### Phase 7: App Dashboard
1. **Card grid**: `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))`
2. **Settings gear**: Hide backup/setup controls behind a toggle button
3. **Clean notice boxes**: Centered, subtle background, clear messaging
4. **Cloud dashboard**: Plan status strip, project cards

## CSS Patterns

### Accordion (for hidden technical docs)
```css
.accordion { border: 1px solid var(--border); border-radius: var(--radius); }
.accordion-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; background: var(--tile-bg);
  cursor: pointer; font-size: 0.74rem; font-weight: 600;
}
.accordion-body { display: none; padding: 12px 14px; border-top: 1px solid var(--border); }
.accordion.open .accordion-body { display: block; }
```

### Settings Toggle (hide/show controls)
```javascript
// In action map:
'toggleSettings': () => {
  const el = document.getElementById('cloud-sync-controls');
  if (el) el.hidden = !el.hidden;
}
```

### Masked Code Display
```html
<span class="code-masked">
  <span class="masked-val" id="code-0" data-code="ABC123" data-masked="1">********</span>
  <button class="toggle-vis" data-action="toggleCode" data-idx="0">Show</button>
  <button class="copy-btn" data-action="copyCode" data-idx="0">Copy</button>
</span>
```

## Verification Checklist

After making UI changes:
1. Run `npm run verify` (CSP + SW + skills)
2. Check both light and dark mode
3. Check mobile responsive (375px, 768px)
4. Verify no emoji on served pages
5. Run relevant qa-*.cjs harnesses
6. Test keyboard navigation (Tab, Escape, Enter)
7. Check focus states are visible

## Common Pitfalls

1. **CSP hash drift**: If you modify inline `<script>` blocks, regenerate hashes with the node command in worker.js header
2. **SW cache stale**: Bump the version string in sw.js when shell assets change
3. **Dark mode breakage**: Always check `body.dark-mode` overrides exist for new tokens
4. **Emoji on pages**: Scan for emoji glyphs (U+1F000-1FAFF, 2600-27BF) — replace with SVG icons
5. **Missing action handlers**: New `data-action` attributes need entries in ACTION_MAP

EXAMPLES  

+---------------------------------------------------------------------------------------------------------+

|  🛠️ My MaNaGeR — Admin Suite                                       [⚙️ Deployment Config] (👤 Sign Out) |
+---------------------------------------------------------------------------------------------------------+

|                                                                                                         |
|  [➕ New Project]   [📥 Download Public Data]   [📤 Export Admin Backup (.csv)]                          |
|                                                                                                         |
|  +---------------------------------------------------------------------------------------------------+  |
|  | 🔑 Cloud Providers Connection (D1 + R2 Datastores)                                                 |  |
|  | Admin API Code: [•••••••••••••••••••••••••••••••••••••••••] [👁️]                 [🔄 Fetch Projects]  |
|  +---------------------------------------------------------------------------------------------------+  |
|                                                                                                         |
|  📂 Managed Infrastructure Projects                                                                      |
|                                                                                                         |
|  +---------------------------------------------------------------------------------------------------+  |
|  |  Riverside Tower Renovation                                                      [🟢 ACTIVE] [Demo] |  |
|  |  ID: demo-project  |  Path: project.html?id=demo-project                                             |  |
|  |                                                                                                      |  |
|  |  +----------------------------------------+  +----------------------------------------------------+  |
|  |  | 🔐 Access Code: •••••••• [👁️] [📋 Copy] |  | ⚠️ Status: Not published to live network           |  |
|  |  +----------------------------------------+  | [🚀 Download & Publish]                            |  |
|  |                                              +----------------------------------------------------+  |
|  |  [✏️ Edit Metadata]   [🔄 Cycle Access Key]   [🔗 View Public URL]                       (🗑️ Delete)  |
|  +---------------------------------------------------------------------------------------------------+  |
|                                                                                                         |
|  +---------------------------------------------------------------------------------------------------+  |
|  |  The New WAVE                                                                   [🔵 PLANNING]        |  |
|  |  ID: the-new-wave  |  Path: project.html?id=the-new-wave  |  View-Only Hash: 7CETMKUM2J              |  |
|  |                                                                                                      |  |
|  |  +----------------------------------------+  +----------------------------------------------------+  |
|  |  | 🔐 Access Code: •••••••• [👁️] [📋 Copy] |  | ⚠️ Status: Not published to live network           |  |
|  |  +----------------------------------------+  | [🚀 Download & Publish]                            |  |
|  |                                              +----------------------------------------------------+  |
|  |  [✏️ Edit Metadata]   [🔄 Cycle Access Key]   [🔗 View Public URL]                       (🗑️ Delete)  |
|  +---------------------------------------------------------------------------------------------------+  |
+---------------------------------------------------------------------------------------------------------+




ANOTHER EXAMPLE 

 The Transformation Blueprint+-----------------------------------------------------------------------------------------+

| [🎨 Top Right Global Bar]                                         (🌗 Dark) (🎨 Theme) |
+-----------------------------------------------------------------------------------------+

|                                                                                         |
|                                                                                         |
|                        +---------------------------------------+                        |
|                        |                 [🔒]                  |                        |
|                        |             Admin Access              |                        |
|                        |  Please authenticate to enter the     |                        |
|                        |  management control suite.            |                        |
|                        |                                       |                        |
|                        |  Admin Password                       |                        |
|                        |  +---------------------------------+  |                        |
|                        |  | ••••••••••••••••••••••••••• [👁️] |  |                        |
|                        |  +---------------------------------+  |                        |
|                        |                                       |                        |
|                        |  [    🔓 Unlock Admin Control Panel  ] |                        |
|                        |                                       |                        |
|                        |  [← Return to Workspace]              |                        |
|                        +---------------------------------------+                        |
|                                                                                         |
|                                                                                         |
+-----------------------------------------------------------------------------------------+

ANOTHER EXAMPLE ------------------------------------------------------------------------+

|  ✨ My MaNaGeR                                                (⚙️) [👤 garack...]        |
+-----------------------------------------------------------------------------------------+

|                                                                                         |
|  👋 Welcome Back, Garfield!                                                             |
|  Select a project to access its real-time dashboard, risk registers, and active budgets. |
|                                                                                         |
|  +-----------------------------------------------------------------------------------+  |
|  | 🚀 Upgrade to Premium: Unlock unlimited projects and advanced Gantt tools.  [Learn More] |  |
|  +-----------------------------------------------------------------------------------+  |
|                                                                                         |
|  📁 Your Cloud Projects (1 of 8 used)                                                    |
|  +---------------------------+ +---------------------------+ +---------------------------+ |
|  | 🟢 the-new-wave           | | ➕ Create New            | |                           | |
|  | Last saved: Aug 11, 2026  | |                           | |                           | |
|  | Base: Linked to garack    | |                           | |                           | |
|  |                           | |                           | |                           | |
|  | [Open Project]  (🗑️)      | | [ New Project ]           | |                           | |
|  +---------------------------+ +---------------------------+ +---------------------------+ |
|                                                                                         |
|  +-----------------------------------------------------------------------------------+  |
|  | 🔒 Need a private workspace? Contact your system admin to register an access code. |  |
|  +-----------------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------------+ LAYOUT MATTERS DONT JUST SLAP THINGS TOGETHER LIKE ANY OTHER AI STRUCTURE IT MAKE IT MODERN NOT JUST SOME ICONS ON A SCREEN TO JUST CLICK CLICK CLICK 

## My MaNaGeR Project-Specific UI Patterns

### Token system
The project uses a three-tier token system:
- **Primitives**: Raw color values (--gold-400, --slate-900, etc.)
- **Semantic**: Intent-carrying names (--color-brand-primary, --color-surface, etc.)
- **Component**: Scoped to UI parts (--button-bg-primary, --table-row-hover, etc.)

### Glass surfaces
Glass (backdrop-filter: blur) is used ONLY on chrome elements:
- Header/navigation bar
- Floating controls/panels
- Modals and sheets
- Toast notifications

Glass is NEVER used on dense content (tables, forms, long text). Dense content sits on solid `--color-surface` or `--color-surface-raised`.

### Dark mode tokens
Dark mode uses warm tones (--db-gold: #E8923A, --db-jet-black: #1a1614, --db-surface: #242019). Never cold blue-black tones. The dark theme re-maps BOTH surface AND text tokens in the same change.

### Card language
Every card, add-form, and nested panel uses the app's card language:
- `--glass-fill-dark` or `--color-surface` background
- `--glass-border` or `1px solid var(--border)`
- `--squircle-md` radius
- `--pad-card` padding
- Never a flat `--tile-bg` square box with hard corners

### Badge/status system
- `.bg` = green/On Track
- `.ba` = amber/At Risk  
- `.br` = red/Blocked
- `.bo` = gold/Brand (caution)
- `.bs` = slate/Neutral
- Text labels always accompany badges

### Toast notifications
Toasts are pill-shaped glass chips with:
- Circular icon tile + one-word label + message
- Types: ok (green), err (danger), warn (amber)
- Smooth slide-up + hold + graceful fade-out
- `prefers-reduced-motion` kills the slide

### Empty states
Every panel must have an empty state when no data exists. The pattern:
- Icon + heading + description + action button
- Example: "No permits added yet. Click Add to track permits and inspections."

### Responsive breakpoints
- Mobile: <=600px (stacked layout, hamburger nav)
- Tablet: 601-768px (partial grid)
- Desktop: >768px (full grid, sidebar rail)

### Focus states
ONE app-wide focus ring: gold border + soft ring. No per-component focus rules. `--on-primary` token ensures button contrast.

### Field guide
Every new feature MUST ship with its field guide entry (mymanager-field-guide.html) in the SAME change. The field guide is the app's companion and must never drift.