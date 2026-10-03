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

## T1 — static QA gates

| Harness | Status | Covers |
|---|---|---|
| `tools/qa-dashboard-spec.cjs` | CI | dashboard tokens, markup, icons, contrast (76 checks) |
| `tools/qa-changelog-diffs.cjs` | CI | changelog before/after diff rendering + escaping |
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
| `tools/qa-calculator-page.cjs` | CI | Build Cost Calculator page (work items, quantities, tax/currency, history) + parallel-aware assistant + F4/F4b rate freedom + exact recall + the 2026-09-29/10-01 waves + plan-v2 Phases 1-2 + **JIC 2025-2027 rate book + the all-in / per-day pricing basis + **the 2026-10-02 owner wave: Jamaican defaults, rate-book popup, no-tax, clean exports (212/212 gates)**** - RB1-RB8 lock the rate-book card contract: top-bar link with i-book icon, open/dialog, all 100 JIC line items across 11 groups, the copy's own line-item count matching the rows it describes, the metric/imperial toggle, and close leaving nothing behind. RB6 caught a REAL bug: `showRateBookCard` was a toggle, so the unit buttons closed the card instead of switching units (fixed by splitting render from toggle). JIC re-baselines: FM4 8 groups, FM5/FM6 43 picker trades incl. the 5 JIC trades, EV1/EV3 9 JIC soil rates (total still 1600), NV3 9 JIC masonry/soil/carpentry rates (formwork still 1100) AB1-AB8 lock the all-in basis: ONE combined `Work rate (all-in)` row on screen AND CSV with NO Materials/Labor pair anywhere (D3), all-in BEATS piece pricing and labour-only rather than erroring (AB5), the published-rate note fires only on book-filled money and drops when the user types (AB2/AB3), an all-in line recalls to an identical total (AB6), and AB7 is the ship-side test that would have caught the silent skip - the shipped Jamaica book imports 100 all-in rates with skipped 0 / badKeys 0 plus a checksum round-trip. AB8 is E1 currency honesty: with the JMD book active and no JMD rate set the field stays EMPTY and the note names JMD. DB1-DB6 lock the per-day basis: days x rate is ONE labour total (never itemised per person), material rides alongside it, quarter-days land exactly, blank/zero/negative/non-numeric/absurd days all fall back to per-unit without NaN, employer on-costs still apply to a day rate (DB4), the finish multiplier scales material ONLY and never the typed day rate (DB2, D8), and DB5 proves the 'not recommended' note appears only on the confirmed finish list and never blocks. **2026-10-02 owner wave re-baselines (each traced to a real behaviour change, not a loosened test):** JMD + Jamaica are the defaults and the shipped book is selected on first visit only (the JMD starting rate is seeded once and labelled, so the FX gates pin USD to read raw model figures); C2b no longer expects the unconverted-USD banner and **new C2c** asserts the honest empty-field note still fires when the FX table is genuinely empty; RB1 expects the short 'Rate book' label, RB2 the aria-modal popup titled 'JIC rates 2025-2027', RB4 that the count/source blurb is GONE; **new PC1** locks the special-case piece opt-in (blockwall/tile/paint hide it, drywall keeps it); TX1 and E2 follow the new tax rows and the resolved JMD rates. Two REAL defects were found and fixed by this harness: `renderBooks` never set `sel.value` (the rate-book button looked dead), and with the book default-selected a prefilled all-in rate priced lines even on the 'measured' basis, making that basis unreachable - the chooser is now authoritative. The PL0-PL7 family was made non-flaky by polling for the project-page boot instead of racing a fixed 3.2s sleep. - serve.cjs battery |
| `tools/qa-calc-trade-coverage.cjs` | CI | Trade coverage walk (owner research round 2, 2026-10-01): every one of the 38 picker trades driven through the real UI - family flip + persistence, basis label, dims, price, piece/bill add, CSV, mobile 390 - plus a console-clean sweep (signed-out /api/ 4xx classified as expected probe noise) - 78 gates across 38 trades (Phase 2 auto-walks formwork, rebar-size, stirrups, fabric-mesh, concrete-labour), serve.cjs battery |
| `tools/qa-calc-golden.cjs` | CI | Golden-case engine gate (plan v2 Phase 0 / E5, 2026-10-01): every hand-calculated case in tools/calc-golden-cases.json (33 picker trades + cross-cutting: imperial, openings-before-waste, piece pricing, instances, quality, tax, on-costs, overhead, equipment, rate freedom + Phase 1: variant conversion, labour mode, rate-entry unit factors + Phase 2: concrete-chain cases (formwork variants incl. imperial sq-ft entry, rebar per-lb, stirrups per-dozen, mesh per-yd2, clay-deep dig, 8in block, labour-only pour) run through the real page engine in a browser - a drift over 1 currency unit rejects the build and the unit-slip guard must flag NOTHING on any case - 75 gates across 72 cases (+14 all-in / per-day cases: all-in metric, all-in on a per-yd2 trade, all-in beats piece, all-in beats labour-only, overhead+tax on a book-filled line, book-filled vs typed, blank-inert, per-day, per-day + material, per-day on-costs, per-day premium-does-not-scale, quarter-days, invalid-days fallback; one hand-calculated expected was corrected against the engine during the wave: tax on 1600+10% overhead is 2024, not 1972), serve.cjs battery |
| `tools/qa-calc-workspace.cjs` | CI | Calc workspace route (client-docs W5 2026-10-01): session-gated GET/PUT /api/calc/workspace against local wrangler dev - signed-out 403, PUT ok+savedAt, GET round-trip, 4MB cap 413, non-JSON 400, plan:'free' rides (6/6), own wrangler on QA_PORT |
| `tools/qa-calc-playwright-audit.cjs` | CI | Playwright UX audit of both calculators (owner 2026-09-28 directive): 3 viewports x layout/focus/live-recompute, light+dark themes, exact-recall fidelity through real UI events, mobile reachability + icon-restore (bfcache sprite re-resolution after persisted pageshow, owner 2026-09-30) + client-docs gates (M13 real logo upload, M14 brand/companions mobile contract, T5 tour final-card centering) - 40 gates, serve.cjs battery |
| `tools/qa-calculator.cjs` | EXTENDED | floating calculator (27/27) |
| `tools/qa-view-mode.cjs` | EXTENDED | view-mode/deck gates |
| `tools/qa-legal-links.cjs` | EXTENDED | legal link targets (7/7) |
| `tools/qa-pool-ui.cjs` | EXTENDED | resource pool UI (6/6) |
| `tools/qa-cloud-pool.cjs` | EXTENDED | cloud resource pool (19/19) |
| `tools/qa-live-pool.cjs` | EXTENDED | live pool gates (17/17) |
| `tools/qa-date-wiring.cjs` | EXTENDED | date wiring, parallel groups, lead-time watcher (32/32) |
| `tools/verify-spy-cdp.cjs` | EXTENDED | marketing scroll-spy |
| `tools/verify-gates-cdp.cjs` | EXTENDED | app/admin gate screens render |
| `tools/verify-gates-themes.cjs` | EXTENDED | gate screens in every theme state |
| `tools/verify-glass-preview-cdp.cjs` | EXTENDED | glass preview surfaces |

## TRIAGE — known-drifting, findings recorded (next wave)

| Harness | Status | Findings (2026-09-22) |
|---|---|---|
| `qa-stress.cjs` | TRIAGE | **D02 is a REAL bug**: the IndexedDB journal held the pre-kill edit (`Grace-Crash-Edited`) but after a hard kill + relaunch nothing was restored — `restoreFromJournal()` only accepts the journal when its `updatedAt` is STRICTLY newer than localStorage's, and `journalPut()` stores a `ts` the restore ignores, so any boot-time localStorage write defeats crash recovery. P04: ambiguous-risk rendering assertion needs re-baselining. |
| `qa-ai-visual.cjs` | TRIAGE | AI window does not open (4 checks) — same `Entitlements.aiAssistant()` signed-in gate already seamed in `qa-full`/`qa-ai`; needs the same seam. |
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
node tools/qa-health-sweep.cjs http://127.0.0.1:8787   # page health vs the Worker
node tools/verify-test-registry.cjs                    # this document stays complete
```
