# My MaNaGeR — Field Guide Update Plan (RECONSTRUCTED)

> ⚠️ **RECONSTRUCTED 2026-08-12** per the owner's rule (directive files are records —
> reconstruct, never drop). The original file was never committed to the repo.
> Built from CONTINUATION-DIRECTIVE.md Part B (A-15), sw.js version comments
> (mmgr-shell-v49, v24), and the sheet structure of the shipped
> `mymanager-field-guide.html` (20 architectural "sheets" with title-blocks).
> Lossy risks: the original sheet-by-sheet breakdown was never fully inlined in the
> records; the item list below is the verified subset that survived.

**Scope:** `mymanager-field-guide.html` — the in-app help guide styled as a set of
architectural drawing sheets (sheet-nav, 20 sheets, title-block per sheet). Companion
document to `MARKETING-AND-ACCESS-GATE-UPDATE-PLAN.md` (which covers the pre-app
marketing pages and explicitly defers to this file for the in-app guide).

## Completed items (verified against the shipped guide)

### A-15 — Data / Backup / Access sheet rewrite — ✅ EXECUTED + VERIFIED (2026-08-11)
- **Where:** `mymanager-field-guide.html` A-15 (~line 1205+), rewritten for the cloud
  era and confirmed by SW v49.
- **Content:** owner / editor / viewer access codes, **EXACTLY-ONCE owner code
  display**, recovery gated on the linked Google account (sub match), changelog with
  field-level before/after, and unlink semantics (keep local, delete the cloud copy).
- **Evidence:** CONTINUATION-DIRECTIVE.md Part B ("Field-guide Data/Backup sheet
  rewrite. DONE — mymanager-field-guide.html A-15 (1205+): rewritten with owner /
  editor / viewer codes, EXACTLY-ONCE owner code display, recovery gated on the
  linked Google account, changelog with field-level before/after, and unlink
  semantics. SW v49 confirms the A-15 rewrite.").
- **Provider note (2026-08-12):** the recovery story is now provider-agnostic —
  email+password sessions (sub `email:<addr>`) satisfy the same sub-match gate as
  Google sessions; the drawer copy was made provider-neutral in the
  EMAIL-PASSWORD-AUTH-COMPLETED session. The guide's A-15 wording ("linked Google
  account") is accurate for the recovery path's primary case and is not misleading;
  a follow-up wording tweak to "linked account" is optional.

### A-13 — Cloud card — ✅ EXECUTED (SW v24, FEATURE-DOCS-AND-QA)
- The field guide's Cloud card documents the model-fallback ladder and the three
  connectable AI providers (OpenAI / Google Gemini / Anthropic), matching the shipped
  app (mmgr-net.js PROVIDER_DEFAULTS + fallbackModels).

### A-19 — FAQ — ✅ EXECUTED (SW v24, FEATURE-DOCS-AND-QA)
- The FAQ documents the AI rate-limit fallback behavior (429 → ladder advance,
  401 → stop + clear) matching the shipped circuit-breaker.

## Not flagged / already good
- The guide's 20-sheet architecture, title-block device, and section nav are the
  established presentation layer; the update plan's job was content accuracy, which
  the completed items above delivered.

## Closing note
All known items of this plan are executed and verified. The reconstruction cannot
guarantee the original's full sheet-by-sheet list survived the records; if a
future session references a specific sheet not listed here, audit that sheet's
content against the shipped guide directly.
