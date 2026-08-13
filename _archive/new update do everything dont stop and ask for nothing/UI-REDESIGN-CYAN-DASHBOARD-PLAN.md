# My MaNaGeR — UI Redesign Plan  
**Cyan Dashboard + Clean Sidebar Layout**  
Created: 2026-08-11  
Status: PLANNING (awaiting owner go-ahead before any code changes)

---

## 1. Goal

Replace the current warm gold/amber + green system and top-header + horizontal-pill navigation with:

1. A cool **cyan / fluorescent blue** color system (user-supplied palette).
2. A **Clean Dashboard** information architecture: fixed left sidebar + top header + responsive metric/grid content.
3. First-class **mobile** behaviour (sidebar → drawer, stacked metrics, scrollable tables/charts).

The redesign must keep the product’s core identity as a construction / project-controls tool (WBS, Gantt, RACI, EVM, decisions, meetings, etc.). It is not a generic e-commerce admin; the new shell must still surface all existing panels cleanly.

---

## 2. Official Color Tokens (new system)

These replace the current gold/amber family and the Liquid Amber Glass tokens.

| Token                  | Hex        | RGB              | Usage |
|------------------------|------------|------------------|-------|
| `--fluorescent-blue`   | `#50E8F4`  | 80, 232, 244     | Primary accent, active states, highlights, critical path, primary CTAs, chart accents |
| `--thin-air`           | `#C7F8FE`  | 199, 248, 254    | Secondary accents, light text on dark, subtle background highlights, soft badges |
| `--blue-charcoal`      | `#001619`  | 0, 22, 25        | Main canvas / deep background, sidebar surface, deep containers |
| `--on-fluorescent`     | `#001619`  | —                | Text / icons placed on fluorescent-blue fills (high contrast) |
| `--card` (dark)        | derived    | slightly lifted from charcoal | Primary cards / panels |
| `--border` (dark)      | derived    | low-opacity thin-air or fluorescent | Hairlines |
| `--text` (dark)        | near white / thin-air | —           | Primary text |
| `--text-secondary`     | muted cyan-gray | —            | Secondary / muted text |

### Design rules (non-negotiable)

- **One primary accent only** — Fluorescent Blue. No residual gold/amber hexes left in product or marketing CSS.
- Fluorescent Blue is the spotlight (borders, icons, active nav, critical Gantt bars, primary buttons).
- Thin Air is used for soft states, secondary labels, and subtle glows — never for primary actions.
- Blue Charcoal is the default dark canvas. Light mode (if retained) will need a parallel cool light set; decision pending.
- Dense data (Gantt body, tables, RACI matrix, long forms) stays on **solid** surfaces. Glass (if kept) is chrome only.
- All text/background pairs must pass WCAG AA. Fluorescent Blue on Blue Charcoal is high-contrast; verify every new combination.

### Migration note
Current marketing site and `css/mmgr.css` are built around gold + teal. Both product and marketing must move together so the brand remains unified.

---

## 3. Layout Architecture

### 3.1 Desktop (≥ 769 px)

```
┌──────────────┬────────────────────────────────────────────┐
│              │  Header (breadcrumbs / search / profile)   │
│   Sidebar    ├────────────────────────────────────────────┤
│   240 px     │                                            │
│   fixed      │  Metric summary cards (responsive grid)    │
│              │                                            │
│  - Main Menu │  Analytics / chart area                    │
│  - Project   │                                            │
│    tools     │  Data tables / recent activity / panels    │
│  - Settings  │                                            │
│              │                                            │
└──────────────┴────────────────────────────────────────────┘
```

- **Sidebar**: Fixed 240 px. Grouped navigation that maps the current section pills into hierarchical groups (Dashboard / Schedule / RACI / Risks / Decisions / Meetings / Admin tools / Settings).
- **Header**: Breadcrumbs, global search (if present), project name / lock indicator, profile / settings.
- **Main content**: Multi-column responsive grid. Metric cards at top, then chart / Gantt / primary panel, then secondary tables.

### 3.2 Mobile (≤ 768 px)

| Element              | Adaptation |
|----------------------|------------|
| Sidebar              | Collapsible off-canvas drawer, opened by hamburger icon in header |
| Metric cards         | Stack vertically into a single-column scrollable feed |
| Charts / Gantt       | Horizontal scroll wrappers or simplified view; no clipping |
| Tables               | Horizontal scroll or column prioritization |
| Floating actions     | Keep reachable; respect safe-area insets |

Breakpoints will use standard media queries + existing viewport helpers in `mmgr-viewport.js` where possible.

---

## 4. Mapping Current Features into the New Shell

The current app is panel-heavy. The new sidebar must not hide functionality.

Suggested sidebar groups (to be refined with owner):

1. **Overview** — Dashboard / Health / Portfolio roll-up
2. **Schedule** — WBS, Gantt, Tasks, Forecast
3. **Team & Governance** — RACI, Stakeholders, Decisions, Meetings
4. **Controls** — Risks, EVM, DMAIC, Claim / Closure
5. **AI & Voice** — AI window, Voice capture, Digests
6. **Project Admin** — Access codes, Sync, Cloud, Settings

Each current `sec-btn` / panel becomes a sidebar item or nested item. Active state uses Fluorescent Blue.

---

## 5. Implementation Phases

### Phase 0 — Bug fixes (independent, do first)
Apply the four confirmed bugs from `docs/CLAUDE-BUG-AUDIT-2026-08-11.md`:
1. `syncClientId` whitelist
2. `.shake` keyframes + class
3. Add `#i-plus` to sprite
4. Add `#i-shield` to sprite

### Phase 1 — Design tokens
- Create new token block in `css/mmgr.css` (and marketing counterpart).
- Replace every remaining gold / amber / old green usage with the cyan family.
- Keep semantic colours (`--danger`, `--success`, etc.) but restyle them to sit cleanly on the new canvas.
- Update `theme-color` meta, manifest, and any hard-coded hexes.

### Phase 2 — Shell structure
- Introduce sidebar markup + CSS (desktop fixed, mobile drawer).
- Move current top header content into the new header bar.
- Convert horizontal `.sec-nav` into sidebar navigation groups.
- Preserve Focus Mode behaviour (hide chrome, keep active panel).

### Phase 3 — Content density & components
- Restyle metric cards, badges, buttons, progress rings, Gantt bars to the new palette.
- Ensure dense tables and Gantt remain solid / readable.
- Update floating action / primary CTAs.

### Phase 4 — Mobile polish
- Hamburger + drawer interaction.
- Metric stacking.
- Horizontal scroll guards for charts and tables.
- Safe-area and touch target checks.

### Phase 5 — Marketing alignment
- Bring `css/marketing.css` and public pages onto the same cyan token set so marketing → app feels like one product.

### Phase 6 — QA & visual regression
- Extend existing QA harnesses where needed.
- Visual smoke on desktop + mobile viewports.
- Contrast audit on all new text/background pairs.

---

## 6. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Brand discontinuity (gold → cyan) | Explicit owner decision; both marketing and product move together |
| Dense panels feel cramped in sidebar shell | Keep content area wide; sidebar only for navigation |
| Accessibility regression with cyan on charcoal | Measure every pair; prefer Thin Air for secondary text |
| Mobile drawer conflicts with existing drawers/modals | Single source of truth for off-canvas layers; z-index audit |
| Incomplete local copy vs GitHub | Work against GitHub repo as source of truth; pull latest before coding |

---

## 7. Decision Points for Owner

Before any code is written, confirm:

1. **Proceed with full cyan pivot?** (Yes / No / Hybrid)
2. **Light mode** — keep a light variant or make dark (Blue Charcoal) the only mode for now?
3. **Sidebar grouping** — accept the draft groups above or supply preferred hierarchy?
4. **Glass** — keep optional glass chrome or go fully solid on the new dark canvas?
5. **Priority** — bug fixes first (Phase 0), then tokens, or start with visual shell?

---

## 8. Deliverables after approval

- Updated `css/mmgr.css` + `css/marketing.css` with new tokens
- New sidebar + header shell in `project.html` / `app.html` (and related pages)
- Mobile drawer behaviour
- Icon sprite additions
- Bug fixes from Claude audit
- Short visual QA notes

---

*This plan is derived from the user-supplied JSON palette, the Clean Dashboard Design reference images, Claude’s 2026-08-11 audit, and the current GitHub codebase structure. No implementation will begin until explicit owner go-ahead.*
