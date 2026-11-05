# Security Register

Canonical status of every SEC item from `SECURITY-HYGIENE-DIRECTIVE.md`.
Updated wave by wave (4.1 first). Each row: status, what was done, evidence.

Statuses: DONE | PARTIAL | QUEUED | OWNER-CHECK (needs owner, not AI) | N-A

| SEC | Title | Status | Evidence / notes |
|---|---|---|---|
| SEC-01 | GitHub Actions least privilege + pinning | **DONE (4.1)** | `permissions:` blocks on all 4 workflows; `gitleaks-action@v2` SHA-pinned (`ff98106...`); `verify-workflow-security.cjs` gate in `static` |
| SEC-02 | Repository governance checklist | OWNER-CHECK | branch protection, secret scanning, 2FA, token audit — owner only |
| SEC-03 | Rate limiter keying on attacker input | **DONE (4.2)** | `qa-ratelimit-keying.cjs` (13/13): per-code bucket kept, per-IP bucket added (more generous), failed-auth ladder (10/15min IP, 30/hour project), per-account AI burst (20/min) |
| SEC-04 | Photo upload MIME trust | **DONE (4.2)** | signature sniffing + EXIF strip (JPEG/PNG/WebP) + `sandbox` CSP on serve; `test/photo-sniff.test.mjs` (8) + `qa-cloud-photos.cjs` arms |
| SEC-05 | Passwords: policy, breach, friction | **PARTIAL (4.5)** | 12-char floor + HIBP screen done; hashes now carry `v2:<iters>:<salt>:<hash>` and a legacy `<salt>:<hash>` row still signs in and is silently re-hashed on that sign-in (`test/password-hash-version.test.mjs`, 6/6: legacy upgrade, no write amplification on a current row, under-strength iteration count upgraded, wrong password upgrades nothing, malformed/unknown-version fails closed, KDF honours the count). Turnstile on register/contact remains an owner decision. |
| SEC-06 | CSP tighten (report-only first) | **PARTIAL (4.3)** | `Content-Security-Policy-Report-Only` on every document with an explicit 13-origin `connect-src` (no bare `https:`), `upgrade-insecure-requests` observed, `report-uri /api/csp-report`; sink is body-capped (16 KiB), rate-limited (`csp` bucket, 30/min) and answers 204 with no body. `tools/verify-csp-connect.cjs` (17/17) proves the candidate, the promotion switch (`CSP_CONNECT_ENFORCE=1`), the one-flag rollback (`CSP_REPORT_ONLY=off`) and the sink. **Enforcement is waiting on the two-week observation window.** `require-trusted-types-for` is deliberately opt-in (`CSP_TT_REPORT=1`) because it reports on every `innerHTML` write. |
| SEC-07 | Supply chain: audit gate + provenance | **DONE (4.1)** | `npm audit --audit-level=high` in `static`; weekly all-levels in `nightly`; `vendor/MANIFEST.json` + `verify-vendor.cjs` |
| SEC-08 | CodeQL static analysis | **DONE (4.1)** | `.github/workflows/codeql.yml`, own workflow, SHA-pinned, `security-events: write` |
| SEC-09 | Authorization matrix test | QUEUED (extend `qa-tenant-isolation`) | route-table sweep not yet added |
| SEC-10 | Secrets runbook + pre-commit scan | **DONE (4.3)** | `docs/RUNBOOK-SECRETS.md` (inventory, rotation, the session-key caveat, history scan, rotation log); `gitleaks protect --staged` in `.githooks/pre-commit` with a visible skip when the binary is absent, plus the CI history scan |
| SEC-11 | (merged → wave 3.2/3.3) | N-A | |
| SEC-12 | Lint ratchet: no-unsanitized-html as error | **PARTIAL (4.4)** | `no-unsanitized-html` is already `error` and at 0. `verify-eslint.cjs` now freezes the global ceiling at the measured count + 10 (**1286**; was 4600, which could never fail) **and** freezes each rule: `curly` 598, `no-unused-vars` 411, `no-undef` 202, `no-redeclare` 65. An unlisted rule has a ceiling of 0. DOM-sink conversion (`setHTML`) still open. |
| SEC-13 | Header gate | **DONE (4.4)** | `tools/qa-security-headers.cjs` (60/60) drives worker.js over seven surfaces. It found a real gap - `/api/*` carried neither `nosniff` nor HSTS - now fixed in `json()` / `cloudRateLimited()` via `API_HARDENING`. |
| SEC-14 | MCP owner-code deprecation | **PARTIAL (4.6)** | Phase 1: every owner-code Bearer use logs `mcp-owner-code-deprecated {result:accepted}`; `MCP_REQUIRE_API_KEY=1` switches the same branch to a JSON-RPC `-32001` refusal (HTTP 200, PATH-A preserved) that names a project API key. The settings card tells users now that owner codes stop working as an MCP credential on 5 December 2026 (shell cache v541). Proven by `test/mcp-owner-code-gate.test.mjs` (5/5), including "the gate decides before D1 is queried". Phase 2 (flip the flag) waits on 30 days of counter data. |
| SEC-15 | (merged → F3) | N-A | |
| SEC-16 | Register skeleton | **DONE (4.1)** | this file |

## Accepted risks

| Risk | Decision | Reason |
|---|---|---|
| `style-src 'unsafe-inline'` in every page policy | **Accepted (owner, SEC-06 step 4)** | The app builds a large share of its UI by assigning `style` attributes and writing `<style>` blocks from JS (dashboards, Gantt, calculator). Removing it would mean a style-token rewrite across the render layer with no matching security gain: `script-src` is hash-only and carries no `'unsafe-inline'`, so an injected style can restyle a page but cannot execute code, and CSS alone cannot read a cookie or a token. Revisit only as part of a deliberate inline-style refactor - not as a CSP tweak. |
| `require-trusted-types-for 'script'` kept opt-in (`CSP_TT_REPORT=1`) | **Accepted (4.3)** | Report-only is still a report per violation, and this app writes `innerHTML` by the hundred per render. Left on permanently it would be a self-inflicted firehose on both the visitor's connection and the report sink. It stays a deliberate mapping tool for SEC-12, not part of the standing observation window. |

## Re-scored posture (§1 table, after 4.1)
- Supply chain: 5 → 7 (audit gate + provenance + CodeQL)
- Governance: ≤4 → 7 (least-privilege CI, action pinning)
- Auth: 7.5 → 8 (HIBP screen added; hash-versioning pending)
- Platform: 7 → 7 (no change in 4.1)
