# SECURITY-REVIEW-RESEARCH.md
**Status: research + review draft. Not an action plan yet — that's the next
step, after you've reviewed this.**

This document has two parts: (1) the current best-practice frameworks I
researched, and (2) how your actual architecture (Cloudflare Workers +
Worker-fronted D1/R2, Google OAuth, BYO AI keys, admin-generated access
codes) measures up against them — sorted into **confirmed good**, **needs
verification**, and **likely gap**. Nothing here has been changed in code.

---

## Part 1 — The frameworks I researched

### 1.1 OWASP Top 10:2025 (released Nov 2025 — this is the current one, not 2021)

The list changed meaningfully from 2021 — two new categories, one
consolidation, and a reshuffle. In order:

| Rank | Category | What changed from 2021 |
|---|---|---|
| A01 | **Broken Access Control** | Stayed #1. SSRF was folded into this category. |
| A02 | **Security Misconfiguration** | Jumped from #5 to #2 — now the fastest-rising risk. |
| A03 | **Software Supply Chain Failures** | **New.** Expands "Vulnerable and Outdated Components" to cover build systems, CI/CD, and dependency compromise generally. |
| A04 | **Cryptographic Failures** | Fell from #2 to #4. |
| A05 | **Injection** | Fell from #3 to #5 (includes XSS and SQL injection). |
| A06 | **Insecure Design** | Fell from #4 to #6. |
| A07 | **Authentication Failures** | Renamed from "Identification and Authentication Failures." |
| A08 | **Software or Data Integrity Failures** | Unchanged position. |
| A09 | **Security Logging & Alerting Failures** | Renamed — emphasis shifted from "monitoring" to "alerting," since logs nobody looks at don't help. |
| A10 | **Mishandling of Exceptional Conditions** | **New.** Improper error handling, fail-open logic, unhandled edge cases — a root-cause category, not just "bugs." |

### 1.2 Cloudflare Workers-specific best practices (current, per Cloudflare's own docs)

- **Secrets never go in `wrangler.jsonc` or source — only `wrangler secret put`**, read via `env` at runtime. A secret committed to a repo, even briefly, is compromised the moment it's pushed (git history keeps it even after deletion).
- **Use bindings (D1/R2/KV), not the REST API, from inside a Worker** — bindings are in-process, no network hop, no separate auth surface to misconfigure.
- **Keep `compatibility_date` current** and pin `compatibility_flags` deliberately — an unreviewed compatibility-date bump can silently change runtime behavior.
- Defense-in-depth even inside "trusted" infrastructure: even where network-level isolation exists (e.g. service bindings), add application-level authentication (HMAC-style) so a compromised caller can't impersonate another legitimate one.

### 1.3 HTTP security headers — 2026 baseline

- **CSP**: hash-based or nonce-based `script-src` (never `unsafe-inline`), `object-src 'none'`, `base-uri 'self'`, `frame-ancestors` set explicitly. `report-to` is now Baseline (broadly supported) as of March 2026 — the older `report-uri` is on its way out.
- **HSTS**: `max-age=31536000; includeSubDomains` at minimum; `preload` is a one-way door (very hard to reverse) — only add it once every subdomain is confirmed HTTPS-only.
- **X-Content-Type-Options: nosniff** — no exceptions, costs nothing.
- **Referrer-Policy: strict-origin-when-cross-origin** — sensible default.
- **Permissions-Policy** — explicitly deny browser features you don't use (`camera=(), microphone=(), geolocation=(), payment=()`), so a compromised third-party script can't silently request them.
- **X-Frame-Options / frame-ancestors** — send both (frame-ancestors for modern browsers, X-Frame-Options as a fallback for older ones) to prevent clickjacking.
- **CORS with credentials**: never `Access-Control-Allow-Origin: *` when credentials are involved; always pair with `Vary: Origin`.
- Deprecated/dead — stop shipping these if present anywhere: `X-XSS-Protection`, `HPKP`, `Expect-CT`.

### 1.4 Session/cookie security — 2026 baseline

- **HttpOnly** on every auth cookie — without it, `document.cookie` hands the session token to any injected script.
- **Secure** — HTTPS-only transmission, no exceptions in production.
- **SameSite** — explicit, not left to browser defaults. `Lax` is the recommended default for most session cookies; `Strict` where the UX cost is acceptable (e.g. admin panels); `None` only for legitimate cross-site flows (embedded widgets, some OAuth redirects), and only paired with `Secure`.
- **`__Host-` cookie name prefix** is the strongest available hardening — browsers enforce Secure + HTTPS + no `Domain` attribute + `Path=/`, which specifically blocks subdomain cookie-injection attacks (a compromised subdomain can't plant a cookie that overrides your main session cookie).
- **Server-side expiry is the real control, not cookie `Max-Age`** — cookie lifetime is a client-side hint; the server must independently enforce inactivity timeout and absolute session lifetime.
- **2026 "gold standard" for token architecture**: access token in memory (never localStorage — localStorage is readable by any script, defeating the point) + refresh token in an HttpOnly/Secure/SameSite cookie, with rotation and reuse detection. For a simpler session-cookie-only model (which is what a same-origin static-asset Worker app like this one actually needs), the same HttpOnly/Secure/SameSite/short-lived/rotated principles apply directly to the session cookie itself.

---

## Part 2 — Gap analysis against your actual architecture

This is organized by what I can currently confirm from having read `worker.js`'s
own code comments (via `CONTINUATION-DIRECTIVE.md`'s Part A/B log, which
cites real line numbers) versus what I have **not** independently verified
myself this session — I have not re-read `worker.js` end-to-end against this
specific header/cookie checklist yet. Treat the "needs verification" column
as the literal next research step, not an assumption of a problem.

### A01 — Broken Access Control

| Item | Status | Basis |
|---|---|---|
| Same-origin-only CORS (no `*`, browser requests without matching Origin get 403) | ✅ Confirmed good | worker.js:629+, "CORS POLICY (gap-audit item A2)" per your own audit log |
| Owner-only actions gated on Google `sub` match (admin recovery reissue, changelog revert, project listing) | ✅ Confirmed good | Cited at multiple points in CONTINUATION-DIRECTIVE.md Part B |
| Editor-code scope enforcement has a single source of truth (`CLOUD_SECTIONS`) shared between client and server, can't drift | ✅ Confirmed good | worker.js:721, mmgr-cloud.js:165 |
| Editor-code revocation in-flight race closed | ✅ Confirmed good | worker.js:1080-1087 |
| Admin panel gated by a secret (`ADMIN_CODE`) | ⚠️ Needs verification | Confirmed the gate exists; haven't verified the secret's strength/rotation policy or whether the admin panel has its own rate limiting distinct from the cloud API's |
| Rate limiting scope | ⚠️ Needs verification | Confirmed present on the 4 cloud auth endpoints (worker.js:560+) — haven't confirmed whether the AI-key relay (`/api/ai/chat`) and the admin endpoints have equivalent protection |

### A02 — Security Misconfiguration (the fastest-rising OWASP category — worth real attention)

| Item | Status | Basis |
|---|---|---|
| CSP with per-script SHA-256 hashes, verified against a locked hash list (`verify-csp-hashes.cjs`) | ✅ Confirmed good, and confirmed *working* (I ran the verify script myself earlier this session) | — |
| HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, frame-ancestors/X-Frame-Options | ❌ **Not yet confirmed present** — I have not read `worker.js`'s header-setting code against this specific checklist | This is the single highest-value thing to check next — CSP alone doesn't cover clickjacking, MIME-sniffing, or referrer leakage |
| Deprecated header hygiene (no `X-XSS-Protection`, no `Expect-CT`) | ⚠️ Needs verification | — |
| `.gitignore` correctly excludes `.git`/`.wrangler`/secrets from the deploy asset bundle | ✅ Confirmed good | Verified directly during the earlier code audit — `wrangler.jsonc`'s asset directory is `.` and does NOT honor gitignore for assets, so this is handled via a separate staging-copy tar recipe (AGENTS.md rule 2), which I confirmed is documented and followed |
| Compatibility date kept current | ⚠️ Needs verification | — |

### A03 — Software Supply Chain Failures (new category — genuinely underexamined so far)

| Item | Status | Basis |
|---|---|---|
| Skill-set integrity locking (`skills-lock.json`, content-hash verified) | ✅ Confirmed good — unusually strong for this category | Ran `verify-skills-lock.cjs` myself this session — all 16 locked skill hashes matched |
| `package.json` dependency review / lockfile pinning | ❌ Not yet checked this session | Worth a direct look — what's actually in `package.json`'s dependency list, and whether it's a minimal set (this app is described as "vanilla JS, minimal CDN libs," which if true is a genuine supply-chain strength — small surface) |
| CDN-loaded third-party scripts (Google Sign-In, any analytics) reviewed for integrity (SRI where applicable) | ❌ Not yet checked | Google Sign-In can't use SRI (it's a dynamic script), so the mitigation there is CSP `script-src` scoping to the specific Google origin, not SRI — worth confirming that scoping is tight |
| `vendor/whisper` (bundled, not CDN-loaded) — provenance/version tracking | ❌ Not yet checked | A vendored binary/library is exactly the kind of thing this new OWASP category is about — worth confirming what it is, where it came from, and whether it's pinned to a known-good version |

### A04 — Cryptographic Failures

| Item | Status | Basis |
|---|---|---|
| Session cookie is HttpOnly + HMAC-SHA256 signed | ✅ Confirmed good | AGENTS.md describes this directly: "Google sign-in session (HttpOnly HMAC cookie)" |
| Session cookie `Secure` + `SameSite` flags | ⚠️ Needs verification | HttpOnly is confirmed; Secure/SameSite specifics haven't been independently checked against the cookie-setting code |
| `__Host-` prefix on the session cookie | ❌ Likely not present — worth adding | This is a genuinely cheap, high-value hardening step (see §1.4) that's easy to miss since it's less well-known than HttpOnly/Secure/SameSite |
| Access codes hashed, not stored plaintext | ✅ Confirmed good (per earlier project history — SHA-256-hashed admin-generated codes) | — |
| AI provider keys never leave the device / stripped from every export | ✅ Confirmed good | `stripStateSecrets` "⛔ MAINTENANCE TRAP" comment (worker.js:1223+) explicitly flags that every future credential-shaped field must be added to the strip list in the same change — this is a genuinely well-designed control, not just a one-time fix |

### A05 — Injection

| Item | Status | Basis |
|---|---|---|
| D1 queries — parameterized vs. string-concatenated SQL | ❌ Not yet checked this session | This is the single most important unchecked item in this whole document for a database-backed app — needs a direct read of every D1 query in `worker.js` |
| XSS via `innerHTML` usage in the front-end JS | ⚠️ Partially checked | The earlier code audit found no `textContent`-should-be-`innerHTML` bugs, but that pass wasn't looking for the inverse (innerHTML being used where user-controlled data isn't escaped) — worth a dedicated pass |
| Copyright/content-security note: the app already escapes rendered values in the changelog diff viewer (`esc()`'d, confirmed in the CHANGELOG-DIFF-EXPAND session log) | ✅ Confirmed good, at least for that one surface | — |

### A06 — Insecure Design

| Item | Status | Basis |
|---|---|---|
| Two-phase owner-approved writes for the MCP (AI) server — propose → approve, single-use TTL'd token, stale-file guard | ✅ Confirmed good — this is a genuinely strong design pattern | mcp/lib/store.mjs per the session log |
| "Honesty gate" verifying imported AI changelog diffs against the live snapshot before storing them, rejecting divergent ones | ✅ Confirmed good | worker.js `cloudVerifyImportedDiffs` |
| Threat modeling for the specific case of a malicious/compromised MCP client | ⚠️ Needs verification | The write-approval flow is strong, but worth explicitly asking: what happens if the AI model itself is tricked (prompt injection via project data) into proposing a malicious change? The approval gate helps, but only if the human reviewing genuinely reads the diff rather than reflexively approving |

### A07 — Authentication Failures

| Item | Status | Basis |
|---|---|---|
| OAuth via Google Sign-In, standard flow | ✅ Likely good — using a standardized provider flow rather than hand-rolled auth is exactly what OWASP notes as the main reason this category's occurrence rate has been falling | — |
| PKCE / authorization-code flow specifics | ⚠️ Needs verification | AGENTS.md notes the `oauth` skill is "Fastify-oriented — apply RFC/flow gotchas only; the Worker's Google sign-in uses its own HMAC cookie flow" — meaning the implementation is custom on top of Google's identity token, not a textbook OAuth authorization-code exchange. Custom-on-top-of-standard is fine, but deserves a specific check against RFC 9700 (OAuth Security BCP) rather than assuming Google's involvement makes it automatically safe |
| Admin panel authentication strength (password? code? both — I've seen references to both `adminLogin` and `adminSetupPassword` actions) | ⚠️ Needs verification | Worth confirming password strength requirements, lockout behavior, and whether it's a separate credential from the Google session or layered on top |

### A08 — Software or Data Integrity Failures

| Item | Status | Basis |
|---|---|---|
| CSP inline-script hash verification (catches any unreviewed inline-script tampering) | ✅ Confirmed good and confirmed working this session | — |
| Service worker cache version discipline (SHELL array, version bump enforcement) | ✅ Confirmed good and confirmed working this session | `verify-sw-cache.cjs` |
| Changelog integrity — revert creates a new logged entry rather than erasing history | ✅ Confirmed good | worker.js:695-704 |

### A09 — Security Logging & Alerting Failures

| Item | Status | Basis |
|---|---|---|
| Changelog / audit log for cloud project changes | ✅ Confirmed good for *data* changes | Extensive changelog system with field-level diffs |
| Security-event logging (failed auth attempts, rate-limit hits, admin actions) | ❌ Not yet confirmed | Data-change logging is strong; *security*-event logging is a distinct thing and hasn't been confirmed — does a spike in failed access-code attempts against one project generate any signal, or only a 429? |
| Alerting (not just logging) | ❌ Not yet confirmed | This is explicitly the axis OWASP renamed the category around in 2025 — logs that nobody is notified about don't prevent an incident, they just help investigate one after the fact. Cloudflare Workers has native analytics/alerting hooks worth checking against |

### A10 — Mishandling of Exceptional Conditions (new category)

| Item | Status | Basis |
|---|---|---|
| Fail-closed vs fail-open on the honesty gate (rejects on divergence rather than storing anyway) | ✅ Confirmed good — fails closed | worker.js `cloudVerifyImportedDiffs` |
| Fail-closed on no-snapshot import ("no cloud snapshot to verify against" → all entries skipped) | ✅ Confirmed good — fails closed | Same subsystem |
| Empty catch-block audit — confirmed every one is a deliberate safe-fail, not a swallowed error | ✅ Confirmed good, and unusually thorough | `CONTINUATION-DIRECTIVE.md` A3 — ~15 empty catches individually reviewed and justified |
| 8MB cap failure UX (maps a 413 to a specific friendly message rather than a generic failure) | ✅ Confirmed good | mmgr-cloud.js:285-286 |
| Behavior when D1 or R2 itself is unavailable/degraded (not the app's own logic failing, but the platform dependency) | ❌ Not yet checked | Worth a specific check — this is exactly the "abnormal condition" class this new category is about, and it's easy to only test your own code's error paths while never simulating "what if the database binding itself throws" |

---

## Summary — what this review actually tells you

**Genuinely strong, confirmed, and above what most projects this size have:**
supply-chain skill-hash locking, the MCP write-approval design, changelog
integrity/honesty-gating, CSP+SW verification tooling, the credential-strip
maintenance trap, empty-catch-block discipline.

**The highest-value unchecked items, in priority order for the next research
pass (this is *not* the action plan — this is "what to look at next" before
we write one):**

1. **D1 query construction** — parameterized vs. concatenated SQL, across
   every query in `worker.js`. This is A05 and it's unchecked.
2. **Full HTTP response header audit** — HSTS, X-Content-Type-Options,
   Referrer-Policy, Permissions-Policy, frame-ancestors. CSP alone is not a
   complete header story.
3. **Session cookie flag audit** — confirm Secure + SameSite explicitly, and
   evaluate adding the `__Host-` prefix.
4. **Security-event logging + alerting**, distinct from the data-changelog
   that already exists.
5. **Supply chain**: `package.json` dependency list, `vendor/whisper`
   provenance, Google Sign-In script CSP scoping.
6. **Admin panel auth strength** and rate-limit parity with the cloud API.

Once you've reviewed this, tell me which of these (all of them, or a subset)
you want turned into the actual action plan — and per the
`plan-continuity-guardian` skill we just set up, that action plan should
itself become a committed file in the repo before any code changes start,
not stay as a chat-only plan.
