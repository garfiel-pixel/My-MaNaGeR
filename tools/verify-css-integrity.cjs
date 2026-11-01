/* ============================================================
   My MaNaGeR — CSS integrity gate (build guard, 2026-09-22)
   ------------------------------------------------------------
   Catches the class of bug that silently killed live rules:

   ARM 1 - stray comment closer. A CSS comment whose prose contains the
   comment-END two-character sequence ends the comment right there. The
   rest of the prose is then parsed as CSS, and the browser drops the
   rule that follows it. This shipped: `.t-sm` (muted text tier) and
   `.btn.full` (full-width gate buttons) were dead in dist/mmgr.min.css
   because css/mmgr.css had two comments writing globs like `.stat*` and
   `mt*` glued to the next token with a slash. Detection: strip real
   comments, then any surviving comment-closer outside a comment is a
   stray. (Writing this very header tripped the gate - the guard earns
   its place.)

   ARM 0 — assembly drift. css/mmgr.css is GENERATED from the ordered
   css/src/*.css layers; a hand edit to the generated file (the easy mistake
   once a file is "just CSS") is caught as a byte mismatch.

   ARM 2 — rule dropped by the pipeline. Every single-class selector
   defined in css/src/*.css / css/marketing.css must still be present in
   the matching minified bundle, so a minifier/parse failure can never
   silently remove a rule again.

   The live-browser counterpart (no source class missing from the CSSOM)
   runs in tools/qa-health-sweep.cjs, which needs Chrome.

   Usage:  node tools/verify-css-integrity.cjs
   ============================================================ */
const fs = require('fs');

// E6.3 (2026-10-31): css/src/*.css are the authored source of the app
// stylesheet and css/mmgr.css is the assembled document pages link. Sorted
// filename order IS cascade order, so the numeric prefixes are load-bearing.
const APP_LAYERS = fs.existsSync('css/src')
  ? fs
      .readdirSync('css/src')
      .filter(f => f.endsWith('.css'))
      .sort()
      .map(f => 'css/src/' + f)
  : ['css/mmgr.css'];

const PAIRS = [
  { srcs: APP_LAYERS, dist: 'dist/mmgr.min.css' },
  { srcs: ['css/marketing.css'], dist: 'dist/marketing.min.css' }
];

let failed = 0;
const fail = msg => {
  console.log('  FAIL  ' + msg);
  failed++;
};
const pass = msg => console.log('  PASS  ' + msg);

function stripComments(text) {
  // Replace each real comment with spaces, preserving offsets so reported
  // line numbers still point at the original file.
  return text.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

console.log('\n=== CSS integrity: ARM 1 stray comment closers ===');

const HTML_PAGES = fs.readdirSync('.').filter(f => f.endsWith('.html'));
const targets = PAIRS.map(p => p.srcs)
  .flat()
  .concat(
    PAIRS.map(p => p.dist).filter(f => fs.existsSync(f)),
    HTML_PAGES.filter(f => {
      try {
        return /<style[\s>]/i.test(fs.readFileSync(f, 'utf8'));
      } catch (e) {
        return false;
      }
    })
  );

for (const file of targets) {
  const raw = fs.readFileSync(file, 'utf8');
  let text = raw;
  let offset = 0;
  // For HTML, only the <style> bodies are CSS - check those in place.
  let stray = 0;
  if (file.endsWith('.html')) {
    for (const m of raw.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
      const body = m[1];
      const base = m.index + m[0].indexOf(body);
      const stripped = stripComments(body);
      let i = -1;
      while ((i = stripped.indexOf('*/', i + 1)) > -1) {
        stray++;
        console.log('    ' + file + ':' + lineOf(raw, base + i) + ' (inside <style>)');
      }
    }
  } else {
    const stripped = stripComments(raw);
    let i = -1;
    while ((i = stripped.indexOf('*/', i + 1)) > -1) {
      stray++;
      console.log('    ' + file + ':' + lineOf(raw, i));
    }
  }
  if (stray) {
    fail(
      file +
        ': ' +
        stray +
        ' stray comment closer(s) - the prose after one is parsed as CSS and kills the next rule'
    );
  } else {
    pass(file + ': no stray comment closer');
  }
}

console.log('\n=== CSS integrity: ARM 0 the served stylesheet is the assembled layers ===');

if (!fs.existsSync('css/src')) {
  pass('no css/src layer directory - single-file stylesheet, nothing to assemble');
} else {
  const body = APP_LAYERS.map(f => fs.readFileSync(f, 'utf8')).join('');
  const served = fs.readFileSync('css/mmgr.css', 'utf8');
  const stripped = served.replace(/^\/\*[\s\S]*?\*\/\n\n/, '');
  if (stripped === body) {
    pass(
      'css/mmgr.css is byte-identical to ' +
        APP_LAYERS.length +
        ' layer(s): ' +
        APP_LAYERS.join(', ')
    );
  } else {
    fail(
      'css/mmgr.css differs from css/src/*.css - either it was hand-edited or the build is stale. Edit the layer, then run `node build.js --css`'
    );
  }
}

console.log('\n=== CSS integrity: ARM 2 rules dropped by the build ===');

for (const pair of PAIRS) {
  if (!fs.existsSync(pair.dist)) {
    fail(pair.dist + ' missing - run `npm run build` first');
    continue;
  }
  const srcCss = pair.srcs
    .map(f => fs.readFileSync(f, 'utf8'))
    .join('')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const dist = fs.readFileSync(pair.dist, 'utf8');
  const classes = new Set();
  for (const m of srcCss.matchAll(/([^{}]+)\{/g)) {
    for (const s of m[1].split(',')) {
      for (const c of s.trim().match(/\.([A-Za-z][A-Za-z0-9_-]*)/g) || []) {
        classes.add(c.slice(1));
      }
    }
  }
  // Collect the SELECTOR segments of the bundle (the text before each `{`),
  // so a class is matched wherever it sits in a selector (`.dark-mode` inside
  // `body.dark-mode`, a merged `.a,.b` list, or a descendant chain) while
  // declarations like `font-size:.72rem` are not mistaken for selectors.
  const segments = [];
  for (const m of dist.matchAll(/([^{}]*)\{/g)) {
    segments.push(m[1]);
  }
  const selectors = segments.join('\n');
  const missing = [];
  for (const c of classes) {
    if (!new RegExp('\\.' + c + '(?![A-Za-z0-9_-])').test(selectors)) {
      missing.push(c);
    }
  }
  if (missing.length) {
    fail(
      pair.srcs.join(' + ') +
        ': ' +
        missing.length +
        ' class rule(s) absent from ' +
        pair.dist +
        ' -> ' +
        missing.slice(0, 12).join(', ')
    );
  } else {
    pass(
      pair.srcs.join(' + ') +
        ': all ' +
        classes.size +
        ' class rules survive the build into ' +
        pair.dist
    );
  }
}

console.log('\n' + (failed ? 'CSS INTEGRITY FAIL (' + failed + ')' : 'CSS INTEGRITY PASS'));
process.exit(failed ? 1 : 0);
