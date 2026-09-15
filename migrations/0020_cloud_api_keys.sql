-- ============================================================
-- PROJECT API KEYS (owner directive 2026-09-15) - migration 0020
-- ------------------------------------------------------------
-- One row per API key an owner mints FROM INSIDE a project (the
-- create endpoint is project-scoped: no project, no key). Keys
-- authorize an external AI agent to act on that one project with
-- the SECTION SCOPE model already enforced for editor codes
-- (CLOUD_SECTIONS in src/lib/http.js). Server-side enforcement
-- merges only granted sections, so a key physically cannot touch
-- anything outside its grant.
-- Keys are stored exactly like owner/editor codes: per-key random
-- salt + PBKDF2-SHA256 hash, never the plaintext. key_fingerprint
-- (sha256 of the plaintext) is the O(1) lookup key for the
-- X-API-Key header; keys are high-entropy so the fingerprint is
-- not brute-forceable. key_prefix (first 8 chars) is display-only
-- so the owner can tell keys apart in the list.
-- expires_at is owner-chosen at mint time; expired keys answer the
-- same generic 403 as unknown/revoked ones (no existence leak).
-- `active` is the revocation flag (0 = revoked).
-- ============================================================

CREATE TABLE IF NOT EXISTS cloud_api_keys (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      TEXT NOT NULL,               -- sanitized local project id (key lives INSIDE this project)
  label           TEXT NOT NULL DEFAULT '',    -- human label, e.g. "Site super assistant"
  scope           TEXT NOT NULL DEFAULT '[]',  -- JSON array of granted section keys (CLOUD_SECTIONS)
  key_salt        TEXT NOT NULL,               -- per-key random salt (hex)
  key_hash        TEXT NOT NULL,               -- PBKDF2-SHA256(salt, key) hex - never the plaintext
  key_fingerprint TEXT,                        -- sha256 hex of plaintext: O(1) lookup for X-API-Key
  key_prefix      TEXT NOT NULL DEFAULT '',    -- first 8 chars, display-only
  expires_at      TEXT,                        -- ISO timestamp; NULL = no expiry (owner's call)
  active          INTEGER NOT NULL DEFAULT 1,  -- 1 = live, 0 = revoked
  created_at      TEXT NOT NULL,
  last_used_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_cloud_api_keys_project ON cloud_api_keys(project_id);
CREATE INDEX IF NOT EXISTS idx_cloud_api_keys_fp ON cloud_api_keys(key_fingerprint);
