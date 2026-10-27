/* ============================================================
   qa-calc-prices-changed.cjs - MAT-3 prices that changed
   ------------------------------------------------------------
   REFINEMENT-DIRECTIVE-2026-10-24, MAT-3: "a line priced earlier
   keeps its old numbers when rates change, and nothing says so."
   A bill line holds its OWN rate fields, so rewriting it silently
   would change a quote someone may have sent. Every line is
   stamped when it is saved with the date it was priced and a
   signature of the PRICING SOURCE it was quoted from (the book /
   model row for each field that is still a prefill, the exchange
   rate where the MAT-1 allowances convert). When that source
   moves, the line says so and offers the only two honest answers.

   This gate proves:
     (1) a new line is stamped once, with a date the bill shows;
     (2) a rate change moves the SOURCE, not the line: the total
         is byte-identical and the note appears;
     (3) Re-price updates exactly that line - hand-typed money on
         it is never touched, no other line moves;
     (4) Keep as quoted hides the note without moving any money,
         and a later rate change raises it again;
     (5) a hand-typed line never flags on a book change (nothing
         about its price can move but the owner's own edit);
     (6) a line saved before this wave carries no stamp and the
         bill claims no date for it;
     (7) the export carries the quoted date only when what is
         exported IS a line on the bill.

   Usage:  node tools/qa-calc-prices-changed.cjs
   Registry: docs/CI-TEST-COVERAGE.md -> CI row (T4 browser battery).
   ============================================================ */
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const PORT = Number(process.env.PORT || 8765);
const BASE = process.env.BASE || 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');
const log = s => process.stdout.write('[prices-changed] ' + s + '\n');
const delay = ms => new Promise(r => setTimeout(r, ms));
let passed = 0,
  failed = 0;
const check = (name, ok, detail) => {
  if (ok) {
    passed++;
    log('PASS  ' + name);
  } else {
    failed++;
    log(
      'FAIL  ' +
        name +
        '  <-- ' +
        JSON.stringify(detail === undefined ? null : detail).slice(0, 700)
    );
  }
};
const near = (a, b, tol) => Math.abs((Number(a) || 0) - (Number(b) || 0)) <= tol;

function resolvePlaywright() {
  try {
    return require('playwright');
  } catch (e) {}
  const roots = [
    path.join(os.homedir(), 'AppData', 'Local', 'npm-cache', '_npx'),
    path.join(os.homedir(), '.npm', '_npx')
  ];
  for (const root of roots) {
    if (!fs.existsSync(root)) {
      continue;
    }
    for (const dir of fs.readdirSync(root)) {
      const p = path.join(root, dir, 'node_modules', 'playwright');
      if (fs.existsSync(path.join(p, 'index.js'))) {
        return require(p);
      }
    }
  }
  throw new Error('playwright not found - npm i -D playwright');
}
function absolutizeChrome(p) {
  if (!p) {
    return undefined;
  }
  if (path.isAbsolute(p)) {
    return fs.existsSync(p) ? p : undefined;
  }
  const finder = os.platform() === 'win32' ? 'where' : 'command -v';
  try {
    const out = require('child_process')
      .execSync(finder + ' ' + JSON.stringify(p), { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
      .split(/\r?\n/)[0];
    if (out && fs.existsSync(out)) {
      return out;
    }
  } catch (e) {
    /* fall back */
  }
  return undefined;
}

(async () => {
  if (!process.env.BASE) {
    let up = false;
    try {
      up = (await fetch(BASE + '/calculator.html')).ok;
    } catch (e) {}
    if (!up) {
      log('starting serve.cjs for this run');
      global.__srv = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
      for (let i = 0; i < 30; i++) {
        await delay(1000);
        try {
          if ((await fetch(BASE + '/calculator.html')).ok) {
            break;
          }
        } catch (e) {}
      }
    }
  }
  const pw = resolvePlaywright();
  let executablePath;
  try {
    executablePath =
      require(path.join(ROOT, 'tools', 'chrome-launcher.cjs')).chromePath || undefined;
  } catch (e) {}
  executablePath = absolutizeChrome(executablePath);
  const browser = await pw.chromium.launch({
    headless: true,
    executablePath,
    args: ['--disk-cache-size=0']
  });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  let pageErrors = 0;
  page.on('pageerror', e => {
    pageErrors++;
    log('page error: ' + String((e && e.message) || e).slice(0, 200));
  });
  await page.goto(BASE + '/calculator.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(
    function () {
      return (
        !!document.getElementById('calc-work') &&
        !!window.__calcEngine &&
        !!window.__calcEngine.rateSig
      );
    },
    null,
    { timeout: 30000 }
  );
  await page.waitForTimeout(700);
  check('calculator page boots with the MAT-3 stamp seam live', pageErrors === 0, pageErrors);

  // A clean bench: no bill, no book, USD so the model prefills real numbers.
  const today = await page.evaluate(() => {
    try {
      localStorage.removeItem('mmgr_calc_boq');
      localStorage.removeItem('mmgr_calc_books');
      localStorage.removeItem('mmgr_calc_book_active');
    } catch (e) {}
    const $ = id => document.getElementById(id);
    $('calc-currency').value = 'USD';
    $('calc-currency').dispatchEvent(new Event('change', { bubbles: true }));
    $('calc-country').value = 'US';
    $('calc-country').dispatchEvent(new Event('change', { bubbles: true }));
    $('calc-work').value = 'blockwall';
    $('calc-work').dispatchEvent(new Event('change', { bubbles: true }));
    $('calc-d1').value = '10';
    $('calc-d1').dispatchEvent(new Event('input', { bubbles: true }));
    $('calc-d2').value = '2.4';
    $('calc-d2').dispatchEvent(new Event('input', { bubbles: true }));
    window.__calcEngine.renderBoq();
    return new Date().toISOString().slice(0, 10);
  });

  // ---- (1) a new line is stamped once, and the bill shows the date --------
  const stamped = await page.evaluate(async () => {
    const $ = id => document.getElementById(id);
    const flush = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    document.querySelector('[data-action="calcBoqAdd"]').click();
    await flush();
    const line = JSON.parse(localStorage.getItem('mmgr_calc_boq') || '[]')[0] || null;
    const row = document.querySelector('#calc-boq-body .bcp-boq-line');
    return {
      has: !!line,
      pricedAt: line ? line.pricedAt : null,
      sig: line ? line.rateSig : null,
      keep: line ? line.rateSigKeep : null,
      rowText: row ? row.textContent : '',
      flags: document.querySelectorAll('#calc-boq-body .bcp-boq-flag').length,
      sigMatches: line ? window.__calcEngine.rateSig(line.st) === line.rateSig : false
    };
  });
  check(
    'a new line carries today and a signature, and the bill reads priced with no note',
    stamped.has &&
      stamped.pricedAt === today &&
      typeof stamped.sig === 'string' &&
      stamped.sig.length >= 5 &&
      stamped.keep == null &&
      /priced \d{1,2} [A-Z][a-z]{2}/.test(stamped.rowText) &&
      stamped.flags === 0 &&
      stamped.sigMatches,
    stamped
  );

  // ---- (2) a rate change moves the source, not the line -------------------
  const rateChange = await page.evaluate(async () => {
    const $ = id => document.getElementById(id);
    const flush = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    const lines0 = JSON.parse(localStorage.getItem('mmgr_calc_boq') || '[]');
    const before = window.__calcEngine.computeFor(lines0[0].st);
    // A second line, so "only that line" can be proved rather than assumed.
    $('calc-work').value = 'fencing';
    $('calc-work').dispatchEvent(new Event('change', { bubbles: true }));
    $('calc-d1').value = '25';
    $('calc-d1').dispatchEvent(new Event('input', { bubbles: true }));
    $('calc-d2').value = '1.8';
    $('calc-d2').dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-action="calcBoqAdd"]').click();
    await flush();
    const two = JSON.parse(localStorage.getItem('mmgr_calc_boq') || '[]');
    const fenceBefore = window.__calcEngine.computeFor(two[1].st);
    // The rate book moves: blockwork is now dearer. Same device, same day.
    try {
      localStorage.setItem(
        'mmgr_calc_books',
        JSON.stringify([
          {
            id: 'qa-rate-chg',
            name: 'QA rate book',
            source: 'gate',
            currency: 'USD',
            rates: { blockwall: { '*': { mat: 90, lab: 60 } } },
            checksum: 'qa'
          }
        ])
      );
      localStorage.setItem('mmgr_calc_book_active', JSON.stringify('qa-rate-chg'));
    } catch (e) {}
    window.__calcEngine.renderBoq();
    const after = JSON.parse(localStorage.getItem('mmgr_calc_boq') || '[]');
    const afterTot = window.__calcEngine.computeFor(after[0].st);
    const flag = document.querySelectorAll('#calc-boq-body .bcp-boq-flag');
    const f0 = flag[0];
    const fenceAfter = window.__calcEngine.computeFor(after[1].st);
    return {
      lineBefore: before && before.total,
      lineAfter: afterTot && afterTot.total,
      fenceBefore: fenceBefore && fenceBefore.total,
      fenceAfter: fenceAfter && fenceAfter.total,
      flags: flag.length,
      text: f0 ? f0.textContent : '',
      reprice: f0 ? !!f0.querySelector('[data-action="calcBoqReprice"]') : false,
      keep: f0 ? !!f0.querySelector('[data-action="calcBoqKeep"]') : false
    };
  });
  check(
    'a rate change leaves the quoted total exactly as it was and raises the note with both answers',
    near(rateChange.lineAfter, rateChange.lineBefore, 0.001) &&
      near(rateChange.fenceAfter, rateChange.fenceBefore, 0.001) &&
      rateChange.flags === 1 &&
      /Prices changed since \d{1,2} [A-Z][a-z]{2}/.test(rateChange.text) &&
      rateChange.reprice &&
      rateChange.keep,
    rateChange
  );

  // ---- (3) Re-price updates exactly that line ----------------------------
  const reprice = await page.evaluate(async () => {
    const $ = id => document.getElementById(id);
    const flush = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    const before = JSON.parse(localStorage.getItem('mmgr_calc_boq') || '[]');
    const fenceBefore = window.__calcEngine.computeFor(before[1].st);
    const wallBefore = window.__calcEngine.computeFor(before[0].st);
    const btn = document.querySelector('#calc-boq-body [data-action="calcBoqReprice"]');
    if (btn) {
      btn.click();
    }
    await flush();
    const after = JSON.parse(localStorage.getItem('mmgr_calc_boq') || '[]');
    const wall = after[0];
    const wallAfter = window.__calcEngine.computeFor(wall.st);
    const fenceAfter = window.__calcEngine.computeFor(after[1].st);
    // The typed material rate was 90 in the book; the wall's own material
    // field must now carry it, and nothing else on the bill moved.
    return {
      clicked: !!btn,
      wallBefore: wallBefore && wallBefore.total,
      wallAfter: wallAfter && wallAfter.total,
      wallRate: wall.st ? wall.st.rateMat : null,
      fenceBefore: fenceBefore && fenceBefore.total,
      fenceAfter: fenceAfter && fenceAfter.total,
      fenceUntouched: JSON.stringify(after[1]) === JSON.stringify(before[1]),
      flags: document.querySelectorAll('#calc-boq-body .bcp-boq-flag').length,
      pricedAt: wall.pricedAt,
      sigNow: wall.rateSig,
      sigMatches: window.__calcEngine.rateSig(wall.st) === wall.rateSig
    };
  });
  check(
    'Re-price takes the new rate on THAT line only - the wall moves to the book, the fence and the stamp follow',
    reprice.clicked &&
      near(reprice.wallRate, 90, 0.001) &&
      reprice.wallAfter > reprice.wallBefore &&
      near(reprice.fenceAfter, reprice.fenceBefore, 0.001) &&
      reprice.fenceUntouched &&
      reprice.flags === 0 &&
      reprice.pricedAt === today &&
      reprice.sigMatches,
    reprice
  );

  // ---- (4) Keep as quoted, and a later change raises it again ------------
  const keepPath = await page.evaluate(async () => {
    const $ = id => document.getElementById(id);
    const flush = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    // Move the book again.
    try {
      localStorage.setItem(
        'mmgr_calc_books',
        JSON.stringify([
          {
            id: 'qa-rate-chg',
            name: 'QA rate book',
            source: 'gate',
            currency: 'USD',
            // Only the wall's rate moves. The fence has no row in this book,
            // so its own source (the WORK model) is untouched and it must stay
            // quiet - "update exactly that line" is the whole promise.
            rates: { blockwall: { '*': { mat: 120, lab: 60 } } },
            checksum: 'qa'
          }
        ])
      );
      localStorage.setItem('mmgr_calc_book_active', JSON.stringify('qa-rate-chg'));
    } catch (e) {}
    window.__calcEngine.renderBoq();
    const flag1 = document.querySelectorAll('#calc-boq-body .bcp-boq-flag');
    const totals1 = JSON.parse(localStorage.getItem('mmgr_calc_boq') || '[]').map(function (l) {
      const r = window.__calcEngine.computeFor(l.st);
      return r && !r.error ? r.total : null;
    });
    const keepBtn = document.querySelector('#calc-boq-body [data-action="calcBoqKeep"]');
    if (keepBtn) {
      keepBtn.click();
    }
    await flush();
    const flag2 = document.querySelectorAll('#calc-boq-body .bcp-boq-flag').length;
    const totals2 = JSON.parse(localStorage.getItem('mmgr_calc_boq') || '[]').map(function (l) {
      const r = window.__calcEngine.computeFor(l.st);
      return r && !r.error ? r.total : null;
    });
    // A THIRD move must raise the note again: "until the rate changes again".
    try {
      const books = JSON.parse(localStorage.getItem('mmgr_calc_books') || '[]');
      books[0].rates.blockwall['*'].mat = 140;
      localStorage.setItem('mmgr_calc_books', JSON.stringify(books));
    } catch (e) {}
    window.__calcEngine.renderBoq();
    const flag3 = document.querySelectorAll('#calc-boq-body .bcp-boq-flag').length;
    return {
      flagsAfterMove: flag1.length,
      keepDone: !!keepBtn,
      flagsAfterKeep: flag2,
      moneyUnmoved: JSON.stringify(totals1) === JSON.stringify(totals2),
      flagsAfterThirdMove: flag3
    };
  });
  check(
    'Keep as quoted hides the note without moving any money, and a later change raises it again',
    keepPath.flagsAfterMove === 1 &&
      keepPath.keepDone &&
      keepPath.flagsAfterKeep === 0 &&
      keepPath.moneyUnmoved &&
      keepPath.flagsAfterThirdMove === 1,
    keepPath
  );

  // ---- (5) a hand-typed line is the owner's own money --------------------
  const typed = await page.evaluate(async () => {
    const $ = id => document.getElementById(id);
    const flush = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    try {
      localStorage.removeItem('mmgr_calc_boq');
    } catch (e) {}
    window.__calcEngine.renderBoq();
    $('calc-work').value = 'render';
    $('calc-work').dispatchEvent(new Event('change', { bubbles: true }));
    $('calc-d1').value = '10';
    $('calc-d1').dispatchEvent(new Event('input', { bubbles: true }));
    $('calc-d2').value = '2.4';
    $('calc-d2').dispatchEvent(new Event('input', { bubbles: true }));
    // Both money fields typed by hand: nothing on this line follows a book.
    $('calc-rate-mat').value = '11';
    $('calc-rate-mat').dataset.model = '';
    $('calc-rate-lab').value = '17';
    $('calc-rate-lab').dataset.model = '';
    $('calc-rate-mat').dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-action="calcBoqAdd"]').click();
    await flush();
    const before = JSON.parse(localStorage.getItem('mmgr_calc_boq') || '[]');
    try {
      localStorage.setItem(
        'mmgr_calc_books',
        JSON.stringify([
          {
            id: 'qa-rate-chg',
            name: 'QA rate book',
            source: 'gate',
            currency: 'USD',
            rates: {
              blockwall: { '*': { mat: 300, lab: 200 } },
              render: { '*': { mat: 300, lab: 200 } }
            },
            checksum: 'qa'
          }
        ])
      );
      localStorage.setItem('mmgr_calc_book_active', JSON.stringify('qa-rate-chg'));
    } catch (e) {}
    window.__calcEngine.renderBoq();
    const after = JSON.parse(localStorage.getItem('mmgr_calc_boq') || '[]');
    const r0 = window.__calcEngine.computeFor(after[0].st);
    const r1 = window.__calcEngine.computeFor(before[0].st);
    return {
      flags: document.querySelectorAll('#calc-boq-body .bcp-boq-flag').length,
      totalUnmoved: !!(r0 && r1 && Math.abs(r0.total - r1.total) < 0.001),
      rateKept: after[0].st ? after[0].st.rateMat : null,
      priced: !!(r0 && !r0.error && r0.total > 0)
    };
  });
  check(
    'a line whose rates were typed by hand never flags on a book change',
    typed.flags === 0 && typed.totalUnmoved && near(typed.rateKept, 11, 0.001) && typed.priced,
    typed
  );

  // ---- (6) a line from before this wave claims nothing -------------------
  const legacy = await page.evaluate(() => {
    try {
      localStorage.setItem(
        'mmgr_calc_boq',
        JSON.stringify([
          {
            st: {
              work: 'blockwall',
              d1: '10',
              d2: '2.4',
              units: 'metric',
              currency: 'USD',
              country: 'US',
              quality: 'standard',
              rateMat: '22',
              matModel: '',
              rateLab: '28',
              labModel: ''
            },
            name: 'Old wall'
          }
        ])
      );
    } catch (e) {}
    window.__calcEngine.renderBoq();
    const row = document.querySelector('#calc-boq-body .bcp-boq-line');
    return {
      flags: document.querySelectorAll('#calc-boq-body .bcp-boq-flag').length,
      rowText: row ? row.textContent : '',
      pricedClaim: /priced \d{1,2} [A-Z][a-z]{2}/.test(row ? row.textContent : '')
    };
  });
  check(
    'a line saved before this wave has no stamp, so the bill claims no date for it',
    legacy.flags === 0 && legacy.pricedClaim === false,
    legacy
  );

  // ---- (7) the export carries the quoted date, and only then -------------
  const exported = await page.evaluate(async () => {
    const E = window.__calcEngine;
    const $ = id => document.getElementById(id);
    const flush = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    // A line priced through the form, so its snapshot is the WHOLE state the
    // export builds from - that is the match this gate is about.
    try {
      localStorage.removeItem('mmgr_calc_boq');
    } catch (e) {}
    $('calc-work').value = 'render';
    $('calc-work').dispatchEvent(new Event('change', { bubbles: true }));
    $('calc-d1').value = '10';
    $('calc-d1').dispatchEvent(new Event('input', { bubbles: true }));
    $('calc-d2').value = '2.4';
    $('calc-d2').dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-action="calcBoqAdd"]').click();
    await flush();
    const line = JSON.parse(localStorage.getItem('mmgr_calc_boq') || '[]')[0];
    E.applyState(line.st);
    const r = E.computeFor(E.readState());
    const csv = E.estimateCsv(r);
    // Every field is quoted by csvQuote, so the row reads "Priced on","<date>".
    const onBill = /"Priced on","\d{4}-\d{2}-\d{2}"/.test(csv);
    // An estimate that was never on the bill claims no price date at all.
    const fresh = Object.assign({}, line.st, { work: 'tile', d1: '4', d2: '4' });
    E.applyState(fresh);
    const r2 = E.computeFor(E.readState());
    const csv2 = r2 && !r2.error ? E.estimateCsv(r2) : '';
    return {
      onBill: onBill,
      offBill: /"Priced on"/.test(csv2),
      stamp: line.pricedAt || null
    };
  });
  check(
    'the export carries the quoted date when what is exported IS a billed line, and claims nothing otherwise',
    exported.onBill && exported.offBill === false && !!exported.stamp,
    exported
  );

  check('no uncaught page error during the wave', pageErrors === 0, pageErrors);

  await browser.close();
  if (global.__srv) {
    try {
      global.__srv.kill();
    } catch (e) {}
  }
  log('');
  log('RESULT  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => {
  log('HARNESS ERROR ' + String((e && e.stack) || e).slice(0, 800));
  process.exit(1);
});
