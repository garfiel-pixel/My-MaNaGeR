/* ============================================================
   T-1 GATE - the icon sprite contract (AUDIT-DIRECTIVE-2026-10-18,
   task T-1; the bug class is F1 in CONTINUATION-DIRECTIVE.md).

   F1: css/mmgr-icons.svg had no `i-pencil` and no `i-image`, yet both
   were referenced - admin.html's team "Edit" button and the photo
   placeholder in js/cloud/photos-ui.js. An unresolved `<use href>`
   renders an empty box and NO error anywhere: no console line, no
   failed request, no layout shift a QA pass would notice. F1 passed
   every gate we had because no gate compared references against the
   sprite's symbol list.

   THIS GATE closes the class, in three arms:

   ARM 0 - sprite integrity. The sprite must exist, define >= 60
   symbols, and define every id exactly ONCE (a duplicate resolves to
   the first definition and the second is shadowed dead weight -
   i-palette shipped twice on 2026-10-24).

   ARM 1 - literal references. Every `<path>.svg#<id>` reference in
   served html + js - single- or double-quoted inside a backtick, the
   template-literal case earlier waves missed - must name an existing
   file containing that symbol; a bare `#i-*` fragment must be in
   that file's own inline symbol set.

   ARM 2 - dynamic construction. Two helpers build the href at
   runtime: js/calc-ai.js' ico(name) (prefix '#i-', verified from the
   helper body) and js/mmgr-render.js' renderGroup(..., icon). Every
   call site is scanned with a quote-aware argument parser, so a ')'
   inside a string ('var(--danger)') or a ternary branch
   (kind === 'bad' ? 'alert-triangle' : 'info') cannot confuse it.
   Each icon argument must be a plain string literal or a ternary of
   string literals; anything else (a variable, an interpolation)
   FAILS loudly - the gate can only be sure about literals, and a
   silent skip is exactly how F1 hid.

   Scope: served files only. .assetsignore excludes tools/, tmp/ and
   qa-*.cjs from the upload; images/pages/*-source.html and the
   monolith snippet are design references never linked from nav (a
   follow-up owner cleanup can retire them). Raw #i-* grep hits in
   colors (#F59E0B), DOM ids (#ai-fab) and qa prose are not icon
   references and are out of scope by construction.

   Usage: node tools/verify-icons.cjs
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SPRITE = 'css/mmgr-icons.svg';

let failed = 0;
const fail = m => {
  console.log('  FAIL  ' + m);
  failed++;
};
const pass = m => console.log('  PASS  ' + m);

console.log('\n=== T-1 ICON SPRITE: every referenced symbol exists ===');

// ---- scope: served html + js (mirrors .assetsignore) -----------------------
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
    else if (/\.(html|js)$/.test(e.name)) out.push(p.replace(/\\/g, '/').replace(/^\.\//, ''));
  }
  return out;
}
const files = walk('.', []).filter(
  f => !f.startsWith('images/pages/') && f !== 'monolith html to reference from all features.html'
);

// ---- ARM 0: sprite integrity ------------------------------------------------
const spriteSymbols = new Set();
const dupSymbols = [];
if (!fs.existsSync(path.join(ROOT, SPRITE))) {
  fail(SPRITE + ' is missing - every use href points at nothing');
} else {
  const st = fs.readFileSync(path.join(ROOT, SPRITE), 'utf8');
  for (const m of st.matchAll(/<symbol[^>]*\bid="([^"]+)"/g)) {
    if (spriteSymbols.has(m[1])) dupSymbols.push(m[1]);
    spriteSymbols.add(m[1]);
  }
  if (spriteSymbols.size < 60) {
    fail(
      SPRITE +
        ' defines only ' +
        spriteSymbols.size +
        ' symbols (expected >= 60) - extraction or sprite drift'
    );
  } else {
    pass(SPRITE + ': ' + spriteSymbols.size + ' unique symbols');
  }
  if (dupSymbols.length) {
    fail(
      'duplicate symbol id(s) in ' +
        SPRITE +
        ': ' +
        dupSymbols.join(', ') +
        ' - browsers resolve to the first definition; the second is unresolvable dead weight'
    );
  } else {
    pass('no duplicate symbol ids');
  }
}

// Per-file inline symbol sets (bare '#i-*' fragments resolve here).
function symbolsOf(abs) {
  return new Set(
    [...fs.readFileSync(abs, 'utf8').matchAll(/<symbol[^>]*\bid="([^"]+)"/g)].map(m => m[1])
  );
}
const inlineSets = new Map(files.map(f => [f, symbolsOf(path.join(ROOT, f))]));

// The ONE gate-verified dynamic href builder: js/calc-ai.js's ico()
// helper. Any OTHER path#prefix literal awaiting concatenation is an
// F1-shaped construction this gate cannot read - fail it loudly rather
// than skip it (a silent skip is how F1 hid).
const ICO_FILE = 'js/calc-ai.js';
const ICO_DEF = 'function ico(name)';
const icoBody = (() => {
  const abs = path.join(ROOT, ICO_FILE);
  if (!fs.existsSync(abs)) return null;
  const src = fs.readFileSync(abs, 'utf8');
  const m = /function ico\([^)]*\)\s*\{[\s\S]{0,300}?\}/.exec(src);
  return m ? { from: m.index, to: m.index + m[0].length } : null;
})();

// ---- ARM 1: literal references ---------------------------------------------
console.log('--- literal references ---');
let refsChecked = 0;
const badPath = [];
const badId = [];
for (const f of files) {
  const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
  // path.svg#id inside '...', "..." or a backtick (either inner quote style).
  for (const m of t.matchAll(/["'`]([^"'`\s()]+\.svg)#([A-Za-z0-9_-]+)["'`]/g)) {
    const target = m[1];
    const id = m[2];
    // A fragment ending in '-' is a PREFIX awaiting runtime concatenation
    // (js/calc-ai.js' ico(): '#i-' + name). Allowed only inside that
    // verified helper; anywhere else it is unverifiable dynamic building.
    if (id.endsWith('-')) {
      if (f !== ICO_FILE || !icoBody || m.index < icoBody.from || m.index > icoBody.to) {
        badPath.push(
          f +
            ' @' +
            t.slice(0, m.index).split('\n').length +
            ': dynamic href prefix ("' +
            target +
            '#' +
            id +
            '") outside the gate-verified ico() helper - F1 cannot be checked here'
        );
      }
      continue;
    }
    refsChecked++;
    const abs = path.join(ROOT, target);
    if (!fs.existsSync(abs)) {
      badPath.push(f + ' -> ' + target + '#' + id + ' (file does not exist)');
      continue;
    }
    const defs = target === SPRITE ? spriteSymbols : symbolsOf(abs);
    if (!defs.has(id)) {
      badId.push(f + ' -> ' + target + '#' + id + ' (no such <symbol>)');
    }
  }
  // Bare '#i-*' fragments: must exist in this file's own inline symbols.
  for (const m of t.matchAll(/["'`](#[A-Za-z][A-Za-z0-9-]*)["'`]/g)) {
    const frag = m[1];
    if (!frag.startsWith('#i-')) continue;
    if (frag.endsWith('-')) {
      if (f !== ICO_FILE || !icoBody || m.index < icoBody.from || m.index > icoBody.to) {
        badPath.push(
          f +
            ' @' +
            t.slice(0, m.index).split('\n').length +
            ': dynamic href prefix ("' +
            frag +
            '") outside the gate-verified ico() helper - F1 cannot be checked here'
        );
      }
      continue;
    }
    refsChecked++;
    if (!(inlineSets.get(f) || new Set()).has(frag.slice(1))) {
      badId.push(
        f + ' -> ' + frag + ' (no inline <symbol> in this file, and it is not a .svg# path)'
      );
    }
  }
}
for (const b of badPath) fail('unresolvable path: ' + b);
for (const b of badId) fail('unresolved symbol: ' + b);
if (!badPath.length && !badId.length) {
  pass(refsChecked + ' literal references all resolve (' + files.length + ' served files scanned)');
}

// ---- ARM 2: dynamic helpers -------------------------------------------------
console.log('--- dynamic icon helpers ---');

// Quote-aware call extractor: returns [{line, args}] where args are the
// raw top-level argument texts. Strings are opaque, so a ')' inside
// 'var(--danger)' or a '[' in a data expression cannot cut a call short.
function extractCalls(src, fnName) {
  const calls = [];
  const re = new RegExp('\\b' + fnName + '\\s*\\(', 'g');
  let m;
  while ((m = re.exec(src)) !== null) {
    const before = src.slice(Math.max(0, m.index - 12), m.index);
    if (/function\s+$/.test(before)) continue; // the definition itself
    let i = m.index + m[0].length;
    let depth = 1;
    let quote = null;
    let cur = '';
    const args = [];
    const line = src.slice(0, m.index).split('\n').length;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (quote) {
        if (ch === '\\') {
          cur += ch + (src[i + 1] || '');
          i += 2;
          continue;
        }
        if (ch === quote) quote = null;
        cur += ch;
      } else if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
        cur += ch;
      } else if (ch === '(' || ch === '[' || ch === '{') {
        depth++;
        cur += ch;
      } else if (ch === ')' || ch === ']' || ch === '}') {
        depth--;
        if (depth === 0) break;
        cur += ch;
      } else if (ch === ',' && depth === 1) {
        args.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
      i++;
    }
    args.push(cur);
    calls.push({ line, args, index: m.index });
    re.lastIndex = i;
  }
  return calls;
}

// The quoted strings of an expression.
const quoted = s => [...s.matchAll(/(['"])([^'"]*)\1/g)].map(x => x[2]);

// A single quoted literal: 'text'
const isSingleLiteral = s => /^\s*['"][^'"]*['"]\s*$/.test(s);
// A ternary whose two branches are quoted literals and whose condition
// holds no code constructs we cannot read ($, parens, brackets, arrows).
const ternaryRe = /^(.+?)\s*\?\s*['"]([^'"]*)['"]\s*:\s*['"]([^'"]*)['"]$/;

// ico(name) in js/calc-ai.js - helper prefixes '#i-', body verified below.
{
  const rel = 'js/calc-ai.js';
  const t = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const body = /function ico\([^)]*\)\s*\{[\s\S]{0,300}?\}/.exec(t);
  if (!body) {
    fail(rel + ': ico() helper not found - pattern drifted, update verify-icons.cjs');
  } else if (!body[0].includes('#i-')) {
    fail(rel + ': ico() no longer prefixes "#i-" - update the prefix assumption in this gate');
  } else {
    const calls = extractCalls(t, 'ico');
    if (calls.length < 10) {
      fail(
        rel +
          ': only ' +
          calls.length +
          ' ico() call sites extracted (expected >= 10) - extractor drift'
      );
    }
    let ok = 0;
    for (const c of calls) {
      const arg = c.args[0] === undefined ? '' : c.args[0];
      let names = null;
      if (isSingleLiteral(arg)) {
        names = quoted(arg);
      } else {
        const tm = ternaryRe.exec(arg);
        // condition must be quote/parens/interpolation-free to be readable
        if (tm && !/[$()[\]{}]/.test(tm[1])) names = [tm[2], tm[3]];
      }
      if (!names) {
        fail(
          rel +
            ' @' +
            c.line +
            ': non-literal ico() argument (' +
            arg.trim().slice(0, 60) +
            ') - the gate can only verify literals; make the icon name a literal or extend verify-icons.cjs'
        );
        continue;
      }
      for (const n of names) {
        const id = 'i-' + n;
        if (!spriteSymbols.has(id)) {
          fail(
            rel + ' @' + c.line + ": ico('" + n + "') -> #" + id + ' has no <symbol> in ' + SPRITE
          );
        } else {
          ok++;
        }
      }
    }
    if (ok)
      pass(
        'ico() in ' +
          rel +
          ': ' +
          calls.length +
          ' call sites, ' +
          ok +
          ' literal icon names all exist'
      );
  }
}

// renderGroup(title, list, color, icon) in js/mmgr-render.js - 4th arg is
// the full symbol id, interpolated as ${icon}.
{
  const rel = 'js/mmgr-render.js';
  const t = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const calls = extractCalls(t, 'renderGroup');
  if (calls.length < 4) {
    fail(
      rel +
        ': only ' +
        calls.length +
        ' renderGroup() call sites extracted (expected >= 4) - extractor drift'
    );
  }
  let ok = 0;
  for (const c of calls) {
    if (c.args.length !== 4) {
      fail(
        rel +
          ' @' +
          c.line +
          ': renderGroup() has ' +
          c.args.length +
          ' args (expected 4) - extractor drift'
      );
      continue;
    }
    const icon = c.args[3].trim();
    if (!/^'i-[^']*'$|^"i-[^"]*"$/.test(icon)) {
      fail(
        rel +
          ' @' +
          c.line +
          ': non-literal renderGroup() icon (' +
          icon.slice(0, 60) +
          ') - the gate can only verify literals'
      );
      continue;
    }
    const id = icon.slice(1, -1);
    if (!spriteSymbols.has(id)) {
      fail(rel + ' @' + c.line + ': renderGroup icon #' + id + ' has no <symbol> in ' + SPRITE);
    } else {
      ok++;
    }
  }
  if (ok) pass('renderGroup() in ' + rel + ': ' + calls.length + ' call sites, all icons exist');
}

console.log(failed ? 'T-1 ICON SPRITE FAIL (' + failed + ')' : 'T-1 ICON SPRITE PASS');
process.exit(failed ? 1 : 0);
