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
    if (m.to === email && (!subjectPart || String(m.subject).indexOf(subjectPart) >= 0)) return m;
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
    if (fs.existsSync(lp)) return lp;
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
    if (fs.existsSync(p)) return p;
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
      if (r.ok) return;
    } catch (e) {
      /* not up yet */
    }
    if (Date.now() - t0 > 120000) throw new Error('wrangler dev did not come up in 120s');
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
function cookieFrom(res) {
  const sc = res.headers.get('set-cookie');
  if (!sc) return null;
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
  if (reg.status !== 200) return { reg, cookie: null };
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
    ? tokenFromText(/\/team\/accept\/([0-9a-f]{32})/, inviteMail.text)
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
  const cancelNoSub = await api('/api/billing/subscription', {
    method: 'DELETE',
    headers: ck(b.cookie)
  });
  check(
    'W8.10b cancel with no active subscription -> 404',
    cancelNoSub.status === 404,
    cancelNoSub.text
  );
  const cancelAlice = await api('/api/billing/subscription', {
    method: 'DELETE',
    headers: ck(a.cookie)
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

  // T13 unknown address
  const unknown = await api(teamPath, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(a.cookie)),
    body: JSON.stringify({ email: 'nobody.here.e2e@example.com', role: 'client' })
  });
  check(
    'T13 inviting an unknown address -> 404 user_not_found',
    unknown.status === 404 && unknown.body && unknown.body.error === 'user_not_found',
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

  const passed = results.filter(r => r.val).length;
  log('----------------------------------------');
  log('RESULT: ' + passed + '/' + results.length + ' gates passed');
  if (passed !== results.length) process.exitCode = 1;
}

let stopping = false;
function shutdown() {
  if (stopping) return;
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
