#!/usr/bin/env node
/* ============================================================
   tools/verify-sizes.cjs
   GATE: E5 - file sizes with a ceiling, so nothing grows back unnoticed
   ------------------------------------------------------------
   WHY THIS EXISTS (REPO-RELIABILITY-DIRECTIVE-2026-10-30, E5)
   `css/mmgr.css` reached 20,016 lines / 484 KB and `js/calculator-page.js`
   562 KB with nothing in CI noticing, because no gate measures size. A cap
   that is never hit is decoration; a cap that fails prints the three largest
   offenders so the next session knows what to split.

   Caps are measured sizes plus headroom, not aspirations. Raising a cap is
   allowed, but only in the commit that needs it, with the reason in the
   commit body (the same rule the doc-size gate follows).

   Usage:  node tools/verify-sizes.cjs
   Registry: docs/CI-TEST-COVERAGE.md -> CI row (static job).
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/* Exact caps. Headroom is roughly 5 to 10 percent at the time of writing. */
const EXACT = {
  // 2026-11-06 (H-6): raised 512000 -> 520000 in the commit that added the
  // approval preview's stylesheet block. The old cap left 1.5 KB of headroom
  // and the feature needs ~2.6 KB of token-only CSS; the next UI wave should
  // split a layer rather than raise this again.
  // 2026-11-08 (C2 Task 2): raised 520000 -> 535000 for the Idea Intake board,
  // list and sheet CSS (~5 KB of token-only surface in css/src/30-panels.css).
  // 2026-11-08 (C3 Phase 4): raised 535000 -> 545000 for the register page
  // cell and the handover pack (~1.5 KB on screen plus ~5 KB of print-only
  // rules). The pack is the first print surface in the app; if the next wave
  // adds more print CSS, split the print rules into their own stylesheet
  // rather than raising this again.
  // 2026-11-10 (Wave 4): raised 545000 -> 550000 for the calculator input
  // outline changes, the AI actions preview card and the BOQ waiting chip.
  'css/mmgr.css': 550000,
  // 2026-11-10 (Wave 6): raised 160000 -> 163000 for the sign-in two-column
  // layout, the per-letter MMGRWP hover and the mobile stack.
  'css/marketing.css': 163000,
  'js/calculator-page.js': 600000,
  // 2026-11-08 (C2 Task 2): raised 210000 -> 215000 for the intake panel,
  // nav group and idea sheet markup in project.html.
  // 2026-11-08 (C3 Phase 1): raised 215000 -> 220000 for the Documents view
  // switcher and the Pages view container (~0.6 KB).
  // 2026-11-10 (Wave 2): raised 220000 -> 226000 for the header status chip,
  // its four-item popover and the "Close snapshot" row in the backup popover
  // (~1.6 KB). The chip is the only new header control; the next markup wave
  // should move a panel out of this file rather than raise it again.
  'project.html': 226000,
  'calculator.html': 80000,
  'app.html': 140000,
  // 2026-11-10 (Wave L): raised 50000 -> 54000 for the "Who we are" band
  // (eyebrow, heading, lede, three identity cards with sprite icons), the
  // top-level Who we are nav item with its two-row dropdown, the two mobile
  // menu entries and the two footer links (~3.4 KB). The band is the only
  // new marketing section this year; if the next wave grows index.html again,
  // move a band to its own page rather than raising this.
  'index.html': 54000
};

/* Per-directory defaults for everything else. */
const DIRS = {
  // 2026-11-10 (Wave 2): 300000 -> 305000. mmgr-app.js crossed the old cap by
  // 32 bytes with the status-chip action (setProjStatus) and the backup row
  // delegate. It is the next split candidate - the action map alone is a few
  // hundred lines - so this bump buys one wave, not a habit.
  js: 305000,
  css: 160000,
  src: 300000
};

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.wrangler',
  '_archive',
  'tmp',
  'vendor',
  'adittion to scope',
  'the last update towrads maintainance mode'
]);

const SIZE_UNITS = ['bytes', 'KB', 'MB'];
function human(n) {
  let v = n;
  let u = 0;
  while (v >= 1024 && u < SIZE_UNITS.length - 1) {
    v = v / 1024;
    u += 1;
  }
  return (u === 0 ? v : v.toFixed(1)) + ' ' + SIZE_UNITS[u];
}

const offenders = [];
const measured = [];

function capFor(rel) {
  if (EXACT[rel]) {
    return EXACT[rel];
  }
  const top = rel.split('/')[0];
  if (DIRS[top]) {
    return DIRS[top];
  }
  return 0;
}

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return;
  }
  for (const ent of entries) {
    const abs = path.join(dir, ent.name);
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name) && dir === ROOT) {
        continue;
      }
      if (SKIP_DIRS.has(rel)) {
        continue;
      }
      walk(abs);
      continue;
    }
    if (!/\.(js|css|html)$/.test(ent.name)) {
      continue;
    }
    const cap = capFor(rel);
    if (!cap) {
      continue;
    }
    const size = fs.statSync(abs).size;
    measured.push({ rel, size, cap });
    if (size > cap) {
      offenders.push({ rel, size, cap, over: size - cap });
    }
  }
}

walk(ROOT);

const failed = [];
const check = (name, ok, detail) => {
  if (!ok) {
    failed.push(name);
  }
  process.stdout.write(
    (ok ? 'PASS' : 'FAIL') +
      '  ' +
      name +
      (ok ? '' : '  <-- ' + JSON.stringify(detail === undefined ? null : detail))
  );
  process.stdout.write('\n');
};

process.stdout.write('=== FILE SIZES: ' + measured.length + ' files measured ===\n');
for (const rel of Object.keys(EXACT)) {
  const row = measured.find(m => m.rel === rel);
  check(
    rel + ' is at or under ' + human(EXACT[rel]),
    !!row && row.size <= EXACT[rel],
    row ? { size: human(row.size), cap: human(row.cap) } : 'file missing'
  );
}

const biggest = measured
  .slice()
  .sort((a, b) => b.size - a.size)
  .slice(0, 3);
process.stdout.write(
  '  largest: ' + biggest.map(b => b.rel + ' ' + human(b.size)).join(', ') + '\n'
);

check(
  'nothing outside the named files exceeds its directory cap',
  offenders.length === 0,
  offenders.slice(0, 10).map(o => o.rel + ' ' + human(o.size) + ' > ' + human(o.cap))
);

process.stdout.write('\n');
if (failed.length) {
  process.stdout.write('FILE SIZE GATE FAIL (' + failed.length + ')\n');
  process.exit(1);
}
process.stdout.write('FILE SIZE GATE PASS\n');
