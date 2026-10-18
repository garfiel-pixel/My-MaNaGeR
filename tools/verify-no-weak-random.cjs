#!/usr/bin/env node
/* ============================================================
   tools/verify-no-weak-random.cjs - T5 (AUDIT-DIRECTIVE-2026-10-18, rule N5)
   ------------------------------------------------------------
   "No Math.random() for anything a person could guess to gain access."

   The rule has zero exceptions on the server: NOTHING under src/ or worker.js
   may call Math.random - not for an access code, not for an id, not for a
   sampler. Everything there uses the CSPRNG (crypto.getRandomValues /
   crypto.randomUUID) or a PRNG seeded once from it.

   In js/ (browser-side) Math.random is allowed ONLY on a line that carries an
   explicit `// ok: non-secret` marker, so every use is a deliberate, reviewed
   choice rather than an accident. The marker list is printed on every run.

   Exit 0 = clean, 1 = a hit that has to be fixed.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SERVER_TREES = ['src']; // plus worker.js
const SERVER_FILES = ['worker.js'];
const OK_MARKER = 'ok: non-secret';

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      walk(p, out);
    } else if (p.endsWith('.js') || p.endsWith('.mjs')) {
      out.push(p);
    }
  }
  return out;
}

// Comments are prose ABOUT the rule, not a call to it: blank out block
// comments (keeping the line count so numbers stay true) and skip whole-line
// `//` comments before scanning.
function codeLines(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const withoutBlocks = raw.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
  return withoutBlocks.split(/\r?\n/).map(l => {
    const t = l.trim();
    if (t.startsWith('//') || t.startsWith('*')) return '';
    return l;
  });
}

function hitsIn(file, allowMarker) {
  const hits = [];
  codeLines(file).forEach((line, i) => {
    if (!line.includes('Math.random')) return;
    if (allowMarker && line.includes(OK_MARKER)) return;
    hits.push({ file: path.relative(ROOT, file), line: i + 1, text: line.trim() });
  });
  return hits;
}

const failures = [];
const markers = [];

for (const tree of SERVER_TREES) {
  const dir = path.join(ROOT, tree);
  if (!fs.existsSync(dir)) continue;
  for (const f of walk(dir, [])) {
    failures.push(...hitsIn(f, false));
  }
}
for (const rel of SERVER_FILES) {
  const p = path.join(ROOT, rel);
  if (fs.existsSync(p)) failures.push(...hitsIn(p, false));
}
const jsDir = path.join(ROOT, 'js');
if (fs.existsSync(jsDir)) {
  for (const f of walk(jsDir, [])) {
    const lines = codeLines(f);
    lines.forEach((line, i) => {
      if (!line.includes('Math.random')) return;
      const where = path.relative(ROOT, f) + ':' + (i + 1);
      if (line.includes(OK_MARKER)) markers.push(where);
      else failures.push({ file: path.relative(ROOT, f), line: i + 1, text: line.trim() });
    });
  }
}

console.log('[verify-no-weak-random] rule N5: no Math.random under src/ or worker.js');
console.log(
  '[verify-no-weak-random] js/ Math.random lines carrying the "' +
    OK_MARKER +
    '" marker: ' +
    markers.length
);
markers.forEach(m => console.log('    ok   ' + m));

if (failures.length) {
  console.error('\n[verify-no-weak-random] FAIL: ' + failures.length + ' hit(s):');
  failures.forEach(f => console.error('    ' + f.file + ':' + f.line + '  ' + f.text));
  console.error(
    '\nUse crypto.getRandomValues()/crypto.randomUUID() (an id suffix can use ' +
      'randomIdSuffix() in src/lib/http.js), or, if the value genuinely cannot ' +
      'grant access, mark the js/ line with: // ' +
      OK_MARKER
  );
  process.exit(1);
}
console.log('[verify-no-weak-random] PASS: no unmarked weak-random use\n');
