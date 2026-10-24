-- G-2 (DIRECTIVE: GOOGLE SIGN-IN SECURITY GAPS, 2026-10-23): server-side
-- single-use store for Sign in with Google nonces. The client fetches a
-- fresh nonce from GET /api/auth/nonce before each sign-in; Google echoes
-- it in the ID token's nonce claim; the Worker refuses the token unless the
-- echoed nonce hashes to a live, unused row here, then consumes the row in
-- the same statement (single use, race-safe). Only the SHA-256 hash is
-- stored, never the nonce itself. Rows are swept by the daily cron.
CREATE TABLE IF NOT EXISTS auth_nonces (
  nonce_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
