-- Theme-pack WS5 (collaboration polish): store a display name for an invited
-- collaborator so the owner can label a person (e.g. "Site Foreman") alongside
-- their email. NULL when the inviter does not supply one.
ALTER TABLE cloud_team_members ADD COLUMN name TEXT;
