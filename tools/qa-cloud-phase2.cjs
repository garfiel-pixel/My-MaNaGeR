/* ============================================================
   CLOUD-BACKEND-ARCHITECTURE-PLAN Phase 2 + 3 — END-TO-END GATE
   ------------------------------------------------------------
   Starts the Worker LOCALLY (npx wrangler dev against local D1 +
   R2 miniflare emulation, with an ADMIN_CODE in .dev.vars for the
   admin-listing checks) and verifies each new piece against that
   live server:

   PHASE 2 — editor codes with SERVER-SIDE section scoping:
     P2.1  owner creates an editor code (label + scope), the code
           hashes like the owner code (never plaintext in D1/R2)
     P2.2  editor code list/revoke are owner-only (403 otherwise)
     P2.3  editor load returns role/editorLabel/scope
     P2.4  editor save within scope is applied (applied:['wbs'])
     P2.5  SCOPE ENFORCEMENT: an editor save that also tries to
           change an out-of-scope section (risks) is merged — the
           out-of-scope change is NOT persisted (blocked:['risk'])
           while the in-scope change IS (checked on the blob)
     P2.6  wrong / revoked editor codes and unknown projects get
           the SAME generic 403 body as wrong owner codes
     P2.7  invalid scope entries are filtered; empty scope -> 400
     P2.8  an editor can save the FIRST blob for a project (only
           its scoped sections become the blob)
     P2.9  GET /api/cloud/sections returns the canonical vocabulary

   PHASE 3 — changelog with owner-only revert:
     P3.1  a small owner save logs a field-level 'edit' entry with
           before/after values (charter.name)
     P3.2  owner revert applies the before-value, the blob is
           restored, and a NEW 'revert' entry is logged (history
           preserved); a revert of the revert restores again
     P3.3  editor saves are attributed to the editor code's label
     P3.4  editors cannot revert and cannot list (403 generic)
     P3.5  a bulk save (>40 leaf diffs) logs a snapshot 'bulk'
           entry; owner revert restores the snapshot; the revert
           is itself reversible

   ADMIN — operator-gated cloud visibility:
     P4.1  GET /api/cloud/admin/projects with the correct
           ADMIN_CODE lists cloud-linked projects
     P4.2  wrong / missing admin code -> 403 (and 503 when the
           secret is not configured — verified by source, not
           live, since the harness must configure it to test P4.1)

   Exit 0 only when all checks pass. Reports PASS/FAIL per check.
   Usage: node tools/qa-cloud-phase2.cjs
   ============================================================ */
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const ADMIN_CODE = process.env.ADMIN_CODE || ('QA-ADMIN-' + Date.now().toString(36).toUpperCase());

const log = (s) => { process.stdout.write('[cloud2] ' + s + '\n'); };
const delay = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, val, detail) => { results.push({ name, val }); log((val ? 'PASS' : 'FAIL') + '  ' + name + (val ? '' : '   <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 500))); };

setTimeout(() => { log('WATCHDOG — harness exceeded 360s'); try { proc && proc.kill(); } catch (e) {} process.exit(2); }, 360000).unref();

// ---- wrangler location ----------------------------------------------------
function globalWranglerJs() {
  const localP = path.join(__dirname, '..', 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  if (fs.existsSync(localP)) return localP;
  try {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const root = execFileSync(npmCmd, ['root', '-g'], { encoding: 'utf8', shell: process.platform === 'win32' }).trim();
    const p = path.join(root, 'wrangler', 'bin', 'wrangler.js');
    if (fs.existsSync(p)) return p;
  } catch (e) { /* fall through */ }
  return null;
}
const WRANGLER_JS = globalWranglerJs();
// When WRANGLER_DEV_URL is set (CI), use the external wrangler's persist dir
// so that queryD1 reads the same D1 that the API calls write to.
const USE_EXTERNAL = !!process.env.WRANGLER_DEV_URL;
const PERSIST_DIR = USE_EXTERNAL
  ? (process.env.QA_PERSIST_DIR || path.join(os.tmpdir(), 'mmgr-wrangler-state'))
  : path.join(os.tmpdir(), 'mmgr-cloud-wstate2-' + Date.now());
const DEV_VARS = path.join(ROOT, '.dev.vars');

let proc = null;
let devLog = '';

function startWrangler() {
  return new Promise((resolve, reject) => {
    // The harness must configure ADMIN_CODE for the admin checks; the
    // .dev.vars file is gitignored and removed on exit.
    try { fs.writeFileSync(DEV_VARS, 'ADMIN_CODE=' + ADMIN_CODE + '\n'); } catch (e) {}
    if (USE_EXTERNAL) {
      log('using external wrangler at ' + process.env.WRANGLER_DEV_URL + ' (persist ' + PERSIST_DIR + ')');
      (async () => {
        try {
          const r = await fetch(process.env.WRANGLER_DEV_URL + '/api/health');
          const body = await r.json().catch(() => null);
          if (r.ok && body && body.ok === true) return resolve();
          return reject(new Error('external wrangler health check failed: ' + r.status));
        } catch (e) { return reject(new Error('external wrangler not reachable: ' + e.message)); }
      })();
      return;
    }
    log('starting wrangler dev on :' + PORT + ' (local D1 + R2, ADMIN_CODE configured)…');
    try {
      execFileSync(process.execPath,
        [WRANGLER_JS, 'd1', 'migrations', 'apply', 'my-manager-db', '--local', '--config', 'wrangler.ci.jsonc', '--persist-to', PERSIST_DIR],
        { cwd: ROOT, stdio: 'ignore', timeout: 90000 });
    } catch (e) { log('migrations apply (best-effort): ' + e.message); }
    proc = spawn(process.execPath, [WRANGLER_JS, 'dev', '--config', 'wrangler.ci.jsonc', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', PERSIST_DIR], {
      cwd: ROOT,
      env: Object.assign({}, process.env, { WRANGLER_SEND_METRICS: 'false' }),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    proc.stdout.on('data', d => { devLog += d; });
    proc.stderr.on('data', d => { devLog += d; });
    proc.on('error', (e) => reject(new Error('wrangler spawn failed: ' + e.message)));
    proc.on('exit', (code) => { if (code !== 0 && code !== null) log('wrangler dev exited early (code ' + code + ')'); });
    const t0 = Date.now();
    const poll = async () => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(function() { ctrl.abort(); }, 3000);
        const r = await fetch(BASE + '/api/health', { signal: ctrl.signal });
        clearTimeout(timer);
        if (r.ok) {
          const body = await r.json().catch(() => null);
          if (body && body.ok === true) return resolve();
          log('health check got 200 but worker not loaded (SPA fallback?) — body: ' + JSON.stringify(body).slice(0, 200));
        }
      } catch (e) { /* not up yet */ }
      if (Date.now() - t0 > 120000) {
        log('wrangler dev log (last 2000 chars):\n' + devLog.slice(-2000));
        return reject(new Error('wrangler dev did not come up in 120s'));
      }
      setTimeout(poll, 1500);
    };
    poll();
  });
}
function stopWrangler() {
  try { proc && proc.kill(); } catch (e) {}
  try { fs.unlinkSync(DEV_VARS); } catch (e) {}
}

// ---- D1 direct inspection (same read-only sqlite approach as phase 1) -----
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
        [WRANGLER_JS, 'd1', 'execute', 'my-manager-db', '--local', '--config', 'wrangler.ci.jsonc', '--persist-to', PERSIST_DIR, '--command', sql, '--json'],
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
// Retry wrapper: the WAL may not be visible to node:sqlite immediately
// after the Worker's D1 binding writes. Retries up to 3x with 200ms delay.
async function queryD1Retry(sql, label) { label = label || 'd1-read';
  for (let _attempt = 0; _attempt < 3; _attempt++) {
    const rows = queryD1(sql);
    if (rows && rows.length > 0) return rows;
    log(label + ': row not visible on attempt ' + (_attempt + 1) + ', retrying in 200ms...');
    await delay(200);
  }
  return queryD1(sql);
}
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

async function api(pathname, opts) {
  const res = await fetch(BASE + pathname, Object.assign({ credentials: 'same-origin' }, opts || {}));
  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  return { status: res.status, body, text: res.status + '|' + JSON.stringify(body) };
}

// ---- real-browser plumbing (same CDP pattern as qa-cloud-phase1 phase B) ---
const { chromePath: CHROME, BASE, PORT } = require('./chrome-launcher.cjs');
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
    const m = JSON.parse(ev2.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true });
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
async function clickWhen(selector) {
  for (let i = 0; i < 24; i++) {
    const ok = await ev('(function(){var el=document.querySelector(' + JSON.stringify(selector) + ');if(el){el.click();return true;}return false;})()');
    if (ok === true) return true;
    await delay(500);
  }
  return false;
}

// PHASE E — REAL-BROWSER editor flow: fresh-device unlock via app.html's
// ?locked=<id> auto-open + tryCloudEditorUnlock, then the project viewer's
// editor-scope UI (greyed nav) and an editor-mode Save to Cloud.
// NOTE on paths: wrangler dev serves the static assets with CLEAN URLs —
// /app.html is 307-redirected to /app and /project.html to /project — so the
// checks accept both forms (probe-verified while debugging P2.10a-f).
async function phaseE(pid, code) {
  const dir = require('os').tmpdir() + '/mmgr-cloud2-E-' + Date.now();
  require('fs').mkdirSync(dir, { recursive: true });
  const proc = await launchChrome(dir, 9250);
  await cdpConnect(9250);
  const consoleLines = [];
  const onMsg = ws.onmessage;
  ws.onmessage = function(ev2) {
    const m = JSON.parse(ev2.data);
    if (m.method === 'Runtime.consoleAPICalled') {
      try { consoleLines.push('[console] ' + (m.params.args || []).map(a => a.value !== undefined ? a.value : (a.description || '')).join(' ')); } catch (e) {}
    }
    if (m.method === 'Runtime.exceptionThrown') {
      try { consoleLines.push('[exception] ' + (m.params.exceptionDetails.exception ? m.params.exceptionDetails.exception.description : m.params.exceptionDetails.text)); } catch (e) {}
    }
    if (m.method === 'Network.requestWillBeSent' && m.params.request.url.indexOf('/api/cloud/') > -1) {
      try { consoleLines.push('[cloud-req] ' + m.params.request.method + ' ' + m.params.request.url + ' code=' + JSON.stringify(m.params.request.headers['X-Editor-Code'] || m.params.request.headers['X-Owner-Code'] || null)); } catch (e) {}
    }
    if (m.method === 'Network.responseReceived' && m.params.response.url.indexOf('/api/cloud/') > -1) {
      try { consoleLines.push('[cloud-resp] ' + m.params.response.status + ' ' + m.params.response.url); } catch (e) {}
    }
    onMsg.call(this, ev2);
  };
  try { await send('Network.enable'); } catch (e) {}
  log('phaseE: pid=' + pid + ' code=' + String(code).slice(0, 4) + '**** (len ' + String(code).length + ')');
  // 1) A fresh device clicks the shared link: project.html gate bounces to
  //    app.html?locked=<id>, which auto-opens the unlock modal.
  await send('Page.navigate', { url: BASE + '/project.html?id=' + pid });
  await delay(6000);
  const locked = await ev('(function(){ return { path: location.pathname, q: location.search, modalOpen: (document.getElementById("om")||{}).className ? document.getElementById("om").classList.contains("open") : false, hasInput: !!document.getElementById("code-input"), title: (document.getElementById("om-title-text")||{}).textContent }; })()');
  check('P2.10a locked direct link bounced to app.html?locked and auto-opened the unlock modal', locked && (locked.path === '/app.html' || locked.path === '/app') && locked.q.indexOf('locked=' + pid) !== -1 && locked.modalOpen === true && locked.hasInput === true, locked);
  // 2) Type the editor code and unlock.
  await ev(`(function(){ var i=document.getElementById('code-input'); i.value=${JSON.stringify(code)}; return true; })()`);
  const unlockRes = await ev('(async function(){ try { await attemptUnlock(); return { done: true }; } catch (e) { return { threw: String(e && e.stack || e) }; } })()');
  await delay(5000);
  const after = await ev('(function(){ return { path: location.pathname, q: location.search, gerr: (document.getElementById("gerr")||{}).textContent, unlocked: localStorage.getItem("mmgr_unlocked_' + pid + '"), ecode: (function(){try{return sessionStorage.getItem("mmgr_cloud_ecode_' + pid + '");}catch(e){return null;}})(), escope: (function(){try{return sessionStorage.getItem("mmgr_cloud_escope_' + pid + '");}catch(e){return null;}})(), hasState: !!localStorage.getItem("mmgr_state_' + pid + '") }; })()');
  check('P2.10b editor code unlocked the project + wrote state + remembered scope', after && (after.path === '/project.html' || after.path === '/project') && after.unlocked === '1' && after.ecode === code && after.hasState === true, { unlockRes: unlockRes, after: after, code: String(code).slice(0, 4) + '****', consoleTail: consoleLines.slice(-12), devLogTail: devLog.split('\n').filter(l => l.indexOf('/api/cloud/') > -1).slice(-6) });
  let escope = null;
  try { escope = JSON.parse(after.escope); } catch (e) {}
  check('P2.10c editor scope stored in session (sections from the server)', !!escope && Array.isArray(escope.sections) && escope.sections.indexOf('wbs') !== -1 && escope.sections.indexOf('risk') !== -1, escope);
  // 3) Editor-scope UI: banner class on body, in-scope nav clickable, out-of-scope greyed.
  const scopeUI = await ev('(function(){ var wbs=document.querySelector(".sec-btn[data-section=wbs]"); var bud=document.querySelector(".sec-btn[data-section=bud]"); return { bodyClass: document.body.className, wbsBlocked: wbs ? wbs.classList.contains("scope-blocked") : null, budBlocked: bud ? bud.classList.contains("scope-blocked") : null }; })()');
  check('P2.10d editor-scope UI: body editor-scope + WBS allowed + Budget greyed', scopeUI && scopeUI.bodyClass.indexOf('editor-scope') !== -1 && scopeUI.wbsBlocked === false && scopeUI.budBlocked === true, scopeUI);
  // 4) Drawer: cloud section renders EDITOR mode; Save to Cloud succeeds.
  await clickWhen('[data-action=openDrw]'); await delay(600);
  await clickWhen('[data-action=swDtab][data-tab=ctrl]'); await delay(600);
  const edMode = await ev('(function(){ var s=document.getElementById("cloud-section"); return !!s && !!s.querySelector("[data-action=cloudSave]") && s.textContent.indexOf("editing as editor") !== -1; })()');
  check('P2.10e drawer shows editor mode with Save button', edMode === true, edMode);
  await clickWhen('[data-action=cloudSave]'); await delay(4000);
  const st = await ev('(function(){ var s=document.getElementById("cloud-status"); return s ? s.className + " | " + s.textContent : ""; })()');
  check('P2.10f editor-mode Save to Cloud succeeded (server enforced, status ok)', typeof st === 'string' && st.indexOf('ds-ok') > -1, { st: st, consoleTail: consoleLines.slice(-10) });
  try { ws.close(); } catch (e) {}
  try { proc.kill(); } catch (e) {}
}

// ---- state builders -------------------------------------------------------
function baseState(pid, name) {
  const now = new Date().toISOString();
  return {
    schemaVersion: 17, projectId: pid, projectName: name, updatedAt: now,
    charter: { name: name, sponsor: 'Sponsor', objective: '', scope: '', deliverables: '', constraints: '', assumptions: '', exclusions: '', targetStart: '', targetCompletion: '', budgetEnvelope: 0, kpis: [], categories: { financial: true, schedule: true, quality: true, safety: true, environmental: true } },
    tasks: [{ id: 't1', name: 'Task One', status: 'todo', start: '2026-01-01', end: '2026-01-05', duration: 5, predecessors: [], milestone: false }],
    risks: [{ id: 'r1', name: 'Risk One', prob: 3, impact: 3 }],
    resources: [], budgetLines: [], budgetEnvelope: 0, spendLog: [], stakeholders: [],
    fieldTs: { charter: now, tasks: now, risks: now },
    config: {}, flags: {}, errorLog: []
  };
}

(async () => {
  if (!WRANGLER_JS) { log('FATAL: global wrangler not found (npm root -g)'); process.exit(1); }
  try { await startWrangler(); } catch (e) { log('FATAL: ' + e.message); log('--- last dev log ---'); log(devLog.slice(-1500)); try { fs.unlinkSync(DEV_VARS); } catch (err) {} process.exit(1); }

  try {
    // ==================================================================
    // PHASE A — setup + editor codes
    // ==================================================================
    const PID = 'qa-cloud2-' + Date.now().toString(36);
    const NAME = 'Cloud Phase 2';
    const state1 = baseState(PID, NAME);

    // A1: sections endpoint
    const secs = await api('/api/cloud/sections');
    check('P2.9a /api/cloud/sections returns ok + sections array', secs.status === 200 && secs.body && secs.body.ok === true && Array.isArray(secs.body.sections), secs.text);
    check('P2.9b canonical sections include wbs/bud/risk with labels', !!secs.body && secs.body.sections.length >= 10 && secs.body.sections.some(s => s.key === 'wbs' && s.label) && secs.body.sections.some(s => s.key === 'risk'), secs.body && secs.body.sections);

    // A2: owner create
    const create = await api('/api/cloud/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: PID, name: NAME }) });
    check('P2.1a owner create ok + owner code', create.status === 200 && create.body && create.body.ok === true && typeof create.body.ownerCode === 'string', create.text);
    const OC = create.body ? create.body.ownerCode : '';

    // A3: editor code create (owner) — scope wbs + bud
    const edCreate = await api('/api/cloud/projects/' + PID + '/editors', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC },
      body: JSON.stringify({ label: 'Site Super', scope: ['wbs', 'bud'] })
    });
    check('P2.1b editor code created with label + scope', edCreate.status === 200 && edCreate.body && edCreate.body.ok === true && typeof edCreate.body.editorCode === 'string' && edCreate.body.label === 'Site Super' && JSON.stringify(edCreate.body.scope) === JSON.stringify(['wbs', 'bud']), edCreate.text);
    const EC = edCreate.body ? edCreate.body.editorCode : '';
    const EDITOR_ID = edCreate.body ? edCreate.body.editorId : null;
    check('P2.1c editor code format XXXX-XXXX-XXXX-XXXX', /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/.test(EC), EC);

    // A4: D1 hash row — never plaintext.
    // Retry up to 3× with a short delay: the INSERT via the Worker's D1
    // binding may not be immediately visible to the out-of-process
    // node:sqlite reader (WAL read-visibility race — not yet root-caused,
    // but cheap to defend against). If all retries fail, log full
    // diagnostics so CI gives us the picture in one run.
    let edRows = null;
    for (let _attempt = 0; _attempt < 3; _attempt++) {
      edRows = queryD1('SELECT label, scope, code_salt, code_hash FROM cloud_editor_codes WHERE project_id = ' + q(PID));
      if (edRows && edRows.length > 0) break;
      log('P2.1d: row not visible on attempt ' + (_attempt + 1) + ', retrying in 200ms…');
      await delay(200);
    }
    const edRow = edRows && edRows[0];
    if (!edRow) {
      log('P2.1d DIAGNOSTIC (all retries exhausted): edCreate.body=' + JSON.stringify(edCreate.body));
      log('P2.1d DIAGNOSTIC: edRows=' + JSON.stringify(edRows));
      log('P2.1d DIAGNOSTIC: PID=' + PID);
    }
    check('P2.1d editor row stored with scope JSON', !!edRow && JSON.stringify(JSON.parse(edRow.scope)) === JSON.stringify(['wbs', 'bud']) && edRow.label === 'Site Super', edRow);
    const edSalt = edRow ? edRow.code_salt : '';
    const edHash = edRow ? edRow.code_hash : '';
    check('P2.1e editor salt/hash shapes (32/64 hex)', /^[0-9a-f]{32}$/.test(edSalt) && /^[0-9a-f]{64}$/.test(edHash), { edSalt, edHash: edHash.slice(0, 12) });
    check('P2.1f editor hash is NOT the plaintext code', edHash !== EC && edHash.indexOf(EC) === -1, edHash.slice(0, 12));
    let recomputed = '';
    try { recomputed = crypto.pbkdf2Sync(Buffer.from(EC, 'utf8'), Buffer.from(edSalt, 'utf8'), 100000, 32, 'sha256').toString('hex'); } catch (e) {}
    check('P2.1g PBKDF2 recompute matches stored editor hash', recomputed === edHash, recomputed.slice(0, 12) + ' vs ' + edHash.slice(0, 12));
    let plaintextOnDisk = [];
    const d1f = d1File();
    if (d1f) { try { if (fs.readFileSync(d1f).includes(Buffer.from(EC, 'utf8'))) plaintextOnDisk.push(d1f); } catch (e) {} }
    check('P2.1h editor code plaintext absent from D1 bytes', plaintextOnDisk.length === 0, plaintextOnDisk);

    // A5: list owner-only
    const edList = await api('/api/cloud/projects/' + PID + '/editors', { headers: { 'X-Owner-Code': OC } });
    check('P2.2a editor list (owner) returns the row without code fields', edList.status === 200 && edList.body && edList.body.ok === true && edList.body.editors.length === 1 && edList.body.editors[0].label === 'Site Super' && edList.body.editors[0].code_hash === undefined && edList.body.editors[0].scope.length === 2, edList.text);
    const edListNoAuth = await api('/api/cloud/projects/' + PID + '/editors');
    check('P2.2b editor list without auth -> generic 403', edListNoAuth.status === 403 && edListNoAuth.body && edListNoAuth.body.error === 'invalid project or owner code', edListNoAuth.text);
    const edListWrong = await api('/api/cloud/projects/' + PID + '/editors', { headers: { 'X-Owner-Code': 'AAAA-BBBB-CCCC-DDDD' } });
    check('P2.2c editor list with wrong owner code -> 403', edListWrong.status === 403, edListWrong.status);

    // A6: owner first save (no changelog row — first blob has nothing to diff)
    const save1 = await api('/api/cloud/projects/' + PID + '/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC },
      body: JSON.stringify({ state: state1 })
    });
    check('P2.4a owner first save ok (Phase 1 regression)', save1.status === 200 && save1.body && save1.body.ok === true && save1.body.actor === 'owner' && save1.body.changelog === undefined, save1.text);

    // A7: editor load — role + scope + state
    const edLoad = await api('/api/cloud/projects/' + PID + '/load', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Editor-Code': EC }, body: JSON.stringify({}) });
    check('P2.3a editor load returns role/editorLabel/scope', edLoad.status === 200 && edLoad.body && edLoad.body.ok === true && edLoad.body.role === 'editor' && edLoad.body.editorLabel === 'Site Super' && JSON.stringify(edLoad.body.scope) === JSON.stringify(['wbs', 'bud']), edLoad.text);
    check('P2.3b editor load returns the owner snapshot (charter + risks readable)', !!edLoad.body && edLoad.body.state && edLoad.body.state.charter.name === NAME && edLoad.body.state.risks[0].name === 'Risk One', edLoad.body && edLoad.body.state);

    // A8: editor save IN scope (wbs) — REVIEW QUEUE (2026-08-17, always on):
    // the save becomes a PENDING PROPOSAL — nothing applies until the owner
    // accepts. applied reports what the proposal WOULD change.
    const stateE = JSON.parse(JSON.stringify(state1));
    stateE.tasks[0].name = 'Edited by editor';
    const edSaveIn = await api('/api/cloud/projects/' + PID + '/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Editor-Code': EC },
      body: JSON.stringify({ state: stateE })
    });
    check('P2.4b editor in-scope save ok (review pending, actor editor)', edSaveIn.status === 200 && edSaveIn.body && edSaveIn.body.ok === true && edSaveIn.body.review === 'pending' && !!edSaveIn.body.reviewId && edSaveIn.body.actor === 'editor' && edSaveIn.body.editorLabel === 'Site Super', edSaveIn.text);
    check('P2.4c editor save reports would-be applied:["wbs"]', !!edSaveIn.body && Array.isArray(edSaveIn.body.applied) && edSaveIn.body.applied.indexOf('wbs') !== -1, edSaveIn.body && edSaveIn.body.applied);

    // A9: THE scope-enforcement check — editor tries to change risks too
    const stateH = JSON.parse(JSON.stringify(stateE));
    stateH.tasks[0].name = 'Edited again (WBS)';
    stateH.risks[0].name = 'HACKED out of scope';
    const edSaveOut = await api('/api/cloud/projects/' + PID + '/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Editor-Code': EC },
      body: JSON.stringify({ state: stateH })
    });
    check('P2.5a editor save that touches out-of-scope section still ok (proposal)', edSaveOut.status === 200 && edSaveOut.body && edSaveOut.body.ok === true && edSaveOut.body.review === 'pending', edSaveOut.text);
    check('P2.5b out-of-scope change reported as blocked:["risk"]', !!edSaveOut.body && Array.isArray(edSaveOut.body.blocked) && edSaveOut.body.blocked.indexOf('risk') !== -1 && edSaveOut.body.blocked.indexOf('charter') === -1, edSaveOut.body && edSaveOut.body.blocked);
    // REVIEW QUEUE: the blob does NOT move on an editor save. Verify tasks are
    // still the OWNER's seed — then accept the pending proposal and verify the
    // same scope-enforced merge the old direct-save path performed.
    const ownerLoad1 = await api('/api/cloud/projects/' + PID + '/load', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC }, body: JSON.stringify({}) });
    const blobPre = ownerLoad1.body && ownerLoad1.body.state;
    check('P2.5c REVIEW QUEUE: editor save did NOT move the blob yet', !!blobPre && blobPre.tasks[0].name === 'Task One', blobPre && blobPre.tasks);
    const accRes = await api('/api/cloud/projects/' + PID + '/reviews/' + edSaveOut.body.reviewId + '/accept', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC }, body: JSON.stringify({})
    });
    check('P2.5c2 owner accept ok (applied wbs)', accRes.status === 200 && accRes.body && accRes.body.ok === true && accRes.body.status === 'accepted' && accRes.body.applied.indexOf('wbs') !== -1, accRes.text);
    const ownerLoad1b = await api('/api/cloud/projects/' + PID + '/load', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC }, body: JSON.stringify({}) });
    const blobState = ownerLoad1b.body && ownerLoad1b.body.state;
    check('P2.5d server-side merge on accept: in-scope WBS change persisted', !!blobState && blobState.tasks[0].name === 'Edited again (WBS)', blobState && blobState.tasks);
    check('P2.5e server-side merge on accept: out-of-scope risk change NOT persisted', !!blobState && blobState.risks[0].name === 'Risk One', blobState && blobState.risks);
    check('P2.5f server-side merge on accept: other sections (charter) untouched', !!blobState && blobState.charter.name === NAME, blobState && blobState.charter);

    // A10: wrong/unknown/revoked editor codes -> identical generic 403
    const wrongEC = await api('/api/cloud/projects/' + PID + '/load', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Editor-Code': 'ZZZZ-ZZZZ-ZZZZ-ZZZZ' }, body: JSON.stringify({}) });
    const unkEC = await api('/api/cloud/projects/no-such-proj/load', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Editor-Code': EC }, body: JSON.stringify({}) });
    const wrongOC = await api('/api/cloud/projects/' + PID + '/load', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': 'AAAA-BBBB-CCCC-DDDD' }, body: JSON.stringify({}) });
    check('P2.6a wrong editor code -> 403', wrongEC.status === 403, wrongEC.status);
    check('P2.6b unknown project with valid editor code -> 403', unkEC.status === 403, unkEC.status);
    const b1 = JSON.stringify(wrongEC.body), b2 = JSON.stringify(unkEC.body), b3 = JSON.stringify(wrongOC.body);
    check('P2.6c editor-code failures share the SAME body as owner failures (no distinguisher)', b1 === b2 && b2 === b3, { b1, b3 });

    // A11: invalid scope filtering + empty scope
    const edBadScope = await api('/api/cloud/projects/' + PID + '/editors', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC },
      body: JSON.stringify({ label: 'Bad Scope', scope: ['wbs', 'bogus-panel'] })
    });
    check('P2.7a unknown scope keys filtered out (stored scope ["wbs"])', edBadScope.status === 200 && edBadScope.body && JSON.stringify(edBadScope.body.scope) === JSON.stringify(['wbs']), edBadScope.text);
    const edEmptyScope = await api('/api/cloud/projects/' + PID + '/editors', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC },
      body: JSON.stringify({ label: 'No Scope', scope: [] })
    });
    check('P2.7b empty scope -> 400', edEmptyScope.status === 400, edEmptyScope.text);

    // A12: editor first-save bootstrap (project B)
    const PIDB = 'qa-cloud2b-' + Date.now().toString(36);
    const createB = await api('/api/cloud/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: PIDB, name: 'B' }) });
    const OCB = createB.body ? createB.body.ownerCode : '';
    const edCreateB = await api('/api/cloud/projects/' + PIDB + '/editors', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OCB },
      body: JSON.stringify({ label: 'Editor B', scope: ['wbs'] })
    });
    const ECB = edCreateB.body ? edCreateB.body.editorCode : '';
    const stateB = { schemaVersion: 17, projectId: PIDB, projectName: 'B', tasks: [{ id: 't1', name: 'Bootstrapped', status: 'todo' }], risks: [{ id: 'r1', name: 'R' }], charter: { name: 'B' }, updatedAt: new Date().toISOString() };
    const edSaveB = await api('/api/cloud/projects/' + PIDB + '/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Editor-Code': ECB },
      body: JSON.stringify({ state: stateB })
    });
    // REVIEW QUEUE: even the FIRST save on a project with no snapshot is a
    // proposal — the owner accepts it, and only then is the blob created.
    check('P2.8a editor first save is a pending proposal (no blob yet)', edSaveB.status === 200 && edSaveB.body && edSaveB.body.ok === true && edSaveB.body.review === 'pending' && !!edSaveB.body.reviewId, edSaveB.text);
    const ownerLoadB0 = await api('/api/cloud/projects/' + PIDB + '/load', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OCB }, body: JSON.stringify({}) });
    check('P2.8b no blob before the owner accepts', ownerLoadB0.body && ownerLoadB0.body.state === null, ownerLoadB0.text);
    const accB = await api('/api/cloud/projects/' + PIDB + '/reviews/' + edSaveB.body.reviewId + '/accept', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OCB }, body: JSON.stringify({})
    });
    check('P2.8b2 owner accept bootstraps the blob', accB.status === 200 && accB.body && accB.body.ok === true, accB.text);
    const ownerLoadB = await api('/api/cloud/projects/' + PIDB + '/load', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OCB }, body: JSON.stringify({}) });
    const blobB = ownerLoadB.body && ownerLoadB.body.state;
    check('P2.8c editor-bootstrapped blob contains ONLY its scoped section (tasks)', !!blobB && blobB.tasks && blobB.tasks[0].name === 'Bootstrapped', blobB);
    check('P2.8d editor-bootstrapped blob does NOT carry out-of-scope keys', !!blobB && (blobB.risks === undefined) && (blobB.charter === undefined), blobB);

    // ==================================================================
    // PHASE B — changelog with revert
    // ==================================================================
    // B1: small owner edit -> field-level 'edit' entry. Base on the CURRENT
    // blob (post-accept — ownerLoad1b) so only charter.name changes — a stale
    // base would also overwrite the accepted WBS edit and split the entry.
    const state2 = JSON.parse(JSON.stringify(ownerLoad1b.body.state));
    state2.charter.name = NAME + '-v2';
    const save2 = await api('/api/cloud/projects/' + PID + '/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC },
      body: JSON.stringify({ state: state2 })
    });
    check('P3.1a small owner save returns changelog entry id + type edit', save2.status === 200 && save2.body && save2.body.changelog && save2.body.changelog.type === 'edit' && save2.body.changelog.id > 0, save2.text);
    const E1 = save2.body ? save2.body.changelog.id : null;
    let logRows = await queryD1Retry('SELECT id, entry_type, actor_type, actor_label, section, diffs_json FROM cloud_changelog WHERE project_id = ' + q(PID) + ' ORDER BY id DESC');
    const e1Row = logRows && logRows[0];
    let e1Diffs = null;
    try { if (e1Row && e1Row.diffs_json) e1Diffs = JSON.parse(e1Row.diffs_json); } catch (err) {}
    check('P3.1b changelog row is edit / owner with a single section', !!e1Row && e1Row.entry_type === 'edit' && e1Row.actor_type === 'owner' && e1Row.section === 'charter', e1Row);
    const charterDiff = e1Diffs && e1Diffs.find(d => d.path === 'charter.name');
    check('P3.1c field-level before/after recorded for charter.name', !!charterDiff && charterDiff.before === NAME && charterDiff.after === NAME + '-v2', e1Diffs);

    // B2: changelog list (owner) + no-auth 403
    const logList = await api('/api/cloud/projects/' + PID + '/changelog', { headers: { 'X-Owner-Code': OC } });
    check('P3.2a changelog list (owner) returns entries', logList.status === 200 && logList.body && logList.body.ok === true && Array.isArray(logList.body.entries) && logList.body.entries.length >= 1, logList.text);
    const logNoAuth = await api('/api/cloud/projects/' + PID + '/changelog');
    check('P3.2b changelog list without auth -> generic 403', logNoAuth.status === 403, logNoAuth.status);

    // B3: owner revert E1 -> blob restored + new revert entry
    const rev1 = await api('/api/cloud/projects/' + PID + '/changelog/' + E1 + '/revert', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC }, body: JSON.stringify({})
    });
    check('P3.2c owner revert ok, returns revert entry id', rev1.status === 200 && rev1.body && rev1.body.ok === true && rev1.body.revertEntryId > 0, rev1.text);
    const ownerLoad2 = await api('/api/cloud/projects/' + PID + '/load', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC }, body: JSON.stringify({}) });
    check('P3.2d blob restored to the before-value after revert', !!ownerLoad2.body.state && ownerLoad2.body.state.charter.name === NAME, ownerLoad2.body && ownerLoad2.body.state && ownerLoad2.body.state.charter);
    logRows = await queryD1Retry('SELECT id, entry_type, actor_type, actor_label, section, diffs_json FROM cloud_changelog WHERE project_id = ' + q(PID) + ' ORDER BY id DESC');
    check('P3.2e revert logged a NEW entry (history preserved)', !!logRows && logRows[0].entry_type === 'revert' && logRows[0].actor_type === 'owner' && logRows.length >= 2, logRows && logRows.map(r => r.entry_type));

    // B4: revert of the revert -> original change restored, another entry
    const revEntryId = logRows && logRows[0] ? logRows[0].id : null;
    const rev2 = await api('/api/cloud/projects/' + PID + '/changelog/' + revEntryId + '/revert', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC }, body: JSON.stringify({})
    });
    check('P3.2f revert-of-revert ok (every entry reversible)', rev2.status === 200 && rev2.body && rev2.body.ok === true, rev2.text);
    const ownerLoad3 = await api('/api/cloud/projects/' + PID + '/load', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC }, body: JSON.stringify({}) });
    check('P3.2g revert-of-revert restored the reverted change', !!ownerLoad3.body.state && ownerLoad3.body.state.charter.name === NAME + '-v2', ownerLoad3.body && ownerLoad3.body.state && ownerLoad3.body.state.charter);

    // B5: editor attribution via the review queue + no editor revert
    const edSaveAttr = await api('/api/cloud/projects/' + PID + '/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Editor-Code': EC },
      body: JSON.stringify({ state: stateE })
    });
    check('P3.3a editor save ok (pending review)', edSaveAttr.status === 200 && edSaveAttr.body && edSaveAttr.body.ok === true && edSaveAttr.body.review === 'pending' && !!edSaveAttr.body.reviewId, edSaveAttr.text);
    // Attribution: the proposal row carries the editor code label; accepting
    // logs the changelog 'accepted' entry (owner-decided) with the diffs.
    logRows = await queryD1Retry('SELECT source_label, status, editor_code_id FROM cloud_reviews WHERE project_id = ' + q(PID) + ' AND status = \'pending\' ORDER BY id DESC LIMIT 1');
    check('P3.3b proposal attributed to the editor code label', !!logRows && logRows[0].source_label === 'Site Super' && logRows[0].editor_code_id !== null, logRows && logRows[0]);
    const accAttr = await api('/api/cloud/projects/' + PID + '/reviews/' + edSaveAttr.body.reviewId + '/accept', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC }, body: JSON.stringify({})
    });
    check('P3.3c accept logs the accepted entry', accAttr.status === 200 && accAttr.body && accAttr.body.ok === true && accAttr.body.status === 'accepted', accAttr.text);
    logRows = await queryD1Retry('SELECT entry_type, actor_type, diffs_json FROM cloud_changelog WHERE project_id = ' + q(PID) + ' ORDER BY id DESC');
    check('P3.3d newest changelog entry is accepted with diffs', !!logRows && logRows[0].entry_type === 'accepted' && logRows[0].actor_type === 'owner' && !!logRows[0].diffs_json, logRows && logRows[0]);
    const editorRevokeAttempt = await api('/api/cloud/projects/' + PID + '/changelog/' + E1 + '/revert', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Editor-Code': EC }, body: JSON.stringify({})
    });
    check('P3.4a editor CANNOT revert -> generic 403', editorRevokeAttempt.status === 403 && editorRevokeAttempt.body && editorRevokeAttempt.body.error === 'invalid project or owner code', editorRevokeAttempt.text);
    const editorLogList = await api('/api/cloud/projects/' + PID + '/changelog', { headers: { 'X-Editor-Code': EC } });
    check('P3.4b editor CANNOT list the changelog -> generic 403', editorLogList.status === 403, editorLogList.text);

    // B6: bulk save (12 tasks -> many leaves) -> snapshot entry + revert.
    // The pre-bulk blob is given a unique marker in a NON-content key (config,
    // never diffed) so the harness can locate the snapshot object in the local
    // R2 emulation regardless of miniflare's key layout.
    const PRE_BULK_MARKER = 'pre-bulk-' + Date.now().toString(36);
    // Clone from a FRESH load so the marker save genuinely changes nothing
    // except the (non-diffable) config key — a stale base would diff against
    // the editor's latest save and create an unintended changelog row.
    const freshForMarker = await api('/api/cloud/projects/' + PID + '/load', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC }, body: JSON.stringify({}) });
    const stateWithMarker = JSON.parse(JSON.stringify(freshForMarker.body.state));
    stateWithMarker.config = { marker: PRE_BULK_MARKER };
    const saveMarker = await api('/api/cloud/projects/' + PID + '/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC },
      body: JSON.stringify({ state: stateWithMarker })
    });
    check('P3.5x pre-bulk marker save ok (config is not a diffable content key)', saveMarker.status === 200 && saveMarker.body && saveMarker.body.ok === true && saveMarker.body.changelog === undefined, saveMarker.text);
    const stateBig = JSON.parse(JSON.stringify(stateWithMarker));
    stateBig.tasks = [];
    for (let i = 0; i < 12; i++) stateBig.tasks.push({ id: 'big' + i, name: 'Bulk Task ' + i, status: 'todo', start: '2026-02-01', end: '2026-02-05', duration: 5, predecessors: [], milestone: false, note: 'n' + i });
    const saveBig = await api('/api/cloud/projects/' + PID + '/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC },
      body: JSON.stringify({ state: stateBig })
    });
    check('P3.5a bulk save returns changelog entry type bulk', saveBig.status === 200 && saveBig.body && saveBig.body.changelog && saveBig.body.changelog.type === 'bulk', saveBig.text);
    const bulkId = saveBig.body ? saveBig.body.changelog.id : null;
    logRows = await queryD1Retry('SELECT snapshot_key FROM cloud_changelog WHERE id = ' + bulkId, "changelog-read");
    const snapKey = logRows && logRows[0] ? logRows[0].snapshot_key : null;
    const snapBlob = snapKey ? findR2Blob(snapKey.split('/').pop(), PRE_BULK_MARKER) : null;
    check('P3.5b bulk entry references an R2 snapshot of the pre-change blob', !!snapKey && !!snapBlob, { snapKey, snap: snapBlob && snapBlob.path });
    const revBulk = await api('/api/cloud/projects/' + PID + '/changelog/' + bulkId + '/revert', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC }, body: JSON.stringify({})
    });
    check('P3.5c bulk revert ok', revBulk.status === 200 && revBulk.body && revBulk.body.ok === true, revBulk.text);
    const ownerLoad4 = await api('/api/cloud/projects/' + PID + '/load', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC }, body: JSON.stringify({}) });
    const blobAfterBulkRev = ownerLoad4.body && ownerLoad4.body.state;
    check('P3.5d bulk revert restored the snapshot (1 task, charter v2)', !!blobAfterBulkRev && Array.isArray(blobAfterBulkRev.tasks) && blobAfterBulkRev.tasks.length === 1 && blobAfterBulkRev.charter.name === NAME + '-v2', blobAfterBulkRev && { tasks: blobAfterBulkRev.tasks.length, charter: blobAfterBulkRev.charter && blobAfterBulkRev.charter.name });
    // revert the bulk revert -> 12 tasks again
    logRows = await queryD1Retry('SELECT id, snapshot_key FROM cloud_changelog WHERE project_id = ' + q(PID) + ' ORDER BY id DESC');
    const bulkRevId = logRows && logRows[0] ? logRows[0].id : null;
    const revBulk2 = await api('/api/cloud/projects/' + PID + '/changelog/' + bulkRevId + '/revert', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC }, body: JSON.stringify({})
    });
    check('P3.5e revert-of-bulk-revert ok', revBulk2.status === 200 && revBulk2.body && revBulk2.body.ok === true, revBulk2.text);
    const ownerLoad5 = await api('/api/cloud/projects/' + PID + '/load', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC }, body: JSON.stringify({}) });
    check('P3.5f revert-of-bulk-revert restored the 12-task state', !!ownerLoad5.body.state && ownerLoad5.body.state.tasks.length === 12, ownerLoad5.body && ownerLoad5.body.state && ownerLoad5.body.state.tasks.length);

    // B7: editor code revoked -> 403 on load + save
    const revoke = await api('/api/cloud/projects/' + PID + '/editors/' + EDITOR_ID, { method: 'DELETE', headers: { 'X-Owner-Code': OC } });
    check('P2.6d owner revoke ok', revoke.status === 200 && revoke.body && revoke.body.ok === true, revoke.text);
    const revokedLoad = await api('/api/cloud/projects/' + PID + '/load', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Editor-Code': EC }, body: JSON.stringify({}) });
    const revokedSave = await api('/api/cloud/projects/' + PID + '/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Editor-Code': EC }, body: JSON.stringify({ state: state1 })
    });
    check('P2.6e revoked editor code -> 403 on load', revokedLoad.status === 403, revokedLoad.status);
    check('P2.6f revoked editor code -> 403 on save', revokedSave.status === 403, revokedSave.status);

    // ==================================================================
    // PHASE E — real-browser editor flow (fresh-device unlock + scope UI)
    // ==================================================================
    const edCreate2 = await api('/api/cloud/projects/' + PID + '/editors', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC },
      body: JSON.stringify({ label: 'Field Editor', scope: ['wbs', 'risk'] })
    });
    check('P2.10x fresh editor code created for the UI run', edCreate2.status === 200 && edCreate2.body && edCreate2.body.ok === true, edCreate2.text);
    const EC2 = edCreate2.body ? edCreate2.body.editorCode : '';
    await phaseE(PID, EC2);

    // ==================================================================
    // PHASE C — admin cloud listing
    // ==================================================================
    const admOk = await api('/api/cloud/admin/projects', { headers: { 'X-Admin-Code': ADMIN_CODE } });
    check('P4.1a admin list with correct ADMIN_CODE -> 200 with our projects', admOk.status === 200 && admOk.body && admOk.body.ok === true && Array.isArray(admOk.body.projects) && admOk.body.projects.some(p => p.projectId === PID), admOk.text);
    const admRow = admOk.body && admOk.body.projects.find(p => p.projectId === PID);
    check('P4.1b admin row exposes label + snapshot state (no hashes/codes)', !!admRow && admRow.label === NAME && admRow.hasSnapshot === true && admRow.linkedName === null && admRow.ownerCodeHash === undefined, admRow);
    const admWrong = await api('/api/cloud/admin/projects', { headers: { 'X-Admin-Code': 'WRONG-CODE-123' } });
    check('P4.2a admin list with wrong code -> 403', admWrong.status === 403, admWrong.status);
    const admNone = await api('/api/cloud/admin/projects');
    check('P4.2b admin list without code -> 403', admNone.status === 403, admNone.status);

    // ==================================================================
    // PHASE D — 2026-08-10 gap-audit hardening (CORS, editor cap, unlink,
    // rate limiting). Added as PERMANENT gate coverage for the audit fixes.
    // ==================================================================
    // D1: CORS — a cross-origin request must be rejected with the explicit
    // message and NO Access-Control-Allow-Origin header ever emitted.
    const corsRes = await fetch(BASE + '/api/cloud/projects/' + PID + '/meta', { headers: { 'Origin': 'https://evil.example', 'X-Owner-Code': OC } });
    let corsBody = null;
    try { corsBody = await corsRes.json(); } catch (e) {}
    check('P5.1a cross-origin cloud request rejected (403, explicit message)', corsRes.status === 403 && corsBody && corsBody.error === 'cross-origin requests are not allowed', corsRes.status);
    check('P5.1b no Access-Control-Allow-Origin on the rejected response', corsRes.headers.get('Access-Control-Allow-Origin') === null, corsRes.headers.get('Access-Control-Allow-Origin'));
    const corsSame = await api('/api/cloud/projects/' + PID + '/meta', { headers: { 'Origin': BASE, 'X-Owner-Code': OC } });
    check('P5.1c same-origin Origin accepted', corsSame.status === 200 && corsSame.body.ok, corsSame.status);

    // D2: editor-code cap (fresh throwaway project so counts are clean).
    const PIDC = 'qa-gapcap-' + Date.now().toString(36);
    const createC = await api('/api/cloud/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: PIDC, name: 'Cap' }) });
    const OCC = createC.body ? createC.body.ownerCode : '';
    let capStatus = null;
    for (let i = 1; i <= 26; i++) {
      const r = await api('/api/cloud/projects/' + PIDC + '/editors', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OCC },
        body: JSON.stringify({ label: 'Cap ' + i, scope: ['wbs'] })
      });
      if (i === 26) capStatus = r;
    }
    check('P5.2 editor-code cap: 26th create rejected with the cap error', capStatus && capStatus.status === 400 && capStatus.body && capStatus.body.error.indexOf('too many active editor codes') !== -1, capStatus.text);

    // D3: owner-only unlink deletes the whole cloud copy (D1 rows + R2).
    const stU = { schemaVersion: 17, projectId: PIDC, projectName: 'Cap', tasks: [], risks: [], charter: { name: 'Cap' }, updatedAt: new Date().toISOString() };
    await api('/api/cloud/projects/' + PIDC + '/save', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OCC }, body: JSON.stringify({ state: stU }) });
    const unlink = await api('/api/cloud/projects/' + PIDC, { method: 'DELETE', headers: { 'X-Owner-Code': OCC } });
    check('P5.3a unlink ok (owner)', unlink.status === 200 && unlink.body && unlink.body.ok === true, unlink.text);
    const afterUnlink = await api('/api/cloud/projects/' + PIDC + '/load', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OCC }, body: JSON.stringify({}) });
    check('P5.3b load after unlink -> generic 403 (cloud copy gone)', afterUnlink.status === 403 && afterUnlink.body && afterUnlink.body.error === 'invalid project or owner code', afterUnlink.text);
    const unlinkRows = await queryD1Retry('SELECT COUNT(*) AS n FROM cloud_projects WHERE project_id = ' + q(PIDC));
    const unlinkEdRows = await queryD1Retry('SELECT COUNT(*) AS n FROM cloud_editor_codes WHERE project_id = ' + q(PIDC));
    check('P5.3c unlink removed D1 rows (project + editor codes)', unlinkRows && unlinkRows[0] && unlinkRows[0].n === 0 && unlinkEdRows && unlinkEdRows[0] && unlinkEdRows[0].n === 0, { unlinkRows, unlinkEdRows });
    const unlinkByEditor = await api('/api/cloud/projects/' + PID, { method: 'DELETE', headers: { 'X-Editor-Code': EC2 } });
    check('P5.3d an editor code cannot unlink (generic 403)', unlinkByEditor.status === 403 && unlinkByEditor.body && unlinkByEditor.body.error === 'invalid project or owner code', unlinkByEditor.text);

    // D4: rate limiting — a burst on ONE owner-code bucket trips 429 with a
    // Retry-After header. Run LAST (it consumes the bucket's budget).
    // Note: PID still exists, so authorized requests below the budget return
    // 200 — the property that matters is that valid usage is NOT throttled
    // until the burst actually exceeds the limit.
    let saw429 = false; let sawOk = false; let hasRetryAfter = false;
    for (let i = 1; i <= 140; i++) {
      const r = await fetch(BASE + '/api/cloud/projects/' + PID + '/meta', { headers: { 'X-Owner-Code': OC } });
      if (r.status === 200) sawOk = true;
      if (r.status === 429 && !saw429) { saw429 = true; hasRetryAfter = !!r.headers.get('Retry-After'); }
      if (saw429 && i > 100) break;
    }
    check('P5.4a burst trips 429 with a Retry-After header', saw429 === true && hasRetryAfter === true, { saw429, hasRetryAfter });
    check('P5.4b authorized requests below the budget are not throttled', sawOk === true, { sawOk });

    // Phase 1 regression within the same run: identical generic 403s on owner paths
    const metaNoAuth = await api('/api/cloud/projects/' + PID + '/meta');
    const metaUnknown = await api('/api/cloud/projects/nope-xyz/meta');
    check('P1.regress meta unknown project -> 403 (no existence leak)', metaUnknown.status === 403 && JSON.stringify(metaUnknown.body) === JSON.stringify(metaNoAuth.body), metaUnknown.text);

    // Owner code plaintext still never in dev logs
    check('P2.1i owner code absent from wrangler dev logs', OC === '' || devLog.indexOf(OC) === -1, 'found in dev log');
    check('P2.1j editor code absent from wrangler dev logs', EC === '' || devLog.indexOf(EC) === -1, 'found in dev log');
  } catch (e) {
    check('harness crashed', false, e.message);
  } finally {
    stopWrangler();
  }

  const failed = results.filter(r => !r.val);
  log('──────────────────────────────────────────────');
  log('CLOUD_PHASE2 ' + (failed.length === 0 ? 'PASS (' + results.length + '/' + results.length + ' checks)' : 'FAIL (' + failed.length + '/' + results.length + ' broken)'));
  failed.forEach(r => log('  broken: ' + r.name));
  process.exit(failed.length === 0 ? 0 : 1);
})().catch(e => { log('FATAL: ' + e.message); try { stopWrangler(); } catch (err) {} process.exit(1); });
