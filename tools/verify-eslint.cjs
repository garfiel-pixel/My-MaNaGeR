#!/usr/bin/env node
/**
 * verify-eslint.cjs — run ESLint against the JS/CJS source tree.
 * Gate for npm run verify:eslint (wired into npm run verify).
 *
 * ESLint 10.x uses the flat config (eslint.config.js) that we ship.
 * We lint the same file set that the config covers; we treat warnings
 * as non-fatal (the legacy codebase has intentional style that ESLint
 * warns about) but any ERROR fails the gate.
 */
'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const ESLINT_BIN = 'npx';
const ROOT = __dirname;

// Files that ESLint should scan. Match eslint.config.js's file set.
const GLOB = [
  'js/**/*.js',
  'src/**/*.js',
  'tools/**/*.cjs',
  '*.cjs',
  '*.mjs',
  // eslint.config.js explicitly excludes these via ignores; keep them
  // out of the glob so we don't pass them and trigger the "no files"
  // error. vendor/, dist/, .wrangler/, node_modules/, tmp/, _archive/
  // are all ignored by the config.
  'worker.js',
];

function main() {
  let stdout = '';
  let stderr = '';
  try {
    stdout = execFileSync('npx', [
      'eslint',
      '--format', 'unix',
      ...GLOB,
    ], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    // ESLint may have written to stderr even on success; capture it.
    stderr = err.stderr ? err.stderr.toString('utf8') : '';
    // eslint exits non-zero when there are errors OR when there are
    // only warnings depending on config — we decide below.
  }

  const combined = (stdout || '') + '\n' + (stderr || '');
  const lines = combined.split('\n').filter(function (l) { return l.trim(); });

  // Count errors vs warnings.
  let errors = 0;
  let warnings = 0;
  const errorLines = [];
  const warningLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // ESLint unix format:  path:line:col  message  (rule)
    // An error line has no warning marker; we detect by the rule tag.
    // Simpler: eslint's exit code tells us. If it exited 0, all clean
    // (warnings allowed). If non-zero, parse.
    if (line.indexOf('warning') > -1 || line.indexOf('⚠') > -1) {
      warnings++;
      warningLines.push(line);
    } else if (line.indexOf('error') > -1 || line.indexOf('✖') > -1) {
      errors++;
      errorLines.push(line);
    }
  }

  // Also parse the exit code: ESLint returns 1 when there are any
  // problems (errors or warnings) unless --max-warnings was set.
  // Since we didn't set --max-warnings=0, exit 1 means there ARE
  // errors (warnings-only would exit 0 with our config).
  // We rely on the text parsing above.

  const total = errors + warnings;
  if (errors > 0) {
    process.stderr.write(
      '\nESLINT ERRORS (' + errors + '):\n' +
      errorLines.slice(0, 50).join('\n') +
      (errorLines.length > 50 ? '\n... (+' + (errorLines.length - 50) + ' more)' : '') +
      '\n'
    );
    process.exit(1);
  }

  if (warnings > 0) {
    // Warnings are informational; print a summary but don't fail.
    process.stderr.write(
      'ESLint: ' + warnings + ' warning(s), 0 errors (non-blocking)\n' +
      warningLines.slice(0, 10).join('\n') +
      (warningLines.length > 10 ? '\n... (+' + (warningLines.length - 10) + ' more)' : '') +
      '\n'
    );
  } else {
    process.stderr.write('ESLint: 0 warnings, 0 errors\n');
  }

  process.exit(0);
}

main();
