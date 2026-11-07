#!/usr/bin/env node
/* ============================================================
   tools/repro-populate.cjs  —  G-4 DIAGNOSTIC (not a gate)
   ------------------------------------------------------------
   FIELD-FINDINGS-DIRECTIVE-2026-10-28, G-4: "The form did not
   price that line: check the quantities" appeared when the
   quantity was fine.

   This harness reproduces the report in a real browser: it
   populates a custom line first, then sends the exact proposal
   the owner sent, and prints WHICH step returns nothing. It is a
   diagnostic, not a pass/fail gate (that is tools/qa-populate.cjs,
   T-POP). Run it by hand when the message reappears:

       node tools/repro-populate.cjs

   It starts serve.cjs itself if nothing answers on :8765.
   ============================================================ */
'use strict';
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const BASE = 'http://127.0.0.1:8765';
const delay = ms => new Promise(r => setTimeout(r, ms));

function resolvePlaywright() {
  for (const id of ['playwright', 'playwright-core']) {
    try {
      return require(id);
    } catch (e) {
      /* try the next */
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
  process.stdout.write('[repro] starting serve.cjs\n');
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

async function snap(page, label) {
  const state = await page.evaluate(() => {
    const sel = document.getElementById('calc-work');
    const out = document.getElementById('calc-output');
    let engine = null;
    try {
      const st = window.__calcEngine.readState();
      const r = window.__calcEngine.computeFor(st);
      engine = r ? { error: r.error || null, qty: r.qty, total: r.total, unit: r.unit } : null;
    } catch (e) {
      engine = { thrown: String(e).slice(0, 160) };
    }
    return {
      selValue: sel ? sel.value : null,
      hasOutput: !!out,
      family: (() => {
        try {
          return localStorage.getItem('mmgr_calc_family');
        } catch (e) {
          return null;
        }
      })(),
      engine
    };
  });
  process.stdout.write('\n[repro] ' + label + '\n' + JSON.stringify(state, null, 2) + '\n');
  return state;
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

    const call = v =>
      page.evaluate(val => {
        try {
          return window.MMGR_CALC_POPULATE(val);
        } catch (e) {
          return { ok: false, error: 'THREW: ' + String(e).slice(0, 160) };
        }
      }, v);

    // A. fresh page, the exact owner proposal.
    const a = await call({ work: 'blockwall', units: 'imperial', measuredQty: 5000 });
    process.stdout.write('\n[repro] A fresh -> ' + JSON.stringify(a) + '\n');
    await snap(page, 'A state after fresh populate');

    // B. after a CUSTOM line, the same proposal.
    const cb = await call({
      custom: { label: 'temp line', unit: 'm2', qty: 10, rate: 100, source: 'user' },
      units: 'metric',
      note: 'temp'
    });
    process.stdout.write('\n[repro] B custom first -> ' + JSON.stringify(cb) + '\n');
    const b = await call({ work: 'blockwall', units: 'imperial', measuredQty: 5000 });
    process.stdout.write('[repro] B work after custom -> ' + JSON.stringify(b) + '\n');
    await snap(page, 'B state after custom-then-work');

    // C. after a DIFFERENT trade.
    await call({ work: 'siteprep', units: 'metric', d1: 5, d2: 5, note: 'clear' });
    const c = await call({ work: 'blockwall', units: 'imperial', measuredQty: 5000 });
    process.stdout.write('\n[repro] C work after a different trade -> ' + JSON.stringify(c) + '\n');
    await snap(page, 'C state after other-trade-then-work');

    // D. metric total.
    const d = await call({ work: 'blockwall', units: 'metric', measuredQty: 500 });
    process.stdout.write('\n[repro] D metric total -> ' + JSON.stringify(d) + '\n');
    await snap(page, 'D state after metric total');

    // E. Why does a measured-total line fail the C8 qtyGuard for some trades?
    // Print the engine quantity against the independent expectation.
    const diag = await page.evaluate(() => {
      const keys = ['slab', 'footings', 'blockwall'];
      const out = {};
      keys.forEach(k => {
        const W = window.__calcEngine.work();
        const w = W[k];
        if (!w) {
          out[k] = { missing: true };
          return;
        }
        let unit = '';
        try {
          unit = (w.q(1, w.d2 ? 1 : null, w.d3 ? 1 : null) || {}).unit || '';
        } catch (e) {}
        const v = { work: k, units: 'metric', measuredQty: 100 };
        const exp = window.__calcEngine.expectedEngineQty(v);
        const st = window.__calcEngine.readState();
        const st2 = Object.assign({}, st, {
          work: k,
          units: 'metric',
          measuredQty: '100',
          measuredEntry: 'eng',
          measuredAuto: ''
        });
        const r = window.__calcEngine.computeFor(st2);
        out[k] = {
          unit,
          expected: exp,
          rqty: r && r.qty,
          runit: r && r.unit,
          hasWaste: r && r.hasWaste,
          wastePct: r && r.wastePct,
          total: r && r.total,
          error: r && r.error
        };
      });
      return out;
    });
    process.stdout.write(
      '\n[repro] E qtyGuard diagnostic\n' + JSON.stringify(diag, null, 2) + '\n'
    );

    await ctx.close();
  } catch (e) {
    process.stdout.write('[repro] FATAL ' + (e && e.message) + '\n');
    process.exitCode = 1;
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
})();
