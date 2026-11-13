# My MaNaGeR - AUDIT DIRECTIVE 2026-11-01 (owner walkthrough, admin panel + project UI + landing)

**Status:** CAPTURE ONLY. The owner's instruction on 2026-11-01 was explicit: put the
audit in the directive, do not start building it in the same breath. Each item below is
written so a later session can pick one up without re-deriving it, and each names the
gate that must exist (or be extended) before the item can be called done.

Read with: `CONTINUATION-DIRECTIVE.md` (read order), `EXECUTION-PLAN.md` wave 5 (the
schedule these items sit in), `docs/SPRINTS.md` (the closed S1-S7 batch this follows).

**Rules that apply to every item:** no emoji on any served page or JS string (SVG sprite
only); no em dash / en dash in served copy; plain language on user faces; gold is the
accent; consistency by reference (find the sibling already in the app and match it);
every new feature ships its `mymanager-field-guide.html` entry in the SAME change; a fix
ships with the gate that would have caught it.

---

## 0. What is already true (checked before writing this file)

- The two demo projects live on `app.html` (launcher), not in the admin panel.
- The admin panel's cloud section is site-wide: it lists EVERY cloud project through the
  `ADMIN_CODE` secret (`GET /api/cloud/admin/projects`), and "Reissue owner code" only
  works when the browser is signed in as the account on the project row.
- `cloud_projects` has no `owner_email` column, so a project can only be found by the
  Google `sub` that created it. The same human signing in with a different account (or
  through the email+password path, which stores `email:...` as the sub) sees an empty
  launcher while the rows still exist. Verified live 2026-11-01: `subscription-test` and
  `bank-renovation` both exist, both owned by `102577792911984404733`.
- `cloud_subscriptions` for that same `sub` is `status=active`, `tier=enterprise`. So
  "premium after deleting the account" is not a client bug: deleting rows in D1 by hand
  does not cancel a Paddle subscription, and the entitlement is read from that row.

---

## 1. Admin panel

### A1. A fresh admin panel must start EMPTY
**Owner:** "there's a starter project in it. If I try to open the starter project, it
flings me back ... and tells me to put in my access code. That is not a good sign. It's
the admin panel. It's going to be empty inside. They are going to have to create their
first project inside the admin panel and choose to upload it to the cloud or not."

- A new admin instance shows no project rows and no starter tile. The first action
  offered is "create your first project".
- Opening a project from the admin panel must never land on the owner-code gate. If a
  row has no local state, say so plainly ("this project has no snapshot on this device")
  and offer load-from-cloud, not a code prompt.
- The two demo projects stay on `app.html` and must not be mirrored into the admin list.
- **Gate:** extend `tools/verify-controls-admin.cjs` - a brand-new instance renders zero
  `.prow`, and no admin row's action leads to an access-code prompt.

### A2. The site admin code story is broken and must be made legible
**Owner tried, and failed with:** the project owner code, the project backup code, the
admin panel code from another account, and the site admin code. "So ensure it's linked
properly and you can actually use the owner code ... to open a project or load in a
project."

- The admin panel must state, in place, which credential it wants and where that
  credential comes from (the `ADMIN_CODE` deploy secret), and reject the others with a
  sentence that names what was typed: "That is a project owner code. Project codes are
  entered on the launcher (app.html)."
- Accept a CLOUD PROJECT's own owner code as a way to LOAD that project in the admin
  panel, without needing the site admin code, and only for projects that exist in the
  cloud (owner: "as you says, it's cloud project so it's only allowed to load in cloud
  projects").
- **Gate:** `tools/qa-admin-credentials.cjs` - the four credential kinds are exercised
  and produce four distinct, correct outcomes; a cloud owner code loads its project; a
  non-cloud project is refused with a reason.

### A3. Admin panel needs an auto-update for cloud projects
**Owner:** "when you click the auto update ... for cloud projects ... a user projects are
automatically updated. They don't have to go and manually click update. It will
automatically update to the back end as long as there's an Internet connection."

- A toggle, persisted per device, off by default. ON: every cloud-linked project pushes
  after a debounce once its state changes and the browser is online, using the existing
  cloud save path (never a second one).
- Status must be visible: last pushed at, pending, failed with reason.
- **Gate:** extend `tools/qa-cloud-refresh.cjs` (or a new `qa-admin-autosave.cjs`) with a
  stubbed `/api/cloud/*`: an edit with the toggle on pushes once, coalesces a burst into
  one push, and retries after a 500.

### A4. Back goes LEFT everywhere
**Owner:** "inside of the project UI, we have the back button being to the left ... I
don't want to see in the admin panel where dashboard and the back one is to the right."

- One convention: the back / dashboard control is the FIRST element in the header, on
  every shell (admin, project, calculator, app). The audit's earlier claim that the admin
  header was already left-aligned is not trusted - measure it.
- **Gate:** extend `tools/qa-chrome.cjs` with a header-order arm over admin.html,
  project.html, calculator.html and app.html.

### A5. The advanced / control panel cannot be closed when opened from a new project
**Owner:** "you can't exit the control panel. There is no exit button for the control
panel when you open it like that."

- Every path that opens the control panel must give it a close control (X), Escape, and
  a scrim click. Reproduce first on a brand-new project, then fix the path that skipped
  the footer.
- **Gate:** `qa-calc-controls`-style arm in a workspace gate: open the panel from a new
  project by each entry point, close it three ways, assert no leftover scroll lock.

---

## 2. Project UI (workspace)

### B1. Session state must be shared before any panel is asked for anything
**Owner:** "the AI ... is showing me an error saying that I need to sign in. I'm already
signed in ... it should have been synced across the entire web page."

- The workspace already restores the session and the plan (`Entitlements.hydrate()`,
  S7). What is missing is a SHARED, observable ready-state: modules must wait for
  "identity resolved" instead of assuming signed-out. A pending state reads as loading,
  never as an error, and a genuine signed-out state is the only thing that says "sign in".
- **Gate:** `tools/qa-auth-ready.cjs` - stub a slow `/api/auth/me`, open the AI, and
  assert the panel shows a waiting state and then works, with zero "sign in" text while
  the session is merely pending.

### B2. Collaboration / notification controls must be VISIBLE on every tier
**Owner:** "I'm not seeing the little collaboration icon ... setting up notification icon
that I can use to give roles ... the UI can be there right? But if someone is not
subscribed to the higher tier ... it will be grayed out ... and if they click it while
it's grayed out, it's going to say ... subscribe to unlock this feature."

- Always render the control; gate it by state, never by absence: enabled for tiers with
  access, otherwise visibly dimmed with `aria-disabled`, and a click explains the
  upgrade in the app's own words. This inverts S7's "suppress the control" reading -
  the owner has now chosen the opposite, so the S7 behaviour becomes: the control is
  present, its ACTIONS are gated.
- **Gate:** re-baseline `tools/qa-team-tier.cjs` - a free account sees the bell, dimmed,
  gets the upgrade sentence on click, and gains nothing; enterprise sees it live.

### B3. No resting circles on the top-bar controls
**Owner:** "we're not going to keep those circle[s] around the control tab and the
notification tab and when the collaboration UI is there as well ... once someone hovers
over it, it will be highlighted [and] the circle will appear."

- At rest: bare icon, no ring, no fill. Hover / focus-visible / open: the ring appears.
- Applies to the control-panel gear, notifications and collaboration.
- **Gate:** browser arm measuring `border`/`box-shadow`/`background` at rest and on
  hover for all three.

### B4. The completion ring is too small for its rectangle
**Owner:** "the circle can be bigger while keeping its thickness."

- Grow the ring's box, keep the stroke width, keep the percentage label legible.
- **Gate:** geometry arm (ring diameter and stroke) plus the existing contrast check.

### B5. Calculate must pulse gold in the dark theme, not sit green
**Owner:** "for the dark theme, I'm seeing the calculate button be green ... change it to
pulsing gold."

- Dark theme: gold fill, a slow pulse (opacity/glow ring, ~2.4s, smooth), paused by
  `prefers-reduced-motion`, and never a colour that fails contrast while it pulses.
- **Gate:** `verify-gold` arm that the Calculate control is gold in both themes, plus a
  reduced-motion arm.

### B6. A quiet particle line in the advanced panel, theme-reactive
**Owner:** one wobbly line with particles, reacting to hover with a small jiggle, drawn
from the active theme's colours.

- Canvas or SVG, one element, paused offscreen and under reduced motion, expensive work
  behind `requestIdleCallback`. Colours read from CSS custom properties so all palettes
  (including the newer ones) follow for free.
- **Gate:** a performance arm (no rAF work while offscreen; frames stay under budget on
  a throttled CPU) plus a reduced-motion arm.

### B7. The sidebar must not auto-open on load
**Owner:** "once the page load, it loads normally flat without the sidebar popping out."

- App and project shells load with the sidebar closed at every width. The hamburger is
  the only thing that opens it.
- First-time users get a one-shot DEMO: the rail slides out and back on first load, the
  same teaching pattern the calculator's first-run tour uses. Shown once per device.
- **Gate:** `qa-shell-first-load.cjs` - fresh storage: sidebar closed after load;
  demo plays once and does not trap focus; second load plays nothing.

### B8. A short first-project walkthrough
**Owner:** a small tour on the first project opened or created: summary of each section
(overview, plan, collaborate, control panel, notifications, AI, calculator,
methodologies), then out. Reference: the calculator's first-run tour, which works.

- Never re-shown automatically; reachable later from the field guide / help.
- Must be keyboard operable, dismissible with Escape, and skipped entirely under
  reduced-motion only in its animation, not its content.
- **Gate:** `qa-first-project-tour.cjs` - appears once, walks every section in order,
  Escape closes, storage records it, second open is silent.

### B9. Section "accelerator": cycle sections with the side buttons
**Owner's own revision:** do not build a new multitasker feature; extend the existing
navigation. Side (back/forward) buttons jump between sections; up to five pinned
sections; off by default; enabled in the control panel; a small reset with no pill
chrome; the position persists.

- Implement INSIDE the existing section navigation (same list, same state), not as a
  parallel tab system. Browser back/forward semantics must not be hijacked: use the
  mouse side buttons (button 3 / 4) only, never the keyboard arrows (owner: some people
  use arrows to scroll).
- **Gate:** `qa-section-accelerator.cjs` - off by default; enabling persists; side
  buttons move one section each way and stop at the ends; a sixth pin is refused; reset
  clears pins; arrows still scroll.

### B10. Whisper must stop on send and start fresh
**Owner:** "once I send a message ... the whisper doesn't turn off ... the prompt that I
sent before is still there plus the new content."

- On send: stop recognition, clear the composer base used by `aiJoin`, and a new
  dictation starts from an empty field.
- **Gate:** extend `tools/qa-ai-dictation.cjs` - send stops the engine, the next
  dictation begins with no carried text, and a second send does not duplicate.

### B11. Project photos: the feature is missing, and a paying account cannot use it
**Owner:** "where are the project photos? I can't upload any."

- Scope: multiple photos per project; description, date, uploader identity (name and
  role of whoever uploaded, including a scoped editor code's name); before/after use.
- Availability: every PAID tier (estimator included - the owner corrected himself on
  this), never free. Quota: 500 MB per account, with a usage bar, download, and delete
  to free space. Empty state must say plainly that there are no photos yet AND how to
  add the first one.
- Existing server side already accepts photos (`src/cloud/photos.js`); the UI path is
  what is missing - prove that first before building anything new.
- **Gate:** `qa-project-photos.cjs` - upload two photos with descriptions, see uploader
  name and role on each, download one, delete one, quota bar moves, free account is
  refused with the upgrade sentence.

### B12. The skeleton must be the project UI's shape
**Owner:** "the skeleton loading screen ... doesn't reflect the project UI."

- The skeleton mirrors the real workspace: header, section nav, panel grid, rail. No
  generic grey blocks.
- **Gate:** a static-structure arm comparing skeleton node classes with the real shell.

---

## 3. Landing page

### C1. Band transitions need one deliberate treatment
**Owner:** "there's a little transition where the colour kind of change ... we could add
a little canvas type of thing ... smooth transition down into the web pages."

- One consistent seam between bands (canvas/SVG), construction-flavoured, themeable,
  and cheap: it must not delay first paint or LCP. Off under reduced motion.

### C2. Try the AI on the landing page
**Owner:** let a visitor talk to it; it explains what the product does, asks qualifying
questions (AI proficiency, MCP appetite), and only becomes interactive once it is ready.

- Lazy: nothing loads until the visitor acts or the section is close to the viewport;
  the control shows a loading state, never a dead box, and degrades to "open the app"
  with no network.
- **Gate:** `qa-landing-ai.cjs` - the widget mounts without blocking LCP, waits, then
  answers; offline shows the fallback; no request is made before interaction.

### C3. Judge the gold outline honestly
**Owner:** "there's a little whiteboard [outline] around the Golden UI ... it kind of
looks forced. Arts too thick ... surprise me with that one if it can be improved."

- Measure what the gold edge is doing (contrast, weight, where it appears). Improve it
  only where it earns its place; remove it where the fill already carries the edge. Any
  change keeps `verify-gold` green and is measured, not eyeballed.

---

## 4. Cloud identity (the root cause behind "my projects are missing")

### D1. One human, several identity keys
A project is found by `google_sub` only. The email+password path stores
`email:<address>` as the sub, and a second Google account is a third key. The owner hit
this twice in one day: projects invisible from another device/account, and admin-panel
uploads that never appeared under the account.

- Add `owner_email` (normalised) to `cloud_projects` at create/update time, requiring a
  VERIFIED session email.
- Launcher list: owned by `sub` OR by the same verified email. Never by display name.
- Admin restores list by both keys and say which one matched.
- Migration + backfill is impossible for old rows (no email was stored), so the owner's
  two existing projects need a one-time claim path: a signed-in user may claim a project
  by presenting its owner code, which stamps the email going forward.
- **Gate:** `qa-tenant-isolation` extension - a second identity with the same verified
  email sees the project; a different email does not; a claim with a wrong code fails.

### D2. Deleting an account must not leave a billable ghost
Today an in-app delete cancels Paddle and removes the subscription row. A hand-edited D1
row leaves both. Add an operator path (admin panel, site admin code) that shows
orphaned subscriptions and can cancel-and-clear one, with the Paddle cancel REQUIRED
before the row is removed.

- **Gate:** `qa-billing-orphan.cjs` with a stubbed Paddle - cancel failure leaves the row
  and says why; success clears it and the tier drops to free.

---

## 5. Queued from the same walkthrough, not yet built

- Calculator chrome strip (owner, same day): the boxed X on "Add area", the boxes around
  the BoQ edit / delete controls, and the "Clear history" button box - the icon alone
  plus its label is enough. Keep the boxed buttons where they are crowded (Save, Export,
  Import, Compare).
- Methodology section and the "Export anytime / Google sync / No servers" cards want the
  same watermark amplification the audience cards just received (landing pass 2026-11-01
  did the audience band only).
- The gold outline question (C3) and the band transition (C1) both feed the owner's
  standing note that the UI should read "construction, futuristic, gold" rather than
  generic SaaS.

---

## 6. Order of work (proposal, not a gate)

1. **D1 + D2** - data the owner cannot see is the highest-cost defect, and every other
   cloud feature assumes it works.
2. **B2 + B1** - the two things that make a paying account look broken.
3. **A1 + A2 + A5, then A3 + A4** - the admin panel's own credibility, then its ergonomics.
4. **B10, B5, B4, B3, B7** - small, visible, each with a cheap gate.
5. **B11** (photos), then **B8 + B9** (tour, accelerator).
6. **B12, B6, C1, C2, C3** - polish that needs its own performance arms.
7. **A1's chrome strip and the landing amplification** - opportunistically, in the same
   change as whatever touches those files.

Every item ships with the gate named beside it, and the gate is proven to fail on the
pre-fix tree before the fix is called done.
