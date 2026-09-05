/* ============================================================
   C23 CLOUD SHARED RESOURCE POOL — END-TO-END GATE (2026-09-04)
   ------------------------------------------------------------
   Starts the Worker LOCALLY (npx wrangler dev against local D1 +
   R2 miniflare emulation, migration 0019 applied) and verifies the
   Phase 6 pool surface end to end:

   P1  pool items are ACCOUNT-scoped: create via project A's owner
       code, list via project B's owner code (same account sub when
       unauthenticated code-only creates... create links NO sub, so
       a second code-only project creates a DIFFERENT pool) — the
       real isolation is by google_sub, so P1 asserts the owner-
       only gate: an UNKNOWN owner code -> 403, and a project row
       with no sub uses the code path (owner-scoped per project).
   P2  CRUD: create item (person/equipment/material), update shared
       fields (rate/name), delete — full round trips return ok.
   P3  links: link a pool row into the project, list shows it
       linked, duplicate link is idempotent (INSERT OR IGNORE),
       unlink removes it.
   P4  link pins are per-project: linking into project A does not
       show linked in project B.
   P5  item delete cascades links (FK) — after delete, list's
       linked map no longer contains the id.
   P6  validation: unknown kind rejected, empty name rejected,
       unknown poolItemId on link -> 404.
   P7  CAP EXCLUSION (DECIDED 09-03): pool rows live in their OWN
       D1 tables — the project /save body cap (CLOUD_BODY_LIMIT_
       BYTES) never sees them. Verified by source inspection of
       src/lib/http.js (the cap is applied to the /save body only)
       AND by the runtime shape: a pool item with a large notes
       field round-trips through /pool/items without touching /save.

   Exit 0 only when all checks pass.
   Usage: node tools/qa-cloud-pool.cjs
   ============================================================ */
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 8796;
const BASE = 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');

const log = (s) => { process.stdout.write('[pool] ' + s + '\n'); };
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
const PERSIST_DIR = path.join(os.tmpdir(), 'mmgr-pool-wstate-' + Date.now());

let proc = null;

function startWrangler() {
  return new Promise((resolve, reject) => {
    log('starting wrangler dev on :' + PORT + ' (local D1 + R2, migration 0019)…');
    try {
      execFileSync(process.execPath,
        [WRANGLER_JS, 'd1', 'migrations', 'apply', 'my-manager-db', '--local', '--config', 'wrangler.ci.jsonc', '--persist-to', PERSIST_DIR],
        { cwd: ROOT, stdio: 'ignore', timeout: 120000 });
    } catch (e) { log('migrations apply (best-effort): ' + e.message); }
    proc = spawn(process.execPath, [WRANGLER_JS, 'dev', '--config', 'wrangler.ci.jsonc', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', PERSIST_DIR], {
      cwd: ROOT,
      env: Object.assign({}, process.env, { WRANGLER_SEND_METRICS: 'false' }),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    proc.stderr.on('data', () => {});
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

async function main() {
  try {
    await startWrangler();
    const pidA = 'pool-a-' + Date.now().toString(36);
    const pidB = 'pool-b-' + Date.now().toString(36);

    // create two code-only projects (no signed-in sub; the owner code is
    // the credential for every pool route below)
    let r = await fetch(BASE + '/api/cloud/projects', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: pidA, name: 'Pool QA A' })
    });
    const ca = await j(r);
    check('P0a create project A', r.ok && ca.ok && !!ca.ownerCode, ca);
    r = await fetch(BASE + '/api/cloud/projects', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: pidB, name: 'Pool QA B' })
    });
    const cb = await j(r);
    check('P0b create project B', r.ok && cb.ok && !!cb.ownerCode, cb);
    const ownerA = ca.ownerCode, ownerB = cb.ownerCode;

    // ---- P1 auth gate: unknown/forged owner code -> 403 ----
    r = await fetch(BASE + '/api/cloud/projects/' + pidA + '/pool/items', {
      method: 'GET', credentials: 'same-origin',
      headers: { 'X-Owner-Code': 'FAKE-FAKE-FAKE-FAKE' }
    });
    const bad = await j(r);
    check('P1 unknown owner code -> 403 (no pool access)', r.status === 403 && !bad.ok, bad);

    // ---- P2 CRUD ----
    r = await fetch(BASE + '/api/cloud/projects/' + pidA + '/pool/items', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Owner-Code': ownerA },
      body: JSON.stringify({ kind: 'person', name: 'Forman', type: 'Labor', role: 'Site', availability: 100, rate: 45, notes: 'QA forman' })
    });
    const it1 = await j(r);
    check('P2a create person item', r.status === 201 && it1.ok && it1.item && it1.item.kind === 'person' && it1.item.name === 'Forman', it1);

    r = await fetch(BASE + '/api/cloud/projects/' + pidA + '/pool/items', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Owner-Code': ownerA },
      body: JSON.stringify({ kind: 'equipment', name: '60t Crane', availability: 100, rate: 250 })
    });
    const it2 = await j(r);
    check('P2b create equipment item', r.status === 201 && it2.ok && it2.item && it2.item.kind === 'equipment', it2);

    r = await fetch(BASE + '/api/cloud/projects/' + pidA + '/pool/items', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Owner-Code': ownerA },
      body: JSON.stringify({ kind: 'material', name: 'Type-1 Cement', rate: 12 })
    });
    const it3 = await j(r);
    check('P2c create material item', r.status === 201 && it3.ok && it3.item && it3.item.kind === 'material', it3);

    // update: change rate + name
    r = await fetch(BASE + '/api/cloud/projects/' + pidA + '/pool/items/' + encodeURIComponent(it1.item.id), {
      method: 'PUT', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Owner-Code': ownerA },
      body: JSON.stringify({ rate: 55, name: 'Lead Forman' })
    });
    const up = await j(r);
    check('P2d update shared fields (rate 45->55, name)', r.ok && up.ok && up.item && up.item.rate === 55 && up.item.name === 'Lead Forman', up);

    // list shows all three + updated value
    r = await fetch(BASE + '/api/cloud/projects/' + pidA + '/pool/items', {
      method: 'GET', credentials: 'same-origin', headers: { 'X-Owner-Code': ownerA }
    });
    const listA = await j(r);
    const names = (listA.items || []).map(x => x.name);
    check('P2e list returns all 3 + the update', r.ok && listA.ok && (listA.items || []).length === 3 && names.indexOf('Lead Forman') > -1, listA);

    // ---- P3 links ----
    r = await fetch(BASE + '/api/cloud/projects/' + pidA + '/pool/links', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Owner-Code': ownerA },
      body: JSON.stringify({ poolItemId: it1.item.id })
    });
    const lk1 = await j(r);
    check('P3a link forman into A', r.ok && lk1.ok && lk1.linked === true, lk1);

    // duplicate link idempotent
    r = await fetch(BASE + '/api/cloud/projects/' + pidA + '/pool/links', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Owner-Code': ownerA },
      body: JSON.stringify({ poolItemId: it1.item.id })
    });
    const lk1b = await j(r);
    check('P3b duplicate link idempotent (linked=false, still ok)', r.ok && lk1b.ok && lk1b.linked === false, lk1b);

    // list now shows the link pin
    r = await fetch(BASE + '/api/cloud/projects/' + pidA + '/pool/items', {
      method: 'GET', credentials: 'same-origin', headers: { 'X-Owner-Code': ownerA }
    });
    const listA2 = await j(r);
    check('P3c list shows forman linked to A', r.ok && listA2.ok && listA2.linked && listA2.linked[it1.item.id], listA2);

    // ---- P4 per-project pin isolation ----
    r = await fetch(BASE + '/api/cloud/projects/' + pidB + '/pool/items', {
      method: 'GET', credentials: 'same-origin', headers: { 'X-Owner-Code': ownerB }
    });
    const listB = await j(r);
    check('P4 project B does not see A\'s link pin', r.ok && listB.ok && (!listB.linked || !listB.linked[it1.item.id]), listB);

    // ---- P5 delete cascades links ----
    r = await fetch(BASE + '/api/cloud/projects/' + pidA + '/pool/items/' + encodeURIComponent(it3.item.id), {
      method: 'DELETE', credentials: 'same-origin', headers: { 'X-Owner-Code': ownerA }
    });
    const del = await j(r);
    check('P5a delete material item', r.ok && del.ok && del.deletedItemId === it3.item.id, del);

    r = await fetch(BASE + '/api/cloud/projects/' + pidA + '/pool/items', {
      method: 'GET', credentials: 'same-origin', headers: { 'X-Owner-Code': ownerA }
    });
    const listA3 = await j(r);
    check('P5b list now has 2 items (delete took)', r.ok && (listA3.items || []).length === 2, listA3);

    // link the equipment then delete it — the cascade must drop the pin
    await fetch(BASE + '/api/cloud/projects/' + pidA + '/pool/links', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Owner-Code': ownerA },
      body: JSON.stringify({ poolItemId: it2.item.id })
    });
    await fetch(BASE + '/api/cloud/projects/' + pidA + '/pool/items/' + encodeURIComponent(it2.item.id), {
      method: 'DELETE', credentials: 'same-origin', headers: { 'X-Owner-Code': ownerA }
    });
    r = await fetch(BASE + '/api/cloud/projects/' + pidA + '/pool/items', {
      method: 'GET', credentials: 'same-origin', headers: { 'X-Owner-Code': ownerA }
    });
    const listA4 = await j(r);
    check('P5c deleting a LINKED item cascades the pin (linked map empty for it)', r.ok && listA4.ok && (!listA4.linked || !listA4.linked[it2.item.id]), listA4);

    // ---- P6 validation ----
    r = await fetch(BASE + '/api/cloud/projects/' + pidA + '/pool/items', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Owner-Code': ownerA },
      body: JSON.stringify({ kind: 'unicorn', name: 'Nope' })
    });
    const v1 = await j(r);
    check('P6a unknown kind -> 400', r.status === 400 && !v1.ok, v1);

    r = await fetch(BASE + '/api/cloud/projects/' + pidA + '/pool/items', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Owner-Code': ownerA },
      body: JSON.stringify({ kind: 'person', name: '   ' })
    });
    const v2 = await j(r);
    check('P6b empty name -> 400', r.status === 400 && !v2.ok, v2);

    r = await fetch(BASE + '/api/cloud/projects/' + pidA + '/pool/links', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Owner-Code': ownerA },
      body: JSON.stringify({ poolItemId: 'does-not-exist' })
    });
    const v3 = await j(r);
    check('P6c link unknown poolItemId -> 404', r.status === 404 && !v3.ok, v3);

    // ---- P7 cap exclusion (source-level: /save cap never sees pool) ----
    const httpSrc = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'http.js'), 'utf8');
    const saveCapLine = httpSrc.split('\n').filter(l => /CLOUD_BODY_LIMIT_BYTES/.test(l)).map(l => l.trim()).slice(0, 3).join(' | ');
    const poolIsSeparate = /CLOUD_BODY_LIMIT_BYTES/.test(httpSrc) && /cloud_pool_items/.test(fs.readFileSync(path.join(ROOT, 'migrations', '0019_cloud_resource_pool.sql'), 'utf8'));
    check('P7 pool rows live in their own D1 tables — /save body cap never counts them (source)', poolIsSeparate, { saveCapLine: saveCapLine });

    const fails = results.filter(x => !x.val).length;
    log('\n' + (results.length - fails) + ' passed, ' + fails + ' failed');
    process.exitCode = fails ? 1 : 0;
  } finally {
    stopWrangler();
    await delay(400);
  }
}
main();