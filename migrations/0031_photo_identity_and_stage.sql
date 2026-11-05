-- 0031_project_photos_identity_and_stage (B11, 2026-11-05).
-- Two columns the photos panel needs and 0025 did not carry:
--   uploaded_role - the ROLE the uploader held (Owner / Editor), kept beside
--                   uploaded_by (the name), because the directive asks for
--                   "name and role", and a scoped editor code's label is a
--                   name, not a role.
--   stage         - before / after / progress, for the before-and-after use
--                   the same directive asks for. Empty means untagged.
-- ALTER TABLE ADD COLUMN with a constant default is the only shape SQLite
-- accepts for adding NOT NULL columns, and both defaults are constants here,
-- so existing rows backfill without a table rewrite.
ALTER TABLE cloud_project_photos ADD COLUMN uploaded_role TEXT NOT NULL DEFAULT '';
ALTER TABLE cloud_project_photos ADD COLUMN stage TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_photos_stage ON cloud_project_photos(project_id, stage, deleted_at);
