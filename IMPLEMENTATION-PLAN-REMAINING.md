# Implementation Plan - Remaining Features
**Date:** 2026-09-01
**Status:** PLAN PHASE - Awaiting owner input on C23, C25, U1

---

## OWNER INPUT REQUIRED (cannot start without)

### C23: Cross-Project Resources - OWNER DECIDED: YES, TOGGLE FEATURE
**Decision:** Build shared resource pool as a TOGGLE feature.
- Toggle goes in Admin Panel (where people create projects)
- User is notified to enable it if they want to work with people/equipment from another project
- Documentation on pages, guide, marketing
- When enabled, resources from all projects are visible and assignable

### C25: Sheet Redline Markup Tool - OWNER DECIDED: SKIP
**Decision:** Not needed right now. Skip this feature.

### U1: "Ask Your Project" AI Bar - OWNER DECIDED: OPTION B
**Decision:** AI bar sits at TOP of workspace, panels below it.
- AI bar always visible when project is open
- Panels below the AI bar
- User can still click panels, but AI bar is always accessible

---

## NO OWNER INPUT NEEDED - CAN START NOW

### C21: @Mentions in Tasks/Comments
**Research findings:**
- Procore: Tasks can be assigned to project users, watchers get notifications
- Fieldwire: Task notifications via email when assigned/commented
- Best practice: @ mentions pull from registered stakeholders (Resources panel), link to task assignment, enable follow-up tracking

**Implementation plan:**
1. Add `assignee` field auto-complete to task fields (already exists as text input)
2. Add `comments` array to tasks: `[{ author, text, mentions: [], timestamp }]`
3. Add `followUp` field to tasks: `{ assignee, dueDate, status: 'pending'|'completed' }`
4. Render: highlighted @name in task comments, follow-up badge on assigned tasks
5. Wire: typing @ in comment field shows dropdown of stakeholders from Resources panel
6. State: `tasks[].comments` and `tasks[].followUp` in FIELD_KEYS

**Files to modify:**
- js/mmgr-tasks.js: Add comments array to task, add followUp field
- js/mmgr-render.js: Add comment rendering with @highlight
- js/render/wbs.js: Add comment UI to task rows
- project.html: Comment input field in task detail
- js/mmgr-state.js: Add task comment fields to FIELD_KEYS

### C24: Template Library
**Research findings:**
- Procore: Project templates with pre-filled WBS, budget, team
- Smartsheet: Reusable templates for construction phases
- Best practice: Templates store task lists, budget lines, stakeholder roles as reusable starting points

**Implementation plan:**
1. Add `state.projectTemplates` array: `[{ id, name, type, tasks, budgetLines, resources }]`
2. Add Template Library card in Controls panel
3. Actions: Save as Template, Apply Template, Delete Template
4. "Save as Template" snapshots current tasks/budget/resources into a template
5. "Apply Template" merges template data into current project (with confirmation)
6. Built-in templates: Residential Construction, Commercial Build, Renovation, Custom

**Files to modify:**
- js/mmgr-templates.js: NEW module (CRUD + apply/save logic)
- js/mmgr-app.js: ACTION_MAP entries
- js/mmgr-render.js: Shim for template rendering
- js/render/controls.js: Template card in Controls panel
- js/mmgr-state.js: Add 'projectTemplates' to FIELD_KEYS
- project.html: Template card markup

### U3: Empty-State Onboarding
**Research findings:**
- Most panels already have empty states (RFI, submittals, permits, etc.)
- Missing: RACI has basic empty state, Charter has no empty state, DMAIC has no empty state
- Best practice: Each empty state should have icon + title + description + action button

**Implementation plan:**
1. Audit all panels for empty state presence
2. Add empty states to panels missing them:
   - Charter panel: "No charter yet. Define your project scope, objectives, and KPIs."
   - DMAIC panel: "No DMAIC cycle started. Begin with Define phase."
   - Meetings panel: "No meetings logged. Schedule your first meeting."
3. Enhance existing empty states with:
   - Consistent icon (using existing sprite)
   - One-line description of what the panel does
   - Primary action button

**Files to modify:**
- js/render/charter.js: Add empty state
- js/mmgr-dmaic.js: Add empty state
- js/mmgr-meetings.js: Add empty state
- css/mmgr.css: Empty state styles (if needed)

---

## C19: Client Portal (OWNER INPUT RECEIVED)

**Owner specification:**
- Admin generates a special "client code" (different from editor/viewer codes)
- Client code is read-only, cloud-only
- Admin toggles which sections the client can see (e.g., only Dashboard, only WBS)
- When client opens with code, they see ONLY the toggled sections
- Changes made by admin are updated in real-time (as long as there's internet)

**Implementation plan:**
1. **New code type:** `client_code` in cloud_client_codes table (migration 0016)
   - Fields: id, project_id, code_hash, code_salt, sections (JSON array of allowed section IDs), created_at, expires_at
   - Sections stored as: `["dash", "wbs", "bud"]` (section panel IDs)

2. **Admin UI:** New "Client Access" card in Share & Access section
   - Generate Client Code button
   - Section toggle checklist (all panel IDs with checkboxes)
   - Show/hide code value
   - Copy button
   - Revoke button

3. **Client experience:**
   - Client enters code on launcher (same as editor/viewer codes)
   - Project loads with only allowed sections visible
   - Navigation buttons for hidden sections are removed
   - Real-time updates via existing cloud sync (same as editor codes)
   - Read-only: no save/edit actions, no owner code prompt

4. **Worker routes:**
   - POST /api/cloud/projects/:id/client-codes (create with sections)
   - GET /api/cloud/projects/:id/client-codes (list)
   - DELETE /api/cloud/projects/:id/client-codes/:codeId (revoke)
   - Modify cloudAuthEditor to handle client_code type (read-only, section-filtered)

5. **Client-side:**
   - mmgr-cloud.js: Add cloudAuthClient() function
   - mmgr-app.js: On load, if client code held, hide sections not in allowed list
   - Navigation: Remove buttons for hidden sections
   - All edits disabled (READONLY_SAFE mode)

**Files to modify:**
- worker.js: New client-code routes
- src/cloud/projects.js: Client code CRUD
- migrations/0016_client_codes.sql: New table
- js/mmgr-cloud.js: Client code auth + section filtering
- js/mmgr-app.js: Section hiding logic
- js/cloud/share.js: Client Access UI card
- project.html: Client code section toggle markup
- css/mmgr.css: Client code styles

---

## IMPLEMENTATION ORDER

### Phase 1 (No owner input needed - can start now)
1. C21: @mentions + task comments + follow-up
2. C24: Template library
3. U3: Empty-state onboarding polish

### Phase 2 (Owner input received - C19)
4. C19: Client Portal (admin code with section toggles)

### Phase 3 (Owner input received)
5. C23: Cross-project resources (toggle in admin panel, notify users)
6. U1: AI bar (top bar + panels below)
7. U2: Core vs Advanced (keep packs on, toggle in settings)

### Phase 4 (Skipped)
- C25: Sheet Redline - SKIPPED per owner decision
- O3: Rate-Limit Tuning - Later, needs production traffic

---

## VERIFICATION REQUIREMENTS

Every feature MUST pass:
1. `node --check` on all modified JS files
2. `npm run verify` (CSP + SW + skills + hidden + exports)
3. `npm run qa:market-features` (61+ tests)
4. `qa-full` (171+ tests)
5. No emoji on served pages
6. No inline styles (zero-inline-style gate)
7. CSP hashes regenerated if inline scripts touched
8. SW cache bumped

**CI must be FULL PASSED before any commit.**
