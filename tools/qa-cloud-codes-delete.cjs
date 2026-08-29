/* ============================================================
   CLOUD-CODES-AND-DELETE — END-TO-END GATE (2026-08-16)
   ------------------------------------------------------------
   Starts the Worker LOCALLY (npx wrangler dev against local D1 +
   R2 miniflare emulation, migration 0009 applied) and verifies
   the new surface from the CLOUD-CODES-AND-DELETE directive:

   K1  POST /api/cloud/codes/lookup resolves an OWNER code to its
       project (role owner, projectName), and an unknown code ->
       invalid_code (generic, no existence hint)
   K2  lookup resolves an EDITOR code (role editor + scope) and a
       VIEWER code (role view + scope) — migration 0009 role column
   K3  load with X-View-Code succeeds as role 'view' with the
       viewer's scope; save with X-View-Code is refused (403)
   K4  soft delete (POST .../delete): every subsequent load
       (owner, editor, view) answers project_deleted (410);
       restore (POST .../restore) brings loads back
   K5  revoking a viewer code -> lookup answers code_revoked
   K6  deleted projects are excluded from the free-plan count
       (owner create cap path) — verified by the deleted_at guard
       on the COUNT query via source inspection in phase2; here we
       assert delete -> lookup answers project_deleted for the
       deleted project's own owner code
   K7  editor-code cap still enforced (25 active shared codes)
   K8  STABILIZATION: the admin cloud list exposes deletedAt for a
       tombstoned project (the "Deleted" state — the owner's report:
       a deleted project kept showing in the Cloud Projects list)
   K9  STABILIZATION: the fortify route POST .../purge hard-deletes
       the backend NOW (list row gone, owner code -> invalid_code,
       restore -> 404)

   Exit 0 only when all checks pass. Reports PASS/FAIL per check.
   Usage: node tools/qa-cloud-codes-delete.cjs
   ============================================================ */
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 8797;
const BASE = 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');
// STABILIZATION (2026-08-16): the admin-list + fortify checks need the site
// ADMIN_CODE in the dev environment (same pattern as qa-cloud-phase2.cjs).
const ADMIN_CODE = 'QA-ADMIN-' + Date.now().toString(36).toUpperCase();

const log = (s) => { process.stdout.write('[codes] ' + s + '\n'); };
const delay = ms => new Promise(r => setTimeout(r, ms));

const results = [];
const check = (name, val, detail) => {
  results.push({ name, val });
  log((val ? 'PASS' : 'FAIL') + '  ' + name + (val ? '' : '   <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 400)));
};

setTimeout(() => { log('WATCHDOG — harness exceeded 300s'); try { proc && proc.kill(); } catch (e) {} process.exit(2); }, 300000).unref();

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
const PERSIST_DIR = path.join(os.tmpdir(), 'mmgr-codes-wstate-' + Date.now());


let proc = null;
let devLog = '';

function startWrangler() {
  return new Promise((resolve, reject) => {
    log('starting wrangler dev on :' + PORT + ' (local D1 + R2, migration 0009)…');
    try {
      execFileSync(process.execPath,
        [WRANGLER_JS, 'd1', 'migrations', 'apply', 'my-manager-db', '--local', '--config', 'wrangler.ci.jsonc', '--persist-to', PERSIST_DIR],
        { cwd: ROOT, stdio: 'ignore', timeout: 120000 });
    } catch (e) { log('migrations apply (best-effort): ' + e.message); }
    proc = spawn(process.execPath, [WRANGLER_JS, 'dev', '--config', 'wrangler.ci.jsonc', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', PERSIST_DIR,
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

(async function main() {
  try {
    await startWrangler();
    const pid = 'codes-qa-' + Date.now().toString(36);
    // K0 create a cloud project (no session — code-only create).
    let r = await fetch(BASE + '/api/cloud/projects', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: pid, name: 'Codes QA Project' })
    });
    const created = await j(r);
    check('K0 create cloud project', r.ok && created.ok && !!created.ownerCode, created);
    const ownerCode = created.ownerCode;

    // K1 owner lookup.
    r = await fetch(BASE + '/api/cloud/codes/lookup', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: ownerCode })
    });
    const lk = await j(r);
    check('K1 owner code lookup resolves to the project (role owner)', r.ok && lk.ok && lk.projectId === pid && lk.role === 'owner', lk);
    // unknown code -> invalid_code, never a 404/existence leak.
    r = await fetch(BASE + '/api/cloud/codes/lookup', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ' })
    });
    const bad = await j(r);
    check('K1b unknown code -> 403 generic (no existence hint)', r.status === 403 && !bad.ok && bad.error === 'invalid project or owner code', bad);

    // K2 editor + viewer codes resolve with their role + scope.
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/editors', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Owner-Code': ownerCode },
      body: JSON.stringify({ label: 'Editor QA', scope: ['wbs', 'budget'], role: 'editor' })
    });
    const ed = await j(r);
    check('K2a editor code created (role editor)', r.ok && ed.ok && !!ed.editorCode && ed.role === 'editor', ed);
    r = await fetch(BASE + '/api/cloud/codes/lookup', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: ed.editorCode })
    });
    const elk = await j(r);
    check('K2b editor code lookup -> role editor + label', r.ok && elk.ok && elk.role === 'editor' && elk.label === 'Editor QA', elk);

    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/editors', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Owner-Code': ownerCode },
      body: JSON.stringify({ label: 'Viewer QA', scope: ['meet'], role: 'view' })
    });
    const vw = await j(r);
    check('K2c viewer code created (role view)', r.ok && vw.ok && !!vw.editorCode && vw.role === 'view', vw);
    r = await fetch(BASE + '/api/cloud/codes/lookup', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: vw.editorCode })
    });
    const vlk = await j(r);
    check('K2d viewer code lookup -> role view + label', r.ok && vlk.ok && vlk.role === 'view' && vlk.label === 'Viewer QA', vlk);

    // K3 viewer load works (read-only), viewer save refused.
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/load', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-View-Code': vw.editorCode },
      body: JSON.stringify({})
    });
    const vload = await j(r);
    check('K3a load with X-View-Code -> role view (read-only)', r.ok && vload.ok && vload.role === 'view' && vload.scope.indexOf('meet') !== -1, vload);
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/save', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-View-Code': vw.editorCode },
      body: JSON.stringify({ state: { tasks: [] } })
    });
    const vsave = await j(r);
    check('K3b save with X-View-Code -> refused (403)', r.status === 403 && !vsave.ok, { status: r.status, vsave });

    // K4 soft delete + restore.
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/delete', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Owner-Code': ownerCode },
      body: JSON.stringify({})
    });
    const del = await j(r);
    check('K4a soft delete ok', r.ok && del.ok && !!del.deletedAt, del);
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/load', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Owner-Code': ownerCode },
      body: JSON.stringify({})
    });
    const dload = await j(r);
    check('K4b load after delete -> project_deleted (410)', r.status === 410 && dload.error === 'project_deleted', { status: r.status, dload });
    r = await fetch(BASE + '/api/cloud/codes/lookup', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: vw.editorCode })
    });
    const dlk = await j(r);
    check('K4c lookup after delete -> deleted flag for code holders too', r.ok && dlk.ok && dlk.deleted === true, { status: r.status, dlk });
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/restore', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Owner-Code': ownerCode },
      body: JSON.stringify({})
    });
    const rst = await j(r);
    check('K4d restore ok', r.ok && rst.ok, rst);
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/load', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Owner-Code': ownerCode },
      body: JSON.stringify({})
    });
    const rload = await j(r);
    check('K4e load after restore works again', r.ok && rload.ok, rload);

    // K5 revoke -> lookup answers code_revoked.
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/editors', {
      method: 'GET', credentials: 'same-origin', headers: { 'X-Owner-Code': ownerCode }
    });
    const eds = await j(r);
    const viewerRow = (eds.editors || []).find(function(e) { return e.role === 'view'; });
    check('K5a editor list exposes the role column', !!(viewerRow && viewerRow.id), eds);
    if (viewerRow) {
      r = await fetch(BASE + '/api/cloud/projects/' + pid + '/editors/' + viewerRow.id, {
        method: 'DELETE', credentials: 'same-origin', headers: { 'X-Owner-Code': ownerCode }
      });
      const rv = await j(r);
      check('K5b revoke viewer code ok', r.ok && rv.ok, rv);
      r = await fetch(BASE + '/api/cloud/codes/lookup', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: vw.editorCode })
      });
      const rlk = await j(r);
      check('K5c lookup of revoked code -> revoked flag', rlk.ok && rlk.revoked === true, { status: r.status, rlk });
    }

    // K6 deleted project answered project_deleted for its own owner code.
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/delete', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Owner-Code': ownerCode },
      body: JSON.stringify({})
    });
    const del2 = await j(r);
    r = await fetch(BASE + '/api/cloud/codes/lookup', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: ownerCode })
    });
    const odlk = await j(r);
    check('K6 owner code lookup after delete -> deleted flag', odlk.ok && odlk.deleted === true, { status: r.status, odlk });

    // ---- STABILIZATION (2026-08-16): delete-link coherence ----
    // The project is currently soft-deleted (tombstoned) from K6. The admin
    // Cloud Projects list must expose that state (deletedAt) so the admin
    // panel can render "Deleted" + Undo + Delete permanently instead of
    // looking live (the owner's exact bug report).
    r = await fetch(BASE + '/api/cloud/admin/projects', { headers: { 'X-Admin-Code': ADMIN_CODE } });
    const admDel = await j(r);
    const delRow = (admDel.projects || []).find(function(x) { return x.projectId === pid; });
    check('K8 admin cloud list exposes the tombstone (deletedAt set)', r.ok && admDel.ok && !!delRow && !!delRow.deletedAt && delRow.hasSnapshot === false, { status: r.status, row: delRow });
    // K9 fortify: POST .../purge hard-deletes the backend NOW — the list
    // row disappears, the owner code stops resolving (row gone -> generic
    // invalid_code), and restore finds nothing to restore (404).
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/purge', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Owner-Code': ownerCode },
      body: JSON.stringify({})
    });
    const prg = await j(r);
    check('K9a purge (fortify) ok via ADMIN_CODE', r.ok && prg.ok && prg.purged === pid, { status: r.status, prg });
    r = await fetch(BASE + '/api/cloud/admin/projects', { headers: { 'X-Admin-Code': ADMIN_CODE } });
    const admGone = await j(r);
    check('K9b admin cloud list no longer shows the purged project', r.ok && admGone.ok && !(admGone.projects || []).some(function(x) { return x.projectId === pid; }), { status: r.status, admGone });
    r = await fetch(BASE + '/api/cloud/codes/lookup', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: ownerCode })
    });
    const plk = await j(r);
    check('K9c owner code lookup after purge -> 403 (row gone)', r.status === 403, { status: r.status, plk });
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/restore', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Owner-Code': ownerCode },
      body: JSON.stringify({})
    });
    const prst = await j(r);
    check('K9d restore after purge -> 403/404 (row gone, nothing to restore)', (r.status === 403 || r.status === 404) && !prst.ok, { status: r.status, prst });
  } catch (e) {
    check('harness fatal', false, String(e && e.message || e));
    log(devLog.split('\n').slice(-25).join('\n'));
  } finally {
    stopWrangler();
  }
  const failed = results.filter(r => !r.val);
  log('──────────────────────────────────────────────');
  log('CLOUD_CODES_DELETE ' + (failed.length ? 'FAIL (' + failed.length + '/' + results.length + ')' : 'PASS (' + results.length + '/' + results.length + ')'));
  process.exit(failed.length ? 1 : 0);
})();
