-- ============================================================
-- CLOUD-BACKEND-ARCHITECTURE-PLAN A5-2 (GAP-AUDIT DECISION) —
-- Auto-purge of orphaned cloud projects after inactivity.
-- ------------------------------------------------------------
-- Decision (Garfield, 2026-08-11): a cloud project's D1 row +
-- R2 blob are auto-deleted after a retention window with NO
-- owner activity. The window is measured on a dedicated
-- last_owner_seen_at stamp (NOT updated_at, which editors also
-- bump) so an abandoned project cannot be kept alive by an
-- editor's saves alone.
--
-- This migration adds the column and back-fills it from
-- updated_at so pre-existing projects are treated as "seen" at
-- their last save (no surprise purge of active projects whose
-- row predates the column). The worker's scheduled purge job
-- reads it; new owner-authenticated requests bump it.
-- ============================================================

ALTER TABLE cloud_projects ADD COLUMN last_owner_seen_at TEXT;

-- Back-fill: existing rows get the column set to their last
-- update time (safe — any save implies the owner was active at
-- least once, and the 12-month window starts from there).
UPDATE cloud_projects SET last_owner_seen_at = updated_at WHERE last_owner_seen_at IS NULL;
