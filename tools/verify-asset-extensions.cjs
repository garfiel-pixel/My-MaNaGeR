/* ============================================================
   My MaNaGeR - deployable asset extension gate (F4, 2026-11-09)
   ------------------------------------------------------------
   wrangler.jsonc serves assets from '.', so any file that survives
   .assetsignore is uploaded and publicly fetchable. A stray dump.sql, a
   backup .bak or a local .pem would become a download link.

   This gate walks the deployable tree (the repo minus the directories
   .assetsignore already removes) and:

     FAILS  on .sql .env* .bak .pem .key .pfx .zip .tar .log
     WARNS  on .md and .map (already excluded from the upload, but a
            future .assetsignore edit that drops those rules should be seen)

   Usage:  node tools/verify-asset-extensions.cjs
   Exit:   0 = no failing extension is present
           1 = at least one file with a dangerous extension would ship
   ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Directories .assetsignore removes from the upload. Scanning them would
// report files that never become public (migrations/*.sql is the obvious one).
const SKIP_DIRS = new Set([
  '.git',
  '.wrangler',
  'node_modules',
  'tmp',
  'dogfood-output',
  'planners',
  '_archive',
  'src',
  'test',
  'mcp',
  'tools',
  'migrations',
  'docs',
  'load',
  '.github',
  '.githooks',
  '.freebuff',
  '.agents',
  'adittion to scope',
  'the last update towrads maintainance mode'
]);

const FAIL_EXT = ['.sql', '.bak', '.pem', '.key', '.pfx', '.zip', '.tar', '.log'];
const WARN_EXT = ['.md', '.map'];

function isFail(name) {
  const lower = name.toLowerCase();
  if (lower === '.env' || lower.indexOf('.env.') === 0) {
    return true;
  }
  return FAIL_EXT.some(function (ext) {
    return lower.endsWith(ext);
  });
}

function isWarn(name) {
  const lower = name.toLowerCase();
  return WARN_EXT.some(function (ext) {
    return lower.endsWith(ext);
  });
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      walk(path.join(dir, entry.name), out);
    } else {
      out.push(path.join(dir, entry.name));
    }
  }
}

const files = [];
walk(ROOT, files);

const failures = [];
const warnings = [];
for (const file of files) {
  const name = path.basename(file);
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  if (isFail(name)) {
    failures.push(rel);
  } else if (isWarn(name)) {
    warnings.push(rel);
  }
}

if (warnings.length) {
  console.log('[asset-ext] WARN: ' + warnings.length + ' file(s) with a non-fatal extension');
  warnings.slice(0, 10).forEach(function (w) {
    console.log('[asset-ext]   warn ' + w);
  });
}

if (failures.length) {
  console.log('[asset-ext] FAIL: ' + failures.length + ' file(s) that must never ship');
  failures.forEach(function (f) {
    console.log('[asset-ext]   FAIL ' + f);
  });
  process.exit(1);
}

console.log('[asset-ext] PASS: no .sql/.env/.bak/.pem/.key/.pfx/.zip/.tar/.log in the asset tree');
