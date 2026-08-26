/* ============================================================
   QA gate — REAL-TIME PRESENCE (Durable Objects)
   Zero dependencies. Run:  node tools/qa-presence.cjs
   (also wired as npm run qa:presence)

   Spins up a LOCAL wrangler dev (own persist dir, migrations
   applied, known GOOGLE_CLIENT_SECRET + ADMIN_CODE vars), creates
   a session-linked cloud project, then exercises the presence
   WebSocket end-to-end with Node's built-in WebSocket client:

     P1  session-linked cloud project create returns owner code
     P2  no credentials          -> 403 (generic)
     P3  wrong owner code        -> 403
     P4  unknown project         -> 403
     P5  unrelated session       -> 403
     P6  owner-code socket opens, init with 0 members
     P7  linked-session socket opens, init lists the owner client
     P8  join broadcast reaches the first client
     P9  leave broadcast reaches the first client
     P10 ping -> pong keepalive
     P11 roster persists across connections (init lists earlier member)

   Tears wrangler dev down cleanly. Requires the global wrangler CLI
   (same resolution as the other cloud harnesses).
   ============================================================ */
'use strict';
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

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
if (!WRANGLER_JS) {
  console.error('qa-presence: global wrangler CLI not found — install it with `npm i -g wrangler`.');
  process.exit(0); // environment gap, not a code regression
}

const PORT = 8796;
const PERSIST = path.join(os.tmpdir(), 'mmgr-presence-e2e-' + Date.now());
const SECRET = 'presence-test-secret-1234567890';
const ADMIN = 'PRESENCE-ADMIN';
const BASE = 'http://127.0.0.1:' + PORT;

let passes = 0, fails = 0;
function check(name, ok, detail) {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + String(detail).slice(0, 220) : ''));
  ok ? passes++ : fails++;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, timeout, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { const v = await fn(); if (v) return v; } catch (e) { /* keep waiting */ }
    await sleep(400);
  }
  throw new Error('timeout waiting for ' + what);
}

function b64u(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
// Byte-identical to worker.js signSession: base64url(JSON payload) + '.' + base64url(HMAC-SHA256 over the exact payload string).
function mintCookie(sub, name) {
  const payload = { sub, email: sub + '@test.dev', name, picture: '', exp: Math.floor(Date.now() / 1000) + 3600 };
  const jsonStr = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', SECRET).update(jsonStr).digest();
  return b64u(Buffer.from(jsonStr)) + '.' + b64u(sig);
}

function wsClient(url, cookie) {
  return new Promise((resolve) => {
    const headers = cookie ? { Cookie: 'mmgr_session=' + cookie } : {};
    let ws;
    try { ws = new WebSocket(url, { headers }); } catch (e) { resolve({ opened: false, msgs: [], closed: false, err: e, ws: null }); return; }
    const msgs = [];
    let opened = false, closed = false, err = null;
    ws.onopen = () => { opened = true; };
    ws.onmessage = (ev) => { try { msgs.push(JSON.parse(String(ev.data))); } catch (e) { msgs.push(String(ev.data)); } };
    ws.onerror = (e) => { err = e; };
    ws.onclose = () => { closed = true; };
    // Allow for DO cold-wake on the first connection after idle.
    setTimeout(() => resolve({ ws, opened, msgs, closed, err }), 3500);
  });
}

async function main() {
  fs.rmSync(PERSIST, { recursive: true, force: true });
  fs.mkdirSync(PERSIST, { recursive: true });
  execFileSync(process.execPath, [WRANGLER_JS, 'd1', 'migrations', 'apply', 'my-manager-db', '--local', '--config', 'wrangler.ci.jsonc', '--persist-to', PERSIST], { stdio: 'ignore' });
  console.log('qa-presence: migrations applied (local persist)');

  const dev = spawn(process.execPath, [WRANGLER_JS, 'dev', '--config', 'wrangler.ci.jsonc', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', PERSIST,
    '--var', 'GOOGLE_CLIENT_SECRET:' + SECRET, '--var', 'ADMIN_CODE:' + ADMIN], { stdio: ['ignore', 'pipe', 'pipe'] });
  dev.stdout.on('data', d => process.stdout.write('[dev] ' + d));
  dev.stderr.on('data', d => process.stdout.write('[dev!] ' + d));

  try {
    await waitFor(async () => { try { return (await fetch(BASE + '/api/health')).ok; } catch (e) { return false; } }, 120000, 'wrangler dev');
    console.log('qa-presence: wrangler dev up on :' + PORT);

    const cookieAlice = mintCookie('sub-alice', 'Alice');
    const cookieBob = mintCookie('sub-bob', 'Bob');

    // P1 — create a cloud project linked to Alice's session (owner code returned once).
    const create = await fetch(BASE + '/api/cloud/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: 'mmgr_session=' + cookieAlice },
      body: JSON.stringify({ projectId: 'presence-e2e-1', name: 'Presence Test' })
    });
    const created = await create.json();
    check('P1 cloud project created (session-linked)', created.ok && created.projectId === 'presence-e2e-1' && !!created.ownerCode, created);
    const ownerCode = created.ownerCode;
    const pid = created.projectId;

    // P2-P5 — generic-403 discipline on every invalid access path.
    check('P2 no credentials -> 403', (await fetch(BASE + '/api/cloud/presence?project=' + pid)).status === 403);
    check('P3 wrong owner code -> 403', (await fetch(BASE + '/api/cloud/presence?project=' + pid + '&code=WRONGCODE')).status === 403);
    check('P4 unknown project -> 403', (await fetch(BASE + '/api/cloud/presence?project=no-such-project')).status === 403);
    check('P5 unrelated session -> 403', (await fetch(BASE + '/api/cloud/presence?project=' + pid, { headers: { Cookie: 'mmgr_session=' + cookieBob } })).status === 403);

    // P6 — owner code connects; init has zero members.
    const alice = await wsClient(BASE + '/api/cloud/presence?project=' + pid + '&code=' + encodeURIComponent(ownerCode));
    check('P6 owner-code socket opens + init with 0 members', alice.opened && alice.msgs.some(m => m.type === 'init' && m.self && (!m.members || m.members.length === 0)), alice.msgs);

    // P7 — linked-owner session connects; init lists the owner-code client.
    const alice2 = await wsClient(BASE + '/api/cloud/presence?project=' + pid, cookieAlice);
    check('P7 linked-session socket opens + init lists owner client', alice2.opened && alice2.msgs.some(m => m.type === 'init' && m.members && m.members.some(x => x.name === 'Owner')), alice2.msgs);
    await sleep(600);
    check('P8 join broadcast reaches first client', alice.msgs.some(m => m.type === 'join' && m.name === 'Alice'), alice.msgs);

    // P9 — close propagates leave.
    alice2.ws.close();
    await sleep(600);
    check('P9 leave broadcast reaches first client', alice.msgs.some(m => m.type === 'leave'), alice.msgs);

    // P10-P11 — keepalive + roster persistence across connections.
    const c = await wsClient(BASE + '/api/cloud/presence?project=' + pid + '&code=' + encodeURIComponent(ownerCode));
    if (c.opened) { c.ws.send(JSON.stringify({ type: 'ping' })); await sleep(500); }
    check('P10 ping -> pong keepalive', c.msgs.some(m => m.type === 'pong'), c.msgs);
    check('P11 roster persists (init lists earlier member)', c.msgs.some(m => m.type === 'init' && m.members && m.members.some(x => x.name === 'Owner')), c.msgs);
    if (c.ws) c.ws.close();

    console.log('---');
    console.log((fails ? 'FAIL ' : 'PASS ') + passes + ' passed, ' + fails + ' failed');
    process.exit(fails ? 1 : 0);
  } catch (e) {
    console.error('qa-presence ERROR:', e && e.message);
    process.exit(2);
  } finally {
    try { dev.kill('SIGTERM'); } catch (e) { /* ignore */ }
    await sleep(1200);
    try { process.kill(dev.pid); } catch (e) { /* already gone */ }
  }
}

main();
