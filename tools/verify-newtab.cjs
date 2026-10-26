#!/usr/bin/env node
/* ============================================================
   tools/verify-newtab.cjs - T-NEWTAB static half (APP-2)
   ------------------------------------------------------------
   REFINEMENT-DIRECTIVE-2026-10-24, APP-2: "seven tabs open for one session".

   Owner rule (question 9): the core app pages - dashboard (app.html), the
   admin panel, a project and the calculator - always navigate in the SAME tab.
   A new tab is only for an external site, a checkout, the field guide, a file,
   or a link the person deliberately middle-clicked.

   This gate scans the served HTML and every js/ module for the two ways a new
   tab happens (`target="_blank"` and `window.open(`) and refuses any occurrence
   that is not on the explicit allow-list in tools/newtab-allow.json.

   The allow-list is a CONTRACT, not a mute button: every entry must still
   match exactly one live occurrence. A stale entry fails the gate, so removing
   the feature that justified it means removing the entry in the same commit,
   and a NEW new-tab site can never slip in unnoticed.

   Usage:  node tools/verify-newtab.cjs
   Registry: docs/CI-TEST-COVERAGE.md -> CI row.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ALLOW_FILE = path.join(__dirname, 'newtab-allow.json');

// The pages the owner named, plus every other served page that could link one
// of them: a new-tab link from features.html to the app is the same defect.
const HTML = fs
  .readdirSync(ROOT)
  .filter(f => /\.html$/i.test(f))
  .sort();

const JS_DIRS = ['js', path.join('js', 'app'), 'src'];
const JS = [];
JS_DIRS.forEach(rel => {
  const dir = path.join(ROOT, rel);
  if (!fs.existsSync(dir)) {
    return;
  }
  fs.readdirSync(dir)
    .filter(f => /\.js$/i.test(f))
    .forEach(f => JS.push(path.join(rel, f).replace(/\\/g, '/')));
});

const PATTERNS = [
  { kind: 'target', re: /target\s*=\s*["']_blank["']/i },
  { kind: 'open', re: /window\.open\s*\(/ }
];

/* Blank out comments AND string bodies? No - strings must stay, because a
   window.open() inside a template string is still a call site. This masks only
   comments, with a real state machine: a `/*` that appears inside a quoted
   string (a CSS snippet, a regex-looking literal) must not start a comment and
   swallow the code below it. Line numbers are preserved. */
function maskComments(src) {
  let out = '';
  let i = 0;
  let state = 'code';
  let quote = '';
  let cls = false; // inside a regex character class
  let prevSig = ''; // last significant code character, for the regex test
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (state === 'code') {
      if (c === '/' && d === '*') {
        state = 'block';
        out += '  ';
        i += 2;
        continue;
      }
      if (c === '/' && d === '/') {
        state = 'line';
        out += '  ';
        i += 2;
        continue;
      }
      if (c === '/') {
        // A `/` right after an operator, a bracket or the start of the file
        // begins a REGEX literal, not a comment. Without this an apostrophe in
        // a regex (`/['"]/`) would look like the start of a string and the
        // scanner would lose every line after it.
        const reOk = prevSig === '' || /[(,=:[!&|?{};+\-*%~^<>]/.test(prevSig);
        if (reOk) {
          state = 'regex';
          cls = false;
          out += c;
          i++;
          continue;
        }
      }
      if (c === '"' || c === "'" || c === '`') {
        quote = c;
        state = 'str';
        out += c;
        i++;
        continue;
      }
      out += c;
      if (!/\s/.test(c)) {
        prevSig = c;
      }
      i++;
      continue;
    }
    if (state === 'block') {
      if (c === '*' && d === '/') {
        state = 'code';
        out += '  ';
        i += 2;
        continue;
      }
      out += c === '\n' ? '\n' : ' ';
      i++;
      continue;
    }
    if (state === 'line') {
      if (c === '\n') {
        state = 'code';
        out += '\n';
        i++;
        continue;
      }
      out += ' ';
      i++;
      continue;
    }
    if (state === 'regex') {
      if (c === '\\') {
        out += c + (src[i + 1] || '');
        i += 2;
        continue;
      }
      if (c === '[') {
        cls = true;
      } else if (c === ']') {
        cls = false;
      } else if (c === '/' && !cls) {
        state = 'code';
        out += c;
        prevSig = '/';
        i++;
        continue;
      } else if (c === '\n') {
        state = 'code';
        out += '\n';
        i++;
        continue;
      }
      out += c;
      i++;
      continue;
    }
    // inside a string
    if (c === '\\') {
      out += c + (src[i + 1] || '');
      i += 2;
      continue;
    }
    if (c === quote) {
      state = 'code';
      out += c;
      prevSig = c;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function scan(rel, text) {
  const hits = [];
  const stripped = maskComments(text);
  const lines = stripped.split(/\r?\n/);
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    PATTERNS.forEach(p => {
      if (p.re.test(line)) {
        hits.push({
          file: rel,
          line: i + 1,
          kind: p.kind,
          snippet: trimmed.slice(0, 400)
        });
      }
    });
  });
  return hits;
}

const allow = JSON.parse(fs.readFileSync(ALLOW_FILE, 'utf8')).allow || [];
const hits = [];
HTML.forEach(f => hits.push(...scan(f, fs.readFileSync(path.join(ROOT, f), 'utf8'))));
JS.forEach(f => hits.push(...scan(f, fs.readFileSync(path.join(ROOT, f), 'utf8'))));

const failures = [];
const usedCount = new Map();

hits.forEach(h => {
  const entry = allow.find(a => a.file === h.file && h.snippet.indexOf(a.contains) > -1);
  if (entry) {
    usedCount.set(entry, (usedCount.get(entry) || 0) + 1);
    return;
  }
  failures.push(
    'NEW TAB SITE  ' +
      h.file +
      ':' +
      h.line +
      '  ' +
      h.kind +
      '  ' +
      h.snippet +
      '   (add an entry to tools/newtab-allow.json with the reason, or navigate in the same tab)'
  );
});

allow.forEach(a => {
  if (!usedCount.get(a)) {
    failures.push(
      'STALE ALLOW   ' +
        a.file +
        '  "' +
        a.contains +
        '" no longer occurs - remove the entry (' +
        (a.reason || 'no reason recorded') +
        ')'
    );
  }
});

const core = ['app.html', 'admin.html', 'project.html', 'dashboard.html', 'calculator.html'];
const coreBad = hits.filter(h => core.indexOf(h.file) > -1 && h.kind === 'open');
coreBad.forEach(h => {
  const msg =
    'CORE PAGE OPEN  ' +
    h.file +
    ':' +
    h.line +
    ' calls window.open() - core pages navigate in the same tab';
  if (failures.indexOf(msg) === -1) {
    failures.push(msg);
  }
});

process.stdout.write(
  '=== NEW TAB GATE: ' +
    hits.length +
    ' new-tab site(s) in ' +
    (HTML.length + JS.length) +
    ' files\n'
);
allow.forEach(a => {
  process.stdout.write('  ALLOW  ' + a.file + '  ' + (a.reason || '') + '\n');
});
if (failures.length) {
  process.stdout.write('\n');
  failures.forEach(f => process.stdout.write('  FAIL  ' + f + '\n'));
  process.stdout.write('\nNEW TAB GATE FAIL (' + failures.length + ' problem(s))\n');
  process.exit(1);
}
process.stdout.write('\nNEW TAB GATE PASS\n');
