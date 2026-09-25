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
| `tools/qa-reviews.cjs` | CI | review queue accept/reject + changelog (25/25) |
| `tools/qa-t9-adoption.cjs` | CI | adoption/discontinue flows (27/27) |
| `tools/qa-email-auth.cjs` | CI | email/password auth, reset, verify (75/75) |
| `tools/verify-cloud-autosave-signin.cjs` | CI | cloud autosave + sign-in queue/resume (8/8) |

## T3 — headless Chrome, own wrangler

| Harness | Status | Covers |
|---|---|---|
| `tools/qa-client-codes.cjs` | CI | client-code entry -> project client scope, soft delete |
| `tools/qa-api-keys.cjs` | CI | scoped API key read + review-queue writes, MCP PATH-A |
| `tools/qa-sync-bond.cjs` | CI | file trip keeps the cloud twin link; re-sync merge (20/20) |

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
| `qa-glass.cjs` | TRIAGE | premium glass engine never activates under headless Chrome (6 checks); still fails with `--use-angle=swiftshader`, so this is not only the missing GPU — needs triage of the engine boot path. |
| `qa-glass-visual.cjs` | TRIAGE | depends on the premium canvas existing (4 checks) — blocked by the same engine boot issue. |
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
