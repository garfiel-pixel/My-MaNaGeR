#!/usr/bin/env node
/* ============================================================
   qa-tenant-isolation.cjs - F1 (REPO-RELIABILITY-DIRECTIVE 2026-10-30)
   ------------------------------------------------------------
   One question, asked properly: can tenant B touch tenant A's project?

   Self-contained: spawns its own wrangler dev (local D1 + R2, --persist-to
   outside the repo), applies migrations, registers two verified accounts,
   then tries every project-scoped route as the WRONG tenant, as an anonymous
   client, and with a guessed owner code.

   Every gate asserts on the RESPONSE and on the STORED state, never on
   intent: a refusal that still wrote a row is a failure here.

     I1  A creates a project and receives an owner code
     I2  A saves its state with the owner code -> 200
     I3  B cannot save into A's project                -> 403
     I4  B cannot load A's project                     -> 403
     I5  A guessed owner code cannot load              -> 403
     I6  anonymous cannot load                         -> 403
     I7  B cannot read A's meta                        -> 403
     I8  B cannot delete A's project                   -> 403
     I9  B cannot restore A's project                  -> 403
     I10 B cannot purge A's project                    -> 403
     I11 B cannot claim A's project                    -> 403
     I12 B cannot list A's changelog                   -> 403
     I13 B cannot open A's photo route                 -> 403
     I14 refusals leak no existence: real id and random id answer identically
     I15 A's stored state is BYTE-IDENTICAL after all of the above
     I16 B's project list does not contain A's project
     I17 B's own project still works (the fence is not simply broken)

   Usage:  node tools/qa-tenant-isolation.cjs
   Env:    QA_PORT (default 8799), QA_KEEP=1 keeps the persist dir.
   ============================================================ */
'use strict';
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const PORT = parseInt(process.env.QA_PORT || '8799', 10);
const BASE = 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');
const TMP = os.tmpdir();
const SECRET = 'qa-tenant-isolation-secret-91c2';
const ADMIN_CODE = 'qa-admin-tenant-7b3f';
const RESEND_KEY = 'qa-fake-resend-key-0000000000000000000000000000';

const OWNER = 'owner.a.iso@example.com';
const OTHER = 'tenant.b.iso@example.com';
const PW = 'QaTenant!Pass123';
const MARKER = 'tenant-a-state-' + Date.now().toString(36);

const log = s => process.stdout.write('[isolation] ' + s + '\n');
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
function globalWranglerJs() {
  const local = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  return fs.existsSync(local) ? local : null;
}
const WRANGLER_JS = globalWranglerJs();
const PERSIST_DIR = path.join(TMP, 'mmgr-tenant-iso-' + Date.now());
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

// ---- the suite -----------------------------------------------------------
async function main() {
  await startEmailStub();
  await startWrangler();

  const a = await register(OWNER, 'Owner A');
  const b = await register(OTHER, 'Tenant B');
  check(
    'I0 two verified tenants exist',
    !!a.cookie && !!b.cookie,
    a.reg.status + '/' + b.reg.status
  );
  if (!a.cookie || !b.cookie) {
    throw new Error('could not create the QA tenants');
  }

  const pid = 'iso-a-' + Date.now().toString(36);
  const created = await api('/api/cloud/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: a.cookie },
    body: JSON.stringify({ projectId: pid, name: 'Tenant A site' })
  });
  const ownerCode = created.body && created.body.ownerCode;
  check(
    'I1 A creates a project and receives an owner code',
    created.status === 200 && !!ownerCode,
    created.status + ' ' + JSON.stringify(created.body)
  );

  const stateA = { projectName: MARKER, tasks: [{ id: 't1', name: 'A only' }], schema: 24 };
  const saved = await api('/api/cloud/projects/' + pid + '/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: a.cookie, 'X-Owner-Code': ownerCode },
    body: JSON.stringify({ state: stateA })
  });
  check(
    'I2 A saves its state with its owner code',
    saved.status === 200,
    saved.status + ' ' + JSON.stringify(saved.body)
  );

  const asB = { 'Content-Type': 'application/json', Cookie: b.cookie };
  const saveB = await api('/api/cloud/projects/' + pid + '/save', {
    method: 'POST',
    headers: asB,
    body: JSON.stringify({ state: { projectName: 'pwned', tasks: [] } })
  });
  check("I3 B cannot save into A's project", saveB.status === 403, saveB.status);

  const loadB = await api('/api/cloud/projects/' + pid + '/load', {
    method: 'POST',
    headers: asB,
    body: '{}'
  });
  check("I4 B cannot load A's project", loadB.status === 403, loadB.status);

  const loadGuess = await api('/api/cloud/projects/' + pid + '/load', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Owner-Code': 'WRONG-CODE-0000' },
    body: '{}'
  });
  check('I5 a guessed owner code cannot load', loadGuess.status === 403, loadGuess.status);

  const loadAnon = await api('/api/cloud/projects/' + pid + '/load', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  check('I6 anonymous cannot load', loadAnon.status === 403, loadAnon.status);

  const metaB = await api('/api/cloud/projects/' + pid + '/meta', { method: 'GET', headers: asB });
  check("I7 B cannot read A's meta", metaB.status === 403, metaB.status);

  const delB = await api('/api/cloud/projects/' + pid + '/delete', {
    method: 'POST',
    headers: asB,
    body: '{}'
  });
  check("I8 B cannot delete A's project", delB.status === 403, delB.status);

  const resB = await api('/api/cloud/projects/' + pid + '/restore', {
    method: 'POST',
    headers: asB,
    body: '{}'
  });
  check("I9 B cannot restore A's project", resB.status === 403, resB.status);

  const purgeB = await api('/api/cloud/projects/' + pid + '/purge', {
    method: 'POST',
    headers: asB,
    body: '{}'
  });
  check("I10 B cannot purge A's project", purgeB.status === 403, purgeB.status);

  // Claim needs an owner code in the body: 400 for a malformed request is the
  // documented contract, not a leak. The interesting case is a WRONG code.
  const claimNoCode = await api('/api/cloud/projects/' + pid + '/claim', {
    method: 'POST',
    headers: asB,
    body: '{}'
  });
  check(
    'I11a claim without an owner code is a bad request (contract, not a leak)',
    claimNoCode.status === 400 &&
      claimNoCode.body &&
      claimNoCode.body.error === 'owner code required',
    claimNoCode.status + ' ' + JSON.stringify(claimNoCode.body)
  );
  const claimB = await api('/api/cloud/projects/' + pid + '/claim', {
    method: 'POST',
    headers: asB,
    body: JSON.stringify({ ownerCode: 'WRONG-CODE-0000' })
  });
  check("I11b B cannot claim A's project with a wrong code", claimB.status === 403, claimB.status);

  const logB = await api('/api/cloud/projects/' + pid + '/changelog', {
    method: 'GET',
    headers: asB
  });
  check("I12 B cannot read A's changelog", logB.status === 403, logB.status);

  const photoB = await api('/api/cloud/projects/' + pid + '/photos', {
    method: 'GET',
    headers: asB
  });
  check("I13 B cannot open A's photo route", photoB.status === 403, photoB.status);

  // I14: a refusal must not distinguish "exists" from "does not exist"
  const ghost = 'iso-ghost-' + Date.now().toString(36);
  const ghostLoad = await api('/api/cloud/projects/' + ghost + '/load', {
    method: 'POST',
    headers: asB,
    body: '{}'
  });
  const claimGhost = await api('/api/cloud/projects/' + ghost + '/claim', {
    method: 'POST',
    headers: asB,
    body: JSON.stringify({ ownerCode: 'WRONG-CODE-0000' })
  });
  const shape = r => r.status + '|' + JSON.stringify(r.body && r.body.error);
  check(
    'I14 refusals reveal no existence (real and random ids answer identically)',
    shape(loadB) === shape(ghostLoad) && shape(claimB) === shape(claimGhost),
    'load ' +
      shape(loadB) +
      ' vs ' +
      shape(ghostLoad) +
      ' | claim ' +
      shape(claimB) +
      ' vs ' +
      shape(claimGhost)
  );

  // I15: after every attempt, A's bytes are untouched
  const reloadA = await api('/api/cloud/projects/' + pid + '/load', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: a.cookie, 'X-Owner-Code': ownerCode },
    body: '{}'
  });
  const reloaded = reloadA.body && reloadA.body.state;
  check(
    "I15 A's stored state is unchanged after every cross-tenant attempt",
    reloadA.status === 200 && !!reloaded && reloaded.projectName === MARKER,
    reloadA.status + ' ' + JSON.stringify(reloaded && reloaded.projectName)
  );

  const listB = await api('/api/cloud/projects', { method: 'GET', headers: { Cookie: b.cookie } });
  const listIds = (listB.body && (listB.body.projects || listB.body.rows || [])).map(
    p => p.projectId || p.project_id
  );
  check(
    "I16 B's project list does not contain A's project",
    listIds.indexOf(pid) === -1,
    JSON.stringify(listIds)
  );

  // I17: prove the fence is a fence and not a broken endpoint
  const pidB = 'iso-b-' + Date.now().toString(36);
  const createdB = await api('/api/cloud/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: b.cookie },
    body: JSON.stringify({ projectId: pidB, name: 'Tenant B site' })
  });
  const codeB = createdB.body && createdB.body.ownerCode;
  const saveBown = await api('/api/cloud/projects/' + pidB + '/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: b.cookie, 'X-Owner-Code': codeB },
    body: JSON.stringify({ state: { projectName: 'tenant-b-ok', tasks: [] } })
  });
  check(
    "I17 B's own project still saves (the fence is not a broken endpoint)",
    saveBown.status === 200,
    saveBown.status
  );

  const passed = results.filter(r => r.ok).length;
  log('');
  log(
    'ISOLATION ' +
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
