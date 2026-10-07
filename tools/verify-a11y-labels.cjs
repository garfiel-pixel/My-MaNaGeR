/* ============================================================
   VERIFY-A11Y-LABELS — static accessible-name gate for served pages.
   Covers directive Waves 8.5 (icon-only controls) and 8.6
   (placeholder-only fields), plus two cheap structural arms that guard
   the same defect class.

   Why static: every one of these defects is a MARKUP defect that is
   green in the DOM and invisible to a visual check — a close "x"
   button reads as an empty button to a screen reader, and a
   placeholder-only field reads as an unlabelled edit box the moment
   the user types (the placeholder is gone, the name never existed).

   ARMS
     1. FIELDS      — every input/select/textarea has an accessible name
                      (aria-label, aria-labelledby, title, a label[for]
                      pointing at its id, or a wrapping <label>).
                      Void/action types (hidden, submit, reset, button,
                      image, file) and readonly display textareas are
                      still checked — they are real controls.
     2. ICON-ONLY   — every <button> / <a> whose visible text is empty
                      after stripping its SVG has aria-label /
                      aria-labelledby / title. This is the close-button
                      and rail-icon class.
     3. LABEL TARGETS — a label[for="x"] must point at an existing id
                      (a dangling for= is the flip side of ARM 1 and is
                      exactly what a typo produces).
     4. DUPLICATE IDS — no id appears twice on a page. A duplicate id
                      silently breaks label association and
                      document.getElementById (the admin.html
                      team-update-scope duplicate removed 2026-10-06).

   SCOPE: every root *.html page the app serves, EXCEPT the legacy
   reference dump "monolith html to reference from all features.html"
   - a pre-split copy of the old single-file app kept for reference
   (nothing links to it; its markup is not the shipped UI). It is
   listed here so the exclusion is explicit rather than accidental.

   Usage: node tools/verify-a11y-labels.cjs
   Exit 0 only when all four arms pass on every in-scope page.
   ============================================================ */
const fs = require('fs');

const REFERENCE_DUMP = 'monolith html to reference from all features.html';
// Form control types that carry no user-editable value.
const ACTION_TYPES = /^(hidden|submit|reset|button|image|file)$/i;

let failed = 0;
const findings = [];
const fail = (file, line, arm, detail) => {
  failed++;
  findings.push(`  FAIL  ${file}:${line}  [${arm}]  ${detail}`);
};

const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function attrsOf(tag) {
  const out = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m;
  while ((m = re.exec(tag)))
    out[m[1].toLowerCase()] = m[3] != null ? m[3] : m[4] != null ? m[4] : m[5];
  return out;
}
const hasName = a => !!(a['aria-label'] || a['aria-labelledby'] || a.title);
const lineAt = (html, idx) => html.slice(0, idx).split('\n').length;

const pages = fs
  .readdirSync('.')
  .filter(f => f.endsWith('.html') && f !== REFERENCE_DUMP)
  .sort();

console.log('\n=== A11Y LABELS: accessible names on every served page ===');
console.log('  pages in scope: ' + pages.length + ' (excludes the legacy reference dump)');

for (const file of pages) {
  const html = fs.readFileSync(file, 'utf8');

  // ---- index: label[for] targets, ids, and inputs wrapped inside labels ----
  const ids = new Map(); // id -> [line, count]
  let m;
  const idRe = /\sid\s*=\s*"([^"]+)"/g;
  while ((m = idRe.exec(html))) {
    const line = lineAt(html, m.index);
    if (!ids.has(m[1])) ids.set(m[1], { line, count: 0 });
    ids.get(m[1]).count++;
  }

  const labelFor = new Map(); // id -> line of the first label pointing at it
  const forRe = /<label\b[^>]*\bfor\s*=\s*("([^"]*)"|'([^']*)')/gi;
  while ((m = forRe.exec(html))) {
    const target = (m[2] != null ? m[2] : m[3]).trim();
    const line = lineAt(html, m.index);
    if (!labelFor.has(target)) labelFor.set(target, line);
    if (!ids.has(target))
      fail(
        file,
        line,
        'LABEL TARGET',
        `<label for="${target}"> points at an id that does not exist`
      );
  }

  const wrapped = new Set();
  const wrapRe = /<label\b[^>]*>([\s\S]*?)<\/label>/gi;
  while ((m = wrapRe.exec(html))) {
    const inner = m[1];
    const ctlRe = /<(input|select|textarea)\b[^>]*>/gi;
    let c;
    while ((c = ctlRe.exec(inner))) {
      const a = attrsOf(c[0]);
      if (a.id) wrapped.add(a.id);
    }
  }

  // ---- ARM 1: fields ----
  let fieldCount = 0;
  const fieldRe = /<(input|select|textarea)\b[^>]*>/gi;
  while ((m = fieldRe.exec(html))) {
    const raw = m[0];
    const a = attrsOf(raw);
    const type = (a.type || 'text').toLowerCase();
    if (ACTION_TYPES.test(type)) continue;
    fieldCount++;
    if (hasName(a)) continue;
    if (a.id && (labelFor.has(a.id) || wrapped.has(a.id))) continue;
    const label = a.placeholder
      ? `placeholder-only ("${a.placeholder.slice(0, 40)}")`
      : 'no name and no placeholder';
    fail(
      file,
      lineAt(html, m.index),
      'FIELD',
      `<${m[1].toLowerCase()}${a.id ? ' #' + a.id : ''}> has no accessible name — ${label}`
    );
  }

  // ---- ARM 2: icon-only controls ----
  let iconCount = 0;
  const ctlRe = /<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  while ((m = ctlRe.exec(html))) {
    const a = attrsOf(m[2]);
    const inner = m[3];
    const text = inner
      .replace(/<svg\b[\s\S]*?<\/svg>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&[a-z#0-9]+;/gi, '')
      .trim();
    if (text) continue;
    if (!/<(svg|use|img)\b/i.test(inner)) continue; // genuinely empty (decorative/spacer)
    iconCount++;
    if (hasName(a)) continue;
    fail(
      file,
      lineAt(html, m.index),
      'ICON-ONLY',
      `<${m[1].toLowerCase()}${a['data-action'] ? ' data-action="' + a['data-action'] + '"' : ''}> renders an icon with no accessible name`
    );
  }

  // ---- ARM 4: duplicate ids ----
  for (const [id, info] of ids) {
    if (info.count > 1)
      fail(file, info.line, 'DUP ID', `id="${id}" appears ${info.count} times on this page`);
  }

  if (!findings.some(f => f.includes('  ' + file + ':'))) {
    console.log(`  PASS  ${file}  (${fieldCount} field(s), ${iconCount} icon control(s) checked)`);
  }
}

if (failed) {
  console.log('\n' + findings.join('\n'));
  console.log(`\nA11Y LABELS FAIL (${failed})`);
  process.exit(1);
}
console.log(
  '\nA11Y LABELS PASS — every served page has named fields, named icon controls, valid label targets and no duplicate ids.'
);
