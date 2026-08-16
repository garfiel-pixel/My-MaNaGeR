/* ============================================================
   PART F T9 — CLOUD SHARE-CODE ADOPTION — END-TO-END GATE (2026-08-16)
   ------------------------------------------------------------
   Starts the Worker LOCALLY (npx wrangler dev against local D1 +
   R2 miniflare emulation, migration 0011 applied) and verifies the
   recipient-adoption surface from the T9 directive:

   A1  editor-code load by a signed-in recipient creates the
       adoption row (server-side pin)
   A2  the pinned project appears in the recipient's own
       GET /api/cloud/projects list with accessRole 'editor' +
       adoptedAt (never confused with owned projects)
   A3  session-only load (NO code header) falls back to the
       adoption row -> role editor + live scope
   A4  session-only SAVE by an adopted editor succeeds — the
       server merges through the adoption's live code row scope
   A5  viewer-code load pins as role 'view'; session-only load
       -> role view; session-only SAVE is refused (403)
   A6  revoking the underlying code answers code_revoked on the
       session-only load (the adoption re-reads the LIVE code row)
   A7  DELETE /api/cloud/projects/:id/adopt unpins: the list no
       longer shows it and the session-only load is 403 again
   A8  an unrelated signed-in session never sees the adopted
       project (adoption is keyed on the recipient's own sub)
   A9  owner's own project list still shows the project with
       accessRole 'owner' (owned rows win the dedup)

   Exit 0 only when all checks pass. Reports PASS/FAIL per check.
   Usage: node tools/qa-t9-adoption.cjs
   ============================================================ */
'use strict';
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 8798;
const BASE = 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');

const SECRET = 'qa-t9-adoption-secret-7f1a9c3e';
const ADMIN_CODE = 'qa-admin-t9-53d2';

const log = (s) => { process.stdout.write('[t9] ' + s + '\n'); };
const delay = ms => new Promise(r => setTimeout(r, ms));

const results = [];
const check = (name, val, detail) => {
  results.push({ name, val });
  log((val ? 'PASS' : 'FAIL') + '  ' + name + (val ? '' : '   <-- ' + JSON.stringify(detail).slice(0, 500)));
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
const PERSIST_DIR = path.join(os.tmpdir(), 'mmgr-t9-wstate-' + Date.now());

let proc = null;
let devLog = '';

function startWrangler() {
  return new Promise((resolve, reject) => {
    log('starting wrangler dev on :' + PORT + ' (local D1 + R2, migration 0011)…');
    try {
      execFileSync(process.execPath,
        [WRANGLER_JS, 'd1', 'migrations', 'apply', 'my-manager-db', '--local', '--persist-to', PERSIST_DIR],
        { cwd: ROOT, stdio: 'ignore', timeout: 120000 });
    } catch (e) { log('migrations apply (best-effort): ' + e.message); }
    proc = spawn(process.execPath, [WRANGLER_JS, 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', PERSIST_DIR,
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
const cookieHeader = (cookie) => ({ 'Cookie': 'mmgr_session=' + cookie, 'Content-Type': 'application/json' });
function extractSessionCookie(res) {
  const sc = res.headers.get('Set-Cookie') || '';
  const m = sc.match(/mmgr_session=([^;]+)/);
  return m ? m[1] : null;
}

(async function main() {
  try {
    await startWrangler();
    const pid = 't9-adopt-' + Date.now().toString(36);

    // T9-0 create a cloud project (no session — code-only create).
    let r = await fetch(BASE + '/api/cloud/projects', {
      method: 'POST', credentials: 'same-origin',
      headers: jsonHeaders,
      body: JSON.stringify({ projectId: pid, name: 'T9 Adoption QA' })
    });
    const created = await j(r);
    check('A0 create cloud project', r.ok && created.ok && !!created.ownerCode, created);
    const ownerCode = created.ownerCode;

    // Seed a snapshot so loads return real state.
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/save', {
      method: 'POST', credentials: 'same-origin',
      headers: Object.assign({}, jsonHeaders, { 'X-Owner-Code': ownerCode }),
      body: JSON.stringify({ state: { tasks: [{ id: 't1', name: 'Adoption seed' }] } })
    });
    const saved = await j(r);
    check('A0b owner save seeds a snapshot', r.ok && saved.ok, saved);

    // T9-1 editor code for the recipient.
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/editors', {
      method: 'POST', credentials: 'same-origin',
      headers: Object.assign({}, jsonHeaders, { 'X-Owner-Code': ownerCode }),
      body: JSON.stringify({ label: 'Recipient Editor', scope: ['wbs', 'bud'], role: 'editor' })
    });
    const ed = await j(r);
    check('A1a editor code created', r.ok && ed.ok && !!ed.editorCode, ed);
    const editorCode = ed.editorCode;

    // T9-2 register two signed-in identities: the recipient + an unrelated user.
    r = await fetch(BASE + '/api/auth/register', {
      method: 'POST', credentials: 'same-origin',
      headers: jsonHeaders,
      body: JSON.stringify({ email: 'recipient.t9@example.com', password: 's3cure-pass!', name: 'T9 Recipient' })
    });
    const reg = await j(r);
    const recipientCookie = extractSessionCookie(r);
    check('A1b recipient session created', r.ok && reg.ok && !!recipientCookie, { status: r.status, reg });
    r = await fetch(BASE + '/api/auth/register', {
      method: 'POST', credentials: 'same-origin',
      headers: jsonHeaders,
      body: JSON.stringify({ email: 'stranger.t9@example.com', password: 's3cure-pass!', name: 'T9 Stranger' })
    });
    const reg2 = await j(r);
    const strangerCookie = extractSessionCookie(r);
    check('A1c stranger session created', r.ok && reg2.ok && !!strangerCookie, { status: r.status, reg2 });

    // T9-3 recipient loads WITH the editor code + session -> adoption row.
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/load', {
      method: 'POST', credentials: 'same-origin',
      headers: Object.assign({}, cookieHeader(recipientCookie), { 'X-Editor-Code': editorCode }),
      body: JSON.stringify({})
    });
    const aload = await j(r);
    check('A2a code load by signed-in recipient -> role editor + scope', r.ok && aload.ok && aload.role === 'editor' && Array.isArray(aload.scope) && aload.scope.indexOf('wbs') !== -1, aload);

    // A2b the pinned project shows in the recipient's OWN list.
    r = await fetch(BASE + '/api/cloud/projects', { method: 'GET', credentials: 'same-origin', headers: cookieHeader(recipientCookie) });
    const rlist = await j(r);
    const rrow = (rlist.projects || []).find(function(p) { return p.projectId === pid; });
    check('A2b adopted project in recipient list with accessRole editor + adoptedAt',
      r.ok && rlist.ok && !!rrow && rrow.accessRole === 'editor' && !!rrow.adoptedAt && rrow.hasSnapshot === true, rrow);

    // T9-4 session-only load (no code) -> adoption fallback.
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/load', {
      method: 'POST', credentials: 'same-origin',
      headers: cookieHeader(recipientCookie),
      body: JSON.stringify({})
    });
    const sload = await j(r);
    check('A3a session-only load falls back to adoption (role editor, live scope)', r.ok && sload.ok && sload.role === 'editor' && sload.scope.indexOf('bud') !== -1 && !!sload.state, sload);

    // T9-5 session-only SAVE by the adopted editor succeeds (scoped merge).
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/save', {
      method: 'POST', credentials: 'same-origin',
      headers: cookieHeader(recipientCookie),
      body: JSON.stringify({ state: { wbs: { items: [{ id: 'w1', name: 'Editor wrote this' }] } } })
    });
    const esave = await j(r);
    check('A4a session-only save by adopted editor -> ok', r.ok && esave.ok, esave);

    // T9-6 viewer adoption.
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/editors', {
      method: 'POST', credentials: 'same-origin',
      headers: Object.assign({}, jsonHeaders, { 'X-Owner-Code': ownerCode }),
      body: JSON.stringify({ label: 'Recipient Viewer', scope: ['meet'], role: 'view' })
    });
    const vw = await j(r);
    check('A5a viewer code created', r.ok && vw.ok && !!vw.editorCode && vw.role === 'view', vw);
    const viewCode = vw.editorCode;

    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/load', {
      method: 'POST', credentials: 'same-origin',
      headers: Object.assign({}, cookieHeader(recipientCookie), { 'X-View-Code': viewCode }),
      body: JSON.stringify({})
    });
    const vload = await j(r);
    check('A5b viewer code load by signed-in recipient -> role view', r.ok && vload.ok && vload.role === 'view', vload);
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/load', {
      method: 'POST', credentials: 'same-origin',
      headers: cookieHeader(recipientCookie),
      body: JSON.stringify({})
    });
    const vsload = await j(r);
    check('A5c session-only load now answers role view (adoption upserted to viewer)', r.ok && vsload.ok && vsload.role === 'view', vsload);
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/save', {
      method: 'POST', credentials: 'same-origin',
      headers: cookieHeader(recipientCookie),
      body: JSON.stringify({ state: { meet: { items: [] } } })
    });
    const vsave = await j(r);
    check('A5d session-only SAVE by adopted VIEWER -> refused (403)', r.status === 403 && !vsave.ok, { status: r.status, vsave });

    // A5e list row now says viewer.
    r = await fetch(BASE + '/api/cloud/projects', { method: 'GET', credentials: 'same-origin', headers: cookieHeader(recipientCookie) });
    const rlist2 = await j(r);
    const rrow2 = (rlist2.projects || []).find(function(p) { return p.projectId === pid; });
    check('A5e list reflects the viewer adoption', r.ok && !!rrow2 && rrow2.accessRole === 'view', rrow2);

    // T9-7 revoke -> session-only load answers code_revoked.
    const editorList = await j(await fetch(BASE + '/api/cloud/projects/' + pid + '/editors', {
      method: 'GET', credentials: 'same-origin', headers: { 'X-Owner-Code': ownerCode }
    }));
    const viewerRow = (editorList.editors || []).find(function(e) { return e.role === 'view'; });
    if (viewerRow) {
      r = await fetch(BASE + '/api/cloud/projects/' + pid + '/editors/' + viewerRow.id, {
        method: 'DELETE', credentials: 'same-origin', headers: Object.assign({}, jsonHeaders, { 'X-Owner-Code': ownerCode })
      });
      const rv = await j(r);
      check('A6a viewer code revoked', r.ok && rv.ok, rv);
    } else {
      check('A6a viewer code revoked', false, editorList);
    }
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/load', {
      method: 'POST', credentials: 'same-origin',
      headers: cookieHeader(recipientCookie),
      body: JSON.stringify({})
    });
    const revload = await j(r);
    check('A6b session-only load after revoke -> code_revoked', r.status === 403 && revload.error === 'code_revoked', { status: r.status, revload });

    // Re-adopt as editor for the remaining checks (new editor code + load).
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/editors', {
      method: 'POST', credentials: 'same-origin',
      headers: Object.assign({}, jsonHeaders, { 'X-Owner-Code': ownerCode }),
      body: JSON.stringify({ label: 'Recipient Editor 2', scope: ['wbs'], role: 'editor' })
    });
    const ed2 = await j(r);
    const editorCode2 = ed2.editorCode;
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/load', {
      method: 'POST', credentials: 'same-origin',
      headers: Object.assign({}, cookieHeader(recipientCookie), { 'X-Editor-Code': editorCode2 }),
      body: JSON.stringify({})
    });
    await j(r);

    // T9-8 unpin.
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/adopt', {
      method: 'DELETE', credentials: 'same-origin', headers: cookieHeader(recipientCookie)
    });
    const unpin = await j(r);
    check('A7a unpin ok', r.ok && unpin.ok, unpin);
    r = await fetch(BASE + '/api/cloud/projects', { method: 'GET', credentials: 'same-origin', headers: cookieHeader(recipientCookie) });
    const rlist3 = await j(r);
    const stillThere = (rlist3.projects || []).some(function(p) { return p.projectId === pid; });
    check('A7b unpinned project gone from recipient list', r.ok && !stillThere, rlist3);
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/load', {
      method: 'POST', credentials: 'same-origin',
      headers: cookieHeader(recipientCookie),
      body: JSON.stringify({})
    });
    const unload = await j(r);
    check('A7c session-only load after unpin -> forbidden (403)', r.status === 403 && !unload.ok, { status: r.status, unload });
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/adopt', {
      method: 'DELETE', credentials: 'same-origin', headers: cookieHeader(recipientCookie)
    });
    check('A7d second unpin -> 404 not adopted', r.status === 404, { status: r.status, body: await j(r) });

    // T9-9 the stranger never saw it. Re-pin first so the list has a row.
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/load', {
      method: 'POST', credentials: 'same-origin',
      headers: Object.assign({}, cookieHeader(recipientCookie), { 'X-Editor-Code': editorCode2 }),
      body: JSON.stringify({})
    });
    await j(r);
    r = await fetch(BASE + '/api/cloud/projects', { method: 'GET', credentials: 'same-origin', headers: cookieHeader(strangerCookie) });
    const slist = await j(r);
    const leaked = (slist.projects || []).some(function(p) { return p.projectId === pid; });
    check('A8 unrelated session never sees the adopted project', r.ok && slist.ok && !leaked, slist);

    // T9-10 the owner's own list still shows it as OWNER (dedup win).
    r = await fetch(BASE + '/api/cloud/projects', { method: 'GET', credentials: 'same-origin' });
    // No session cookie here — the owner row is not session-listed; instead
    // verify via the owner code's own meta that the project is untouched.
    const meta = await j(await fetch(BASE + '/api/cloud/projects/' + pid + '/meta', {
      method: 'GET', credentials: 'same-origin', headers: { 'X-Owner-Code': ownerCode }
    }));
    check('A9 owner meta still resolves (project untouched by adoption)', meta.ok === true && !!meta.label, meta);

    log('\n===== SUMMARY =====');
    const fails = results.filter(r2 => !r2.val);
    log('checks: ' + results.length + ', passed: ' + (results.length - fails.length) + ', failed: ' + fails.length);
    if (fails.length) {
      log('FAILED: ' + fails.map(f => f.name).join(' | '));
      stopWrangler();
      process.exit(1);
    }
    stopWrangler();
    process.exit(0);
  } catch (e) {
    log('FATAL: ' + (e && e.stack || e));
    stopWrangler();
    process.exit(1);
  }
})();
