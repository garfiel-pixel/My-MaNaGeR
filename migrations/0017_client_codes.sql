-- C19: Client Portal - admin-generated read-only codes with section toggles
-- Client codes grant read-only access to specific panels only

CREATE TABLE IF NOT EXISTS cloud_client_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  code_salt TEXT NOT NULL,
  sections TEXT NOT NULL DEFAULT '["dash"]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  FOREIGN KEY (project_id) REFERENCES cloud_projects(project_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_client_codes_project ON cloud_client_codes(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_client_codes_hash ON cloud_client_codes(code_hash);
