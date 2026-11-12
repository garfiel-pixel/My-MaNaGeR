/* ============================================================
   verify-navigation-anchors.cjs - T-05 anchor gate
   ------------------------------------------------------------
   Every static `href="#id"` on every served page must resolve to an
   element with that id on the SAME page, and every NAV_DD item id
   (js/marketing.js) must exist on its declared target page.

   This is the gate that would have caught the six dead nav links
   (`f-lookahead`, `f-health`, `f-gonogo`, `f-meetings`, `f-claims`,
   `f-registers`) that pointed at features.html blocks which did not
   exist before T-06.

   Static: node builtins only. Inline <script> blocks and HTML comments
   are stripped first so a JS template string cannot be mistaken for a
   real link.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const results = [];
function check(name, val, detail) {
  results.push({ name, val });
  console.log(
    (val ? 'PASS' : 'FAIL') +
      '  ' +
      name +
      (val ? '' : '   <-- ' + JSON.stringify(detail === undefined ? null : detail))
  );
}

const PAGES = [
  'index.html',
  'features.html',
  'about.html',
  'pricing.html',
  'mymanager-field-guide.html',
  'privacy.html',
  'terms.html',
  'refund.html',
  'reviews.html',
  'contact.html',
  'app.html',
  'project.html',
  'admin.html',
  'calculator.html'
];

function readVisible(page) {
  return fs
    .readFileSync(path.join(ROOT, page), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '');
}

function idsOf(html) {
  return new Set([...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)].map(m => m[1]));
}

// ---- 1. Same-page anchors ----
const broken = [];
const pageIds = {};
for (const page of PAGES) {
  const html = readVisible(page);
  const ids = idsOf(html);
  pageIds[page] = ids;
  const anchors = [...html.matchAll(/href\s*=\s*["']#([^"']+)["']/g)].map(m => m[1]);
  for (const a of anchors) {
    // Dynamic/JS fragments are not static links.
    if (!a || a.indexOf('$') > -1 || a.indexOf('{') > -1 || a.indexOf('?') === 0) {
      continue;
    }
    if (!ids.has(a)) {
      broken.push(page + ' -> #' + a);
    }
  }
}
check(
  'anchors: every static href="#id" resolves on its page',
  broken.length === 0,
  broken.slice(0, 12)
);

// ---- 2. NAV_DD items on their target page ----
function loadNav() {
  const src = fs.readFileSync(path.join(ROOT, 'js/marketing.js'), 'utf8');
  const start = src.indexOf('var FEATURES = [');
  const navStart = src.indexOf('var NAV_DD = {');
  if (start < 0 || navStart < 0) {
    throw new Error('FEATURES or NAV_DD not found');
  }
  const navEnd = src.indexOf('\n  };', navStart) + 5;
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(src.slice(start, navEnd), sandbox);
  return sandbox.NAV_DD;
}

let NAV_DD;
try {
  NAV_DD = loadNav();
} catch (e) {
  console.log('FAIL  could not evaluate NAV_DD: ' + e.message);
  process.exit(1);
}

const navBroken = [];
for (const key of Object.keys(NAV_DD)) {
  const hashAt = key.indexOf('#');
  const page = hashAt > -1 ? key.slice(0, hashAt) : key;
  const section = hashAt > -1 ? key.slice(hashAt + 1) : '';
  const ids = pageIds[page] || new Set();
  if (section && !ids.has(section)) {
    navBroken.push(key + ' -> section #' + section + ' missing on ' + page);
  }
  const groups = NAV_DD[key].groups || [];
  for (const g of groups) {
    for (const item of g.items || []) {
      if (!ids.has(item.id)) {
        navBroken.push(key + ' -> item #' + item.id + ' missing on ' + page);
      }
    }
  }
}
check(
  'anchors: every NAV_DD item exists on its target page',
  navBroken.length === 0,
  navBroken.slice(0, 12)
);

const passed = results.filter(r => r.val).length;
console.log('=== NAVIGATION ANCHORS: ' + passed + '/' + results.length + ' ===');
if (passed !== results.length) {
  process.exitCode = 1;
}
