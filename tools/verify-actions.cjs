/* ============================================================
   T-2 GATE - the data-action contract (AUDIT-DIRECTIVE-2026-10-18,
   task T-2; the bug class is F2 in CONTINUATION-DIRECTIVE.md).

   F2: Project Photos' Cancel button carried data-action="photos-cancel"
   and NOTHING anywhere answered it. The click dispatchers only run
   actions present in their map and silently ignore the rest, so the
   button was dead from the day the panel shipped - and it survived
   three waves of QA because no gate ever compared the markup with the
   maps. A data-action attr with no answer is invisible by
   construction: no console error, no failed request, just a control
   that does nothing.

   THIS GATE closes the class. Per page, every data-action in static
   markup must be answered by one of that page's dispatchers, and
   every data-action emitted by js/ templates (or inline scripts) must
   be answered somewhere in the shipped client code:

     PAGES + their named maps (extracted by brace-block, quoted or
     bare keys):
       project.html  -> ACTION_MAP       (js/mmgr-app.js)
       app.html      -> DASH_ACTION_MAP  (app.html inline)
       admin.html    -> ADMIN_ACTION_MAP (admin.html inline)
       calculator    -> ACTIONS          (js/calculator-page.js)

   An action X counts as ANSWERED when any of:
     1. map      - X is a key of one of the four named maps;
     2. selector - some code looks it up with [data-action="X"]
                   (dedicated handlers like calcBookPick at
                   js/calculator-page.js:9841, consent.js' toggle);
     3. dispatch - the standalone literal "X" follows case / === /
                   !== / == / [ (local if-chain dispatchers like
                   resources.js' pool* rows).

   There is deliberately NO suppression list. The four attrs whose
   only "answer" was an element-id listener (T-4: photos-upload,
   photos-cancel, calcDocType, calcCashMode) were REMOVED from the
   markup on 2026-10-24 instead of being whitelisted here - the id
   listener does the work, the attr advertised nothing, and a
   suppression list is exactly the rot this gate exists to prevent.

   Scope (per the directive): static arm only - "the live click paths
   stay with qa-full". Comments are stripped before matching, so a
   prose mention (photos-ui.js' F2 history comment) can never answer
   an attr; that trade-off can only ever false-REJECT loudly, never
   false-accept.

   Usage: node tools/verify-actions.cjs
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const IDENT = '[A-Za-z][A-Za-z0-9-]*';
const PAGES = ['app.html', 'project.html', 'admin.html', 'calculator.html'];

const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// js/ sources, recursively (js/render/*, js/cloud/*, ...).
function jsFiles() {
  return fs
    .readdirSync(path.join(ROOT, 'js'), { recursive: true })
    .map(String)
    .filter(f => f.endsWith('.js'))
    .map(f => 'js/' + f);
}

// Prose cannot answer an action: strip block and line comments (the
// `[^:]` guard keeps URLs inside strings from eating the rest of a line).
const stripComments = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

// Top-level keys of a map literal, found by brace-depth from its declaration.
// Accepts bare (`showSec: el =>`), quoted (`'cloudSave': () =>`) and
// identifier (`calcCsv: downloadCsv`) value shapes at 2-4 space indent.
function mapKeys(rel, declRe) {
  const lines = read(rel).split('\n');
  const start = lines.findIndex(l => declRe.test(l));
  if (start < 0) {
    return { keys: new Set(), declared: false };
  }
  const keys = new Set();
  let depth = 0;
  let begun = false;
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') {
        depth++;
        begun = true;
      } else if (ch === '}') {
        depth--;
      }
    }
    if (i > start) {
      const m = lines[i].match(new RegExp("^\\s{2,4}'?(" + IDENT + ")'?:\\s*\\S"));
      if (m && depth >= 1) {
        keys.add(m[1]);
      }
    }
    if (begun && depth === 0) {
      break;
    }
  }
  return { keys, declared: true };
}

const MAPS = [
  {
    name: 'ACTION_MAP',
    where: 'js/mmgr-app.js',
    min: 300,
    max: 500,
    ...mapKeys('js/mmgr-app.js', /const ACTION_MAP = \{/)
  },
  {
    name: 'DASH_ACTION_MAP',
    where: 'app.html',
    min: 8,
    max: 40,
    ...mapKeys('app.html', /const DASH_ACTION_MAP = \{/)
  },
  {
    name: 'ADMIN_ACTION_MAP',
    where: 'admin.html',
    min: 40,
    max: 120,
    ...mapKeys('admin.html', /const ADMIN_ACTION_MAP = \{/)
  },
  {
    name: 'ACTIONS',
    where: 'js/calculator-page.js',
    min: 40,
    max: 100,
    ...mapKeys('js/calculator-page.js', /const ACTIONS = \{/)
  }
];

// ---- consumption sets -------------------------------------------------------

const selector = new Map(); // X -> files that look it up with [data-action="X"]
const dispatch = new Map(); // X -> files whose dispatch chain names the literal
for (const f of [...jsFiles(), ...PAGES]) {
  const t = stripComments(read(f));
  for (const m of t.matchAll(new RegExp('\\[data-action=["\'](' + IDENT + ')["\']\\]', 'g'))) {
    (selector.get(m[1]) || selector.set(m[1], []).get(m[1])).push(f);
  }
  for (const m of t.matchAll(
    new RegExp('(?:case\\s+|={2,3}\\s*|\\[)["\'](' + IDENT + ')["\']', 'g')
  )) {
    (dispatch.get(m[1]) || dispatch.set(m[1], []).get(m[1])).push(f);
  }
}

const union = new Set();
for (const m of MAPS) {
  for (const k of m.keys) {
    union.add(k);
  }
}

function accept(x) {
  if (union.has(x)) {
    return 'map';
  }
  if (selector.has(x)) {
    return 'selector';
  }
  if (dispatch.has(x)) {
    return 'dispatch';
  }
  return null;
}

// ---- gate -------------------------------------------------------------------

let failed = 0;
const fail = m => {
  console.log('  FAIL  ' + m);
  failed++;
};
const pass = m => console.log('  PASS  ' + m);

console.log('\n=== T-2 ACTION CONTRACT: every data-action has an answer ===');

// Extraction health: a drift in the map regexes must fail loudly rather
// than silently reshaping what the gate accepts.
for (const m of MAPS) {
  if (!m.declared) {
    fail(m.name + ' declaration not found in ' + m.where + ' - map extraction is broken');
  } else if (m.keys.size < m.min || m.keys.size > m.max) {
    fail(
      m.name +
        ' extracted ' +
        m.keys.size +
        ' keys, expected ' +
        m.min +
        '-' +
        m.max +
        ' - either the map grew/shrank for real (update the bound) or the extraction drifted'
    );
  } else {
    pass(m.name + ' (' + m.where + '): ' + m.keys.size + ' keys');
  }
}

// ARM 1 - static markup, per page. (Spec wording: "per page, every
// data-action must appear in that page's own map" - here: in its
// dispatcher's map, or answered by a dedicated handler.)
console.log('--- markup attrs per page ---');
for (const p of PAGES) {
  const markup = read(p).replace(/<script[\s\S]*?<\/script>/g, '');
  const attrs = [
    ...new Set(
      [...markup.matchAll(new RegExp('data-action=["\'](' + IDENT + ')["\']', 'g'))].map(m => m[1])
    )
  ];
  const bad = attrs.filter(v => !accept(v)).sort();
  if (bad.length) {
    for (const v of bad) {
      fail(
        p +
          ': data-action="' +
          v +
          '" has NO answer (not a map key, no [data-action] selector, no dispatch literal) - F2 class, this button does nothing'
      );
    }
  } else {
    pass(p + ': ' + attrs.length + ' markup actions all answered');
  }
}

// ARM 2 - what js/ templates and inline scripts EMIT. The bundles are a
// concatenation of js/ sources, so any module can render into any of the
// four pages; the union of the four maps is therefore the right yardstick.
console.log('--- generated attrs (js/ templates + inline scripts) ---');
const genBad = new Map();
for (const f of [...jsFiles(), ...PAGES]) {
  const src = read(f);
  // For html, only scan what is inside <script> blocks (markup attrs are
  // ARM 1's job); for js, scan the whole comment-stripped file.
  const zones = f.endsWith('.html')
    ? [...src.matchAll(/<script[\s\S]*?<\/script>/g)].map(m => m[0])
    : [stripComments(src)];
  for (const zone of zones) {
    for (const m of zone.matchAll(new RegExp('data-action=["\'](' + IDENT + ')["\']', 'g'))) {
      if (!accept(m[1])) {
        genBad.set(m[1], f);
      }
    }
  }
}
if (genBad.size) {
  for (const [v, f] of genBad) {
    fail(
      f + ': template emits data-action="' + v + '" with NO answer anywhere in js/ or the four maps'
    );
  }
} else {
  pass('every template-emitted action is answered');
}

const total = MAPS.reduce((n, m) => n + m.keys.size, 0);
console.log(
  '\naccepted universe: ' +
    total +
    ' map keys + ' +
    selector.size +
    ' selector-consumed + ' +
    dispatch.size +
    ' dispatch-literal actions'
);
console.log(failed ? 'T-2 ACTION CONTRACT FAIL (' + failed + ')' : 'T-2 ACTION CONTRACT PASS');
process.exit(failed ? 1 : 0);
