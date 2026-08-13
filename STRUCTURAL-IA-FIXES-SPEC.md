# My MaNaGeR — Structural & IA Fixes
### Companion spec to GLASS-UI-DESIGN-SPEC.md — read that first if you haven't

**Relationship to the glass spec:** that document is a surface/material
treatment. This document is everything underneath it — empty states,
navigation density, information architecture, and visual hierarchy. Do
them in this order: **glass first (self-contained, low-risk), then this
document.** Nothing here depends on glass being done first, but doing it
first means you're not re-touching the same markup twice. If you skip the
glass spec entirely, everything in this document still applies unchanged
— it's independent of surface treatment.

**Scope boundary:** this document changes structure, copy, and layout
density. It does **not** touch color tokens, blur, corner radius, or
press physics — those stay exactly as GLASS-UI-DESIGN-SPEC.md defines
them (or as they currently are, if you haven't done that pass yet). If a
fix below seems to require a new color or a new material, that's a
scope violation — flag it instead of inventing one.

---

## 1. Empty states — the zero-tasks bug and the broader pattern

### 1.1 The specific bug (fix this first, it's a one-line-of-logic fix)

`renderDash()` in `js/mmgr-render.js` (around line 138) currently does:

```js
if (sorted.length === 0) {
  n3.innerHTML = '<li style="color:var(--slate)">All tasks completed.</li>';
}
```

This fires whenever there are zero *incomplete* tasks — which is true
both when a project is **freshly created with no tasks at all** and when
it's **100% finished**. Those are opposite situations and must not share
a message.

**Required fix:** branch on `total === 0` (no tasks exist at all) vs.
`total > 0 && done === total` (every task is genuinely complete) as two
distinct states:

- **Zero tasks exist:** this is a new-project empty state — see §1.2 for
  what that state should actually contain, not just different copy.
- **All tasks complete:** keep a completion message, but make it feel
  like an accomplishment, not a shrug — e.g. reference the count ("12 of
  12 tasks complete") rather than the generic phrase currently used.

Apply the same audit to every other dashboard stat that currently shows a
bare `0` with no context about *why* it's zero — Budget Variance,
Resource Utilization, Pending Changes, Baseline Variance (all visible in
the dashboard screenshot from earlier in this project). A `0` next to
"Resource Utilization" reads identically whether no resources have been
added yet or resources exist but are genuinely idle — same class of bug
as above, audit all of them, not just the one found.

### 1.2 What a real empty state looks like (not just different text)

A card showing zeros with a slightly different sentence is still a card
showing zeros. The actual fix has three parts, and all three are
required — text alone is not sufficient:

1. **Explain why it's empty** in plain language tied to what the user
   controls (per the writing guidance below) — "No tasks yet" not "0 of 0
   tasks."
2. **Give a direct path to fix it** — every empty state needs a primary
   action, not just an explanation. A card with zero budget lines gets an
   "Add first budget line" action inline in the card, not just a stat
   showing $0 that the user has to go find the Budget tab to address.
3. **Visually de-emphasize the zero itself.** A `0` rendered at the same
   size/weight as a real number (see §4 on hierarchy) implies it's a
   meaningful data point. An empty state's zero should be visually
   quieter than a populated state's number — smaller, lower-contrast, or
   replaced entirely by the explanatory text from point 1.

**Apply this to every dashboard card that can legitimately be empty on a
new project:** Project Completion, Project Health, Next 3 Priority
Actions, Budget Variance, Resource Utilization, Pending Changes, Baseline
Variance, and the Baseline Variance — Schedule Days & Cost table. Audit
each one individually; don't assume fixing the pattern once propagates —
each card's markup needs its own conditional branch.

---

## 2. Navigation density — 14 pills is too many

### 2.1 The problem, specifically

`project.html`'s `#sec-nav` currently renders 14 flat pill buttons in a
single row that wraps: Dashboard, Definitions, Charter, WBS, Gantt,
Kanban, Resources, Budget, Stakeholders, Changes, Decision Log,
Risk/Issues, Closure, RACI, Comms Log, Documents (16 counting DMAIC when
Hybrid is active — 14 is the Waterfall/Agile baseline count). Every pill
gets equal visual weight regardless of how often it's used. This is a
flat list pretending to be an IA.

### 2.2 Required restructure — grouped navigation

Group the 14 (16) sections into a small number of named clusters. Use
this grouping unless you have a specific reason to deviate (and if you
do, document the reason in a comment in `project.html` near the nav):

- **Overview** — Dashboard, Definitions
- **Planning** — Charter, WBS, Gantt, RACI
- **Execution** — Kanban, Resources, Budget
- **Governance** — Stakeholders, Changes, Decision Log, Risk/Issues
- **Closeout** — Closure, Comms Log, Documents
- **DMAIC** — stays as its own item, conditionally shown, not folded into
  a group (it's already conditionally hidden/shown by methodology; don't
  add grouping complexity on top of that toggle)

**Implementation approach — pick one, don't do both:**

- **Option A (lower effort, recommended first pass):** keep the nav as a
  single row structurally, but visually cluster pills with a small gap +
  a subtle vertical divider between groups, and group-label them with a
  tiny uppercase eyebrow label above each cluster (matching the existing
  `.card-title` styling already used elsewhere, so this doesn't introduce
  new type treatment). Still one row, still all visible, just visually
  legible as groups instead of a flat wall of 14 identical buttons.
- **Option B (higher effort, better long-term):** collapse into a
  secondary-nav pattern — top-level shows only the 5 group names, clicking
  a group reveals its child pills (either as a flyout or by replacing the
  pill row contents). This reduces default visual noise more aggressively
  but adds a click for anything not in the currently-open group, and
  changes `showSec`'s interaction model — do not attempt this without
  also updating `test-headless.js`'s "Scenario 3" data-action coverage
  audit, since it will change which elements have `data-action` attributes
  and when.

**Do not silently drop any of the 14 sections to "simplify."** Every one
of them maps to a real feature already built and tested. This is a
density/grouping fix, not a feature-removal exercise.

### 2.3 Active-state clarity

Whichever option you choose, the currently-active pill must remain
unambiguous at a glance — don't let grouping visually compete with the
`.active` state that's already defined in the CSS. If pills get grouped
under eyebrow labels, the active pill's existing gold-highlight treatment
should still read as the strongest visual signal in the nav, stronger
than the group dividers.

---

## 3. Remove the session timer

**Current implementation:** `js/mmgr-app.js` line 98 —
`setInterval(R.updateSessionTimer, 1000)` — ticks a `Session: MM:SS`
label in the header every single second, forever, for the life of the
page.

**Why this is a real problem, not just a nitpick:**
1. It's a per-second re-render for information that provides the user no
   actionable value — nobody needs to watch their session duration count
   up while managing a construction project.
2. It runs even when the tab is backgrounded (unless you've specifically
   paused it on `visibilitychange`, which the current code doesn't do per
   the grep above) — needless work, needless battery/CPU on long-running
   background tabs.
3. Ambient motion in a header the user's eyes pass over constantly
   contributes to visual noise, working directly against the "premium,
   deliberate" feeling the glass pass is trying to build. A flickering
   number undercuts a calm, tactile interface no matter how good the
   glass looks around it.

**Required fix:**
1. Remove the `setInterval(R.updateSessionTimer, 1000)` call from
   `mmgr-app.js` entirely.
2. Remove `updateSessionTimer` from `mmgr-render.js`'s exports if nothing
   else calls it — check first with a grep across the codebase before
   deleting, per the same discipline used in the earlier codebase audit
   (an orphaned function isn't harmful, but don't leave dead exports
   without a reason).
3. Remove the `Session: <span id="sess-t"></span>` markup from
   `project.html` line 56.
4. **If session duration is genuinely useful for anything** (e.g. you
   want it in an exported report footer, or a "time since last save"
   indicator makes sense) — that's a different, much lower-frequency
   need. A "Saved 2 minutes ago" style relative timestamp that updates
   on save events (not every second) would serve that need without the
   ambient noise. Only build this if you actually want it — don't
   reintroduce it by default just because something used to be there.

---

## 4. Visual hierarchy between summary cards

### 4.1 The problem

Project Completion, Project Health, Next 3 Priority Actions, Budget
Variance, Resource Utilization, Pending Changes, and Baseline Variance
all currently render as equal-weight cards — same size, same
`card-title` treatment, same numeric styling regardless of whether the
number represents something urgent (Overdue: 3) or something neutral
(Resource Utilization: 0%). Equal visual weight for unequal importance is
a hierarchy failure, independent of how nice any individual card looks.

### 4.2 Required tiering

Establish three visual tiers and apply them consistently:

- **Tier 1 — needs attention now:** any card/stat currently showing a
  non-zero Blocked, Overdue, or Live Issues count. These get the
  strongest visual treatment available in the current palette (the
  existing `--danger` token, already used for these categories per the
  screenshot) — larger numeral, and positioned first/top-left in the
  grid regardless of their default DOM order, if that's achievable
  without a major layout rewrite; if reordering by urgency is too
  invasive for this pass, at minimum ensure the visual weight (size,
  color intensity) makes them impossible to miss even in their current
  position.
- **Tier 2 — informational, on-track:** Project Completion ring, Budget
  Variance when positive/neutral, Resource Utilization when in a healthy
  range. Standard card weight, no change needed beyond what §1 already
  specifies for empty states.
- **Tier 3 — passive/rarely-changing:** Pending Changes when zero,
  Baseline Variance when no baseline is saved. These should visually
  recede — smaller type, lower contrast — consistent with the empty-state
  de-emphasis principle from §1.2.

### 4.3 What NOT to do here

Do not introduce new colors to create this hierarchy — use size, weight,
and the existing `--danger`/`--slate`/`--gold` tokens already in the
palette. Do not make Tier 1 cards animate or pulse to draw attention —
that reintroduces the ambient-motion problem §3 just removed the session
timer for. Static size/color/position weighting is sufficient and more
in keeping with a calm, professional tool.

---

## 5. Progressive disclosure of empty panels

### 5.1 The problem

Every one of the 14–16 sections behind the nav renders its full panel
chrome (headers, empty tables with column headers, toolbars) even when
there's zero content in it — a brand-new project shows a fully-chromed
but completely empty Budget table, Risk register, RACI matrix, etc.
across every tab. This is the tab-level version of the same problem §1
addresses on the dashboard.

### 5.2 Required fix

For every panel that renders a table/list from state data, add a
genuine empty state INSIDE that panel (not just an empty `<tbody>`) when
the underlying array has zero entries — following the same three-part
pattern from §1.2: explain why it's empty, give a direct primary action
(e.g. "Add your first risk" button inside the empty Risk register,
already-existing `addRisk` action, just surfaced more prominently), and
visually quiet the surrounding chrome until there's real data to give it
weight.

**Do this panel-by-panel, and test each one individually** — this is
not a single shared component change, because the "primary action" is
different for every panel (Risks: `addRisk`; Budget: `addBudgetLine`;
Stakeholders: `addStake`; RACI: prompt to add the first task/person via
the existing pickers; etc.). Reference the existing `data-action` names
already wired in `ACTION_MAP` for each — you're surfacing existing
actions more prominently in an empty state, not creating new ones.

---

## 6. Writing / copy pass (applies across §1 and §5)

Per general writing-in-design practice: name things by what the user
controls, use active voice, and keep the interface's voice direct rather
than apologetic. Concretely for this pass:

- Empty-state headlines: state the fact plainly — "No risks logged yet,"
  not "It looks like there aren't any risks here at the moment!"
- Primary action button copy: exact verb matching what happens — "Add
  risk," not "Get started" or "Let's go."
- Never blame the user or the system for emptiness — a new project having
  no tasks yet is expected, not an error state; don't phrase it like one.

---

## 7. Explicit non-goals for this pass

To keep this scoped and prevent creep into the glass spec's territory:

1. **No new color tokens.** Hierarchy in §4 uses size/weight/position and
   the existing palette only.
2. **No new typefaces or type scale.** Out of scope per the glass spec's
   §7 and unchanged here.
3. **No removal of any of the 14–16 nav sections.** §2 is a grouping and
   density fix, never a feature-removal exercise.
4. **No new animation/motion.** §4.3 explicitly forbids pulsing/animating
   Tier 1 cards; §3 is actively removing motion, not adding it elsewhere.
5. **No change to the data model or state schema.** Every fix in this
   document is render-logic and markup only — if a fix seems to require a
   new field in `mmgr-state.js`, stop and reconsider the approach first,
   since a schema change means a migration per the existing
   `SCHEMA_VERSION` pattern, which is a bigger commitment than an IA pass
   should require.

---

## 8. Testing checklist

- [ ] A genuinely brand-new project (zero tasks, zero everything) shows
      distinct, helpful empty states on every dashboard card and every
      panel — no card says "All tasks completed" or shows a bare
      unexplained `0`
- [ ] A fully-complete project (all tasks done) shows a distinct,
      accomplishment-toned message — never the same string as the
      empty-project case
- [ ] Nav groups are visually legible as groups without adding a second
      click to reach any existing section (if Option A from §2.2) — or,
      if Option B, every section is still reachable and
      `test-headless.js`'s data-action coverage audit still passes with
      zero orphaned/missing handlers
- [ ] The active nav pill is still the single clearest visual element in
      the nav bar after grouping is applied
- [ ] Session timer is gone from the header, `mmgr-app.js`'s `setInterval`
      call is removed, and no per-second re-render happens anywhere in
      the app (verify with browser devtools' performance/rendering
      overlay — confirm no 1-second-interval paint activity)
- [ ] Overdue/Blocked/Live Issues stats are visually unmistakable as
      higher-priority than on-track stats, without any new color or
      motion
- [ ] Every panel with an "Add first X" empty-state action actually wires
      to the correct existing `data-action` — click each one on an empty
      project and confirm it does what it says
- [ ] `node test-headless.js` still passes in full, including Scenario 3
      (data-action coverage audit) — this scenario is the one most likely
      to catch a mistake if nav restructuring (§2.2 Option B) changes
      which elements carry `data-action` attributes
