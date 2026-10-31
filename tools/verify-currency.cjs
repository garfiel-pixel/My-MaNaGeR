#!/usr/bin/env node
/* ============================================================
   tools/verify-currency.cjs - T3 (AUDIT-DIRECTIVE-2026-10-18, rule N3)
   ------------------------------------------------------------
   "A model rate is never shown or charged in a currency it was not written in."

   The defect (C2): WORK.blockwall.rate = { mat: 22, lab: 28 } is a US-dollar
   planning model. With JMD selected and no exchange rate the prefill correctly
   left the rate fields empty, but the engine then silently fell back to the raw
   model and charged USD 22 as J$22 - a 32.7x gap between two quotes for the
   same job on the owner's desk.

   Gates:
     C2a JMD, no exchange rate, empty rate fields, split basis -> the engine
         returns the plain error and NEVER a total
     C2b USD currency still prices the model exactly as before
         (10 m2 x (22 + 28) = 500 before on-costs)
     C2c no variant label anywhere in the shipped source claims a book row beside a
         rate that is not the book's (the label-lies defect)
     C2d JMD WITH an exchange rate converts and flags nothing
     C2e the rate comparison reports the three candidate rates per unit and the
         sanity rule fires above 3x (free function, no DOM)

   Exit 0 = currency honesty holds, 1 = it does not.
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8765;
const BASE = 'http://127.0.0.1:' + PORT;
const delay = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const log = s => process.stdout.write('[verify-currency] ' + s + '\n');
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  log((ok ? 'PASS' : 'FAIL') + '  ' + name + (ok ? '' : '   <-- ' + JSON.stringify(detail)));
}
const close = (a, b, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));

async function ensureServer() {
  try {
    const h = await fetch(BASE + '/calculator.html');
    if (h.ok) return null;
  } catch (e) {
    /* not up */
  }
  log('serve.cjs not answering - starting one for this run');
  const srv = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 30; i++) {
    await delay(1000);
    try {
      const h = await fetch(BASE + '/calculator.html');
      if (h.ok) return srv;
    } catch (e) {
      /* keep waiting */
    }
  }
  throw new Error('serve.cjs did not come up');
}

(async function main() {
  const srv = await ensureServer();
  const { chromium } = require('playwright');
  const browser = await chromium.launch({
    headless: true,
    executablePath: require('./chrome-launcher.cjs').chromePath,
    args: ['--disk-cache-size=0', '--no-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  try {
    await page.goto(BASE + '/calculator.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('window.__calcEngine && window.__calcEngine.computeFor', null, {
      timeout: 20000
    });

    const base = {
      work: 'blockwall',
      d1: '5',
      d2: '2',
      d3: '',
      wastePct: '0',
      openings: '[]',
      instances: '[]',
      measuredAuto: '',
      rateMat: '',
      rateLab: '',
      allInRate: '',
      basis: 'measured',
      country: 'JM',
      taxOverride: '',
      variant: '',
      piecePrice: '',
      pieceSize: '',
      currency: 'JMD',
      units: 'metric'
    };

    // ---- C2a: the refusal (no exchange rate, empty fields, local currency)
    const c2a = await page.evaluate(
      ([b, extra]) => {
        const st = Object.assign({}, b, extra);
        st._fxMissing = st.currency !== 'USD';
        const r = __calcEngine.computeFor(st);
        return {
          error: r && r.error ? r.error : null,
          total: r && r.total != null ? r.total : null
        };
      },
      [base, { units: 'metric' }]
    );
    check('C2a JMD with no exchange rate and empty rate fields refuses to price', !!c2a.error, c2a);
    check(
      'C2a-2 the refusal never carries a total',
      c2a.total === null || c2a.total === undefined,
      c2a
    );
    check(
      'C2a-3 the refusal is in plain words and names the currency',
      !!c2a.error && /JMD/.test(c2a.error) && /exchange rate/.test(c2a.error),
      c2a
    );

    // ---- C2b: USD still prices the model exactly as before (10 m2 x 50 = 500)
    const c2b = await page.evaluate(
      ([b]) => {
        const st = Object.assign({}, b, { currency: 'USD', country: 'US' });
        st._fxMissing = false;
        const r = __calcEngine.computeFor(st);
        return r && r.error
          ? { error: r.error }
          : { mat: r.mat, lab: r.lab, sub: r.sub, total: r.total, qty: r.qty };
      },
      [base]
    );
    check('C2b USD prices the planning model (10 m2 x (22 + 28))', c2b.error == null, c2b);
    check(
      'C2b-2 the split money is exactly 500 before on-costs',
      c2b.mat != null && c2b.lab != null && close(c2b.mat + c2b.lab, 500, 1e-9),
      c2b
    );

    // ---- C2c: no shipped label claims a book number beside a non-book rate
    const src = fs.readFileSync(path.join(ROOT, 'js', 'calculator-page.js'), 'utf8');
    // Only VARIANT labels are in scope, and the lie had a specific shape: a row
    // claim in parentheses, e.g. '8 in blocks ... (book Masonry #1)'. The
    // assistant's own field labels legitimately mention the book picker, so the
    // pattern is the parenthetical row claim, not the word itself.
    const labelClaims = [...src.matchAll(/label:\s*'([^']*\(book\s+[^']*\)[^']*)'/g)].map(
      m => m[1]
    );
    check(
      'C2c no variant label claims a book row (the book figures live in the book picker)',
      labelClaims.length === 0,
      labelClaims.slice(0, 5)
    );

    // ---- C2d: JMD WITH an exchange rate converts and flags nothing
    const c2d = await page.evaluate(
      ([b]) => {
        // The page's own FX store: units of currency per 1 USD.
        localStorage.setItem(
          'mmgr_calc_fx',
          JSON.stringify({ JMD: { per: '157.0', asOf: new Date().toISOString().slice(0, 10) } })
        );
        const st = Object.assign({}, b);
        st._fxMissing = false; // the wrapper's own check, now satisfiable
        const r = __calcEngine.computeFor(st);
        localStorage.removeItem('mmgr_calc_fx');
        return r && r.error ? { error: r.error } : { mat: r.mat, lab: r.lab };
      },
      [base]
    );
    check(
      'C2d JMD with a 157.0 rate converts the model and prices (no refusal)',
      c2d.error == null && c2d.mat != null,
      c2d
    );

    // ---- C2e: the comparison strip and the sanity rule
    const c2e = await page.evaluate(
      ([b]) => {
        const stLib = { JMD: { per: '157.0', asOf: '2026-10-18' } };
        localStorage.setItem('mmgr_calc_fx', JSON.stringify(stLib));
        const st = Object.assign({}, b, { allInRate: '1747', rateMat: '22', rateLab: '28' });
        st._fxMissing = false;
        const cmp = __calcEngine.rateComparison(st, { unit: 'm2' });
        const sane = __calcEngine.rateSanity({ book: 1747, split: 50 });
        const okPair = __calcEngine.rateSanity({ book: 1747, split: 1600 });
        localStorage.removeItem('mmgr_calc_fx');
        return { cmp, sane, okPair };
      },
      [base]
    );
    check(
      'C2e the comparison lists book, your split and the model per unit',
      c2e.cmp &&
        /Book rate/.test(c2e.cmp.text) &&
        /Your split/.test(c2e.cmp.text) &&
        /Model/.test(c2e.cmp.text),
      c2e.cmp
    );
    check(
      'C2e-2 the sanity rule fires on the 1747 vs 50 gap (34.9x)',
      c2e.sane && c2e.sane.ok === false && c2e.sane.ratio > 30,
      c2e.sane
    );
    check('C2e-3 two rates within 3x stay quiet', c2e.okPair && c2e.okPair.ok === true, c2e.okPair);

    // ---- C2f: the strip and banner are on the page and read-only
    const c2f = await page.evaluate(() => {
      const strip = document.getElementById('calc-rate-compare');
      const banner = document.getElementById('calc-rate-sanity');
      return {
        strip: !!strip,
        banner: !!banner,
        stripButtons: strip ? strip.querySelectorAll('button').length : -1,
        bannerButtons: banner ? banner.querySelectorAll('button').length : -1
      };
    });
    check(
      'C2f the comparison strip and banner exist and carry no buttons',
      c2f.strip && c2f.banner && c2f.stripButtons === 0 && c2f.bannerButtons === 0,
      c2f
    );
  } finally {
    await browser.close();
    if (srv) {
      try {
        srv.kill();
      } catch (e) {
        /* best effort */
      }
    }
  }

  const failed = results.filter(r => !r.ok);
  log('========================================');
  log(results.length + ' checks, ' + failed.length + ' failed');
  process.exit(failed.length ? 1 : 0);
})().catch(e => {
  console.error('[verify-currency] HARNESS ERROR: ' + ((e && e.stack) || e));
  process.exit(1);
});
