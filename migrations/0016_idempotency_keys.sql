-- ============================================================
-- IDEMPOTENCY KEYS — deduplicate retried write requests
-- ------------------------------------------------------------
-- Supports the withIdempotency() helper in src/lib/observe.js.
-- Accepts an optional Idempotency-Key header on write endpoints;
-- stores recently-seen keys with a short TTL (5 minutes default)
-- so a retried POST (network blip, double-click) short-circuits
-- with the cached response instead of double-applying.
--
-- KV is the preferred fast-path (distributed, ~60s TTL); this
-- D1 table is the persistent fallback for cross-isolate restarts.
-- If the table is missing (pre-migration deploys), the helper
-- gracefully skips D1 and relies on KV alone.
-- ============================================================

CREATE TABLE IF NOT EXISTS idempotency_keys (
  cache_key TEXT PRIMARY KEY,
  response_body TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Cleanup index for the scheduled() sweep (daily cron already exists).
-- Rows older than their expires_at are deleted by the sweep.
CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys (expires_at);
