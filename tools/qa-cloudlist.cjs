/* ============================================================
   qa-cloudlist.cjs — T-CLOUDLIST (I-1, BUDGET-BOQ-MCP 2026-11-05)
   ------------------------------------------------------------
   I-1 (owner, spoken audit): "I upload to the cloud ... I log out of
   Google, log back in, and my cloud projects are not the same ones I
   uploaded. Any other device signed in to that account should show
   them. It is shocking."

   This harness reproduces the SERVER contract for that report without a
   real Google OAuth round trip: it forges Google-shaped session cookies
   (same technique as qa-team-rbac.cjs) so two cookies that share one
   `sub` model "two devices / a re-sign-in of the same account", and a
   third cookie with a different `sub` models "a different account".

   It then asserts the gate from the directive:
     T1  create + save a project under account A       -> 200
     T2  list under A shows the project                -> present, hasSnapshot
     T3  list under B (same sub, second device) shows -> present  (cross-device)
     T4  edit on A, list under B reflects new save    -> updatedAt advanced
     T5  list under C (different sub) NEVER shows it  -> isolated
     T6  the save result names the outcome plainly     -> ok:true, savedAt set

   A passing harness here proves the server list/save key correctly on the
   signed-in account; a failure pinpoints the server cause (project written
   under a different key, filtered, or an error swallowed). Self-hosts its
   own wrangler dev (local D1) like qa-team-rbac.cjs.
   ============================================================ */
'use strict';
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = parseInt(process.env.QA_PORT || '8820', 10);
const BASE = 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');
const TMP = os.tmpdir();

// The session cookie HMAC secret MUST equal what the Worker reads for the
// session signing key. qa-team-rbac proves the Worker uses GOOGLE_CLIENT_SECRET
// for that, so we pass the same value through --var below.
const SECRET = 'qa-cloudlist-secret-3b7e9c12';
const ADMIN_CODE = 'qa-admin-cloudlist-9d41';
const FREE_CAP = '200';

const ALICE_EMAIL = 'i1.alice.cloudlist@example.com';
const OTHER_EMAIL = 'i1.other.cloudlist@example.com';

const log = s => {
  process.stdout.write('[cloudlist] ' + s + '\n');
};
const delay = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, val, detail) => {
  results.push({ name, val });
  log(
    (val ? 'PASS' : 'FAIL') +
      '  ' +
      name +
      (val ? '' : '   <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 500))
  );
};

// ---- wrangler scaffolding (mirrors qa-team-rbac.cjs) ----------------------
function globalWranglerJs() {
  try {
    const lp = path.join(__dirname, '..', 'node_modules', 'wrangler', 'bin', 'wrangler.js');
    if (fs.existsSync(lp)) {
      return lp;
    }
  } catch (e) {
    /* fall through */
  }
  try {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const root = execFileSync(npmCmd, ['root', '-g'], {
      encoding: 'utf8',
      shell: process.platform === 'win32'
    }).trim();
    const p = path.join(root, 'wrangler', 'bin', 'wrangler.js');
    if (fs.existsSync(p)) {
      return p;
    }
  } catch (e) {
    /* fall through */
  }
  return null;
}
const WRANGLER_JS = globalWranglerJs();
const PERSIST_DIR = path.join(TMP, 'mmgr-cloudlist-wstate-' + Date.now());
const { stopWranglerIfLocal } = require('./wrangler-ci-helpers.cjs');

let proc = null;
let devLog = '';
async function startWrangler() {
  log('starting wrangler dev on :' + PORT + '…');
  try {
    execFileSync(
      process.execPath,
      [
        WRANGLER_JS,
        'd1',
        'migrations',
        'apply',
        'my-manager-db',
        '--local',
        '--config',
        'wrangler.ci.jsonc',
        '--persist-to',
        PERSIST_DIR
      ],
      { cwd: ROOT, stdio: 'ignore', timeout: 120000 }
    );
  } catch (e) {
    log('migrations apply (best-effort): ' + e.message);
  }
  const args = [
    WRANGLER_JS,
    'dev',
    '--config',
    'wrangler.ci.jsonc',
    '--port',
    String(PORT),
    '--ip',
    '127.0.0.1',
    '--persist-to',
    PERSIST_DIR,
    '--var',
    'GOOGLE_CLIENT_SECRET:' + SECRET,
    '--var',
    'ADMIN_CODE:' + ADMIN_CODE,
    '--var',
    'FREE_PROJECT_CAP:' + FREE_CAP
  ];
  proc = spawn(process.execPath, args, {
    cwd: ROOT,
    env: Object.assign({}, process.env, { WRANGLER_SEND_METRICS: 'false' }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  proc.stdout.on('data', d => {
    devLog += d;
  });
  proc.stderr.on('data', d => {
    devLog += d;
  });
  proc.on('error', e => {
    throw new Error('wrangler spawn failed: ' + e.message);
  });
  const t0 = Date.now();
  for (;;) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(function () {
        ctrl.abort();
      }, 3000);
      const r = await fetch(BASE + '/api/health', { signal: ctrl.signal });
      clearTimeout(timer);
      if (r.ok) {
        return;
      }
    } catch (e) {
      /* not up yet */
    }
    if (Date.now() - t0 > 120000) {
      throw new Error('wrangler dev did not come up in 120s');
    }
    await delay(1500);
  }
}
function stopWrangler() {
  stopWranglerIfLocal(proc);
  try {
    proc && proc.kill();
  } catch (e) {
    /* ignore */
  }
}

// ---- Google-shaped session forgery (same technique as qa-team-rbac) --------
function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
function mintGoogleCookie(email, name, sub) {
  const payload = {
    sub: sub,
    email: email,
    name: name || 'Google User',
    exp: Math.floor(Date.now() / 1000) + 3600
  };
  const json = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', SECRET).update(json).digest();
  return 'mmgr_session=' + b64url(json) + '.' + b64url(sig);
}
function ck(cookie) {
  return cookie ? { Cookie: cookie } : {};
}

async function api(pathname, opts) {
  const res = await fetch(BASE + pathname, Object.assign({}, opts || {}));
  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    body = null;
  }
  return { status: res.status, body, headers: res.headers };
}

// ---- assertions ------------------------------------------------------------
function listHas(list, pid) {
  const projects = (list && list.body && list.body.projects) || [];
  return projects.some(p => p.projectId === pid);
}
function listRow(list, pid) {
  const projects = (list && list.body && list.body.projects) || [];
  return projects.find(p => p.projectId === pid) || null;
}

async function main() {
  await startWrangler();

  const subA = 'google-i1-' + crypto.randomBytes(8).toString('hex');
  // B shares A's sub: "second device, same account".
  const cookieA = mintGoogleCookie(ALICE_EMAIL, 'Alice One', subA);
  const cookieB = mintGoogleCookie(ALICE_EMAIL, 'Alice One', subA);
  // C is a different account entirely.
  const cookieC = mintGoogleCookie(
    OTHER_EMAIL,
    'Other Person',
    'google-i1-other-' + crypto.randomBytes(8).toString('hex')
  );

  const pid = 'i1proj-' + Date.now().toString(36);

  // T1: create + save under A.
  const created = await api('/api/cloud/projects', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(cookieA)),
    body: JSON.stringify({ projectId: pid, name: 'I-1 Reproduction' })
  });
  check(
    'T-CLOUDLIST create project under account A returns 200 ok',
    created.status === 200 && created.body && created.body.ok === true,
    {
      status: created.status,
      body: created.body
    }
  );

  const saved = await api('/api/cloud/projects/' + encodeURIComponent(pid) + '/save', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(cookieA)),
    body: JSON.stringify({
      state: { projectName: 'I-1 Reproduction', updatedAt: new Date().toISOString() }
    })
  });
  check(
    'T-CLOUDLIST save returns ok:true with a savedAt (plain outcome, no silent no-op)',
    saved.status === 200 && saved.body && saved.body.ok === true && !!saved.body.savedAt,
    { status: saved.status, body: saved.body }
  );

  // T2: list under A shows it.
  const listA1 = await api('/api/cloud/projects', { method: 'GET', headers: ck(cookieA) });
  check(
    'T-CLOUDLIST list under A shows the uploaded project (hasSnapshot)',
    listHas(listA1, pid) && listRow(listA1, pid).hasSnapshot === true,
    {
      status: listA1.status,
      count: ((listA1.body && listA1.body.projects) || []).length
    }
  );

  // T3: list under B (same sub, second device) shows it.
  const listB = await api('/api/cloud/projects', { method: 'GET', headers: ck(cookieB) });
  check('T-CLOUDLIST second device (same account sub) lists the project', listHas(listB, pid), {
    status: listB.status,
    count: ((listB.body && listB.body.projects) || []).length
  });

  // T4: edit on A, list under B reflects the newer save.
  const firstSavedAt = (listRow(listA1, pid) || {}).updatedAt;
  await delay(1100);
  const saved2 = await api('/api/cloud/projects/' + encodeURIComponent(pid) + '/save', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(cookieA)),
    body: JSON.stringify({
      state: { projectName: 'I-1 Reproduction v2', updatedAt: new Date().toISOString() }
    })
  });
  const listB2 = await api('/api/cloud/projects', { method: 'GET', headers: ck(cookieB) });
  const rowB2 = listRow(listB2, pid);
  check(
    'T-CLOUDLIST edit on one device appears on the other (savedAt advanced)',
    rowB2 && firstSavedAt && rowB2.updatedAt && rowB2.updatedAt > firstSavedAt,
    { firstSavedAt, second: rowB2 && rowB2.updatedAt }
  );

  // T5: a different account never sees it.
  const listC = await api('/api/cloud/projects', { method: 'GET', headers: ck(cookieC) });
  check('T-CLOUDLIST a different account NEVER sees the project', !listHas(listC, pid), {
    status: listC.status,
    count: ((listC.body && listC.body.projects) || []).length
  });

  const passed = results.filter(r => r.val).length;
  log('');
  log('RESULT ' + passed + '/' + results.length);
  if (passed !== results.length) {
    process.exitCode = 1;
  }
}

main()
  .catch(e => {
    log('PROBE-ERROR: ' + (e && e.message));
    if (devLog) {
      log('--- wrangler log (last 1500 chars) ---');
      log(devLog.slice(-1500));
    }
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      stopWrangler();
    } catch (e) {
      /* ignore */
    }
  });
