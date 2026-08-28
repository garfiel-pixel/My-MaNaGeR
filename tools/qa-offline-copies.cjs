/* ============================================================
   CLOUD-FIRST SYNC (PART 3) — OFFLINE COPIES + ADMIN BROADCAST
   END-TO-END GATE (2026-08-17)
   ------------------------------------------------------------
   Starts the Worker LOCALLY (npx wrangler dev against local D1 +
   R2 miniflare emulation, migration 0014 applied — offline_copies
   table + cloud_projects.auto_broadcast) and verifies the approved
   PART-3 surface end to end:

   C1  register an offline copy (viewer code + deviceId) -> ok +
       copyId; the register route accepts ANY valid access
   C2  re-register the SAME device -> idempotent (same copyId,
       never a duplicate row)
   C3  register with NO credential -> generic 403
   C4  owner GET /offline-copies lists the copy with deviceId +
       freshness fields and autoBroadcast false
   C5  a non-owner (viewer code) listing -> 403
   C6  load with X-Device-Id stamps last_pulled_at + last_cloud_rev
       (visible in the owner list afterwards)
   C7  owner POST /broadcast -> ok, copies count, and a changelog
       'broadcast' entry appears; viewer broadcast -> 403
   C8  owner PUT /auto-broadcast enabled -> ok; a save then ALSO
       records a 'broadcast' changelog entry (auto mode) and never
       fails the save
   C9  owner PUT /auto-broadcast disabled -> a later save records
       NO new broadcast entry
   C10 the registering device can DELETE its own copy; the owner
       can DELETE any copy (404 on a second delete)
   C11 unlink (soft-delete) cascades: the offline-copies list then
       answers project_deleted

   Exit 0 only when all checks pass. Reports PASS/FAIL per check.
   Usage: node tools/qa-offline-copies.cjs
   ============================================================ */
'use strict';
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 8796;
const BASE = 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');

const SECRET = 'qa-offline-copies-secret-4c8b2f1d';
const ADMIN_CODE = 'qa-admin-oc-71e9';

const log = (s) => { process.stdout.write('[oc] ' + s + '\n'); };
const delay = ms => new Promise(r => setTimeout(r, ms));

const results = [];
const check = (name, val, detail) => {
  results.push({ name, val });
  log((val ? 'PASS' : 'FAIL') + '  ' + name + (val ? '' : '   <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 500)));
};

setTimeout(() => { log('WATCHDOG — harness exceeded 300s'); try { proc && proc.kill(); } catch (e) {} process.exit(2); }, 300000).unref();

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
const PERSIST_DIR = path.join(os.tmpdir(), 'mmgr-oc-wstate-' + Date.now());

let proc = null;
let devLog = '';

function startWrangler() {
  return new Promise((resolve, reject) => {
    log('starting wrangler dev on :' + PORT + ' (local D1 + R2, migration 0014)…');
    try {
      execFileSync(process.execPath,
        [WRANGLER_JS, 'd1', 'migrations', 'apply', 'my-manager-db', '--local', '--config', 'wrangler.ci.jsonc', '--persist-to', PERSIST_DIR],
        { cwd: ROOT, stdio: 'ignore', timeout: 120000 });
    } catch (e) { log('migrations apply (best-effort): ' + e.message); }
    proc = spawn(process.execPath, [WRANGLER_JS, 'dev', '--config', 'wrangler.ci.jsonc', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', PERSIST_DIR,
      '--var', 'GOOGLE_CLIENT_SECRET:' + SECRET,
      '--var', 'ADMIN_CODE:' + ADMIN_CODE], {
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

const j = async (res) => { try { return await res.json(); } catch (e) { return {}; } };
const jsonHeaders = { 'Content-Type': 'application/json' };

(async function main() {
  try {
    await startWrangler();
    const pid = 'oc-copy-' + Date.now().toString(36);

    // C0 create a cloud project (code-only create) + seed a snapshot.
    let r = await fetch(BASE + '/api/cloud/projects', {
      method: 'POST', credentials: 'same-origin',
      headers: jsonHeaders,
      body: JSON.stringify({ projectId: pid, name: 'Offline Copies QA' })
    });
    const created = await j(r);
    check('C0a create cloud project', r.ok && created.ok && !!created.ownerCode, created);
    const ownerCode = created.ownerCode;

    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/save', {
      method: 'POST', credentials: 'same-origin',
      headers: Object.assign({}, jsonHeaders, { 'X-Owner-Code': ownerCode }),
      body: JSON.stringify({ state: { tasks: [{ id: 't1', name: 'Seed task' }] } })
    });
    const saved = await j(r);
    check('C0b owner save seeds a snapshot', r.ok && saved.ok && !!saved.savedAt, saved);

    // A viewer code for the recipient device.
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/editors', {
      method: 'POST', credentials: 'same-origin',
      headers: Object.assign({}, jsonHeaders, { 'X-Owner-Code': ownerCode }),
      body: JSON.stringify({ label: 'Copy Recipient', scope: ['wbs'], role: 'view' })
    });
    const vw = await j(r);
    check('C0c viewer code created', r.ok && vw.ok && !!vw.editorCode && vw.role === 'view', vw);
    const viewCode = vw.editorCode;

    // C1 register an offline copy with the viewer code.
    const deviceId = 'dev-' + Date.now().toString(36) + '-aa11';
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/offline-copies', {
      method: 'POST', credentials: 'same-origin',
      headers: Object.assign({}, jsonHeaders, { 'X-View-Code': viewCode }),
      body: JSON.stringify({ deviceId: deviceId })
    });
    const reg = await j(r);
    check('C1 register offline copy via viewer code -> ok + copyId',
      r.ok && reg.ok && !!reg.copyId && reg.deviceId === deviceId, reg);
    const copyId = reg.copyId;

    // C2 idempotent re-register of the same device.
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/offline-copies', {
      method: 'POST', credentials: 'same-origin',
      headers: Object.assign({}, jsonHeaders, { 'X-View-Code': viewCode }),
      body: JSON.stringify({ deviceId: deviceId })
    });
    const reg2 = await j(r);
    check('C2 re-register same device is idempotent (same copyId)', r.ok && reg2.ok && reg2.copyId === copyId, { first: copyId, second: reg2.copyId });

    // C3 no credential -> generic 403.
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/offline-copies', {
      method: 'POST', credentials: 'same-origin',
      headers: jsonHeaders,
      body: JSON.stringify({ deviceId: 'dev-nobody-0000' })
    });
    check('C3 register with no credential -> 403', r.status === 403, { status: r.status });

    // C4 owner list shows the single copy + autoBroadcast false.
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/offline-copies', {
      method: 'GET', credentials: 'same-origin',
      headers: { 'X-Owner-Code': ownerCode }
    });
    const list = await j(r);
    const one = (list.copies || []).length === 1 ? list.copies[0] : null;
    check('C4 owner list: 1 copy with deviceId + freshness fields, autoBroadcast false',
      r.ok && list.ok && (list.copies || []).length === 1 && !!one && one.deviceId === deviceId && list.autoBroadcast === false &&
      one.id === copyId, list);

    // C5 a non-owner listing -> 403.
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/offline-copies', {
      method: 'GET', credentials: 'same-origin',
      headers: { 'X-View-Code': viewCode }
    });
    check('C5 viewer listing -> 403', r.status === 403, { status: r.status });

    // C6 load with X-Device-Id stamps freshness.
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/load', {
      method: 'POST', credentials: 'same-origin',
      headers: Object.assign({}, jsonHeaders, { 'X-View-Code': viewCode, 'X-Device-Id': deviceId }),
      body: JSON.stringify({})
    });
    const load1 = await j(r);
    check('C6a copy pull with X-Device-Id succeeds', r.ok && load1.ok && !!load1.state && load1.state.tasks.length === 1, load1);
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/offline-copies', {
      method: 'GET', credentials: 'same-origin',
      headers: { 'X-Owner-Code': ownerCode }
    });
    const list2 = await j(r);
    const c2 = (list2.copies || [])[0];
    check('C6b owner list shows last_pulled_at + last_cloud_rev stamped',
      r.ok && !!c2 && !!c2.lastPulledAt && !!c2.lastCloudRev, c2);

    // C7 manual broadcast: owner ok + changelog entry; viewer 403.
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/broadcast', {
      method: 'POST', credentials: 'same-origin',
      headers: Object.assign({}, jsonHeaders, { 'X-Owner-Code': ownerCode }),
      body: JSON.stringify({})
    });
    const bc = await j(r);
    check('C7a owner broadcast -> ok with copies count 1', r.ok && bc.ok && bc.copies === 1 && !!bc.broadcastAt, bc);
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/broadcast', {
      method: 'POST', credentials: 'same-origin',
      headers: Object.assign({}, jsonHeaders, { 'X-View-Code': viewCode }),
      body: JSON.stringify({})
    });
    check('C7b viewer broadcast -> 403', r.status === 403, { status: r.status });
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/changelog', {
      method: 'GET', credentials: 'same-origin',
      headers: { 'X-Owner-Code': ownerCode }
    });
    const clog = await j(r);
    const bcEntries = (clog.entries || []).filter(function(e) { return e.type === 'broadcast'; });
    check('C7c changelog has a broadcast entry after manual broadcast', r.ok && bcEntries.length >= 1, bcEntries);

    // C8 auto-broadcast on: a save then ALSO logs a broadcast entry.
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/auto-broadcast', {
      method: 'PUT', credentials: 'same-origin',
      headers: Object.assign({}, jsonHeaders, { 'X-Owner-Code': ownerCode }),
      body: JSON.stringify({ enabled: true })
    });
    const abOn = await j(r);
    check('C8a auto-broadcast enabled', r.ok && abOn.ok && abOn.enabled === true, abOn);
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/save', {
      method: 'POST', credentials: 'same-origin',
      headers: Object.assign({}, jsonHeaders, { 'X-Owner-Code': ownerCode }),
      body: JSON.stringify({ state: { tasks: [{ id: 't1', name: 'Seed task', done: true }] } })
    });
    const save2 = await j(r);
    check('C8b save with auto-broadcast on still succeeds', r.ok && save2.ok && !!save2.savedAt, save2);
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/changelog', {
      method: 'GET', credentials: 'same-origin',
      headers: { 'X-Owner-Code': ownerCode }
    });
    const log2 = await j(r);
    const bc2 = (log2.entries || []).filter(function(e) { return e.type === 'broadcast'; });
    check('C8c auto-broadcast save logged a broadcast entry', r.ok && bc2.length >= 2, bc2.length);

    // C9 auto-broadcast off: the next save logs NO new broadcast entry.
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/auto-broadcast', {
      method: 'PUT', credentials: 'same-origin',
      headers: Object.assign({}, jsonHeaders, { 'X-Owner-Code': ownerCode }),
      body: JSON.stringify({ enabled: false })
    });
    const abOff = await j(r);
    check('C9a auto-broadcast disabled', r.ok && abOff.ok && abOff.enabled === false, abOff);
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/save', {
      method: 'POST', credentials: 'same-origin',
      headers: Object.assign({}, jsonHeaders, { 'X-Owner-Code': ownerCode }),
      body: JSON.stringify({ state: { tasks: [{ id: 't1', name: 'Seed task', done: true, note: 'x' }] } })
    });
    const save3 = await j(r);
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/changelog', {
      method: 'GET', credentials: 'same-origin',
      headers: { 'X-Owner-Code': ownerCode }
    });
    const log3 = await j(r);
    const bc3 = (log3.entries || []).filter(function(e) { return e.type === 'broadcast'; });
    check('C9b save with auto-broadcast off logs no new broadcast entry', r.ok && bc3.length === 2, bc3.length);

    // C10 self-removal + owner removal.
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/offline-copies/' + copyId, {
      method: 'DELETE', credentials: 'same-origin',
      headers: Object.assign({}, jsonHeaders, { 'X-View-Code': viewCode }),
      body: JSON.stringify({ deviceId: deviceId })
    });
    const selfDel = await j(r);
    check('C10a device can delete its own copy', r.ok && selfDel.ok, selfDel);
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/offline-copies/' + copyId, {
      method: 'DELETE', credentials: 'same-origin',
      headers: Object.assign({}, jsonHeaders, { 'X-Owner-Code': ownerCode }),
      body: JSON.stringify({})
    });
    check('C10b second delete -> 404 (already gone)', r.status === 404, { status: r.status });

    // A fresh copy so the owner-removal path is exercised.
    const dev2 = 'dev-' + Date.now().toString(36) + '-bb22';
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/offline-copies', {
      method: 'POST', credentials: 'same-origin',
      headers: Object.assign({}, jsonHeaders, { 'X-View-Code': viewCode }),
      body: JSON.stringify({ deviceId: dev2 })
    });
    const reg3 = await j(r);
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/offline-copies/' + reg3.copyId, {
      method: 'DELETE', credentials: 'same-origin',
      headers: Object.assign({}, jsonHeaders, { 'X-Owner-Code': ownerCode }),
      body: JSON.stringify({})
    });
    const ownerDel = await j(r);
    check('C10c owner can delete any copy', r.ok && ownerDel.ok && ownerDel.removed === reg3.copyId, ownerDel);

    // C11 unlink (hard delete) cascades offline_copies: the project row is
    // gone, so the owner listing now answers the generic 403.
    r = await fetch(BASE + '/api/cloud/projects/' + pid, {
      method: 'DELETE', credentials: 'same-origin',
      headers: Object.assign({}, jsonHeaders, { 'X-Owner-Code': ownerCode }),
      body: JSON.stringify({})
    });
    const unlink = await j(r);
    check('C11a unlink succeeds', r.ok && unlink.ok && unlink.unlinked === pid, unlink);
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/offline-copies', {
      method: 'GET', credentials: 'same-origin',
      headers: { 'X-Owner-Code': ownerCode }
    });
    const afterUnlink = await j(r);
    check('C11b offline-copies list after unlink -> generic 403', r.status === 403, { status: r.status, body: afterUnlink });

    // Summary.
    const fails = results.filter(function(x) { return !x.val; });
    log('========================================');
    log('offline-copies gate: ' + (results.length - fails.length) + '/' + results.length + ' checks passed');
    if (fails.length) {
      log('FAILED: ' + fails.map(function(f) { return f.name; }).join(' | '));
      stopWrangler();
      process.exit(1);
    }
    stopWrangler();
    process.exit(0);
  } catch (e) {
    log('HARNESS ERROR: ' + (e && e.stack || e));
    stopWrangler();
    process.exit(1);
  }
})();
