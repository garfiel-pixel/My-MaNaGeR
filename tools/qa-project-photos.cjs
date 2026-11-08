#!/usr/bin/env node
/* ============================================================
   tools/qa-project-photos.cjs - 5.7 B11 PROJECT PHOTOS, BROWSER HALF
   ------------------------------------------------------------
   The acceptance row for 5.7 is a person's walk, not an API shape:
   two photos uploaded with descriptions, the uploader's name and role
   on each card, one downloaded, one deleted, the storage bar moving,
   and a read-only credential that can see but not touch.

   `tools/qa-cloud-photos.cjs` already proves the server round trip.
   This suite proves the panel a person actually uses, in real Chrome,
   against a real local Worker (own wrangler dev, own D1 + R2, every
   migration applied):

     G1  the panel paints: storage bar and Add photo on a fresh project
     G2  the bar reads 0 B of 500.0 MB used and aria-valuenow is 0
     G3  upload 1 through the real file picker (before, with a caption)
     G4  upload 2 (after) -> two cards
     G5  every card names its uploader and role and its stage chip
     G6  the quota text moved, and the usage endpoint agrees with the
         exact byte count of both files
     G7  Download hands back the uploaded bytes under the uploaded name
     G8  Remove asks first, then drops the card and the used bytes
     G9  a view code sees the photo but gets no Add and no Remove
     G11 three photos and one description become one editable, removable bundle
     G12 an offline selection queues in IndexedDB and sends on reconnect
     G10 no page error and no console error for the whole run

   The free-account refusal (402 + the upgrade sentence) cannot be
   reached here: billing is dormant without Paddle secrets, exactly the
   branch `tools/qa-cloud-photos.cjs` documents. It is reported as a
   documented SKIP; the sentence itself is pinned by
   `test/photo-tier.test.mjs`.

   Two credentials, two rate-limit buckets: the harness drives the API
   with the owner code and the page with the editor code, because
   `cloudRateKey` prefers the code header over the address. The page
   also keeps its request count low (each list, thumbnail, download
   and delete is one call against a 30/min general bucket).

   Usage:  node tools/qa-project-photos.cjs
   Env:    QA_PORT (default 8815), QA_KEEP=1 keeps the persist dir.
   Registry: docs/CI-TEST-COVERAGE.md -> CI row (cloud-auth).
   Exit:   0 only when every gate passes.
   ============================================================ */
'use strict';
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = parseInt(process.env.QA_PORT || '8815', 10);
const BASE = 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');
// Wrangler state lives OUTSIDE the repo: AGENTS lesson 11, the asset
// watcher reload-loops on any file it sees inside the tree.
const TMP = os.tmpdir();
const PERSIST_DIR = path.join(TMP, 'mmgr-photos-wstate-' + Date.now());

const TAG = '[photos-ui]';
const ADMIN_CODE = 'QA-ADMIN-CI';
// RFC 5737 TEST-NET-3: documented, never routed, only ever a rate-limit key.
const QA_IP = '203.0.113.13';

const log = s => process.stdout.write(TAG + ' ' + s + '\n');
const delay = ms => new Promise(r => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const results = [];
function check(name, cond, detail) {
  results.push({ name, val: !!cond });
  if (cond) {
    pass++;
    log('PASS  ' + name);
  } else {
    fail++;
    log(
      'FAIL  ' +
        name +
        (detail === undefined ? '' : '   <-- ' + JSON.stringify(detail).slice(0, 700))
    );
  }
}
function skip(name, why) {
  log('SKIP  ' + name + (why ? '   (' + why + ')' : ''));
}

// A real 1x1 PNG, so the byte counts and the served type mean something.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
);

// Node-side calls get their own client address so the fixture budget never
// spends the browser's. Playwright uses its own network stack, untouched.
const _realFetch = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const o = Object.assign({}, init || {});
  const h = new Headers(o.headers || undefined);
  if (!h.has('CF-Connecting-IP')) {
    h.set('CF-Connecting-IP', QA_IP);
  }
  o.headers = h;
  return _realFetch.call(globalThis, input, o);
};

// ---- wrangler scaffolding -------------------------------------------------
function localWranglerJs() {
  const p = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  return fs.existsSync(p) ? p : null;
}
function globalWranglerJs() {
  try {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const root = execFileSync(npmCmd, ['root', '-g'], {
      encoding: 'utf8',
      shell: process.platform === 'win32'
    }).trim();
    const p = path.join(root, 'wrangler', 'bin', 'wrangler.js');
    return fs.existsSync(p) ? p : null;
  } catch (e) {
    return null;
  }
}
const WRANGLER_JS = localWranglerJs() || globalWranglerJs();
const { stopWranglerIfLocal } = require('./wrangler-ci-helpers.cjs');

let proc = null;
let devLog = '';

async function startWrangler() {
  if (!WRANGLER_JS) {
    throw new Error('wrangler not found (local or global)');
  }
  log('starting wrangler dev on :' + PORT + ' (local D1 + R2)');
  try {
    execFileSync(
      process.execPath,
      [
        WRANGLER_JS,
        'd1',
        'migrations',
        'apply',
        'my-manager-db',
        '--local',
        '--config',
        'wrangler.ci.jsonc',
        '--persist-to',
        PERSIST_DIR
      ],
      { cwd: ROOT, stdio: 'ignore', timeout: 180000 }
    );
  } catch (e) {
    log('migrations apply (best-effort): ' + e.message);
  }
  proc = spawn(
    process.execPath,
    [
      WRANGLER_JS,
      'dev',
      '--config',
      'wrangler.ci.jsonc',
      '--port',
      String(PORT),
      '--ip',
      '127.0.0.1',
      '--persist-to',
      PERSIST_DIR,
      '--var',
      'ADMIN_CODE:' + ADMIN_CODE
    ],
    {
      cwd: ROOT,
      env: Object.assign({}, process.env, { WRANGLER_SEND_METRICS: 'false' }),
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );
  proc.stdout.on('data', d => {
    devLog += d;
  });
  proc.stderr.on('data', d => {
    devLog += d;
  });
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(BASE + '/api/health');
      if (res.ok || res.status === 404) {
        log('worker up');
        return;
      }
    } catch (e) {
      /* not up yet */
    }
    await delay(1000);
  }
  throw new Error('wrangler dev did not come up in 120s\n' + devLog.slice(-2000));
}

function stopWrangler() {
  stopWranglerIfLocal(proc);
  try {
    proc && proc.kill();
  } catch (e) {
    /* ignore */
  }
}

let chrome = null;
setTimeout(() => {
  log('WATCHDOG - harness exceeded 600s');
  try {
    chrome && chrome.close && chrome.close();
  } catch (e) {
    /* ignore */
  }
  stopWrangler();
  process.exit(2);
}, 600000).unref();

// ---- API helper -----------------------------------------------------------
async function api(pathname, opts) {
  const res = await fetch(BASE + pathname, opts);
  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    body = null;
  }
  return { status: res.status, body, headers: res.headers };
}
function jsonHeaders(extra) {
  return Object.assign({ 'Content-Type': 'application/json' }, extra || {});
}

// The device state a project page needs, seeded before any app script runs.
// No owner code is ever written here: `activeCredential()` prefers the owner
// slot, and an owner code would collapse the two rate-limit buckets into one.
function seedDevice(seed) {
  const pid = seed.pid;
  const code = seed.code;
  const escope = seed.escope;
  try {
    localStorage.setItem(
      'mmgr_admin_projects',
      JSON.stringify([{ id: pid, file: 'project.html?id=' + pid }])
    );
    localStorage.setItem('mmgr_unlocked_' + pid, '1');
    localStorage.setItem('mmgr_current_project', pid);
    localStorage.setItem('mmgr_cloud_id_' + pid, pid);
    // The one-shot tour overlay would sit on top of the panel.
    localStorage.setItem('mmgr_first_project_tour_v1', '1');
    sessionStorage.setItem('mmgr_cloud_ecode_' + pid, code);
    sessionStorage.setItem('mmgr_cloud_escope_' + pid, JSON.stringify(escope));
  } catch (e) {
    /* storage disabled: the page will say so, the gate will fail honestly */
  }
}

// Polls until the page reports the expected shape. Returns the last value
// either way, so a failure prints what it actually saw.
async function until(page, fn, arg, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 20000);
  let last = null;
  for (;;) {
    try {
      last = await page.evaluate(fn, arg);
    } catch (e) {
      last = { threw: String((e && e.message) || e) };
    }
    if (last) {
      return last;
    }
    if (Date.now() > deadline) {
      return last;
    }
    await delay(300);
  }
}

async function openPhotos(page, pid) {
  await page.goto(BASE + '/project.html?id=' + pid, { waitUntil: 'domcontentloaded' });
  // Project Photos lives in the Field pack, and a brand-new project starts
  // Core-only by design (Rank 3.1 progressive disclosure). Turn the pack on
  // through the SAME state write the control panel's toggle performs, then
  // let renderPacks unhide the nav. The gate is about the photos panel, not
  // about re-proving the pack mechanism.
  const packOn = await page.evaluate(() => {
    try {
      if (!window.MMGR || !MMGR.State || !MMGR.Render) {
        return false;
      }
      MMGR.State.updateState(function (s) {
        if (!s.packs) {
          s.packs = {};
        }
        s.packs.field = true;
        s.packsEverEnabled = true;
      });
      MMGR.Render.renderPacks();
      return true;
    } catch (e) {
      return false;
    }
  });
  if (!packOn) {
    log('could not enable the Field pack before opening Photos');
  }
  // The nav exists twice (desktop rail and the compact drawer), and only one
  // of the two is on screen at a given width. Wait for a VISIBLE one rather
  // than the first match, which is the hidden copy at 1280px.
  const sel = '.sec-btn[data-section="photos"]';
  const nav = await until(
    page,
    s => {
      const all = Array.prototype.slice.call(document.querySelectorAll(s));
      for (let i = 0; i < all.length; i++) {
        const b = all[i];
        const r = b.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          return {
            found: true,
            blocked: b.classList.contains('scope-blocked'),
            disabled: !!b.disabled
          };
        }
      }
      return false;
    },
    sel,
    25000
  );
  if (!nav || !nav.found) {
    const diag = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      body: document.body ? document.body.className : '(no body)',
      btns: Array.prototype.slice.call(document.querySelectorAll('.sec-btn')).map(function (b) {
        return {
          s: b.getAttribute('data-section'),
          cls: b.className,
          w: Math.round(b.getBoundingClientRect().width)
        };
      }),
      panels: Array.prototype.slice.call(document.querySelectorAll('.panel')).map(function (p) {
        return p.id + ':' + p.className;
      })
    }));
    log('nav diagnose: ' + JSON.stringify(diag).slice(0, 2000));
    return nav;
  }
  await page
    .locator(sel + ':visible')
    .first()
    .click();
  return nav;
}

// ============================================================
async function main() {
  await startWrangler();

  const pid = 'qa-photos-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  // ---- fixture: a code-created cloud project + an editor + a viewer ----
  const made = await api('/api/cloud/projects', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ projectId: pid, name: 'QA Photos Project' })
  });
  const ownerCode = made.body && made.body.ownerCode;
  check(
    'G0a a code-created cloud project answers with an owner code',
    made.status === 200 && !!ownerCode,
    {
      status: made.status,
      body: made.body
    }
  );
  if (!ownerCode) {
    log('cannot continue without an owner code');
    return;
  }
  const owner = { 'X-Owner-Code': ownerCode };

  const ed = await api('/api/cloud/projects/' + pid + '/editors', {
    method: 'POST',
    headers: jsonHeaders(owner),
    body: JSON.stringify({ label: 'QA Editor', role: 'editor', scope: ['photos'] })
  });
  const editorCode = ed.body && ed.body.editorCode;
  // A second editor code for the bundle walk: the rate limiter buckets by
  // code, and the first editor has already spent its 30/min on the single
  // upload walk. Same project, same role, a fresh bucket.
  const ed2 = await api('/api/cloud/projects/' + pid + '/editors', {
    method: 'POST',
    headers: jsonHeaders(owner),
    body: JSON.stringify({ label: 'QA Bundle Editor', role: 'editor', scope: ['photos'] })
  });
  const bundleCode = ed2.body && ed2.body.editorCode;
  const vw = await api('/api/cloud/projects/' + pid + '/editors', {
    method: 'POST',
    headers: jsonHeaders(owner),
    body: JSON.stringify({ label: 'QA Viewer', role: 'view', scope: ['photos'] })
  });
  const viewCode = vw.body && vw.body.editorCode;
  check(
    'G0b two editor codes and a view code exist for the project',
    ed.status === 200 &&
      !!editorCode &&
      ed2.status === 200 &&
      !!bundleCode &&
      vw.status === 200 &&
      !!viewCode,
    { editor: ed.status, bundle: ed2.status, view: vw.status, body: ed.body }
  );
  if (!editorCode || !bundleCode || !viewCode) {
    log('cannot drive the panel without every credential');
    return;
  }

  const { chromium } = require('playwright');
  const launchOpts = { headless: true, args: ['--disk-cache-size=0', '--no-sandbox'] };
  const chromePath = require('./chrome-launcher.cjs').chromePath;
  if (chromePath) {
    launchOpts.executablePath = chromePath;
  } else {
    // CI's cloud-auth job carries system Chrome, never `playwright install`.
    launchOpts.channel = 'chrome';
  }
  const browser = await chromium.launch(launchOpts);
  chrome = browser;

  const pageErrors = [];
  const consoleErrors = [];

  try {
    // ================= editor context: the full walk =================
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      acceptDownloads: true
    });
    await ctx.setExtraHTTPHeaders({ 'CF-Connecting-IP': '203.0.113.21' });
    await ctx.addInitScript(seedDevice, {
      pid: pid,
      code: editorCode,
      escope: { role: 'editor', label: 'QA Editor', sections: ['photos'] }
    });
    let page = await ctx.newPage();
    page.on('pageerror', e => pageErrors.push(String((e && e.message) || e)));
    page.on('console', m => {
      if (m.type() === 'error') {
        consoleErrors.push(m.text());
      }
    });

    const nav = await openPhotos(page, pid);
    check(
      'G0c the Photos nav entry opens without being blocked by the editor scope',
      !!nav && nav.found === true && nav.blocked === false,
      nav
    );

    // ---- G1: the panel paints -------------------------------------
    const g1 = await until(
      page,
      () => {
        const bar = document.getElementById('photos-quota-bar');
        const add = document.getElementById('photos-add-btn');
        const body = document.getElementById('photos-body');
        if (!bar || !add || !body) return false;
        const text = (document.getElementById('photos-quota-text') || {}).textContent || '';
        if (!/of 500\.0 MB used/.test(text)) return false;
        return {
          bar: true,
          addVisible: !add.classList.contains('is-hide'),
          panelActive: (document.getElementById('panel-photos') || {}).className || '',
          text: text
        };
      },
      null,
      25000
    );
    check(
      'G1 the Photos panel paints its storage bar and Add photo on a fresh project',
      !!g1 && g1.bar === true && g1.addVisible === true && /active/.test(g1.panelActive),
      g1
    );

    // ---- G2: the bar reads zero, and an empty project is not an error ----
    const g2 = await page.evaluate(() => {
      const note = document.getElementById('photos-note');
      return {
        text: (document.getElementById('photos-quota-text') || {}).textContent || '',
        now: (document.getElementById('photos-quota-bar') || {}).getAttribute
          ? document.getElementById('photos-quota-bar').getAttribute('aria-valuenow')
          : null,
        items: document.querySelectorAll('.photo-item').length,
        empty: ((document.getElementById('photos-list') || {}).textContent || '').slice(0, 160),
        note: note ? String(note.textContent || '') : '',
        noteHidden: note ? note.classList.contains('is-hide') : false
      };
    });
    check(
      'G2 a fresh project reads 0 B of 500.0 MB used, says No photos yet, and raises no error',
      /^0 B of 500\.0 MB used$/.test(g2.text.trim()) &&
        g2.now === '0' &&
        g2.items === 0 &&
        /No photos yet/.test(g2.empty) &&
        g2.noteHidden === true &&
        !/HTTP \d/.test(g2.empty + g2.note),
      g2
    );

    // ---- G2b: a real failure speaks in words and offers a retry --------
    // The owner's report was a bare "Could not load photos (HTTP 500)" over an
    // empty project. The cause was a schema behind the code (migrations 0028
    // to 0031), fixed at the database; this arm pins the client half so a
    // future failure can never surface as a status code with no next step.
    await page.route('**/api/cloud/projects/*/photos', route =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"ok":false}' })
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openPhotos(page, pid);
    const g2b = await until(
      page,
      () => {
        const note = document.getElementById('photos-note');
        if (!note || note.classList.contains('is-hide')) return false;
        const retry = note.querySelector('[data-photo-retry]');
        const text = String(note.textContent || '');
        if (!retry) return false;
        return { text: text.trim(), hasRetry: !!retry, hidden: note.classList.contains('is-hide') };
      },
      null,
      25000
    );
    check(
      'G2b a failed load names the problem in words, never a bare status code, and offers Try again',
      !!g2b &&
        /server could not answer/i.test(g2b.text) &&
        g2b.hasRetry === true &&
        !/HTTP \d/.test(g2b.text) &&
        !/\(HTTP/.test(g2b.text),
      g2b
    );
    await page.unroute('**/api/cloud/projects/*/photos');
    const g2c = await (async () => {
      await page.click('[data-photo-retry]');
      return until(
        page,
        () => {
          const note = document.getElementById('photos-note');
          const list = document.getElementById('photos-list');
          if (!note || !list) return false;
          const empty = /No photos yet/.test(String(list.textContent || ''));
          return empty && note.classList.contains('is-hide')
            ? { empty: true, noteHidden: true }
            : false;
        },
        null,
        25000
      );
    })();
    check(
      'G2c Try again recovers the panel to the empty state once the server answers',
      !!g2c && g2c.empty === true && g2c.noteHidden === true,
      g2c
    );

    // ---- G3: upload 1 through the real picker ----------------------
    async function upload(name, caption, stage) {
      const addVisible = await page.evaluate(() => {
        const b = document.getElementById('photos-add-btn');
        return !!b && !b.classList.contains('is-hide');
      });
      if (!addVisible) {
        await page.click('#photos-cancel-btn').catch(() => {});
      }
      await page.click('#photos-add-btn');
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 15000 }),
        page.click('#photos-pick-btn')
      ]);
      await chooser.setFiles({ name: name, mimeType: 'image/png', buffer: PNG });
      await page.fill('#photos-caption-input', caption);
      await page.fill('#photos-date-input', '2026-11-05');
      await page.selectOption('#photos-stage-input', stage);
      await page.click('#photos-submit-btn');
    }

    await upload('site-before.png', 'Foundation before the pour', 'before');
    const g3 = await until(
      page,
      () => {
        const items = document.querySelectorAll('.photo-item');
        if (items.length !== 1) return false;
        const note = (document.getElementById('photos-note') || {}).textContent || '';
        return { items: 1, note: note, text: items[0].textContent };
      },
      null,
      30000
    );
    check(
      'G3 the first upload lands as one card with its description',
      !!g3 && g3.items === 1 && /Foundation before the pour/.test(g3.text),
      g3
    );

    // ---- G4: upload 2 ----------------------------------------------
    await upload('site-after.png', 'Slab poured and cured', 'after');
    const g4 = await until(
      page,
      () => {
        const items = document.querySelectorAll('.photo-item');
        if (items.length !== 2) return false;
        return { items: 2 };
      },
      null,
      30000
    );
    check('G4 the second upload lands, so the list holds two cards', !!g4 && g4.items === 2, g4);

    // ---- G5: uploader identity + stage on every card ---------------
    const g5 = await page.evaluate(() => {
      const items = Array.prototype.slice.call(document.querySelectorAll('.photo-item'));
      return {
        count: items.length,
        cards: items.map(function (el) {
          return {
            text: el.textContent,
            stage: (el.querySelector('.photo-stage') || {}).textContent || '',
            thumb: !!el.querySelector('.photo-thumb img'),
            download: !!el.querySelector('[data-photo-download]'),
            remove: !!el.querySelector('[data-photo-remove]')
          };
        })
      };
    });
    const everyCardIdentified =
      g5.count === 2 &&
      g5.cards.every(function (c) {
        return c.text.indexOf('Uploaded by QA Editor (Editor)') > -1;
      });
    const stages = g5.cards.map(function (c) {
      return c.stage.trim();
    });
    check(
      'G5 every card names its uploader and role, and carries its stage chip',
      everyCardIdentified && stages.indexOf('Before') > -1 && stages.indexOf('After') > -1,
      g5
    );

    // ---- G6: the bar moved and the server agrees -------------------
    const g6text = await page.textContent('#photos-quota-text');
    const expectedUsed = PNG.length * 2;
    const g6usage = await api('/api/cloud/projects/' + pid + '/photos/usage', { headers: owner });
    check(
      'G6 the quota text moved and the usage endpoint counts both files exactly',
      g6text.trim() === expectedUsed + ' B of 500.0 MB used' &&
        g6usage.status === 200 &&
        g6usage.body &&
        g6usage.body.usage &&
        g6usage.body.usage.usedBytes === expectedUsed &&
        g6usage.body.usage.limitBytes === 524288000 &&
        g6usage.body.usage.photos === 2,
      { text: g6text, usage: g6usage.body && g6usage.body.usage }
    );

    // ---- G7: download the first card -------------------------------
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      page.click('.photo-item [data-photo-download]')
    ]);
    const dlPath = await download.path();
    const dlSize = dlPath ? fs.statSync(dlPath).size : -1;
    check(
      'G7 Download returns the uploaded bytes under the uploaded name',
      download.suggestedFilename() === 'site-after.png' && dlSize === PNG.length,
      { name: download.suggestedFilename(), size: dlSize, want: PNG.length }
    );

    // ---- G8: remove asks, then drops the card ----------------------
    await page.click('.photo-item:nth-child(2) [data-photo-remove]');
    const confirm = await until(
      page,
      () => {
        const c = document.querySelector('.photo-confirm');
        const yes = document.querySelector('[data-photo-remove-confirm]');
        if (!c || !yes) return false;
        return { copy: c.textContent.trim(), hasYes: true };
      },
      null,
      10000
    );
    await page.click('.photo-item:nth-child(2) [data-photo-remove-confirm]');
    const g8 = await until(
      page,
      () => {
        const items = document.querySelectorAll('.photo-item');
        if (items.length !== 1) return false;
        return { items: 1, text: items[0].textContent };
      },
      null,
      30000
    );
    const g8usage = await api('/api/cloud/projects/' + pid + '/photos/usage', { headers: owner });
    check(
      'G8 Remove asks first, then drops the card and its used bytes',
      !!confirm &&
        /Remove this photo\?/.test(confirm.copy) &&
        !!g8 &&
        g8.items === 1 &&
        g8usage.status === 200 &&
        g8usage.body.usage.usedBytes === PNG.length,
      { confirm: confirm, page: g8, usage: g8usage.body && g8usage.body.usage }
    );

    // ---- G11: one bundle, one description --------------------------
    // Fresh editor code and context: the first editor has spent its 30/min
    // bucket on G3-G8, and the bundle walk needs its own.
    const editorErrs = pageErrors.slice();
    const editorConsole = consoleErrors.slice();
    await ctx.close();
    const bctx = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      acceptDownloads: true
    });
    await bctx.setExtraHTTPHeaders({ 'CF-Connecting-IP': '203.0.113.23' });
    await bctx.addInitScript(seedDevice, {
      pid: pid,
      code: bundleCode,
      escope: { role: 'editor', label: 'QA Bundle Editor', sections: ['photos'] }
    });
    page = await bctx.newPage();
    page.on('pageerror', e => pageErrors.push(String((e && e.message) || e)));
    page.on('console', m => {
      if (m.type() === 'error') {
        consoleErrors.push(m.text());
      }
    });
    await openPhotos(page, pid);

    async function uploadBundle(names, caption, stage) {
      const addVisible = await page.evaluate(() => {
        const b = document.getElementById('photos-add-btn');
        return !!b && !b.classList.contains('is-hide');
      });
      if (!addVisible) {
        await page.click('#photos-cancel-btn').catch(() => {});
      }
      await page.click('#photos-add-btn');
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 15000 }),
        page.click('#photos-pick-btn')
      ]);
      await chooser.setFiles(
        names.map(function (n) {
          return { name: n, mimeType: 'image/png', buffer: PNG };
        })
      );
      await page.fill('#photos-caption-input', caption);
      await page.fill('#photos-date-input', '2026-11-05');
      await page.selectOption('#photos-stage-input', stage);
      await page.click('#photos-submit-btn');
    }

    await uploadBundle(
      ['bundle-a.png', 'bundle-b.png', 'bundle-c.png'],
      'Steel frame, three angles',
      'progress'
    );
    await delay(2500);
    const g11debug = await page.evaluate(() => ({
      items: document.querySelectorAll('.photo-item').length,
      bundles: document.querySelectorAll('.photo-bundle').length,
      note: (document.getElementById('photos-note') || {}).textContent || '',
      photos:
        window.MMGR && window.MMGR.CloudPhotos && window.MMGR.CloudPhotos.cloudPhotosGetPhotos
          ? window.MMGR.CloudPhotos.cloudPhotosGetPhotos().length
          : -1
    }));
    log('G11 debug ' + JSON.stringify(g11debug));
    const g11 = await until(
      page,
      () => {
        const items = document.querySelectorAll('.photo-item');
        const bundles = document.querySelectorAll('.photo-bundle');
        if (items.length !== 2 || bundles.length !== 1) return false;
        const b = bundles[0];
        return {
          items: items.length,
          bundles: bundles.length,
          count: (b.querySelector('.photo-bundle-count') || {}).textContent || '',
          text: b.textContent
        };
      },
      null,
      30000
    );
    check(
      'G11 three photos and one description become one bundle card',
      !!g11 && g11.count === '3' && /Steel frame, three angles/.test(g11.text),
      g11
    );

    await page.click('.photo-bundle [data-bundle-open]');
    const g11b = await until(
      page,
      () => {
        const d = document.getElementById('photos-bundle-dialog');
        if (!d || !d.open) return false;
        return {
          open: true,
          caption: (document.getElementById('photos-bundle-caption') || {}).textContent || '',
          photos: document.querySelectorAll('#photos-bundle-body .photo-dialog-item').length
        };
      },
      null,
      10000
    );
    check(
      'G11b opening the bundle shows all three photos and the description',
      !!g11b && g11b.photos === 3 && /Steel frame, three angles/.test(g11b.caption),
      g11b
    );

    await page.fill('#photos-bundle-caption-input', 'Steel frame, revised description');
    await page.click('[data-bundle-save]');
    const g11c = await until(
      page,
      () => {
        const c = (document.getElementById('photos-bundle-caption') || {}).textContent || '';
        return /revised description/.test(c) ? { caption: c } : false;
      },
      null,
      15000
    );
    check('G11c the bundle description can be edited', !!g11c, g11c);
    await page.click('[data-bundle-close]');

    await page.click('.photo-bundle [data-bundle-open]');
    await page.click('[data-bundle-delete]');
    await page.click('[data-bundle-delete-confirm]');
    const g11d = await until(
      page,
      () => {
        const items = document.querySelectorAll('.photo-item');
        return items.length === 1 ? { items: 1 } : false;
      },
      null,
      30000
    );
    check('G11d removing a bundle removes every photo in it', !!g11d, g11d);

    // ---- G12: an offline selection queues and sends on reconnect ----
    await page.context().setOffline(true);
    await page
      .waitForFunction(() => navigator.onLine === false, null, { timeout: 10000 })
      .catch(() => {});
    await uploadBundle(['offline-a.png', 'offline-b.png'], 'Poured after the rain', 'after');
    const g12 = await until(
      page,
      () => {
        const note = (document.getElementById('photos-note') || {}).textContent || '';
        return /saved on this device/i.test(note) ? { note: note } : false;
      },
      null,
      15000
    );
    const queued = await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open('mmgr-photo-queue', 1);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('queue', 'readonly');
        const rq = tx.objectStore('queue').count();
        rq.onsuccess = () => resolve(rq.result);
        rq.onerror = () => reject(rq.error);
      });
    });
    check('G12 an offline selection is queued on the device', !!g12 && queued === 2, {
      note: g12,
      queued: queued
    });

    await page.context().setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    const g12b = await until(
      page,
      () => {
        const bundles = document.querySelectorAll('.photo-bundle');
        if (bundles.length !== 1) return false;
        const b = bundles[0];
        return {
          count: (b.querySelector('.photo-bundle-count') || {}).textContent || '',
          text: b.textContent
        };
      },
      null,
      45000
    );
    check(
      'G12b the queued bundle uploads when the connection returns',
      !!g12b && g12b.count === '2' && /Poured after the rain/.test(g12b.text),
      g12b
    );

    await page.click('.photo-bundle [data-bundle-open]');
    await page.click('[data-bundle-delete]');
    await page.click('[data-bundle-delete-confirm]');
    const g12c = await until(
      page,
      () => document.querySelectorAll('.photo-item').length === 1,
      null,
      30000
    );
    check('G12c the offline bundle can be removed after it lands', !!g12c, g12c);

    await bctx.close();

    // ================= viewer context: read only ====================
    const vctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await vctx.setExtraHTTPHeaders({ 'CF-Connecting-IP': '203.0.113.22' });
    await vctx.addInitScript(seedDevice, {
      pid: pid,
      code: viewCode,
      escope: { role: 'view', label: 'QA Viewer', sections: ['photos'] }
    });
    const vpage = await vctx.newPage();
    const viewPageErrors = [];
    vpage.on('pageerror', e => viewPageErrors.push(String((e && e.message) || e)));
    vpage.on('console', m => {
      if (m.type() === 'error') {
        consoleErrors.push(m.text());
      }
    });
    const vnav = await openPhotos(vpage, pid);
    const g9 = await until(
      vpage,
      () => {
        const items = document.querySelectorAll('.photo-item');
        if (items.length !== 1) return false;
        const add = document.getElementById('photos-add-btn');
        return {
          items: 1,
          addHidden: !!add && add.classList.contains('is-hide'),
          download: !!items[0].querySelector('[data-photo-download]'),
          remove: !!items[0].querySelector('[data-photo-remove]'),
          note: (document.getElementById('photos-note') || {}).textContent || ''
        };
      },
      null,
      30000
    );
    check(
      'G9 a view code sees the photo and can download it, but gets no Add and no Remove',
      !!vnav &&
        vnav.found === true &&
        !!g9 &&
        g9.items === 1 &&
        g9.download === true &&
        g9.addHidden === true &&
        g9.remove === false,
      { nav: vnav, page: g9 }
    );
    const viewErrs = viewPageErrors.slice();
    await vctx.close();

    // ---- G10: a clean run ------------------------------------------
    // "Failed to load resource" is the browser's own 404 line (favicon and
    // the app's optional probes), not a page error.
    const allConsole = consoleErrors.filter(function (t) {
      return !/Failed to load resource/i.test(String(t));
    });
    check(
      'G10 no page error and no console error for the whole run',
      pageErrors.length === 0 && viewPageErrors.length === 0 && allConsole.length === 0,
      {
        editorPageErrors: editorErrs.slice(0, 4),
        viewPageErrors: viewErrs.slice(0, 4),
        console: allConsole.slice(0, 6),
        consoleBeforeViewer: editorConsole.slice(0, 4)
      }
    );

    // ---- the one arm this deployment cannot reach -------------------
    skip(
      'free account refused with the upgrade sentence (402)',
      'billing is dormant without Paddle secrets, so photoUploadPaid() allows the upload; the sentence is pinned by test/photo-tier.test.mjs'
    );
  } finally {
    try {
      await browser.close();
    } catch (e) {
      /* ignore */
    }
  }
}

// ============================================================
main()
  .then(() => {
    stopWrangler();
    log('');
    log(fail === 0 ? 'ALL GATES PASSED (' + pass + ')' : fail + ' FAILED (' + pass + ' passed)');
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch(e => {
    log('FATAL: ' + ((e && e.stack) || e));
    stopWrangler();
    process.exit(1);
  });
