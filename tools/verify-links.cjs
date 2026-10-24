/* ============================================================
   T-3 GATE - internal links (AUDIT-DIRECTIVE-2026-10-18, task T-3;
   the bug class is F3 in CONTINUATION-DIRECTIVE.md).

   F3: admin.html linked "See Company plan" to pricing.html#company,
   but pricing.html had no id="company" - the buyer silently landed
   at the top of the page. Every existing gate passed it: a dead
   anchor is not a 404, not a console error, not a layout regression.
   It is just a promise the page does not keep.

   THIS GATE closes the class:

   ARM 1 - files. Every relative href (html and js templates alike)
   must point at a file that exists, query string stripped.
   Absolute-path hrefs must exist too, except the Worker's own
   routes (/, /api/*, /auth/*, /cdn-cgi/*) which are not static
   files.

   ARM 2 - anchors. Every '#frag' (same page) and 'page.html#frag'
   (cross page) must resolve to an id= that exists STATICALLY in the
   target html. Static-only on purpose: a JS-created id would make
   the gate depend on runtime order it cannot see - and on today's
   tree every anchor already resolves statically, so requiring that
   costs nothing and catches markup renames at commit time.

   Out of scope (same rationale as T-1/T-2): external URLs,
   mailto:/tel:/javascript:/data:, src= attributes (the directive
   names href), and design-reference files excluded from the upload
   (images/pages/*-source.html, the monolith snippet).

   Usage: node tools/verify-links.cjs
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

let failed = 0;
const fail = m => {
  console.log('  FAIL  ' + m);
  failed++;
};
const pass = m => console.log('  PASS  ' + m);

console.log('\n=== T-3 INTERNAL LINKS: every href exists, every anchor resolves ===');

// ---- scope: served html + js (mirrors .assetsignore, as in T-1) ------------
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'tmp',
  'dist',
  'tools',
  'migrations',
  'planners',
  'dogfood-output',
  '_archive',
  '.wrangler'
]);
const SKIP_RE = /^(qa|verify|audit)-[a-z0-9-]+\.(cjs|mjs)$/;

function walk(d, out) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name) || SKIP_RE.test(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(html|js)$/.test(e.name)) out.push(p.replace(/\\/g, '/').replace(/^.\//, ''));
  }
  return out;
}
const files = walk('.', []).filter(
  f => !f.startsWith('images/pages/') && f !== 'monolith html to reference from all features.html'
);

// ---- static id sets per html page ------------------------------------------
const ids = new Map();
for (const f of files.filter(x => x.endsWith('.html'))) {
  const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
  ids.set(f, new Set([...t.matchAll(/\bid=["']([^"']+)["']/g)].map(m => m[1])));
}

const isExternal = h => /^(https?:)?\/\//.test(h) || /^(mailto:|tel:|javascript:|data:)/.test(h);
const WORKER_ROUTE = h => h === '/' || /^\/(api|auth|cdn-cgi)(\/|$)/.test(h);

// ---- gate -------------------------------------------------------------------
let hrefs = 0;
let anchors = 0;
const badFiles = [];
const badAnchors = [];

for (const f of files) {
  const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const m of t.matchAll(/href=["']([^"']+)["']/g)) {
    const raw = m[1].trim();
    if (!raw || isExternal(raw)) continue;
    const line = t.slice(0, m.index).split('\n').length;
    const where = f + ' @' + line;

    // same-page fragment
    if (raw.startsWith('#')) {
      const frag = raw.slice(1);
      if (!frag) continue;
      anchors++;
      const own = ids.get(f);
      // js files emit links on behalf of a page - accept a static id in
      // any served page, since the emitter cannot be attributed here.
      const hit = own ? own.has(frag) : [...ids.values()].some(s => s.has(frag));
      if (!hit) badAnchors.push(where + ' -> ' + raw + ' (no static id)');
      continue;
    }

    hrefs++;
    const [p, frag] = raw.split('#');
    const clean = p.split('?')[0];

    // absolute path: Worker route or a static file
    if (clean.startsWith('/')) {
      if (WORKER_ROUTE(clean)) continue;
      const rel = clean.slice(1);
      if (!fs.existsSync(path.join(ROOT, rel))) {
        badFiles.push(where + ' -> ' + raw + ' (no file at ' + rel + ')');
      } else if (frag && rel.endsWith('.html') && !(ids.get(rel) || new Set()).has(frag)) {
        badAnchors.push(where + ' -> ' + raw + ' (no static id in ' + rel + ')');
      }
      continue;
    }

    // relative file
    if (!fs.existsSync(path.join(ROOT, clean))) {
      badFiles.push(where + ' -> ' + raw + ' (file does not exist: ' + clean + ')');
      continue;
    }
    if (frag && clean.endsWith('.html')) {
      anchors++;
      if (!(ids.get(clean) || new Set()).has(frag)) {
        badAnchors.push(where + ' -> ' + raw + ' (no static id in ' + clean + ')');
      }
    }
  }
}

for (const b of badFiles) fail('dead file: ' + b);
for (const b of badAnchors) fail('dead anchor: ' + b);
if (!badFiles.length && !badAnchors.length) {
  pass(
    hrefs + ' path hrefs exist, ' + anchors + ' anchors resolve (' + files.length + ' served files)'
  );
}

// Extraction health: a regex drift that matches nothing must fail loudly.
if (hrefs < 100) {
  fail('only ' + hrefs + ' path hrefs extracted (expected >= 100) - extractor drift?');
}

console.log(failed ? 'T-3 INTERNAL LINKS FAIL (' + failed + ')' : 'T-3 INTERNAL LINKS PASS');
process.exit(failed ? 1 : 0);
