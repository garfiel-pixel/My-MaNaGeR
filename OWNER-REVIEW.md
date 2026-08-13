# OWNER-REVIEW.md — Things Only the Owner Can Do

> **Referenced from CONTINUATION-DIRECTIVE.md (PART E — OPERATIONAL + STATUS LOG).**
> This is the single checklist of everything that needs the owner (Garfield) in
> person: secrets/credentials, deploys with real-world side effects, and product
> decisions no model should make alone. Agents: work through the directive's OPEN
> code items and leave THIS list for the owner; check items off here ONLY when the
> owner confirms them in chat. Owner: review top-to-bottom, tick what you've done,
> and tell the next session what you decided.
>
> Last updated: 2026-08-13 (DEPLOYED to production — §2 done; the full wave is
> live: billing tier ACTIVE, email+password auth, presence, Rank 9 API/webhooks,
> safety banner, emoji-free pages. §1.1 troubleshooting notes now apply to the
> LIVE origin. §1.2 still PAUSED, §3/§4/§5 updated).

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
`FREE_PROJECT_CAP` (3) hit the Upgrade flow, and the Upgrade banner appears.

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
- [ ] Confirm the default `FREE_PROJECT_CAP` (currently 3 linked projects for free accounts — override via env `FREE_PROJECT_CAP` if you want a different number).
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
- [ ] Optional: real-Google round-trip of `/api/cloud/prefs/theme` against the deployed origin (the local harness already proves the flow with byte-identical session cookies).

---

## 3. 🧭 Product decisions (only you can pick these)

- [ ] **Digest engine real-use gate (blocks Rank 9).** MASTER-ACTION-PLAN Rank 9
  (API/webhook layer) is explicitly deferred until the Rank 2 digest engine has been
  used manually for at least one real project cycle. Use the Weekly/Daily Digest +
  the AI presets on a real project, then tell the next session — that's the unlock.
- [x] **Rank 10 backlog — CLOSED 2026-08-13 (owner go-ahead).** All surviving items
  (21–25: Heat/Cold Safety Alert, SRI, rolling lead-time, subcontractor notice, manual
  weather override) were audit-verified already shipped in code; the Heat/Cold safety
  alert was additionally promoted to a page-top `#safety-banner` this session. Nothing
  remains on the backlog unless you add new ideas.
- [ ] **Rank 8 treatment confirmation.** The light-mode projects page now has a
  subtle gold radial glow (spec option 1 of 3 — glow over blueprint texture /
  card thumbnails, chosen per your recommended-option rule). Open app.html in light
  mode and confirm you like it; the other two options remain available if you'd
  rather have texture or thumbnails.
- [ ] **Presence chip** is on by default on project.html ("N online"). Confirm you
  want it always-visible when viewers are present (vs. behind a toggle).
- [ ] **Auto-purge retention** (already decided 2026-08-11): orphaned cloud projects
  auto-purge after 12 months with no owner activity. Confirm the 12-month window
  still feels right now that billing exists (a paying account should arguably never
  purge — say the word and I'll gate purge on active subscription).
- [ ] **Email+password auth on the public app**: the email form currently mounts on
  the app.html/admin.html auth bars. Confirm whether you also want it on the
  marketing site (index.html) or keep registration app-only.

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
- [ ] **Email+password sign-in form** (app.html/admin.html auth bar): toggle,
  login/register modes, error line.
- [ ] **Presence chip** (project.html header, when a second viewer is open).
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
