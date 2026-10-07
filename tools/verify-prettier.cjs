#!/usr/bin/env node
/**
 * verify-prettier.cjs — run Prettier --check against the tracked source tree.
 * Gate for npm run verify:prettier (wired into npm run verify).
 *
 * Prettier exits 0 when all files match the configured style, 1 when any
 * file needs formatting. We run --check (no write) so the gate is a read-only
 * assertion; the codebase was formatted in the Wave 8.7 commit.
 */
'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const PRETTIER_BIN = path.join(__dirname, '..', 'node_modules', '.bin', 'prettier');
const ROOT = __dirname;

// Match the files Prettier is configured to format (see .prettierrc.json
// and the project's .prettierignore if any). We exclude artifact dirs that
// are not committed: dist/, .wrangler/, node_modules/, tmp/, _archive/.
const GLOB = [
  'js/**/*.js',
  'src/**/*.js',
  'tools/**/*.cjs',
  '*.cjs',
  '*.mjs',
  '*.css',
  '*.html',
  '*.json',
  '*.md',
  // Exclude generated/binary artifacts
  '!dist/**',
  '!.wrangler/**',
  '!node_modules/**',
  '!tmp/**',
  '!_archive/**',
];

function main() {
  let stdout = '';
  let stderr = '';
  try {
    stdout = execFileSync(PRETTIER_BIN, [
      '--check',
      ...GLOB,
    ], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    stderr = err.stderr ? err.stderr.toString('utf8') : '';
    stdout = err.stdout ? err.stdout.toString('utf8') : '';
  }

  const combined = (stdout || '') + '\n' + (stderr || '');
  const lines = combined.split('\n').filter(function (l) { return l.trim(); });

  // Prettier --check outputs one line per file that differs:
  //   "X    path/to/file"
  const diffLines = lines.filter(function (l) {
    return /^\s*[0-9]+\s+/.test(l) && !/All matched files/.test(l);
  });

  if (diffLines.length > 0) {
    process.stderr.write(
      '\nPRETTIER DIFF (' + diffLines.length + ' files need formatting):\n' +
      diffLines.slice(0, 50).join('\n') +
      (diffLines.length > 50 ? '\n... (+' + (diffLines.length - 50) + ' more)' : '') +
      '\n'
    );
    process.exit(1);
  }

  process.stderr.write('Prettier: all matched files use Prettier code style\n');
  process.exit(0);
}

main();
