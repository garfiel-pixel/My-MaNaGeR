-- Wave 1: app-wide MCP server backing store (2026-11-11)
-- Account-level MCP server config + connected-client roster + account-scoped
-- OAuth tokens/codes, plus a per-project opt-out column on cloud_projects.

-- One row per account that has touched the app-wide MCP server.
-- policy: allow_all | allow_read | allow_subset | block_all
-- tool_subset: JSON array of TOOL NAMES (e.g. ["list_projects","get_tasks"]),
--              used only when policy=allow_subset
CREATE TABLE IF NOT EXISTS mcp_server_config (
  account_sub   TEXT PRIMARY KEY,
  enabled       INTEGER NOT NULL DEFAULT 1,
  policy        TEXT NOT NULL DEFAULT 'allow_all',
  tool_subset   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- Connected first-party / third-party clients (RFC 7591 dynamic client
-- registration). Public clients (no secret) use PKCE only.
CREATE TABLE IF NOT EXISTS mcp_clients (
  client_id       TEXT PRIMARY KEY,
  account_sub     TEXT NOT NULL,
  name            TEXT NOT NULL,
  client_secret_hash TEXT,
  created_at      TEXT NOT NULL,
  last_used_at    TEXT,
  revoked         INTEGER NOT NULL DEFAULT 0
);

-- Account-scoped bearer tokens issued by the OAuth authorization server.
-- Only the SHA-256 of each token is stored; the plaintext token is shown once.
CREATE TABLE IF NOT EXISTS mcp_tokens (
  token_id          TEXT PRIMARY KEY,
  account_sub       TEXT NOT NULL,
  client_id         TEXT NOT NULL,
  access_hash       TEXT NOT NULL,
  refresh_hash      TEXT,
  scope             TEXT NOT NULL DEFAULT 'account',
  expires_at        TEXT NOT NULL,
  refresh_expires_at TEXT,
  revoked           INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_mcp_tokens_access ON mcp_tokens (access_hash);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_account ON mcp_tokens (account_sub);

-- Short-lived authorization codes for the PKCE code flow.
CREATE TABLE IF NOT EXISTS mcp_auth_codes (
  code              TEXT PRIMARY KEY,
  account_sub       TEXT NOT NULL,
  client_id         TEXT NOT NULL,
  code_challenge    TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL DEFAULT 'S256',
  redirect_uri      TEXT NOT NULL,
  scope             TEXT NOT NULL DEFAULT 'account',
  created_at        TEXT NOT NULL,
  expires_at        TEXT NOT NULL,
  consumed          INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_mcp_auth_codes_account ON mcp_auth_codes (account_sub);

-- Per-project opt-out for the app-wide MCP server. Defaults to 1 (enabled).
ALTER TABLE cloud_projects ADD COLUMN mcp_enabled INTEGER NOT NULL DEFAULT 1;
