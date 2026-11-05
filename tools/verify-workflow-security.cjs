#!/usr/bin/env node
/* ============================================================
   tools/verify-workflow-security.cjs
   GATE: SEC-01 / 4.1 - GitHub Actions least privilege + pinning
   ------------------------------------------------------------
   Fails when any workflow under .github/workflows:
     1. lacks a TOP-LEVEL `permissions:` block (jobs inherit the
        repo default token, often read/write);
     2. contains `pull_request_target` (runs the workflow with a
        privileged token against a fork's code);
     3. uses a third-party action pinned to a moving tag instead of
        a full 40-hex commit SHA. First-party `actions/*` may stay
        on tags (documented here, per SEC-01 fix note).
   Exits 1 on the first category of failure; prints every finding.
   ============================================================ */
const fs = require('fs');
const path = require('path');

const WF_DIR = path.join(process.cwd(), '.github', 'workflows');
const SHA_RE = /^[0-9a-f]{40}$/;

let failures = 0;
const log = (wf, msg) => {
  console.log(`  [${wf}] ${msg}`);
  failures++;
};

if (!fs.existsSync(WF_DIR)) {
  console.error('No .github/workflows directory found.');
  process.exit(1);
}

const files = fs.readdirSync(WF_DIR).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));

for (const f of files) {
  const full = path.join(WF_DIR, f);
  const text = fs.readFileSync(full, 'utf8');
  const lines = text.split('\n');

  // 1. top-level permissions: a line that is exactly "permissions:" at column 0
  const hasTopLevelPerms = lines.some(l => l === 'permissions:' || l === 'permissions: read-all');
  if (!hasTopLevelPerms) {
    log(f, 'no top-level `permissions:` block');
  }

  // 2. pull_request_target anywhere
  if (text.includes('pull_request_target')) {
    log(f, 'contains `pull_request_target`');
  }

  // 3. uses: pinning
  for (const raw of lines) {
    const m = raw.match(/^\s*-?\s*uses:\s*(\S+)/);
    if (!m) continue;
    let ref = m[1];
    // strip an inline comment if present: "owner/repo@sha # v2"
    const hashIdx = ref.indexOf('#');
    if (hashIdx !== -1) ref = ref.slice(0, hashIdx).trim();
    if (!ref.includes('@')) continue; // local action or malformed; not our concern
    const [action, version] = ref.split('@');
    const owner = action.split('/')[0];
    if (owner === 'actions') continue; // first-party: tags allowed by policy
    if (!SHA_RE.test(version)) {
      log(f, `third-party action not SHA-pinned: ${action}@${version}`);
    }
  }
}

if (failures === 0) {
  console.log(`verify-workflow-security: PASS (${files.length} workflow(s) scanned)`);
  process.exit(0);
} else {
  console.log(`verify-workflow-security: FAIL (${failures} finding(s))`);
  process.exit(1);
}
