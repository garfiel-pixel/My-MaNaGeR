/* ============================================================
   My MaNaGeR — test-registry gate (2026-09-22)
   ------------------------------------------------------------
   Every QA / verification harness in this repo must be registered in
   docs/CI-TEST-COVERAGE.md, which records WHERE it runs (CI, EXTENDED,
   TRIAGE, MANUAL) and what it covers.

   Why this gate exists: qa-full, qa-ai, qa-v11 and qa-p1 sat stale for
   weeks while the CI battery stayed green — they were never wired into
   CI and nothing noticed. This check makes forgetting a harness a red
   build: a new qa-*.cjs / verify-*.cjs / audit-*.cjs file is either
   wired in, scheduled in the extended workflow, triaged with findings,
   or explicitly marked MANUAL — but never silently orphaned.

   Usage:  node tools/verify-test-registry.cjs
   ============================================================ */
const fs = require('fs');
const path = require('path');

const DOC = 'docs/CI-TEST-COVERAGE.md';
const TOKENS = ['CI', 'EXTENDED', 'TRIAGE', 'MANUAL'];

let failed = 0;
const fail = (m) => { console.log('  FAIL  ' + m); failed++; };
const pass = (m) => console.log('  PASS  ' + m);

console.log('\n=== TEST REGISTRY: every harness is accounted for ===');

if (!fs.existsSync(DOC)) {
  fail(DOC + ' is missing - the registry is the source of truth');
  console.log('\nTEST REGISTRY FAIL (1)');
  process.exit(1);
}
const doc = fs.readFileSync(DOC, 'utf8');

// harness files: qa-*/verify-*/audit-* in the repo root and in tools/
const isHarness = (f) => /^(qa|verify|audit)-[a-z0-9-]+\.cjs$/.test(f);
const files = []
  .concat(fs.readdirSync('.').filter(isHarness).map((f) => ({ name: f, where: 'root' })))
  .concat(fs.readdirSync('tools').filter(isHarness).map((f) => ({ name: f, where: 'tools' })));

const unregistered = [];
const untagged = [];
for (const f of files) {
  if (doc.indexOf('`' + f.name + '`') === -1 && doc.indexOf(f.name) === -1) {
    unregistered.push(f.where + '/' + f.name);
    continue;
  }
  // the line carrying the filename must also carry a status token
  const line = doc.split('\n').find((l) => l.indexOf(f.name) > -1) || '';
  if (!TOKENS.some((t) => new RegExp('\\b' + t + '\\b').test(line))) untagged.push(f.name);
}

if (unregistered.length) fail(unregistered.length + ' harness(es) missing from ' + DOC + ': ' + unregistered.join(', '));
else pass('all ' + files.length + ' harnesses are registered in ' + DOC);

if (untagged.length) fail(untagged.length + ' harness row(s) carry no status token (' + TOKENS.join('/') + '): ' + untagged.join(', '));
else pass('every registered row declares where it runs');

// a registered harness that no longer exists is stale documentation
const referenced = Array.from(doc.matchAll(/`((?:tools\/)?(?:qa|verify|audit)-[a-z0-9-]+\.cjs)`/g)).map((m) => m[1]);
const seen = new Set();
const stale = [];
for (const r of referenced) {
  if (seen.has(r)) continue;
  seen.add(r);
  const bare = path.basename(r);
  if (!fs.existsSync(r) && !fs.existsSync(bare) && !fs.existsSync(path.join('tools', bare))) stale.push(r);
}
if (stale.length) fail(stale.length + ' registry entr(ies) point at files that do not exist: ' + stale.join(', '));
else pass('no stale registry entries');

console.log('\n' + (failed ? 'TEST REGISTRY FAIL (' + failed + ')' : 'TEST REGISTRY PASS'));
process.exit(failed ? 1 : 0);
