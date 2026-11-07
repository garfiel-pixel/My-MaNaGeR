#!/usr/bin/env node
/* ============================================================
   tools/verify-assistant-wording.cjs - plain-words gate
   ------------------------------------------------------------
   FIELD-FINDINGS-DIRECTIVE-2026-10-28, G-6.

   The owner's rule: not everyone knows what "quantity" means, so a missing
   figure is EXPLAINED, never named bare. This gate proves the code can only
   speak the amended locked sentence 3:

     "I need one more number before that can price: <box>. That is <meaning>,
      for example <worked example>."

   Arms (static, no browser):
   1. every calcCheck() missing entry carries `meaning` and `example`;
   2. the page builds the sentence in ONE function, exported for the panel;
   3. calcPopulate and the panel both compose refusals through it, and the old
      bare phrasing is gone;
   4. the assistant prompt carries the amended sentence 3 and never says
      "your quantity or rate";
   5. the banned blame phrase appears nowhere in js/ or a served page;
   6. every WORK entry gets its meaning/example from the loader.

   The runtime proof (every shipped WORK key has both, and a real refusal
   carries both) lives in tools/qa-calc-assistant.cjs, G-6 arms.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok });
  console.log(
    (ok ? 'PASS' : 'FAIL') +
      '  ' +
      name +
      (ok ? '' : '  <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 400))
  );
};

/* Every `missing.push({ ... });` block, brace-matched, from one source file. */
function missingBlocks(src) {
  const blocks = [];
  const re = /missing\.push\(\{/g;
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length - 1; // at '{'
    let depth = 0;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') {
        depth--;
        if (depth === 0) {
          blocks.push(src.slice(m.index, i + 1));
          break;
        }
      }
    }
  }
  return blocks;
}

const calc = read('js/calculator-page.js');
const ai = read('js/calc-ai.js');

// 1. Every missing entry explains itself.
const blocks = missingBlocks(calc);
const bare = blocks.filter(b => !/\bmeaning\s*:/.test(b) || !/\bexample\s*:/.test(b));
check(
  'every calcCheck() missing entry carries a meaning and an example (' + blocks.length + ' blocks)',
  blocks.length > 0 && bare.length === 0,
  bare.map(b => b.replace(/\s+/g, ' ').slice(0, 160))
);

// 2. One sentence builder, exported for the panel.
check(
  'the page builds locked sentence 3 in one function',
  /function missingSentence\(m\)/.test(calc) &&
    calc.indexOf('I need one more number before that can price: ') > -1 &&
    calc.indexOf("'. That is '") > -1 &&
    calc.indexOf("', for example '") > -1,
  'missingSentence'
);
check(
  'the sentence builder is exported to the panel',
  /window\.MMGR_CALC_MISSING_SENTENCE = missingSentence;/.test(calc),
  'MMGR_CALC_MISSING_SENTENCE'
);

// 3. Both refusals go through it; the bare phrasing is gone.
check(
  'calcPopulate composes its refusal from the sentence builder',
  /chk\.missing\.map\(missingSentence\)/.test(calc),
  'calcPopulate'
);
check(
  'the panel composes its refusal from the page sentence builder',
  /MMGR_CALC_MISSING_SENTENCE/.test(ai) && /chk\.missing\.map\(sent\)/.test(ai),
  'calc-ai'
);
check(
  'the old bare refusal wording is gone',
  ai.indexOf('I cannot enter that yet') === -1 && calc.indexOf('I still need ') === -1,
  'old wording'
);

// 4. The prompt carries the amended sentence and drops the old phrase.
check(
  'the assistant prompt carries the amended locked sentence 3',
  ai.indexOf('I need one more number before that can price: ') > -1 &&
    ai.indexOf('your quantity or rate') === -1,
  'prompt'
);

// 5. The blame phrase is absent everywhere a user can read it. Harnesses may
// quote it (they assert it is GONE), so the scan is the shipped JS and the
// served pages, not tools/.
const BANNED = 'check the ' + 'quantities';
const offenders = [];
(function walk(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
    const full = path.join(dir, e.name);
    const rel = path.relative(ROOT, full).split(path.sep).join('/');
    if (/^(node_modules|dist|tmp|_archive|docs|\.git|\.agents|tools)$/.test(rel.split('/')[0])) {
      return;
    }
    if (e.isDirectory()) {
      walk(full);
    } else if (/\.(js|cjs|html)$/i.test(e.name)) {
      if (fs.readFileSync(full, 'utf8').indexOf(BANNED) > -1) {
        offenders.push(rel);
      }
    }
  });
})(ROOT);
check('no user-facing file tells the user to ' + BANNED, offenders.length === 0, offenders);

// 6. The loader gives every WORK entry both fields.
check(
  'every WORK entry is given a meaning and an example at load',
  /Object\.keys\(WORK\)\.forEach\(function \(k\) \{/.test(calc) &&
    /w\.meaning = hint\.meaning;/.test(calc) &&
    /w\.example = hint\.example;/.test(calc),
  'WORK loader'
);
check(
  'the quantity classifier covers area, volume, length and count',
  /key === 'm2'/.test(calc) &&
    /key === 'm3'/.test(calc) &&
    /key === 'm'/.test(calc) &&
    /how many there are/.test(calc),
  'workQuantityHint'
);

const failed = results.filter(r => !r.ok);
console.log('');
console.log(
  (failed.length ? 'FAIL' : 'PASS') +
    ' - ' +
    (results.length - failed.length) +
    '/' +
    results.length +
    ' gates'
);
process.exit(failed.length ? 1 : 0);
