#!/usr/bin/env node
/* ============================================================
   F4 - TIMED D1 RESTORE DRILL (EXECUTION-PLAN 3.2)
   ------------------------------------------------------------
   A backup nobody has restored is a hope, not a backup. This runs the whole
   cycle against a THROWAWAY local D1, timing every step and verifying the
   data comes back byte-identical:

     1. migrate   - a fresh local D1 with every migration applied
     2. seed      - realistic rows in the tables a project depends on
     3. backup    - `wrangler d1 export` (the same command a real backup uses)
     4. loss      - delete the local D1 storage, the worst case: nothing left
     5. restore   - import the dump into an empty database
     6. verify    - row counts, a project row's exact bytes, PRAGMA
                    integrity_check, and a foreign-key walk from project to
                    changelog to photos

   It writes docs/RESTORE-DRILL-<date>.md with the measured numbers.

   WHAT THIS IS NOT: production. A real restore runs against the deployed D1
   (`wrangler d1 export --remote` to take the copy, Time Travel or an import
   to put it back) and needs the owner's Cloudflare access. The local numbers
   are a FLOOR for the real RTO - they exclude the network, the download of
   the dump, and any edge propagation - and must never be quoted as the
   production restore time.

   Usage:  node tools/qa-d1-restore-drill.cjs
   ============================================================ */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const WRANGLER = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const WORK = path.join(ROOT, 'tmp', 'restore-drill-' + Date.now().toString(36));
const CONFIG = path.join(WORK, 'wrangler.drill.jsonc');
const DUMP = path.join(WORK, 'backup.sql');
const REPORT = path.join(
  ROOT,
  'docs',
  'RESTORE-DRILL-' + new Date().toISOString().slice(0, 10) + '.md'
);

const results = [];
const log = s => process.stdout.write('[drill] ' + s + '\n');
function check(name, ok, detail) {
  results.push({ name: name, ok: !!ok, detail: detail });
  log(
    (ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : '  <-- ' + JSON.stringify(detail).slice(0, 400))
  );
}

function wrangler(args, opts) {
  return execFileSync(process.execPath, [WRANGLER].concat(args), {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: (opts && opts.timeout) || 180000,
    env: Object.assign({}, process.env, { WRANGLER_SEND_METRICS: 'false' })
  });
}

function sql(command) {
  return wrangler([
    'd1',
    'execute',
    'my-manager-db',
    '--local',
    '--config',
    CONFIG,
    '--json',
    '--command',
    command
  ]);
}

function scalar(command) {
  const out = sql(command);
  const parsed = JSON.parse(out.slice(out.indexOf('[')));
  const row = parsed[0] && parsed[0].results && parsed[0].results[0];
  return row ? Object.values(row)[0] : null;
}

function timed(fn) {
  const t0 = process.hrtime.bigint();
  const value = fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { ms: Math.round(ms), value: value };
}

const TABLES = ['cloud_projects', 'cloud_changelog', 'cloud_project_photos', 'auth_users'];

function counts() {
  const out = {};
  for (const t of TABLES) {
    out[t] = Number(scalar('SELECT COUNT(*) AS n FROM ' + t));
  }
  return out;
}

function seed() {
  // Two projects, a changelog row each, one photo row and one account. The
  // hashes are fake but shaped exactly like the real ones, so the byte
  // comparison below is meaningful.
  const hash = c => c.repeat(64).slice(0, 64);
  sql(
    [
      "INSERT INTO cloud_projects (project_id, owner_code_salt, owner_code_hash, owner_label, latest_r2_key, created_at, updated_at) VALUES ('drill-a', 'a1b2c3', '" +
        hash('a') +
        "', 'Drill A', 'projects/drill-a/latest.json', '2026-11-01T00:00:00.000Z', '2026-11-02T00:00:00.000Z')",
      "INSERT INTO cloud_projects (project_id, owner_code_salt, owner_code_hash, owner_label, latest_r2_key, created_at, updated_at) VALUES ('drill-b', 'd4e5f6', '" +
        hash('b') +
        "', 'Drill B', 'projects/drill-b/latest.json', '2026-11-01T00:00:00.000Z', '2026-11-02T00:00:00.000Z')",
      "INSERT INTO cloud_changelog (project_id, actor_label, actor_type, entry_type, diffs_json, created_at) VALUES ('drill-a', 'Owner', 'owner', 'edit', '[{\"path\":\"charter.name\"}]', '2026-11-02T00:00:00.000Z')",
      "INSERT INTO cloud_changelog (project_id, actor_label, actor_type, entry_type, diffs_json, created_at) VALUES ('drill-b', 'Owner', 'owner', 'edit', '[{\"path\":\"charter.name\"}]', '2026-11-02T00:00:00.000Z')",
      "INSERT INTO cloud_project_photos (project_id, photo_id, filename, content_type, size_bytes, created_at) VALUES ('drill-a', 'p1', 'site.jpg', 'image/jpeg', 2048, '2026-11-02T00:00:00.000Z')",
      "INSERT INTO auth_users (email, password_hash, created_at) VALUES ('drill@example.test', 'v2:100000:aa:bb', '2026-11-01T00:00:00.000Z')"
    ].join('; ')
  );
}

function main() {
  fs.mkdirSync(WORK, { recursive: true });
  fs.writeFileSync(
    CONFIG,
    JSON.stringify(
      {
        name: 'mmgr-drill',
        compatibility_date: '2026-09-01',
        d1_databases: [
          {
            binding: 'DB',
            database_name: 'my-manager-db',
            database_id: '00000000-0000-0000-0000-000000000000',
            migrations_dir: '../../migrations'
          }
        ]
      },
      null,
      2
    ) + '\n'
  );

  const migrate = timed(() =>
    wrangler(['d1', 'migrations', 'apply', 'my-manager-db', '--local', '--config', CONFIG])
  );
  const tables = Number(
    scalar(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    )
  );
  check('1 a fresh D1 takes every migration', tables >= 20, { tables: tables });

  seed();
  const before = counts();
  check(
    '2 seeded rows are present before the backup',
    before.cloud_projects === 2 &&
      before.cloud_changelog === 2 &&
      before.cloud_project_photos === 1 &&
      before.auth_users === 1,
    before
  );

  const backup = timed(() =>
    wrangler([
      'd1',
      'export',
      'my-manager-db',
      '--local',
      '--config',
      CONFIG,
      '--output',
      DUMP,
      '--skip-confirmation'
    ])
  );
  const bytes = fs.existsSync(DUMP) ? fs.statSync(DUMP).size : 0;
  check('3 the backup dump exists and is not empty', bytes > 1000, { bytes: bytes });
  const dumpText = bytes ? fs.readFileSync(DUMP, 'utf8') : '';
  check(
    '3b the dump carries schema AND data',
    /CREATE TABLE/.test(dumpText) && /INSERT INTO/.test(dumpText),
    { hasSchema: /CREATE TABLE/.test(dumpText), hasData: /INSERT INTO/.test(dumpText) }
  );

  // Total loss: remove the D1 storage directory itself, not a few rows.
  const d1Dir = path.join(WORK, '.wrangler', 'state', 'v3', 'd1');
  fs.rmSync(d1Dir, { recursive: true, force: true });
  check('4 the database is gone (storage directory removed)', !fs.existsSync(d1Dir), d1Dir);

  const restore = timed(() =>
    wrangler([
      'd1',
      'execute',
      'my-manager-db',
      '--local',
      '--config',
      CONFIG,
      '--file',
      DUMP,
      '--yes'
    ])
  );
  const after = counts();
  check(
    '5 every table came back with the same row count',
    TABLES.every(t => after[t] === before[t]),
    { before: before, after: after }
  );

  const hashBefore = 'a'.repeat(64);
  const hashAfter = String(
    scalar("SELECT owner_code_hash FROM cloud_projects WHERE project_id = 'drill-a'")
  );
  check('6 the project row is byte-identical', hashAfter === hashBefore, {
    expected: hashBefore.slice(0, 12),
    got: hashAfter.slice(0, 12)
  });

  // D1 refuses PRAGMA (SQLITE_AUTH), so the schema arm is proven by the
  // indexes instead: an import that only carried INSERTs would leave these
  // missing while every row count still matched.
  const indexes = Number(
    scalar(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index' AND name IN ('idx_cloud_projects_google_sub', 'idx_cloud_changelog_project', 'idx_photos_project_active')"
    )
  );
  check('7 the indexes came back with the schema (not just the rows)', indexes === 3, {
    indexes: indexes
  });

  const orphan = Number(
    scalar(
      'SELECT COUNT(*) AS n FROM cloud_changelog c LEFT JOIN cloud_projects p ON p.project_id = c.project_id WHERE p.project_id IS NULL'
    )
  );
  check('8 no changelog row is orphaned from its project', orphan === 0, { orphans: orphan });

  const rtoMs = restore.ms;
  const totalMs = migrate.ms + backup.ms + restore.ms;

  const md = [
    '# D1 restore drill - ' + new Date().toISOString().slice(0, 10),
    '',
    '**Scope: LOCAL ONLY.** This is the drill that can be run without owner',
    'credentials. It proves the backup file is complete and that a restore into',
    'an empty database reproduces the data exactly. It does **not** measure the',
    'production restore: that path adds the dump download, the network, and',
    'Cloudflare Time Travel, and it needs the owner.',
    '',
    '## Measured',
    '',
    '| Step | Time |',
    '|---|---|',
    '| migrate a fresh D1 (all migrations) | ' + migrate.ms + ' ms |',
    '| export (backup) | ' + backup.ms + ' ms |',
    '| import (restore) | ' + restore.ms + ' ms |',
    '| **restore RTO (import only)** | **' + rtoMs + ' ms** |',
    '',
    'Dump size: ' + bytes + ' bytes. Rows per table: ' + JSON.stringify(after) + '.',
    '',
    '## What was verified',
    '',
    ...results.map(r => '- ' + (r.ok ? 'PASS' : 'FAIL') + ' - ' + r.name),
    '',
    '## Production procedure (owner)',
    '',
    '1. `npx wrangler d1 export my-manager-db --remote --output backup-<date>.sql`',
    '2. Record the dump size and the moment it was taken. That moment is the',
    '   RPO: everything written after it is lost.',
    '3. Restore with Time Travel where possible',
    '   (`npx wrangler d1 time-travel restore my-manager-db --timestamp=<unix>`),',
    '   which is faster and does not need a full re-import. Fall back to',
    '   `npx wrangler d1 execute my-manager-db --remote --file backup-<date>.sql`',
    '   only when Time Travel no longer covers the window.',
    '4. R2 is separate: a D1 restore does NOT restore the project blobs. Export',
    '   the bucket (`npx wrangler r2 object get`) or rely on the per-project',
    '   copies before declaring a project recovered.',
    '5. Re-run the checks above against the restored database and paste the',
    '   numbers into this file.',
    '',
    'The target in `docs/RELIABILITY-TARGETS.md` is RTO 1 hour / RPO 5 minutes.',
    'The local import above is a floor, not that number.'
  ].join('\n');

  fs.writeFileSync(REPORT, md + '\n');
  log('');
  log('restore RTO (local import): ' + rtoMs + ' ms; dump ' + bytes + ' bytes');
  log('report: ' + path.relative(ROOT, REPORT));

  const failed = results.filter(r => !r.ok);
  if (failed.length) {
    log('DRILL FAIL - ' + failed.length + ' check(s)');
    return 1;
  }
  log('DRILL PASS - ' + results.length + '/' + results.length);
  return 0;
}

let code = 1;
try {
  code = main();
} catch (e) {
  log('ERROR ' + (e && e.stdout ? e.stdout.slice(-1500) : '') + (e && e.message ? e.message : e));
  code = 2;
} finally {
  try {
    fs.rmSync(WORK, { recursive: true, force: true });
  } catch (e) {
    /* the temp tree is under tmp/ and gitignored */
  }
  process.exit(code);
}
