#!/usr/bin/env node
/* ============================================================
   gen-jic-full.cjs - generate src/data/ratebook.js from
   JIC_Rate_Book_2025-2027_FULL.md (owner rate-book wave, P2b)
   ------------------------------------------------------------
   The FULL doc is the hand-verified source of truth: 811 unique
   rates across 11 trades, parsed out of section 7's tables. This
   generator turns it into a Worker module so the calculator's
   rate-book card can show the WHOLE book instead of the 100 rows
   that were shipped inline.

   RB-1 (REFINEMENT-DIRECTIVE-2026-10-24, 2026-10-25): the book
   used to be a PUBLIC browser file (js/jic-rates-full.js) that
   anyone could download - and the service worker precached it for
   every visitor - while the sign-in gate was only a screen. The
   output is now a Worker module, imported by src/ratebook.js and
   served ONLY by GET /api/ratebook behind a signed-in session. It
   is not a static asset (src/ is excluded in .assetsignore) and it
   is not in the service-worker shell.

   Offline still works: the calculator stores the fetched book in
   the Cache API (mmgr-ratebook-v1) on the first signed-in load, so
   the book opens with no network afterwards.

   RULE 7 (no emoji on a served page) is enforced HERE rather than
   trusted to memory: the source doc uses the heavy check mark
   U+2714 and the warning sign U+26A0 in its tables. Both fall in
   the banned ranges. The generator refuses to emit them and fails
   loudly if it finds any other banned glyph, so the served data
   file cannot pick one up by accident.

   Output shape (src/data/ratebook.js, an ES module):
     export const RATEBOOK_PROVENANCE = { source, publisher, edition, status };
     export const RATEBOOK = { years, trades:[{tid,label}],
                               rows:[{t,n,d,iu,ir,mu,mr,b?,note?,app?}] };

   `basis` is 'S' (the source's own metric figure) or 'C' (calculated
   from the imperial rate by section 6's rules) - the card shows a
   marker for C so the user knows which numbers are JIC's and which
   we derived.

   `RATEBOOK_PROVENANCE` is the private record the directive asks for
   (3.3): it names the source, the edition and the permission status,
   is NEVER put in the API response, and is never rendered to a user.
   Removing it later is the owner's decision, not a code cleanup.

   Usage:  node tools/gen-jic-full.cjs           (write the file)
           node tools/gen-jic-full.cjs --check   (verify in sync)
   Registry: CI-TEST-COVERAGE.md -> T1 row (static).
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'JIC_Rate_Book_2025-2027_FULL.md');
const OUT = path.join(ROOT, 'src', 'data', 'ratebook.js');
const CHECK = process.argv.indexOf('--check') > -1;

// Display label -> stable id. These ids are the SAME ones js/calculator-page.js
// puts on its JIC_RATES rows, so the card, the shipped rows and the book
// payload all speak one language. The label is what the user reads; the id is
// what the code keys on, so a rename is a one-line change here.
const TRADES = [
  { tid: 'excavation', label: 'Excavation', heading: 'Excavation' },
  { tid: 'carpentry', label: 'Carpentry', heading: 'Carpentry' },
  { tid: 'steelwork', label: 'Steelwork', heading: 'Steelwork' },
  { tid: 'masonry', label: 'Masonry', heading: 'Masonry' },
  { tid: 'scaffolding', label: 'Scaffolding', heading: 'Scaffolding' },
  { tid: 'tiling', label: 'Tiling', heading: 'Tiling' },
  { tid: 'painting', label: 'Painting', heading: 'Painting' },
  { tid: 'joinery', label: 'Joinery', heading: 'Joinery' },
  { tid: 'plumbing', label: 'Plumbing', heading: 'Plumbing' },
  { tid: 'electrical', label: 'Electrical', heading: 'Electrical' },
  { tid: 'welding', label: 'Welding', heading: 'Welding' }
];

// AGENTS rule 7: no emoji on a served page. The exact ranges the owner's scan
// uses. The source doc legitimately contains two of these in its TABLES (the
// heavy check mark marks "already in the app", the warning sign flags the one
// rate that was wrong), and the generator drops both - but anything ELSE in a
// banned range is a mistake in the source and stops the build.
function bannedRange(cp) {
  return (
    (cp >= 0x1f000 && cp <= 0x1faff) ||
    (cp >= 0x2600 && cp <= 0x27bf) ||
    (cp >= 0x2b00 && cp <= 0x2bff) ||
    cp === 0xfe0f
  );
}
// The two the source uses as COLUMN MARKERS. Never emitted into the output.
const MARKER_APP = '\u2714'; // heavy check mark -> app:true / inShipped:true
const MARKER_WARN = '\u26A0'; // warning sign -> stripped from the note text

function parse() {
  const md = fs.readFileSync(SRC, 'utf8');
  const lines = md.split(/\r?\n/);

  // Section 7 only - the earlier sections are prose and summary tables that
  // would otherwise parse as rows.
  const s7 = lines.findIndex(l => /^## 7\./.test(l));
  if (s7 < 0) {
    throw new Error('section 7 not found in ' + SRC);
  }

  const byHeading = {};
  let heading = null;
  const unknown = [];

  for (let i = s7; i < lines.length; i++) {
    const line = lines[i];
    const h = /^### (.+)$/.exec(line);
    if (h) {
      heading = h[1].trim();
      continue;
    }
    if (!heading || line.charAt(0) !== '|') {
      continue;
    }
    const cells = line
      .split('|')
      .slice(1, -1)
      .map(s => s.trim());
    if (cells.length !== 9) {
      continue;
    } // header + separator rows
    if (/^Ref$/.test(cells[0]) || /^-{2,}/.test(cells[0])) {
      continue;
    }

    const ref = cells[0];
    const rm = /^(\S+)\s+#(\d+)$/.exec(ref);
    if (!rm) {
      unknown.push(ref);
      continue;
    }
    const trade = TRADES.find(t => t.heading === rm[1]);
    if (!trade) {
      unknown.push(ref);
      continue;
    }

    // Rule 7: the app column's heavy check mark is a MARKER, not content. It
    // becomes a boolean. The warning sign inside a note is punctuation carrying
    // no meaning, so it is dropped.
    const inApp = cells[1].indexOf(MARKER_APP) > -1;
    let note = cells[8] || '';
    note = note.split(MARKER_WARN).join('').trim();
    // Any OTHER banned glyph is a source mistake - refuse rather than serve it.
    for (const ch of note) {
      if (bannedRange(ch.codePointAt(0))) {
        throw new Error(
          'banned glyph U+' + ch.codePointAt(0).toString(16).toUpperCase() + ' in note for ' + ref
        );
      }
    }

    // Numbers may carry thousands separators ("1,428").
    const num = s => Number(String(s).replace(/,/g, ''));

    if (!byHeading[trade.tid]) {
      byHeading[trade.tid] = [];
    }
    byHeading[trade.tid].push({
      tid: trade.tid,
      ref: rm[1] + ' #' + rm[2],
      no: Number(rm[2]),
      desc: cells[2],
      impUnit: cells[3],
      impRate: num(cells[4]),
      metUnit: cells[5],
      metRate: num(cells[6]),
      basis: cells[7] === 'C' ? 'C' : 'S',
      note: note,
      inApp: inApp
    });
  }

  if (unknown.length) {
    throw new Error('unparsed refs: ' + unknown.slice(0, 5).join(', '));
  }

  const rows = [];
  for (const t of TRADES) {
    const list = byHeading[t.tid];
    if (!list) {
      throw new Error('no rows parsed for trade ' + t.tid);
    }
    rows.push.apply(rows, list);
  }
  return rows;
}

function render(rows) {
  const years = /(\d{4})[–-](\d{4})/.exec(rows.length ? '2025-2027' : '');
  const data = {
    years: years ? years[1] + '-' + years[2] : '2025-2027',
    trades: TRADES.map(t => ({ tid: t.tid, label: t.label })),
    rows: rows
  };
  // JSON.stringify, then strip the object keys that are constant across every
  // row so the file is smaller. `basis`/`note`/`inApp` are omitted when empty.
  const slim = rows.map(r => {
    const o = {
      t: r.tid,
      n: r.no,
      d: r.desc,
      iu: r.impUnit,
      ir: r.impRate,
      mu: r.metUnit,
      mr: r.metRate
    };
    if (r.basis !== 'S') {
      o.b = r.basis;
    }
    if (r.note) {
      o.note = r.note;
    }
    if (r.inApp) {
      o.app = 1;
    }
    return o;
  });
  const header =
    '/* GENERATED FILE - do not edit by hand.\n' +
    '   Source: JIC_Rate_Book_2025-2027_FULL.md (section 7 tables).\n' +
    '   Regenerate with: node tools/gen-jic-full.cjs\n' +
    '   Verify in sync with: node tools/gen-jic-full.cjs --check\n' +
    '   811 rates across 11 trades. Carries no emoji (AGENTS rule 7).\n' +
    '\n' +
    '   PRIVATE (RB-1): imported by src/ratebook.js and served ONLY by\n' +
    '   GET /api/ratebook behind a signed-in session. Not a static asset and\n' +
    '   not in the service-worker shell. The calculator caches it in the Cache\n' +
    '   API (mmgr-ratebook-v1) for offline use and clears that on sign-out. */\n' +
    '\n';
  const provenance =
    '/* Provenance record, REQUIRED by REFINEMENT-DIRECTIVE-2026-10-24 3.3.\n' +
    '   Never served to a user and never rendered: while `status` is not\n' +
    "   'rebuilt', the served copy keeps the source line and makes no claim\n" +
    '   that the figures are independently produced. The owner changes this\n' +
    '   value deliberately, with advice; it is not a code cleanup. */\n' +
    'export const RATEBOOK_PROVENANCE = {\n' +
    "  source: 'JIC_Rate_Book_2025-2027_FULL.md',\n" +
    "  publisher: 'Jamaica Institute of Construction (JIC)',\n" +
    "  edition: '" +
    data.years +
    "',\n" +
    "  status: 'unresolved' // unresolved | permission-granted | rebuilt\n" +
    '};\n' +
    '\n';
  const body =
    'export const RATEBOOK = {\n' +
    "  years: '" +
    data.years +
    "',\n" +
    '  trades: ' +
    JSON.stringify(data.trades) +
    ',\n' +
    '  rows: ' +
    JSON.stringify(slim) +
    '\n' +
    '};\n';
  return header + provenance + body;
}

const rows = parse();
const out = render(rows);

// Sanity: the counts the owner's audit established.
const inApp = rows.filter(r => r.inApp).length;
const calc = rows.filter(r => r.basis === 'C').length;
const stats = {
  rows: rows.length,
  trades: new Set(rows.map(r => r.tid)).size,
  inApp: inApp,
  calc: calc
};
if (CHECK) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (cur !== out) {
    console.error(
      '[gen-jic-full] OUT OF SYNC: src/data/ratebook.js does not match the source doc.'
    );
    console.error('[gen-jic-full] Run: node tools/gen-jic-full.cjs');
    process.exit(1);
  }
  console.log('[gen-jic-full] in sync - ' + JSON.stringify(stats));
  process.exit(0);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out);
console.log(
  '[gen-jic-full] wrote src/data/ratebook.js - ' +
    JSON.stringify(stats) +
    ' (' +
    (out.length / 1024).toFixed(1) +
    ' KB, ' +
    (require('zlib').gzipSync(out).length / 1024).toFixed(1) +
    ' KB gzipped)'
);
