-- ============================================================
-- CLOUD IDENTITY: owner_email on cloud_projects (plan 5.1, 2026-11-02)
-- ------------------------------------------------------------
-- A cloud project was only ever tied to an account by google_sub.
-- That is enough while the sub never changes, but it is not enough
-- for the owner's own case: a project published from the admin panel
-- while the panel was signed out has google_sub NULL, and a person
-- who signs in by password on one device and by Google on another
-- addressed the same human through two different subs. In both
-- cases the project exists and is invisible.
--
-- owner_email is the second, human-readable half of the identity:
-- written on create and on claim from the SESSION's verified address
-- (Google IDs are verified by Google; a password account must have
-- clicked its confirmation link - the same rule the cloud-create
-- route already applies). The list route then matches
-- `google_sub = ?` OR `owner_email = <verified address>`, so one
-- human sees their projects through either door.
--
-- Nothing here loosens a fence: the email is read from a signed
-- session payload, never from a request body or header, and the
-- per-project owner-code check on save/load/meta/delete is
-- untouched.
--
-- SQLite gotcha (see 0022): ALTER TABLE ADD COLUMN is not
-- idempotent and D1 has no IF NOT EXISTS for columns. The
-- migration file itself runs once, guaranteed by d1_migrations.
-- ============================================================

ALTER TABLE cloud_projects ADD COLUMN owner_email TEXT;

CREATE INDEX IF NOT EXISTS idx_cloud_projects_owner_email ON cloud_projects(owner_email);

-- Deterministic backfill, no guessing: an email account's sub IS the
-- address, so those rows can be filled exactly. Google subs are opaque
-- ids and carry no address, so those stay NULL and keep working
-- through google_sub - which is how they were found before.
UPDATE cloud_projects
   SET owner_email = lower(substr(google_sub, 7))
 WHERE owner_email IS NULL
   AND google_sub LIKE 'email:%'
   AND length(google_sub) > 6;
