/* ============================================================
   qa-calc-playwright-audit.cjs - PLAYWRIGHT UX AUDIT (owner 2026-09-28:
   "use playwright, they get some different overview ... some troubles
   with a face while using these said calculators").
   ------------------------------------------------------------ 
   Independent engine on purpose: the CDP harnesses assert the math and
   wiring; this one walks the calculators like a user and reports UX
   defects - layout breaks at three viewports, theme contrast, focus
   visibility, live-recompute behavior, recall fidelity. Built on the
   repo's established Playwright launch pattern (qa-health-sweep.cjs:
   resolvePlaywright + absolutizeChrome).

   Sections (each failure names the page + viewport):
     L  LAYOUT: no horizontal scroll, primary controls inside viewport,
        result card visible after Calculate (390 / 768 / 1280)
     T  THEMES: light + dark both leave the page usable (body class flips,
        no horizontal scroll, run button visible in both)
     F  FOCUS: every interactive control shows a visible focus outline
        (keyboard walk - the doctrine's Gate: focus never "removed")
     V  LIVE: typing recomputes without pressing Calculate; error state
        guides instead of crashing; actions row appears only when valid
     R  RECALL: run + recall returns the EXACT settings (the owner's
        directive) - verified through the real UI events
     M  MOBILE: 390px panel - segmented control, rates and piece rows all
        reachable and tappable-sized

   Usage: node tools/qa-calc-playwright-audit.cjs  (starts serve.cjs if absent)
   Registry: CI-TEST-COVERAGE.md -> CI row.
   ============================================================ */
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const PORT = 8765;
const BASE = 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');
const log = (s) => process.stdout.write('[pw-audit] ' + s + '\n');
const delay = ms => new Promise(r => setTimeout(r, ms));
let passed = 0, failed = 0;
const check = (name, ok, detail) => {
  if (ok) { passed++; log('PASS  ' + name); }
  else { failed++; log('FAIL  ' + name + '  <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 300)); }
};

function resolvePlaywright() {
  if (process.env.PLAYWRIGHT_MODULE && fs.existsSync(process.env.PLAYWRIGHT_MODULE)) return require(process.env.PLAYWRIGHT_MODULE);
  try { return require('playwright'); } catch (e) { /* fall through */ }
  const roots = [path.join(os.homedir(), 'AppData', 'Local', 'npm-cache', '_npx'), path.join(os.homedir(), '.npm', '_npx')];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const dir of fs.readdirSync(root)) {
      const p = path.join(root, dir, 'node_modules', 'playwright');
      if (fs.existsSync(path.join(p, 'index.js'))) return require(p);
    }
  }
  throw new Error('playwright not found - npm i -D playwright');
}

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

async function walkFocus(page) {
  // Keyboard-walk the form; count focusable controls that show NO visible
  // focus indicator (outline none/0 and no outline on the element).
  return page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('button, input, select, [tabindex]'))
      .filter(e => e.offsetParent !== null && !e.disabled);
    let bad = 0;
    const names = [];
    for (const el of els) {
      el.focus();
      const cs = getComputedStyle(el);
      const visible = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || el.matches(':focus-visible');
      // :focus-visible is the modern gate; outline must exist for keyboard.
      if (!visible && cs.outlineStyle === 'none') { bad++; names.push(el.id || el.getAttribute('data-action') || el.tagName); }
    }
    return { total: els.length, bad, names: names.slice(0, 6) };
  });
}

(async () => {
  let served = false;
  try { const h = await fetch(BASE + '/calculator.html'); served = h.ok; } catch (e) {}
  let srv;
  if (!served) {
    log('starting serve.cjs for this run');
    srv = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { await delay(1000); try { const h = await fetch(BASE + '/calculator.html'); if (h.ok) { served = true; break; } } catch (e) {} }
  }
  if (!served) { log('FATAL: serve.cjs did not come up'); process.exit(1); }

  const { chromium } = resolvePlaywright();
  let executablePath;
  try { executablePath = require('./chrome-launcher.cjs').chromePath || undefined; } catch (e) {}
  executablePath = absolutizeChrome(executablePath);
  const browser = await chromium.launch({ headless: true, executablePath });

  const VIEWPORTS = [{ w: 390, h: 844, n: '390' }, { w: 768, h: 1024, n: '768' }, { w: 1280, h: 900, n: '1280' }];

  try {
    // ============ PAGE: calculator.html ============
    for (const vp of VIEWPORTS) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String(e).slice(0, 120)));
      await page.goto(BASE + '/calculator.html', { waitUntil: 'networkidle' });

      // L: layout integrity. The result card legitimately sits below the
      // fold on phones - "reachable" means scrolling to it works, not that
      // it starts on-screen.
      const layout = await page.evaluate(() => ({
        hscroll: document.documentElement.scrollWidth > window.innerWidth + 1,
        runVisible: (() => { const r = document.querySelector('[data-action=calcRun]').getBoundingClientRect(); return r.width > 0 && r.right <= window.innerWidth + 1; })()
      }));
      check('L1 [' + vp.n + '] no horizontal scroll', !layout.hscroll, layout);
      check('L2 [' + vp.n + '] Calculate button fully in viewport', layout.runVisible, layout);
      await page.evaluate(() => document.getElementById('calc-output').scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(600);
      const reachable = await page.evaluate(() => {
        const r = document.getElementById('calc-output').getBoundingClientRect();
        // 1px tolerance: smooth scrolling can settle a hair past the target
        // (top -0.0001 rounds to 0 but fails a naive >= 0).
        return { w: Math.round(r.width), top: Math.round(r.top * 100) / 100, vh: window.innerHeight,
                 ok: r.width > 0 && r.top > -1 && r.top < window.innerHeight };
      });
      check('L3 [' + vp.n + '] estimate card reachable by scroll', reachable.ok, reachable);

      // F: focus visibility (keyboard).
      const focus = await walkFocus(page);
      check('F1 [' + vp.n + '] every control shows keyboard focus (' + focus.total + ' controls)', focus.bad === 0, focus);

      // V: live recompute + error guidance + actions row gating.
      await page.selectOption('#calc-work', 'slab');
      await page.fill('#calc-d1', '10');
      await page.fill('#calc-d2', '8');
      const live = await page.evaluate(() => document.getElementById('calc-output').textContent);
      check('V1 [' + vp.n + '] typing recomputes live (partial -> guidance)', live.indexOf('Enter the dimensions') > -1, live.slice(0, 60));
      await page.fill('#calc-d3', '150');
      await page.waitForTimeout(120);
      const valid = await page.evaluate(() => ({
        hasTotal: document.getElementById('calc-output').textContent.indexOf('Estimated total') > -1,
        actionsShown: !document.getElementById('calc-out-actions').classList.contains('is-hide')
      }));
      check('V2 [' + vp.n + '] complete dims -> total + export actions appear', valid.hasTotal && valid.actionsShown, valid);
      await page.click('[data-action=calcRatesReset]');
      await page.fill('#calc-d3', '');
      await page.waitForTimeout(120);
      const errState = await page.evaluate(() => ({
        guidance: document.getElementById('calc-output').textContent.indexOf('Enter the dimensions') > -1,
        actionsHidden: document.getElementById('calc-out-actions').classList.contains('is-hide'),
        noThrow: true
      }));
      check('V3 [' + vp.n + '] clearing a dim -> guidance, actions hide, no crash', errState.guidance && errState.actionsHidden && errState.noThrow && errors.length === 0, { errState, errors });
      await ctx.close();
    }

    // T + R + M at the desktop/mobile pair.
    for (const vp of [{ w: 1280, h: 900, n: '1280' }, { w: 390, h: 844, n: '390' }]) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
      const page = await ctx.newPage();
      await page.goto(BASE + '/calculator.html', { waitUntil: 'networkidle' });

      // T: both themes stay usable.
      await page.click('[data-action=tglTheme]');
      await page.waitForTimeout(150);
      const dark = await page.evaluate(() => ({
        isDark: document.body.classList.contains('dark-mode'),
        hscroll: document.documentElement.scrollWidth > window.innerWidth + 1,
        runVisible: document.querySelector('[data-action=calcRun]').getBoundingClientRect().width > 0
      }));
      check('T1 [' + vp.n + '] dark theme flips + stays usable', dark.isDark && !dark.hscroll && dark.runVisible, dark);
      await page.click('[data-action=tglTheme]');
      await page.waitForTimeout(150);
      const light = await page.evaluate(() => !document.body.classList.contains('dark-mode'));
      check('T2 [' + vp.n + '] back to light', light, light);

      // R: recall fidelity through real UI events (the owner's exact scenario:
      // do it in metric, switch to imperial, recall -> metric returns).
      await page.selectOption('#calc-work', 'slab');
      await page.fill('#calc-d1', '10');
      await page.fill('#calc-d2', '8');
      await page.fill('#calc-d3', '150');
      await page.selectOption('#calc-currency', 'JMD');
      await page.selectOption('#calc-country', 'JM');
      await page.waitForTimeout(120);
      await page.click('[data-action=calcRun]');
      await page.click('[data-action="calcUnits"][data-units="imperial"]');
      await page.waitForTimeout(120);
      const disturbed = await page.evaluate(() => document.getElementById('calc-d1-label').textContent);
      check('R1 [' + vp.n + '] disturbed to imperial (' + disturbed + ')', disturbed === 'Length (ft)', disturbed);
      await page.click('[data-action=calcRestore]');
      await page.waitForTimeout(150);
      const recalled = await page.evaluate(() => ({
        lbl: document.getElementById('calc-d1-label').textContent,
        d1: document.getElementById('calc-d1').value,
        d3: document.getElementById('calc-d3').value,
        cur: document.getElementById('calc-currency').value,
        units: localStorage.getItem('mmgr_calc_units'),
        total: document.getElementById('calc-output').textContent.indexOf('Estimated total') > -1
      }));
      check('R2 [' + vp.n + '] recall returns the exact settings (metric, JMD, dims)', recalled.lbl === 'Length (m)' && recalled.d1 === '10' && recalled.d3 === '150' && recalled.cur === 'JMD' && recalled.units === 'metric' && recalled.total, recalled);

      // M: mobile reachability + tap sizes.
      const m = await page.evaluate(() => {
        const seg = document.querySelector('.bcp-seg').getBoundingClientRect();
        const rateMat = document.getElementById('calc-rate-mat').getBoundingClientRect();
        const pieceRow = document.getElementById('calc-piece-wrap');
        const run = document.querySelector('[data-action=calcRun]').getBoundingClientRect();
        return {
          segIn: seg.right <= window.innerWidth + 1 && seg.height >= 26,
          rateIn: rateMat.right <= window.innerWidth + 1 && rateMat.height >= 26,
          pieceReachable: pieceRow.hidden || pieceRow.getBoundingClientRect().width > 0,
          runTap: run.height >= 34
        };
      });
      check('M1 [' + vp.n + '] controls inside viewport + tap-sized', m.segIn && m.rateIn && m.pieceReachable && m.runTap, m);
      // M9/M10 (owner 2026-09-30 mobile pass) on the phone viewport only.
      if (vp.n === '390') {
        const m9 = await page.evaluate(() => {
          const b = document.querySelector('.bcp-run');
          window.scrollTo(0, 800);
          const r = b.getBoundingClientRect();
          return { pos: getComputedStyle(b).position,
                   inThumb: r.bottom > window.innerHeight - 160 && r.top < window.innerHeight,
                   noHScroll: document.documentElement.scrollWidth <= window.innerWidth + 1 };
        });
        check('M9 [390] Calculate sticks within thumb reach after scroll', m9 && m9.pos === 'sticky' && m9.inThumb, m9);
        const m10 = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('calc-d1')).fontSize));
        check('M10 [390] dimension inputs render 16px (no iOS zoom-jump)', m10 === 16, m10);
        const m11 = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
        check('M11 [390] no horizontal scroll at 390px (bar + form)', m11, m11);
      }
      await ctx.close();
    }

    // ============ IR: icon restore after a bfcache-style restore ==========
    // Owner bug 2026-09-30: after a back/forward-cache restore the external
    // sprite <use> refs lose their paint. Real bfcache cannot be forced in
    // CI, so the CONTRACT is verified: the module must exist on both pages
    // and a synthetic persisted pageshow / direct restore() call must
    // re-resolve every dropped external-sprite reference.
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto(BASE + '/calculator.html', { waitUntil: 'networkidle' });
      const ir1 = await page.evaluate(() => {
        if (!window.MMGRIconRestore || !MMGRIconRestore.restore) return { err: 'module missing on calculator' };
        const u = document.querySelector('svg.ico use[href^="css/mmgr-icons.svg"]');
        if (!u) return { err: 'no external sprite use found' };
        const before = u.getAttribute('href');
        const n = MMGRIconRestore.restore(); // full pass: clears + re-resolves every external ref
        return { ok: n > 0 && u.getAttribute('href') === before, n: n };
      });
      check('IR1 calculator: restore() re-resolves a dropped sprite href', ir1.ok === true, ir1);
      // app.html: same contract through the bundle build
      await page.goto(BASE + '/app.html', { waitUntil: 'networkidle' });
      const ir2 = await page.evaluate(() => {
        if (!window.MMGRIconRestore) return { err: 'module missing on app (bundle)' };
        const uses = Array.from(document.querySelectorAll('use[href^="css/mmgr-icons.svg"]'));
        if (!uses.length) return { err: 'no external sprite uses' };
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        return { ok: MMGRIconRestore.lastCount >= uses.length, n: uses.length, restored: MMGRIconRestore.lastCount };
      });
      check('IR2 app: persisted pageshow restores all dropped sprite hrefs', ir2.ok === true, ir2);
      await page.close();
    }
  } finally {
    await browser.close().catch(() => {});
    if (srv) { try { srv.kill(); } catch (e) {} }
  }

  log('==== PLAYWRIGHT UX AUDIT: ' + passed + ' passed / ' + failed + ' failed ====');
  process.exit(failed ? 1 : 0);
})();
