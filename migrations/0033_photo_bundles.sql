-- 0033_photo_bundles (I-12, BUDGET-BOQ-MCP-DIRECTIVE-2026-11-05).
--
-- A bundle is a set of photos picked together and described once ("this
-- bundle is for these things"), not a separate table: the description is
-- copied onto every row in the bundle so a single-photo delete can never
-- orphan it, and the list groups by bundle_id. Existing rows keep '' and
-- render as individual photos, which is exactly what they are.
--
-- Both defaults are constants, the only shape SQLite accepts for adding a
-- NOT NULL column without a table rewrite.
ALTER TABLE cloud_project_photos ADD COLUMN bundle_id TEXT NOT NULL DEFAULT '';
ALTER TABLE cloud_project_photos ADD COLUMN bundle_caption TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_photos_bundle
  ON cloud_project_photos (project_id, bundle_id, deleted_at);
