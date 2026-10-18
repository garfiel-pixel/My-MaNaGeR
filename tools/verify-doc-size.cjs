#!/usr/bin/env node
// T8 - doc size gate (audit directive H-1 / rule N9).
// Fails when an agent-facing plan doc exceeds 40,960 bytes (40 KB), because no agent
// can read an 800 KB directive without burning its context before it starts.
//
// DOCUMENTED EXCEPTION (the single one the directive allows): AUDIT-DIRECTIVE-*.md
// files are work orders handed over whole by the owner. They are listed for
// visibility but exempt from the failure. Everything else must stay under the cap.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CAP = 40960;

// Exact exempt path pattern (the one documented exception).
const EXEMPT = name => /^AUDIT-DIRECTIVE-.*\.md$/.test(name);

// The four checked files the audit names, plus the exemption patterns documented here.
const CHECK = ['CONTINUATION-DIRECTIVE.md', 'AGENTS.md', 'CLAUDE.md'];
// Also scan root for AUDIT-DIRECTIVE-*.md; report their size but never fail on them.
const audits = fs
  .readdirSync(ROOT)
  .filter(f => /^AUDIT-DIRECTIVE-.*\.md$/.test(f))
  .sort();

if (audits.length > 1) {
  // Keep at most one active work order at a time; older ones belong in docs/history/.
  console.log(
    '[verify-doc-size] NOTE: multiple AUDIT-DIRECTIVE files at root: ' + audits.join(', ')
  );
}

let failed = false;
const lines = [];
for (const f of CHECK) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) {
    lines.push(`  MISSING  ${f}`);
    failed = true;
    continue;
  }
  const size = fs.statSync(p).size;
  const tag = size > CAP ? 'OVER' : ' ok ';
  if (size > CAP) failed = true;
  lines.push(`  ${tag}  ${f} (${size} bytes, cap ${CAP})`);
}
for (const f of audits) {
  const size = fs.statSync(path.join(ROOT, f)).size;
  const note = EXEMPT(f) ? 'EXEMPT (documented exception)' : 'not exempt';
  const over = !EXEMPT(f) && size > CAP;
  if (over) failed = true;
  lines.push(`  ${over ? 'OVER' : ' ok '}  ${f} (${size} bytes) - ${note}`);
}

console.log('[verify-doc-size] cap = ' + CAP + ' bytes');
console.log(lines.join('\n'));
if (failed) {
  console.error('[verify-doc-size] FAIL: an agent-facing doc is over 40 KB. Split it: keep the');
  console.error(
    'locked rules, open registry, next-session pointer and newest entries; archive the'
  );
  console.error('rest under docs/history/ (see AUDIT-DIRECTIVE-2026-10-18.md task H-1).');
  process.exit(1);
}
console.log('[verify-doc-size] doc sizes OK\n');
