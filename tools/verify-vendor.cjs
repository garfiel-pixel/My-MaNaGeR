#!/usr/bin/env node
/* ============================================================
   tools/verify-vendor.cjs
   GATE: SEC-07 - vendored code provenance (three r160, whisper wasm)
   ------------------------------------------------------------
   Recomputes the SHA-256 of every file under vendor/ and compares
   against vendor/MANIFEST.json. Fails on any hash/size drift, or
   any manifest entry whose file is missing. Extra untracked files
   are reported but do not fail (so new vendored deps can be added
   by updating the manifest). Exits 1 on drift/missing.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = process.cwd();
const manifestPath = path.join(root, 'vendor', 'MANIFEST.json');

if (!fs.existsSync(manifestPath)) {
  console.error('vendor/MANIFEST.json missing');
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// flatten manifest file map: relpath -> {sha256, bytes}
const expect = {};
for (const item of manifest.items || []) {
  for (const [rel, meta] of Object.entries(item.files || {})) {
    expect[rel] = meta;
  }
}

let failures = 0;
const fail = m => {
  console.log('  ' + m);
  failures++;
};

// every manifest entry must match on disk
for (const [rel, meta] of Object.entries(expect)) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) {
    fail(`MISSING: ${rel}`);
    continue;
  }
  const buf = fs.readFileSync(p);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  if (sha !== meta.sha256)
    fail(
      `HASH DRIFT: ${rel} (manifest ${meta.sha256.slice(0, 12)}..., disk ${sha.slice(0, 12)}...)`
    );
  if (buf.length !== meta.bytes)
    fail(`SIZE DRIFT: ${rel} (manifest ${meta.bytes}, disk ${buf.length})`);
}

// report (do not fail) files present on disk but absent from the manifest
function walk(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else acc.push(path.relative(root, p).split(path.sep).join('/'));
  }
  return acc;
}
const onDisk = walk(path.join(root, 'vendor'), []);
const extras = onDisk.filter(f => !expect[f]);
if (extras.length)
  console.log(
    `  note: ${extras.length} file(s) on disk not in manifest (add them to vendor/MANIFEST.json):` +
      (extras.length <= 8 ? ' ' + extras.join(', ') : '')
  );

if (failures === 0) {
  console.log(`verify-vendor: PASS (${Object.keys(expect).length} file(s) checked)`);
  process.exit(0);
} else {
  console.log(`verify-vendor: FAIL (${failures} finding(s))`);
  process.exit(1);
}
