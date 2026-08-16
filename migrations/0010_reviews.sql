-- ============================================================
-- PART F T7 (2026-08-16) — PUBLIC REVIEWS WINDOW
-- ------------------------------------------------------------
-- reviews.html — anyone leaves a review (name optional, renders
-- as "Anonymous"), stored in the cloud backend and shown to
-- everyone instantly (no moderation). The star/priority UI is a
-- FOLLOW-UP session per the owner, but the schema is star-READY
-- now: stars (nullable, 0 = not rated) + votes ride on every row
-- so the follow-up only adds UI, never another migration.
--
-- Storage: D1 `reviews` row (listing source, newest first) + R2
-- `reviews/<id>.json` (durable copy) — both written on POST.
--
-- SQLite gotchas: id is the rowid alias (INTEGER PRIMARY KEY,
-- no AUTOINCREMENT needed); TEXT defaults keep inserts explicit.
-- ============================================================

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY,
  name TEXT,
  review_text TEXT NOT NULL,
  stars INTEGER,
  votes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reviews_created
  ON reviews(created_at DESC, id DESC);
