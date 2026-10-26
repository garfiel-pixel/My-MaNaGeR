#!/usr/bin/env node
/* ============================================================
   tools/verify-ratebook-wording.cjs - rate book rebrand gate
   ------------------------------------------------------------
   REFINEMENT-DIRECTIVE-2026-10-24, section 3.2/3.3.

   The book is "My MaNaGeR Rate Book" on every user-facing surface, the count
   on the pricing page is the REAL number of rates in the data, the planning
   notice is one function's wording, and no page claims the figures are
   independently produced while the provenance status is not 'rebuilt'.

   Pure static: reads the files, no browser, no network.
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

(async () => {
  const calc = read('js/calculator-page.js');
  const pricing = read('pricing.html');
  const css = read('css/mmgr.css');

  // 1. The name exists in one constant and is used in the dialog.
  check(
    'the rate book name is one constant',
    /const RATEBOOK_NAME = 'My MaNaGeR Rate Book'/.test(calc),
    'RATEBOOK_NAME'
  );
  check(
    'the dialog header uses the name and the brand mark',
    /RATEBOOK_MARK[\s\S]{0,400}RATEBOOK_NAME/.test(calc) && /i-mpw/.test(calc),
    'header'
  );
  check(
    'the brand mark is sized 18px',
    /\.rr-mark\s*\{[^}]*width:\s*18px[^}]*height:\s*18px/.test(css),
    '.rr-mark'
  );

  // 2. The notice is ONE function with the directive's wording.
  check(
    'the planning notice is one function',
    /function rateBookNotice\(status\)/.test(calc),
    'rateBookNotice'
  );
  check(
    'the notice carries the directive sentence',
    calc.indexOf(
      'Starting rates for planning. Prices vary by site, supplier and date. Replace any rate with your own.'
    ) > -1,
    'notice text'
  );
  check(
    'the notice rides the priced result and the dialog footer',
    /calc-rate-notice/.test(calc) && /class="rr-notice"/.test(calc),
    'wiring'
  );

  // 3. Source line while the status is not rebuilt.
  const status =
    (read('src/data/ratebook.js').match(/status:\s*'([a-z-]+)'/) || [])[1] || 'unknown';
  check('the provenance status is known', status === 'unresolved' || status === 'rebuilt', status);
  if (status === 'rebuilt') {
    check(
      'rebuilt status removes the source line and drops the independence ban',
      /RATEBOOK_STATUS === 'rebuilt'[\s\S]{0,200}: ''/.test(calc),
      'source line'
    );
  } else {
    check(
      'the source line is present while the status is unresolved',
      calc.indexOf('Source data: ') > -1 && calc.indexOf('JIC Rate Book 2025-2027') > -1,
      'source line'
    );
    check(
      'no claim of independent production reaches a user surface',
      !/independent(ly)? (proprietary )?estimates/i.test(calc + pricing),
      'independence claim'
    );
  }

  // 4. The pricing page uses the name and the count is the real row count.
  check(
    'the pricing page names the book',
    pricing.indexOf('My MaNaGeR Rate Book') > -1,
    'pricing name'
  );
  const data = read('src/data/ratebook.js');
  const rowCount = (data.match(/"t"/g) || []).length;
  const claimed = (pricing.match(/My MaNaGeR Rate Book:\s*(\d+)\s*planning rates/) || [])[1];
  check(
    'the pricing rate count equals the rows in the data (' + rowCount + ')',
    String(claimed) === String(rowCount),
    { claimed, rowCount }
  );

  // 5. The old public name is gone from served copy.
  const served = ['calculator.html', 'pricing.html', 'mymanager-field-guide.html'];
  const leftovers = [];
  served.forEach(p => {
    const html = read(p);
    // "JIC" may survive as a row reference ("JIC #12") and in the provenance
    // line, but not as the product's name.
    const bad = html.match(/(JIC rate book|Jamaica rate book|JIC rates)/gi) || [];
    if (bad.length) {
      leftovers.push(p + ': ' + bad.join(', '));
    }
  });
  check('no served page calls the book by its old public name', leftovers.length === 0, leftovers);

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
})();
