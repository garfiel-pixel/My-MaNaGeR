# My MaNaGeR — Continuation Directive (Gap Audit + Cloud Backend Architecture)
**Purpose of this file:** a single, persistent work order combining the open items from
`FULL-GAP-AUDIT.md` and `CLOUD-BACKEND-ARCHITECTURE-PLAN.md`. Sessions reset roughly
hourly, so this file is the memory between sessions — read it, work it, update it.

---

## LOCKED SKILL SET — READ THIS BEFORE ANY WORK (added 2026-08-11)

**The full agent skill set lives in `.agents/skills/` and is registered in
`skills-lock.json` (source of truth — path, source, content hash).** AGENTS.md is the
canonical "load before editing" instruction; this section is the quick reference so
this file is self-sufficient if AGENTS.md is not at hand.

**Standing rule:** before editing any code, read the SKILL.md of every skill relevant
to the task (load by skill `name`, or read `.agents/skills/<dir>/SKILL.md`) and follow
it. Ignoring a skill risks violating this project's hard gates. After any skill-set
change, run `npm run verify` (CSP + SW + `verify:skills` — it re-checks every locked
hash against the on-disk folders).

### The 16 locked skills (as of 2026-08-11)

| Skill dir | Use for… |
|---|---|
| `.agents/skills/cloudflare` | Any Cloudflare platform task (Workers, Pages, KV, D1, R2, AI). Comprehensive fallback. |
| `.agents/skills/cloudflare-api` | Direct Cloudflare REST API ops (D1 queries, R2 bulk, cache purge, WAF). |
| `.agents/skills/d1-migration` | D1 schema changes / migrations (repo uses raw SQL migrations — apply the SQL gotchas only). |
| `.agents/skills/wrangler` | Running wrangler commands (deploy, `d1`, `r2`, secrets, dev). |
| `.agents/skills/workers-best-practices` | Writing/reviewing any Worker code or `wrangler.jsonc` config. |
| `.agents/skills/security-audit` | Security reviews of `worker.js`, cloud API, CSP, session/owner-code flows. |
| `.agents/skills/web-perf` | Page-load/Core Web Vitals/PWA performance audits. |
| `.agents/skills/qa-expert` | QA process, test plans, P0–P4 triage, coverage metrics (complements `qa-*.cjs`). |
| `.agents/skills/google-drive` | Anything touching Google Drive integration. |
| `.agents/skills/skeptical-code-audit` | Auditing for broken wiring (CSS/JS/DOM drift, dead handlers, silent no-ops). Project-authored, registered as `local` in the lock. |
| `.agents/skills/universal-ui-architect` | Any UI/UX work — design tokens, WCAG 2.2/APCA gates, Liquid Glass, polish. Hard gates block ship. Project-authored, registered as `local`. |
| `.agents/skills/gemini-api-dev` | Gemini API work: `js/mmgr-ai.js` / `mmgr-ai-key.js`, model fallback ladder, `/api/ai/chat` relay, prompt/model selection. NEW 2026-08-11 (google-gemini/gemini-skills). |
| `.agents/skills/pwa-development` | PWA work: `sw.js` caching strategy, `manifest.webmanifest`, offline-first behavior. NEW 2026-08-11 (alinaqi/maggy). |
| `.agents/skills/oauth` | OAuth 2.0/2.1 authz-code/PKCE flow reference — Fastify-oriented; apply RFC/flow gotchas only (Worker's Google sign-in uses its own HMAC cookie flow). NEW 2026-08-11 (mcollina/skills). |
| `.agents/skills/landing-page-generator` | Marketing page work: `index/features/about/contact.html`, CTA/hero/SEO copy. NEW 2026-08-11 (kostja94/marketing-skills). |
| `.agents/skills/accessibility-rules` | WCAG 2.2 rule reference — NOTE: document-oriented (Word/Excel/PPT/PDF); for web pages use `universal-ui-architect` gates instead. NEW 2026-08-11 (community-access/accessibility-agents). |

**When in doubt, load** `cloudflare`, `workers-best-practices`, and
`skeptical-code-audit` — they cover most edits in this repo. New skills: review their
contents before first use (skills run with full agent permissions).

---

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
| `OWNER-REVIEW.md` | ✅ in-repo (created 2026-08-12) | **Owner-only checklist** — secrets/credentials, deploys, product decisions, and visual review items that need Garfield in person. Agents: do not execute these; leave them for the owner (see PART E — OPERATIONAL). Owner: work through it and report back so the STATUS LOG updates. |

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
- [x] Real-time presence (Durable Objects) — RE-OPENED AND EXECUTED by Garfield
  (2026-08-12, "start on that isn't implemented"). Shipped: Presence DO
  (WebSocket Collab/Hibernation, per-project idFromName, roster of {id, name,
  since} only — never content), /api/cloud/presence with generic-403 auth
  (linked session / D1 owner+editor code / published-manifest sha256 code),
  wrangler.jsonc durable_objects binding + migration v1-presence, new
  js/mmgr-presence.js (project.html chip, backoff reconnect, 3-try 403 give-up,
  visibility-aware) + .presence-chip CSS. Verified: tools/qa-presence.cjs 11/11
  (npm run qa:presence) against real wrangler dev. Deploy note: the DO binding
  + migration deploy with the worker (auto-applied).
- [ ] Still deferred (explicitly, do not build unless re-opened): additional
  sign-in providers (Yahoo/Microsoft need their OAuth client IDs/secrets from
  the owner; email+password is self-contained and can be built on request),
  billing/subscription tier (needs a payment-provider decision + keys).

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
  Download & publish button; security  banner rewritten to describe real opt-in Drive
  behavior (admin codes never leave the device). DIR-3 gate glass: GATE-DECLUTTER commit
  (a8d69ee) applied the same header/setup treatment to both gate screens.

---

## PART E — Open Work Registry (added 2026-08-12)

> Source: an audit run 2026-08-12 comparing every action plan/directive against the
> repo. **The audit compared against committed HEAD — the working tree already carried
> the implementations below as UNCOMMITTED changes (sw v67–v69), so several of its
> "zero code exists" findings were stale. Real status per item, checked against the
> actual code, supersedes the audit text.**

### OPEN — the audit's two open items (both now closed, both verified this session)

- [x] **DASHBOARD-UI-REFRESH-SPEC.md** — dark portfolio-dashboard for `app.html`.
  IMPLEMENTED (sw v67, uncommitted) + DRIVEN TO 100% VERIFIED THIS SESSION. The audit's
  "Confirmed zero code exists (no --db-* tokens…)" was stale — the working tree has
  the full `--db-*` token block (css/mmgr.css:1776+), `body.db-page` + `#db-sidebar` /
  `#db-nav-btn` hamburger / `#db-scrim` / `#db-metrics` in app.html, `renderMetrics()`
  in js/mmgr-portfolio.js, and `toggleSidebar` in app.html's `DASH_ACTION_MAP` + aria
  sync + Escape close. **§0 scope ("app.html only") WAS owner-confirmed 2026-08-12** —
  recorded in the spec itself ("Scope CONFIRMED (2026-08-12, per owner: 'start on that
  isn't implemented')"); the audit's "never confirmed" is superseded, and the build is
  scoped exactly that way (`body.dark-mode.db-page`, light mode byte-untouched per §5).
  VERIFIED THIS SESSION: `tools/qa-dashboard-spec.cjs` 58/58 (tokens, markup wiring,
  no dead links, sprite icon refs, 9 measured WCAG pairs 11.07–17.24:1, CSP hash
  parity); `npm run verify` green (CSP 11/11, SW v69 > 46 assets, 16/16 skills);
  node --check clean on all touched JS; browser (agent-browser vs serve.cjs:8765) —
  §4 320px gate: no horizontal scroll (scrollW=320), drawer slides via transform with
  hamburger + scrim + aria-expanded + Escape close, metric row single-col @320 /
  3-col @1000, renderMetrics computed Active 2 / At-Risk 1 / Avg 62 from REAL rank()
  data, sidebar links all resolve, light mode: rail display:none + wrap margin 0, zero
  console errors on boot.
- [x] **BACKLOG.md B-N (AI-upgraded email templates / 'email' preset family)** —
  IMPLEMENTED (sw v68, uncommitted; owner go-ahead 2026-08-12 per BACKLOG.md). The
  audit's "logged only, not approved, not started" was stale. mmgr-prompts.js `email`
  generator (grounded, zero-fabrication prompt), mmgr-ai.js `PRESET_LABELS.email` +
  `LOCAL_BUILDERS.email` (returns static `App.emailTplText('status')` verbatim on the
  LOCAL tier — the guaranteed no-model fallback), js/mmgr-app.js `emailTplText(kind)`
  extracted as a pure getter under `emailTpl` (the one-click static buttons are
  unchanged). VERIFIED THIS SESSION: node --check clean, `npm run verify` green,
  `node qa-ai.cjs` → AI23_GATE PASS (incl. A17 presets reachable after a long
  conversation on a short viewport, A11 run-button/chip count ≥10 with the new preset).

### DEFERRED — do NOT start without the user explicitly naming one

- [x] Real-time presence (Durable Objects) — RE-OPENED + EXECUTED by Garfield
  2026-08-12 (see Part B): Presence DO + /api/cloud/presence + js/mmgr-presence.js +
  .presence-chip, sw v69, wrangler durable_objects binding + migration v1-presence,
  tools/qa-presence.cjs 11/11 (claimed vs real wrangler dev). DONE — no longer deferred.
- [x] Additional sign-in providers — **email + password COMPLETED + VERIFIED
  2026-08-12** (this session; see STATUS LOG — the "De Riviot" session's interrupted
  work finished end-to-end): worker.js routes wired for `/api/auth/register` +
  `/api/auth/login` (auth rate bucket 30/min — brute-force deterrent on the
  credential-guessing surface; PBKDF2-SHA256 100k iters via hashOwnerCode, per-account
  salt, timing-side-channel + create-race guards, `sub='email:<addr>'` namespace),
  migration 0007 auth_users, js/mmgr-google-auth.js email sign-in form (app.html +
  admin.html auth bars; same mmgr_session cookie; dispatches mmgr:google-signed-in),
  tools/qa-email-auth.cjs 26/26 gates. Yahoo/Microsoft still blocked (need their
  OAuth client IDs/secrets from the owner).
- [x] Billing/subscription tier — **server-side COMPLETE + VERIFIED 2026-08-12**: routes
  wired for `/api/billing/status` (session-gated) + `/api/billing/checkout` (session-
  gated) + the signature-verified `/api/billing/webhook` (the ONLY writer of
  cloud_subscriptions, migration 0006) + the session-linked FREE_PROJECT_CAP create
  gate in handleCloudCreate (HTTP 402 {upgrade:true} for free accounts over the cap,
  with the ACTIVE-SUBSCRIPTION exemption — qa-email-auth B5 caught a missing check).
  DORMANT until configured: with no LEMONSQUEEZY_* secrets set, status reports
  configured:false, checkout answers 503, and the cap is off — byte-for-byte unchanged
  behavior. **CLIENT UPGRADE UI COMPLETED + VERIFIED 2026-08-12** (same session):
  js/mmgr-cloud.js surfaces a real server 402 {upgrade:true} as a gold Upgrade-plan
  banner (i-zap, data-action=cloudUpgrade) instead of a bare error, and cloudUpgrade()
  POSTs the session-gated /api/billing/checkout and opens the checkout URL in a new
  tab (clears the banner only on 503 — billing genuinely unconfigured); mmgr-app.js
  ACTION_MAP + READONLY_SAFE_ACTIONS gain cloudUpgrade (opens a checkout tab — no
  local mutation). Inert when unconfigured — the server never 402s then, so the banner
  never renders. Browser-verified against the configured-phase harness origin (:8796,
  cap=2): register via the email form → create u1/u2 ok → u3 gets the banner +
  Upgrade button + "free plan limit reached" status; Upgrade click fires the checkout
  POST (upstream 401 with fake secrets — surfaced, banner persists); qa-email-auth
  26/26; npm run verify green (SW v73, CSP 11/11 unchanged).
- [x] UI-REDESIGN-CYAN-DASHBOARD-PLAN.md — **§7 decision points FORMALLY CLOSED
  2026-08-12** (superseded by the theme system; archived to `_archive/`): (1) full cyan
  pivot → theme system resolved it as HYBRID — cyan is an optional theme, gold stays
  default (`html[data-theme="cyan"]` + `mmgr_palette`, mmgr-theme.js); (2) light mode
  → BOTH light and dark remain (`data-theme=cyan` + `body.dark-mode` cyan block in
  css/mmgr.css:102,127); (3) sidebar grouping → SIDEBAR-HAMBURGER-TOGGLE-PLAN shipped
  grouped nav (Overview/Planning/Execution/Governance/Closeout/DMAIC — the dashboard
  refresh added its own app.html rail); (4) glass → universal-ui-architect Gate 6.1
  resolved it: glass chrome only, dense content solid; (5) priority → executed as
  bug-fixes-first (Claude audit Phase A), then theme tokens, then the mobile shell.
  File archived (not deleted) per the owner's keep-records rule.

### MASTER-ACTION-PLAN-v3-STRICT rank status (audited against shipped code 2026-08-12)

- [x] Phase 0 foundation — unload flush (mmgr-state.js; qa-stress D01) + Today/Meeting-to-Action (mmgr-meetings.js) + Narrative Health (mmgr-health.js) — all verified present.
- [x] Rank 1 Evidence/Claim Pack — js/mmgr-claim.js (1.1 claimPackText one-click export, 1.2 cause-tagged slips defaulting to "unknown", 1.3 LD exposure rollup avoided/incurred).
- [x] Rank 2 Digest Engine — js/mmgr-digest.js (2.1 weekly digest) + AI presets (2.2: PRESET_LABELS digest/audit/claim/client…, zero-fabrication discipline).
- [x] Rank 3 Progressive Disclosure — Core Mode vs packs (schema v18 packsEverEnabled), data-def inline glossary (project.html ×15 + mmgr-defs.js).
- [x] Rank 4 PWA/offline durability — SW mmgr-shell-v72, crash-safe journal (qa-stress DIR-4), offline gate harnesses (qa-pwa etc.).
- [x] Rank 5 Portfolio Explainability — mmgr-portfolio.js urgency score + plain-English reasons + weather-risk input (verified in the DASHBOARD-UI-REFRESH session).
- [x] **Rank 6.1 sanitized Report Issue export — EXECUTED 2026-08-12 (see STATUS LOG): new js/mmgr-report.js (counts-only by default, hard exclusion of budget figures/risk descriptions/names, per-report Include-project-context opt-in, never AI keys), project.html Controls-drawer Report Issue row (i-flag, Copy report/Download + toggle), tools/verify-report-issue.cjs 27/27.** Rank 6.2 (replay via qa-*.cjs fixtures) is satisfied by the existing fixture pattern — no separate patch-store product per the plan's own STOP clause.
- [x] Rank 7 Weather-Aware — mmgr-weather/forecast + daily log + wxCache risk days (feeds Rank 1/5).
- [x] **Rank 8 Projects-list visual weight — EXECUTED 2026-08-12 (see STATUS LOG): the
  LIGHT-mode flat-page gap fixed with the spec's option 1 (subtle radial glow behind
  #grid using the EXISTING --gold-rgb token at <10% alpha, three layered washes at
  different positions — no new colors per 8.1's constraint, no motion; scoped to
  body.db-page:not(.dark-mode), display:none in dark where the dashboard treatment owns
  the canvas, every other page untouched). Verified: glow computed-style confirmed in
  light, suppressed in dark, cards keep their own opaque surface + full text contrast
  (8.2), 4-card grid renders, zero console errors, qa-dashboard-spec 58/58, verify green
  (SW v74)."
- [x] **Rank 9 API/Webhook — EXECUTED 2026-08-12 (owner re-opened the plan's gate; see STATUS LOG): 9.1 read-only resource shapes (GET /api/cloud/projects/:id/api/:shape — tasks|baseline|risks|weather|evm|portfolio; owner-gated code/session; faithful worker ports of the app's EVM/health/wxRiskDays math; secrets can never leak — they're stripped at save + shapes only read whitelisted fields; editor codes 403; empty project → exists:false) + 9.2 opt-in webhooks (migration 0008 webhook_subscriptions; owner-gated POST/GET/DELETE /api/cloud/projects/:id/webhooks; scheduled() evaluator fires health_dropped + weather_risk_tomorrow with an HMAC-SHA256 X-MMGR-Signature header; reference-point last_value semantics for health drops + once-per-day guard for weather; ZERO rows = no-op — off by default; project.html Cloud drawer Webhooks section with event select + URL + List/Add/Remove + one-time secret display; mmgr-app.js cloudWebhookList/Add/Del wired). tools/qa-rank9-api.cjs 31/31 incl. real cron-driven deliveries via wrangler dev --test-scheduled.
- [ ] Rank 10 backlog — opportunistic, nothing pulled yet (owner picks from OWNER-REVIEW §3).

### OPERATIONAL — not a code task, needs the user present for deploy

> **OWNER-ONLY WORK IS TRACKED IN `OWNER-REVIEW.md`** (added 2026-08-12) — the
> single checklist of everything that needs the owner in person: secrets/credentials
> (LemonSqueezy ×3, Yahoo/Microsoft OAuth, GOOGLE_CLIENT_SECRET, ADMIN_CODE), the
> deploy sequence, product decisions, and visual review items. Agents: leave it for
> the owner; when the owner completes an item, update the STATUS LOG + this section
> and check it off there. The short list below mirrors it for quick reference.

- [ ] Apply migrations 0005 + 0006 + 0007 to remote D1: `npx wrangler d1 migrations
  apply my-manager-db --remote` — required before the worker deploy (0005: the
  changelog list hard-references import_key; 0006: cloud_subscriptions, 0007:
  auth_users — both now completed and part of the deploy). The presence DO binding +
  v1-presence migration deploy with the worker (auto-applied).
- [ ] `npm run deploy` — local verify is green (re-confirmed this session).
- [ ] Optional: real-Google round-trip of /api/cloud/prefs/theme.
- [ ] Set the LEMONSQUEEZY_API_KEY / LEMONSQUEEZY_WEBHOOK_SECRET / LEMONSQUEEZY_VARIANT_ID
  secrets to activate the (complete, verified, dormant) billing tier — see OWNER-REVIEW.md §1.1.
- [ ] Provide Yahoo + Microsoft OAuth client IDs/secrets to unblock those sign-in
  providers (email+password is done) — see OWNER-REVIEW.md §1.2.

### HOUSEKEEPING — no code impact, do in one small pass whenever convenient

- [x] **RECONSTRUCT (never drop) the missing directive files — ALL DONE 2026-08-12.**
  The 4 missing files (PROJECT-UX-NAV-WEATHER-EXPORT-DIRECTIVE.json,
  FINAL-PRE-DEPLOY-DIRECTIVE.json, FIELD-GUIDE-UPDATE-PLAN.md,
  MONOLITH-FEATURE-PARITY-DIRECTIVES.json) were reconstructed in the RANK-6.1 session;
  the chat-only base ACTION-PLAN-COMPETITIVE-GAPS.md was RECONSTRUCTED this session
  as a faithful flagged record from the addendum's phase cross-refs + master-plan
  Rank 10 absorption notes. All four others exist untracked (MASTER-ACTION-PLAN,
  GLASS-UI-DESIGN-SPEC, STRUCTURAL-IA-FIXES-SPEC, MONOLITH-PORTING-GUIDE) —
  reconciled in the skill §2 registry.
- [x] Consolidate the DUPLICATE root universal-ui-architect.md — DONE (byte-identical
  to the locked `.agents/skills/universal-ui-architect/SKILL.md`; root copy removed).
- [x] Archive the stray txts — DONE: both "this is where vthe last chat ended.txt"
  (its captured email+password work is completed + logged) and the old
  "Windows PowerShell from last session…" file moved to `_archive/` (kept, not
  deleted, per the owner's keep-records rule).
- [x] Confirm the "new update do everything…" folder's contents are fully executed —
  DONE + ARCHIVED to `_archive/`: CLAUDE-BUG-AUDIT-2026-08-11 (all 4 bugs verified
  fixed in shipped code: syncClientId whitelist, .shake keyframes, i-plus + i-shield
  sprite symbols), THEME-SYSTEM-AND-MOBILE-UI-ACTION-PLAN (theme system + cyan theme +
  hamburger/sidebar all shipped), UI-REDESIGN-CYAN-DASHBOARD-PLAN (§7 closed above).
  `_archive/` is excluded from deploy staging (`--exclude='_archive'` in wrangler.jsonc).

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

**2026-08-12 — Session: RANK-9-API-WEBHOOK — MASTER-ACTION-PLAN Rank 9 (API/webhook layer) implemented + verified; the plan's own deferral gate ("do not start until Rank 2 digest has real use") was explicitly re-opened by the owner naming the task.**
SHIPPED (worker.js): 9.1 — owner-gated GET /api/cloud/projects/:id/api/:shape with six stable READ-ONLY shapes (tasks/baseline/risks/weather/evm/portfolio) projected from the saved R2 state, built by pure dependency-free ports of the app's own math (apiEVM mirrors mmgr-evm computeEVM incl. spendLog actuals + curve-shape time-phased PV; apiPortfolio mirrors the 5-factor health formula; apiWeather mirrors wxRiskDays thresholds precip>=60||tMax>=32||tMin<=0). Secrets cannot leak by construction: stripStateSecrets runs at save, and the builders read only enumerated whitelisted fields. Auth = cloudAuthOwnerEither (owner code OR linked session) with the same generic-403 discipline; editor codes are rejected (R10). Empty project → 200 {exists:false, data:null}. 9.2 — OPT-IN webhooks (migration 0008 webhook_subscriptions): owner-gated POST/GET/DELETE /api/cloud/projects/:id/webhooks (event whitelist health_dropped|weather_risk_tomorrow, targetUrl must be http(s), per-subscription crypto.getRandomValues secret shown ONCE at create and never in the list); the scheduled() cron now calls evaluateWebhooks() — health_dropped stores last_value on EVERY run (a drop is a real comparison, never a first-run surprise) and weather_risk_tomorrow fires at most once per calendar day; delivery is a POST with an HMAC-SHA256 X-MMGR-Signature header + 10s timeout. ZERO subscription rows = the evaluator no-ops → dormant-until-configured, byte-for-byte unchanged behavior on the current deploy.
CLIENT: project.html Cloud drawer (owner mode) gains the Webhooks section — event select (Health score dropped / Weather-risk day tomorrow) + target URL input + Add Webhook (i-plus), List (i-refresh), per-row Remove with last-fired stamp, and the one-time signing secret in the status live region; mmgr-app.js ACTION_MAP + READONLY_SAFE_ACTIONS gain cloudWebhookList/Add/Del (server-table-only mutation, like the other cloud actions). sw.js mmgr-shell-v75→v76. package.json gains qa:rank9-api.
VERIFICATION: node --check clean (worker.js, mmgr-cloud.js, mmgr-app.js, sw.js, harness); npm run verify GREEN (CSP 11/11 — no inline scripts touched; SW v76 > 47 assets; 16/16 skills); tools/qa-rank9-api.cjs 31/31 against REAL wrangler dev (all migrations incl. 0008, --test-scheduled so the harness drives the ACTUAL scheduled() handler): R1 unknown shape 404, R2/R3 generic 403 (identical bodies), R4 tasks shape + secret-free payload, R5 baseline, R6 risks, R7 weather riskDays incl. tomorrow, R8 evm (spi/cpi finite), R9 portfolio score, R10 editor 403, R11 empty project; W1-W7 CRUD/validation/owner-only + list-never-leaks-secret; W8 first eval stores reference (weather fires — correct, the fixture's tomorrow IS a risk day) then a genuinely-lower health state fires a signed delivery (previousScore>currentScore asserted), W8b/W8c HMAC verifies with the returned secret and fails with a wrong one, W9 second eval same day fires nothing (once-per-day + no new drop), W9b weather delivered at least once, W10-W12 delete/404/label. BROWSER (agent-browser vs a persistent wrangler dev on the harness persist dir): signed in as the linked owner via the email form, recovered the owner code through the linked session, drawer rendered the Webhooks section; List showed the harness's weather webhook with its last-fired stamp; Add posted a new health_dropped webhook and displayed the one-time secret; Remove deleted it (rows 2→1, "Webhook removed."); GET /api/cloud/projects/rank9proj/api/portfolio returned score 36 / atRisk true from the browser; zero console errors.
NOTE (harness learnings): (a) wrangler dev --test-scheduled is the honest way to exercise the cron evaluator — the first draft simulated delivery instead and that was wrong; (b) adding budget-backed tasks to "worsen" a fixture can RAISE the health score (f3 via cpi) and mask a drop — the worse state added open issues only; (c) the email form mounts on app.html not project.html, and the recover rate bucket needs a 60s window before the owner code can be fetched via session.
NEXT per the sweep: the MASTER-ACTION-PLAN is now executed through Rank 9 — only Rank 10 (backlog, owner-picked per OWNER-REVIEW §3) and the owner-blocked items remain (deploy: migrations 0005-0008 + v1-presence to remote D1 then npm run deploy; LemonSqueezy secrets; Yahoo/Microsoft OAuth; digest real-use before any Rank-9-adjacent extension).

**2026-08-12 — Session: BILLING-UPGRADE-APP-DASH — free-plan status + Upgrade button surfaced on the app.html projects page (not just the project drawer); the OWNER-REVIEW §1.1 placement decision resolved.**
Per the owner's follow-up to the OWNER-REVIEW file ("surface the free-plan limit and upgrade button on the app.html projects page"): SHIPPED — js/mmgr-cloud-dash.js gains loadPlan() (fetches the session-gated /api/billing/status after the project list, renders the #cloud-dash-plan strip: "Free plan — N of M linked projects" + i-zap Upgrade button; "Pro plan — unlimited linked projects" line when active; gold .at-limit state when count >= cap) and upgradePlan() (POST /api/billing/checkout, opens checkoutUrl in a new tab, 503 → "billing not configured" warn, other failures surfaced in the existing live-region status line) — both wired through the module's existing delegated click handler (data-cd-upgrade), keeping the module self-contained (no MMGR deps — it loads before mmgr-utils.js). app.html: #cloud-dash-plan slot between the cloud-dash head and list + .cd-plan styles in its inline style block (token-driven: --border/--slate/--text/--tile-bg/--gold-rgb, .at-limit gold wash; .btn width:auto — app.html's dashboard .btn is width:100%). css/mmgr.css: dark db-page override (solid --db-surface, --db-text-secondary, cyan .at-limit rgba(80,232,244,…) — matches the existing .cd-* treatment). sw.js mmgr-shell-v74→v75.
VERIFICATION: node --check clean; npm run verify GREEN (CSP 11/11 — no inline scripts touched; SW v75 > 47 assets; 16/16 skills); qa-email-auth 26/26 (B1 already asserts the exact /api/billing/status shape the strip reads: configured:true, plan free, projectCap 2, projectCount); BROWSER E2E vs the harness's configured origin (:8796, cap=2): fresh account registered via the email form → strip renders "Free plan — 0 of 2 linked projects" + Upgrade button (dash visible, plan visible); created 2 cloud projects → reload → "Free plan — 2 of 2 linked projects — limit reached" + .at-limit gold border/bg (rgba(180,83,9,.45)/.08 light; rgba(80,232,244,.4)/.08 + cyan text in dark db-page — after unregistering the stale SW cache from the earlier harness run, which had served pre-edit CSS); Upgrade click → checkout POST fired → upstream 401 with fake secrets surfaced in the status line (expected; the 503/unconfigured path hides the strip entirely — verified dormant origin :8765 shows plan hidden + dash hidden); zero console errors. NOTE: an active SW from the PREVIOUS harness run served stale CSS on :8796 — unregister/refresh needed after any harness restart; not a code bug (production SW bump handles it).
NEXT: the billing tier is now fully surfaced client-side (drawer banner + app.html strip). Remaining owner-blocked: the deploy (migrations 0005–0007 + v1-presence to remote D1, then npm run deploy), LemonSqueezy secrets to activate the tier, Yahoo/Microsoft OAuth credentials, and the Rank 9 digest real-use gate — all tracked in OWNER-REVIEW.md.

**2026-08-12 — Session: OWNER-REVIEW-FILE — new OWNER-REVIEW.md tracks everything only the owner can do; the directive now references it from PART E (OPERATIONAL) + the REFERENCED FILES table.**
Per the owner ("there are things only I can review — create a file connected to the continuous directive, listing what only the owner can do; I'll go review it"): created `OWNER-REVIEW.md` — a single self-maintaining checklist that future sessions read and the owner works through. Sections: §1 secrets/credentials (LemonSqueezy ×3: API key/webhook secret/variant id — activates the complete-but-dormant billing tier; Yahoo + Microsoft OAuth client IDs/secrets — the only blockers to those sign-in providers since email+password is done; confirm GOOGLE_CLIENT_SECRET + ADMIN_CODE Wrangler secrets); §2 deploy operations (migrations 0005–0007 + v1-presence to remote D1, then npm run deploy — nothing committed/deployed yet, all work uncommitted in the tree); §3 product decisions (Rank 9 digest real-use gate, Rank 10 backlog picks, Rank 8 glow treatment confirmation, presence chip visibility, 12-month auto-purge vs paying accounts, email+password on marketing site); §4 visual/UX review items the owner should eyeball (dark dashboard, light-mode glow, Report Issue, billing banner, email form, presence chip); §5 housekeeping closes (reconstructed directive files, _archive/ restore). Wire-in: CONTINUATION-DIRECTIVE.md PART E — OPERATIONAL now opens with a pointer block ("OWNER-ONLY WORK IS TRACKED IN OWNER-REVIEW.md") and mirrors the top 3 deploy/secret items for quick reference; REFERENCED FILES table gains the OWNER-REVIEW.md row (agents: do not execute — leave for the owner; owner: report back so STATUS LOG updates). Nothing committed per the owner's standing rule. NEXT: owner reviews OWNER-REVIEW.md; agents resume with whatever the owner directs (deploy, secrets, or new code items).

**2026-08-12 — Session: RANK-8-VISUAL-WEIGHT — MASTER-ACTION-PLAN Rank 8 (projects-list visual gap, light mode) implemented + verified; the plan's only remaining rank was the cosmetic light-page gap.**
Per the owner's standing instruction (keep pulling uncompleted registry items, update the directive after each, make conventional choices — pick the recommended option — instead of stopping to ask): MASTER-ACTION-PLAN Rank 8.1's three options are (a) radial glow in existing accent tokens, (b) blueprint-grid texture, (c) per-card thumbnails. The owner's recommended-option rule + the plan's own "pick one, don't stack" + "no new colors" constraint → chose (a): a STATIC three-layer radial glow behind #grid, using ONLY the existing --gold-rgb token (light theme 180,83,9 — verified in computed style) at .10/.07/.05 alpha, positioned top-left / top-right / bottom so it reads as depth not a blob. SHIPPED: css/mmgr.css new scoped block — body.db-page:not(.dark-mode) #grid{position:relative;isolation:isolate} + #grid::before{z-index:-1;pointer-events:none} with the three radial washes; body.db-page.dark-mode #grid::before{display:none} (the dark dashboard treatment owns that canvas — its .db-side rail + solid surfaces + --db-canvas already carry the weight); prefers-reduced-motion guard. No markup, no JS, no new colors, no tokens — the SW shell needed only a bump (mmgr-shell-v73→v74) because css/mmgr.css is a shell asset. Scoped so EVERY other page (and every other theme block) is byte-for-byte untouched.
VERIFICATION: node --check clean (no JS touched); npm run verify GREEN (CSP 11/11 — CSS-only, no inline scripts touched; SW v74 > 47 assets; 16/16 skills); tools/qa-dashboard-spec.cjs 58/58 (the dashboard CSS block + app.html inline scripts untouched); BROWSER (agent-browser vs serve.cjs:8765): app.html boots, #grid::before computed backgroundImage is the gold radial-gradient in LIGHT mode (rgba(180,83,9,.1) — the token, not a hardcoded hex), flips to none when body.dark-mode is added (suppressed), cards render with their own opaque rgb(255,255,255) surface + rgb(15,23,42) text (8.2 readability untouched — the <10% wash never sits between text and background), a 4-card grid renders under the glow, zero console errors. (Note: renderCards() reads window.MMGR_PROJECTS at boot — the reseed had to call renderCards() directly after setting the global; that's the page's existing contract, not a bug.)
NEXT per the sweep: the plan is now fully executed through Rank 8 — the remaining ranks (9 API/webhook, 10 backlog) are EXPLICITLY deferred by the plan itself (Rank 9 waits until the digest engine has been used manually for a real project cycle; Rank 10 is opportunistic). Registry status: all OPEN code items are done; what remains genuinely needs the owner — the deploy (migrations 0005–0007 to remote D1, then npm run deploy; local verify green), Yahoo/Microsoft OAuth client IDs/secrets, and the Rank 2 digest-engine real-use gate before Rank 9 can start.

**2026-08-12 — Session: BILLING-UPGRADE-UI — the client half of the billing tier shipped: a 402 is now surfaced as an Upgrade-plan affordance in the cloud drawer (the last server-completed-but-client-missing piece from the email+password session).**
Per the owner's standing instruction (keep pulling uncompleted registry items one at a time, update the directive after each, make conventional choices instead of stopping to ask): the remaining billing item was "the client upgrade UI — surface a 402 into the cloud drawer's checkout flow." SHIPPED: js/mmgr-cloud.js — new module flag _upgradePending set only when createProject() receives a real server 402 {ok:false, upgrade:true} (the session-linked FREE_PROJECT_CAP gate); render() then injects a gold Upgrade-plan banner into the cloud section (existing .sr/.sr-hint styling + i-zap + data-action=cloudUpgrade + role=status) with copy "Free plan limit reached — you've used all the linked cloud projects on the free plan"; new cloudUpgrade() POSTs the session-gated /api/billing/checkout (credentials same-origin) and window.open()s the returned checkoutUrl (noopener, new tab), clearing the banner only on a 503 (billing genuinely unconfigured — "no upgrade is available" warn) and surfacing other checkout errors in the live-region status line. js/mmgr-app.js: ACTION_MAP + READONLY_SAFE_ACTIONS gain 'cloudUpgrade' (it opens a checkout tab — never mutates the local workspace, matching the cloud-actions precedent). sw.js mmgr-shell-v72→v73. Dormant-until-configured is preserved BY CONSTRUCTION: the banner only appears when the server actually answers 402, which requires all three LEMONSQUEEZY_* secrets — on the current unconfigured deploy the path is inert, byte-for-byte unchanged.
VERIFICATION: node --check clean; npm run verify GREEN (CSP 11/11 unchanged — JS-rendered, no inline scripts touched; SW v73 > 47 assets; 16/16 skills); qa-email-auth 26/26 (B2 already asserts the exact 402 {upgrade:true} contract the client keys off; B5 the active-sub exemption; re-run green with clean teardown); BROWSER E2E against the harness's configured-phase origin (:8796, FREE_PROJECT_CAP=2): registered a fresh account through the real email form (session confirmed via /api/auth/me — sub email:upgrade.tester.e2e@example.com), created cloud projects u1 + u2 ok (owner codes issued), u3 → 402 → **gold banner rendered with Upgrade plan button** + status "free plan limit reached — upgrade to create more linked projects"; clicked Upgrade → checkout POST fired → upstream 401 with fake secrets surfaced in the status line (expected) and the banner correctly persisted (only 503 clears it); zero console errors. (The checkout-open-success path itself can't be exercised without real LemonSqueezy credentials — covered by the worker handler + harness's own checkout route tests.)
NEXT per the sweep: MASTER-ACTION-PLAN Rank 8 (projects-list visual weight in LIGHT mode — the dark dashboard treatment covered dark; pick ONE of radial glow / blueprint texture / card thumbnails per the plan's own constraint), then the remaining owner-blocked items (deploy with migrations 0005–0007 to remote D1, Yahoo/Microsoft OAuth credentials).

**2026-08-12 — Session: STRUCTURAL-IA-VERIFIED + HOUSEKEEPING-CLOSED — STRUCTURAL-IA-FIXES-SPEC fully verified against shipped code; UI-REDESIGN §7 formally closed; archive + reconstruction pass done.**
Per the owner's standing instruction (keep pulling uncompleted registry items, update the directive after each, repeat until something genuinely needs the user):
1) **STRUCTURAL-IA-FIXES-SPEC.md audited against shipped code — FULLY VERIFIED IMPLEMENTED (CLOSED):** §1 empty states (ring says "No tasks yet" on a fresh project — never a bare 0 or "All tasks completed"; N3 gives a real + Add Task action; budget/util/pending/base cards quiet to '—' with var(--slate) + explanatory subtext, .tier3 CSS); §2 grouped nav (12 .nav-group blocks with eyebrow labels + dividers in project.html, .nav-group-label, active-pill clarity via .sec-nav .sec-btn.active box-shadow+green — verified strongest signal); §3 session timer REMOVED (no updateSessionTimer / #sess-t anywhere; grep clean); §4 tiering (health-card.has-danger for non-zero Blocked/Overdue/Live-Issues — existing --danger token, no motion per §4.3; .has-danger + .health-empty CSS in mmgr.css:320-323); §5 progressive disclosure (10+ emptyStateRow call sites — risks/issues/resources/budget/stakeholders/changes/decisions/comms/docs with direct data-action buttons, plus wbs-empty, meet-empty, .es kanban, RACI empty state — every panel covered); §6 copy pass ("No risks logged yet." plain-voice, exact-verb buttons). §8 TESTING CHECKLIST verified in-browser (agent-browser vs serve.cjs:8765): 12 nav groups / 38 sec-btns all reachable / active pill clear / sess-t absent; seeded a BRAND-NEW project (?id=p1, zero tasks) — ring "No tasks yet", N3 "No tasks yet — add your first task…", budget '—' + "No budget lines yet — add one in Budget", health-empty=true, has-danger=false. No code changes needed — the spec's work was already fully shipped (by the earlier THEME-SYSTEM + IA sessions).
2) **UI-REDESIGN-CYAN-DASHBOARD-PLAN §7 decision points FORMALLY CLOSED** (5/5, each resolved by shipped code — see Part E): cyan pivot → hybrid via theme system; light mode → both modes retained; sidebar grouping → shipped nav groups; glass → Gate 6.1 chrome-only; priority → bugs-first execution confirmed. Plan archived (never dropped).
3) **HOUSEKEEPING COMPLETE:** `_archive/` created — moved the fully-executed "new update do everything…" folder (CLAUDE-BUG-AUDIT 4/4 bugs verified fixed: syncClientId change-whitelist js/mmgr-app.js:2463, .shake keyframes mmgr.css:161-164, i-plus + i-shield in sprite; theme system + cyan + hamburger/sidebar verified) and both stray session txts. wrangler.jsonc staging recipe now excludes `_archive`. Base ACTION-PLAN-COMPETITIVE-GAPS.md RECONSTRUCTED as a faithful flagged record (from the v2 addendum's phase cross-references — Phase 1.1 Today Decision Engine, 2.3 Procurement Lead-Time, 3.3 PM Consistency, 6.1 Portfolio Rollup — and MASTER-ACTION-PLAN Rank 10 absorption notes); skill §2 registry synced with STRUCTURAL-IA (CLOSED) + archive rows.
VERIFICATION: node --check not needed (no code changed — pure audit/archive/documentation pass); grep evidence above; browser checks live. NEXT per the sweep: the billing client upgrade UI (surface a 402 into the cloud drawer — the one remaining server-completed-but-client-missing piece), then Rank 8 light-mode visual weight.

**2026-08-12 — Session: RANK-6.1-REPORT-ISSUE — MASTER-ACTION-PLAN Rank 6.1 (sanitized Report Issue export) built + verified; the plan's rank registry established in Part E.**
Per the owner's standing instruction (keep pulling uncompleted registry items one at a time, update the directive after each, make conventional choices instead of stopping to ask): first AUDITED MASTER-ACTION-PLAN-v3-STRICT.md against shipped code — Phase 0 (unload flush mmgr-state.js/qa-stress D01 + Today/Meeting-to-Action mmgr-meetings.js + Narrative Health mmgr-health.js) verified; Rank 1 (js/mmgr-claim.js: 1.1 claimPackText export, 1.2 cause-tagged slips defaulting to "unknown", 1.3 LD exposure rollup avoided/incurred); Rank 2 (mmgr-digest.js + PRESET_LABELS digest/audit/claim/client); Rank 3 (Core Mode packs schema v18 + data-def glossary ×15 in project.html); Rank 4 (PWA v72 + crash journal); Rank 5 (portfolio urgency + reasons); Rank 7 (weather/forecast/daily log) — ALL PRESENT. **THE GAP: Rank 6.1 (sanitized "Report Issue") had zero implementation anywhere.**
SHIPPED: new js/mmgr-report.js (self-contained, zero-network, mirrors the mmgr-presence.js module pattern): PURE reportIssueText(state, errs, opts) builder — schema/app version, active panel, packs ON/OFF, NON-SENSITIVE COUNTS only (tasks/issues/risks/budget-lines/changes/meetings/decisions), client error-log slice (last 20, ts+action+msg); HARD RULE per the plan: the default payload NEVER includes budget dollar figures, risk descriptions, or personal names — a per-report Include-project-context opt-in (session-only, default OFF) adds project name, task/risk/issue lists, and budget totals; AI keys never appear in either mode (only enumerated fields are read). buildPackage() reads live state + DOM (active panel, viewport, theme, UA); copyPackage/downloadPackage reuse the existing clipboard + Blob-download patterns. project.html: Controls drawer gains the Report Issue row (i-flag icon — the conventional report glyph per the owner's recommended-option rule; Copy report / Download buttons + Include project context toggle) — READONLY_SAFE (reporting mutates nothing). mmgr-app.js wires reportIssueCopy / reportIssueDownload / tglReportContext (exports + ACTION_MAP + READONLY_SAFE_ACTIONS). sw.js mmgr-shell-v71→v72 (+js/mmgr-report.js in the SHELL). NEW gate tools/verify-report-issue.cjs (npm run qa:report-issue): 27/27 — R1 skeleton (header/schema/panel/packs/counts/error-log + canonical 5-pack order), R2 HARD EXCLUSIONS (a planted set of name/sponsor/task-name/risk-description/issue-description/budget-figures/meeting/stakeholder/API-key strings — every one absent from the sanitized payload), R3 opt-in includes names + figures but STILL never the AI key, R4 zero-fabrication on an empty project.
VERIFICATION: node --check clean (all touched JS); npm run verify GREEN (CSP 11/11 unchanged — no inline scripts touched, SW v72 > 47 assets, 16/16 skills); tools/verify-report-issue.cjs 27/27; BROWSER (agent-browser vs serve.cjs:8765, local-owner bypass project): Controls drawer renders the Report Issue row + toggle, buildPackage(false) excludes the project name + budget figures while buildPackage(true) includes them, a REAL Copy report click through the delegated data-action handler fires the success toast, zero console errors. (First eval attempt tripped on a stale page — the project.html gate redirects to app.html when no state is seeded at first load; re-opened after seeding localStorage, page booted fine. Not a bug.)
NEXT per the sweep: reconstruct the 4 missing directive files (owner rule: reconstruct, never drop), then the billing client upgrade UI (surface a 402 into the cloud drawer), then consolidate the duplicate root universal-ui-architect.md. Remaining user-required items after that: deploy (migrations 0005–0007 to remote D1), Yahoo/Microsoft OAuth credentials, Rank 8 light-mode visual-gap decision.

**2026-08-12 — Session: EMAIL-PASSWORD-AUTH-COMPLETED — De Riviot's interrupted email+password sign-in + billing-tier work finished end-to-end, verified against real code.**
Per the owner ("complete what was left from the last chat"): the last session's capture ("this is where vthe last chat ended.txt") stopped mid-edit right after `authHashPassword` in worker.js — the handlers existed but were NEVER WIRED: /api/auth/register + /api/auth/login had no routes, /api/billing/status + /api/billing/checkout had no routes, and the billing FREE_PROJECT_CAP create gate was comment-only. COMPLETED THIS SESSION:
WORKER.JS: register/login routes wired behind the same-origin gate with a new CLOUD_RATE.auth bucket (30/min — the brute-force deterrent for the credential-guessing surface; register shares it for spam parity); /api/billing/status (session-gated) + /api/billing/checkout (session-gated) on the general bucket; the webhook keeps its pre-gate exemption (HMAC, not origin, is its auth); handleCloudCreate now enforces the cap — session-linked FREE accounts over FREE_PROJECT_CAP (default 3, env-overridable) get HTTP 402 {upgrade:true} with the ACTIVE-SUBSCRIPTION EXEMPTION (qa-email-auth B5 caught my first version missing it — a cap must gate free accounts, never block a paying one). Dormant-until-configured: with no LEMONSQUEEZY_* secrets set, status → configured:false, checkout → 503, cap off — byte-for-byte unchanged.
CLIENT: js/mmgr-google-auth.js gains the EMAIL+PASSWORD form (toggle + login/register modes, name field in register, autocomplete email/current-password|new-password, password cleared after every attempt, role=status live region incl. the 429 message, focus-on-open) mounted next to #google-signin-button on the app.html + admin.html auth bars — JS-rendered, so ZERO CSP hash churn (11/11 unchanged). Success path reuses showUser's chip and dispatches mmgr:google-signed-in, so the project.html cloud drawer (which re-reads /api/auth/me) refreshes; sign-out resets the form to login mode (review fix). css/mmgr.css: token-driven .email-auth block (solid --tile-bg per Gate 6.1, app-wide gold focus ring, .email-auth .btn width override for app.html's dashboard width:100%). js/mmgr-cloud.js: drawer "Signed in with Google" → provider-neutral "Signed in —" (email sessions land there too; recovery is sub-match gated, provider-agnostic). sw.js mmgr-shell-v70→v71 (v70 was the feature; v71 the review pass — reset-login-mode + btn width).
HARNESS: NEW tools/qa-email-auth.cjs (npm run qa:email-auth) — 26/26 gates, TWO phases against real wrangler dev (local D1+R2, migrations incl. 0006/0007, GOOGLE_CLIENT_SECRET var): PHASE 1 dormant (no LS secrets — matches current prod): validation 400s, register → 200 + Set-Cookie + sub 'email:<addr>' + NO password_hash/password in the response, duplicate 409, unknown-email vs wrong-password 401s byte-identical (timing guard), /me, mixed-case+spaces normalization, no-cookie 403 generic, email session creates a cloud project (linked:true) + loads it (sub-match accepts the email namespace), account isolation (bob can't see/load alice's), billing dormant (status configured:false, checkout 503), name >80 sliced to 80, logout → /me null, prefs R2 round-trip on the email sub, 40-login rate burst → ≥1 401 then ≥1 429 with Retry-After. PHASE 2 configured (fake LS secrets + FREE_PROJECT_CAP=2): status configured:true projectCap 2 plan free, 2 creates ok → 3rd 402 {upgrade:true}, HMAC-signed subscription_created webhook upserts (the ONLY writer of cloud_subscriptions), status flips active/plan pro, active sub clears the cap (the B5 fix), bad signature 401 + test_request 200 ignored. Harness tears down cleanly via its stop file.
VERIFICATION: node --check clean (worker.js, mmgr-google-auth.js, mmgr-cloud.js, sw.js, harness); npm run verify GREEN (CSP 11/11 — no inline scripts touched; SW v71 > 46 assets; 16/16 skills); qa-dashboard-spec 58/58 (no regression from the CSS addition); BROWSER E2E (agent-browser vs the harness's live wrangler origin :8796): app.html toggle → register mode (name field + new-password) → submit → chip "Dave Browser" + /api/auth/me confirms sub email:dave.browser.e2e@example.com + password cleared + form collapses; sign out → form reappears in LOGIN mode; login → chip again; admin.html mounts the form too; ZERO console errors.
REMAINING (all recorded, none blocking): the billing tier's CLIENT upgrade UI (surface a 402 into the cloud drawer with an upgrade/checkout affordance) is a product decision for the owner — the server is fully gated and dormant-until-configured, so nothing ships broken; Yahoo/Microsoft sign-in still needs their OAuth client IDs/secrets; deploy must now apply migrations 0005 + 0006 + 0007 to remote D1 before the worker deploy; the Part E HOUSEKEEPING pass (reconstruct-or-drop the missing directive files, duplicate universal-ui-architect.md, stray txt, old folder) is still open.

**2026-08-12 — Session: PART-E-OPEN-WORK-REGISTRY — audit findings folded in with REAL statuses; picked DASHBOARD-UI-REFRESH-SPEC from the OPEN list and drove it to 100% verified.**
Per the audit instruction passed in (add Part E with exact checkbox items, update the STATUS LOG, pick ONE OPEN item, work it to 100% verified, touch nothing deferred): Part E is now in this file (above VERIFICATION WORKFLOW) recording REAL status per item — the audit itself ran against committed HEAD and its "zero code exists / logged only, not started" findings were STALE vs the uncommitted working tree (sw v67–v69). VERIFIED ACTUAL STATE: both OPEN items are implemented + uncommitted (DASHBOARD-UI-REFRESH-SPEC sw v67 incl. --db-* token block css/mmgr.css:1776+, app.html body.db-page/#db-sidebar/#db-nav-btn/#db-scrim/#db-metrics + DASH_ACTION_MAP toggleSidebar, js/mmgr-portfolio.js renderMetrics; BACKLOG B-N sw v68 incl. mmgr-prompts.js email generator, mmgr-ai.js PRESET_LABELS/LOCAL_BUILDERS.email, mmgr-app.js emailTplText pure getter) and real-time presence is DONE (sw v69, Part B — re-opened by Garfield, no longer deferred). §0 scope of the dashboard spec WAS owner-confirmed 2026-08-12 (recorded in the spec itself) — the audit's "never confirmed" is superseded, implementation is app.html-only scoped, light mode byte-untouched.
PICKED: DASHBOARD-UI-REFRESH-SPEC (first OPEN item). Driven to 100% this session: tools/qa-dashboard-spec.cjs 58/58 (tokens, no dead links, sprite refs, 9 WCAG pairs 11.07–17.24:1, CSP hash parity); npm run verify GREEN (CSP 11/11, SW v69 > 46 assets, 16/16 skills); node --check clean on all touched JS; BROWSER (agent-browser 0.33.2 vs serve.cjs:8765, viewport via CDP Emulation.setDeviceMetricsOverride): @320px — no horizontal scroll (scrollW==clientW==320, the spec §4 hard gate), drawer off-canvas → transform slide-in to left:0, hamburger + scrim + aria-expanded + Escape close all work, metric row single-col; renderMetrics rendered Active 2 / At-Risk 1 / Avg 62/100 from REAL rank() data (localStorage mmgr_unlocked_/mmgr_state_ fixtures — earlier 0/0/— was my thin fixture reading as locked, not a code bug) — no invented numbers; @1000px — fixed 240px rail, .wrap margin-left 264px, hamb hidden, metrics 3-col, all 3 db-links resolve; light mode — rail display:none + margin 0 (spec §5); zero console errors on boot.
B-N (second OPEN item) also re-verified this session while the server was up: node qa-ai.cjs → AI23_GATE PASS (A17 presets reachable, A11 chip count ≥10 with the new email preset). BOTH OPEN ITEMS NOW CLOSED in Part E.
⚠️ FLAGGED FOR OWNER (recorded in Part E, NOT touched per the DEFERRED rule): the interrupted last session left PARTIALLY-BUILT, UNCOMMITTED deferred work in the tree — email+password auth (worker.js /api/auth/register|login ~1852+, migration 0007 auth_users.sql, server-side only, NO client UI, NO harness) and the billing tier (migration 0006 cloud_subscriptions.sql + worker.js /api/billing/webhook|status|checkout + free cap, DORMANT until LEMONSQUEEZY_* secrets are set — behavior unchanged while unconfigured). Decide: finish them (wire UI + harnesses, deploy with 0006/0007) or revert the worker.js/migration deltas.
NEXT (all optional, none blocking): owner decision on the auth/billing question above; npm run deploy (apply migration 0005 to remote D1 first — `npx wrangler d1 migrations apply my-manager-db --remote`); real-Google round-trip of /api/cloud/prefs/theme; the Part E HOUSEKEEPING pass (reconstruct-or-drop the 4 missing directive files + the chat-only plans, remove the duplicate root universal-ui-architect.md, delete the stray txt once the auth decision is made, archive the "new update do everything…" folder). Dev server left running on :8765.

**2026-08-12 — Session: SIDEBAR-HAMBURGER-TOGGLE — the SIDEBAR-HAMBURGER-TOGGLE-PLAN.md executed in full.**
Per Garfield ("read the plan and the continuation directive, then execute the plan"): added the
opt-in desktop sidebar + unified hamburger, wired the device preference end-to-end, and applied
the dashboard alignment pass. Scope stayed exactly as the plan states — no theme work, no feature
removal, the existing horizontal .sec-nav pill nav is untouched and stays primary by default.
DESKTOP SIDEBAR: new `#app-sidebar` rail (~240px, below the sticky header, solid card surface per
Gate 6.1) in project.html AFTER `</main>` (so document.querySelector first-matches keep pointing
at the original top nav — programmatic showSection still highlights the top pill). Its content is
built by new `buildSidebar()` in js/mmgr-app.js: it CLONES the .sec-nav `.nav-group`s (one source
of truth — links/actions can never drift), strips ids (originals keep gnav/knav/dmaic-nav), and a
MutationObserver mirrors `.is-hide` from originals to clones forever (active-state sync is already
global via showSection). Pack/methodology gates now cover the clones: mmgr-render.js renderPacks
uses `data-dual-gate` (added to the dmaic button) instead of `id === 'dmaic-nav'`, and
renderMethodology toggles every `.sec-btn[data-section="dmaic"]` instead of the id only.
PREFERENCE (plan §5-6): localStorage `mmgr_sidebar` = 'on'|'off', default 'off' (current users see
zero change). TWO body classes per code review: `sidebar-on` = the persisted layout PREF (shows the
hamburger on desktop; drives the settings switch) and `sidebar-open` = the TEMPORARY visible state
(the rail + #app-main 240px shift follow this — the hamburger, × button, and Escape toggle only the
temporary state, so closing never disables the preference and the hamburger stays one click away;
next load re-opens whenever the pref is on). ≤768px the rail is display:none and the EXISTING
off-canvas .sec-nav drawer remains the only mobile nav. a11y: the hamburger's aria-expanded is
VIEWPORT-AWARE (mobile tracks the drawer, desktop tracks sidebar-open — the code-review catch that
closeNav/syncSidebarChrome were pref-blind left it stale on mobile with the pref on). Backend: the session-gated R2 prefs blob (worker.js
/api/cloud/prefs/theme) gains a nullable `sidebar` field (cloudSanitizeSidebar; GET returns it in
theme.sidebar, PUT accepts 'on'|'off' and merges — palette/dark untouched; qa-prefs-roundtrip
contract preserved since P5-P12 only assert palette/dark presence). Client push on toggle
(PUT {sidebar}), one-per-load pull mirroring mmgr-theme.js (only when mmgr_palette_backend==='1'
AND no local mmgr_sidebar yet, with a _sidebarUserTouched race guard). HAMBURGER: tglNav now
dispatches by viewport — ≤768px toggles the drawer (unchanged), desktop toggles the sidebar pref;
bindNavDismiss installs Escape/resize/section-click closes at init (not lazily) so Escape also
closes a boot-opened sidebar. SETTINGS: Controls drawer gains a "Sidebar Layout" .tgl switch
(#sb-tgl, i-menu icon) next to the Color Theme row + hint; sidebar rail has a close button
(data-action tglSidebar). Focus Mode hides #app-sidebar and resets the margin (dead-band fix);
print hides it too; reduced-motion kills only its transition (transform:none deliberately NOT
applied — the rail's open state is transform-driven). DASHBOARD ALIGNMENT (plan's ready-to-paste
item): #panel-dash .g3 wraps via auto-fit minmax(250px,1fr), each top card is an equal-height
flex column, health rows gain consistent padding + right-aligned badge min-widths, Next-3 list
gets breathing room — data untouched. The mobile media blocks re-assert #panel-dash .g3 with
SAME specificity (a plain .g3 media rule would lose to #panel-dash .g3 in the cascade — the
second code-review catch), so ≤768 stays 2-col and ≤520 stays 1-col. sw.js mmgr-shell-v64→v65. CODE REVIEW (Nit-Pick pass) closed 3 findings, all fixed in-place: (1) aria-expanded stale on
mobile when the pref was on — now viewport-aware everywhere; (2) #panel-dash .g3 specificity
silently killed the mobile .g3 media rules — same-specificity re-asserts added; (3) ×/Escape were
turning the preference OFF (and hiding the hamburger, leaving no quick reopen) — replaced with
the sidebar-on/sidebar-open two-state model above. VERIFICATION: node --check clean (all touched
JS), npm run verify GREEN (CSP 11/11 hashes unchanged — no inline scripts touched, SW v65 > 45
SHELL assets, 16/16 skills), tools/qa-prefs-roundtrip.cjs 15/15 PASS (worker prefs contract
intact with the new sidebar field, clean stop-file teardown), browser smoke via serve.cjs:8765
(browser-use, two rounds): boot-with-pref-on, hamburger/×/Escape temporary close keeping
mmgr_sidebar='on', settings switch off/on ('off' persisted), mobile drawer at 480px with correct
aria-expanded, 500px dashboard renders 1 column, sidebar clones keep pack-gated visibility
(Money pack off hides Budget/Resources in BOTH navs), active-state sync between both navs,
reload persistence, zero functional console errors. NEXT
(unchanged, optional): deploy (migration 0005 already applied remotely is required before the
worker deploy), real-Google round-trip of /api/cloud/prefs/theme incl. the new sidebar field.

**2026-08-12 — Session: PREFS-ROUNDTRIP — /api/cloud/prefs/theme exercised with REAL (cryptographically valid) Google sessions, cross-device sync proven in-browser. EXECUTED.**
Per Garfield: exercise the theme-prefs round-trip with a real Google session and confirm the palette syncs across devices. A real login is POST /api/auth/google {idToken} -> Set-Cookie mmgr_session (HttpOnly HMAC-SHA256 keyed by GOOGLE_CLIENT_SECRET). Can't click Google's consent screen without credentials, so the new committed harness tools/qa-prefs-roundtrip.cjs (`npm run qa:prefs-roundtrip`) mints session cookies that are BYTE-IDENTICAL to a real login — base64url(JSON{sub,email,name,picture,exp}) + '.' + base64url(HMAC-SHA256 over the exact payload string), matching worker.js signSession/readSession exactly (valid accepted, expired + tampered rejected proves the minting is byte-identical) — and passes the known secret to `wrangler dev --var GOOGLE_CLIENT_SECRET` (same env var a real deploy gets from the Wrangler secret store). API phase (wrangler dev on :8795, own D1/R2 persist, migrations applied): 15/15 gates — P1-P4 every auth failure is the SAME generic 403 body (no cookie / expired / tampered sig — nothing distinguishes them, closing the response-shape loop per review), P5-P6 PUT cyan + GET persists (GET contract is palette+dark only — no updatedAt on GET), P7 palette whitelist 400, P8-P9 sequential writes land (dark-only PUT merges, keeps cyan), P10 account isolation (acct B reads defaults), P11 oversized body 413, P11b reset, P12 idempotent re-save, P13 create project WITH session cookie -> linked:true (google_sub recorded), P14 admin list surfaces themePrefs {cyan, dark:false, updatedAt ISO} for the linked project and NEVER exposes the raw sub. BROWSER PHASE (browser-use vs the live wrangler origin, real cookie via CDP): DEVICE A fresh profile -> default -> click Cyan -> data-theme=cyan + aria-pressed + localStorage, fetch GET confirms the click's PUT reached R2, reload keeps cyan (backend pull). DEVICE B fresh profile, SAME account cookie, STALE local palette 'default' + light + mmgr_palette_backend flag -> load -> one-per-load pull OVERRIDES stale local to cyan (data-theme=cyan, picker cyan pressed, no dark-mode) — the cross-device sync proof. Zero console errors both devices (only the documented GSI localhost-origin notice). Code review clean (1 tightening applied: P3/P4 now assert the generic body too; re-run still 15/15). Harness tears down cleanly via its stop file. Deploy note unchanged: prefs endpoint is R2-backed, no migration. NEXT (optional): run the same round-trip against a deployed origin with a real Google account, or surface the prefs write time in the app's own UI.

**2026-08-12 — Session: QA-STRESS-COMPLETED — qa-stress.cjs run to completion, STRESS_GATE PASS.**
Per Garfield ("run qa-stress.cjs to completion"): full run against serve.cjs:8765 finished
within the 10-min watchdog (did NOT trip). RESULT: STRESS_GATE PASS, PAGE ERRORS: none.
All executed checks green: S-suite two-device merge semantics (S04 conflict-reverse LWW
adopts genuinely newer edit, S05 timestamp tie keeps local, S06 undo to exact pre-merge
state, S07 no stamp inflation across intervening saves, S08 Merge Project .json UI wiring),
M-suite messy voice-to-claim (M01/M02 action+decision recovery from garbled transcript,
M03/M04 land in Decision Log + Meeting-to-Action, M05 slips with cause tag never blank),
P-suite AI presets (P01 all 9 presets run local-tier + write state, P02 every output carries
a zero-fabrication trace, P03 audit catches reversed start/end, P04 risk resilience, P05
budget honesty, P06 grounded free-form lookup, P07 cloud-no-key circuit-break leaves state
untouched), D-suite crash safety (D01 unload flush survives reload-mid-edit, D02 journal
restore on real hard-kill relaunch). This closes the long-standing "finish/observe the
qa-stress run to completion" backlog item from the PRE-LAUNCH VERIFICATION session — no
code changes were needed (the merge/journal logic was already verified correct in the C8
session; this confirms the full suite end-to-end on the current tree incl. the
MCP-CHANGELOG-UI/DIFF-EXPAND changes). NEXT (unchanged, optional): deploy (migration 0005
first), real-Google /api/cloud/prefs/theme round-trip.

**2026-08-12 — Session: AI-BADGE-E2E — imported-AI changelog exercised end-to-end against a LIVE local backend, all verified.**
Per Garfield ("exercise the imported-AI changelog badge end-to-end"): full chain of
import → badge → diff panel → browser-driven revert → snapshot verification, all against a
REAL wrangler dev origin (not mocks). New committed harness tools/qa-ai-badge-e2e.cjs (npm
run qa:ai-badge-e2e): starts wrangler dev on :8794 (own persist dir, migrations incl. 0005),
creates cloud project ai-e2e-*, saves a blob whose state IS the MCP-AFTER of the diffs (the
honesty gate requires it), imports ONE MCP entry (recordId add/delete/field: t9 added,
r1 deleted, t1.status todo→done), asserts the changelog list exposes source='mcp' /
actorLabel 'mcp-ai' / type edit / 3 recordId diffs (A1–A5, 5/5 PASS), writes
{TMP}/mmgr-ai-e2e-state.json, prints a READY banner, and stays alive until the stop file
appears (15-min watchdog). BROWSER PHASE (browser-use against the live origin, local-owner
bypass + the REAL owner code): project.html?id=ai-e2e-* boots → Controls drawer → Cloud
Backup → View hits the real /changelog → entry 1 renders the PURPLE AI · MCP badge, actor
'MCP AI · <timestamp>', 'Imported from AI (MCP) — 3 field(s) changed · multiple'; caret
expands the diff panel showing tasks[1] (added), risks[0] (absent), tasks[0].status
todo→done; clicking Revert (confirm auto-accepted) reports success and the list re-renders
with a NEW 'Revert of a previous change' entry at top (Owner actor, NO AI badge); ZERO
console errors. POST-REVERT VERIFICATION: /load with the real code → SNAPSHOT-REVERT-
VERIFIED (t9 removed, r1 re-inserted as Risk One, t1.status back to 'todo') — proving the
browser's Revert click mutated the cloud snapshot exactly, including the recordId
delete-restore path. Harness torn down cleanly via the stop file. No code changes were
needed — the badge + revert flows shipped in the prior sessions work as designed.
NEXT (unchanged, optional): deploy (migration 0005 first, then npm run deploy — predeploy
verify), real-Google round-trip of /api/cloud/prefs/theme, qa-stress to completion.

**2026-08-12 — Session: CHANGELOG-DIFF-EXPAND — click-to-expand before/after diff panel on every changelog entry EXECUTED.**
Per Garfield (follow-up to the MCP-CHANGELOG-UI session): every cloud changelog entry that
carries field-level diffs now has a caret toggle revealing the before/after panel — inspect
what changed without reverting. js/mmgr-cloud.js: listLog adds a .cl-toggle button
(data-action cloudLogToggleDiffs, aria-expanded + aria-controls, caret ▸ rotating 90° via
.open) + a hidden #cl-diffs-<id> panel per entry with diffs; new clVal (primitives as-is,
whole-record values → compact JSON, long strings ellipsis-truncated on screen with the FULL
value in the title attribute, undefined→null defensive guard, everything esc()'d incl. title
attrs) + renderDiffPanel (4-col grid: Field | Before | → | After, 60-row cap with "… and N
more" footer; solid --tile-bg surface per Gate 6.1) + toggleDiffs (pure DOM, no server call;
syncs .open + aria-expanded). Recovery/bulk entries get no toggle (no diffs by construction);
revert entries DO (they store inverse diffs). Wired in mmgr-app.js ACTION_MAP +
READONLY_SAFE_ACTIONS (view-only expansion works in readonly mode). css/mmgr.css: token-
driven .cl-toggle/.cl-diffs/.cl-diffs-head/.cl-diff/.cl-diff-path/.cl-val/.cl-old
(danger)/.cl-new (green)/.cl-absent/.cl-arr/.cl-more — adapt to both palettes + dark.
sw.js mmgr-shell-v62→v63. NEW committed gate tools/qa-changelog-diffs.cjs (17 gates: paths/values/absent/JSON/escaping incl. quotes/truncation+title/empty/
60-cap+footer; stubs window/document and drives the pure-string _renderDiffPanel test hook)
+ npm run qa:changelog-diffs. VERIFICATION: qa-changelog-diffs 17/17 PASS (first run's 4
FAILs were harness assertion bugs — escaped-JSON form, wrong sample path, title-by-design
conflict, regex over-matching cl-diff-head/path — fixed in the harness, code was correct),
npm run verify green (CSP 11/11, SW v63, skills), node --check clean, browser E2E via
serve.cjs:8765 with a CDP fetch mock + local-owner bypass (localStorage mmgr_unlocked_/
scope_/state_/current_project/admin_projects + sessionStorage owner code): project.html
?id=e2e-diff boots, Controls drawer → Cloud Backup → View renders both rows, entry 41
expands showing charter.name/Old Project Name/New Project Name with aria-expanded true →
collapses to false, row 42 shows the purple AI · MCP badge, ZERO console errors. Code review
closed 0 bugs; 2 minor items applied: aria-controls on the toggle (disclosure pattern) and
the undefined→null guard in clVal. NEXT (unchanged, optional): deploy (migration 0005 first),
real-Google round-trip of /api/cloud/prefs/theme, qa-stress to completion.

**2026-08-12 — Session: MCP-CHANGELOG-UI + ADMIN-PREF-SURFACING — two backlog items EXECUTED, all gates green.**
Per Garfield ("read the continuation directive and follow suite"): the directive's Parts A–D
were already closed; the remaining actionable backlog items were (1) surface mcp-ai entries
distinctly in the changelog UI and (2) surface the prefs endpoint in the admin cloud listing.
Both shipped this session, plus the required verification pass.
ITEM 1 — MCP-CHANGELOG-UI: worker.js handleCloudChangelogList now SELECTs import_key and
exposes a derived `source: 'mcp'|'cloud'` per entry (the raw import_key is NEVER returned —
only the boolean-ish flag); js/mmgr-cloud.js listLog renders MCP-imported entries with a
purple `.badge-ai` chip (i-sparkle icon, title tooltip) + "MCP AI" actor + "Imported from AI
(MCP) — …" prefix instead of masquerading as "Owner"; Revert stays (recordId reverts were
the point of the import pipeline). css/mmgr.css gains `--purple-rgb` tokens in all four theme
blocks (default light/dark + cyan light/dark, values checked against each block's --purple
hex) + the `.badge-ai` rule using rgba(var(--purple-rgb),…) — the same tokenization pattern
as --gold-rgb/--amber-rgb.
ITEM 2 — ADMIN-PREF-SURFACING: worker.js handleAdminCloudList selects google_sub INTERNALLY
(never exposed in the response) and reads R2 prefs/<sub>.json per project to add
themePrefs {palette, dark, updatedAt} to each row (best-effort try/catch → null); admin.html
shows a "Theme: cyan · dark · saved YYYY-MM-DD" line in each project row (only when prefs
exist) + the admin hint now mentions the prefs store. The admin listing is operator-scoped
and small, so the sequential per-row R2 reads are fine (reviewer noted Promise.all would be
marginally faster at scale — not required).
HOUSEKEEPING: admin.html inline-script hash regenerated (2x during the session as the row
markup gained the saved-date — final 'sha256-8lwCeR…') and synced into worker.js +
serve.cjs INLINE_SCRIPT_HASHES; sw.js bumped mmgr-shell-v61→v62 with the change comment.
VERIFICATION (all pass): npm run verify GREEN (CSP 11/11 hashes match worker.js + serve.cjs,
SW v62 > 45 SHELL assets, 16/16 skill hashes); node --check clean (worker.js, serve.cjs,
sw.js, js/mmgr-cloud.js); tools/qa-cloud-import.cjs 35/35 (import pipeline + recordId reverts
regression-free); tools/qa-cloud-phase2.cjs 79/79 (this run even passed the two previously-
documented failures P2.10f + browser-phase crash — fresh persist dir); browser smoke
(serve.cjs:8765) admin/project/app all render with ZERO CSP violations, admin gate screen +
palette picker present. One environment lesson logged: an OLD serve.cjs kept running in the
background held port 8765 with stale in-memory CSP hashes after a mid-session hash regen —
verify-csp passing against disk does not mean the RUNNING dev server matches; after any
inline-script hash change, restart the dev server (kill the exact PID on the port via
netstat+taskkill, never a blanket node.exe kill — two live node procs are the Freebuff
client).
REMAINING (unchanged, all optional): deploy (apply migrations 0005 to remote D1 first, then
npm run deploy); end-to-end round-trip of /api/cloud/prefs/theme with a real Google session;
observe qa-stress to completion. NOTE for deploy restated per code review: the changelog
list endpoint now hard-references the import_key column — migration 0005 must be applied to
remote D1 before/with this worker deploy (already the documented order).

**2026-08-11 — Session: THEME-SYSTEM-AND-MOBILE-UI — cyan theme + drawer + 4 bug fixes EXECUTED.**
Executed the `new update do everything dont stop and ask for nothing/` folder in full: the
Claude bug audit (4/4), the Theme System + Mobile UI action plan (Phases A–E), and the parts
of the cyan-dashboard plan that were NOT superseded. Skills loaded per AGENTS.md:
universal-ui-architect (tokens/contrast gates) — the skeptical-code-audit skill was used only
for the wiring verification of the final state, not as the task driver.
BUG FIXES (CLAUDE-BUG-AUDIT-2026-08-11): (1) `syncClientId` added to the change whitelist
+ change-listener condition in js/mmgr-app.js — Google OAuth Client ID now persists. (2)
`@keyframes shake` + `.shake` class (reduced-motion guard) added to css/mmgr.css — wrong-code
modal now animates. (3)+(4) `#i-plus` + `#i-shield` (plus `#i-menu` + `#i-palette` for the new
UI) added to css/mmgr-icons.svg.
THEME SYSTEM (THEME-SYSTEM-AND-MOBILE-UI-ACTION-PLAN, default-gold preserved): new early-load
helper js/mmgr-theme.js on ALL 7 pages (app, project, admin + 4 marketing), external script so
CSP inline hashes needed zero changes (verify-csp still 11/11). Two independent axes: palette
(`default|cyan`) → <html data-theme> + dark (existing body.dark-mode). **DELIBERATE DEVIATION
from the plan's literal naming: the palette lives in localStorage `mmgr_palette`, NOT
`mmgr_theme`** — the shipped dark toggle already owns `mmgr_theme` ('dark'|'light'); writing
'cyan' into it would clobber dark mode. Backend path (plan §2.3, backend-preferred): new
session-gated GET/PUT /api/cloud/prefs/theme in worker.js (handleCloudPrefsGet/Put), stored as
R2 prefs/<google-sub>.json — NO D1 migration needed for deploy; client writes localStorage
instantly, PUTs on change (data-sync="1" script tag on app pages), pulls once per load after a
successful round-trip (mmgr_palette_backend flag) — marketing pages are localStorage-only so
anonymous traffic never hits the Worker. theme-color meta syncs per palette/dark. Cyan token
blocks (light+dark) added to css/mmgr.css + css/marketing.css mapping the fluorescent-blue
palette onto existing token names (light accent #0f766e teal-700 — AA-passing text accent on
white; #50e8f4 fluorescent reserved for dark mode where it passes AA ~13:1); default marketing
dark token block added (was none). Phase D-17 tokenization: 33 gold/amber rgba fills in
mmgr.css + 22 in marketing.css → rgba(var(--gold-rgb)/var(--amber-rgb),…); new --gold-rgb/
--amber-rgb/--purple tokens in all four theme blocks; inline-SVG sec-nav icon strokes
(stroke="#D4AF37" etc.) now follow tokens via attribute selectors; js/mmgr-cloud.js + 
js/mmgr-raci.js inline gold rgba tokenized too. Deliberate exception: the timeline chart
palette in mmgr-app.js (~886-893) stays constant (canvas fills can't read CSS vars). Picker UI:
.pal-switch/.pal-btn segmented controls next to every dark-mode control (project.html Controls
drawer, app.html theme-ctl, admin.html gate pill + header, 4 marketing headers), driven by ONE
delegated [data-pal] click listener in the helper (no inline JS, no hash churn).
MOBILE SHELL (plan §4.2): hamburger (#nav-btn, i-menu icon) in project.html header + #nav-scrim;
≤768px the SAME .sec-nav element becomes a fixed off-canvas drawer (transform translateX,
body.nav-open toggle) — no duplicated nav, active states stay in sync; closes on scrim tap /
any section button / Escape / resize>768 (tglNav action in mmgr-app.js ACTION_MAP +
READONLY_SAFE); #nav-scrim added to the focus-mode hide list. AI entry point, lock indicator,
settings remain in the header.
VERIFICATION: node --check clean (all touched JS), npm run verify GREEN (CSP 11/11, SW v61 > 45
SHELL assets incl. new js/mmgr-theme.js, 16/16 skill hashes). Browser smoke (serve.cjs:8765,
browser-use): app.html Cyan switch/aria-pressed/localStorage persistence across reload/Default
reset/dark toggle all PASS; project.html 8/8 PASS (hamburger hidden desktop, visible + drawer
opens at 480px with translateX(0) + scrim, scrim closes, .shake rule present, picker present,
zero console errors); index.html 7/7 PASS (palette switch, data-theme, body bg → #eefafc,
Gold reset, layout intact). Code review closed 3 real findings, all fixed: marketing pages
never applied body.dark-mode (helper in <head>, body null at boot — now re-applies on
DOMContentLoaded), JS-embedded gold rgba tokenized, scrim added to focus-mode hide list.
NEXT (optional): end-to-end browser pass against a deployed origin to exercise the R2 prefs
round-trip with a real Google session; or surface the prefs endpoint in the admin cloud listing.

**2026-08-11 — Session: PRE-LAUNCH VERIFICATION — full QA battery green, harness flakes identified, deploy checklist confirmed.**
Per Garfield ("earn another check before launching"): ran the ENTIRE QA battery against the
theme/drawer build on serve.cjs:8765 (distinct CDP ports checked for parallel safety; qa-p0 /
qa-obs-verify share 9230 so they ran in separate waves). RESULTS: qa-full 171/171 (0 console
errors, 0 page exceptions), qa-p0 PASS, qa-p1 PASS (incl. theme+crosshair persist after hard
refresh), qa-ai AI23 PASS, qa-ai-visual AIVIS PASS, tools/qa-ai-polish 11/11, qa-marketing 17/17
(0 console errors across all 6 pages — covers the new palette pickers + theme script),
qa-obs-verify 14/14, qa-pwa 13/13, qa-restore-verify 14/14, qa-focus PASS, qa-typing PASS,
qa-glass 12/12 (with the uCyan uniform), qa-sync PASS, qa-voice VOICE_GATE PASS, qa-v11 V11 PASS,
qa-r3 R3 PASS, qa-oauth 11/11, qa-stress 13/13-so-far with 0 failures (long multi-section
AI/voice stress run, still mid-flight when the sweep concluded — NOT part of the deploy gate).
qa-drive-smoke passes gates A+B then WATCHDOG-exits at the real-Google-Drive step (needs
credentials — expected in sandbox, not a regression). KEY LESSON logged for future sessions:
4 harnesses (qa-pwa, qa-restore-verify, qa-typing, tools/qa-ai-polish) each failed ONCE under
parallel load — all showed `undefined` state = the page hadn't finished booting when the probe
fired (timing flake), and EVERY one passed on clean re-run. Do NOT treat a single failed CDP
harness run as a regression: re-run it solo before investigating. Verify gates: npm run verify
green (CSP 11/11, SW v61 > 45 assets, 16/16 skills), node --check clean on all touched JS.
Repo state confirmed as exactly the intended 20-file change set (project.html LF intact — its
inline-script hashes still match, proving byte-identity). DEPLOY CHECKLIST (all that remains
before/at launch): (1) apply migrations/0005 to REMOTE D1 first — `npx wrangler d1 migrations
apply my-manager-db --remote` (from the CLOUD-MCP-IMPORT session); (2) the theme-prefs endpoint
is R2-backed — no migration, worker.js deploys as-is; (3) deploy via the wrangler.jsonc staging
recipe (exclude .git/.wrangler/node_modules/.agents — 25 MiB asset limit); `npm run deploy`
(predeploy = npm run verify) is unblocked. Dev server left running on :8765 for manual poking.
NEXT (optional): deploy + live round-trip of /api/cloud/prefs/theme with a real Google session;
finish/observe the qa-stress run to completion; surface mcp-ai entries distinctly in the
changelog UI (older backlog item).

**2026-08-11 — Session: WHAT-IF ADVERSARIAL PASS on the theme/drawer build — 3 real findings fixed, all gates re-green.**
Per Garfield ("what if it breaks / find reasons to distrust it"): ran a hostile review of the
just-shipped theme system + mobile drawer, fixing every real hole before handing back.
FOUND + FIXED: (1) Premium-glass GLSL shader hardcoded a warm-gold accent vector — cyan palette
+ premium glass showed a GOLD glow. Added a `uCyan` uniform (declared in FRAG, registered in the
uniforms object at material creation, set in refreshTheme alongside uDark) and `mix(gold, cyan,
uCyan)` in palette() — uCyan=0 reproduces the old gold path exactly, qa-glass.cjs GLASS35 gate
still 12/12. (2) Backend-pull race: with data-sync enabled, a stale GET /api/cloud/prefs/theme
resolving AFTER a fresh user click could clobber the user's pick. Added `_userTouched` in
js/mmgr-theme.js — setPalette sets it; pullBackend bails at entry AND re-checks in .then before
any write. (3) PUT /api/cloud/prefs/theme accepted unbounded bodies — content-length guard
(>2048 → 413) added. Also: syncGlass() hooks palette changes into MMGR.Glass.refreshTheme so an
ACTIVE glass backdrop re-tints instantly (dark toggle already refreshed it); #nav-scrim added to
the focus-mode hide list; mmgr-cloud.js + mmgr-raci.js inline gold rgba tokenized. VERIFIED
CLEAN under hostile testing (browser, serve.cjs:8765): wrong-code modal shake fires live (class +
'Incorrect code' + modal stays usable); cyan+dark combo → body bg exactly rgb(0,22,25); all 4
sprite symbols resolve; drawer at 375px opens/closes via scrim + Escape + section-button (which
also switches sections); syncClientId LIVE-persists to localStorage (bug-1 fix proven); admin
3-control gate pill fits 1200px (515px) and 480px (476px ≤ viewport, wraps cleanly) with zero
console errors on every page. Harness note: qa-glass.cjs fails with 'MMGR undefined' if the
:8765 server isn't running — that is harness-environment, not a code regression (restarted
server → GLASS35 12/12 PASS, SYNC45 PASS). Final: npm run verify green (CSP 11/11, SW v61 > 45
assets, 16/16 skills). Deliberate non-fixes (documented, low risk): timeline-chart canvas
palette in mmgr-app.js stays constant (canvas fills can't read CSS vars); chunked/NaN
content-length can bypass the 413 (route is session-gated + rate-limited — cheap hardening only);
premium glass requires the pinned three.js CDN, so it cannot be exercised in this sandbox.

**2026-08-11 — Session: CLOUD-MCP-IMPORT — changelog importer (MCP → D1).**
Per Garfield's next-step from the MCP build: push mcp changelog entries into the D1
cloud_changelog. Built end to end: (1) migrations/0005_cloud_changelog_import_key.sql —
nullable UNIQUE import_key so re-imports can never duplicate audit rows (SQLite
gotchas per the d1-migration skill: ALTER TABLE ADD COLUMN once-only, unique index
IF NOT EXISTS, NULLs never collide). (2) worker.js new owner-only endpoint POST
/api/cloud/projects/:id/changelog/import (handleCloudChangelogImport ~1230+,
router entry after the changelog-list match): sanitizes each entry (localId positive
int, entry_type edit|bulk|revert only, ISO created_at, diff shape path +
beforeAbsent/afterAbsent), runs an HONESTY GATE (cloudVerifyImportedDiffs) — every
diff is verified against the live R2 blob (record diffs by recordId: add must exist
+ equal after, delete must be absent, field/whole-record update must equal after;
charter/leaf diffs by path) — entries whose diffs diverged are skipped and reported,
NEVER stored; no blob ⇒ all skipped ('no cloud snapshot to verify against'); MCP
'bulk' with diffs stored as 'edit' (sidecar has no R2 snapshot); insert via ON
CONFLICT(import_key) DO NOTHING with fresh D1 ids, import_key 'mcp:<pid>:<localId>'
(project-scoped — localIds repeat across projects); section computed server-side via
cloudSectionOfDiffs; cloudTouchOwner on successful import. (3) worker.js revert
route upgrade: cloudRevertDiff (port of the MCP sidecar's applyInverseDiffs) —
record diffs resolve by stable recordId (fallback: recorded index for cloud-native
leaf diffs), delete-restore re-INSERTS at a clamped index, gone-target skips instead
of clobbering; cloud-native behavior unchanged when no recordId present (phase-2 P3
gates still green). (4) tools/import-mcp-changelog.cjs — zero-dep CLI: --file/--dir+
--project-name, cloud id from state.projectId (--project-id override), --dry-run,
--max-id, ledger <sidecar>.imported.json (skip-ahead; server UNIQUE is the real
guard), exit codes 0/1/2. (5) tools/qa-cloud-import.cjs — 29/29 gates against local
wrangler dev (migrations applied): owner-only auth incl. generic 403 parity, happy
path + D1 row shape + fresh ids, honesty gate rejects divergent diffs, no-snapshot
reject, idempotent re-import, recordId add/delete/field import + owner revert
restores exactly (t9 removed, r1 re-inserted, status→todo) + revert-of-revert, bulk
→edit normalization, entry validation, CLI dry-run/live/ledger/re-run e2e. npm
scripts qa:cloud-import + import:mcp. Docs: mcp/README.md new "Cloud changelog
importer" section (honesty gate, idempotency, revertibility, normalization) +
suggestions updated. Verification: node --check clean (worker.js + both tools),
qa-cloud-import 29/29, qa-cloud-phase2 61/63 — the 2 failures (P2.10f + harness
crash, '(r.impact||"").toLowerCase' TypeError in the browser flow) are PRE-EXISTING
and reproducible on a pristine stashed worker.js (front-end fixture issue: phase-2
baseState risks use numeric impact:3; untouched by this work), npm run verify green
(CSP 11/11, SW v60, 16/16 skill hashes).
TWO REVIEW-FIX ROUNDS after the first pass (both real data-integrity bugs found by
code review, both now gated): (1) cloudRevertDiff spliced the whole record for ANY
beforeAbsent diff — cloud-native leaf reverts turned into corruption (a field-add
revert deleted the record; a record-add revert with leaf diffs at one index
repeatedly spliced away the FOLLOWING records). Fixed: beforeAbsent+field deletes
just the field; only whole-record adds splice. Same fix ported to the MCP sidecar
mcp/lib/changelog.mjs applyInverseDiffs. Gates: qa-cloud-import Q11/Q12 (field-add
+ record-add reverts keep every neighbor), mcp/qa-mcp.cjs W10 (field-add revert
keeps the record). (2) cloudRevertDiff only special-cased charter + arrays, so
object content keys (closure.*, raci.* incl. raci.matrix.<key> with its two-dot
path, dmaic.*, activeMeeting.*) silently no-opped on revert — the pre-recordId
code was generic cloudPathSet/cloudPathDelete. Fixed: regex widened to allow
dotted fields + a generic path-helper fallback for non-array list keys (charter
included). Gate: Q13 (closure change save→revert restores the field). FINAL:
qa-cloud-import 35/35, qa-mcp 38/38, npm run verify green. NOTE for deploy: apply
migration 0005 to remote D1 (npx wrangler d1 migrations apply my-manager-db
--remote) before/with the worker deploy. NEXT (optional): surface imported mcp-ai
entries distinctly in the app's changelog UI, or an end-to-end browser pass of the
importer against the deployed origin.

**2026-08-11 — Session: MCP SERVER BUILT (zero-dep, owner-approved writes).**
Per Garfield: build an MCP server for the product, cloud-model-only unless the local
engine can handle it — and it can handle the fixed intents, so the design is
LOCAL-FIRST with cloud fallback. New `mcp/` directory (zero-dependency, Node .mjs,
stdio JSON-RPC): server.mjs (20 tools: 16 read/analytics + mmgr_answer_question
local-first→cloud + 4 write tools), lib/engine.mjs (faithful ports of the app's
localLookup/buildContext/Health/EVM/riskDays/computeSlips with the same
zero-fabrication trace discipline), lib/validate.mjs (per-record-type field
whitelists + enum checks — model output is untrusted input), lib/changelog.mjs
(sidecar changelog mirroring the D1 cloud_changelog shape exactly: entry_type /
actor_type / actor_label / section / diffs_json [{path,before,after,beforeAbsent,
afterAbsent}] / created_at), lib/store.mjs (atomic tmp+rename writes, pre-change
backups <project>.pre-<id>.json, fingerprint stale-guard), lib/cloud.mjs (provider
ladder port: google-gemini gemini-flash-latest→gemini-flash-lite-latest, openai
gpt-4o-mini→gpt-5-mini/nano, anthropic claude-3-5-sonnet-latest→haiku→haiku3;
429/503 advance, 401/403 stops; MMGR_MCP_AI_KEY env-only, never in files). WRITES
ARE TWO-PHASE OWNER-APPROVED: propose_change returns a preview + single-use TTL'd
token; approve_change is the only file-writing path (stale-file guard refuses if the
disk changed since propose); reject discards; revert_change undoes MCP-AI changes
by id and logs a NEW revert row (history never erased). Env: MMGR_MCP_DIR,
MMGR_MCP_PROJECT, MMGR_MCP_AI_KEY, MMGR_MCP_PROVIDER, MMGR_MCP_ALLOW_WRITES=1,
MMGR_MCP_TOKEN_TTL_MS. QA: mcp/qa-mcp.cjs = 34/34 gates (handshake H1-H2, read
R1-R6, write/approval W1-W9 incl. review-fix regressions: real pre-change backup,
real (non-phantom) add ids in the changelog, revert-by-id under index drift, plus
a real validate.mjs bug the new gates caught — delete ops crashed on the 'id'
field-schema lookup). npm scripts: mcp / qa:mcp. Fixture: mcp/fixtures/sample-
project.json (Riverwalk Retail Fit-Out, schema v18). Code review (deepseek-flash)
closed 3 real findings: phantom add-ids logged in changelog (now logs approve-time
diffs), promised pre-change backup was never written (now written with the
pre-computed entry id), revert-by-index drifted after later edits (now resolves by
stable recordId); dead exports removed (opToDiffs/isWritableField/removeChangelog).
All gates green: node --check on all mcp files, qa-mcp 34/34, npm run verify
(CSP/SW/skills). NEXT (optional): push changelog entries into the D1 cloud_changelog
(shapes already match), or a browser-use smoke test wiring the server into Claude
Desktop.

**2026-08-11 — Session: SKILL-SET EXPANSION + LOCKED-SKILL-SET SECTION.**
Per Garfield: installed all product-related community skills and recorded the skill
set in this file so every future session knows what to load. Installed 5 new skills
via `npx skills add` into `.agents/skills/`: gemini-api-dev (google-gemini/gemini-
skills), pwa-development (alinaqi/maggy), oauth (mcollina/skills), landing-page-
generator (kostja94/marketing-skills), accessibility-rules (community-access/
accessibility-agents). Registered the two project-authored skills that were on disk
but never locked — skeptical-code-audit + universal-ui-architect — into
skills-lock.json with hashes computed via new helper tools/hash-skill-folder.cjs
(identical algorithm to verify-skills-lock.cjs; sourceType "local"). Updated AGENTS.md
skill map (16 rows, incl. accuracy notes: accessibility-rules is document-oriented,
oauth is Fastify-oriented) + rule 4 local-skill exception. This file gained the
"LOCKED SKILL SET" quick-reference section above. Verification: `npm run verify`
green — ALL 16 LOCKED SKILL HASHES MATCH, CSP 11/11, SW mmgr-shell-v60 > 44 assets.
Safety scan of the 5 new skill contents: clean. NOTE: `npx skills add` regenerates
lock entries automatically; only project-authored skills need
`tools/hash-skill-folder.cjs`.

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
