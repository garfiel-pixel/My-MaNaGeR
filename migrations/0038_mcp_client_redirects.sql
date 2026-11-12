-- T-26 (2026-11-12): open Dynamic Client Registration for external MCP
-- connectors (Claude, Cursor, ChatGPT).
--
-- An external connector registers itself from its own servers, with no
-- browser session, so the registration endpoint can no longer require one.
-- The redirect URIs it registers are stored here and the authorize endpoint
-- accepts an exact match only. Without that list, open registration would be
-- an open redirect that hands authorization codes to any host.
ALTER TABLE mcp_clients ADD COLUMN redirect_uris TEXT;
