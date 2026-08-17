-- ============================================================
-- AUTH MAINFRAME v2 (2026-08-17) — email verification + reset
-- ------------------------------------------------------------
-- auth_users.email_verified: 1 = the address is proven owned (a
-- one-time HMAC verify link was clicked). EXISTING accounts are
-- backfilled to 1 — grandfathered, they registered before the
-- flow existed — while NEW signups default to 0 and must verify
-- before they can own cloud projects (this is what makes
-- account-occupation — registering someone else's email first —
-- useless).
--
-- SQLite gotchas: ALTER TABLE ADD COLUMN has no IF NOT EXISTS,
-- but the d1_migrations ledger runs this file exactly once; the
-- backfill UPDATE is idempotent. The DEFAULT must be a constant
-- (0), which SQLite requires for ADD COLUMN.
-- ============================================================

ALTER TABLE auth_users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
UPDATE auth_users SET email_verified = 1 WHERE email_verified = 0;

-- ============================================================
-- auth_tokens: server-side ledger for one-time signed tokens
-- (email verification + password reset). The token handed to the
-- user is an HMAC-signed payload carrying this row's id (jti);
-- single-use is enforced with a conditional UPDATE (used_at IS
-- NULL) so a replayed token can only ever consume itself once
-- (race-safe). Expired / long-consumed / long-revoked rows are
-- swept by the daily cron (worker.js scheduled handler).
-- ============================================================

CREATE TABLE IF NOT EXISTS auth_tokens (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL,          -- 'verify' | 'reset'
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_email ON auth_tokens (email);
