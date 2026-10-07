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

   DIAGNOSABILITY (2026-10-07): a failing gate is useless if the reason cannot
   be read back. Downloading Actions job logs needs repository admin rights
   (the API answers 403 "Must have admin rights to Repository"), so when this
   runs under Actions it publishes the reason - and every drifted file - as a
   workflow annotation, which the public check-runs API and the run page both
   surface. Closing that blind spot is why every failure path goes through
   fail() instead of writing to stderr and exiting locally.

   Usage: node tools/verify-prettier.cjs
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PRETTIER_BIN = path.join(ROOT, 'node_modules', 'prettier', 'bin', 'prettier.cjs');

/**
 * Publish a failure as a GitHub Actions annotation so it is readable from the
 * public check-runs API even when the job logs are not. No-op off Actions.
 * Escaping per the workflow-command spec: % -> %25, CR -> %0D, LF -> %0A.
 */
function annotate(title, message) {
  if (process.env.GITHUB_ACTIONS !== 'true') return;
  const body = String(message)
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A')
    .slice(0, 6000);
  process.stdout.write('::error title=' + title + '::' + body + '\n');
}

function fail(msg, detail) {
  process.stderr.write('\nPRETTIER GATE FAIL: ' + msg + '\n');
  if (detail) process.stderr.write(detail + '\n');
  annotate('Prettier gate: ' + msg, (detail || '') + '\n\n--- gate context ---\n' + context());
  process.exit(1);
}

function prettierVersion() {
  try {
    return require(path.join(ROOT, 'node_modules', 'prettier', 'package.json')).version;
  } catch (e) {
    return 'unknown';
  }
}

function context() {
  return [
    'node: ' + process.version,
    'prettier: ' + prettierVersion(),
    'cwd: ' + process.cwd()
  ].join('\n');
}

if (!fs.existsSync(PRETTIER_BIN)) {
  fail('prettier is not installed', 'looked for ' + PRETTIER_BIN + ' - run `npm install`');
}

if (!fs.existsSync(path.join(ROOT, '.prettierignore'))) {
  // Without it Prettier would sweep dist/, node_modules and vendor/, and the
  // gate would be reporting on artifacts instead of source.
  fail('.prettierignore is missing', 'the gate has no defined scope');
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
    fail(
      'prettier produced no "Checking formatting..." banner',
      'raw output:\n' + out.slice(0, 2000)
    );
  }
  console.log('Prettier: all matched files use Prettier code style');
  process.exit(0);
}

if (status === 2) {
  fail('prettier could not complete (glob or parse error)', 'raw output:\n' + out.slice(0, 4000));
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

const list = drifted
  .slice(0, 100)
  .map(function (f) {
    return '  ' + f;
  })
  .join('\n');
process.stderr.write('\n' + drifted.length + ' file(s) need formatting:\n' + list + '\n');
if (drifted.length > 100) {
  process.stderr.write('  ... (+' + (drifted.length - 100) + ' more)\n');
}
fail(
  drifted.length + ' file(s) need formatting - run `npx prettier --write .` to fix',
  list + (drifted.length > 100 ? '\n  ... (+' + (drifted.length - 100) + ' more)' : '')
);
