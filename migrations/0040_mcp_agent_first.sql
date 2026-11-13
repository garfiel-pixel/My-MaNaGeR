-- ============================================================
-- MCP-AGENT-FIRST (2026-11-12) 1.3 — no silent truncation
-- ------------------------------------------------------------
-- `cloud_reviews.diffs_json` has always been capped at 500 leaves for
-- display. A proposal larger than that was queued with the cap applied and
-- accepted from the capped list, so the owner approved 500 changes and the
-- rest were silently lost.
--
-- ops_json carries the FULL enriched op list (uncapped) and ops_count the
-- true number. diffs_json stays capped at 500 for the review UI. Accept
-- prefers ops_json and falls back to diffs_json for older rows.
--
-- change_set_id / key_id group and attribute proposals (Phase 3/4), and
-- apply_report_json stores the post-accept report the agent reads back.
--
-- cloud_changelog gains the same attribution so one accepted proposal can be
-- traced from the agent call to the audit entry: proposal_id, source_type,
-- source_label, key_id, change_set_id, plus diffs_key for entries whose diff
-- list overflowed the inline column and lives in R2.
--
-- Additive only: every statement adds a column or an index. No data rewrite.
-- ============================================================
ALTER TABLE cloud_reviews ADD COLUMN ops_json TEXT;
ALTER TABLE cloud_reviews ADD COLUMN ops_count INTEGER;
ALTER TABLE cloud_reviews ADD COLUMN change_set_id TEXT;
ALTER TABLE cloud_reviews ADD COLUMN key_id TEXT;
ALTER TABLE cloud_reviews ADD COLUMN apply_report_json TEXT;

CREATE INDEX IF NOT EXISTS idx_cloud_reviews_change_set
  ON cloud_reviews (project_id, change_set_id);

ALTER TABLE cloud_changelog ADD COLUMN proposal_id INTEGER;
ALTER TABLE cloud_changelog ADD COLUMN source_type TEXT;
ALTER TABLE cloud_changelog ADD COLUMN source_label TEXT;
ALTER TABLE cloud_changelog ADD COLUMN key_id TEXT;
ALTER TABLE cloud_changelog ADD COLUMN change_set_id TEXT;
ALTER TABLE cloud_changelog ADD COLUMN diffs_key TEXT;
