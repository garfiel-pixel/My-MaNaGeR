# OWNER-REVIEW.md — Items requiring owner input

**Purpose:** Items that cannot be completed without the owner's decision, action, or review.
Agents: do not execute these; leave them for the owner.

---

## Path to 10/10 — Items needing the owner

### Backend Architecture
- [x] **Analytics Engine enablement** — DONE: Dataset `mmgr-events` created in Cloudflare dashboard, binding `ANALYTICS` already in wrangler.jsonc. Takes effect on next deploy.
- [x] **Idempotency key D1 migration** — DONE: Migration `0016_idempotency_keys.sql` created. Idempotency sweep added to worker.js scheduled handler.

### Backend Security
- [x] **Gitleaks secrets scanning** — DONE: Added to CI workflow via `gitleaks/gitleaks-action@v2`. `.gitleaksignore` created for known false positives.
- [ ] **Third-party penetration test** — The 10/10 plan identifies a professional pentest as the genuine difference between a 9 and a verified 10. This costs real money (a few hundred to a few thousand dollars).
- [ ] **Rate-limit tuning** — The rate limiter exists and is wired everywhere. Real traffic data is needed to verify thresholds are right. Collect data, then review.

### CI/QA
- [x] **Tier 3 Chrome-path rewrite** — DONE: `tools/chrome-launcher.cjs` created with cross-platform auto-detect. All 28+ scripts updated. Zero hardcoded Chrome paths remain.
- [ ] **Wrangler secrets for CI** — The Tier 2 CI jobs need `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub Actions secrets. Ensure these are configured in the repo settings.

### Frontend Architecture
- [ ] **Further mmgr-app.js/mmgr-cloud.js extraction** — mmgr-app.js (2,145 lines) and mmgr-cloud.js still have extractable functions. The biggest candidates: mmgr-ai.js and mmgr-google-auth.js. This is a riskier refactor — needs a dedicated session.
- [x] **Shared component layer** — DONE: `js/app/components.js` with `badge()`, `reviewBadge()`, `aiBadge()`, `showToast()`. Wired into build.js + HTML fallback lists. mmgr-cloud-dash.js duplicate toast eliminated. review.js uses `reviewBadge()`.

### UI Polish
- [x] **Empty-state audit** — DONE: Already well-implemented. `emptyStateRow()` helper in mmgr-render.js, dashboard cards with tier3 quiet styling + actionable copy, task table with "+ Add Task" / "Import" buttons. No gaps found.
- [x] **Color-as-state audit** — DONE: `.badge.on-hold` changed from `var(--gold)` (brand) to `var(--amber)` (status). Review badge 'pending' uses `reviewBadge()` with amber. Gold is now reserved exclusively for brand elements.

### Domains & Email (added 2026-09-07, from the subdomain/DNS audit)
- [ ] **www.mymanagerworkspace.com does not resolve** — DNS has no `www` record, so anyone typing `www.` gets a browser error. Decision: add a proxied `www` CNAME to the apex in Cloudflare DNS (recommended), or declare apex-only. If you add it, also add `https://www.mymanagerworkspace.com` to the Google OAuth Authorized JavaScript origins so sign-in works from both.
- [ ] **The domain cannot receive email (no MX records)** — if you want addresses `@mymanagerworkspace.com`, enable Cloudflare Email Routing (free, forwards to your Gmail) in the dashboard. This is what future "emails from them" would flow through.
- [ ] **No SPF/DKIM/DMARC TXT records** — the dormant Tier A email-OTP admin recovery (`EMAIL_RECOVERY_ENABLED` in wrangler.jsonc) stays 503 until a verified sending domain exists. To activate: add Resend's DKIM/SPF DNS records for `mymanagerworkspace.com` (or use Cloudflare Email Workers), set `RESEND_FROM_EMAIL` to an address on the domain, then flip the flag. Google Workspace/verification TXTs also belong here when needed.
- [ ] **workers.dev subdomain still serves the full app** (`my-manager.garfieldprocis.workers.dev`) — decision: keep it as a dev/preview alias, or disable/redirect it now that the paid domain is live (duplicate public content; also check which origins are listed in the Google OAuth client before removing anything).

### Deploy
- [ ] **Custom domain purchase (F2)** — DONE: the domain is purchased and live (`mymanagerworkspace.com`, deployed 2026-09-06/07). Keeping the checklist item open only until the www/email decisions above are made.
- [ ] **Review live site** — Walk through the live site and confirm: (1) the refactored worker.js serves all pages correctly, (2) all auth flows work (Google sign-in, email+password, logout), (3) cloud sync still functions, (4) no CSP violations in the console.
- [ ] **Commit + push + deploy** — The changes from this session need to be committed, pushed, and deployed. The verify pipeline passes locally (CSP 17/17, SW v200, exports clean).
