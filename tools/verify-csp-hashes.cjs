/* ============================================================
   My MaNaGeR — CSP inline-script hash build guard (audit #2)
   ------------------------------------------------------------
   The production Worker (worker.js) and the local dev server
   (serve.cjs) ship a Content-Security-Policy whose script-src
   lists SHA-256 hashes of every inline <script> block in the
   served HTML files. The moment anyone edits an inline <script>
   block without re-running the regen command (worker.js header
   comment), the CSP silently blocks that page's inline script in
   production — no console error, no crash, just dead functionality.

   This guard recomputes the hashes and fails the build if they
   drift from the hardcoded lists — converting the silent
   production bug into a build-time error.

   Usage:  node tools/verify-csp-hashes.cjs
   Exit:   0 = computed hashes match worker.js AND serve.cjs
           1 = drift detected (build-blocking)
   ============================================================ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');

// The exact file list + order from worker.js's header regen command.
const HTML_FILES = [
  'project.html',
  'app.html',
  'admin.html',
  'dashboard.html',
  'seed-test.html',
  'mymanager-field-guide.html',
  'monolith html to reference from all features.html'
];

// The two files that hardcode the hash list (must stay in sync with each
// other AND with the computed hashes).
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

// Extracts every 'sha256-...' literal from the whole source file and compares
// count + order against the computed list. ASSUMPTION: sha256 literals appear
// ONLY in the INLINE_SCRIPT_HASHES array (the CSP strings reference the array
// at runtime via `+ INLINE_SCRIPT_HASHES`). If a future policy ever inlines
// sha256 literals directly, this would double-count — keep the runtime-join
// convention or update this extractor to scope to the array literal only.
function extractHardcodedHashes(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const hashes = [];
  const re = /'sha256-[A-Za-z0-9+/=]+'/g;
  let m;
  while ((m = re.exec(src)) !== null) hashes.push(m[0]);
  return hashes;
}

let fail = false;

// 1) Computed vs each hardcoded list.
const computed = [];
for (const f of HTML_FILES) {
  const hs = computeHashes(f);
  computed.push({ file: f, hashes: hs });
}
const computedFlat = computed.reduce((acc, c) => acc.concat(c.hashes), []);

for (const hf of HARDCODED_FILES) {
  const hardcoded = extractHardcodedHashes(hf);
  const a = JSON.stringify(computedFlat);
  const b = JSON.stringify(hardcoded);
  if (a !== b) {
    fail = true;
    console.error('[verify-csp-hashes] FAIL: computed hashes do not match the hardcoded list in ' + hf + '.');
    console.error('    computed  (' + computedFlat.length + '):');
    computed.forEach(c => c.hashes.forEach(h => console.error('      ' + c.file + '  ' + h)));
    console.error('    hardcoded (' + hardcoded.length + '):');
    hardcoded.forEach(h => console.error('      ' + h));
  }
}

// 2) worker.js and serve.cjs must also agree with each other (defense in depth).
const w = JSON.stringify(extractHardcodedHashes('worker.js'));
const s = JSON.stringify(extractHardcodedHashes('serve.cjs'));
if (w !== s) {
  fail = true;
  console.error('[verify-csp-hashes] FAIL: worker.js and serve.cjs hardcoded hash lists have drifted from each other.');
}

if (fail) {
  console.error('    Regenerate with the one-liner in the worker.js header comment, then update');
  console.error('    INLINE_SCRIPT_HASHES in BOTH worker.js and serve.cjs.');
  process.exit(1);
}

const perFile = computed.map(c => c.file + ' (' + c.hashes.length + ' inline script' + (c.hashes.length === 1 ? '' : 's') + ')').join(', ');
console.log('[verify-csp-hashes] OK — ' + computedFlat.length + ' inline-script hashes match worker.js and serve.cjs: ' + perFile);
