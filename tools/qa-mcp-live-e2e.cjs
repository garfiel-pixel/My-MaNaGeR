/* ============================================================
   qa-mcp-live-e2e — MCP propose -> owner review accept, END TO END
   ------------------------------------------------------------
   Born as the owner's live-browser probe (tmp/e2e-mcp-accept.cjs,
   2026-09-25) that verified the full MCP -> review-queue flow on
   production and found the MCP-badge mislabel (v318). Promoted to
   a permanent harness (owner directive, same day).

   Gates:
     A1-A7   API: create throwaway project, seed snapshot, mint a
             scoped sk-mmgr- key, MCP initialize + apply_changes ->
             proposal queued, cloud state UNCHANGED before accept,
             proposal visible in the review queue.
     B0-B5   Real headless Chrome on the local Worker: access-gate
             seeding, owner-code cloud section, MCP AI badge, REAL
             Accept click applies (status + row), duplicate
             proposal -> zero-diff accept warns 'nothing left to
             apply' (v318 contract, no false success).
     C1-C6   Cloud state carries the change, changelog logged, key
             revoked (refuses calls, no data leak), project deleted,
             meta refuses afterwards.

   SELF-CONTAINED (T3 pattern, like verify-cloud-autosave-signin):
   spawns its own wrangler dev (own port + persist dir OUTSIDE the
   repo - AGENTS lesson 11) and its own headless Chrome. It NEVER
   targets production: the base URL is always the spawned server,
   there is no override that can point it at a live site.

   MMGR_QA_NO_BROWSER=1 skips the browser phase (API-only run).

   Run: node tools/qa-mcp-live-e2e.cjs
   ============================================================ */
'use strict';
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = parseInt(process.env.MMGR_E2E_PORT || '8833', 10);
const BASE = 'http://127.0.0.1:' + PORT; // always local - never a live site
const PERSIST_DIR = path.join(os.tmpdir(), 'mmgr-e2e-wstate-' + Date.now());

// Distinct debug port so the harness never fights an interactive session's
// Chrome (chrome-launcher defaults to 9228).
process.env.CHROME_DEBUG_PORT = process.env.CHROME_DEBUG_PORT || '9333';
const { chromePath: CHROME, DEBUG_PORT } = require('./chrome-launcher.cjs');

const PID = 'e2e-mcp-' + Math.random().toString(36).slice(2, 8);
const KEY_LABEL = 'qa-mcp-live-e2e';
const SCOPE = ['wbs'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = s => process.stdout.write('[e2e] ' + s + '\n');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; log('PASS  ' + name); }
  else { fail++; log('FAIL  ' + name + (detail !== undefined ? '  => ' + JSON.stringify(detail).slice(0, 300) : '')); }
}

// ---- shared cleanup state (guaranteed via finally) ----
let wranglerProc = null;
let chromeProc = null;
let OC = null;      // owner code once minted
let KEY_ID = null;  // api key row id once minted
let userDir = null;
let cleaned = false;

async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  // The throwaway project must never survive a crashed run: best-effort
  // delete with whatever credentials we hold.
  if (OC && PID) {
    try { await api('POST', '/api/cloud/projects/' + PID + '/delete', {}, ownerH(OC)); } catch (e) { /* server may be gone */ }
  }
  if (chromeProc) { try { chromeProc.kill(); } catch (e) {} }
  if (wranglerProc) { try { wranglerProc.kill(); } catch (e) {} }
  try { fs.rmSync(PERSIST_DIR, { recursive: true, force: true }); } catch (e) {}
  if (userDir) { try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) {} }
}

async function api(method, p, body, headers) {
  const res = await fetch(BASE + p, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
const ownerH = code => ({ 'X-Owner-Code': code });
const keyH = key => ({ 'Authorization': 'Bearer ' + key });

async function mcp(key, method, params, id) {
  const r = await api('POST', '/api/mcp/' + PID, { jsonrpc: '2.0', id: id || 1, method, params: params || {} }, keyH(key));
  return r.data;
}

// ---- wrangler lifecycle (self-contained, T3 pattern) ----
const WRANGLER_JS = (function () {
  const local = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  if (fs.existsSync(local)) return local;
  try { return execFileSync(process.execPath, ['npm', 'root', '-g'], { encoding: 'utf8' }).trim() + '/wrangler/bin/wrangler.js'; } catch (e) {}
  return local;
})();

async function startWrangler() {
  log('starting wrangler dev on :' + PORT + ' (persist outside repo: ' + PERSIST_DIR + ')');
  try {
    execFileSync(process.execPath, [WRANGLER_JS, 'd1', 'migrations', 'apply', 'my-manager-db', '--local', '--config', 'wrangler.ci.jsonc', '--persist-to', PERSIST_DIR], { cwd: ROOT, stdio: 'ignore' });
  } catch (e) { /* migrations may already be applied in this fresh dir */ }
  wranglerProc = spawn(process.execPath, [WRANGLER_JS, 'dev', '--config', 'wrangler.ci.jsonc', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', PERSIST_DIR], {
    cwd: ROOT, stdio: 'ignore',
    env: Object.assign({}, process.env, { ADMIN_CODE: 'QA-E2E-ADMIN' })
  });
  wranglerProc.on('error', (e) => { log('wrangler spawn error: ' + e.message); });
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(BASE + '/api/health');
      if (r.ok) { log('wrangler ready on :' + PORT); return; }
    } catch (e) {}
    await sleep(2000);
  }
  throw new Error('wrangler dev did not come up in 80s');
}

async function main() {
  await startWrangler();

  // ---------- PHASE A: API ----------
  const cr = await api('POST', '/api/cloud/projects', { projectId: PID, name: 'E2E MCP Probe' });
  check('A1 create throwaway project (anonymous create contract)', cr.status === 200 && cr.data.ok && typeof cr.data.ownerCode === 'string', cr);
  OC = cr.data.ownerCode;
  if (!OC) throw new Error('cannot continue without owner code');

  const seedState = {
    schemaVersion: 19, projectId: PID, projectName: 'E2E MCP Probe', updatedAt: new Date().toISOString(),
    tasks: [{ id: 't1', name: 'Pour slab', status: 'inprogress', startDate: '2026-09-01', endDate: '2026-09-10' }],
    risks: [], budgetLines: [], spendLog: [], fieldTs: {}
  };
  await sleep(1200);
  const sv = await api('POST', '/api/cloud/projects/' + PID + '/save', { state: seedState }, ownerH(OC));
  check('A2 owner save seeds the snapshot', sv.status === 200 && sv.data.ok, sv);

  await sleep(1200);
  const km = await api('POST', '/api/cloud/projects/' + PID + '/api-keys', { label: KEY_LABEL, scope: SCOPE }, ownerH(OC));
  check('A3 mint scoped API key (shown once)', km.status === 200 && km.data.ok && /^sk-mmgr-/.test(km.data.apiKey || ''), km);
  const KEY = km.data.apiKey;
  KEY_ID = km.data.keyId;
  if (!KEY) throw new Error('cannot continue without api key');

  await sleep(800);
  const init = await mcp(KEY, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'qa-mcp-live-e2e' } }, 1);
  check('A4 MCP initialize with Bearer key -> serverInfo', !!(init.result && init.result.serverInfo && init.result.serverInfo.name === 'my-manager-mcp'), init);

  await sleep(800);
  const ap = await mcp(KEY, 'tools/call', { name: 'apply_changes', arguments: {
    diffs: [{ path: 'tasks', recordId: 't1', field: 'status', after: 'completed' }],
    label: 'e2e: mark Pour slab completed'
  } }, 2);
  const apText = ap.result && ap.result.content && ap.result.content[0] && ap.result.content[0].text || '';
  check('A5 MCP apply_changes -> queued for owner review', ap.result && !ap.result.isError && /Queued 1 field change/.test(apText), apText);

  await sleep(1200);
  const preLoad = await api('POST', '/api/cloud/projects/' + PID + '/load', {}, ownerH(OC));
  const preStatus = preLoad.data && preLoad.data.state && preLoad.data.state.tasks && preLoad.data.state.tasks[0] && preLoad.data.state.tasks[0].status;
  check('A6 cloud state UNCHANGED before accept (never auto-applied)', preStatus === 'inprogress', preStatus);

  const rl = await api('GET', '/api/cloud/projects/' + PID + '/reviews', undefined, ownerH(OC));
  const pending = (rl.data.proposals || []).filter(p => p.status === 'pending');
  check('A7 review queue lists the pending MCP proposal', rl.status === 200 && pending.length === 1 && pending[0].sourceType === 'api', pending);

  // ---------- PHASE B: real browser (skippable for API-only runs) ----------
  if (process.env.MMGR_QA_NO_BROWSER === '1') {
    log('MMGR_QA_NO_BROWSER=1 - skipping the browser phase (A + C gates only)');
  } else {
    // PRE-FLIGHT (AGENTS lesson 1 discipline): a stale headless Chrome may
    // already own the debug port - our spawn would silently lose it and
    // every CDP call would talk to the OLD profile. Inspect, fail loudly,
    // never kill by image name.
    let portOwner = null;
    try { const v = await fetch('http://127.0.0.1:' + DEBUG_PORT + '/json/version'); if (v.ok) portOwner = await v.json(); } catch (e) {}
    if (portOwner) {
      log('DEBUG PORT ' + DEBUG_PORT + ' already owned: ' + JSON.stringify(portOwner.Browser || portOwner));
      check('B0 debug port free before spawn', false, portOwner);
      throw new Error('debug port ' + DEBUG_PORT + ' busy - inspect the owning PID, never kill by image name');
    }
    check('B0 debug port free before spawn', true);

    userDir = path.join(os.tmpdir(), 'chrome-e2e-mcp-' + Date.now());
    chromeProc = spawn(CHROME, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-sandbox', '--disk-cache-size=0',
      '--remote-allow-origins=*', '--remote-debugging-port=' + DEBUG_PORT,
      '--user-data-dir=' + userDir, '--window-size=1280,900', 'about:blank'
    ], { stdio: 'ignore' });

    const pageLogs = [];
    let ws = null;
    let send = null;
    let ev = null;
    try {
      for (let i = 0; i < 60; i++) {
        try { const r = await fetch('http://127.0.0.1:' + DEBUG_PORT + '/json/version'); if (r.ok) break; } catch (e) {}
        await sleep(300);
      }
      const targets = await (await fetch('http://127.0.0.1:' + DEBUG_PORT + '/json')).json();
      ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
      const pendingMsgs = new Map();
      let mid = 0;
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.id && pendingMsgs.has(m.id)) { pendingMsgs.get(m.id)(m); pendingMsgs.delete(m.id); }
        // Auto-accept window.confirm (the real Accept button calls confirm())
        if (m.method === 'Page.javascriptDialogOpening') {
          ws.send(JSON.stringify({ id: 900000 + (++mid), method: 'Page.handleJavaScriptDialog', params: { accept: true } }));
        }
        if (m.method === 'Runtime.exceptionThrown') log('PAGE EXCEPTION: ' + JSON.stringify(m.params && m.params.exceptionDetails && m.params.exceptionDetails.exception || {}).slice(0, 200));
        if (m.method === 'Runtime.consoleAPICalled') {
          pageLogs.push((m.params.type || 'log') + ': ' + (m.params.args || []).map(a => a.value !== undefined ? String(a.value) : (a.description || a.type || '')).join(' '));
          if (pageLogs.length > 60) pageLogs.shift();
        }
        if (m.method === 'Log.entryAdded') {
          pageLogs.push('log:' + (m.params.entry && m.params.entry.source || '') + ': ' + (m.params.entry && m.params.entry.text || '').slice(0, 200));
          if (pageLogs.length > 60) pageLogs.shift();
        }
      };
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws fail')); });
      send = (method, params = {}) => new Promise(res => { const i = ++mid; pendingMsgs.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
      ev = async expr => {
        const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
        return r.result && r.result.result ? r.result.result.value : undefined;
      };
      await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');

      // First navigation hits the client Access Gate (mmgr-app.js checkAccess:
      // no mmgr_unlocked_<pid> -> bounce to app.html?locked=<pid>). Seed the
      // locally-owned record + unlock flag on whatever page we landed on
      // (same origin), then re-navigate - isLocallyOwned() then grants full
      // scope with no code re-entry. Same pattern verify-cloud-autosave uses.
      await send('Page.navigate', { url: BASE + '/project.html?id=' + PID });
      await sleep(2500);
      await ev(`(function(){
        localStorage.setItem('mmgr_admin_projects', JSON.stringify([{ id: '${PID}', title: 'E2E MCP Probe', description: '', status: 'active', file: 'project.html?id=${PID}' }]));
        localStorage.setItem('mmgr_unlocked_${PID}', '1');
        localStorage.setItem('mmgr_state_${PID}', JSON.stringify({ projectName: 'E2E MCP Probe', schemaVersion: 19, projectId: '${PID}', tasks: [{ id: 't1', name: 'Pour slab', status: 'inprogress' }] }));
      })()`);
      await send('Page.navigate', { url: BASE + '/project.html?id=' + PID });
      let cloudReady = null;
      for (let i = 0; i < 80; i++) {
        cloudReady = await ev(`(function(){ try { return { cloud: !!(window.MMGR && window.MMGR.Cloud && window.MMGR.CloudReview), ready: document.readyState, href: location.href }; } catch (e) { return { cloud: false, err: String(e) }; } })()`);
        if (cloudReady && cloudReady.cloud) break;
        await sleep(750);
      }
      if (!(cloudReady && cloudReady.cloud)) {
        log('B1 DIAGNOSTICS: last console/page logs:');
        for (const l of pageLogs.slice(-15)) log('  | ' + l);
        log('  | document: ' + JSON.stringify(await ev('({ ready: document.readyState, href: location.href, hasMMGR: !!window.MMGR, scripts: document.scripts.length })')));
      }
      check('B1 project page loads with cloud modules (CSP intact)', !!(cloudReady && cloudReady.cloud), cloudReady);

      // Hold the owner code + local state, render the real drawer.
      const b2 = await ev(`(async function(){
        try {
          sessionStorage.setItem('mmgr_cloud_code_${PID}', ${JSON.stringify(OC)});
          localStorage.setItem('mmgr_state_${PID}', JSON.stringify({ projectName: 'E2E MCP Probe', schemaVersion: 19, projectId: '${PID}', tasks: [{ id: 't1', name: 'Pour slab', status: 'inprogress' }] }));
          await window.MMGR.Cloud.render();
          return { hasList: !!document.getElementById('cloud-review-list') };
        } catch (e) { return { threw: String(e && e.message || e) }; }
      })()`);
      check('B2 owner code held -> cloud section renders with review list', b2 && b2.hasList, b2);

      // Populate the queue through the module (the Refresh button's own path).
      const b3 = await ev(`(async function(){
        try { await window.MMGR.CloudReview.cloudReviewList(); await new Promise(r => setTimeout(r, 400));
          return { rows: document.querySelectorAll('#cloud-review-list .sr').length,
            acceptBtns: document.querySelectorAll('#cloud-review-list [data-action="cloudReviewAccept"]').length,
            badge: !!document.querySelector('#cloud-review-list .badge-ai') };
        } catch (e) { return { threw: String(e && e.message || e) }; }
      })()`);
      check('B3 queue shows the MCP proposal with an Accept button + AI badge', b3 && b3.rows >= 1 && b3.acceptBtns === 1 && b3.badge, b3);

      // B3b: queue a SECOND proposal for the SAME change while the task is
      // still inprogress. The server refuses a propose whose merge applies
      // zero diffs AT PROPOSE TIME, so a zero-diff ACCEPT needs the state to
      // move between propose and accept - B4's accept does exactly that,
      // leaving the duplicate with nothing left to apply.
      const dup = await mcp(KEY, 'tools/call', { name: 'apply_changes', arguments: {
        diffs: [{ path: 'tasks', recordId: 't1', field: 'status', after: 'completed' }],
        label: 'e2e: duplicate proposal (zero-diff accept probe)'
      } }, 4);
      check('B3b duplicate proposal queued while state is pre-accept', !!(dup.result && !dup.result.isError && /Queued 1 field change/.test((dup.result.content && dup.result.content[0] && dup.result.content[0].text) || '')), dup.result);

      // Click the REAL Accept button (full UI path incl. confirm + status).
      // Two pending rows now: list orders pending first, newest id first, so
      // this click takes ONE of them; B5 takes the other.
      const b4 = await ev(`(async function(){
        try {
          const btn = document.querySelector('#cloud-review-list [data-action="cloudReviewAccept"]');
          if (!btn) return { noBtn: true };
          btn.click();
          await new Promise(r => setTimeout(r, 2500));
          const status = (document.getElementById('cloud-status') || {}).textContent || '';
          const acceptLeft = document.querySelectorAll('#cloud-review-list [data-action="cloudReviewAccept"]').length;
          return { status: status, acceptedShown: /Accepted/.test(status), acceptLeft: acceptLeft };
        } catch (e) { return { threw: String(e && e.message || e) }; }
      })()`);
      check('B4 Accept click applies -> status says Accepted, one row left', b4 && b4.acceptedShown && b4.acceptLeft === 1, b4);

      // B5 (v318): accept the duplicate - the change is already applied, the
      // merge finds zero diffs, the server answers ok:true with NO savedAt,
      // and the v318 contract must WARN 'nothing left to apply' in the
      // status line (a false success message would be a regression).
      const b5 = await ev(`(async function(){
        try {
          await window.MMGR.CloudReview.cloudReviewList();
          await new Promise(r => setTimeout(r, 500));
          const btn = document.querySelector('#cloud-review-list [data-action="cloudReviewAccept"]');
          if (!btn) return { noBtn: true };
          btn.click();
          await new Promise(r => setTimeout(r, 2500));
          const status = (document.getElementById('cloud-status') || {}).textContent || '';
          const acceptLeft = document.querySelectorAll('#cloud-review-list [data-action="cloudReviewAccept"]').length;
          return { status: status, warned: /nothing left to apply/.test(status), acceptLeft: acceptLeft };
        } catch (e) { return { threw: String(e && e.message || e) }; }
      })()`);
      check('B5 zero-diff accept warns nothing-left-to-apply (no false success)', b5 && b5.warned && b5.acceptLeft === 0, b5);

    } catch (e) {
      check('BROWSER PHASE', false, String(e && e.stack || e));
    } finally {
      try { ws && ws.close(); } catch (e) {}
      if (chromeProc) { try { chromeProc.kill(); } catch (e) {} chromeProc = null; }
    }
  }

  // ---------- PHASE C: verify + cleanup ----------
  const noBrowser = process.env.MMGR_QA_NO_BROWSER === '1';
  await sleep(1500);
  const postLoad = await api('POST', '/api/cloud/projects/' + PID + '/load', {}, ownerH(OC));
  const postStatus = postLoad.data && postLoad.data.state && postLoad.data.state.tasks && postLoad.data.state.tasks[0] && postLoad.data.state.tasks[0].status;
  if (noBrowser) {
    // API-only mode: nothing ever accepted, so the meaningful contract is
    // the PERSISTENT never-auto-apply guarantee + an unconsumed queue.
    check('C1 (api-only) cloud state STILL unchanged at the end (never auto-applied)', postStatus === 'inprogress', postStatus);
    const rl2 = await api('GET', '/api/cloud/projects/' + PID + '/reviews', undefined, ownerH(OC));
    // The duplicate proposal (B3b) is browser-phase setup, so exactly ONE
    // proposal exists in api-only mode (A5's). The point: NOTHING consumed
    // it - the queue is intact, the row is still pending.
    const stillPending = (rl2.data.proposals || []).filter(p => p.status === 'pending').length;
    check('C2 (api-only) the proposal is still pending (nothing consumed server-side)', stillPending === 1, stillPending);
  } else {
    check('C1 accepted change IS in the cloud state (status completed)', postStatus === 'completed', postStatus);
    const cl = await api('GET', '/api/cloud/projects/' + PID + '/changelog', undefined, ownerH(OC));
    const entries = cl.data.entries || cl.data.log || [];
    const acc = entries.find(e => e.entryType === 'accepted' || e.type === 'accepted' || e.entry_type === 'accepted');
    check('C2 changelog carries the accepted entry', !!acc, entries.slice(0, 2));
  }

  if (KEY_ID) {
    const rk = await api('DELETE', '/api/cloud/projects/' + PID + '/api-keys/' + KEY_ID, undefined, ownerH(OC));
    check('C3 API key revoked', rk.status === 200 && rk.data.ok, rk);
    await sleep(800);
    const dead = await mcp(KEY, 'tools/call', { name: 'get_tasks', arguments: {} }, 3);
    const deadErr = dead.result && dead.result.isError === true;
    const deadLeak = JSON.stringify(dead.result || {}).indexOf('Pour slab') !== -1;
    check('C4 revoked key refuses tool calls, no data leak', deadErr && !deadLeak, dead);
  }
  await sleep(800);
  const del = await api('POST', '/api/cloud/projects/' + PID + '/delete', {}, ownerH(OC));
  check('C5 throwaway project deleted', del.status === 200 && del.data.ok, del);
  await sleep(800);
  const gone = await api('GET', '/api/cloud/projects/' + PID + '/meta', undefined, ownerH(OC));
  check('C6 project gone (meta refuses)', gone.status === 403 || gone.status === 404 || (gone.data && gone.data.ok === false), gone);
}

(async () => {
  // Watchdog: cleanup then die (unref so a normal exit is never held up).
  const wd = setTimeout(() => { log('WATCHDOG TIMEOUT'); cleanup().then(() => process.exit(2)); }, 420000);
  wd.unref();
  try {
    await main();
  } catch (e) {
    log('HARNESS ERROR: ' + (e && e.stack || e));
    fail++;
  } finally {
    await cleanup();
    log('========================================');
    log('QA-MCP-LIVE-E2E RESULT: ' + pass + ' passed, ' + fail + ' failed  (project ' + PID + ')');
    process.exit(fail ? 1 : 0);
  }
})();
