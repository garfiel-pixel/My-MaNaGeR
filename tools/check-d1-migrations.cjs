#!/usr/bin/env node
/* Pre-deploy guard: production D1 must be at the same migration head as the
   code in this tree.

   WHY THIS EXISTS (2026-11-06). Four migrations (0028 to 0031) sat unapplied
   in production while the Worker that read them was deployed. Nothing failed
   at deploy time, because `wrangler deploy` does not look at D1. The first
   symptom was the owner's: every project's Photos tab answered HTTP 500
   because the list SELECT names `uploaded_role`, `stage` and `sort_order`,
   and the cloud project list returned nothing because it filters on
   `owner_email`. Both columns arrive in those migrations. A schema that is
   behind the code is a live defect that no local gate can see.

   USAGE
     node tools/check-d1-migrations.cjs            # report only
     node tools/check-d1-migrations.cjs --strict   # exit 1 when any is pending

   Run it before `wrangler deploy`, and after any migration is added. It needs
   an authenticated wrangler session, so it is a manual pre-deploy step, not a
   CI step: CI has no production credentials and must not have them.
*/
'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DB = 'my-manager-db';
const strict = process.argv.includes('--strict');

function run(args) {
  return execFileSync('npx', ['wrangler', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32'
  });
}

let out = '';
try {
  out = run(['d1', 'migrations', 'list', DB, '--remote']);
} catch (e) {
  const msg = (e.stdout || '') + (e.stderr || '');
  console.error('could not read the remote migration state:', msg.trim().slice(0, 400));
  process.exit(strict ? 1 : 0);
}

if (/No migrations to apply/i.test(out)) {
  console.log('D1 MIGRATIONS PASS - production is at the head of migrations/');
  process.exit(0);
}

// Anything else means at least one migration is unapplied. Name them.
const pending = out
  .split('\n')
  .map(l => l.replace(/[│|]/g, ' ').trim())
  .filter(l => /^\d{4}_[A-Za-z0-9_]+\.sql$/.test(l));

console.error('D1 MIGRATIONS PENDING - the deployed Worker expects these:');
(pending.length ? pending : ['(could not parse the list; read the output above)']).forEach(p =>
  console.error('  ' + p)
);
console.error('Apply with: npx wrangler d1 migrations apply ' + DB + ' --remote');
process.exit(strict ? 1 : 0);
