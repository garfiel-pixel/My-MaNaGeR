-- ============================================================
-- CLOUD-BACKEND-ARCHITECTURE-PLAN Phase 2 — editor codes
-- ------------------------------------------------------------
-- One row per editor code a project owner creates. Editor codes
-- are hashed exactly like the owner code (per-code random salt +
-- PBKDF2-SHA256; never the plaintext) and carry a SECTION SCOPE:
-- the JSON array of section keys (see worker.js CLOUD_SECTIONS)
-- that this code may WRITE. Scope is enforced server-side on every
-- save — the Worker merges only granted sections into the stored
-- blob, so a compromised or re-shared editor code physically
-- cannot alter anything outside its grant.
-- `active` is the revocation flag: a revoked code returns the same
-- generic 403 as an unknown one (no existence leak).
-- ============================================================

CREATE TABLE IF NOT EXISTS cloud_editor_codes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  TEXT NOT NULL,               -- sanitized local project id
  label       TEXT NOT NULL DEFAULT '',    -- human label the owner gave the code (e.g. "Site Super — Riverside")
  scope       TEXT NOT NULL DEFAULT '[]',  -- JSON array of granted section keys
  code_salt   TEXT NOT NULL,               -- per-code random salt (hex)
  code_hash   TEXT NOT NULL,               -- PBKDF2-SHA256(salt, code) hex — never the code
  active      INTEGER NOT NULL DEFAULT 1,  -- 1 = live, 0 = revoked
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cloud_editor_codes_project ON cloud_editor_codes(project_id);
