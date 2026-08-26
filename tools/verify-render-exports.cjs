/* ============================================================
   verify-render-exports.cjs — A1: Module-export completeness gate
   ------------------------------------------------------------
   Catches the renderSafetyBanner bug class: a function extracted
   into js/render/*.js that has no delegating wrapper in the
   parent monolith, leaving the export object referencing an
   undefined identifier.

   Checks:
   1. For each js/render/*.js module: all exported keys must have
      a matching wrapper in js/mmgr-render.js.
   2. For js/mmgr-render.js ns.Render = { ... }: every bare
      identifier must resolve to a local function/const/let/var
      in the same file's IIFE scope.
   3. Same checks for js/app/* modules against mmgr-app.js.
   4. Same checks for js/cloud/* modules against mmgr-cloud.js.

   Zero dependencies. Run: node tools/verify-render-exports.cjs
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

let failures = 0;
function fail(msg) { failures++; console.error('  FAIL: ' + msg); }
function pass(msg) { console.log('  PASS: ' + msg); }

// ---- helpers ----

// Extract keys from a `ns.X = { key1: val1, ... }` block.
// Returns an array of { key, line } objects.
function extractExportKeys(filePath, varPattern) {
  const src = fs.readFileSync(filePath, 'utf8');
  const lines = src.split('\n');
  const keys = [];
  let inExport = false;
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inExport && varPattern.test(line)) {
      inExport = true;
      depth = 0;
    }
    if (inExport) {
      depth += (line.match(/\{/g) || []).length;
      depth -= (line.match(/\}/g) || []).length;
      // Match `keyName: valueName` or `keyName: function` or `keyName: expr`
      const keyMatch = line.match(/^\s+(\w+)\s*:/);
      if (keyMatch && depth > 0) {
        keys.push({ key: keyMatch[1], line: i + 1 });
      }
      if (depth <= 0) break;
    }
  }
  return keys;
}

// Check if a name is defined as a function/const/let/var in the file scope.
function findDefinition(src, name) {
  // Match `function name(`, `const name =`, `let name =`, `var name =`
  const patterns = [
    new RegExp('function\\s+' + name + '\\s*\\('),
    new RegExp('(const|let|var)\\s+' + name + '\\s*[=;,]'),
  ];
  for (const p of patterns) {
    const m = src.match(p);
    if (m) return true;
  }
  return false;
}

// Check if a delegating wrapper exists: `function name(...) { if (ns.X) ns.X.name(...); }`
function findDelegationWrapper(src, name) {
  // Pattern: `function name(...)` followed within a few lines by `ns.RenderXxx.name(`
  // or `ns.AppXxx.name(`
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const funcRe = new RegExp('function\\s+' + name + '\\s*\\(');
    if (funcRe.test(lines[i])) {
      // Check next 5 lines for delegation call
      const window = lines.slice(i, i + 6).join('\n');
      if (new RegExp('ns\\.\\w+\\.' + name + '\\s*\\(').test(window)) {
        return true;
      }
      // Also accept: `if (ns.X) ns.X.name(...)`
      // or direct call pattern
      if (new RegExp('ns\\.\\w+\\.' + name).test(window)) {
        return true;
      }
    }
  }
  return false;
}

// ---- Track A1: render module exports vs mmgr-render.js wrappers ----

console.log('\n=== A1: render module export completeness ===\n');
const renderDir = path.join(ROOT, 'js', 'render');
const renderFiles = fs.readdirSync(renderDir).filter(f => f.endsWith('.js'));
const renderSrc = fs.readFileSync(path.join(ROOT, 'js', 'mmgr-render.js'), 'utf8');

for (const file of renderFiles) {
  const filePath = path.join(renderDir, file);
  const src = fs.readFileSync(filePath, 'utf8');

  // Find the namespace: ns.RenderXxx
  const nsMatch = src.match(/ns\.(\w+)\s*=\s*\{/);
  if (!nsMatch) {
    pass(file + ': no export object found (skip)');
    continue;
  }
  const nsName = nsMatch[1];
  const keys = extractExportKeys(filePath, new RegExp('ns\\.' + nsName + '\\s*=\\s*\\{'));
  if (keys.length === 0) {
    pass(file + ': empty export (skip)');
    continue;
  }

  let fileFail = 0;
  for (const { key, line } of keys) {
    // Check if mmgr-render.js has either:
    // (a) a function declaration for this key, or
    // (b) a delegation wrapper that forwards to ns.RenderXxx.key()
    const hasFunc = findDefinition(renderSrc, key);
    const hasWrapper = findDelegationWrapper(renderSrc, key);
    const hasFallback = renderSrc.includes('function ' + key + '(') &&
                        (renderSrc.includes('ns.RenderWeather') || renderSrc.includes('ns.' + nsName)) &&
                        findDelegationWrapper(renderSrc, key);

    if (!hasFunc && !hasWrapper && !hasFallback) {
      fail(nsName + '.' + key + ' (from ' + file + ':' + line + ') — no wrapper in mmgr-render.js');
      fileFail++;
    }
  }
  if (fileFail === 0) {
    pass(file + ': all ' + keys.length + ' exports have wrappers');
  }
}

// ---- Track A1: mmgr-render.js ns.Render export completeness ----

console.log('\n=== A1: mmgr-render.js ns.Render export identifiers ===\n');
const renderExportKeys = extractExportKeys(
  path.join(ROOT, 'js', 'mmgr-render.js'),
  /ns\.Render\s*=\s*\{/
);
let renderExportFails = 0;
for (const { key, line } of renderExportKeys) {
  const hasDef = findDefinition(renderSrc, key);
  if (!hasDef) {
    fail('ns.Render.' + key + ' (line ' + line + ') — identifier not defined in mmgr-render.js');
    renderExportFails++;
  }
}
if (renderExportFails === 0) {
  pass('All ' + renderExportKeys.length + ' ns.Render export identifiers defined');
}

// ---- Track A1: app module exports vs mmgr-app.js wrappers ----

console.log('\n=== A1: app module export completeness ===\n');
const appDir = path.join(ROOT, 'js', 'app');
// components.js is a standalone utility module (badge/toast), not an extracted
// function group — its exports are accessed directly via MMGR.Components.*
// and do not need delegation wrappers in mmgr-app.js.
const APP_EXCLUDE = new Set(['components.js']);
const appFiles = fs.readdirSync(appDir).filter(f => f.endsWith('.js') && !APP_EXCLUDE.has(f));
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'mmgr-app.js'), 'utf8');

for (const file of appFiles) {
  const filePath = path.join(appDir, file);
  const src = fs.readFileSync(filePath, 'utf8');
  const nsMatch = src.match(/ns\.(\w+)\s*=\s*\{/);
  if (!nsMatch) {
    pass(file + ': no export object found (skip)');
    continue;
  }
  const nsName = nsMatch[1];
  const keys = extractExportKeys(filePath, new RegExp('ns\\.' + nsName + '\\s*=\\s*\\{'));
  if (keys.length === 0) {
    pass(file + ': empty export (skip)');
    continue;
  }

  let fileFail = 0;
  for (const { key, line } of keys) {
    const hasFunc = findDefinition(appSrc, key);
    const hasWrapper = findDelegationWrapper(appSrc, key);
    if (!hasFunc && !hasWrapper) {
      fail(nsName + '.' + key + ' (from ' + file + ':' + line + ') — no wrapper in mmgr-app.js');
      fileFail++;
    }
  }
  if (fileFail === 0) {
    pass(file + ': all ' + keys.length + ' exports have wrappers');
  }
}

// ---- Track A1: cloud module exports vs mmgr-cloud.js wrappers ----

console.log('\n=== A1: cloud module export completeness ===\n');
const cloudDir = path.join(ROOT, 'js', 'cloud');
const cloudFiles = fs.readdirSync(cloudDir).filter(f => f.endsWith('.js'));
const cloudSrc = fs.readFileSync(path.join(ROOT, 'js', 'mmgr-cloud.js'), 'utf8');

for (const file of cloudFiles) {
  const filePath = path.join(cloudDir, file);
  const src = fs.readFileSync(filePath, 'utf8');
  const nsMatch = src.match(/ns\.(\w+)\s*=\s*\{/);
  if (!nsMatch) {
    pass(file + ': no export object found (skip)');
    continue;
  }
  const nsName = nsMatch[1];
  const keys = extractExportKeys(filePath, new RegExp('ns\\.' + nsName + '\\s*=\\s*\\{'));
  if (keys.length === 0) {
    pass(file + ': empty export (skip)');
    continue;
  }

  let fileFail = 0;
  for (const { key, line } of keys) {
    const hasFunc = findDefinition(cloudSrc, key);
    const hasWrapper = findDelegationWrapper(cloudSrc, key);
    if (!hasFunc && !hasWrapper) {
      fail(nsName + '.' + key + ' (from ' + file + ':' + line + ') — no wrapper in mmgr-cloud.js');
      fileFail++;
    }
  }
  if (fileFail === 0) {
    pass(file + ': all ' + keys.length + ' exports have wrappers');
  }
}

// ---- Summary ----
console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' FAILURE(S) FOUND'));
process.exit(failures === 0 ? 0 : 1);
