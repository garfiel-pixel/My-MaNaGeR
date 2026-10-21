/* ============================================================
   tools/qa-procurement.cjs - PART H Procurement tab gate
   ------------------------------------------------------------
   The supplier price book + AI quote panel (CONTINUATION-
   DIRECTIVE H5.10 / H8.4). Real browser (Playwright + the
   repo's chrome-launcher), against serve.cjs.

   Gates:
     M1-M4  migration v19 -> v20 seeds supplierBook, keeps the C10
            material-order rows, seeds packs.procurement=false, and
            the tab ships HIDDEN until its pack is switched on (D2).
     S1     the panel structure: vendors column, 10-column items
            table (Min order joined with P4), subtotal line, quote (supplier select, tone
            select, Write quote, Copy, output region).
     V1/V2  add supplier lands, focus jumps to the name field, the
            typed name renders in the row and the count updates.
     I1/I2  three items with prices; keyboard disclosure (focus +
            Enter) sets aria-expanded=true, reveals the detail
            panel, and the items are listed with their prices.
     T1/T2  subtotal is EXACT and is always
            MMGR.Prompts.bookTotals(...).verdict (one source);
            a price edit stamps quotedAt (fresh) + quotedBy.
     X1/X2  H7.3 injection surface: a supplier and an item named
            `<img onerror=alert(1)>` land as LITERAL TEXT, no
            element is injected, zero page errors.
     R1     persistence across a REAL reload.
     A1/A2  axe-core on #panel-proc in light AND dark: zero
            serious/critical violations.
     RO     view-only cannot mutate the book (READONLY guard).
     Q1     signed-in quote: the relay is called ONCE, the prompt
            carries the full supplier context, the output is the
            model's reply, state.aiOutputs.quote is written, Copy
            is revealed.
     Q2     H7.2 quote integrity: every money token in the output
            appears byte-for-byte in
            MMGR.Prompts.context({vendorId}); a doctored sample
            FAILS the same check (the detector has teeth).
     Q3-Q8  the H4 behaviour matrix: signed out -> draft + sign-in
            note; offline -> draft + connection note + ZERO relay
            requests; 402 -> quota note; 503 -> busy note; engine
            Off -> off note + zero relay requests; empty book ->
            plain-language guard + zero relay requests. Never an
            empty box.
     E1     zero page errors across every flowed gate.

   Usage:   node tools/qa-procurement.cjs
   Registry: docs/CI-TEST-COVERAGE.md (CI row) + ci.yml step.
   ============================================================ */
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const PORT = 8765;
const BASE = process.env.QA_BASE || process.argv[2] || 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');
const log = s => process.stdout.write('[procurement] ' + s + '\n');
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
        JSON.stringify(detail === undefined ? null : detail).slice(0, 500)
    );
  }
};

// ---- kit copied from tools/qa-calc-assistant.cjs (H7.2) ----
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

function axeSource() {
  const candidates = [];
  try {
    candidates.push(require.resolve('axe-core/axe.min.js'));
  } catch (e) {
    /* not resolvable from here */
  }
  candidates.push(path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'));
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return fs.readFileSync(c, 'utf8');
    }
  }
  throw new Error('axe-core not found - npm i -D axe-core');
}

async function ensureServer() {
  try {
    const h = await fetch(BASE + '/project.html');
    if (h.ok || h.status === 307 || h.status === 301) {
      return null;
    }
  } catch (e) {}
  log('starting serve.cjs for this run');
  const srv = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 30; i++) {
    await delay(1000);
    try {
      const h = await fetch(BASE + '/project.html');
      if (h.ok || h.status === 307) {
        return srv;
      }
    } catch (e) {}
  }
  throw new Error('serve.cjs did not come up');
}

const VISIBLE = el => {
  if (!el) {
    return false;
  }
  return (
    !el.hidden &&
    el.offsetParent !== null &&
    getComputedStyle(el).display !== 'none' &&
    getComputedStyle(el).visibility !== 'hidden'
  );
};

// The security review's quote-reply builder: the MODEL's reply is built
// only from the money lines that were actually inside the request's
// supplier context, so Q2's integrity assertion is a real statement
// about byte-identical figures, not about a hand-written constant.
function quoteFromBody(body) {
  try {
    const j = JSON.parse(body);
    const msgs = (j && j.messages) || [];
    for (const m of msgs) {
      const c = String((m && m.content) || '');
      if (c.indexOf('SUPPLIER PRICE BOOK') !== -1) {
        const moneyLines = c
          .split('\n')
          .filter(l => l.indexOf('J$') !== -1)
          .map(l => l.trim());
        if (!moneyLines.length) {
          return 'No prices found in the data, nothing to quote.';
        }
        return (
          'Dear supplier,\n\nPrices we have on record from your sheet:\n' +
          moneyLines.join('\n') +
          '\n\nRegards,\nQA Officer'
        );
      }
    }
  } catch (e) {}
  return '';
}

(async () => {
  const AXE = axeSource();
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
    srv = await ensureServer();
    browser = await chromium.launch({ headless: true, executablePath });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const pageErrors = [];
    const page = await ctx.newPage();
    page.on('pageerror', e => pageErrors.push(String((e && e.message) || e).slice(0, 160)));

    // Demo project must be unlocked + FULL scope, seeded before every
    // navigation (same contract the other harnesses use).
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('mmgr_unlocked_demo-project', '1');
        localStorage.setItem('mmgr_scope_demo-project', 'full');
        // Theme is armed per navigation (A2 boots the page in dark rather
        // than toggling body.dark-mode after load - see the A1/A2 block).
        let theme = 'light';
        try {
          theme = sessionStorage.getItem('qa_theme') || 'light';
        } catch (e) {}
        localStorage.setItem('mmgr_theme', theme);
      } catch (e) {}
      // M1/M2 fixture: ONE definition, available to the M1 evaluate (which
      // calls it directly) and to the reload (which needs it re-applied).
      window.__qaShapeV19 = function () {
        const raw = JSON.parse(localStorage.getItem('mmgr_state_demo-project') || '{}');
        delete raw.qaSeed;
        raw.schemaVersion = 19;
        delete raw.supplierBook;
        raw.procurement = [{ id: 'PO1', material: 'Cement', vendor: 'C10 row' }];
        raw.packs = raw.packs || {};
        delete raw.packs.procurement;
        raw.config = raw.config || {};
        raw.config.ai = raw.config.ai || {};
        raw.config.ai.tier = 'local';
        localStorage.setItem('mmgr_state_demo-project', JSON.stringify(raw));
        return {
          ok: raw.schemaVersion === 19 && raw.procurement.length === 1,
          keys: Object.keys(raw).length
        };
      };
      // M2 fixture seed. The app writes the project state back on teardown
      // (probe 2026-10-18: a save from dist/bundle.js lands DURING the
      // navigation and overwrites whatever the page just stored), so the v19
      // fixture has to be written by the NEXT document before any of its own
      // scripts run. The M1 evaluate arms this one-shot flag.
      try {
        if (sessionStorage.getItem('qa_v19_arm') === '1') {
          sessionStorage.removeItem('qa_v19_arm');
          // The crash journal (IndexedDB `mmgr_journal`) still holds the
          // pre-fixture save, and restoreFromJournal() adopts it whenever it
          // differs from localStorage (probe 2026-10-18: the boot save that
          // failed M2 came from that path, not from a teardown write). Drop
          // it before any page script runs so the boot migrates OUR fixture.
          try {
            indexedDB.deleteDatabase('mmgr_journal');
          } catch (e) {}
          window.__qaShapeV19();
        }
      } catch (e) {}
    });

    // Signed-in owner by default; the quote gates flip these per gate.
    const auth = { signedIn: true };
    await ctx.route('**/api/auth/me', route =>
      route.fulfill(
        auth.signedIn
          ? {
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ ok: true, user: { email: 'owner@example.com' } })
            }
          : { status: 401, contentType: 'application/json', body: JSON.stringify({ ok: false }) }
      )
    );
    // The relay is MOCKED (copied kit): mode selects the H4 failure
    // surface; echo builds the reply from the request's OWN context.
    const relay = { mode: 'echo', bodies: [] };
    await ctx.route('**/api/ai/chat', route => {
      const body = route.request().postData() || '';
      relay.bodies.push(body);
      if (relay.mode === '401' || relay.mode === '402' || relay.mode === '503') {
        return route.fulfill({
          status: Number(relay.mode),
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, error: 'mocked ' + relay.mode })
        });
      }
      const text = quoteFromBody(body);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, text: text || 'Understood.', remaining: 4 })
      });
    });

    const booted = async () => {
      await page.waitForFunction(
        () => !!(window.MMGR && MMGR.State && document.getElementById('panel-dash')),
        null,
        { timeout: 25000 }
      );
      await page.waitForTimeout(700);
    };
    // NOTE (2026-10-17 probe): the rail original lives inside NAV.sec-nav
    // (display:none at this viewport); the VISIBLE button is the topbar
    // clone. Always target the :visible instance.
    const openProc = async () => {
      await page.click('.sec-btn[data-section="proc"]:visible');
      await page.waitForSelector('#panel-proc.active', { timeout: 6000 });
      await page.waitForTimeout(250);
    };
    // Programmatic set: value + input + change through the real
    // delegation (synthetic events DO reach document listeners; the
    // change lands the module's re-render exactly like a blur).
    const setField = async (sel, val) => {
      await page.waitForSelector(sel, { timeout: 6000 });
      await page.evaluate(
        ([s, v]) => {
          const el = document.querySelector(s);
          if (!el) {
            throw new Error('missing ' + s);
          }
          el.value = v;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        },
        [sel, val]
      );
      await page.waitForTimeout(120);
    };
    const lastRow = field => '#proc-item-body tr:last-child input[data-field="' + field + '"]';
    const waitPersisted = async needle => {
      for (let i = 0; i < 40; i++) {
        const ok = await page.evaluate(
          n => (localStorage.getItem('mmgr_state_demo-project') || '').indexOf(n) !== -1,
          needle
        );
        if (ok) {
          return true;
        }
        await delay(150);
      }
      return false;
    };

    // ANY instance visible (rail original + topbar clone both carry the
    // data-section; the rail one sits inside a hidden NAV at this viewport).
    const btnVisible = () =>
      page.evaluate(() => {
        const els = [...document.querySelectorAll('.sec-btn[data-section="proc"]')];
        return els.some(
          el =>
            !el.hidden &&
            !el.classList.contains('is-hide') &&
            el.offsetParent !== null &&
            getComputedStyle(el).display !== 'none'
        );
      });

    // ---------------- CTX 1: migration + pack gate ----------------
    await page.goto(BASE + '/project.html?id=demo-project', { waitUntil: 'load', timeout: 45000 });
    await booted();
    // Nothing is persisted at boot (probe 2026-10-17: boot state has
    // tasks:[] but localStorage is empty). Force a real save first, or the
    // fixture below would be shaped from {} and the migrated state would
    // have no tasks/risks arrays - validate() would rightly fail M2.
    await page.evaluate(() => {
      MMGR.State.updateState(function (s) {
        s.qaSeed = true;
      });
    });
    await page.waitForFunction(
      () => (localStorage.getItem('mmgr_state_demo-project') || '').indexOf('"tasks"') !== -1,
      null,
      { timeout: 10000 }
    );
    const shaped = await page.evaluate(() => {
      const out = window.__qaShapeV19();
      sessionStorage.setItem('qa_v19_arm', '1');
      return out.ok;
    });
    check('M1 v19 fixture (no supplierBook, C10 row, no procurement pack) applied', shaped, shaped);
    await page.reload({ waitUntil: 'load' });
    await booted();
    const m2 = await page.evaluate(() => {
      const s = MMGR.State.getState();
      const issues = MMGR.State.validate ? MMGR.State.validate(s) : null;
      return {
        v: s.schemaVersion,
        seeded: !!(
          s.supplierBook &&
          Array.isArray(s.supplierBook.vendors) &&
          Array.isArray(s.supplierBook.items)
        ),
        packSeeded: s.packs && s.packs.procurement === false,
        c10: !!(s.procurement && s.procurement[0] && s.procurement[0].material === 'Cement'),
        issues
      };
    });
    check(
      'M2 migration seeds supplierBook + packs.procurement=false, keeps the C10 material-order row, schema 22',
      // Re-baselined 2026-10-21: the P5 quantity-break wave bumped
      // SCHEMA_VERSION 21 -> 22 (additive back-fill of priceTiers).
      m2.v === 22 &&
        m2.seeded &&
        m2.packSeeded &&
        m2.c10 &&
        Array.isArray(m2.issues) &&
        m2.issues.length === 0,
      m2
    );
    const hiddenBefore = !(await btnVisible());
    check('M3 the Procurement tab ships HIDDEN (owner D2: behind its pack)', hiddenBefore, {
      hiddenBefore
    });
    await page.evaluate(() => {
      const cb = document.getElementById('pk-procurement');
      if (!cb) {
        throw new Error('no pk-procurement pack chip');
      }
      cb.click();
    });
    await page.waitForTimeout(300);
    const m4 = await page.evaluate(() => {
      const cb = document.getElementById('pk-procurement');
      const els = [...document.querySelectorAll('.sec-btn[data-section="proc"]')];
      return {
        pack: MMGR.State.getState().packs.procurement,
        checked: !!(cb && cb.checked),
        allShown: els.length > 0 && els.every(el => !el.classList.contains('is-hide')),
        anyVisible: els.some(el => el.offsetParent !== null)
      };
    });
    check(
      'M4 switching on the Procurement pack turns the tab on for real (state + visible button)',
      m4.pack === true && m4.checked && m4.allShown && m4.anyVisible,
      m4
    );

    // ---------------- CTX 2: structure + CRUD ----------------
    await openProc();
    const s1 = await page.evaluate(() => {
      const q = sel => !!document.querySelector(sel);
      const scope = document.querySelector('#panel-proc');
      const out = document.getElementById('proc-quote-out');
      const banner = out ? getComputedStyle(out, '::before').content : '';
      return {
        panel: !!scope,
        vendors: q('#proc-vendors'),
        addVendor: q('[data-action="addPvendor"]'),
        addItem: q('[data-action="addPitem"]'),
        // NOTE: the table is `table.dt > thead > th` (repo convention), so
        // the descendant selector has to read `.dt thead th`, not the other
        // way round.
        // 12 = ID, Item, Unit, Min price, Currency, Lead days, Min order,
        // Quoted, Duty % (P6), Breaks (P5), Notes, delete-icon.
        cols: document.querySelectorAll('#panel-proc table.dt thead th').length === 12,
        subtotal: q('#proc-subtotal'),
        vendorSel: !!document.getElementById('proc-quote-vendor'),
        vendorOpt0: (document.getElementById('proc-quote-vendor').options[0] || {}).text,
        toneOpts: document.getElementById('proc-quote-tone').options.length,
        quoteBtn: q('[data-action="procQuote"]'),
        copyHidden: document.getElementById('proc-quote-copy').classList.contains('is-hide'),
        emptyBanner: /quote will appear here/.test(banner),
        emptyState:
          (document.getElementById('proc-vendors').textContent || '').indexOf(
            'No suppliers yet'
          ) !== -1
      };
    });
    check(
      'S1 panel structure: vendors column, 12-column table, subtotal, quote card + empty states',
      s1.panel &&
        s1.vendors &&
        s1.addVendor &&
        s1.addItem &&
        s1.cols &&
        s1.subtotal &&
        s1.vendorSel &&
        s1.vendorOpt0 === 'Pick a supplier' &&
        s1.toneOpts === 3 &&
        s1.quoteBtn &&
        s1.copyHidden &&
        s1.emptyBanner &&
        s1.emptyState,
      s1
    );

    await page.click('[data-action="addPvendor"]');
    await page.waitForTimeout(250);
    const v1 = await page.evaluate(() => ({
      rows: document.querySelectorAll('#proc-vendors .pv-disc').length,
      focus: document.activeElement && document.activeElement.getAttribute('data-field')
    }));
    check(
      'V1 Add Supplier lands a row and focuses the name field',
      v1.rows === 1 && v1.focus === 'name',
      v1
    );
    await setField('#proc-vendors input[data-field="name"]', 'Aggregate Supplies Ltd');
    const v2 = await page.evaluate(() => ({
      name: (document.querySelector('#proc-vendors .pv-name') || {}).textContent,
      count: (document.getElementById('proc-vendor-count') || {}).textContent
    }));
    check(
      'V2 the typed supplier name renders in the row and the count reads (1)',
      v2.name === 'Aggregate Supplies Ltd' && v2.count === ' (1)',
      v2
    );

    const ITEMS = [
      ['Portland cement 42.5N', 'bag', '1250'],
      ['Sharp sand', 'm3', '980'],
      ['Rebar 16mm', 'tonne', '4500']
    ];
    for (const [name, unit, price] of ITEMS) {
      await page.click('[data-action="addPitem"]');
      await page.waitForTimeout(200);
      await setField(lastRow('name'), name);
      await setField(lastRow('unit'), unit);
      await setField(lastRow('minPrice'), price);
    }
    const i1 = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#proc-item-body tr')];
      return {
        rows: rows.length,
        prices: [...document.querySelectorAll('#proc-item-body input[data-field="minPrice"]')].map(
          i => i.value
        ),
        names: [...document.querySelectorAll('#proc-item-body input[data-field="name"]')].map(
          i => i.value
        ),
        sub: (document.getElementById('proc-subtotal') || {}).textContent
      };
    });
    check(
      'I1 three items carry their names, units and prices in the table',
      i1.rows === 3 &&
        i1.prices.join(',') === '1250,980,4500' &&
        i1.names.join('|') === ITEMS.map(x => x[0]).join('|'),
      i1
    );

    // Keyboard disclosure: collapse first (it opened on selection), then
    // focus + Enter must disclose it for real.
    await page.click('#pv-disc-0');
    await page.waitForTimeout(200);
    await page.focus('#pv-disc-0');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    const i2 = await page.evaluate(() => {
      const btn = document.getElementById('pv-disc-0');
      const panel = document.getElementById('pv-panel-0');
      return {
        expanded: btn.getAttribute('aria-expanded'),
        panelShown: !!(panel && !panel.hidden && panel.offsetParent !== null),
        listed: document.querySelectorAll('#proc-item-body input[data-field="name"]').length,
        prices: [...document.querySelectorAll('#proc-item-body input[data-field="minPrice"]')].map(
          i => i.value
        ),
        focus: document.activeElement && document.activeElement.id
      };
    });
    check(
      'I2 keyboard disclosure: Enter expands (aria-expanded=true), the panel shows and the items are listed with their prices',
      i2.expanded === 'true' &&
        i2.panelShown &&
        i2.listed === 3 &&
        i2.prices.join(',') === '1250,980,4500',
      i2
    );

    const t1 = await page.evaluate(() => ({
      text: (document.getElementById('proc-subtotal') || {}).textContent,
      verdict: MMGR.Prompts.bookTotals(
        MMGR.State.getState().supplierBook.items.filter(it => String(it.vendorId) === 'v1')
      ).verdict
    }));
    check(
      'T1 subtotal is EXACT and is byte-identical to Prompts.bookTotals (one source)',
      t1.text === 'Subtotal (all lines JMD): J$6,730' && t1.text === t1.verdict,
      t1
    );

    await setField('#proc-item-body input[data-field="minPrice"][data-idx="0"]', '1300');
    await delay(200);
    const t2 = await page.evaluate(() => {
      const it = MMGR.State.getState().supplierBook.items[0];
      const at = it.quotedAt ? Date.parse(it.quotedAt) : NaN;
      return {
        fresh: !isNaN(at) && Date.now() - at < 60000,
        by: it.quotedBy,
        sub: (document.getElementById('proc-subtotal') || {}).textContent
      };
    });
    check(
      'T2 a price edit stamps quotedAt (fresh) + quotedBy, and the subtotal recalculates exactly',
      t2.fresh && t2.by === 'local (this device)' && t2.sub === 'Subtotal (all lines JMD): J$6,780',
      t2
    );

    // H7.3: the injection surface (vendor name AND item name).
    await page.click('[data-action="addPitem"]');
    await page.waitForTimeout(200);
    await setField(lastRow('name'), '<img onerror=alert(1)>');
    await setField(lastRow('unit'), 'ea');
    await setField(lastRow('minPrice'), '250');
    const x2 = await page.evaluate(() => ({
      val: document.querySelector('#proc-item-body tr:last-child input[data-field="name"]').value,
      imgs: document.querySelectorAll('#proc-item-body img').length
    }));
    check(
      'X2 an item named <img onerror=alert(1)> lands as literal value, no element injected',
      x2.val === '<img onerror=alert(1)>' && x2.imgs === 0,
      x2
    );
    await page.click('[data-action="addPvendor"]');
    await page.waitForTimeout(200);
    await setField(
      '#proc-vendors .pv-row:last-child input[data-field="name"]',
      '<img onerror=alert(1)>'
    );
    await page.waitForTimeout(150);
    const x1 = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#proc-vendors .pv-name')];
      return {
        names: rows.map(r => r.textContent),
        imgs: document.querySelectorAll('#proc-vendors img').length,
        count: (document.getElementById('proc-vendor-count') || {}).textContent
      };
    });
    check(
      'X1 an injected supplier name renders as literal text, zero elements injected',
      x1.names.length === 2 &&
        x1.names[1] === '<img onerror=alert(1)>' &&
        x1.imgs === 0 &&
        x1.count === ' (2)',
      x1
    );
    const subAfter = await page.evaluate(
      () => (document.getElementById('proc-subtotal') || {}).textContent
    );
    // vendor2 is now selected (Add selects the new row) - reselect v1 for
    // the money gates.
    await page.click('#pv-disc-0');
    await page.waitForTimeout(250);
    const r1pre = await waitPersisted('Aggregate Supplies Ltd');
    check('R-pre the book reached localStorage before the reload probe', r1pre, { r1pre });

    await page.reload({ waitUntil: 'load' });
    await booted();
    await openProc();
    await page.click('#pv-disc-0');
    await page.waitForTimeout(300);
    const r1 = await page.evaluate(() => ({
      vendors: document.querySelectorAll('#proc-vendors .pv-disc').length,
      firstName: (document.querySelector('#proc-vendors .pv-name') || {}).textContent,
      rows: document.querySelectorAll('#proc-item-body tr').length,
      prices: [...document.querySelectorAll('#proc-item-body input[data-field="minPrice"]')].map(
        i => i.value
      ),
      sub: (document.getElementById('proc-subtotal') || {}).textContent,
      pack: MMGR.State.getState().packs.procurement
    }));
    check(
      'R1 everything survives a REAL reload (2 suppliers, 4 priced rows, subtotal exact, pack still on)',
      r1.vendors === 2 &&
        r1.firstName === 'Aggregate Supplies Ltd' &&
        r1.rows === 4 &&
        r1.prices.join(',') === '1300,980,4500,250' &&
        r1.sub === 'Subtotal (all lines JMD): J$7,030' &&
        r1.pack === true,
      r1
    );

    // ---------------- A1/A2 axe on the new panel ----------------
    // Dark is ENGAGED BY A REAL BOOT (mmgr_theme=dark + reload), never by
    // toggling body.dark-mode after load: the starfield/glass layer paints
    // its theme at init, so a late toggle leaves a light canvas under dark
    // text and axe then measures a state this app cannot render (probe
    // 2026-10-18: same panel, same tokens , 27 colour-contrast hits from the
    // toggle, ZERO once dark was booted). The dark condition itself is
    // asserted before the run.
    const ensureVendorOpen = () =>
      page.evaluate(() => {
        const b = document.getElementById('pv-disc-0');
        if (!b) {
          return 'no-disc';
        }
        if (b.getAttribute('aria-expanded') !== 'true') {
          b.click();
        }
        return document.getElementById('pv-disc-0').getAttribute('aria-expanded');
      });
    const axePanel = async () => {
      await page.evaluate(AXE);
      return page.evaluate(async () => {
        const target = document.getElementById('panel-proc');
        const r = await window.axe.run(target, { resultTypes: ['violations'] });
        return r.violations
          .filter(v => v.impact === 'serious' || v.impact === 'critical')
          .map(
            v =>
              v.id +
              ': ' +
              v.nodes
                .map(n => n.target.join(' '))
                .join(' | ')
                .slice(0, 220)
          );
      });
    };
    const lightExpanded = await ensureVendorOpen();
    const axeLight = await axePanel();
    check(
      'A1 axe [light] on #panel-proc: zero serious/critical violations',
      axeLight.length === 0 && lightExpanded === 'true',
      { axeLight, lightExpanded }
    );

    await page.evaluate(() => sessionStorage.setItem('qa_theme', 'dark'));
    await page.reload({ waitUntil: 'load' });
    await booted();
    const darkEngaged = await page.evaluate(() => document.body.classList.contains('dark-mode'));
    await openProc();
    const darkExpanded = await ensureVendorOpen();
    const axeDark = await axePanel();
    check(
      'A2 axe [dark] on #panel-proc: zero serious/critical violations',
      darkEngaged && darkExpanded === 'true' && axeDark.length === 0,
      { darkEngaged, darkExpanded, axeDark }
    );

    // Back to light for the gates that follow.
    await page.evaluate(() => sessionStorage.setItem('qa_theme', 'light'));
    await page.reload({ waitUntil: 'load' });
    await booted();
    await openProc();

    // ---------------- RO view-only cannot edit ----------------
    const ro = await page.evaluate(() => {
      const before = document.querySelectorAll('#proc-vendors .pv-disc').length;
      MMGR.scope = 'readonly';
      document.querySelector('[data-action="addPvendor"]').click();
      const after = document.querySelectorAll('#proc-vendors .pv-disc').length;
      const toasts = [...document.querySelectorAll('.toast')].map(t => t.textContent || '');
      MMGR.scope = 'full';
      return { before, after, toasts };
    });
    check(
      'RO view-only refuses the edit (supplier count unchanged + view-only toast)',
      ro.before === ro.after && ro.toasts.some(t => t.indexOf('View-only mode') !== -1),
      ro
    );

    // ---------------- Q gates: the AI quote panel ----------------
    const outText = () =>
      page.evaluate(() => (document.getElementById('proc-quote-out') || {}).textContent || '');
    const runQuote = async prev => {
      await page.click('[data-action="procQuote"]');
      await page.waitForFunction(
        p => {
          const t = (document.getElementById('proc-quote-out') || {}).textContent || '';
          return t !== p && t !== 'Writing your quote...';
        },
        prev,
        { timeout: 20000 }
      );
      await page.waitForTimeout(150);
      return outText();
    };

    await page.selectOption('#proc-quote-vendor', 'v1');
    await page.waitForTimeout(150);
    relay.mode = 'echo';
    auth.signedIn = true;
    const bodiesBefore = relay.bodies.length;
    const prev1 = await outText();
    const q1out = await runQuote(prev1);
    const q1 = await page.evaluate(() => ({
      saved: !!(MMGR.State.getState().aiOutputs && MMGR.State.getState().aiOutputs.quote),
      savedText: (MMGR.State.getState().aiOutputs.quote || {}).text,
      copyShown: !document.getElementById('proc-quote-copy').classList.contains('is-hide')
    }));
    const q1relay = relay.bodies.length - bodiesBefore;
    const q1req = relay.bodies[relay.bodies.length - 1] || '';
    check(
      'Q1 signed-in quote runs ONCE against the relay with the full supplier context, output = the reply, state saved, Copy revealed',
      q1relay === 1 &&
        q1req.indexOf('=== SUPPLIER PRICE BOOK (ground truth) ===') !== -1 &&
        q1req.indexOf('J$1,300') !== -1 &&
        q1out === quoteFromBody(q1req) &&
        q1.saved &&
        q1.savedText === q1out &&
        q1.copyShown,
      { q1relay, hasHeader: q1req.indexOf('SUPPLIER PRICE BOOK') !== -1, head: q1out.slice(0, 140) }
    );

    const q2 = await page.evaluate(() => {
      const out = (document.getElementById('proc-quote-out') || {}).textContent || '';
      const vid = document.getElementById('proc-quote-vendor').value;
      const ctxStr = MMGR.Prompts.context({ vendorId: vid });
      const toks = out.match(/(?:J|US)\$[\d,]+(?:\.\d+)?/g) || [];
      const everyIn = toks.every(t => ctxStr.indexOf(t) !== -1);
      const doctoredTokens = (out + ' J$999,999').match(/(?:J|US)\$[\d,]+(?:\.\d+)?/g) || [];
      const doctoredEveryIn = doctoredTokens.every(t => ctxStr.indexOf(t) !== -1);
      return {
        toks,
        everyIn,
        doctoredEveryIn,
        ctxHasHeader: ctxStr.indexOf('SUPPLIER PRICE BOOK') !== -1
      };
    });
    check(
      'Q2 quote integrity (H7.2): every money figure exists byte-for-byte in the context, and the detector rejects an invented figure',
      q2.ctxHasHeader && q2.toks.length >= 2 && q2.everyIn === true && q2.doctoredEveryIn === false,
      q2
    );

    // Q3 signed out.
    relay.mode = '401';
    auth.signedIn = false;
    let prev = await outText();
    const q3 = await runQuote(prev);
    check(
      'Q3 signed out: a plain draft still lands plus the sign-in note (never an empty box)',
      q3.indexOf('Dear ') === 0 &&
        q3.indexOf('Sign in with Google to have the built-in AI write this quote') !== -1,
      q3.slice(0, 220)
    );

    // Q4 offline: draft + connection note + ZERO relay requests.
    auth.signedIn = true;
    relay.mode = 'echo';
    await ctx.setOffline(true);
    const b4 = relay.bodies.length;
    prev = await outText();
    const q4 = await runQuote(prev);
    await ctx.setOffline(false);
    check(
      'Q4 offline: draft + connection note, and NOT one relay request is attempted',
      relay.bodies.length === b4 &&
        q4.indexOf('Dear ') === 0 &&
        q4.indexOf('needs a connection for AI writing') !== -1,
      { delta: relay.bodies.length - b4, head: q4.slice(0, 160) }
    );

    // Q5 402 over quota.
    relay.mode = '402';
    prev = await outText();
    const q5 = await runQuote(prev);
    check(
      'Q5 over the daily limit: draft + the quota note',
      q5.indexOf('Dear ') === 0 && q5.indexOf('free AI messages for today are used up') !== -1,
      q5.slice(0, 180)
    );

    // Q6 503 busy.
    relay.mode = '503';
    prev = await outText();
    const q6 = await runQuote(prev);
    check(
      'Q6 the built-in AI busy: draft + the busy note',
      q6.indexOf('Dear ') === 0 && q6.indexOf('busy right now') !== -1,
      q6.slice(0, 180)
    );

    // Q7 engine Off: the setting is respected, no relay attempt at all.
    relay.mode = 'echo';
    await page.evaluate(() => {
      MMGR.State.updateState(s => {
        s.config = s.config || {};
        s.config.ai = s.config.ai || {};
        s.config.ai.tier = 'off';
      });
    });
    const b7 = relay.bodies.length;
    prev = await outText();
    const q7 = await runQuote(prev);
    await page.evaluate(() => {
      MMGR.State.updateState(s => {
        s.config.ai.tier = 'local';
      });
    });
    check(
      'Q7 engine Off: draft + the off note, and no relay request is made',
      relay.bodies.length === b7 &&
        q7.indexOf('The AI engine is Off') !== -1 &&
        q7.indexOf('Dear ') !== -1,
      { delta: relay.bodies.length - b7, head: q7.slice(0, 160) }
    );

    // Q8 empty book: plain-language guard BEFORE any AI call.
    // Seed THROUGH the app (not raw localStorage): a raw write leaves the
    // IndexedDB crash journal holding the populated book, and
    // restoreFromJournal() adopts it on the next boot whenever it differs
    // from localStorage - the panel would come back populated and the guard
    // would never fire. updateState + flushSave writes both copies together.
    await page.evaluate(() => {
      MMGR.State.updateState(s => {
        s.supplierBook = { vendors: [], items: [], nvendorid: 2, nitemid: 5 };
      });
      MMGR.State.flushSave();
    });
    await page.waitForFunction(
      () => {
        try {
          const raw = JSON.parse(localStorage.getItem('mmgr_state_demo-project') || '{}');
          return raw.supplierBook && raw.supplierBook.items.length === 0;
        } catch (e) {
          return false;
        }
      },
      null,
      { timeout: 8000 }
    );
    await page.reload({ waitUntil: 'load' });
    await booted();
    await openProc();
    const b8 = relay.bodies.length;
    const prev8 = await outText();
    const q8 = await runQuote(prev8);
    check(
      'Q8 an empty price book names the fix in plain words and never calls the AI',
      relay.bodies.length === b8 &&
        q8 === 'Add a supplier and their prices first, then write the quote.',
      { delta: relay.bodies.length - b8, q8 }
    );

    // ============================================================
    // P2/P3/P4 gates (AUDIT-DIRECTIVE 2026-10-18, procurement wave).
    // ============================================================

    // P2z: the new XLSX reader's inflate is validated against node's own
    // zlib (dynamic Huffman, real bytes) before the browser flow uses it.
    {
      const zlib = require('zlib');
      const payload = Buffer.from(('supplier price list row '.repeat(300) + 'end').repeat(9));
      const deflated = zlib.deflateRawSync(payload, { level: 9 });
      const round = await page.evaluate(
        function (args) {
          const out = window.MMGR.XlsxLite.inflateRaw(new Uint8Array(args[0]), args[1]);
          return Array.from(out);
        },
        [Array.from(deflated), payload.length]
      );
      const ok = Buffer.from(round).equals(payload) && round.length === payload.length;
      check('P2z XLSX reader inflate round-trips zlib-deflated bytes exactly', ok, {
        got: round && round.length,
        want: payload.length
      });
    }

    // Seed a deterministic book: one vendor, one priced item.
    await page.evaluate(function () {
      window.MMGR.State.updateState(function (s) {
        s.supplierBook = {
          vendors: [
            { id: 'v1', name: 'Aggie Supply', contact: '', phone: '', email: '', notes: '' }
          ],
          items: [
            {
              id: 'i1',
              vendorId: 'v1',
              name: 'Gravel',
              unit: 'load',
              minPrice: '900',
              currency: 'JMD',
              leadTimeDays: '2',
              minOrder: '',
              notes: '',
              quotedAt: '',
              quotedBy: '',
              priceHistory: []
            }
          ],
          nvendorid: 2,
          nitemid: 2
        };
      });
      window.MMGR.Proc.render();
    });
    await page.click('#pv-disc-0');

    // ---- P2: price history + sparkline ----
    const editPrice = async val => {
      await page.evaluate(function (v) {
        const inp = document.querySelector('#proc-item-body input[data-field="minPrice"]');
        inp.value = String(v);
        inp.dispatchEvent(new Event('change', { bubbles: true }));
      }, val);
    };
    await editPrice(950);
    await editPrice(975);
    await editPrice(1000);
    const p2 = await page.evaluate(function () {
      const it = window.MMGR.State.getState().supplierBook.items[0];
      const h = it.priceHistory || [];
      const spark = document.querySelector('#proc-item-body svg.ph-spark polyline');
      return {
        n: h.length,
        last: h[h.length - 1],
        capped: h.length <= 12,
        sparkPts: spark ? spark.getAttribute('points').split(' ').length : 0
      };
    });
    check(
      'P2a every price edit appends to the price history with who + when',
      p2.n === 3 &&
        p2.last &&
        p2.last.price === '1000' &&
        !!p2.last.quotedAt &&
        !!p2.last.quotedBy &&
        p2.last.qtyBreak === null,
      p2
    );
    check('P2b the sparkline renders once history has 2+ prices', p2.sparkPts >= 2, p2);
    // cap: hammer 20 more edits -> history never exceeds 12
    for (let i = 0; i < 20; i++) {
      await editPrice(1000 + i + 1);
    }
    const p2cap = await page.evaluate(function () {
      const it = window.MMGR.State.getState().supplierBook.items[0];
      return {
        n: (it.priceHistory || []).length,
        newest: it.priceHistory[it.priceHistory.length - 1].price
      };
    });
    check(
      'P2c price history is append-only and capped at 12',
      p2cap.n === 12 && p2cap.newest === '1020',
      p2cap
    );

    // ---- P3: CSV import with mapping, dry run, merge ----
    await page.evaluate(function () {
      window.MMGR.Proc.procImport();
    });
    const csvText =
      'Item,Unit,Price,Currency,Lead days,Min order\n' +
      'Cement,bag,450,JMD,7,10\n' +
      'Sand,m3,3200,JMD,2,\n' +
      'Broken down,load,,JMD,,\n' +
      'Gravel,load,1200,JMD,3,\n';
    await page.evaluate(function (text) {
      const file = new File([text], 'price-list.csv', { type: 'text/csv' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const inp = document.getElementById('proc-imp-file');
      inp.files = dt.files;
      window.MMGR.Proc.procImportFile(inp);
    }, csvText);
    await page
      .waitForFunction(
        function () {
          const p = window.MMGR.Proc._impPreview && window.MMGR.Proc._impPreview();
          return p && p.add.length + p.upd.length + p.skip.length === 4;
        },
        null,
        { timeout: 5000 }
      )
      .catch(function () {});
    const p3 = await page.evaluate(function () {
      const p = window.MMGR.Proc._impPreview();
      const body = document.getElementById('proc-imp-body').textContent;
      return {
        add: p.add.length,
        upd: p.upd.length,
        skip: p.skip.length,
        skipWhy: p.skip[0] ? p.skip[0].why : '',
        namesIt: body.indexOf('Nothing is saved until you press Import') > -1,
        verdicts: body.indexOf('new item') > -1 && body.indexOf('updates Gravel') > -1
      };
    });
    check(
      'P3a CSV dry run: 2 new, 1 update (merge by name+unit), 1 skipped and named',
      p3.add === 2 &&
        p3.upd === 1 &&
        p3.skip === 1 &&
        /no usable price/.test(p3.skipWhy) &&
        p3.namesIt &&
        p3.verdicts,
      p3
    );
    const p3apply = await page.evaluate(function () {
      window.MMGR.Proc.procImportApply();
      const b = window.MMGR.State.getState().supplierBook;
      const gravel = b.items.filter(function (x) {
        return x.name === 'Gravel';
      })[0];
      const cement = b.items.filter(function (x) {
        return x.name === 'Cement';
      })[0];
      return {
        items: b.items.length,
        gravelPrice: gravel ? gravel.minPrice : null,
        gravelHist: gravel && gravel.priceHistory ? gravel.priceHistory.length : 0,
        gravelBy: gravel ? gravel.quotedBy : '',
        cementLead: cement ? cement.leadTimeDays : null,
        cementMinOrder: cement ? cement.minOrder : null,
        hidden: document.getElementById('proc-import').classList.contains('is-hide')
      };
    });
    check(
      'P3b applying the import adds rows, merges the duplicate, stamps history',
      p3apply.items === 3 &&
        p3apply.gravelPrice === '1200' &&
        p3apply.gravelHist >= 1 &&
        p3apply.gravelHist <= 12 &&
        /import \(price-list\.csv\)/.test(p3apply.gravelBy) &&
        p3apply.cementLead === '7' &&
        p3apply.cementMinOrder === '10' &&
        p3apply.hidden,
      p3apply
    );

    // ---- P3x: XLSX import round-trip through the real reader ----
    await page.evaluate(function () {
      window.MMGR.Proc.procImport();
    });
    const xlsxB64 = await page.evaluate(function () {
      const bytes = window.MMGR.XlsxLite.build([
        {
          name: 'Sheet1',
          rows: [
            ['Item', 'Unit', 'Price'],
            ['Blocks', 'each', 210],
            ['Paint', 'tin', '']
          ]
        }
      ]);
      let s = '';
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return btoa(s);
    });
    await page.evaluate(function (b64) {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const file = new File([bytes], 'list.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const dt = new DataTransfer();
      dt.items.add(file);
      const inp = document.getElementById('proc-imp-file');
      inp.files = dt.files;
      window.MMGR.Proc.procImportFile(inp);
    }, xlsxB64);
    await page
      .waitForFunction(
        function () {
          const p = window.MMGR.Proc._impPreview && window.MMGR.Proc._impPreview();
          return p && p.add.length + p.upd.length + p.skip.length === 2;
        },
        null,
        { timeout: 5000 }
      )
      .catch(function () {});
    const p3x = await page.evaluate(function () {
      const p = window.MMGR.Proc._impPreview();
      return {
        add: p.add.length,
        skip: p.skip.length,
        first: p.add[0] ? p.add[0].name : '',
        price: p.add[0] ? p.add[0].price : null
      };
    });
    check(
      'P3c XLSX price list reads through the shared reader (1 new, 1 skipped)',
      p3x.add === 1 && p3x.skip === 1 && p3x.first === 'Blocks' && p3x.price === 210,
      p3x
    );
    await page.evaluate(function () {
      window.MMGR.Proc.procImportCancel();
    });

    // ---- P4: compare matrix ----
    await page.evaluate(function () {
      window.MMGR.State.updateState(function (s) {
        s.supplierBook.vendors.push({
          id: 'v2',
          name: 'Better Buys',
          contact: '',
          phone: '',
          email: '',
          notes: ''
        });
        const n = s.supplierBook.nitemid;
        s.supplierBook.items.push(
          {
            id: 'i' + n,
            vendorId: 'v2',
            name: 'Cement',
            unit: 'bag',
            minPrice: '430',
            currency: 'JMD',
            leadTimeDays: '5',
            minOrder: '50',
            notes: '',
            quotedAt: '',
            quotedBy: '',
            priceHistory: []
          },
          {
            id: 'i' + (n + 1),
            vendorId: 'v1',
            name: 'Cement',
            unit: 'bag',
            minPrice: '450',
            currency: 'JMD',
            leadTimeDays: '7',
            minOrder: '10',
            notes: '',
            quotedAt: '',
            quotedBy: '',
            priceHistory: []
          },
          {
            id: 'i' + (n + 2),
            vendorId: 'v1',
            name: 'Paint',
            unit: 'tin',
            minPrice: '100',
            currency: 'JMD',
            leadTimeDays: '',
            minOrder: '',
            notes: '',
            quotedAt: '',
            quotedBy: '',
            priceHistory: []
          },
          {
            id: 'i' + (n + 3),
            vendorId: 'v2',
            name: 'Paint',
            unit: 'tin',
            minPrice: '12',
            currency: 'USD',
            leadTimeDays: '',
            minOrder: '',
            notes: '',
            quotedAt: '',
            quotedBy: '',
            priceHistory: []
          }
        );
        s.supplierBook.nitemid = n + 4;
      });
      window.MMGR.Proc.procCompare();
    });
    const p4 = await page.evaluate(function () {
      const box = document.getElementById('proc-cmp-body');
      const cheapCells = box.querySelectorAll('td.pc-cheap');
      const mixed = box.querySelectorAll('.pc-mixed').length;
      const text = box.textContent;
      return {
        cheap: cheapCells.length,
        cheapText: cheapCells.length ? cheapCells[0].textContent : '',
        mixed,
        hasTotal: /JMD 430/.test(text),
        hasLead: /5d lead/.test(text),
        hasMoq: /min order 50/.test(text),
        totText: (document.querySelector('.pc-tot') || {}).textContent || ''
      };
    });
    check(
      'P4 compare matrix: cheapest highlighted, lead + min order shown, mixed-currency row kept out of totals',
      p4.cheap === 1 &&
        /JMD 430/.test(p4.cheapText) &&
        p4.mixed === 1 &&
        p4.hasTotal &&
        p4.hasLead &&
        p4.hasMoq &&
        !/USD/.test(p4.totText),
      p4
    );
    await page.evaluate(function () {
      window.MMGR.Proc.procCompareClose();
    });

    // ---- P5: quantity break pricing (directive 2026-10-18) ----
    // Seed a volume ladder on item 0 and prove the picking rule, the editor
    // write-through, the live preview, and that the quote context exposes it.
    await page.evaluate(function () {
      window.MMGR.State.updateState(function (s) {
        const it = s.supplierBook.items[0];
        it.minPrice = '120';
        it.priceTiers = [
          { minQty: 1, price: '120' },
          { minQty: 50, price: '112' },
          { minQty: 200, price: '105' }
        ];
      });
      window.MMGR.Proc.render();
    });
    const p5pick = await page.evaluate(function () {
      const it = window.MMGR.State.getState().supplierBook.items[0];
      const P = window.MMGR.Proc;
      return {
        q1: P.tierPriceFor(it, 1),
        q49: P.tierPriceFor(it, 49),
        q50: P.tierPriceFor(it, 50),
        q199: P.tierPriceFor(it, 199),
        q200: P.tierPriceFor(it, 200),
        q999: P.tierPriceFor(it, 999),
        // no tier at/below qty -> falls back to single minPrice
        below: P.tierPriceFor(it, 0),
        unit0: P.unitPriceFor(it, 0),
        unit50: P.unitPriceFor(it, 50)
      };
    });
    check(
      'P5a tier picker takes the largest minQty at or below the quantity, falls back to Min price below the ladder',
      p5pick.q1 === 120 &&
        p5pick.q49 === 120 &&
        p5pick.q50 === 112 &&
        p5pick.q199 === 112 &&
        p5pick.q200 === 105 &&
        p5pick.q999 === 105 &&
        p5pick.below === null &&
        p5pick.unit0 === 120 &&
        p5pick.unit50 === 112,
      p5pick
    );
    // Editor: open the panel, add a break, edit it, confirm state + label.
    await page.evaluate(function () {
      const btn = document.querySelector('#proc-item-body [data-action="openTiers"]');
      btn.click();
    });
    const p5open = await page.evaluate(function () {
      return !document.getElementById('proc-tiers').classList.contains('is-hide');
    });
    await page.evaluate(function () {
      window.MMGR.Proc.addTier(); // seeds minQty = highest+1 = 201
    });
    const p5edited = await page.evaluate(function () {
      const inp = document.querySelector(
        '#proc-tier-body input[data-field="minQty"][data-tidx="3"]'
      );
      inp.value = '500';
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      const price = document.querySelector(
        '#proc-tier-body input[data-field="price"][data-tidx="3"]'
      );
      price.value = '99';
      price.dispatchEvent(new Event('change', { bubbles: true }));
      const it = window.MMGR.State.getState().supplierBook.items[0];
      return { n: it.priceTiers.length, t3: it.priceTiers[3] };
    });
    check(
      'P5b the tier editor writes through to state (add + edit minQty and price)',
      // minQty and price are stored as strings, matching how minPrice/
      // leadTimeDays/minOrder are stored; tiersOf normalises with Number().
      p5open &&
        p5edited.n === 4 &&
        p5edited.t3 &&
        p5edited.t3.minQty === '500' &&
        p5edited.t3.price === '99',
      p5edited
    );
    // Live preview echoes the same picking rule the quote uses.
    const p5prev = await page.evaluate(function () {
      const q = document.getElementById('proc-tier-qty');
      q.value = '50';
      window.MMGR.Proc.tierPreview();
      return document.getElementById('proc-tier-pick-out').textContent;
    });
    check(
      'P5c the quantity preview shows the tier unit price the quote will charge',
      /50 x JMD 112 each/.test(p5prev),
      p5prev
    );
    await page.evaluate(function () {
      window.MMGR.Proc.closeTiers();
    });
    // Quote context exposes the ladder so the model can pick by quantity.
    const p5ctx = await page.evaluate(function () {
      return window.MMGR.Prompts.context ? window.MMGR.Prompts.context({ vendorId: 'v1' }) : '';
    });
    check(
      'P5d the quote context lists each quantity break with its money figure',
      /quantity breaks:/.test(p5ctx) &&
        /1\+ = J\$120/.test(p5ctx) &&
        /50\+ = J\$112/.test(p5ctx) &&
        /500\+ = J\$99/.test(p5ctx),
      p5ctx.slice(p5ctx.indexOf('quantity breaks') - 40, p5ctx.indexOf('quantity breaks') + 120)
    );

    // ---- P6: landed cost (directive 2026-10-18) ----
    // Freight + handling are per-DELIVERY (spread over qty); duty is a
    // per-item rate. "Cheapest" must mean cheapest DELIVERED, and on-costs
    // stay in the item's own currency - never converted (C2 honesty).
    await page.evaluate(function () {
      window.MMGR.State.updateState(function (s) {
        const b = s.supplierBook;
        // v1 freight/handling/lead: per-delivery on-costs.
        b.vendors[0].landFreight = '200';
        b.vendors[0].landHandling = '100';
        b.vendors[0].landLeadDays = '7';
        // item 0 (Gravel): base 120 JMD, 10% duty.
        b.items[0].dutyPct = '10';
      });
      window.MMGR.Proc.render();
    });
    const p6 = await page.evaluate(function () {
      const s = window.MMGR.State.getState();
      const v = s.supplierBook.vendors[0];
      const it = s.supplierBook.items[0];
      const P = window.MMGR.Proc;
      // qty=2: base 120 -> duty 10% = 132, + freight 200/2=100 + handling 100/2=50 => 282.
      const unit2 = P.landedUnitFor(v, it, 2);
      // qty=1: 132 + 200 + 100 = 432.
      const unit1 = P.landedUnitFor(v, it, 1);
      const lf = P.landedFor(v, it, 2);
      return {
        unit2: Math.round(unit2 * 100) / 100,
        unit1: Math.round(unit1 * 100) / 100,
        freight2: lf.freight,
        handling2: lf.handling,
        dutyRate: lf.dutyRate,
        lead: lf.lead
      };
    });
    check(
      'P6a landed unit price = base + duty + per-delivery freight/handling spread over qty (own currency, no FX)',
      p6.unit2 === 282 &&
        p6.unit1 === 432 &&
        p6.freight2 === 100 &&
        p6.handling2 === 50 &&
        p6.dutyRate === 10 &&
        p6.lead === 7,
      p6
    );
    // Compare view ranks by delivered price and labels the uplift.
    await page.evaluate(function () {
      window.MMGR.State.updateState(function (s) {
        const b = s.supplierBook;
        // A second supplier with a CHEAPER base but heavier on-costs, so the
        // DELIVERED price is higher - the highlight must NOT flip to it.
        b.vendors.push({
          id: 'v2',
          name: 'Bulk Traders',
          contact: '',
          phone: '',
          email: '',
          notes: '',
          landFreight: '500',
          landHandling: '0',
          landLeadDays: '14'
        });
        b.nvendorid = 3;
        b.items.push({
          id: 'i2',
          vendorId: 'v2',
          name: 'Gravel',
          unit: 'load',
          minPrice: '100',
          currency: 'JMD',
          leadTimeDays: '5',
          minOrder: '',
          dutyPct: '10',
          notes: '',
          quotedAt: '',
          quotedBy: '',
          priceHistory: []
        });
        b.nitemid = 3;
      });
      window.MMGR.Proc.render();
      window.MMGR.Proc.procCompare();
    });
    const p6cmp = await page.evaluate(function () {
      const body = document.getElementById('proc-cmp-body').textContent;
      // Find the GRAVEL row and read which vendor cell is highlighted. v1
      // (Aggie) base 120 -> delivered 432; v2 (Bulk) base 100 -> delivered
      // 610. Ranking by DELIVERED must highlight Aggie despite Bulk's cheaper
      // base - that is the whole point of P6 (cheapest = cheapest delivered).
      let gravelWinner = '';
      document.querySelectorAll('#proc-cmp-body tbody tr').forEach(function (tr) {
        const label = (tr.querySelector('td') || {}).textContent || '';
        if (/^Gravel/.test(label.trim())) {
          tr.querySelectorAll('td').forEach(function (td, ci) {
            if (ci > 0 && td.classList.contains('pc-cheap')) {
              gravelWinner = td.textContent.trim().slice(0, 30);
            }
          });
        }
      });
      return { gravelWinner: gravelWinner, hasDelivered: /delivered/.test(body) };
    });
    check(
      'P6b the compare matrix ranks GRAVEL by delivered price (Aggie 432 beats Bulk 610 despite Bulk cheaper base) and labels the uplift',
      /JMD 120/.test(p6cmp.gravelWinner) && p6cmp.hasDelivered,
      p6cmp
    );
    await page.evaluate(function () {
      window.MMGR.Proc.procCompareClose();
    });
    // The quote context carries the delivery costs, honestly unattributed to a
    // currency (C2: never assert a currency symbol we do not know).
    const p6ctx = await page.evaluate(function () {
      return window.MMGR.Prompts.context({ vendorId: 'v1' });
    });
    check(
      'P6c the quote context lists delivery costs per delivery without asserting a currency',
      /delivery costs \(per delivery/.test(p6ctx) &&
        /freight 200/.test(p6ctx) &&
        /handling 100/.test(p6ctx) &&
        /delivery 7 days/.test(p6ctx),
      p6ctx.slice(p6ctx.indexOf('delivery costs') - 10, p6ctx.indexOf('delivery costs') + 120)
    );

    // ---- P7: calculator -> RFQ (directive 2026-10-18) ----
    // The bill lives in calculator.html; the handoff is a shared local key.
    // Seed it, reload (the pickup runs once per load), assert the RFQ card
    // surfaces the canonical-qty lines and the quote context addresses them,
    // then dismiss and prove the key is cleared.
    await page.evaluate(function () {
      localStorage.setItem(
        'mmgr_rfq_draft',
        JSON.stringify({
          lines: [
            { name: 'Blockwork', qty: 929.03, unit: 'm2', currency: 'JMD' },
            { name: 'Cement', qty: 120, unit: 'bag', currency: 'JMD' }
          ],
          at: new Date().toISOString(),
          from: 'calculator'
        })
      );
    });
    await page.reload({ waitUntil: 'load' });
    await booted();
    // Re-open the Procurement section so render() -> renderRfq() runs and the
    // handoff card is surfaced (the pickup renders only when the tab shows).
    await openProc();
    const p7 = await page.evaluate(function () {
      const card = document.getElementById('proc-rfq');
      const shown = card && !card.classList.contains('is-hide');
      const body = card ? card.textContent : '';
      const ctx = window.MMGR.Prompts.context
        ? window.MMGR.Prompts.context({ vendorId: 'v1' })
        : '';
      return {
        shown: !!shown,
        hasBlock: /Blockwork/.test(body),
        hasCanonicalQty: /929\.03/.test(body),
        ctxRequested: /REQUESTED LINES/.test(ctx) && /qty 929\.03 m2/.test(ctx)
      };
    });
    check(
      'P7 the bill handoff surfaces an RFQ card with canonical-qty lines and the quote context lists them as requested',
      p7.shown && p7.hasBlock && p7.hasCanonicalQty && p7.ctxRequested,
      p7
    );
    const p7clear = await page.evaluate(function () {
      window.MMGR.Proc.clearRfq();
      const card = document.getElementById('proc-rfq');
      return {
        hidden: card.classList.contains('is-hide'),
        keyGone: localStorage.getItem('mmgr_rfq_draft') === null,
        ctxClean: !/REQUESTED LINES/.test(window.MMGR.Prompts.context({ vendorId: 'v1' }))
      };
    });
    check(
      'P7b dismissing the RFQ card hides it, clears the shared key, and drops the lines from the quote context',
      p7clear.hidden && p7clear.keyGone && p7clear.ctxClean,
      p7clear
    );

    // ---- P8: RFQ email pack (directive 2026-10-18) ----
    // Fill the term fields, write a quote, and prove the terms reach the
    // request body (they flow into the prompt header) and the mailto button
    // reveals. getQuoteOpts reads them live - ephemeral, never state.
    await page.evaluate(function () {
      var set = function (id, v) {
        var el = document.getElementById(id);
        el.value = v;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      set('proc-quote-valid', '2026-12-31');
      set('proc-quote-site', '12 Tower Street, Kingston');
      set('proc-quote-terms', 'Net 30');
    });
    const p8opts = await page.evaluate(function () {
      return window.MMGR.Proc.getQuoteOpts();
    });
    check(
      'P8a getQuoteOpts reads the validity date, delivery site and payment terms live',
      p8opts.validUntil === '2026-12-31' &&
        p8opts.site === '12 Tower Street, Kingston' &&
        p8opts.terms === 'Net 30',
      p8opts
    );
    await page.selectOption('#proc-quote-vendor', 'v1');
    await page.evaluate(function () {
      var t = document.getElementById('proc-quote-tone');
      t.value = 'rfq';
      t.dispatchEvent(new Event('change', { bubbles: true }));
    });
    relay.mode = 'echo';
    auth.signedIn = true;
    const p8prev = await outText();
    await runQuote(p8prev);
    const p8body = relay.bodies[relay.bodies.length - 1] || '';
    const p8 = await page.evaluate(function () {
      return {
        mailShown: !document.getElementById('proc-quote-mailto').classList.contains('is-hide')
      };
    });
    check(
      'P8b the quote request body carries validity, delivery site and payment terms; the mailto button reveals',
      /Quote valid until: 2026-12-31/.test(p8body) &&
        /Deliver to: 12 Tower Street, Kingston/.test(p8body) &&
        /Payment terms: Net 30/.test(p8body) &&
        p8.mailShown,
      { mailShown: p8.mailShown, bodyHit: /Payment terms: Net 30/.test(p8body) }
    );

    // ---- P9: purchase order PDF from an awarded quote (directive 2026-10-18) ----
    // Set the tone to 'award', write a quote (reveals the Purchase order
    // button), then raise the PO and assert the C5b PDF metadata: PO number
    // mirrors docNoSuggest (PO-NNNN), supplier + priced lines flow through,
    // and the bytes are a real PDF (starts %PDF, one page).
    await page.selectOption('#proc-quote-vendor', 'v1');
    await page.evaluate(function () {
      var t = document.getElementById('proc-quote-tone');
      t.value = 'award';
      t.dispatchEvent(new Event('change', { bubbles: true }));
      // Clear the output first: the award-tone echo repeats the SAME money
      // lines as the P8 quote, so without a blank start runQuote's
      // wait-for-change would never fire and would time out.
      document.getElementById('proc-quote-out').textContent = '';
    });
    relay.mode = 'echo';
    auth.signedIn = true;
    const p9prev = await outText();
    await runQuote(p9prev);
    const p9btn = await page.evaluate(function () {
      return {
        poShown: !document.getElementById('proc-po').classList.contains('is-hide')
      };
    });
    check('P9a an award-tone quote reveals the Purchase order button', p9btn.poShown, p9btn);
    await page.evaluate(function () {
      window.__poMeta = null;
      window.MMGR.Proc.procPo();
    });
    const p9 = await page.evaluate(function () {
      var m = window.__poMeta || {};
      var rfqCleared = localStorage.getItem('mmgr_rfq_draft') === null;
      var book = MMGR.State.getState().supplierBook;
      var v1 = book.vendors.filter(function (v) {
        return String(v.id) === 'v1';
      })[0];
      var v1priced = book.items.filter(function (it) {
        return String(it.vendorId) === 'v1' && it.minPrice !== '' && isFinite(Number(it.minPrice));
      }).length;
      return {
        meta: m,
        rfqCleared: rfqCleared,
        v1priced: v1priced,
        v1name: v1 ? v1.name : '',
        counter: localStorage.getItem('mmgr_po_counter')
      };
    });
    const pm = p9.meta || {};
    check(
      'P9b procPo builds a real PDF: PO-NNNN number, supplier + every priced v1 line, one %PDF page, counter bumped',
      /^PO-\d{4}$/.test(pm.no || '') &&
        pm.supplier === p9.v1name &&
        pm.lines === p9.v1priced &&
        pm.lines > 0 &&
        pm.pages === 1 &&
        pm.bytes > 800 &&
        pm.pdf === '%PDF-' &&
        Number(p9.counter) >= 2,
      { meta: pm, v1priced: p9.v1priced, counter: p9.counter }
    );

    // ---- P10: lead time -> schedule link (directive 2026-10-18) ----
    // Select v1 in the ITEM table first (its disclosure carries data-id="v1")
    // - renderItems only draws rows for the selected supplier, and _selId is
    // ephemeral (the R1 reload cleared it; P9 set only the quote-vendor select).
    await page.click('[data-action="selVendor"][data-id="v1"]');
    await page.waitForSelector('#proc-item-body input[data-field="name"]', { timeout: 4000 });
    // Seed two tasks (fixture has none): one starting TODAY (linking a 14-day
    // lead lands after it = the late warning), one starting in 90 days (on
    // time). Give a v1 item a lead time, link it to the late task, and assert
    // the task fields, the warn toast, and the inline .lt-late tracker chip.
    const p10 = await page.evaluate(function () {
      var U = MMGR.Utils;
      var today = U.todayStr();
      var lateId = 'qa-lt-late';
      var okId = 'qa-lt-ok';
      MMGR.State.updateState(function (s) {
        s.tasks = s.tasks || [];
        s.tasks.push({ id: lateId, name: 'Pour slab', startDate: today, endDate: today });
        s.tasks.push({
          id: okId,
          name: 'Roof cover',
          startDate: U.fmtDate(U.addDays(today, 90)),
          endDate: U.fmtDate(U.addDays(today, 96))
        });
        // give the FIRST priced v1 item a 14-day supplier lead time
        var it = s.supplierBook.items.filter(function (x) {
          return String(x.vendorId) === 'v1' && isFinite(Number(x.minPrice));
        })[0];
        if (it) {
          it.leadTimeDays = '14';
          window.__p10Item = it.id;
        }
      });
      MMGR.Proc.render();
      // the Schedule button is enabled only when the row has lead days
      var btns = [...document.querySelectorAll('[data-action="procLead"]')];
      return {
        today: today,
        enabled: btns.filter(function (b) {
          return !b.disabled;
        }).length,
        total: btns.length
      };
    });
    check(
      'P10a a row with lead days shows an ENABLED Schedule button; rows without one stay disabled (never a guessed lead time)',
      p10.enabled >= 1 && p10.total >= 2 && p10.enabled < p10.total,
      p10
    );
    // Open the lead card for the first ENABLED row and link it to the LATE task.
    await page.evaluate(function () {
      var b = [...document.querySelectorAll('[data-action="procLead"]')].filter(function (x) {
        return !x.disabled;
      })[0];
      b.click();
    });
    await page.waitForSelector('#proc-lead:not(.is-hide) #proc-lead-task', { timeout: 4000 });
    const p10link = await page.evaluate(function (lateId) {
      var sel = document.getElementById('proc-lead-task');
      sel.value = lateId;
      var toastsBefore = document.querySelectorAll('.toast').length;
      document.querySelector('[data-action="procLeadLink"]').click();
      var toasts = [...document.querySelectorAll('.toast')].map(function (t) {
        return t.textContent || '';
      });
      var task = MMGR.State.getState().tasks.filter(function (t) {
        return t.id === lateId;
      })[0];
      return {
        lead: task && task.leadTime === true,
        submitted: task && task.submittedDate === MMGR.Utils.todayStr(),
        expected:
          task &&
          task.expectedDate === MMGR.Utils.fmtDate(MMGR.Utils.addDays(MMGR.Utils.todayStr(), 14)),
        cardHidden: document.getElementById('proc-lead').classList.contains('is-hide'),
        newToasts: toasts.slice(toastsBefore),
        warn: toasts.some(function (t) {
          return /lands .* after/i.test(t) && /Order earlier/.test(t);
        })
      };
    }, 'qa-lt-late');
    check(
      'P10b linking stamps leadTime + order date today + expected today+14, closes the card, and warns it lands after the task start',
      p10link.lead && p10link.submitted && p10link.expected && p10link.cardHidden && p10link.warn,
      p10link
    );
    // Flush the RAF renderDash uses, then read the tracker's inline chip.
    await page.evaluate(function () {
      MMGR.Render.renderDash();
      return new Promise(function (res) {
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            res();
          });
        });
      });
    });
    await page.waitForTimeout(200);
    const p10track = await page.evaluate(function () {
      var el = document.getElementById('leadtime-tracker-body');
      var html = el ? el.innerHTML : '';
      return {
        hasChip: /class="lt-late"/.test(html),
        namesTask: /Pour slab/.test(html),
        chipText: /lands after this task starts/.test(html)
      };
    });
    check(
      'P10c the Lead-Time Tracker shows the linked task with an inline late chip (order lands after the task start)',
      p10track.hasChip && p10track.namesTask && p10track.chipText,
      p10track
    );

    // E1 zero page errors (the /api/ mock chatter is expected noise).
    const real = pageErrors.filter(e => !/\/api\//.test(e));
    check('E1 zero page errors across every flowed gate', real.length === 0, real.slice(0, 4));

    await browser.close();
    browser = null;
  } catch (e) {
    failed++;
    log('FATAL ' + (e && e.message));
    if (browser) {
      try {
        await browser.close();
      } catch (e2) {}
    }
  }
  if (srv) {
    try {
      srv.kill();
    } catch (e) {}
  }
  log('==== PROCUREMENT: ' + passed + ' passed / ' + failed + ' failed ====');
  process.exit(failed ? 1 : 0);
})();
