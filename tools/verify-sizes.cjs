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
  // 2026-11-10 (Theme pack): raised 550000 -> 590000 for the eight launcher
  // skin stylesheets (css/src/86-theme-*.css) plus the Customize-modal CSS
  // (css/src/86-theme-modal.css) - ~31 KB of token + component skin rules
  // scoped to body.db-page[data-skin=...]. Skins are additive and isolated, so
  // the next wave should not need another raise.
  // 2026-11-12 (MCP branch gate-fix): raised 590000 -> 591000 for the obsidian
  // skin's own --gold-text token (3 lines) so gold-as-words is readable on the
  // near-black canvas and the T-GOLD gate passes (the light-page bronze is
  // unreadable there). Needed, not bloat; the delta is 83 bytes.
  // 2026-11-12 (T-14 search palette): raised 591000 -> 598000 for the new
  // css/src/36-search.css layer (overlay, combobox rows, group headings and
  // the reduced-motion search-hit outline, ~2.9 KB). One additive layer; the
  // next CSS wave should split a layer rather than raise this again.
  // 2026-11-12 (proposal review UI + drawer type): raised 598000 -> 604000
  // for the grouped review card (record name + field rows + affected-surface
  // chips) and the approval modal's surface line (~2.6 KB), plus the Controls
  // drawer's readable type scale and the non-wrapping tab bar (~1.4 KB). The
  // old 0.66rem flat diff grid and 10.9px hints were unreadable; this is the
  // replacement surface.
  // 2026-11-12 (UI-IA Phase 4): raised 604000 -> 607000 for the admin rail's
  // dropdown language (group rows, sub-rows, nested MCP menu, ~1.2 KB) and the
  // MCP card disclosure (summary, state chip, brand mark, ~1.6 KB). Both are
  // admin-only selectors; the next admin wave should split a layer first.
  // 2026-11-13 (size-gate fix): the 607000 cap was set ~1.9 KB below the real
  // committed size (608868 bytes) after the search-palette + proposal-UI +
  // UI-IA waves landed; the prior raises were estimated, not measured. Bump to
  // 612000 so the gate tracks the true file, leaving ~3 KB headroom.
  // 2026-11-19 (MCP proposal view + admin card): raised 612000 -> 616000. The
  // #11 grouped change-detail sheet (record cards, before/after rows, modal
  // chrome) and the #12 admin card gutter/row spacing added ~0.5 KB to the
  // built css/mmgr.css (612470 bytes measured). Both live in the isolated
  // css/src/37-mcp-admin.css layer already; this raise tracks the real file,
  // leaving ~3.5 KB headroom. The next CSS wave should split a layer first.
  // 2026-11-19 (chrome-truth): raised 616000 -> 620000. The drawer containment
  // + wide-viewport width, the mobile skeleton collapse and the skin bands add
  // 6.6 KB of built CSS (619109 bytes measured). ~1 KB headroom only: the next
  // CSS wave should SPLIT a layer rather than raise this again.
  // 2026-11-19 (ux A2): 620000 -> 624000 for the short-screen block - slim
  // headers, a 41px Estimate bar, dvh dialogs and safe-area insets
  // (623735 measured). One shared block, not per-page hacks.
  // 2026-11-19 (ux A4): 624000 -> 627000 for the coarse-pointer touch-target
  // block - one rule set, hit areas only, no layout (626087 measured).
  // 2026-11-19 (ux A5): 627000 -> 631000 for the sign-out confirm dialog
  // (overlay, card, three-button row, short-landscape and coarse-pointer
  // rules) in css/src/87-signin-polish.css (629248 measured).
  // 2026-11-19 (ux B2): 631000 -> 634000 for the eight chart-slot tokens and
  // their dark / departure / obsidian / guild re-points (632054 measured).
  // 2026-11-19 (ux B5): 637000 -> 640000 for the dashboard link styles (44px
  // rows, chevron, focus ring), the section anchors and the WBS view-filter
  // banner (638434 measured).
  // 2026-11-19 (ux B4): 634000 -> 637000 for the "What is driving completion"
  // list - row grid, dot, thin bar, points, empty line and the 520px
  // breakpoint, plus the hot-row wash that links it to the ring arcs
  // (635054 measured).
  // 2026-11-19 (ux B6): 640000 -> 642000 for the eight [data-major] token
  // rules and the three carry-through accents - WBS row marker, Gantt bar
  // stripe, Kanban card stripe (640329 measured).
  // 2026-11-19 (scrub-smart-time): 642000 -> 648000 for the 97-scrub-smart-time
  // layer - scrub affordance, active state, solid quick-value popover, chip
  // sizes, coarse-pointer and reduced-motion/transparency/perf fallbacks
  // (644376 measured).
  'css/mmgr.css': 648000,
  // 2026-11-10 (Wave 6): raised 160000 -> 163000 for the sign-in two-column
  // layout, the per-letter MMGRWP hover and the mobile stack.
  // 2026-11-10 (Wave L closeout): raised 163000 -> 166000 for the audience ring
  // continuous-loop transition (border/box-shadow/colour eased at 0.7s), the
  // softer band-seam glow and the reduced-motion cross-fade rules.
  // 2026-11-19 (ux A5): 166000 -> 169000. The marketing pages link their own
  // stylesheet, so the sign-out confirm dialog is a deliberate twin of the
  // app block (167637 measured) - identical rules, both files.
  // 2026-11-19 (ux C1+C2): 169000 -> 176000. C1 rewrote the six band seams as
  // two masked layers with their SVG data URIs (the wave and the stroke paths
  // live in the stylesheet, so the markup stays unchanged) and C2 added the
  // shared card-motion block plus the numeral/glyph corner fixes
  // (172805 measured).
  'css/marketing.css': 176000,
  // 2026-11-17 (rate book, user's own book): raised 600000 -> 610000. The
  // file readers were SPLIT OUT into js/book-import.js first (288 lines), so
  // this raise covers only what stayed: the per-line rate identity, the
  // uploaded-book picker group, the upload/remove actions and the workspace
  // section. The next calculator feature should split a render family rather
  // than raise this again.
  'js/calculator-page.js': 610000,
  // 2026-11-08 (C2 Task 2): raised 210000 -> 215000 for the intake panel,
  // nav group and idea sheet markup in project.html.
  // 2026-11-08 (C3 Phase 1): raised 215000 -> 220000 for the Documents view
  // switcher and the Pages view container (~0.6 KB).
  // 2026-11-10 (Wave 2): raised 220000 -> 226000 for the header status chip,
  // its four-item popover and the "Close snapshot" row in the backup popover
  // (~1.6 KB). The chip is the only new header control; the next markup wave
  // should move a panel out of this file rather than raise it again.
  // 2026-11-19 (data-truth): raised 226000 -> 227000 for the Risk panel's
  // "Discuss with AI" header button (~170 bytes, 226169 measured). Static
  // markup only; the risk table itself is rendered by js/render/risks.js.
  // 2026-11-19 (ux B5): 227000 -> 230000. The seven health counters became
  // links, the EVM tiles became links, four panels gained their #section
  // anchor and the WBS gained its view-filter bar (228995 measured).
  'project.html': 230000,
  'calculator.html': 80000,
  // 2026-11-10 (Theme pack): raised 140000 -> 143000 for the Customize modal
  // markup (themes grid, appearance/performance rows, account section) added to
  // app.html. The modal is static HTML only (~0.3 KB).
  // 2026-11-19 (surface-language): raised 143000 -> 146000 for the six rail
  // group dropdowns - each heading becomes a [data-rail-toggle] button with a
  // sprite caret and each group gains a .db-g-body wrapper (~2.5 KB of real
  // markup across six groups). Nothing new was added; the old headings were
  // plain <div> labels. The rail is now fully grouped, so the next wave should
  // not need to grow app.html for navigation again.
  'app.html': 146000,
  // 2026-11-10 (Wave L): raised 50000 -> 54000 for the "Who we are" band
  // (eyebrow, heading, lede, three identity cards with sprite icons), the
  // top-level Who we are nav item with its two-row dropdown, the two mobile
  // menu entries and the two footer links (~3.4 KB). The band is the only
  // new marketing section this year; if the next wave grows index.html again,
  // move a band to its own page rather than raising this.
  // 2026-11-19 (ux C3): 54000 -> 60000. The four role cards became buttons
  // with a detail area and a silhouette figure, and the figures are INLINE by
  // requirement - the fallback must render with no extra request, so it
  // cannot be an external SVG file (58365 measured). This is not a new band;
  // the "move a band" note above still stands for the next content growth.
  'index.html': 60000
};

/* Per-directory defaults for everything else. */
const DIRS = {
  // 2026-11-10 (Wave 2): 300000 -> 305000. mmgr-app.js crossed the old cap by
  // 32 bytes with the status-chip action (setProjStatus) and the backup row
  // delegate. It is the next split candidate - the action map alone is a few
  // hundred lines - so this bump buys one wave, not a habit.
  // 2026-11-12 (status menu placement): 305000 -> 307000 for the [popover]
  // anchoring helper (~1 KB). The menu opened at the viewport origin; this is
  // the fix, and the file remains the next split candidate.
  // 2026-11-19 (chrome-truth): 307000 -> 309000. The three skeleton wrappers
  // were reading export names the module does not have (`.html/.paint/
  // .sections` vs `skeletonHtml/skeletonPaint/skeletonSections`), so all
  // eleven templates were dead. Naming them correctly costs ~270 bytes
  // (307269 measured); the rest of the headroom is the comment that stops the
  // next reader re-breaking it. This file is STILL the split candidate.
  // 2026-11-19 (data-truth): 309000 -> 310000 for openDrwToBaseline (the
  // Dashboard baseline card's deep link, ~1.2 KB with its comment) and the
  // askAboutRisk action entry (309319 measured).
  // 2026-11-19 (ux A6/B4): 310000 -> 312000. A6 added aiRun/aiRunPreset to
  // the view-only safe list (the assistant answers without writing a project
  // record) and B4 added the majorShowAll view-state action; both are one
  // entry plus the comment that explains why they are safe (310028 measured).
  // This file is STILL the split candidate - the next wave should split it
  // rather than raise this again.
  // 2026-11-19 (ux B5): 312000 -> 315000. The one delegated [data-nav]
  // handler, the boot call that seeds the history entry, the clearWbsFilter
  // action and its export (312344 measured). Navigation is app-level wiring,
  // so it belongs here; the 3 KB headroom is deliberate - the next growth
  // should be the split, not another raise.
  js: 315000,
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
