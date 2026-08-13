-- ============================================================
-- MASTER-ACTION-PLAN RANK 9 (2026-08-12) — API / webhook layer
-- ------------------------------------------------------------
-- 9.2 Webhook triggers — OPT-IN ONLY, off by default. A row only
-- exists after the owner creates it (owner-gated CRUD in the cloud
-- drawer); with no rows, the scheduled() evaluator has nothing to
-- fire, so the current deploy behaves byte-for-byte unchanged.
--
-- events (validated in worker.js):
--   health_dropped        — current health score < last_value (the
--                           score stored on the previous evaluation
--                           run); last_value is persisted on every
--                           run so a drop is a real comparison, not
--                           a first-run surprise.
--   weather_risk_tomorrow — tomorrow is a weather-risk day per the
--                           project's cached wxCache forecast
--                           (precip>=60 || tMax>=32 || tMin<=0, the
--                           same thresholds the app's wxRiskDays
--                           uses); fires at most once per calendar
--                           day (last_fired date guard).
--
-- Delivery: POST to target_url with an HMAC-SHA256 signature in the
-- X-MMGR-Signature header (hex, keyed by the per-subscription secret
-- returned once at creation) so the receiver can verify authenticity.
--
-- SQLite gotchas: AUTOINCREMENT not needed (id is the rowid alias
-- with INTEGER PRIMARY KEY); TEXT defaults keep inserts explicit.
-- ============================================================

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id INTEGER PRIMARY KEY,
  project_id TEXT NOT NULL,
  event TEXT NOT NULL,
  target_url TEXT NOT NULL,
  secret TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_value TEXT,
  last_fired_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_project
  ON webhook_subscriptions(project_id);
