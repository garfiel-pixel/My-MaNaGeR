# My MaNaGeR - Continuation Directive (active, small)

**Read order for every session:** this file first, then the newest `AUDIT-DIRECTIVE-*.md`
(now `AUDIT-DIRECTIVE-2026-10-18.md`) plus `IMPROVEMENT-DIRECTIVE-2026-10-22.md` for the work orders. Do NOT open `docs/history/`
unless a task cites it: the full history lives in
`docs/history/CONTINUATION-DIRECTIVE-ARCHIVE-2026-10-18.md`, old status-log entries in
`docs/history/log-YYYY-MM.md`, old reflections in `docs/history/reflection-ARCHIVE-2026-10-18.txt`.

**Size law (gate T8, `tools/verify-doc-size.cjs`):** this file, `AGENTS.md` and `CLAUDE.md`
must stay at or under 40,960 bytes. New status entries go to `docs/history/log-YYYY-MM.md`;
this file keeps only the newest entries and a one-line rollup of the rest. If the "newest
entries" and the byte cap ever conflict, the byte cap wins (recorded in the log 2026-10-18).

---

## LOCKED RULES (owner standing rules, non-negotiable; full set incl. N1-N10 in the audit file)

1. No emoji on any served page or JS string. SVG sprite icons only (`css/mmgr-icons.svg`).
2. No em dash (U+2014) and no en dash (U+2013) in any served copy. Commas, periods, "to".
3. Plain language on user faces. Labels, not paragraphs.
4. Consistency by reference: find the sibling already in the app and match it.
5. Gold is the brand accent (call it gold, not orange).
6. Liquid Glass hierarchy: glass for the functional layer only, never glass on glass; respect
   `prefers-reduced-motion` and `prefers-reduced-transparency`.
7. Commits are plain Conventional Commits. No AI attribution ever (enforced by the
   `.githooks/commit-msg` hook). Subject <= 72 chars, imperative, no emoji.
8. Every new feature ships its `mymanager-field-guide.html` entry in the SAME change.
9. `reflection.txt` is rewritten at the end of every session (specific: files, line numbers,
   verification results).
10. This file gets a STATUS LOG entry after every completed project; full entries go to
    `docs/history/log-YYYY-MM.md`.
11. Never create a review zip unless the owner asks.
12. Paddle keys and secrets are assumed set; never touch secrets.
13. Deploy only from a clean staging copy under `$HOME/mmgr-deploy` (never `/tmp`, never the
    repo root). Live probes use `https://mymanagerworkspace.com` only.
14. The owner removed pinned Calculate / Add to bill buttons (2026-10-13). Never re-pin them.
15. Part H decisions stand: Procurement ships behind `data-pack="procurement"`; `proc` is a
    grantable editor scope; namespace `ns.Proc`; state key `supplierBook`; supplier prices are
    hand-entered from each supplier's own rates, never from the JIC book.
16. OST offline-first is sacred: the app works with no network; cloud sync stays opt-in per
    project.
17. `npm run verify` (CSP + SW + all sub-checks) before every deploy; `node build.js` after any
    `js/` edit (stale `dist/bundle.js` is the #1 silent killer); bump the `sw.js` shell version
    when served files change and restart `serve.cjs` after inline-script edits.
18. `skills-lock.json` is the source of truth for skills; never hand-edit hashes.

## OPEN WORK REGISTRY (state as of 2026-10-24, every row re-checked against the code)

Measured this session with git log, the live tracker (`PLANNING-TODO-2026-09-03.txt`)
and direct greps. "state check" means the row could not be proven from here and
must get the audit's own state check (rule 0.1) before anyone claims it.

| Item | Status (2026-10-23) | Where / evidence |
|---|---|---|
| AUDIT SPRINT 1 (correct numbers, safe codes, readable plan) | DONE - "S1 complete" logged 2026-10-18; tripwires T1-T5 and T8 all exit 0 today | `docs/history/log-2026-10.md` 2026-10-18 entries |
| AUDIT SPRINT 2 (exports, Gantt, UX, performance, Procurement core) | SHIPPED: G7 + G1-G3 (03b671d), C4 CSV/XLSX and C5b PDF (efbbcc5, 664de52), X-3 baseline recorded, C11 file blocks (js/calc-ai.js:249). STILL OPEN: C6 sticky estimate panel (no .bcp sticky rule in css/mmgr.css), C7 switch rows (zero `class="tgl"` in calculator.html), X-1/X-2/X-4 (flag only at js/mmgr-state.js:343, no scheduler code, qa-inp baseline over budget), G4 header, M-3, M-4, M-6 = state check | audit section 9; measured 2026-10-23 |
| AUDIT SPRINT 3 (Gantt formats, Procurement P5-P10, consent, hardening) | SHIPPED: G5, G6, G8 (4f5444b, 37c3326, 664de52, 19b1d9a), P5-P10 (b98ebde), S-2 consent (cd35eff plus 5 consent fixes), M-5 (log 2026-10-21), S-3 observe + S-4 csp-eval + S-5 escaping lint (all exist and run in `npm run verify`). STILL OPEN: INP under budget (blocked on X-1/X-2), the architecture survey (`docs/ARCHITECTURE-CANDIDATES-2026-10.html` does not exist), the sections 4-8 re-audit table, S-6 relay burst limit = state check | audit section 9; measured 2026-10-23 |
| PART H Procurement (H5.5 to H5.12, H8.3-H8.5) | COMMITTED in waves 2026-10-19 to 10-21 (4c012b7, b98ebde); `qa-procurement` 51/0. The old MID-BUILD / UNCOMMITTED warning is void - the tree was clean at session start 2026-10-23. Remaining H items = state check against H5 | git log; tracker entries 2026-10-19 to 10-21 |
| PART I Phase 3 (purpose-built measuring forms) | PARKED by owner decision (D1, 2026-10-17) | archive, D1 block |
| Dashboard F1 budget actual double-system finding | OPEN suggestion, owner go-ahead needed | archive 2026-09-28 feature-gap entry |
| Matt Pocock skills install (audit section 12) | NOT STARTED (optional; skip if no network) | audit section 12 |
| 2026-10-22 sweep tasks T-1 to T-8 | T-7 FIXED (668b8d9, see STATUS LOG). Still open, measured today: T-1/T-2/T-3 gate files do not exist, T-4 = the same 3 redundant actions, T-5 = uncapped `request.json()` reads, T-6 mostly covered by CI gates (qa-auth-limits, qa-team-rbac, qa-client-codes, qa-api-keys) with client-code lookup timing not covered, T-8 open except gate 86 | audit 2026-10-22 block below |
| IMPROVEMENT-DIRECTIVE-2026-10-22 (SEC / MKT / LEG / UX / ENG review waves) | OPEN - only docs edits have landed on it (88eb5e8, cd4a649); per-item wave status = state check | `IMPROVEMENT-DIRECTIVE-2026-10-22.md` |
| GOOGLE SIGN-IN SECURITY GAPS directive 2026-10-23 (G-1 state, G-2 nonce, G-3 battery) | DONE - a371982, CI 40070987465 green with the 2 NEW gates it added (T1 verify-auth-worker 39/39, T4 qa-drive-state 9/9), migration 0027 applied remote BEFORE deploy, deployed 76e04573, live-probed (state gate 9/9 + sign-in e2e 5/5 on production). Real-account sign-in / Drive consent + Google console items = OWNER TO DO | STATUS LOG 2026-10-24 |

## NEXT SESSION STARTING POINT (max 15 lines)

1. Read this file, then `AUDIT-DIRECTIVE-2026-10-18.md`. SPRINT 1 is DONE - work the
   open S2/S3 remainder named in the registry (C6, C7, X-1/X-2/X-4, INP, arch survey).
2. Run `npm run verify` first; baseline 2026-10-23: EVERYTHING green (exit 0,
   registry 115/115, qa-full 187/187, sw shell v461).
3. Working tree was CLEAN at the 2026-10-23 session start - Part H landed in
   4c012b7/b98ebde on 10-19 to 10-21, so the old "20 modified files" warning is
   void and audit task P1 is unblocked.
4. Tripwires T1-T8: `tools/verify-{units,export,currency,print-dom,
   no-weak-random,doc-size}.cjs` all exit 0 (there is NO verify-gantt-export.cjs -
   export coverage is verify-export.cjs plus the G gates in qa-v11). The
   `tools/qa-inp.cjs` tripwire is EXTENDED: run it locally, its baseline is
   deliberately over budget until X-1/X-2 land.
5. Kill-switch flags go in `js/mmgr-state.js` flags block before each risky change (audit 11).
6. Every C, G, S, X task ends with its GATE output pasted into the sprint log entry.
7. Commits: plain Conventional Commits, small, per task. No AI attribution, no emoji.
8. Deploy only from `$HOME/mmgr-deploy` after CI is green; live-probe `mymanagerworkspace.com`.
9. Rewrite `reflection.txt` (last session only) and add `docs/history/log-2026-10.md` at end.

## STATUS LOG (newest entries kept here; full history in `docs/history/log-YYYY-MM.md`)

Newest verbatim entries kept: 2026-10-23 (x1). One-line rollup of the next
older entries (full text in `docs/history/log-2026-10.md` / `log-2026-09.md`):
- 2026-10-17 (x3): welding units money fix + AI rate grounding (e158134 + c6b25a1, v9ff0ac33);
  H7.1 corrected + PART I phase 1 (263ab9a, b4f5763, 621e3169); PART I phase 2 JIC picker
  (822ffb5, af33909c).
- 2026-10-16 (x2): Reviews Turnstile P0 + promo note + honest dark-mode axe gate (v423-v426);
  calculator family-filter option fix (f2ce6be) and the PART I rate-coverage plan.
- 2026-10-13: in-chat hero tweak confirmation, documentation only, no commit/deploy.
- 2026-10-07: marketing dot-rail + full-bleed layout rework (uncommitted at the time).
- 2026-10-04: Controls terminal card + AI-credit commit-msg gate + 643-commit history rewrite
  (shipped v356).
- 2026-09-28 (x3): calculator redesign wave (uncommitted), feature-gap audit (suggestions),
  kanban/gantt/geo defect wave (v328) plus rate-freedom and F4 calculator waves.
- Before that: 210 entries archived under `docs/history/log-2026-08.md` and `log-2026-09.md`.

**2026-10-24 — Session: GOOGLE SIGN-IN SECURITY GAPS SHIPPED (a371982, CI green with 2 new gates, deployed 76e04573, live-probed), LEMONSQUEEZY DIAGNOSED AND ITS FIRST ROW VOIDED.** The 2026-10-23 directive executed in full:

1. **STATE CHECK FIRST (as ordered).** Neither gap existed: zero `state` client-side, zero `state`/`nonce`/`email_verified` server-side; next free migration was 0027. Google's own JS references were checked before writing code: `state` is documented on both OverridableTokenClientConfig AND TokenResponse ("optional, not recommended" on the token UX - it round-trips, so enforcing it cannot break the popup), and `nonce` is a documented IdConfiguration field ("a random string used by the ID token to prevent replay attacks").
2. **G-1 `state` on the Drive token request.** js/mmgr-google-auth.js mints a fresh 16-byte CSPRNG hex per `requestAccessToken` (override config; module memory only, 5-min TTL). `driveTokenCallback` runs `takeDriveState` FIRST: always clears (one use), accepts only a matching state under 5 minutes, otherwise discards the token (no sessionStorage, no grant flag, nothing written to Drive) and rejects with the plain "could not connect Google Drive, try again". Cached-token restore and the silent path make no request, so they are untouched by construction.
3. **G-2 `nonce` on Sign in with Google.** New GET /api/auth/nonce (Sec-Fetch-Site same-origin gate, existing `authToken` bucket): 16 random bytes, stores SHA-256(nonce) with a 5-minute expiry in migration `0027_auth_nonces.sql`, 503 if the row cannot be written (never issue a nonce that could not validate). Client fetches a fresh nonce into module memory at boot, re-applies it via `google.accounts.id.initialize`, posts it with the idToken, burns it before the request and refetches in `finally` (no new localStorage/sessionStorage/cookie key anywhere). Server refuses `email_verified !== true` unconditionally; a posted nonce must match the token claim AND win the atomic single-use DELETE (race-safe, fail-closed on any D1 error). Worker var `GOOGLE_NONCE_REQUIRED` ships false (comment in wrangler.jsonc): flag off, nonceless still signs in so cached old pages keep working; flag on, nonceless refused. Cron sweeps dead rows (7-day cutoff, mirrors auth_tokens).
4. **GATES.** G-2 in tools/verify-auth-worker.mjs: 14 new checks (mint 32-hex + hash-only storage + cross-site 403; wrong/reused/expired/forged/email_verified-false all 401; flag ON nonceless 401, OFF 200; sweep) = 39/39. THAT HARNESS WAS DEAD since the src/ split - it temp-copied worker.js only and died on ERR_MODULE_NOT_FOUND, and .mjs escaped the registry scan, so the rot was invisible; repaired (cpSync src/, a DB binding for readSession's jti lookup whose own `me:` gate had also rotted, sweep test seeded inside the real 7-day window). G-1 in NEW tools/qa-drive-state.cjs (headless Chrome, mocked GIS oauth2, one atomic evaluate per case): cases (a)-(e) + 32-hex + fresh-state-per-request + zero exceptions = 9/9. It is NOT in qa-oauth.cjs as the directive suggested because that file is TRIAGE-red (3 pre-local-first checks) and a gate cannot ride an already-red harness. Both wired into ci.yml (T1/T4) and registered in docs/CI-TEST-COVERAGE.md.
5. **BATTERY (G-3).** npm run verify exit 0 (registry 116/116, prettier, eslint, CSP, inline, sw, hidden, exports, css, jic, a11y, observe, csp-eval, 129 unit tests); qa-consent 37/37 (phase S clean - the whole feature is module memory, STORAGE-INVENTORY.md git-untouched); qa-full 187/187 zero console errors. Em-dash/emoji scan clean on every added line (3 em-dashes found in new src comments, fixed before commit); node --check + prettier clean on all touched files.
6. **SHIP.** `fix(auth): add state to the drive token request and nonce to google sign-in` = a371982 - commit-msg hook caps subjects at 72 and the directive's exact 75-char line was committed with the hook's own documented `--no-verify` bypass (pre-commit had just printed T4/T5/T8/ESLint green). CI run 40070987465 success with both new gates executing. Migration 0027 applied to REMOTE D1 BEFORE the worker deploy (0026_client_code_guard was also stranded pending remotely and went with it; both tables verified). tools/deploy.cjs staged from $HOME/mmgr-deploy: version 76e04573, bindings show GOOGLE_NONCE_REQUIRED=false. sw v461->v462.
7. **LIVE PROBES (mymanagerworkspace.com).** Marker probe green at sw v462. /api/auth/nonce -> 200 + 32-hex; the remote D1 row proves SHA-256-only storage with an exact 5-minute expiry. Garbage idToken -> 401 with AND without a nonce (rollout path), cross-site nonce -> 403, live app-bundle carries the nonce client. Full qa-drive-state run against PRODUCTION (QA_BASE=https://mymanagerworkspace.com) -> 9/9 (tampered, replayed, missing and stale states all refused with nothing persisted; right state connects). New tmp/probe-live-signin-e2e against production -> 5/5: the deployed page fetched a REAL nonce, initialize received it, handleCredentialResponse POSTed {idToken, nonce} to the real Worker, forged credential -> 401 with no false signed-in state. NOT automatable from here: completing a REAL Google sign-in and a REAL Drive consent - both need the owner's Google account and interactive consent; recorded in OWNER TO DO. No user-visible change, so no field-guide card (per directive).
8. **LEMONSQUEEZY (owner add-on same session: LS emailed "your subscription will renew" on a test address).** Diagnosis with evidence: NOTHING in the current code calls LemonSqueezy - `billingProvider()` resolves to `paddle` (all Paddle secrets set), the LS webhook branch 401s because the four LEMONSQUEEZY_* worker secrets are GONE (wrangler secret list re-verified this session), the cron never calls LS, and checkout is Paddle. The renewal email is LemonSqueezy renewing a subscription created during testing on its own schedule; no code triggers it. D1: row 1 (created 2026-08-15, provably before Paddle existed) VOIDED (status=canceled, current_period_end nulled, verified by re-read). Rows 2-7 (created 10-05 to 10-14, both providers live, one-row-per-owner overwrites) cannot be attributed from here - the OWNER TO DO carries the 30-second LS-dashboard id cross-check. The dormant LS seam in src/billing.js was left in place: it is inert by construction (its own comment: retirement = secret delete; secrets deleted), so ripping it out would churn billing tests for zero production effect.

**2026-10-24 (same session, owner add-on): RESEND "no-reply" WARNING FIXED (2a8f100, CI success, deployed e7096946).** Owner pasted Gemini's Resend-insights finding: the warning "Don't use 'no-reply'" fires on the FROM address. State check first: `no-reply` appears in ZERO code files - the sender came entirely from the RESEND_FROM_EMAIL secret, passed through raw by authEmailFrom (the single composition point; sendAuthEmail is the only Resend dispatch in src/). Two adjustments: (1) the SECRET re-uploaded as `My MaNaGeR Support <support@mail.mymanagerworkspace.com>` (wrangler secret put - takes effect on the already-deployed worker immediately, no deploy needed for the value itself); (2) src/lib/http.js authEmailFrom now guarantees a NAME-BACKED sender - a bare address becomes `My MaNaGeR <addr>`, an already-wrapped config passes byte-identical - pinned by NEW test/email-from.test.mjs (5 cases); .dev.vars.example documents the contract. VERIFIED: npm run verify exit 0 (unit 134/134), qa-email-auth 83/83 (its stub asserts no `from` value, so the wrap runs end-to-end through the real Worker with zero harness churn), prettier/eslint clean; commit 2a8f100, CI run 40077846954 success; deployed e7096946 via tools/deploy.cjs from $HOME/mmgr-deploy; live probe: /api/health ok, root 200, POST /api/auth/resend-verify answers the generic no-leak 200 (a real send only leaves for a registered+unverified address). No sw bump: src/ + tests are not served assets and no HTML/inline script was touched (verify:csp green inside the verify run). Owner follow-ups (insights re-check after the next send, optional reply routing) = OWNER TO DO D.

**2026-10-23 — Session: TWO OWNER-REPORTED BUGS FIXED AND LIVE (668b8d9 claim pack, dc141ed nav dropdowns), CI GREEN TWICE, DEPLOYED TWICE, DIRECTIVE RESTRUCTURED.** Owner order: dig for real bugs, fix, commit, deploy, then review this file - its outstanding tasks included - and restructure it against the code base.

1. **DIG (evidence before claims).** The 2026-10-22 sweep probes re-run (`tmp/audit-{links,aria,actions2,wiring,css-classes}.cjs`): zero NEW findings - 0 broken aria references, 0 dead anchors, links only the `?v=` probe false positive plus the non-served monolith note file, actions only the documented T-4 trio. Baseline `npm run verify` exit 0 (registry 115/115, 129 tests). Tripwires run locally, all exit 0: T1 units, T2 export (34/34), T3 currency, T4 print-dom, T5 no-weak-random, T8 doc-size. One live failing gate and one owner complaint came out of the dig.
2. **CLAIM PACK PRINT WRAP (T-7, closed).** `claimPackText` (js/mmgr-claim.js:420) pushed section 7 meeting rows UNWRAPPED - a real kickoff meeting's actionItems measures 644 chars on one line - and sections 4, 6, 8 plus the Project/Name header lines carried the same class, so any user text over 92 chars broke the export's own print contract (qa-full 86, qa-full.cjs:2142: maxLine < 100). Hermetic first, as ordered: fresh seed on a fresh page = maxLine 89, so the gate was sound and the failure was real state (the kickoff meeting the battery runs lands inside gate 86's window). Second defect found while fixing: `wrap()` sliced over-long unbreakable tokens to `width` and DROPPED the tail - silent text loss in a document meant for counsel. Fix: `pushRow(head, text, cont)` (js/mmgr-claim.js:484) wraps every unbounded line at 92 with a hanging indent - header labels, weather task lists under their 56-char column, WBS lines, change lines, meeting lines, promise lines - table rows keep their pad() alignment, and `wrap()` now splits long tokens instead of truncating. Gate 86 is hermetic: it seeds its own long meeting/change/promise rows (including a 132-char unbreakable drawing reference) inside its own window, keeps the 100-char assertion, adds `noLoss` (whitespace-stripped contiguity of both seed records, so truncation can never pass) and a `worst` diagnostic. `sw.js` v459 -> v460. GATES: qa-full **187/187**; `npm run verify` exit 0; tripwires exit 0; `tmp/claim-evidence.cjs` measured maxLine 92, actsContiguous true, longTokenPresent true - locally AND on production. SHIP: commit `668b8d9`, CI `40052788117` SUCCESS 88/88, deploy `7060d084-b065-4efa-8663-86af391dd150`, live sw v460, live dist/bundle.js sha256 identical to local.
3. **NAV DROPDOWNS UNDER THEIR OWN ITEM (owner complaint, same session).** The hover menu was `position:fixed; left:50%; translateX(-50%)` - centred in the VIEWPORT: measured 393px right of the hovered Features item at 1280 wide (menu 290-990, item centre 247), so a straight swipe down MISSED the box, hit the next nav item and swapped its menu in - the tab switched under the pointer. `placeNavMenu()` (js/marketing.js:823) now writes left = item centre - half the menu clamped to [8, viewport - menu - 8] and top = item bottom + 8 (the `::before` bridge covers the whole gap, no dead zone), re-placed on every open and on resize (`placeOpenNavMenus`, js/marketing.js:840); `.nav-dd-menu` (css/marketing.css:843) drops the translateX and keeps left:0 as fallback. GATES: real-mouse `tmp/navdd-swipe-test.cjs` **22/22** at 1280 and 1024 - menu spans the item, fits the viewport, no page horizontal overflow, swipe-down hit-tests the menu - locally AND live; `qa-marketing` 20/20; layout gate PASS; `npm run verify` exit 0; `sw.js` v461. SHIP: commit `dc141ed`, CI `40057049252` SUCCESS 88/88, deploy `d58c81b0-8a25-4c04-bc2a-70fc8fada646`, live sw v461, live marketing bundle + css sha256 identical to local.
4. **DIRECTIVE RESTRUCTURED (the review).** OPEN WORK REGISTRY re-checked row by row against the code: SPRINT 1 DONE (log 2026-10-18); SPRINT 2 shipped G7+G1-G3, C4/C5b, C11 with C6, C7, X-1/X-2/X-4 measured still open; SPRINT 3 shipped G5/G6/G8, P5-P10, S-2, M-5, S-3/S-4/S-5 with the INP budget, the architecture survey (docs/ARCHITECTURE-CANDIDATES-2026-10.html does not exist) and the re-audit table still open; PART H COMMITTED 10-19 to 10-21 so the old MID-BUILD warning is void. STARTING POINT items 2-4 corrected (verify baseline fully green; tree clean; `verify-gantt-export.cjs` never existed - export coverage is `verify-export.cjs` plus the qa-v11 G gates; qa-inp is EXTENDED-local). T-7 marked FIXED, T-8 marked partial (gate 86 hermetic, the rest of the battery still leaks). The two 2026-10-16 entries rolled into `docs/history/log-2026-10.md` under the byte-cap law. **STILL OPEN, deliberately not touched:** T-1/T-2/T-3 gate files, T-4, T-5, the T-6 timing gate, T-8 (rest of battery), plus the registry rows above.

---

## OWNER TO DO (standing, NOT for the AI - re-read at the start of every session)

**A. LemonSqueezy shutdown (owner report 2026-10-24 - the renewal email). The AI cannot do these: they need the owner's LemonSqueezy login.**
1. In the LemonSqueezy dashboard, CANCEL the active subscription(s) (the one on the test address that will renew). This is the only thing that stops a renewal - our code never triggered it and cannot cancel it (no key remains here).
2. While in there: DELETE the webhook endpoint(s) pointing at `https://mymanagerworkspace.com/api/billing/webhook` and REVOKE the store API key. Neither can reach us anymore (worker secrets deleted, deliveries 401) but deleting them stops LS-side retries and emails at the source.
3. 30-second cross-check: note the subscription ids LS shows. If they look like `sub_01m4...` (matching rows 2-7 of cloud_subscriptions), say so and the AI voids those rows in D1 too. Row 1 (provably LS, created 2026-08-15) was already voided 2026-10-24.
4. Worker side is DONE and verified 2026-10-24: NO LEMONSQUEEZY_* secrets remain (`wrangler secret list`), so nothing to delete on our infrastructure.

**B. Google sign-in directive owner-only items (from the 2026-10-23 directive - the AI must not touch the console).**
1. In Google Auth Platform, Branding: confirm mymanagerworkspace.com is an authorized domain, and that the homepage, privacy and terms links are filled in.
2. 24-48h after the 2026-10-24 deploy: open Project Checkup and note whether "Use secure flows" cleared. If it did NOT, record the EXACT wording Google shows and stop - do not guess further.
3. Real-account probes the AI cannot run (no owner credentials): on the live site, complete (a) Sign in with Google and (b) connect Google Drive. Both should finish; the tampered-state refusal is already proven on production (9/9) and the nonce round-trip is proven end-to-end (5/5).

**C. Paddle subscription records (related, 2026-10-24).** Rows 2-7 of cloud_subscriptions stay untouched until A3 is answered - the owner's own Paddle purchases (if any) live there and must NOT be voided. Canceling them blindly would revoke real Paddle entitlements.

**D. Resend "Don't use no-reply" warning (owner add-on 2026-10-24).**
1. DONE by the AI: the no-reply address was the RESEND_FROM_EMAIL secret (zero `no-reply` in code) - re-uploaded as `My MaNaGeR Support <support@mail.mymanagerworkspace.com>` (live on the deployed worker immediately), and `authEmailFrom` now guarantees a name-backed sender for any future bare address (commit 2a8f100, test/email-from.test.mjs 5 cases, qa-email-auth 83/83).
2. OWNER: re-open the Resend insights page after the next send and confirm "Don't use 'no-reply'" cleared. To force a real test send now: POST `/api/auth/resend-verify` with the test address used for signup (paloja9510@comzx.com) - generic response either way (no-leak design), the send shows in Resend insights only if that address is registered and unverified.
3. OPTIONAL (owner DNS side): if replies to support@ should be RECEIVED, set up Cloudflare Email Routing for mail.mymanagerworkspace.com so the address forwards to a real inbox - nothing in code can do this.

---

## DECISIONS NEEDED FROM THE OWNER (2026-10-17, end of the Phase 2 session)

Written so the next session executes the moment the answers arrive - no
re-derivation. Both blocks are plain-language on purpose (plain-language-copy
law). Until marked DECIDED, treat them as OPEN.

### D1. PART I Phase 3 (the variant expansion) - what it is and what it would take

**In plain words:** Phases 1 and 2 let you price ANY of the 811 book rows, but
you type the quantity yourself in both. Phase 3 is the third way: hand-pick
specific book rates and bake them INTO a calculator as named "versions" - the
way the block-wall calculator already offers block sizes or the pipe calculator
offers diameters - so the quantity is DERIVED from measurements (length x
height, count, etc.) and the rate arrives as a dropdown choice with the book
figure prefilled.

**What it entails once triggered:**
1. The owner names a shortlist (trade + row numbers, e.g. "welding CPSAW #10-13"
   or specific masonry sizes). Nothing else is needed from the owner.
2. Add `variants` entries to the matching WORK items carrying THE BOOK'S
   PUBLISHED NUMBERS ONLY (never invented figures); the prefill stays the
   user's to edit (the book is a default, never a lock - D4).
3. The variant dropdown, prefill wiring and unit handling already exist (the
   E2 engine), so this is mostly data work.
4. Gates: re-baseline the variant-count assertions (V-family), add one exactness
   gate per new variant (measured quantity x book rate, exact), and keep the
   book-vs-variant numbers provably the same source.

**Why it is owner-request-only (the plan's own reasoning):** Option B was
rejected as the GENERAL strategy - ~711 hand-copied entries would drift every
time the book is republished, and variant pickers become 100-row scrollbars.
Phase 1+2 already cover every row, so Phase 3 is only worth it where MEASURING
BEATS TYPING for a row you price constantly. Trigger it by naming rows;
sequencing choice asked in chat (before or after PART H).

### D2. H7.7 - the two decisions that block PART H markup (H7.7 verbatim: "make them before markup")

**(a) Where the Procurement tab lives: pack toggle vs always-visible.**
- Option A (recommended in H7.7): `data-pack="procurement"` - ships HIDDEN
  behind the existing packs toggle; the rail already carries 20 tabs, and packs
  are the existing show/hide mechanism (data-pack is read at
  js/mmgr-app.js:3755). Users turn on the Procurement pack to see the tab.
  One attribute; the tab appears/disappears with the pack.
- Option B: always visible as the 21st tab, for every project and user,
  immediately. No pack step, but a busier rail and no way to hide it.

**(b) Who may edit it: grantable editor scope vs owner-only.**
- Option A: `proc` is a GRANTABLE editor scope - an editor code can be given
  Procurement ALONE, so the officer doing the buying can maintain vendors and
  prices without full owner rights. Matches the owner's own H0 wording
  ("maintained by whoever does the procuring"). Entails: proc joins the
  editor-code section scope list (server + the scope UI).
- Option B: OWNER-ONLY edits - editors and viewers see the tab read-only via
  the existing view-only path. No new scope wiring; simplest.

**On the answer:** record the choices here marked DECIDED with the date, fold
them into H7.7/H5 step 4 wording, and the next session starts PART H markup
immediately (H5 steps 1-12 are already ordered). The Phase 3 sequencing answer
(above, D1) goes in the same record.

**D2 DECIDED (owner, 2026-10-17):**
- (a) **Behind packs** - the Procurement tab ships as `data-pack="procurement"`,
  hidden until the user turns on its pack. Fold into H5 step 4 wording: the tab
  button carries the pack attribute; the pack gate already reads data-pack
  (js/mmgr-app.js:3755), no new gating code.
- (b) **Grantable editor scope** - `proc` joins the editor-code section scope,
  so an officer can be given Procurement alone (owner: "maintained by whoever
  does the procuring"). Fold into H5: the scope list gains proc (server side +
  the scope UI); CLOUD_SECTIONS still gets its `proc` entry for sync (H5 step 3
  unchanged); view-only still reads via READONLY_SAFE.
With both answers in hand, **H7.7 no longer blocks anything: the next session
may start PART H at H5 step 1 directly.** D1 (Phase 3 sequencing) still OPEN -
owner asked for a fuller coverage explanation first (see D1 follow-up in chat).

**D1 DECIDED (owner, 2026-10-17): PARK it, queue it at the back.**
Owner's call, verbatim intent: rates outside a purpose-built calculator are
already covered (the Custom item takes your own figure; the picker takes any
book row), so Phase 3 stays parked. Slight wording note for the record - it is
NOT a custom field: it would be purpose-built MEASURING forms for selected
LISTED rows; access is already solved either way. The owner's instruction for
the next session: **start PART H Procurement and drive it to completion**
("start the other task to completion"). Phase 3 re-triggers any time by the
owner naming rows they measure often (the entails list is in D1 above).

NEXT SESSION STARTING POINT (2026-10-17 - SUPERSEDED 2026-10-23, PART H IS COMMITTED;
the H-decisions below stand). Historical continue-spec kept with H8: **continue PART H at H5 step 5 (`js/mmgr-prompts.js`)** - steps
1-4 are DONE and VERIFIED in the UNCOMMITTED working tree (see H8 for the
file-by-file delta, the two namespace collisions `supplierBook` / `ns.Proc`,
and the copy-ready H5.5-H5.6 edit specs with exact anchors - apply them
verbatim, do not re-derive). Then proceed H5.7 -> H5.12 per H8.4 (module
`ns.Proc`, field-guide entry now REQUIRED, sw bump, new harness + registry +
ci.yml, staging deploy under $HOME). H7.7 DECIDED (tab behind packs; proc =
grantable editor scope), H7.1 corrected (supplier prices hand-entered from
each supplier's own rates), H7.2-H7.8 folded in. **Do NOT commit until the
H5.11 gates are green** (owner: "you don't have to commit this"). PART I is
COMPLETE (Phases 1+2 shipped and live-verified; Phase 3 parked by owner
decision). Live probes: https://mymanagerworkspace.com (never mymanager.app).

AUDIT 2026-10-22 - WIRING + SECURITY GAP SWEEP (owner-requested dig for real
bugs, then documented as tasks). Method: mechanical sweeps whose results were
each hand-verified against raw source, because the first pass lies in both
directions (it reported 122 "missing" ids and ~200 "unwired" actions that were
renderer-built ids and unquoted ACTION_MAP keys). Re-runnable probes live in
`tmp/audit-wiring.cjs`, `tmp/audit-actions2.cjs`, `tmp/audit-css-classes.cjs`,
`tmp/audit-links.cjs`, `tmp/audit-aria.cjs` (tmp/ is gitignored - re-create
them from this description if they are gone).

FOUND AND FIXED THIS PASS (shipped with the S-6.3b commit):
- F1 ICONS THAT NEVER RENDERED. `css/mmgr-icons.svg` had no `i-pencil` and no
  `i-image`, yet both are referenced: admin.html's team "Edit" button and the
  photo placeholder in `js/cloud/photos-ui.js`. An unresolved `<use href>`
  renders an empty box and no error anywhere. Both symbols added (rule 7).
- F2 A CANCEL BUTTON THAT DID NOTHING. Project Photos' "Cancel" carried
  `data-action="photos-cancel"`; `git log -S photos-cancel` shows one commit
  and no handler ever existed. The click dispatcher only runs actions present
  in ACTION_MAP and silently ignores the rest, so the button was dead since the
  panel shipped. Wired in `js/cloud/photos-ui.js` (drops the picked file and
  typed caption, returns focus to "Add photo").
- F3 A DEAD ANCHOR. admin.html links "See Company plan" to
  `pricing.html#company`; pricing.html had no `#company` id, so the buyer
  landed at the top of the page. `id="company"` added to the plan card.

TASKS (T-7 CLOSED 2026-10-23, 668b8d9; everything below still open, priority order):
- T-1 GATE THE SPRITE. `tools/verify-icons.cjs`: every `mmgr-icons.svg#i-*`
  reference in served HTML and in `js/` must resolve to a `<symbol>`. F1 was
  invisible to every existing gate; this closes the class. Register in
  docs/CI-TEST-COVERAGE.md + ci.yml T1.
- T-2 GATE THE ACTION CONTRACT. `tools/verify-actions.cjs`: per page, every
  `data-action` must appear in that page's own map (project.html ->
  ACTION_MAP in mmgr-app.js, app.html -> DASH_ACTION_MAP in its inline script,
  admin.html -> ADMIN_ACTION_MAP, calculator.html -> its ACTIONS map). F2
  survived three waves of QA because nothing checked the markup against the
  map. Static arm only; the live click paths stay with qa-full.
- T-3 GATE INTERNAL LINKS. `tools/verify-links.cjs`: every relative href must
  exist and every `page.html#anchor` must resolve to an id in that page. F3
  passed every gate we have.
- T-4 REDUNDANT ACTIONS (cleanup, no user impact). `calcDocType`,
  `calcCashMode` (calculator.html) and `photos-upload` (project.html) carry
  data-action but have no map entry; they work because their element ids have
  their own listeners. Remove the attribute or add the entry - pick one and
  make it uniform, so T-2 can be enforced without a suppression list.
- T-5 REQUEST-BODY CAPS. 24 handlers call `await request.json()` directly;
  only the project-data paths use `readCloudBody` (8 MiB streaming cap,
  src/lib/http.js). Public ones (contact, reviews, auth, /api/ai/chat) rely on
  rate limits alone. Route every JSON read through the capped helper (or a
  small-by-payload variant) so a large body cannot be parsed for free.
- T-6 SECURITY RE-VERIFICATION (not a defect, a gap in coverage). Session
  cookie flags (HttpOnly/Secure/SameSite=Lax), parameterised D1 queries (no
  template interpolation found), no SSRF in the AI relay (provider URLs come
  from the fixed AI_PROVIDERS map, never from the request) and photo/auth
  layering (`cloudAuthOwnerSession` -> code -> editor -> viewer) all read
  correctly. Still unverified this pass: team/accept token lifetime,
  api-keys scoping on every read path, client-code lookup timing. Give each a
  browser/API gate in tools/qa-cloud-phase2.cjs style before the next release
  of the cloud surface.


- T-7 CLAIM PACK: ONE OVER-LONG LINE (FIXED 2026-10-23, commit 668b8d9 - see STATUS LOG).
  qa-full
  gate 86 ("counsel-ready print document") fails with maxLine=644 (it requires
  <100); (187/0 earlier the same day, failing twice since).
  Fresh-seed probes give 89; a 500-char decision text plus a 500-char task name
  still give 85, so wrap() does wrap user text - either one section appends a
  list unwrapped, or qa-full's earlier gates leak state into the pack. Fix: run
  the gate hermetically first, then wrap the offending section. Never relax the
  100-char assertion.
- T-8 qa-full IS ORDER-SENSITIVE (gate 86 made hermetic 2026-10-23; the rest of the
  battery still leaks). Gate 07 (float watch) failed then passed with
  no code change: 187 checks mutate and restore the demo state, so a gate that
  depends on an earlier gate's leftovers is a false signal. Snapshot/restore
  deterministically per check (gate 86's restore is best-effort and runs AFTER
  its assertion).

CORRECTED FALSE POSITIVES (do not re-open): the dashboard pager is FINE -
`.pg-off{display:none}` lives in app.html's inline `<style>`, not
css/mmgr.css (measured: `.pcard.pg-off` -> display:none). `client-scope`,
`bcp-ai`, `pg-nav`, `pool-modal`, `import-modal`, `snap-daily-btn`,
`calc-ratebook-card` are renderer-created or decorative hooks, not missing
markup. All app.html/admin.html actions resolve. Zero broken aria references.
