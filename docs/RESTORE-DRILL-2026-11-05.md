# D1 restore drill - 2026-11-05

**Scope: LOCAL ONLY.** This is the drill that can be run without owner
credentials. It proves the backup file is complete and that a restore into
an empty database reproduces the data exactly. It does **not** measure the
production restore: that path adds the dump download, the network, and
Cloudflare Time Travel, and it needs the owner.

## Measured

| Step | Time |
|---|---|
| migrate a fresh D1 (all migrations) | 12585 ms |
| export (backup) | 1186 ms |
| import (restore) | 1395 ms |
| **restore RTO (import only)** | **1395 ms** |

Dump size: 19262 bytes. Rows per table: {"cloud_projects":2,"cloud_changelog":2,"cloud_project_photos":1,"auth_users":1}.

## What was verified

- PASS - 1 a fresh D1 takes every migration
- PASS - 2 seeded rows are present before the backup
- PASS - 3 the backup dump exists and is not empty
- PASS - 3b the dump carries schema AND data
- PASS - 4 the database is gone (storage directory removed)
- PASS - 5 every table came back with the same row count
- PASS - 6 the project row is byte-identical
- PASS - 7 the indexes came back with the schema (not just the rows)
- PASS - 8 no changelog row is orphaned from its project

## Production procedure (owner)

1. `npx wrangler d1 export my-manager-db --remote --output backup-<date>.sql`
2. Record the dump size and the moment it was taken. That moment is the
   RPO: everything written after it is lost.
3. Restore with Time Travel where possible
   (`npx wrangler d1 time-travel restore my-manager-db --timestamp=<unix>`),
   which is faster and does not need a full re-import. Fall back to
   `npx wrangler d1 execute my-manager-db --remote --file backup-<date>.sql`
   only when Time Travel no longer covers the window.
4. R2 is separate: a D1 restore does NOT restore the project blobs. Export
   the bucket (`npx wrangler r2 object get`) or rely on the per-project
   copies before declaring a project recovered.
5. Re-run the checks above against the restored database and paste the
   numbers into this file.

The target in `docs/RELIABILITY-TARGETS.md` is RTO 1 hour / RPO 5 minutes.
The local import above is a floor, not that number.
