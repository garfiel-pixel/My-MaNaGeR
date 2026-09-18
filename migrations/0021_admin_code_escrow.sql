-- ============================================================
-- ADMIN-CODE CLOUD BACKUP (owner 2026-09-17)
-- ------------------------------------------------------------
-- The admin code (the password that unlocks admin.html on a
-- device) used to live ONLY on the device that created it
-- (localStorage mmgr_admin_pass_hash). Lose the device, lose
-- admin access. This table stores one escrowed copy per signed-in
-- account:
--   - keyed by sub ('google:<id>' or 'email:<address>'), one row
--     per account (latest code wins - UPSERT).
--   - the plaintext code is NEVER stored. The client sends the
--     code once over same-origin HTTPS; the Worker seals it into
--     a versioned AES-256-GCM envelope under the SESSION_SECRET
--     family before it touches the database, exactly like the R2
--     state blobs. A database read alone reveals nothing.
--   - recovery is gated server-side on the signed-in session +
--     a verified account (Google session, or email account with
--     email_verified = 1). Nobody can probe or fetch the code
--     without owning the session.
-- SQLite gotchas: CREATE TABLE IF NOT EXISTS is idempotent-safe;
-- UPSERT syntax (ON CONFLICT) needs SQLite 3.24+ (D1 ships newer).
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_code_escrow (
  sub TEXT PRIMARY KEY,
  envelope TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
