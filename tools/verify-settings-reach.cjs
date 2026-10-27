/* ============================================================
   My MaNaGeR - SW-14 permanent test: UNREACHABLE SETTINGS
   ------------------------------------------------------------
   The sweep detector (tools/sweep/sweep.cjs, SW-14) asked "settings
   stored in state but with no UI or AI path to set them" and reported
   ZERO hits. That zero was VACUOUS: it looked for a `settings: {` block
   in js/mmgr-state.js, that block does not exist, and the early return
   gave a clean report for a check that never ran.

   The real settings store the directive's AI-3 work owns is the
   calculator's SETTING_FIELDS allowlist (js/calculator-page.js) - the
   one table that decides which keys the form can set and which keys the
   assistant is allowed to send. This is the permanent version of that
   detector:

     1  SETTING_FIELDS parses and is non-empty          (drift guard)
     2  the assistant's system prompt names EXACTLY those keys
     3  the page publishes the same list to the panel
        (window.MMGR_CALC_SETTING_KEYS = Object.keys(SETTING_FIELDS))
     4  every key's type is one the applier actually handles
     5  every key reaches a real field (its id exists in the page or is
        rendered by the page's own JS)
     6  the composite keys (onCost, accessories) have their editors and
        their applier branches
     7  every id readState() saves from exists as a field - a key saved
        to state with no field behind it is exactly the unreachable
        setting this test exists to catch
     8  the project app's state file: if a `settings:` block ever
        appears, its keys must have a UI or AI path too (the original
        detector's rule, kept alive); if it never appears, that is said
        out loud instead of being silently skipped.

   Every extraction counts its own results: an empty extraction FAILS,
   never passes. A detector that cannot see the code must not report
   the code as clean.

   Usage:  node tools/verify-settings-reach.cjs
   ============================================================ */
const fs = require('fs');

let failed = 0;
const fail = m => {
  console.log('  FAIL  ' + m);
  failed++;
};
const pass = m => console.log('  PASS  ' + m);
const note = m => console.log('  NOTE  ' + m);

console.log('\n=== SW-14: every stored setting has a UI or an AI path ===');

const read = f => {
  if (!fs.existsSync(f)) {
    fail(f + ' is missing - nothing can be checked');
    return '';
  }
  return fs.readFileSync(f, 'utf8');
};

const page = read('js/calculator-page.js');
const ai = read('js/calc-ai.js');
const html = read('calculator.html');
const stateSrc = read('js/mmgr-state.js');

/* ---- a brace scanner that skips comments and string bodies ----------
   Used so a brace inside a label string or an explanatory comment can
   never end a block early (the same trap that killed .t-sm in CSS). */
function skipString(src, i) {
  const q = src[i];
  let exprDepth = 0;
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') {
      j++;
      continue;
    }
    if (q === '`' && c === '$' && src[j + 1] === '{') {
      exprDepth++;
      j++;
      continue;
    }
    if (q === '`' && exprDepth > 0) {
      if (c === '{') exprDepth++;
      else if (c === '}') exprDepth--;
      continue;
    }
    if (c === q && exprDepth === 0) return j;
  }
  return src.length - 1;
}

function blockFrom(src, marker) {
  const at = src.indexOf(marker);
  if (at < 0) return null;
  const start = src.indexOf('{', at);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      const e = src.indexOf('\n', i);
      if (e < 0) return null;
      i = e;
      continue;
    }
    if (c === '/' && n === '*') {
      const e = src.indexOf('*/', i + 2);
      if (e < 0) return null;
      i = e + 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      i = skipString(src, i);
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

// Top-level keys of an object literal: 4-space indent in this file's style.
function topLevelKeys(block) {
  const out = [];
  const re = /^ {4}([A-Za-z][A-Za-z0-9]*):/gm;
  let m;
  while ((m = re.exec(block))) out.push(m[1]);
  return out;
}

// A one-line map ("bool: 0, select: 1") has no indented keys at all, so it
// needs its own read - an empty result here would blind the type check.
function inlineKeys(block) {
  const out = [];
  const re = /([A-Za-z][A-Za-z0-9]*):\s*\d+/g;
  let m;
  while ((m = re.exec(block))) out.push(m[1]);
  return out;
}

/* Every top-level ENTRY of an object literal (not just its key): a line
   starting at 4 spaces with a letter begins an entry and runs to the next
   one, so a single-line entry like `labourOnly: { id: ... }` keeps its id. */
function entries(block) {
  const lines = block.split('\n');
  const starts = [];
  lines.forEach((ln, i) => {
    if (/^ {4}[A-Za-z]/.test(ln)) starts.push(i);
  });
  const map = {};
  starts.forEach((ln, idx) => {
    const key = /^ {4}([A-Za-z][A-Za-z0-9]*):/.exec(lines[ln])[1];
    const end = idx + 1 < starts.length ? starts[idx + 1] : lines.length;
    map[key] = lines.slice(ln, end).join('\n');
  });
  return map;
}

// id="x" appearing anywhere (the page itself or the JS that renders it).
function fieldExists(id) {
  return (
    html.indexOf('id="' + id + '"') > -1 ||
    page.indexOf('id="' + id + '"') > -1 ||
    page.indexOf("id='" + id + "'") > -1 ||
    page.indexOf('id=\\"' + id) > -1
  );
}

/* ---- 1. SETTING_FIELDS (the one allowlist) ------------------------- */
const settingsBlock = blockFrom(page, 'var SETTING_FIELDS = {');
if (settingsBlock === null) {
  fail('SETTING_FIELDS not found in js/calculator-page.js - extractor drift');
} else {
  const keys = topLevelKeys(settingsBlock);
  if (keys.length === 0) {
    fail('SETTING_FIELDS parsed but carried 0 keys - extractor drift');
  } else {
    pass('SETTING_FIELDS parses with ' + keys.length + ' settings keys');

    // Per-key shape: a type the applier handles, and a field to reach.
    const specOf = entries(settingsBlock);
    keys.forEach(k => {
      if (!Object.prototype.hasOwnProperty.call(specOf, k)) specOf[k] = '';
    });

    /* ---- 4. type is one the applier understands --------------------- */
    const orderBlock = blockFrom(page, 'var SETTING_ORDER = {') || '';
    const known = topLevelKeys(orderBlock).length
      ? topLevelKeys(orderBlock)
      : inlineKeys(orderBlock);
    if (!known.length) {
      fail('SETTING_ORDER could not be parsed - the type check would be blind');
    } else {
      const unknown = keys.filter(k => {
        const t = /type:\s*'([a-z]+)'/.exec(specOf[k] || '');
        return !t || known.indexOf(t[1]) === -1;
      });
      if (unknown.length) {
        fail(
          'keys whose type SETTING_ORDER does not rank (the applier would skip them): ' +
            unknown.join(', ')
        );
      } else {
        pass('every key has a type SETTING_ORDER ranks (' + known.join('/') + ')');
      }
    }

    /* ---- 5. every keyed field exists ------------------------------- */
    const withId = keys.filter(k => /id:\s*'([a-z0-9-]+)'/.test(specOf[k] || ''));
    const composite = keys.filter(k => !/id:\s*'/.test(specOf[k] || ''));
    const missing = withId.filter(k => {
      const id = /id:\s*'([a-z0-9-]+)'/.exec(specOf[k])[1];
      return !fieldExists(id);
    });
    if (withId.length === 0) {
      fail('no key declares a field id - extractor drift');
    } else if (missing.length) {
      fail('keys pointing at a field that does not exist: ' + missing.join(', '));
    } else {
      pass(withId.length + ' keys reach a real field id in the page');
    }

    /* ---- 6. composites have editors and applier branches ------------ */
    const needFns = { parts: 'function settingParts', acc: 'function settingAccessories' };
    const needBranch = { parts: "spec.type === 'parts'", acc: "spec.type === 'acc'" };
    composite.forEach(k => {
      const t = (/type:\s*'([a-z]+)'/.exec(specOf[k] || '') || [])[1];
      if (!t || !needFns[t]) {
        fail('composite key "' + k + '" has no known editor contract');
        return;
      }
      const okFn = page.indexOf(needFns[t]) > -1;
      const okBranch = page.indexOf(needBranch[t]) > -1;
      if (okFn && okBranch) {
        pass('composite "' + k + '" (' + t + ') has its editor and its applier branch');
      } else {
        fail(
          'composite "' +
            k +
            '" (' +
            t +
            '): editor ' +
            (okFn ? 'found' : 'MISSING') +
            ', applier branch ' +
            (okBranch ? 'found' : 'MISSING')
        );
      }
    });

    /* ---- 2. the assistant is told exactly these keys ---------------- */
    // The prompt is built by string concatenation, so the capture crosses
    // quote/newline/+ artifacts - strip those, stop at the sentence's dash,
    // and keep only real identifiers.
    const mPrompt = /settings keys this page accepts are ([^-]+)-/.exec(ai);
    if (!mPrompt) {
      fail('calc-ai.js no longer states the settings keys it accepts - extractor drift');
    } else {
      const promptKeys = mPrompt[1]
        .replace(/["'+\n\r]/g, ' ')
        .split(/[\s,]+/)
        .map(s => s.trim())
        .filter(s => /^[a-z][A-Za-z0-9]*$/.test(s));
      if (!promptKeys.length) {
        fail('the system prompt listed 0 keys - extractor drift');
      } else {
        const extra = promptKeys.filter(k => keys.indexOf(k) === -1);
        const absent = keys.filter(k => promptKeys.indexOf(k) === -1);
        if (extra.length || absent.length) {
          fail(
            'the prompt and the page disagree. Prompt names but the page does not: ' +
              (extra.join(', ') || 'none') +
              '. Page accepts but the prompt never names: ' +
              (absent.join(', ') || 'none')
          );
        } else {
          pass('the system prompt names exactly the ' + keys.length + ' keys the page accepts');
        }
      }
    }

    /* ---- 3. the page publishes the same list ------------------------ */
    if (page.indexOf('window.MMGR_CALC_SETTING_KEYS = Object.keys(SETTING_FIELDS)') > -1) {
      pass('the panel is given the same list (MMGR_CALC_SETTING_KEYS)');
    } else {
      fail('MMGR_CALC_SETTING_KEYS is no longer Object.keys(SETTING_FIELDS) - drift');
    }
  }
}

/* ---- 7. every id readState() saves has a field behind it ------------ */
const readStateBlock = blockFrom(page, 'function readState()');
if (readStateBlock === null) {
  fail('readState() not found in js/calculator-page.js - extractor drift');
} else {
  const ids = [];
  const re = /\$\(\s*'([a-z0-9-]+)'/g;
  let m;
  while ((m = re.exec(readStateBlock))) {
    if (ids.indexOf(m[1]) === -1) ids.push(m[1]);
  }
  if (ids.length < 10) {
    fail('readState() only yielded ' + ids.length + ' field ids - extractor drift');
  } else {
    const dead = ids.filter(id => !fieldExists(id));
    if (dead.length) {
      fail(
        'saved to state but no field can set them: ' + dead.join(', ') + ' - an unreachable setting'
      );
    } else {
      pass('all ' + ids.length + ' ids readState() saves exist as fields');
    }
  }
}

/* ---- 8. the project app's own settings block ------------------------ */
const appSettings = blockFrom(stateSrc, 'settings: {');
if (appSettings === null) {
  note(
    'js/mmgr-state.js carries no `settings` block - the project app keeps no ' +
      'settings object of that shape (its settings are fields on the state ' +
      'root, each with its own row). If one is ever added, this test reads it ' +
      'and applies the sweep rule: each key needs calc-<key>/set-<key> in a ' +
      'page or a quoted path in an AI module.'
  );
} else {
  const appKeys = topLevelKeys(appSettings);
  if (!appKeys.length) {
    fail('a `settings` block exists in mmgr-state.js but parsed 0 keys - drift');
  } else {
    const aiSrc = ai + page;
    const uiPages = ['project.html', 'app.html', 'admin.html', 'calculator.html']
      .map(f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''))
      .join('\n');
    const bad = appKeys.filter(k => {
      const inUi = uiPages.indexOf('calc-' + k) > -1 || uiPages.indexOf('set-' + k) > -1;
      const inAi = aiSrc.indexOf('"' + k + '"') > -1 || aiSrc.indexOf("'" + k + "'") > -1;
      return !inUi && !inAi;
    });
    if (bad.length) {
      fail('app settings with no UI or AI path: ' + bad.join(', '));
    } else {
      pass('all ' + appKeys.length + ' app settings keys have a UI or AI path');
    }
  }
}

console.log(
  failed ? 'SW-14 UNREACHABLE SETTINGS FAIL (' + failed + ')' : 'SW-14 UNREACHABLE SETTINGS PASS'
);
process.exit(failed ? 1 : 0);
