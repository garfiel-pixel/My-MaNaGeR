/* ============================================================
   tools/qa-widescreen.cjs - the app fills the monitor it opens on
   ------------------------------------------------------------
   Owner report (2026-10-19): on a huge monitor the app section did not cover
   the screen - a narrow column sat in a wide field of empty background.

   Cause: three fixed caps - `.wrap` 1080px (app.html), `#app-main` 1600px
   (project.html workspace), `.bcp-main` 1080px (calculator) - plus 1000px on
   admin.html's `main`. css/mmgr.css now lifts every cap above 1200px so the
   column grows into the space the rail leaves; below 1200px the old reading
   width still governs.

   Gates (W1..W5):
     W1 wide: at 2560 and 3440 the app column reaches within 40px of the
            window's right edge on app.html, project.html, calculator.html
            and admin.html.
     W2 narrow is unchanged: at 1024 the launcher column never exceeds its
       1080px reading width (the lift must not leak downwards).
     W3 no horizontal overflow anywhere: document scroll width stays inside
            the viewport at 390, 768, 1280 and 3440 (a fill that pushes a
            scrollbar is a regression, not a fit).
     W4 the printed sheet keeps its width: the print media query never sees
            a >=1200px canvas, so calculator.html's print view must still
            resolve .bcp-main at <=1080px under print emulation.
     W5 dark palette holds the same geometry (the fill is width, not theme).

   Usage:   node tools/qa-widescreen.cjs
   Registry: docs/CI-TEST-COVERAGE.md + ci.yml (T4 block, serve.cjs)
   ============================================================ */
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const PORT = 8765;
const BASE = process.env.QA_BASE || 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');
const log = s => process.stdout.write('[qa-widescreen] ' + s + '\n');
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
        JSON.stringify(detail === undefined ? null : detail).slice(0, 300)
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

(async () => {
  let srv = null;
  const { chromium } = resolvePlaywright();
  let executablePath;
  try {
    executablePath =
      require(path.join(ROOT, 'tools', 'chrome-launcher.cjs')).chromePath || undefined;
  } catch (e) {
    /* playwright's own browser */
  }
  let browser = null;
  try {
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

    browser = await chromium.launch({
      headless: true,
      executablePath,
      args: ['--disk-cache-size=0']
    });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    // The workspace redirects to the launcher while the project is locked;
    // unlock it the way every harness does, before the first navigation.
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('mmgr_unlocked_demo-project', '1');
      } catch (e) {
        /* ignore */
      }
    });
    const page = await ctx.newPage();

    // measure(): viewport-relative geometry of the page's content column.
    const measure = () =>
      page.evaluate(() => {
        const pick =
          document.querySelector('.wrap') ||
          document.getElementById('app-main') ||
          document.querySelector('.bcp-main') ||
          document.querySelector('main');
        const r = pick ? pick.getBoundingClientRect() : null;
        return {
          vw: document.documentElement.clientWidth,
          scrollW: document.documentElement.scrollWidth,
          sel: pick ? pick.className || pick.tagName : 'none',
          x: r ? Math.round(r.x) : 0,
          w: r ? Math.round(r.width) : 0,
          right: r ? Math.round(r.right) : 0,
          maxW: pick ? getComputedStyle(pick).maxWidth : 'n/a'
        };
      });

    // admin.html keeps its whole panel behind the password gate (#admin-app is
    // display:none until the setup/login flow runs), so there is no content
    // column to measure until it is opened. Same recipe as
    // tools/verify-controls-admin.cjs S3: set the password, then park through
    // the show-once recovery modal (PBKDF2 needs a beat).
    const unlockAdmin = async () => {
      await page.evaluate(() => {
        const setup = document.getElementById('setup-screen');
        if (setup && !setup.classList.contains('hidden')) {
          const p1 = document.getElementById('setup-pass1');
          const p2 = document.getElementById('setup-pass2');
          if (p1 && p2) {
            p1.value = 'WideScreen123!';
            p2.value = 'WideScreen123!';
          }
          const b = setup.querySelector('[data-action="adminSetupPassword"]');
          if (b) {
            b.click();
          }
        }
        const login = document.getElementById('login-screen');
        if (login && !login.classList.contains('hidden')) {
          const p = document.getElementById('login-pass');
          if (p) {
            p.value = 'WideScreen123!';
          }
          const b = login.querySelector('[data-action="adminLogin"]');
          if (b) {
            b.click();
          }
        }
      });
      for (let t = 0; t < 24; t++) {
        const state = await page.evaluate(() => {
          const om = document.getElementById('rc-om');
          const app = document.getElementById('admin-app');
          if (app && !app.classList.contains('hidden')) {
            return 'unlocked';
          }
          if (om && om.classList.contains('show')) {
            const cb = document.getElementById('rc-saved-cb');
            if (cb && !cb.checked) {
              cb.checked = true;
              cb.dispatchEvent(new Event('change', { bubbles: true }));
            }
            const done = document.querySelector('#rc-om [data-action="confirmRecoverySaved"]');
            if (done) {
              done.click();
            }
          }
          return 'waiting';
        });
        if (state === 'unlocked') {
          return true;
        }
        await delay(500);
      }
      return false;
    };

    const PAGES = [
      { name: 'app', url: '/app.html' },
      { name: 'project', url: '/project.html?id=demo-project' },
      { name: 'calculator', url: '/calculator.html' },
      { name: 'admin', url: '/admin.html' }
    ];

    // ---- W1: wide monitors, the column must reach the right edge ----
    for (const vw of [2560, 3440]) {
      await page.setViewportSize({ width: vw, height: 1200 });
      for (const p of PAGES) {
        await page.goto(BASE + p.url, { waitUntil: 'load', timeout: 45000 });
        await page.waitForTimeout(1200);
        if (p.name === 'admin' && !(await unlockAdmin())) {
          check('W1 admin@' + vw + ' could not pass the password gate', false, 'gate stayed shut');
          continue;
        }
        await page.waitForTimeout(400);
        const m = await measure();
        const gap = m.vw - m.right;
        check(
          'W1 ' +
            p.name +
            '@' +
            vw +
            ' fills the window (right gap ' +
            gap +
            'px, cap ' +
            m.maxW +
            ')',
          gap <= 40 && m.w >= m.vw * 0.85,
          m
        );
      }
    }

    // ---- W2: the lift must NOT leak below the breakpoint ----
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto(BASE + '/app.html', { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(1000);
    const narrow = await measure();
    check(
      'W2 app@1024 keeps the 1080px reading width (got ' +
        narrow.w +
        'px, cap ' +
        narrow.maxW +
        ')',
      narrow.w <= 1080 && narrow.maxW === '1080px',
      narrow
    );

    // ---- W3: no horizontal overflow at any width ----
    for (const vw of [390, 768, 1280, 3440]) {
      await page.setViewportSize({ width: vw, height: 900 });
      for (const p of PAGES) {
        await page.goto(BASE + p.url, { waitUntil: 'load', timeout: 45000 });
        await page.waitForTimeout(700);
        const m = await measure();
        check(
          'W3 ' +
            p.name +
            '@' +
            vw +
            ' has no horizontal overflow (scroll ' +
            m.scrollW +
            ' vs ' +
            m.vw +
            ')',
          m.scrollW <= m.vw + 2,
          m
        );
      }
    }

    // ---- W4: print keeps the sheet width (print canvas is ~816px) ----
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE + '/calculator.html', { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(800);
    const printed = await page.evaluate(async () => {
      // Ask the CSS parser what print sees: clone the sheets into a print
      // media frame and read the resolved width of .bcp-main.
      const frame = document.createElement('iframe');
      frame.style.cssText = 'position:absolute;left:-10000px;top:0;width:816px;height:1056px;';
      document.body.appendChild(frame);
      const doc = frame.contentDocument;
      doc.body.className = 'calculator-page';
      const main = doc.createElement('main');
      main.className = 'bcp-main';
      doc.body.appendChild(main);
      for (const sheet of document.styleSheets) {
        try {
          const s = doc.createElement('style');
          s.textContent = [...sheet.cssRules].map(r => r.cssText).join('\n');
          doc.head.appendChild(s);
        } catch (e) {
          /* cross-origin sheet: none here */
        }
      }
      await new Promise(r => setTimeout(r, 250));
      const w = frame.contentWindow;
      // The iframe renders at paper width, so this is exactly what print sees:
      // the wide-screen query must NOT match, and the 1080px cap must govern.
      const applies = w.matchMedia('(min-width: 1200px)').matches;
      const width = w.getComputedStyle(main).maxWidth;
      const rect = main.getBoundingClientRect().width;
      frame.remove();
      return { width, rect, wideQueryApplies: applies };
    });
    check(
      'W4 print canvas keeps .bcp-main capped (max-width ' +
        printed.width +
        ', wide query applies: ' +
        printed.wideQueryApplies +
        ')',
      printed.wideQueryApplies === false && printed.width === '1080px',
      printed
    );

    // ---- W5: dark palette holds the same geometry ----
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('mmgr_theme', 'dark');
      } catch (e) {
        /* ignore */
      }
    });
    await page.setViewportSize({ width: 2560, height: 1200 });
    await page.goto(BASE + '/app.html', { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(1000);
    const dark = await measure();
    const darkGap = dark.vw - dark.right;
    check(
      'W5 app@2560 dark fills the window (right gap ' + darkGap + 'px)',
      darkGap <= 40 &&
        dark.w >= dark.vw * 0.85 &&
        (await page.evaluate(() => document.body.classList.contains('dark-mode'))),
      dark
    );

    log('==== qa-widescreen: ' + passed + ' passed / ' + failed + ' failed ====');
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
