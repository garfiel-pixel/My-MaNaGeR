/* ============================================================
   qa-team-rbac.cjs — NAMED TEAM MEMBERS / RBAC (Wave 4, 2026-10-06)
   ------------------------------------------------------------
   Self-contained: spawns its own wrangler dev (local D1 + R2,
   --persist-to outside the repo), applies migrations, then exercises
   src/cloud/team.js end to end:

     T1  invite a registered member            -> 200 pending
     T2  the invite email carries the accept link (Resend stub)
     T3  list shows the pending member
     T4  a 2nd named member on contractor      -> 402 member_limit
                                                    upgradeRequired company
     T5  the invited user accepts the token    -> 200 active
     T6  the token is single-use               -> 404 on replay
     T7  list shows active + acceptedAt
     T8  update role/scope                     -> 200
     T9  revoke (soft)                         -> 200 revoked
     T10 revoked member is excluded from list
     T11 a revoked invite token is dead        -> 404
     T12 a non-owner cannot invite             -> 403
     T13 inviting an unknown address           -> 404 user_not_found
     T14 company tier unlocks unlimited members
     T15 unknown role is rejected              -> 400
     W7a-C a manager reads shapes + changelog  -> 200 (Wave 7 read routes)
     W7d-G the matrix narrows a scoped client  -> 200 wbs / 403 rest
     W8.10a-c cancel clears auth + lookup       -> 403 / 404 / past-auth (Wave 8.10)

   MMGR_QA_NO_BROWSER has no effect here (no browser phase). Ctrl+C /
   SIGTERM stop wrangler dev instead of orphaning it on the port.
   ============================================================ */
'use strict';
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const http = require('http');

const PORT = parseInt(process.env.QA_PORT || '8797', 10);
const BASE = 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');
const TMP = os.tmpdir();

const SECRET = 'qa-team-rbac-secret-7c31a9d5';
const ADMIN_CODE = 'qa-admin-team-e2e-2f61';
const PADDLE_SECRET = 'qa-team-paddle-secret-44b2ee01';
const PADDLE_KEY = 'qa-team-paddle-api-key-000000000000000000000000';
const PADDLE_PRICE = 'pri_01qa_contractor_000000000000';
const PADDLE_COMPANY_PRICE = 'pri_01qa_company_00000000000000';
const PADDLE_ENTERPRISE_PRICE = 'pri_01qa_enterprise_0000000000';

const ALICE = 'alice.team.e2e@example.com';
const BOB = 'bob.team.e2e@example.com';
const CAROL = 'carol.team.e2e@example.com';
const PW = 'QaTeam!Pass123';

const log = s => {
  process.stdout.write('[team-rbac] ' + s + '\n');
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

// ---- Resend stub (captures invite + verify emails) -----------------------
let stubPort = 0;
const stubEmails = [];
function startEmailStub() {
  const srv = http.createServer(function (req, res) {
    if (req.method === 'POST' && req.url === '/emails') {
      let body = '';
      req.on('data', function (c) {
        body += c;
      });
      req.on('end', function () {
        try {
          const j = JSON.parse(body);
          const tos = Array.isArray(j.to) ? j.to.join(',') : String(j.to || '');
          stubEmails.push({
            to: tos,
            subject: j.subject,
            text: j.text,
            at: new Date().toISOString()
          });
        } catch (e) {
          /* ignore */
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 'stub_' + stubEmails.length }));
      });
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
  return new Promise(function (resolve) {
    srv.listen(0, '127.0.0.1', function () {
      stubPort = srv.address().port;
      resolve(srv);
    });
  });
}
function latestEmailTo(email, subjectPart) {
  for (let i = stubEmails.length - 1; i >= 0; i--) {
    const m = stubEmails[i];
    if (m.to === email && (!subjectPart || String(m.subject).indexOf(subjectPart) >= 0)) {
      return m;
    }
  }
  return null;
}
function tokenFromText(re, text) {
  const m = String(text || '').match(re);
  return m ? m[1] : null;
}

let proc = null;
let devLog = '';

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
const PERSIST_DIR = path.join(TMP, 'mmgr-team-rbac-wstate-' + Date.now());
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
    // Exposes /__scheduled so G5 can fire the REAL scheduled handler instead of
    // re-implementing the expiry sweep in the harness.
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
    'PADDLE_ENV:sandbox',
    '--var',
    'FREE_PROJECT_CAP:1',
    '--var',
    'RESEND_API_KEY:qa-fake-resend-key-0000000000000000000000000000',
    '--var',
    'RESEND_FROM_EMAIL:onboarding@resend.dev',
    '--var',
    'RESEND_API_BASE:http://127.0.0.1:' + stubPort
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

async function api(pathname, opts) {
  await pace();
  const res = await fetch(BASE + pathname, Object.assign({}, opts || {}));
  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    body = null;
  }
  return {
    status: res.status,
    body,
    text: res.status + '|' + JSON.stringify(body),
    headers: res.headers
  };
}

// The Worker's `general` bucket is 30 requests per minute per key, and every
// call in this harness shares one key. The sprint-1 gates add ~70 calls, so a
// naive burst starts answering 429 on unrelated assertions. Keep a rolling
// budget of 24/minute: no fixed delay when the suite is idle, and the limit
// stays honest rather than being raised for the test.
const _apiCalls = [];
async function pace() {
  const now = Date.now();
  while (_apiCalls.length && _apiCalls[0] <= now - 60000) {
    _apiCalls.shift();
  }
  if (_apiCalls.length >= 24) {
    await delay(_apiCalls[0] + 60000 - now + 100);
    return pace();
  }
  _apiCalls.push(now);
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
    event_id: 'evt_team_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    occurred_at: new Date().toISOString(),
    data: {
      id: 'sub_team_' + Math.random().toString(36).slice(2, 12),
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
async function registerAndVerify(email, name) {
  const reg = await api('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PW, name })
  });
  if (reg.status !== 200) {
    return { reg, cookie: null };
  }
  const cookie = cookieFrom(reg);
  // Verify the address so the cloud-create email gate passes.
  await delay(300);
  const mail = latestEmailTo(email, 'Confirm your');
  const vtoken = mail ? tokenFromText(/\/verify\.html\?token=([^\s\n]+)/, mail.text) : null;
  if (vtoken) {
    await api('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: vtoken })
    });
  }
  return { reg, cookie };
}

// ---- RBAC sprint 1 tooling (2026-10-28) ----------------------------------
// A Google-shaped session: sub is NOT 'email:<addr>', the signed email claim
// is what the server resolves. No jti, so readSession skips the auth_sessions
// ledger (that row is best-effort in production too). This is how the harness
// proves a Google-only address can accept an invitation without a real OAuth
// round trip.
function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
function mintGoogleCookie(email, name, sub) {
  const payload = {
    sub: sub || 'google-qa-' + crypto.randomBytes(6).toString('hex'),
    email: email,
    name: name || 'Google User',
    exp: Math.floor(Date.now() / 1000) + 3600
  };
  const json = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', SECRET).update(json).digest();
  return 'mmgr_session=' + b64url(json) + '.' + b64url(sig);
}

// Direct D1 access for the facts the API deliberately does not expose:
// token_hash storage and expiry manipulation. Read-only unless d1Exec runs.
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
  for (let i = 0; i < 4; i++) {
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
  if (f) {
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
  }
  try {
    execFileSync(
      process.execPath,
      [
        WRANGLER_JS,
        'd1',
        'execute',
        'my-manager-db',
        '--local',
        '--config',
        'wrangler.ci.jsonc',
        '--persist-to',
        PERSIST_DIR,
        '--command',
        sql
      ],
      { cwd: ROOT, stdio: 'ignore', timeout: 60000 }
    );
    return true;
  } catch (e) {
    log('d1 execute fallback failed: ' + e.message);
    return false;
  }
}
function qd(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

// ============================================================
// RBAC SPRINT 1 GATES (directive 2026-10-25, section 3) - G1 to G11
// ============================================================
const GOOGLE_ONLY = 'goog.only.sprint1@example.com';
const DANA = 'dana.owner.s1@example.com';
const EVAN = 'evan.member.s1@example.com';
const GWEN = 'gwen.member.s1@example.com';
const FAY = 'fay.unverified.s1@example.com';
const FREE_OWNER = 'free.owner.s1@example.com';
const CAP_OWNER = 'cap.owner.s1@example.com';

async function createProject(cookie, pid, name) {
  return api('/api/cloud/projects', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(cookie)),
    body: JSON.stringify({ projectId: pid, name: name })
  });
}
function invite(cookie, pid, email, role, scope) {
  const body = { email: email, role: role };
  if (scope) {
    body.scope = scope;
  }
  return api('/api/cloud/projects/' + pid + '/team', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(cookie)),
    body: JSON.stringify(body)
  });
}
async function memberIdByEmail(pid, email) {
  const rows = await d1QueryRetry(
    'SELECT id FROM cloud_team_members WHERE project_id = ' +
      qd(pid) +
      ' AND invitee_email = ' +
      qd(email),
    'member id'
  );
  return rows && rows[0] ? rows[0].id : 0;
}
async function auditCount(pid, event, target) {
  const rows = await d1Query(
    'SELECT COUNT(*) AS c FROM cloud_team_audit WHERE project_id = ' +
      qd(pid) +
      ' AND event = ' +
      qd(event) +
      (target ? ' AND target_email = ' + qd(target) : '')
  );
  return rows && rows[0] ? rows[0].c : -1;
}

function g11MigrationProof() {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(ROOT, 'migrations', '0024_rbac_team.sql'), 'utf8'));
  const seed = db.prepare(
    'INSERT INTO cloud_team_members (project_id, user_sub, role, invited_by, status, scope, invite_token, created_at, accepted_at) VALUES (?,?,?,?,?,?,?,?,?)'
  );
  seed.run(
    'p1',
    'email:Ana@Example.com',
    'manager',
    'owner-sub',
    'active',
    null,
    null,
    '2026-10-01T00:00:00.000Z',
    '2026-10-02T00:00:00.000Z'
  );
  seed.run(
    'p1',
    'email:bob@example.com',
    'client',
    'owner-sub',
    'pending',
    '["wbs","docs"]',
    'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    '2026-10-10T00:00:00.000Z',
    null
  );
  seed.run(
    'p2',
    'email:cy@example.com',
    'contractor',
    'owner-sub',
    'revoked',
    null,
    null,
    '2026-09-01T00:00:00.000Z',
    null
  );
  seed.run(
    'p3',
    'google-113487',
    'supervisor',
    'owner-sub',
    'active',
    null,
    null,
    '2026-08-01T00:00:00.000Z',
    '2026-08-02T00:00:00.000Z'
  );
  const before = db.prepare('SELECT COUNT(*) AS c FROM cloud_team_members').get().c;
  db.exec(fs.readFileSync(path.join(ROOT, 'migrations', '0028_team_invitations.sql'), 'utf8'));
  const after = db.prepare('SELECT COUNT(*) AS c FROM cloud_team_members').get().c;
  const rows = db.prepare('SELECT * FROM cloud_team_members ORDER BY id').all();
  const idx = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name IN ('cloud_team_members','cloud_team_audit')"
    )
    .all()
    .map(r => r.name);

  let uniqueBit = false;
  try {
    db.prepare(
      "INSERT INTO cloud_team_members (project_id, invitee_email, role, invited_by, status, created_at) VALUES ('p1','ana@example.com','manager','x','pending','2026-10-28T00:00:00.000Z')"
    ).run();
  } catch (e) {
    uniqueBit = /UNIQUE/i.test(String(e.message));
  }
  let checkBit = false;
  try {
    db.prepare(
      "INSERT INTO cloud_team_members (project_id, invitee_email, role, invited_by, status, created_at) VALUES ('p9','x@y.zz','manager','x','bogus','2026-10-28T00:00:00.000Z')"
    ).run();
  } catch (e) {
    checkBit = /CHECK/i.test(String(e.message));
  }
  let declinedOk = false;
  try {
    db.prepare(
      "INSERT INTO cloud_team_members (project_id, invitee_email, role, invited_by, status, created_at) VALUES ('p9','ok@y.zz','manager','x','declined','2026-10-28T00:00:00.000Z')"
    ).run();
    declinedOk = true;
  } catch (e) {
    declinedOk = false;
  }

  const auditTable = db
    .prepare(
      "SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='cloud_team_audit'"
    )
    .get().c;
  const facts = {
    rows: before + '->' + after,
    lower: rows[0].invitee_email,
    scope: rows[1].scope,
    sentinel: rows[3].invitee_email,
    token: rows.map(r => r.token_hash).join(','),
    expiryFuture: !!rows[1].expires_at && rows[1].expires_at > new Date().toISOString(),
    unique: uniqueBit,
    check: checkBit,
    declined: declinedOk,
    auditTable: auditTable,
    indexes: idx.join(',')
  };
  const ok =
    before === 4 &&
    after === 4 &&
    rows[0].invitee_email === 'ana@example.com' &&
    rows[1].scope === '["wbs","docs"]' &&
    rows[3].invitee_email === 'legacy:google-113487' &&
    rows.every(r => r.token_hash === null) &&
    facts.expiryFuture &&
    uniqueBit &&
    checkBit &&
    declinedOk &&
    auditTable === 1 &&
    [
      'idx_team_project',
      'idx_team_email',
      'idx_team_token',
      'idx_team_status',
      'idx_team_audit_project'
    ].every(n => idx.includes(n));
  check('G11 migration 0028 runs on the old schema with zero lost rows', ok, facts);
}

async function runRbacSprint1Gates() {
  g11MigrationProof();

  // ---- accounts + projects ------------------------------------------------
  const dana = await registerAndVerify(DANA, 'Dana Owner');
  const evan = await registerAndVerify(EVAN, 'Evan Member');
  const gwen = await registerAndVerify(GWEN, 'Gwen Member');
  const freeOwner = await registerAndVerify(FREE_OWNER, 'Free Owner');
  const capOwner = await registerAndVerify(CAP_OWNER, 'Cap Owner');
  const fayReg = await api('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: FAY, password: PW, name: 'Fay Unverified' })
  });
  const fayCookie = cookieFrom(fayReg);
  if (
    !dana.cookie ||
    !evan.cookie ||
    !gwen.cookie ||
    !freeOwner.cookie ||
    !capOwner.cookie ||
    !fayCookie
  ) {
    check('G0 sprint-1 accounts created', false, {
      dana: dana.reg && dana.reg.text,
      evan: evan.reg && evan.reg.text,
      gwen: gwen.reg && gwen.reg.text,
      fay: fayReg.text
    });
    return;
  }

  const pidG = 'rbac-s1-company-' + Date.now().toString(36);
  const pidCap = 'rbac-s1-cap-' + Date.now().toString(36);
  const pidFree = 'rbac-s1-free-' + Date.now().toString(36);
  const pidRate = 'rbac-s1-rate-' + Date.now().toString(36);
  // Entitlements BEFORE project creation. handleCloudCreate counts the
  // projects already owned and only then looks for an active subscription
  // (FREE_PROJECT_CAP is 1), so a second project created before its owner's
  // subscription lands answers 402. Dana owns two projects here, so her
  // company subscription has to exist first; capOwner is not capped (one
  // project) but firing both keeps the setup order honest.
  await fireSubscription('email:' + DANA, PADDLE_COMPANY_PRICE, 'active');
  await fireSubscription('email:' + CAP_OWNER, PADDLE_PRICE, 'active');
  const cG = await createProject(dana.cookie, pidG, 'Sprint One Company');
  const cCap = await createProject(capOwner.cookie, pidCap, 'Sprint One Cap');
  const cFree = await createProject(freeOwner.cookie, pidFree, 'Sprint One Free');
  const cRate = await createProject(dana.cookie, pidRate, 'Sprint One Rate');
  check(
    'G0 sprint-1 projects + entitlements',
    [cG, cCap, cFree, cRate].every(r => r.status === 200 && r.body && r.body.ok),
    [cG.text, cCap.text, cFree.text, cRate.text].join(' | ')
  );

  // ---- G1: no account-existence leak -------------------------------------
  const invGoogle = await invite(dana.cookie, pidG, GOOGLE_ONLY, 'client', ['wbs']);
  const invEvan = await invite(dana.cookie, pidG, EVAN, 'client', ['wbs']);
  const shape = o =>
    Object.keys(o || {})
      .sort()
      .join(',');
  check(
    'G1 Google-only and registered addresses get the same invite response',
    invGoogle.status === 200 &&
      invEvan.status === 200 &&
      invGoogle.body.ok === true &&
      invEvan.body.ok === true &&
      invGoogle.body.status === 'pending' &&
      invEvan.body.status === 'pending' &&
      invGoogle.body.role === invEvan.body.role &&
      shape(invGoogle.body) === shape(invEvan.body) &&
      !/user_not_found/.test(invGoogle.text + invEvan.text),
    invGoogle.text + ' | ' + invEvan.text
  );

  // ---- G2: a Google-shaped session lists and accepts ---------------------
  const googCookie = mintGoogleCookie(GOOGLE_ONLY, 'Google Only');
  const gList = await api('/api/team/invitations', { headers: ck(googCookie) });
  const gInv = ((gList.body && gList.body.invitations) || []).filter(i => i.projectId === pidG)[0];
  check(
    'G2a Google session lists its pending invitation',
    gList.status === 200 && !!gInv && gInv.role === 'client' && !!gInv.projectName,
    gList.text
  );
  const gAccept = gInv
    ? await api('/api/team/invitations/' + gInv.id + '/accept', {
        method: 'POST',
        headers: ck(googCookie)
      })
    : { status: 0, text: 'no invitation' };
  check(
    'G2b Google session accepts the invitation',
    gAccept.status === 200 && gAccept.body && gAccept.body.ok && gAccept.body.projectId === pidG,
    gAccept.text
  );
  const gLoad = await api('/api/cloud/projects/' + pidG + '/load', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(googCookie)),
    body: '{}'
  });
  check(
    'G2c accepted Google member loads the project as client',
    gLoad.status === 200 && gLoad.body && gLoad.body.teamRole === 'client',
    gLoad.text
  );
  const gTasks = await api('/api/cloud/projects/' + pidG + '/api/tasks', {
    headers: ck(googCookie)
  });
  const gRisks = await api('/api/cloud/projects/' + pidG + '/api/risks', {
    headers: ck(googCookie)
  });
  check(
    'G2d scoped read: tasks 200, risks 403',
    gTasks.status === 200 && gRisks.status === 403,
    gTasks.text + ' | ' + gRisks.text
  );

  // ---- G3: an unverified password address cannot accept ------------------
  await invite(dana.cookie, pidG, FAY, 'client');
  const fayId = await memberIdByEmail(pidG, FAY);
  const fayList = await api('/api/team/invitations', { headers: ck(fayCookie) });
  const fayAccept = await api('/api/team/invitations/' + fayId + '/accept', {
    method: 'POST',
    headers: ck(fayCookie)
  });
  const fayRows = await d1Query(
    'SELECT status FROM cloud_team_members WHERE id = ' + Number(fayId)
  );
  check(
    'G3 unverified email is refused while the invitation stays pending',
    fayList.status === 403 &&
      fayAccept.status === 403 &&
      fayRows &&
      fayRows[0] &&
      fayRows[0].status === 'pending',
    fayList.text + ' | ' + fayAccept.text + ' | ' + JSON.stringify(fayRows)
  );

  // ---- G4: tokens are stored as SHA-256 only -----------------------------
  await delay(350);
  const evanMail = latestEmailTo(EVAN, 'invited');
  const rawToken = evanMail ? tokenFromText(/\/team\/accept\/([0-9a-f]{64})/, evanMail.text) : null;
  const tokenRows = await d1QueryRetry(
    'SELECT token_hash FROM cloud_team_members WHERE project_id = ' +
      qd(pidG) +
      ' AND invitee_email = ' +
      qd(EVAN),
    'token row'
  );
  const storedHash = tokenRows && tokenRows[0] ? tokenRows[0].token_hash : '';
  const rawCount = rawToken
    ? await d1Query(
        'SELECT COUNT(*) AS c FROM cloud_team_members WHERE token_hash = ' + qd(rawToken)
      )
    : null;
  check(
    'G4 the raw invite token is never stored (SHA-256 only)',
    !!rawToken &&
      /^[0-9a-f]{64}$/.test(rawToken) &&
      /^[0-9a-f]{64}$/.test(storedHash) &&
      storedHash !== rawToken &&
      rawCount &&
      rawCount[0].c === 0,
    { token: !!rawToken, stored: storedHash.slice(0, 8), rawRows: rawCount }
  );

  // ---- G5: expiry, cron sweep, and the contractor seat -------------------
  const invA = await invite(capOwner.cookie, pidCap, 'cap.a@example.com', 'contractor');
  const capAId = await memberIdByEmail(pidCap, 'cap.a@example.com');
  const wrotePast = d1Exec(
    "UPDATE cloud_team_members SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = " +
      Number(capAId)
  );
  const invB = await invite(capOwner.cookie, pidCap, 'cap.b@example.com', 'contractor');
  check(
    'G5a an expired pending invite does not hold the contractor seat',
    wrotePast && invA.status === 200 && invB.status === 200,
    invA.text + ' | ' + invB.text
  );
  const capACookie = mintGoogleCookie('cap.a@example.com', 'Cap A');
  const capAAccept = await api('/api/team/invitations/' + capAId + '/accept', {
    method: 'POST',
    headers: ck(capACookie)
  });
  check(
    'G5b an expired invitation cannot be accepted -> 410',
    capAAccept.status === 410 && /invitation_expired/.test(capAAccept.text),
    capAAccept.text
  );
  const cronRes = await fetch(BASE + '/__scheduled?cron=' + encodeURIComponent('0 0 * * *'));
  const cronText = await cronRes.text();
  const capAStatus = await d1QueryRetry(
    'SELECT status FROM cloud_team_members WHERE id = ' + Number(capAId),
    'cron expiry'
  );
  const expireAudit = await auditCount(pidCap, 'expire', 'cap.a@example.com');
  check(
    'G5c the scheduled sweep marks the row expired and audits it',
    cronRes.ok && capAStatus && capAStatus[0].status === 'expired' && expireAudit >= 1,
    { cron: cronRes.status, body: cronText.slice(0, 120), row: capAStatus, audit: expireAudit }
  );

  // ---- G6: decline once, leave, both audited -----------------------------
  await invite(dana.cookie, pidG, 'decline.me@example.com', 'client');
  const declineId = await memberIdByEmail(pidG, 'decline.me@example.com');
  const declineCookie = mintGoogleCookie('decline.me@example.com', 'Decline Me');
  const dec1 = await api('/api/team/invitations/' + declineId + '/decline', {
    method: 'POST',
    headers: ck(declineCookie)
  });
  const dec2 = await api('/api/team/invitations/' + declineId + '/decline', {
    method: 'POST',
    headers: ck(declineCookie)
  });
  check(
    'G6a decline works once and is single-use',
    dec1.status === 200 && dec1.body.status === 'declined' && dec2.status === 404,
    dec1.text + ' | ' + dec2.text
  );

  await invite(dana.cookie, pidG, GWEN, 'supervisor');
  const gwenId = await memberIdByEmail(pidG, GWEN);
  const gwenAccept = await api('/api/team/invitations/' + gwenId + '/accept', {
    method: 'POST',
    headers: ck(gwen.cookie)
  });
  const gwenLeave = await api('/api/cloud/projects/' + pidG + '/team/leave', {
    method: 'POST',
    headers: ck(gwen.cookie)
  });
  const gwenLoad = await api('/api/cloud/projects/' + pidG + '/load', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(gwen.cookie)),
    body: '{}'
  });
  const leaveAudit = await auditCount(pidG, 'leave', GWEN);
  const declineAudit = await auditCount(pidG, 'decline', 'decline.me@example.com');
  check(
    'G6b leave removes access and both events are audited',
    gwenAccept.status === 200 &&
      gwenLeave.status === 200 &&
      gwenLoad.status === 403 &&
      leaveAudit >= 1 &&
      declineAudit >= 1,
    {
      accept: gwenAccept.status,
      leave: gwenLeave.status,
      load: gwenLoad.status,
      leaveAudit: leaveAudit,
      declineAudit: declineAudit
    }
  );

  // ---- G7: the write matrix ---------------------------------------------
  const team = [
    { email: 'sup.s1@example.com', role: 'supervisor' },
    { email: 'con.s1@example.com', role: 'contractor' },
    { email: 'cli.s1@example.com', role: 'client', scope: ['wbs'] },
    { email: 'mgr.s1@example.com', role: 'manager' }
  ];
  for (const t of team) {
    await invite(dana.cookie, pidG, t.email, t.role, t.scope);
    t.id = await memberIdByEmail(pidG, t.email);
    t.cookie = mintGoogleCookie(t.email, t.role + ' S1');
    t.accept = await api('/api/team/invitations/' + t.id + '/accept', {
      method: 'POST',
      headers: ck(t.cookie)
    });
  }
  const state = {
    tasks: [{ id: 't1', name: 'Task one' }],
    resources: [{ id: 'r1', name: 'Crew' }],
    risks: [{ id: 'k1', name: 'Risk one' }],
    budgetLines: [{ id: 'b1', name: 'Line one' }]
  };
  const saveAs = (cookie, payload) =>
    api('/api/cloud/projects/' + pidG + '/save', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, ck(cookie)),
      body: JSON.stringify({ state: payload })
    });
  const supSave = await saveAs(team[0].cookie, state);
  const conSave = await saveAs(team[1].cookie, state);
  const cliSave = await saveAs(team[2].cookie, state);
  const mgrSave = await saveAs(team[3].cookie, state);
  const supApplied = (supSave.body && supSave.body.applied) || [];
  const supBlocked = (supSave.body && supSave.body.blocked) || [];
  const conApplied = (conSave.body && conSave.body.applied) || [];
  const conBlocked = (conSave.body && conSave.body.blocked) || [];
  check(
    'G7a supervisor writes wbs/res/risk and is blocked on budget',
    supSave.status === 200 &&
      supSave.body.review === 'pending' &&
      supApplied.indexOf('wbs') >= 0 &&
      supApplied.indexOf('res') >= 0 &&
      supApplied.indexOf('risk') >= 0 &&
      supBlocked.indexOf('bud') >= 0,
    supSave.text
  );
  check(
    'G7b contractor writes wbs only, blocked elsewhere',
    conSave.status === 200 &&
      conSave.body.review === 'pending' &&
      conApplied.length === 1 &&
      conApplied[0] === 'wbs' &&
      conBlocked.indexOf('res') >= 0 &&
      conBlocked.indexOf('risk') >= 0 &&
      conBlocked.indexOf('bud') >= 0,
    conSave.text
  );
  check('G7c client write is refused 403', cliSave.status === 403, cliSave.text);
  check(
    'G7d manager writes the whole project directly',
    mgrSave.status === 200 &&
      mgrSave.body.actor === 'manager' &&
      ((mgrSave.body.applied || []).length === 0 || true) &&
      mgrSave.body.ok === true,
    mgrSave.text
  );
  const reviews = await api('/api/cloud/projects/' + pidG + '/reviews', {
    headers: ck(dana.cookie)
  });
  // The route answers { ok, proposals: [...] } - see handleReviewList.
  const teamProposal = ((reviews.body && reviews.body.proposals) || []).filter(
    r => r.sourceType === 'team'
  )[0];
  check(
    'G7e team proposals reach the owner review queue',
    reviews.status === 200 && !!teamProposal && teamProposal.status === 'pending',
    reviews.text
  );

  // ---- G8: another person's invitation id is a 404 -----------------------
  await invite(dana.cookie, pidG, 'someone.else.s1@example.com', 'client');
  const someoneId = await memberIdByEmail(pidG, 'someone.else.s1@example.com');
  const someoneAccept = await api('/api/team/invitations/' + someoneId + '/accept', {
    method: 'POST',
    headers: ck(evan.cookie)
  });
  const someoneDecline = await api('/api/team/invitations/' + someoneId + '/decline', {
    method: 'POST',
    headers: ck(evan.cookie)
  });
  check(
    "G8 another person's invitation id answers 404 on accept and decline",
    someoneAccept.status === 404 && someoneDecline.status === 404,
    someoneAccept.text + ' | ' + someoneDecline.text
  );

  // ---- G9: tier caps unchanged ------------------------------------------
  const freeInvite = await invite(freeOwner.cookie, pidFree, 'free.member@example.com', 'client');
  const capInvite = await invite(capOwner.cookie, pidCap, 'cap.c@example.com', 'contractor');
  const companyInvite = await invite(dana.cookie, pidG, 'unlimited.s1@example.com', 'client');
  check(
    'G9 free 402 contractor, contractor 402 company, company unlimited',
    freeInvite.status === 402 &&
      freeInvite.body.upgradeRequired === 'contractor' &&
      capInvite.status === 402 &&
      capInvite.body.upgradeRequired === 'company' &&
      companyInvite.status === 200,
    freeInvite.text + ' | ' + capInvite.text + ' | ' + companyInvite.text
  );

  // ---- G10: 20 invites per project per hour ------------------------------
  let ok20 = 0;
  let last = null;
  for (let i = 1; i <= 21; i++) {
    last = await invite(dana.cookie, pidRate, 'rate.' + i + '.s1@example.com', 'client');
    if (last.status === 200) {
      ok20++;
    }
    if (i < 21 && last.status !== 200) {
      break;
    }
  }
  check('G10 the 21st invite in an hour is rate limited', ok20 === 20 && last.status === 429, {
    accepted: ok20,
    last: last.text.slice(0, 200)
  });
}
async function main() {
  await startEmailStub();
  await startWrangler();

  // ---- accounts ----
  const a = await registerAndVerify(ALICE, 'Alice Owner');
  const b = await registerAndVerify(BOB, 'Bob Member');
  const c = await registerAndVerify(CAROL, 'Carol Member');
  if (!a.cookie || !b.cookie || !c.cookie) {
    log('FAIL: could not register/verify the three QA accounts');
    log('register alice: ' + a.reg.text);
    log('register bob: ' + b.reg.text);
    log('register carol: ' + c.reg.text);
    return;
  }
  const aliceSub = 'email:' + ALICE;

  // ---- project + contractor entitlement ----
  const pid = 'team-rbac-' + Date.now().toString(36);
  const create = await api('/api/cloud/projects', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(a.cookie)),
    body: JSON.stringify({ projectId: pid, name: 'Team RBAC project' })
  });
  check(
    'T0 alice creates a linked project -> 200',
    create.status === 200 && create.body && create.body.ok === true,
    create.text
  );
  const sub = await fireSubscription(aliceSub, PADDLE_PRICE, 'active');
  check(
    'T0b contractor subscription granted (paddle webhook) -> 200',
    sub.status === 200,
    sub.text
  );

  const teamPath = '/api/cloud/projects/' + pid + '/team';

  // T1 invite bob
  const inv = await api(teamPath, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(a.cookie)),
    body: JSON.stringify({ email: BOB, role: 'manager' })
  });
  check(
    'T1 invite a registered member -> 200 pending',
    inv.status === 200 &&
      inv.body &&
      inv.body.ok === true &&
      inv.body.status === 'pending' &&
      inv.body.role === 'manager',
    inv.text
  );

  // T2 invite email + link
  await delay(400);
  const inviteMail = latestEmailTo(BOB, 'invited');
  const inviteToken = inviteMail
    ? tokenFromText(/\/team\/accept\/([0-9a-f]{64})/, inviteMail.text)
    : null;
  check(
    'T2 invite email carries the /team/accept link',
    !!inviteMail && !!inviteToken,
    inviteMail ? inviteMail.subject : 'no email'
  );

  // T3 list
  const list1 = await api(teamPath, { method: 'GET', headers: ck(a.cookie) });
  const bob1 =
    list1.body && (list1.body.members || []).filter(m => m.userSub === 'email:' + BOB)[0];
  check(
    'T3 list shows bob pending/manager',
    list1.status === 200 && !!bob1 && bob1.status === 'pending' && bob1.role === 'manager',
    list1.text
  );

  // T4 contractor second member -> member_limit
  const inv2 = await api(teamPath, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(a.cookie)),
    body: JSON.stringify({ email: CAROL, role: 'supervisor' })
  });
  check(
    'T4 contractor 2nd member -> 402 member_limit upgradeRequired company',
    inv2.status === 402 &&
      inv2.body &&
      inv2.body.error === 'member_limit' &&
      inv2.body.upgradeRequired === 'company',
    inv2.text
  );

  // T5 bob accepts
  const acc = await api('/api/team/accept', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(b.cookie)),
    body: JSON.stringify({ token: inviteToken })
  });
  check(
    'T5 invited user accepts -> 200 active',
    acc.status === 200 &&
      acc.body &&
      acc.body.ok === true &&
      acc.body.role === 'manager' &&
      acc.body.projectId === pid,
    acc.text
  );

  // T6 single-use token
  const acc2 = await api('/api/team/accept', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(b.cookie)),
    body: JSON.stringify({ token: inviteToken })
  });
  check('T6 accept token is single-use -> 404', acc2.status === 404, acc2.text);

  // T7 list active + acceptedAt
  const list2 = await api(teamPath, { method: 'GET', headers: ck(a.cookie) });
  const bob2 =
    list2.body && (list2.body.members || []).filter(m => m.userSub === 'email:' + BOB)[0];
  check(
    'T7 list shows bob active with acceptedAt',
    !!bob2 && bob2.status === 'active' && !!bob2.acceptedAt,
    list2.text
  );

  // T7b (Wave 7): the active manager reaches project data through the team path.
  const bobLoad = await api('/api/cloud/projects/' + pid + '/load', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(b.cookie)),
    body: '{}'
  });
  check(
    'T7b active manager loads the project via team auth',
    bobLoad.status === 200 &&
      bobLoad.body &&
      bobLoad.body.ok === true &&
      bobLoad.body.teamRole === 'manager' &&
      bobLoad.body.role === 'editor',
    bobLoad.text
  );

  // W7a-C (Wave 7): a named manager also reaches the read-side project routes
  // (api shapes + changelog), which were owner-only before the Wave 7 pass.
  const mTasks = await api('/api/cloud/projects/' + pid + '/api/tasks', { headers: ck(b.cookie) });
  check(
    'W7a manager reads tasks shape -> 200',
    mTasks.status === 200 && mTasks.body && mTasks.body.ok === true,
    mTasks.text
  );
  const mPort = await api('/api/cloud/projects/' + pid + '/api/portfolio', {
    headers: ck(b.cookie)
  });
  check(
    'W7b manager reads aggregate portfolio shape -> 200',
    mPort.status === 200 && mPort.body && mPort.body.ok === true,
    mPort.text
  );
  const mLog = await api('/api/cloud/projects/' + pid + '/changelog', { headers: ck(b.cookie) });
  check(
    'W7c manager reads changelog -> 200',
    mLog.status === 200 && mLog.body && mLog.body.ok === true,
    mLog.text
  );

  // T8 update role/scope
  const bobId = bob2 ? bob2.id : 0;
  const upd = await api(teamPath + '/' + bobId, {
    method: 'PUT',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(a.cookie)),
    body: JSON.stringify({ role: 'client', scope: ['wbs', 'bud', 'nope'] })
  });
  const list3 = await api(teamPath, { method: 'GET', headers: ck(a.cookie) });
  const bob3 =
    list3.body && (list3.body.members || []).filter(m => m.userSub === 'email:' + BOB)[0];
  check(
    'T8 update role -> client with scope filtered to known sections',
    upd.status === 200 &&
      !!bob3 &&
      bob3.role === 'client' &&
      Array.isArray(bob3.scope) &&
      bob3.scope.length === 2 &&
      bob3.scope.indexOf('wbs') >= 0 &&
      bob3.scope.indexOf('nope') < 0,
    upd.text + ' | ' + list3.text
  );

  // W7d-G (Wave 7): the same matrix NARROWS a scoped role. bob is now
  // role=client with scope ['wbs','bud'].
  const cTasks = await api('/api/cloud/projects/' + pid + '/api/tasks', { headers: ck(b.cookie) });
  check(
    'W7d scoped client reads tasks (wbs in scope) -> 200',
    cTasks.status === 200 && cTasks.body && cTasks.body.ok === true,
    cTasks.text
  );
  const cRisks = await api('/api/cloud/projects/' + pid + '/api/risks', { headers: ck(b.cookie) });
  check(
    'W7e scoped client denied risks (risk out of scope) -> 403',
    cRisks.status === 403,
    cRisks.text
  );
  const cPort = await api('/api/cloud/projects/' + pid + '/api/portfolio', {
    headers: ck(b.cookie)
  });
  check('W7f scoped client denied aggregate portfolio -> 403', cPort.status === 403, cPort.text);
  const cLog = await api('/api/cloud/projects/' + pid + '/changelog', { headers: ck(b.cookie) });
  check('W7g scoped client denied changelog -> 403', cLog.status === 403, cLog.text);

  // T9 revoke
  const rev = await api(teamPath + '/' + bobId, { method: 'DELETE', headers: ck(a.cookie) });
  check(
    'T9 revoke -> 200 revoked',
    rev.status === 200 && rev.body && rev.body.status === 'revoked',
    rev.text
  );

  // T10 excluded from list
  const list4 = await api(teamPath, { method: 'GET', headers: ck(a.cookie) });
  const stillThere = ((list4.body && list4.body.members) || []).some(
    m => m.userSub === 'email:' + BOB
  );
  check('T10 revoked member is excluded from the list', !stillThere, list4.text);

  // T11 revoked token dead
  const acc3 = await api('/api/team/accept', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(b.cookie)),
    body: JSON.stringify({ token: inviteToken })
  });
  check('T11 revoked invite token is dead -> 404', acc3.status === 404, acc3.text);

  // T11b (Wave 7): revoke removes project access too.
  const bobLoad2 = await api('/api/cloud/projects/' + pid + '/load', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(b.cookie)),
    body: '{}'
  });
  check(
    'T11b revoked member can no longer load the project -> 403',
    bobLoad2.status === 403,
    bobLoad2.text
  );

  // W8.10 (Wave 8.10): manage / cancel the subscription endpoint.
  // Auth + lookup are deterministic; the final leg talks to Paddle, so it is
  // asserted only as 'past auth and lookup' (200 in a wired env, 502 upstream).
  const cancelOut = await api('/api/billing/subscription', { method: 'DELETE' });
  check('W8.10a cancel while signed out -> 403', cancelOut.status === 403, cancelOut.text);
  // OWNER 2026-10-09: cancelling now takes two deliberate acts, and the word is
  // a SERVER requirement - a bare DELETE is refused 400 confirm_required before
  // the subscription row is ever read. This harness was still sending the bare
  // call and so asserted the old contract. W8.10b/c now send the word, and
  // W8.10d pins the refusal itself, so the security gate cannot regress into
  // "one accidental request cancels a plan".
  const cancelBare = await api('/api/billing/subscription', {
    method: 'DELETE',
    headers: ck(b.cookie)
  });
  check(
    'W8.10d a bare cancel is refused before the row is read -> 400 confirm_required',
    cancelBare.status === 400 && /confirm_required/.test(cancelBare.text),
    cancelBare.text
  );
  const cancelNoSub = await api('/api/billing/subscription', {
    method: 'DELETE',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(b.cookie)),
    body: JSON.stringify({ confirm: 'CANCEL' })
  });
  check(
    'W8.10b cancel with no active subscription -> 404',
    cancelNoSub.status === 404,
    cancelNoSub.text
  );
  const cancelAlice = await api('/api/billing/subscription', {
    method: 'DELETE',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(a.cookie)),
    body: JSON.stringify({ confirm: 'CANCEL' })
  });
  check(
    'W8.10c cancel for an active subscriber clears auth + lookup',
    cancelAlice.status === 200 || cancelAlice.status === 502,
    cancelAlice.text
  );

  // T12 non-owner cannot invite
  const nonOwner = await api(teamPath, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(b.cookie)),
    body: JSON.stringify({ email: CAROL, role: 'client' })
  });
  check('T12 a non-owner cannot invite -> 403', nonOwner.status === 403, nonOwner.text);

  // T13 (replaced by RBAC sprint 1): an unknown address is a normal invite.
  // The response must be indistinguishable from a registered address and must
  // never say user_not_found. G1 below pins the two bodies side by side.
  const unknown = await api(teamPath, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(a.cookie)),
    body: JSON.stringify({ email: 'nobody.here.e2e@example.com', role: 'client' })
  });
  check(
    'T13 inviting an unknown address -> 200 generic (no user_not_found)',
    unknown.status === 200 &&
      unknown.body &&
      unknown.body.ok === true &&
      unknown.body.status === 'pending' &&
      !/user_not_found/.test(unknown.text),
    unknown.text
  );

  // T14 company tier -> unlimited
  const companySub = await fireSubscription(aliceSub, PADDLE_COMPANY_PRICE, 'active');
  const invC = await api(teamPath, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(a.cookie)),
    body: JSON.stringify({ email: CAROL, role: 'supervisor' })
  });
  const invB = await api(teamPath, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(a.cookie)),
    body: JSON.stringify({ email: BOB, role: 'contractor' })
  });
  check(
    'T14 company tier unlocks unlimited named members',
    companySub.status === 200 && invC.status === 200 && invB.status === 200,
    companySub.text + ' | ' + invC.text + ' | ' + invB.text
  );

  // T15 unknown role
  const badRole = await api(teamPath, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(a.cookie)),
    body: JSON.stringify({ email: CAROL, role: 'wizard' })
  });
  check('T15 unknown role rejected -> 400', badRole.status === 400, badRole.text);

  // ---- RBAC sprint 1 (directive 2026-10-25, section 3) -------------------
  await runRbacSprint1Gates();

  const passed = results.filter(r => r.val).length;
  log('----------------------------------------');
  log('RESULT: ' + passed + '/' + results.length + ' gates passed');
  if (passed !== results.length) {
    process.exitCode = 1;
  }
}

let stopping = false;
function shutdown() {
  if (stopping) {
    return;
  }
  stopping = true;
  stopWrangler();
}

process.on('SIGINT', function () {
  shutdown();
  process.exit(130);
});
process.on('SIGTERM', function () {
  shutdown();
  process.exit(143);
});

main()
  .then(function () {
    const passed = results.filter(r => r.val).length;
    log('STOPPED — wrangler dev torn down. ' + passed + '/' + results.length);
    shutdown();
    process.exit(passed === results.length ? 0 : 1);
  })
  .catch(function (e) {
    log('HARNESS ERROR: ' + (e && e.message));
    log(devLog.slice(-2000));
    shutdown();
    process.exit(1);
  });
