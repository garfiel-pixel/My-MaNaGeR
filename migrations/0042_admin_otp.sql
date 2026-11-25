-- 0042: emailed admin sign-in (owner 2026-11-24)
-- Replaces the static site admin code as the operator credential with a
-- single-use code emailed to the owner's inbox, exchanged for a short-lived
-- admin session token. Only hashes are stored: PBKDF2 for the code (same
-- helper as owner/editor codes) and SHA-256 for the opaque token.

CREATE TABLE IF NOT EXISTS admin_otp_challenges (
  id TEXT PRIMARY KEY,
  sub TEXT NOT NULL,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  ip TEXT,
  ua TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_otp_sub ON admin_otp_challenges (sub, created_at);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  sub TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip TEXT,
  ua TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_hash ON admin_sessions (token_hash);
