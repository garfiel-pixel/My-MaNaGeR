#!/usr/bin/env node
/* ============================================================
   tools/verify-action-pins.cjs
   GATE: every GitHub Action is pinned to a commit SHA
   ------------------------------------------------------------
   WHY THIS EXISTS (2026-11-24 security review)
   A workflow that runs `uses: actions/checkout@v4` executes whatever that tag
   points at when the job runs. Tags are mutable: a compromised or careless
   upstream can move one onto new code, and that code runs inside a job that
   carries CLOUDFLARE_API_TOKEN (ci.yml starts wrangler dev for the T2 suites).
   Pinning to a 40-character commit SHA is the only ref GitHub cannot retarget.

   Dependabot keeps the pins current (.github/dependabot.yml, github-actions
   ecosystem) - it opens a PR that bumps the SHA, so the gate never means
   "freeze".

   Rules
     - every `uses:` must be `owner/repo@<40 hex>` (a `# vX.Y.Z` comment is
       welcome but not required);
     - local composite actions (`./path`) are allowed and skipped;
     - docker:// refs are allowed only with a digest, not a tag.

   Registry: docs/CI-TEST-COVERAGE.md -> CI row (static job, via npm run verify).
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, '.github', 'workflows');
const SHA = /^[0-9a-f]{40}$/;

let fail = 0;
const files = fs
  .readdirSync(DIR)
  .filter(f => /\.ya?ml$/.test(f))
  .sort();

for (const file of files) {
  const lines = fs.readFileSync(path.join(DIR, file), 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    const m = /^\s*(?:-\s*)?uses:\s*['"]?([^'"\s#]+)['"]?/.exec(line);
    if (!m) {
      return;
    }
    const ref = m[1];
    if (ref.indexOf('./') === 0) {
      return; // local composite action
    }
    if (ref.indexOf('docker://') === 0) {
      const ok = /@sha256:[0-9a-f]{64}$/.test(ref);
      if (!ok) {
        fail++;
        console.log('FAIL  ' + file + ':' + (i + 1) + '  docker tag, not a digest: ' + ref);
      }
      return;
    }
    const at = ref.lastIndexOf('@');
    const sha = at > 0 ? ref.slice(at + 1) : '';
    if (!SHA.test(sha)) {
      fail++;
      console.log('FAIL  ' + file + ':' + (i + 1) + '  not pinned to a SHA: ' + ref);
    }
  });
}

if (fail) {
  console.log('\nACTION PIN GATE FAIL - pin each action to its 40-char commit SHA');
  process.exit(1);
}
console.log('ACTION PIN PASS - every action in ' + files.length + ' workflows is SHA-pinned');
