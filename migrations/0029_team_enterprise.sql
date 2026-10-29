-- 0029_team_enterprise.sql - RBAC sprint 3 (directive 2026-10-25)
--
-- The enterprise layer on top of 0028's email-keyed membership:
--
--   perm              a per-section matrix for ONE member:
--                     {"wbs":"edit","bud":"view","risk":"none",...}
--                     Levels are none / view / edit. NULL means "use the role
--                     template", so every row written before this migration
--                     keeps exactly the access it had (no backfill needed).
--   access_expires_at optional end of access for a time-boxed member. The auth
--                     path refuses a row past it and marks the row expired, so
--                     the 7-day notice the owner sees is not the enforcement.
--   cloud_team_templates
--                     reusable (name, matrix) presets owned by one ACCOUNT, so
--                     an owner can apply the same custom role to many projects.
--
-- Additive only: no existing column or row changes value. SQLite ALTER TABLE
-- ADD COLUMN cannot carry a UNIQUE or CHECK, which is fine here - validation
-- lives in src/lib/http.js (normalizeTeamMatrix), and that is the single place
-- the server reads a matrix from. Both statements are idempotent-safe in the
-- sense that a re-run fails loudly rather than corrupting data, which is the
-- behaviour every other migration in this repo has.

ALTER TABLE cloud_team_members ADD COLUMN perm TEXT;

ALTER TABLE cloud_team_members ADD COLUMN access_expires_at TEXT;

CREATE INDEX IF NOT EXISTS idx_team_members_access_expiry
  ON cloud_team_members (access_expires_at);

CREATE TABLE IF NOT EXISTS cloud_team_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_sub TEXT NOT NULL,
  name TEXT NOT NULL,
  perm TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_sub, name)
);

CREATE INDEX IF NOT EXISTS idx_team_templates_owner
  ON cloud_team_templates (owner_sub, name);
