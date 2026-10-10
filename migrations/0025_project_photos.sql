-- Project photos (2026-10-09).
-- Binary photo blobs live in R2 under photos/<project_id>/<photo_id>.<ext>.
-- This table holds ordering, captions, uploader ref, and soft-delete so the
-- list, single-photo view, and delete can be managed without touching R2 blobs
-- until a real delete is confirmed.
-- Auth: this table is project-scoped and always joined to a cloud project via
-- the handler; there is no row that belongs to "no project".
CREATE TABLE IF NOT EXISTS cloud_project_photos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   TEXT NOT NULL,
  photo_id     TEXT NOT NULL,
  filename     TEXT NOT NULL,
  caption      TEXT NOT NULL DEFAULT '',
  captured_at  TEXT NOT NULL DEFAULT '',
  uploaded_by  TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL DEFAULT 0,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  deleted_at   TEXT,
  created_at   TEXT NOT NULL,
  UNIQUE(project_id, photo_id)
);
CREATE INDEX IF NOT EXISTS idx_photos_project_active ON cloud_project_photos(project_id, deleted_at, sort_order DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_photos_photo ON cloud_project_photos(photo_id);
