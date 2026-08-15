# My MaNaGeR — ULTIMATE NEW UI CREATION PLAN
**Authoritative contract for the remake of Projects · Admin · Project view**  
**Version:** 2.0 · 2026-08-14  
**Status:** BINDING — any implementer (human or LLM) must re-read this entire document before writing a single line of UI code.

---

## ⚠ MANDATORY PRE-IMPLEMENTATION GATE

**STOP. Re-read this file end-to-end before any HTML, CSS, or JS change.**

This is not a “make it prettier” note. It is a full creation contract for a **new app shell** on three surfaces only. Surface-level restyles of the old horizontal pill nav are **out of scope and rejected**.

If you are an LLM: do not summarize this away. Do not invent a fourth page. Do not replace the sun/moon control with the menu. Do not remove AI, Gantt, voice, RACI, or cloud. Do not ship pure `#000` text. Do not give nested cards the same `border-radius` as their inner buttons.

---

## 0. Scope lock

| Surface | File | Role |
|---------|------|------|
| **Projects** | `app.html` | Launcher — list, unlock, open projects |
| **Admin** | `admin.html` | Create/edit projects, codes, publish |
| **Project view** | `project.html` | Live workspace (Dashboard, WBS, Gantt, Budget, Kanban, …) |

**Out of scope (do not touch):**  
`index.html`, `about.html`, `features.html`, `contact.html`, `mymanager-field-guide.html`, marketing CSS.

**Data rule:** Existing state, panels, ACTION_MAP handlers, AI, voice, weather, packs, and cloud stay.  
Work is **shell + layout + chrome + optical quality**. Panels mount into the new shell.

---

## 1. Reference visual system (owner-supplied)

These patterns define the target — not optional moodboards.

### 1.1 Icon rail + main workspace (Gantt reference)
- Narrow **dark left icon rail** (home, calendar, people, chart, add, settings, exit).
- Large white/light **content card** with clear title breadcrumb.
- Gantt: task rows, colored bars, avatars on bars, today line.
- **Implication for us:** Project view primary nav lives in a **left column**, not a wrapping horizontal pill strip.

### 1.2 Metric dashboard language
- Cards: Budget / Cost with trend, donut “Total” with legend, bar chart.
- Soft elevation, generous padding, clear numeric hierarchy.
- **Implication:** Project Dashboard uses the same card math — aligned metrics, not cramped uneven columns.

### 1.3 Secondary left meta + overview grid (Teamwork-style)
- Left column: description, tags, category, dates, reports.
- Main: Overview title, Summary/Activity tabs, Tasks / Digest / Breakdown cards.
- **Implication:** Dense project meta can sit in a secondary column; primary work stays center-right.

### 1.4 Current My Manager (what we are leaving)
- Horizontal grouped pills across the full width.
- Three dark cards (Completion / Health / Next actions) with weak optical alignment.
- **This layout is the problem.** Do not “polish” it — replace the shell.

### 1.5 Plaky-style dark table + sidebar
- Persistent left workspace tree + main table (timeline, assignee, status pills).
- Dark surfaces, high-contrast status chips, clear section headers.
- **Implication:** Admin lists and project tables should feel this ordered, not like stacked generic divs.

### 1.6 Structured Gantt / dependency clarity
- Phases as parent bars; children indented; diamond milestones.
- **Implication:** Existing Gantt data stays; visual hierarchy of phases vs tasks must remain readable inside the new shell.

---

## 2. Interaction model (non-negotiable)

### 2.1 Left navigation + hamburger

- **Hamburger** (`i-menu` SVG) opens/closes the left nav.  
- **Sun/moon stays theme-only.** Never reuse it as the menu control.
- Left drawer holds **all primary destinations** for that surface.
- Mobile (≤768px): off-canvas drawer + scrim; Escape and scrim close it.
- Desktop (≥769px): prefer **pinned ~240px rail** when sidebar preference is on; otherwise overlay drawer still available.
- Preference key: `localStorage.mmgr_sidebar` = `"on"` | `"off"` (default may be `"on"` for the new shell on fresh installs; existing users can keep off until they opt in).

### 2.2 Fitts’ Law placement

- High-frequency controls (hamburger, search if any, close, settings) sit on **edges/corners**, not floating in empty center whitespace.
- Primary CTA in content areas stays large enough for thumb targets on mobile (min ~44×44px hit area).

### 2.3 Ethical friction

- **Low friction:** open project, switch section, save, navigate.
- **High friction:** delete project, wipe data, regenerate access codes — multi-step confirm, never a single accidental click.

---

## 3. Hard UX metrics (apply these, ignore the rest of the blog noise)

| Principle | Rule for this product |
|-----------|------------------------|
| **50ms first impression** | Header + rail + first content card must read as one coherent product immediately. No layout jump after theme apply (theme pre-paint scripts stay). |
| **F-pattern** | Logo/brand and primary nav on the **left**. Headings left-aligned. Do not center long body copy. |
| **Friction** | Access-code form stays short. Destructive admin actions stay confirmed. |
| **CTA visibility** | Primary actions (Open, Unlock, Add Project, Add Task) visible without hunting. |
| **Performance** | SVG icons only for UI chrome. No new heavy image stacks in the shell. Respect existing offline-first constraints. |
| **Mobile** | Single-column main content ≤768px; drawer is the nav; sticky useful actions where they already exist. |

---

## 4. Optical & mathematical rules (the difference between “fine” and premium)

### 4.1 Law of Nested Radii

```
outer_radius = inner_radius + padding
```

Example: button `border-radius: 8px` inside card with `padding: 16px` → card radius **24px**, not 8px or 12px on both.

Implement as tokens where possible:

```css
:root {
  --radius-control: 8px;
  --pad-card: 16px;
  --radius-card: calc(var(--radius-control) + var(--pad-card)); /* 24px */
}
```

### 4.2 No pure black / pure white text pairs

- Prefer ink like `#0F172A` / `#1E293B` on light, and off-white `#E2E8F0` on dark — already close to existing tokens.
- **Forbidden in new chrome:** `color: #000` or `background: #000` for body text surfaces.
- Dark mode accents must use **higher-luminance, slightly desaturated** variants of gold/cyan (existing cyan dark tokens already lean this way — do not regress).

### 4.3 Semantic color anchoring

- **Gold / primary accent** = interactive emphasis (primary buttons, active nav, key metrics).
- **Green** = success / completed / positive.
- **Red** = danger / blocked / destructive.
- **Slate/gray** = structure, labels, non-clickable chrome.
- Do **not** paint every icon gold “because brand.” Inactive nav icons stay muted; active state earns the accent.

### 4.4 Optical center for icons

- Play/arrow/sparkle icons in circular buttons often need `transform: translateX(0.5px–2px)` (or equivalent) so they *look* centered.
- Prefer eye-check over pure flexbox center for asymmetrical glyphs.

### 4.5 Cap-height / type optical alignment

- Icon + label rows: if text looks low, nudge with `translateY(-0.5px)` to `-1px` on the label, not by increasing line-height chaos.
- Section labels: uppercase, tracked, muted — consistent across rail groups.

### 4.6 Gradients

- If any gradient is required, prefer **OKLCH** interpolation over raw RGB to avoid muddy midpoints.
- Prefer flat token surfaces for data density (tables, Gantt, forms).

### 4.7 Cognitive load curve

- **Shell chrome:** calm, predictable, low novelty.
- **Dashboard:** moderate energy — clear metrics, not celebration confetti.
- **Destructive modals:** lowest visual energy — no decorative sidebar, no extra marketing, only the decision.

---

## 5. Shell architecture (all three surfaces)

```
┌──────────────────────────────────────────────────────────┐
│ HEADER  [☰]  Brand/Greeting    context controls    status │
├────────────┬─────────────────────────────────────────────┤
│            │                                             │
│  LEFT NAV  │              MAIN WORKSPACE                 │
│  (rail /   │         (cards · tables · panels)           │
│   drawer)  │                                             │
│            │                                             │
└────────────┴─────────────────────────────────────────────┘
```

### 5.1 Shared CSS skeleton (illustrative — adapt to existing tokens)

```css
/* Shell layout — desktop pinned rail */
.app-shell {
  display: grid;
  grid-template-columns: var(--rail-w, 240px) 1fr;
  grid-template-rows: var(--hdr-h, 64px) 1fr;
  min-height: 100vh;
}
.app-header {
  grid-column: 1 / -1;
  position: sticky;
  top: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  background: var(--card);
  border-bottom: 1px solid var(--border);
}
.app-rail {
  grid-row: 2;
  grid-column: 1;
  border-right: 1px solid var(--border);
  background: var(--card);
  overflow-y: auto;
}
.app-main {
  grid-row: 2;
  grid-column: 2;
  padding: 20px 24px;
  overflow: auto;
  background: var(--canvas);
}

/* Mobile: rail becomes drawer */
@media (max-width: 768px) {
  .app-shell {
    grid-template-columns: 1fr;
  }
  .app-rail {
    position: fixed;
    inset: var(--hdr-h, 64px) auto 0 0;
    width: min(84vw, 300px);
    transform: translateX(-105%);
    transition: transform 0.24s cubic-bezier(0.25, 1, 0.5, 1);
    z-index: 96;
  }
  body.nav-open .app-rail {
    transform: translateX(0);
  }
  .nav-scrim {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.45);
    opacity: 0;
    pointer-events: none;
    z-index: 94;
  }
  body.nav-open .nav-scrim {
    opacity: 1;
    pointer-events: auto;
  }
}
```

### 5.2 Hamburger control (illustrative)

```html
<button type="button"
  class="nav-btn"
  id="nav-btn"
  data-action="tglNav"
  aria-label="Open navigation"
  aria-expanded="false"
  aria-controls="app-rail">
  <svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-menu"></use></svg>
</button>
```

```js
// Pattern only — wire into existing ACTION_MAP style
function tglNav() {
  const open = document.body.classList.toggle('nav-open');
  const btn = document.getElementById('nav-btn');
  if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}
```

### 5.3 Nested radius example

```css
.metric-card {
  padding: var(--pad-card); /* 16px */
  border-radius: var(--radius-card); /* 24px */
  background: var(--card);
  border: 1px solid var(--border);
}
.metric-card .btn {
  border-radius: var(--radius-control); /* 8px */
}
```

---

## 6. Surface specifications

### 6.1 Projects (`app.html`)

**Rail**
- All projects  
- Admin → `admin.html`  
- Optional: cloud section anchor  

**Main**
- Welcome + theme controls  
- Cloud projects strip (existing behaviour)  
- Metric summary if present  
- Project card grid (unlock modal unchanged)  

**Quality bar**
- Cards: equal padding, nested radii, hover border uses accent token only.  
- Lock/unlock icons optically balanced.  
- No centered essay text in the hero.

### 6.2 Admin (`admin.html`)

**Rail**
- Project list focus  
- New project  
- Cloud admin  
- Export actions  

**Main**
- Toolbar primary: New Project  
- Rows: title hierarchy, masked codes, status chips, ethical friction on Delete / Regenerate code  

**Quality bar**
- Gate screens: low visual energy, single primary CTA.  
- Tables/rows: Plaky-like clarity — status pills, not noisy badges everywhere.

### 6.3 Project view (`project.html`)

**Rail groups (same sections as today)**

```
Overview     → Dashboard, Definitions
Planning     → Charter, WBS, Gantt
Execution    → Kanban, Resources, Budget
Governance   → Stakeholders, Changes, Decision Log, Risk/Issues, Claim Pack
Closeout     → Closure, RACI, Comms Log, Documents
Field/Quality→ Meetings, DMAIC (if pack on)
```

Use existing `data-action="showSec"` + `data-section="..."` so panel modules do not change.

**Header**
- Greeting, methodology tabs, hamburger, back to projects, backup/timeline/presence chips, settings  

**Main**
- Active panel only  
- Focus Mode hides header + rail  

**Dashboard panel (I5 priority)**
- Metric cards in a consistent grid (completion, health factors, next actions).  
- Status rows: fixed row height, label left, count right.  
- No orphan short columns; optical alignment over “three random stacks.”

**Nav policy**
- Horizontal `.sec-nav` pills are **not** the primary navigation in the new shell.  
- They may be removed from the default path once the rail is complete; do not leave users with two competing primary navs.

---

## 7. Token & theme rules

- Keep **gold default** + **cyan alternate** via `html[data-theme="..."]`.  
- `body.dark-mode` remains device preference.  
- Glass only on functional chrome if used; **data surfaces stay solid** (tables, Gantt, forms, metric cards).  
- Extend tokens rather than scattering hex.  
- Dark mode accents: higher luminance variants — never copy light-mode saturation onto jet backgrounds.

---

## 8. Code quality bar (reject weak implementation)

**Required**
- Token-driven CSS; no random hex in components.  
- `data-action` delegation consistent with existing app.  
- `aria-expanded`, `aria-controls`, focus-visible rings.  
- `prefers-reduced-motion` kills non-essential transitions.  
- `prefers-reduced-transparency` flattens any blur.  
- SVG sprite icons only.

**Rejected**
- Emoji as icons.  
- Inline `onclick=` proliferation.  
- Pure `#000` / `#fff` body text pairs.  
- Same radius on parent and child without nested-radius math.  
- “Centered everything” marketing layouts inside the app shell.  
- Duplicate nav systems both claiming to be primary.  
- Half-finished drawers that do not list all sections.

**Example — status row (Dashboard)**

```html
<div class="status-row" role="listitem">
  <span class="status-label">In Progress</span>
  <span class="status-count" data-status="in-progress">0</span>
</div>
```

```css
.status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 36px;
  padding: 6px 0;
  border-bottom: 1px solid var(--border);
  font-size: 0.86rem;
}
.status-label { color: var(--text); font-weight: 600; }
.status-count {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  color: var(--slate);
  min-width: 1.5rem;
  text-align: right;
}
```

**Example — rail nav item**

```css
.rail-link {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-control);
  color: var(--slate);
  font-weight: 600;
  font-size: 0.84rem;
}
.rail-link:hover {
  color: var(--text);
  background: color-mix(in oklch, var(--gold) 8%, transparent);
}
.rail-link[aria-current="page"],
.rail-link.active {
  color: var(--on-gold);
  background: var(--gold);
}
.rail-link .ico {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
```

---

## 9. Build increments (ship in order)

| ID | Deliverable | Done when |
|----|-------------|-----------|
| **I1** | Shared shell: header + hamburger + left rail/drawer on all three pages | Opens/closes; scrim; Escape; no panel rewrite |
| **I2** | Projects page fully on shell | Grid, unlock, cloud strip work |
| **I3** | Admin fully on shell | Gate, rows, cloud admin work |
| **I4** | Project view: all sections via rail | Pills no longer required to navigate |
| **I5** | Dashboard metrics/status optical layout | Aligned cards/rows; nested radii |
| **I6** | Polish pass | Light/dark/cyan; reduced motion; focus rings; no pure black text |

Do **not** collapse I1–I6 into one undirected “modernize the UI” pass.

---

## 10. LLM implementation prompt (copy exactly for I1)

```text
You are implementing Increment I1 only of MMGR-NEW-UI-CREATION-BRIEF.md (re-read that file first).

Goal: New app shell on app.html, admin.html, project.html.
- Left navigation rail/drawer opened by HAMBURGER (i-menu), not sun/moon.
- Desktop ~240px rail preferred; mobile off-canvas + scrim.
- Token-first CSS; nested radius math; no pure #000 body text.
- Semantic color: accent = interactive only.
- Do not redesign marketing/guide.
- Do not remove AI, Gantt, voice, panels, or data logic.
- Do not leave horizontal pills as the only primary nav on project.html once the rail lists all sections.
- Wire toggles via existing data-action patterns.
- Deliver working shell only; no drive-by refactors.

After changes, verify: hamburger toggles rail, Escape closes, focus-visible works, light and dark both readable.
```

---

## 11. Verification checklist (every increment)

- [ ] Re-read this document before coding  
- [ ] Hamburger ≠ theme control  
- [ ] Left nav lists the correct destinations for the surface  
- [ ] Nested radii on cards/buttons  
- [ ] No `#000` body text; dark accents luminance-adjusted  
- [ ] F-pattern: primary nav left  
- [ ] Mobile drawer usable one-handed  
- [ ] Reduced motion / reduced transparency respected  
- [ ] Existing unlock, save, section switch, AI still work  
- [ ] No emoji icons  

---

## 12. What “above the usual” means here

Most UI rewrites stop at: new colors, border-radius 12px everywhere, a sidebar component, and a congratulatory README.

This plan demands:

1. **Structural** left-rail product chrome matching the owner references.  
2. **Mathematical** nested radii and optical alignment.  
3. **Semantic** color discipline.  
4. **Behavioral** Fitts + ethical friction.  
5. **Incremental** shipping so the shell is real before polish.  
6. **Panel preservation** so the product does not regress into a pretty empty shell.

If an implementation only restyles `.sec-nav` pills, it has **failed this contract**.

---

*End of ultimate creation plan. Re-read before implementation.*
