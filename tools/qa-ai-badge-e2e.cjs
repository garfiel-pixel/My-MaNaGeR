/* ============================================================
   qa-ai-badge-e2e.cjs — AI-BADGE + REVERT browser E2E setup
   ------------------------------------------------------------
   The BROWSER half of the imported-AI changelog end-to-end pass:
   this script starts the Worker LOCALLY (wrangler dev, local D1 +
   R2 miniflare emulation, migrations incl. 0005), creates a cloud
   project, saves a blob whose state MATCHES the MCP-AFTER of the
   entries we import (the honesty gate requires it), imports one
   MCP changelog entry (recordId add/delete/field diffs), asserts
   the changelog list exposes it with source='mcp' + actorLabel
   'mcp-ai' (the data behind the purple AI · MCP badge), writes
   { pid, ownerCode, port, entryId } to
   %TMPDIR%/mmgr-ai-e2e-state.json, prints a READY banner, and then
   STAYS ALIVE so a browser (CDP) can be driven against the origin
   to verify the badge renders and the Revert button works.

   Stop it by creating the stop file (touch mmgr-ai-e2e-stop in
   the tmpdir) — it exits and takes the wrangler child down.

   Usage:  node tools/qa-ai-badge-e2e.cjs
   Exit:   0 after a clean stop; 1 on any API-phase gate failure.
   ============================================================ */
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 8794;
let BASE = 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');
const TMP = os.tmpdir();
const STATE_FILE = path.join(TMP, 'mmgr-ai-e2e-state.json');
const STOP_FILE = path.join(TMP, 'mmgr-ai-e2e-stop');

const log = (s) => { process.stdout.write('[ai-e2e] ' + s + '\n'); };
const delay = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, val, detail) => { results.push({ name, val }); log((val ? 'PASS' : 'FAIL') + '  ' + name + (val ? '' : '   <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 500))); };

let proc = null;
let devLog = '';

// ---- wrangler scaffolding (same as qa-cloud-import.cjs) -------------------
function globalWranglerJs() {
  try {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const root = execFileSync(npmCmd, ['root', '-g'], { encoding: 'utf8', shell: process.platform === 'win32' }).trim();
    const p = path.join(root, 'wrangler', 'bin', 'wrangler.js');
    if (fs.existsSync(p)) return p;
  } catch (e) { /* fall through */ }
  // Fallback: local node_modules (CI, no global wrangler)
  try {
    const lp = path.join(__dirname, '..', 'node_modules', 'wrangler', 'bin', 'wrangler.js');
    if (fs.existsSync(lp)) return lp;
  } catch (e) { /* fall through */ }
  return null;
}
const WRANGLER_JS = globalWranglerJs();
const PERSIST_DIR = path.join(TMP, 'mmgr-ai-e2e-wstate-' + Date.now());

const { USE_EXTERNAL, externalWranglerGuard, stopWranglerIfLocal } = require('./wrangler-ci-helpers.cjs');
if (USE_EXTERNAL && process.env.WRANGLER_DEV_URL) BASE = process.env.WRANGLER_DEV_URL;
async function startWrangler() {
  const ext = externalWranglerGuard(log); if (ext) return ext;
  try {
    fs.rmSync(STOP_FILE, { force: true });
    fs.rmSync(STATE_FILE, { force: true });
  } catch (e) {}
  log('starting wrangler dev on :' + PORT + ' (local D1 + R2, migrations incl. 0005)…');
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
  proc.on('error', (e) => { throw new Error('wrangler spawn failed: ' + e.message); });
  const t0 = Date.now();
  for (;;) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(function() { ctrl.abort(); }, 3000);
      const r = await fetch(BASE + '/api/health', { signal: ctrl.signal });
      clearTimeout(timer);
      if (r.ok) return;
    } catch (e) { /* not up yet */ }
    if (Date.now() - t0 > 120000) throw new Error('wrangler dev did not come up in 120s');
    await delay(1500);
  }
}
function stopWrangler() {
  try { fs.rmSync(STOP_FILE, { force: true }); } catch (e) {}
  stopWranglerIfLocal(proc);
}

async function api(pathname, opts) {
  const res = await fetch(BASE + pathname, Object.assign({}, opts || {}));
  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  return { status: res.status, body, text: res.status + '|' + JSON.stringify(body) };
}

// The blob state: the MCP-AFTER of the diffs we import (tasks t1 done + t9
// planned, risks EMPTY) — the honesty gate verifies every imported diff
// against THIS blob.
function baseState(pid, name) {
  const now = new Date().toISOString();
  return {
    schemaVersion: 17, projectId: pid, projectName: name, updatedAt: now,
    charter: { name: name, sponsor: 'Sponsor' },
    tasks: [
      { id: 't1', name: 'Task One', status: 'done', start: '2026-01-01', end: '2026-01-05' },
      { id: 't9', name: 'AI Added', status: 'planned', start: '2026-02-01', end: '2026-02-05' }
    ],
    risks: [],
    closure: { status: 'open', handoverNotes: 'Initial handover' },
    raci: { tasks: [], persons: [], matrix: {} },
    resources: [], budgetLines: [], budgetEnvelope: 0, spendLog: [], stakeholders: [],
    fieldTs: { charter: now, tasks: now, risks: now, closure: now },
    config: {}, flags: {}, errorLog: []
  };
}

(async () => {
  if (!WRANGLER_JS) { log('FATAL: global wrangler not found (npm root -g)'); process.exit(1); }
  try { await startWrangler(); }
  catch (e) { log('FATAL: ' + e.message); log(devLog.slice(-1500)); process.exit(1); }

  try {
    // ---- create project + blob -------------------------------------------
    const PID = 'ai-e2e-' + Date.now().toString(36);
    const NAME = 'AI Badge E2E';
    const create = await api('/api/cloud/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: PID, name: NAME }) });
    check('A1 project create ok + owner code', create.status === 200 && create.body && create.body.ok === true && typeof create.body.ownerCode === 'string', create.text);
    const OC = create.body ? create.body.ownerCode : '';
    const state1 = baseState(PID, NAME);
    const save = await api('/api/cloud/projects/' + PID + '/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC },
      body: JSON.stringify({ state: state1 })
    });
    check('A2 owner save ok (blob in place for the honesty gate)', save.status === 200 && save.body && save.body.ok === true, save.text);

    // ---- import ONE MCP entry (recordId add/delete/field) ------------------
    const ISO = new Date().toISOString();
    const d = [
      { path: 'tasks[1]', recordId: 't9', after: { id: 't9', name: 'AI Added', status: 'planned', start: '2026-02-01', end: '2026-02-05' }, beforeAbsent: true, afterAbsent: false },
      { path: 'risks[0]', recordId: 'r1', before: { id: 'r1', name: 'Risk One', prob: 3 }, beforeAbsent: false, afterAbsent: true },
      { path: 'tasks[0].status', recordId: 't1', before: 'todo', after: 'done', beforeAbsent: false, afterAbsent: false }
    ];
    const imp = await api('/api/cloud/projects/' + PID + '/changelog/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': OC },
      body: JSON.stringify({ entries: [{ localId: 1, entry_type: 'edit', actor_type: 'owner', actor_label: 'mcp-ai', diffs_json: d, created_at: ISO }] })
    });
    check('A3 MCP entry imported', imp.status === 200 && imp.body && imp.body.imported.length === 1 && imp.body.skipped.length === 0 && imp.body.imported[0].section === 'multiple', imp.text);
    const ENTRY_ID = imp.body && Array.isArray(imp.body.imported) && imp.body.imported.length ? imp.body.imported[0].cloudId : null;

    // ---- changelog list carries the badge data ------------------------------
    const list = await api('/api/cloud/projects/' + PID + '/changelog', { method: 'GET', headers: { 'X-Owner-Code': OC } });
    const top = list.body && list.body.entries && list.body.entries[0];
    check('A4 list exposes the imported entry with source mcp + mcp-ai actor', list.status === 200 && top && top.id === ENTRY_ID && top.source === 'mcp' && top.actorLabel === 'mcp-ai' && top.type === 'edit' && Array.isArray(top.diffs) && top.diffs.length === 3, top);
    check('A5 entry carries recordId diffs (add/delete/field)', top && top.diffs[0].recordId === 't9' && top.diffs[0].beforeAbsent === true && top.diffs[1].recordId === 'r1' && top.diffs[1].afterAbsent === true && top.diffs[2].recordId === 't1', top && top.diffs);

    // ---- hand off to the browser phase ---------------------------------------
    try { fs.writeFileSync(STATE_FILE, JSON.stringify({ pid: PID, ownerCode: OC, port: PORT, entryId: ENTRY_ID, name: NAME })); } catch (e) {}
    log('READY pid=' + PID + ' code=' + OC + ' port=' + PORT + ' entry=' + ENTRY_ID);
    log('browser: http://127.0.0.1:' + PORT + '/project.html?id=' + PID);
    if (!process.env.MMGR_QA_NO_BROWSER) {
      log('waiting for browser phase (stop file: ' + STOP_FILE + ')…');
      // Keep alive until the stop file appears (or a 15-min watchdog).
      const t0 = Date.now();
      while (Date.now() - t0 < 900000) {
        if (fs.existsSync(STOP_FILE)) break;
        await delay(1000);
      }
    }
  } catch (e) {
    log('FATAL harness exception: ' + (e && e.stack || e));
  }

  const fails = results.filter(r => !r.val);
  log('----------------------------------------');
  log('API PHASE RESULT: ' + (results.length - fails.length) + '/' + results.length + ' gates passed');
  log('STOPPED — wrangler dev torn down.');
  stopWrangler();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { log('FATAL: ' + (e && e.stack || e)); stopWrangler(); process.exit(1); });
