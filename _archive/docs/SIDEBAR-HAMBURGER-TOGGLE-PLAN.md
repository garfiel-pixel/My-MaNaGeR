# My MaNaGeR — Sidebar + Hamburger Toggle Plan
**Single-purpose instruction file**  
Created: 2026-08-12  
Scope: Left sidebar layout + hamburger icon only. No theme work, no feature removal.

---

## Goal

Add a **left sidebar** that holds the main navigation groups.  
It is opened/closed by a **hamburger icon**.  
The sidebar is a **user preference** — the user can turn the sidebar layout on or off. Preference is saved (localStorage + backend when available) and applied on every page load.

Default behaviour:
- **Desktop**: sidebar can start open or closed based on saved preference (default = closed / current top-nav layout if preference is off).
- **Mobile (≤768px)**: sidebar is always an off-canvas drawer; hamburger opens it.

**Non-negotiable:** Do not remove, hide, or break any existing panel, AI tool, voice, Gantt, RACI, or other working feature. Only add the sidebar shell and the toggle.

---

## Behaviour rules

1. Hamburger icon lives in the header (left side, near the greeting or brand).
2. Clicking hamburger toggles the sidebar open/closed.
3. When sidebar is **enabled** (preference on):
   - Nav groups move into (or are duplicated into) the sidebar.
   - Main content shifts right on desktop when sidebar is open.
4. When sidebar is **disabled** (preference off):
   - Current horizontal pill navigation stays as the primary nav (current look).
   - Hamburger can still open a simple drawer of the same links on mobile.
5. Preference key: `mmgr_sidebar` → `"on"` | `"off"` (default `"off"` so current users see no change until they opt in).
6. Also persist to backend when the user is signed in (same pattern as theme preference if that exists).
7. Focus Mode must still hide the sidebar/hamburger chrome when active.

---

## Files to touch (expected)

- `css/mmgr.css` — sidebar layout, drawer, hamburger button, responsive rules
- `project.html` (and any shared header partial) — hamburger button markup + sidebar container
- `js/mmgr-app.js` or `js/mmgr-viewport.js` — toggle logic, preference read/write, class on `<body>` or `<html>`
- Optionally `app.html` / `admin.html` if they share the same header chrome

Do **not** delete existing `.sec-nav` / pill navigation code. Reuse or mirror the same links inside the sidebar.

---

## Implementation checklist

1. Add hamburger button in the header (`aria-label="Open menu"`, icon from existing sprite or simple CSS/SVG bars).
2. Add sidebar container (`#app-sidebar` or similar) with the existing nav groups inside it.
3. CSS:
   - Desktop: fixed left sidebar, width ~240px, slides in/out or toggles with a class on `body` (e.g. `body.sidebar-on`).
   - Mobile: off-canvas drawer (transform translateX), overlay backdrop optional.
   - Main content margin/padding adjusts when `sidebar-on`.
4. JS:
   - On load: read `localStorage.mmgr_sidebar` (and backend if available) → apply class.
   - Hamburger click: toggle class + write preference.
   - Settings (or a small control near the sun/dark toggle): explicit “Sidebar layout” on/off switch.
5. Ensure all current section buttons still activate the correct panels.
6. Test Focus Mode still hides the new chrome.
7. Test mobile: hamburger opens drawer; links work; drawer closes after navigation if desired.

---

## Ready-to-paste AI prompt

Copy everything inside the block below and give it to Claude / Cursor / your coder:

```text
TASK: Add a toggleable left sidebar + hamburger menu to My MaNaGeR. Do not remove or break any existing features.

REQUIREMENTS:
1. Add a hamburger icon button in the app header.
2. Clicking it opens/closes a left sidebar that contains the main navigation groups (Dashboard, Definitions, Charter, WBS, Gantt, Kanban, Resources, Budget, Stakeholders, Changes, Decision Log, Risk/Issues, Claim Pack, Closure, RACI, Comms Log, Documents, DMAIC, Meetings, etc.).
3. The sidebar is a USER PREFERENCE:
   - localStorage key: mmgr_sidebar = "on" | "off"
   - Default: "off" (keep current horizontal pill nav as primary until user opts in)
   - When signed in, also save/load this preference from the backend if a user-preference endpoint exists; otherwise localStorage is enough.
4. Desktop: when preference is "on", show a fixed ~240px left sidebar; main content shifts right. Hamburger toggles it.
5. Mobile (max-width: 768px): sidebar is always an off-canvas drawer opened by the hamburger.
6. Do NOT delete the existing top horizontal .sec-nav / pill navigation. Keep it working. Sidebar reuses the same links/actions.
7. Focus Mode must continue to hide header/sidebar chrome.
8. Do not remove AI button, voice, Gantt, RACI, or any other working feature.
9. Use existing CSS tokens and dark-mode classes. Match current visual style (dark surfaces, gold/accent highlights).
10. Add a simple on/off control for “Sidebar layout” near the existing theme/dark-mode controls or inside Settings.

FIX the current Dashboard alignment while you are there:
- The status list (In Progress, At Risk, Blocked, Completed, Overdue, Live Issues) and the progress ring / task list look cramped and poorly aligned.
- Tighten spacing, make the metric/status cards consistent height and alignment, and ensure the layout does not look scrambled on desktop or mobile.
- Do not change the data or remove any status row — only fix visual alignment and spacing.

Deliver only the necessary code changes. Preserve all existing functionality.
```

---

## Simple JSON (optional, for structured agents)

```json
{
  "task": "sidebar_hamburger_toggle",
  "preference_key": "mmgr_sidebar",
  "default": "off",
  "hamburger": true,
  "desktop": "fixed_240px_when_on",
  "mobile": "offcanvas_drawer",
  "preserve_existing_nav": true,
  "preserve_all_features": true,
  "also_fix": "dashboard_status_list_alignment"
}
```

---

*End of plan. Use the prompt block above to instruct the AI. No other scope.*
