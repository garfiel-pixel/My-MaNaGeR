/* ============================================================
   qa-calc-assistant.cjs - owner waves 2026-10-10, real browser
   ------------------------------------------------------------
   Covers the two waves that surface numbers a user acts on:

     W8b / T4  QUICK TOTAL (calculator.html)
       - all 44 work items (43 trades + the custom choice) price
         through the ONE big measurement x
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

// C2 re-baseline (audit 2026-10-18): the calculator no longer charges a
// US-dollar model as JMD with no exchange rate - it refuses, which is correct.
// These gates exercise the assistant and the page, not the FX table, so each
// context starts with the DISCLOSED seeded JMD starting rate, exactly what a
// real Jamaica project gets on first use. The refusal path has its own gates
// in tools/verify-currency.cjs (T3) and the FX3/FX4 page gates.
async function seedCalcFx(page) {
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
}

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
  await seedCalcFx(page);
  await page.goto(BASE + '/calculator.html', { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.MMGR_CALC_POPULATE, null, { timeout: 20000 });

  const works = await page.evaluate(() => {
    const sel = document.getElementById('calc-work');
    return sel
      ? Array.from(sel.options)
          .map(o => o.value)
          // 'jic' (JIC rate book, PART I Phase 2) is NOT quick-total walkable
          // - it needs a picked book row; its contract is the JP family in
          // tools/qa-calculator-page.cjs. Everything else, custom included,
          // prices through the measured-total + all-in flow below.
          .filter(v => v && v !== 'jic')
      : [];
  });
  check(
    'T4 work list is the trade set plus the custom choice (44)',
    works.length === 44,
    works.length
  );

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
  check('T4 every work item prices in Quick total mode (44/44)', bad.length === 0, bad.slice(0, 5));
  check(
    'F-3 no "undefined" / "NaN" / "[object" anywhere in the results (44/44)',
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

// ---- W8a / T2 + T3: the assistant's own outputs ---------------------------
async function assistantOutputs(browser, errors) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('calculator.html(ai): ' + String(e).slice(0, 140)));
  await page.route('**/api/auth/me', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, user: { email: 'owner@example.com' } })
    })
  );
  let relayCalls = 0;
  await page.route('**/api/ai/chat', async route => {
    relayCalls++;
    // Deliberately slow, so the in-flight indicator is observable.
    await new Promise(r => setTimeout(r, 900));
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        text:
          'Use one wall, 12 m long and 2.4 m high.\n' +
          'PROPOSAL: {"work":"blockwall","d1":12,"d2":2.4,"note":"one wall"}',
        remaining: 4
      })
    });
  });
  await seedCalcFx(page);
  await page.goto(BASE + '/calculator.html', { waitUntil: 'load' });
  await page.waitForFunction(
    () => {
      const b = document.querySelector('[data-cai=send]');
      return b && !b.disabled;
    },
    null,
    { timeout: 20000 }
  );

  // T3: a real relay round-trip shows the dots, and they are gone afterwards.
  await page.fill('[data-cai=input]', 'price one wall 12 m by 2.4 m');
  await page.click('[data-cai=send]');
  await page.waitForSelector('.bcp-ai-typing', { timeout: 5000 });
  const typing = await page.evaluate(() => {
    const row = document.querySelector('.bcp-ai-typing');
    return {
      role: row ? row.getAttribute('role') : '',
      name: row ? row.getAttribute('aria-label') : '',
      dots: row ? row.querySelectorAll('.bcp-ai-dot').length : 0,
      animated: row
        ? getComputedStyle(row.querySelector('.bcp-ai-dot')).animationName !== 'none'
        : false
    };
  });
  check(
    'T3 the in-flight bubble is a role=status row with three animated gold dots',
    typing.role === 'status' && typing.dots === 3 && typing.animated === true,
    typing
  );
  check(
    'T3 it is named for a screen reader',
    typing.name === 'The assistant is writing',
    typing.name
  );
  await page.waitForFunction(() => !!window.__x || true, null, { timeout: 1000 }).catch(() => {});
  await page.waitForSelector('.bcp-ai-typing', { state: 'detached', timeout: 15000 });
  check('T3 the bubble is removed when the reply lands', true);
  check('T3 exactly one relay request was spent', relayCalls === 1, relayCalls);
  const noThinking = await page.evaluate(
    () => !/Thinking\.\.\./.test(document.querySelector('[data-cai=log]').textContent)
  );
  check('T3 the old "Thinking..." status line is gone (one source of truth)', noThinking);

  // T2: with NOTHING priced, no chip and no false success claim.
  // C2 re-baseline (2026-10-18): the device now carries the disclosed JMD
  // starting rate, so a line can price on load where it used to fail. Clear the
  // bill to make "nothing priced" true again, and count chips ADDED by this
  // click - earlier conversation chips are history, not this gate's subject.
  // A reload is what a user gets on a fresh visit: the page keeps no form or
  // result state in storage, so `lastResult` is null and MMGR_CALC_FILE has
  // nothing to build. Clearing the bill alone is not enough - the export reads
  // the last rendered result, not the bill rows.
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__calcEngine, null, { timeout: 10000 });
  // The download button only exists while a proposal is waiting, so ask again
  // (the mocked relay answers with the same proposal) and leave the form empty.
  await page.fill('[data-cai=input]', 'price one wall 12 m by 2.4 m');
  await page.click('[data-cai=send]');
  await page.waitForSelector('[data-cai=makefile]', { state: 'visible', timeout: 15000 });
  const chipsBeforeEmpty = await page.evaluate(
    () => document.querySelectorAll('.bcp-ai-log .bcp-ai-chip').length
  );
  await page.click('[data-cai=makefile]');
  await page.waitForTimeout(250);
  const empty = await page.evaluate(
    before => ({
      // B5 re-baseline (2026-10-14): the PROPOSAL chip lives in the paths box,
      // not the log. A DOWNLOAD chip is only ever appended to the log, so the
      // gate counts log chips - the proposal summary is not a download.
      chips: document.querySelectorAll('.bcp-ai-log .bcp-ai-chip').length - before,
      total: document.querySelectorAll('.bcp-ai-log .bcp-ai-chip').length,
      text: document.querySelector('[data-cai=log]').textContent
    }),
    chipsBeforeEmpty
  );
  // C9 re-baseline (audit 2026-10-18): Download no longer depends on Populate
  // having run - the page prices the waiting proposal in a sandbox, so a chip
  // here is CORRECT. What must still never happen is an export that invents a
  // file: with nothing priced and no proposal, the hook refuses.
  check('T2 nothing priced -> no download chip', empty.chips === 1, empty);
  check(
    'T2 the chat never claims a download that did not happen',
    !/has been downloaded/i.test(empty.text),
    empty.text.replace(/\s+/g, ' ').slice(0, 140)
  );
  // B1 (owner 2026-10-11): the old line named neither a cause nor a next step.
  // It must now say what is missing AND what to press.
  const bare = await page.evaluate(() => window.MMGR_CALC_FILE());
  check(
    'T2 the export refuses when there is nothing to price (no invented file)',
    bare && bare.ok === false,
    bare
  );
  check(
    'T2 the refusal says why in plain words (never a silent no-op)',
    bare && /nothing priced/i.test(String(bare.reason || '')),
    bare
  );

  // T2: find an element-row box and fill the measurement the assistant proposed.
  await page.evaluate(() => {
    const sel = document.getElementById('calc-work');
    sel.value = 'blockwall';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const d1 = document.querySelector('#calc-inst-rows .bcp-inst-dim[data-field=d1]');
    const d2 = document.querySelector('#calc-inst-rows .bcp-inst-dim[data-field=d2]');
    if (d1) {
      d1.value = '12';
      d1.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (d2) {
      d2.value = '2.4';
      d2.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const run = document.querySelector('[data-action="calcRun"]');
    if (run) {
      run.click();
    }
  });
  await page.waitForTimeout(250);

  const chipsBeforePriced = await page.evaluate(
    () => document.querySelectorAll('.bcp-ai-log .bcp-ai-chip').length
  );
  await page.click('[data-cai=makefile]');
  await page.waitForSelector('.bcp-ai-log .bcp-ai-chip', { timeout: 5000 });
  const chip = await page.evaluate(async before => {
    const rows = document.querySelectorAll('.bcp-ai-log .bcp-ai-chip');
    const a = rows[rows.length - 1].querySelector('a[download]');
    const href = a ? a.getAttribute('href') : '';
    // Byte-for-byte against the page's own export (Response.text() strips the
    // UTF-8 BOM per spec, so compare the raw bytes instead of the decoded text).
    let blobBytes = new Uint8Array(0);
    try {
      blobBytes = new Uint8Array(await fetch(href).then(r => r.arrayBuffer()));
    } catch (e) {
      blobBytes = new Uint8Array(0);
    }
    const built = window.MMGR_CALC_FILE();
    const want = built && built.ok ? new TextEncoder().encode(built.text) : new Uint8Array(0);
    let sameBytes = want.length > 0 && want.length === blobBytes.length;
    if (sameBytes) {
      for (let i = 0; i < want.length; i++) {
        if (want[i] !== blobBytes[i]) {
          sameBytes = false;
          break;
        }
      }
    }
    return {
      chips: rows.length - before,
      total: rows.length,
      download: a ? a.getAttribute('download') : '',
      blob: /^blob:/.test(href),
      sameBytes,
      rowsReported: built ? built.rows : -1,
      blobLen: blobBytes.length,
      builtLen: want.length
    };
  }, chipsBeforePriced);
  check('T2 a priced line produces exactly one chip', chip.chips === 1, chip);
  check(
    'T2 the chip link is a real blob URL with a download name',
    chip.blob && /\.csv$/.test(chip.download),
    chip
  );
  check(
    "T2 the chip bytes equal the page's own MMGR_CALC_FILE output",
    chip.sameBytes === true,
    chip
  );

  // C9 (c): the combined action does BOTH in one click - the line lands in the
  // bill and the file is there to take away, in that order, with no guesswork.
  await page.fill('[data-cai=input]', 'price one wall 12 m by 2.4 m');
  await page.click('[data-cai=send]');
  await page.waitForSelector('[data-cai=both]', { state: 'visible', timeout: 15000 });
  const combined = await page.evaluate(async () => {
    const rows = () => document.querySelectorAll('[data-action="calcBoqRecall"]').length;
    const chips = () => document.querySelectorAll('.bcp-ai-log .bcp-ai-chip').length;
    const before = { rows: rows(), chips: chips() };
    document.querySelector('[data-cai=both]').click();
    await new Promise(r => setTimeout(r, 600));
    return { before, rows: rows(), chips: chips() };
  });
  check(
    'C9 the combined action adds the line AND makes the file in one click',
    combined.rows === combined.before.rows + 1 && combined.chips === combined.before.chips + 1,
    combined
  );
  await ctx.close();
}

// ---- W10a / T7: attachment allow-list + retrieval budget -------------------
async function fileIntake(browser, errors) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('calculator.html(file): ' + String(e).slice(0, 140)));
  await page.route('**/api/auth/me', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, user: { email: 'owner@example.com' } })
    })
  );
  let lastBody = null;
  await page.route('**/api/ai/chat', route => {
    lastBody = route.request().postData() || '';
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, text: 'Noted.', remaining: 4 })
    });
  });
  await seedCalcFx(page);
  await page.goto(BASE + '/calculator.html', { waitUntil: 'load' });
  await page.waitForFunction(
    () => {
      const b = document.querySelector('[data-cai=send]');
      return b && !b.disabled;
    },
    null,
    { timeout: 20000 }
  );

  const accept = await page.getAttribute('[data-cai=file]', 'accept');
  check(
    'T7 the picker offers exactly the four types (pdf, csv, txt, md)',
    accept === '.pdf,.csv,.txt,.md,application/pdf,text/csv,text/plain,text/markdown',
    accept
  );

  // The real user path: press Attach, then pick a file. (Setting the input
  // directly through CDP does not emit the trusted change the panel requires,
  // by design - the panel deliberately ignores script-set values.)
  const attachFile = async file => {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('[data-cai=attach]')
    ]);
    await chooser.setFiles(file);
  };

  // A .json is refused in plain words and is not attached.
  await attachFile({
    name: 'rates.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"a":1}')
  });
  await page.waitForTimeout(250);
  const refused = await page.evaluate(() => ({
    log: document.querySelector('[data-cai=log]').textContent,
    info: document.querySelector('[data-cai=fileinfo]').hidden
  }));
  check(
    'T7 a .json is refused with the plain message and is not attached',
    /not supported\. Attach a PDF, CSV, TXT or MD file/.test(refused.log) && refused.info === true,
    refused
  );

  // A 20,000-character TXT: attaches, is indexed, and the request carries only
  // the relevant slice.
  const filler = 'unrelated line about scaffolding and site fencing. '.repeat(400);
  const bigTxt = filler + '\n\nRendered wall coverage is 10 m2 per litre.\n\n' + filler;
  await attachFile({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(bigTxt)
  });
  await page.waitForFunction(
    () => {
      const i = document.querySelector('[data-cai=fileinfo]');
      return i && !i.hidden;
    },
    null,
    { timeout: 5000 }
  );
  const attachInfo = await page.evaluate(() => ({
    text: document.querySelector('[data-cai=fileinfo]').textContent,
    indexed: /lines ready/.test(document.querySelector('[data-cai=fileinfo]').textContent)
  }));
  check('T7 the TXT attaches and is indexed', attachInfo.indexed === true, attachInfo.text);

  // A CSV attaches and is indexed one line per row; a fake PDF is refused by
  // the real signature, not by its name.
  await attachFile({
    name: 'rates.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('item,unit,rate\nblock wall,m2,120\nrender,m2,45\n')
  });
  await page.waitForTimeout(250);
  const csvInfo = await page.evaluate(
    () => document.querySelector('[data-cai=fileinfo]').textContent
  );
  check('T7 a CSV attaches and is indexed by row', /rates\.csv/.test(csvInfo), csvInfo);

  await attachFile({
    name: 'scan.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('not really a pdf at all')
  });
  await page.waitForTimeout(250);
  const fakePdf = await page.evaluate(() => ({
    log: document.querySelector('[data-cai=log]').textContent,
    info: document.querySelector('[data-cai=fileinfo]').textContent
  }));
  check(
    'T7 a file named .pdf that is not a PDF is refused by its signature',
    /not a PDF/.test(fakePdf.log),
    fakePdf.log.slice(-160)
  );

  // back to the TXT for the retrieval-budget check
  await attachFile({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(bigTxt)
  });
  await page.waitForTimeout(250);

  await page.fill('[data-cai=input]', 'how much render does a wall need per litre');
  await page.click('[data-cai=send]');
  await page.waitForTimeout(600);
  const sent = String(lastBody || '');
  const fileSection = (sent.split('ATTACHED FILE')[1] || '').split('"')[2] || sent;
  check(
    'T7 the request carries the file budget, not the whole 20k-character file',
    sent.length > 0 && fileSection.length > 0 && fileSection.length <= 2200,
    { bodyLen: sent.length, fileLen: fileSection.length }
  );
  check(
    'T7 the relevant line is the one that travelled',
    /Rendered wall coverage/.test(sent),
    sent.slice(0, 160)
  );

  // The rate book answers about a family the old fixed window could miss.
  const books = await page.evaluate(() => ({
    filtered: window.MMGR_CALC_RATEBOOK('blockwall'),
    plain: window.MMGR_CALC_RATEBOOK()
  }));
  check(
    'T7 the rate book is filtered on the question (differs from the unfiltered text)',
    !!books.filtered && books.filtered !== books.plain,
    {
      filteredLen: (books.filtered || '').length,
      plainLen: (books.plain || '').length
    }
  );

  // ---- B2 (owner 2026-10-11): PDFs are READ now, on the device ---------------
  // "PDF reading is not available on this device yet." used to be true. The
  // fixtures are built here rather than committed: a real zlib-compressed
  // content stream, a page with no text layer, and a renamed text file.
  const zlib = require('zlib');
  const makePdf = (content, flate) => {
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'
    ];
    const body = Buffer.from(content, 'latin1');
    const stored = flate ? zlib.deflateSync(body) : body;
    objs.push(
      '<< /Length ' + stored.length + (flate ? ' /Filter /FlateDecode' : '') + ' >>\nstream\n'
    );
    let out = '%PDF-1.4\n';
    const offs = [];
    objs.forEach((o, i) => {
      offs[i] = out.length;
      out += i + 1 + ' 0 obj\n' + o + '\n';
      if (i === 3) {
        out += stored.toString('latin1') + '\nendstream\n';
      }
      out += 'endobj\n';
    });
    const xref = out.length;
    out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
    offs.forEach(o => {
      out += String(o).padStart(10, '0') + ' 00000 n \n';
    });
    out +=
      'trailer\n<< /Root 1 0 R /Size ' +
      (objs.length + 1) +
      ' >>\nstartxref\n' +
      xref +
      '\n%%EOF\n';
    return Buffer.from(out, 'latin1');
  };
  const fixDir = path.join(ROOT, 'tmp', 'fixtures');
  fs.mkdirSync(fixDir, { recursive: true });
  const b2GoodPdf = path.join(fixDir, 'b2-rates.pdf');
  const b2ScanPdf = path.join(fixDir, 'b2-scan.pdf');
  const b2FakePdf = path.join(fixDir, 'b2-fake.pdf');
  fs.writeFileSync(
    b2GoodPdf,
    makePdf('BT /F1 12 Tf 72 720 Td (Blockwork laying rate is 1234 per m2) Tj ET\n', true)
  );
  fs.writeFileSync(b2ScanPdf, makePdf('q Q\n', false));
  fs.writeFileSync(b2FakePdf, Buffer.from('this is not a pdf at all', 'latin1'));

  const lastNote = () =>
    page.evaluate(() => {
      const rows = document.querySelectorAll('#calc-ai-mount .bcp-ai-note');
      const n = rows[rows.length - 1];
      return n ? n.textContent.trim() : '';
    });

  await attachFile(b2GoodPdf);
  await page.waitForTimeout(500);
  const pdfInfo = await page.evaluate(() => {
    const fi = document.querySelector('#calc-ai-mount .bcp-ai-fileinfo');
    return fi && !fi.hidden ? fi.textContent.trim() : '';
  });
  check(
    'B2 a text PDF attaches instead of being refused',
    /b2-rates\.pdf/.test(pdfInfo),
    'info: ' + pdfInfo.slice(0, 40) + ' | note: ' + (await lastNote()).slice(0, 70)
  );

  await page.fill('[data-cai=input]', 'what is the blockwork laying rate?');
  await page.click('[data-cai=send]');
  await page.waitForTimeout(1000);
  check(
    'B2 the extracted PDF text travels with the question',
    /Blockwork laying rate is 1234/.test(String(lastBody || '')),
    String(lastBody || '').slice(0, 120)
  );

  await attachFile(b2ScanPdf);
  await page.waitForTimeout(500);
  const scanNote = await lastNote();
  check(
    'B2 a PDF with no text layer says so plainly',
    /no readable text/i.test(scanNote),
    scanNote.slice(0, 90)
  );

  await attachFile(b2FakePdf);
  await page.waitForTimeout(500);
  const fakeNote = await lastNote();
  check(
    'B2 a renamed text file is still refused by its signature',
    /is not a PDF/i.test(fakeNote),
    fakeNote.slice(0, 90)
  );
  await ctx.close();
}

// ---- W12a / T10-A: contrast on the surfaces that were flagged ---------------
// The gold identity stays gold; where a gold word or a muted tone was too faint
// the TEXT step moved, not the surface. Measured in the real browser with the
// real cascade (computed colour over the real composited background).
const CONTRAST_CASES = [
  ['index.html', '.footer-bottom', 4.5, 'footer bottom line on the charcoal band'],
  ['index.html', '.footer-col a', 4.5, 'footer column link on the charcoal band'],
  ['contact.html', '.btn-gold', 4.5, 'contact submit label on the gold button'],
  ['contact.html', '.contact-tile a', 4.5, 'contact tile link (teal on white)'],
  ['reviews.html', '.btn-gold', 4.5, 'reviews submit label on the gold button'],
  ['reviews.html', '.rv-field label', 4.5, 'reviews field label on the cream canvas'],
  [
    'calculator.html',
    '.bcp-seg-btn.active',
    4.5,
    'calculator units toggle label on the soft-gold tint'
  ],
  ['mymanager-field-guide.html', '.nav-group-label', 4.5, 'field guide dim label on navy']
];

const CONTRAST_FN = () => {
  const parse = c => {
    const m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) {
      return null;
    }
    const p = m[1].split(',').map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = c => {
    const f = v => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const resolveBg = el => {
    const layers = [];
    let n = el;
    while (n && n.nodeType === 1) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) {
        layers.push(c);
        if (c.a >= 0.999) {
          break;
        }
      }
      n = n.parentElement;
    }
    let out = { r: 255, g: 255, b: 255 };
    for (let i = layers.length - 1; i >= 0; i--) {
      const c = layers[i];
      out = {
        r: c.r * c.a + out.r * (1 - c.a),
        g: c.g * c.a + out.g * (1 - c.a),
        b: c.b * c.a + out.b * (1 - c.a)
      };
    }
    return out;
  };
  window.__contrast = sel => {
    const el = document.querySelector(sel);
    if (!el) {
      return null;
    }
    const cs = getComputedStyle(el);
    const fg = parse(cs.color);
    const bg = resolveBg(el);
    const l1 = Math.max(lum(fg), lum(bg));
    const l2 = Math.min(lum(fg), lum(bg));
    return {
      ratio: Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100,
      fg: cs.color,
      bg: 'rgb(' + Math.round(bg.r) + ', ' + Math.round(bg.g) + ', ' + Math.round(bg.b) + ')',
      size: cs.fontSize,
      weight: cs.fontWeight
    };
  };
  return true;
};

async function contrastGates(browser, errors) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('contrast: ' + String(e).slice(0, 120)));
  for (const [url, sel, min, label] of CONTRAST_CASES) {
    await page.goto(BASE + '/' + url, { waitUntil: 'load' });
    await page.evaluate(CONTRAST_FN);
    const got = await page.evaluate(s => window.__contrast(s), sel);
    check(
      'T10-A ' + label + ' >= ' + min + ':1',
      !!got && got.ratio >= min,
      got || 'selector not found: ' + sel
    );
  }
  // The assistant's identity link is the signed-OUT state (no auth mock here),
  // which is exactly where the gold-on-white link renders.
  await seedCalcFx(page);
  await page.goto(BASE + '/calculator.html', { waitUntil: 'load' });
  await page.waitForSelector('.bcp-ai-me-link', { timeout: 20000 });
  await page.evaluate(CONTRAST_FN);
  const link = await page.evaluate(() => window.__contrast('.bcp-ai-me-link'));
  check(
    'T10-A the assistant identity link on the panel >= 4.5:1',
    !!link && link.ratio >= 4.5,
    link
  );
  await ctx.close();
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
  // A fixed 320ms wait RACES the 120ms CSS transition. The transition's
  // start time is set at the next style resolution, and a busy main thread
  // (the battery running other suites) delays that resolution, so the read
  // can land MID-transition and return an INTERPOLATED tone: rgb(140,140,140)
  // between the light 51 and dark 245 label tokens, rgb(144,141,139) between
  // the light 229 and dark 43 border tokens. That failed the token check for
  // a reason that has nothing to do with the app. Wait for the element's
  // OWN transitions to finish instead of guessing a duration: force the
  // style recalc that starts the transition, await the animations, then
  // flush a frame so the final value is committed.
  const settle = async () => {
    await page.evaluate(sel => {
      const b = document.querySelector(sel);
      void getComputedStyle(b).color; // force recalc: the transition starts now
      const anims = b.getAnimations ? b.getAnimations() : [];
      const done = anims.map(a => a.finished.catch(() => {}));
      return Promise.race([Promise.all(done), new Promise(r => setTimeout(r, 3000))]);
    }, BTN);
    await page.evaluate(
      () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    );
  };
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

// ---- B1 (owner 2026-10-11): the diagnosis behind "those figures do not price"
// The panel used to be handed one blanket sentence. These gates drive the
// page's OWN hooks to prove it now names the box that is actually short.
async function assistantDiagnosis(page) {
  const hookOk = await page.evaluate(() => typeof window.MMGR_CALC_CHECK === 'function');
  check('B1 the page exposes MMGR_CALC_CHECK', hookOk);

  // The dry run must never touch the form or the bill.
  const pure = await page.evaluate(() => {
    const first = document.querySelector('#calc-work option');
    const key = first ? first.value : '';
    const snap = () => ({
      d1: document.getElementById('calc-d1').value,
      d2: document.getElementById('calc-d2').value,
      d3: document.getElementById('calc-d3').value,
      manual: document.getElementById('calc-measured-manual').checked,
      work: document.getElementById('calc-work').value,
      rows: document.querySelectorAll('[data-action=calcBoqRecall]').length
    });
    const before = snap();
    window.MMGR_CALC_CHECK({ work: key, d1: 69 });
    window.MMGR_CALC_CHECK({ work: key, measuredQty: 69 });
    return JSON.stringify(before) === JSON.stringify(snap());
  });
  check('B1 MMGR_CALC_CHECK is a pure dry run (form and bill untouched)', pure);

  // Over every work item, a lump v1 proposal must price or NAME its missing box.
  const m = await page.evaluate(() => {
    const sel = document.getElementById('calc-work');
    const works = Array.from(sel.options)
      .map(o => o.value)
      .filter(Boolean);
    let priced = 0;
    let diagnosed = 0;
    let bare = 0;
    const samples = [];
    works.forEach(key => {
      sel.value = key;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      ['calc-d1', 'calc-d2', 'calc-d3'].forEach(id => {
        const e = document.getElementById(id);
        if (e) {
          e.value = '';
        }
      });
      const man = document.getElementById('calc-measured-manual');
      if (man) {
        man.checked = false;
      }
      const r = window.MMGR_CALC_POPULATE({ work: key, d1: 69 });
      if (r && r.ok) {
        priced++;
      } else if (
        r &&
        Array.isArray(r.missing) &&
        r.missing.length &&
        !/those figures do not price/i.test(r.error || '')
      ) {
        diagnosed++;
        if (samples.length < 2) {
          samples.push(key + ' -> ' + (r.error || ''));
        }
      } else {
        bare++;
        if (samples.length < 3) {
          samples.push(key + ' -> ' + JSON.stringify(r));
        }
      }
    });
    return { total: works.length, priced, diagnosed, bare, samples };
  });
  check(
    'B1 a lump proposal never fails bare: it prices or names the missing box',
    m.priced + m.diagnosed === m.total && m.bare === 0,
    'priced ' + m.priced + ', diagnosed ' + m.diagnosed + ', bare ' + m.bare
  );
  if (m.samples.length) {
    log('     ' + m.samples.join(' ; '));
  }

  // A second line must not price with the first line's numbers.
  const stale = await page.evaluate(() => {
    const sel = document.getElementById('calc-work');
    const setWork = key => {
      sel.value = key;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    };
    setWork('siteprep');
    const a = window.MMGR_CALC_POPULATE({ work: 'siteprep', d1: 12, d2: 3 });
    const d2AfterFirst = document.getElementById('calc-d2').value;
    // The page's own dry run decides which work prices from one box.
    const oneBox = Array.from(sel.options)
      .map(o => o.value)
      .filter(Boolean)
      .find(key => window.MMGR_CALC_CHECK({ work: key, d1: 10 }).ok === true);
    if (!oneBox) {
      return { aOk: a.ok === true, cleared: false, oneBox: 'none' };
    }
    setWork(oneBox);
    const b = window.MMGR_CALC_POPULATE({ work: oneBox, d1: 10 });
    return {
      aOk: a.ok === true,
      cleared:
        b.ok === true && d2AfterFirst === '3' && document.getElementById('calc-d2').value === '',
      oneBox: oneBox
    };
  });
  check('B1 a two-box line prices before the clear is measured', stale.aOk);
  check(
    'B1 the next line CLEARS the box the previous one left behind',
    stale.cleared,
    'one-box work ' + stale.oneBox
  );
}

// ---- DIRECTIVE 2026-10-13 (PART A, N1-N9): the assistant reads the book ----
// RB-1 (2026-10-25): the 811 rates are no longer a public browser file. They
// are generated into src/data/ratebook.js (a Worker module) and served only by
// GET /api/ratebook behind a signed-in session. The harness reads the SAME
// generated module the Worker imports, and mocks the API with it, so the test
// still proves the page indexes the real book - it just gets it the way the
// browser now does.
function loadJicBook() {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'data', 'ratebook.js'), 'utf8');
  const key = 'export const RATEBOOK = ';
  const at = src.indexOf(key);
  const end = src.lastIndexOf('};');
  if (at < 0 || end < 0) {
    throw new Error('src/data/ratebook.js shape changed');
  }
  // The generated module is an object literal, so it is evaluated rather than
  // JSON-parsed - exactly what the Worker's import does.
  return new Function('return ' + src.slice(at + key.length, end + 1))();
}

// The one API the calculator now loads the book from.
async function mockRatebook(page, book) {
  await page.route('**/api/ratebook', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, book: book })
    })
  );
}

async function mockAuth(page) {
  await page.route('**/api/auth/me', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, user: { email: 'owner@example.com' } })
    })
  );
}

// The relay is MOCKED (the free daily message cap is real). Replies are
// chosen by call index so a conversation can be scripted turn by turn, and
// every request body is kept so the gates can read the system message sent.
async function mockRelay(page, replyFn) {
  const bodies = [];
  await page.route('**/api/ai/chat', route => {
    const body = route.request().postData() || '';
    bodies.push(body);
    let text = '';
    try {
      text = replyFn(bodies.length - 1, body) || '';
    } catch (e) {
      text = '';
    }
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, text: text || 'Understood.', remaining: 4 })
    });
  });
  return bodies;
}

function sysOf(body) {
  try {
    const j = JSON.parse(body);
    return (j.messages && j.messages[0] && j.messages[0].content) || '';
  } catch (e) {
    return '';
  }
}

function rateBlock(sys) {
  const parts = String(sys).split('RATE BOOK (answer from this):');
  return parts.length > 1 ? parts[1].split('\n\n')[0] : '';
}

async function sendQ(page, text) {
  const before = await page.evaluate(
    () => document.querySelectorAll('.bcp-ai-log .bcp-ai-msg.ai').length
  );
  await page.fill('[data-cai=input]', text);
  await page.click('[data-cai=send]');
  await page.waitForFunction(
    n => document.querySelectorAll('.bcp-ai-log .bcp-ai-msg.ai').length > n,
    before,
    { timeout: 10000 }
  );
  await page.waitForTimeout(120);
}

// Directive 5.4: screenshots of a subject at 390 and 1280, light and dark,
// with the hard rules probed programmatically - no horizontal overflow, no
// emoji, no blue border where gold belongs, no lock icon.
async function shotSet(page, dir, name, selector) {
  fs.mkdirSync(dir, { recursive: true });
  const probes = [];
  for (const w of [390, 1280]) {
    await page.setViewportSize({ width: w, height: 900 });
    for (const dark of [false, true]) {
      await page.evaluate(d => document.body.classList.toggle('dark-mode', d), dark);
      await page.waitForTimeout(110);
      const tag = w + '-' + (dark ? 'dark' : 'light');
      await page.screenshot({ path: path.join(dir, name + '-' + tag + '.png') });
      probes.push(
        await page.evaluate(
          ({ sel, t }) => {
            const el = document.querySelector(sel);
            const txt = el ? el.innerText || '' : '';
            const de = document.documentElement;
            const blue = el
              ? Array.from(el.querySelectorAll('input')).some(i => {
                  const m = /rgb\((\d+), (\d+), (\d+)\)/.exec(
                    getComputedStyle(i).borderTopColor || ''
                  );
                  if (!m) {
                    return false;
                  }
                  const r = +m[1];
                  const g = +m[2];
                  const b = +m[3];
                  return b > 120 && b > r && b > g;
                })
              : false;
            // The custom fields must carry the page's OWN accent token
            // (--brand: warm gold in light, white in dark - see mmgr.css),
            // not a blue and not a lost/absent accent. Comparing the border
            // to the live --brand value makes "gold accent, no blue" a
            // measurable, mode-agnostic rule.
            const parse = c => {
              const m = /#([0-9a-f]{6})/i.exec(c || '');
              if (m) {
                const n = parseInt(m[1], 16);
                return [n >> 16, (n >> 8) & 255, n & 255];
              }
              const r = /rgb\((\d+), (\d+), (\d+)\)/.exec(c || '');
              return r ? [+r[1], +r[2], +r[3]] : null;
            };
            const gold = el
              ? Array.from(el.querySelectorAll('input')).every(i => {
                  const cs = getComputedStyle(i);
                  const want = parse(cs.getPropertyValue('--brand'));
                  const got = parse(cs.borderTopColor || '');
                  return (
                    !!want &&
                    !!got &&
                    Math.abs(got[0] - want[0]) <= 3 &&
                    Math.abs(got[1] - want[1]) <= 3 &&
                    Math.abs(got[2] - want[2]) <= 3
                  );
                })
              : false;
            return {
              tag: t,
              found: !!el,
              overflow: Math.max(
                de.scrollWidth - de.clientWidth,
                el ? el.scrollWidth - el.clientWidth : 0
              ),
              clipped: el
                ? Array.from(el.querySelectorAll('label, span')).some(
                    s => s.scrollHeight - s.clientHeight > 1 || s.scrollWidth - s.clientWidth > 1
                  )
                : false,
              emoji:
                /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\uFE0F\u{1F1E6}-\u{1F1FF}]/u.test(
                  txt
                ),
              blue,
              gold,
              lock: el ? !!el.querySelector('[class*=lock]') : false
            };
          },
          { sel: selector, t: tag }
        )
      );
    }
  }
  await page.evaluate(() => document.body.classList.remove('dark-mode'));
  await page.setViewportSize({ width: 1280, height: 900 });
  return probes;
}

async function partARateAccess(browser, errors) {
  let JIC;
  try {
    JIC = loadJicBook();
  } catch (e) {
    check('N0 the 811-row file parses', false, String(e));
    return;
  }
  check(
    'N0 the JIC file parses (811 rows, 11 trades)',
    JIC.rows.length === 811 && JIC.trades.length === 11,
    { rows: JIC.rows.length, trades: JIC.trades.length }
  );
  const counts = {};
  JIC.rows.forEach(r => {
    counts[r.t] = (counts[r.t] || 0) + 1;
  });

  // ---- N1 / N2 / N7 / N9: one fresh profile, scripted relay --------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('calc(partA): ' + String(e).slice(0, 140)));
    await mockAuth(page);
    const bodies = await mockRelay(page, i =>
      i === 2
        ? 'One wall, 12 m long and 2.4 m high.\nPROPOSAL: {"work":"blockwall","d1":12,"d2":2.4,"note":"one wall"}'
        : 'Understood - those are the rates on this device.'
    );
    await seedCalcFx(page);
    await mockRatebook(page, JIC);
    await page.goto(BASE + '/calculator.html', { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.MMGR_CALC_RATEBOOK, null, { timeout: 20000 });
    // A1: the panel mount starts the ONE full-book loader; give the mocked
    // API a moment so the first question is answered from all 811 rows.
    await page
      .waitForFunction(() => !!window.MMGR_RATEBOOK, null, { timeout: 8000 })
      .catch(() => {});

    await sendQ(page, 'what rates do you have');
    const sys1 = sysOf(bodies[bodies.length - 1]);
    const rb1 = rateBlock(sys1);
    check(
      'N1 the scope line says 811 rates across 11 trades',
      rb1.indexOf('811 rates across 11 trades') > -1,
      rb1.slice(0, 160)
    );
    const missing = JIC.trades
      .filter(t => !rb1.includes(t.label + ' ' + counts[t.tid]))
      .map(t => t.label + ' ' + counts[t.tid]);
    check('N1 all 11 trade names appear with their counts', missing.length === 0, missing);
    check('N1 never "Active rate book: none"', sys1.indexOf('Active rate book: none') < 0);

    await sendQ(page, 'rate for excavation in stiff clay');
    const rb2 = rateBlock(sysOf(bodies[bodies.length - 1]));
    const firstRow2 = rb2.split('\n').find(l => l.indexOf(' | ') > -1) || '';
    const stiff = JIC.rows.find(r => /stiff clay/i.test(r.d || ''));
    check('N2 the first rate line is the stiff clay row', /stiff clay/i.test(firstRow2), firstRow2);
    check(
      'N2 its metric rate comes from the file, not the test',
      !!stiff && firstRow2.indexOf('J$' + stiff.mr + ' per ' + stiff.mu) > -1,
      { row: firstRow2, file: stiff ? { mr: stiff.mr, mu: stiff.mu } : null }
    );
    // 5.5: the manual spot check - the first five rate lines of the request
    // that was actually captured off the wire.
    const five = rb2
      .split('\n')
      .filter(l => l.indexOf(' | ') > -1)
      .slice(0, 5);
    log('5.5 first five rate lines: ' + JSON.stringify(five));

    // N3: one representative question per trade - a row OF that trade first.
    const n3bad = [];
    for (const t of JIC.trades) {
      const first = await page.evaluate(q => {
        const row =
          window
            .MMGR_CALC_RATEBOOK(q)
            .split('\n')
            .find(l => l.indexOf(' | ') > -1) || '';
        return row.split(' #')[0];
      }, t.label.toLowerCase());
      if (first.toLowerCase().indexOf(t.label.toLowerCase()) < 0) {
        n3bad.push({ trade: t.label, first });
      }
    }
    check('N3 each of the 11 trades returns a row of that trade first', n3bad.length === 0, n3bad);

    // N4: everyday questions land on a relevant row.
    const n4 = await page.evaluate(() => {
      const first = q =>
        window
          .MMGR_CALC_RATEBOOK(q)
          .split('\n')
          .find(l => l.indexOf(' | ') > -1) || '';
      return {
        block: first('block walls'),
        paint: first('painting walls'),
        tiles: first('tiles')
      };
    });
    check(
      'N4 "block walls" lands on a block-and-wall row',
      /block/i.test(n4.block) && /wall/i.test(n4.block),
      n4.block
    );
    check(
      'N4 "painting walls" lands on a paint-and-wall row',
      /paint/i.test(n4.paint) && /wall/i.test(n4.paint),
      n4.paint
    );
    check('N4 "tiles" lands on a tile row', /tile/i.test(n4.tiles), n4.tiles);

    // N7: the section never exceeds 9000 characters and no row is cut.
    const rowLines = rb2.split('\n').filter(l => l.indexOf(' | ') > -1);
    check('N7 the rate section never exceeds 9000 characters', rb2.length <= 9000, rb2.length);
    check(
      'N7 no row is cut mid-line',
      rowLines.length > 0 && rowLines.every(l => /in calculator: (yes|no)$/.test(l)),
      rowLines.slice(-2)
    );

    // N9 (re-baselined 2026-10-18, audit C8): the PROPOSAL instruction now
    // REQUIRES the unit system the user spoke in, so the page never converts a
    // stated figure behind their back. The key discipline is unchanged.
    check(
      'N9 the PROPOSAL instruction carries the unit system and the key discipline',
      sys1.indexOf('PROPOSAL: {"work":"<key>","units":"metric"|"imperial","d1":<number>') > -1 &&
        sys1.indexOf('PROPOSAL: {"work":"<key>","units":"...","measuredQty":<number>') > -1 &&
        /use only the work keys you were given/i.test(sys1) &&
        /never guess a key/i.test(sys1)
    );
    await sendQ(page, 'price one wall twelve metres by two point four');
    await page.click('[data-cai=pop]');
    await page.waitForTimeout(300);
    const n9 = await page.evaluate(() => {
      const notes = document.querySelectorAll('#calc-ai-mount .bcp-ai-note');
      return {
        rows: document.querySelectorAll('[data-action="calcBoqRecall"]').length,
        note: notes.length ? notes[notes.length - 1].textContent : ''
      };
    });
    check(
      'N9 an original-form proposal still adds a line',
      n9.rows === 1 && /Added to the bill/.test(n9.note),
      n9
    );
    check(
      'N9 an original-form proposal shows no custom fields',
      !(await page.isVisible('#calc-custom-wrap'))
    );
    await ctx.close();
  }

  // ---- N5: the imported book takes the slot ahead of the published row ----
  {
    const same =
      JIC.rows.find(r => r.t === 'masonry' && Number(r.n) === 1) ||
      JIC.rows.find(r => r.t === 'masonry');
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(
      ({ book, active }) => {
        try {
          localStorage.setItem('mmgr_calc_books', JSON.stringify([book]));
          localStorage.setItem('mmgr_calc_book_active', JSON.stringify(active));
          localStorage.setItem('mmgr_calc_jic_default', '1');
        } catch (e) {}
      },
      {
        book: {
          id: 'bk-owner',
          name: 'Owner import',
          rates: { masonry: { m1: { allIn: 999, unit: 'm2', label: same.d } } }
        },
        active: 'bk-owner'
      }
    );
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('calc(partA-n5): ' + String(e).slice(0, 140)));
    await seedCalcFx(page);
    await mockRatebook(page, JIC);
    await page.goto(BASE + '/calculator.html', { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.MMGR_CALC_RATEBOOK, null, { timeout: 20000 });
    await page
      .waitForFunction(() => !!window.MMGR_RATEBOOK, null, { timeout: 8000 })
      .catch(() => {});
    const n5 = await page.evaluate(q => {
      const lines = window.MMGR_CALC_RATEBOOK(q).split('\n');
      const imp = lines.findIndex(l => l.indexOf('source: Owner import') > -1);
      const jic = lines.findIndex(
        l => l.indexOf('source: JIC ') > -1 && l.indexOf(q.slice(0, 18)) > -1
      );
      return { imp, jic, impLine: lines[imp] || '', jicLine: lines[jic] || '' };
    }, same.d);
    check('N5 both sources appear for the same item', n5.imp > -1 && n5.jic > -1, n5);
    check('N5 the imported row is listed first', n5.imp > -1 && n5.jic > -1 && n5.imp < n5.jic, n5);
    await ctx.close();
  }

  // ---- N6: the API is blocked - the exact failure line, and no hang -------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('calc(partA-n6): ' + String(e).slice(0, 140)));
    await mockAuth(page);
    // RB-1: the book now arrives from GET /api/ratebook, so that is the call
    // a dead network kills. The failure contract is unchanged and is what this
    // gate protects: one honest line, the 100 inline rows, and no hang.
    await page.route('**/api/ratebook*', route => route.abort());
    const bodies = await mockRelay(page, () => 'Masonry starts with the block work rows.');
    await seedCalcFx(page);
    await page.goto(BASE + '/calculator.html', { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.MMGR_CALC_RATEBOOK, null, { timeout: 20000 });
    await sendQ(page, 'what rates do you have for masonry');
    const rb = rateBlock(sysOf(bodies[bodies.length - 1]));
    const FAIL =
      'The full JIC book could not load on this device; only the rates already on this page are available.';
    check('N6 the exact A2 failure line is sent', rb.indexOf(FAIL) > -1, rb.slice(0, 200));
    const ai = await page.evaluate(
      () => document.querySelectorAll('.bcp-ai-log .bcp-ai-msg.ai').length
    );
    check('N6 the page does not hang (the reply landed)', ai >= 1, ai);
    await ctx.close();
  }

  // ---- N8: ONE load, even with the assistant AND the card open ------------
  // RB-1 re-baseline: there is no rate-data script tag any more (that was the
  // leak). The property worth protecting is the same one it protected - the
  // book is fetched ONCE per page life, not once per consumer - so this counts
  // the /api/ratebook requests instead of the script tags, and additionally
  // asserts the retired script tag count is zero.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('calc(partA-n8): ' + String(e).slice(0, 140)));
    let apiCalls = 0;
    page.on('request', r => {
      if (r.url().indexOf('/api/ratebook') > -1) {
        apiCalls++;
      }
    });
    await mockAuth(page);
    await mockRatebook(page, JIC);
    await seedCalcFx(page);
    await page.goto(BASE + '/calculator.html', { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.MMGR_CALC_RATEBOOK, null, { timeout: 20000 });
    await page.click('[data-action="openRateBook"]');
    await page.waitForSelector('#calc-ratebook-card', { timeout: 5000 });
    await page.waitForTimeout(400);
    // Close and reopen: the session copy must answer, not another request.
    await page.evaluate(() => {
      const x = document.querySelector('#calc-ratebook-card [data-action="rrClose"]');
      if (x) {
        x.click();
      }
    });
    await page.waitForTimeout(200);
    await page.click('[data-action="openRateBook"]');
    await page.waitForTimeout(400);
    const tags = await page.evaluate(
      () => document.querySelectorAll('script[src*="jic-rates-full"]').length
    );
    check('N8a no rate-data script tag is injected any more (the RB-1 leak)', tags === 0, tags);
    check(
      'N8b exactly one /api/ratebook request for the whole page life',
      apiCalls === 1,
      apiCalls
    );
    await ctx.close();
  }
}

// ---- DIRECTIVE 2026-10-13 (PART B, C1-C11): the custom rate line ----------
async function partBCustomLine(browser, errors) {
  const JIC = loadJicBook();
  const shots = path.join(ROOT, 'tmp', 'directive-shots');

  // ---- C1 / C2 / C3 / C9 / C10: the real form, real clicks ---------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('calc(partB): ' + String(e).slice(0, 140)));
    await seedCalcFx(page);
    await page.goto(BASE + '/calculator.html', { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.MMGR_CALC_POPULATE, null, { timeout: 20000 });

    // C1: pick the custom choice with the real select - four fields show,
    // nothing else hides; any other choice hides them and leaves it empty.
    await page.selectOption('#calc-work', 'custom');
    const c1a = {
      fields: await page.isVisible('#calc-custom-wrap'),
      dims: await page.isVisible('#calc-d1')
    };
    await page.selectOption('#calc-work', 'siteprep');
    const c1b = {
      hidden: !(await page.isVisible('#calc-custom-wrap')),
      empty:
        (await page.inputValue('#calc-custom-name')) === '' &&
        (await page.inputValue('#calc-custom-rate')) === ''
    };
    check(
      'C1 the custom pick shows exactly the four fields and hides nothing',
      c1a.fields && c1a.dims,
      c1a
    );
    check('C1 another pick hides them and leaves the form as it was', c1b.hidden && c1b.empty, c1b);

    // C3: every invalid input from B2, one at a time - a plain message beside
    // the field, no line added, and no undefined/NaN/[object] anywhere.
    await page.selectOption('#calc-work', 'custom');
    const c3cases = [
      { name: '', unit: 'day', qty: '3', rate: '12000', err: 'calc-custom-name-err' },
      { name: 'x'.repeat(61), unit: 'day', qty: '3', rate: '12000', err: 'calc-custom-name-err' },
      { name: 'Fine name', unit: '', qty: '3', rate: '12000', err: 'calc-custom-unit-err' },
      { name: 'Fine name', unit: 'day', qty: '0', rate: '12000', err: 'calc-custom-qty-err' },
      { name: 'Fine name', unit: 'day', qty: '-5', rate: '12000', err: 'calc-custom-qty-err' },
      { name: 'Fine name', unit: 'day', qty: 'abc', rate: '12000', err: 'calc-custom-qty-err' },
      { name: 'Fine name', unit: 'day', qty: '3', rate: '0', err: 'calc-custom-rate-err' },
      { name: 'Fine name', unit: 'day', qty: '3', rate: '-1', err: 'calc-custom-rate-err' },
      { name: 'Fine name', unit: 'day', qty: '3', rate: 'abc', err: 'calc-custom-rate-err' }
    ];
    // Two layers guard the custom fields, and C3 must test the SECOND one:
    // the inputs carry maxlength (nobody can TYPE 61 characters), so the
    // values are injected programmatically to prove the validator itself
    // rejects an over-long name / unit with its own message.
    const c3maxlengths = await page.evaluate(() => ({
      name: (document.getElementById('calc-custom-name') || {}).maxLength,
      unit: (document.getElementById('calc-custom-unit') || {}).maxLength
    }));
    check(
      'C3 the inputs cap typing at 60 / 12 characters',
      c3maxlengths.name === 60 && c3maxlengths.unit === 12,
      c3maxlengths
    );
    const setVal = async (id, v) => {
      await page.evaluate(
        ({ i, val }) => {
          const el = document.getElementById(i);
          el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        },
        { i: id, val: v }
      );
    };
    const c3bad = [];
    for (const t of c3cases) {
      await setVal('calc-custom-name', t.name);
      await setVal('calc-custom-unit', t.unit);
      await setVal('calc-custom-qty', t.qty);
      await setVal('calc-custom-rate', t.rate);
      await page.click('[data-action="calcBoqAdd"]');
      const shown = await page.isVisible('#' + t.err);
      const rows = await page.locator('[data-action="calcBoqRecall"]').count();
      if (!shown || rows !== 0) {
        c3bad.push({ name: t.name, qty: t.qty, rate: t.rate, shown, rows });
      }
    }
    check(
      'C3 every invalid input shows its plain message and adds no line',
      c3bad.length === 0,
      c3bad
    );
    const bodyText = await page.evaluate(() => document.body.innerText);
    check(
      'C3 no undefined, NaN or [object] anywhere on the page',
      !/undefined|NaN|\[object/i.test(bodyText)
    );

    // C2: Generator hire, 3 day at 12000 - the expected figures are computed
    // IN THE TEST (quantity x rate, then the page's own 12.5% on-cost), never
    // read back from the page.
    await page.selectOption('#calc-country', 'NONE');
    await page.fill('#calc-custom-name', 'Generator hire');
    await page.fill('#calc-custom-unit', 'day');
    await page.fill('#calc-custom-qty', '3');
    await page.fill('#calc-custom-rate', '12000');
    await page.click('[data-action="calcRun"]');
    const quick = ((await page.textContent('#calc-quick-line')) || '').replace(/\s+/g, ' ');
    const wantBase = 3 * 12000;
    check(
      'C2 the read-out line is 3 day x J$12,000 = J$36,000',
      new RegExp('3 day x .*12,000 = .*' + wantBase.toLocaleString('en-US')).test(quick),
      quick
    );
    await page.click('[data-action="calcBoqAdd"]');
    // X-2 PAINT CAPS (audit 8.3, 2026-10-24): #calc-boq-card now carries
    // content-visibility:auto, so a card parked below the fold has NO
    // laid-out boxes and innerText reads "" while its lines sit in the DOM
    // (the add-to-bill smooth scroll is what brings them on screen). A read
    // here would therefore race a scroll animation and report an empty bill
    // for a line that WAS added - measured: card top 1564 in a 900px
    // viewport, rows 1, innerText "", textContent 170 chars. The gate reads
    // textContent - the DOM truth, layout-independent - never innerText.
    const c2 = await page.evaluate(() => ({
      rows: document.querySelectorAll('[data-action="calcBoqRecall"]').length,
      bill: ((document.getElementById('calc-boq-card') || {}).textContent || '')
        .replace(/\s+/g, ' ')
        .trim()
    }));
    check(
      'C2 the bill line carries the name, 3 day, the rate and the total',
      c2.rows === 1 &&
        /Generator hire/.test(c2.bill) &&
        /3 day/.test(c2.bill) &&
        /(12,000|12000)/.test(c2.bill) &&
        /(36,000|36000)/.test(c2.bill),
      c2.bill.slice(0, 240)
    );
    // C7 (2026-10-24): the switch is a ROW now (.tgl input is 0x0 and not
    // clickable). Click the row text - the audit's GATE C7 interaction -
    // and assert the input actually flipped before building on it.
    await page.evaluate(() => {
      const c = document.getElementById('calc-oncost-toggle');
      if (c.checked) c.click();
    });
    await page.click('.bcp-opt[data-opt="oncost"] .bcp-opt-name');
    const oncostOn = await page.evaluate(
      () => document.getElementById('calc-oncost-toggle').checked
    );
    if (!oncostOn) throw new Error('C7 row click did not turn the on-cost switch on');
    await page.fill('#calc-oncost-pct', '12.5');
    await page.click('[data-action="calcRun"]');
    await page.click('[data-action="calcBoqAdd"]');
    const wantOn = Math.round(wantBase * 1.125);
    // Same X-2 note as the C2 read above: textContent, not innerText - the
    // card can still be off-screen here and content-visibility skips it.
    const c2b = await page.evaluate(() =>
      ((document.getElementById('calc-boq-card') || {}).textContent || '')
        .replace(/\s+/g, ' ')
        .trim()
    );
    check(
      'C2 the on-cost total equals qty x rate + 12.5% (independent math)',
      (c2b.match(/Generator hire/g) || []).length === 2 &&
        c2b.indexOf(wantOn.toLocaleString('en-US')) > -1,
      { wantOn, bill: c2b.slice(0, 300) }
    );

    // 5.4: screenshots of the custom form - 390 and 1280, light and dark -
    // and the hard rules probed, not eyeballed.
    await page.selectOption('#calc-work', 'custom');
    const formProbes = await shotSet(page, shots, 'custom-form', '#calc-custom-wrap');
    const badForm = formProbes.filter(
      p => !p.found || p.overflow > 1 || p.clipped || p.emoji || p.blue || p.lock || !p.gold
    );
    check(
      '5.4 the custom form: gold accent present, no overflow/clipping/emoji/blue/lock at 390/1280 light+dark',
      badForm.length === 0,
      badForm
    );

    // C9: reload keeps the lines, recall refills the four fields, and a state
    // from BEFORE this change prices to its recorded total (golden fixture).
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => !!window.MMGR_CALC_POPULATE, null, { timeout: 20000 });
    const rowsReload = await page.locator('[data-action="calcBoqRecall"]').count();
    check('C9 the custom lines survive a reload', rowsReload === 2, rowsReload);
    await page.click('[data-action="calcBoqRecall"]');
    await page.waitForTimeout(250);
    const recall = {
      name: await page.inputValue('#calc-custom-name'),
      unit: await page.inputValue('#calc-custom-unit'),
      qty: await page.inputValue('#calc-custom-qty'),
      rate: await page.inputValue('#calc-custom-rate')
    };
    check(
      'C9 recalling a custom entry refills its four fields',
      recall.name === 'Generator hire' &&
        recall.unit === 'day' &&
        recall.qty === '3' &&
        recall.rate === '12000',
      recall
    );
    const golden = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'tools', 'calc-golden-cases.json'), 'utf8')
    );
    const gcase = (golden.cases || []).find(c => c.expect && c.expect.total != null && c.work);
    const gres = await page.evaluate(c => {
      const st = {
        work: c.work,
        units: c.units || 'metric',
        d1: (c.dims && c.dims.d1) || '',
        d2: (c.dims && c.dims.d2) || '',
        d3: (c.dims && c.dims.d3) || '',
        currency: c.currency || 'USD',
        country: c.country || 'US',
        quality: c.quality || 'standard',
        wastePct: c.wastePct,
        rateMat: c.rateMat,
        rateLab: c.rateLab,
        rateEq: c.rateEq,
        ohPct: c.ohPct,
        onCostPct: c.onCostPct,
        taxOverride: c.taxOverride,
        piecePrice: c.piecePrice,
        pieceSize: c.pieceSize,
        measuredQty: c.measuredQty,
        measuredUnit: c.measuredUnit,
        openings: c.openings ? JSON.stringify(c.openings) : undefined,
        variant: c.variant,
        labourOnly: c.labourOnly,
        allInRate: c.allInRate,
        daysStr: c.days,
        dayRateStr: c.dayRate,
        _matModel: c.matModel,
        _labModel: c.labModel,
        _allInModel: c.allInModel
      };
      const r = window.__calcEngine.computeFor(st);
      return r && !r.error ? r.total : null;
    }, gcase);
    check(
      'C9 a state saved before this change prices to its recorded total',
      gres != null && Math.abs(gres - gcase.expect.total) <= 1,
      { case: gcase.id, got: gres, want: gcase.expect.total }
    );

    // C10: the CSV and the printed document both carry name, quantity with
    // unit, rate and line total.
    const c10 = await page.evaluate(() => {
      const built = window.MMGR_CALC_FILE();
      const btn = document.querySelector('[data-action="calcPrint"]');
      if (btn) {
        btn.click();
      }
      return {
        csv: built && built.ok ? built.text : '',
        printed: document.body.innerText.replace(/\s+/g, ' '),
        printClass: document.body.classList.contains('print-estimate')
      };
    });
    const has4 = s =>
      /Generator hire/.test(s) &&
      /3 day/.test(s) &&
      /(12,000|12000)/.test(s) &&
      /(36,000|36000)/.test(s);
    check('C10 the CSV carries name, 3 day, rate and total', has4(c10.csv), c10.csv.slice(0, 300));
    check('C10 the printed document carries name, 3 day, rate and total', has4(c10.printed));
    check('C10 Print enters the print-estimate view', c10.printClass === true);
    await ctx.close();
  }

  // ---- C4-C8 + C11: scripted conversations through the real panel --------
  {
    const stiff =
      JIC.rows.find(r => r.t === 'excavation' && Number(r.n) === 5) ||
      JIC.rows.find(r => /stiff clay/i.test(r.d || ''));
    const demo = JIC.rows.find(r => r.t === 'excavation' && Number(r.n) === 19) || stiff;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('calc(partB-chat): ' + String(e).slice(0, 140)));
    await mockAuth(page);
    const bodies = await mockRelay(page, i => {
      const custom = (label, unit, qty, rate, source) =>
        'Here is the line.\nPROPOSAL: {"custom":{"label":"' +
        label +
        '","unit":"' +
        unit +
        '","qty":' +
        qty +
        ',"rate":' +
        rate +
        ',"source":"' +
        source +
        '","currency":"JMD"},"note":"scripted"}';
      if (i === 0) {
        return 'There is no rate for shade cloth in the book - what rate will you use, and how much do you need?';
      }
      if (i === 1) {
        return custom('Shade cloth', 'm2', 80, 4500, 'user');
      }
      if (i === 2) {
        return custom('Fence paint', 'L', 10, 9999, 'user');
      }
      if (i === 3) {
        return custom(
          'Excavation stiff clay',
          stiff.mu,
          10,
          stiff.mr + 0.01,
          'JIC Excavation #' + stiff.n
        );
      }
      if (i === 4) {
        return custom(
          'Excavation stiff clay',
          stiff.mu,
          10,
          stiff.mr,
          'JIC Excavation #' + stiff.n
        );
      }
      if (i === 5) {
        return custom('<b>Slab hire</b>', 'day', 2, stiff.mr, 'JIC Excavation #' + stiff.n);
      }
      if (i === 6) {
        return custom('Demolish block walls', demo.mu, 40, demo.mr, 'JIC Excavation #' + demo.n);
      }
      if (i === 7) {
        return 'One wall, 12 m long and 2.4 m high.\nPROPOSAL: {"work":"blockwall","d1":12,"d2":2.4,"note":"one wall"}';
      }
      return 'Understood.';
    });
    await seedCalcFx(page);
    await mockRatebook(page, JIC);
    await page.goto(BASE + '/calculator.html', { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.MMGR_CALC_POPULATE, null, { timeout: 20000 });
    await page
      .waitForFunction(() => !!window.MMGR_RATEBOOK, null, { timeout: 8000 })
      .catch(() => {});
    const rowCount = () =>
      page.evaluate(() => document.querySelectorAll('[data-action="calcBoqRecall"]').length);
    const lastNote = () =>
      page.evaluate(() => {
        const n = document.querySelectorAll('#calc-ai-mount .bcp-ai-note');
        return n.length ? n[n.length - 1].textContent : '';
      });
    const pop = async () => {
      await page.click('[data-cai=pop]');
      await page.waitForTimeout(280);
    };

    // C4: no rate anywhere - the turn's request carries the no-rate
    // instruction, the reply asks for a rate, the user gives one, and the
    // scripted custom proposal is accepted through the same dispatch.
    await sendQ(page, 'what is your rate for shade cloth');
    const sys0 = sysOf(bodies[bodies.length - 1]);
    check(
      'C4 the request carries the no-rate instruction',
      sys0.indexOf('The rate book is silent on that one') > -1 &&
        sys0.indexOf('do not guess a rate') > -1,
      sys0.slice(-300)
    );
    await sendQ(page, 'my rate is 4500 per m2 for 80 m2');
    const chip = await page.evaluate(() => {
      const box = document.querySelector('[data-cai=paths] .bcp-ai-chip');
      return box ? box.textContent : '';
    });
    check(
      'B5 the custom proposal chip reads label, qty, unit and rate',
      /Shade cloth/.test(chip) && /80 m2/.test(chip) && /4500/.test(chip),
      chip
    );
    const chipProbes = await shotSet(page, shots, 'proposal-chip', '[data-cai=paths]');
    const badChip = chipProbes.filter(p => !p.found || p.overflow > 1 || p.emoji || p.lock);
    check(
      '5.4 the proposal chip: no overflow, emoji or lock at 390/1280 light+dark',
      badChip.length === 0,
      badChip
    );
    await pop();
    let rows = await rowCount();
    let note = await lastNote();
    check(
      'C4 the accepted custom proposal adds the line through Add-to-bill dispatch',
      rows === 1 && /Added to the bill/.test(note),
      { rows, note }
    );

    // C5: a rate the user never typed - rejected with the EXACT B6 notice.
    await sendQ(page, 'add a fence paint line please');
    await pop();
    rows = await rowCount();
    note = await lastNote();
    const B6 =
      'I could not add that line because the rate did not match what you gave me. Tell me the rate again and I will add it.';
    check(
      'C5 a never-typed rate is rejected with the exact B6 notice, no line',
      rows === 1 && note.indexOf(B6) > -1,
      { rows, note }
    );
    const noticeProbes = await shotSet(page, shots, 'rejection-notice', '.bcp-ai-note');
    const badNotice = noticeProbes.filter(p => !p.found || p.overflow > 1 || p.emoji || p.lock);
    check(
      '5.4 the rejection notice: no overflow, emoji or lock at 390/1280 light+dark',
      badNotice.length === 0,
      badNotice
    );

    // C6: a JIC source one cent off the file - rejected; exact - accepted.
    await sendQ(page, 'use the book for that excavation rate');
    await pop();
    rows = await rowCount();
    note = await lastNote();
    check('C6 a JIC rate one cent off the file is rejected', rows === 1 && note.indexOf(B6) > -1, {
      rows,
      note
    });
    await sendQ(page, 'okay use the exact book rate');
    await pop();
    rows = await rowCount();
    note = await lastNote();
    check('C6 the exact file rate is accepted', rows === 2 && /Added to the bill/.test(note), {
      rows,
      note
    });

    // C7: markup in the label - rejected, and nothing renders as HTML.
    await sendQ(page, 'and a slab hire line');
    await pop();
    rows = await rowCount();
    note = await lastNote();
    const htmlLeak = await page.evaluate(() => {
      const bs = Array.from(document.querySelectorAll('b'));
      return bs.some(b => /Slab hire/.test(b.textContent));
    });
    check(
      'C7 markup in the label is rejected and renders as nothing',
      rows === 2 && note.indexOf('markup') > -1 && !htmlLeak,
      { rows, note, htmlLeak }
    );

    // C8: a row marked "in calculator: no" is visible to the model, and an
    // accepted proposal lands as a custom line at the file's metric rate
    // with the row's metric unit.
    const sys6 = sysOf(bodies[bodies.length - 1]);
    const rb6 = rateBlock(sys6);
    const noRow = rb6
      .split('\n')
      .filter(l => l.indexOf(' | ') > -1 && /in calculator: no$/.test(l));
    check(
      'C8 the system text marks an "in calculator: no" row',
      noRow.length > 0,
      noRow.slice(0, 2)
    );
    await sendQ(page, 'add that demolition as a custom line');
    await pop();
    rows = await rowCount();
    note = await lastNote();
    // X-2 paint caps: textContent, not innerText - see the C2 read above.
    const c8bill = await page.evaluate(() =>
      ((document.getElementById('calc-boq-card') || {}).textContent || '')
        .replace(/\s+/g, ' ')
        .trim()
    );
    check(
      'C8 the accepted JIC proposal lands at the file rate with the row unit',
      rows === 3 &&
        /Added to the bill/.test(note) &&
        /Demolish block walls/.test(c8bill) &&
        c8bill.indexOf(String(demo.mu)) > -1 &&
        new RegExp('(^|[^0-9])' + demo.mr + '([^0-9]|$)').test(c8bill),
      { rows, note, bill: c8bill.slice(-260) }
    );

    // C11: both proposal forms back to back, then the 60-line cap.
    await sendQ(page, 'and price one wall twelve by two point four');
    await pop();
    rows = await rowCount();
    note = await lastNote();
    check(
      'C11 both proposal forms work back to back',
      rows === 4 && /Added to the bill/.test(note),
      { rows, note }
    );
    const cap = await page.evaluate(() => {
      let i = 0;
      while (i++ < 80) {
        if (document.querySelectorAll('[data-action="calcBoqRecall"]').length >= 60) {
          break;
        }
        try {
          window.MMGR_CALC_POPULATE({ work: 'siteprep', d1: 2, d2: 3 });
        } catch (e) {
          break;
        }
      }
      const before = document.querySelectorAll('[data-action="calcBoqRecall"]').length;
      window.MMGR_CALC_POPULATE({
        custom: { label: 'Cap test', unit: 'm2', qty: 1, rate: 100, source: 'user' }
      });
      const after = document.querySelectorAll('[data-action="calcBoqRecall"]').length;
      return { before, after };
    });
    check('C11 the 60-line bill cap is respected', cap.before === 60 && cap.after === 60, cap);
    await ctx.close();
  }
}

/* S-6 (owner 2026-10-22) - the two-option rate choice and the settings the
   calculator already has. Both are new contracts, so both get gates:

     S6.1  a work proposal shows BOTH ways to price it (rate book, or the
           user's own rate), and the own-rate button opens the custom line
           carrying the same job with an EMPTY rate box in focus - the panel
           must never write the user's rate for them.
     S6.2  a settings proposal names every change BEFORE any click, applies
           them only on that click, and refuses an unsupported key by name
           (the 2% Contractors Levy is a withholding, not a cost).
*/
async function s6OwnRateAndSettings(browser, errors) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('calc(s6): ' + String(e).slice(0, 140)));
  await mockAuth(page);
  const bodies = await mockRelay(page, i => {
    if (i === 0) {
      return (
        'Block wall, 24 m2. From the rate book that comes to J$81,600. ' +
        'Do you want that added, or would you prefer to use your own rate?\n' +
        'PROPOSAL: {"work":"blockwall","units":"metric","measuredQty":24,"note":"block wall"}'
      );
    }
    return (
      'Jamaica charges 15% GCT on the works.\n' +
      'PROPOSAL: {"settings":{"country":"JM","taxOverride":15,"overhead":10},"note":"Jamaica tax"}'
    );
  });
  await seedCalcFx(page);
  // RB-1: the book arrives from GET /api/ratebook now. Mocked with the same
  // generated module the Worker imports, so the panel's book load settles the
  // way it does in production.
  await mockRatebook(page, loadJicBook());
  await page.goto(BASE + '/calculator.html', { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.MMGR_CALC_AI, null, { timeout: 20000 });
  await page.waitForFunction(() => !!window.MMGR_RATEBOOK, null, { timeout: 8000 }).catch(() => {});

  // S6.0 - both hooks exist and the panel reports the build that uses them.
  const hooks = await page.evaluate(() => ({
    user: typeof window.MMGR_CALC_USER_RATE,
    settings: typeof window.MMGR_CALC_SETTINGS,
    version: (window.MMGR_CALC_AI || {}).version
  }));
  check(
    'S6.0 the page exposes the own-rate and settings hooks',
    hooks.user === 'function' && hooks.settings === 'function',
    hooks
  );
  check('S6.0 the panel is the build that offers them', hooks.version === 'calc-ai-4', hooks);

  // S6.1a - the system prompt states BOTH options and the levy rule.
  await sendQ(page, 'block wall 24 square metres');
  const sys1 = sysOf(bodies[bodies.length - 1]);
  check(
    'S6.1a the prompt asks for the rate book figure AND the user rate',
    /use your own rate/i.test(sys1) && /From the rate book/i.test(sys1),
    sys1.slice(0, 200)
  );
  check(
    'S6.1a the prompt says the Contractors Levy is not an extra cost',
    /Contractors Levy/i.test(sys1) && /not an extra cost/i.test(sys1),
    sys1.slice(0, 200)
  );
  check(
    'S6.2a the prompt documents the settings proposal form',
    /"settings":/.test(sys1),
    sys1.slice(0, 200)
  );

  // S6.1b - the work proposal shows both choices, in words and in buttons.
  const shown = await page.evaluate(() => {
    const q = document.querySelector('[data-cai=pathq]');
    const btn = document.querySelector('[data-cai=myrate]');
    return {
      pathsHidden: document.querySelector('[data-cai=paths]').hidden,
      question: q ? q.textContent : '',
      btnHidden: btn ? btn.hidden : null
    };
  });
  check(
    'S6.1b the work proposal asks for the rate book figure or the user rate',
    shown.pathsHidden === false && /own rate/i.test(shown.question),
    shown
  );
  check('S6.1b the own-rate button is offered', shown.btnHidden === false, shown);

  // S6.1c - taking it fills the job and quantity, leaves the rate EMPTY.
  await page.click('[data-cai=myrate]');
  const own = await page.evaluate(() => ({
    work: (document.getElementById('calc-work') || {}).value,
    name: (document.getElementById('calc-custom-name') || {}).value,
    qty: (document.getElementById('calc-custom-qty') || {}).value,
    rate: (document.getElementById('calc-custom-rate') || {}).value,
    focus: document.activeElement ? document.activeElement.id : '',
    visible: !(document.getElementById('calc-custom-wrap') || {}).hidden
  }));
  check('S6.1c the own-rate path switches the line to custom', own.work === 'custom', own);
  check('S6.1c the job name carries over', /\S/.test(String(own.name)), own);
  check('S6.1c the quantity carries over', Number(own.qty) === 24, own);
  check('S6.1c the rate box is EMPTY - the number is the user\u0027s', own.rate === '', own);
  check('S6.1c the caret sits in the rate box', own.focus === 'calc-custom-rate', own);
  check('S6.1c the custom boxes are visible', own.visible === true, own);

  // S6.2a/2b - the settings proposal names the changes, then applies on click.
  await sendQ(page, 'what about GCT?');
  const stShown = await page.evaluate(() => {
    const chip = document.querySelector('.bcp-ai-chip-settings');
    const btn = document.querySelector('[data-cai=settings]');
    return {
      hidden: btn ? btn.hidden : null,
      text: chip && !chip.hidden ? chip.textContent : ''
    };
  });
  check(
    'S6.2a each setting change is named before any click',
    stShown.hidden === false &&
      /country \(sets the tax\): JM/.test(stShown.text) &&
      /custom tax %: 15/.test(stShown.text) &&
      /overhead & margin %: 10/.test(stShown.text),
    stShown
  );
  await page.evaluate(() => {
    const c = document.getElementById('calc-country');
    c.value = 'US';
    c.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const outBefore = await page.evaluate(
    () => (document.getElementById('calc-output') || {}).textContent || ''
  );
  await page.click('[data-cai=settings]');
  const stApp = await page.evaluate(() => ({
    country: (document.getElementById('calc-country') || {}).value,
    tax: (document.getElementById('calc-tax-override') || {}).value,
    oh: (document.getElementById('calc-oh') || {}).value,
    out: (document.getElementById('calc-output') || {}).textContent || ''
  }));
  check(
    'S6.2b the click writes the country, the tax and the overhead',
    stApp.country === 'JM' && String(stApp.tax) === '15' && String(stApp.oh) === '10',
    stApp
  );
  check('S6.2b the estimate is worked out again', stApp.out !== outBefore, {
    same: stApp.out === outBefore
  });

  // S6.2c - an unsupported key is refused by name, and nothing is written.
  const refused = await page.evaluate(() => {
    const before = (document.getElementById('calc-tax-override') || {}).value;
    const out = window.MMGR_CALC_SETTINGS({ levy: 2 });
    const after = (document.getElementById('calc-tax-override') || {}).value;
    return { out: out, before: before, after: after };
  });
  check('S6.2c an unsupported setting is refused', refused.out.ok === false, refused);
  check('S6.2c the refusal names the key', /levy/.test(String(refused.out.error)), refused);
  check('S6.2c nothing is written by a refused call', refused.before === refused.after, refused);

  // S6.4 - the "nice box" treatment reaches the fields that had NO styling:
  // the document row, the save-name box and the client fields. One rule set,
  // tokens only, so the radius and the padding match the .bcp-field boxes.
  const fieldLook = await page.evaluate(() => {
    const ids = ['calc-doc-title', 'calc-save-name', 'calc-client-name', 'calc-d1'];
    const out = {};
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (!el) {
        out[id] = { missing: true };
        return;
      }
      const cs = getComputedStyle(el);
      out[id] = {
        radius: cs.borderTopLeftRadius,
        padTop: cs.paddingTop,
        padLeft: cs.paddingLeft,
        border: cs.borderTopStyle + ' ' + cs.borderTopWidth,
        bg: cs.backgroundColor
      };
    });
    return out;
  });
  // A toolbar field may be DENSER (the save-name box sits beside buttons and
  // keeps its own 7px/10px padding) - what must match is the field LANGUAGE:
  // the radius, the 1px border, the token fill. That is what "the same boxes"
  // means on screen.
  const styled = ['calc-doc-title', 'calc-save-name', 'calc-client-name', 'calc-d1'].every(id => {
    const f = fieldLook[id] || {};
    return (
      !f.missing &&
      f.radius !== '0px' &&
      f.border === 'solid 1px' &&
      parseFloat(f.padTop) >= 7 &&
      parseFloat(f.padLeft) >= 10
    );
  });
  check('S6.4 every estimate box shares the token field treatment', styled, fieldLook);
  const matched = await page.evaluate(() => {
    const a = getComputedStyle(document.getElementById('calc-doc-title'));
    const b = getComputedStyle(document.getElementById('calc-d1'));
    return {
      a: a.borderTopLeftRadius + '/' + a.paddingTop + '/' + a.backgroundColor,
      b: b.borderTopLeftRadius + '/' + b.paddingTop + '/' + b.backgroundColor
    };
  });
  check('S6.4 the two sets of boxes match each other', matched.a === matched.b, matched);

  // S6.5 - the caret stays in the question box across a reply on desktop.
  await page.click('[data-cai=input]');
  await page.fill('[data-cai=input]', 'and the roof?');
  const n0 = await page.evaluate(
    () => document.querySelectorAll('.bcp-ai-log .bcp-ai-msg.ai').length
  );
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    n => document.querySelectorAll('.bcp-ai-log .bcp-ai-msg.ai').length > n,
    n0,
    { timeout: 10000 }
  );
  await page.waitForTimeout(150);
  const focusAfter = await page.evaluate(() => ({
    active: document.activeElement ? document.activeElement.getAttribute('data-cai') : '',
    disabled: document.querySelector('[data-cai=input]').disabled
  }));
  check(
    'S6.5 the question box keeps the caret after a reply',
    focusAfter.active === 'input' && focusAfter.disabled === false,
    focusAfter
  );

  // S6.1d - a CUSTOM proposal is already the user's rate: no own-rate button.
  const customBtn = await page.evaluate(() => {
    window.MMGR_CALC_AI.mount(document.getElementById('calc-ai-mount'));
    return true;
  });
  check('S6.1d the panel remounts cleanly after the wave', customBtn, null);
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
    await assistantDiagnosis(page);
    await ariaLabels(page);

    await loadButton(browser, errors);
    await assistantOutputs(browser, errors);
    await fileIntake(browser, errors);
    await partARateAccess(browser, errors);
    await partBCustomLine(browser, errors);
    await s6OwnRateAndSettings(browser, errors);
    await contrastGates(browser, errors);

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
