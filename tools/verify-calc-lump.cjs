/* ============================================================
   verify-calc-lump.cjs - T-LUMP gate (MAT-1, static)
   ------------------------------------------------------------
   REFINEMENT-DIRECTIVE-2026-10-24, MAT-1:

     "a script reads every WORK entry; a trade whose matDesc lists
      more than one component must have an ACCESSORIES entry OR an
      explicit accessoriesNone reason; the build fails on a bare
      lump."

   The calculator's WORK table is the money: 49 trades, each with a
   material rate that is ONE number. MAT-1 lets the user see into it
   (`ACCESSORIES[key].items`) or records, in writing, why that trade
   has nothing to itemise (`accessoriesNone`). This gate walks the
   shipped table straight out of js/calculator-page.js - no browser,
   no copy of the data - and fails if a trade with a multi-part
   material description is left as a bare lump.

   It also checks the shape of every line (id, name, unit, rule,
   waste, a US-dollar price, and a source note) and the calibration
   fields, because the T-ACC browser gate can only reconcile what is
   shaped correctly here.

   Usage:  node tools/verify-calc-lump.cjs
   Registry: docs/CI-TEST-COVERAGE.md -> CI row (T1 static battery).
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'js', 'calculator-page.js');
const log = s => process.stdout.write('[calc-lump] ' + s + '\n');
let failed = 0;
const fail = (name, detail) => {
  failed++;
  log('FAIL  ' + name + '  <-- ' + JSON.stringify(detail).slice(0, 600));
};
const pass = name => log('PASS  ' + name);

/* The block that follows `needle`, found by brace matching that SKIPS comments
   and string bodies - a `{` inside a material description ("Boards, studs") must
   not be mistaken for a brace, and a commented-out trade must not count. The
   slice comes back in RAW coordinates, so keys and descriptions are read from
   the real text (a quoted key like 'lining-out' is a key, not a blank). */
function block(src, needle) {
  const at = src.indexOf(needle);
  if (at < 0) {
    return '';
  }
  const open = src.indexOf('{', at);
  let depth = 0,
    i = open,
    line = false,
    blk = false,
    quote = '';
  for (; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    if (line) {
      if (c === '\n') {
        line = false;
      }
      continue;
    }
    if (blk) {
      if (c === '*' && n === '/') {
        blk = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (c === '\\') {
        i++;
      } else if (c === quote) {
        quote = '';
      }
      continue;
    }
    if (c === '/' && n === '/') {
      line = true;
      i++;
      continue;
    }
    if (c === '/' && n === '*') {
      blk = true;
      i++;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      continue;
    }
    if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) {
        return src.slice(open, i + 1);
      }
    }
  }
  return '';
}

const RAW = fs.readFileSync(FILE, 'utf8');
const WORK = block(RAW, 'const WORK = {');
const ACC = block(RAW, 'const ACCESSORIES = {');
if (!WORK || !ACC) {
  log('FAIL  could not find the WORK / ACCESSORIES tables in js/calculator-page.js');
  process.exit(1);
}
const KEY_RE = /^ {4}(?:'([A-Za-z][\w-]*)'|"([A-Za-z][\w-]*)"|([A-Za-z][\w-]*)): \{$/gm;
function entries(text) {
  const out = [];
  let m;
  KEY_RE.lastIndex = 0;
  while ((m = KEY_RE.exec(text))) {
    out.push({ key: m[1] || m[2] || m[3], at: m.index });
  }
  out.forEach((e, i) => {
    e.body = text.slice(e.at, i + 1 < out.length ? out[i + 1].at : text.length);
  });
  return out;
}
const workEntries = entries(WORK);
const accEntries = entries(ACC);
const accByKey = new Map(accEntries.map(e => [e.key, e]));
const workByKey = new Map(workEntries.map(e => [e.key, e]));

// The material description a WORK entry carries. Multi-part = a comma, a plus,
// or an "and" - i.e. the one rate is claiming to cover more than one thing.
function matDescOf(entry) {
  const m = /matDesc:\s*((?:'[^']*'|"[^"]*"|\s|\+)+)/.exec(entry.body);
  if (!m) {
    return '';
  }
  return m[1]
    .split('+')
    .map(s => s.trim().replace(/^'|'$/g, '').replace(/^"|"$/g, ''))
    .join('')
    .trim();
}

// ---- 1. every trade carries a decision -------------------------------------
const missing = workEntries.filter(e => !accByKey.has(e.key)).map(e => e.key);
if (missing.length) {
  fail('every WORK trade carries an ACCESSORIES entry or a written reason', missing);
} else {
  pass('every WORK trade carries an ACCESSORIES entry or a written reason');
}
const extra = accEntries.filter(e => !workEntries.some(w => w.key === e.key)).map(e => e.key);
if (extra.length) {
  fail('the ACCESSORIES table describes no trade that does not exist', extra);
} else {
  pass('the ACCESSORIES table describes only real trades');
}

// ---- 2. the shape of every entry -------------------------------------------
const badShape = [];
const badLines = [];
const bareLump = [];
const shortReason = [];
const multiPartNone = [];
let itemised = 0,
  noneCount = 0;
accEntries.forEach(e => {
  const hasItems = /items: \[/.test(e.body);
  const noneM = /accessoriesNone:\s*(?:'([^']*)'|"([^"]*)")/.exec(e.body);
  const noneReason = noneM ? noneM[1] || noneM[2] : '';
  // The DESCRIPTION lives on the trade, not on the accessory entry - the gate
  // reads what the trade claims its one rate covers.
  const desc = matDescOf(workByKey.get(e.key) || { body: '' });
  const multi = /,|\s\+\s|\sand\s/.test(desc);
  if (!hasItems && !noneReason) {
    badShape.push(e.key);
    return;
  }
  if (hasItems) {
    itemised++;
    if (!/refLump: [\d.]+/.test(e.body) || !/primaryShare: [\d.]+/.test(e.body)) {
      badShape.push(e.key + ' (no refLump/primaryShare)');
      return;
    }
    const share = Number(/primaryShare: ([\d.]+)/.exec(e.body)[1]);
    if (!(share > 0 && share < 1)) {
      badShape.push(e.key + ' (primaryShare out of range: ' + share + ')');
    }
    const itemBodies = e.body.split(/\n {8}\{\n/).slice(1);
    if (itemBodies.length < 1) {
      badLines.push(e.key + ' (items list is empty)');
      return;
    }
    const seen = new Set();
    // One reader for a single- or double-quoted field: the source is formatted
    // by Prettier, which keeps the quotes the author wrote, so both shapes are
    // real in this table.
    const pick = (re, b) => {
      const m = re.exec(b);
      return m
        ? m[1] !== undefined
          ? m[1]
          : m[2] !== undefined
            ? m[2]
            : m[3] !== undefined
              ? m[3]
              : null
        : null;
    };
    itemBodies.forEach(b => {
      const id = pick(/id: (?:'([^']*)'|"([^"]*)")/, b);
      const name = pick(/name: (?:'([^']*)'|"([^"]*)")/, b);
      const unit = pick(/unit: (?:'([^']*)'|"([^"]*)")/, b);
      const per = pick(/rule: \{ per: (?:'([^']*)'|"([^"]*)"), qty: ([\d.]+) \}/, b);
      const perQty = (() => {
        const m = /rule: \{ per: (?:'[^']*'|"[^"]*"), qty: ([\d.]+) \}/.exec(b);
        return m ? Number(m[1]) : null;
      })();
      const waste = pick(/waste: ([\d.]+)/, b);
      const usd = pick(/usd: ([\d.]+)/, b);
      const src = pick(/src: (?:'([^']*)'|"([^"]*)")/, b);
      if (
        id === null ||
        name === null ||
        unit === null ||
        per === null ||
        waste === null ||
        usd === null ||
        src === null
      ) {
        badLines.push(e.key + ' line: ' + b.replace(/\s+/g, ' ').slice(0, 90));
        return;
      }
      if (!['area', 'perimeter', 'piece', 'fixed'].includes(per)) {
        badLines.push(e.key + ' ' + id + ': unknown rule ' + per);
      }
      if (seen.has(id)) {
        badLines.push(e.key + ': duplicate line id ' + id);
      }
      seen.add(id);
      if (!(Number(usd) > 0) || !(perQty >= 0) || name.length < 3 || unit.length < 1) {
        badLines.push(e.key + ' ' + id + ': qty/price/name/unit out of range');
      }
      if (src.length < 8) {
        badLines.push(e.key + ' ' + id + ': the source note is missing');
      }
    });
  } else {
    noneCount++;
    const reason = noneReason.replace(/^['"]|['"],?$/g, '');
    if (reason.length < 20) {
      shortReason.push(e.key + ': ' + reason);
    }
    if (multi) {
      multiPartNone.push(e.key + ': ' + reason);
    }
    if (/items: \[/.test(e.body)) {
      badShape.push(e.key + ' (both an items list and a reason)');
    }
  }
  if (multiPartNone.some(x => x.startsWith(e.key + ':')) && !/items: \[/.test(e.body)) {
    bareLump.push(e.key);
  }
  // The gate's own teeth: a multi-part description with neither list nor reason
  // is what this harness exists to stop.
  if (multi && !hasItems && !noneReason) {
    bareLump.push(e.key);
  }
});

if (badShape.length) {
  fail('every entry is either an itemised list or a written reason, never both', badShape);
} else {
  pass('every entry is either an itemised list or a written reason, never both');
}
if (badLines.length) {
  fail(
    'every itemised line has an id, a name, a unit, a rule, waste, a price and a source',
    badLines
  );
} else {
  pass('every itemised line has an id, a name, a unit, a rule, waste, a price and a source');
}
if (shortReason.length) {
  fail('a written reason says something (20+ characters)', shortReason);
} else {
  pass('a written reason says something (20+ characters)');
}
// The headline rule. Every multi-part description must be answered - by a list
// (the user can see into it) or by a reason (the decision is recorded).
const unanswered = workEntries.filter(e => {
  const desc = matDescOf(e);
  if (!/,|\s\+\s|\sand\s/.test(desc)) {
    return false;
  }
  const acc = accByKey.get(e.key);
  return !acc || (!/items: \[/.test(acc.body) && !/accessoriesNone:\s*['"]/.test(acc.body));
});
if (unanswered.length) {
  fail(
    'T-LUMP: no trade with a multi-part material description is left as a bare lump',
    unanswered.map(e => e.key + ' "' + matDescOf(e) + '"')
  );
} else {
  pass('T-LUMP: no trade with a multi-part material description is left as a bare lump');
}

// ---- 3. the coverage the owner asked for -----------------------------------
if (itemised < 30) {
  fail('the table itemises the trades the owner named (30+ lists)', itemised);
} else {
  pass('the table itemises the trades the owner named (30+ lists)');
}
log(
  'coverage: ' +
    itemised +
    ' trades itemised, ' +
    noneCount +
    ' with a written reason, ' +
    workEntries.length +
    ' trades in total'
);
if (multiPartNone.length) {
  log(
    'multi-part descriptions answered with a reason (review these - each one is a ' +
      'deliberate "there is nothing to itemise here"):'
  );
  multiPartNone.forEach(x => log('  - ' + x));
}
const drywall = accByKey.get('drywall');
if (!drywall || /accessoriesNone/.test(drywall.body) || !/items: \[/.test(drywall.body)) {
  fail('the drywall question the owner asked is answered with a real list', 'drywall');
} else {
  pass('the drywall question the owner asked is answered with a real list');
}
const dwNames = drywall ? drywall.body : '';
['studs', 'compound', 'tape', 'screws'].forEach(id => {
  if (dwNames.indexOf("id: '" + id + "'") < 0 && dwNames.indexOf('id: "' + id + '"') < 0) {
    fail('drywall itemises ' + id + ' (the owner named it)', id);
  }
});

log('');
log('RESULT  ' + (failed ? failed + ' failed' : 'all checks passed'));
process.exit(failed ? 1 : 0);
