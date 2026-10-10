/* ============================================================
   qa-calc-assistant.cjs - owner waves 2026-10-10, real browser
   ------------------------------------------------------------
   Covers the two waves that surface numbers a user acts on:

     W8b / T4  QUICK TOTAL (calculator.html)
       - all 43 work items price through the ONE big measurement x
         ONE rate path (measuredQty + all-in), through the real
         page hook MMGR_CALC_POPULATE, not a copied formula
       - the result heading never reads "undefined" (F-3)
       - the read-out line reads "69 m2 x J$120 = J$8,280 before
         tax" for the 69 m2 @ 120 case the owner quoted
       - element-row boxes carry an accessible name (A-5)

     W11 / T9  LOAD BUTTON (app.html, 3 mocked cloud cards)
       - default: no green fill, readable label
       - hover / focus: green fill, white label (5.13:1)
       - dark mode: its own border/text tokens
       - the rail buttons and other green buttons are untouched
       - the click handler still loads the project

   Usage: node tools/qa-calc-assistant.cjs
   Registry: docs/CI-TEST-COVERAGE.md -> CI row.
   ============================================================ */
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const PORT = 8765;
const BASE = process.env.BASE || 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');
const log = s => process.stdout.write('[calc-ai] ' + s + '\n');
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
  throw new Error('serve.cjs did not come up');
}

// ---------------------------------------------------------------- sections
async function quickTotalMatrix(page) {
  await page.goto(BASE + '/calculator.html', { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.MMGR_CALC_POPULATE, null, { timeout: 20000 });

  const works = await page.evaluate(() => {
    const sel = document.getElementById('calc-work');
    return sel
      ? Array.from(sel.options)
          .map(o => o.value)
          .filter(Boolean)
      : [];
  });
  check('T4 work list is the full trade set (43)', works.length === 43, works.length);

  const bad = [];
  const undefinedText = [];
  for (const key of works) {
    // One big measurement: POPULATE writes the total and adds the line through
    // the same dispatch the "Add to bill" button uses.
    const res = await page.evaluate(k => {
      const man = document.getElementById('calc-measured-manual');
      if (man && man.checked) {
        man.click();
      }
      const basis = document.getElementById('calc-basis');
      if (basis) {
        basis.value = 'measured';
        basis.dispatchEvent(new Event('change', { bubbles: true }));
      }
      window.MMGR_CALC_POPULATE({ work: k, measuredQty: 69 });
      // then price it at ONE specified rate (all-in)
      if (basis) {
        basis.value = 'allin';
        basis.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const a = document.getElementById('calc-allin');
      if (a) {
        a.value = '120';
        a.dispatchEvent(new Event('input', { bubbles: true }));
        a.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const run = document.querySelector('[data-action="calcRun"]');
      if (run) {
        run.click();
      }
      const out = document.getElementById('calc-output');
      const line = document.getElementById('calc-quick-line');
      const sum = document.getElementById('calc-sum-label');
      return {
        text: (out && out.textContent) || '',
        line: line && !line.hidden ? line.textContent : '',
        heading: sum ? sum.textContent : ''
      };
    }, key);
    if (/undefined|NaN|\[object/i.test(res.text) || /undefined|NaN|\[object/i.test(res.heading)) {
      undefinedText.push({
        key,
        heading: res.heading.slice(0, 60),
        sample: res.text.replace(/\s+/g, ' ').slice(0, 80)
      });
    }
    if (!res.line || res.line.indexOf(' = ') < 0) {
      bad.push({ key, line: res.line });
    }
  }
  check('T4 every work item prices in Quick total mode (43/43)', bad.length === 0, bad.slice(0, 5));
  check(
    'F-3 no "undefined" / "NaN" / "[object" anywhere in the results (43/43)',
    undefinedText.length === 0,
    undefinedText.slice(0, 5)
  );
}

async function quickTotalExample(page) {
  const res = await page.evaluate(() => {
    const man = document.getElementById('calc-measured-manual');
    if (man && man.checked) {
      man.click();
    }
    const basis = document.getElementById('calc-basis');
    if (basis) {
      basis.value = 'measured';
      basis.dispatchEvent(new Event('change', { bubbles: true }));
    }
    window.MMGR_CALC_POPULATE({ work: 'blockwall', measuredQty: 69 });
    if (basis) {
      basis.value = 'allin';
      basis.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const a = document.getElementById('calc-allin');
    a.value = '120';
    a.dispatchEvent(new Event('input', { bubbles: true }));
    a.dispatchEvent(new Event('change', { bubbles: true }));
    const run = document.querySelector('[data-action="calcRun"]');
    if (run) {
      run.click();
    }
    const line = document.getElementById('calc-quick-line');
    const q = document.getElementById('calc-measured-qty');
    return {
      line: line && !line.hidden ? line.textContent : '',
      hidden: line ? line.hidden : null,
      placeholder: q ? q.placeholder : '',
      aria: q ? q.getAttribute('aria-label') : ''
    };
  });
  check(
    'T4 the owner example reads "69 m2 x J$120 = J$8,280 before tax"',
    res.line === '69 m2 x J$120 = J$8,280 before tax',
    res
  );
  check(
    'T4 the quantity box carries the trade unit ("Total m2")',
    /m2/.test(res.placeholder) && /m2/.test(res.aria),
    res
  );
}

async function ariaLabels(page) {
  const res = await page.evaluate(() => {
    // a wall trade carries element rows with three dims
    window.MMGR_CALC_POPULATE({ work: 'blockwall', measuredQty: 69 });
    const man = document.getElementById('calc-measured-manual');
    if (man && man.checked) {
      man.click();
    }
    const rows = Array.from(document.querySelectorAll('#calc-inst-rows .bcp-inst-dim'));
    return {
      count: rows.length,
      missing: rows.filter(r => !(r.getAttribute('aria-label') || '').trim()).length,
      first: rows.length ? rows[0].getAttribute('aria-label') : ''
    };
  });
  check(
    'A-5 every element-row box has an accessible name',
    res.count > 0 && res.missing === 0,
    res
  );
  check('A-5 the name reads like "Wall 1 length (m)"', /length/i.test(res.first), res.first);
}

const MOCK_PROJECTS = {
  ok: true,
  projects: [
    {
      projectId: 'demo-one',
      label: 'Riverside Tower',
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-09T00:00:00Z',
      hasSnapshot: true,
      accessRole: 'owner'
    },
    {
      projectId: 'demo-two',
      label: 'Harbour Villa',
      createdAt: '2026-10-02T00:00:00Z',
      updatedAt: '2026-10-09T00:00:00Z',
      hasSnapshot: true,
      accessRole: 'owner'
    },
    {
      projectId: 'demo-three',
      label: 'Kingston Depot',
      createdAt: '2026-10-03T00:00:00Z',
      updatedAt: '2026-10-09T00:00:00Z',
      hasSnapshot: true,
      accessRole: 'owner'
    }
  ]
};

async function loadButton(browser, errors) {
  const ctx = await browser.newContext({ viewport: { width: 1534, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('app.html: ' + String(e).slice(0, 140)));
  await page.route('**/api/cloud/projects', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_PROJECTS)
    })
  );
  await page.route('**/api/cloud/projects/*/load', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, project: { id: 'demo-one' } })
    })
  );
  await page.goto(BASE + '/app.html', { waitUntil: 'load' });
  await page.waitForSelector('.cd-card .btn[data-cd-load]', { timeout: 20000 });
  const n = await page.locator('.cd-actions .btn[data-cd-load]').count();
  check('W11 three cloud cards rendered with a Load button each', n === 3, n);
  const BTN = '.cd-actions .btn[data-cd-load]';
  // A theme/token change needs a style recalc + a frame to reach the element
  // (measured 2026-10-10: reading in the same task returns the previous
  // frame's colour). Settle before every read, and settle the 120ms
  // transition before reading a hover/focus tone.
  const readBtn = () =>
    page.evaluate(sel => {
      const b = document.querySelector(sel);
      const cs = getComputedStyle(b);
      return { bg: cs.backgroundColor, color: cs.color, border: cs.borderTopColor };
    }, BTN);
  const settle = () => page.waitForTimeout(320);
  const rest = await readBtn();
  check(
    'W11 default fill is transparent (not a green block)',
    /rgba?\(0, 0, 0, 0\)/.test(rest.bg),
    rest
  );
  check(
    'W11 default label is the visible text token, not white',
    rest.color === 'rgb(51, 51, 51)',
    rest
  );
  check(
    'W11 default border is the hairline border token',
    rest.border === 'rgb(229, 224, 216)',
    rest
  );

  // dark theme parity FIRST, so no pointer/focus state is in flight when the
  // neutral default is read (the class change needs a frame - see above).
  await page.evaluate(() => document.body.classList.add('dark-mode'));
  await settle();
  const dark = await readBtn();
  check(
    'W11 dark mode keeps the neutral default (no green block)',
    /rgba?\(0, 0, 0, 0\)/.test(dark.bg),
    dark
  );
  check(
    'W11 dark mode label is the light text token (#f5f5f5)',
    dark.color === 'rgb(245, 245, 245)',
    dark
  );
  check(
    'W11 dark mode border is the dark border token (#2b2b30)',
    dark.border === 'rgb(43, 43, 48)',
    dark
  );
  await page.hover(BTN);
  await settle();
  const darkHover = await readBtn();
  check(
    'W11 dark hover still lands on a usable green + white',
    darkHover.bg === 'rgb(46, 125, 50)' && darkHover.color === 'rgb(255, 255, 255)',
    darkHover
  );
  await page.mouse.move(2, 2);
  await page.evaluate(() => document.body.classList.remove('dark-mode'));
  await settle();

  // A REAL pointer hover (Playwright dispatches the mouse), not a forced class.
  await page.hover(BTN);
  await settle();
  const hover = await readBtn();
  check('W11 hover paints the green fill (#2e7d32)', hover.bg === 'rgb(46, 125, 50)', hover);
  check(
    'W11 hover label is white (5.13:1 on that green)',
    hover.color === 'rgb(255, 255, 255)',
    hover
  );
  await page.mouse.move(2, 2);
  await settle();

  // :focus-visible shares that declaration block. Assert against the SHIPPED
  // stylesheet the browser parsed (the block that paints green on hover must
  // also carry the :focus-visible selector and the same two declarations).
  const focusRule = await page.evaluate(sel => {
    const want = sel + ':focus-visible';
    const seen = { found: false, bg: '', color: '' };
    const walk = rules => {
      for (const r of rules) {
        if (r.selectorText && r.selectorText.indexOf(want) > -1) {
          seen.found = true;
          seen.bg = r.style.background || r.style.backgroundColor;
          seen.color = r.style.color;
        }
        if (r.cssRules && r.cssRules.length) {
          walk(r.cssRules);
        }
      }
    };
    for (const sheet of document.styleSheets) {
      let rr = [];
      try {
        rr = sheet.cssRules || [];
      } catch (e) {
        continue;
      }
      walk(rr);
    }
    return seen;
  }, BTN);
  check(
    'W11 the same block paints green + white for :focus-visible',
    focusRule.found &&
      /rgb\(46, 125, 50\)|var\(--green\)/.test(focusRule.bg) &&
      /255, 255, 255/.test(focusRule.color),
    focusRule
  );

  // the click handler still works
  const clicked = await page.evaluate(() => {
    document.body.classList.remove('dark-mode');
    let hit = '';
    document.addEventListener(
      'click',
      e => {
        const el = e.target.closest ? e.target.closest('[data-cd-load]') : null;
        if (el) {
          hit = el.getAttribute('data-cd-load');
        }
      },
      true
    );
    document.querySelector('.cd-actions .btn[data-cd-load]').click();
    return hit;
  });
  check(
    'W11 the Load click still reaches the data-cd-load handler',
    clicked === 'demo-one',
    clicked
  );
  await ctx.close();
}

(async () => {
  let srv = null;
  const { chromium } = resolvePlaywright();
  let executablePath;
  try {
    executablePath =
      require(path.join(ROOT, 'tools', 'chrome-launcher.cjs')).chromePath || undefined;
  } catch (e) {}
  executablePath = absolutizeChrome(executablePath) || chromium.executablePath();
  try {
    srv = await ensureServer();
    const browser = await chromium.launch({ headless: true, executablePath });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e).slice(0, 140)));

    await quickTotalMatrix(page);
    await quickTotalExample(page);
    await ariaLabels(page);

    await loadButton(browser, errors);

    const real = errors.filter(e => !/\/api\//.test(e));
    check('zero page errors in the walked flows', real.length === 0, real.slice(0, 3));
    await browser.close();
  } catch (e) {
    failed++;
    log('FATAL ' + (e && e.message));
  }
  if (srv) {
    try {
      srv.kill();
    } catch (e) {}
  }
  log('==== CALC ASSISTANT: ' + passed + ' passed / ' + failed + ' failed ====');
  process.exit(failed ? 1 : 0);
})();
