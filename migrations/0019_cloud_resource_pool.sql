-- ============================================================
-- C23: CLOUD SHARED RESOURCE POOL (owner D2, Phase 6 2026-09-04)
-- ------------------------------------------------------------
-- An ACCOUNT-scoped library of reusable project resources. Pool
-- rows live in their OWN D1 tables and never travel in the project
-- state blob, so they never count against the 8MB /save body cap
-- (CLOUD_BODY_LIMIT_BYTES on src/lib/http.js applies to project
-- state only — DECIDED 09-03).
--
-- Types (DECIDED 09-03): people (Labor + Subcontractor expressed as
-- kind='person' + type), equipment, material. Stakeholders are NOT
-- pool types. A pool row is keyed to the account (google_sub) that
-- owns it, so a project created by that account can link any of the
-- account's pool rows regardless of which project is in focus.
--
-- cloud_pool_links mirrors cloud_adoptions (the proven link-row
-- pattern): one row pins a pool item into one project. A project
-- keeps a denormalized copy of the linked entry in its own state
-- (stamped poolItemId) so rendering works offline and without a
-- network round-trip; cloud_pool_links is the source of truth for
-- what the project may PULL-MERGE.
-- ============================================================

CREATE TABLE IF NOT EXISTS cloud_pool_items (
  id             TEXT PRIMARY KEY,          -- client-generated short id (R-pool-…)
  owner_sub      TEXT NOT NULL,             -- account that owns this pool row (google_sub)
  kind           TEXT NOT NULL,             -- 'person' | 'equipment' | 'material'
  name           TEXT NOT NULL,
  type           TEXT NOT NULL DEFAULT '',  -- Labor | Subcontractor (kind=person) | role label
  role           TEXT NOT NULL DEFAULT '',
  availability   REAL NOT NULL DEFAULT 100,
  rate           REAL NOT NULL DEFAULT 0,
  hoursAllocated REAL NOT NULL DEFAULT 0,
  notes          TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cloud_pool_items_owner ON cloud_pool_items(owner_sub);
CREATE INDEX IF NOT EXISTS idx_cloud_pool_items_kind ON cloud_pool_items(owner_sub, kind);

CREATE TABLE IF NOT EXISTS cloud_pool_links (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   TEXT NOT NULL,
  pool_item_id TEXT NOT NULL,
  linked_at    TEXT NOT NULL,
  FOREIGN KEY (pool_item_id) REFERENCES cloud_pool_items(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_pool_links_project_item ON cloud_pool_links (project_id, pool_item_id);
CREATE INDEX IF NOT EXISTS idx_cloud_pool_links_item ON cloud_pool_links (pool_item_id);
