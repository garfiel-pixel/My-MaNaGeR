-- ============================================================
-- CLOUD-FIRST SYNC (PART 3, approved 2026-08-17) — REVIEW QUEUE
-- for inbound changes (owner: "admin review and update from
-- another source and accept changes").
-- ------------------------------------------------------------
-- cloud_reviews is the owner's review gate for changes coming
-- from a NON-OWNER source. Always on (owner decision): an
-- editor's scoped save or an MCP import no longer lands in the
-- cloud snapshot directly — it becomes a proposal the owner
-- accepts (applies + changelog 'accepted') or rejects (discards
-- + changelog 'rejected'). Owner saves still apply instantly.
--
-- Columns:
--   id             proposal id (autoincrement)
--   project_id     the cloud project
--   proposal_type  'save' (editor scoped save) | 'mcp' (imported
--                  AI edit — the blob is already in that state,
--                  accept = audit-acknowledge, reject = decline)
--   source_type    'editor' | 'mcp' (UI badge)
--   source_label   the editor code label (or the MCP entry label)
--   editor_code_id the editor code that proposed (adoptions
--                  resolve to the same code id); NULL for MCP
--   scope          JSON array of the editor's granted sections
--   submitted_json the raw state the editor submitted (re-applied
--                  with the SAME scope merge on accept)
--   diffs_json     leaf diffs vs the snapshot at propose time
--                  (what the review UI shows)
--   section        single section label for MCP entries
--   actor_type     original actor type for MCP entries
--   import_key     'mcp:<projectId>:<localId>' UNIQUE — a lost
--                  CLI ledger can never duplicate a proposal
--   status         'pending' | 'accepted' | 'rejected'
--   proposed_at    when the proposal was created
--   decided_at     when the owner decided
--   decided_by     owner label
--   accepted_entry_id  cloud_changelog id written on accept
--
-- Editor proposal dedupe ("last proposal wins"): a NEW save from
-- the same editor_code_id REPLACES that editor's still-pending
-- proposal (delete-then-insert), so a busy editor never spams
-- the queue — the newest proposal is what the owner reviews.
-- ============================================================

CREATE TABLE IF NOT EXISTS cloud_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  proposal_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_label TEXT,
  editor_code_id INTEGER,
  scope TEXT,
  submitted_json TEXT,
  diffs_json TEXT,
  section TEXT,
  actor_type TEXT,
  import_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  proposed_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT,
  accepted_entry_id INTEGER
);

CREATE INDEX IF NOT EXISTS idx_cloud_reviews_project_status ON cloud_reviews (project_id, status);
CREATE INDEX IF NOT EXISTS idx_cloud_reviews_editor ON cloud_reviews (editor_code_id, status);
-- Partial-safe unique index (NULL import_keys never collide —
-- only MCP proposals carry one).
CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_reviews_import_key ON cloud_reviews (import_key);
