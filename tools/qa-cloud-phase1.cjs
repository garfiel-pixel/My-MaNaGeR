/* ============================================================
   CLOUD-BACKEND-ARCHITECTURE-PLAN Phase 1 — END-TO-END GATE
   ------------------------------------------------------------
   Starts the Worker LOCALLY (npx wrangler dev against a local
   D1 + R2 miniflare emulation) and verifies each Phase-1 piece
   against that live server — not just source inspection:

     C1  a project can be created and a row written to D1
     C2  the state blob lands in local R2 emulation and the D1
         row correctly references it
     C3  the owner code is generated, hashed before storage
         (PBKDF2 recompute matches), and never stored or logged
         in plaintext anywhere (D1 bytes, R2 bytes, dev logs)
     C4  entering the correct owner code on a FRESH 'device' (a
         second incognito Chrome context) successfully pulls the
         project back down
     C5  wrong / malformed / unknown-project codes are rejected
         with the SAME generic 403 body — no existence leak

   Exit 0 only when all five pass. Reports PASS/FAIL per check.
   Usage: node tools/qa-cloud-phase1.cjs
   ============================================================ */
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const { chromePath: CHROME, BASE, DEBUG_PORT: PORT } = require('./chrome-launcher.cjs');
const ROOT = path.resolve(__dirname, '..');

let ws = null; let msgId = 0; const pending = new Map();
const log = (s) => { process.stdout.write('[cloud1] ' + s + '\n'); };
const delay = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, val, detail) => { results.push({ name, val }); log((val ? 'PASS' : 'FAIL') + '  ' + name + (val ? '' : '   <-- ' + JSON.stringify(detail).slice(0, 400))); };

setTimeout(() => { log('WATCHDOG — harness exceeded 300s'); try { proc && proc.kill(); } catch (e) {} process.exit(2); }, 300000).unref();

// ---- wrangler location ----------------------------------------------------
// npm is npm.cmd on Windows — execFileSync('npm') would throw ENOENT there.
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

// Local D1/R2 persistence MUST live OUTSIDE the project directory. miniflare
// writes state on every operation; if that state sits inside the assets
// directory the dev server's own writes trigger the asset watcher, which
// reloads the worker, which writes state again — an infinite reload loop
// (observed live: 400+ "Reloading local server" lines, health never answered).
const PERSIST_DIR = path.join(os.tmpdir(), 'mmgr-cloud-wstate-' + Date.now());

let proc = null;          // wrangler dev child
let devLog = '';          // captured wrangler stdout+stderr (plaintext scan)

function startWrangler() {
  return new Promise((resolve, reject) => {
    log('starting wrangler dev on :' + PORT + ' (local D1 + R2 emulation, persist ' + PERSIST_DIR + ')…');
    // Apply the migration into the SAME external persist dir the dev server
    // will use, so the cloud_projects table exists on first boot.
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
    proc.stdout.on('data', d => { devLog += d; });
    proc.stderr.on('data', d => { devLog += d; });
    proc.on('error', (e) => reject(new Error('wrangler spawn failed: ' + e.message)));
    proc.on('exit', (code) => { if (code !== 0 && code !== null) log('wrangler dev exited early (code ' + code + ')'); });
    // Wait for /api/health (up to 120s — first boot bundles the worker).
    const t0 = Date.now();
    const poll = async () => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(function() { ctrl.abort(); }, 3000);
        const r = await fetch(BASE + '/api/health', { signal: ctrl.signal });
        clearTimeout(timer);
        if (r.ok) return resolve();
      } catch (e) { /* not up yet or timed out */ }
      if (Date.now() - t0 > 120000) return reject(new Error('wrangler dev did not come up in 120s'));
      setTimeout(poll, 1500);
    };
    poll();
  });
}
function stopWrangler() {
  try { proc && proc.kill(); } catch (e) {}
}

// ---- D1 direct inspection (node:sqlite, read-only — immune to the dev
// process's WAL session; wrangler d1 execute fallback if unavailable) -------
// SQL literal helper: SQLite treats double quotes as identifiers, so string
// values in WHERE clauses MUST use single quotes.
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
  if (f && typeof require('node:sqlite') === 'object') {
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

// ---- R2 local-emulation blob finder ---------------------------------------
// Miniflare persists R2 objects under .wrangler/state/v3/r2/<bucket>/…;
// returns { path, content } for the first file whose path ends with the key
// OR whose content matches the marker (layout-agnostic).
function findR2Blob(keySuffix, marker) {
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
          const keyMatch = keySuffix && p.split(path.sep).join('/').endsWith(keySuffix);
          const markerMatch = marker && content.indexOf(marker) > -1;
          if (keyMatch || markerMatch) hits.push({ path: p, content });
        } catch (err) { /* skip locked/partial */ }
      }
    }
  };
  walk(root);
  return hits[0] || null;
}

// ---- HTTP helpers ----------------------------------------------------------
async function api(pathname, opts) {
  const res = await fetch(BASE + pathname, Object.assign({ credentials: 'same-origin' }, opts || {}));
  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  return { status: res.status, body, text: res.status + '|' + JSON.stringify(body) };
}

// ============================================================================
// PHASE A — HTTP-level checks (C1, C2, C3, C5 + the server half of C4)
// ============================================================================
async function phaseA() {
  const PID = 'qa-cloud-' + Date.now().toString(36);
  const NAME = 'QA Cloud Phase 1';
  const STATE_MARKER = 'state-blob-' + Date.now().toString(36);
  const STATE = { projectName: NAME, marker: STATE_MARKER, tasks: [{ id: 'T1', name: 'Foundations', status: 'todo' }] };

  // ---- C1: create project -> D1 row ---------------------------------------
  const create = await api('/api/cloud/projects', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: PID, name: NAME })
  });
  check('C1a create returns ok + ownerCode', create.status === 200 && create.body && create.body.ok === true && typeof create.body.ownerCode === 'string', create.text);
  const CODE = create.body ? create.body.ownerCode : '';
  const codeRe = /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/;
  check('C1b owner code format XXXX-XXXX-XXXX-XXXX (no 0/O/1/I/L)', codeRe.test(CODE), CODE);

  let rows = queryD1('SELECT project_id, owner_code_salt, owner_code_hash, owner_label, google_sub, latest_r2_key FROM cloud_projects WHERE project_id = ' + q(PID));
  const row = rows && rows[0];
  check('C1c D1 row written (project_id + label)', !!row && row.project_id === PID && row.owner_label === NAME, rows);
  check('C1d D1 row exists before any save (latest_r2_key NULL)', !!row && row.latest_r2_key === null, row);

  // ---- C2: save -> R2 blob + D1 reference ----------------------------------
  const save = await api('/api/cloud/projects/' + PID + '/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Owner-Code': CODE },
    body: JSON.stringify({ state: STATE })
  });
  check('C2a save returns ok', save.status === 200 && save.body && save.body.ok === true, save.text);
  const KEY = 'projects/' + PID + '/latest.json';
  check('C2b save reports the expected R2 key', save.body && save.body.key === KEY, save.body);

  rows = queryD1('SELECT latest_r2_key FROM cloud_projects WHERE project_id = ' + q(PID));
  check('C2c D1 row now references the R2 key', !!rows && rows[0] && rows[0].latest_r2_key === KEY, rows);

  const blob = findR2Blob(KEY, STATE_MARKER);
  let blobState = null;
  try { if (blob) blobState = JSON.parse(blob.content); } catch (e) { /* not JSON */ }
  check('C2d state blob found in local R2 emulation', !!blob, blob ? blob.path : 'no blob');
  check('C2e R2 blob content equals the saved state', !!blobState && blobState.marker === STATE_MARKER && blobState.tasks[0].id === 'T1', blobState);

  // ---- C3: owner code hashed, never plaintext ------------------------------
  rows = queryD1('SELECT owner_code_salt, owner_code_hash FROM cloud_projects WHERE project_id = ' + q(PID));
  const hashRow = rows && rows[0];
  const salt = hashRow ? hashRow.owner_code_salt : '';
  const storedHash = hashRow ? hashRow.owner_code_hash : '';
  check('C3a stored salt is 32 hex chars', /^[0-9a-f]{32}$/.test(salt), salt);
  check('C3b stored hash is 64 hex chars (PBKDF2-SHA256 256-bit)', /^[0-9a-f]{64}$/.test(storedHash), storedHash);
  check('C3c stored hash is NOT the plaintext code', storedHash !== CODE && storedHash.indexOf(CODE) === -1, storedHash.slice(0, 12) + '…');
  // Recompute PBKDF2 the exact way the Worker does: salt = UTF-8 bytes of the
  // hex salt STRING, 100000 iterations, SHA-256, 256 bits.
  let recomputed = '';
  try {
    recomputed = crypto.pbkdf2Sync(Buffer.from(CODE, 'utf8'), Buffer.from(salt, 'utf8'), 100000, 32, 'sha256').toString('hex');
  } catch (e) { recomputed = ''; }
  check('C3d PBKDF2 recompute matches the stored hash', recomputed === storedHash, recomputed.slice(0, 12) + ' vs ' + storedHash.slice(0, 12));

  // Plaintext never on disk: scan D1 sqlite bytes + every R2 file bytes.
  let plaintextOnDisk = [];
  const f = d1File();
  if (f) { try { if (fs.readFileSync(f).includes(Buffer.from(CODE, 'utf8'))) plaintextOnDisk.push(f); } catch (e) {} }
  const r2root = path.join(PERSIST_DIR, 'v3', 'r2');
  if (fs.existsSync(r2root)) {
    const walk2 = (d) => {
      let entries = [];
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
      for (const e of entries) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk2(p);
        else if (e.isFile()) {
          try { if (fs.readFileSync(p).includes(Buffer.from(CODE, 'utf8'))) plaintextOnDisk.push(p); } catch (err) {}
        }
      }
    };
    walk2(r2root);
  }
  check('C3e plaintext code absent from ALL D1 + R2 bytes', plaintextOnDisk.length === 0, plaintextOnDisk);

  // ---- C4 (server half): load with the CORRECT code from a fresh context ---
  const load = await api('/api/cloud/projects/' + PID + '/load', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Owner-Code': CODE },
    body: JSON.stringify({})
  });
  check('C4a correct code loads the saved state (fresh HTTP context)', load.status === 200 && load.body && load.body.ok === true && load.body.state && load.body.state.marker === STATE_MARKER, load.text);

  // ---- C5: wrong/malformed/unknown all get the SAME 403 --------------------
  const wrong = await api('/api/cloud/projects/' + PID + '/load', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Owner-Code': 'AAAA-BBBB-CCCC-DDDD' },
    body: JSON.stringify({})
  });
  const malformed = await api('/api/cloud/projects/' + PID + '/load', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Owner-Code': 'not-a-code' },
    body: JSON.stringify({})
  });
  const unknown = await api('/api/cloud/projects/does-not-exist-xyz/load', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Owner-Code': CODE },
    body: JSON.stringify({})
  });
  const unknownMeta = await api('/api/cloud/projects/does-not-exist-xyz/meta', {
    method: 'GET',
    headers: { 'X-Owner-Code': CODE }
  });
  check('C5a wrong code rejected with 403', wrong.status === 403, wrong.status);
  check('C5b malformed code rejected with 403', malformed.status === 403, malformed.status);
  check('C5c unknown project id rejected with 403 (load)', unknown.status === 403, unknown.status);
  check('C5d unknown project id rejected with 403 (meta)', unknownMeta.status === 403, unknownMeta.status);
  const b1 = JSON.stringify(wrong.body), b2 = JSON.stringify(malformed.body), b3 = JSON.stringify(unknown.body), b4 = JSON.stringify(unknownMeta.body);
  check('C5e all four responses share the SAME body (no existence leak)', b1 === b2 && b2 === b3 && b3 === b4, { b1, b3 });

  return { PID, CODE, STATE_MARKER, STATE };
}

// ============================================================================
// PHASE B — fresh-device recovery via a SECOND incognito Chrome context (C4)
// ============================================================================
function launchChrome(profileDir, port) {
  return new Promise((resolve, reject) => {
    const p = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--incognito', '--remote-debugging-port=' + port, '--user-data-dir=' + profileDir, '--window-size=1440,1200', 'about:blank'], { stdio: 'ignore' });
    let ok = false;
    const poll = async () => {
      try { const r = await fetch('http://127.0.0.1:' + port + '/json/version'); if (r.ok) { ok = true; return resolve(p); } } catch (e) {}
      if (!ok && Date.now() - t0 > 30000) return reject(new Error('chrome did not open on :' + port));
      setTimeout(poll, 300);
    };
    const t0 = Date.now();
    poll();
  });
}
async function cdpConnect(port) {
  const targets = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
  const page = targets.find(t => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    // Auto-accept any JS dialog (loadFromCloud uses window.confirm).
    if (m.method === 'Page.javascriptDialogOpening') {
      send('Page.handleJavaScriptDialog', { accept: true });
    }
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws fail')); });
  await send('Runtime.enable'); await send('Page.enable');
}
function send(method, params) {
  return new Promise(res => {
    const id = ++msgId;
    pending.set(id, m => { pending.delete(id); res(m.result || {}); });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { __err: r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text };
  return r.result && r.result.value;
}

// Wait until a selector is clickable (up to ~12s), then click it.
async function clickWhen(selector) {
  for (let i = 0; i < 24; i++) {
    const ok = await ev('(function(){var el=document.querySelector(' + JSON.stringify(selector) + ');if(el){el.click();return true;}return false;})()');
    if (ok === true) return true;
    await delay(500);
  }
  return false;
}

async function phaseB() {
  // Phase B creates its OWN project entirely through the Device-A UI (the
  // Phase-A project id is already linked — re-creating it would 409).
  const PID = 'qa-ui-' + Date.now().toString(36);
  const dirA = path.join(os.tmpdir(), 'mmgr-cloud-A-' + Date.now());
  const dirB = path.join(os.tmpdir(), 'mmgr-cloud-B-' + Date.now());
  fs.mkdirSync(dirA, { recursive: true });
  fs.mkdirSync(dirB, { recursive: true });
  let uiCode = '';

  // --- Device A (creator): seed workspace, open project, create + save via
  // the REAL drawer UI, capture the code from sessionStorage.
  const procA = await launchChrome(dirA, 9234);
  await cdpConnect(9234);
  await send('Page.navigate', { url: BASE + '/index.html' }); await delay(2500);
  await ev(`(function(){
    localStorage.setItem('mmgr_unlocked_${PID}','1');
    localStorage.setItem('mmgr_scope_${PID}','full');
    localStorage.setItem('mmgr_state_${PID}', JSON.stringify({projectName:'Device A local', marker:'device-a-local'}));
    localStorage.setItem('mmgr_current_project','${PID}');
    return true;
  })()`);
  await send('Page.navigate', { url: BASE + '/project.html?id=' + PID }); await delay(5000);
  await clickWhen('[data-action=openDrw]'); await delay(500);
  await clickWhen('[data-action=swDtab][data-tab=ctrl]'); await delay(500);
  const uiHasSection = await ev('(function(){var s=document.getElementById("cloud-section");return !!(s && s.querySelector("[data-action=cloudCreate]"));})()');
  check('C4b Controls drawer renders the Cloud section (create button)', uiHasSection === true, uiHasSection);
  await clickWhen('[data-action=cloudCreate]'); await delay(2500);
  uiCode = await ev('(function(){return (window.MMGR.Cloud && MMGR.Cloud.getCode()) || sessionStorage.getItem("mmgr_cloud_code_' + PID + '") || "";})()');
  check('C4c create stores the owner code in sessionStorage (session-only)', typeof uiCode === 'string' && uiCode.length > 0, uiCode);
  // Save the seeded device-A state (distinct from the HTTP-saved STATE) so a
  // later load from the fresh device must return THIS blob.
  await clickWhen('[data-action=cloudSave]'); await delay(2500);
  const saveStatus = await ev('(function(){var s=document.getElementById("cloud-status");return s?s.className+" | "+s.textContent:"";})()');
  check('C4d Save to Cloud succeeded from the UI (status ok)', typeof saveStatus === 'string' && saveStatus.indexOf('ds-ok') > -1, saveStatus);
  try { ws.close(); } catch (e) {}
  try { procA.kill(); } catch (e) {}

  // --- Device B (FRESH incognito context — no code, different local state) --
  const procB = await launchChrome(dirB, 9235);
  await cdpConnect(9235);
  await send('Page.navigate', { url: BASE + '/index.html' }); await delay(2500);
  await ev(`(function(){
    localStorage.setItem('mmgr_unlocked_${PID}','1');
    localStorage.setItem('mmgr_scope_${PID}','full');
    localStorage.setItem('mmgr_state_${PID}', JSON.stringify({projectName:'Device B stale', marker:'device-b-stale'}));
    localStorage.setItem('mmgr_current_project','${PID}');
    return true;
  })()`);
  await send('Page.navigate', { url: BASE + '/project.html?id=' + PID }); await delay(5000);
  await clickWhen('[data-action=openDrw]'); await delay(500);
  await clickWhen('[data-action=swDtab][data-tab=ctrl]'); await delay(500);
  const freshHasInput = await ev('(function(){var i=document.getElementById("cloud-code-in");return !!i && !!document.querySelector("[data-action=cloudLoadWithCode]");})()');
  check('C4e fresh device shows the "Load with Code" entry (no code in session)', freshHasInput === true, freshHasInput);

  // Wrong code on the fresh device first: must be rejected, state untouched.
  // window.confirm is stubbed because headless Chrome auto-dismisses dialogs
  // (confirm() would return false and the load would silently no-op).
  await ev('window.confirm = function(){ return true; }; true');
  await ev(`(function(){var i=document.getElementById("cloud-code-in");if(i){i.value="ZZZZ-ZZZZ-ZZZZ-ZZZZ";i.dispatchEvent(new Event("input",{bubbles:true}));}return true;})()`);
  await clickWhen('[data-action=cloudLoadWithCode]'); await delay(2500);
  const wrongStatus = await ev('(function(){var s=document.getElementById("cloud-status");return s?s.className+" | "+s.textContent:"";})()');
  const stateAfterWrong = await ev('(function(){try{return JSON.parse(localStorage.getItem("mmgr_state_' + PID + '")).marker;}catch(e){return null;}})()');
  check('C4f wrong code rejected on fresh device (status err)', typeof wrongStatus === 'string' && wrongStatus.indexOf('ds-err') > -1, wrongStatus);
  check('C4g wrong code left local state untouched', stateAfterWrong === 'device-b-stale', stateAfterWrong);

  // Correct code: must pull Device A's blob down and reload into the workspace.
  await ev(`(function(){var i=document.getElementById("cloud-code-in");if(i){i.value=${JSON.stringify(uiCode)};i.dispatchEvent(new Event("input",{bubbles:true}));}return true;})()`);
  await clickWhen('[data-action=cloudLoadWithCode]');
  // loadFromCloud reloads the page ~1.2s after a successful write.
  let restored = null;
  for (let i = 0; i < 20; i++) {
    await delay(1000);
    restored = await ev('(function(){try{var s=JSON.parse(localStorage.getItem("mmgr_state_' + PID + '"));return s?s.marker:null;}catch(e){return null;}})()');
    if (restored === 'device-a-local') break;
  }
  check('C4h fresh device pulled the creator\u2019s cloud snapshot into the workspace', restored === 'device-a-local', restored);
  try { ws.close(); } catch (e) {}
  try { procB.kill(); } catch (e) {}
  return uiCode;
}

// ============================================================================
(async () => {
  if (!WRANGLER_JS) { log('FATAL: global wrangler not found (npm root -g)'); process.exit(1); }
  log('wrangler at: ' + WRANGLER_JS);
  try {
    await startWrangler();
  } catch (e) {
    log('FATAL: ' + e.message);
    log('--- last dev log ---'); log(devLog.slice(-1500));
    process.exit(1);
  }

  try {
    const ctx = await phaseA();
    check('C3f plaintext code absent from wrangler dev logs', devLog.indexOf(ctx.CODE) === -1, 'found in dev log');
    const uiCode = await phaseB();
    check('C3g UI-created owner code also absent from wrangler dev logs', uiCode === '' || devLog.indexOf(uiCode) === -1, 'found in dev log');
  } catch (e) {
    check('harness crashed', false, e.message);
  } finally {
    stopWrangler();
  }

  const failed = results.filter(r => !r.val);
  log('──────────────────────────────────────────────');
  log('CLOUD_PHASE1 ' + (failed.length === 0 ? 'PASS (' + results.length + '/' + results.length + ' checks)' : 'FAIL (' + failed.length + '/' + results.length + ' broken)'));
  failed.forEach(r => log('  broken: ' + r.name));
  process.exit(failed.length === 0 ? 0 : 1);
})().catch(e => { log('FATAL: ' + e.message); try { stopWrangler(); } catch (err) {} process.exit(1); });
