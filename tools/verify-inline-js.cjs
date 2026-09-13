/* ============================================================
   VERIFY-INLINE-JS (T1 static gate, 2026-09-13)
   ------------------------------------------------------------
   Parses every inline <script> (no src attribute) on every
   served HTML page as real JavaScript.

   Guard for the 2026-09-13 launcher outage: .recent-card CSS
   rules were mis-pasted INTO app.html's inline script (commit
   b5ae4bb). One SyntaxError discarded the whole ~54KB script —
   cloudCodeOpen, DASH_ACTION_MAP, the click delegate and SW
   registration all vanished with zero console errors. No
   existing gate caught it: verify:csp only hashes bytes, and
   the bundles are built from js/ (not the inline blocks).

   Rule: every inline script must parse with new Function().
   Exits 1 with the page, block index, and V8 error message on
   any failure. Usage: node tools/verify-inline-js.cjs
   ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const fails = [];
let blocks = 0;

function extractInlineScripts(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue; // external script, not inline
    if (/\btype\s*=\s*["']?(application\/json|application\/ld\+json|text\/template)/i.test(attrs)) continue;
    out.push({ attrs: attrs.trim(), code: m[2] || '' });
  }
  return out;
}

const files = process.argv.slice(2);
const pages = files.length ? files : fs.readdirSync(ROOT)
  .filter(f => f.endsWith('.html'))
  .filter(f => !/^serve-icontest|^monolith/.test(f)); // archived scratch fixtures

for (const page of pages) {
  const p = path.join(ROOT, page);
  if (!fs.existsSync(p)) continue;
  const html = fs.readFileSync(p, 'utf8');
  const scripts = extractInlineScripts(html);
  scripts.forEach((s, i) => {
    blocks++;
    const head = (s.attrs ? '<' + s.attrs + '> ' : '') + s.code.trim().slice(0, 60).replace(/\s+/g, ' ');
    if (!s.code.trim()) return; // empty block is harmless
    try {
      // new Function parses WITHOUT executing — exactly what we want.
      new Function(s.code);
    } catch (e) {
      fails.push({ page, block: i, error: e.message, head });
    }
  });
}

if (fails.length) {
  console.log('[verify-inline-js] FAIL — ' + fails.length + ' unparsable inline script(s):');
  fails.forEach(f => console.log('  ' + f.page + ' block#' + f.block + ': ' + f.error + '\n    head: ' + f.head));
  process.exit(1);
}
console.log('[verify-inline-js] OK — ' + blocks + ' inline scripts across ' + pages.filter(f => fs.existsSync(path.join(ROOT, f))).length + ' pages all parse as JavaScript.');
