/* ============================================================
   My MaNaGeR — CSP inline-script hash regeneration
   ------------------------------------------------------------
   Recomputes the SHA-256 hashes of every inline <script> block in
   the served HTML files and rewrites the INLINE_SCRIPT_HASHES
   array in worker.js + serve.cjs.

   Run this after ANY edit to an inline <script> block in
   project.html / app.html / admin.html / dashboard.html /
   seed-test.html / mymanager-field-guide.html / the monolith
   reference file. Stale hashes silently block the page in
   production (CSP), so the companion guard
   tools/verify-csp-hashes.cjs fails the build on drift.

   Usage:  node tools/regen-csp-hashes.cjs
   Exit:   0 = worker.js + serve.cjs rewritten with the computed
           hashes (run npm run verify:csp afterwards to confirm)
   ============================================================ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');

// The exact file list + order from tools/verify-csp-hashes.cjs.
const HTML_FILES = [
  'project.html',
  'app.html',
  'admin.html',
  'dashboard.html',
  'seed-test.html',
  'mymanager-field-guide.html',
  'monolith html to reference from all features.html'
];

// The two files that hardcode the hash list (must stay in sync).
const HARDCODED_FILES = ['worker.js', 'serve.cjs'];

function computeHashes(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const hashes = [];
  const re = /<script>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    hashes.push("'sha256-" + crypto.createHash('sha256').update(m[1]).digest('base64') + "'");
  }
  return hashes;
}

const computedFlat = [];
for (const f of HTML_FILES) computedFlat.push(...computeHashes(f));

const ARRAY_BODY = computedFlat.map(h => '  "' + h + '",').join('\n');

// Anchor tightly to the array literal. Both files join the array into a
// string with .join(' '); the [^;]*? guard stops at the first semicolon so
// the match can never swallow the CSP/HEADERS code that follows the array in
// worker.js (a past bug in this tool deleted those blocks).
const ARRAY_RE = /const INLINE_SCRIPT_HASHES = \[[^;]*?\]\.join\(' '\);/;

let changed = 0;
for (const hf of HARDCODED_FILES) {
  const fp = path.join(ROOT, hf);
  let src = fs.readFileSync(fp, 'utf8');
  if (!ARRAY_RE.test(src)) {
    console.error('ERROR: INLINE_SCRIPT_HASHES array not found in ' + hf);
    process.exitCode = 1;
    continue;
  }
  const replacement = 'const INLINE_SCRIPT_HASHES = [\n' + ARRAY_BODY + '\n].join(\' \');';
  const next = src.replace(ARRAY_RE, replacement);
  fs.writeFileSync(fp, next);
  changed++;
  console.log('Updated ' + hf + ' (' + computedFlat.length + ' hashes)' + (next === src ? ' (already in sync)' : ''));
}

if (changed === HARDCODED_FILES.length) {
  console.log('Done. Run npm run verify:csp to confirm parity.');
} else {
  console.error('One or more files were not updated.');
  process.exitCode = 1;
}