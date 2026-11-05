# Security Register

Canonical status of every SEC item from `SECURITY-HYGIENE-DIRECTIVE.md`.
Updated wave by wave (4.1 first). Each row: status, what was done, evidence.

Statuses: DONE | PARTIAL | QUEUED | OWNER-CHECK (needs owner, not AI) | N-A

| SEC | Title | Status | Evidence / notes |
|---|---|---|---|
| SEC-01 | GitHub Actions least privilege + pinning | **DONE (4.1)** | `permissions:` blocks on all 4 workflows; `gitleaks-action@v2` SHA-pinned (`ff98106...`); `verify-workflow-security.cjs` gate in `static` |
| SEC-02 | Repository governance checklist | OWNER-CHECK | branch protection, secret scanning, 2FA, token audit — owner only |
| SEC-03 | Rate limiter keying on attacker input | QUEUED (4.2) | `qa-ratelimit-keying.cjs` not yet written |
| SEC-04 | Photo upload MIME trust | QUEUED (4.2) | content sniffing + EXIF strip (owner: strip) not yet done |
| SEC-05 | Passwords: policy, breach, friction | PARTIAL | 12-char floor + HIBP screen done (tests green); hash-versioning + Turnstile (defer) open |
| SEC-06 | CSP tighten (report-only first) | QUEUED (4.3) | no `verify-csp-connect` yet |
| SEC-07 | Supply chain: audit gate + provenance | **DONE (4.1)** | `npm audit --audit-level=high` in `static`; weekly all-levels in `nightly`; `vendor/MANIFEST.json` + `verify-vendor.cjs` |
| SEC-08 | CodeQL static analysis | **DONE (4.1)** | `.github/workflows/codeql.yml`, own workflow, SHA-pinned, `security-events: write` |
| SEC-09 | Authorization matrix test | QUEUED (extend `qa-tenant-isolation`) | route-table sweep not yet added |
| SEC-10 | Secrets runbook + pre-commit scan | QUEUED (4.3) | `docs/RUNBOOK-SECRETS.md` + `gitleaks protect` hook not yet added |
| SEC-11 | (merged → wave 3.2/3.3) | N-A | |
| SEC-12 | Lint ratchet: no-unsanitized-html as error | QUEUED (4.4) | |
| SEC-13 | Header gate | QUEUED (4.4) | |
| SEC-14 | MCP owner-code deprecation | QUEUED (4.6) | |
| SEC-15 | (merged → F3) | N-A | |
| SEC-16 | Register skeleton | **DONE (4.1)** | this file |

## Re-scored posture (§1 table, after 4.1)
- Supply chain: 5 → 7 (audit gate + provenance + CodeQL)
- Governance: ≤4 → 7 (least-privilege CI, action pinning)
- Auth: 7.5 → 8 (HIBP screen added; hash-versioning pending)
- Platform: 7 → 7 (no change in 4.1)
