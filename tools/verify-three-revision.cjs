/* ============================================================
   My MaNaGeR - vendored three.js revision guard (D, 2026-11-09)
   ------------------------------------------------------------
   three.js is a vendored browser module, not an npm dependency, so
   `npm audit` cannot see it. This gate pins the revision the security
   register accepted (r160) and fails the build if the file changes
   without the register entry being revisited.

   Why a gate rather than a comment: a quiet replacement of the vendor file
   is exactly the change no other check would notice. The register records
   the two advisories and why neither applies to r160; a different revision
   means that reasoning must be re-run, not assumed.

   Usage:  node tools/verify-three-revision.cjs
   Exit:   0 = the vendored file is the accepted revision
           1 = the revision moved (update the register and this constant)
   ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const THREE = path.join(ROOT, 'vendor', 'three', 'three.module.js');
const EXPECTED = '160';

if (!fs.existsSync(THREE)) {
  console.error('[verify-three] FAIL: vendor/three/three.module.js is missing');
  process.exit(1);
}

const source = fs.readFileSync(THREE, 'utf8');
const match = /const\s+REVISION\s*=\s*'([^']+)'/.exec(source);
if (!match) {
  console.error('[verify-three] FAIL: no REVISION constant found in the vendored file');
  process.exit(1);
}

if (match[1] !== EXPECTED) {
  console.error(
    '[verify-three] FAIL: vendored three.js is r' +
      match[1] +
      ', the accepted revision is r' +
      EXPECTED +
      '. Re-check the advisories and update docs/SECURITY-REGISTER.md (SEC-17) before changing this gate.'
  );
  process.exit(1);
}

console.log('[verify-three] PASS: vendored three.js is r' + EXPECTED);
