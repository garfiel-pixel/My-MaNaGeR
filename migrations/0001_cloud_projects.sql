-- ============================================================
-- CLOUD-BACKEND-ARCHITECTURE-PLAN Phase 1 — D1 schema
-- ------------------------------------------------------------
-- One row per cloud-linked project. The owner/recovery code is
-- NEVER stored in plaintext: only a per-project random salt plus
-- its PBKDF2-SHA256 hash (see worker.js hashOwnerCode). The
-- actual project-state JSON lives in R2; this row references it
-- via latest_r2_key so D1 rows stay small and fast to query.
-- Editor-code scoping + the changelog table arrive in Phase 2/3
-- as separate migrations (this migration stays additive-safe).
-- ============================================================

CREATE TABLE IF NOT EXISTS cloud_projects (
  project_id      TEXT PRIMARY KEY,           -- sanitized local project id (see worker.js)
  owner_code_salt TEXT NOT NULL,              -- per-project random salt (hex)
  owner_code_hash TEXT NOT NULL,              -- PBKDF2-SHA256(salt, ownerCode) hex — never the code
  owner_label     TEXT NOT NULL DEFAULT '',   -- human label (project name at creation)
  google_sub      TEXT,                       -- linked Google account id (sub claim), nullable
  google_name     TEXT,                       -- display name of the linked account, nullable
  latest_r2_key   TEXT,                       -- R2 object key of the latest state snapshot
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cloud_projects_google_sub ON cloud_projects(google_sub);
