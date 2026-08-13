-- ============================================================
-- ADDITIONAL-SIGN-IN-PROVIDER (2026-08-12) — email + password
-- ------------------------------------------------------------
-- Deferred cloud item #14 (FULL-GAP-AUDIT.md): Yahoo/Microsoft
-- providers need their own OAuth client IDs/secrets (user
-- credentials — not buildable without them), but email+password
-- is fully self-contained, so it ships now. The account row is
-- a bare identity: email + a PBKDF2-SHA256 password hash (same
-- KDF as owner codes, 100k iterations, per-account random salt
-- stored hex-side-by-side with the hash). Passwords are never
-- stored or logged in plaintext anywhere.
--
-- The session cookie reuses the exact mmgr_session flow: after
-- register/login the Worker signs a session with
-- sub = 'email:<address>' — a namespace that can never collide
-- with Google's numeric subs — and every downstream system
-- (cloud_projects.google_sub, prefs R2 keys, presence roster,
-- billing owner_sub) treats it identically to a Google sub.
--
-- SQLite gotchas: CREATE TABLE IF NOT EXISTS is idempotent-safe;
-- email is the PRIMARY KEY so a duplicate register is a clean
-- constraint, never a second row.
-- ============================================================

CREATE TABLE IF NOT EXISTS auth_users (
  email TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
