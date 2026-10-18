#!/usr/bin/env node
/* ============================================================
   tools/verify-units.cjs - T1 (AUDIT-DIRECTIVE-2026-10-18, rule N1)
   ------------------------------------------------------------
   "One physical quantity has one canonical unit inside the engine, and every
   entry point declares what unit it is writing."

   The bug this locks (C1): the Quick total box wrote a bare number that the
   engine read as its canonical unit, so typing 10,000 in imperial mode priced
   10,000 m2 instead of 10,000 sq ft - a 10.7639x money error the owner found
   by comparing two quotes for the same job.

   Runs against a real browser + serve.cjs and drives the page's OWN hooks
   (window.__calcEngine.applyState / computeFor / readState), then checks the
   golden table plus the static writer rule.

   Exit 0 = units are honoured end to end, 1 = drift.
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8765;
const BASE = 'http://127.0.0.1:' + PORT;
const delay = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const log = s => process.stdout.write('[verify-units] ' + s + '\n');
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  log((ok ? 'PASS' : 'FAIL') + '  ' + name + (ok ? '' : '   <-- ' + JSON.stringify(detail)));
}
const close = (a, b, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));

function resolvePlaywright() {
  return require('playwright');
}

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
  const { chromium } = resolvePlaywright();
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

    // A base state with waste pinned to 0, so the test measures the UNIT
    // boundary and nothing else (waste is a separate feature with its own
    // gates: a 5% default would otherwise blur every expected figure).
    const base = {
      work: 'blockwall',
      d1: '',
      d2: '',
      d3: '',
      wastePct: '0',
      openings: '[]',
      instances: '[]',
      measuredAuto: '',
      rateMat: '',
      rateLab: '',
      allIn: '',
      days: '',
      currency: 'JMD',
      country: 'JM',
      taxOverride: '',
      variant: '',
      piecePrice: '',
      pieceSize: '',
      labourOnly: false
    };

    const run = async extra => {
      return page.evaluate(
        ([b, x]) => {
          const st = Object.assign({}, b, x);
          __calcEngine.applyState(st);
          const r = __calcEngine.computeFor(st);
          return r && r.error ? { error: r.error } : { qty: r.qty, unit: r.unit, total: r.total };
        },
        [base, extra]
      );
    };

    // ---- U1: imperial dimension boxes (ft -> m), the path that always worked
    const u1 = await run({ units: 'imperial', d1: '100', d2: '100' });
    check(
      'U1 imperial 100 ft x 100 ft prices 929.0304 m2',
      u1.qty != null && close(u1.qty, 929.0304, 1e-6),
      u1
    );

    // ---- U2: the Quick total box in imperial mode (the C1 bug)
    const u2 = await run({
      units: 'imperial',
      measuredQty: '10000',
      measuredEntry: 'imp',
      measuredUnit: 'm2',
      measuredAuto: ''
    });
    check(
      'U2 imperial Quick total 10,000 sq ft prices 929.0304 m2',
      u2.qty != null && close(u2.qty, 929.0304, 1e-6),
      u2
    );

    // ---- U3: the Quick total box in metric mode (unchanged behaviour)
    const u3 = await run({
      units: 'metric',
      measuredQty: '10000',
      measuredEntry: 'eng',
      measuredUnit: 'm2',
      measuredAuto: ''
    });
    check(
      'U3 metric Quick total 10,000 prices 10,000 m2',
      u3.qty != null && close(u3.qty, 10000),
      u3
    );

    // ---- U4: a LEGACY saved state (no measuredEntry at all) prices as before
    const u4 = await run({ units: 'metric', measuredQty: '10000', measuredUnit: 'm2' });
    check(
      'U4 legacy state without measuredEntry is unchanged',
      u4.qty != null && close(u4.qty, 10000),
      u4
    );
    const u4b = await run({ units: 'imperial', measuredQty: '10000', measuredUnit: 'm2' });
    check(
      'U4b legacy imperial state still means engine units (no silent conversion)',
      u4b.qty != null && close(u4b.qty, 10000),
      u4b
    );

    // ---- U5: the dimension path is untouched (both systems agree physically)
    const u5imp = await run({ units: 'imperial', work: 'slab', d1: '30', d2: '20', d3: '5.9055' });
    const u5met = await run({ units: 'metric', work: 'slab', d1: '9.144', d2: '6.096', d3: '150' });
    check(
      'U5 imperial slab 30 ft x 20 ft x 5.9055 in = 8.3613 m3',
      u5imp.qty != null && close(u5imp.qty, 8.3613, 1e-4),
      u5imp
    );
    check(
      'U5b the metric twin 9.144 m x 6.096 m x 150 mm gives the same volume',
      // 5.9055 in is the rounded spelling of 150 mm, so the two entries agree
      // to the 4th decimal place rather than to the last bit.
      u5met.qty != null && close(u5met.qty, u5imp.qty, 1e-5),
      { imperial: u5imp, metric: u5met }
    );

    // ---- U6: the unit toggle keeps the PHYSICAL quantity, not the digits
    const toggle = await page.evaluate(() => {
      __calcEngine.applyState({
        work: 'blockwall',
        units: 'metric',
        measuredQty: '10000',
        measuredEntry: 'eng',
        measuredUnit: 'm2',
        measuredAuto: '',
        wastePct: '0'
      });
      document.querySelector('[data-action="calcUnits"][data-units="imperial"]').click();
      const box = document.getElementById('calc-measured-qty');
      const imperial = { value: box.value, entry: box.dataset.entry };
      const ri = __calcEngine.computeFor(__calcEngine.readState());
      document.querySelector('[data-action="calcUnits"][data-units="metric"]').click();
      const metric = { value: box.value, entry: box.dataset.entry };
      const rm = __calcEngine.computeFor(__calcEngine.readState());
      return {
        imperial,
        metric,
        qtyImp: ri && !ri.error ? ri.qty : null,
        qtyMet: rm && !rm.error ? rm.qty : null
      };
    });
    check(
      'U6 toggle to imperial converts the digits (10,000 m2 -> 107,639.1042 sq ft)',
      Number(toggle.imperial.value) > 107639 &&
        Number(toggle.imperial.value) < 107640 &&
        toggle.imperial.entry === 'imp',
      toggle.imperial
    );
    check(
      'U6b the physical quantity survives the toggle (engine qty stays 10,000)',
      toggle.qtyImp != null && close(toggle.qtyImp, 10000, 1e-5),
      { qtyImp: toggle.qtyImp }
    );
    check(
      'U6c toggling back restores the metric digits and the eng declaration',
      close(Number(toggle.metric.value), 10000, 1e-6) && toggle.metric.entry === 'eng',
      toggle.metric
    );

    // ---- U7: the read-out under the box prints BOTH units
    const readout = await page.evaluate(() => {
      // The Quick total box is the "use my own total" path, so the manual
      // checkbox has to be on before the read-out is expected (it is the same
      // switch the page checks).
      const manual = document.getElementById('calc-measured-manual');
      if (manual) manual.checked = true;
      __calcEngine.applyState({
        work: 'blockwall',
        units: 'imperial',
        measuredQty: '10000',
        measuredEntry: 'imp',
        measuredUnit: 'm2',
        measuredAuto: '',
        wastePct: '0',
        basis: 'allin',
        allInRate: '1747'
      });
      // applyState only fills the form (callers render), so fire the box's own
      // input handler: that is the real user path and it also re-stamps the
      // entry declaration from the unit system on screen.
      document
        .getElementById('calc-measured-qty')
        .dispatchEvent(new Event('input', { bubbles: true }));
      const el = document.getElementById('calc-quick-line');
      return {
        txt: (el && el.textContent) || '',
        hidden: !el || el.hidden,
        entry: document.getElementById('calc-measured-qty').dataset.entry
      };
    });
    check(
      'U7 the Quick total read-out names both units',
      /10,000(\.\d+)?\s*sq ft/.test(readout.txt) && /929(\.\d+)?\s*m2/.test(readout.txt),
      readout
    );

    // ---- U9-C8: the assistant's proposal carries its unit, and populate
    // prices from it (the model never converts - the page does).
    const u9 = await page.evaluate(() => {
      const proposal = { work: 'blockwall', units: 'imperial', d1: 100, d2: 100 };
      const chk = window.MMGR_CALC_CHECK(proposal);
      const res = window.MMGR_CALC_POPULATE(proposal);
      const after = window.__calcEngine.computeFor(window.__calcEngine.readState());
      return {
        preview: chk && chk.preview ? chk.preview : null,
        res: res,
        qty: after && !after.error ? after.qty : null,
        units: document.getElementById('calc-work') ? 'ok' : 'missing'
      };
    });
    check(
      'U9 the dry run previews the proposal quantity and unit',
      !!u9.preview && u9.preview.qty > 0,
      u9
    );
    check('U9b Populate accepts an imperial proposal', u9.res && u9.res.ok === true, u9.res);
    check(
      'U9c the populated line prices 929.0304 m2 (100 ft x 100 ft)',
      u9.qty != null && close(u9.qty, 929.0304, 1e-6),
      u9
    );

    // ---- U10-C8: the fail-closed rule itself (both sides driven directly)
    const u10 = await page.evaluate(() => ({
      agrees: __calcEngine.qtyGuard(929.0304, 929.0304),
      disagrees: __calcEngine.qtyGuard(929.0304, 10000),
      unknown: __calcEngine.qtyGuard(null, 10000),
      expectedImperial: __calcEngine.expectedEngineQty({
        work: 'blockwall',
        units: 'imperial',
        d1: 100,
        d2: 100
      }),
      expectedMetric: __calcEngine.expectedEngineQty({
        work: 'blockwall',
        units: 'metric',
        measuredQty: 10000
      })
    }));
    check(
      'U10 the quantity guard accepts agreement and refuses disagreement',
      u10.agrees === true && u10.disagrees === false && u10.unknown === true,
      u10
    );
    check(
      'U10b the independent derivation matches the two declarations',
      close(u10.expectedImperial, 929.0304, 1e-6) && close(u10.expectedMetric, 10000, 1e-9),
      u10
    );

    // ---- U11-C9: Download works on a PROPOSAL, before any Populate
    const u11 = await page.evaluate(() => {
      const f = window.MMGR_CALC_FILE({
        work: 'blockwall',
        units: 'imperial',
        d1: 100,
        d2: 100
      });
      return {
        ok: !!(f && f.ok),
        name: f && f.name,
        rows: f && f.rows,
        text: (f && f.text) || '',
        head: f && f.text ? f.text.slice(0, 200) : ''
      };
    });
    check(
      'U11 Generate a file prices an unpopulated proposal (no Populate first)',
      u11.ok === true,
      u11
    );
    check(
      'U11b the sandboxed file carries the converted quantity and a total',
      /929\.03/.test(u11.text) && /[0-9][0-9,]*\.[0-9]{2}/.test(u11.text),
      { head: u11.head, rows: u11.rows }
    );

    // ---- U12-C10: the chip's data source is never blank for a work proposal
    const u12 = await page.evaluate(() => {
      const chk = window.MMGR_CALC_CHECK({
        work: 'blockwall',
        units: 'imperial',
        d1: 100,
        d2: 100
      });
      return { qty: chk.preview && chk.preview.qty, unit: chk.preview && chk.preview.unit };
    });
    check(
      'U12 a work proposal previews a real quantity and unit (the chip reads these)',
      u12.qty > 0 && !!u12.unit,
      u12
    );

    // ---- U8 (static): EVERY writer of the box declares its unit
    const src = fs.readFileSync(path.join(ROOT, 'js', 'calculator-page.js'), 'utf8').split(/\r?\n/);
    const undeclared = [];
    let writers = 0;
    src.forEach((line, i) => {
      // Direct form: $('calc-measured-qty').value = ...
      // Indirect form: var mq = $('calc-measured-qty'); ... mq.value = ...
      const direct = /calc-measured-qty['"]\)?\.value\s*=/.test(line);
      let indirect = false;
      if (!direct && /\.value\s*=/.test(line)) {
        const before = src.slice(Math.max(0, i - 4), i + 1).join('\n');
        indirect =
          /calc-measured-qty['"]\)/.test(before) &&
          /var\s+\w+\s*=\s*\$\(\s*'calc-measured-qty'/.test(before);
      }
      if (!direct && !indirect) return;
      writers++;
      const after = src.slice(i, i + 4).join('\n');
      if (!/dataset\.entry/.test(after)) {
        undeclared.push('js/calculator-page.js:' + (i + 1) + '  ' + line.trim());
      }
    });
    check(
      'U8 every calc-measured-qty writer sets dataset.entry within 3 lines',
      undeclared.length === 0 && writers >= 2,
      { undeclared, writers }
    );

    log('writers of #calc-measured-qty inspected: ' + writers);
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
  failed.forEach(f => log('FAIL: ' + f.name));
  process.exit(failed.length ? 1 : 0);
})().catch(e => {
  console.error('[verify-units] HARNESS ERROR: ' + ((e && e.stack) || e));
  process.exit(1);
});
