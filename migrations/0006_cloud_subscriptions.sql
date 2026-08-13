-- ============================================================
-- BILLING-TIER (2026-08-12) — LemonSqueezy subscription state
-- ------------------------------------------------------------
-- Deferred cloud item #15 (FULL-GAP-AUDIT.md) — executed with
-- LemonSqueezy as the payment provider (merchant of record:
-- LemonSqueezy collects sales tax/VAT itself, so the app never
-- has to compute or remit taxes — the reason it was picked over
-- a raw processor). This table is the D1 side of the billing
-- tier. It is keyed by owner_sub (the same session.sub identity
-- that keys cloud_projects.google_sub, R2 prefs blobs, and the
-- presence roster), so "the account that owns cloud projects"
-- and "the account that pays for the pro tier" are provably the
-- same identity — no sub-to-sub mapping tables.
--
-- Rows are written ONLY by the signature-verified webhook
-- (POST /api/billing/webhook, HMAC-SHA256 of the raw body with
-- the LEMONSQUEEZY_WEBHOOK_SECRET). Nothing on the client or in
-- any other Worker route can create or mutate a subscription
-- row — a session cookie alone is never enough.
--
-- SQLite gotchas (d1-migration skill): CREATE TABLE IF NOT
-- EXISTS is idempotent-safe; the primary key is owner_sub so a
-- second webhook for the same account is an upsert, never a
-- duplicate row.
-- ============================================================

CREATE TABLE IF NOT EXISTS cloud_subscriptions (
  owner_sub TEXT PRIMARY KEY,
  ls_subscription_id TEXT NOT NULL,
  status TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'pro',
  current_period_end INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
