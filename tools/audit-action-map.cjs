/* ============================================================
   Skeptical-code-audit check #2 — action-map completeness.
   Extracts every data-action="X" from the HTML pages and every
   ACTION_MAP key from js/mmgr-app.js, then reports:
     - markup actions with no ACTION_MAP entry (candidate bugs)
     - ACTION_MAP entries never used in markup (dead entries)
   A markup action is "covered" if it appears as an ACTION_MAP key
   literal OR anywhere else in mmgr-app.js (dynamic wiring).
   Usage: node tools/audit-action-map.cjs
   ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// project.html-scoped on purpose: app.html/admin.html/dashboard.html use
// different, non-action-map wiring.
const PAGES = ['project.html'];
const APP = path.join(ROOT, 'js/mmgr-app.js');

const app = fs.readFileSync(APP, 'utf8');

// Every data-action in markup.
const actions = new Set();
for (const page of PAGES) {
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  const re = /data-action="([A-Za-z0-9]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) actions.add(m[1]);
}

// Every ACTION_MAP key literal — capture the map object body between
// `const ACTION_MAP` (or `var ACTION_MAP`) and its closing `};`.
const mapBodyRe = /(?:const|var|let)\s+ACTION_MAP\s*=\s*\{([\s\S]*?)\n\s*\};/;
const mb = mapBodyRe.exec(app);
if (!mb) {
  console.error('ACTION_MAP object literal not found in mmgr-app.js');
  process.exit(1);
}
const mapBody = mb[1];
const mapKeys = new Set();
const keyRe = /'([A-Za-z0-9]+)'\s*:/g;
let k;
while ((k = keyRe.exec(mapBody)) !== null) mapKeys.add(k[1]);

// Markup actions not defined in the map AND not referenced anywhere else.
const missing = [...actions].filter(a => !mapKeys.has(a) && app.indexOf("'" + a + "'") === -1);
// Map keys never used in markup (informational — includes dynamic/legacy).
const unused = [...mapKeys].filter(a => !actions.has(a));

console.log('markup actions: ' + actions.size);
console.log('ACTION_MAP keys: ' + mapKeys.size);
console.log('--- MISSING (markup action with NO handler anywhere) ---');
console.log(missing.length ? JSON.stringify(missing, null, 0) : '(none)');
// Informational only — actions rendered dynamically by JS (delTask, aiPreset,
// cloudSignIn, vpAccept, …) legitimately never appear in static markup.
console.log('--- NOT STATICALLY REFERENCED (map key absent from project.html markup; includes JS-rendered actions) ---');
console.log(JSON.stringify(unused, null, 0));

process.exit(missing.length ? 1 : 0);
