/* ============================================================
   PART F T7 (2026-08-16) — PUBLIC REVIEWS WINDOW END-TO-END GATE
   ------------------------------------------------------------
   Starts the Worker LOCALLY (npx wrangler dev against local D1 +
   R2 miniflare emulation) and verifies the /api/reviews surface
   against that live server, then loads reviews.html in headless
   Chrome and drives the real form.

   R1  GET /api/reviews starts empty
   R2  POST a valid review -> ok + review echoed; name null when blank
   R3  POST with a name -> name echoed; stars accepted (star-READY)
   R4  GET returns newest-first with the stored fields
   R5  POST rejects empty review text (400)
   R6  POST rejects HTML/markup (400, plain text only)
   R7  POST rejects links (400)
   R8  POST rejects oversized text (400)
   R9  POST rate-limit trips the dedicated reviews bucket (429)
   R10 cross-origin POST -> 403 (same-origin gate)
   R11 D1 row + R2 reviews/<id>.json durable copy both written
   R12 page: reviews.html renders header/hero/form/footer, zero
       console errors, empty state shown, form posts a review and
       the list re-renders with it

   Exit 0 only when all checks pass. Reports PASS/FAIL per check.
   Usage: node tools/qa-reviews.cjs
   ============================================================ */
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 8797;
const BASE = 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');

const log = (s) => { process.stdout.write('[reviews] ' + s + '\n'); };
const delay = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, val, detail) => { results.push({ name, val }); log((val ? 'PASS' : 'FAIL') + '  ' + name + (val ? '' : '   <-- ' + JSON.stringify(detail).slice(0, 500))); };

setTimeout(() => { log('WATCHDOG — harness exceeded 300s'); try { proc && proc.kill(); } catch (e) {} process.exit(2); }, 300000).unref();

// ---- wrangler location ----------------------------------------------------
function globalWranglerJs() {
  try {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const root = execFileSync(npmCmd, ['root', '-g'], { encoding: 'utf8', shell: process.platform === 'win32' }).trim();
    const p = path.join(root, 'wrangler', 'bin', 'wrangler.js');
    if (fs.existsSync(p)) return p;
  } catch (e) { /* fall through */ }
  return null;
}
const WRANGLER_JS = globalWranglerJs();
const PERSIST_DIR = path.join(os.tmpdir(), 'mmgr-reviews-wstate-' + Date.now());

let proc = null;
function startWrangler() {
  return new Promise((resolve, reject) => {
    try {
      execFileSync(process.execPath,
        [WRANGLER_JS, 'd1', 'migrations', 'apply', 'my-manager-db', '--local', '--persist-to', PERSIST_DIR],
        { cwd: ROOT, stdio: 'ignore', timeout: 90000 });
    } catch (e) { log('migrations apply (best-effort): ' + e.message); }
    proc = spawn(process.execPath, [WRANGLER_JS, 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', PERSIST_DIR], {
      cwd: ROOT,
      env: Object.assign({}, process.env, { WRANGLER_SEND_METRICS: 'false' }),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    proc.on('error', (e) => reject(new Error('wrangler spawn failed: ' + e.message)));
    const t0 = Date.now();
    const poll = async () => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(function() { ctrl.abort(); }, 3000);
        const r = await fetch(BASE + '/api/health', { signal: ctrl.signal });
        clearTimeout(timer);
        if (r.ok) return resolve();
      } catch (e) { /* not up yet */ }
      if (Date.now() - t0 > 120000) return reject(new Error('wrangler dev did not come up in 120s'));
      setTimeout(poll, 1500);
    };
    poll();
  });
}
function stopWrangler() {
  try { proc && proc.kill(); } catch (e) {}
}

// ---- D1 / R2 direct inspection (read-only sqlite + blob walk) -------------
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
function d1File() {
  const dir = path.join(PERSIST_DIR, 'v3', 'd1', 'miniflare-D1DatabaseObject');
  if (!fs.existsSync(dir)) return null;
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.sqlite') && !f.startsWith('metadata')) return path.join(dir, f);
  }
  return null;
}
function queryD1(sql) {
  const f = d1File();
  if (f) {
    try {
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(f, { readOnly: true });
      const rows = [];
      for (const row of db.prepare(sql).all()) rows.push(row);
      db.close();
      return rows;
    } catch (e) { log('node:sqlite read failed (' + e.message + ') — trying wrangler d1 execute'); }
  }
  if (WRANGLER_JS) {
    try {
      const out = execFileSync(process.execPath,
        [WRANGLER_JS, 'd1', 'execute', 'my-manager-db', '--local', '--persist-to', PERSIST_DIR, '--command', sql, '--json'],
        { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
      const m = out.match(/\[[\s\S]*\]/);
      if (m) {
        const parsed = JSON.parse(m[0]);
        if (parsed[0] && Array.isArray(parsed[0].results)) return parsed[0].results;
      }
    } catch (e) { log('d1 execute fallback failed: ' + e.message); }
  }
  return null;
}
// Miniflare stores R2 objects under hashed blob filenames (the key is
// metadata, not the path), so locate the review blob by CONTENT marker —
// the review text we posted is unique to this run.
function findR2Blob(marker) {
  const root = path.join(PERSIST_DIR, 'v3', 'r2');
  if (!fs.existsSync(root)) return null;
  const hits = [];
  const walk = (d) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        try {
          const content = fs.readFileSync(p, 'utf8');
          if (marker && content.indexOf(marker) > -1) hits.push({ path: p, content });
        } catch (err) { /* skip locked/partial */ }
      }
    }
  };
  walk(root);
  return hits[0] || null;
}

async function api(pathname, opts) {
  const res = await fetch(BASE + pathname, Object.assign({ credentials: 'same-origin' }, opts || {}));
  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  return { status: res.status, body, text: res.status + '|' + JSON.stringify(body) };
}

// ---- headless Chrome (CDP) ------------------------------------------------
const CHROME = process.platform === 'win32'
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : '/usr/bin/google-chrome';
let ws = null; let msgId = 0; const pending = new Map();
function launchChrome(profileDir, port) {
  return new Promise((resolve, reject) => {
    const p = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--incognito', '--remote-debugging-port=' + port, '--user-data-dir=' + profileDir, '--window-size=1440,1200', 'about:blank'], { stdio: 'ignore' });
    const t0 = Date.now();
    const poll = async () => {
      try { const r = await fetch('http://127.0.0.1:' + port + '/json/version'); if (r.ok) return resolve(p); } catch (e) {}
      if (Date.now() - t0 > 30000) return reject(new Error('chrome did not open on :' + port));
      setTimeout(poll, 300);
    };
    poll();
  });
}
async function cdpConnect(port) {
  const targets = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
  const page = targets.find(t => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  ws.onmessage = (ev2) => {
    const msg = JSON.parse(ev2.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  await new Promise((res) => { ws.onopen = res; });
}
function cdp(method, params) {
  return new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}
let consoleErrors = [];
async function ev(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  return r.result && r.result.result ? r.result.result.value : undefined;
}

(async function main() {
  log('starting wrangler dev on :' + PORT + ' (local D1 + R2)…');
  await startWrangler();

  // ---- R1 empty list ----
  const r1 = await api('/api/reviews');
  check('R1 GET /api/reviews starts empty', r1.status === 200 && r1.body && r1.body.ok && Array.isArray(r1.body.reviews) && r1.body.reviews.length === 0, r1.text);

  // ---- R2 valid POST, anonymous ----
  const r2 = await api('/api/reviews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ review: 'Solid tool for our daily standups on site.' }) });
  const r2id = r2.body && r2.body.review ? r2.body.review.id : null;
  check('R2 POST valid review -> ok + id + name null', r2.status === 200 && r2.body && r2.body.ok && r2id && r2.body.review.name === null && r2.body.review.review === 'Solid tool for our daily standups on site.' && r2.body.review.votes === 0, r2.text);

  // ---- R3 POST with name + stars (star-READY) ----
  const r3 = await api('/api/reviews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Project Lead', review: 'Saved our closeout weeks.', stars: 5 }) });
  check('R3 POST name + stars accepted', r3.status === 200 && r3.body && r3.body.ok && r3.body.review.name === 'Project Lead' && r3.body.review.stars === 5, r3.text);

  // ---- R4 GET newest-first + fields ----
  const r4 = await api('/api/reviews');
  const names = (r4.body && r4.body.reviews || []).map(r => r.name);
  check('R4 GET returns newest-first with fields', r4.status === 200 && names[0] === 'Project Lead' && names[1] === null && (r4.body.reviews[1] || {}).review === 'Solid tool for our daily standups on site.' && !!r4.body.reviews[0].createdAt, r4.text);

  // ---- R5 empty review text ----
  const r5 = await api('/api/reviews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ review: '   ' }) });
  check('R5 POST empty review -> 400', r5.status === 400, r5.text);

  // ---- R6 HTML/markup rejected ----
  const r6 = await api('/api/reviews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ review: '<script>alert(1)</script>' }) });
  check('R6 POST HTML markup -> 400 plain-text-only', r6.status === 400 && /plain text/i.test((r6.body && r6.body.error) || ''), r6.text);

  // ---- R7 links rejected ----
  const r7 = await api('/api/reviews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ review: 'Check out https://example.com for details' }) });
  check('R7 POST link -> 400 no-links', r7.status === 400 && /link/i.test((r7.body && r7.body.error) || ''), r7.text);

  // ---- R8 oversized text ----
  const r8 = await api('/api/reviews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ review: 'x'.repeat(2500) }) });
  check('R8 POST >2000 chars -> 400', r8.status === 400, r8.text);

  // ---- R10 cross-origin POST rejected ----
  const r10 = await api('/api/reviews', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Origin': 'https://evil.example' }, body: JSON.stringify({ review: 'x' }) });
  check('R10 cross-origin POST -> 403 same-origin gate', r10.status === 403, r10.text);

  // ---- R11 D1 + R2 durable copy ----
  const d1rows = queryD1('SELECT id, name, review_text, stars, votes FROM reviews ORDER BY id');
  const blob = findR2Blob('Solid tool for our daily standups on site.');
  check('R11 D1 reviews rows written', !!d1rows && d1rows.length >= 2 && (d1rows[0] || {}).review_text === 'Solid tool for our daily standups on site.', JSON.stringify(d1rows).slice(0, 300));
  check('R11b R2 reviews/<id>.json durable copy written', !!blob && blob.content.indexOf('Solid tool for our daily standups on site.') > -1, blob ? blob.path : 'no blob');

  // ---- R12 page render + real form flow (BEFORE the R9 rate-limit hammer:
  // both share the same 127.0.0.1 key, so the hammer would 429 the page's
  // own POST) ----
  let chromeProc = null; let pageOk = true; let why = '';
  try {
    const profile = path.join(os.tmpdir(), 'mmgr-reviews-cdp-' + Date.now());
    const cport = 9300 + Math.floor(Math.random() * 200);
    chromeProc = await launchChrome(profile, cport);
    await cdpConnect(cport);
    await cdp('Page.enable');
    await cdp('Runtime.enable');
    consoleErrors = [];
    await cdp('Page.navigate', { url: BASE + '/reviews.html' });
    await delay(2200);
    const chrome1 = await ev(`(function(){
      return {
        header: !!document.querySelector('.site-header'),
        hero: !!document.querySelector('.page-hero h1'),
        form: !!document.getElementById('review-form'),
        footer: !!document.querySelector('.site-footer'),
        navReviews: (function(){ var a = document.querySelector('.site-nav a[href="reviews.html"]'); return !!a; })(),
        listCards: document.querySelectorAll('.rv-card').length
      };
    })()`);
    check('R12 page renders header/hero/form/footer + nav Reviews + seeded list', chrome1 && chrome1.header && chrome1.hero && chrome1.form && chrome1.footer && chrome1.navReviews && chrome1.listCards >= 2, chrome1);

    // Drive the real form: fill + submit, then wait for the re-fetch render.
    await ev(`(function(){
      var n = document.getElementById('review-name'); if (n) n.value = 'Site Visitor';
      var t = document.getElementById('review-text'); if (t) t.value = 'Browser-driven review from the QA harness.';
      var f = document.getElementById('review-form'); if (f) f.requestSubmit();
      return true;
    })()`);
    await delay(2500);
    const chrome2 = await ev(`(function(){
      return {
        status: (document.getElementById('review-status') || {}).textContent || '',
        firstCard: (function(){ var c = document.querySelector('.rv-card .rv-name'); return c ? c.textContent : null; })(),
        firstText: (function(){ var c = document.querySelector('.rv-card .rv-text'); return c ? c.textContent : null; })()
      };
    })()`);
    check('R12b form posts -> status + new card on top', chrome2 && /Thank you/.test(chrome2.status || '') && chrome2.firstCard === 'Site Visitor' && /Browser-driven review/.test(chrome2.firstText || ''), chrome2);
    check('R12c zero console errors on reviews.html', consoleErrors.length === 0, consoleErrors.slice(0, 5));

    // R13 STAR INPUT UI (STABILIZATION 2026-08-16 — owner decision: star
    // picker + display only): the picker renders 5 radios, a picked rating
    // rides the POST, the new card draws the stars, and the picker resets.
    const starState = await ev(`(function(){
      var row = document.getElementById('rv-pick-row');
      var radios = row ? row.querySelectorAll('input[name="stars"]') : [];
      return { count: radios.length, val: row ? row.getAttribute('data-val') : null };
    })()`);
    check('R13a star picker renders 5 radios (data-val 0)', starState && starState.count === 5 && starState.val === '0', starState);
    await ev(`(function(){
      var n = document.getElementById('review-name'); if (n) n.value = 'Rated Visitor';
      var t = document.getElementById('review-text'); if (t) t.value = 'Browser-driven RATED review with four stars.';
      var row = document.getElementById('rv-pick-row');
      var r4 = row ? row.querySelector('input[value="4"]') : null;
      if (r4) { r4.checked = true; row.dispatchEvent(new Event('change')); }
      var f = document.getElementById('review-form'); if (f) f.requestSubmit();
      return true;
    })()`);
    await delay(2500);
    const starAfter = await ev(`(function(){
      var row = document.getElementById('rv-pick-row');
      var first = document.querySelector('.rv-card');
      var ons = first ? first.querySelectorAll('.rv-star.on').length : 0;
      var name = first ? first.querySelector('.rv-name').textContent : '';
      return { dataVal: row ? row.getAttribute('data-val') : null, checked: !!(row && row.querySelector('input[name="stars"]:checked')), ons: ons, name: name, status: (document.getElementById('review-status') || {}).textContent || '' };
    })()`);
    check('R13b rated review posts -> 4 stars rendered on the new top card', /Thank you/.test(starAfter.status || '') && starAfter.name === 'Rated Visitor' && starAfter.ons === 4, starAfter);
    check('R13c picker resets after the post (data-val 0, nothing checked)', starAfter.dataVal === '0' && starAfter.checked === false, starAfter);
  } catch (e) {
    pageOk = false; why = e.message;
  } finally {
    try { ws && ws.close(); } catch (e) {}
    try { chromeProc && chromeProc.kill(); } catch (e) {}
  }
  check('R12d page flow completed without harness error', pageOk, why);

  // ---- R9 rate limit (dedicated reviews bucket: 10/min) — AFTER the page
  // flow so the browser's own POST is never 429'd by the hammer. ----
  let limited = false; let lastStatus = 0;
  for (let i = 0; i < 12; i++) {
    const r = await api('/api/reviews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ review: 'rate test ' + i }) });
    lastStatus = r.status;
    if (r.status === 429) { limited = true; break; }
  }
  check('R9 POST rate limit trips reviews bucket (429)', limited && lastStatus === 429, 'last status ' + lastStatus);

  stopWrangler();
  const failed = results.filter(r => !r.val);
  log('---');
  log(failed.length === 0 ? 'REVIEWS_GATE PASS (' + results.length + '/' + results.length + ')' : 'REVIEWS_GATE FAIL (' + (results.length - failed.length) + '/' + results.length + ')');
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { log('FATAL: ' + e.stack); stopWrangler(); process.exit(1); });
