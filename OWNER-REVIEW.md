# OWNER-REVIEW.md — Things Only the Owner Can Do

> **Referenced from CONTINUATION-DIRECTIVE.md (PART E — OPERATIONAL + STATUS LOG).**
> This is the single checklist of everything that needs the owner (Garfield) in
> person: secrets/credentials, deploys with real-world side effects, and product
> decisions no model should make alone. Agents: work through the directive's OPEN
> code items and leave THIS list for the owner; check items off here ONLY when the
> owner confirms them in chat. Owner: review top-to-bottom, tick what you've done,
> and tell the next session what you decided.
>
> Last updated: 2026-08-12 (after the RANK-8-VISUAL-WEIGHT session).

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

Owner decisions needed once configured:
- [ ] Confirm the default `FREE_PROJECT_CAP` (currently 3 linked projects for free accounts — override via env `FREE_PROJECT_CAP` if you want a different number).
- [ ] Pick the paid plan's variant/price in LemonSqueezy and set `LEMONSQUEEZY_VARIANT_ID`.
- [x] Confirm where the Upgrade banner should live — RESOLVED 2026-08-12: the
  app.html projects page now has its own free-plan strip ("Free plan — N of M
  linked projects" + Upgrade button, gold .at-limit state at/over cap) rendered
  by js/mmgr-cloud-dash.js loadPlan() from /api/billing/status, next to the My
  Cloud Projects list; the project.html Cloud drawer banner (mmgr-cloud.js) stays
  too. Verified vs the configured harness (0-of-2 → 2-of-2 "limit reached" +
  gold state + checkout click, dark-mode cyan treatment, dormant unconfigured =
  hidden, zero console errors).

### 1.2 Yahoo + Microsoft sign-in (both blocked on your OAuth credentials)
Email+password is DONE (register/login, migration 0007). Yahoo and Microsoft need
their own OAuth client IDs + secrets from you — they cannot be guessed:

- [ ] Yahoo: create an OAuth app → provide client id + secret (+ redirect URI) → I wire the flow.
- [ ] Microsoft (Entra): create an app registration → provide client id + secret (+ redirect URI) → I wire the flow.

### 1.3 Verify Google sign-in secret is set (deploy prerequisite)
- [ ] Confirm `GOOGLE_CLIENT_SECRET` is set as a Wrangler secret (the public Client ID is already in wrangler.jsonc). Without it, Google sign-in + owner-code recovery are inert in production.

### 1.4 Admin API secret
- [ ] Confirm `ADMIN_CODE` is set as a Wrangler secret (gates the admin cloud listing API). If unset, the admin cloud page answers 503 with a clear message.

---

## 2. 🚀 Deploy operations (real-world side effects — owner runs these)

All local verification is GREEN (npm run verify: CSP 11/11, SW v74, 16/16 skills;
qa-dashboard-spec 58/58; qa-email-auth 26/26; qa-presence 11/11; verify-report-issue 27/27).
Nothing has been committed or deployed yet — all work is uncommitted in the working tree.

- [ ] **Apply migrations to remote D1** (required before the worker deploy, in order):
  ```bash
  npx wrangler d1 migrations apply my-manager-db --remote
  ```
  This applies ALL pending migrations including 0005 (changelog `import_key`), 0006
  (`cloud_subscriptions`), 0007 (`auth_users`), and v1-presence (the Presence DO
  binding + migration deploy with the worker — auto-applied).
- [ ] **Deploy**:
  ```bash
  npm run deploy
  ```
  (runs `npm run verify` first; uses the tar staging recipe in wrangler.jsonc — the
  new `_archive/` folder is excluded so it never bloats the asset upload).
- [ ] Optional: real-Google round-trip of `/api/cloud/prefs/theme` against the deployed origin (the local harness already proves the flow with byte-identical session cookies).

---

## 3. 🧭 Product decisions (only you can pick these)

- [ ] **Digest engine real-use gate (blocks Rank 9).** MASTER-ACTION-PLAN Rank 9
  (API/webhook layer) is explicitly deferred until the Rank 2 digest engine has been
  used manually for at least one real project cycle. Use the Weekly/Daily Digest +
  the AI presets on a real project, then tell the next session — that's the unlock.
- [ ] **Rank 10 backlog pulls.** The plan's Rank 10 backlog (original 25-gap items
  like Heat/Cold Safety Alerts, Schedule Reliability Index, Subcontractor Weather
  Notification, On-Site Weather Override) is opportunistic — pick one to prioritize,
  or leave it.
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

---

## 5. 🧹 Housekeeping the owner may close out

- [ ] Confirm whether the reconstructed directive files
  (PROJECT-UX-NAV-WEATHER-EXPORT-DIRECTIVE.json, FINAL-PRE-DEPLOY-DIRECTIVE.json,
  FIELD-GUIDE-UPDATE-PLAN.md, MONOLITH-FEATURE-PARITY-DIRECTIVES.json,
  ACTION-PLAN-COMPETITIVE-GAPS.md) read faithfully — they were rebuilt from
  in-directive records after the originals were found missing.
- [ ] `_archive/` now holds the executed plans + session txts (kept, never deleted,
  excluded from deploys). Tell the next session if you want any of them restored to
  the root.

---

## Status legend

- [ ] = needs you (owner). Nothing here is blocked on a model.
- When you complete an item, say so in chat (or edit this file) so the next session
  checks it off in CONTINUATION-DIRECTIVE.md's STATUS LOG and updates Part E.
