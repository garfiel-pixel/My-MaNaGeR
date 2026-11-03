/* ============================================================
   qa-billing-orphan.cjs — 5.2 ORPHANED SUBSCRIPTION CLEANUP (2026-11-03)
   ---------------------------------------------------------------
   A subscription row that outlived its account is a billable ghost: Paddle
   keeps charging, the app grants a paid tier to nobody, and no customer
   screen can reach the row - only the site admin panel can. This gate pins
   the operator path the plan requires:

     - the list says WHICH rows are orphans and WHY (five presence proofs),
     - a row that anything in the app still holds is never touchable,
     - the clear route cancels AT PADDLE FIRST and only then deletes,
     - a provider refusal leaves the row exactly where it was and carries
       the provider's reason back to the operator (keptRow: true),
     - a 404 from Paddle counts as success (already gone, nothing bills).

   Paddle is STUBBED: this harness spawns its own wrangler with
   PADDLE_API_BASE pointed at a loopback stub (the seam in src/billing.js
   `paddleApiBase()`, which honours only absolute http(s) URLs on
   127.0.0.1/localhost/[::1], so the seam can never become a credential
   leak). The stub answers per subscription id: 400 with a detail for ids
   containing "refuse", 404 for "gone", 200 otherwise - so the refusal path
   is exercised against the REAL Worker code, not a mock of it.

   Self-contained: spawns its own wrangler dev (local D1, --persist-to
   outside the repo), applies migrations, seeds rows through the REAL signed
   webhook, then drives the admin routes. Ctrl+C / SIGTERM stop wrangler
   instead of orphaning it on the port.
   ============================================================ */
'use strict';
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const http = require('http');

const PORT = parseInt(process.env.QA_PORT || '8816', 10);
const BASE = 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');
const TMP = os.tmpdir();

const ADMIN_CODE = 'qa-admin-orphan-9f21c4d0';
const PADDLE_SECRET = 'qa-orphan-paddle-secret-77aa10be';
const PADDLE_KEY = 'qa-orphan-paddle-api-key-0000000000000000000000';
const PADDLE_PRICE = 'pri_01qa_orphan_00000000000000';

const LIVE_EMAIL = 'owner.live.orphan@example.com';
const LIVE_SUB = 'email:' + LIVE_EMAIL;
const GHOST_REFUSE = 'email:orphan.refuse@example.com';
const GHOST_GONE = 'email:orphan.gone@example.com';
const GHOST_OK = 'email:orphan.clear@example.com';

// Ids drive the stub: "refuse" -> 400 with a detail, "gone" -> 404,
// anything else -> 200. The strings must stay in sync with the stub below.
const SUB_REFUSE = 'sub_refuse_5f2a01';
const SUB_GONE = 'sub_gone_5f2a02';
const SUB_OK = 'sub_ok_5f2a03';
const SUB_LIVE = 'sub_live_5f2a04';

const log = s => {
  process.stdout.write('[billing-orphan] ' + s + '\n');
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

/* ---- Paddle stub: answers per subscription id, records every call ------- */
let stubPort = 0;
const stubCalls = [];
function startPaddleStub() {
  const srv = http.createServer(function (req, res) {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', function () {
      const m = String(req.url || '').match(/^\/subscriptions\/([^/]+)\/cancel$/);
      if (req.method !== 'POST' || !m) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'not_found', detail: 'unknown stub route' } }));
        return;
      }
      const id = decodeURIComponent(m[1]);
      stubCalls.push({
        id: id,
        auth: String(req.headers.authorization || ''),
        body: body,
        at: new Date().toISOString()
      });
      if (id.indexOf('refuse') >= 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { code: 'invalid_request', detail: 'stub: the provider refused this cancel' }
          })
        );
        return;
      }
      if (id.indexOf('gone') >= 0) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'not_found', detail: 'subscription not found' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          data: { id: id, status: 'cancelled', cancelled_at: new Date().toISOString() }
        })
      );
    });
  });
  return new Promise(function (resolve) {
    srv.listen(0, '127.0.0.1', function () {
      stubPort = srv.address().port;
      resolve(srv);
    });
  });
}
const stubBase = () => 'http://127.0.0.1:' + stubPort;
const cancelsFor = id => stubCalls.filter(c => c.id === id);

/* ---- wrangler dev (local D1, own port, stubbed Paddle base) ------------ */
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
const PERSIST_DIR = path.join(TMP, 'mmgr-billing-orphan-wstate-' + Date.now());
const { stopWranglerIfLocal } = require('./wrangler-ci-helpers.cjs');

async function startWrangler() {
  log('starting wrangler dev on :' + PORT + ' (Paddle -> ' + stubBase() + ') …');
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
    'ADMIN_CODE:' + ADMIN_CODE,
    '--var',
    'GOOGLE_CLIENT_SECRET:qa-orphan-google-secret-0000000000',
    '--var',
    'PADDLE_WEBHOOK_SECRET:' + PADDLE_SECRET,
    '--var',
    'PADDLE_API_KEY:' + PADDLE_KEY,
    '--var',
    'PADDLE_PRICE_ID:' + PADDLE_PRICE,
    // The loopback-only seam: src/billing.js paddleApiBase() honours this
    // only when it is an absolute http(s) URL on 127.0.0.1 / localhost / [::1].
    '--var',
    'PADDLE_API_BASE:' + stubBase()
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
      throw new Error('wrangler dev did not come up in 120s\n' + devLog.slice(-3000));
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

/* ---- API helper: unique rate-limit client + rolling budget ------------- */
// The Worker's `general` bucket is 30 requests per minute per key and every
// call here shares one key (CF-Connecting-IP, src/lib/http.js). A TEST-NET-3
// address (RFC 5737, never routed) keeps this suite's budget separate from
// the suites that ran before it, and the rolling24/min guard keeps an honest
// limit honest instead of raising it for the test.
const RATE_IP = '203.0.113.15';
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
async function api(pathname, opts) {
  await pace();
  const o = Object.assign({}, opts || {});
  o.headers = Object.assign({ 'CF-Connecting-IP': RATE_IP }, o.headers || {});
  const res = await fetch(BASE + pathname, o);
  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    body = null;
  }
  return { status: res.status, body: body };
}
const adminGet = code =>
  api('/api/admin/billing/subscriptions', { headers: { 'X-Admin-Code': code || ADMIN_CODE } });
const adminClear = (ownerSub, code) =>
  api('/api/admin/billing/subscriptions/clear', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Code': code || ADMIN_CODE
    },
    body: JSON.stringify({ ownerSub: ownerSub })
  });

/* ---- seeding through the REAL signed webhook --------------------------- */
async function fireSub(subId, ownerSub, status) {
  const raw = JSON.stringify({
    event_type: 'subscription.activated',
    event_id: 'evt_orphan_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    occurred_at: new Date().toISOString(),
    data: {
      id: subId,
      status: status || 'active',
      custom_data: { sub: ownerSub },
      items: [{ quantity: 1, price: { id: PADDLE_PRICE } }],
      current_billing_period: {
        starts_at: new Date().toISOString(),
        ends_at: new Date(Date.now() + 30 * 86400000).toISOString()
      }
    }
  });
  const ts = String(Math.floor(Date.now() / 1000));
  const h1 = crypto
    .createHmac('sha256', PADDLE_SECRET)
    .update(ts + ':' + raw)
    .digest('hex');
  return api('/api/billing/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Paddle-Signature': 'ts=' + ts + ';h1=' + h1
    },
    body: raw
  });
}

async function main() {
  const stub = await startPaddleStub();
  await startWrangler();
  log('wrangler up at ' + BASE);

  try {
    /* ---- seed: one account that is still real, three ghosts ------------ */
    const reg = await api('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: LIVE_EMAIL, password: 'Orphan-QA-Pass1!', name: 'Live Owner' })
    });
    check(
      'seed: live owner registers (auth_users row for the presence proof)',
      reg.status === 200 && reg.body && reg.body.ok !== false,
      reg
    );

    const seeds = [
      [SUB_LIVE, LIVE_SUB],
      [SUB_REFUSE, GHOST_REFUSE],
      [SUB_GONE, GHOST_GONE],
      [SUB_OK, GHOST_OK]
    ];
    for (const s of seeds) {
      const w = await fireSub(s[0], s[1]);
      check('seed: webhook writes ' + s[1], w.status === 200 && w.body && w.body.ok === true, w);
    }

    /* ---- G1: admin auth is the SAME site admin code as the project list */
    const noCode = await adminGet('wrong-code-on purpose');
    check(
      'G1 list with a wrong admin code -> 403 generic refusal',
      noCode.status === 403 && noCode.body && noCode.body.ok === false,
      noCode
    );

    /* ---- G2: the list names every row and says WHY --------------------- */
    const list = await adminGet();
    check(
      'G2 list with the admin code -> 200, four rows',
      list.status === 200 &&
        list.body &&
        list.body.ok === true &&
        list.body.subscriptions.length === 4,
      list.body && list.body.subscriptions && list.body.subscriptions.length
    );
    const bySub = {};
    (list.body.subscriptions || []).forEach(r => (bySub[r.ownerSub] = r));
    const live = bySub[LIVE_SUB];
    const refuseRow = bySub[GHOST_REFUSE];
    const goneRow = bySub[GHOST_GONE];
    const okRow = bySub[GHOST_OK];
    check(
      'G3 the live account is NOT an orphan and its evidence names the proof',
      live && live.orphaned === false && /auth_users|live session/.test(String(live.evidence)),
      live && live.evidence
    );
    check(
      'G4 all three ghosts ARE orphans, each with the evidence sentence',
      [refuseRow, goneRow, okRow].every(
        r => r && r.orphaned === true && String(r.evidence).indexOf('no account') === 0
      ),
      [refuseRow, goneRow, okRow].map(r => r && r.evidence)
    );
    check(
      'G5 cancellable:true (provider paddle) and every row carries its provider id',
      list.body.cancellable === true &&
        [live, refuseRow, goneRow, okRow].every(r => r && r.subscriptionId),
      { cancellable: list.body.cancellable }
    );

    /* ---- G6: a wrong code cannot clear either -------------------------- */
    const noCodeClear = await adminClear(GHOST_OK, 'wrong-code-again');
    check(
      'G6 clear with a wrong admin code -> 403, nothing asked of Paddle',
      noCodeClear.status === 403 && stubCalls.length === 0,
      { status: noCodeClear.status, stubCalls: stubCalls.length }
    );

    /* ---- G7: an account anything still holds is untouchable ------------ */
    const liveClear = await adminClear(LIVE_SUB);
    check(
      'G7 clear a NON-orphan -> 409 stage "orphan" with evidence, Paddle never called',
      liveClear.status === 409 &&
        liveClear.body &&
        liveClear.body.stage === 'orphan' &&
        String(liveClear.body.error).indexOf('not an orphan') === 0 &&
        Array.isArray(liveClear.body.evidence) &&
        liveClear.body.evidence.length > 0 &&
        cancelsFor(SUB_LIVE).length === 0,
      liveClear.body
    );

    /* ---- G8: the refusal path - Paddle says no, the ROW STAYS ---------- */
    const refused = await adminClear(GHOST_REFUSE);
    const stillRefused = await adminGet();
    const refusedStillListed = !!(stillRefused.body.subscriptions || []).find(
      r => r.ownerSub === GHOST_REFUSE
    );
    check(
      'G8a clear with Paddle refusing -> 409 keptRow:true, provider reason attached',
      refused.status === 409 &&
        refused.body &&
        refused.body.ok === false &&
        refused.body.keptRow === true &&
        refused.body.stage === 'cancel' &&
        String(refused.body.error).indexOf('refused to cancel') >= 0 &&
        // The route appends the provider's own reason to the error string,
        // so the operator sees WHY Paddle said no in the status line.
        String(refused.body.error).indexOf('stub: the provider refused this cancel') >= 0 &&
        refused.body.http === 400,
      refused.body
    );
    check(
      'G8b the refused row is STILL listed (clearing first would delete the only handle)',
      refusedStillListed,
      (stillRefused.body.subscriptions || []).map(r => r.ownerSub)
    );
    const refuseCalls = cancelsFor(SUB_REFUSE);
    check(
      'G8c Paddle WAS asked first: one POST .../cancel with the bearer key',
      refuseCalls.length === 1 &&
        /^Bearer /.test(refuseCalls[0].auth) &&
        String(refuseCalls[0].body).indexOf('immediately') >= 0,
      refuseCalls
    );

    /* ---- G9: 404 from Paddle is success - already gone, nothing bills -- */
    const gone = await adminClear(GHOST_GONE);
    const afterGone = await adminGet();
    check(
      'G9 clear when Paddle answers 404 -> ok, alreadyGone, row removed',
      gone.status === 200 &&
        gone.body &&
        gone.body.ok === true &&
        gone.body.alreadyGone === true &&
        !(afterGone.body.subscriptions || []).find(r => r.ownerSub === GHOST_GONE),
      gone.body
    );

    /* ---- G10: the happy path - cancel accepted, then the row goes ------ */
    const cleared = await adminClear(GHOST_OK);
    const afterClear = await adminGet();
    const okCalls = cancelsFor(SUB_OK);
    check(
      'G10a clear with Paddle accepting -> ok, cancelledAtProvider, row removed',
      cleared.status === 200 &&
        cleared.body &&
        cleared.body.ok === true &&
        cleared.body.cancelledAtProvider === true &&
        !(afterClear.body.subscriptions || []).find(r => r.ownerSub === GHOST_OK),
      cleared.body
    );
    check(
      'G10b the live row survived every clear and is still not an orphan',
      !!(afterClear.body.subscriptions || []).find(
        r => r.ownerSub === LIVE_SUB && r.orphaned === false
      ),
      afterClear.body.subscriptions
    );
    check(
      'G10c every provider call carried the API key',
      stubCalls.length > 0 && stubCalls.every(c => /^Bearer /.test(c.auth)),
      stubCalls.map(c => c.auth)
    );

    /* ---- G11: request validation happens before any provider call ----- */
    const missing = await adminClear('');
    const unknown = await adminClear('email:nobody.here@example.com');
    check(
      'G11a clear with no ownerSub -> 400 stage "request"',
      missing.status === 400 && missing.body && missing.body.stage === 'request',
      missing.body
    );
    check(
      'G11b clear an unknown row -> 404, still no extra Paddle call',
      unknown.status === 404 && cancelsFor('email:nobody.here@example.com').length === 0,
      unknown.body
    );
  } finally {
    stopWrangler();
    try {
      stub.close();
    } catch (e) {
      /* ignore */
    }
  }

  const failed = results.filter(r => !r.val).length;
  log('---');
  log(results.length + ' checks, ' + (results.length - failed) + ' passed, ' + failed + ' failed');
  if (failed) {
    process.exitCode = 1;
  }
}

main().catch(e => {
  log('FATAL: ' + (e && e.stack ? e.stack : e));
  stopWrangler();
  process.exitCode = 1;
});
