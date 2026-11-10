#!/usr/bin/env node
/* ============================================================
   qa-team-invite.cjs - WAVE 3 (owner 2026-11-10)
   ------------------------------------------------------------
   The owner's report: "I'm an enterprise tier. I should be able to send out
   invites to my project. I'm not seeing that." The panel now offers one
   email, one role, one Invite button, and it must work for a SESSION owner
   with no owner code on the device.

   This harness proves the whole loop against a real Worker + D1:

     T1  owner A creates a cloud project (session only)
     T2  A invites B by email with NO owner-code header  -> 200
     T3  the invitation is listed for B
     T4  B accepts it                                    -> 200
     T5  B's "Shared with me" list contains the project
     T6  B can load the project
     T7  A's team list shows B active (and the member id)
     T8  A revokes B                                     -> 200
     T9  B can no longer load the project                -> 403
     T10 B's "Shared with me" list no longer contains it
     T11 the pending invitation list no longer contains it
     T12 a bad email is refused (contract, not a crash)
     T13 an unknown role is refused
     T14 A can invite the same address again after the revoke
     T15 a stranger with no session cannot invite

   Usage:  node tools/qa-team-invite.cjs
   Env:    QA_PORT (default 8801), QA_KEEP=1 keeps the persist dir.
   ============================================================ */
'use strict';
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { DatabaseSync } = require('node:sqlite');

const PORT = parseInt(process.env.QA_PORT || '8801', 10);
const BASE = 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');
const TMP = os.tmpdir();
const SECRET = 'qa-team-invite-secret-4d21';
const ADMIN_CODE = 'qa-admin-team-9c4e';
const RESEND_KEY = 'qa-fake-resend-key-0000000000000000000000000000';

const OWNER = 'owner.invite@example.com';
const GUEST = 'guest.invite@example.com';
const PW = 'QaTeam!Pass12345';

const log = s => process.stdout.write('[team-invite] ' + s + '\n');
const delay = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  log((ok ? 'PASS' : 'FAIL') + '  ' + name + (ok ? '' : '   <-- ' + String(detail).slice(0, 300)));
}

// ---- email stub (verification links) -------------------------------------
const stubEmails = [];
let stubPort = 0;
function startEmailStub() {
  const srv = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/emails') {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => {
        try {
          const j = JSON.parse(body);
          stubEmails.push({ to: String(j.to || ''), subject: j.subject, text: j.text });
        } catch (e) {
          /* ignore */
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"id":"stub"}');
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise(resolve =>
    srv.listen(0, '127.0.0.1', () => {
      stubPort = srv.address().port;
      resolve(srv);
    })
  );
}
function tokenFor(email) {
  for (let i = stubEmails.length - 1; i >= 0; i--) {
    const m = stubEmails[i];
    if (m.to !== email) {
      continue;
    }
    const hit = String(m.text || '').match(/\/verify\.html\?token=([^\s\n]+)/);
    if (hit) {
      return hit[1];
    }
  }
  return null;
}

// ---- wrangler dev --------------------------------------------------------
const WRANGLER_JS = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const PERSIST_DIR = path.join(TMP, 'mmgr-team-invite-' + Date.now());
const { stopWranglerIfLocal } = require('./wrangler-ci-helpers.cjs');
let proc = null;

async function startWrangler() {
  log('starting wrangler dev on :' + PORT);
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
    log('migrations best-effort: ' + e.message);
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
    'FREE_PROJECT_CAP:5',
    '--var',
    'PROJECTS_PER_USER_CAP:5',
    '--var',
    'RATE_LIMIT_DISABLED:1',
    '--var',
    'RESEND_API_KEY:' + RESEND_KEY,
    '--var',
    'RESEND_FROM_EMAIL:onboarding@resend.dev',
    '--var',
    'RESEND_API_BASE:http://127.0.0.1:' + stubPort,
    '--var',
    'PADDLE_ENV:sandbox'
  ];
  proc = spawn(process.execPath, args, {
    cwd: ROOT,
    env: Object.assign({}, process.env, { WRANGLER_SEND_METRICS: 'false' }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let devLog = '';
  proc.stdout.on('data', d => (devLog += d));
  proc.stderr.on('data', d => (devLog += d));
  const t0 = Date.now();
  for (;;) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const r = await fetch(BASE + '/api/health', { signal: ctrl.signal });
      clearTimeout(timer);
      if (r.ok) {
        return;
      }
    } catch (e) {
      /* not up yet */
    }
    if (Date.now() - t0 > 150000) {
      throw new Error('wrangler dev did not come up: ' + devLog.slice(-800));
    }
    await delay(1500);
  }
}
function stopWrangler() {
  try {
    stopWranglerIfLocal(proc);
  } catch (e) {
    /* ignore */
  }
  try {
    proc && proc.kill();
  } catch (e) {
    /* ignore */
  }
}

// ---- request helpers -----------------------------------------------------
const _calls = [];
async function pace() {
  const now = Date.now();
  while (_calls.length && _calls[0] <= now - 60000) {
    _calls.shift();
  }
  if (_calls.length >= 24) {
    await delay(_calls[0] + 60000 - now + 100);
    return pace();
  }
  _calls.push(now);
}
async function api(p, opts) {
  await pace();
  const res = await fetch(BASE + p, Object.assign({}, opts || {}));
  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    body = null;
  }
  return { status: res.status, body, headers: res.headers };
}
function cookieOf(res) {
  const sc = res.headers.get('set-cookie');
  if (!sc) {
    return '';
  }
  const m = sc.match(/mmgr_session=([^;]+)/);
  return m ? 'mmgr_session=' + m[1] : '';
}
async function register(email, name) {
  const reg = await api('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PW, name })
  });
  if (reg.status !== 200) {
    return { cookie: '', reg };
  }
  const cookie = cookieOf(reg);
  await delay(400);
  const tok = tokenFor(email);
  if (tok) {
    await api('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: tok })
    });
  }
  return { cookie, reg };
}

// ---- direct local D1 (seed the paid tier the invite route reads) ---------
function findD1Sqlite() {
  const base = path.join(PERSIST_DIR, 'v3', 'd1', 'miniflare-D1DatabaseObject');
  if (!fs.existsSync(base)) {
    return null;
  }
  const files = fs.readdirSync(base).filter(f => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
  return files.length ? path.join(base, files[0]) : null;
}
async function d1Run(sql, ...params) {
  const dbPath = findD1Sqlite();
  if (!dbPath) {
    throw new Error('local D1 sqlite not found under ' + PERSIST_DIR);
  }
  let lastErr = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const db = new DatabaseSync(dbPath);
    try {
      db.prepare(sql).run(...params);
      db.close();
      return;
    } catch (e) {
      lastErr = e;
      try {
        db.close();
      } catch (e2) {
        /* already closed */
      }
      await delay(200);
    }
  }
  throw lastErr;
}

// ---- the suite -----------------------------------------------------------
async function main() {
  await startEmailStub();
  await startWrangler();

  const a = await register(OWNER, 'Owner A');
  const b = await register(GUEST, 'Guest B');
  check(
    'T0 two verified accounts exist',
    !!a.cookie && !!b.cookie,
    a.reg.status + '/' + b.reg.status
  );
  if (!a.cookie || !b.cookie) {
    throw new Error('could not create the QA accounts');
  }

  // The invite route reads the OWNER's subscription row for the tier. Seed an
  // enterprise plan so the gate exercises the paid path the owner reported.
  const sub = await api('/api/auth/me', { headers: { Cookie: a.cookie } });
  const ownerSub = (sub.body && sub.body.user && sub.body.user.sub) || '';
  if (ownerSub) {
    await d1Run(
      "INSERT OR REPLACE INTO cloud_subscriptions (owner_sub, ls_subscription_id, status, plan, tier, current_period_end, created_at, updated_at) VALUES (?, 'qa-sub', 'active', 'enterprise', 'enterprise', NULL, ?, ?)",
      ownerSub,
      new Date().toISOString(),
      new Date().toISOString()
    );
  }

  const pid = 'team-a-' + Date.now().toString(36);
  const created = await api('/api/cloud/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: a.cookie },
    body: JSON.stringify({ projectId: pid, name: 'Invite gate site' })
  });
  check(
    'T1 owner A creates a cloud project',
    created.status === 200 && !!(created.body && created.body.ownerCode),
    created.status + ' ' + JSON.stringify(created.body)
  );

  // T2 is the owner's actual complaint: the invite must work with the SESSION
  // alone. No X-Owner-Code header is sent on purpose.
  const invited = await api('/api/cloud/projects/' + pid + '/team', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: a.cookie },
    body: JSON.stringify({ email: GUEST, role: 'contractor' })
  });
  check(
    'T2 the owner invites by email with the session only',
    invited.status === 200 && !!(invited.body && invited.body.ok),
    invited.status + ' ' + JSON.stringify(invited.body)
  );

  const invB = await api('/api/team/invitations', { headers: { Cookie: b.cookie } });
  const rows = (invB.body && invB.body.invitations) || [];
  const row = rows.find(r => r.projectId === pid);
  check(
    'T3 the invitation is listed for the invited address',
    invB.status === 200 && !!row,
    invB.status + ' ' + JSON.stringify(rows.map(r => r.projectId))
  );

  const accepted = await api('/api/team/invitations/' + (row ? row.id : 0) + '/accept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: b.cookie },
    body: '{}'
  });
  check(
    'T4 the invited person accepts',
    accepted.status === 200 && !!(accepted.body && accepted.body.ok),
    accepted.status + ' ' + JSON.stringify(accepted.body)
  );

  const shared = await api('/api/team/memberships', { headers: { Cookie: b.cookie } });
  const sharedIds = ((shared.body && shared.body.memberships) || []).map(p => p.projectId);
  check(
    'T5 the project appears in "Shared with me"',
    sharedIds.indexOf(pid) > -1,
    JSON.stringify(sharedIds)
  );

  const loadB = await api('/api/cloud/projects/' + pid + '/load', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: b.cookie },
    body: '{}'
  });
  check('T6 the member can load the project', loadB.status === 200, loadB.status);

  const teamA = await api('/api/cloud/projects/' + pid + '/team', {
    headers: { Cookie: a.cookie }
  });
  const members = (teamA.body && teamA.body.members) || [];
  const member = members.find(m => m.userSub && m.userSub.indexOf(GUEST) > -1);
  check(
    "T7 the owner's team list shows the member active",
    !!member && member.status === 'active',
    JSON.stringify(members.map(m => m.userSub + ':' + m.status))
  );

  const revoked = await api('/api/cloud/projects/' + pid + '/team/' + (member ? member.id : 0), {
    method: 'DELETE',
    headers: { Cookie: a.cookie }
  });
  check(
    'T8 the owner revokes the member',
    revoked.status === 200 && !!(revoked.body && revoked.body.ok),
    revoked.status + ' ' + JSON.stringify(revoked.body)
  );

  const loadAfter = await api('/api/cloud/projects/' + pid + '/load', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: b.cookie },
    body: '{}'
  });
  check('T9 the revoked member is refused (403)', loadAfter.status === 403, loadAfter.status);

  const sharedAfter = await api('/api/team/memberships', { headers: { Cookie: b.cookie } });
  const sharedAfterIds = ((sharedAfter.body && sharedAfter.body.memberships) || []).map(
    p => p.projectId
  );
  check(
    'T10 the revoked project leaves "Shared with me"',
    sharedAfterIds.indexOf(pid) === -1,
    JSON.stringify(sharedAfterIds)
  );

  const invAfter = await api('/api/team/invitations', { headers: { Cookie: b.cookie } });
  const afterRows = ((invAfter.body && invAfter.body.invitations) || []).map(r => r.projectId);
  check(
    'T11 no pending invitation survives the revoke',
    afterRows.indexOf(pid) === -1,
    afterRows.join(',')
  );

  const badEmail = await api('/api/cloud/projects/' + pid + '/team', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: a.cookie },
    body: JSON.stringify({ email: 'not-an-email', role: 'contractor' })
  });
  check(
    'T12 a malformed email is a plain 400',
    badEmail.status === 400 && !!(badEmail.body && badEmail.body.error),
    badEmail.status + ' ' + JSON.stringify(badEmail.body)
  );

  const badRole = await api('/api/cloud/projects/' + pid + '/team', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: a.cookie },
    body: JSON.stringify({ email: GUEST, role: 'wizard' })
  });
  check(
    'T13 an unknown role is refused',
    badRole.status === 400 && badRole.body && badRole.body.error === 'unknown role',
    badRole.status + ' ' + JSON.stringify(badRole.body)
  );

  const again = await api('/api/cloud/projects/' + pid + '/team', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: a.cookie },
    body: JSON.stringify({ email: GUEST, role: 'client' })
  });
  check(
    'T14 the same address can be invited again after a revoke',
    again.status === 200 && !!(again.body && again.body.ok),
    again.status + ' ' + JSON.stringify(again.body)
  );

  const anon = await api('/api/cloud/projects/' + pid + '/team', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'stranger@example.com', role: 'contractor' })
  });
  check('T15 an anonymous caller cannot invite', anon.status === 403, anon.status);

  const passed = results.filter(r => r.ok).length;
  log('');
  log(
    'TEAM INVITE ' +
      (passed === results.length ? 'PASS' : 'FAIL') +
      ' - ' +
      passed +
      '/' +
      results.length +
      ' gates'
  );
  return passed === results.length;
}

let ok = false;
main()
  .then(v => {
    ok = v;
  })
  .catch(e => {
    log('ERROR ' + (e && e.message ? e.message : e));
  })
  .finally(() => {
    stopWrangler();
    if (!process.env.QA_KEEP) {
      try {
        fs.rmSync(PERSIST_DIR, { recursive: true, force: true });
      } catch (e) {
        /* ignore */
      }
    }
    process.exit(ok ? 0 : 1);
  });
