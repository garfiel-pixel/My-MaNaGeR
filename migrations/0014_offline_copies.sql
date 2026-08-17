-- ============================================================
-- CLOUD-FIRST SYNC (PART 3 of AUTH-MAINFRAME-AND-CLOUD-FIRST-
-- SYNC-DIRECTIVE, approved 2026-08-17) — offline copies +
-- admin broadcast.
-- ------------------------------------------------------------
-- offline_copies: every "Make offline copy" click registers
-- the recipient's device against the cloud project so the
-- server knows which copies exist and how fresh they are:
--   - id            random copy id (server-generated)
--   - project_id    the cloud project this copy belongs to
--   - device_id     the registering device's stable id
--   - created_at    when the copy was registered
--   - last_pulled_at  last time this copy pulled a snapshot
--   - last_cloud_rev the cloud revision it last pulled
--                 (updated_at at pull time; NULL = never)
-- UNIQUE(project_id, device_id) so a device re-registering
-- is an idempotent upsert, never a duplicate row.
--
-- cloud_projects.auto_broadcast: per-project switch for the
-- owner's "broadcast to other projects automatically on every
-- save" mode. 0 = manual broadcast only (owner clicks), 1 =
-- every save also broadcasts the new revision to all copies.
-- ============================================================

CREATE TABLE IF NOT EXISTS offline_copies (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_pulled_at TEXT,
  last_cloud_rev TEXT
);

CREATE INDEX IF NOT EXISTS idx_offline_copies_project ON offline_copies(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_offline_copies_device ON offline_copies(project_id, device_id);

ALTER TABLE cloud_projects ADD COLUMN auto_broadcast INTEGER NOT NULL DEFAULT 0;
