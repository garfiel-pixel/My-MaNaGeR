# OWNER-REVIEW.md — Items requiring owner input

**Purpose:** Items that cannot be completed without the owner's decision, action, or review.
Agents: do not execute these; leave them for the owner.

---

## Path to 10/10 — Items needing the owner

### Backend Architecture
- [ ] **Analytics Engine enablement** — The Analytics Engine binding is commented out in wrangler.jsonc pending dashboard enablement. Enable at: https://dash.cloudflare.com/fe39273e10025384ffa49822709a6632/workers/analytics-engine then uncomment the binding block.
- [ ] **Cloudflare Email Service domain onboarding** — Required for orphan-purge warning emails (14-day advance notice before project archival). Steps:
  1. Go to Cloudflare Dashboard > Compute > Email Service > Email Sending
  2. Click "Onboard Domain"
  3. Select your domain (garfieldprocis.workers.dev or your custom domain)
  4. Review the DNS records Cloudflare will add (MX for bounce, TXT for SPF/DKIM/DMARC)
  5. Click "Done" (DNS propagation takes 5-15 minutes for Cloudflare DNS domains)
  6. The `[[send_email]]` binding is already in wrangler.jsonc — no code changes needed after onboarding
  - Without this, orphan warnings silently skip (projects still get purged, just no advance email)
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

### Deploy
- [ ] **Review live site** — Walk through the live site and confirm: (1) the refactored worker.js serves all pages correctly, (2) all auth flows work (Google sign-in, email+password, logout), (3) cloud sync still functions, (4) no CSP violations in the console.
- [ ] **Commit + push + deploy** — The changes from this session need to be committed, pushed, and deployed. The verify pipeline passes locally (CSP 17/17, SW v200, exports clean).
