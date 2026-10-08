# CI test coverage registry

Every QA / verification harness in this repo, what it covers, and where it runs.
**Rule:** `tools/verify-test-registry.cjs` fails CI if any `qa-*.cjs`,
`verify-*.cjs` or `audit-*.cjs` file in the repo root or `tools/` is missing from
this document. Adding a harness without registering it here is a red build, so a
battery can never drift silently out of date again (that is exactly how the
`qa-full` / `qa-ai` / `qa-v11` / `qa-p1` suites sat stale for weeks while every
gate stayed green — they were never wired into CI at all).

Status tokens used below: **CI** (runs on every push), **EXTENDED** (runs in
`.github/workflows/extended-qa.yml` on a schedule / on demand — green but too slow
or too niche for the deploy gate), **TRIAGE** (known-drifting, findings listed),
**MANUAL** (needs live credentials or a human, never automated).

## Tiers inside ci.yml

- **Static** — CSP hashes, inline-JS parse, service-worker cache, `[hidden]`
  wiring, skills lock, render exports, CSS integrity.
- **T1** — pure-static QA gates (no browser, no server).
- **T2** — `wrangler dev` on :8787 (D1/R2 emulation), including the page-health
  sweep against the real Worker.
- **T3** — headless-Chrome suites that spawn their own wrangler.
- **T4** — headless-Chrome batteries against the static server (`serve.cjs`, :8765).

## Static / build guards

| Harness | Status | Covers |
|---|---|---|
| `tools/verify-csp-hashes.cjs` | CI | every inline `<script>` hash in worker.js + serve.cjs matches disk |
| `tools/verify-inline-js.cjs` | CI | every inline script parses as JS (catches CSS-in-script mis-pastes) |
| `tools/verify-js-syntax.cjs` | CI | every source script under js/ + src/ (plus worker.js, serve.cjs, sw.js, build.js) parses. Added 2026-10-02 after js/calculator-page.js shipped with unquoted hyphenated keys (`plumbing-pipe:`), a hard SyntaxError that killed the whole calculator page: build.js does NOT parse it (calculator.html loads it standalone, unbundled) and no other gate did either. Verified to catch the exact original bug and to exit 0 once fixed |
| `tools/verify-sw-cache.cjs` | CI | service-worker SHELL cache version + membership |
| `tools/verify-hidden-attr.cjs` | CI | `[hidden]` elements are not out-rendered by a `display` rule |
| `tools/verify-skills-lock.cjs` | CI | `.agents/skills` hashes match `skills-lock.json` |
| `tools/verify-render-exports.cjs` | CI | every module export has a `ns.X` wrapper |
| `tools/verify-css-integrity.cjs` | CI | no stray comment-closer in CSS; every source rule survives into dist |
| `tools/verify-a11y-labels.cjs` | CI | Waves 8.5 + 8.6: every served page's fields and icon-only controls carry an accessible name, every `label[for]` target resolves to a real id, and no page carries duplicate ids (static markup gate for screen-reader wiring) |
| `tools/verify-eslint.cjs` | CI | Wave 8.7 ESLint lint gate — runs the resolved local binary with `--format json` and fails on a crash, unparseable output, **0 files linted**, any severity-2 error, or warnings above the frozen ceiling (4600; currently 4522 across 233 files). Rewritten 2026-10-07: v1 used `--format unix` (removed in ESLint 10) and decided pass/fail by scanning the text for "error"/"warning", which ESLint's own failure message does not contain — it could not fail |
| `tools/verify-prettier.cjs` | CI | Wave 8.7 Prettier format gate — trusts Prettier's exit code (0/1/2), strips ANSI, requires the `Checking formatting...` banner (guards the "matched nothing" silent pass) and requires `.prettierignore` to exist, and names every drifted file. Rewritten 2026-10-07: v1's regex expected `"<count>  <path>"` but Prettier 3 prints `[warn] <path>` on stderr — it could not fail. Failures are also published as GitHub Actions annotations, because downloading job logs needs repository admin rights (the API answers 403) and a gate whose reason cannot be read back is undiagnosable. First CI run of the rewritten gate went red on a generated artifact, not on source: the gitleaks step writes `gitleaks-results.sarif` into the workspace BEFORE the gate, Prettier infers the JSON parser for `.sarif`, and the file never exists locally — `.prettierignore` now excludes `*.sarif` / `gitleaks-*` |
| `test/billing.test.mjs` | CI | `npm test` (`node --test test/*.test.mjs`) — 10 node:test cases over the billing helpers: free-project cap override + fallback, and tier derivation from the Paddle price ID (enterprise/company/contractor, unrecognised → contractor, never a downgrade, missing price/env). Added to the CI step list 2026-10-07: the script existed and the tests passed, but the composite `npm run verify` chain never called it and CI runs its steps individually, so nothing executed them |

## T1 — static QA gates

| Harness | Status | Covers |
|---|---|---|
| `tools/qa-dashboard-spec.cjs` | CI | dashboard tokens, markup, icons, contrast (76 checks) |
| `tools/qa-changelog-diffs.cjs` | CI | changelog before/after diff rendering + escaping |
| `tools/qa-paddle-csp.cjs` | EXTENDED | Paddle checkout CSP + the `_ptxn` dead-checkout regression (29 checks: 24 static, 5 live-browser). CSP: `buy.paddle.com` in frame-src, paddle styles allowed, hash gate stays strict, pricing-scoped only. `_ptxn`: the source no longer strips it unconditionally, `handlePaddleReturn` never names it, module scope initialises Paddle BEFORE the return handler, the SHIPPED bundle carries no 4-key strip, and a live browser proves `?_ptxn=` survives a real page load (the exact symptom of the 2026-10-05 dead checkout). Static arm runs in CI; the live-browser arm needs the deployed site (and targets `/pricing.html` on a local origin, which serve.cjs actually serves) |
| `tools/qa-auth-limits.cjs` | CI | auth hardening: 1 password reset per email per day, escalating failed-login ladder (5 fails = 2h, doubling, capped 24h), generic account-collision message that names no provider, reset endpoint still cannot enumerate accounts (E11) |
| `tools/qa-hero-cards.cjs` | EXTENDED | hero preview cards: numbered panel headers, bar tooltips on hover AND keyboard focus, CPI glow, pulsing assistant steps (CSS-counter numbered, no glyphs), cards stay SOLID, all animation dies under prefers-reduced-motion, light+dark at 1280 and 390 |
| `tools/verify-marketing-markup.cjs` | CI | static rail + canvas guard (rewritten 2026-10-07): no `<li>` nested inside a `<li>` in the rail, exactly 7 big dots, no `.tooltip`/`.dot-label`/`.rail-line`/`.dot-group`, `.dot` must declare a display that lets width/height apply with major dots >= 12px and minor dots <= 8px, `<main>` must be full-bleed (no margin, max-width=none, width=100%), and `js/marketing.js` must declare `MINORS_PER_GAP`. Runs in `npm run verify`, so on every push rather than weekly |
| `tools/qa-marketing-layout.cjs` | EXTENDED | marketing canvas + dot rail live-browser gate (2026-10-07): every marketing page is full-bleed at 6 desktop sizes + phone + mid (<main> spans the window, every band edge-to-edge, heading inset >= 24px desktop / 14px phone), the homepage rail alternates big-small-small-big... with 7 big + 12 small dots, no labels/tooltips/lines, rail height <= 340px, clears the reading column by >= 12px, is hidden at 1024px, exactly one dot is active at every scroll position and it travels forward through all 19 dots, and the field guide has no sideways scroll. Needs a served site (QA_BASE), so it runs in extended-qa, not `npm run verify` |
| `tools/qa-spy-nav.cjs` | EXTENDED | marketing dot rail coverage delegated to `tools/qa-marketing-layout.cjs` (2026-10-07). Kept alive for the hero-fold and nav-hugs-brand assertions only: the hero puts its headline, sub-headline and Get Started button in the first screen at 1440x900 and 1280x800 with an h1 >= 44px and line-height >= 1.1; the nav hugs the brand. The rail's big-dot count, nesting, active-dot tracking, small-dot generation and 96px-gutter assertions moved to `qa-marketing-layout.cjs` which measures them at real desktop sizes |
| `tools/qa-signin-page.cjs` | EXTENDED | standalone /signin page: two doors (Google above, email disclosure below), legal below the action, OPEN-REDIRECT DEFENCE (10 hostile ?next= values rejected, 4 same-site paths honoured), disclosure is a real ARIA pattern, glass card stays legible (measured WCAG contrast), zero emoji, no overflow at 390 |
| `tools/qa-scurve.cjs` | EXTENDED | EVM S-curve draw-on animation: dasharray covers the real path length (a short dash would leave the curve INVISIBLE), resting dashoffset 0 so non-SMIL renderers show a finished curve, fill=freeze on both, and the animation observed actually moving and settling at 0 in a real browser |
| `tools/qa-ai-relay.cjs` | CI | AI provider routing, auth, headers, tool gate, rate limits |
| `tools/verify-report-issue.cjs` | CI | report-issue payload excludes PII/budget (27 checks) |
| `tools/verify-dynamic-labels.cjs` | CI | JS-rendered table inputs get derived accessible names |
| `tools/verify-delegate-gate.cjs` | CI | monolith shims stay shims; no duplicate implementations |
| `tools/verify-owner-gate.cjs` | CI | session-marker never becomes a fake owner code; sign-in invalidates ownership memos; state-aware owner-gate message (12 checks) |
| `tools/verify-render-exports.cjs` | CI | (also listed above) render/API export completeness |
| `tools/verify-ai-import.cjs` | EXTENDED | AI-assisted import seams (12 checks) |
| `tools/verify-date-wiring.cjs` | EXTENDED | date-change wiring + re-sync offer |
| `tools/verify-contrast.cjs` | EXTENDED | WCAG 2.2 AA contrast pairs (18 pairs) |
| `tools/audit-action-map.cjs` | EXTENDED | every `data-action` in markup has a handler (360 keys) |

## T2 — wrangler dev (:8787)

| Harness | Status | Covers |
|---|---|---|
| `tools/qa-cloud-phase1.cjs` | CI | cloud create/save/load/meta, owner codes, codes never logged (29/29) |
| `tools/qa-cloud-phase2.cjs` | CI | editor codes, section scope, changelog + revert (85/85) |
| `tools/qa-cloud-codes-delete.cjs` | CI | code escrow + purge/restore after delete (23/23) |
| `tools/qa-cloud-import.cjs` | CI | CLI import ledger + id mapping (35/35) |
| `tools/qa-market-features.cjs` | CI | dashboard/market feature aggregations (61/61) |
| `tools/verify-controls-admin.cjs` | CI | Controls drawer surfaces + admin copy/labels (11/11) |
| `tools/qa-health-sweep.cjs` | CI | every served page: console errors, exceptions, 4xx/5xx, CSP violations, live-vs-disk CSP hash drift, emoji, leaked raw values, and browser-verified CSS rule coverage |
| `tools/qa-ai-badge-e2e.cjs` | CI | AI badge end-to-end (API phase) |
| `tools/qa-offline-copies.cjs` | CI | offline-copy records + countdown (23/23) |
| `tools/qa-prefs-roundtrip.cjs` | CI | theme/UI prefs round-trip across devices (15/15 API gates) |
| `tools/qa-presence.cjs` | CI | presence Durable Object roster (11/11) |
| `tools/qa-rank9-api.cjs` | CI | owner-gated API projections + webhooks (31/31) |
| `tools/qa-reviews.cjs` | CI | review queue accept/reject + changelog + Turnstile bot gate (41/41; T1-T8 cover the public sitekey/secret split, refuse-without-token, refuse-on-bogus-token, fail-CLOSED when siteverify errors, accept-on-valid-token, and no-rows-written on every refusal) |
| `tools/qa-t9-adoption.cjs` | CI | adoption/discontinue flows (27/27) |
| `tools/qa-email-auth.cjs` | CI | email/password auth, reset, verify + billing tier across BOTH providers (83/83): LS phases B1-B6 unchanged, Paddle phase 2b PD1-PD7 (provider seam: status provider paddle, checkout honest 502 on fake key, Paddle-Signature ts/h1 verify + replay + tamper gates, cap still gates, one-time transaction.completed grant) |
| `tools/qa-team-rbac.cjs` | CI | named team members / RBAC (19/19): invite, invite email accept link, list, contractor 2nd-member 402 member_limit upgradeRequired company, single-use accept token, role+scope update (scope filtered to known sections), active manager loads project via team auth (Wave 7), soft revoke excluded from list, dead revoked token, revoked member 403 on load, non-owner 403, unknown-address 404, company tier unlocks unlimited, unknown role 400 |
| `tools/verify-cloud-autosave-signin.cjs` | CI | cloud autosave + sign-in queue/resume + review-accept failure surfaces incl. missing-#cloud-status toast fallback (12/12) |

## T3 — headless Chrome, own wrangler

| Harness | Status | Covers |
|---|---|---|
| `tools/qa-client-codes.cjs` | CI | client-code entry -> project client scope, soft delete |
| `tools/qa-api-keys.cjs` | CI | scoped API key read + review-queue writes, MCP PATH-A |
| `tools/qa-sync-bond.cjs` | CI | file trip keeps the cloud twin link; re-sync merge (20/20) |
| `tools/qa-mcp-live-e2e.cjs` | EXTENDED | MCP propose -> owner review Accept end-to-end in a real browser: scoped key + PATH-A, queue gating, never-auto-apply, zero-diff accept warns (v318), revoke/delete hygiene (20 gates). Runs nightly + extended battery; self-contained (own wrangler/Chrome, never a live site) |
| `tools/qa-engine-parity.cjs` | EXTENDED | ENGINE-PARITY LAW (owner 2026-09-27): the REAL served schedule engine must catch hand-authored/MCP-seeded schedule fiction - seeded dependency violation corrected to the exact engine date in the served page, MCP reads (get_tasks vs /load predecessors contract) and apply_changes remediation queueing asserted. Self-contained (own wrangler + Chrome); born green 12/12 |

## T4 — headless Chrome against serve.cjs (:8765)

| Harness | Status | Covers |
|---|---|---|
| `qa-full.cjs` | CI | the full gap-list battery incl. cloud, readonly scope, MCP (181/181) |
| `qa-ai.cjs` | CI | AI tiers: local engine, vault key, relay-first ladder, presets (green) |
| `qa-v11.cjs` | CI | v11 feature battery: flags, imports, readonly gating (green) |
| `qa-p1.cjs` | CI | P1 core battery: theme/crosshair persistence, kanban, cascade |
| `tools/verify-theme-cdp.cjs` | CI | theme persistence, state fallback, launcher/admin/view-only, OS follow (7/7) |
| `qa-p0.cjs` | EXTENDED | P0 smoke battery |
| `qa-sync.cjs` | EXTENDED | sync/merge battery |
| `qa-r3.cjs` | EXTENDED | R3 battery |
| `qa-restore-verify.cjs` | EXTENDED | backup restore (14/14) |
| `qa-obs-verify.cjs` | EXTENDED | observability/error log (14/14) |
| `qa-typing.cjs` | EXTENDED | typing/focus retention in dynamic fields |
| `qa-rhythm.cjs` | EXTENDED | schedule rhythm/cascade |
| `qa-voice.cjs` | EXTENDED | voice capture seams |
| `qa-focus.cjs` | EXTENDED | focus retention across re-render (twin fields, date commit) |
| `qa-marketing.cjs` | EXTENDED | marketing pages, zero console errors (20/20) |
| `qa-pwa.cjs` | EXTENDED | manifest + service worker registration, offline CRUD |
| `tools/qa-calculator-page.cjs` | CI | Build Cost Calculator page (work items, quantities, tax/currency, history) + parallel-aware assistant + F4/F4b rate freedom + exact recall + the 2026-09-29/10-01 waves + plan-v2 Phases 1-2 + **JIC 2025-2027 rate book + the all-in / per-day pricing basis + **the 2026-10-02 owner wave: Jamaican defaults, rate-book popup, no-tax, clean exports (217/217 gates)**** - RB1-RB8 lock the rate-book card contract: top-bar link with i-book icon, open/dialog, all 100 JIC line items across 11 groups, the copy's own line-item count matching the rows it describes, the metric/imperial toggle, and close leaving nothing behind. RB6 caught a REAL bug: `showRateBookCard` was a toggle, so the unit buttons closed the card instead of switching units (fixed by splitting render from toggle). JIC re-baselines: FM4 8 groups, FM5/FM6 43 picker trades incl. the 5 JIC trades, EV1/EV3 9 JIC soil rates (total still 1600), NV3 9 JIC masonry/soil/carpentry rates (formwork still 1100) AB1-AB8 lock the all-in basis: ONE combined `Work rate (all-in)` row on screen AND CSV with NO Materials/Labor pair anywhere (D3), all-in BEATS piece pricing and labour-only rather than erroring (AB5), the published-rate note fires only on book-filled money and drops when the user types (AB2/AB3), an all-in line recalls to an identical total (AB6), and AB7 is the ship-side test that would have caught the silent skip - the shipped Jamaica book imports 100 all-in rates with skipped 0 / badKeys 0 plus a checksum round-trip. AB8 is E1 currency honesty: with the JMD book active and no JMD rate set the field stays EMPTY and the note names JMD. DB1-DB6 lock the per-day basis: days x rate is ONE labour total (never itemised per person), material rides alongside it, quarter-days land exactly, blank/zero/negative/non-numeric/absurd days all fall back to per-unit without NaN, employer on-costs still apply to a day rate (DB4), the finish multiplier scales material ONLY and never the typed day rate (DB2, D8), and DB5 proves the 'not recommended' note appears only on the confirmed finish list and never blocks. **2026-10-02 owner wave re-baselines (each traced to a real behaviour change, not a loosened test):** JMD + Jamaica are the defaults and the shipped book is selected on first visit only (the JMD starting rate is seeded once and labelled, so the FX gates pin USD to read raw model figures); C2b no longer expects the unconverted-USD banner and **new C2c** asserts the honest empty-field note still fires when the FX table is genuinely empty; RB1 expects the short 'Rate book' label, RB2 the aria-modal popup titled 'JIC rates 2025-2027', RB4 that the count/source blurb is GONE; **new PC1** locks the special-case piece opt-in (blockwall/tile/paint hide it, drywall keeps it); TX1 and E2 follow the new tax rows and the resolved JMD rates. Two REAL defects were found and fixed by this harness: `renderBooks` never set `sel.value` (the rate-book button looked dead), and with the book default-selected a prefilled all-in rate priced lines even on the 'measured' basis, making that basis unreachable - the chooser is now authoritative. The PL0-PL7 family was made non-flaky by polling for the project-page boot instead of racing a fixed 3.2s sleep. **NEW NC1 locks the owner's final 'we are not a converter - no negotiable' ruling:** nothing seeds an exchange rate, the JIC book's own JMD all-in rate fills #calc-allin with no conversion involved, the document reads J$ with NO USD banner over it, and a trade the book does not cover keeps the honest empty field + JMD note rather than borrowing a converted figure. Getting there surfaced TWO more real defects: with the book selected by default and the basis still 'measured', every line fell back to the USD planning-grade model and printed those figures under a Jamaican estimate (the relabelled-USD defect E1 exists to prevent) - so the first-visit install now puts the basis on the book that is actually selected; and the E1 unconverted flag fired on all-in lines too, printing a false 'these are US dollars' banner over a correct Jamaican total - an all-in line charges only allInCost, which is already in the book's own currency, so it is exempt. Split-path gates (IN2/IN3/SX1-SX4) and the playwright M1 mobile gate now pin the basis and measure the rate control that is actually on screen, exactly as they already pin currency. **RB9-RB12 were added after the post-deploy production smoke found the rate-book popup was INVISIBLE in production while every earlier gate passed:** the CSS rule that hides the popup while printing sat outside any `@media print`, so `display:none !important` applied on screen and the popup rendered 0x0 - and RB1-RB8 all passed anyway, because they asserted the popup was PRESENT (role, aria-modal, title, 100 rows, a Close button), never that it PAINTED. RB9 now measures the open popup's box and computed display, RB10 asserts focus lands inside it, RB11 asserts Escape closes it and releases the body scroll lock, and RB12 asserts the top-bar toggle leaves no leaked state. Each was proven to have teeth by re-introducing the defect and watching the gate fail (RB9 caught `display:"none"`, 0x0, panel 0x0). - serve.cjs battery |
| `tools/qa-calc-trade-coverage.cjs` | CI | Trade coverage walk (owner research round 2, 2026-10-01): every one of the 38 picker trades driven through the real UI - family flip + persistence, basis label, dims, price, piece/bill add, CSV, mobile 390 - plus a console-clean sweep (signed-out /api/ 4xx classified as expected probe noise) - 78 gates across 38 trades (Phase 2 auto-walks formwork, rebar-size, stirrups, fabric-mesh, concrete-labour), serve.cjs battery |
| `tools/qa-calc-golden.cjs` | CI | Golden-case engine gate (plan v2 Phase 0 / E5, 2026-10-01): every hand-calculated case in tools/calc-golden-cases.json (33 picker trades + cross-cutting: imperial, openings-before-waste, piece pricing, instances, quality, tax, on-costs, overhead, equipment, rate freedom + Phase 1: variant conversion, labour mode, rate-entry unit factors + Phase 2: concrete-chain cases (formwork variants incl. imperial sq-ft entry, rebar per-lb, stirrups per-dozen, mesh per-yd2, clay-deep dig, 8in block, labour-only pour) run through the real page engine in a browser - a drift over 1 currency unit rejects the build and the unit-slip guard must flag NOTHING on any case - 75 gates across 72 cases (+14 all-in / per-day cases: all-in metric, all-in on a per-yd2 trade, all-in beats piece, all-in beats labour-only, overhead+tax on a book-filled line, book-filled vs typed, blank-inert, per-day, per-day + material, per-day on-costs, per-day premium-does-not-scale, quarter-days, invalid-days fallback; one hand-calculated expected was corrected against the engine during the wave: tax on 1600+10% overhead is 2024, not 1972), serve.cjs battery |
| `tools/qa-calc-workspace.cjs` | CI | Calc workspace route (client-docs W5 2026-10-01): session-gated GET/PUT /api/calc/workspace against local wrangler dev - signed-out 403, PUT ok+savedAt, GET round-trip, 4MB cap 413, non-JSON 400, plan:'free' rides (6/6), own wrangler on QA_PORT |
| `tools/qa-calc-playwright-audit.cjs` | CI | Playwright UX audit of both calculators (owner 2026-09-28 directive): 3 viewports x layout/focus/live-recompute, light+dark themes, exact-recall fidelity through real UI events, mobile reachability + icon-restore (bfcache sprite re-resolution after persisted pageshow, owner 2026-09-30) + client-docs gates (M13 real logo upload, M14 brand/companions mobile contract, T5 tour final-card centering) - 40 gates, serve.cjs battery | M1 now measures the rate control that is actually on screen for the chosen basis (the all-in field under the JIC book, the material field otherwise) - it previously measured #calc-rate-mat unconditionally, which is legitimately hidden on the all-in basis.
| `tools/qa-calculator.cjs` | EXTENDED | floating calculator (27/27) |
| `tools/qa-view-mode.cjs` | EXTENDED | view-mode/deck gates |
| `tools/qa-legal-links.cjs` | EXTENDED | legal link targets (7/7) |
| `tools/qa-pool-ui.cjs` | EXTENDED | resource pool UI (6/6) |
| `tools/qa-cloud-pool.cjs` | EXTENDED | cloud resource pool (19/19) |
| `tools/qa-live-pool.cjs` | EXTENDED | live pool gates (17/17) |
| `tools/qa-date-wiring.cjs` | EXTENDED | date wiring, parallel groups, lead-time watcher (32/32) |
| `tools/verify-spy-cdp.cjs` | EXTENDED | marketing dot rail, driven over CDP against the SERVED page - it previously navigated to `file:///C:/Users/<user>/Downloads/mymanager-fixed/index.html`, a path that exists on one machine only, so the step could never pass on CI. Prints spy state + scroll positions for diagnosis; `qa-spy-nav.cjs` is the one that asserts |
| `tools/verify-gates-cdp.cjs` | EXTENDED | app/admin gate screens render |
| `tools/verify-gates-themes.cjs` | EXTENDED | gate screens in every theme state |
| `tools/verify-glass-preview-cdp.cjs` | EXTENDED | glass preview surfaces |

## TRIAGE — known-drifting, findings recorded (next wave)

| Harness | Status | Findings (2026-10-06) |
|---|---|---|
| `qa-stress.cjs` | TRIAGE | **D02 RESOLVED 2026-10-06 (Wave 8.1)**: `restoreFromJournal()` now compares the journal's OWN record instead of localStorage `updatedAt` — the crash-recovery bug that dropped pre-kill edits is fixed in `js/mmgr-state.js`. P04: ambiguous-risk rendering assertion still needs re-baselining before the harness can leave TRIAGE. |
| `qa-ai-visual.cjs` | TRIAGE | AI window does not open (4 checks) — same `Entitlements.aiAssistant()` signed-in gate already seamed in `qa-full`/`qa-ai`; this harness needs the same seam applied to its checks. |
| `qa-glass.cjs` | EXTENDED | dual-engine glass lifecycle, 14 gates, host page app.html (TRIAGE RESOLVED 2026-09-29: seed-test.html redirects into project.html, where activate() excludes glass by design — the "headless can't boot" mystery was the page-exclusion guard, not SwiftShader/GPU; mocked-THREE lifecycle is deterministic). |
| `qa-glass-visual.cjs` | TRIAGE | depends on the premium canvas existing (4 checks) — the qa-glass host-page fix (app.html instead of seed-test.html) likely unblocks it too; needs its own re-baseline before it can leave TRIAGE. |
| `qa-oauth.cjs` | TRIAGE | 3 checks assume the old unlock flow; local-first means a locally-owned project unlocks with no modal (`qa-full` 70h/70i define the current contract), and the header sign-in bar moved. |
| `tools/qa-ai-polish.cjs` | TRIAGE | 2 checks read the clipboard back, which headless Chrome refuses (its own env probe fails first); the app's copy path is sound (`storedMatches`/`capturedExact` true). Make the clipboard arm a SKIP when the env probe fails. |

## MANUAL — never automated

| Harness | Status | Why |
|---|---|---|
| `qa-drive-smoke.cjs` | MANUAL | needs a live Google Drive session; parks on its watchdog after the offline arms pass |
| `qa-admin-recovery.cjs` | MANUAL | points a mock mail server at the recovery flow; run per release |
| `tools/qa-admin-code-escrow.cjs` | MANUAL | admin-code escrow round trip needs an account-scoped run |

## Verification commands

```bash
node build.js             # dist must exist before the CSS integrity arm
npm run verify            # static gates (incl. verify:css)
  verify:a11y   tools/verify-a11y-labels.cjs   19/19 pages clean (Waves 8.5 + 8.6 — session 15)
  verify:eslint tools/verify-eslint.cjs       0 errors, warnings must stay under the 4600 ceiling (Wave 8.7)
  verify:prettier tools/verify-prettier.cjs    every matched source file matches Prettier style (Wave 8.7)
npm test                                      10 node:test billing cases (Wave 8.11)
  verify:css    tools/verify-css-integrity.cjs
node tools/qa-health-sweep.cjs http://127.0.0.1:8787   # page health vs the Worker
node tools/verify-test-registry.cjs                    # this document stays complete
```
