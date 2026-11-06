# BUDGET FROM BOQ, MCP APPROVALS (Wave H) AND OWNER UI AUDIT FIXES (Wave I)

Date: 2026-11-05, extended 2026-11-06 with Wave I. For: the terminal AI working on My MaNaGeR. From: the product owner, via his planning sessions.

Two parts in one file. Wave H (sections 1 to 4) is the BOQ-to-budget, deliveries, weekly tracking, MCP budget access and approval preview plan. Wave I (section 4B) is the owner's 28 minute spoken UI audit of 2026-11-06: landing page, sign-in page, project screens and three data bugs.

---

## 0. HOW TO READ THIS (obey exactly)

1. This is a PLAN, not a patch set. It was written from an OLDER copy of the code base than the one you have.
   Every file name, function name, field name and line behaviour below is a HINT marked **[A#]** (assumption
   number). Your first job (H-0) is to check every assumption against the LIVE code and record true, false or
   changed. Where the live code already does the thing, do not rebuild it: extend it. Where it differs, adapt
   the task to the live shape and say what you changed.
2. Locked rules in `CONTINUATION-DIRECTIVE.md` apply to everything here (no emoji, no em or en dash in served
   copy, plain Conventional Commits with no AI attribution, `node build.js` after `js/` edits, bump `sw.js`,
   `npm run verify` before deploy, field-guide card for every user-visible feature, new storage keys listed in
   `docs/STORAGE-INVENTORY.md`).
3. Questions: ask the owner ONE batch (section 3) at the very start, then proceed. If there is no answer,
   use the stated defaults and log that you did. Never stop to ask later; log a decision in the progress file.
4. Progress file: add a "WAVE H" section and a "WAVE I" section to `REFINEMENT-PROGRESS.md` listing H-0 to H-8 and I-0 to I-15 as `[ ]`. After each task's
   gate passes, in the SAME commit flip the box, add commit hash and gate result, recompute the scoreboard.
   A passed gate is not a pause. Go to the next unchecked task. Do not tick what you did not verify.
5. Six sprints (section 5): Sprint 0 first, then Sprints 1 to 3 (Wave H), then Sprints 4 and 5 (Wave I). Commit after every task. Deploy and live-probe at the end of each sprint. Wave G (`FIELD-FINDINGS-DIRECTIVE-2026-10-28.md`) still comes before Sprint 0.
6. Do not rewrite working modules. Do not change a saved data shape without a versioned migration that keeps
   every old project loading unchanged. Do not add a runtime dependency. The model never does money arithmetic:
   the page (and, for MCP writes, the server) computes every amount.

---

## 1. WHAT THE OWNER WANTS (his words, tidied)

The Bill of Quantities (BOQ) becomes the project's budget baseline. The budget box on the project can be empty:
nothing is wrong with that, the project simply tracks expenses against the BOQ total. When a delivery reaches
site (a load of gravel, sand and so on) and it is documented and paid, it is recorded, and it comes off the
budget that the BOQ created. Every week the owner tracks spending against the BOQ to see whether the job is on
track or overspending. The MCP server can read the budget, and, only if the owner grants permission, propose
changes to it. Every MCP change is approved by a person first. The approval screen must be improved: when a
change is proposed the owner clicks View and sees exactly where it will land and how it will look, can correct
any value before approving (for example a proposed fixed 100,000 change that he did not authorise), and can
approve or reject each change.

The pitch line: price the job once in the calculator; that bill becomes the budget; every delivery you record
comes off it; every week you see where you stand.

---

## 2. PRINCIPLES (non-negotiable, each is a gate somewhere below)

- P1 One source of truth for money spent. Every screen, report, export, the dashboard, earned value and pay
  applications read the same function.
- P2 Empty envelope is valid. Baseline = envelope if set, otherwise the sum of BOQ budget lines. No "over budget"
  alarm from a missing envelope.
- P3 The BOQ baseline is frozen and dated. Later edits are variations with a reason and an approver, never a
  silent rewrite.
- P4 Nothing the MCP sends touches live data until a person approves it. MCP can never approve its own proposal.
- P5 Preview before approval shows the real screen with the change applied, not a text description.
- P6 The approver can edit before approving. The record keeps what was proposed, what was approved, and who edited.
- P7 Everything approved can be reverted, and a revert logs its own entry.
- P8 Offline-first holds: recording a delivery works with no connection and syncs later.
- P9 Currency and units come from the project and the calculator's single currency table, never a hard-coded "$".
- P10 A rate is always shown with its unit ("1,529.00 per m2"). No money line without a unit.

---

## 3. OWNER QUESTIONS (ask once, defaults apply if unanswered)

- Q1 What counts as "spent"? Default: a delivery counts as Spent when it is RECORDED as received; "Paid" and
  "Owed" (received, not yet paid) show as sub-figures beside it. Alternative: count only paid.
- Q2 Is the project envelope optional? Default: yes, optional; when set it acts as a ceiling shown beside the BOQ total.
- Q3 Who may approve budget changes? Default: project owner only; editors may propose; the owner may name one
  budget approver in the team settings.
- Q4 MCP budget write access. Default: OFF. Reading the budget and proposing changes are two separate switches on
  each API key, both off until the owner turns them on.
- Q5 Thresholds. Default: line "watch" at 80 percent of its planned amount, "over" above 100 percent; a change is
  "large" at 10 percent of the line or 50,000 in project currency, whichever is smaller.
- Q6 Weekly report audience. Default: owner and editors see money; a separate client-safe copy is off unless asked.
- Q7 Week starts on Monday. Default: yes.
- Q8 Partial approval (approve some changes in a proposal, reject others). Default: yes.
- Q9 Fancy font for COMFORTABLY and WORKSPACE (I-4). Default: one open-licence display serif, self-hosted and subset, chosen from three screenshots; the owner may name another.
- Q10 The Pin control (I-13). Default: if the live code shows no working behaviour for it, remove it; if it has a clear target, finish it.
- Q11 Sign-in side text (I-10). Default: exactly "MMWRP" as dictated, outlined, silver, gold on hover.
- Q12 Photography (I-7). Default: free-licence stock photos that allow commercial use; the owner may supply his own instead.
- Q13 Photo uploads (I-12). Default: uploading needs any paid plan; viewing existing photos stays available on every plan.

---

## 4. TASKS

### H-0 Reconnaissance (read only, first, small)
Read the live code and write `docs/BUDGET-MAP-2026-11.md`: for each assumption below say TRUE, FALSE or CHANGED,
with file and function. Also map: where project state is saved and synced (local, cloud, R2/D1), how a state
migration is added, how the calculator stores its bill, how the field guide and CI coverage lists are updated.
GATE: the file exists, every A# has a verdict, and every later task below is annotated "adapted as follows" or
"as written". Commit it with the first line of the progress file updated.

Assumptions (verify each, they come from an older copy):
- A1 The Budget panel keeps `budgetLines` (category, planned, committed, actual, task link, curve), a project
  `budgetEnvelope`, and a dated `spendLog` (date, budgetLineId, amount, notes).
- A2 A line's actual is meant to be derived from its Spend Log entries once any exist (`budgetLineActual`), but the
  Budget panel's Spent and Remaining cards and per-line variance summed the typed `actual` box instead, while the
  dashboard, earned value and pay applications used the derived value. (Possible disagreement between screens.)
- A3 Remaining = envelope minus spent, so an empty envelope shows "Over budget" and fires overrun alerts once any
  money is recorded.
- A4 A spend entry has only date, budget line, amount, notes. No quantity, unit price, supplier, ticket, paid
  status or attachment.
- A5 The calculator's bill (BOQ) is stored on its own page and its only handoff to a project is a quote request
  with quantities and no prices.
- A6 Cash flow is a planned S-curve against actual in roughly two-week steps; nothing weekly exists.
- A7 MCP has `get_budget` and `apply_changes`; `apply_changes` queues a review row and never writes live data; API
  keys are scoped by project section (the budget section covers lines, envelope, spend log); MCP is a Premium
  feature gated on the project owner's plan.
- A8 The owner already has a review panel with an expandable before/after diff and Accept or Reject, and a
  changelog with revert.
- A9 The exported project report deliberately excludes budget dollar figures.
- A10 Budget screens hard-code "$".

### H-1 One source of truth, empty envelope allowed (fix before building on it)
STATE CHECK: A2, A3, A10.
DO: one function returns spent, committed, paid, owed, remaining and baseline for the project and for each line.
Every consumer calls it: Budget cards, bar, per-line variance and percentage, dashboard, earned value, pay
application drafts, MCP `get_budget`, reports. Baseline = envelope if greater than zero, else the sum of planned.
With no envelope the screen says "Tracking against the BOQ total" and never raises an over-budget alarm until spent
exceeds the baseline. With an envelope and planned above it, show a separate quiet notice "Planned lines exceed the
envelope by X". Replace hard-coded "$" with the project currency.
GATE T-BUD-TRUTH: add a line planned 10,000 and one spend of 3,000: Spent card, Remaining card, bar, line variance,
dashboard, earned value, pay application draft and MCP get_budget all read 3,000 spent and 7,000 remaining. Repeat
with the envelope empty (no alarm) and set to 8,000 (planned exceeds envelope notice, no over-budget alarm).

### H-2 Budget from BOQ (the bridge)
STATE CHECK: A5. Find how the calculator saves its bill and how it already hands lines to procurement.
DO:
- Budget line gains (versioned migration, old lines untouched): `source` ('manual' or 'boq'), `boqRef`
  (calculator line id), `description`, `qty`, `unit`, `rate`, `rateUnit`, `planned` (= qty x rate, computed by the
  page), `kind` ('work', 'site', 'tax', 'overhead', 'margin', 'contingency'), `phase` and optional WBS task link.
- Entry points: calculator "Send bill to project" (pick a project, local or cloud) and project Budget tab "Create
  budget from BOQ". Site costs, tax, overhead and margin from the estimate become their own lines so the total
  equals the estimate total to the cent.
- Baseline: on first send create "Baseline 1" (date, who, total, a frozen copy of the lines). Later changes to
  planned, qty or rate are variations: each stores reason, who, and approver, and shows against the baseline.
- Re-sending a changed bill never duplicates: match on `boqRef`, show the differences in the preview (H-6), apply
  only what the owner accepts.
- The envelope field stays, optional (P2).
GATE T-BOQ: a bill of N lines creates N budget lines; budget total equals the calculator total to the cent in
both unit systems; re-sending the same bill changes nothing; a changed bill produces a diff and no duplicates;
Baseline 1 is unchanged after a variation; old projects with manual lines load and behave as before.

### H-3 Record a delivery or expense
STATE CHECK: A4. Extend the spend entry; do not replace the Spend Log.
DO: a "Record delivery" form (also reachable from a BOQ line's row) with: BOQ or budget line, quantity received,
unit (defaults to the line's unit), unit price paid (defaults to the line's rate), amount (= qty x price,
computed by the page; an override needs a reason), supplier, ticket or invoice number, status (ordered, received,
invoiced, paid), paid date, attachment or photo (reuse the project photo store if it exists, else a small
image field kept offline then synced), recorded by, note. Old entries keep working and read as "legacy amount".
Per line, show: quantity received of quantity in the BOQ, quantity remaining, money remaining, price variance
(price paid minus BOQ rate, times quantity) and quantity variance, so an overspend is explained as price or amount.
Q1 decides what feeds Spent; Paid and Owed always show.
Quick-entry: three taps for the common case (pick line, enter quantity, confirm price) on a phone.
GATE T-DELIVERY: recording 20 loads of a 50-load line at a price 5 percent above the BOQ rate shows 30 remaining,
the correct money remaining, a price variance of 5 percent of the 20 loads, and Spent reduces the budget by the
recorded amount in every consumer from H-1. Works offline and syncs. A legacy entry still renders.

### H-4 Weekly tracking and report
STATE CHECK: A6; look at the existing health, report and earned-value modules and reuse their maths.
DO: a Weekly view on the Budget tab with a week selector (Q7): spent this week, spent to date against plan to
date, percent of money used against percent of work done (from WBS progress), a status chip per line (on track,
watch, over, per Q5, plus "price above BOQ rate"), forecast at completion (spent so far plus remaining quantity at
the latest price paid, falling back to the cost performance method when no quantity exists), and the variance
split into price and quantity. Weekly steps for the cash-flow chart. Export the weekly report as PDF and as the
project spreadsheet, using the existing export standards (computed column widths, rate with its unit, currency in
the header). Respect A9: if the project report excludes money by design, the weekly report is a separate,
owner-and-editor-only export (Q6).
GATE T-WEEK: a seeded project with three weeks of deliveries gives the same week totals on screen, in the PDF and
in the spreadsheet; chips switch at the Q5 thresholds; forecast at completion equals the hand calculation in the
fixture; changing the selected week never changes saved data.

### H-5 MCP budget access, with permission
STATE CHECK: A7. Read how API key scopes, the review queue and Premium gating work today and reuse them.
DO:
- Key settings: separate switches "Read budget" and "Propose budget changes" (Q4), both off by default, shown in
  the key list with a plain label. Premium gating on the owner's plan stays.
- Read tools (scope-checked): extend `get_budget` with baseline, BOQ quantity, unit, rate, deliveries, remaining
  quantity, status chips; add `get_deliveries` and `get_weekly_summary`; add `get_proposal_status` so an AI client
  can see accepted, rejected (with the owner's reason) or edited-and-accepted.
- Write path: only `apply_changes` proposals. New proposal kinds: add budget line, change a budget line field, add
  delivery. No delete in v1 unless the owner enables it per key. MCP cannot create or change a baseline.
- Server-side validation of every money field: finite number, not negative unless the field allows it, qty and
  price present for a delivery, unit equals the line's unit family (the unit check from the rate-unit guard), amount
  computed by the server and shown in the proposal. A proposal over the key's limits (changes per proposal, large
  changes per day) is refused with a plain message.
- Every proposal carries the key label, time, and a one-line plain summary generated by the server.
GATE T-MCP-BUDGET: a key without the propose switch cannot queue anything; with it, a delivery proposal queues and
changes no live value; a proposal with a text amount, a negative amount, a wrong unit or a missing price is refused;
an AI client cannot approve; `get_proposal_status` reports the owner's decision and reason.

### H-6 Approval UI v2 (the main improvement)
STATE CHECK: A8. Reuse the existing review panel, changelog and revert; replace its presentation.
DO: a proposal opens a full-width preview ("View") with three parts.
1. A plain-words summary per change, for example "Change Gravel planned amount from 120,000 to 220,000 (+100,000)".
   Large changes (Q5) carry a visible warning with the reason; duplicates, negative values, unit mismatches and
   prices above the BOQ rate are flagged.
2. A live rendering of the REAL screen (Budget table, Spend Log, summary cards, cash-flow chart, weekly chips)
   built from a throwaway copy of the project state with the proposed changes applied. Changed cells have a gold
   edge, added rows are green, removed rows are struck through. Summary cards show before and after with the
   difference ("Remaining 410,000 to 310,000; Gravel line now 112 percent of budget"). Nothing here is saved.
3. Editing before approval: every proposed value is an editable field in the preview. Editing recomputes the
   preview and the impact line at once (P6). Each change has its own approve checkbox (Q8); a Reject needs a short
   reason that goes back to the MCP client. Approve applies the chosen, possibly edited, changes in one step.
Also: if the live data changed after the proposal was made, show "This line changed since" with both values and
require a refresh before approving; record in the changelog what was proposed, what was approved, who edited, and
revert like any entry; a person-icon notice in the app header shows how many proposals wait; works on a phone,
in dark and light, with keyboard, and respects Performance Mode.
Apply the same preview to all MCP proposal types (tasks, risks and so on), budget first. Replace the plain diff
used by H-2's re-send with this shared preview.
GATE T-APPROVE: scripted: an MCP proposal raises a line by 100,000. View shows the changed cell, the card
deltas and the large-change warning. The owner edits 100,000 to 10,000; the preview and impact line update;
Approve writes 10,000; the changelog records proposed 100,000, approved 10,000 and edited; Revert restores the
original and logs itself. Partial approval applies only the ticked changes. A proposal made stale by a live edit
is blocked until refreshed. Reject with a reason is returned by `get_proposal_status`.

### H-7 Roles and permissions
STATE CHECK: the RBAC work in `RBAC-DIRECTIVE-2026-10-25.md` and its team roles.
DO: who may record deliveries (editors and owner by default), who may approve budget changes and variations
(Q3), who may view money (Q6), who may issue or change API keys. Enforced on the server, not only hidden in the
UI. Every approval, edit and revert shows the person in the changelog.
GATE T-BUD-RBAC: a viewer cannot record or approve; an editor can record and propose but not approve; the budget
approver can approve; direct calls to the endpoints fail the same way as the UI.

### H-8 Documentation and closing
Field-guide cards: Create budget from BOQ, Record a delivery, Weekly tracking, MCP budget permissions, Approval
preview and editing. Update the MCP documentation and the pricing page wording only if the Premium description
changes. Update `docs/STORAGE-INVENTORY.md`, `docs/CI-TEST-COVERAGE.md` and `ci.yml` for every new harness. Write
the Wave H entry in the session log and rewrite `reflection.txt`. Re-run the sweep and the full qa battery.

---

## 4B. WAVE I - OWNER UI AUDIT (spoken audit, 2026-11-06)

SOURCE. A 28 minute voice recording by the owner, machine-transcribed. The wording below is tidied from it. Where
the audio was unclear it is listed in section 4C with a default; do not guess beyond the default. The owner also
asked, in his own words, for the page to be "thoroughly planned and viewed": use Playwright, take screenshots,
look at them, and propose improvements to look and ease of use. Working correctness is a separate matter for
him ("we are not really worried about working"), but the three data bugs in I-1 to I-3 are real defects and come
first. Every reference to a file or element is a hint from an OLDER copy: verify against the live code (STATE CHECK)
and adapt.

Constraints that stay in force: the marketing canvas and dot-rail rules, the three hero SVG cards, brand accent is
GOLD (never orange), sign-in page keeps the black star sky with gold accent (no blue, no lock icon, Sign in goes to
`/signin`), Performance Mode and `prefers-reduced-motion` switch off every new animation, `GOLD-AUDIT` token rules.

### I-0 Screenshot review and map (read only, first)
Take Playwright screenshots of the landing page, sign-in page, pricing, the app, a project (each section), the
photos tab and the calculator at 390, 768, 1280 and 1920 px wide, dark theme, into `tools/shots/ui-audit/`.
View them. Write `docs/UI-AUDIT-MAP-2026-11.md`: (a) a verdict for each assumption U-A1 to U-A8 below (TRUE, FALSE,
CHANGED); (b) for each task I-4 to I-14, what the live page looks like today and the exact element you will change;
(c) a short list of further look-and-use improvements you propose from the screenshots, each one line, each
marked "owner to approve"; do not build (c) without approval.
- U-A1 the globe feature cards carry a gold outline.
- U-A2 the hero buttons are glass (backdrop blur, outer layer); View Field Guide is white.
- U-A3 the hero headline already makes COMFORTABLY and WORKSPACE gold, in the same font as the rest.
- U-A4 the "everything a real project needs" section stacks its panels vertically on a phone, and the page states
  different panel counts in different places (older copy said Eighteen in one section; the owner read 15 in another).
- U-A5 the same grid-with-diamond divider is used between sections and the section dividers have no real motion.
- U-A6 the landing dot rail is still very visible.
- U-A7 the "from blank to live in four steps" block uses a star icon for the AI tour.
- U-A8 there is a project first-open tour whose steps do not highlight their targets.
GATE: the map file exists, every U-A has a verdict, screenshots exist at all four widths, and every task below is
annotated "as written" or "adapted as follows".

### SPRINT 0 - DATA BUGS (do right after Wave G, before Wave H)

#### I-1 Cloud projects do not show up (highest priority in Wave I)
OWNER. "I upload to the cloud, it says update your cloud projects, I did that and it did not work. I log out of
Google, log back in, and my cloud projects are not the same ones I uploaded. Any other device signed in to that
account should show them. It is shocking. It needs to be wired properly."
STATE CHECK: how the app lists cloud projects (the list endpoint, the account key it uses, any local cache or
filter on the list), what "Update your cloud projects" runs, and what identifies the owner (Google subject, email,
or a project code). The older copy keys project access by codes plus a Google identity; check that the list is
built from the signed-in account and not only from codes held in this browser.
DO: reproduce first with two Playwright browser contexts, one Google test account: create a project, upload it to
the cloud, sign out, sign in again, open a second context signed in as the same account. Find where the list loses
the project (never written to the account, written under a different key, filtered out, stale cache, or an error
swallowed). Fix the cause. The upload result must say plainly what happened ("Uploaded to your account as <name>")
or show the real error, never a silent no-op. The list must refresh after upload, after sign-in and on every
device. Recover existing orphans if they exist (offer "Find my projects" that lists cloud projects owned by the
account, including ones created before the fix).
GATE T-CLOUDLIST: upload then sign out and in: project listed; second device context: project listed; edit on one
device appears on the other after refresh; a different account never sees it; the upload message matches the real
outcome in success and failure; wired into `ci.yml`.

#### I-2 "Could not load photos HTTP 500" on a project with no photos
OWNER. A fresh project shows this error. It probably means there are no photos, but the user should see an empty
state with the upload option, not an error.
STATE CHECK: the photos list endpoint and the client message.
DO: an empty list returns 200 with an empty array. Find why the server returns 500 on empty (query, missing
table, missing storage binding, missing project row) and fix the cause. The client shows "No photos yet" with the
upload control. Genuine failures show a retry button and a plain reason, never a bare status code.
GATE T-PHOTO-EMPTY: new project, open Photos: no error, empty-state text and upload control visible; simulated
server failure shows retry with a human sentence.

#### I-3 Role-based access has no visible interface
OWNER. "I still do not see any UI for role based access. I do not understand why that does not exist."
STATE CHECK: `RBAC-DIRECTIVE-2026-10-25.md` and its progress in the log; whether the roles panel, in-app invitations
(person-icon bar), role and scope picker and accept flow exist in the live code, and why they are not reachable.
DO: if built but unreachable, find the missing entry point or flag and make it reachable from the project menu
("Team and roles") and from the app header. If not built, build it exactly as that directive specifies: owner types
an email, picks a role and scope, confirms; the invited account sees and accepts the invitation inside the app;
simple enough for enterprise use. Show the current members, their role, and change or remove a member.
GATE T-RBAC-UI: owner invites a second test account; invitation appears in that account's header bar; accept gives
that role; a viewer cannot edit; the owner can change and remove the member; the entry point is visible on desktop
and phone.

### SPRINT 4 - LANDING PAGE AND SIGN-IN

#### I-4 Hero polish: outlines, buttons, headline
OWNER. (a) Remove the gold outline on the spinning globe's feature cards: it only draws a box; the AI is obsessed
with outlines. (b) "Get Started" is plain gold with no outline, sitting on the page. (c) "View Field Guide" loses its
glass or glassmorphism, its outer layer and its white colour: it becomes goldish so it reflects the UI and flows
with the page. Neither button should look stuck on the background. (d) COMFORTABLY and WORKSPACE stay gold and each
gets a fancy display font (Q9) so the headline "Built comfortably, all in one workspace" reads as part of the page.
(e) Typed text: in a few chosen places text types itself out (for example the hero line under the headline and one
rotating phrase); the full text is always in the page for screen readers and search, the effect is decoration only.
DO: remove the outline and border on the globe cards; remove backdrop blur and outer layers from both hero buttons;
Get Started = gold fill, no border; View Field Guide = transparent, gold text, hover adds a soft gold fill, no white
anywhere. Self-host the display font as a subset woff2 with a real fallback stack; check the content-security
policy allows it. Typing effect: small script, one run per view, off for reduced motion and Performance Mode, text
present in the HTML.
GATE T-HERO: computed styles on the hero buttons show no backdrop-filter, no outline, no border (Get Started) and no
white colour (View Field Guide); the globe cards have no outline; both headline words compute to the gold token and
the display font; the typed text is present in the DOM at load; screenshots at 390 and 1280 attached to the log.

#### I-5 Motion language: smooth, varied, not flickering
OWNER. The current transitions flicker; that is not wanted. He wants a smooth transition between parts of the page
and a golden light that travels with the page, something in the background as you scroll down. The grid with a small
diamond running across looks poor and has no real animation. The same transition appears everywhere; it is not
needed everywhere and should be varied. On photos, the edge fade on both sides is not needed; use something else at
the bottom. Not spammy. Also: the top bar hides while scrolling down and returns on scrolling up. Also: a thin line
or wave field flows through the page and reacts to the mouse, as if the cursor were a magnet.
DO: (a) remove the flicker (find the cause: opacity or filter toggling, a layout shift, a double animation, or a
paint-heavy effect) and replace the divider with a smooth gold-light transition driven by scroll position; (b) define
a small motion set of at most four patterns (soft light sweep, slow parallax, fade-rise, line draw) and assign them
by section so no pattern repeats back to back; (c) photos get a bottom treatment only (gradient or caption bar), not
side fades; (d) the marketing top bar hides on scroll down and shows on scroll up and always shows at the top of the
page, without layout shift; (e) a canvas wave or line field on pointer-fine devices only, moves with the mouse like a
magnet, capped at 30 frames per second, paused when off screen, off on touch devices, off in Performance Mode and
reduced motion, inside the existing marketing canvas rules.
GATE T-MOTION: no flicker (the opacity and transform of divider elements change monotonically over a scripted scroll;
no layout shift above 0.05); reduced motion and Performance Mode disable (a), (b), (e) and the typing effect; scroll
down hides the top bar and scroll up shows it; the canvas is absent on a touch viewport; frame time of the page
stays under budget in the existing perf harness; screenshots before and after in the log.

#### I-6 "Everything a real project needs" as four live slots with staggered flips
OWNER. The panels stack vertically on a phone and look ugly. Keep FOUR on screen: one big card on the left, two small
cards on the right, and one wide horizontal card below those two. The remaining panels live behind them: each of
the four slots flips to show another panel. They must never flip together. Example timing: the big card flips at 5
seconds, the first small card at 10, the second small card at 15, the wide card at 20, then they continue at their
own offsets. A visitor sees one flip, then another; the page feels alive and shows more features without length.
DO: build the 1 + 2 + 1 layout (desktop and tablet), the same four slots on phone as a tidy two-column or single
horizontal arrangement with no tall vertical stack of every panel. Slot rotation: each slot has its own start offset
and its own period, so two slots never flip within 1.5 seconds of each other; the pool is the full panel list in a
fixed order so every panel is seen; flips pause on hover, focus and when the section is off screen, and stop under
reduced motion and Performance Mode (the four slots then show the first four panels with a "See all features" link).
All panels remain reachable without motion: a visually-hidden full list and a link to the field guide. Use one panel
count from one source (see I-8).
GATE T-BENTO: at 1280 px four slots in the 1 + 2 + 1 arrangement; over a 60 second scripted run, logged flip
timestamps never overlap within 1.5 s, every panel appears at least once, flips pause on hover; at 390 px no
vertical stack of more than four cards; under reduced motion no flip occurs and a "See all features" link exists.

#### I-7 Real photography
OWNER. Competitor sites use real photos. Use stock photos of skyscrapers and large construction works in the
framework, and structure the plan around them.
DO: pick photographs that suit the black and gold theme (cranes, steel frames, concrete pours, site at dusk, big
projects), a few for the hero background and section backdrops. Licence: only photos whose licence allows commercial
use and modification; record source, photographer, licence name and date retrieved for each in
`docs/PHOTO-CREDITS.md` (Q12). No identifiable people unless the licence clearly covers it, no visible brand logos.
Self-host as WebP or AVIF with `srcset`, width and height attributes, lazy loading below the fold, each image under
150 KB at its largest size; dark gradient overlay so text stays readable; alt text on each; bottom treatment only
(I-5c). The three hero SVG cards stay.
GATE T-PHOTOS: every image on the landing page is listed in `PHOTO-CREDITS.md` with licence; no remote image URLs; size
budget respected; contrast of overlaid text 4.5:1 or better; Lighthouse performance not worse than before by more
than 3 points; no layout shift.

#### I-8 New content sections and honest numbers
OWNER. Add a "Why My MaNaGeR" section with the benefits and our story, a short platform overview, and who we serve;
add the four solution areas; show project and field tracking and team collaboration on the landing page. No "Request
a demo", no sales-hungry calls to action, no customer stories yet, no customer service or professional services pages.
The story, in his words, tidied: modern software is bloated and oversaturated; most of its features are never used
across a whole project; the prices are high and the value for the money is poor; My MaNaGeR is the simple alternative.
Who we serve: general contractors, the public sector, subcontractors, quantity surveyors, estimators, and anyone who
produces work on a project. Solutions (each maps to real modules): project execution, cost management, resource
management, project lifecycle management.
DO: write the sections in the owner's voice (short, plain, no corporate filler), using only claims the product can
back up; no invented testimonials, numbers or comparisons that name a competitor; keep calls to action to Get
Started and View Field Guide. Check the claims against the product: "zero server required" and "100 percent of the
data stays yours" must be worded to match the actual behaviour (works offline; cloud and AI features are optional
and say what leaves the device). One source of truth for panel and module counts: a single constant used by every
place that states a number, because the older copy stated different counts in different sections.
GATE T-COPY: a grep gate that every stated panel or module count on the landing page comes from the one constant; no
"demo" call to action; the new sections exist; a claims table in `docs/UI-AUDIT-MAP-2026-11.md` links each claim to the
module that backs it.

#### I-9 Dot rail, stats strip, and the AI tour label
OWNER. (a) The landing page's circular side buttons are too visible and look pasted on; dim them by about another
quarter. (b) The strip that says panels, zero server required, offline first by design, 100 percent of the data
stays yours is accurate but could be presented better. (c) In "from blank to live in four steps" (charter the project,
pick your methodology, build the work breakdown structure, track, forecast and report), replace the little star icon
with the brand label "My MaNaGeR AI Tour"; branding matters. Keep it simple. The "account optional, your data is
not" line stays where it is.
DO: (a) reduce the rail's resting opacity by 25 percent of its current value and keep hover and active states clear;
(b) redesign the strip as four clean stat tiles with small icons and a gentle count-up on first view (reduced motion:
static), using the count constant from I-8 and honest wording; (c) swap the star for the label and logo mark; if the
block accepts questions, make sure the box works, otherwise leave it as a guided tour.
GATE T-RAIL: the rail's computed opacity at rest is at most 0.75 times its value at commit `acf2462` or the value
recorded in the map file; the star icon is gone; the label reads "My MaNaGeR AI Tour"; the strip uses the constant.

#### I-10 Sign-in page: card moves left, outlined MMWRP on the right
OWNER. Move the sign-in card from the centre to the left, unchanged: no re-editing of the card, "everything is perfect
as it is". On the right, use the freed space for the letters MMWRP (my manager workspace, Q11) as large skeleton
text: outline only, no fill, big font. It is a silver outline that turns gold with a soft highlight when the pointer
moves over it. Hidden on mobile. Keep the current background.
DO: two-column layout from a defined breakpoint (default 900 px); below it the card is centred as today and the
outlined text is not rendered. Outline via text stroke with transparent fill (or SVG text); the hover highlight is a
gold stroke plus a faint glow; keyboard users get nothing extra (decorative, `aria-hidden`). The card keeps its
current content, size and focus order; no lock icon, no blue, the in-card email dropdown stays.
GATE T-SIGNIN: at 1280 px the card's centre is left of the page centre and the outlined text is on the right; at 390
px the layout matches today's and the text is absent; the text computes to a transparent fill with a silver stroke
and a gold stroke on hover; the card's inner markup is byte-identical to before except for its wrapper.

### SPRINT 5 - PROJECT AND APP SCREENS

#### I-11 First-open tour must highlight what it describes
OWNER. The tips shown when a project is first opened say that everything lives in one project, the rail switches
between sections, and the tour walks the sections used most. But nothing is highlighted: it talks about the dashboard
and the rail while nothing is circled or lit. The wording is simple and good; the highlighting is missing.
DO: each step names a target element; the tour dims everything else, cuts a rounded spotlight around the target with a
gold ring, scrolls the target into view, places the tip beside it without covering it, and repositions on resize.
Targets that do not exist for this user (a hidden section) are skipped. Works on phone, in dark and light, with
keyboard (Next, Back, Escape) and focus kept in the tip. Reduced motion: no animated movement.
GATE T-TOUR: for every step, the target's bounding box lies inside the spotlight cut-out and the rest of the page is
covered; skipping a missing target works; the tip never overlaps the target; screenshots of each step at 1280 and 390
attached to the log.

#### I-12 Photo upload with bundles, behind any paid plan
OWNER. Photos must be uploadable from a phone (camera or gallery) or from a computer, with a description. The picker
allows one or several photos. If several are chosen they are kept together as one bundle, not separated, and the
bundle gets one description ("this bundle is for these things"); then the user moves on to the next upload. There is a
visible upload button for the project manager. The feature needs any paid subscription (Q13).
STATE CHECK: the photo store, its limits, and any plan gate helper used by other paid features.
DO: an Upload button on the Photos tab; picker with `multiple` and `accept=image/*` (camera capture allowed on
phones); after picking, a small form with one description for the whole selection, a preview strip, and Upload; the
selection is saved as one bundle record containing its photos; the grid shows bundles as stacked thumbnails with a
count; opening a bundle shows all its photos and the description; edit or delete a bundle. Compress on device before
upload (long edge about 1600 px) and show per-photo progress; works offline (queue and send later). Plan gate: free
users see the upload button with a short upgrade explanation (no dead click); paid users upload; everyone can view
what exists. Roles: who may upload follows the roles in I-3 and H-7.
GATE T-PHOTO-BUNDLE: select 3 photos, one description: one bundle with 3 photos appears; a free account sees the
upgrade message and cannot upload (server enforced, not only hidden); a paid account uploads; the 500 case from I-2 does
not occur; offline queue sends after reconnect.

#### I-13 Three "what is this" controls
OWNER. (a) A "Pin" control exists but does nothing anywhere he can see. (b) In the Advanced pack there is a small
animated element and he asks what it is and whether it was added as a surprise. (c) A "how do I delete my account"
entry shows for a person who has no account.
DO: (a) find Pin; apply the Q10 default (finish it if it has a clear target, otherwise remove it); (b) find the
animation, write one line in the log saying what it is and who added it (git blame), keep it only if it serves a
stated purpose and carries a label, otherwise remove it; (c) find the delete-account entry points and make them
appear only for signed-in users (signed-out users see nothing or a neutral line), then report any other place a
signed-in only message appears to a signed-out visitor.
GATE: signed out, no delete-account prompt anywhere in the app or marketing pages; Pin is either working with a test
or gone; the animation is explained in the log; a grep confirms no leftover reference to a removed control.

#### I-14 App sidebar opens on hover
OWNER. On a computer, moving the mouse onto the icon rail should open the sidebar straight away. Today it does not
open when the pointer is over a specific icon. It should close when the pointer leaves.
STATE CHECK: the sidebar open and close handlers and the gutter work from APP-1 (`REFINEMENT-PROGRESS.md`).
DO: on devices with a fine pointer and hover, open on pointer enter anywhere over the rail, including over an icon, and
close on pointer leave after about 150 ms so moving across icons does not flicker; keyboard focus on any rail item
opens it; Escape closes; phones and touch tablets keep today's tap behaviour; the open sidebar overlays content (no
layout jump) unless the user has pinned it open; Performance Mode keeps the behaviour but drops transitions.
GATE T-SIDEBAR-HOVER: hovering an icon opens the sidebar within 200 ms; moving between icons keeps it open; leaving
closes it; keyboard focus opens it; touch viewport unchanged; no layout shift.

#### I-15 Explicitly NOT changing
- The calculator interface: the owner called it a simple, uncluttered calculator UI. Do not redesign it (the Wave G
  and refinement fixes to it stand).
- The colours of the project section cards: the owner said they are not bad and to leave them for now.
- The existing "account is optional, your data is not" line.
GATE: a diff review in the log shows no change to the calculator layout or the project card colour tokens from Wave I.

### 4C. WHAT THE AUDIO DID NOT MAKE CLEAR (defaults apply, owner may correct)
- The list of competitor sites he browsed was garbled; none of it is needed, only the ideas above.
- The project-section colours remark (a mention of magenta and a thought that did not finish): treat as "leave as is" (I-15).
- Where exactly "Pin" and the Advanced pack animation sit: found by search in I-13.
- The "delete my account" remark is low confidence; I-13 (c) audits the visibility rather than assuming a design.
- Roughly 90 seconds near the 21 minute mark and a few gaps elsewhere were silent or inaudible; nothing was inferred from them.

---

## 5. SPRINTS

- Sprint 0 (right after Wave G, before Wave H): I-0, I-1, I-2, I-3. Exit: T-CLOUDLIST, T-PHOTO-EMPTY, T-RBAC-UI green,
  `npm run verify`, commit, deploy, live probe (upload a project, sign out and in, open it on a second device; open
  Photos on a new project; invite a second account).
- Sprint 1: H-0, H-1, H-2, H-3. Exit: T-BUD-TRUTH, T-BOQ, T-DELIVERY green, `npm run verify`, commit, deploy, live probe
  (send a real bill to a test project, record a delivery, watch Remaining fall on every screen).
- Sprint 2: H-4, H-6. Exit: T-WEEK, T-APPROVE green, commit, deploy, live probe (propose from an MCP client with a test
  key, View, edit, approve, revert).
- Sprint 3: H-5, H-7, H-8. Exit: T-MCP-BUDGET, T-BUD-RBAC green, field guide complete, full qa battery, deploy,
  live probe of the permission switches.
- Sprint 4: I-4 to I-10 (landing page and sign-in). Exit: T-HERO, T-MOTION, T-BENTO, T-PHOTOS, T-COPY, T-RAIL, T-SIGNIN
  green, screenshots at 390 and 1280 in the log, `npm run verify`, commit, deploy, live probe on a real phone width.
- Sprint 5: I-11 to I-15 (project and app screens) and the Wave I part of H-8. Exit: T-TOUR, T-PHOTO-BUNDLE, T-SIDEBAR-HOVER
  green, I-13 gate, I-15 diff review, full qa battery, deploy, live probe.

---

## 6. DONE MEANS

Every box H-0 to H-8 and I-0 to I-15 ticked with a commit hash and gate output in `REFINEMENT-PROGRESS.md`; all new gates
in `ci.yml`; no assumption left unverified in `docs/BUDGET-MAP-2026-11.md` and `docs/UI-AUDIT-MAP-2026-11.md`; field-guide
cards for every user-visible Wave H and Wave I feature; the owner can price a job in the calculator, send it to a project,
record a delivery, see the weekly position, and approve an MCP change after seeing and correcting exactly what it will do;
cloud projects follow the account to every device; the landing page and sign-in page carry the owner's look (flat gold
buttons, smooth varied motion, four flipping feature slots, real photography, the outlined MMWRP) without losing speed
on a phone.
