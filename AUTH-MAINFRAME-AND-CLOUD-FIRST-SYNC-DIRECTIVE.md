# My MaNaGeR — AUTH MAINFRAME + CLOUD-FIRST SYNC + SUBSCRIPTION EMAILS DIRECTIVE

> Created 2026-08-17 from the owner's session: rate-limiter correction, local
> access-code model clarification, the cloud-first project vision, the auth
> "mainframe" hardening pass, and subscription confirmation emails.
> Sessions reset hourly — this file plus the STATUS LOG in
> `CONTINUATION-DIRECTIVE.md` are the memory. Read both before working.

---

## PART 1 — CLARIFICATIONS (verified against code, 2026-08-17)

### 1.1 The crawl 429 was NOT the app's rate limiter
Owner: "If 10 requests crawl tripped, it should not be looking to that."
VERIFIED: the app's limiter only covers `/api/*` routes — static page GETs are
never rate-checked (worker.js fetch handler). Re-ran the exact burst twice
(10 distinct pages rapid + 12x same page): all 200. The earlier 429s were
transient Cloudflare-edge blips on the *.workers.dev hostname, not the app.
**No fix needed.** App limits: general 120/min per IP; auth 30/min per IP.

### 1.2 Local access codes do NOT transfer data (owner is correct)
The project data lives in the browser's localStorage (`mmgr_state_<pid>`);
`projects-data.js` ships only SHA-256 hashes of codes. A code entered on
another device cannot summon data from the first device — physically
impossible. A local code is only a gate on the device that ALREADY has the
data (post-import / post-cloud-load). The real cross-device keys are the
cloud owner/editor codes (server-side enforced). The cloud-first model in
PART 3 is the coherent replacement.

### 1.3 Duplicate email signups are already impossible
`auth_users.email` is the PRIMARY KEY, plus a pre-check SELECT, plus a
concurrent-registration race guard, plus lowercase normalization. No bug
exists; no change needed.

### 1.4 Email provider decision — Resend
Researched via Gravity Index (2026-08-17): **Resend** wins for this stack —
free tier (3,000 emails/mo, 100/day), plain REST `fetch` from the Worker
(no SDK), no Node dependency. Env vars needed (owner action, see OWNER-REVIEW):
`RESEND_API_KEY`, `RESEND_FROM_EMAIL`.

---

## PART 2 — AUTH MAINFRAME (owner-approved scope)

### 2.1 DONE THIS SESSION (worker.js + migration 0012, no credentials needed)
- **Rate-bucket split**: `auth` -> `authRegister` (30/min) + `authLogin`
  (30/min); login spam can no longer consume register's budget or vice versa.
- **Per-account lockout** (`auth_login_guard` table): 5 failed passwords ->
  15-min lock; 10+ -> 1 hour; explicit "Too many failed attempts — try again
  later or contact support." 429 with Retry-After; success clears the row.
  Unknown emails keep the generic 401 + dummy-PBKDF2 timing (no existence
  leak). NOTE (accepted trade-off): a locked account response reveals the
  account exists after 5+ wrong passwords — industry-standard for lockout.
- **Session revocation + jti** (`auth_sessions` table): every issued session
  carries a random `jti` recorded in D1. `/api/auth/logout` now revokes
  server-side; NEW `/api/auth/logout-all` revokes every session for the
  account (sign-out everywhere). `readSession` rejects revoked jtis on every
  authenticated route. Pre-table cookies (no jti) are accepted once and
  renewed with a jti on the next `/api/auth/me` — no mass logout on deploy.
- **Lazy sliding renewal**: `/api/auth/me` re-issues the cookie when the
  session is >24h old (same jti, fresh 7-day expiry), bounded by a 30-day
  absolute cap — active users are no longer silently logged out at 7 days,
  and a stolen cookie cannot live past 30 days.
- **Password change API**: `POST /api/auth/password { currentPassword,
  newPassword }` — session-gated, email accounts only, verifies current
  password, swaps the PBKDF2 hash, revokes every OTHER session (theft
  signal). UI wiring deferred to the mainframe UI pass.
- **Session-row sweep** in the daily cron (expired / long-revoked rows).

### 2.2 DONE (2026-08-17 — Resend key provided; dev sender onboarding@resend.dev)
Built + verified 40/40 in tools/qa-email-auth.cjs (local D1 + Resend stub,
zero real Resend calls):
- **Email verification on signup** (worker.js + migration 0013): register
  mints a signed one-time verify token (HMAC, 24h, single-use, ledger row in
  `auth_tokens`) and emails it via Resend. `POST /api/auth/verify { token }`
  consumes it (race-safe conditional UPDATE — replays answer 400) and marks
  `auth_users.email_verified = 1`. Existing accounts are backfilled to
  verified (grandfathered); NEW signups start unverified.
- **Verified-email cloud gate** (`handleCloudCreate`): an email session with
  an unverified address cannot link a cloud project — 403
  `{verifyRequired:true}` (this is what kills account-occupation). Google
  sessions are never gated; the gate is OFF when RESEND_API_KEY is unset
  (dormant = byte-for-byte unchanged). Enforced at create, so verification
  takes effect on the next attempt.
- **Forgot password / reset**: `POST /api/auth/forgot { email }` -> signed
  one-time reset token (30 min, single-use) emailed; `POST /api/auth/reset
  { token, newPassword }` swaps the PBKDF2 hash + revokes ALL sessions for
  the account + clears its login lockout. Generic response either way
  ("If an account exists for that email, a reset link is on its way.") with
  dummy-PBKDF2 timing on the unknown path; per-email quota 5/hour
  (`AUTH_RESET_MAX_PER_EMAIL_H`) answered with the SAME generic message so
  the quota itself cannot be probed.
- **Sender**: `RESEND_FROM_EMAIL` secret, falling back to the free
  `onboarding@resend.dev` (only delivers to the Resend signup address — fine
  for dev; real users need the verified domain). `RESEND_API_BASE` is a
  TEST-ONLY seam (never set in production). Emails are plain text, sent
  via plain REST `fetch` — no SDK, no Node dependency.
- **Rate buckets**: `authForgot` (10/min/IP) + `authToken` (30/min/IP) added
  to CLOUD_RATE; daily cron now also sweeps stale auth_tokens rows.
- **Subscription emails** (PART 4) built + verified in the same harness.

### 2.3 DONE (2026-08-17) — verify/reset pages; still deferred: Settings UI
- **`/verify.html` + `/reset.html`** (the links in the verification + reset
  emails) — SHIPPED with external controllers `js/verify.js` + `js/reset.js`
  (CSP script-src 'self', zero hash churn). verify drives `/api/auth/verify`;
  reset validates the password client-side then drives `/api/auth/reset`.
  Both have loading / success / error / sent states plus a RECOVERABLE error
  path: a dead-link form posts `/api/auth/resend-verify` (verify) or
  `/api/auth/forgot` (reset) — both generic-response no-leak endpoints with
  the 5/hour/email quota. Same design language (marketing.css tokens, solid
  card per Gate 6.1, dark-mode parity, reduced-motion spinner kill, [hidden]
  guards, sprite icons, no emoji). Browser-smoke-tested (all states) +
  harness 43/43. Screenshots: tools/auth-{verify,reset}-light.png.
- MFA (owner: keep login seamless for now). Yahoo/Microsoft OAuth (paused).
- Settings UI for password change (the /api/auth/password API exists; the
  app.html/admin.html Settings wiring is still pending).

---

## PART 3 — CLOUD-FIRST PROJECTS + LIVE SYNC (owner vision, design stage)

Owner's model, restated: create the project in the cloud FIRST; share a link
(or code) so recipients access the CLOUD version (view-only by default);
recipient can click an in-project icon "Make offline copy" — the server
REGISTERS that offline copy against the cloud project; when the main project
updates, every registered offline copy shows an "Update offline copy" icon
and can pull the new data for offline use; changes are auto-saved (no toggle).

### 3.1 What already exists (verified)
- Cloud create/save/load (owner+editor+viewer codes, server-side scope),
  auto-save debounce + pagehide flush, manual Load from Cloud, T9 adoption
  (pinned copies with role), changelog + revert, Presence WebSocket
  (roster ONLY — who's online, never content).

### 3.2 The gap (verified — nothing does this today)
- NO polling or live content push. A change on the main device sits in the
  cloud; another device sees it only after a manual Load from Cloud (full
  page reload). The owner's change-order scenario does NOT work today.

### 3.3 Build plan — DESIGN APPROVED 2026-08-17 (owner answers to the three sign-off questions)

**Scope: APPROVED AS SCOPED (live refresh on save).** Owner: "doccument this
in continious directive and i choose aproved as scoped later we can add a
feature where admin review and update from another source and accept
changes." The approved model is: copies update when the main device saves —
NO simultaneous co-editing, last save wins, changelog history retained.

**REVIEW QUEUE: BUILT 2026-08-17** — the "admin review and accept changes
from another source" feature shipped (owner approval: BOTH editor saves +
MCP imports go through review, ALWAYS ON, review-list-with-status). A
non-owner change (editor save or MCP import) becomes a PENDING proposal in
cloud_reviews (migration 0015) and does NOT move the cloud snapshot until
the owner ACCEPTS (applies through the same scope merge + changelog
'accepted', revertible) or REJECTS (discarded + changelog 'rejected'). The
editor sees their proposal's status on their side (pending / accepted /
rejected); the owner reviews diffs in the Cloud drawer. This OVERRIDES the
"last save wins" clause for non-owner sources: only accepted changes move
the project (and only they push rev-changed to copies). Owner saves still
apply instantly.

**Offline copies: VIEW-ONLY** (owner: "View-only") — a registered offline
copy is read-only everywhere; it can never edit the cloud project.

**Reconcile: auto-sync-up + admin-gated broadcast** (owner: "the local is
conected to the cloud so any changes made should automaticall be updated to
the cloud when internet is conect and a sync canhappen and it broadcast and
overite all other project when the admin click broadcast to other projects
or the admin can turn on auto broadcast for that specific project") — the
local device pushes its changes to the cloud whenever a sync can happen
(already true: autoSaveToCloud), and the ADMIN controls propagation to
copies: a manual "Broadcast to other projects" action, or a per-project
AUTO-BROADCAST toggle that makes every save broadcast. Copies never fight
the cloud (view-only + last-save-wins), so there is no keep-local prompt.

Build plan (queued — complex-L):
1. **Cloud-first creation flow**: "Create in cloud" becomes the primary path
   for new shared projects; offline attach/download is derived from it.
2. **View links**: shareable link carries a view code (existing viewer-role
   machinery) — recipient opens the CLOUD view, no local copy made.
3. **"Make offline copy" icon** in-project: POST registers the copy
   (new table: offline_copies { id, cloud_project_id, device_id, created_at,
   last_pulled_at, last_cloud_rev }) — server registers it, per owner.
   Registered copies are view-only.
4. **"Update offline copy" icon + auto-pull**: when a registered copy's
   revision is behind (compare savedAt/changelog rev), show the icon;
   pull refreshes only changed sections (no full reload).
5. **Live broadcast**: upgrade the Presence WebSocket from roster-only to
   also broadcast `{ type: 'rev-changed', revision }` to connected viewers
   (still never project content); open copies refresh instantly instead of
   polling. **Plus the owner's broadcast control**: `POST
   /api/cloud/projects/:id/broadcast` (admin clicks "Broadcast to other
   projects") pushes the current revision to every registered copy, and a
   per-project `auto_broadcast` flag makes every save broadcast
   automatically. Web page first, then the same flows port to a native app
   later — the PWA is already installable.

---

## PART 4 — SUBSCRIPTION EMAILS (DONE, 2026-08-17)

LemonSqueezy webhook (`/api/billing/webhook`, signature-verified, the only
writer of cloud_subscriptions) handles lifecycle events. SHIPPED:
- **Purchase confirmation**: on `subscription_created`, email the customer
  (Resend): "Your My MaNaGeR subscription is confirmed" + plan locked in.
- **Cancellation notice**: on `subscription_cancelled`, email the customer:
  "Your My MaNaGeR subscription was cancelled".
- Recipient: `attrs.user_email` from the LS payload, falling back to the
  account's own email for email accounts (owner_sub 'email:' namespace).
- DORMANT until RESEND_API_KEY is set (same pattern as the billing tier);
  never blocks or changes the webhook result (best-effort + logged).
  Verified in tools/qa-email-auth.cjs E10a/E10b (stub capture).

---

## PART 5 — OWNER ACTIONS
1. RESEND: key created + stored as a Wrangler secret (done 2026-08-17).
   The sending DOMAIN is NOT yet owned: when `mymanager.app` is bought,
   add it in Resend (Manual setup DNS is the reliable path — the Auto
   configure / Domain Connect flow fails on this Cloudflare account with
   "You are not authorized to make changes to workers.dev"), verify, then
   flip the `RESEND_FROM_EMAIL` secret to admin@mymanager.app. Until then
   dev/testing uses the free `onboarding@resend.dev` sender.
2. ~~Review PART 3 design~~ REVIEWED + APPROVED 2026-08-17 against the
   code (the pieces it builds on are all live: viewer codes, adoption,
   changelog, Presence DO) with the owner's three answers recorded in
   §3.3 (scope = approved-as-scoped live refresh; copies view-only;
   reconcile = auto-sync-up + admin broadcast / per-project auto-broadcast).
   The complex-L cloud-first sync build started in the same session — see
   the CONTINUATION-DIRECTIVE.md STATUS LOG.
3. ~~Walk the auth changes after deploy~~ the whole auth wave is DEPLOYED
   2026-08-17 (migrations 0012+0013 remote, worker versions
   `79d8e536…` + `505eb85b…`): wrong-password lockout, sign-out
   everywhere, password change, verify-email gate, 24h+ session renewal.
4. ~~Ship `/verify.html` + `/reset.html`~~ DONE (2026-08-17, §2.3).
5. ~~Settings UI for password change~~ DONE 2026-08-17 (the deferred §2.3
   item): the shared Change-password control is wired into the signed-in
   chip on app.html/admin.html, the marketing sign-in sheet, and
   project.html Settings ▸ Controls ▸ Profile (email accounts only).
   Field guide A-15 documents it; sw.js v135.
