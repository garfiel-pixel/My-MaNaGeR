# MERGED WAVE PLAN - 2026-10-09 (owner review + estimator follow-ups)

**Status:** DRAFT FOR OWNER APPROVAL. Nothing in this document is code. Do not edit a served
file until the owner signs this off.

**Sources merged:**
- The owner's 2026-10-09 review (voice transcript, clarified live in session).
- `PLAN-ESTIMATOR-2026-10-09-RESEARCHED.md` - only the parts still open, plus the parts the new
  session decisions change.
- `MYMANAGER-ESTIMATOR-DIRECTIVE-2026-10.md` (locked decisions D1-D14).

**Reading order:** section 0 (decisions + a correction), section 1 (the work, item by item),
section 2 (wave order), section 3 (decision log), section 4 (out of scope).

---

## 0. DECISIONS LOCKED THIS SESSION

| # | Owner decision | Effect on the old plan |
|---|---|---|
| L1 | **The pretty UI stays the default.** Performance Mode is an opt-out for a laggy device, and there must be a visible hint offering it when the page lags. | `PLAN-ESTIMATOR` never covered this. `mmgr-perf.js` is the file. |
| L2 | **The sign-in popup is turned OFF.** Sign-in happens ONLY on the app page, and clicking Sign in there opens the polished `signin.html` page. Marketing pages do not offer sign-in. | Rewrites estimator `W3`: instead of pointing marketing headers at `/signin`, remove the marketing entry points and route the APP's trigger to `/signin`. |
| L3 | **No topic restriction on the AI.** Instead, the free daily limit drops from 10 to 5 messages. | Changes estimator decision #4 (10/24h) and `js/calc-ai.js`'s `CAP`. |
| L4 | **The hero stays static.** Do not build the looping hero sequence. | **Cancels estimator `W7`.** |
| L5 | **"Skeleton" means the loading skeleton** (the grey placeholders), not the dashboard layout. | Scopes item 7. |
| L6 | **The estimator AI offers both outputs.** It asks the user: populate the calculator (so they can export) OR generate a file to download, with a "recommended" tag on the populate path. This is a paid surface, so the choice must be obvious. | Extends estimator `W6` (the calculator AI panel). |
| L7 | **Re-plan before code.** | This document. |
| L8 | **Rail groups:** the admin entries get a group named **Administrate**; the calculator gets its own section under a **Tools** heading. | Resolves Q1 (item 9). |
| L9 | **Starfield scope:** app page only as built; the project viewer stays plain. **Plus the sign-in page** (`signin.html`), which must look beautiful - soft UI, not too glassy, keep the classiness. | Resolves Q2 (item 2) and extends item 3. |
| L10 | **Rounded-rectangle sweep reaches admin + app + project** (the same language everywhere). | Resolves Q3 (item 8). |
| L11 | **Cloud cap rule:** the free tier gets exactly **1** cloud project; **any** paid subscription gets **unlimited** cloud projects; offline/local projects are unlimited on every tier, signed in or not. | Resolves Q4 and turns it into a real server change, not just verification (item 12). |

### 0.1 CORRECTION - the estimator plan's status header is stale

`PLAN-ESTIMATOR-2026-10-09-RESEARCHED.md` opens with "PLAN ONLY - nothing in this document is
implemented", but its own wave log (section 14) marks the following **DONE and deployed**:

- W1 `entitlements.js` estimator gate + `unlimitedCloud()` fix - DONE.
- W2 cancel requires a typed `CANCEL` word, client + server token - DONE.
- W4 free key pool as Wrangler secrets `GEMINI_KEY_1..4`, smallest model only - DONE.
- W5 managed rung on `POST /api/ai/chat` in the A1 order, plus the 10/24h per-account cap - DONE.
- W6 the AI chat panel on `calculator.html` (`js/calc-ai.js`, swappable mount) - DONE.
- Shipped as commit `d32359b`, Worker version `f69db6ec`, CI green, live `sw.js` v387.

**Still open from that plan:** W3 (sign-in) and W7 (hero). W7 is now cancelled by L4; W3 is
rewritten by L2 and is item 3 below.

One consequence worth stating plainly: the pool has **never answered from a real Google key**.
Section 14 of the estimator plan records that the live call has not been made. That is a
verification item in this plan, not a new feature.

---

## 1. THE WORK, ITEM BY ITEM

Each item states the measured current state, the change, the files, and how it is proven.
"Prove it" means a browser or a harness, never a grep.

### Item 1 - Sprite icons disappear after back-navigation (reported in several places)

**Current, verified in code.** `js/mmgr-icon-restore.js` re-resolves every external-sprite
`<use href="css/mmgr-icons.svg#i-...">` on a `pageshow` where `persisted === true` (the
back/forward cache). It is registered in `build.js` in `APP_MODULES` (project bundle) and
`APP_LAUNCHER_MODULES` (app bundle), and `calculator.html` loads it as its own `<script>`.
It is **not** in the admin bundle, and `PLANNING-TODO-2026-09-03.txt` lists "admin.html
icon-restore wiring" as still open. This is exactly the reported defect class: leave the page,
come back, icons keep their box and draw nothing.

**Change.**
1. Add `js/mmgr-icon-restore.js` to `ADMIN_MODULES` in `build.js` and rebuild, so returning to
   `admin.html` restores its rail icons.
2. Sweep every served page that can be restored to guarantee the module is present on the page
   being restored to (project, app, admin, and the standalone pages that already carry it).
3. Confirm whether the report is only *unpainted icons* or also a *collapsed rail*. The rail is
   pinned open by a pre-paint inline script (`body.side-open` on desktop), so a bfcache restore
   that drops that class would look like "the side panel is gone" too. Prove which one it is
   before changing anything else; if the class is lost, restore it on `pageshow` as well.

**Files:** `build.js`, `dist/admin-bundle.js` (rebuild), possibly `js/mmgr-icon-restore.js` and
the pre-paint inline scripts. If an inline script changes, the CSP hashes in `worker.js` and
`serve.cjs` must be regenerated (hard gate) and `sw.js` bumped.

**Prove it.** Real browser: from the app, open the admin panel and the calculator, then
`history.back()`; assert every external-sprite `<use>` on the restored page has a non-zero paint
box. Extend the existing icon-restore gates in `tools/qa-calc-playwright-audit.cjs` and add an
admin/app case. `npm run verify` green.

### Item 2 - Pretty by default, the starfield actually shows, and the lag hint works

**Current, verified in code.** `mmgr-perf.js` defaults to prettiness (Performance Mode off), which
matches L1. But two real defects sit here:

- **The lag probe is inverted.** `startLagProbe()` returns early on `if (!isOn()) return;` - it only
  runs when Performance Mode is already ON. With the pretty default, a laggy device never gets the
  hint at all. A comment in the file still describes the pre-2026-09-29 default. Fix: run the probe
  while Performance Mode is OFF (the heavy layers are active) and keep the one-time, user-decides
  contract.
- **The starfield may not paint even with Performance Mode off.** `Viewport.effectiveGlassMode()`
  returns `css` unless ALL of: perf off, glass pref not the legacy `css` opt-out, a capable device
  (6+ cores, DPR <= 2.5, WebGL), and a wide viewport (not portrait, width > 640). `mmgr-glass.js`
  also refuses outright when the path contains `project`. So "perf off but no starfield" can be a
  capability or viewport gate rather than a wiring failure.

**Change.**
1. Fix the probe guard so the hint can actually fire on a laggy device.
2. Measure, in a real browser on the app page with Performance Mode off, which gate is returning
   `css`. Only then decide the fix - it may be nothing more than confirming the owner's window is
   wide and capable, or a genuine bug in activation/teardown. Do not loosen the capability floor
   blindly.
3. Confirm the intended pages (L9): the app page as built, the admin panel already gets it, the
   project viewer stays plain by design, and the **sign-in page** joins the list - `signin.html`
   must read as soft and beautiful, less glassy than it is now, while staying classy. The sign-in
   styling pass is carried by item 3 so it lands with the sign-in wiring.

**Files:** `js/mmgr-perf.js` (probe), and `js/mmgr-viewport.js` / `js/mmgr-glass.js` only if the
measurement shows a defect. `sw.js` bump if a served asset changes.

**Prove it.** Browser: perf off -> `#glass-canvas` present and `body.glass-premium` set on the app
page; perf on -> both absent, and no canvas leak. Throttle the CPU to confirm the lag hint appears
once, then never again on that device. `npm run verify` green.

### Item 3 - Sign-in: kill the popup, route the app to the polished page

**Current, verified in code.** Two popups exist:
- Marketing (`index/about/features/contact/pricing/reviews` + `mymanager-field-guide.html`, six
  `.signin-trigger` occurrences in the guide alone): a `signin-btn signin-trigger` opens
  `#signin-sheet`, the dark `#0b0b0d` box the owner calls the "black little box".
- The app page: the rail's Sign in and the header avatar call `openSignIn()`, which opens the
  in-page `#siom` modal.

Meanwhile `signin.html` is a polished, live page (star field, drift, glass card, Google + email,
`?next=` same-site redirect). It is linked from one place in the whole site.

**Change, per L2.**
1. Remove the marketing sign-in entry points entirely. Marketing keeps a "Get started" path that
   lands on the app page; it does not offer sign-in.
2. Point the app page's Sign in (rail row, header avatar, any other `openSignIn` caller) at
   `/signin?next=/app` instead of the `#siom` modal. Keep `#siom` in the markup, polished and
   hidden, so it can be pulled back up in one line if needed (this matches estimator plan decision
   #7: polish AND hide, do not delete).
3. `js/marketing.js`: remove the `.signin-trigger` -> `#signin-sheet` wiring and the sheet's
   focus-trap / Escape / outside-click handling that exists only for it.
4. Keep the `?next=` contract same-site only, and prove an absolute `next` is discarded.
5. **Styling pass on `signin.html`** (L9): soft UI, less glassy than today, still classy. This is the
   page the owner wants to look beautiful, so it lands with the wiring, not later.

**Files:** `app.html` (its inline `openSignIn`; if edited, regenerate CSP hashes), `js/marketing.js`,
`css/marketing.css` (polish the sheet to light, then hide it), the six marketing pages +
`mymanager-field-guide.html`, `css/mmgr.css` (`#siom` polish), `sw.js` bump.

**Prove it.** `qa-marketing.cjs` currently clicks `.signin-trigger` and asserts `#signin-sheet`
opens on desktop and mobile - those two checks MUST be re-baselined in the same commit or the suite
goes red. Extend `tools/qa-marketing-layout.cjs` (no marketing page contains `#signin-sheet`; no
marketing sign-in trigger) and `tools/verify-marketing-markup.cjs`. Browser: app Sign in lands on
`/signin`, and after sign-in returns to the app.

### Item 4 - The calculator AI window (the biggest item)

**Current, verified in code.** `js/calc-ai.js` is a small panel mounted at `#calc-ai-mount` on
`calculator.html`: a Clear button, a log, a two-row textarea and a send button, styled by a
`.bcp-ai-*` block in `css/mmgr.css`. It talks to the same `/api/ai/chat` relay and exports
`mount` / `unmount` for a later full takeover. It hardcodes `CAP = 10` and its status line reads
"10 free messages a day". The input is disabled when signed out. It already passes the estimate
totals to the relay through `MMGR_CALC_AI_CONTEXT`. The JIC 2025-2027 rate book lives in
`js/calculator-page.js`.

**Change, per L3 and L6.**
1. **Quota:** drop the free daily limit to 5 (both the client `CAP` and the server's KV cap in
   `src/ai-proxy.js`). Do not advertise the number up front; show only the reached message:
   "your daily limit has been reached, it refreshes in 24 hours".
2. **Sign-in required:** the AI is signed-in only. Align client and server so an anonymous caller
   cannot use it (this changes the estimator plan's "anonymous keeps the Workers AI path" note).
3. **Bigger, Claude-style window:** a larger panel; a history section that opens on hover or click
   of a small control; a "New chat" affordance; the conversation in the middle; the signed-in
   identity pinned at the bottom. Reuse the app page's existing identity rendering so the two read
   as one product.
4. **File upload:** a path to attach and read a file (rate sheet or document).
5. **Rate sheet indexing:** the assistant must be able to read the active rate book and answer from
   it, and the user must be able to add their own rate sheet.
6. **Both outputs, user's choice (L6):** when the conversation reaches a conclusion the assistant
   asks "populate the calculator so you can export, or generate a file to download?", marks the
   populate path as recommended, and follows the choice. Populating reuses the existing calculator
   action dispatch (`calcBoqAdd` per directive D6); generating a file uses the existing export
   machinery, not a new format.

**Files:** `js/calc-ai.js`, `calculator.html`, `css/mmgr.css` (`.bcp-ai-*`), `js/calculator-page.js`
(populate + rate-sheet read hooks only - the panel must stay swappable and must not reach into
calculator internals), `src/ai-proxy.js` (cap 5, signed-in only, system prompt), `test/ai-free-pool.test.mjs`
(10 -> 5), `sw.js` bump.

**Prove it.** Re-run and extend the `js/calc-ai.js` browser probes (input disabled when signed out,
server quota wording reaches the user, no fake answer on a 402, mount/unmount). New probes: the
5-message cap, the reached-limit notice and its absence before that, history open/close, file
upload reading, a rate-sheet-grounded answer, and both output paths. Unit tests: the cap is 5, an
exhausted allowance refuses with 402, an anonymous caller is refused.

This item is large enough to ship as its own sub-waves (see section 2) so each piece is verifiable.

### Item 5 - AI topic restriction

**Decision L3: no restriction.** No guardrail code. Only the system prompt keeps the assistant in
an estimating voice - which `js/calc-ai.js` already does. Nothing to build beyond Item 4.

### Item 6 - Hero art loop

**Decision L4: cancelled.** No work. Record it so a future session does not resurrect estimator
`W7`.

### Item 7 - Loading skeleton polish

**Current, verified in code.** The loading skeleton is already a shipped wave
(`docs/superpowers/plans/2026-09-29-skeleton-loading-screens.md`, sw v337): shared `.skel-box`
primitives + `skel-shimmer` keyframes with `--skel-base` / `--skel-sheen` tokens, a boot splash in
`project.html` mirroring the real layout, and cloud-dash skeleton cards in `js/mmgr-cloud-dash.js`
for `#cloud-dash` and `#rail-cloud-list`.

**Change, per L5.** A visual polish pass only: tighten the placeholder shapes so they match the real
rendered dimensions, tune the shimmer timing and contrast against the theme tokens, confirm dark
mode parity and `prefers-reduced-motion`, and make sure no off-screen skeleton flashes while the
page is offline.

**Files:** `css/mmgr.css` (the skeleton block), `project.html` (static markup only - no inline
script, so no CSP hash change), `js/mmgr-cloud-dash.js`, `sw.js` bump.

**Prove it.** `tools/qa-dashboard-spec.cjs` skeleton gates + browser screenshots in light and dark,
plus the offline guard: with the Worker absent, the cloud skeleton must not flash.

### Item 8 - Fewer pill shapes: use rounded rectangles across admin, app and project

**Current.** The admin panel is heavy on fully-rounded pill controls (the owner: "way too many pill
icons... it looks so pilly"). A rounded-rectangle language already exists in the codebase (the dark
button language uses `--radius-rect: 10px`).

**Change (L10).** Sweep the rail and control surfaces from pill (fully rounded) to rounded
rectangles with the curved-edge radius across the **admin panel, the app page and the project
viewer** - one language everywhere - without removing any control or changing behaviour.

**Files:** `admin.html` (its inline `<style>` or the shared sheet), `css/mmgr.css` (admin-scoped
rules), `sw.js` bump.

**Prove it.** CSSOM probe on the admin page confirming the new radius on the swept controls; no
control or handler removed (the action-map audit stays green). Contrast still AA in both themes.

### Item 9 - Navigation: separate Administrate and Calculator groups

**Current, verified in code.** The launcher rail (`app.html` `#db-nav`) has four groups: Overview,
Projects, Cloud, Customize. Admin panel and Create your own sit inside Projects; Build Cost
Calculator sits inside Projects.

**Change (L8).** Give the admin entries their own group named **Administrate**, and put the
calculator under a **Tools** heading. Final order:
Overview / Projects / Cloud / **Administrate** / **Tools** / Customize.

**Files:** `app.html` (rail markup only - no inline script, no CSP change), possibly
`js/mmgr-cloud-dash.js` if it renders any of these rows, `sw.js` bump.

**Prove it.** Browser probe: the rail renders the new groups in order with all icons painted;
re-baseline the nav-group assertions in `tools/qa-dashboard-spec.cjs`.

### Item 10 - Marketing footer: Pricing and Refund policy links

**Current.** `privacy.html` and `refund.html` exist; `pricing.html` exists. The footer does not
surface all three consistently (the estimator plan already noted the sitemap omits `/pricing` and
`/refund`).

**Change.** Add Pricing and Refund policy links to the marketing footer so they are discoverable
without knowing the URLs. Confirm the pricing page states the actual prices for every tier (it
already lists estimator $49.99 / 6 months and the monthly tiers) and links its own refund policy.
Nothing about Paddle, the webhook, or subscription state changes.

**Files:** the marketing page footers (`index/about/features/contact/pricing/reviews.html`),
`css/marketing.css` if a footer rule is needed, `sitemap.xml` (add `/pricing` and `/refund`),
`sw.js` bump.

**Prove it.** `qa-marketing` / `tools/qa-marketing-layout.cjs` footer assertions; a browser click
test that each footer link resolves 200 (local `serve.cjs` has no extension rewrite, so assert the
`.html` target on disk and the clean URL in production).

### Item 11 - Confirmation / verify screen polish

**Current.** `verify.html` (email confirmation landing) and `reset.html` exist with their own
`.auth-*` block in `css/marketing.css` and external controllers `js/verify.js` / `js/reset.js`. The
owner reports the confirmation screen "wasn't looking good" when last checked.

**Change.** A visual polish pass on `verify.html` (and `reset.html` for parity) to the marketing
card language: spacing, states (loading / success / error / sent), contrast in both themes, reduced
motion. No flow change, no new endpoint.

**Files:** `verify.html`, `reset.html`, `css/marketing.css`, `sw.js` bump.

**Prove it.** Browser walk of every state (no token, bogus token, success, recovery form) with zero
console errors; existing `qa-email-auth` gates stay green.

### Item 12 - Subscription and RBAC end-to-end verification

**Current, verified in code.** `js/app/entitlements.js` exposes `aiAssistant`, `unlimitedCloud`,
`estimatorAccess`, `rbacAccess`, `rbacUnlimited`, with `unlimitedCloud` now fixed to contractor+.
The admin Codes modal has named team members with roles, backed by `/api/cloud/projects/:id/team`.
Admin "Manage subscription" cancels at the end of the paid period (v376, and W2 added the typed
confirmation).

**Change (L11).** Two parts.

1. **Correct the cloud cap server-side.** The rule: free = exactly 1 cloud project; any paid tier
   (including `estimator`) = unlimited cloud projects; offline/local projects are unlimited on
   every tier regardless of sign-in. Today `src/billing.js` returns the free cap for every tier and
   the free cap default is 8, so this is a real change. Set the free cap to 1 and give every paid
   tier an unlimited server-side cap. Keep the client gate honest: `js/app/entitlements.js`'s
   `unlimitedCloud()` must return true for **every paid tier including `estimator`** - the estimator
   plan's earlier fix deliberately excluded it because the server cap was uniform; with L11 they now
   agree.
2. **Verify end to end.** When the owner subscribes to the top tier, drive each gate and record what
   actually happens: unlimited cloud projects, the free tier refused a second cloud project,
   inviting a person outside the team and assigning a role, section scope, AI, and cancel.

**Files:** `src/billing.js`, `js/app/entitlements.js`, `test/billing.test.mjs`, and `sw.js` if a
served asset changes.

**Prove it.** `tools/qa-cloud-*.cjs` team/RBAC suites, plus a live signed-in walk on the top tier
with the results recorded in the tracker.

### Item 13 - Keep the working cancel

The typed-confirmation cancel (W2) is live and correct. Do not break it. It is a regression guard,
not a work item.

### Item 14 - Prove the free key pool answers from a real key

**Current.** W4/W5 shipped the pool, but the estimator plan records that no real Google key has
ever answered through it, because that needs a signed-in session and no local secret exists to mint
one.

**Change.** No new code expected. Have the owner sign in and ask one question on the calculator
assistant or the AI window; the reply should carry `source: free-pool`. If it does not, that is a
defect to root-cause here.

**Prove it.** The live reply's source field, recorded.

---

## 2. WAVE ORDER

Each wave is atomic: build, gates green, `sw.js` bumped where a served asset changed, then the next.
The owner can stop after any wave.

| Wave | Scope | Independent? | Exit gate |
|---|---|---|---|
| **W0** | Owner approves this plan and answers Q1-Q4. No code. | - | Owner sign-off |
| **W1** | Item 1 (icon restore everywhere, plus confirm and fix a collapsed rail if present). | Yes | Real-browser back-nav restores icons; `npm run verify` green |
| **W2** | Item 3 (sign-in: remove marketing triggers, route the app to `/signin`, polish+hide the sheet). | Yes | `qa-marketing.cjs` re-baselined; `/signin` round trip green |
| **W3** | Item 2 (perf probe fix + measure and fix the starfield not painting). | Yes | Perf-off shows the canvas, perf-on tears it down, lag hint fires once |
| **W4** | Item 9 + Item 8 + Item 7 (nav groups, admin rounded rectangles, loading-skeleton polish). Small UI waves, may split. | Yes | Browser + CSSOM probes; dashboard-spec re-baselined |
| **W5** | Item 10 + Item 11 (footer links + sitemap; verify/reset polish). | Yes | Marketing gates + browser walks |
| **W6a** | Item 4.1-4.2 (cap 5, no up-front number, signed-in only). | Yes | Unit tests + calc-ai probes |
| **W6b** | Item 4.3-4.4 (bigger window, history, identity, file upload). | W6a | Browser probes |
| **W6c** | Item 4.5-4.6 (rate-sheet grounding + both output paths). | W6a | Browser probes + populate/export round trip |
| **W7** | Item 12 (cloud cap rule server + client, then RBAC/subscription verification) + Item 14 (real pool proof). | W0; owner's subscription for the live half | Free tier refused a 2nd cloud project; any paid tier unlimited; RBAC/team walk recorded; pool reply carries `source: free-pool` |

Anchoring the first four waves on the four defects the owner can see (icons, sign-in, starfield,
pills/nav) means the visible wins land before the larger AI rebuild.

---

## 3. DECISION LOG (Q1-Q4 resolved)

All four questions from the first draft are answered; the answers are folded into items 2, 3, 8, 9
and 12 and recorded as L8-L11 in section 0. No open questions remain for this plan. If a new
ambiguity appears during a wave, it is raised before that wave edits a served file.

---

## 4. OUT OF SCOPE (deliberate)

- No second AI relay endpoint; the pool stays a rung on `/api/ai/chat`.
- No hardcoded model ids; the verified-live ladder stays the source of truth.
- No redesign of `signin.html`; it is connected, not rebuilt.
- No hero animation loop (cancelled by L4).
- No change to Paddle, the webhook, or subscription state.
- No change to the offline-first contract: every new network path is on the AI surface only.
- No `estimate.html` iframe of the calculator (the older directive's iframe plan stays rejected).
- No relocation of the calculator page; it is not parked.

---

## 5. STANDING GATES (apply to every wave)

- `npm run verify` exits 0 (CSP hashes, service-worker cache, hidden rules, skills, exports).
- Any inline-script edit regenerates `INLINE_SCRIPT_HASHES` in `worker.js` and `serve.cjs`, and
  `serve.cjs` is restarted before browser checks (a running server serves a stale CSP).
- `node build.js` after any `js/` change; never trust a stale bundle.
- `sw.js` cache version bumped whenever a served asset changes.
- Emoji scan clean; no emoji in any served page or rendered string.
- Conventional Commits, no AI attribution footer.
- Re-baseline a harness in the SAME commit that changes the contract it asserts, and register any
  new harness in `docs/CI-TEST-COVERAGE.md` and `ci.yml` (or the extended workflow).
