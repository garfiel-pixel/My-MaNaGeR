-- Named team members for RBAC (2026-10-06).
-- Tier enforcement: contractor accounts may have 1 row per project_id;
-- company/enterprise accounts are unlimited. Enforcement is in the API,
-- not in this schema.
CREATE TABLE IF NOT EXISTS cloud_team_members (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   TEXT NOT NULL,
  user_sub     TEXT NOT NULL,
  role         TEXT NOT NULL CHECK(role IN ('manager','supervisor','contractor','client')),
  invited_by   TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','revoked')),
  scope        TEXT,           -- JSON array of section IDs; used for client role only
  invite_token TEXT,           -- one-time token for accept link, cleared on accept
  created_at   TEXT NOT NULL,
  accepted_at  TEXT,
  UNIQUE(project_id, user_sub)
);
CREATE INDEX IF NOT EXISTS idx_team_project ON cloud_team_members(project_id);
CREATE INDEX IF NOT EXISTS idx_team_user    ON cloud_team_members(user_sub);
CREATE INDEX IF NOT EXISTS idx_team_token   ON cloud_team_members(invite_token);
