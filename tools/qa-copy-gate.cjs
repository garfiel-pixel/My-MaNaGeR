/* ============================================================
   qa-copy-gate.cjs — T-COPY gate (I-8, BUDGET-BOQ-MCP 2026-11-05)
   ------------------------------------------------------------
   Static checks (no browser) that the landing page copy obeys I-8:
     - every stated PANEL or MODULE count is sourced from the one
       constant (window.MMGR_PANEL_COUNT / MMGR_MODULE_COUNT) and the
       HTML carries a data-count span, never a hardcoded number in prose;
     - no "Request a demo" / sales-hungry CTA; only Get Started + View
       Field Guide CTAs;
     - the new "Why My MaNaGeR" / who-we-serve / four-solution-areas
       sections exist;
     - docs/UI-AUDIT-MAP-2026-11.md carries the claims table.
   Exit non-zero on any failure so CI stays red.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { stripComments } = require('./lib/html-strip.cjs');
const ROOT = path.resolve(__dirname, '..');

const results = [];
function check(name, val, detail) {
  results.push({ name, val });
  const mark = val ? 'PASS' : 'FAIL';
  process.stdout.write(
    '[copy-gate] ' + mark + '  ' + name + (val ? '' : '   <-- ' + JSON.stringify(detail)) + '\n'
  );
}

const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const marketingJs = fs.readFileSync(path.join(ROOT, 'js/marketing.js'), 'utf8');

// Stripping HTML comments removes the owner/directive prose (which names
// "15 panels" and "request a demo" only to forbid them) so the gate scans the
// VISIBLE page, not the instructions that govern it.
const visibleHtml = indexHtml.replace(/<!--[\s\S]*?-->/g, '');

// 1. The single source of truth is exported.
check(
  'T-COPY the panel/module count constant is defined and exposed',
  /window\.MMGR_PANEL_COUNT\s*=/.test(marketingJs) &&
    /window\.MMGR_MODULE_COUNT\s*=/.test(marketingJs),
  {
    hasPanel: /MMGR_PANEL_COUNT/.test(marketingJs),
    hasModule: /MMGR_MODULE_COUNT/.test(marketingJs)
  }
);

// 2. No hardcoded panel/module count in prose (only data-count spans allowed).
//    Find numeric counts near the words "panel" / "solution" outside data-count.
const proseCountHits = [];
const proseRe = /(\b\d{1,3}\b)\s*(panels?|solution areas?|modules?)/gi;
let m;
while ((m = proseRe.exec(visibleHtml))) {
  const before = visibleHtml.slice(Math.max(0, m.index - 40), m.index);
  if (!/data-count\s*=\s*["']/.test(before)) {
    proseCountHits.push(m[0]);
  }
}
check(
  'T-COPY no hardcoded panel/module count in prose (data-count only)',
  proseCountHits.length === 0,
  proseCountHits.slice(0, 5)
);

// 3. Every data-count="panels"/"modules" span exists and is filled by JS.
const dataCountOk = /data-count="panels"/.test(indexHtml) && /data-count="modules"/.test(indexHtml);
check('T-COPY landing carries data-count spans for panels and modules', dataCountOk, null);

// 4. No "Request a demo" or other banned sales CTAs.
const banned = [
  /request\s+a\s+demo/i,
  /book\s+a\s+demo/i,
  /sales\s+team/i,
  /talk\s+to\s+sales/i,
  /free\s+trial/i,
  /contact\s+sales/i
];
const bannedHits = banned.filter(r => {
  const mm = r.exec(visibleHtml);
  return mm ? mm[0] : null;
});
check('T-COPY no sales-hungry CTA on the landing page', bannedHits.length === 0, bannedHits);

// 5. The only CTAs present are Get Started / View Field Guide (and See all features).
const ctaTexts = (indexHtml.match(/<a [^>]*class="[^"]*btn[^"]*"[^>]*>([^<]+)</g) || []).map(s =>
  s
    .replace(/<a [^>]*>/, '')
    .replace(/<.*/, '')
    .trim()
);
const allowedCta = [
  /get\s+started/i,
  /view\s+field\s+guide/i,
  /see\s+all\s+features/i,
  /open\s+the\s+field\s+guide/i,
  /see\s+the\s+features/i,
  /open\s+the\s+app/i,
  /read\s+the\s+field\s+guide/i,
  /try\s+the\s+ai/i
];
const badCta = ctaTexts.filter(t => !allowedCta.some(r => r.test(t)));
check('T-COPY all button CTAs are within the allowed set', badCta.length === 0, badCta);

// 6. New I-8 sections exist.
check(
  'T-COPY "Why My MaNaGeR" section present',
  /id="why"/.test(indexHtml) && /Why My MaNaGeR/i.test(indexHtml),
  null
);
check('T-COPY who-we-serve copy present', /Who we serve/i.test(indexHtml), null);
check(
  'T-COPY four solution areas present',
  (indexHtml.match(/sol-card/g) || []).length === 4,
  (indexHtml.match(/sol-card/g) || []).length
);

// 7. Claims table lives in the audit map.
const auditMap = fs.readFileSync(path.join(ROOT, 'docs/UI-AUDIT-MAP-2026-11.md'), 'utf8');
check(
  'T-COPY claims table links each claim to a backing module',
  /Claims table/.test(auditMap) && /[Bb]acking module/.test(auditMap),
  null
);

// 8. T-04: every served page agrees with the one registry. A number in prose
//    ("18 panels", "Sheets 32") is how three pages drifted apart; only a
//    data-count span may state a count, and its value must equal FEATURES.
const SERVED_PAGES = [
  'index.html',
  'features.html',
  'about.html',
  'pricing.html',
  'mymanager-field-guide.html',
  'privacy.html',
  'terms.html',
  'refund.html',
  'reviews.html',
  'contact.html',
  'app.html',
  'project.html',
  'admin.html',
  'calculator.html'
];
const featuresMatch = marketingJs.match(/var FEATURES = \[([\s\S]*?)\];/);
const registryPanels = featuresMatch ? (featuresMatch[1].match(/panel:\s*true/g) || []).length : 0;
const registrySheets = Number((marketingJs.match(/var SHEET_COUNT\s*=\s*(\d+)/) || [])[1] || 0);
const hardcodedCounts = [];
const countMismatches = [];
for (const page of SERVED_PAGES) {
  const html = stripComments(fs.readFileSync(path.join(ROOT, page), 'utf8'));
  const re = /(\b\d{1,3}\b)\s*(panels?|sheets?)/gi;
  let mm;
  while ((mm = re.exec(html))) {
    const before = html.slice(Math.max(0, mm.index - 80), mm.index);
    if (!/data-count\s*=\s*["']/.test(before)) {
      hardcodedCounts.push(page + ': ' + mm[0]);
    }
  }
  const spans = html.matchAll(/data-count\s*=\s*["'](panels|sheets)["'][^>]*>\s*([^<]*)</gi);
  for (const s of spans) {
    const kind = s[1].toLowerCase();
    const val = parseInt(String(s[2]).trim(), 10);
    const want = kind === 'panels' ? registryPanels : registrySheets;
    if (val !== want) {
      countMismatches.push(page + ': ' + kind + '=' + val + ' want ' + want);
    }
  }
}
check(
  'T-COPY no hardcoded panel/sheet count on any served page',
  hardcodedCounts.length === 0,
  hardcodedCounts.slice(0, 5)
);
check(
  'T-COPY every data-count agrees with the registry',
  registryPanels > 0 && registrySheets > 0 && countMismatches.length === 0,
  { registryPanels, registrySheets, countMismatches: countMismatches.slice(0, 5) }
);

const passed = results.filter(r => r.val).length;
process.stdout.write('[copy-gate] RESULT ' + passed + '/' + results.length + '\n');
if (passed !== results.length) {
  process.exitCode = 1;
}
