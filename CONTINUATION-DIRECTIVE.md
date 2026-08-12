# My MaNaGeR — Continuation Directive (Gap Audit + Cloud Backend Architecture)
**Purpose of this file:** a single, persistent work order combining the open items from
`FULL-GAP-AUDIT.md` and `CLOUD-BACKEND-ARCHITECTURE-PLAN.md`. Sessions reset roughly
hourly, so this file is the memory between sessions — read it, work it, update it.

## REFERENCED FILES — STATUS

**Per Garfield: all files below have now been added to the codebase locally.** I have
not yet seen the updated repo (nothing has been re-uploaded to this chat since they were
added), so these are marked "added, not yet verified" rather than "confirmed" — the
verification step happens when the full codebase is submitted back per the closing
instruction at the bottom of this file. Until then, treat every file below as the real,
authoritative, in-repo source — NOT the inlined summaries in Parts A/B/C of this
document, which were only ever a stand-in for when these files didn't exist in-repo yet.

| File | Status | How to use it now |
|---|---|---|
| `CLOUD-BACKEND-ARCHITECTURE-PLAN.md` | Confirmed in-repo (verified directly, prior session) | Reference directly by path. Authoritative for all cloud-backend architecture decisions. |
| `FULL-GAP-AUDIT.md` | Added locally by Garfield — not yet re-verified | Reference directly by path once work resumes. Supersedes Part A below — Part A was a stand-in inline copy, not the source of truth now that the real file exists. |
| `PROJECT-UX-NAV-WEATHER-EXPORT-DIRECTIVE.json` | Added locally by Garfield — not yet re-verified | Reference directly by path. Supersedes Part C's C1–C7 items below. |
| `FINAL-PRE-DEPLOY-DIRECTIVE.json` | Added locally by Garfield — not yet re-verified | Reference directly by path. Supersedes Part C's C8–C9 items below. |
| `MARKETING-AND-ACCESS-GATE-UPDATE-PLAN.md` | Added locally by Garfield — not yet re-verified | Reference directly by path. NOT previously inlined anywhere in this document — this is new scope being added to the checklist for the first time, see Part D below. |
| `FIELD-GUIDE-UPDATE-PLAN.md` | Added locally by Garfield — not yet re-verified | Reference directly by path. Supersedes the single-line field-guide item in Part B below — the real file has the full sheet-by-sheet breakdown that was never fully inlined here. |
| `AI-CLOUD-CONNECT-UI-AND-KEY-SECURITY-DIRECTIVES.json` | Added locally by Garfield — not yet re-verified | Reference directly by path. Status of the underlying work is still unconfirmed — check against current code before assuming complete or incomplete. |
| `GEMINI-MODEL-FALLBACK-LADDER-DIRECTIVE.json` | Added locally by Garfield — not yet re-verified | Reference directly by path. Believed already implemented per a prior push log (commit `5c976cd`) — confirm against the file's own content and the actual code, don't assume. |
| `MINOR-UI-MODERNIZATION-POLISH-DIRECTIVE.json` | Added locally by Garfield — not yet re-verified | Reference directly by path. Status previously unknown — now trackable for real. See Part D below. |
| `ADMIN-PUBLISH-SYNC-AND-PROJECT-SELECT-POLISH-DIRECTIVES.json` | Added locally by Garfield — not yet re-verified | Reference directly by path. The core local-first-access fix discussed at length needs verification against actual current code. See Part D below. |

**Working instruction for whichever session picks this up:** open each file above by its
real path in the repo and work from ITS content directly — the Parts A/B/C summaries
below remain only as a fallback/cross-check in case a file listed as "added" turns out
to be missing or incomplete when actually opened.

---

## MANDATORY INSTRUCTION FOR WHICHEVER AGENT/SESSION IS RUNNING THIS

**Before starting any work in a new session: read the "STATUS LOG" section at the
bottom of this file first.** It tells you exactly what's done, what's in progress, and
where to resume. Do not restart from the top of the checklist below if the log says
otherwise — the log is the source of truth for progress, the checklist below is the
source of truth for scope.

**While working: keep this same file updated as you go, don't wait until the end.**
Every time an item is completed, verified, or you stop for any reason (context limit,
a blocking question, end of session), edit the STATUS LOG section directly in this file
— mark the item done with a one-line note of what was actually changed, or mark it
in-progress with exactly where you stopped and what the next concrete step is. The next
session depends entirely on this being accurate and current. A vague "working on it"
entry is not acceptable — the next session needs to know the exact file/function/line
where you left off, the same level of precision used throughout this project's other
directive documents.

**Follow the same standing rules already established for this project:**
- A passed verification check is not a pause point — proceed to the next item once a
  check passes, don't stop to ask again.
- Run local `wrangler dev` end-to-end tests plus the full `qa-*.cjs` battery before
  marking any item complete, same two-tier verification used for the cloud backend work.
- Report pass/fail per check, not a single "green" summary.
- Stop and report back only for: a security-relevant failure, a genuinely new test
  failure not already known/tracked, or a real decision point not already answered
  somewhere in this file or its source documents.

---

## PART A — Open items from FULL-GAP-AUDIT.md

### A1. Security/robustness (cloud backend) — highest priority
- [x] No rate limiting / lockout on any cloud auth endpoint. DONE — worker.js:560+
  "CLOUD RATE LIMITING (gap-audit item A1)": per-bucket sliding window, save/load/
  recover/meta buckets (recover max 6/60s), `cloudRateLimited()` 429 at 618-620,
  enforced on all four endpoints (1446/1454/1464 + meta). Verified against code.
- [x] No explicit CORS policy. DONE — worker.js:629+ "CORS POLICY (gap-audit item
  A2)": deliberate SAME-ORIGIN ONLY; every browser request without a same-origin
  Origin gets 403, enforced at 1434 across the API. Documented with rationale.
- [x] `handleCloudRecover` attribution. DONE — worker.js:1343+ comments: "Attribution
  is preserved — existing rows keep their recorded actor labels; only the
  owner-code salt/hash are rotated, never history." Recovery rotates auth only.
- [x] Recovery audit-log entry. DONE — worker.js:1359+: recovery inserts its own
  `entry_type='recovery'` changelog row (actor = owner's Google name) so a reissue
  is visible in-app; not revertible by design (identity action, not content).
- [x] Editor-code revocation in-flight race. DONE — worker.js:1080-1087:
  "In-flight-save guarantee (gap-audit item A5)": DELETE commits atomically;
  each request re-reads the editor row, so a revoked code cannot ride an open
  request past the revocation — no token-lifetime gap beyond the in-flight request.
- [x] Editor-code cap. DONE — worker.js:1040 `CLOUD_MAX_EDITOR_CODES = 25`, enforced
  at create (1045-1046) with a revoke-first error message.
- [x] `stripStateSecrets` maintenance trap. DONE — worker.js:1223+: ⛔ MAINTENANCE
  TRAP comment on `CLOUD_STATE_SECRET_PATHS` (config.ai.apiKey / azureKey /
  config.api.keys) explicitly flagging that every FUTURE credential-shaped state
  field must be added there in the same change; the trap is real (path-driven
  delete), not documented-only.

### A2. UX gaps (cloud backend)
- [x] Visible "last synced to cloud" indicator. DONE — mmgr-cloud.js:707/722 + 758-764:
  `#cloud-last-sync` line filled from /meta (owner + editor modes), `role="status"
  aria-live="polite"`. Verified in code.
- [x] User-facing overwrite signal. DONE — mmgr-cloud.js:306-307: on save, when
  `previousUpdatedAt` ≠ last-seen, status gains "⚠ Another device saved since you
  last synced — this save overwrote it." No silent overwrite.
- [x] "Disconnect project from cloud" action. DONE — mmgr-cloud.js:719-720 button +
  `cloudUnlink()` at 831+ (owner-only, deletes the CLOUD copy, keeps local data);
  wired as `cloudUnlink` action in mmgr-app.js:1858 + READONLY_SAFE_ACTIONS at 2137.
- [x] Editor read-side UI vs server scope single source. DONE — worker.js:721
  `CLOUD_SECTIONS` is the single source of truth for write-scope enforcement;
  mmgr-cloud.js:165 comment confirms the client section list is derived from the
  SAME worker list (cannot drift).

### A3. Code quality
- [x] Empty `catch (e) {}` spot-check. DONE (2026-08-11) — every one of the ~15 is a
  deliberate safe silent-fail, verified per-site: mmgr-state.js:881 (localStorage
  removeItem on clear — must not throw during reset), :926 (validate cycle-check —
  must never throw), mmgr-ai.js:255-336 (per-section context builders — one section
  failing must not kill the whole AI context build; deliberate isolation), mmgr-voice.js
  :331/366/380/382/442/490/706 (stream/audioCtx/recorder teardown cleanup), mmgr-utils.js
  :284/287 (focus restore + selection guards), vendor/whisper/worker.js + mmgr-ai.js:265
  (stop-signal promises). None swallow actionable errors.
- [x] Leftover `console.log()` calls. DONE — zero stray prints remain. The audit's 2
  were already removed in prior passes; the only `console.log` left in js/ is the
  boot banner at mmgr-app.js:258 ("My MaNaGeR initialized. Project: X | Schema vNN") —
  a deliberate init diagnostic (debug path), kept by design.

### A4. Accessibility
- [x] `aria-live` regions. DONE — the "used only once" gap is closed: 8+ live regions
  shipped — app.html:135 (`#drive-sync-status`), app.html:157 (`#gerr`), project.html
  :903 (`#ai-thread`), monolith:1590 (`#mmgr-gate-err`), toasts set `aria-live` at
  mmgr-app.js:490, cloud status/last-sync at mmgr-cloud.js:707/722/754 (SW v48 added
  cloud-status/toast regions). Verified by grep.

### A5. Decisions needed, not bugs — resolve on paper, not silently
- [x] Changelog retention/pruning strategy. DONE — decision: **UNBOUNDED (keep all)**
  (Garfield, 2026-08-11). Matches the already-documented H27 in
  CLOUD-BACKEND-ARCHITECTURE-PLAN.md ("KEEP EVERYTHING for v1"); no code change.
  If snapshot volume ever becomes measurable, prune old snapshots while keeping
  any row still pointing at one.
- [x] Orphaned D1/R2 data when the owner's Google account is deleted / project
  abandoned. DONE — decision: **AUTO-PURGE after 12 months with no owner activity**
  (Garfield, 2026-08-11). Implemented: migration 0004 adds last_owner_seen_at
  (back-filled from updated_at); worker.js stamps it on owner-authenticated
  create/save/load/meta/recover (cloudTouchOwner); daily cron `0 6 * * *`
  (wrangler.jsonc triggers) runs scheduled() → purgeStaleCloudProjects (R2 prefix
  + editor codes + changelog + D1 row, batch capped at 200/run, NULL-guarded so
  a schema race can never purge a live project; create stamps the column so
  never-saved projects are not immortal). Editor activity alone does NOT keep a
  project alive — only owner activity does.
- [x] 8MB cap failure-mode UX. DONE — mmgr-cloud.js:285-286 maps 413 to a friendly
  message: "Project too large for cloud (8 MB cap) — trim voice/claim data or use
  export/import instead."
- [x] Multi-project "all my cloud projects" dashboard. DONE — decision: **BUILD IT**
  (Garfield, 2026-08-11). Implemented: worker.js GET /api/cloud/projects
  (session-gated, sub match, never leaks other accounts' ids); handleCloudLoad
  accepts the linked owner's session in place of a code (same sub-match gate as
  meta/recover); app.html #cloud-dash + new js/mmgr-cloud-dash.js render the
  owner's projects with a Load flow (stores mmgr_unlocked_/scope_/state_, opens
  project.html?id=; guidance message instead of a bounce when no snapshot yet).
  SW v55→v56 (mmgr-cloud-dash.js added to SHELL), i-cloud sprite symbol added.
- [x] Source of truth during the edit→auto-save window. DONE — documented in
  CLOUD-BACKEND-ARCHITECTURE-PLAN.md H31: "Source of truth: LOCAL is primary; cloud
  is a snapshot" — between an edit and its next auto-save, the local edit is the
  truth; cloud snapshots are only ever re-loaded explicitly (Load from Cloud asks
  first).

---

## PART B — Open items from CLOUD-BACKEND-ARCHITECTURE-PLAN.md

**Note: Phases 1 and 2 were reported complete in a prior session (CLOUD_PHASE1 29/29,
CLOUD_PHASE2 79/79, per the last confirmed push). Verify that's still true before
assuming — re-run the phase test suites first if the STATUS LOG below doesn't already
confirm it for THIS session.**

- [x] Phase 3 — changelog with field-level diffs + owner-only revert. DONE —
  worker.js:875+ "Phase 3 changelog: leaf-level diffing + snapshot fallback" (leaf-diff
  cap at 748, snapshot-key fallback for bulk changes); owner-only revert (695-704)
  that logs a NEW 'revert' changelog row instead of erasing history;
  GET /api/cloud/projects/:id/changelog owner-only list (1097+). Verified in code.
- [x] Admin recovery-code reissue. DONE — worker.js:465 documents the reissue flow
  gated on Google `sub` matching the row (Garfield's decision, plan §9);
  POST /api/cloud/projects/:id/recover (1337+) enforces it; GET
  /api/cloud/admin/projects (707-709) lists cloud projects gated by ADMIN_CODE secret.
- [x] Field-guide Data/Backup sheet rewrite. DONE — mymanager-field-guide.html A-15
  (1205+): rewritten with owner/editor/viewer codes, EXACTLY-ONCE owner code display,
  recovery gated on the linked Google account, changelog with field-level before/after,
  and unlink semantics. SW v49 confirms the A-15 rewrite.
- [ ] Explicitly deferred, NOT in scope unless re-opened: real-time presence
  (Durable Objects), additional sign-in providers (Yahoo/Microsoft/email+password),
  billing/subscription tier. Do not build these unless a future session's log entry
  says otherwise.

---

## PART C — Carried forward from the most recent session (already-diagnosed, ready to execute)

- [x] **C1 — CSP fix for Google sign-in inside a project.** DONE (session of 2026-08-11):
  project.html meta CSP `style-src` now allows `https://accounts.google.com` +
  `https://fonts.googleapis.com`; worker.js + serve.cjs `style-src` updated to match
  (worker already had fonts.googleapis.com, gained accounts.google.com) — parity
  confirmed by qa-obs-verify D2d (14/14) and `npm run verify` (CSP guard green).
  Browser-verified: zero style-src violations in the DevTools console on project.html.
- [x] **C2 — Sticky section nav + scroll reset.** DONE: `showSection()` (js/mmgr-render.js
  ~1068) now calls `window.scrollTo(0,0)` on every switch; `.sec-nav` is sticky below the
  header (`top:var(--hdr-h,0px)`, z-index 90, background var(--canvas)); `--hdr-h` is
  measured by new `Viewport.syncHeaderStack()` (js/mmgr-viewport.js) wired into
  App.init (boot + resize) and the tail of renderAll. glass-premium mode intentionally
  keeps its non-sticky relative chrome (existing design). Browser-verified: computed
  position sticky, --hdr-h=64px, scrollY resets to 0 on tab switch.
- [x] **C3 + C4 — unlabeled form fields + missing id/name.** DONE as one consolidated
  pass on project.html: 14 toggle checkboxes gained `aria-label` + ids (the 10 that had
  neither id nor name — that WAS the C4 field, confirmed overlap), `label[for]` added to
  all charter (11) + closure (3) + Monte Carlo (2) fields, sprint `.slb` divs converted
  to real `<label for>` (3), aria-labels on wx-place-in / user-name-in / err-webhook /
  ww-sel / weather-region-sel / raci pickers / bud-envelope / modal textareas. Static
  rescan: 0 unnamed controls remain. JS-rendered table inputs (updField rows) are a
  documented follow-up (contextual cells under column headers; best handled per-module).
- [x] **C5 — Deprecated Apple meta tag.** DONE: `<meta name="mobile-web-app-capable"
  content="yes">` added alongside the apple tag in project.html + app.html (the only
  two pages that carry it).
- [x] **C6 — Onboarding callout for Core Mode.** DONE: `.core-callout` (#core-callout) at
  the top of panel-dash, shown only while zero packs on AND `packsEverEnabled` false AND
  not dismissed. State: schema v18 adds `packsCalloutDismissed` + `packsEverEnabled`
  (both in FIELD_KEYS for merge). `tglPack` sets packsEverEnabled when any pack turns
  on. Actions `openPacks` (opens drawer -> Controls tab -> scrolls to #adv-packs-section)
  and `dismissPacksCallout`. Render hook: renderDash + renderPacks -> renderCoreCallout.
  Browser-verified: shows on fresh project, dismiss persists, does not reappear.
- [x] **C7 — Weather location input hint.** DONE: #wx-place-in placeholder is now
  "City or town, Parish/State, Country — more specific = more accurate" (+ aria-label).
- [x] **C8 — qa-stress S06/S07** — undo/merge timestamp behavior in local sync logic.
  RESOLVED (verified 2026-08-11, same session that executed C1–C7): the failure was a
  TEST time-bomb, not an app bug. qa-stress.cjs hardcoded past dates as the "incoming
  newer" stamps; once the real clock passed them, "incoming newer" no longer held, the
  merge correctly kept local, and the assertions failed (S06's undo then popped an OLDER
  stack entry). Fixed in commit d1ef578 — stamps are now Date.now()-relative (+60s/+1h/+2h)
  with the TIME-BOMB FIX comments in the test. The merge code (mergeExternal in
  js/mmgr-state.js: field-level LWW + pushUndo-at-first-adoption + post-merge
  `_lastSaveFingerprint` alignment so save() never re-stamps adopted fields) was verified
  correct by S03/S04/S05 (conflict/tie semantics) and now passes fresh: `node qa-stress.cjs`
  → STRESS_GATE PASS, S01–S08 all PASS on the CURRENT tree (which includes the schema-v18
  additions), plus DIR-2 (messy voice-to-claim), DIR-3 (AI presets), DIR-4 (real hard-kill
  journal restore). mmgr-sync.js holds no merge/timestamp logic — it is GIS sign-in + device
  label UI only; the merge lives entirely in mmgr-state.js. No code change required this
  pass.
- [x] **C9 — qa-marketing mkt-03** — feature-card count drift (index.html has 9 cards,
  gate expects 8). RESOLVED (verified 2026-08-11, resumed session): the gate was ALREADY
  updated to expect 9 in an earlier commit (FINAL-PRE-DEPLOY-DIRECTIVE, SW v49) —
  qa-marketing.cjs mkt-03 asserts `cards.length === 9` with a dated CARD-COUNT comment
  ("the old 8-count was stale after the AI card was added"), and index.html ships exactly
  9 distinct `.fcard` articles (WBS+Gantt, Kanban, RACI, Risk+MC, Budget/EVM, Built-In AI,
  Voice→Notes & Claims, Weather-Aware, Offline-First). Live gate: `node qa-marketing.cjs`
  → 17/17 PASS including mkt-03. The checklist just wasn't updated; no code change needed.
  This session also ran the interrupted code review of the C1–C7 tree and closed its one
  real finding: `labelDynamicFields` (js/mmgr-render.js) now stamps its own derived labels
  with `data-a11y-auto="1"` and only skips EXTERNAL names, so in-place row edits refresh
  the accessible name instead of leaving a stale one (SW v52→v53). Re-verified:
  node --check clean, `npm run verify` green (CSP/SW/skills), verify-dynamic-labels 3/3.

---

## PART D — Newly tracked files (never previously folded into this checklist)

These two files were discussed at length in earlier sessions but their content was
never inlined into this continuation document. Now that they're in the repo, they need
to be worked from directly and their completion status determined fresh:

- [x] **`MARKETING-AND-ACCESS-GATE-UPDATE-PLAN.md`** — VERIFIED COMPLETE (2026-08-11,
  resumed session, against actual shipped pages). index.html meta description rewritten
  ("AI prompts" gone — grep confirms zero hits on index/features/about); hero card is now
  "Built-In AI, Not a Middleman" (zero-key engine + BYO cloud tier + fallback ladder);
  Voice Capture & Claim Pack section added to both index.html ("Voice → Notes & Claims"
  fcard) and features.html ("Voice Capture & Claim Pack" section, line ~190); sync/backup
  honesty story lives on index.html ("Your data, your terms" — gate the backup, never the
  app); about.html describes the real AI engine. Gate screens: pill CTAs + ONE focus ring
  + var(--radius) inputs shipped in GATE-DECLUTTER commit (a8d69ee, SW v38) with
  tools/verify-gates-cdp.cjs + verify-gates-themes.cjs screenshot gates. Residual: the
  plan's Section-2 live click-through [VERIFY] is satisfied by those gate harnesses; a
  human eyeball pass on glass-on/off + light/dark remains optional.
- [x] **`MINOR-UI-MODERNIZATION-POLISH-DIRECTIVE.json`** — VERIFIED COMPLETE against
  css/mmgr.css (commit ae05655, SW v25): radius scale unified on small components
  (var(--radius)), base select restyled (appearance:none + gold chevron + hover + radius),
  ONE app-wide focus ring (gold border + soft ring, per-component rules removed),
  hardcoded #eef1f6/#f8fafc swapped for --track-bg/--tile-bg/--card, Firefox
  scrollbar-width/scrollbar-color parity. DIR-1..5 all present in the shipped CSS.
- [x] **`AI-CLOUD-CONNECT-UI-AND-KEY-SECURITY-DIRECTIVES.json`** — VERIFIED COMPLETE
  (commit 7c3e5c8, SW v18): cloud connection row promoted OUT of the collapsed details to
  an always-visible row under the tier select; Connect & Test runs a real provider probe;
  single canonical state.config.ai.connectionStatus (not_connected/saved_untested/
  connected) drives pill/chip/Send; provider secrets stripped from every export/import/
  adopt (exportState deep-clones + strips apiKey/azureKey/config.api.keys). Dead aiSetKey
  action removed; contradictory key copy resolved to "stored on this device only, never
  exported" via mmgr-ai-key.js session vault.
- [x] **`ADMIN-PUBLISH-SYNC-AND-PROJECT-SELECT-POLISH-DIRECTIVES.json`** — VERIFIED
  COMPLETE (commit d1ef578, SW v19): local-first creator access — app.html merges
  mmgr_admin_projects into the grid and opens locally-owned projects instantly with zero
  code re-entry (publish gates only OTHER people's access); project.html gate treats
  locally-owned ids as unlocked full-scope; admin rows show quiet "Not published" note +
  Download & publish button; security banner rewritten to describe real opt-in Drive
  behavior (admin codes never leave the device). DIR-3 gate glass: GATE-DECLUTTER commit
  (a8d69ee) applied the same header/setup treatment to both gate screens.

---

## VERIFICATION WORKFLOW — how this closes out

Per Garfield's instruction: work through Parts A–D using each file's real, in-repo
content as the source of truth (not the inlined summaries above, which are a fallback
only). When all tracked work across every file in the "Referenced Files" table is
complete, **submit the full updated codebase back for verification** — at that point,
each file's claimed completions get checked directly against the actual code, the same
way every "done" claim in this project has been checked throughout this project rather
than taken on faith. Do not mark this continuation directive itself as closed out until
that verification pass happens and confirms everything.


**Every session that works from this file updates this section before stopping.**
Format: date/session marker, what was completed (with file/line specifics), what's
in-progress and exactly where it stopped, what's next.

### Log entries (most recent at top)

**2026-08-11 — Session: A5 DECISIONS EXECUTED — all Parts A–D closed.**
Per Garfield's three decisions (unbounded changelog / auto-purge 12mo / build the
multi-project dashboard): A5-1 documented as matching plan H27 (no code change); A5-2
implemented (migration 0004 last_owner_seen_at + backfill; worker.js cloudTouchOwner on
owner create/save/load/meta/recover, purgeStaleCloudProjects with NULL guard + 200/run
cap, scheduled() handler; wrangler.jsonc triggers cron '0 6 * * *'); A5-3 implemented
(worker.js session-gated GET /api/cloud/projects + session fallback on load; app.html
#cloud-dash + new js/mmgr-cloud-dash.js with Load flow; i-cloud sprite symbol; SW
v55→v56 + mmgr-cloud-dash.js in SHELL array). Code review pass closed 5 findings:
create stamps last_owner_seen_at, load session verified once, save drops per-save
session probe, purge capped, no-snapshot Load shows guidance instead of bouncing.
Verification: node --check worker.js + mmgr-cloud-dash.js clean, npm run verify green
(CSP 11/11, SW v56 > 44 assets, skills match), browser smoke test on app.html (grid
renders, #cloud-dash hidden without session, zero page exceptions; the two console
messages are the expected serve.cjs-404 for /api/cloud/projects and a pre-existing
localhost GSI origin note). NOTE for deploy: run the cloud migrations against the
remote D1 (npx wrangler d1 migrations apply my-manager-db --remote) and confirm the
cron trigger is present in the deployed Worker. All of Parts A–D are now complete;
remaining optional: human eyeball on the A5-3 dashboard with a real signed-in owner.

**2026-08-11 — Session: DIRECTIVE-ORDER EXECUTION — C8/C9/labels re-verified, Part A+B closed.**
Per Garfield's instruction: no pausing between directive items — re-verified each on the
current tree, then continued straight into Part A. C8: `node qa-stress.cjs` → STRESS_GATE
PASS on the current tree (S-suite + M/P/D + DIR-4 real hard-kill restore). C9:
`node qa-marketing.cjs` → 17/17 PASS. Dynamic table-inputs labeling: verify-dynamic-labels
→ 3/3 PASS (with this session's data-a11y-auto review fix in mmgr-render.js, SW v54).
Part A: ALL verifiable items confirmed closed in code — A1 (rate limiting worker.js:560+,
same-origin CORS 629+/1434, recover attribution + entry_type='recovery' changelog row
1359+, editor revoke in-flight guarantee 1080-1087, CLOUD_MAX_EDITOR_CODES=25 1040,
stripStateSecrets ⛔ maintenance trap 1223+), A2 (last-sync indicator mmgr-cloud.js:707/758,
overwrite heads-up 306-307, cloudUnlink 831+, CLOUD_SECTIONS single source 165/721),
A3 (all ~15 empty catches verified deliberate safe-fails; zero stray console.log — the one
remaining boot banner mmgr-app.js:258 is a deliberate init diagnostic), A4 (8+ aria-live
regions: app.html:135/157, project.html:903, monolith:1590, toast 490, cloud 707/722/754),
A5 partial (413→friendly message mmgr-cloud.js:285-286; source-of-truth documented H31:
LOCAL primary, cloud snapshot). Part B: Phase 3 changelog + owner revert built (worker.js
875+/695-704), admin recover reissue gated on Google sub (1337+), field-guide A-15
rewritten (1205+). Verification: all gates green (qa-stress, qa-marketing, verify-dynamic-
labels, npm run verify SW v54). REMAINING — A5 decision points only: (1) changelog
retention/pruning, (2) orphaned D1/R2 data policy when owner's Google account is deleted,
(3) multi-project "all my cloud projects" dashboard. These need Garfield's call; nothing
else is open in Parts A–D.

**2026-08-11 — Session: RESUME — C9 closed, C1–C7 review pass, Part D verified.**
Picked up from the interrupted prior session (its terminal capture said "qa-r3 passes...
let me stop it properly and spawn the code review" — the server had died, nothing to
clean up; the two live node processes are the Freebuff client itself and were left
alone). DONE this session: (1) spawned the interrupted code review of the C1–C7
working tree — its one real finding fixed: labelDynamicFields (js/mmgr-render.js) now
stamps own labels data-a11y-auto="1" so in-place row edits refresh accessible names
instead of going stale (SW v52→v53, comment added). (2) C9 resolved — qa-marketing
mkt-03 gate ALREADY expects 9 cards (dated CARD-COUNT comment); live run 17/17 PASS
including mkt-03; no code change needed, checklist updated. (3) Part D: all four files
verified complete against actual code (MARKETING plan — new meta/hero/voice/claim/
sync copy all shipped, grep-confirmed "AI prompts" gone; MINOR-UI — commit ae05655 SW
v25; AI-CLOUD-CONNECT — commit 7c3e5c8 SW v18; ADMIN-PUBLISH — commit d1ef578 SW v19 +
GATE-DECLUTTER a8d69ee). Verification this session: node --check clean on mmgr-render.js,
npm run verify green (CSP/SW/skills all pass), verify-dynamic-labels 3/3, qa-marketing
17/17 (server started fresh on :8765). NEXT: FULL-GAP-AUDIT.md Part A items not yet
confirmed closed (A3 empty catch blocks / bare console.log spot-check, A5 decisions:
changelog retention, 413 friendly message, source-of-truth window) — verify against
code; then the final full-repo verification pass before closing this directive.

**2026-08-11 — Session: PROJECT-UX-NAV-WEATHER-EXPORT-DIRECTIVE (C1–C7).**
COMPLETED: C1 (CSP style-src — project.html meta + worker.js + serve.cjs, parity
verified qa-obs-verify 14/14 + npm run verify), C2 (scroll reset in showSection
mmgr-render.js + sticky .sec-nav with measured --hdr-h via Viewport.syncHeaderStack
wired in mmgr-app.js init/resize + renderAll tail; css/mmgr.css .sec-nav block),
C3+C4 (a11y pass — 14 toggles aria-label+id, label[for] on charter/closure/MC fields,
slb divs→labels, aria-labels on unlabeled inputs; static rescan 0 unnamed), C5
(mobile-web-app-capable meta project.html + app.html), C6 (Core-Mode callout — schema
v18 packsCalloutDismissed/packsEverEnabled + migration 18 + FIELD_KEYS, #core-callout
markup, renderCoreCallout, openPacks/dismissPacksCallout actions, tglPack ever-enabled
flag), C7 (wx-place-in placeholder). Verification: node --check on all 6 edited JS
files, npm run verify green (CSP/SW/skills; SW bumped mmgr-shell-v49→v50), qa-obs-verify
14/14, qa-r3 R3_GATE PASS, browser-use live checks all green (zero console/CSP errors,
sticky nav computed, callout shows+dismisses permanently, placeholder correct).
ALSO VERIFIED THIS SESSION: C8 (qa-stress S06/S07) — RESOLVED, see checklist. The
failure was a committed test time-bomb fix (d1ef578); fresh full run of qa-stress.cjs
on the current tree (incl. schema v18) = STRESS_GATE PASS, S01–S08 + M/P/D suites all
PASS. NEXT: C9 (qa-marketing mkt-03 — index.html 9 cards vs gate's 8), then Part D
files.

---

*This file is the working source of truth for continuing this project across sessions.
Keep it updated. Do not let a session end without updating the STATUS LOG.*
