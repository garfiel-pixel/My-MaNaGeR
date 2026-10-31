# Sprints - owner UI audit (2026-10-31)

One sheet, one order. Each sprint is a single session that leaves the repo
shippable on its own, with a gate that fails if the fix regresses later.
**This file supersedes `IMPLEMENTATION-PLAN-2026-10-30.md`,
`FINAL-IMPLEMENTATION-PLAN.md` and `TOOLS-CHECKLIST.md`** - those three were
written without reading the code and contain claims disproved below.

Position in the main queue: these are sub-phases of **Wave 1.7**. Wave 1.6
(the `css/src/*` split) still comes after 1.7 closes.

## What the earlier plans got wrong (checked against the code)

| Their claim | The code says |
|---|---|
| "Back to Dashboard is already on the LEFT, no change needed" (admin.html:398) | It is in `.hdr-actions` (`admin.html:393-401`), the right-hand group of `header{display:flex;justify-content:space-between}` (`css/mmgr.css:874-877`). The owner's complaint stands; only his left/right detail was loose. |
| "Float/pin broken, verified at mmgr-ai.js:3184 and :4284" | `3184` is the comment above `setupFloatSurface()`, `4284` is `syncPinUI()` - the *pin*, not the float. Neither line is evidence of a defect. |
| (their patch) `syncFloatState(id); saveFloatState(id);` | `syncFloatState()` exists (`js/mmgr-ai.js:3324`). **`saveFloatState()` does not exist** - that patch would throw on first float. |
| "RBAC/team UI missing, add enterprise detection" | Shipped 2026-10-28: `enterprise()` gates on `Entitlements.rbacEnterprise()` (`js/cloud/team-ui.js:108-113`), with `qa-team-enterprise` (E0-E15) and `qa-team-ui` already in the battery. Nothing to rebuild. |
| "Add a `.bcp-rate-notice` disclaimer div" | `<p class="bcp-rate-notice" id="calc-rate-notice" hidden></p>` already exists at `calculator.html:703`. Reuse it; do not add a second. |
| Tools: `qa-admin.cjs`, `verify-theme.cjs`, `verify-cloud-access.cjs` | Do not exist. The real ones are `qa-admin-code-escrow`, `qa-admin-recovery`, `verify-theme-cdp`. `verify-test-registry.c2` is a typo for `.cjs`. |
| "Emergency Override: skip the blocking requirement" | Directly contradicts the hard gates in `AGENTS.md`. No sprint below permits it. |

The one correction to my own earlier report: `calculator.html` **does** carry
owner-facing "JIC" (`:265` label "JIC rate", `:531` "Checked against JIC on"),
not just `js/calculator-page.js`.

## The sprints

**Status 2026-10-31: S1-S6 are DONE; S7 remains.**

- **S5** shipped with `tools/qa-cloud-refresh.cjs` (8/8). The real defect was
  narrower than the report and worse than it sounded: nothing was lost, but
  EVERY failure path in `loadList()` hid the whole section and then blamed the
  wrong thing ("Cloud sync is unavailable on this host" to a signed-in owner) -
  so one slow or failed request emptied the launcher's cloud list. The last
  good answer is now cached in `mmgr_cloud_dash_cache` and painted first, a
  failure keeps the cards and states the reason in the status line, sign-out
  drops the cache AND clears the DOM, and the list painter is one function
  (`paintList()`) shared by the fetch and the cache.

- **S4** shipped with `tools/qa-theme-perf.cjs` (15/15). The standard paths were
  already sound, so the gate proved the contract instead of "fixing" it - and
  then found the case the owner actually described: an open tab did not follow a
  preference changed in another tab. Both modules now listen for `storage` and
  re-apply only their own key.
- **S6** shipped with `tools/qa-ai-float.cjs` (12/12), the first gate to touch
  `.float-mode`. It found two real defects: D-1's More-menu injection `return`ed
  early, so the Float row had no click handler and the header had no drag wiring
  (float did nothing at all); and closing a floating window left `float-mode`
  and its inline geometry behind, so the next open came back mid-screen. Both
  fixed in `js/mmgr-ai.js`, with the dock/close path factored into `dockFloat()`
  so the drawer and the assistant cannot drift apart again.

**Status 2026-10-31: S1, S2 and S3 are DONE** (owner greenlit all three plus the
full initials purge). Evidence: `qa-chrome` 82/82, `qa-toolbar-spacing` 12/12,
`verify-ratebook-wording` 12/12 with the new zero-occurrence arm, and the
calculator battery re-baselined where the rename moved its fixtures -
`qa-calculator-page` 250/250, `qa-calc-assistant` 156/156, `qa-calc-golden`
85/85, `qa-calc-controls` 94/94, `qa-calc-trade-coverage` 88/88,
`qa-calc-playwright-audit` 61/61, `qa-ratebook` 14/14, `verify-export` 34/34,
`verify-currency` 11/11, `npm run verify` exit 0. Shell v517.

Three defects the work itself surfaced, all fixed in the same wave:

1. **Two `syncBookNote()` functions.** The rebrand collapsed the picker's note
   helper and the all-in note helper onto one name; hoisting made the all-in
   version win, so the picker's note never rendered (`qa-calculator-page` JP2
   caught it). They are `syncBookPickNote()` and `syncBookNote()` now.
2. **A dead full-book handoff.** `js/calc-ai.js` still read
   `window.MMGR_JIC_FULL_LOAD`, so the assistant waited forever for the 811-row
   book to land. Now `MMGR_BOOK_FULL_LOAD`.
3. **A duplicate id.** The blanket id rename gave the picker note and the
   all-in note the same `id`, so `getElementById` returned the wrong node. The
   picker's is `calc-book-pick-note`.

### S1 - Chrome: kill the pills and the boxes  (owner findings 1, 6, 8, 10)
**Why:** the most visible complaint and the lowest-risk change - no behaviour,
no markup semantics, no JS.
**Scope**
- Admin header actions (`admin.html:393-401`): drop `.btn-n.btn-s` from
  Dashboard / Password / Lock; the header's own `<style>` block
  (`admin.html:139-142`) becomes hover + focus-visible underline, no fill.
- `.escrow-badge` (`css/mmgr.css:18130-18149`): lose `border-radius:999px`,
  the border and the raised fill; keep the dot + text as a status line.
- `.hdr-back` (`css/mmgr.css:979-993`): remove `border`, `background`,
  `border-radius`; keep the icon, the label and a visible `:hover` /
  `:focus-visible` state.
- Calculator top-bar back button and the theme / perf / arrow icon buttons:
  same treatment (hover-only highlight), keeping a >=3:1 focus ring.
**Gate:** new `tools/qa-chrome.cjs` (browser, serves from disk): for each named
control assert computed `border-radius` <= 6px, `background-color` transparent
at rest, non-transparent on `:hover`, and a focus-visible outline whose contrast
against the surface is >= 3:1. Run at 390 and 1280, light and dark.
**Done when:** new gate green, `npm run verify` green, `verify-gold`,
`verify-actions`, `verify-a11y-labels` and `qa-health-sweep` green.
**Size:** one session. **Risk:** low.

### S2 - The rate book's real name  (finding 9)
**Why:** the owner has asked for this twice, and **the gate that exists to
enforce it passes while "JIC" is still rendered to users**. That is the real
defect: not the six strings, but a gate with a hole.
**The hole.** `tools/verify-ratebook-wording.cjs` (CI, 12/12) fails served
pages on `JIC rate book|Jamaica rate book|JIC rates` (`:115-117`) but scans
**`js/` strings not at all** beyond the name/notice/source arms. So it misses:
- `js/calculator-page.js:9816` - `' (JIC rate book)'` rendered on the estimate;
- `:10671` - `' - JIC rate book'` in the CSV export;
- `:15387` - hint "...in the JIC rate book picker.";
- `calculator.html:265` - label "JIC rate" (singular, outside the regex);
- `:531` - "Checked against JIC on" (outside the regex).
**Scope**
1. Gate first: add an arm that extracts rendered string literals from
   `js/calculator-page.js` (strip comments and template noise) and fails on
   `JIC|GIC` followed by `rate`/`rates`/`book`; widen the HTML arm to the same
   rule. Keep two explicit exemptions: the provenance line
   (`RATEBOOK_SOURCE = 'JIC Rate Book 2025-2027'`, which arm 85 requires while
   provenance is unresolved) and row references of the form `JIC #<n>`.
   Prove the arm has teeth by running it against the current tree - it must
   fail on the five strings above before any fix.
2. Then rename: "JIC rate" -> "My MaNaGeR rate", "Checked against JIC on" ->
   "Checked against the book on", ` (JIC rate book)` -> ` (book rate)`,
   ` - JIC rate book` -> ` - book rate`, and the picker hint.
3. Add the owner's disclaimer to the **existing** `#calc-rate-notice`
   (`calculator.html:703`): "Baseline planning rates, subject to change - not
   final pricing." Do not create a second notice element.
Keep internal ids and the `calcBookJic` action name - they are wiring, not copy.
**Gate:** the extended `tools/verify-ratebook-wording.cjs` (already in
`ci.yml:258`) plus `qa-calculator-page`.
**Done when:** the new arm fails on the pre-fix tree, passes after, and
`qa-calculator-page` is green.
**Size:** half a session. **Risk:** low.

### S3 - Spacing and dot states  (findings 5, 7)
**Why:** the only two purely visual defects the owner can point at on a
screenshot, and both are one CSS rule plus one render tweak.
**Scope**
- `.card-title > div` (used by the charter row, `project.html:559`) gains
  `display:flex; gap:8px; flex-wrap:wrap;` - or better, give that row the
  existing toolbar class if one already defines the gap, so one rule serves
  every card head.
- `.timeline-ind` (`css/mmgr.css:7508-7531`) and `.dirty-ind` (`:7317-7342`):
  one shared dot treatment - 8px dot, transparent at rest, no `100px` radius
  on the hover pill; three tones (ok / warn / bad) driven by tokens already in
  use (`--dot-green`, `--dot-yellow`, `--dot-red`), never raw hex.
**Gate:** new `tools/qa-toolbar-spacing.cjs`: measure every button row inside a
`.card-title` and assert a horizontal gap >= 8px between adjacent buttons at
390 / 768 / 1280, plus computed dot size 8px and `background-color` transparent
at rest for the two indicators.
**Done when:** new gate green plus `qa-dashboard-spec`, `qa-fixed-containment`
and `verify-css-integrity` green.
**Size:** one session. **Risk:** low-medium (shared selectors - check the other
`.card-title` rows before adding a global rule).

### S4 - Theme and Performance Mode stop fighting  (finding 11)
**Why:** two independent prefs (`mmgr_theme` in `js/mmgr-theme.js:46`,
`mmgr_perf_mode` in `js/mmgr-perf.js:17`) plus a boot script
(`js/mmgr-perf-boot.js`) and a marketing-page reader (`js/marketing.js:142`).
A real coupling bug is plausible; nobody has reproduced it.
**Scope:** write the reproduction FIRST - a gate that, on calculator and on
project, toggles theme and asserts the perf pref is unchanged, then toggles
perf and asserts `documentElement` class + stored theme are unchanged, then
hard-reloads and asserts both survive. Fix only what that gate shows.
**Gate:** new `tools/qa-theme-perf.cjs` (browser, both pages, both directions,
plus reload).
**Done when:** gate green, `verify-theme-cdp` green.
**Size:** one session. **Risk:** medium (theme boot runs before paint; a bad fix
flashes the wrong theme on every page).

### S5 - Cloud projects survive a hard refresh  (finding 12)  [DONE]
**Why:** data appears lost to the owner; that is worse than any styling issue.
**Outcome:** the list was never actually lost - it was hidden. The gate proved
`/api/cloud/projects` answers correctly after a hard reload, then proved every
failure path blanked the section and mislabelled the cause. Fixed with a
device-side display cache (`mmgr_cloud_dash_cache`) painted before the fetch,
`keepOrHide()` for failures, and one `paintList()` for both sources. Gate:
`tools/qa-cloud-refresh.cjs`, 8/8.
**Scope:** reproduce in `verify-cloud-autosave-signin` (it already signs in and
saves) with a real hard reload (`--disk-cache-size=0`), then follow the trail:
`js/mmgr-cloud-dash.js:196-206` writes `mmgr_state_<id>` / `mmgr_unlocked_<id>`
but the editor code lives in `sessionStorage`, which a hard reload keeps and a
new tab does not - decide which of those is the "disappeared" case and make the
list rebuild from `/api/cloud/projects` rather than from a cached manifest.
**Gate:** a hard-reload arm added to `verify-cloud-autosave-signin` (or a new
`tools/qa-cloud-refresh.cjs`), asserting the project list is non-empty after
reload and after a fresh tab with the session cookie only.
**Done when:** that gate is green twice in a row and `qa-cloud-phase2` is green.
**Size:** one session, possibly spills. **Risk:** medium-high (session and
entitlement paths; do not weaken the tenant fence from `f004300`).

### S6 - Assistant float and pin, gate first  (finding 4)
**Why:** **no harness in the repo covers float mode at all** - `qa-appshell`
only mentions it in a comment, and `qa-ai-win` / `qa-ai-window-layout` never
touch `.float-mode`. So the report cannot be confirmed *or* denied today, which
is exactly how a broken control survives green CI.
**Scope:** step 1, add `tools/qa-ai-float.cjs`: open the assistant, float it,
assert the window leaves the dock (rect vs sidebar), drags and keeps its new
position, restores dock geometry on unfloat, persists across reload, and
`#ai-pin-btn` reports `aria-pressed` + `aria-checked` honestly. Step 2, fix
whatever that gate proves - in `setupFloatSurface()` / `syncFloatState()` /
`toggleFloat()` (`js/mmgr-ai.js:3184-3400`). Do not rewrite the module; D-1
landed here on 2026-10-30.
**Gate:** the new harness, registered in `docs/CI-TEST-COVERAGE.md` and run in
the `browser-app` job.
**Done when:** new harness green, `qa-ai`, `qa-ai-win`, `qa-ai-window-layout`,
`qa-ai-dictation`, `qa-fixed-containment` all still green.
**Size:** one session. **Risk:** high (recently rebuilt surface).

### S7 - Close the enterprise claim  (finding 3)
**Why:** the owner says the team panel does not appear with an enterprise plan.
The UI and its API are shipped and gated, so either the tier is not actually
active or the panel is hidden by a separate condition.
**Scope:** no product change until proven. Run `qa-team-ui` + `qa-team-enterprise`;
then a browser probe signed in on an enterprise subscription checking
`Entitlements.rbacEnterprise()`, the `#team-*` panel's visibility and the
`enterprise()` gate's inputs. Record the answer (tier string, entitlement
result, panel state) in this file. Only if the panel is genuinely missing for a
true enterprise tier does a code sprint follow.
**Gate:** `qa-team-ui`, `qa-team-enterprise` (both already registered).
**Size:** half a session, diagnostic. **Risk:** none.

## Order and dependencies

`S1 -> S2 -> S3 -> S4 -> S5 -> S6 -> S7`

- S1, S2, S3 touch different files and could ship in any order; run them first
  because they are visible, cheap and rebuild the owner's confidence.
- S4 and S5 are both "reproduce, then fix" and must not be merged: one is a
  preference bug, the other a session/cache bug.
- S6 is last of the fixes because it is the riskiest and because a new harness
  there is more valuable than a speculative patch.
- S7 is diagnostic and can be run at any time; it costs half a session.

## Not in these sprints (still queued in EXECUTION-PLAN)

- **1.6 E6.3** - split `css/mmgr.css` into `css/src/*` layers. Do it AFTER S1
  and S3, or their new rules land in a file that is about to be split.
- **E7** - `tsc --checkJs` + JSDoc on state / cloud / billing (no `tsconfig.json`
  today). Unblocks nothing urgent.
- **F2** - load test against a staging Worker (D1 write-heavy p50/p95/p99).
- **F3/F4/F5** - uptime + error tracking, one real D1 restore drill, published
  targets and an incident log. Blocked on owner choices, not on code.

## Rules that apply to every sprint

1. `node build.js` after any `js/` edit - a stale bundle is the #1 phantom bug.
2. `npm run verify` before claiming done; register any new harness in
   `docs/CI-TEST-COVERAGE.md` **and** in `ci.yml` or `extended-qa.yml`.
3. No emoji, SVG sprite symbols only; no AI attribution in commits; no
   `--no-verify`.
4. Inline `<script>` edits require regenerating `INLINE_SCRIPT_HASHES` in
   `worker.js` + `serve.cjs`, and restarting `serve.cjs` (stale in-memory CSP).
5. One commit per sprint, Conventional Commit subject, `npm run verify` green
   in the message body's evidence line.
