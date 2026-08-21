# OWNER-REVIEW.md — Things Only the Owner Can Do

> **Referenced from CONTINUATION-DIRECTIVE.md (PART E — OPERATIONAL + STATUS LOG).**
> This is the single checklist of everything that needs the owner (Garfield) in
> person: secrets/credentials, deploys with real-world side effects, and product
> decisions no model should make alone. Agents: work through the directive's OPEN
> code items and leave THIS list for the owner; check items off here ONLY when the
> owner confirms them in chat. Owner: review top-to-bottom, tick what you've done,
> and tell the next session what you decided.
>
> Last updated: 2026-08-14 (owner decisions recorded in §2/§3; FREE_PROJECT_CAP
> default now 8 and LIVE (deployed 2026-08-14, version `21a508b8…`); the
> marketing + field-guide email sign-in and the BUG-10 sidebar fix are deployed.
> §1.1 troubleshooting notes apply to the LIVE origin; §1.2 still PAUSED).

---

## 1. 🔑 Secrets & credentials (only the owner can create/provide these)

### 1.1 LemonSqueezy billing (unblocks the paid tier end-to-end)
The billing server-side is DONE + verified (worker.js `/api/billing/status`,
`/api/billing/checkout`, signature-verified webhook, `FREE_PROJECT_CAP` create
gate with 402 `{upgrade:true}`) and the client upgrade UI is DONE + verified
(402 → gold Upgrade-plan banner → checkout in a new tab). It is DORMANT until you
set these three Wrangler secrets (all three required together):

```bash
npx wrangler secret put LEMONSQUEEZY_API_KEY          # your LS API key
npx wrangler secret put LEMONSQUEEZY_WEBHOOK_SECRET   # webhook signing secret (URL: /api/billing/webhook)
npx wrangler secret put LEMONSQUEEZY_VARIANT_ID       # the checkout variant id (numeric)
```

✅ **ALL THREE SECRETS SET — CONFIRMED 2026-08-13** via `npx wrangler secret list` on
`my-manager`: `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_WEBHOOK_SECRET`,
`LEMONSQUEEZY_VARIANT_ID` all present. **Variant ID: `2013675`** (logged 2026-08-13
per the owner — variant ids are public checkout identifiers, not secrets).

✅ **LIVE — DEPLOYED 2026-08-13** (version `2ca85916-f309-483b-a7ee-1c8fdcc6e302`,
`my-manager.garfieldprocis.workers.dev`). Verified on the live origin immediately
after deploy: `/api/billing/status` returns the session-gated generic 403 (route
exists — no more 404), `/api/auth/me` returns `{ok:false,user:null}`, cloud API +
presence routes respond. The billing tier is now ACTIVE: free accounts over
`FREE_PROJECT_CAP` (8, owner decision 2026-08-14) hit the Upgrade flow, and the
Upgrade banner appears.

**Troubleshooting on the LIVE origin (if checkout/webhook misbehave):**
- Checkout 502: the response body now includes LemonSqueezy's own error detail
  (harden added 2026-08-13). Common real causes: (a) the LS API key is invalid or
  belongs to a different store than the variant; (b) the variant `2013675` belongs
  to a **payment-link-style product** — API-created checkouts require a standard
  product/variant (payment-link variants can't create API checkouts); (c) store in
  test mode produces a test checkout URL (expected).
- Webhook 401: the webhook URL + signing secret in the LemonSqueezy dashboard
  (Settings → Webhooks) must match the Wrangler secret and point at
  `https://<your-domain>/api/billing/webhook`, subscribed to the `subscription_*`
  events. Signature is HMAC-SHA256 of the RAW body with `LEMONSQUEEZY_WEBHOOK_SECRET`.

Owner decisions needed once configured:
- [x] Confirm the default `FREE_PROJECT_CAP` — RESOLVED 2026-08-14 (owner): the
  default is now **8 linked projects** for free accounts (worker.js
  `billingFreeCap()` default changed 3→8; env `FREE_PROJECT_CAP` still overrides).
  **LIVE — deployed 2026-08-14** (version `21a508b8-b7d1-4f62-b95c-c8ea4c79da34`):
  the production origin now enforces the 8-project cap.
- [x] Pick the paid plan's variant/price in LemonSqueezy and set `LEMONSQUEEZY_VARIANT_ID` — DONE 2026-08-13: variant **2013675** set + confirmed.
- [x] Confirm where the Upgrade banner should live — RESOLVED 2026-08-12: the
  app.html projects page now has its own free-plan strip ("Free plan — N of M
  linked projects" + Upgrade button, gold .at-limit state at/over cap) rendered
  by js/mmgr-cloud-dash.js loadPlan() from /api/billing/status, next to the My
  Cloud Projects list; the project.html Cloud drawer banner (mmgr-cloud.js) stays
  too. Verified vs the configured harness (0-of-2 → 2-of-2 "limit reached" +
  gold state + checkout click, dark-mode cyan treatment, dormant unconfigured =
  hidden, zero console errors).

### 1.2 Yahoo + Microsoft sign-in (⏸️ PAUSED 2026-08-13 by the owner — revisit later)
Email+password is DONE (register/login, migration 0007). Yahoo and Microsoft were
**paused by the owner (2026-08-13)** — no OAuth credentials needed right now; nothing
was built or disabled (the providers were never wired — they exist only as docs/
comments). When re-opened, they still need their own OAuth client IDs + secrets:

- [ ] Yahoo: create an OAuth app → provide client id + secret (+ redirect URI) → I wire the flow.
- [ ] Microsoft (Entra): create an app registration → provide client id + secret (+ redirect URI) → I wire the flow.

### 1.3 Verify Google sign-in secret is set (deploy prerequisite)
- [x] Confirm `GOOGLE_CLIENT_SECRET` is set as a Wrangler secret — CONFIRMED 2026-08-13
  (`npx wrangler secret list` shows it on `my-manager`).

### 1.4 Admin API secret
- [x] Confirm `ADMIN_CODE` is set as a Wrangler secret — CONFIRMED 2026-08-13
  (`npx wrangler secret list` shows it on `my-manager`).

### 1.5 Resend transactional email (auth mainframe — verification/reset + subscription emails)
Chosen via Gravity Index 2026-08-17: **Resend** — free tier (3,000 emails/mo,
100/day), plain REST from the Worker (no SDK). INTEGRATION **BUILT + VERIFIED
2026-08-17** (40/40 in tools/qa-email-auth.cjs against a local Resend stub):
email verification on signup, forgot-password/reset, the verified-email cloud
ownership gate, and subscription confirmation/cancellation emails
(AUTH-MAINFRAME-AND-CLOUD-FIRST-SYNC-DIRECTIVE.md Part 2 §2.2 + Part 4,
migration 0013 auth_tokens + auth_users.email_verified).

- [x] Resend account + API key created; key stored as the Wrangler secret
  `RESEND_API_KEY` (2026-08-17).
- [x] `RESEND_FROM_EMAIL` — currently the free dev sender `onboarding@resend.dev`
  (delivers only to the Resend signup address — dev testing only).
- [ ] **Buy the `mymanager.app` domain**, then add it in Resend and verify:
  use **Manual setup** (3 DNS records in Cloudflare — MX
  `feedback-smtp.us-east-1.amazonses.com` prio 10, SPF TXT, DKIM TXT with
  proxy DNS-Only); the Auto configure / Domain Connect flow fails on this
  Cloudflare account with "You are not authorized to make changes to
  workers.dev". Once verified, flip the secret:
  `npx wrangler secret put RESEND_FROM_EMAIL` -> admin@mymanager.app.
- [x] Ship `/verify.html` + `/reset.html` — DONE 2026-08-17 (js/verify.js +
  js/reset.js, external scripts, CSP hashes untouched). The email links now
  land on real pages with success/error states + fresh-link recovery.
  Remaining before the emails reach real users: buy + verify the domain and
  flip RESEND_FROM_EMAIL (this checklist's third bullet).

---

## 2. 🚀 Deploy operations (real-world side effects — owner runs these)

All local verification was GREEN before the deploy (npm run verify: CSP 11/11,
SW v81, 16/16 skills; qa-email-auth 26/26; qa-full 171/171). The 2026-08-12/13 wave
is committed + pushed (`7ee863e` docs, `2e20562` feat, `3c0e62b` emoji-free,
`74e0839` checkout harden). **Deploy DONE 2026-08-13** via the tar staging recipe.

- [x] **Apply migrations to remote D1** — ALREADY APPLIED (verified 2026-08-13 before
  deploy: all 8 migrations incl. 0006/0007/0008 present in `d1_migrations`, remote
  tables exist). The Presence DO migration v1-presence auto-applied with the deploy.
- [x] **Deploy** — DONE 2026-08-13 (staging copy excluded `.git .wrangler
  node_modules .agents _archive`; 234 files; version `2ca85916-f309-483b-a7ee-1c8fdcc6e302`;
  https://my-manager.garfieldprocis.workers.dev). Post-deploy curl verified the
  billing/auth/cloud/presence routes answer (no 404s).
- [x] **Deploy (2026-08-14 wave: FREE_PROJECT_CAP 3→8, BUG-10 sidebar scroll fix,
  marketing + field-guide email sign-in, glow verified)** — DONE 2026-08-14 via the
  tar staging recipe (excluded `.git .wrangler node_modules .agents _archive`; 235
  files read, worker script 107.47 KiB, startup 4 ms; version
  `21a508b8-b7d1-4f62-b95c-c8ea4c79da34`, cron `0 6 * * *` preserved). Post-deploy
  curl vs the LIVE origin: root 200 with the NEW index (signin-trigger +
  signin-sheet markup), /mymanager-field-guide serves the new sign-in wiring,
  css/marketing.css carries the .signin-sheet styles, sw.js = `mmgr-shell-v89`
  (incl. the v89 FIELD-GUIDE-EMAIL-SIGNIN comment), /api/auth/me →
  `{ok:false,user:null}`, /api/billing/status + /api/cloud/projects +
  /api/cloud/presence → session-gated generic 403, /app 200.
  NOTE: the worker canonicalizes `*.html` URLs with a 307 to the extension-less
  path (/index.html → /, /mymanager-field-guide.html → /mymanager-field-guide) —
  pre-existing behavior, verified the canonical paths serve the new content.
- [x] Optional: real-Google round-trip of `/api/cloud/prefs/theme` against the deployed origin — **CLOSED 2026-08-14 (owner: "no need user can easily customize at their expense")** — the local harness already proves the flow with byte-identical session cookies.
- [x] **Deploy (2026-08-17 auth-mainframe wave: email verification + password change UI + sign-in identity/nav dropdowns + SEO files)** — DONE 2026-08-17. Migrations **0012 + 0013 applied to remote D1** (`wrangler d1 migrations apply my-manager-db --remote` — auth_sessions, auth_login_guard, auth_tokens, auth_users.email_verified, all ✅). Worker deployed via the tar staging recipe (25 files uploaded, 113 cached; version `79d8e536-adea-4694-a0bd-48e0d863b2ba`, cron preserved). Live curl: /verify + /reset + /reviews serve their real pages, robots.txt text/plain + sitemap.xml application/xml, sw.js = mmgr-shell-v135, /api/auth/me correct signed-out shape.
- [x] **Deploy (2026-08-17 front-page wave: decluttered header + bento glass hero)** — DONE 2026-08-17, version `505eb85b-9bf7-44fe-b55d-9b058e522f5d`, live sw.js = mmgr-shell-v136, live index header pills gone / mobile-menu pills present. See §4 for the visual review.

---

## 3. 🧭 Product decisions (only you can pick these)

- [ ] **Cloud-first sync design sign-off (AUTH directive PART 3)** — reviewed 2026-08-17
  against the code (builds on live pieces: viewer codes, adoption, changelog, Presence
  DO); the complex-L build stays queued until you approve the design. This is the last
  big feature before public launch.

- [ ] **Digest engine real-use gate (blocks Rank 9).** MASTER-ACTION-PLAN Rank 9
  (API/webhook layer) is explicitly deferred until the Rank 2 digest engine has been
  used manually for at least one real project cycle. Use the Weekly/Daily Digest +
  the AI presets on a real project, then tell the next session — that's the unlock.
- [x] **Rank 10 backlog — CLOSED 2026-08-13 (owner go-ahead).** All surviving items
  (21–25: Heat/Cold Safety Alert, SRI, rolling lead-time, subcontractor notice, manual
  weather override) were audit-verified already shipped in code; the Heat/Cold safety
  alert was additionally promoted to a page-top `#safety-banner` this session. Nothing
  remains on the backlog unless you add new ideas.
- [x] **Rank 8 treatment confirmation — RESOLVED 2026-08-14 (owner: "make it so that when
  a new file is created the glow naturally applies to it").** Verified in-browser:
  the glow is a container-level 3-layer radial wash on `#grid::before` (z-index -1,
  `isolation:isolate`) in light db-page mode only, so EVERY card — including a newly
  created file added to `mmgr_admin_projects` — automatically sits above the glow;
  cards keep their opaque `--glass-fill-dark` surface (full text contrast, 8.2
  intact) and dark mode suppresses it (`display:none`). No code change needed — it
  works by construction; the browser check confirmed a brand-new project card
  renders under the glow.
- [ ] **Presence chip** is on by default on project.html ("N online"). Confirm you
  want it always-visible when viewers are present (vs. behind a toggle).
- [x] **Auto-purge retention — CONFIRMED 2026-08-14 (owner: "i agree to this").** The
  12-month no-owner-activity window stays as-is (no change to the purge gate).
- [x] **Email+password auth on the public app — DONE 2026-08-14 (owner: "put at the side
  of the hamburger or where appropriate").** index.html / about.html / features.html /
  contact.html now have a header "Sign in" button beside the hamburger (all
  viewports) — and mymanager-field-guide.html has one in the sidebar (desktop)
  plus one beside its mobile-bar hamburger — opening a sheet mounting the SAME
  shared email+password form
  from js/mmgr-google-auth.js (`mountEmailAuth('marketing-email-auth', {showToggle:false})`)
  — never a duplicate auth implementation; same worker endpoints + `mmgr_session`
  cookie as the app bars; signed-in state shows name/email + Sign out. Browser-
  verified desktop + 390px mobile (no overflow), sheet toggle/Escape/click-outside,
  graceful failure on a worker-less host, and qa-email-auth 26/26 incl. a real
  register→chip→sign-out round-trip against wrangler dev.

---

## 4. 👀 Visual / UX review items (things only you can eyeball)

Each was programmatically verified, but the owner's eye is the final gate:

- [ ] **Dark dashboard** (app.html in dark mode): sidebar rail, 3 metric cards,
  solid content surfaces, fluorescent-blue accent. Open app.html → dark mode.
- [ ] **Light-mode projects glow** (app.html light mode): the new radial glow behind
  the project cards (Rank 8).
- [ ] **Report Issue** (project.html → Controls drawer → Report Issue): Copy/Download
  with the Include-project-context toggle.
- [ ] **Billing upgrade banner** (only visible once LemonSqueezy is configured and
  a free account exceeds the cap): project.html → Cloud drawer.
- [ ] **Email+password sign-in form** (app.html/admin.html auth bar + the new
  marketing-site sheet): toggle, login/register modes, error line.
- [ ] **Presence chip** (project.html header, when a second viewer is open).
- [ ] **Front-page modernization** (index.html): the header now reads Logo → nav →
  Open App → Sign in (Gold/Cyan pills moved to the mobile menu), and the hero
  preview cards are translucent glass over the crane photo. Screenshot:
  tools/front-page-modernize-light.png (2026-08-17).
- [ ] **Password change UI** (email accounts only — sign in with an email account,
  then: marketing sign-in sheet, launcher/admin account chip, or project.html
  Settings → Controls → Profile → Change password): current + new + confirm,
  wrong-current error, "every other device signed out" success. The trigger does
  NOT appear for Google accounts (they have no password).
- [ ] **Heat/Cold safety banner** (NEW 2026-08-13 — project.html top-of-page red/blue
  bar when a heat/cold risk day is in the forecast): confirm the copy/tints read as
  SAFETY, not just another schedule flag.

---

## 5. 🧹 Housekeeping the owner may close out

- [ ] Confirm whether the reconstructed directive files
  (PROJECT-UX-NAV-WEATHER-EXPORT-DIRECTIVE.json, FINAL-PRE-DEPLOY-DIRECTIVE.json,
  FIELD-GUIDE-UPDATE-PLAN.md, MONOLITH-FEATURE-PARITY-DIRECTIVES.json,
  ACTION-PLAN-COMPETITIVE-GAPS.md) read faithfully — they were rebuilt from
  in-directive records after the originals were found missing.
- [x] `_archive/` restore decision — **NO RESTORE (owner, 2026-08-13):** the archived
  executed plans + session txts are redundant records, not of further value; keep them
  archived (they're excluded from deploys).

---

## Status legend

- [ ] = needs you (owner). Nothing here is blocked on a model.
- When you complete an item, say so in chat (or edit this file) so the next session
  checks it off in CONTINUATION-DIRECTIVE.md's STATUS LOG and updates Part E.
