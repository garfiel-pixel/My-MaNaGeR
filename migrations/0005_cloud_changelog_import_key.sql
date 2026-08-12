-- ============================================================
-- CLOUD-MCP-IMPORT (2026-08-11) — idempotent changelog import
-- ------------------------------------------------------------
-- The MCP server (mcp/) records AI edits in a cloud-shaped sidecar
-- changelog. This migration gives the D1 changelog a nullable UNIQUE
-- import_key so the importer can never duplicate an audit row: rows
-- written by the app's own saves keep NULL (unchanged behavior),
-- while MCP-imported rows carry 'mcp:<projectId>:<localEntryId>'.
-- A re-import of the same local entry is then a silent no-op even
-- if the CLI's own ledger file is lost or recreated.
--
-- SQLite gotchas applied per the d1-migration skill: ALTER TABLE ADD
-- COLUMN has no IF NOT EXISTS variant, so this migration must only
-- ever run once — which the wrangler migration runner guarantees by
-- recording it in d1_migrations. The UNIQUE index is created with IF
-- NOT EXISTS and is partial-safe (NULL keys never collide; SQLite
-- treats NULLs as distinct in unique indexes).
-- ============================================================

ALTER TABLE cloud_changelog ADD COLUMN import_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_changelog_import_key ON cloud_changelog(import_key);
