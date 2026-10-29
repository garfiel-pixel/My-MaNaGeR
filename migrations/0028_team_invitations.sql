-- 0028_team_invitations.sql - RBAC sprint 1, step 1 (2026-10-28)
--
-- Replaces the user_sub-keyed membership row with an invitation that belongs to
-- a VERIFIED EMAIL ADDRESS. Why the rebuild: SQLite cannot change a UNIQUE
-- constraint or a CHECK in place, and both have to change here.
--
--   old: UNIQUE(project_id, user_sub), status IN (pending, active, revoked)
--   new: UNIQUE(project_id, invitee_email), status IN (pending, active,
--        declined, revoked, expired)
--
-- Identity: every invite ever written used 'email:<addr>' as user_sub
-- (src/cloud/team.js handleTeamInvite line 158, and accept never rewrites it),
-- so the email backfill is exact for real rows. The CASE keeps the fallback for
-- a hand-written row so no row can ever be lost or fail the NOT NULL.
--
-- Tokens: the old invite_token was stored in PLAINTEXT. It is deliberately NOT
-- copied: from this migration on the table holds only SHA-256(token). Every
-- pending invitation still exists and is still visible in the app; its emailed
-- link stops working, which is the point of the fix. Owners can resend.
--
-- Expiry: existing pending rows get 7 days from this migration, per the
-- directive. Active rows stay active and keep no expiry.
--
-- Times are written as ISO-8601 UTC with milliseconds so a lexicographic
-- comparison against toISOString() in the Worker is exact. SQLite's
-- datetime('now') uses a space separator, which sorts BEFORE 'T' and would
-- make a row look expired on the day it expires.

CREATE TABLE cloud_team_members_v2 (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      TEXT NOT NULL,
  invitee_email   TEXT NOT NULL,
  user_sub        TEXT,
  role            TEXT NOT NULL CHECK(role IN ('manager','supervisor','contractor','client')),
  invited_by      TEXT NOT NULL,
  invited_by_name TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK(status IN ('pending','active','declined','revoked','expired')),
  scope           TEXT,
  token_hash      TEXT,
  expires_at      TEXT,
  created_at      TEXT NOT NULL,
  accepted_at     TEXT,
  revoked_at      TEXT,
  revoked_by      TEXT,
  UNIQUE(project_id, invitee_email)
);

INSERT INTO cloud_team_members_v2 (
  id, project_id, invitee_email, user_sub, role, invited_by, status, scope,
  created_at, accepted_at, expires_at
)
SELECT
  id,
  project_id,
  CASE
    WHEN user_sub LIKE 'email:%' THEN lower(trim(substr(user_sub, 7)))
    ELSE 'legacy:' || user_sub
  END,
  user_sub,
  role,
  invited_by,
  status,
  scope,
  created_at,
  accepted_at,
  CASE
    WHEN status = 'pending' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+7 days')
    ELSE NULL
  END
FROM cloud_team_members;

DROP TABLE cloud_team_members;

ALTER TABLE cloud_team_members_v2 RENAME TO cloud_team_members;

CREATE INDEX IF NOT EXISTS idx_team_project ON cloud_team_members(project_id);
CREATE INDEX IF NOT EXISTS idx_team_email   ON cloud_team_members(invitee_email);
CREATE INDEX IF NOT EXISTS idx_team_token   ON cloud_team_members(token_hash);
CREATE INDEX IF NOT EXISTS idx_team_status  ON cloud_team_members(status, expires_at);

-- Membership events get their OWN table (F10) rather than rows in
-- cloud_changelog. The changelog is the content-revert history: every row it
-- holds is rendered with a Revert button and is expected to carry field
-- diffs. A membership event has neither, so parking one there would offer the
-- owner a revert control that cannot work and count it as "0 field(s)
-- changed". This table is project-scoped, append-only, and is what Sprint 3
-- exports as the audit CSV.
CREATE TABLE IF NOT EXISTS cloud_team_audit (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   TEXT NOT NULL,
  member_id    INTEGER,
  event        TEXT NOT NULL,   -- invite | resend | accept | decline | update_role | update_scope | revoke | leave | expire
  actor_email  TEXT,            -- who did it (null for the cron sweep)
  actor_name   TEXT,
  target_email TEXT,            -- whose membership was affected
  role         TEXT,
  detail       TEXT,            -- JSON: changed fields, expiry, reason
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_team_audit_project ON cloud_team_audit(project_id, id);
