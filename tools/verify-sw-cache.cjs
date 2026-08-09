/* ============================================================
   My MaNaGeR — sw.js CACHE-version build guard (audit 1.3)
   ------------------------------------------------------------
   Fails the build if any asset listed in sw.js's SHELL array was
   modified AFTER the last CACHE bump in sw.js.

   Why: the service worker is cache-first for static assets. If a
   js/css file is edited but the `CACHE = 'mmgr-shell-vNN'` string
   is not bumped, every browser keeps executing the OLD file even
   after a normal refresh — a silent, hard-to-diagnose deploy bug.

   How "last CACHE bump" is determined: the bump lives in sw.js
   itself, so sw.js's own mtime is used as the bump timestamp
   (mtime heuristic — NOTE: ANY edit to sw.js, even an unrelated
   comment, resets the clock and satisfies the guard; the real
   invariant is "sw.js was touched after the shell change"). Any
   SHELL asset with a newer mtime means it was changed after the
   last time sw.js was touched → fail.

   Usage:  node tools/verify-sw-cache.cjs
   Exit:   0 = all shell assets are older than the last sw.js edit
           1 = at least one asset is stale (build-blocking)
   ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SW = path.join(ROOT, 'sw.js');

const sw = fs.readFileSync(SW, 'utf8');

// 1) Parse the CACHE version string.
const cacheMatch = sw.match(/const CACHE = '([^']+)'/);
if (!cacheMatch) {
  console.error('[verify-sw-cache] FAIL: no `const CACHE = ...` found in sw.js.');
  process.exit(1);
}
const cacheVersion = cacheMatch[1];

// 2) Parse the SHELL array (every asset the worker caches on install).
const shellMatch = sw.match(/const SHELL = \[([\s\S]*?)\];/);
if (!shellMatch) {
  console.error('[verify-sw-cache] FAIL: no SHELL array found in sw.js.');
  process.exit(1);
}
const shellAssets = [];
const strRe = /'([^']+)'/g;
let m;
while ((m = strRe.exec(shellMatch[1])) !== null) {
  const asset = m[1];
  if (asset !== './') shellAssets.push(asset);
}

// 3) sw.js mtime = "the last CACHE bump" (bumping requires editing sw.js).
let swMtime;
try {
  swMtime = fs.statSync(SW).mtimeMs;
} catch (e) {
  console.error('[verify-sw-cache] FAIL: cannot stat sw.js: ' + e.message);
  process.exit(1);
}

// Grace window: a fresh `git checkout` stamps every file with the checkout
// time, so sw.js may legitimately appear a second older than a sibling asset
// that was checked out moments later. Only a change older than the grace is
// treated as "edited after the bump". Override with MMGR_SW_GRACE_MS.
const GRACE_MS = Number(process.env.MMGR_SW_GRACE_MS || 30000);

const stale = [];
const missing = [];
for (const asset of shellAssets) {
  const p = path.join(ROOT, asset);
  if (!fs.existsSync(p)) { missing.push(asset); continue; }
  const st = fs.statSync(p);
  if (st.mtimeMs > swMtime + GRACE_MS) stale.push(asset + '  (mtime ' + st.mtimeMs + ' > sw.js ' + swMtime + ' + grace ' + GRACE_MS + 'ms)');
}

let ok = true;
if (missing.length) {
  // A missing SHELL asset fails cache.addAll() silently (the install catch
  // swallows it) — the asset simply never gets cached. Build-blocking.
  ok = false;
  console.error('[verify-sw-cache] FAIL: SHELL assets missing on disk:');
  missing.forEach(a => console.error('    - ' + a));
}
if (stale.length) {
  ok = false;
  console.error('[verify-sw-cache] FAIL: these SHELL assets are NEWER than the last CACHE bump in sw.js (' + cacheVersion + '):');
  stale.forEach(a => console.error('    - ' + a));
  console.error('    Bump the version string in sw.js (const CACHE = ...) to force a refresh.');
}
if (ok) {
  console.log('[verify-sw-cache] OK — cache version ' + cacheVersion + ' is newer than all ' + shellAssets.length + ' SHELL assets.');
} else {
  process.exit(1);
}
