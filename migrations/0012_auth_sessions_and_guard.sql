-- ============================================================
-- AUTH-MAINFRAME (2026-08-17) — session revocation + sliding
-- renewal + per-account login lockout. Owner-approved hardening
-- pass (AUTH-MAINFRAME-AND-CLOUD-FIRST-SYNC-DIRECTIVE.md Part 2).
-- ------------------------------------------------------------
-- auth_sessions: every issued mmgr_session cookie carries a jti
-- (random UUID) recorded here so a session can be revoked
-- server-side — logout, sign-out-everywhere, and password change
-- (which revokes all OTHER sessions). The row is consulted on
-- every authenticated request; expired and long-revoked rows are
-- swept by the daily cron (worker.js scheduled handler).
-- SQLite gotchas: CREATE TABLE IF NOT EXISTS is idempotent-safe;
-- the sub index keeps "sign out everywhere" and the sweep fast.
-- ============================================================

CREATE TABLE IF NOT EXISTS auth_sessions (
  jti TEXT PRIMARY KEY,
  sub TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_sub ON auth_sessions (sub);

-- ============================================================
-- auth_login_guard: per-account failed-password counter + lockout
-- window (owner: "we cannot have someone spamming down our
-- thing"). ONLY existing accounts get a row — unknown emails keep
-- the generic 401 + dummy-PBKDF2 timing path in handleAuthLogin
-- (no existence leak). 5 failures -> 15 min, 10+ -> 1 hour; a
-- successful login deletes the row. The lockout response (429 with
-- Retry-After) intentionally tells the user the account exists
-- after repeated failures — the accepted, industry-standard
-- trade-off for real lockout feedback.
-- ============================================================

CREATE TABLE IF NOT EXISTS auth_login_guard (
  email TEXT PRIMARY KEY,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT
);
