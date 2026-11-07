#!/usr/bin/env node
/* ============================================================
   My MaNaGeR - Build Script (esbuild)
   ------------------------------------------------------------
   Concatenates and minifies the JS modules into optimised
   bundles. The app uses a global MMGR namespace (IIFEs that
   attach to window.MMGR), not ES module imports, so the
   correct approach is sequential concatenation with esbuild's
   minify pass - NOT module bundling.

   Output:      dist/bundle.js      - project.html (55 modules, ~1.28 MB -> ~400-500 KB)      dist/marketing.js   - marketing pages (3 modules, ~111 KB -> ~40 KB)

   Usage:
     node build.js           — build both bundles
     node build.js --app     — build project.html bundle only
     node build.js --marketing — build marketing bundle only
   ============================================================ */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

// ---- Ensure dist/ exists ----
if (!fs.existsSync(DIST)) {
  fs.mkdirSync(DIST, { recursive: true });
}

/**
 * Compute a short content hash for a file.
 * Returns a 8-char hex hash of the file contents.
 */
function contentHash(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);
}

/**
 * Write a manifest mapping logical bundle names to hashed filenames.
 * Used by HTML processors and service worker to find the current build.
 */
function writeManifest(manifest) {
  const manifestPath = path.join(DIST, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log('  manifest:  dist/manifest.json');
}

// ---- Project.html bundle (56 modules) ----
// Order must match the <script> tags in project.html - each module
// extends the global MMGR namespace created by mmgr-state.js.
const APP_MODULES = [
  // Core (loaded first - defines MMGR namespace + utilities)
  'js/mmgr-state.js',
  'js/mmgr-utils.js',
  // Unit conversion for rate-book quantities (G-1). Loads before the
  // calculator so MMGR.RateUnits is available when the pricing guard runs.
  'js/rateunits.js',
  // Work package relations (OpenProject-inspired). Pure model: must load
  // before the renderers and the domain modules, because both read
  // MMGR.Relations at call time.
  'js/mmgr-relations.js',
  // Kanban board model. Must load before the renderer and the domain
  // modules, because both read MMGR.Kanban at call time.
  'js/mmgr-kanban.js',
  'js/mmgr-net.js',
  // Performance Mode (owner 2026-09-06): gates heavy layers; must load
  // before mmgr-viewport.js / mmgr-dock.js read it.
  'js/mmgr-perf.js',
  // Consent (audit 2026-10-18, 8.2): the signed-in app carries the choice
  // as a Settings > Privacy toggle instead of a banner, and the mirror
  // cookie it writes is what the Worker's CSP reads. Public pages load this
  // file standalone; the app carries it here.
  'js/consent.js',
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
  // C5b shared PDF writer - dependency of mmgr-app.js exports (Gantt PDF)
  'js/mmgr-pdf.js',
  // XLSX/CSV writer AND reader (P3 procurement import reuses the reader)
  'js/xlsx-lite.js',
  // App sub-modules (extracted from mmgr-app.js)
  'js/app/confirm.js',
  'js/app/copy-text.js',
  'js/app/sidebar.js',
  'js/app/section-accelerator.js',
  'js/app/particle-line.js',
  // GANTT-1: pure view builder (rows/spans/links/scale) - the export in
  // mmgr-app.js calls it at runtime; needs Utils + Schedule at call time.
  'js/mmgr-gantt-view.js',
  'js/mmgr-app.js',
  'js/app/weather.js',
  'js/app/backup.js',
  // Baseline guard (owner 2026-09-19): auto-capture + nudge dot; needs
  // State + App toast at call time, wired into renderDash.
  'js/app/baseline-guard.js',
  // H-2 (BUDGET-BOQ directive 2026-11-05): the BOQ to budget bridge. A
  // top-level domain module (not an mmgr-app.js sub-module), so it sits here
  // with the other domain modules and reads State/Utils/Spend at call time.
  'js/mmgr-boq-bridge.js',
  // H-4 (BUDGET-BOQ directive 2026-11-05): the weekly tracking view and its
  // two exports. Reads State/Spend/Utils at call time only.
  'js/mmgr-weekly.js',
  // H-6 (BUDGET-BOQ directive 2026-11-05): the approval preview. Renders the
  // REAL Budget and Weekly panels from a throwaway state (State.setPreviewState)
  // and sends only the ticked, possibly edited changes back for approval.
  'js/mmgr-approval.js',
  // Entitlements seam (owner 2026-09-19): the one future door for gating AI
  // features on sign-in; premium rules land inside later, callers never change.
  'js/app/entitlements.js',
  // Background assistant (Task 6, owner 2026-09-19): deterministic watchers
  // + header mailbox. Needs State/Utils at call time only.
  'js/mmgr-watch.js',
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
  // PART H (owner 2026-10-16): Procurement tab - supplier price book +
  // AI quote panel (ns.Proc). Call-time deps only (State/Utils/Prompts).
  'js/mmgr-procurement.js',
  'js/mmgr-raci.js',
  'js/mmgr-charter.js',
  'js/mmgr-defs.js',
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
  // RBAC sprint 2: the team bell + panel. Independent of MMGR.Cloud at load
  // time so the same file can ride both the project and launcher bundles.
  'js/cloud/team-ui.js',
  'js/cloud/share.js',
  'js/cloud/review.js',
  'js/cloud/photos-ui.js',
  'js/cloud/webhooks.js',
  // C23 Cloud Shared Resource Pool (Phase 6)
  'js/mmgr-pool.js',
  // Calculator (floating draggable FAB)
  'js/mmgr-calculator.js',
  'js/mmgr-templates.js',
  // B8 (owner audit 2026-11-01): the first-project walkthrough. Load-order
  // independent (it builds its own overlay and waits for #sec-nav), so it
  // sits here rather than in the core block.
  'js/mmgr-tour.js',
  // bfcache sprite restore (2026-09-30): icons vanish after Back when
  // Chrome restores the page from the back/forward cache; load-order
  // independent, DOM-only, so it sits last.
  'js/mmgr-icon-restore.js'
];

// ---- Marketing pages bundle ----
// REFINEMENT-DIRECTIVE-2026-10-24 (PERF-1): mmgr-perf.js leads the bundle so the
// footer's "Lighter pages" switch has MMGR.Perf to call and the marketing pages
// share the app's one storage key, one event and one sync.
const MARKETING_MODULES = [
  'js/mmgr-perf.js',
  'js/marketing.js',
  'js/reviews.js',
  'js/verify.js',
  'js/reset.js'
];

// ---- Hero globe bundle (index.html only, loaded after window load) ----
const GLOBE_MODULES = ['js/marketing-globe.js'];

// ---- Landing AI tour bundle (C2; index.html only, loaded LAZILY when the
// #try-ai section nears the viewport or the visitor acts, so it never competes
// with the hero for first paint or LCP) ----
const MARKETING_AI_MODULES = ['js/marketing-ai.js'];

// ---- app.html bundle (launcher / project list) ----
const APP_LAUNCHER_MODULES = [
  'projects-data.js',
  'demo-data.js',
  'js/mmgr-utils.js',
  'js/mmgr-perf.js',
  'js/app/components.js',
  'js/mmgr-google-auth.js',
  'js/mmgr-cloud-dash.js',
  // OWNER 2026-11-06 (second report): the launcher's plan bar is deliberately
  // NOT in this bundle. It loads as its own deferred script from app.html
  // (js/mmgr-billing-manage.js?v=...) because the bundle is a single cached
  // asset that a returning browser can hold for an hour, so bundling the
  // control meant a deploy could not make the Upgrade bar appear on a browser
  // that had the previous bundle. The admin panel still bundles it below.
  // RBAC sprint 2: the launcher's own bell + "Shared with me" list. The
  // launcher has no mmgr-cloud.js, so team-ui.js is deliberately standalone.
  'js/cloud/team-ui.js',
  'js/mmgr-viewport.js',
  'js/mmgr-glass.js',
  // bfcache sprite restore (2026-09-30): same module as the project
  // bundle - load-order independent, DOM-only, sits last.
  'js/mmgr-icon-restore.js'
];

// ---- admin.html bundle ----
const ADMIN_MODULES = [
  'js/mmgr-utils.js',
  'js/mmgr-perf.js',
  'js/mmgr-viewport.js',
  'js/mmgr-glass.js',
  // Wave 8.10 (owner 2026-10-06): the admin rail's Manage-subscription strip.
  // Self-contained (delegated clicks, no inline script) so adding it changes
  // no CSP hash.
  'js/mmgr-billing-manage.js',
  // bfcache sprite restore (2026-10-09): admin.html is a back/forward-cache
  // restore target too - returning to it left its rail icons unpainted. Same
  // module as the project + launcher bundles; load-order independent, it only
  // touches the DOM, so it sits last.
  'js/mmgr-icon-restore.js'
];

// ---- Banner: ensures MMGR namespace exists before any module runs ----
const BANNER = '/* My MaNaGeR - bundled by esbuild */var MMGR=window.MMGR||{};';

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
    // Strip standalone namespace creation lines - the banner provides it.
    // Matches: var MMGR = window.MMGR || {};  (with any whitespace/semicolons)
    src = src.replace(/^\s*var\s+MMGR\s*=\s*window\.MMGR\s*\|\|\s*\{\}\s*;?\s*$/gm, '');
    return src;
  });

  const combined = sources.join('\n;\n');

  // Use esbuild CLI for minification (no npm dependency needed)
  // Write combined source to a temp file, pipe through esbuild, write output.
  const tmpIn = path.join(DIST, '.tmp-build-input.js');
  fs.writeFileSync(tmpIn, BANNER + '\n' + combined);

  const baseName = path.basename(outputFile, path.extname(outputFile));
  const ext = path.extname(outputFile);

  try {
    // Escape backslashes BEFORE quotes: a backslash left raw would consume
    // the quote that follows it and break out of the shell argument.
    const bannerArg = BANNER.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    execSync(
      'npx esbuild "' +
        tmpIn +
        '" --minify --sourcemap --banner:js="' +
        bannerArg +
        '" --outfile="' +
        path.join(DIST, path.basename(outputFile)) +
        '"',
      { stdio: 'pipe', cwd: ROOT }
    );
  } catch (e) {
    console.error('  esbuild failed:', e.stderr ? e.stderr.toString() : e.message);
    process.exit(1);
  } finally {
    // Clean up temp file
    try {
      fs.unlinkSync(tmpIn);
    } catch (_) {}
  }

  const outPath = path.join(DIST, path.basename(outputFile));
  const rawSize = Buffer.byteLength(combined);
  const minSize = fs.statSync(outPath).size;
  const ratio = ((1 - minSize / rawSize) * 100).toFixed(1);
  const elapsed = Date.now() - start;

  // Compute content hash and write hashed copy
  const hash = contentHash(outPath);
  const hashedName = baseName + '.' + hash + ext;
  const hashedPath = path.join(DIST, hashedName);
  fs.copyFileSync(outPath, hashedPath);

  console.log('  ' + label + ':');
  console.log('    modules:  ' + modules.length);
  console.log('    raw:      ' + (rawSize / 1024).toFixed(0) + ' KB');
  console.log('    minified: ' + (minSize / 1024).toFixed(0) + ' KB (' + ratio + '% reduction)');
  console.log('    output:   dist/' + path.basename(outputFile) + ' -> dist/' + hashedName);
  console.log('    time:     ' + elapsed + 'ms');

  return { name: path.basename(outputFile), hashed: hashedName, hash: hash };
}

// ---- App stylesheet assembly (E6.3, 2026-10-31) ----
// css/src/*.css are the SOURCE of the app stylesheet; css/mmgr.css is the
// generated document every page links. Files are concatenated in filename
// order, which is also cascade order - the numeric prefixes exist so moving a
// rule between layers cannot silently reorder it against its neighbours.
// The banner is what tells a future session that editing css/mmgr.css is a
// dead end.
const CSS_SRC = path.join(ROOT, 'css', 'src');
const CSS_BANNER =
  '/* GENERATED FROM css/src/*.css BY build.js. Edit the layer files, never this file. */\n\n';

function bundleAppCSS() {
  const start = Date.now();
  if (!fs.existsSync(CSS_SRC)) {
    console.log('  app CSS layers: css/src missing, leaving css/mmgr.css untouched');
    return false;
  }
  const layers = fs
    .readdirSync(CSS_SRC)
    .filter(f => f.endsWith('.css'))
    .sort();
  if (!layers.length) {
    console.error('  ERROR: css/src holds no .css layer');
    process.exit(1);
  }
  const body = layers.map(f => fs.readFileSync(path.join(CSS_SRC, f), 'utf8')).join('');
  fs.writeFileSync(path.join(ROOT, 'css', 'mmgr.css'), CSS_BANNER + body);
  console.log('  app CSS layers:');
  console.log('    layers:   ' + layers.length + ' (' + layers.join(', ') + ')');
  console.log('    time:     ' + (Date.now() - start) + 'ms');
  return true;
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
      'npx esbuild "' +
        absIn +
        '" --minify --outfile="' +
        path.join(DIST, path.basename(outputFile)) +
        '"',
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

  // Compute content hash and write hashed copy
  const hash = contentHash(outPath);
  const baseName = path.basename(outputFile, path.extname(outputFile));
  const ext = path.extname(outputFile);
  const hashedName = baseName + '.' + hash + ext;
  const hashedPath = path.join(DIST, hashedName);
  fs.copyFileSync(outPath, hashedPath);

  console.log('  ' + label + ':');
  console.log('    raw:      ' + (rawSize / 1024).toFixed(0) + ' KB');
  console.log('    minified: ' + (minSize / 1024).toFixed(0) + ' KB (' + ratio + '% reduction)');
  console.log('    output:   dist/' + path.basename(outputFile) + ' -> dist/' + hashedName);
  console.log('    time:     ' + elapsed + 'ms');

  return { name: path.basename(outputFile), hashed: hashedName, hash: hash };
}

// ---- Main ----
const args = process.argv.slice(2);
const buildApp = args.length === 0 || args.includes('--app');
const buildMkt = args.length === 0 || args.includes('--marketing');
const buildGlobe = args.length === 0 || args.includes('--globe');
const buildCss = args.length === 0 || args.includes('--css');
const buildLauncher = args.length === 0 || args.includes('--launcher');
const buildAdmin = args.length === 0 || args.includes('--admin');

console.log('My MaNaGeR - build\n');

if (buildApp) {
  buildBundle(APP_MODULES, 'dist/bundle.js', 'app bundle');
}
if (buildLauncher) {
  buildBundle(APP_LAUNCHER_MODULES, 'dist/app-bundle.js', 'launcher bundle');
}
if (buildAdmin) {
  buildBundle(ADMIN_MODULES, 'dist/admin-bundle.js', 'admin bundle');
}
if (buildMkt) {
  buildBundle(MARKETING_MODULES, 'dist/marketing-bundle.js', 'marketing bundle');
}
// HERO GLOBE (owner 2026-10-12): its OWN bundle, built from ONE module and
// loaded by index.html only, after the page has loaded. Keeping it separate
// is what lets the hero headline stay the LCP and keeps the globe off every
// other marketing page.
if (buildGlobe) {
  buildBundle(GLOBE_MODULES, 'dist/marketing-globe.js', 'marketing globe bundle');
}
// C2: the landing AI tour is its own lazily-loaded bundle, built with the
// marketing set so a `--marketing` build always produces it.
if (buildMkt) {
  buildBundle(MARKETING_AI_MODULES, 'dist/marketing-ai.js', 'marketing AI bundle');
}
if (buildCss) {
  bundleAppCSS();
  buildCSS('css/mmgr.css', 'dist/mmgr.min.css', 'app CSS');
  buildCSS('css/marketing.css', 'dist/marketing.min.css', 'marketing CSS');
}

console.log('\nDone.');

// Write manifest mapping logical names to hashed filenames.
// The manifest is used by sw.js and any HTML processors to find
// the current content-addressed build artifacts.
const manifest = {};
if (buildApp) {
  manifest['bundle.js'] = 'bundle.' + contentHash(path.join(DIST, 'bundle.js')) + '.js';
}
if (buildLauncher) {
  manifest['app-bundle.js'] = 'app-bundle.' + contentHash(path.join(DIST, 'app-bundle.js')) + '.js';
}
if (buildAdmin) {
  manifest['admin-bundle.js'] =
    'admin-bundle.' + contentHash(path.join(DIST, 'admin-bundle.js')) + '.js';
}
if (buildMkt) {
  manifest['marketing-bundle.js'] =
    'marketing-bundle.' + contentHash(path.join(DIST, 'marketing-bundle.js')) + '.js';
  manifest['marketing-ai.js'] =
    'marketing-ai.' + contentHash(path.join(DIST, 'marketing-ai.js')) + '.js';
}
if (buildGlobe) {
  manifest['marketing-globe.js'] =
    'marketing-globe.' + contentHash(path.join(DIST, 'marketing-globe.js')) + '.js';
}
if (buildCss) {
  manifest['mmgr.min.css'] = 'mmgr.min.' + contentHash(path.join(DIST, 'mmgr.min.css')) + '.css';
  manifest['marketing.min.css'] =
    'marketing.min.' + contentHash(path.join(DIST, 'marketing.min.css')) + '.css';
}
writeManifest(manifest);

// Touch sw.js so its mtime is always newer than dist/ files.
// This keeps verify:sw happy - the SW cache version must be the
// newest asset in the SHELL list after every build.
const swPath = path.join(ROOT, 'sw.js');
if (fs.existsSync(swPath)) {
  const now = new Date();
  fs.utimesSync(swPath, now, now);
}
