/* ============================================================
   qa-calc-golden.cjs - golden-case engine gate (plan v2, E5)
   ------------------------------------------------------------
   The plan's rule: "No test, no ship. Every item ships with a
   hand-calculated expected result. A difference of more than 1
   currency unit rejects it." This harness reads
   tools/calc-golden-cases.json (expecteds HAND-CALCULATED from
   the documented formulas, never read off the engine) and runs
   each case through the real page's pure engine
   (window.__calcEngine.computeFor) in a real browser.

   One case = one gate: quantity (tol 0.02), materials, labor,
   tax and total (tol 1.0 currency unit). New items and engine
   changes are INVALID without a case here - the Phase 0 gate
   ("33 of 33 items have a golden case and pass").

   Usage:  node tools/qa-calc-golden.cjs
           BASE=https://... node tools/qa-calc-golden.cjs  (prod smoke)
   Registry: CI-TEST-COVERAGE.md -> CI row (serve.cjs battery).
   ============================================================ */
'use strict';
const path = require('path'); const os = require('os'); const fs = require('fs');
const { spawn } = require('child_process');
const PORT = 8765;
const BASE = process.env.BASE || 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');
const log = (s) => process.stdout.write('[calc-golden] ' + s + '\n');
const delay = ms => new Promise(r => setTimeout(r, ms));
let passed = 0, failed = 0;
const check = (name, ok, detail) => {
  if (ok) { passed++; log('PASS  ' + name); }
  else { failed++; log('FAIL  ' + name + '  <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 500)); }
};
function resolvePlaywright() {
  try { return require('playwright'); } catch (e) {}
  const roots = [path.join(os.homedir(), 'AppData', 'Local', 'npm-cache', '_npx'), path.join(os.homedir(), '.npm', '_npx')];
  for (const root of roots) { if (!fs.existsSync(root)) continue;
    for (const dir of fs.readdirSync(root)) { const p = path.join(root, dir, 'node_modules', 'playwright');
      if (fs.existsSync(path.join(p, 'index.js'))) return require(p); } }
  throw new Error('playwright not found - npm i -D playwright');
}
// Playwright demands an ABSOLUTE executablePath (see qa-calc-trade-coverage).
function absolutizeChrome(p) {
  if (!p) return undefined;
  if (path.isAbsolute(p)) return fs.existsSync(p) ? p : undefined;
  const finder = os.platform() === 'win32' ? 'where' : 'command -v';
  try {
    const out = require('child_process').execSync(finder + ' ' + JSON.stringify(p), { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split(/\r?\n/)[0];
    if (out && fs.existsSync(out)) return out;
  } catch (e) { /* fall back */ }
  return undefined;
}
(async () => {
  const file = path.join(ROOT, 'tools', 'calc-golden-cases.json');
  const book = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cases = book.cases || [];
  check('golden case file carries cases (>= 40)', cases.length >= 40, cases.length);

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
  executablePath = absolutizeChrome(executablePath);
  const browser = await pw.chromium.launch({ headless: true, executablePath, args: ['--disk-cache-size=0'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  let consoleErrors = 0;
  page.on('pageerror', () => { consoleErrors++; });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const url = (m.location() || {}).url || '';
    if (/Failed to load resource/.test(m.text()) && /\/api\//.test(url)) return; // signed-out probe noise
    consoleErrors++;
  });
  await page.goto(BASE + '/calculator.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(function() { return !!document.getElementById('calc-work') && !!window.__calcEngine; }, null, { timeout: 30000 });
  await page.waitForTimeout(600);

  const near = (a, b, tol) => Math.abs((Number(a) || 0) - (Number(b) || 0)) <= tol;
  for (const c of cases) {
    let r = null, evalErr = null;
    try {
      r = await page.evaluate((c) => {
        const st = {
          work: c.work, units: c.units || 'metric',
          d1: (c.dims && c.dims.d1) || '', d2: (c.dims && c.dims.d2) || '', d3: (c.dims && c.dims.d3) || '',
          currency: c.currency || 'USD', country: c.country || 'US', quality: c.quality || 'standard',
          wastePct: c.wastePct, rateMat: c.rateMat, rateLab: c.rateLab, rateEq: c.rateEq,
          ohPct: c.ohPct, onCostPct: c.onCostPct, taxOverride: c.taxOverride,
          piecePrice: c.piecePrice, pieceSize: c.pieceSize,
          measuredQty: c.measuredQty, measuredUnit: c.measuredUnit,
          openings: c.openings ? JSON.stringify(c.openings) : undefined,
          _matModel: c.matModel, _labModel: c.labModel
        };
        const r = window.__calcEngine.computeFor(st);
        if (!r) return { error: 'null result' };
        if (r.error) return { error: r.error };
        return { qty: r.qty, mat: r.mat, lab: r.lab, tax: r.tax, total: r.total };
      }, c);
    } catch (e) { evalErr = String((e && e.message) || e).slice(0, 300); }
    if (evalErr || !r || r.error) { check('[' + c.id + '] runs', false, evalErr || r); continue; }
    const e = c.expect;
    const parts = [];
    if (e.qty != null && !near(r.qty, e.qty, 0.02)) parts.push('qty ' + r.qty + ' != ' + e.qty);
    if (e.mat != null && !near(r.mat, e.mat, 1)) parts.push('mat ' + r.mat + ' != ' + e.mat);
    if (e.lab != null && !near(r.lab, e.lab, 1)) parts.push('lab ' + r.lab + ' != ' + e.lab);
    if (e.tax != null && !near(r.tax, e.tax, 1)) parts.push('tax ' + r.tax + ' != ' + e.tax);
    if (e.total != null && !near(r.total, e.total, 1)) parts.push('total ' + r.total + ' != ' + e.total);
    check('[' + c.id + '] hand-calculated result holds' + (parts.length ? '' : ' (qty/mat/lab/total)'), parts.length === 0, parts.join('; ') || c.note);
  }
  check('zero console/page errors across all golden cases', consoleErrors === 0, consoleErrors);
  await ctx.close(); await browser.close();
  if (global.__srv) { try { global.__srv.kill(); } catch (e) {} }
  log('==== GOLDEN CASES: ' + passed + ' passed / ' + failed + ' failed across ' + cases.length + ' cases ====');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
