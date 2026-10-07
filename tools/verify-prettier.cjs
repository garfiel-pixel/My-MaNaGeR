#!/usr/bin/env node
/* ============================================================
   verify-prettier.cjs - Prettier format gate for `npm run verify` (Wave 8.7).

   WHY IT IS WRITTEN THIS WAY (rewritten 2026-10-07 after a false pass):
   The first version decided pass/fail by filtering Prettier's stdout with a
   regex that expected "<count>  <path>" lines. Prettier 3 prints
   "[warn] <path>", so the filter matched nothing, the failure list was always
   empty, and the gate printed "all matched files use Prettier code style" even
   with deliberate formatting drift injected. It could not fail.

   This version trusts the EXIT CODE (Prettier's own contract):
     0  = every matched file matches the configured style
     1  = at least one file needs formatting
     2  = Prettier itself errored (bad glob, or a file it cannot parse)

   Scope comes from .prettierignore, which deliberately excludes HTML (a
   reformat would rewrite inline <script> blocks and invalidate the SHA-256
   CSP hashes in worker.js / serve.cjs - AGENTS.md rule 1), hash-pinned skill
   bundles, and JSON/JSONC data & config.

   Usage: node tools/verify-prettier.cjs
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PRETTIER_BIN = path.join(ROOT, 'node_modules', 'prettier', 'bin', 'prettier.cjs');

function fail(msg) {
  process.stderr.write('\nPRETTIER GATE FAIL: ' + msg + '\n');
  process.exit(1);
}

if (!fs.existsSync(PRETTIER_BIN)) {
  fail('prettier is not installed at ' + PRETTIER_BIN + ' - run `npm install`');
}

if (!fs.existsSync(path.join(ROOT, '.prettierignore'))) {
  // Without it Prettier would sweep dist/, node_modules and vendor/, and the
  // gate would be reporting on artifacts instead of source.
  fail('.prettierignore is missing - the gate has no defined scope');
}

const r = spawnSync(process.execPath, [PRETTIER_BIN, '--check', '.'], {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 128 * 1024 * 1024
});

if (r.error) fail('could not start prettier: ' + r.error.message);

const out = (r.stdout || '') + (r.stderr || '');
const status = r.status;

if (status === 0) {
  // Guard against the "checked nothing" case: a scope that matches no file
  // prints no [warn] lines and exits 0, which would be another silent pass.
  if (/Checking formatting\.\.\./.test(out) === false) {
    fail('prettier produced no "Checking formatting..." banner - it may have matched nothing');
  }
  console.log('Prettier: all matched files use Prettier code style');
  process.exit(0);
}

if (status === 2) {
  process.stderr.write(out.slice(0, 4000) + '\n');
  fail('prettier could not complete (glob or parse error)');
}

// status === 1: real formatting drift.
// When stdout is not a TTY Prettier writes the [warn] lines to STDERR and
// wraps the tag in ANSI colour, so strip escapes before matching or the list
// comes back empty and the failure is reported without naming a file.
const ANSI = /\u001b\[[0-9;]*m/g;
const drifted = out
  .split('\n')
  .map(function (l) {
    return l.replace(ANSI, '');
  })
  .filter(function (l) {
    return /^\[warn\]\s+/.test(l) && !/Code style issues/.test(l);
  })
  .map(function (l) {
    return l.replace(/^\[warn\]\s+/, '');
  });

process.stderr.write('\n' + drifted.length + ' file(s) need formatting:\n');
process.stderr.write(
  drifted
    .slice(0, 50)
    .map(function (f) {
      return '  ' + f;
    })
    .join('\n') + '\n'
);
if (drifted.length > 50) {
  process.stderr.write('  ... (+' + (drifted.length - 50) + ' more)\n');
}
fail('run `npx prettier --write .` to fix');
