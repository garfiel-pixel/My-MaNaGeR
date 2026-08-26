#!/usr/bin/env node
/* ============================================================
   My MaNaGeR — Build Script (esbuild)
   ------------------------------------------------------------
   Concatenates and minifies the JS modules into optimised
   bundles. The app uses a global MMGR namespace (IIFEs that
   attach to window.MMGR), not ES module imports, so the
   correct approach is sequential concatenation with esbuild's
   minify pass — NOT module bundling.

   Output:
     dist/bundle.js      — project.html (55 modules, ~1.28 MB -> ~400-500 KB)
     dist/marketing.js   — marketing pages (3 modules, ~111 KB -> ~40 KB)

   Usage:
     node build.js           — build both bundles
     node build.js --app     — build project.html bundle only
     node build.js --marketing — build marketing bundle only
   ============================================================ */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

// ---- Ensure dist/ exists ----
if (!fs.existsSync(DIST)) fs.mkdirSync(DIST, { recursive: true });

// ---- Project.html bundle (55 modules) ----
// Order must match the <script> tags in project.html — each module
// extends the global MMGR namespace created by mmgr-state.js.
const APP_MODULES = [
  // Core (loaded first — defines MMGR namespace + utilities)
  'js/mmgr-state.js',
  'js/mmgr-utils.js',
  'js/mmgr-net.js',
  // Render sub-modules (loaded before mmgr-render.js which wraps them)
  'js/render/financials.js',
  'js/render/people.js',
  'js/render/closure.js',
  'js/render/documents.js',
  'js/render/weather.js',
  'js/render/kanban.js',
  'js/render/risks.js',
  'js/render/resources.js',
  'js/mmgr-render.js',
  // Domain modules
  'js/mmgr-prompts.js',
  'js/mmgr-weather.js',
  'js/mmgr-field.js',
  'js/mmgr-schedule.js',
  'js/mmgr-resources.js',
  'js/mmgr-health.js',
  'js/mmgr-evm.js',
  'js/mmgr-dmaic.js',
  'js/mmgr-meetings.js',
  'js/mmgr-voice.js',
  'js/mmgr-errors.js',
  'js/mmgr-report.js',
  // App controller
  // Shared component templates (loaded before render modules)
  'js/app/components.js',
  // App sub-modules (extracted from mmgr-app.js)
  'js/app/confirm.js',
  'js/app/copy-text.js',
  'js/app/sidebar.js',
  'js/mmgr-app.js',
  'js/app/weather.js',
  'js/app/backup.js',
  'js/app/export.js',
  'js/app/history.js',
  'js/app/definitions.js',
  // Presence + more domain modules
  'js/mmgr-presence.js',
  'js/mmgr-tasks.js',
  'js/mmgr-risks.js',
  'js/mmgr-stakeholders.js',
  'js/mmgr-bids.js',
  'js/mmgr-closure.js',
  'js/mmgr-raci.js',
  'js/mmgr-charter.js',
  'js/mmgr-defs.js',
  'js/mmgr-portfolio.js',
  'js/mmgr-forecast.js',
  'js/mmgr-decisions.js',
  'js/mmgr-claim.js',
  'js/mmgr-digest.js',
  // AI
  'js/mmgr-ai-key.js',
  'js/mmgr-ai.js',
  // Visual + viewport
  'js/mmgr-viewport.js',
  'js/mmgr-glass.js',
  // Sync + auth + cloud
  'js/mmgr-sync.js',
  'js/mmgr-google-auth.js',
  'js/mmgr-cloud.js',
  // Cloud sub-modules (extracted from mmgr-cloud.js)
  'js/cloud/diffs.js',
  'js/cloud/scope.js',
  'js/cloud/share.js',
  'js/cloud/review.js',
  'js/cloud/webhooks.js',
];

// ---- Marketing pages bundle ----
const MARKETING_MODULES = [
  'js/marketing.js',
  'js/reviews.js',
  'js/verify.js',
  'js/reset.js',
];

// ---- app.html bundle (launcher / project list) ----
const APP_LAUNCHER_MODULES = [
  'projects-data.js',
  'demo-data.js',
  'js/mmgr-utils.js',
  'js/app/components.js',
  'js/mmgr-portfolio.js',
  'js/mmgr-google-auth.js',
  'js/mmgr-cloud-dash.js',
  'js/mmgr-viewport.js',
  'js/mmgr-glass.js',
];

// ---- admin.html bundle ----
const ADMIN_MODULES = [
  'js/mmgr-utils.js',
  'js/mmgr-viewport.js',
  'js/mmgr-glass.js',
];

// ---- Banner: ensures MMGR namespace exists before any module runs ----
const BANNER = '/* My MaNaGeR — bundled by esbuild */var MMGR=window.MMGR||{};';

function buildBundle(modules, outputFile, label) {
  const start = Date.now();

  // Read all source files and strip any standalone MMGR namespace creation
  // (var MMGR = window.MMGR || {}) so the banner handles it once.
  const sources = modules.map(function (rel) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) {
      console.error('  ERROR: missing ' + rel);
      process.exit(1);
    }
    let src = fs.readFileSync(abs, 'utf8');
    // Strip standalone namespace creation lines — the banner provides it.
    // Matches: var MMGR = window.MMGR || {};  (with any whitespace/semicolons)
    src = src.replace(/^\s*var\s+MMGR\s*=\s*window\.MMGR\s*\|\|\s*\{\}\s*;?\s*$/gm, '');
    return src;
  });

  const combined = sources.join('\n;\n');

  // Use esbuild CLI for minification (no npm dependency needed)
  // Write combined source to a temp file, pipe through esbuild, write output.
  const tmpIn = path.join(DIST, '.tmp-build-input.js');
  fs.writeFileSync(tmpIn, BANNER + '\n' + combined);

  try {
    execSync(
      'npx esbuild "' + tmpIn + '" --minify --sourcemap --banner:js="' + BANNER.replace(/"/g, '\\"') + '" --outfile="' + path.join(DIST, path.basename(outputFile)) + '"',
      { stdio: 'pipe', cwd: ROOT }
    );
  } catch (e) {
    console.error('  esbuild failed:', e.stderr ? e.stderr.toString() : e.message);
    process.exit(1);
  } finally {
    // Clean up temp file
    try { fs.unlinkSync(tmpIn); } catch (_) {}
  }

  const outPath = path.join(DIST, path.basename(outputFile));
  const rawSize = Buffer.byteLength(combined);
  const minSize = fs.statSync(outPath).size;
  const ratio = ((1 - minSize / rawSize) * 100).toFixed(1);
  const elapsed = Date.now() - start;

  console.log('  ' + label + ':');
  console.log('    modules:  ' + modules.length);
  console.log('    raw:      ' + (rawSize / 1024).toFixed(0) + ' KB');
  console.log('    minified: ' + (minSize / 1024).toFixed(0) + ' KB (' + ratio + '% reduction)');
  console.log('    output:   dist/' + path.basename(outputFile));
  console.log('    time:     ' + elapsed + 'ms');
}

// ---- CSS minification ----
function buildCSS(inputFile, outputFile, label) {
  const start = Date.now();
  const absIn = path.join(ROOT, inputFile);
  if (!fs.existsSync(absIn)) {
    console.error('  ERROR: missing ' + inputFile);
    process.exit(1);
  }
  const rawSize = fs.statSync(absIn).size;
  try {
    execSync(
      'npx esbuild "' + absIn + '" --minify --outfile="' + path.join(DIST, path.basename(outputFile)) + '"',
      { stdio: 'pipe', cwd: ROOT }
    );
  } catch (e) {
    console.error('  esbuild CSS failed:', e.stderr ? e.stderr.toString() : e.message);
    process.exit(1);
  }
  const outPath = path.join(DIST, path.basename(outputFile));
  const minSize = fs.statSync(outPath).size;
  const ratio = ((1 - minSize / rawSize) * 100).toFixed(1);
  const elapsed = Date.now() - start;
  console.log('  ' + label + ':');
    console.log('    raw:      ' + (rawSize / 1024).toFixed(0) + ' KB');
    console.log('    minified: ' + (minSize / 1024).toFixed(0) + ' KB (' + ratio + '% reduction)');
    console.log('    output:   dist/' + path.basename(outputFile));
    console.log('    time:     ' + elapsed + 'ms');
}

// ---- Main ----
const args = process.argv.slice(2);
const buildApp = args.length === 0 || args.includes('--app');
const buildMkt = args.length === 0 || args.includes('--marketing');
const buildCss = args.length === 0 || args.includes('--css');
const buildLauncher = args.length === 0 || args.includes('--launcher');
const buildAdmin = args.length === 0 || args.includes('--admin');

console.log('My MaNaGeR — build\n');

if (buildApp) buildBundle(APP_MODULES, 'dist/bundle.js', 'app bundle');
if (buildLauncher) buildBundle(APP_LAUNCHER_MODULES, 'dist/app-bundle.js', 'launcher bundle');
if (buildAdmin) buildBundle(ADMIN_MODULES, 'dist/admin-bundle.js', 'admin bundle');
if (buildMkt) buildBundle(MARKETING_MODULES, 'dist/marketing-bundle.js', 'marketing bundle');
if (buildCss) {
  buildCSS('css/mmgr.css', 'dist/mmgr.min.css', 'app CSS');
  buildCSS('css/marketing.css', 'dist/marketing.min.css', 'marketing CSS');
}

console.log('\nDone.');

// Touch sw.js so its mtime is always newer than dist/ files.
// This keeps verify:sw happy — the SW cache version must be the
// newest asset in the SHELL list after every build.
const swPath = path.join(ROOT, 'sw.js');
if (fs.existsSync(swPath)) {
  const now = new Date();
  fs.utimesSync(swPath, now, now);
}
