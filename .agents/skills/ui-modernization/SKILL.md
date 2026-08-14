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