-- S-1 (AUDIT-DIRECTIVE-2026-10-18): client access codes open project sections
-- to people outside the team, so the code lookup gets the same brute-force
-- guard the email sign-in has had since 2026-09-14 (auth_login_guard in
-- migration 0012). One row per guard key:
--   project:<projectId>|ip:<address>   a single project from a single address
--   ip:<address>                       the address across every project
-- 5 wrong codes lock the key for 15 minutes. Reads never fail hard on this
-- table: the callers catch a missing table or a D1 hiccup and allow the read,
-- so an unapplied migration cannot lock anyone out.
CREATE TABLE IF NOT EXISTS client_code_guard (
  guard_key TEXT PRIMARY KEY,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT
);
