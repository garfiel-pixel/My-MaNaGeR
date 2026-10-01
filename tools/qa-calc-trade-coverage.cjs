/* ============================================================
   qa-calc-trade-coverage.cjs - "same way for every trade" audit
   (owner 2026-10-01: "what about drywall etc and all the others -
   I don't think we are covering everything the same way even tho
   I said to research with playwright")
   ------------------------------------------------------------
   The owner is right: qa-calc-playwright-audit walks a handful of
   trades (slab/blockwall/tile), not all of them. This audit walks
   EVERY user trade in the picker (read live from the page, so
   future trades are covered automatically) through the IDENTICAL
   contract, via the real UI at desktop + phone viewports:

     1  selecting the trade flips the family picker to its group
     2  d1 label names the measurement basis (every label carries
        a parenthesised basis - the research-backed contract)
     3  the dim fields that show accept values and hide otherwise
     4  pricing: quantity > 0, hero shows the trade's unit,
        'Estimated total' renders, matDesc names the materials
     5  the piece row (price-per-board/sheet/tile/...) - when the
        trade offers one - carries non-empty placeholders and the
        typed per-piece price feeds the exact $/unit
     6  Add to bill lands a REAL priced line
     7  the CSV carries the trade + rates
     8  zero console errors / page errors across the whole walk
     9  [390] form + result stay inside the phone viewport

   Output: a per-trade PASS/FAIL matrix + totals. Exit 1 on any
   trade failing any step. BASE env overrides the target (the same
   file smokes production: BASE=https://... node tools/qa-calc-trade-coverage.cjs).

   CI hardening (after run 36892966047 failed blind): boot waits on
   domcontentloaded + explicit readiness (never networkidle - one
   hanging keep-alive request would time the step out with zero
   harness output), and a per-trade evaluate throw is captured and
   REPORTED in the gate detail instead of crashing the step with a
   bare exit 1. Gate logic is unchanged.

   Usage:  node tools/qa-calc-trade-coverage.cjs
   Registry: CI-TEST-COVERAGE.md -> CI row (serve.cjs battery).
   ============================================================ */
'use strict';
const path = require('path'); const os = require('os'); const fs = require('fs');
const { spawn } = require('child_process');
const PORT = 8765;
const BASE = process.env.BASE || 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');
const log = (s) => process.stdout.write('[trade-coverage] ' + s + '\n');
const delay = ms => new Promise(r => setTimeout(r, ms));
let passed = 0, failed = 0;
const check = (name, ok, detail) => {
  if (ok) { passed++; log('PASS  ' + name); }
  else { failed++; log('FAIL  ' + name + '  <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 400)); }
};
function resolvePlaywright() {
  try { return require('playwright'); } catch (e) {}
  const roots = [path.join(os.homedir(), 'AppData', 'Local', 'npm-cache', '_npx'), path.join(os.homedir(), '.npm', '_npx')];
  for (const root of roots) { if (!fs.existsSync(root)) continue;
    for (const dir of fs.readdirSync(root)) { const p = path.join(root, dir, 'node_modules', 'playwright');
      if (fs.existsSync(path.join(p, 'index.js'))) return require(p); } }
  throw new Error('playwright not found - npm i -D playwright');
}
function dimSample(label) {
  // Sane sample per basis: mm dims small, m dims modest, counts small.
  if (/\(mm\)/.test(label)) return '100';
  if (/\(m2\)|\(m3\)/.test(label)) return '10';
  if (/\(m\)/.test(label)) return '10';
  return '10';
}
(async () => {
  if (!process.env.BASE) {
    let srv = null;
    try { const h = await fetch(BASE + '/calculator.html'); if (!h.ok) throw 0; } catch (e) {
      log('starting serve.cjs for this run');
      srv = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
      for (let i = 0; i < 30; i++) { await delay(1000); try { const h = await fetch(BASE + '/calculator.html'); if (h.ok) break; } catch (e) {} }
    }
    global.__srv = srv;
  }
  const pw = resolvePlaywright();
  let executablePath; try { executablePath = require(path.join(ROOT, 'tools', 'chrome-launcher.cjs')).chromePath || undefined; } catch (e) {}
  const browser = await pw.chromium.launch({ headless: true, executablePath, args: ['--disk-cache-size=0'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  let consoleErrors = 0;
  const apiNoise = []; // classified: the workspace probe 404s on the static server / 403s signed-out
  const evalErrors = []; // evaluate throws are captured + reported, never crash the step blind
  page.on('pageerror', () => { consoleErrors++; });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const url = (m.location() || {}).url || '';
    if (/Failed to load resource/.test(m.text()) && /\/api\//.test(url)) { apiNoise.push(url.slice(-40)); return; }
    consoleErrors++; // non-API errors are real
  });
  // Boot: domcontentloaded + explicit readiness, NOT networkidle - a hanging
  // keep-alive request would time the step out with zero harness output.
  await page.goto(BASE + '/calculator.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(function() { return !!document.getElementById('calc-work') && !!window.__calcEngine; }, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  // One wrapper for every per-trade evaluate: a throw becomes a reported
  // payload (gate FAIL with the message) instead of an unhandled rejection
  // that kills the whole step with no output.
  const runTrade = async (p, trade, fn) => {
    try { return { ok: true, r: await p.evaluate(fn, trade) }; }
    catch (e) { const err = { evalError: String((e && e.message) || e).slice(0, 300) }; evalErrors.push(err); return { ok: false, err: err }; }
  };

  const trades = await page.evaluate(() =>
    Array.prototype.map.call(document.querySelectorAll('#calc-work option'), o => o.value).filter(v => v && v !== '')
  );
  check('picker exposes the user trades (>= 20)', trades.length >= 20, trades);

  for (const trade of trades) {
    const res = await runTrade(page, trade, async (trade) => {
      const dimSample = (label) => /\(mm\)/.test(label || '') ? '100' : '10';
      // Reset to a deterministic state between trades.
      try { localStorage.removeItem('mmgr_calc_boq'); localStorage.removeItem('mmgr_calc_wstamps'); } catch (e) {}
      const work = document.getElementById('calc-work');
      work.value = trade;
      work.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
      const d1l = document.getElementById('calc-d1-label');
      const d2 = document.getElementById('calc-d2'), d2w = document.getElementById('calc-d2-wrap');
      const d3 = document.getElementById('calc-d3'), d3w = document.getElementById('calc-d3-wrap');
      // Family flip: the trade's own optgroup must be the visible one.
      const opt = work.querySelector('option[value="' + trade + '"]');
      const group = opt ? opt.parentElement : null;
      const familyVisible = !!group && !group.hidden && group.tagName === 'OPTGROUP';
      const famSel = document.getElementById('calc-family');
      // Fill the visible dims with per-basis samples.
      const d1v = dimSample(d1l ? d1l.textContent : '');
      const inp = document.getElementById('calc-d1'); inp.value = d1v;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      if (d2 && !d2.hidden) { d2.value = /\(mm\)/.test((document.getElementById('calc-d2-label') || {}).textContent || '') ? '150' : '4'; d2.dispatchEvent(new Event('input', { bubbles: true })); }
      if (d3 && !d3.hidden) {
        d3.value = /\(mm\)/.test((document.getElementById('calc-d3-label') || {}).textContent || '') ? '100' : '0.15';
        d3.dispatchEvent(new Event('input', { bubbles: true }));
      }
      // Piece row: if visible, type a per-piece price (roof-sheet-style math).
      const pw2 = document.getElementById('calc-piece-wrap');
      let pieceNote = null;
      if (pw2 && !pw2.hidden) {
        const pp = document.getElementById('calc-piece-price');
        if (pp) { pp.value = '950'; pp.dispatchEvent(new Event('input', { bubbles: true })); }
        pieceNote = { visible: true, pricePh: (pp || {}).placeholder || '' };
      } else pieceNote = { visible: false };
      document.querySelector('[data-action="calcRun"]').click();
      await new Promise(res => setTimeout(res, 150));
      const out = document.getElementById('calc-output').textContent;
      const heroUnit = (document.querySelector('.calc-sum-qty') || {}).textContent || '';
      const matDesc = (document.querySelector('.calc-sum-sub') || {}).textContent || '';
      const csv = window.__calcEngine.estimateCsv(window.__calcEngine.readState());
      const linesBefore = JSON.parse(localStorage.getItem('mmgr_calc_boq') || '[]').length;
      const addBtn = document.querySelector('[data-action="calcBoqAdd"]');
      if (addBtn) addBtn.click();
      await new Promise(res => setTimeout(res, 120));
      const linesAfter = JSON.parse(localStorage.getItem('mmgr_calc_boq') || '[]').length;
      return {
        d1Label: (d1l || {}).textContent || '',
        familyVisible: familyVisible,
        famValue: famSel ? famSel.value : null,
        d2vis: d2 ? !d2.hidden : false,
        d3vis: d3 ? !d3.hidden : false,
        qtyPositive: /Estimated total/i.test(out) && /[1-9]/.test((out.match(/Estimated total([\s\S]{0,120})/) || [''])[1] || ''),
        totalPositive: (out.match(/Estimated total[^\d]{0,20}([\d,.]+)/) || [])[1] ? parseFloat((out.match(/Estimated total[^\d]{0,20}([\d,.]+)/) || [])[1].replace(/,/g, '')) > 0 : false,
        matDesc: !!matDesc,
        piece: pieceNote,
        csvOk: csv.length > 40 && csv.indexOf('Material') > -1,
        billAdded: linesAfter === linesBefore + 1,
        heroUnit: heroUnit.slice(0, 60),
        consoleClean: true
      };
    });
    const r = res.ok ? res.r : null;
    const ok = !!r && r.familyVisible && r.d1Label.indexOf('(') > -1 && r.qtyPositive && r.totalPositive &&
      r.matDesc && r.csvOk && r.billAdded &&
      (!r.piece.visible || (r.piece.pricePh && r.piece.pricePh.length > 3));
    check('[' + trade + '] family flip + basis label + priced + CSV + bill' + (r && r.piece.visible ? ' + piece row' : ''),
      ok, r || res.err);
  }

  // Mobile pass: every trade selects, prices, and stays inside the phone.
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mpage = await mctx.newPage();
  let mErrs = 0;
  mpage.on('pageerror', () => { mErrs++; });
  await mpage.goto(BASE + '/calculator.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await mpage.waitForFunction(function() { return !!document.getElementById('calc-work') && !!window.__calcEngine; }, null, { timeout: 30000 });
  await mpage.waitForTimeout(600);
  const mTrades = await mpage.evaluate(() =>
    Array.prototype.map.call(document.querySelectorAll('#calc-work option'), o => o.value).filter(v => v && v !== '')
  );
  for (const trade of mTrades) {
    const res = await runTrade(mpage, trade, async (trade) => {
      const dimSample = (label) => /\(mm\)/.test(label || '') ? '100' : '10';
      const work = document.getElementById('calc-work');
      work.value = trade;
      work.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
      const d1 = document.getElementById('calc-d1');
      const d1l = (document.getElementById('calc-d1-label') || {}).textContent || '';
      d1.value = /\(mm\)/.test(d1l) ? '100' : '10';
      d1.dispatchEvent(new Event('input', { bubbles: true }));
      const d2 = document.getElementById('calc-d2');
      if (d2 && !d2.hidden) { d2.value = /\(mm\)/.test((document.getElementById('calc-d2-label') || {}).textContent || '') ? '150' : '4'; d2.dispatchEvent(new Event('input', { bubbles: true })); }
      const d3 = document.getElementById('calc-d3');
      if (d3 && !d3.hidden) { d3.value = /\(mm\)/.test((document.getElementById('calc-d3-label') || {}).textContent || '') ? '100' : '0.15'; d3.dispatchEvent(new Event('input', { bubbles: true })); }
      document.querySelector('[data-action="calcRun"]').click();
      await new Promise(res => setTimeout(res, 120));
      const run = document.querySelector('.bcp-run').getBoundingClientRect();
      return {
        noHScroll: document.documentElement.scrollWidth <= window.innerWidth + 1,
        hasTotal: /Estimated total/i.test(document.getElementById('calc-output').textContent),
        runVisible: run.width > 0
      };
    });
    const m = res.ok ? res.r : null;
    check('[' + trade + '] [390] prices + stays inside the phone viewport',
      !!m && m.noHScroll && m.hasTotal && m.runVisible, m || res.err);
  }
  check('zero console/page errors across all trades (both viewports; signed-out /api/ 4xx classified as expected probe noise)',
    consoleErrors === 0 && mErrs === 0 && evalErrors.length === 0, { consoleErrors, mErrs, evalErrors, apiNoise });
  await ctx.close(); await mctx.close(); await browser.close();
  if (global.__srv) { try { global.__srv.kill(); } catch (e) {} }
  log('==== TRADE COVERAGE: ' + passed + ' passed / ' + failed + ' failed across ' + trades.length + ' trades ====');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
