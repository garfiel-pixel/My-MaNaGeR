-- ============================================================
-- ADMIN PASSWORD RECOVERY TIER A (owner D8 2026-09-03) — email OTP
-- ------------------------------------------------------------
-- One row per OTP sent to a SIGNED-IN admin with a verified email
-- on file (never for local-only sessions — Tier B handles those).
--
-- Semantics:
--   - otp_hash stores 'saltHex:pbkdf2Hex' (hashOwnerCode, 100k iters
--     PBKDF2-SHA256) — the plaintext code is never persisted.
--   - Single-use: verified via a conditional UPDATE (used_at IS NULL),
--     the same race-safe pattern as auth_tokens.
--   - Newest-OTP-invalidates-older: sending a new OTP stamps used_at on
--     every older unused row for the same account.
--   - Attempt lock: attempt_count >= 5 locks until the row's expires_at
--     (15-minute OTP expiry, owner confirmed).
--   - Expired and consumed rows are swept by the daily cron in worker.js
--     (mirrors the auth_tokens sweep).
-- SQLite gotchas: CREATE TABLE IF NOT EXISTS is idempotent-safe; the
-- (sub, created_at) index keeps newest-row lookup and the sweep fast.
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_recovery_otp (
  id TEXT PRIMARY KEY,
  sub TEXT NOT NULL,              -- session sub ('email:addr' or Google sub)
  email TEXT NOT NULL,            -- delivery address (masked in API replies)
  otp_hash TEXT NOT NULL,         -- 'saltHex:pbkdf2Hex'
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,                   -- consumed by verify, OR superseded by a newer send
  attempt_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_admin_recovery_otp_sub ON admin_recovery_otp (sub);
