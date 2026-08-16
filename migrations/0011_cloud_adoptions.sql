-- PART F T9 (2026-08-16): cloud share-code recipient adoption.
-- When a signed-in user loads a project with an editor/viewer code, a
-- cloud_adoptions row pins that project into THEIR "My Cloud Projects"
-- list (recipient_sub <-> project) so it re-opens without re-typing the
-- code. The row references the editor-code id so the grant stays CURRENT:
-- every session-authenticated load/save re-reads the live code row (a
-- revoked code stops the adoption from working; a scope change applies
-- immediately). The adoption is a capability keyed on the recipient's own
-- signed-in identity — never a client-supplied claim.
CREATE TABLE IF NOT EXISTS cloud_adoptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  recipient_sub TEXT NOT NULL,
  editor_code_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_adoptions_project_sub ON cloud_adoptions (project_id, recipient_sub);
CREATE INDEX IF NOT EXISTS idx_cloud_adoptions_sub ON cloud_adoptions (recipient_sub);
