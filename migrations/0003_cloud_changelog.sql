-- ============================================================
-- CLOUD-BACKEND-ARCHITECTURE-PLAN Phase 3 — changelog with revert
-- ------------------------------------------------------------
-- One row per cloud SAVE EVENT (owner or editor). Per plan §5 the
-- entry stores either:
--   (A) field-level before/after diffs (diffs_json, leaf paths into
--       the state blob) for ordinary small edits, or
--   (B) a snapshot fallback (snapshot_key pointing at an R2 object
--       holding the PRE-save blob) for bulk operations where
--       field-level diffing is impractical.
-- A revert is itself logged as a NEW 'revert' row (the paper trail
-- shows the revert happened; history is never erased). Reverting a
-- 'revert' row restores the pre-revert state, so every action in
-- this table is reversible.
-- ============================================================

CREATE TABLE IF NOT EXISTS cloud_changelog (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   TEXT NOT NULL,               -- sanitized local project id
  entry_type   TEXT NOT NULL DEFAULT 'edit',-- 'edit' | 'bulk' | 'revert'
  actor_type   TEXT NOT NULL DEFAULT 'owner',-- 'owner' | 'editor'
  actor_label  TEXT NOT NULL DEFAULT '',    -- linked Google name, or the editor code's label
  section      TEXT,                        -- section key when all diffs are in one section; 'multiple' or NULL otherwise
  diffs_json   TEXT,                        -- JSON [{path,before,after,beforeAbsent,afterAbsent}] for edit/revert entries
  snapshot_key TEXT,                        -- R2 key of the pre-change blob for bulk/revert entries
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cloud_changelog_project ON cloud_changelog(project_id, id);
