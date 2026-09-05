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
  'monolith html to reference from all features.html',
  // 2026-09-05: marketing pages now carry an inline dev-fallback block next
  // to dist/marketing-bundle.js — they must be hashed like every other page.
  'index.html',
  'features.html',
  'about.html',
  'contact.html',
  'reviews.html',
  'privacy.html',
  'terms.html'
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

// Extracts every sha256 literal from the whole source file and compares
// count + order against the computed list. The regex REQUIRES the CSP-safe
// written form: a double-quoted JS string whose content is the single-quoted
// CSP token ("'sha256-…='"). A bare 'sha256-…' token (quotes swallowed as JS
// delimiters) joins into the policy UNQUOTED, which invalidates every hash
// source and silently blocks ALL inline scripts — that exact incident shipped
// 2026-09-05 (runs 227-231) via a scratch rewrite script, so the guard now
// rejects the bare form at build time instead of letting it pass silently.
function extractHardcodedHashes(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const hashes = [];
  const re = /"'sha256-[A-Za-z0-9+/=]+'"/g;
  let m;
  while ((m = re.exec(src)) !== null) hashes.push(m[0].slice(1, -1));
  // Loud failure on the bare-token form: an unquoted sha256 token that is
  // not part of a double-quoted CSP token means the list was rewritten wrong.
  const bare = src.match(/(?<!["'])'sha256-[A-Za-z0-9+/=]+'(?!["'])/g);
  if (bare && bare.length) {
    fail = true;
    console.error('[verify-csp-hashes] FAIL: ' + file + ' carries ' + bare.length + ' BARE sha256 token(s) (no CSP quotes). Joined into script-src they are invalid and Chrome blocks every inline script silently. Regenerate with node tools/regen-csp-hashes.cjs.');
  }
  return hashes;
}

let fail = false;

// 0) Policy sanity: the JOINED policy string must contain the CSP-quoted
// hash form ("'sha256-"). Catches a hand-edit that drops the quotes even if
// the count happens to match. Checks the actual runtime join expression.
for (const hf of ['worker.js', 'serve.cjs']) {
  const src = fs.readFileSync(path.join(ROOT, hf), 'utf8');
  if (/INLINE_SCRIPT_HASHES\s*=[\s\S]*?\.join\(/.test(src) && src.indexOf('"\'sha256-') === -1) {
    fail = true;
    console.error('[verify-csp-hashes] FAIL: ' + hf + ' never writes the CSP-quoted form (\'sha256-…\') — hash sources in the joined policy would be unquoted/invalid.');
  }
}

// 1) Computed vs each hardcoded list.
const computed = [];
for (const f of HTML_FILES) {
  const hs = computeHashes(f);
  computed.push({ file: f, hashes: hs });
}
const computedFlat = computed.reduce((acc, c) => acc.concat(c.hashes), []);
// Every computed token must itself carry the CSP quotes (computeHashes adds
// them; this guards a future edit that drops them at the source).
if (computedFlat.some(h => !(h.startsWith("'") && h.endsWith("'")))) {
  fail = true;
  console.error('[verify-csp-hashes] FAIL: computed hash tokens are not CSP-quoted (expected \'sha256-…\' form).');
}

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

// 3) AUDIT FINDING (2026-08): a page META CSP is enforced IN ADDITION to the
// header CSP (the browser applies the intersection of all policies), so every
// inline-script hash must ALSO appear in the page's own <meta http-equiv=
// "Content-Security-Policy"> script-src. project.html's meta was shipping only
// ONE of its two inline hashes — silently blocking its theme script in
// production while worker.js/serve.cjs (and this tool) looked fine. Fail the
// build if any page meta CSP omits a hash of its own inline script.
function checkMetaCsp(file, hashes) {
  if (!hashes.length) return;
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const metaRe = /<meta[^>]+http-equiv=[\"']Content-Security-Policy[\"'][^>]*>/gi;
  let m;
  while ((m = metaRe.exec(src)) !== null) {
    const content = /content=([\"'])([\s\S]*?)\1/i.exec(m[0]);
    if (!content) continue;
    const policy = content[2];
    // Scope the lookup to the script-src directive only (a hash appearing in
    // another directive must not count as covered).
    const scriptSrc = /(?:^|;)\s*script-src\s+([^;]+)/i.exec(policy);
    const allow = scriptSrc ? scriptSrc[1] : '';
    for (const h of hashes) {
      if (allow.indexOf(h) === -1) {
        fail = true;
        console.error('[verify-csp-hashes] FAIL: ' + file + ' meta CSP is missing its own inline-script hash ' + h + ' — that inline <script> is silently blocked in production (CSP intersection).');
        console.error('    Fix: add ' + h + ' to the page\u2019s <meta http-equiv="Content-Security-Policy"> script-src (the header policy in worker.js/serve.cjs already lists it).');
      }
    }
  }
}
computed.forEach(c => checkMetaCsp(c.file, c.hashes));

if (fail) {
  console.error('    Regenerate with the one-liner in the worker.js header comment, then update');
  console.error('    INLINE_SCRIPT_HASHES in BOTH worker.js and serve.cjs.');
  process.exit(1);
}

const perFile = computed.map(c => c.file + ' (' + c.hashes.length + ' inline script' + (c.hashes.length === 1 ? '' : 's') + ')').join(', ');
console.log('[verify-csp-hashes] OK — ' + computedFlat.length + ' inline-script hashes match worker.js and serve.cjs: ' + perFile);
