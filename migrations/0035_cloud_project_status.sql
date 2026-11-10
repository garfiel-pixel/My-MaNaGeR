-- Wave 2 (owner 2026-11-10): a cloud project carries a lifecycle status and a
-- per-project sync mode.
--
-- status    active | planning | on-hold | completed. The workspace already has
--           this field on a local project card; before this column the cloud
--           copy had no way to carry it, so every cloud card read "active".
-- sync_mode auto | manual. "auto" means the workspace publishes its own changes
--           as they settle; "manual" means the owner closes a snapshot on
--           purpose. The device keeps its own copy of the choice so offline
--           first still knows it, and this column is the cross-device truth.
--
-- Both columns are additive with defaults, so existing rows and every older
-- client keep working unchanged.
ALTER TABLE cloud_projects ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE cloud_projects ADD COLUMN sync_mode TEXT NOT NULL DEFAULT 'auto';
