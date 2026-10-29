#!/usr/bin/env node
/* ============================================================
   tools/verify-eol.cjs - line-ending integrity (no CR in tracked text)
   ------------------------------------------------------------
   THE RULE: every tracked text file is stored with LF endings. A CR that
   reaches the index is a defect in three separate ways:

     1. CSP. worker.js and serve.cjs pin SHA-256 hashes of the exact inline
        <script> bytes. A CRLF working copy changes those bytes and every
        inline script on the page is silently blocked in production.
     2. Diff noise. CRLF made git diff report 764-line rewrites that were
        byte-identical (root-caused 2026-09-12).
     3. Byte budgets. The plan docs have a hard 40,960-byte cap; stray CRs eat
        into it invisibly, because no editor shows them.

   IT CHECKS THE INDEX, NOT THE WORKING TREE. git grep --cached reads the
   blobs a commit would carry, which is what CI checks out and what the
   .gitattributes eol=lf filters produce at `git add`. The working tree is
   deliberately NOT scanned: on Windows it legitimately holds CRLF copies
   (core.autocrlf=true, plus trees copied from an archive), and flagging
   those would make the gate red on a clean checkout.

   WHY IT EXISTS: this check lived ONLY in ci.yml until 2026-10-28, so a
   commit could pass every local gate and still go red at CI step 10 - which
   is exactly what happened on ebc0720 (two stray CRs in
   CONTINUATION-DIRECTIVE.md). A CI-only gate is a gate the local battery
   cannot see. The pathspec list below is now the single definition, and
   ci.yml calls this tool.

   ARMS
     1. Corpus. The selection must still contain a plausible number of files.
        A pathspec typo selects nothing, and "nothing found" would otherwise
        read as "nothing wrong".
     2. No CR bytes in any selected blob, with the offending line numbers and
        the tail of each line printed so the fix is a one-line edit.

   Exit 0 = clean, 1 = a CR in the index or a gate that stopped measuring.
   ============================================================ */
'use strict';
const { spawnSync } = require('child_process');

const ROOT = require('path').join(__dirname, '..');

// The single definition of "tracked text file" for this rule. Mirrors the
// eol=lf entries in .gitattributes; add both when a new text type arrives.
const EXTENSIONS = [
  'js',
  'cjs',
  'mjs',
  'md',
  'json',
  'jsonc',
  'sql',
  'yml',
  'css',
  'txt',
  'html',
  'svg'
];
const PATHSPECS = EXTENSIONS.map(e => '*.' + e);

// A floor, not a target: ~555 files matched when this gate was written. If the
// selection collapses (bad pathspec, renamed tree) the gate says so instead of
// reporting a clean scan of nothing.
const MIN_FILES = 200;

function git(args) {
  return spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

const corpusFailures = [];
const crFailures = [];

// ---- ARM 1: the corpus is real -------------------------------------------
const list = git(['ls-files', '-z', '--', ...PATHSPECS]);
if (list.status !== 0) {
  console.error('[verify-eol] FAIL: git ls-files did not run: ' + (list.stderr || '').trim());
  process.exit(1);
}
const files = list.stdout.split('\0').filter(Boolean);
console.log('[verify-eol] tracked text files in the index: ' + files.length);
if (files.length < MIN_FILES) {
  corpusFailures.push(
    'the selection found only ' +
      files.length +
      ' files (floor ' +
      MIN_FILES +
      '): the pathspec list is broken, so a clean result would be meaningless'
  );
}

// ---- ARM 2: no CR bytes ---------------------------------------------------
// status 0 = at least one blob matched, 1 = none matched, anything else = error.
const hits = git(['grep', '--cached', '-I', '-l', '\r', '--', ...PATHSPECS]);
if (hits.status !== 0 && hits.status !== 1) {
  console.error('[verify-eol] FAIL: git grep did not run: ' + (hits.stderr || '').trim());
  process.exit(1);
}
const bad = hits.status === 0 ? hits.stdout.split('\n').filter(Boolean) : [];

for (const file of bad) {
  const blob = git(['cat-file', 'blob', ':' + file]);
  if (blob.status !== 0) {
    crFailures.push(file + ': in a CR list but the index blob could not be read');
    continue;
  }
  const buf = blob.stdout;
  const at = [];
  for (let i = 0; i < buf.length && at.length < 5; i++) if (buf.charCodeAt(i) === 13) at.push(i);
  const lines = at.map(off => {
    const line = buf.slice(0, off).split('\n').length;
    const start = buf.lastIndexOf('\n', off - 1) + 1;
    const end = buf.indexOf('\n', off);
    const text = buf.slice(start, end === -1 ? buf.length : end).replace(/\r/g, '');
    return 'line ' + line + ': ...' + text.slice(-60);
  });
  const totalCr = buf.split('\r').length - 1;
  crFailures.push(file + ': ' + totalCr + ' CR byte(s)\n      ' + lines.join('\n      '));
}

if (corpusFailures.length || crFailures.length) {
  console.error(
    '\n[verify-eol] FAIL: ' + (corpusFailures.length + crFailures.length) + ' problem(s):'
  );
  for (const f of corpusFailures) console.error('    ' + f);
  for (const f of crFailures) console.error('    ' + f);
  if (crFailures.length) {
    console.error(
      '\nFix: rewrite the file with LF endings (or delete the stray CR inside the ' +
        'line). The .gitattributes rules normalize CRLF at `git add`, so a CR that ' +
        'still reaches the index is inside the line content, not the line ending. ' +
        'Confirm with: git grep --cached -Il $' +
        "'\\r'" +
        ' -- *.md'
    );
  }
  if (corpusFailures.length) {
    console.error(
      '\nFix: restore PATHSPECS/EXTENSIONS in this file to the text types .gitattributes covers.'
    );
  }
  console.error('');
  process.exit(1);
}

console.log('[verify-eol] PASS: no CR bytes in ' + files.length + ' tracked text files\n');
