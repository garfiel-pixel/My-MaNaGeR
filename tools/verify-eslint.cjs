#!/usr/bin/env node
/* ============================================================
   verify-eslint.cjs - ESLint gate for `npm run verify` (Wave 8.7).

   WHY IT IS WRITTEN THIS WAY (rewritten 2026-10-07 after a false pass):
   The first version shelled out with `--format unix`, a formatter ESLint 10
   REMOVED, and then decided pass/fail by scanning the text for the words
   "error"/"warning". ESLint's error message contains neither, so the gate
   reported "0 warnings, 0 errors" no matter what - it could not fail.
   A gate that cannot fail proves nothing, so this version:

     1. runs ESLint through the resolved local binary (no npx, no shell),
     2. asks for --format json and PARSES it, so severity is read from the
        data rather than guessed from prose,
     3. FAILS if ESLint crashed or produced unparseable output,
     4. FAILS if it linted zero files (the classic "config missing" symptom),
     5. FAILS on any severity-2 (error) message,
     6. FAILS if warnings EXCEED a frozen ceiling - a ratchet so new lint debt
        cannot be added silently. ES5-era code carries a lot of pre-existing
        warning debt; the ceiling is the Wave 8.7 baseline plus headroom, and
        it should be LOWERED over time, never raised without a reason.

   Usage: node tools/verify-eslint.cjs
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ESLINT_BIN = path.join(ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js');

// Wave 8.7 baseline: 4519 warnings / 0 errors across 233 files.
// Headroom absorbs dependency-level drift; new debt trips the gate.
const WARN_CEILING = 4600;

function fail(msg) {
  process.stderr.write('\nESLINT GATE FAIL: ' + msg + '\n');
  process.exit(1);
}

if (!fs.existsSync(ESLINT_BIN)) {
  fail('eslint is not installed at ' + ESLINT_BIN + ' - run `npm install`');
}

// `.` lets the flat config's `files` / `ignores` select the tree, so the gate
// can never drift out of sync with eslint.config.js.
const r = spawnSync(process.execPath, [ESLINT_BIN, '.', '--format', 'json'], {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 128 * 1024 * 1024
});

if (r.error) fail('could not start eslint: ' + r.error.message);

let results;
try {
  results = JSON.parse(r.stdout || '[]');
} catch (e) {
  process.stderr.write((r.stderr || '').slice(0, 2000) + '\n');
  fail('eslint did not return parseable JSON (it probably could not load a config)');
}

if (!Array.isArray(results)) fail('unexpected eslint output shape');

const linted = results.filter(function (f) {
  return Array.isArray(f.messages);
}).length;
if (linted === 0) {
  fail('eslint linted 0 files - eslint.config.js matched nothing, so nothing was proven');
}

let errors = 0;
let warnings = 0;
let fatal = 0;
const errorLines = [];

results.forEach(function (f) {
  (f.messages || []).forEach(function (m) {
    const where = path.relative(ROOT, f.filePath) + ':' + (m.line || 0) + ':' + (m.column || 0);
    if (m.fatal) fatal++;
    if (m.severity === 2) {
      errors++;
      errorLines.push('  ' + where + '  ' + m.message + (m.ruleId ? '  (' + m.ruleId + ')' : ''));
    } else if (m.severity === 1) {
      warnings++;
    }
  });
});

if (fatal) fail(fatal + ' fatal parse error(s) in linted files');

if (errors > 0) {
  process.stderr.write('\n' + errors + ' ESLint error(s):\n');
  process.stderr.write(errorLines.slice(0, 50).join('\n') + '\n');
  if (errorLines.length > 50) {
    process.stderr.write('  ... (+' + (errorLines.length - 50) + ' more)\n');
  }
  fail(errors + ' error(s)');
}

if (warnings > WARN_CEILING) {
  fail(
    warnings +
      ' warnings exceeds the frozen ceiling of ' +
      WARN_CEILING +
      ' - this change added lint debt. Fix the new warnings (or, if the ' +
      'ceiling is genuinely obsolete, lower it deliberately).'
  );
}

console.log(
  'ESLint: 0 errors, ' +
    warnings +
    ' pre-existing warning(s) across ' +
    linted +
    ' file(s) (ceiling ' +
    WARN_CEILING +
    ', headroom ' +
    (WARN_CEILING - warnings) +
    ')'
);
process.exit(0);
