/* ============================================================
   My MaNaGeR — [hidden]-attribute build guard (billing rail fix
   regression gate, 2026-08-15)
   ------------------------------------------------------------
   Catches the bug that made the "Upgrade to Premium" button
   stay visible for paid accounts: the `hidden` HTML attribute is
   only implemented by the UA stylesheet rule `[hidden]{display:
   none}`, and ANY author rule that sets a non-none `display` on
   the element (e.g. `.db-upgrade{display:flex}`) outranks it —
   so the element renders despite `hidden`. The fix pattern is a
   matching guard such as `.db-upgrade[hidden]{display:none}`.

   This gate scans every served *.html for elements carrying the
   `hidden` attribute, parses css/*.css plus the pages' inline
   <style> blocks, and fails the build if any such element is
   matched by a non-none `display` rule without a `[hidden]`
   guard that wins the cascade (specificity- and
   !important-aware).

   Scope note: only STATIC markup is checked. `hidden` set by JS
   on elements that only exist in JS-rendered strings is not
   visible to a static scan — the gate still catches the usual
   regression (new static markup + a display rule).

   Usage:  node tools/verify-hidden-attr.cjs
   Exit:   0 = every [hidden] element is truly hidden
           1 = at least one [hidden] element is painted anyway
   ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// ---- 1. Collect CSS text: css/*.css + inline <style> blocks ----
function collectCss() {
  const sources = []; // { src: 'css/mmgr.css', text: '...' }
  const cssDir = path.join(ROOT, 'css');
  if (fs.existsSync(cssDir)) {
    for (const f of fs.readdirSync(cssDir).sort()) {
      if (f.endsWith('.css')) {
        sources.push({ src: 'css/' + f, text: fs.readFileSync(path.join(cssDir, f), 'utf8') });
      }
    }
  }
  const htmlFiles = fs.readdirSync(ROOT).filter(f => /\.html$/i.test(f)).sort();
  for (const f of htmlFiles) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
    let m;
    while ((m = styleRe.exec(text)) !== null) {
      sources.push({ src: f + ' (<style>)', text: m[1] });
    }
  }
  return sources;
}

// ---- 2. Brace-matching CSS rule parser ----
// Strips comments, then walks the text. At-rules that WRAP plain rules
// (@media/@supports/@layer/@container/@scope) are recursed into; at-rules
// with non-selector blocks (@keyframes/@font-face/@page/@import/@charset)
// are skipped entirely. Returns [{ selector, body }].
function parseCss(text) {
  const rules = [];
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const len = stripped.length;

  function readBlock(startIdx) {
    // startIdx points AT the opening '{'. Returns { body, end } where end is
    // the index AFTER the matching '}'.
    let depth = 0;
    let inStr = null;
    for (let i = startIdx; i < len; i++) {
      const ch = stripped[i];
      if (inStr) {
        if (ch === inStr) inStr = null;
        continue;
      }
      if (ch === '"' || ch === "'") { inStr = ch; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return { body: stripped.slice(startIdx + 1, i), end: i + 1 };
      }
    }
    return { body: '', end: len };
  }

  function scan(from, limit, out) {
    // Inner scans must be bounded to their own block span: an unbounded scan
    // re-processes everything after the block (quadratic blowup).
    let i = from;
    while (i < limit) {
      const braceIdx = stripped.indexOf('{', i);
      if (braceIdx === -1 || braceIdx >= limit) break;
      const prelude = stripped.slice(i, braceIdx).trim();
      const { body, end } = readBlock(braceIdx);
      if (prelude.startsWith('@')) {
        const at = prelude.split(/\s+/)[0];
        if (at === '@media' || at === '@supports' || at === '@layer' || at === '@container' || at === '@scope') {
          scan(braceIdx + 1, end, out); // recurse into wrapping at-rules only
        }
        // keyframes/font-face/page/import/charset etc: skip
        i = end;
        continue;
      }
      if (prelude) out.push({ selector: prelude, body });
      i = end;
    }
  }
  scan(0, len, rules);
  return rules;
}

// ---- 3. Selector helpers ----
// Split a selector list on top-level commas (attribute values can hold commas).
function splitSelectors(selector) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (ch === '[' || ch === '(') depth++;
    else if (ch === ']' || ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  parts.push(cur.trim());
  return parts.filter(Boolean);
}

// The compound that directly styles the element: everything after the last
// combinator (space/>/+/~) or top-level comma.
function lastCompound(selector) {
  let depth = 0;
  for (let i = selector.length - 1; i >= 0; i--) {
    const ch = selector[i];
    if (ch === ']' || ch === ')') { depth++; continue; }
    if (ch === '[' || ch === '(') { depth--; continue; }
    if (depth === 0 && (ch === ' ' || ch === '>' || ch === '+' || ch === '~' || ch === ',')) {
      return selector.slice(i + 1).trim();
    }
  }
  return selector.trim();
}

function specificity(selector) {
  let a = 0, b = 0, c = 0;
  a += (selector.match(/#[\w-]+/g) || []).length;                                       // ids
  b += (selector.match(/\.[\w-]+/g) || []).length;                                      // classes
  b += (selector.match(/\[[^\]]+\]/g) || []).length;                                    // attributes ([hidden] counts)
  b += (selector.replace(/::[\w-]+/g, '').match(/:[-\w]+/g) || []).length;              // pseudo-classes, not ::pseudo-elements
  c += (selector.match(/(^|[\s>+~,(])([a-z][\w-]*)/g) || []).length;                    // type selectors
  return [a, b, c];
}

function compareSpec(s1, s2) {
  for (let i = 0; i < 3; i++) {
    if (s1[i] !== s2[i]) return s1[i] > s2[i] ? 1 : -1;
  }
  return 0;
}

function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Does the LAST compound of this selector match the element?
// Conservative by design, to avoid false positives from selectors whose
// ancestor context we cannot verify statically:
//   - id/class match: certain when the compound targets the element's own
//     id/class (the defect pattern is always class/id-driven, e.g.
//     `.db-upgrade { display:flex }` on `#rail-upgrade`).
//   - universal `*`: matches everything.
//   - bare-tag compounds (`div:last-child`, `img,svg`) are NOT matched —
//     they need ancestor/structure context a static scan cannot prove.
function canMatch(selector, el) {
  const comp = lastCompound(selector);
  if (comp === '*' || /\*/.test(comp.replace(/\[[^\]]*\]/g, ''))) return true;
  if (el.id && new RegExp('#' + esc(el.id) + '(?![\\w-])').test(comp)) return true;
  for (const c of el.classes) {
    if (new RegExp('\\.' + esc(c) + '(?![\\w-])').test(comp)) return true;
  }
  return false;
}

// ---- 4. HTML elements carrying the `hidden` ATTRIBUTE ----
// The `hidden` attribute must be an attribute NAME — `aria-hidden="true"`,
// `class="... hidden"` or `data-hidden` are NOT the hidden attribute and
// must not match.
function parseAttrs(attrText) {
  const attrs = {};
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(attrText)) !== null) {
    attrs[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : ''));
  }
  return attrs;
}

function findHiddenElements(htmlFile, text) {
  const els = [];
  const re = /<([a-z][\w-]*)\b([^<>]*)>/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const tag = m[1].toLowerCase();
    const attrs = parseAttrs(m[2] || '');
    if (!('hidden' in attrs)) continue;
    const id = attrs.id || null;
    const classes = (attrs.class || '').trim().split(/\s+/).filter(Boolean);
    els.push({ file: htmlFile, tag, id, classes, raw: '<' + tag + (id ? ' id="' + id + '"' : '') + (classes.length ? ' class="' + classes.join(' ') + '"' : '') + ' hidden>' });
  }
  return els;
}

// ---- 5. Main check ----
const cssSources = collectCss();
const allRules = [];
for (const s of cssSources) {
  for (const r of parseCss(s.text)) allRules.push({ selector: r.selector, body: r.body, src: s.src });
}

const DISPLAY_RE = /display\s*:\s*([^;{}]+)/g;
function displayVals(body) {
  const vals = [];
  let m;
  DISPLAY_RE.lastIndex = 0;
  while ((m = DISPLAY_RE.exec(body)) !== null) {
    const raw = (m[1] || '').trim();
    if (!raw) continue;
    const important = /!important\s*$/i.test(raw);
    const value = raw.replace(/!important\s*$/i, '').trim().toLowerCase();
    vals.push({ value, important });
  }
  return vals;
}

const findings = [];
const htmlFiles = fs.readdirSync(ROOT).filter(f => /\.html$/i.test(f)).sort();
for (const f of htmlFiles) {
  const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const el of findHiddenElements(f, text)) {
    const defeat = []; // non-none display rules matching el
    const guard = [];  // display:none rules matching el whose selector contains [hidden]
    for (const rule of allRules) {
      if (/:not\(/.test(rule.selector)) continue;             // :not() selectors: cannot statically prove they apply
      if (/::/.test(rule.selector)) continue;                 // ::pseudo-element rules never style the element itself
      const matchesEl = splitSelectors(rule.selector).some(sel => canMatch(sel, el));
      if (!matchesEl) continue;
      for (const v of displayVals(rule.body)) {
        const hasHidden = /\[hidden(?=[\s\]])/i.test(rule.selector);
        if (v.value === 'none') {
          if (hasHidden) guard.push({ selector: rule.selector, v, src: rule.src });
        } else if (v.value && !hasHidden) {
          defeat.push({ selector: rule.selector, v, src: rule.src });
        }
      }
    }

    if (!defeat.length) continue;
    const guardImportant = guard.some(g => g.v.important);
    const defeatImportant = defeat.some(d => d.v.important);
    const bestDefeatSpec = defeat.reduce(function (best, d) {
      const s = specificity(d.selector);
      return compareSpec(s, best) > 0 ? s : best;
    }, [0, 0, 0]);
    const bestGuardSpec = guard.reduce(function (best, g) {
      const s = specificity(g.selector);
      return compareSpec(s, best) > 0 ? s : best;
    }, [0, 0, 0]);
    const noWinningGuard =
      !guardImportant && (defeatImportant || !guard.length || compareSpec(bestGuardSpec, bestDefeatSpec) < 0);

    if (noWinningGuard) {
      const ruleDesc = defeat.map(d =>
        "'" + d.selector + " { display:" + d.v.value + (d.v.important ? ' !important' : '') + " }' (" + d.src + ')'
      ).join('; ');
      const fixSel = defeat.map(d => lastCompound(d.selector)).filter(function (v, i, a) { return a.indexOf(v) === i; });
      findings.push({ file: f, el: el.raw, rules: ruleDesc, fix: fixSel.map(s => s + '[hidden]{display:none;}').join('  ') });
    }
  }
}

if (findings.length) {
  console.error('[verify-hidden] FAIL: ' + findings.length + ' [hidden] element(s) would still be painted by the CSS:');
  for (const fn of findings) {
    console.error('  ' + fn.file + ' — ' + fn.el);
    console.error('    non-none display rule(s): ' + fn.rules);
    console.error('    fix: add a guard, e.g. ' + fn.fix);
  }
  console.error('[verify-hidden] The `hidden` attribute is only display:none via the UA stylesheet; any author display rule overrides it.');
  process.exit(1);
}

console.log('[verify-hidden] OK — every [hidden] element in ' + htmlFiles.length + ' page(s) is matched by no unguarded non-none display rule (' + allRules.length + ' CSS rules checked).');
process.exit(0);
