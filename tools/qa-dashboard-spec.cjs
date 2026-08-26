/* ============================================================
   QA gate — DASHBOARD-UI-REFRESH-SPEC (app.html dark dashboard)
   Zero dependencies. Run:  node tools/qa-dashboard-spec.cjs
   (also wired as npm run qa:dashboard-spec)

   Asserts the spec's shipped surface without a browser:
     1. --db-* tokens + component rules exist in css/mmgr.css (dark-scoped)
     2. app.html markup: body.db-page, #db-sidebar, #db-nav-btn, #db-scrim,
        #db-metrics, #top, and every sidebar anchor target resolves
        (no dead links — skeptical-code-audit rule)
     3. Every icon <use href="#i-..."> introduced by the dashboard exists in
        the sprite (no invisible-glyph regressions)
     4. mmgr-portfolio.js exposes renderMetrics() and render() calls it
     5. WCAG 2.2 contrast on every recorded --db-* pair (Gate 4.1, 4.3)
     6. app.html inline-script CSP hashes match worker.js + serve.cjs
   ============================================================ */
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

const css = read('css/mmgr.css');
const appHtml = read('app.html');
const sprite = read('css/mmgr-icons.svg');
const portfolio = read('js/mmgr-portfolio.js');
const worker = read('worker.js');
const serve = read('serve.cjs');

let fails = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; console.log('  PASS  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('DASHBOARD-UI-REFRESH-SPEC gate');
console.log('--- 1. CSS tokens + component rules (dark-scoped) ---');
const tokens = ['--db-gold', '--db-gold-soft', '--db-jet-black', '--db-canvas',
  '--db-surface', '--db-surface-raised', '--db-accent', '--db-accent-soft',
  '--db-border', '--db-text-secondary'];
for (const t of tokens) check('token ' + t, css.includes(t + ':'), t);
for (const sel of ['body.dark-mode.db-page .db-side{', 'body.dark-mode.db-page .db-metrics{',
  'body.dark-mode.db-page .db-metric{', '.db-side,.db-hamb,.db-scrim,.db-metrics{display:none;}',
  'body.dark-mode.db-page .pcard,']) {
  check('rule ' + sel.slice(0, 45), css.includes(sel));
}
check('mobile drawer media query', css.includes('@media(max-width:768px)') && css.includes('.db-side{') && css.includes('translateX(-100%)'));
check('reduced-transparency fallback', css.includes('prefers-reduced-transparency') && css.includes('body.dark-mode.db-page .top'));
check('no-backdrop-filter fallback', css.includes('@supports not (backdrop-filter:blur(1px))') && css.includes('body.dark-mode.db-page .db-side'));
check('reduced-motion fallback', css.includes('prefers-reduced-motion') && css.includes('body.dark-mode.db-page .db-side'));

console.log('--- 2. app.html markup + wiring (no dead links) ---');
check('body class db-page', /<body class="db-page">/.test(appHtml));
check('#db-sidebar rail', appHtml.includes('id="db-sidebar"') && appHtml.includes('class="db-side"'));
check('#db-nav-btn hamburger', appHtml.includes('id="db-nav-btn"') && appHtml.includes('data-action="toggleSidebar"'));
check('#db-scrim', appHtml.includes('id="db-scrim"'));
check('#db-metrics container', appHtml.includes('id="db-metrics"'));
check('#top anchor exists', appHtml.includes('id="top"'));
check('#grid anchor exists', appHtml.includes('id="grid"'));
check('toggleSidebar in DASH_ACTION_MAP', /'toggleSidebar':\s*\(\)\s*=>\s*toggleSidebar\(\)/.test(appHtml));
check('toggleSidebar() defined', /function toggleSidebar\(\)/.test(appHtml));
check('aria-expanded sync', /syncSidebarAria/.test(appHtml));
check('Escape closes drawer', /Escape/.test(appHtml) && /side-open/.test(appHtml));
// every dashboard anchor target must resolve to a real element or page
const anchorTargets = [...appHtml.matchAll(/class="db-link" href="([^"]+)"/g)].map(m => m[1]);
for (const href of anchorTargets) {
  if (href.startsWith('#')) check('anchor #' + href.slice(1) + ' exists', appHtml.includes('id="' + href.slice(1) + '"'), href);
  else check('link ' + href + ' is a real page', fs.existsSync(path.join(ROOT, href)), href);
}
check('at least 3 sidebar links', anchorTargets.length >= 3);

console.log('--- 3. Icon refs in dashboard markup exist in sprite ---');
// grab the dashboard-specific block: everything between the DASHBOARD comment and <div class="wrap">
const dashBlock = appHtml.slice(appHtml.indexOf('DASHBOARD-UI-REFRESH-SPEC: dark-dashboard nav rail'), appHtml.indexOf('<div class="wrap">'));
const iconRefs = [...dashBlock.matchAll(/use href="css\/mmgr-icons\.svg#([^"]+)"/g)].map(m => m[1]);
for (const id of iconRefs) check('icon #' + id, new RegExp('id="' + id + '"').test(sprite), id);

console.log('--- 4. mmgr-portfolio.js renderMetrics ---');
check('renderMetrics() defined', /function renderMetrics\(\)/.test(portfolio));
check('render() calls renderMetrics', /function render\(\) {\s*renderMetrics\(\)/.test(portfolio));
check('renderMetrics in API', /renderMetrics: renderMetrics/.test(portfolio));
check('renderMetrics is a no-op (launcher metrics removed per UI plan)', /el\.innerHTML = '';/.test(portfolio));
check('render() still calls renderMetrics', /function render\(\) {\s*renderMetrics\(\)/.test(portfolio));

console.log('--- 5. WCAG 2.2 contrast on recorded pairs (Gate 4.1/4.3) ---');
function lum(hex) {
  const c = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
const pairs = [
  ['--db-gold on --db-canvas', 'E8923A', '0A0A0A'],
  ['--db-gold on --db-surface', 'E8923A', '121212'],
  ['--db-gold on --db-surface-raised', 'E8923A', '1A1A1A'],
  ['--db-text-secondary on --db-surface', '94a3b8', '121212'],
  ['--db-text-secondary on --db-surface-raised', '94a3b8', '1A1A1A'],
  ['--text on --db-surface', 'E8E0D8', '242019'],
  ['--db-gold on --db-jet-black', 'E8923A', '0A0A0A']
];
for (const [name, fg, bg] of pairs) {
  const r = ratio(fg, bg);
  check(name + ' ≥ 4.5:1 (' + r.toFixed(2) + ':1)', r >= 4.5, r.toFixed(2) + ':1');
}

console.log('--- 6. app.html CSP hashes match worker.js + serve.cjs ---');
const inlineScripts = [];
const re = /<script>([\s\S]*?)<\/script>/g;
let m;
while ((m = re.exec(appHtml)) !== null) inlineScripts.push('sha256-' + crypto.createHash('sha256').update(m[1]).digest('base64'));
for (const h of inlineScripts) {
  check('hash ' + h.slice(7, 20) + '… in worker.js', worker.includes("'" + h + "'"));
  check('hash ' + h.slice(7, 20) + '… in serve.cjs', serve.includes("'" + h + "'"));
}
check('app.html inline scripts are CSP-hashed', inlineScripts.length >= 2, inlineScripts.length + ' found');

console.log('---');
console.log((fails ? 'FAIL ' : 'PASS ') + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
