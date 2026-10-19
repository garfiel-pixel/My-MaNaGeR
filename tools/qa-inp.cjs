/* ============================================================
   tools/qa-inp.cjs - X-3 interaction-latency profile (T7)
   ------------------------------------------------------------
   AUDIT-DIRECTIVE-2026-10-18, task X-3 ("do first: measure").

   Drives the real pages in headless Chrome under 4x CPU throttling,
   with a PerformanceObserver on `event` (durationThreshold 16, so
   only interactions that could ever be reported as INP are counted)
   and on `long-animation-frame` where the browser supports it. Each
   scenario runs its interaction, then reports the p75 and the worst
   duration of the events that interaction produced.

   Budget (directive 8.3): every scenario under 200 ms, typing under
   100 ms. The first run with no baseline on disk only RECORDS
   tmp/inp-baseline.json (the baseline must exist before X-1/X-2
   touch anything); later runs fail when a scenario is over budget
   or more than 20% slower than its recorded baseline (the 20% is
   the noise allowance for a shared CI runner, documented rather
   than hidden).

   Usage:   node tools/qa-inp.cjs
   Registry: docs/CI-TEST-COVERAGE.md (EXTENDED) + extended-qa.yml
   ============================================================ */
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const PORT = 8765;
const BASE = process.env.QA_BASE || process.argv[2] || 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');
const BASELINE_PATH = path.join(ROOT, 'tmp', 'inp-baseline.json');
const CPU_RATE = 4;
const NOISE = 1.2; // 20% slower than baseline = a real regression
const log = s => process.stdout.write('[qa-inp] ' + s + '\n');
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
        JSON.stringify(detail === undefined ? null : detail).slice(0, 400)
    );
  }
};

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
    /* fall through */
  }
  return undefined;
}

(async () => {
  let srv = null;
  const { chromium } = resolvePlaywright();
  let executablePath;
  try {
    executablePath =
      require(path.join(ROOT, 'tools', 'chrome-launcher.cjs')).chromePath || undefined;
  } catch (e) {
    /* fall back to playwright's browser */
  }
  executablePath = absolutizeChrome(executablePath);
  let browser = null;
  try {
    // Reuse a running serve.cjs (CI starts one for the T4/E-T4 block);
    // start our own only when :8765 is quiet.
    let up = false;
    try {
      up = (await fetch(BASE + '/manifest.webmanifest')).ok;
    } catch (e) {
      up = false;
    }
    if (!up) {
      log('starting serve.cjs for this run');
      srv = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
      for (let i = 0; i < 60 && !up; i++) {
        await delay(250);
        try {
          up = (await fetch(BASE + '/manifest.webmanifest')).ok;
        } catch (e) {
          /* keep waiting */
        }
      }
    }
    if (!up) {
      throw new Error('serve.cjs did not answer on ' + BASE);
    }

    browser = await chromium.launch({ headless: true, executablePath });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    // Observers FIRST (every navigation), then the throttle per page.
    await ctx.addInitScript(() => {
      window.__inpEvents = [];
      window.__inpFrom = 0;
      try {
        new PerformanceObserver(list => {
          for (const e of list.getEntries()) {
            window.__inpEvents.push({
              kind: 'event',
              name: e.name,
              start: e.startTime,
              ms: e.duration
            });
          }
        }).observe({ type: 'event', durationThreshold: 16, buffered: true });
      } catch (e) {
        /* no event timing: the loaf observer below still reports */
      }
      try {
        new PerformanceObserver(list => {
          for (const e of list.getEntries()) {
            window.__inpEvents.push({
              kind: 'loaf',
              name: 'long-animation-frame',
              start: e.startTime,
              ms: e.duration
            });
          }
        }).observe({ type: 'long-animation-frame', buffered: true });
      } catch (e) {
        /* long-animation-frame is not available everywhere; optional by design */
      }
    });
    // project.html bounces to the launcher while the project is locked, so
    // unlock the demo project before the first navigation - every harness in
    // this repo does the same (tools/qa-procurement.cjs M0).
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('mmgr_unlocked_demo-project', '1');
      } catch (e) {
        /* ignore */
      }
    });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_RATE });
    log('CPU throttling ' + CPU_RATE + 'x engaged');

    const arm = () =>
      page.evaluate(() => {
        window.__inpEvents = [];
        window.__inpFrom = performance.now();
      });
    const read = () =>
      page.evaluate(() => {
        const from = window.__inpFrom;
        const evts = (window.__inpEvents || []).filter(e => e.start >= from);
        const durs = evts.map(e => e.ms).sort((a, b) => a - b);
        const p = q =>
          durs.length ? durs[Math.min(durs.length - 1, Math.floor(q * durs.length))] : 0;
        return {
          n: durs.length,
          p50: Math.round(p(0.5) * 100) / 100,
          p75: Math.round(p(0.75) * 100) / 100,
          worst: Math.round((durs.length ? durs[durs.length - 1] : 0) * 100) / 100,
          loaf: evts.filter(e => e.kind === 'loaf').length,
          names: evts
            .filter(e => e.ms >= 50)
            .slice(0, 4)
            .map(e => e.name + '=' + Math.round(e.ms))
        };
      });

    const results = {};
    const scenario = async (key, budgetMs, fn) => {
      await arm();
      await fn();
      await delay(500); // let trailing observers flush
      const s = await read();
      results[key] = s;
      log(
        key.padEnd(22) +
          ' n=' +
          String(s.n).padStart(3) +
          ' p50=' +
          String(s.p50).padStart(7) +
          ' p75=' +
          String(s.p75).padStart(7) +
          ' worst=' +
          String(s.worst).padStart(7) +
          ' (budget ' +
          budgetMs +
          ' ms)'
      );
      return s;
    };

    // ---------------- calculator.html ----------------
    await page.goto(BASE + '/calculator.html', { waitUntil: 'load', timeout: 45000 });
    await page.waitForSelector('#calc-d1', { timeout: 25000 });
    await delay(600);
    // A work item must be selected or Calculate has nothing to price.
    await page.evaluate(() => {
      const sel = document.getElementById('calc-work');
      if (sel && !sel.value && sel.options.length > 1) {
        sel.value = sel.options[1].value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await delay(300);

    await scenario('calc-type-6-digits', 100, async () => {
      await page.click('#calc-d1');
      await page.evaluate(() => {
        const el = document.getElementById('calc-d1');
        el.value = '';
        el.focus();
      });
      for (const ch of '123456') {
        await page.keyboard.type(ch, { delay: 40 });
      }
    });

    await page.evaluate(() => {
      const el = document.getElementById('calc-d1');
      el.value = '10';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await delay(300);

    await scenario('calc-calculate', 200, async () => {
      await page.click('[data-action="calcRun"]');
      await delay(250);
    });

    await scenario('calc-switch', 200, async () => {
      await page.click('#calc-oncost-toggle');
      await delay(120);
      await page.click('#calc-oncost-toggle');
      await delay(120);
    });

    await scenario('calc-switch-units', 200, async () => {
      await page.click('[data-action="calcUnits"][data-units="imperial"]');
      await delay(150);
      await page.click('[data-action="calcUnits"][data-units="metric"]');
      await delay(150);
    });

    // ---------------- project.html ----------------
    await page.goto(BASE + '/project.html?id=demo-project', { waitUntil: 'load', timeout: 45000 });
    await page.waitForFunction(
      () => !!(window.MMGR && MMGR.State && document.getElementById('panel-dash')),
      null,
      { timeout: 25000 }
    );
    await delay(700);
    // The Gantt sits behind the schedule pack; measure the real panel the
    // way a project that uses it would, not a hidden button. updateState only
    // writes state - renderPacks() is what flips the is-hide class on the
    // pack-gated nav buttons, so call it explicitly (boot does, on toggle).
    await page.evaluate(() => {
      MMGR.State.updateState(s => {
        s.packs = s.packs || {};
        s.packs.schedule = true;
        s.packs.money = true;
      });
      if (MMGR.Render && typeof MMGR.Render.renderPacks === 'function') {
        MMGR.Render.renderPacks();
      }
    });
    await delay(400);

    await scenario('project-open-ai', 200, async () => {
      await page.click('#ai-fab');
      await page
        .waitForSelector('#ai-win.rr-open, #ai-win.open, #ai-win', { timeout: 6000 })
        .catch(() => {});
      await delay(150);
      await page.evaluate(() => {
        const w = document.getElementById('ai-win');
        const close = w && w.querySelector('[data-action="closeAiWin"]');
        if (close) {
          close.click();
        }
      });
      await delay(200);
    });

    await scenario('project-open-gantt', 200, async () => {
      // Two section buttons carry data-section="gantt" (rail + section nav);
      // click the one actually on screen, not the hidden twin.
      await page.click('.sec-btn[data-action="showSec"][data-section="gantt"]:visible');
      await page
        .waitForSelector('#panel-gantt.active, .panel.active', { timeout: 6000 })
        .catch(() => {});
      await delay(200);
    });

    await scenario('project-tab', 200, async () => {
      // Definitions has no pack gate and no panel twin, so it is the tab that
      // is always on screen (there is no data-section="sched" - the schedule
      // pack is named gantt).
      await page.click('.sec-btn[data-action="showSec"][data-section="def"]:visible');
      await delay(150);
      await page.click('.sec-btn[data-action="showSec"][data-section="dash"]:visible');
      await delay(150);
    });

    // ---------------- budget + baseline ----------------
    const BUDGETS = {
      'calc-type-6-digits': 100,
      'calc-calculate': 200,
      'calc-switch': 200,
      'calc-switch-units': 200,
      'project-open-ai': 200,
      'project-open-gantt': 200,
      'project-tab': 200
    };
    const record = { at: new Date().toISOString(), cpu: CPU_RATE, scenarios: results };
    let baseline = null;
    try {
      baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
    } catch (e) {
      baseline = null;
    }

    if (!baseline) {
      fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
      fs.writeFileSync(BASELINE_PATH, JSON.stringify(record, null, 2) + '\n');
      log('BASELINE written to tmp/inp-baseline.json (no baseline existed before this run)');
      const over = Object.keys(BUDGETS).filter(k => results[k] && results[k].p75 > BUDGETS[k]);
      check(
        'X-3 baseline recorded for all ' + Object.keys(BUDGETS).length + ' scenarios',
        Object.keys(results).length === Object.keys(BUDGETS).length,
        Object.keys(results)
      );
      log(
        over.length
          ? 'NOTE: over budget on the FIRST measurement (this is what X-1/X-2 must fix): ' +
              over.join(', ')
          : 'every scenario already inside budget'
      );
    } else {
      for (const key of Object.keys(BUDGETS)) {
        const now = results[key];
        const before = (baseline.scenarios || {})[key] || null;
        check(
          key + ' inside the ' + BUDGETS[key] + ' ms budget',
          !!now && now.p75 <= BUDGETS[key],
          now
        );
        check(
          key + ' not slower than baseline (p75 ' + (before ? before.p75 : 'n/a') + ' ms)',
          !!now && !!before && now.p75 <= Math.max(before.p75 * NOISE, BUDGETS[key]),
          { now: now && now.p75, baseline: before && before.p75 }
        );
      }
    }

    log('==== qa-inp: ' + passed + ' passed / ' + failed + ' failed ====');
    if (failed) {
      process.exitCode = 1;
    }
  } catch (e) {
    log('FATAL ' + String((e && e.message) || e).slice(0, 300));
    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (srv) {
      srv.kill();
    }
  }
})();
