# My MaNaGeR — SECURITY & HYGIENE DIRECTIVE (calibration draft)

**Repo:** `garfiel-pixel/My-MaNaGeR` · **Read at:** `main` @ `2a5f01b` (pull first; use names, not line numbers) · **Method:** static review of `worker.js`, `src/`, `.github/`, config and tests + I ran the repo's own gates. **No penetration test, no GitHub/Cloudflare dashboard access, no production logs.** Anything that depends on those is tagged `[OWNER-CHECK]`.
**Companion files:** `AUDIT-DIRECTIVE-2026-10-18.md` (this *adds to* its §8.1; it does not repeat it), `UI-CI-DIRECTIVE.md` (D-4 CI split — new security gates go in its `static` job).

---

## 0. Rules for the AI that executes this (read first)

1. **Evidence tags.** Every claim is `VERIFIED` (command/file shown), `STATIC` (read from code, not run), or `OWNER-CHECK` (needs a dashboard). If you disagree with a finding, **prove it with command output** and write the disproof in the PR — never skip silently. If something differs from this file, report it; do not guess.
2. **Inherited, non-negotiable** (`AGENTS.md` / `CONTINUATION-DIRECTIVE.md`): offline-first stays sacred; CSP inline-script hashes regenerated on any inline-script change; deploy from a clean staging copy; Conventional Commits; **no AI-attribution lines in commits**; no emoji on served pages; keep CI green (repair loop, §8); register every new harness in `docs/CI-TEST-COVERAGE.md`; recompute `skills-lock.json` after touching a skill.
3. **Never:** history rewrites, force-push, `reset --hard`; forcing users/owners to reset codes or passwords; adding a third-party script origin; loosening any existing gate to make something pass; deleting a test.
4. **One item = one branch/PR = one gate.** Each item below ends with a mechanical acceptance test. An item is not done until its test fails on the old code and passes on the new.
5. **Order:** P0 → P1 → P2 → P3. Do not start P2 before P0/P1 are merged green.
6. Run `npm run build` before any browser-based check; `dist/` is not committed.

---

## 1. Calibrated assessment (replaces my earlier single "7.5")

My earlier number blended two very different things. The honest picture is **strong code, weak governance**:

| Area | Score | Why (evidence) |
|---|---|---|
| Application code security | **8 / 10** | SQL is parameterised (260 `.bind()`, 0 template-literal `prepare`; the one dynamic table name comes from a constant list `PROJECT_PURGE_TABLES`); no `eval`/`new Function` in `js/`; `Math.random` banned in `src/` by a gate; Paddle webhook verifies `ts`+`h1`, timestamp tolerance, constant-time compare; AI relay calls fixed upstream URLs (no SSRF) and validates `model` with a regex; custom `no-unsanitized-html` lint rule currently has **0** hits across 415 `innerHTML` sites |
| Authentication & access control | **7.5 / 10** | Cookies `HttpOnly; Secure; SameSite=Lax`; same-origin gate; per-account login lockout table; dedicated rate buckets for login/register/forgot/contact/reviews/AI; timing-sink on unknown accounts; scoped, expiring, revocable API keys exist. **Gaps:** SEC-03, SEC-05, SEC-14 |
| Platform & headers | **7 / 10** | CSP script-src is **hash-only**; HSTS, nosniff, frame-ancestors, CORP/COOP, Permissions-Policy set; `unsafe-eval` scoped to the whisper runtime and gated; private paths 404'd and `.assetsignore` strips `src/ tools/ migrations/ *.md *.json`. **Gaps:** `connect-src https:` (any https host), `style-src 'unsafe-inline'`, no CSP reporting |
| Supply chain & CI hygiene | **5 / 10** | 0 npm vulns (`npm audit --omit=dev`), Dependabot on; **but** no `permissions:` block in any workflow, actions pinned to tags not SHAs (incl. third-party `gitleaks-action` given `GITHUB_TOKEN`), no `npm audit`/CodeQL in CI, `vendor/three` is r160 (2023) with no provenance record, ESLint ratchet ceiling 4600 vs 550 real warnings so it cannot fail |
| Repo governance | **`OWNER-CHECK` (likely ≤4 / 10)** | ~~No `CODEOWNERS` file~~ **CORRECTED 2026-10-31: it exists at the repo ROOT — `CODEOWNERS`, 126 bytes, `* @garfiel-pixel`** (the reviewer looked only in `.github/`; `.assetsignore` is right). Branch protection, secret scanning, push protection and 2FA remain genuinely unknown |
| Privacy & operations | **6 / 10, partly `OWNER-CHECK`** | Consent banner + storage inventory + redaction gate exist; no documented backup-restore drill, incident runbook, retention policy, or data-protection mapping (Jamaica Data Protection Act 2020 — ask a lawyer; this file is not legal advice) |

**Target after this directive:** every row ≥ 8. The fastest movers are SEC-01/02 (governance) and SEC-07/08 (supply chain): small effort, large score change.

### 1.1 Prior audit items — verified status (do not redo)
| 2026-10-18 item | Status now |
|---|---|
| S-1 weak random / guessable codes | **DONE** — CSPRNG, 10-char codes, `verify-no-weak-random.cjs` gate (see SEC-03 for the rate-limit gap that remains) |
| S-3 observability sampling + redaction | **DONE** — `verify-observability-redaction.cjs` in CI |
| S-4 `unsafe-eval` scoping | **DONE** — `verify-csp-unsafe-eval.cjs` in CI |
| S-5 `innerHTML` escaping lint | **DONE** (0 warnings) — hardening in SEC-12 |
| S-6 AI relay abuse | **DONE** — `ai` bucket, 60/min; per-account burst limit still worth adding (SEC-03) |
| S-2 cookie/storage consent | present (`STORAGE-INVENTORY.md`); not re-audited here |

---

## 2. P0 — do first (hours, high value)

### SEC-01 — GitHub Actions least privilege and pinning  `STATIC`
**Finding:** none of `ci.yml`, `extended-qa.yml`, `nightly.yml` declares `permissions:`, so jobs inherit the repository default token (often read/write). `uses:` entries are tag-pinned (`actions/checkout@v4`, `gitleaks/gitleaks-action@v2`). CI also exposes `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` in several steps.
**Fix:**
```yaml
# top of every workflow
permissions:
  contents: read
# add per job only what it truly needs (e.g. security-events: write for CodeQL)
```
Pin every third-party action to a full commit SHA with the tag in a comment (`uses: gitleaks/gitleaks-action@<sha> # v2.x`); Dependabot's `github-actions` ecosystem (already configured) will then bump SHAs. Confirm what the Cloudflare token is for; if CI only needs `wrangler dev`/dry-run, it should be a **least-privilege token with no deploy rights** (`OWNER-CHECK`: scope in the Cloudflare dashboard).
**Gate:** new `tools/verify-workflow-security.cjs` (add to the `static` job; register it): fails if any workflow lacks a top-level `permissions:`, if any `uses:` is not `@<40-hex>` (first-party `actions/*` may stay on tags if you prefer, but say so in the script), or if `pull_request_target` appears.
**Effort:** 1–2 h. **Aligns with goals:** keeps "CI green" rule; no behaviour change.

### SEC-02 — Repository governance checklist  `OWNER-CHECK`
I cannot read these settings from here. Owner to confirm/enable, then paste screenshots or `gh api` output into `docs/SECURITY-REGISTER.md` (SEC-16):
- [ ] Branch protection on `main`: require CI status checks, require linear history, **block force-pushes and deletion** (do this *after* any intentional history work is finished).
- [ ] Secret scanning **and push protection** on; Dependabot alerts + security updates on; private vulnerability reporting on.
- [ ] 2FA / passkeys on the GitHub account **and** the Cloudflare account **and** the email account that receives resets (`garfieldprocis@gmail.com` per `SECURITY.md` — confirm it is the monitored inbox).
- [x] ~~Add a real `.github/CODEOWNERS`~~ **Already satisfied 2026-10-31**: the repo root carries `CODEOWNERS` with `* @garfiel-pixel`, which GitHub honours (root, `docs/` and `.github/` are all valid locations). Optional only: add the explicit per-path lines if you want path-specific owners, which a solo repo does not need.
- [ ] Cloudflare API tokens: list, delete unused, scope the rest; rotate any token that was ever pasted into a chat/log.
- [ ] Decide commit signing (optional) — only if it won't slow the solo workflow.
**Acceptance:** the register shows each box with a date and evidence.

### SEC-03 — Rate limiter must not key on attacker-controlled input  `STATIC`
**Finding:** `cloudRateKey()` (`src/lib/http.js`) keys the bucket on `sha256(X-Owner-Code | X-Editor-Code)` whenever that header is present, and on IP only otherwise. Several routes **authenticate by that same header** (`projects.js`, `photos.js`, `team.js`, MCP). So a caller guessing codes can send a different value on every request and get a **fresh bucket each time** — the limiter does nothing against code-guessing on those routes. Realistic risk today: **low for owner codes** (16 chars × 5 bits = 80 bits) but **real for any shorter secret** (legacy 8-char client codes = 40 bits; editor-code strength: `OWNER-CHECK`/`STATIC` — read `src/cloud/editors.js` generation).
**Fix:** key every bucket on the network identity (IP, plus ASN/colo if useful), **never** on the supplied credential; add a *separate failed-auth counter* keyed by `(ip)` and by `(projectId)` that increments only on failure and applies a lockout ladder (e.g. 10 fails/15 min per IP; 30 fails/hour per project), with constant-time responses and no user-visible state change for the legitimate owner. Keep `teamInvite` keyed per project (explicit override already exists). Add a per-account AI burst limit (≈20/min) next to the existing `ai` bucket.
**Fix constraint (added during review 2026-10-31):** do **not** simply re-key every bucket on IP. `CLOUD_RATE.general` is `max: 30 / 60s` (`src/lib/http.js:528`), so an IP-only bucket would put an entire site office behind one NAT — and this app's whole cloud surface — on a shared 30/min budget, which is worse than today. Check BOTH: a per-code bucket (as now, for per-tenant fairness) **and** an IP bucket with its own, more generous cap; only the failed-auth counter is strict.

**Test (`tools/qa-ratelimit-keying.cjs`, runs against `wrangler dev` in the cloud job):** send 100 requests to a header-auth route with 100 different random `X-Owner-Code` values from one IP → must become `429` by the 31st request (the `general` cap is 30/min, not 40); one valid owner code from the same IP afterwards still works within its own allowance (no lockout of the legit owner by attacker noise from a different IP).
**Effort:** 3–5 h. **Must not break:** existing codes, `RATE_LIMITER` binding call count asserted by `qa-ai-relay` M3 (keep the binding call first).

### SEC-04 — Photo upload trusts the client's MIME type  `STATIC`
**Finding:** `src/cloud/photos.js` accepts uploads if `file.type` (client-supplied) is in an allow-list and size ≤ 8 MB (`:347`, `:343`); there is no content sniffing. The response sets `Content-Disposition: inline` (`:598`).

**Severity correction 2026-10-31 (`STATIC`): LOW-MEDIUM, not the XSS it reads like.** The allow-list is image-only (`image/jpeg|png|webp|gif|avif`), the Worker sets `X-Content-Type-Options: nosniff` on every response (`worker.js:138`), and the stored `content_type` comes from that closed set — so a renamed HTML file cannot be served as HTML. What remains is real but smaller: a non-image 8 MB payload can be stored (storage abuse, and a polyglot may travel through export/backup), and EXIF GPS leaks job-site coordinates. Do the sniffing (cheap, makes the stored type true), keep the `sandbox` CSP on photo responses, and treat EXIF stripping as an owner privacy decision.
**Fix:** read the first 16 bytes and require a matching signature (JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`, WebP `RIFF....WEBP`, GIF `GIF87a/GIF89a`, AVIF `....ftypavif`); store the **sniffed** type, not the client's; reject mismatches with the existing generic error. On serve, add `Content-Security-Policy: sandbox; default-src 'none'` and keep `nosniff`. Privacy option (owner decision): strip EXIF GPS on upload — site photos reveal job-site locations.
**Test:** upload an HTML file renamed `.jpg` with `Content-Type: image/jpeg` → 400; a polyglot GIF/JS → 400; valid JPEG/PNG/WebP still accepted; served headers contain `sandbox`.
**Effort:** 2–3 h.

---

## 3. P1 — this month

### SEC-05 — Passwords: policy, breach screening, bot friction  `STATIC`
**Finding:** `AUTH_MIN_PASSWORD = 8`; hashing is PBKDF2-SHA-256 at **100,000** iterations (`CLOUD_PBKDF2_ITERS`, reused for passwords via `authHashPassword → hashOwnerCode`). OWASP's current guidance is ≥ 600,000 for PBKDF2-HMAC-SHA256, but to my knowledge Workers' WebCrypto caps PBKDF2 at 100,000 (`VERIFY` against Cloudflare docs before deciding). Turnstile guards only `/api/reviews`; register/forgot/contact rely on IP buckets.
**Fix (no forced resets):**
1. Raise the minimum to **12** for *new/changed* passwords; existing users keep logging in.
2. Screen new passwords against Have-I-Been-Pwned's k-anonymity range API **server-side** (send only the first 5 hex of the SHA-1); **fail-open** if the service is unreachable; no password ever leaves the Worker.
3. Store a hash *version* + iteration count with each hash so you can **upgrade on next successful login** to a stronger KDF (scrypt/Argon2 via WASM, if CPU limits allow) without a migration day.
4. Use the existing Turnstile integration on register, forgot-password and contact (server verifies the token; keep offline/no-account flows untouched).
**Test:** weak/pwned password rejected; 12-char strong accepted; legacy 8-char user logs in and gets silently upgraded; register without a Turnstile token → 403 (when Turnstile enabled).
**Effort:** 0.5–1 day. **Goal check:** "no account required" stays true (Turnstile only on cloud account creation).

### SEC-06 — CSP: tighten in report-only first  `STATIC`
**Finding:** `connect-src 'self' https: …` lets any injected script exfiltrate to any https host; `style-src 'unsafe-inline'` (accepted risk — script-src is hash-only, so style injection cannot execute code). No CSP reporting exists, so you cannot see what a tighter policy would break.
**Fix (staged, never in one jump):**
1. Add `Content-Security-Policy-Report-Only` with a candidate `connect-src` of explicit origins observed in the code: `'self'`, `https://accounts.google.com`, `https://oauth2.googleapis.com`, `https://www.googleapis.com`, `https://challenges.cloudflare.com`, `https://cdn.paddle.com` (+ checkout hosts), `https://api.open-meteo.com`, `https://geocoding-api.open-meteo.com`, `https://huggingface.co` and `https://release-assets.githubusercontent.com` (whisper model download), and the BYO-AI provider hosts only where the browser calls them directly (`https://api.openai.com`, `https://api.anthropic.com`, `https://generativelanguage.googleapis.com` — check whether those are browser-direct or Worker-relayed; if relayed, drop them from `connect-src`). Add a `report-uri`/`report-to` endpoint (a tiny Worker route that logs to observability, rate-limited, body-capped).
2. Watch for 2 weeks across the app, calculator, admin, pricing pages; fix misses.
3. Promote to enforced `connect-src` (keep one rollback flag in `worker.js`). Add `upgrade-insecure-requests` and `require-trusted-types-for 'script'` **in report-only** to map DOM sinks for SEC-12.
4. `style-src 'unsafe-inline'` → leave, document as accepted risk with reason in `docs/SECURITY-REGISTER.md` (revisit only if inline styles are refactored).
**Gate:** extend `verify-csp-unsafe-eval.cjs` (or new `verify-csp-connect.cjs`): enforced policy must not contain a bare `https:` in `connect-src`; every origin in `connect-src` must be referenced by code (no dead allow-list entries).
**Effort:** 1 day + 2 weeks observation. **Must not break:** BYO-AI, weather, whisper model download, Paddle checkout, Google sign-in.

### SEC-07 — Supply chain: audit gate, vendor provenance  `STATIC`
**Finding:** no `npm audit`/OSV/CodeQL step in any workflow. Vendored code: `vendor/three` (**r160**, Nov 2023, 53k lines) and `vendor/whisper` (WASM) have no provenance record; Dependabot cannot see them; `*.json` is excluded from assets so a manifest would not ship (fine).
**Fix:**
- CI (`static` job): `npm audit --omit=dev --audit-level=high` (fail on high/critical). Weekly scheduled run in `nightly.yml` for all levels with a summary.
- `vendor/MANIFEST.json`: for each vendored item: name, version, upstream URL, license, **SHA-256 of each file**, date vendored, who verified. New `tools/verify-vendor.cjs` recomputes hashes and fails on drift. Review three.js r160 → current for security fixes and decide upgrade-or-accept in the register.
- Dependabot: keep majors ignored but add a **monthly manual major review** line to the register; add `.github/dependabot.yml` group updates to reduce PR noise.
**Effort:** 3–4 h (+ upgrade work if three.js is bumped).

### SEC-08 — Add CodeQL (static analysis)  `STATIC`
Add `.github/workflows/codeql.yml` (JavaScript/TypeScript, `permissions: security-events: write`, `contents: read`, scheduled weekly + on PR to `main`). Runs in its own workflow, so it does **not** lengthen the main CI. Triage findings once; fix real ones; suppress false positives with a one-line reason in the register. **Gate:** workflow exists (covered by `verify-workflow-security.cjs`). **Effort:** 1 h + triage.

### SEC-09 — Authorization matrix test (tenant isolation)  `STATIC`
**Finding:** RBAC batteries exist (`qa-team-rbac`, `qa-client-codes`, `qa-cloud-*`) but nothing proves *every route × every role* behaves. The most expensive SaaS bug is one user reading another's project.

**Re-scope 2026-10-31 (`VERIFIED`): partially already covered.** `tools/qa-tenant-isolation.cjs` exists, runs in the `cloud-auth` job and asserts tenant A cannot read or write tenant B on the project endpoints (19/19 since 2026-10-30; it also found and closed a live existence oracle in `claim`). Do **not** write a second isolation harness. The only thing missing is the coverage *contract* — a route in `src/router.js` with no matrix row — so extend that file with the route-table sweep instead of starting a parallel one.
**Fix:** `tools/qa-authz-matrix.cjs` — build the matrix from `src/router.js` route table (parse route patterns) × roles `{anonymous, other signed-in user, viewer code, editor code, owner, admin, API key (read), API key (write)}`; assert expected status for each cell from a checked-in table (`test/authz-matrix.json`). **A route in the router with no matrix row fails the test** (so new routes cannot ship unreviewed). Seed two projects/users on `wrangler dev`.
**Effort:** 1 day. Runs in the `cloud-core` job from the CI split.

### SEC-10 — Secrets, history integrity, rotation runbook  `OWNER-CHECK` + `STATIC`
- Tree regex scan found **no** key material (only a fake in the redaction test). **I did not scan history.** Run `gitleaks detect --log-opts="--all"` on the current repo **and on the `v1.0-model` tag that appeared after the rewrite**; anything real is treated as leaked → rotate (don't just delete).
- `.githooks/pre-commit` already exists (and `CONTRIBUTING.md` documents `git config core.hooksPath .githooks`) but runs **no secret scan**: add `gitleaks protect --staged --config .gitleaks.toml` to it, skipping with a visible warning if the `gitleaks` binary is absent.
- Write `docs/RUNBOOK-SECRETS.md`: for each secret (Google client secret, Paddle API key + webhook secret, Resend key, session/HMAC signing secret(s), Cloudflare tokens, `.dev.vars` copies) → where it lives, who can read it, **how to rotate with zero downtime**, last rotated date. `STATIC` note: I found no session-secret key-ID/rotation support (`grep kid|SECRET_PREV` empty) — if rotating the session signing secret logs everyone out, document that or add dual-secret verification.
**Acceptance:** history scan clean or rotated; runbook merged; hook documented.

### SEC-11 — Governance for data you hold (privacy & ops)  `OWNER-CHECK`
Not code; needed for a paid SaaS holding contractors' project and client data:
- Backup/restore: confirm D1 Time Travel + R2 versioning/backup; **do one restore drill** and record RTO/RPO in the register.
- Incident runbook (`docs/RUNBOOK-INCIDENT.md`): detect (alerts), contain (existing kill switches, AUDIT §11), notify, rotate, post-mortem.
- Data map vs privacy notice: reconcile `STORAGE-INVENTORY.md` with the privacy page; retention for logs (observability), deleted projects, photos; verify `delete-account` removes R2 objects (the purge path exists — add a test that checks R2 is empty after delete).
- Jamaica's Data Protection Act 2020 and any client-contract obligations: ask a qualified lawyer; record the answer, not my guess.
**Effort:** 1–2 days spread over a month.

---

### SEC-11 is partly already planned — read this before adding it
**Duplicate notice (review 2026-10-31):** the restore drill and the incident log are **already** wave 3 of `EXECUTION-PLAN.md` (3.2 F4 restore drill, 3.3 F5 targets + incident log) and the monitoring item SEC-15 duplicates 3.x F3 (uptime, error tracking, status page). Do **not** create a second set of documents. SEC-11 contributes three genuinely new things only — the R2-emptiness test after account deletion, the data map vs privacy page reconciliation, and the lawyer question — and they attach to the existing F4/F5 work.

### SEC-06 origin list — confirmed browser-direct on 2026-10-31
`STATIC` grep of the tree settles the reviewer's open question: the BYO-AI path **is** browser-direct, not relayed. `js/mmgr-ai.js:878-881` calls `https://generativelanguage.googleapis.com/v1beta/models`, `https://api.anthropic.com/v1/models` and `https://api.openai.com/v1/models` to validate a pasted key, and `js/mmgr-net.js:49` posts to `https://api.openai.com/v1/chat/completions` for the direct path (`/api/ai/chat` is the managed-key relay, used when there is no user key). `js/mmgr-voice.js:727` fetches the whisper model from `https://huggingface.co/...`. `js/mmgr-forecast.js` uses open-meteo, `pricing.html:306` loads `https://cdn.paddle.com/paddle/v2/paddle.js`, and the sign-in stack uses the Google origins. **All of those must survive in the enforced `connect-src`** — dropping the AI hosts would silently break every BYO-key user, and dropping huggingface would break offline dictation setup.

## 4. P2 — next quarter

### SEC-12 — Client-side hardening  `STATIC`
- ESLint ratchet: lower `WARN_CEILING` from **4600 → current + 10** and add **per-rule ceilings** (`curly` 100, `no-unused-vars` 119 today; `no-unsanitized-html` **0, severity `error`**). A ceiling that is 8× the real count can never fail.
  **Numbers corrected 2026-10-31 (`VERIFIED`, `npx eslint . -f json`):** 550 warnings, 0 errors, and the per-rule counts are `curly` **224**, `no-unused-vars` **200**, `no-undef` **95**, `no-redeclare` **31**. `no-unsanitized-html` is **0** (confirmed) and `console.log` in `js/` is **1** (confirmed). Ratchet to 560 total and set the per-rule ceilings from the measured figures, not the guessed ones.
- Use the SEC-06 `require-trusted-types-for 'script'` report-only data to find remaining DOM sinks; convert the noisiest modules (`calculator-page.js`, `mmgr-render.js`, `mmgr-cloud.js`) to a central `setHTML(el, trustedString)` helper.
- Keep `console.log` at 1; no secrets in `localStorage` (audit against `STORAGE-INVENTORY.md`; the BYO key must stay session-only — add a test that it never lands in `localStorage`/IndexedDB).
**Gate:** `verify-eslint.cjs` per-rule ceilings; new `qa-no-secret-storage.cjs`.

### SEC-13 — Security headers & disclosure hygiene
- `/.well-known/security.txt` (contact, policy, expiry) matching `SECURITY.md`; add `Cross-Origin-Embedder-Policy` only if nothing breaks (likely skip: Paddle/Google frames).
- `qa-security-headers.cjs`: fetch `/`, `/app`, `/project`, `/pricing`, `/calculator`, `/admin`, a photo, an API 404; assert the full header set on each (CSP present, no `unsafe-eval` except the whisper route, HSTS, nosniff, frame-ancestors/XFO, CORP, Referrer-Policy), plus **no `Server`/stack-trace/error-detail leakage** on 4xx/5xx.
- Edge defence-in-depth (`OWNER-CHECK`): Cloudflare WAF managed rules, Bot Fight Mode, an edge rate-limiting rule for `/api/auth/*`.

### SEC-14 — Retire the full-power owner-code Bearer for MCP
**Finding:** `src/mcp/server.js` still accepts the owner code as `Bearer`, with **full** access; scoped/expiring/revocable API keys already exist and are labelled "RECOMMENDED".
**Fix:** log a deprecation counter for owner-code Bearer use for 30 days; after that, require API keys on MCP and keep owner codes for the app only. Show each key's last-used time/scope in the UI (if not already). **Do not break** existing integrations without notice: announce in-app, then switch by flag.

### SEC-15 — Edge & operational monitoring `OWNER-CHECK`
Uptime + synthetic checks (`/api/health`, sign-in page, Paddle webhook reachability), alert on 5xx spikes and on 429 spikes for auth routes, billing-webhook failure alerts, Cloudflare audit-log review monthly.

---

## 5. P3 — control the register (this is how it stays good)

### SEC-16 — Security register and a security job in CI
- `docs/SECURITY-REGISTER.md`: one row per finding (ID, severity, status, evidence, owner, date, accepted-risk reason). Seed it from this file. Every accepted risk has a **review date**.
- In the D-4 CI split, add the new gates to `static`: `verify-workflow-security`, `verify-vendor`, `npm audit`, `verify-csp-connect`; `qa-ratelimit-keying`, `qa-authz-matrix` to `cloud-core`; `qa-security-headers`, `qa-no-secret-storage` to `browser-app`. Register all in `docs/CI-TEST-COVERAGE.md` (the registry gate will fail otherwise).
- Monthly 30-minute review: Dependabot PRs, CodeQL alerts, register due dates.

---

## 6. Sequencing, effort, and how to know it worked

| Wave | Items | Effort | Score movement (my estimate) |
|---|---|---|---|
| 1 | SEC-01, SEC-02 (owner), SEC-07 (audit gate only), SEC-08 | ½ day | Supply chain 5→7, Governance ≤4→7 |
| 2 | SEC-03, SEC-04 | 1 day | Auth 7.5→8.5 |
| 3 | SEC-05, SEC-06 (report-only), SEC-09 | 2–3 days | Auth→9, Platform 7→8 |
| 4 | SEC-07 (vendor), SEC-10, SEC-11 | 2 days + owner time | Supply 7→8.5, Ops 6→8 |
| 5 | SEC-12…16, SEC-06 enforce | ongoing | all ≥ 8 |

**Definition of done for the whole directive:** every gate above exists, fails on the old code, passes on the new; `docs/SECURITY-REGISTER.md` has no unowned or undated row; `npm run verify` and CI green; scorecard in §1 re-scored **with evidence links**, not opinion.

## 7. What I could not verify (so you can calibrate against reality)
GitHub settings (branch protection, secret scanning, 2FA), Cloudflare dashboard (WAF, token scopes, D1 backups), production logs and any real incident history, git history for secrets, editor-code strength, whether session-secret rotation is supported, Workers' PBKDF2 iteration cap, and anything dynamic (I read code; I did not attack it). A professional penetration test (or at least an OWASP ZAP baseline against a staging copy) is the only way to move from "reads well" to "holds up" — schedule one after Wave 3.

## 9. Calibration review — 2026-10-31 (`main` @ `0737ce4`)

Second reviewer pass, run before this file was accepted into `EXECUTION-PLAN.md`.
Every claim was re-derived from the tree with a command; nothing here is taken
on trust from §1-§5. **Result: 12 of 16 items stand as written or with a
narrowed scope; 2 were factually wrong; 2 duplicate work already planned.**

### 9.1 Verdicts

| Item | Verdict | Evidence / correction |
|---|---|---|
| SEC-01 workflow permissions + pinning | **CONFIRMED, P0** | 3 workflows, **0** `permissions:` blocks; 15 `uses:` entries on tags; one third-party action (`gitleaks/gitleaks-action@v2`) handed `secrets.GITHUB_TOKEN`; no `pull_request_target` (good). Pin third-party actions to SHAs; first-party `actions/*` may stay on tags. |
| SEC-02 governance | **CORRECTED** | **`CODEOWNERS` exists at the repo root** (`* @garfiel-pixel`) — the "no CODEOWNERS" claim is wrong, `.github/CODEOWNERS` is not required. Branch protection / secret scanning / 2FA remain genuine `OWNER-CHECK`. The "main was force-updated, so no branch protection" inference is speculation: today's `2a5f01b..0737ce4` push was a plain fast-forward. |
| SEC-03 rate limiter keying | **CONFIRMED, real design flaw** | `cloudRateKey()` (`src/lib/http.js:555-578`) hashes `X-Owner-Code`/`X-Editor-Code` first and falls back to IP only when the header is absent, so a caller who varies the header gets a fresh bucket every request — the limiter contributes nothing on header-authenticated routes, and costs nothing to defeat. Owner codes are 16 chars of a 32-symbol alphabet = **80 bits** (`randomOwnerCode`, `:453`); legacy client codes are 8 chars = 40 bits (`src/cloud/client-codes.js:242`). Treat as a **DoS / cost** defect first and a guessing defect second. Fixture corrected: cap is 30/min, so assert 429 by request **31**, and keep a per-code bucket (see the fix constraint added in §2). |
| SEC-04 photo MIME sniffing | **CONFIRMED, severity DOWNGRADED** | Client `file.type` is trusted (`src/cloud/photos.js:347`), 8 MB cap, `Content-Disposition: inline` (`:598`). But the allow-list is image-only and `nosniff` is global (`worker.js:138`), so this is not XSS. Keep the sniff + the `sandbox` CSP; EXIF stripping is an owner privacy call. |
| SEC-05 password policy | **CONFIRMED, split for decisions** | `AUTH_MIN_PASSWORD = 8` (`src/auth/session.js:33`); `CLOUD_PBKDF2_ITERS = 100000` (`src/lib/http.js:451`); Turnstile appears only in `src/reviews.js` + `src/router.js`. The Workers PBKDF2 ceiling is real, so "raise iterations" is not available — hash-versioning (5.3) is the only durable upgrade path and is pure win. HIBP + Turnstile on register and the 12-char minimum are **owner decisions** (they change what a user must do), not AI calls. |
| SEC-06 CSP tightening | **CONFIRMED, origins verified** | `worker.js:125` / `:164` carry `connect-src 'self' https: …`; `style-src 'unsafe-inline'`; no `report-uri`/`report-to` anywhere. The candidate origin list is now evidence-backed (see the note above §4) and the AI hosts **must stay** — they are browser-direct. |
| SEC-07 supply chain | **CONFIRMED, P0-cheap** | No `npm audit`, OSV or CodeQL step in any workflow; `npm audit --omit=dev` currently reports **0 vulnerabilities**; `vendor/three` is **r160** (`vendor/three` REVISION `160`, 2023) with no manifest or provenance; Dependabot covers npm + actions weekly but ignores all semver majors, so a major never gets looked at. |
| SEC-08 CodeQL | **CONFIRMED, low effort** | No workflow exists. Public repo, so GitHub's *default setup* in the UI would also satisfy this; a workflow keeps it in the tree and in review. |
| SEC-09 authz matrix | **NARROWED — partly duplicate** | `tools/qa-tenant-isolation.cjs` (19/19, `cloud-auth`) already proves A cannot read/write B. Keep only the coverage contract: every `src/router.js` route must have a matrix row. Extend, don't clone. |
| SEC-10 secrets + rotation | **CONFIRMED** | `.githooks/pre-commit` exists and runs no secret scan; CI does run gitleaks (full history) but the pre-commit hook does not. No `docs/RUNBOOK-SECRETS.md`. History scan is a real gap and is a local command, not an owner action. |
| SEC-11 privacy & ops | **MERGED into existing wave 3** | Restore drill = 3.2 (F4), incident log + targets = 3.3 (F5), both already in `EXECUTION-PLAN.md`. Only the R2-emptiness test, the data-map vs privacy-page reconciliation and the lawyer question are new. |
| SEC-12 client hardening | **CONFIRMED with corrected numbers** | `WARN_CEILING = 4600` (`tools/verify-eslint.cjs:38`) against **550** real warnings — an 8.4× headroom, so the ratchet cannot fail. Per-rule figures in §4 were guesses; measured: `curly` 224, `no-unused-vars` 200, `no-undef` 95, `no-redeclare` 31. `no-unsanitized-html` 0 hits and `console.log` 1 in `js/` confirmed. |
| SEC-13 headers + security.txt | **CONFIRMED** | No `.well-known/security.txt`; header assertions are worth having as one browser gate. `Server`/stack leakage is already handled by the Worker's error path — keep that arm as an assertion, not a fix. |
| SEC-14 MCP owner-code Bearer | **CONFIRMED** | `src/mcp/server.js:17` documents the owner-code Bearer as full access, and `:1191` routes it through `X-Owner-Code`; scoped API keys already exist and are labelled recommended. Deprecate with a counter and notice — never a silent cut. |
| SEC-15 edge monitoring | **DUPLICATE** | Same work as F3 (uptime, error tracking, status page) already in the plan. Fold the WAF/bot items in there; do not open a second monitoring track. |
| SEC-16 register | **CONFIRMED, one register** | Seed `docs/SECURITY-REGISTER.md` from this file and cross-link `docs/RELIABILITY-TARGETS.md` / `docs/INCIDENTS.md` so there are not three. |

### 9.2 The scorecard is the weakest part of §1 — treat it as indicative
There is no rubric behind the numbers, and a solo repo scoring itself 8/10 on
"code security" is unanchored: the evidence column is the useful part, the
decimals are not. Keep them as a **direction check only** (re-score at the end
of each wave with links), and never quote a score to a customer. What the review
confirms is the shape of the split, not the digits: the written code is in good
shape (parameterised SQL, hash-only `script-src`, signed webhooks, no known
vulns), and the **process** around it is thin (unscoped CI tokens, tag-pinned
actions, a lint ratchet that cannot fail, no static analysis, no register).

### 9.3 What the review changed in the scope

- **Dropped:** "no CODEOWNERS" (it exists); "add `.github/CODEOWNERS`"; IP-only
  rate keying; the guessed per-rule lint numbers; the 40-request threshold.
- **Merged:** SEC-11 → wave 3.2/3.3; SEC-15 → F3; SEC-09 → extend
  `qa-tenant-isolation`.
- **Split for an owner decision** (the AI must not decide these): 12-char
  minimum, HIBP dependency, Turnstile on register/contact, EXIF stripping,
  whether `main` gets branch protection now, whether CodeQL is a workflow or
  GitHub default setup, and the three.js upgrade-or-accept call.
- **Kept exactly as written** (highest value per hour): SEC-01, SEC-07, SEC-08,
  SEC-10, SEC-12, SEC-13, SEC-16.
- **Kept with a narrowed fix:** SEC-03, SEC-04, SEC-06, SEC-14.

### 9.4 Accepted order (mirrors `EXECUTION-PLAN.md` wave 4)

| Step | Items | Why here |
|---|---|---|
| 4.1 | SEC-01, SEC-07 (audit gate), SEC-08, SEC-16 (register skeleton) | half a day, no product behaviour touched, closes the governance gap that costs the most score for the least work |
| 4.2 | SEC-03 (with the dual-bucket fix), SEC-04 | one day, the only two items that touch live request handling |
| 4.3 | SEC-06 report-only + the report endpoint, SEC-10 runbook + hook | observation has to start before it can be enforced |
| 4.4 | SEC-12 ratchet + `no-unsanitized-html` as error, SEC-13 header gate | cheap gates that keep the rest from regressing |
| 4.5 | SEC-05 hash-versioning, then the owner decisions | the only piece that needs a product call first |
| 4.6 | SEC-14 MCP deprecation, SEC-06 enforced | after two weeks of reports |

## 8. Copy-paste handoff prompt
> Implement `SECURITY-HYGIENE-DIRECTIVE.md` for `garfiel-pixel/My-MaNaGeR` (pull first; use names, not line numbers). Read `CLAUDE.md` → `CONTINUATION-DIRECTIVE.md` → newest `AUDIT-DIRECTIVE-*.md` → `AGENTS.md` first. Work in waves (§6), one branch/PR per SEC item, each with a test that fails before and passes after. Respect §0: evidence tags, no history rewrites/force-push, no forced resets of codes or passwords, no new third-party script origins, no loosened gates, no AI attribution in commits, register every new test in `docs/CI-TEST-COVERAGE.md`. Items tagged `OWNER-CHECK` are not yours to guess: produce the checklist/evidence request and stop. If a finding does not match the code, prove it with command output and report instead of skipping. Finish each wave with the re-scored §1 table and links to the evidence.
