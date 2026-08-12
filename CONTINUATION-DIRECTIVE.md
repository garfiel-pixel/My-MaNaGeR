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
