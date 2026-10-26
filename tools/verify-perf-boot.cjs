#!/usr/bin/env node
/* ============================================================
   tools/verify-perf-boot.cjs - T-PERF-WIRE static half (PERF-1)
   ------------------------------------------------------------
   REFINEMENT-DIRECTIVE-2026-10-24, PERF-1, part 6:

     "A static check fails the build if any html page that includes
      mmgr-glass.js, three or marketing-globe.js lacks mmgr-perf-boot.js."

   The contract has three halves, and all three are checked here because a
   browser gate can only open the pages it knows about:

     1. BOOT   every served HTML page carries js/mmgr-perf-boot.js, and the
               pages that can start a GPU decoration (the glass shader, Three,
               the hero globe) carry it BEFORE the script that would start it.
               Booting after the shader has mounted is a flash of the very work
               Performance Mode exists to skip.
     2. KILL   the one CSS kill block exists in css/mmgr.css and
               css/marketing.css, and every rule in it survives the build into
               dist/*.min.css (the build minifies; a dropped selector would
               silently stop Performance Mode from trimming anything).
     3. WIRE   js/mmgr-perf.js dispatches the mmgr:perf event and every module
               that owns a decoration listens for it.

   Usage:  node tools/verify-perf-boot.cjs
   Registry: docs/CI-TEST-COVERAGE.md -> CI row.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const fails = [];
const notes = [];

const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = rel => fs.existsSync(path.join(ROOT, rel));

const HTML = fs
  .readdirSync(ROOT)
  .filter(f => /\.html$/i.test(f))
  .sort();

/* Pages the BOOT half does not apply to, each for a concrete reason. A new
   exemption is a decision with a sentence attached, never a silent skip. */
const BOOT_EXEMPT = {
  // Carries ZERO external requests by design: it is a redirect stub that
  // replaces an old tracker-laden dashboard and lands on app.html instantly.
  'dashboard.html': 'redirect stub with no scripts (its header promises zero external requests)',
  // QA fixture: writes the demo project into localStorage and navigates away.
  'seed-test.html': 'QA seed fixture, no UI and no decoration',
  // Authoring reference, not a served page: the pre-split monolith kept so the
  // inline styles can be compared. Nothing links to it.
  'monolith html to reference from all features.html':
    'authoring reference copy of the old monolith, not linked or served as a page'
};

// ---------------------------------------------------------------- 1. BOOT
const GPU = [/mmgr-glass\.js/i, /\bthree(\.module)?\.js/i, /marketing-globe/i, /\bTHREE\b/];

HTML.forEach(f => {
  if (BOOT_EXEMPT[f]) {
    notes.push('  SKIP ' + f + ' - ' + BOOT_EXEMPT[f]);
    return;
  }
  const html = read(f);
  const scripts = [];
  const re = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    scripts.push({ src: m[1], at: m.index });
  }
  const boot = scripts.find(s => /mmgr-perf-boot\.js/i.test(s.src));
  const bootAt = boot ? boot.at : -1;
  const gpu = scripts.filter(s => GPU.some(p => p.test(s.src)));

  if (!boot) {
    fails.push('NO BOOT SCRIPT  ' + f + ' does not load js/mmgr-perf-boot.js');
    return;
  }
  if (!/data-sync\s*=\s*["']1["']/i.test(html.slice(bootAt, bootAt + 200))) {
    fails.push('BOOT NOT SYNCING  ' + f + ' loads mmgr-perf-boot.js without data-sync="1"');
  }
  gpu.forEach(s => {
    if (s.at < bootAt) {
      fails.push(
        'BOOT TOO LATE  ' +
          f +
          ' starts ' +
          s.src +
          ' before js/mmgr-perf-boot.js has applied the stored choice'
      );
    }
  });
  if (gpu.length) {
    notes.push('  GPU  ' + f + ' -> ' + gpu.map(s => path.basename(s.src)).join(', '));
  }
});

// ---------------------------------------------------------------- 2. KILL
const KILL = [
  'backdrop-filter: none !important',
  'animation-iteration-count: 1 !important',
  'scroll-behavior: auto !important'
];

[
  ['css/mmgr.css', 'dist/mmgr.min.css'],
  ['css/marketing.css', 'dist/marketing.min.css']
].forEach(([src, dist]) => {
  const source = read(src);
  if (!/\[data-perf=['"]on['"]\]/.test(source)) {
    fails.push('NO KILL BLOCK  ' + src + ' has no [data-perf="on"] rules');
    return;
  }
  KILL.forEach(prop => {
    if (source.indexOf(prop) === -1) {
      fails.push('KILL INCOMPLETE  ' + src + ' is missing "' + prop + '"');
    }
  });
  const canvas = /\[data-perf=['"]on['"]\][^{]*canvas[^{]*\{[^}]*display:\s*none/i.test(source);
  if (!canvas) {
    fails.push('KILL INCOMPLETE  ' + src + ' does not hide decorative canvases');
  }
  if (exists(dist)) {
    const built = read(dist);
    const srcRules = (source.match(/\[data-perf=['"]on['"]\]/g) || []).length;
    const distRules = (built.match(/\[data-perf=(['"]?)on\1\]/g) || []).length;
    if (distRules < srcRules) {
      fails.push(
        'KILL DROPPED  ' +
          dist +
          ' carries ' +
          distRules +
          ' of the ' +
          srcRules +
          ' [data-perf="on"] rules in ' +
          src
      );
    }
  }
});

// ---------------------------------------------------------------- 3. WIRE
const perf = read('js/mmgr-perf.js');
if (!/CustomEvent\(\s*['"]mmgr:perf['"]/.test(perf)) {
  fails.push('NO EVENT  js/mmgr-perf.js does not dispatch a mmgr:perf CustomEvent');
}
if (!/mmgr_perf_mode/.test(perf)) {
  fails.push('NO KEY  js/mmgr-perf.js does not read the mmgr_perf_mode key');
}
[
  ['js/mmgr-glass.js', 'the WebGL shader'],
  ['js/mmgr-dock.js', 'the 3D tilt'],
  ['js/marketing-globe.js', 'the hero globe']
].forEach(([file, what]) => {
  if (!exists(file)) {
    fails.push('MISSING  ' + file + ' (' + what + ') no longer exists');
    return;
  }
  const body = read(file);
  if (body.indexOf('mmgr:perf') === -1) {
    fails.push(
      'NO LISTENER  ' + file + ' never listens for mmgr:perf, so ' + what + ' cannot stop'
    );
  }
});

process.stdout.write('=== PERFORMANCE MODE WIRING: ' + HTML.length + ' pages\n');
notes.forEach(n => process.stdout.write(n + '\n'));
if (fails.length) {
  process.stdout.write('\n');
  fails.forEach(f => process.stdout.write('  FAIL  ' + f + '\n'));
  process.stdout.write('\nPERF WIRING FAIL (' + fails.length + ' problem(s))\n');
  process.exit(1);
}
process.stdout.write('\nPERF WIRING PASS\n');
