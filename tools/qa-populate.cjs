#!/usr/bin/env node
/* ============================================================
   tools/qa-populate.cjs  —  GATE T-POP (Wave G, G-4)
   ------------------------------------------------------------
   FIELD-FINDINGS-DIRECTIVE-2026-10-28, G-4: "The form did not
   price that line: check the quantities" appeared when the
   quantity was fine.

   This gate drives the page's REAL MMGR_CALC_POPULATE and proves,
   for EVERY trade the picker offers, in BOTH unit systems, on BOTH
   the measured-total path and the dimensions path:

     * calcPopulate returns ok:true with a positive total, and
     * it still does so straight after a `custom` line and after a
       DIFFERENT trade (the two conditions in the report).

   The bill is cleared between calls so the 60-line cap never makes
   a good line look like a failure. It is a browser harness (needs
   serve.cjs on :8765 and Chrome); it starts serve.cjs itself.

   Usage:  node tools/qa-populate.cjs
   Registry: docs/CI-TEST-COVERAGE.md -> CI row (browser-calc).
   ============================================================ */
'use strict';
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const BASE = 'http://127.0.0.1:8765';
const delay = ms => new Promise(r => setTimeout(r, ms));

let passed = 0,
  failed = 0;
const log = s => process.stdout.write('[qa-pop] ' + s + '\n');
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
        JSON.stringify(detail === undefined ? null : detail).slice(0, 500)
    );
  }
};

function resolvePlaywright() {
  for (const id of ['playwright', 'playwright-core']) {
    try {
      return require(id);
    } catch (e) {
      /* next */
    }
  }
  try {
    return require(path.join(ROOT, 'node_modules', 'playwright'));
  } catch (e) {
    throw new Error('playwright is not installed');
  }
}
function chromePath() {
  try {
    const p = require(path.join(ROOT, 'tools', 'chrome-launcher.cjs')).chromePath;
    if (p) {
      return path.isAbsolute(p) ? p : path.join(ROOT, p);
    }
  } catch (e) {}
  return undefined;
}
async function ensureServer() {
  try {
    const h = await fetch(BASE + '/calculator.html');
    if (h.ok) {
      return null;
    }
  } catch (e) {}
  log('starting serve.cjs for this run');
  const srv = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 30; i++) {
    await delay(1000);
    try {
      const h = await fetch(BASE + '/calculator.html');
      if (h.ok) {
        return srv;
      }
    } catch (e) {}
  }
  throw new Error('serve.cjs did not come up on :8765');
}

(async () => {
  const { chromium } = resolvePlaywright();
  let srv = null;
  let browser = null;
  try {
    srv = await ensureServer();
    browser = await chromium.launch({ headless: true, executablePath: chromePath() });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      try {
        if (!localStorage.getItem('mmgr_calc_fx')) {
          localStorage.setItem(
            'mmgr_calc_fx',
            JSON.stringify({ JMD: { per: '158', asOf: '2026-01-15', seeded: true } })
          );
        }
      } catch (e) {}
    });
    await page.route('**/api/auth/me', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, user: { email: 'owner@example.com' } })
      })
    );
    await page.goto(BASE + '/calculator.html', { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.MMGR_CALC_POPULATE, null, { timeout: 20000 });

    const info = await page.evaluate(() => {
      const sel = document.getElementById('calc-work');
      const W = window.__calcEngine.work();
      const keys = Array.from(sel.options)
        .map(o => o.value)
        .filter(v => v && v !== 'book' && v !== 'custom');
      const meta = {};
      Object.keys(W).forEach(k => {
        meta[k] = { d2: !!W[k].d2, d3: !!W[k].d3, name: W[k].name || W[k].label || k };
      });
      return { keys, meta };
    });
    check(
      'T-POP the picker offers the trade set (>= 40)',
      info.keys.length >= 40,
      info.keys.length
    );

    const runOne = (v, meta) =>
      page.evaluate(
        ([val, m]) => {
          try {
            localStorage.setItem('mmgr_calc_boq', '[]');
          } catch (e) {}
          let proposal;
          if (val.kind === 'measured') {
            proposal = { work: val.k, units: val.u, measuredQty: 100 };
          } else {
            proposal = { work: val.k, units: val.u, d1: 10 };
            if (m && m.d2) {
              proposal.d2 = 3;
            }
            if (m && m.d3) {
              proposal.d3 = 1;
            }
          }
          try {
            return { proposal, r: window.MMGR_CALC_POPULATE(proposal) };
          } catch (e) {
            return { proposal, r: { ok: false, error: 'THREW ' + String(e).slice(0, 140) } };
          }
        },
        [v, meta]
      );

    const bad = [];
    for (const k of info.keys) {
      const meta = info.meta[k] || {};
      for (const u of ['metric', 'imperial']) {
        for (const kind of ['measured', 'dims']) {
          const out = await runOne({ k, u, kind }, meta);
          const r = out.r || {};
          if (r.ok !== true || !(Number(r.total) > 0)) {
            bad.push({ k, u, kind, proposal: out.proposal, r });
          }
        }
      }
    }
    check(
      'T-POP every trade prices in BOTH units on BOTH paths (' + info.keys.length * 4 + ' cases)',
      bad.length === 0,
      bad.slice(0, 8)
    );

    // The two report conditions, with the owner's exact proposal.
    const afterCustom = await page.evaluate(() => {
      try {
        localStorage.setItem('mmgr_calc_boq', '[]');
      } catch (e) {}
      const c = window.MMGR_CALC_POPULATE({
        custom: { label: 'temp line', unit: 'm2', qty: 10, rate: 98765, source: 'user' },
        units: 'metric',
        note: 'temp'
      });
      const w = window.MMGR_CALC_POPULATE({
        work: 'blockwall',
        units: 'imperial',
        measuredQty: 5000
      });
      return { custom: c, work: w };
    });
    check(
      'T-POP the owner proposal prices straight after a custom line',
      afterCustom.work && afterCustom.work.ok === true && Number(afterCustom.work.total) > 0,
      afterCustom
    );

    const afterTrade = await page.evaluate(() => {
      try {
        localStorage.setItem('mmgr_calc_boq', '[]');
      } catch (e) {}
      const first = window.MMGR_CALC_POPULATE({ work: 'siteprep', units: 'metric', d1: 5, d2: 5 });
      const w = window.MMGR_CALC_POPULATE({
        work: 'blockwall',
        units: 'imperial',
        measuredQty: 5000
      });
      return { first, work: w };
    });
    check(
      'T-POP the owner proposal prices straight after a different trade',
      afterTrade.work && afterTrade.work.ok === true && Number(afterTrade.work.total) > 0,
      afterTrade
    );

    // The honest-message contract: an impossible work key must NOT blame the
    // quantity and must name the item / state that it could not be selected.
    const honest = await page.evaluate(() => {
      try {
        return window.MMGR_CALC_POPULATE({ work: '__no_such_trade__', units: 'metric', d1: 1 });
      } catch (e) {
        return { ok: false, error: 'THREW ' + String(e).slice(0, 120) };
      }
    });
    const honestText = String((honest && honest.error) || '');
    check(
      'T-POP a line that cannot be selected never blames the quantity',
      honestText.length > 0 && !/check the quantities/i.test(honestText),
      honest
    );

    await ctx.close();
  } catch (e) {
    failed++;
    log('FATAL ' + (e && e.message));
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {}
    }
    if (srv) {
      try {
        srv.kill();
      } catch (e) {}
    }
  }
  log('==== T-POP: ' + passed + ' passed / ' + failed + ' failed ====');
  process.exit(failed ? 1 : 0);
})();
