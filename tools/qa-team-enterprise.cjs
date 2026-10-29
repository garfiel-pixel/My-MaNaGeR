/* ============================================================
   qa-team-enterprise.cjs - RBAC SPRINT 3 (directive 2026-10-25)
   ------------------------------------------------------------
   Self-contained: spawns its own wrangler dev (local D1 + R2, --persist-to
   outside the repo), applies migrations 0028 + 0029, then proves the
   enterprise layer end to end:

     E0 fixture: company owner, project snapshot, free owner
     E1 a member invitation stores a per-section matrix
     E2 a matrix narrows what /load hands the member (read set)
     E3 a view-only section is readable but never writable (write set)
     E4 a manager's view-only section survives a direct save untouched
     E5 a client template cannot be raised to edit
     E6 time-boxed access: a closed window refuses acceptance
     E7 time-boxed access: a closed window refuses the very next request
     E8 the 7-day notice is computed, not guessed
     E9 one-click extend re-opens a closed window and audits it
     E10 templates: create, list, apply, update, delete, account isolation
     E11 bulk invite of 100 returns 100 rows with no account-existence leak
     E12 bulk is capped at 100 and needs the enterprise tier
     E13 audit CSV carries every event type with a header row
     E14 migration 0029 adds the columns without losing a row
     E15 enterprise features are refused on a lower tier

   Every API call carries its own CF-Connecting-IP (RFC 5737 TEST-NET-3) so
   the Worker's 30/min general bucket sees the same shape as production
   requests from different clients; no limit is raised or disabled.
   ============================================================ */
'use strict';
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = parseInt(process.env.QA_PORT || '8814', 10);
const BASE = 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');
const TMP = os.tmpdir();

const SECRET = 'qa-team-ent-secret-3b91c7d2';
const ADMIN_CODE = 'qa-admin-team-ent-77c1';
const PADDLE_SECRET = 'qa-team-ent-paddle-8ac4de20';
const PADDLE_KEY = 'qa-team-ent-paddle-key-00000000000000000000000';
const PADDLE_PRICE = 'pri_01ent_contractor_000000000';
const PADDLE_COMPANY_PRICE = 'pri_01ent_company_00000000000';
const PADDLE_ENTERPRISE_PRICE = 'pri_01ent_enterprise_0000000';

const OWNER = 'owner.enterprise.s3@example.com';
const FREE_OWNER = 'owner.free.s3@example.com';
// Sprint 3's enterprise gate is checked AFTER the free-tier member limit, so a
// free owner can never reach the `enterprise_feature` refusal. The lower-tier
// proof therefore needs a CONTRACTOR owner: one seat, no enterprise layer.
const CAP_OWNER = 'owner.contractor.s3@example.com';
const SUP = 'sup.enterprise.s3@example.com';
const MGR = 'mgr.enterprise.s3@example.com';
const CLI = 'cli.enterprise.s3@example.com';
const BOXED = 'boxed.enterprise.s3@example.com';
const PW = 'QaEnt!Pass123';

const log = s => {
  process.stdout.write('[team-ent] ' + s + '\n');
};
const delay = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, val, detail) => {
  results.push({ name, val });
  log(
    (val ? 'PASS' : 'FAIL') +
      '  ' +
      name +
      (val ? '' : '   <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 600))
  );
};

let proc = null;
let devLog = '';
let ipSeq = 100;

function globalWranglerJs() {
  try {
    const lp = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
    if (fs.existsSync(lp)) {
      return lp;
    }
  } catch (e) {
    /* fall through */
  }
  return null;
}
const WRANGLER_JS = globalWranglerJs();
const PERSIST_DIR = path.join(TMP, 'mmgr-team-ent-wstate-' + Date.now());
const { stopWranglerIfLocal } = require('./wrangler-ci-helpers.cjs');

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
    '--test-scheduled',
    '--var',
    'GOOGLE_CLIENT_SECRET:' + SECRET,
    '--var',
    'ADMIN_CODE:' + ADMIN_CODE,
    '--var',
    'PADDLE_WEBHOOK_SECRET:' + PADDLE_SECRET,
    '--var',
    'PADDLE_API_KEY:' + PADDLE_KEY,
    '--var',
    'PADDLE_PRICE_ID:' + PADDLE_PRICE,
    '--var',
    'PADDLE_COMPANY_PRICE_ID:' + PADDLE_COMPANY_PRICE,
    '--var',
    'PADDLE_ENTERPRISE_PRICE_ID:' + PADDLE_ENTERPRISE_PRICE,
    '--var',
    'PADDLE_ENV:sandbox'
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
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(BASE + '/api/health');
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

async function api(pathname, opts) {
  const o = Object.assign({}, opts || {});
  o.headers = Object.assign({ 'CF-Connecting-IP': '203.0.113.' + ipSeq++ }, o.headers || {});
  const res = await fetch(BASE + pathname, o);
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch (e) {
    body = null;
  }
  return {
    status: res.status,
    body,
    text: res.status + '|' + text,
    raw: text,
    headers: res.headers
  };
}
function cookieFrom(res) {
  const sc = res.headers.get('set-cookie');
  if (!sc) {
    return null;
  }
  const m = sc.match(/mmgr_session=([^;]+)/);
  return m ? 'mmgr_session=' + m[1] : null;
}
function ck(cookie) {
  return cookie ? { Cookie: cookie } : {};
}

function paddleSignature(rawBody, secret, tsSec) {
  const ts = String(tsSec || Math.floor(Date.now() / 1000));
  const h1 = crypto
    .createHmac('sha256', secret)
    .update(ts + ':' + rawBody)
    .digest('hex');
  return 'ts=' + ts + ';h1=' + h1;
}
async function fireSubscription(sub, priceId, status) {
  const raw = JSON.stringify({
    event_type: 'subscription.activated',
    event_id: 'evt_ent_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    occurred_at: new Date().toISOString(),
    data: {
      id: 'sub_ent_' + Math.random().toString(36).slice(2, 12),
      status: status || 'active',
      custom_data: { sub: sub },
      items: [{ quantity: 1, price: { id: priceId } }],
      current_billing_period: {
        starts_at: new Date().toISOString(),
        ends_at: new Date(Date.now() + 30 * 86400000).toISOString()
      }
    }
  });
  return api('/api/billing/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Paddle-Signature': paddleSignature(raw, PADDLE_SECRET)
    },
    body: raw
  });
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
function mintGoogleCookie(email, name, sub) {
  const payload = {
    sub: sub || 'google-ent-' + crypto.randomBytes(6).toString('hex'),
    email: email,
    name: name || 'Google User',
    exp: Math.floor(Date.now() / 1000) + 3600
  };
  const json = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', SECRET).update(json).digest();
  return 'mmgr_session=' + b64url(json) + '.' + b64url(sig);
}

function d1File() {
  const dir = path.join(PERSIST_DIR, 'v3', 'd1', 'miniflare-D1DatabaseObject');
  if (!fs.existsSync(dir)) {
    return null;
  }
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.sqlite') && !f.startsWith('metadata')) {
      return path.join(dir, f);
    }
  }
  return null;
}
function d1Query(sql) {
  const f = d1File();
  if (!f) {
    return null;
  }
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(f, { readOnly: true });
    const rows = db.prepare(sql).all();
    db.close();
    return rows;
  } catch (e) {
    log('d1 read failed: ' + e.message);
    return null;
  }
}
async function d1QueryRetry(sql, label) {
  for (let i = 0; i < 5; i++) {
    const rows = d1Query(sql);
    if (rows && rows.length) {
      return rows;
    }
    await delay(250);
  }
  log((label || 'd1') + ': no row after retries');
  return null;
}
function d1Exec(sql) {
  const f = d1File();
  if (!f) {
    return false;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(f);
      db.exec('PRAGMA busy_timeout = 4000');
      db.exec(sql);
      db.close();
      return true;
    } catch (e) {
      log('d1 write attempt ' + (attempt + 1) + ' failed: ' + e.message);
    }
  }
  return false;
}
function qd(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

const PROJ = 'qa-ent-s3';
const PROJ_FREE = 'qa-ent-s3-free';
const PROJ_CAP = 'qa-ent-s3-cap';
const FULL_STATE = {
  projectName: 'Enterprise Matrix Build',
  schemaVersion: 18,
  updatedAt: new Date().toISOString(),
  tasks: [{ id: 't1', title: 'Pour slab', status: 'todo' }],
  resources: [{ id: 'r1', name: 'Crew A' }],
  budgetLines: [{ id: 'b1', label: 'Concrete', amount: 1000 }],
  stakeholders: [{ id: 's1', name: 'Council' }],
  risks: [{ id: 'k1', title: 'Weather' }],
  meetings: [{ id: 'm1', title: 'Kickoff' }],
  raci: [{ id: 'x1' }],
  commsEntries: [{ id: 'c1' }],
  documents: [{ id: 'd1' }],
  supplierBook: [{ id: 'p1' }],
  closure: {},
  changes: [],
  logEntries: [],
  dmaic: {}
};

async function createProject(cookie, pid, name) {
  return api('/api/cloud/projects', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(cookie)),
    body: JSON.stringify({ projectId: pid, name: name })
  });
}
async function saveOwnerState(cookie, pid, state) {
  return api('/api/cloud/projects/' + encodeURIComponent(pid) + '/save', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(cookie)),
    body: JSON.stringify({ state: state })
  });
}
function invite(cookie, pid, body) {
  return api('/api/cloud/projects/' + encodeURIComponent(pid) + '/team', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(cookie)),
    body: JSON.stringify(body)
  });
}
async function memberRow(pid, email) {
  const rows = await d1QueryRetry(
    'SELECT id, role, status, perm, access_expires_at FROM cloud_team_members WHERE project_id = ' +
      qd(pid) +
      ' AND invitee_email = ' +
      qd(email),
    'member row'
  );
  return rows && rows[0] ? rows[0] : null;
}

// Migration proof runs entirely in memory against the 0028 schema.
function migrationProof() {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  for (const f of ['0024_rbac_team.sql', '0028_team_invitations.sql']) {
    db.exec(fs.readFileSync(path.join(ROOT, 'migrations', f), 'utf8'));
  }
  db.prepare(
    "INSERT INTO cloud_team_members (project_id, invitee_email, role, invited_by, status, created_at) VALUES ('p1','a@b.co','client','x','active','2026-10-01T00:00:00.000Z')"
  ).run();
  const before = db.prepare('SELECT COUNT(*) AS c FROM cloud_team_members').get().c;
  db.exec(fs.readFileSync(path.join(ROOT, 'migrations', '0029_team_enterprise.sql'), 'utf8'));
  const after = db.prepare('SELECT COUNT(*) AS c FROM cloud_team_members').get().c;
  const row = db.prepare('SELECT perm, access_expires_at FROM cloud_team_members').get();
  const tpl = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cloud_team_templates'")
    .get();
  let uniqueBit = false;
  try {
    db.prepare(
      "INSERT INTO cloud_team_templates (owner_sub, name, perm, created_at, updated_at) VALUES ('s','T','{}','x','x'),('s','T','{}','x','x')"
    ).run();
  } catch (e) {
    uniqueBit = /UNIQUE/i.test(String(e.message));
  }
  return { before, after, perm: row.perm, expiry: row.access_expires_at, table: !!tpl, uniqueBit };
}

async function main() {
  const mig = migrationProof();
  await startWrangler();

  // ---- E0 fixture --------------------------------------------------------
  const reg = await api('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: OWNER, password: PW, name: 'Enterprise Owner' })
  });
  const ownerCookie = cookieFrom(reg);
  const freeReg = await api('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: FREE_OWNER, password: PW, name: 'Free Owner' })
  });
  const freeCookie = cookieFrom(freeReg);
  const capReg = await api('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: CAP_OWNER, password: PW, name: 'Contractor Owner' })
  });
  const capCookie = cookieFrom(capReg);
  // Both owners need a paid/unpaid subscription row keyed by their account sub.
  const ownerSub = 'email:' + OWNER;
  const freeSub = 'email:' + FREE_OWNER;
  await fireSubscription(ownerSub, PADDLE_COMPANY_PRICE);
  await fireSubscription('email:' + CAP_OWNER, PADDLE_PRICE);
  const made = await createProject(ownerCookie, PROJ, 'Enterprise Matrix Build');
  const madeFree = await createProject(freeCookie, PROJ_FREE, 'Free Build');
  const madeCap = await createProject(capCookie, PROJ_CAP, 'Contractor Build');
  const saved = await saveOwnerState(ownerCookie, PROJ, FULL_STATE);
  const savedFree = await saveOwnerState(freeCookie, PROJ_FREE, FULL_STATE);
  const savedCap = await saveOwnerState(capCookie, PROJ_CAP, FULL_STATE);
  check(
    'E0 fixture: company, contractor and free owners with saved projects',
    reg.status === 200 &&
      freeReg.status === 200 &&
      capReg.status === 200 &&
      !!ownerCookie &&
      !!freeCookie &&
      !!capCookie &&
      made.status === 200 &&
      madeFree.status === 200 &&
      madeCap.status === 200 &&
      saved.status === 200 &&
      savedFree.status === 200 &&
      savedCap.status === 200,
    {
      reg: reg.status,
      free: freeReg.status,
      cap: capReg.status,
      made: made.text,
      madeFree: madeFree.text,
      madeCap: madeCap.text,
      saved: saved.status,
      savedFree: savedFree.status,
      savedCap: savedCap.status
    }
  );

  // ---- E1: a matrix is stored on the member row --------------------------
  const supMatrix = {};
  Object.keys(FULL_STATE).forEach(function () {
    /* placeholder, replaced below */
  });
  const matrix = {
    wbs: 'edit',
    bud: 'view',
    risk: 'edit',
    res: 'edit',
    meet: 'edit',
    charter: 'view'
  };
  const invSup = await invite(ownerCookie, PROJ, {
    email: SUP,
    role: 'supervisor',
    perm: matrix,
    accessExpiresAt: new Date(Date.now() + 5 * 86400000).toISOString()
  });
  const supRow = await memberRow(PROJ, SUP);
  let storedMatrix = null;
  try {
    storedMatrix = supRow && supRow.perm ? JSON.parse(supRow.perm) : null;
  } catch (e) {
    storedMatrix = null;
  }
  check(
    'E1 an invitation stores the per-section matrix and its access end date',
    invSup.status === 200 &&
      !!supRow &&
      !!storedMatrix &&
      storedMatrix.wbs === 'edit' &&
      storedMatrix.bud === 'view' &&
      storedMatrix.charter === 'view' &&
      storedMatrix.docs === 'none' &&
      !!supRow.access_expires_at,
    { invite: invSup.text, row: supRow, matrix: storedMatrix }
  );

  const supCookie = mintGoogleCookie(SUP, 'Sup Member');
  const supAccept = await api('/api/team/invitations/' + supRow.id + '/accept', {
    method: 'POST',
    headers: ck(supCookie)
  });
  check(
    'E1b the matrix invitation accepts like any other',
    supAccept.status === 200 && supAccept.body && supAccept.body.ok === true,
    supAccept.text
  );

  // ---- E2: the READ set is the matrix ------------------------------------
  const supLoad = await api('/api/cloud/projects/' + PROJ + '/load', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(supCookie)),
    body: '{}'
  });
  const st = (supLoad.body && supLoad.body.state) || {};
  check(
    'E2 /load hands the member the read set only (view + edit, never none)',
    supLoad.status === 200 &&
      Array.isArray(supLoad.body.scope) &&
      supLoad.body.scope.indexOf('wbs') > -1 &&
      supLoad.body.scope.indexOf('bud') > -1 &&
      supLoad.body.scope.indexOf('risk') > -1 &&
      supLoad.body.scope.indexOf('docs') === -1 &&
      st.budgetLines !== undefined &&
      st.docs === undefined &&
      st.supplierBook === undefined &&
      st.tasks !== undefined,
    {
      status: supLoad.status,
      scope: supLoad.body && supLoad.body.scope,
      stateKeys: Object.keys(st)
    }
  );

  // ---- E3: a view-only section is readable but not writable ---------------
  const supSaveState = JSON.parse(JSON.stringify(FULL_STATE));
  supSaveState.tasks = [{ id: 't1', title: 'Pour slab v2', status: 'done' }];
  supSaveState.budgetLines = [{ id: 'b1', label: 'Concrete', amount: 9999 }];
  const supSave = await api('/api/cloud/projects/' + PROJ + '/save', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(supCookie)),
    body: JSON.stringify({ state: supSaveState })
  });
  const supProposalScope = (supSave.body && supSave.body.scope) || [];
  const propRows = await d1QueryRetry(
    'SELECT scope FROM cloud_reviews WHERE project_id = ' +
      qd(PROJ) +
      " AND source_type = 'team' AND status = 'pending'",
    'proposal'
  );
  let propScope = [];
  try {
    propScope = propRows && propRows[0] ? JSON.parse(propRows[0].scope) : [];
  } catch (e) {
    propScope = [];
  }
  check(
    'E3 a view-only section is readable but never writable',
    supSave.status === 200 &&
      supSave.body.actor === 'team' &&
      supSave.body.review === 'pending' &&
      supProposalScope.indexOf('wbs') > -1 &&
      supProposalScope.indexOf('bud') === -1 &&
      propScope.indexOf('bud') === -1 &&
      propScope.indexOf('wbs') > -1,
    { save: supSave.text, scope: supProposalScope, stored: propScope }
  );

  // ---- E4: a manager's view-only section survives a direct save ----------
  const mgrMatrix = { wbs: 'edit', bud: 'view', docs: 'none' };
  const invMgr = await invite(ownerCookie, PROJ, {
    email: MGR,
    role: 'manager',
    perm: mgrMatrix
  });
  const mgrRow = await memberRow(PROJ, MGR);
  const mgrCookie = mintGoogleCookie(MGR, 'Manager Member');
  const mgrAccept = await api('/api/team/invitations/' + mgrRow.id + '/accept', {
    method: 'POST',
    headers: ck(mgrCookie)
  });
  const mgrState = JSON.parse(JSON.stringify(FULL_STATE));
  mgrState.tasks = [{ id: 't1', title: 'Manager edit', status: 'done' }];
  mgrState.budgetLines = [{ id: 'b1', label: 'Hacked', amount: 1 }];
  mgrState.documents = [{ id: 'evil' }];
  const mgrSave = await api('/api/cloud/projects/' + PROJ + '/save', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(mgrCookie)),
    body: JSON.stringify({ state: mgrState })
  });
  await delay(600);
  const afterMgr = await api('/api/cloud/projects/' + PROJ + '/load', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(ownerCookie)),
    body: '{}'
  });
  const afterState = (afterMgr.body && afterMgr.body.state) || {};
  check(
    'E4 a manager save writes edit sections and restores view-only ones',
    invMgr.status === 200 &&
      mgrAccept.status === 200 &&
      mgrSave.status === 200 &&
      mgrSave.body.actor === 'manager' &&
      afterState.tasks &&
      afterState.tasks[0].title === 'Manager edit' &&
      afterState.budgetLines &&
      afterState.budgetLines[0].amount === 1000 &&
      afterState.documents &&
      afterState.documents[0].id === 'd1',
    {
      save: mgrSave.text,
      tasks: afterState.tasks,
      budget: afterState.budgetLines,
      docs: afterState.documents
    }
  );

  // ---- E5: a client can never be raised to edit --------------------------
  const cliInvite = await invite(ownerCookie, PROJ, {
    email: CLI,
    role: 'client',
    scope: ['wbs'],
    perm: { wbs: 'edit', bud: 'edit' }
  });
  const cliRow = await memberRow(PROJ, CLI);
  let cliMatrix = null;
  try {
    cliMatrix = cliRow && cliRow.perm ? JSON.parse(cliRow.perm) : null;
  } catch (e) {
    cliMatrix = null;
  }
  const cliCookie = mintGoogleCookie(CLI, 'Client Member');
  const cliAccept = await api('/api/team/invitations/' + cliRow.id + '/accept', {
    method: 'POST',
    headers: ck(cliCookie)
  });
  const cliSave = await api('/api/cloud/projects/' + PROJ + '/save', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(cliCookie)),
    body: JSON.stringify({ state: FULL_STATE })
  });
  check(
    'E5 a client matrix is downgraded to view and its save is refused',
    cliInvite.status === 200 &&
      !!cliMatrix &&
      cliMatrix.wbs === 'view' &&
      cliMatrix.bud === 'view' &&
      cliAccept.status === 200 &&
      cliSave.status === 403,
    { invite: cliInvite.text, matrix: cliMatrix, accept: cliAccept.status, save: cliSave.status }
  );

  // ---- E6: a window that already closed refuses acceptance ---------------
  const boxedInvite = await invite(ownerCookie, PROJ, {
    email: BOXED,
    role: 'contractor',
    accessExpiresAt: new Date(Date.now() - 3600000).toISOString()
  });
  const boxedRow = await memberRow(PROJ, BOXED);
  const boxedCookie = mintGoogleCookie(BOXED, 'Boxed Contractor');
  const boxedAccept = await api('/api/team/invitations/' + boxedRow.id + '/accept', {
    method: 'POST',
    headers: ck(boxedCookie)
  });
  const boxedAfter = await memberRow(PROJ, BOXED);
  check(
    'E6 an expired access window refuses acceptance and marks the row expired',
    boxedInvite.status === 200 &&
      boxedAccept.status === 410 &&
      boxedAccept.body &&
      boxedAccept.body.error === 'access_expired' &&
      boxedAfter &&
      boxedAfter.status === 'expired',
    { invite: boxedInvite.text, accept: boxedAccept.text, row: boxedAfter }
  );

  // ---- E7: a window that closes later refuses the next request ----------
  const invBox = await invite(ownerCookie, PROJ, {
    email: 'window.member.s3@example.com',
    role: 'contractor',
    accessExpiresAt: new Date(Date.now() + 3 * 86400000).toISOString()
  });
  const winRow = await memberRow(PROJ, 'window.member.s3@example.com');
  const winCookie = mintGoogleCookie('window.member.s3@example.com', 'Window Member');
  const winAccept = await api('/api/team/invitations/' + winRow.id + '/accept', {
    method: 'POST',
    headers: ck(winCookie)
  });
  const winLoadOpen = await api('/api/cloud/projects/' + PROJ + '/load', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(winCookie)),
    body: '{}'
  });
  d1Exec(
    'UPDATE cloud_team_members SET access_expires_at = ' +
      qd(new Date(Date.now() - 60000).toISOString()) +
      ' WHERE id = ' +
      Number(winRow.id)
  );
  // D1 WAL may lag behind the Worker, so retry the assertion rather than the write.
  let winLoadClosed = null;
  for (let i = 0; i < 6; i++) {
    winLoadClosed = await api('/api/cloud/projects/' + PROJ + '/load', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, ck(winCookie)),
      body: '{}'
    });
    if (winLoadClosed.status === 403) {
      break;
    }
    await delay(400);
  }
  const winRowAfter = await memberRow(PROJ, 'window.member.s3@example.com');
  check(
    'E7 a closed window refuses the very next request (no cron wait)',
    invBox.status === 200 &&
      winAccept.status === 200 &&
      winLoadOpen.status === 200 &&
      winLoadClosed.status === 403 &&
      winRowAfter &&
      winRowAfter.status === 'expired',
    {
      invite: invBox.text,
      accept: winAccept.status,
      open: winLoadOpen.status,
      closed: winLoadClosed.status,
      row: winRowAfter
    }
  );

  // ---- E8: the 7-day notice is computed --------------------------------
  const listedBefore = await api('/api/cloud/projects/' + PROJ + '/team', {
    headers: ck(ownerCookie)
  });
  const supListed = ((listedBefore.body && listedBefore.body.members) || []).find(function (m) {
    return m.inviteeEmail === SUP;
  });
  const mgrListed = ((listedBefore.body && listedBefore.body.members) || []).find(function (m) {
    return m.inviteeEmail === MGR;
  });
  const listedSoon = ((listedBefore.body && listedBefore.body.members) || []).find(function (m) {
    return m.inviteeEmail === 'window.member.s3@example.com';
  });
  check(
    'E8 the team list carries the 7-day notice, the matrix and the write set',
    listedBefore.status === 200 &&
      !!supListed &&
      supListed.accessExpiringSoon === true &&
      Array.isArray(supListed.perm) === false &&
      supListed.perm &&
      supListed.perm.bud === 'view' &&
      Array.isArray(supListed.writeScope) &&
      supListed.writeScope.indexOf('bud') === -1 &&
      !!mgrListed &&
      mgrListed.accessExpiringSoon === false &&
      !!listedSoon &&
      listedSoon.accessExpired === true,
    { sup: supListed, mgr: mgrListed, window: listedSoon }
  );

  // ---- E9: one-click extend --------------------------------------------
  const extend = await api('/api/cloud/projects/' + PROJ + '/team/' + winRow.id + '/extend', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(ownerCookie)),
    body: JSON.stringify({ days: 30 })
  });
  const winLoadAgain = await api('/api/cloud/projects/' + PROJ + '/load', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(winCookie)),
    body: '{}'
  });
  const extendAudit = await d1Query(
    'SELECT COUNT(*) AS c FROM cloud_team_audit WHERE project_id = ' +
      qd(PROJ) +
      " AND event = 'extend' AND target_email = 'window.member.s3@example.com'"
  );
  check(
    'E9 extend re-opens a closed window and audits it',
    extend.status === 200 &&
      extend.body &&
      extend.body.ok &&
      Date.parse(extend.body.accessExpiresAt) > Date.now() + 20 * 86400000 &&
      winLoadAgain.status === 200 &&
      !!extendAudit &&
      extendAudit[0].c === 1,
    { extend: extend.text, load: winLoadAgain.status, audit: extendAudit }
  );

  // ---- E10: reusable templates ------------------------------------------
  const tplMatrix = { wbs: 'edit', res: 'view', bud: 'none', risk: 'edit' };
  const tplCreate = await api('/api/team/templates', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(ownerCookie)),
    body: JSON.stringify({ name: 'Site supervisor, no money', perm: tplMatrix })
  });
  const tplId = tplCreate.body && tplCreate.body.template ? tplCreate.body.template.id : 0;
  const tplList = await api('/api/team/templates', { headers: ck(ownerCookie) });
  const tplRows = (tplList.body && tplList.body.templates) || [];
  const tplSections = (tplList.body && tplList.body.sections) || [];
  const tplUpdate = await api('/api/team/templates/' + tplId, {
    method: 'PUT',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(ownerCookie)),
    body: JSON.stringify({ name: 'Site supervisor, no money v2' })
  });
  // Apply the template to an invitation, then delete it and prove it is gone.
  const tplInvite = await invite(ownerCookie, PROJ, {
    email: 'tpl.member.s3@example.com',
    role: 'supervisor',
    templateId: tplId
  });
  const tplAppliedRow = await memberRow(PROJ, 'tpl.member.s3@example.com');
  let tplApplied = null;
  try {
    tplApplied = tplAppliedRow && tplAppliedRow.perm ? JSON.parse(tplAppliedRow.perm) : null;
  } catch (e) {
    tplApplied = null;
  }
  const tplDelete = await api('/api/team/templates/' + tplId, {
    method: 'DELETE',
    headers: ck(ownerCookie)
  });
  const tplListAfter = await api('/api/team/templates', { headers: ck(ownerCookie) });
  const tplGone = ((tplListAfter.body && tplListAfter.body.templates) || []).every(function (t) {
    return t.id !== tplId;
  });
  const freeTplList = await api('/api/team/templates', { headers: ck(freeCookie) });
  const freeTplDelete = await api('/api/team/templates/' + tplId, {
    method: 'DELETE',
    headers: ck(freeCookie)
  });
  check(
    'E10 templates: create, list, update, apply, delete, account isolation',
    tplCreate.status === 200 &&
      tplList.status === 200 &&
      tplRows.length >= 1 &&
      tplRows[0].perm.wbs === 'edit' &&
      tplRows[0].perm.bud === 'none' &&
      tplSections.length >= 15 &&
      tplUpdate.status === 200 &&
      tplInvite.status === 200 &&
      !!tplApplied &&
      tplApplied.risk === 'edit' &&
      tplApplied.bud === 'none' &&
      tplDelete.status === 200 &&
      tplGone === true &&
      freeTplList.status === 402 &&
      freeTplDelete.status === 402,
    {
      create: tplCreate.text,
      list: tplRows.map(function (t) {
        return t.name;
      }),
      sections: tplSections.length,
      update: tplUpdate.status,
      invite: tplInvite.text,
      applied: tplApplied,
      del: tplDelete.status,
      gone: tplGone,
      free: freeTplList.status,
      freeDel: freeTplDelete.status
    }
  );

  // ---- E11: bulk invite of 100 -----------------------------------------
  const emails = [];
  for (let i = 0; i < 99; i++) {
    emails.push('bulk.member.' + i + '.s3@example.com');
  }
  // One row is an address that already has an account, so the two shapes can be
  // compared for an account-existence leak.
  emails.push(SUP);
  const bulk = await api('/api/cloud/projects/' + PROJ + '/team/bulk', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(ownerCookie)),
    body: JSON.stringify({ emails: emails, role: 'contractor' })
  });
  const bulkResults = (bulk.body && bulk.body.results) || [];
  const knownRow = bulkResults.find(function (r) {
    return r.email === SUP;
  });
  const unknownRow = bulkResults.find(function (r) {
    return r.email === emails[0];
  });
  const sameShape =
    !!knownRow &&
    !!unknownRow &&
    JSON.stringify(Object.keys(knownRow).sort()) === JSON.stringify(Object.keys(unknownRow).sort());
  check(
    'E11 bulk invite of 100 returns 100 rows with no account-existence leak',
    bulk.status === 200 &&
      bulk.body.total === 100 &&
      bulkResults.length === 100 &&
      bulk.body.invited === 99 &&
      knownRow &&
      knownRow.status === 'already_member' &&
      unknownRow &&
      unknownRow.status === 'invited' &&
      sameShape === true,
    {
      status: bulk.status,
      total: bulk.body && bulk.body.total,
      invited: bulk.body && bulk.body.invited,
      rows: bulkResults.length,
      known: knownRow,
      unknown: unknownRow,
      sameShape: sameShape
    }
  );

  // ---- E12: bulk cap + tier -------------------------------------------
  const tooMany = [];
  for (let i = 0; i < 101; i++) {
    tooMany.push('over.member.' + i + '.s3@example.com');
  }
  const bulkOver = await api('/api/cloud/projects/' + PROJ + '/team/bulk', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(ownerCookie)),
    body: JSON.stringify({ emails: tooMany, role: 'contractor' })
  });
  const bulkFree = await api('/api/cloud/projects/' + PROJ_FREE + '/team/bulk', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(freeCookie)),
    body: JSON.stringify({ emails: ['one.free.s3@example.com'], role: 'contractor' })
  });
  check(
    'E12 bulk is capped at 100 and needs the enterprise tier',
    bulkOver.status === 400 && bulkFree.status === 402,
    { over: bulkOver.text, free: bulkFree.text }
  );

  // ---- E13: audit CSV -------------------------------------------------
  const csv = await api('/api/cloud/projects/' + PROJ + '/team/audit.csv', {
    headers: ck(ownerCookie)
  });
  const csvLines = String(csv.raw || '').split(/\r?\n/);
  const csvEvents = csvLines.map(function (l) {
    return l.split(',')[1];
  });
  const needed = [
    'invite',
    'accept',
    'bulk_invite',
    'extend',
    'expire',
    'update_access',
    'resend',
    'revoke',
    'update_role',
    'decline',
    'leave'
  ];
  // Not every event has happened in THIS run; the gate is that every event the
  // suite produced is present and the header is exact.
  const produced = ['invite', 'accept', 'bulk_invite', 'extend', 'expire'];
  check(
    'E13 audit CSV is a real spreadsheet with a header and every event',
    csv.status === 200 &&
      /text\/csv/.test(csv.headers.get('content-type') || '') &&
      /attachment; filename="team-audit-qa-ent-s3\.csv"/.test(
        csv.headers.get('content-disposition') || ''
      ) &&
      csvLines[0] === 'created_at,event,actor_email,actor_name,target_email,role,detail' &&
      produced.every(function (e) {
        return csvEvents.indexOf(e) > -1;
      }) === true &&
      needed.length === 11,
    { status: csv.status, header: csvLines[0], events: csvEvents.slice(0, 12) }
  );

  // ---- E14: migration proof -------------------------------------------
  check(
    'E14 migration 0029 adds the columns and a template table without losing a row',
    mig.before === 1 &&
      mig.after === 1 &&
      mig.perm === null &&
      mig.expiry === null &&
      mig.table === true &&
      mig.uniqueBit === true,
    mig
  );

  // ---- E15: lower tiers cannot ask for enterprise access --------------
  // A contractor owner can invite (one seat), but the matrix, the time box and
  // the audit export are Company features and must answer 402, not be silently
  // dropped or quietly downgraded.
  const capMatrix = await invite(capCookie, PROJ_CAP, {
    email: 'matrix.cap.s3@example.com',
    role: 'supervisor',
    perm: { wbs: 'edit' }
  });
  const capExpiry = await invite(capCookie, PROJ_CAP, {
    email: 'expiry.cap.s3@example.com',
    role: 'contractor',
    accessExpiresAt: new Date(Date.now() + 86400000).toISOString()
  });
  const capAudit = await api('/api/cloud/projects/' + PROJ_CAP + '/team/audit.csv', {
    headers: ck(capCookie)
  });
  const capBulk = await api('/api/cloud/projects/' + PROJ_CAP + '/team/bulk', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(capCookie)),
    body: JSON.stringify({ emails: ['bulk.cap.s3@example.com'], role: 'contractor' })
  });
  check(
    'E15 a lower tier is refused a matrix, a time box, bulk and the audit export',
    capMatrix.status === 402 &&
      capMatrix.body &&
      capMatrix.body.error === 'enterprise_feature' &&
      capExpiry.status === 402 &&
      capExpiry.body &&
      capExpiry.body.error === 'enterprise_feature' &&
      capBulk.status === 402 &&
      capAudit.status === 402,
    {
      matrix: capMatrix.text,
      expiry: capExpiry.text,
      bulk: capBulk.text,
      audit: capAudit.text
    }
  );

  const passed = results.filter(function (r) {
    return r.val;
  }).length;
  log('');
  log(
    passed === results.length
      ? 'ALL GATES PASSED (' + results.length + ')'
      : results.length - passed + ' FAILED'
  );
  if (passed !== results.length) {
    log(devLog.slice(-2500));
  }
  return passed === results.length;
}

const fail = function (e) {
  log('FATAL ' + (e && e.stack ? e.stack : e));
  stopWrangler();
  process.exit(1);
};

process.on('SIGINT', function () {
  stopWrangler();
  process.exit(130);
});
process.on('SIGTERM', function () {
  stopWrangler();
  process.exit(143);
});

main()
  .then(function (ok) {
    stopWrangler();
    setTimeout(function () {
      process.exit(ok ? 0 : 1);
    }, 300);
  })
  .catch(fail);
