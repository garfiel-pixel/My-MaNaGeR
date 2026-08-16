-- ============================================================
-- CLOUD-CODES-AND-DELETE-DIRECTIVE (2026-08-16) — migration 0009
-- ------------------------------------------------------------
-- 1. cloud_editor_codes gains a ROLE ('editor' | 'view') and a
--    code_fingerprint (sha256 hex of the plaintext code) so the
--    launcher's POST /api/cloud/codes/lookup can resolve ANY code
--    to its project without iterating projects or salts. The code
--    itself is still ONLY ever stored as PBKDF2(salt, code) — the
--    fingerprint is a safe lookup key because codes are high-
--    entropy random strings (sha256 of a 16-char random code is
--    not brute-forceable).
-- 2. cloud_projects gains owner_code_fingerprint (same purpose for
--    owner codes — written at create/recover; legacy rows stay NULL
--    until their code is re-issued) and deleted_at (soft-delete
--    tombstone so an admin delete can be undone within a short
--    window, and every load/save/meta after it rejects with a clear
--    'project_deleted' instead of a generic 403).
-- ============================================================

ALTER TABLE cloud_editor_codes ADD COLUMN role TEXT NOT NULL DEFAULT 'editor';
ALTER TABLE cloud_editor_codes ADD COLUMN code_fingerprint TEXT;
ALTER TABLE cloud_projects ADD COLUMN owner_code_fingerprint TEXT;
ALTER TABLE cloud_projects ADD COLUMN deleted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_cloud_editor_codes_fp ON cloud_editor_codes(code_fingerprint);
CREATE INDEX IF NOT EXISTS idx_cloud_projects_owner_fp ON cloud_projects(owner_code_fingerprint);
