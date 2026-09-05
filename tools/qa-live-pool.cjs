/* ============================================================
   LIVE C23 POOL END-TO-END (2026-09-04)
   Drives the PRODUCTION worker at QA_BASE with a real email
   session + three real cloud projects:

   Scenario A (account-scoped shared pool — the real C23 story):
     - register a QA email -> mmgr_session cookie
     - create project A + B under the SAME session (google_sub
       set on both -> account-wide pool namespace)
     - A adds pool rows; B sees them (shared account pool)
     - B links a row (cross-project link works in one account)
     - link pins are per-project (A does NOT show B's pin)
     - B updates a shared field; A sees the update on refresh

   Scenario B (code-only isolation — the offline-first fallback):
     - create project C WITHOUT a session (google_sub null ->
       per-project namespace 'project:C')
     - C's pool list is empty (isolated from the account pool)
     - C linking an account row -> 404 (not in C's namespace)

   Cleanup: pool rows deleted (cascade links), projects purged via
   owner codes, QA account deleted via /api/auth/delete-account.
   Exit 0 only when all checks pass.
   Usage: QA_BASE=https://... node tools/qa-live-pool.cjs
   ============================================================ */
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8787';
// QA_D1_VERIFY=1 lets the harness complete email verification itself via
// remote D1 (wrangler d1 execute), mirroring exactly what the confirmation
// email link does (UPDATE auth_users SET email_verified=1). The live worker
// has RESEND configured, so a REAL register mints a verify token and tries
// to send mail — but the QA address (example.com) can never receive it, so
// without this seam the session-linked (google_sub) scenario is untestable
// on the live site. The harness deletes the QA account in cleanup.
const D1_VERIFY = process.env.QA_D1_VERIFY === '1';
const ROOT = path.resolve(__dirname, '..');
const EMAIL = 'qa-pool-live-' + Date.now() + '@example.com';
const PASSWORD = 'QaPool!2026x';
const stamp = Date.now().toString(36);
const PID_A = 'qa-pool-a-' + stamp;
const PID_B = 'qa-pool-b-' + stamp;
const PID_C = 'qa-pool-c-' + stamp;

const log = (s) => { process.stdout.write('[live-pool] ' + s + '\n'); };
const results = [];
const check = (name, val, detail) => {
  results.push({ name, val });
  log((val ? 'PASS' : 'FAIL') + '  ' + name + (val ? '' : '   <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 500)));
};

async function req(path, opts = {}) {
  const r = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers: Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {}),
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
  });
  let j = null;
  try { j = await r.json(); } catch (e) { /* non-JSON */ }
  return { status: r.status, headers: r.headers, body: j, ok: r.ok };
}

(async function () {
  let cookie = '';
  // 1. Register + mint the session cookie
  let r = await req('/api/auth/register', { method: 'POST', body: { email: EMAIL, password: PASSWORD, name: 'QA Pool Live' } });
  const sc = r.headers.get('set-cookie') || '';
  const m = sc.match(/mmgr_session=([^;]+)/);
  if (m) cookie = m[1];
  check('L1 register QA email + session cookie minted', r.ok && !!cookie && r.body && r.body.user && r.body.user.sub === 'email:' + EMAIL, { reg: r.body, hasCookie: !!cookie });

  // Self-verify via remote D1 when asked (the email link's exact action).
  // wrangler is invoked through its JS entry (node .../bin/wrangler.js) so the
  // .cmd shim / shell-quoting problems on Windows never arise.
  if (D1_VERIFY && cookie) {
    try {
      const db = process.env.QA_D1_NAME || 'my-manager-db';
      const wranglerJs = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
      execFileSync(process.execPath, [wranglerJs, 'd1', 'execute', db, '--remote', '--command',
        "UPDATE auth_users SET email_verified = 1 WHERE email = '" + EMAIL + "'"],
        { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
      log('QA email verified via remote D1 (email-link equivalent)');
    } catch (e) {
      log('D1 verify failed (non-fatal, later creates will 403): ' + String(e && e.stderr || e).slice(0, 200));
    }
  }

  const authHeaders = { Cookie: 'mmgr_session=' + cookie };
  const ownerHeadersA = Object.assign({ 'X-Owner-Code': 'PLACEHOLDER' }, authHeaders);
  const ownerHeadersB = Object.assign({ 'X-Owner-Code': 'PLACEHOLDER' }, authHeaders);
  const ownerHeadersC = { 'X-Owner-Code': 'PLACEHOLDER' };

  // 2. Create A + B with the session (account-scoped pool), C code-only
  r = await req('/api/cloud/projects', { method: 'POST', headers: authHeaders, body: { projectId: PID_A, name: 'QA Pool Project A' } });
  check('L2 create project A (session-linked)', r.ok && r.body && r.body.ok && !!r.body.ownerCode, r.body);
  if (r.body && r.body.ownerCode) ownerHeadersA['X-Owner-Code'] = r.body.ownerCode;

  r = await req('/api/cloud/projects', { method: 'POST', headers: authHeaders, body: { projectId: PID_B, name: 'QA Pool Project B' } });
  check('L3 create project B (session-linked)', r.ok && r.body && r.body.ok && !!r.body.ownerCode, r.body);
  if (r.body && r.body.ownerCode) ownerHeadersB['X-Owner-Code'] = r.body.ownerCode;

  r = await req('/api/cloud/projects', { method: 'POST', body: { projectId: PID_C, name: 'QA Pool Project C (code-only)' } });
  check('L4 create project C (code-only, no session)', r.ok && r.body && r.body.ok && !!r.body.ownerCode && r.body.linked === false, r.body);
  if (r.body && r.body.ownerCode) ownerHeadersC['X-Owner-Code'] = r.body.ownerCode;

  let item1 = null, item2 = null;
  try {
    // 3. A adds pool rows (account namespace = email sub)
    r = await req('/api/cloud/projects/' + PID_A + '/pool/items', { method: 'POST', headers: ownerHeadersA, body: { name: 'Forman Garcia', kind: 'person', role: 'Lead Carpenter', availability: 90, rate: 48, notes: 'QA live row' } });
    item1 = r.body && r.body.item ? r.body.item : null;
    check('L5 A creates pool person row', r.ok && r.body && r.body.ok && !!item1 && item1.kind === 'person' && item1.name === 'Forman Garcia', r.body);

    r = await req('/api/cloud/projects/' + PID_A + '/pool/items', { method: 'POST', headers: ownerHeadersA, body: { name: '60t Crane', kind: 'equipment', rate: 120, availability: 100 } });
    item2 = r.body && r.body.item ? r.body.item : null;
    check('L6 A creates pool equipment row', r.ok && r.body && r.body.ok && !!item2 && item2.kind === 'equipment', r.body);

    // 4. B sees the SAME pool (account-scoped across projects)
    r = await req('/api/cloud/projects/' + PID_B + '/pool/items', { method: 'GET', headers: ownerHeadersB });
    const itemsB = (r.body && r.body.items) || [];
    check('L7 B lists the account pool (shared across projects)', r.ok && item1 && item2 && itemsB.length === 2 && itemsB.some(i => i.id === item1.id) && itemsB.some(i => i.id === item2.id), { items: itemsB.map(i => i.name) });

    // 5. B links A's row (cross-project link in one account)
    if (item1) {
      r = await req('/api/cloud/projects/' + PID_B + '/pool/links', { method: 'POST', headers: ownerHeadersB, body: { poolItemId: item1.id } });
      check('L8 B links Forman into project B', r.ok && r.body && r.body.ok && r.body.linked === true, r.body);

      r = await req('/api/cloud/projects/' + PID_B + '/pool/items', { method: 'GET', headers: ownerHeadersB });
      check('L9 B list shows Forman linked', r.ok && r.body && r.body.linked && r.body.linked[item1.id], r.body);

      // link pins are per-project: A does NOT show B's pin
      r = await req('/api/cloud/projects/' + PID_A + '/pool/items', { method: 'GET', headers: ownerHeadersA });
      check('L10 A does NOT see B\'s link pin (pins are per-project)', r.ok && r.body && (!r.body.linked || !r.body.linked[item1.id]), r.body);

      // 6. B updates a shared field; A sees it (shared-fields propagate)
      r = await req('/api/cloud/projects/' + PID_B + '/pool/items/' + item1.id, { method: 'PUT', headers: ownerHeadersB, body: { rate: 52 } });
      check('L11 B updates shared rate to 52', r.ok && r.body && r.body.ok && Number(r.body.item.rate) === 52, r.body);
      r = await req('/api/cloud/projects/' + PID_A + '/pool/items', { method: 'GET', headers: ownerHeadersA });
      const itemsA = (r.body && r.body.items) || [];
      const updated = itemsA.find(i => i.id === item1.id);
      check('L12 A sees the shared-field update (rate 52)', r.ok && updated && Number(updated.rate) === 52, updated);
    } else {
      check('L8 B links Forman into project B', false, { skipped: 'item1 missing' });
      check('L9 B list shows Forman linked', false, { skipped: 'item1 missing' });
      check('L10 A does NOT see B\'s link pin (pins are per-project)', false, { skipped: 'item1 missing' });
      check('L11 B updates shared rate to 52', false, { skipped: 'item1 missing' });
      check('L12 A sees the shared-field update (rate 52)', false, { skipped: 'item1 missing' });
    }

    // 7. code-only project C: isolated pool + cannot link account rows
    r = await req('/api/cloud/projects/' + PID_C + '/pool/items', { method: 'GET', headers: ownerHeadersC });
    check('L13 C (code-only) sees an EMPTY pool (isolated namespace)', r.ok && r.body && r.body.ok && (!r.body.items || r.body.items.length === 0), r.body);

    if (item1) {
      r = await req('/api/cloud/projects/' + PID_C + '/pool/links', { method: 'POST', headers: ownerHeadersC, body: { poolItemId: item1.id } });
      check('L14 C linking the account row -> 404 (not in C\'s namespace)', r.status === 404, { status: r.status, body: r.body });
    } else {
      check('L14 C linking the account row -> 404 (not in C\'s namespace)', false, { skipped: 'item1 missing' });
    }

    // 8. delete cascades links (B's pin to item2 after linking it, then delete item2)
    if (item2) {
      r = await req('/api/cloud/projects/' + PID_B + '/pool/links', { method: 'POST', headers: ownerHeadersB, body: { poolItemId: item2.id } });
      check('L15 B links crane into project B', r.ok && r.body && r.body.ok && r.body.linked === true, r.body);
      r = await req('/api/cloud/projects/' + PID_A + '/pool/items/' + item2.id, { method: 'DELETE', headers: ownerHeadersA });
      check('L16 A deletes crane (account row)', r.ok && r.body && r.body.ok, r.body);
      r = await req('/api/cloud/projects/' + PID_B + '/pool/items', { method: 'GET', headers: ownerHeadersB });
      check('L17 B list no longer contains crane AND its pin is gone', r.ok && !(r.body.items || []).some(i => i.id === item2.id) && (!r.body.linked || !r.body.linked[item2.id]), r.body);
    } else {
      check('L15 B links crane into project B', false, { skipped: 'item2 missing' });
      check('L16 A deletes crane (account row)', false, { skipped: 'item2 missing' });
      check('L17 B list no longer contains crane AND its pin is gone', false, { skipped: 'item2 missing' });
    }
  } finally {
    // ---- CLEANUP (best-effort, never fails the gate) ----
    try {
      if (item1) await req('/api/cloud/projects/' + PID_A + '/pool/items/' + item1.id, { method: 'DELETE', headers: ownerHeadersA });
      if (item2) await req('/api/cloud/projects/' + PID_A + '/pool/items/' + item2.id, { method: 'DELETE', headers: ownerHeadersA });
      // Purge is the PATH-SEGMENT form (…/<pid>/purge) — the same shape
      // admin.html uses. The ?op=purge query form is NOT a route and 404s.
      if (ownerHeadersA['X-Owner-Code'] !== 'PLACEHOLDER') {
        await req('/api/cloud/projects/' + PID_A + '/purge', { method: 'POST', headers: ownerHeadersA });
      }
      if (ownerHeadersB['X-Owner-Code'] !== 'PLACEHOLDER') {
        await req('/api/cloud/projects/' + PID_B + '/purge', { method: 'POST', headers: ownerHeadersB });
      }
      if (ownerHeadersC['X-Owner-Code'] !== 'PLACEHOLDER') {
        await req('/api/cloud/projects/' + PID_C + '/purge', { method: 'POST', headers: ownerHeadersC });
      }
      await req('/api/auth/delete-account', { method: 'POST', headers: authHeaders, body: { password: PASSWORD } });
      log('cleanup complete (pool rows, projects purged, QA account deleted)');
    } catch (e) { log('cleanup error (non-fatal): ' + e.message); }
  }

  const failed = results.filter(x => !x.val);
  log('----');
  log(failed.length ? (failed.length + ' FAILED') : 'ALL ' + results.length + ' LIVE POOL GATES PASSED');
  process.exit(failed.length ? 1 : 0);
})().catch(e => { log('FATAL: ' + (e && e.stack || e)); process.exit(2); });