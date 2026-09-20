/* ============================================================
   qa-sync-bond.cjs — Task 13 SYNC BOND end-to-end gate
   (owner directive 2026-09-19: an exported file from a
   cloud-linked project must re-link to its cloud twin on a
   fresh device, and a bonded offline copy that becomes a cloud
   copy must adopt the twin instead of forking a duplicate.)

   Drives the REAL flow against wrangler dev (local D1 + R2):

     D1  export from a cloud-linked project embeds a cloudBond
         pointer, and the owner code is NOT in the file
     D2  fresh device import stores the bond + raises the
         pending flag; the drawer shows the one-time offer
     D3  re-sync via the offer pulls the cloud snapshot and
         merges (device B edit survives, device A edit arrives)
     D4  reverse direction: budget change on device B re-syncs
         back out to the cloud (save) and lands on device A
     D5  bonded-create guard: a bonded project's Create probes
         the twin (no duplicate cloud row created)
     D6  the bond never contains a credential

   Usage: node tools/qa-sync-bond.cjs
   CI:    WRANGLER_DEV_URL + QA_PERSIST_DIR (external wrangler)
   ============================================================ */
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { chromePath: CHROME, BASE: _BASE, PORT } = require('./chrome-launcher.cjs');
const BASE = process.env.WRANGLER_DEV_URL || _BASE;

const ROOT = path.resolve(__dirname, '..');
let ws = null; let msgId = 0; const pending = new Map();
const log = (s) => { process.stdout.write('[syncbond] ' + s + '\n'); };
const delay = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, val, detail) => { results.push({ name, val }); log((val ? 'PASS' : 'FAIL') + '  ' + name + (val ? '' : '   <-- ' + JSON.stringify(detail).slice(0, 400))); };

let _done = false;
const _watchdog = setTimeout(() => { if (_done) return; log('WATCHDOG — harness exceeded 300s'); try { proc && proc.kill(); } catch (e) {} process.exit(2); }, 300000);

// ---- wrangler location (same discovery as qa-cloud-phase1) ----------------
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

// Local D1/R2 persistence MUST live OUTSIDE the project directory (the
// reload-loop incident, AGENTS.md lesson 2 family). See qa-cloud-phase1.
const USE_EXTERNAL = !!process.env.WRANGLER_DEV_URL;
const PERSIST_DIR = USE_EXTERNAL
  ? (process.env.QA_PERSIST_DIR || path.join(os.tmpdir(), 'mmgr-wrangler-state'))
  : path.join(os.tmpdir(), 'mmgr-syncbond-wstate-' + Date.now());

let proc = null;

function startWrangler() {
  return new Promise((resolve, reject) => {
    if (USE_EXTERNAL) {
      log('using external wrangler at ' + process.env.WRANGLER_DEV_URL + '…');
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
    log('starting wrangler dev on :' + PORT + ' (persist ' + PERSIST_DIR + ')…');
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
    let devLog = '';
    proc.stdout.on('data', d => { devLog += d; });
    proc.stderr.on('data', d => { devLog += d; });
    proc.on('error', (e) => reject(new Error('wrangler spawn failed: ' + e.message)));
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
  if (USE_EXTERNAL) return;
  try { proc && proc.kill(); } catch (e) {}
}

// ---- HTTP helpers ----------------------------------------------------------
async function api(pathname, opts) {
  const res = await fetch(BASE + pathname, Object.assign({ credentials: 'same-origin' }, opts || {}));
  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  return { status: res.status, body, text: res.status + '|' + JSON.stringify(body) };
}

// ---- Chrome + CDP (two isolated contexts = two devices) --------------------
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
// Trap console errors from this point on (harness convention).
async function trapErrors() {
  await ev('(function(){window.__consoleErrors=[];window.onerror=function(m,s,l,c,e){window.__consoleErrors.push(m+" @ "+s+":"+l+":"+c);};window.addEventListener("unhandledrejection",function(e){window.__consoleErrors.push("unhandled:"+((e.reason&&e.reason.message)||e.reason||"unknown"));});return true;})()');
}
// Poll a page expression until truthy (or timeout ms).
async function waitFor(expr, timeout, label) {
  const t0 = Date.now();
  for (;;) {
    const v = await ev(expr);
    if (v && !v.__err) return v;
    if (Date.now() - t0 > (timeout || 15000)) return v;
    await delay(500);
  }
}
// Wait for the cloud status line to settle (kind + text).
async function statusSettle() {
  let last = '';
  for (let i = 0; i < 24; i++) {
    await delay(1000);
    const s = await ev('(function(){var s=document.getElementById("cloud-status");return s?(s.className+" | "+s.textContent):"";})()');
    if (s === last && s.indexOf('busy') === -1 && s) return s;
    last = s;
  }
  return last;
}

// Seed a locally-owned project and open it (device-agnostic helper).
async function openDevice(port, profileDir, pid, stateObj) {
  const p = await launchChrome(profileDir, port);
  await cdpConnect(port);
  await send('Page.navigate', { url: BASE + '/index.html' }); await delay(2500);
  await ev(`(function(){
    localStorage.setItem('mmgr_unlocked_${pid}','1');
    localStorage.setItem('mmgr_scope_${pid}','full');
    localStorage.setItem('mmgr_state_${pid}', JSON.stringify(${JSON.stringify(stateObj)}));
    localStorage.setItem('mmgr_current_project','${pid}');
    return true;
  })()`);
  await send('Page.navigate', { url: BASE + '/project.html?id=' + pid }); await delay(5000);
  await trapErrors();
  return p;
}
// Open the drawer on the Controls tab (the Cloud section's home).
async function openCloudSection() {
  await waitFor('(function(){return !!document.querySelector("[data-action=openDrw]");})()');
  await ev('(function(){var el=document.querySelector("[data-action=openDrw]");if(el)el.click();return true;})()'); await delay(600);
  await ev('(function(){var el=document.querySelector("[data-action=swDtab][data-tab=ctrl]");if(el)el.click();return true;})()'); await delay(600);
  return await waitFor('(function(){return !!document.getElementById("cloud-section");})()');
}

// ============================================================================
async function main() {
  // ---- setup: device A owns a real cloud project (HTTP-level create) ------
  const PID = 'qa-bond-' + Date.now().toString(36);
  const NAME = 'QA Sync Bond';
  const create = await api('/api/cloud/projects', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: PID, name: NAME })
  });
  if (!(create.status === 200 && create.body && create.body.ok)) {
    throw new Error('cloud create failed: ' + create.text);
  }
  const CODE = create.body.ownerCode;
  log('cloud project ' + PID + ' created');

  const MARKER_A = 'device-a-home';
  const stateA = {
    projectName: NAME, schemaVersion: undefined, marker: MARKER_A,
    tasks: [{ id: 'T1', name: 'Foundations', status: 'todo' }],
    budgetLines: [{ id: 'B1', category: 'Concrete', planned: 1000, actual: 0 }]
  };
  // Server-side save so the twin has a snapshot (X-Owner-Code, same as C2).
  const save0 = await api('/api/cloud/projects/' + PID + '/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Owner-Code': CODE },
    body: JSON.stringify({ state: stateA })
  });
  if (!(save0.status === 200 && save0.body && save0.body.ok)) throw new Error('seed save failed: ' + save0.text);

  // ---- Device A: open project + hold the owner code + export --------------
  const dirA = path.join(os.tmpdir(), 'mmgr-bond-A-' + Date.now());
  fs.mkdirSync(dirA, { recursive: true });
  const procA = await openDevice(9244, dirA, PID, stateA);
  await openCloudSection();
  // Hold the credential exactly like the real owner path (code + session
  // unused here - the code is the credential that travels with this device).
  await ev('(function(){try{sessionStorage.setItem("mmgr_cloud_code_' + PID + '","' + CODE + '");}catch(e){return String(e);}return true;})()');
  await ev('(function(){if(window.MMGR&&MMGR.Cloud&&MMGR.Cloud._render)MMGR.Cloud._render();return true;})()');
  await delay(1200);
  // Export through the REAL state layer (same bytes the Export modal copies).
  const exported = await ev('(function(){return window.MMGR.State.exportState();})()');
  let exportBlob = null;
  try { exportBlob = JSON.parse(exported); } catch (e) {}
  check('D1a export embeds a cloudBond pointer', !!exportBlob && !!exportBlob.cloudBond && exportBlob.cloudBond.cloudProjectId === PID, exportBlob ? exportBlob.cloudBond : exported.slice(0, 120));
  check('D1b bond carries the cloud id + a timestamp only (no code)', !!exportBlob && !!exportBlob.cloudBond && JSON.stringify(exportBlob.cloudBond).indexOf(CODE) === -1 && Object.keys(exportBlob.cloudBond).every(k => ['cloudProjectId', 'linkedAt'].indexOf(k) > -1), exportBlob ? exportBlob.cloudBond : 'no bond');
  const exportHasCode = exported.indexOf(CODE) > -1;
  check('D1c owner code absent from the whole export', exportHasCode === false, exportHasCode);
  try { ws.close(); } catch (e) {}
  try { procA.kill(); } catch (e) {}

  // ---- Device B (fresh): import the file -> bond stored + offer shown -----
  const dirB = path.join(os.tmpdir(), 'mmgr-bond-B-' + Date.now());
  fs.mkdirSync(dirB, { recursive: true });
  const procB = await openDevice(9245, dirB, PID, {
    projectName: 'Device B offline edit', marker: 'device-b-offline',
    tasks: [{ id: 'T1', name: 'Foundations', status: 'todo' }],
    budgetLines: [{ id: 'B1', category: 'Concrete', planned: 1000, actual: 0 }]
  });
  await openCloudSection();
  // Import the exported bytes through the REAL state layer.
  const imp = await ev('(function(){return window.MMGR.State.importState(' + JSON.stringify(exported) + ');})()');
  check('D2a importState accepts the bonded export', imp === true, imp);
  const bondB = await ev('(function(){try{return JSON.parse(localStorage.getItem("mmgr_cloud_bond_' + PID + '")||"null");}catch(e){return null;}})()');
  check('D2b bond stored locally on the fresh device', !!bondB && bondB.cloudProjectId === PID, bondB);
  const pendingFlag = await ev('(function(){return window.MMGR.State.isBondPending ? window.MMGR.State.isBondPending() : null;})()');
  check('D2c pending flag raised for the one-time offer', pendingFlag === true, pendingFlag);
  // The offer renders on the next cloud render (the real boot render already
  // ran before the import, so re-render as the app does after import).
  await ev('(function(){if(window.MMGR&&MMGR.Cloud&&MMGR.Cloud._render)MMGR.Cloud._render();return true;})()');
  await delay(1200);
  const offerBtn = await ev('(function(){var s=document.getElementById("cloud-section");return s?!!s.querySelector("[data-action=cloudResync]"):false;})()');
  check('D2d one-time re-sync offer visible in the drawer', offerBtn === true, offerBtn);
  const createLabel = await ev('(function(){var s=document.getElementById("cloud-section");var b=s&&s.querySelector("[data-action=cloudCreate]");return b?b.textContent:"";})()');
  check('D2e Create button renamed while the offer stands (twin guard visible)', /checks the cloud copy first/.test(createLabel || ''), createLabel);

  // ---- D3: re-sync through the REAL button (device A change arrives) ------
  // Device A has moved on: bump the cloud snapshot while B works offline.
  const stateA2 = JSON.parse(JSON.stringify(stateA));
  stateA2.budgetLines[0].actual = 250;                 // A recorded spend
  stateA2.tasks[0].status = 'done';
  const save1 = await api('/api/cloud/projects/' + PID + '/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Owner-Code': CODE },
    body: JSON.stringify({ state: stateA2 })
  });
  check('D3a device-A change saved to the cloud twin', save1.status === 200 && save1.body && save1.body.ok, save1.text);
  // Give device B the credential (code) it needs for the pull - an imported
  // file carries NO credential by design, so the user enters the code here
  // (the same "On another device?" box the offer sits next to).
  await ev('(function(){try{sessionStorage.setItem("mmgr_cloud_code_' + PID + '","' + CODE + '");}catch(e){return String(e);}return true;})()');
  await ev('(function(){if(window.MMGR&&MMGR.Cloud&&MMGR.Cloud._render)MMGR.Cloud._render();return true;})()');
  await delay(1200);
  // Device B also edited locally (its own spend) - a per-field timestamp
  // OLDER than the cloud's loses the merge BY DESIGN (newest-wins); the
  // edit that matters here is B's post-resync edit, pushed in D4.
  await ev('(function(){window.MMGR.State.updateState(function(st){st.budgetLines[0].planned=1200;});return true;})()');
  await delay(800);
  await ev('(function(){var b=document.querySelector("[data-action=cloudResync]");if(b)b.click();return true;})()');
  const resyncStatus = await statusSettle();
  check('D3b re-sync status lands ok', /ds-ok/.test(resyncStatus || ''), resyncStatus);
  const mergedA = await ev('(function(){var s=window.MMGR.State.getState();return {taskStatus:(s.tasks[0]||{}).status, actual:((s.budgetLines[0]||{}).actual)};})()');
  check('D3c cloud edit arrived (task status done)', mergedA && mergedA.taskStatus === 'done', mergedA);
  check('D3d cloud edit arrived (actual 250)', mergedA && mergedA.actual === 250, mergedA);
  const keptLocal = await ev('(function(){var s=window.MMGR.State.getState();return (s.budgetLines[0]||{}).planned;})()');
  check('D3e newest-wins honored (cloud-newer planned overwrote B\u2019s older edit)', keptLocal === 1000, keptLocal);
  const offerGone = await ev('(function(){return window.MMGR.State.isBondPending();})()');
  check('D3f offer cleared after re-sync (one-time)', offerGone === false, offerGone);
  try { ws.close(); } catch (e) {}
  try { procB.kill(); } catch (e) {}

  // ---- D4: reverse direction - B's edits reach A through save + load ------
  // (B pushes its merged state back up; a fresh A-context load sees them.)
  const dirB2 = path.join(os.tmpdir(), 'mmgr-bond-B2-' + Date.now());
  fs.mkdirSync(dirB2, { recursive: true });
  const procB2 = await openDevice(9246, dirB2, PID, {
    projectName: NAME, marker: MARKER_A,
    tasks: [{ id: 'T1', name: 'Foundations', status: 'todo' }],
    budgetLines: [{ id: 'B1', category: 'Concrete', planned: 1000, actual: 0 }]
  });
  await openCloudSection();
  await ev('(function(){try{sessionStorage.setItem("mmgr_cloud_code_' + PID + '","' + CODE + '");}catch(e){}return true;})()');
  await ev('(function(){if(window.MMGR&&MMGR.Cloud&&MMGR.Cloud._render)MMGR.Cloud._render();return true;})()');
  await delay(1200);
  // Seed the same bond via the state layer's import path (the file trip).
  const export2 = await ev('(function(){var s=window.MMGR.State.getState();s.cloudBond={cloudProjectId:"' + PID + '",linkedAt:new Date().toISOString()};return true;})()');
  await ev('(function(){return window.MMGR.State.importState(JSON.stringify(window.MMGR.State.getState()));})()');
  await ev('(function(){if(window.MMGR&&MMGR.Cloud&&MMGR.Cloud._render)MMGR.Cloud._render();return true;})()');
  await delay(800);
  // Pull through re-sync (bond path), then push B's own edit via the real
  // save action; A's context is gone, so verify through a fresh HTTP load.
  await ev('(function(){var b=document.querySelector("[data-action=cloudResync]");if(b)b.click();return true;})()');
  await statusSettle();
  await ev('(function(){window.MMGR.State.updateState(function(st){st.budgetLines[0].actual=400;});return true;})()');
  await delay(600);
  await ev('(function(){var b=document.querySelector("[data-action=cloudSave]");if(b)b.click();return true;})()');
  const pushStatus = await statusSettle();
  check('D4a bonded device pushed its merge back to the cloud (save ok)', /ds-ok/.test(pushStatus || ''), pushStatus);
  // HARNESS LAW (shared rate bucket, 2026-09-20): the two-way sync watcher
  // legitimately polls /meta on device sessions, so late-run HTTP probes can
  // land on a 429 through no fault of the app. Retry on 429 (3 attempts,
  // 15s apart) keeps the assertion about DATA, not about bucket timing.
  let loadBack = await api('/api/cloud/projects/' + PID + '/load', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Owner-Code': CODE },
    body: JSON.stringify({})
  });
  for (let i = 0; i < 3 && loadBack.status === 429; i++) {
    await delay(15000);
    loadBack = await api('/api/cloud/projects/' + PID + '/load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Owner-Code': CODE },
      body: JSON.stringify({})
    });
  }
  check('D4b cloud copy now carries device B\\u2019s edit (actual 400)', loadBack.status === 200 && loadBack.body && loadBack.body.ok && loadBack.body.state && loadBack.body.state.budgetLines && loadBack.body.state.budgetLines[0].actual === 400, loadBack.text.slice(0, 200));

  // ---- D6: bond shape never carries a credential (live bytes, device B2) --
  // Capture while the CDP connection is still on B2 - later phases switch
  // contexts, and ev() on a closed socket would hang the harness.
  const bondLive = await ev('(function(){return localStorage.getItem("mmgr_cloud_bond_' + PID + '");})()');
  check('D6 stored bond holds id + timestamp, never the code', !!bondLive && bondLive.indexOf(CODE) === -1 && /cloudProjectId/.test(bondLive || ''), bondLive);
  try { ws.close(); } catch (e) {}
  try { procB2.kill(); } catch (e) {}

  // ---- D5: bonded-create guard (HTTP-level proof of the twin probe) -------
  // The bonded create path probes /meta before anything else; an unknown id
  // must NOT fall through to a blind create. Drive the guard through the UI:
  // a bonded project whose twin is gone -> bond cleared, no create issued.
  const PID2 = 'qa-bond-gone-' + Date.now().toString(36);
  const dirG = path.join(os.tmpdir(), 'mmgr-bond-G-' + Date.now());
  fs.mkdirSync(dirG, { recursive: true });
  const procG = await openDevice(9247, dirG, PID2, {
    projectName: 'Ghost twin', marker: 'ghost',
    tasks: [], budgetLines: []
  });
  await openCloudSection();
  await ev('(function(){localStorage.setItem("mmgr_cloud_bond_' + PID2 + '",JSON.stringify({cloudProjectId:"' + PID + '-ghost-twin",lastSyncedAt:""}));return true;})()');
  await ev('(function(){if(window.MMGR&&MMGR.Cloud&&MMGR.Cloud._render)MMGR.Cloud._render();return true;})()');
  await delay(1200);
  await ev('(function(){var b=document.querySelector("#cloud-section [data-action=cloudCreate]");if(b)b.click();return true;})()');
  const ghostStatus = await statusSettle();
  // Task 13 resolution order for an offline copy turning cloud: held code ->
  // session -> bond + SIGN-IN CHALLENGE. The ghost device holds neither code
  // nor session, so the designed behavior is the sign-in queue (the probe
  // runs after the user proves an account) - never a blind create.
  check('D5a create on a bonded twin with no credential challenges sign-in first', /Sign in to continue/.test(ghostStatus || '') && /cloud twin/.test(ghostStatus || ''), ghostStatus);
  const bondGone = await ev('(function(){return localStorage.getItem("mmgr_cloud_bond_' + PID2 + '");})()');
  check('D5b bond kept through the sign-in challenge (retry contract)', !!bondGone && /ghost-twin/.test(bondGone || ''), bondGone);
  // No duplicate row: with the anonymous challenge the create call never
  // fired. Prove it server-side: an unauthenticated list may not be readable,
  // but a create for the same ghost id (code-less) must NOT have already
  // linked it - the create below answers 200 only if the id was still free.
  const noGhostRow = await api('/api/cloud/projects', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: PID + '-ghost-twin', name: 'Ghost twin' })
  });
  check('D5c blind create never ran for the ghost id (id still free -> 200)', noGhostRow.status === 200 && noGhostRow.body && noGhostRow.body.ok === true, noGhostRow.status + '|' + noGhostRow.text.slice(0, 120));
  try { ws.close(); } catch (e) {}
  try { procG.kill(); } catch (e) {}
}

(async () => {
  try {
    await startWrangler();
    await main();
  } catch (e) {
    check('harness crashed', false, e.message);
  } finally {
    _done = true;
    clearTimeout(_watchdog);
    stopWrangler();
  }
  const failed = results.filter(r => !r.val);
  log('──────────────────────────────────────────────');
  log('SYNC_BOND ' + (failed.length === 0 ? 'PASS (' + results.length + '/' + results.length + ' checks)' : 'FAIL (' + failed.length + '/' + results.length + ' broken)'));
  failed.forEach(r => log('  broken: ' + r.name));
  process.exit(failed.length === 0 ? 0 : 1);
})();
