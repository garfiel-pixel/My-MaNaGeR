-- Extend cloud_subscriptions for multi-tier billing (2026-10-06).
-- Existing rows default to 'contractor' - the equivalent of the old 'pro' plan.
-- paddle_price_id records which price triggered the subscription, used by
-- deriveTier() on future webhook events.
ALTER TABLE cloud_subscriptions ADD COLUMN tier TEXT NOT NULL DEFAULT 'contractor';
ALTER TABLE cloud_subscriptions ADD COLUMN paddle_price_id TEXT;
CREATE INDEX IF NOT EXISTS idx_sub_tier ON cloud_subscriptions(tier);

-- Backfill: rename 'pro' rows to 'contractor' (the old hard-coded value).
UPDATE cloud_subscriptions SET tier = 'contractor' WHERE plan = 'pro';
