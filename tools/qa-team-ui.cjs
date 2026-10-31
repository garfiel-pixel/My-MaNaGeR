/* ============================================================
   qa-team-ui.cjs — NAMED TEAM MEMBERS, BROWSER HALF (RBAC sprint 2,
   directive 2026-10-25, section 4)
   ------------------------------------------------------------
   qa-team-rbac.cjs proves the SERVER contract. This suite proves the
   surfaces a person actually touches, in a real Chrome, against a real
   local Worker (own wrangler dev, own D1 + R2, migrations applied):

     G1  an invitation link opened signed OUT explains itself and
         carries a return target (no dead end)
     G2  the SAME link, signed in, accepts and lands on "Invitation
         accepted" — the Worker rewrite keeps the token in the path
     G3  signed out, the launcher shows no bell at all (no control that
         can only 403)
     G4  signed in, the bell appears with a count of 1 and a spoken label
     G5  the panel lists the invitation with its project and role
     G6  Accept clears the badge, confirms in the status line and puts
         the project in "Shared with me"
     G7  Open project lands on the project page with the member banner
         and the member escope (role 'team', teamRole 'supervisor')
     G8  a section outside the role is LOCKED, one inside it is not
     G9  a supervisor save is queued for owner review (status copy AND a
         pending team proposal in the owner's queue — server truth)
     G10 a team CLIENT is read-only: client sections only, one banner
         (not two), and the save is refused in plain words
     G11 revoking the membership while the page is open shows "Access
         removed" through the SAME check the 60s poll runs, and retires
         the save control
     G12 light, dark and 360px renders all produce a real screenshot
     G13 at 360px the header neither overflows nor changes height when
         the badge appears, and the bell stays inside the viewport
     G14 no console error and no uncaught exception for the whole run

   Ports: QA_PORT (default 8795) for the Worker, QA_CDP_PORT (default
   9245) for Chrome. Both are overridable so CI can keep each suite on
   its own port.

   Chrome is the system browser via tools/chrome-launcher.cjs, launched
   with --disk-cache-size=0 (AGENTS lesson 5: the HTTP cache otherwise
   serves a previous run's JS).

   Usage:  node tools/qa-team-ui.cjs
   Exit:   0 only when every gate passes.
   ============================================================ */
'use strict';
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const http = require('http');

const PORT = parseInt(process.env.QA_PORT || '8795', 10);
const CDP_PORT = parseInt(process.env.QA_CDP_PORT || '9245', 10);
const BASE = 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');
// Wrangler state and the Chrome profile live OUTSIDE the repo: AGENTS lesson
// 11 — the asset watcher reload-loops on any file it sees inside the tree.
const TMP = os.tmpdir();
const SHOT_DIR = path.join(ROOT, 'tmp', 'qa-team-ui');

const SECRET = 'qa-team-ui-secret-1b7d4c92';
const ADMIN_CODE = 'qa-admin-team-ui-9a13';
const PADDLE_SECRET = 'qa-team-ui-paddle-secret-80fa41';
const PADDLE_KEY = 'qa-team-ui-paddle-api-key-00000000000000000';
const PADDLE_PRICE = 'pri_01qa_ui_contractor_0000000000';
const PADDLE_COMPANY_PRICE = 'pri_01qa_ui_company_000000000000';

const OWNER = 'owner.team.ui@example.com';
const MEMBER = 'member.team.ui@example.com';
const PW = 'QaTeamUi!Pass123';

const log = s => process.stdout.write('[team-ui] ' + s + '\n');
const delay = ms => new Promise(r => setTimeout(r, ms));
// RFC 5737 TEST-NET-3: documented, never routed, and only ever a rate-limit key.
const QA_IP = '203.0.113.7';
let ipSeq = 8;
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
let chrome = null;
let devLog = '';
setTimeout(() => {
  log('WATCHDOG — harness exceeded 600s');
  try {
    proc && proc.kill();
  } catch (e) {
    /* ignore */
  }
  try {
    chrome && chrome.kill();
  } catch (e) {
    /* ignore */
  }
  process.exit(2);
}, 600000).unref();

// ---- Resend stub: captures the verification and invitation mails ----------
let stubPort = 0;
const stubEmails = [];
function startEmailStub() {
  const srv = http.createServer(function (req, res) {
    if (req.method === 'POST' && req.url === '/emails') {
      let body = '';
      req.on('data', c => {
        body += c;
      });
      req.on('end', () => {
        try {
          const j = JSON.parse(body);
          stubEmails.push({
            to: Array.isArray(j.to) ? j.to.join(',') : String(j.to || ''),
            subject: j.subject,
            text: j.text
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
  return new Promise(resolve => {
    srv.listen(0, '127.0.0.1', () => {
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

// ---- wrangler scaffolding -------------------------------------------------
function localWranglerJs() {
  const p = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  return fs.existsSync(p) ? p : null;
}
function globalWranglerJs() {
  try {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const root = execFileSync(npmCmd, ['root', '-g'], {
      encoding: 'utf8',
      shell: process.platform === 'win32'
    }).trim();
    const p = path.join(root, 'wrangler', 'bin', 'wrangler.js');
    return fs.existsSync(p) ? p : null;
  } catch (e) {
    return null;
  }
}
const WRANGLER_JS = localWranglerJs() || globalWranglerJs();
const PERSIST_DIR = path.join(TMP, 'mmgr-team-ui-wstate-' + Date.now());
const { stopWranglerIfLocal } = require('./wrangler-ci-helpers.cjs');

async function startWrangler() {
  log('starting wrangler dev on :' + PORT + ' (local D1 + R2)…');
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
  proc = spawn(
    process.execPath,
    [
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
      'PADDLE_ENV:sandbox',
      // Three projects in one suite: the free cap must not turn a UI gate into
      // a billing gate.
      '--var',
      'FREE_PROJECT_CAP:10',
      '--var',
      'RESEND_API_KEY:qa-fake-resend-key-0000000000000000000000000000',
      '--var',
      'RESEND_FROM_EMAIL:onboarding@resend.dev',
      '--var',
      'RESEND_API_BASE:http://127.0.0.1:' + stubPort
    ],
    {
      cwd: ROOT,
      env: Object.assign({}, process.env, { WRANGLER_SEND_METRICS: 'false' }),
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );
  proc.stdout.on('data', d => {
    devLog += d;
  });
  proc.stderr.on('data', d => {
    devLog += d;
  });
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(BASE + '/api/health');
      if (res.ok || res.status === 404) {
        log('worker up');
        return;
      }
    } catch (e) {
      /* not up yet */
    }
    await delay(1000);
  }
  throw new Error('wrangler dev did not come up in 120s\n' + devLog.slice(-2000));
}
function stopWrangler() {
  stopWranglerIfLocal(proc);
  try {
    proc && proc.kill();
  } catch (e) {
    /* ignore */
  }
}

// ---- API helper -----------------------------------------------------------
// The Worker's `general` bucket is 30/min per IP and the browser phase shares
// that key, so the harness paces itself at 20/min: the browser needs the rest.
const _calls = [];
async function pace() {
  const now = Date.now();
  while (_calls.length && _calls[0] <= now - 60000) {
    _calls.shift();
  }
  if (_calls.length >= 20) {
    await delay(_calls[0] + 60000 - now + 100);
    return pace();
  }
  _calls.push(now);
}
async function api(pathname, opts) {
  await pace();
  // The Worker keys its rate limiter on CF-Connecting-IP (http.js). In
  // production the harness and the browser would be different clients with
  // different IPs; locally both collapse to the literal 'anon' key, so the
  // browser's ordinary page loads would spend the harness budget and the
  // fixture calls would start answering 429. A TEST-NET-3 address (RFC 5737,
  // never routed) keeps the two budgets apart without disabling any limit.
  const o = Object.assign({}, opts || {});
  o.headers = Object.assign({ 'CF-Connecting-IP': QA_IP }, o.headers || {});
  const res = await fetch(BASE + pathname, o);
  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    body = null;
  }
  return { status: res.status, body, headers: res.headers };
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
  if (!cookie) {
    return {};
  }
  // Callers pass either a full `name=value` pair (from Set-Cookie) or a bare
  // session token (from mintSession). Normalise here: a bare token sent as the
  // cookie NAME authenticates nobody, and the 403 that follows reads like a
  // permissions bug rather than a harness bug.
  return { Cookie: cookie.indexOf('=') > -1 ? cookie : 'mmgr_session=' + cookie };
}

// A Google-shaped session: sub is NOT 'email:<addr>', so the server trusts the
// signed email claim. This is the Google-only invitee — no auth_users row, no
// password, no verification mail. The browser holds this cookie too.
function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
function mintSession(email, name) {
  const payload = {
    sub: 'google-qa-' + crypto.randomBytes(6).toString('hex'),
    email: email,
    name: name || 'Google User',
    exp: Math.floor(Date.now() / 1000) + 3600
  };
  const json = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', SECRET).update(json).digest();
  return b64url(json) + '.' + b64url(sig);
}

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
async function invite(cookie, pid, email, role, scope) {
  return api('/api/cloud/projects/' + encodeURIComponent(pid) + '/team', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ck(cookie)),
    body: JSON.stringify({ email: email, role: role, scope: scope || null })
  });
}
async function memberships(cookie) {
  return api('/api/team/memberships', { headers: ck(cookie) });
}
// Tier gate: named team members need a paid plan, so the harness fires the
// REAL webhook (company tier = unlimited members) rather than bypassing the
// check. The subscription row is keyed on the owner's session sub.
function paddleSignature(rawBody, secret, tsSec) {
  const ts = String(tsSec || Math.floor(Date.now() / 1000));
  const h1 = crypto
    .createHmac('sha256', secret)
    .update(ts + ':' + rawBody)
    .digest('hex');
  return 'ts=' + ts + ';h1=' + h1;
}
async function fireSubscription(sub, priceId) {
  const raw = JSON.stringify({
    event_type: 'subscription.activated',
    event_id: 'evt_team_ui_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    occurred_at: new Date().toISOString(),
    data: {
      id: 'sub_team_ui_' + Math.random().toString(36).slice(2, 12),
      status: 'active',
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
async function reviews(cookie, pid) {
  return api('/api/cloud/projects/' + encodeURIComponent(pid) + '/reviews', {
    headers: ck(cookie)
  });
}
async function revoke(cookie, pid, mid) {
  return api('/api/cloud/projects/' + encodeURIComponent(pid) + '/team/' + mid, {
    method: 'DELETE',
    headers: ck(cookie)
  });
}

// ---- Chrome / CDP ---------------------------------------------------------
async function launchChrome() {
  const { chromePath } = require('./chrome-launcher.cjs');
  const userDir = path.join(TMP, 'chrome-team-ui-' + Date.now());
  chrome = spawn(
    chromePath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-sandbox',
      '--remote-allow-origins=*',
      '--remote-debugging-port=' + CDP_PORT,
      '--user-data-dir=' + userDir,
      '--window-size=1280,900',
      '--disk-cache-size=0',
      'about:blank'
    ],
    { stdio: 'ignore' }
  );
  for (let i = 0; i < 60; i++) {
    try {
      const v = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version')).json();
      if (v.webSocketDebuggerUrl) {
        break;
      }
    } catch (e) {
      /* not ready */
    }
    await delay(300);
  }
  let tgt = null;
  for (let i = 0; i < 60 && !tgt; i++) {
    try {
      const targets = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json')).json();
      tgt = (targets || []).find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch (e) {
      /* not ready */
    }
    if (!tgt) {
      await delay(300);
    }
  }
  if (!tgt) {
    throw new Error('no CDP page target');
  }
  const ws = new WebSocket(tgt.webSocketDebuggerUrl);
  const pending = new Map();
  const events = [];
  let cid = 0;
  let sendRef = null;
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    } else if (m.method) {
      events.push(m);
      // A beforeunload prompt would otherwise park the page: headless Chrome
      // shows it and waits for an answer, so a navigation would look like a
      // dead click. Accept it and let the navigation proceed.
      if (m.method === 'Page.javascriptDialogOpening' && sendRef) {
        sendRef('Page.handleJavaScriptDialog', { accept: true });
      }
    }
  };
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('CDP socket failed'));
  });
  const send = (method, params = {}) =>
    new Promise(res => {
      const mid = ++cid;
      pending.set(mid, m => res(m.result || {}));
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  const ev = async expression => {
    const rr = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (rr && rr.exceptionDetails) {
      return {
        __threw:
          (rr.exceptionDetails.text || '') +
          ' ' +
          ((rr.exceptionDetails.exception || {}).description || '')
      };
    }
    return rr && rr.result ? rr.result.value : undefined;
  };
  sendRef = send;
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  // A distinct client address for the BROWSER. The Worker keys its limiter on
  // CF-Connecting-IP; locally every request would otherwise share the literal
  // 'anon' key and the ordinary page loads would spend the harness budget (and
  // the browser's own budget would be spent by the harness). In production
  // these ARE two clients, so this restores the real shape instead of
  // disabling the limit.
  await send('Network.setExtraHTTPHeaders', {
    headers: { 'CF-Connecting-IP': '203.0.113.8' }
  });
  // Survives navigation, so an error on ANY page in the run is recorded. The
  // capture runs before page scripts, and DevTools-injected code is not subject
  // to the page CSP.
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source:
      '(function(){' +
      'window.__qaErrs=[];' +
      'window.__qaCalls=[];' +
      // Every API request gets its own client address. The Worker allows 30
      // requests a minute per IP and a project page's own boot + sync polling
      // can reach that inside a minute; in production each page load is a
      // different person, so rotating here restores that shape instead of
      // weakening a limit the API suite proves still bites.
      'var __qan=200;' +
      'var of=window.fetch;' +
      'window.fetch=function(u,o){' +
      '  try{' +
      '    var s=String(u);' +
      '    if(s.indexOf("/api/")>-1){' +
      '      o=o||{};' +
      '      var h=new Headers(o.headers||{});' +
      '      h.set("CF-Connecting-IP","203.0.113."+(__qan++));' +
      '      o.headers=h;' +
      '    }' +
      '  }catch(e){}' +
      '  return of.call(this,u,o).then(function(r){' +
      '    try{if(String(u).indexOf("/api/team/")>-1||String(u).indexOf("/api/cloud/projects")>-1){window.__qaCalls.push(String(u).split("?")[0]+" "+r.status);}}catch(e){}' +
      '    return r;' +
      '  });' +
      '};' +
      'var oe=console.error;' +
      'console.error=function(){try{window.__qaErrs.push(Array.prototype.slice.call(arguments).map(String).join(" "));}catch(e){} return oe.apply(console,arguments);};' +
      'window.addEventListener("error",function(e){window.__qaErrs.push("error: "+(e&&e.message||""));});' +
      'window.addEventListener("unhandledrejection",function(e){window.__qaErrs.push("rejection: "+String(e&&e.reason&&(e.reason.message||e.reason)||""));});' +
      '})();'
  });
  return { send, ev, ws, events };
}

async function setSessionCookie(cdp, token) {
  await cdp.send('Network.setCookie', {
    name: 'mmgr_session',
    value: token,
    url: BASE,
    path: '/',
    httpOnly: true,
    sameSite: 'Lax'
  });
}
async function clearSessionCookie(cdp) {
  await cdp.send('Network.deleteCookies', { name: 'mmgr_session', url: BASE });
}
async function nav(cdp, url, settleMs) {
  // Give each page load its own client address. The Worker's general bucket is
  // 30 requests a minute per IP, and a QA run opens half a dozen pages in a
  // minute - far more than a person does, but each page then spends its own
  // allowance instead of starving the next one. In production these are
  // genuinely different clients; locally they all share the literal 'anon'
  // key unless the harness supplies the address Cloudflare would.
  ipSeq += 1;
  await cdp.send('Network.setExtraHTTPHeaders', {
    headers: { 'CF-Connecting-IP': '203.0.113.' + ipSeq }
  });
  await cdp.send('Page.navigate', { url: url });
  await delay(settleMs || 3500);
}
// Polls the page until `expr` answers truthy (or the deadline passes) and
// returns the last value either way, so a failure prints what it saw.
async function until(cdp, expr, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 12000);
  let last;
  for (;;) {
    last = await cdp.ev(expr);
    if (last) {
      return last;
    }
    if (Date.now() > deadline) {
      return last;
    }
    await delay(400);
  }
}
async function shot(cdp, name) {
  try {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
  } catch (e) {
    /* ignore */
  }
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  if (!r || !r.data) {
    return 0;
  }
  const buf = Buffer.from(r.data, 'base64');
  fs.writeFileSync(path.join(SHOT_DIR, name + '.png'), buf);
  return buf.length;
}

// ============================================================
async function main() {
  if (!WRANGLER_JS) {
    throw new Error('wrangler not found (local or global)');
  }
  const stub = await startEmailStub();
  await startWrangler();

  // ---- fixture: owner account + verified email + three projects -----------
  const reg = await api('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: OWNER, password: PW, name: 'Olive Owner' })
  });
  const ownerCookie = cookieFrom(reg);
  await delay(400);
  const vmail = latestEmailTo(OWNER, 'Confirm your');
  if (vmail) {
    const m = String(vmail.text || '').match(/\/verify\.html\?token=([^\s\n]+)/);
    if (m) {
      await api('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: m[1] })
      });
    }
  }
  const seed = {
    projectName: 'Riverside Fit-Out',
    schemaVersion: 18,
    updatedAt: new Date().toISOString(),
    tasks: [{ id: 't1', title: 'Pour slab', status: 'todo' }],
    resources: [],
    risks: [],
    meetings: []
  };
  const projA = 'qa-team-ui-a';
  const projB = 'qa-team-ui-b';
  const projC = 'qa-team-ui-c';
  const madeA = await createProject(ownerCookie, projA, 'Riverside Fit-Out');
  const madeC = await createProject(ownerCookie, projC, 'Harbour Warehouse');
  const savedA = await saveOwnerState(ownerCookie, projA, seed);
  // Project C needs a snapshot too: a member's Open control can only open a
  // project that has been saved at least once, and without one the project
  // page correctly bounces home (the module now says so in plain words).
  const savedC = await saveOwnerState(
    ownerCookie,
    projC,
    Object.assign({}, seed, { projectName: 'Harbour Warehouse' })
  );
  check(
    'G0 fixture: owner project + cloud snapshot exist',
    madeA.status === 200 &&
      madeC.status === 200 &&
      savedA.status === 200 &&
      savedC.status === 200 &&
      !!ownerCookie,
    {
      a: madeA.status,
      c: madeC.status,
      save: savedA.status,
      saveC: savedC.status,
      cookie: !!ownerCookie
    }
  );

  // Named members are a paid feature: unlock the company tier through the real
  // webhook before inviting, so the invite gate is satisfied honestly.
  const sub = await fireSubscription('email:' + OWNER, PADDLE_COMPANY_PRICE);
  check('G0 fixture: the owner account carries a paid plan', sub.status === 200, {
    status: sub.status,
    body: sub.body
  });

  // Invitation A (supervisor) shows in the bell. Invitation C (contractor)
  // carries the emailed link so G1/G2 can exercise /team/accept/<token>.
  const invA = await invite(ownerCookie, projA, MEMBER, 'supervisor', null);
  const invC = await invite(ownerCookie, projC, MEMBER, 'contractor', null);
  await delay(600);
  const cmail = latestEmailTo(MEMBER, 'invited');
  const tokenMatch = cmail
    ? String(cmail.text || '').match(/\/team\/accept\/([A-Za-z0-9_-]{8,256})/)
    : null;
  const inviteToken = tokenMatch ? tokenMatch[1] : '';
  check(
    'G0 fixture: two invitations exist, one carries an emailed link',
    invA.status === 200 && invC.status === 200 && !!inviteToken,
    { a: invA.status, c: invC.status, token: !!inviteToken }
  );

  const memberToken = mintSession(MEMBER, 'Morgan Member');
  const cdp = await launchChrome();
  try {
    // ---- G3: signed out, no bell ------------------------------------------
    await nav(cdp, BASE + '/app.html', 4000);
    const signedOut = await until(
      cdp,
      `(function(){
        if (!document.documentElement.hasAttribute('data-team-ready')) return false;
        var b = document.querySelector('[data-team-bell]');
        return {
          noBell: !b,
          hidden: !!b && b.hidden,
          badge: (document.getElementById('team-bell-count')||{}).textContent || ''
        };
      })()`,
      15000
    );
    check(
      'G3 signed out: no bell is offered on the launcher',
      !!signedOut && (signedOut.noBell === true || signedOut.hidden === true),
      signedOut
    );

    // ---- G1: invitation link while signed out ----------------------------
    await nav(cdp, BASE + '/team/accept/' + inviteToken, 3000);
    const landingOut = await until(
      cdp,
      `(function(){
        var so = document.getElementById('ta-signedout');
        var ok = document.getElementById('ta-ok');
        var err = document.getElementById('ta-err');
        var settled = (so && !so.hidden) || (ok && !ok.hidden) || (err && !err.hidden);
        if (!settled) return false;
        var a = document.getElementById('ta-signin');
        return {
          signedOut: !!so && !so.hidden,
          next: a ? a.getAttribute('href') : '',
          path: location.pathname
        };
      })()`,
      15000
    );
    check(
      'G1 signed out: the emailed link explains and keeps a return target',
      !!landingOut &&
        landingOut.signedOut === true &&
        String(landingOut.next).indexOf('next=%2Fteam%2Faccept%2F') > -1 &&
        String(landingOut.path).indexOf('/team/accept/' + inviteToken) === 0,
      landingOut
    );

    // ---- G2: same link, signed in ----------------------------------------
    await setSessionCookie(cdp, memberToken);
    await nav(cdp, BASE + '/team/accept/' + inviteToken, 3500);
    const landingIn = await until(
      cdp,
      `(function(){
        var ok = document.getElementById('ta-ok');
        var err = document.getElementById('ta-err');
        var settled = (ok && !ok.hidden) || (err && !err.hidden);
        if (!settled) return false;
        return {
          accepted: !!ok && !ok.hidden,
          message: (document.getElementById('ta-ok-msg')||{}).textContent || '',
          error: !!err && !err.hidden ? (document.getElementById('ta-err-msg')||{}).textContent : '',
          path: location.pathname
        };
      })()`,
      15000
    );
    check(
      'G2 signed in: the link accepts and the token stays in the path',
      !!landingIn &&
        landingIn.accepted === true &&
        /Contractor/.test(landingIn.message) &&
        String(landingIn.path).indexOf('/team/accept/') === 0,
      landingIn
    );
    const memC = await memberships(memberToken);
    check(
      'G2 the accepted invitation is a live membership',
      memC.status === 200 &&
        (memC.body.memberships || []).some(function (m) {
          return m.projectId === projC && m.role === 'contractor';
        }),
      memC.body
    );

    // ---- G4: bell + badge ------------------------------------------------
    await nav(cdp, BASE + '/app.html', 4000);
    const bellState = await until(
      cdp,
      `(function(){
        if (!document.documentElement.hasAttribute('data-team-ready')) return false;
        var b = document.querySelector('[data-team-bell]');
        var badge = document.getElementById('team-bell-count');
        return {
          bell: !!b,
          hidden: !!b && b.hidden,
          badge: badge ? badge.textContent : '',
          badgeHidden: !!badge && badge.hidden,
          label: b ? b.getAttribute('aria-label') : '',
          inv: (document.getElementById('team-inv-list')||{}).textContent || ''
        };
      })()`,
      15000
    );
    check(
      'G4 signed in: bell shows a count of 1 with a spoken label',
      !!bellState &&
        bellState.bell === true &&
        bellState.hidden === false &&
        bellState.badge === '1' &&
        bellState.badgeHidden === false &&
        bellState.label === '1 invitation waiting',
      bellState
    );

    // ---- G5: the panel ---------------------------------------------------
    await cdp.ev(`document.querySelector('[data-team-bell]').click()`);
    const panel = await until(
      cdp,
      `(function(){
        var pop = document.getElementById('team-pop');
        if (!pop || pop.hidden) return false;
        var list = document.getElementById('team-inv-list');
        var txt = list ? list.textContent : '';
        return {
          open: true,
          hasProject: txt.indexOf('Riverside Fit-Out') > -1,
          hasRole: txt.indexOf('Supervisor') > -1,
          hasAccept: !!list && !!list.querySelector('[data-team-accept]'),
          title: (list.querySelector('.team-card-top b')||{}).textContent || ''
        };
      })()`,
      12000
    );
    check(
      'G5 panel lists the invitation with its project, role and Accept',
      !!panel && panel.open && panel.hasProject && panel.hasRole && panel.hasAccept,
      panel
    );

    // ---- G6: accept ------------------------------------------------------
    await cdp.ev(`document.querySelector('#team-inv-list [data-team-accept]').click()`);
    const accepted = await until(
      cdp,
      `(function(){
        var badge = document.getElementById('team-bell-count');
        var shared = document.getElementById('shared-dash');
        var list = document.getElementById('shared-list');
        var status = document.getElementById('team-pop-status');
        var st = status ? status.textContent : '';
        var txt = list ? list.textContent : '';
        if (!badge || !badge.hidden) return false;
        if (!/Invitation accepted/.test(st)) return false;
        if (!shared || shared.hidden) return false;
        if (txt.indexOf('Riverside Fit-Out') === -1) return false;
        return { badgeHidden: true, status: st, sharedVisible: true, sharedText: txt };
      })()`,
      20000
    );
    check(
      'G6 Accept clears the badge, confirms, and fills Shared with me',
      !!accepted &&
        accepted.badgeHidden === true &&
        /Invitation accepted/.test(accepted.status) &&
        accepted.sharedVisible === true &&
        accepted.sharedText.indexOf('Riverside Fit-Out') > -1,
      accepted
    );

    // ---- G7: open the shared project ------------------------------------
    const opened = await cdp.ev(
      `(function(){
        var b = document.querySelector('#shared-list [data-team-open="' + '${projA}' + '"]');
        if (!b) return { clicked: false, buttons: document.querySelectorAll('#shared-list [data-team-open]').length };
        b.click();
        return { clicked: true };
      })()`
    );
    await delay(4500);
    const projectA = await until(
      cdp,
      `(function(){
        if (!/project(\\.html)?$/.test(location.pathname)) return false;
        var banner = document.getElementById('team-scope-banner');
        if (!banner || banner.classList.contains('is-hide')) return false;
        var txt = document.getElementById('team-scope-text');
        var copy = txt ? txt.textContent : '';
        if (!/Supervisor/.test(copy)) return false;
        var es = null;
        try { es = JSON.parse(sessionStorage.getItem('mmgr_cloud_escope_' + '${projA}') || 'null'); } catch(e) {}
        if (!es || es.role !== 'team' || es.teamRole !== 'supervisor') return false;
        return {
          path: location.pathname,
          bannerVisible: true,
          copy: copy,
          role: es.role,
          teamRole: es.teamRole,
          bodyClass: document.body.className
        };
      })()`,
      20000
    );
    check(
      'G7 Open project lands with the member banner and the member scope',
      !!opened &&
        opened.clicked === true &&
        !!projectA &&
        /project(\\.html)?$/.test(String(projectA.path)) &&
        projectA.bannerVisible === true &&
        /Supervisor/.test(projectA.copy) &&
        projectA.role === 'team' &&
        projectA.teamRole === 'supervisor',
      { opened: opened, page: projectA }
    );

    // ---- G8: the scope is real -------------------------------------------
    const scopeState = await cdp.ev(
      `(function(){
        function st(sel){
          var b = document.querySelector(sel);
          if (!b) return 'missing';
          return { blocked: b.classList.contains('scope-blocked'), disabled: !!b.disabled };
        }
        return { inScope: st('.sec-btn[data-section="wbs"]'), outScope: st('.sec-btn[data-section="bud"]') };
      })()`
    );
    check(
      'G8 a section outside the role is locked, one inside it is not',
      !!scopeState &&
        scopeState.inScope !== 'missing' &&
        scopeState.outScope !== 'missing' &&
        scopeState.inScope.blocked === false &&
        scopeState.outScope.blocked === true &&
        scopeState.outScope.disabled === true,
      scopeState
    );

    // ---- G9: supervisor save is a proposal -------------------------------
    await cdp.ev(
      `(function(){
        var k = 'mmgr_state_' + '${projA}';
        var s = JSON.parse(localStorage.getItem(k) || '{}');
        s.tasks = (s.tasks || []).concat([{ id: 't-qa-team', title: 'QA team edit', status: 'todo' }]);
        localStorage.setItem(k, JSON.stringify(s));
        return true;
      })()`
    );
    await cdp.ev(`MMGR.Cloud.render(); MMGR.Cloud.saveToCloud();`);
    const saveUi = await until(
      cdp,
      `(function(){
        var s = document.getElementById('cloud-status');
        var t = s ? s.textContent : '';
        return /owner review|pending acceptance|Saved to cloud/i.test(t) ? { text: t } : false;
      })()`,
      18000
    );
    const proposalQueue = await reviews(ownerCookie, projA);
    const teamProposal = (
      proposalQueue.body && proposalQueue.body.proposals ? proposalQueue.body.proposals : []
    ).some(function (p) {
      return p.source_type === 'team' || p.sourceType === 'team';
    });
    check(
      'G9 a supervisor save is queued for owner review (copy + server row)',
      !!saveUi &&
        /owner review/i.test(saveUi.text) &&
        /Supervisor/i.test(saveUi.text) &&
        teamProposal === true,
      { status: saveUi, proposals: proposalQueue.body }
    );

    // ---- G10: team client is read-only -----------------------------------
    const madeB = await createProject(ownerCookie, projB, 'Client Portal Build');
    const invB = await invite(ownerCookie, projB, MEMBER, 'client', ['dash', 'wbs']);
    await saveOwnerState(
      ownerCookie,
      projB,
      Object.assign({}, seed, { projectName: 'Client Portal Build' })
    );
    check(
      'G10 fixture: client invitation exists on a second project',
      madeB.status === 200 && invB.status === 200,
      { b: madeB.status, invite: invB.status }
    );
    await nav(cdp, BASE + '/app.html', 4000);
    const acceptedB = await until(
      cdp,
      `(function(){
        if (!document.documentElement.hasAttribute('data-team-ready')) return false;
        var b = document.querySelector('[data-team-bell]');
        var badge = document.getElementById('team-bell-count');
        return {
          path: location.pathname,
          calls: (window.__qaCalls || []).slice(-8),
          bell: !!b,
          hidden: !!b && b.hidden,
          badge: badge ? badge.textContent : '',
          badgeHidden: !!badge && badge.hidden,
          inv: (document.getElementById('team-inv-list')||{}).textContent || ''
        };
      })()`,
      15000
    );
    await cdp.ev(`document.querySelector('[data-team-bell]').click()`);
    const acceptBReady = await until(
      cdp,
      `(function(){
        var btn = document.querySelector('#team-inv-list [data-team-accept]');
        return btn ? { id: btn.getAttribute('data-team-accept') } : false;
      })()`,
      15000
    );
    // ONE click. Polling a click inside the predicate fires accept twice and the
    // second request answers "already accepted", which parks an error in the
    // status line the gate then reads as a failure.
    const acceptBClicked = await cdp.ev(
      `(function(){
        var btn = document.querySelector('#team-inv-list [data-team-accept]');
        if (!btn) return false;
        btn.click();
        return true;
      })()`
    );
    const acceptBSettled = await until(
      cdp,
      `(function(){
        var btn = document.querySelector('#team-inv-list [data-team-accept]');
        var badge = document.getElementById('team-bell-count');
        if (btn) return false;
        if (badge && !badge.hidden) return false;
        var list = document.getElementById('shared-list');
        return { shared: list ? list.textContent : '' };
      })()`,
      15000
    );
    const openB = await until(
      cdp,
      `(function(){
        var b = document.querySelector('#shared-list [data-team-open="' + '${projB}' + '"]');
        if (!b) return false;
        b.click();
        return true;
      })()`,
      15000
    );
    await delay(1000);
    const clientPage = await until(
      cdp,
      `(function(){
        if (!/project(\\.html)?$/.test(location.pathname)) return false;
        var team = document.getElementById('team-scope-banner');
        var generic = document.getElementById('client-scope-banner');
        if (!team || team.classList.contains('is-hide')) return false;
        if (!document.body.classList.contains('client-scope')) return false;
        var wbs = document.querySelector('.sec-btn[data-section="wbs"]');
        var bud = document.querySelector('.sec-btn[data-section="bud"]');
        if (!wbs || !bud) return false;
        // The banner and body class land one render BEFORE the per-section
        // scope marks, so this predicate must wait for the thing it asserts
        // (budget hidden, WBS shared). On a slow CI runner the old predicate
        // returned early and read wbsHidden:false while the scope was still
        // being applied - a harness race, not a product defect.
        if (!bud.classList.contains('client-hidden')) return false;
        return {
          clientScope: true,
          teamBanner: true,
          genericBanner: !!generic && !generic.classList.contains('is-hide'),
          copy: (document.getElementById('team-scope-text')||{}).textContent || '',
          wbsHidden: wbs.classList.contains('client-hidden'),
          budHidden: bud.classList.contains('client-hidden')
        };
      })()`,
      20000
    );
    check(
      'G10 a team client sees only the shared sections and one banner',
      !!acceptedB &&
        acceptedB.hidden === false &&
        acceptedB.badge === '1' &&
        !!acceptBReady &&
        acceptBClicked === true &&
        !!acceptBSettled &&
        openB === true &&
        !!clientPage &&
        clientPage.clientScope === true &&
        clientPage.teamBanner === true &&
        clientPage.genericBanner === false &&
        /Client/.test(clientPage.copy) &&
        clientPage.wbsHidden === false &&
        clientPage.budHidden === true,
      { acceptedB: acceptedB, ready: acceptBReady, clicked: acceptBClicked, clientPage: clientPage }
    );
    // render() is async and rewrites #cloud-section, which destroys the status
    // line. Calling both in one expression let the render land AFTER the
    // refusal copy and wipe it, so the page looked silent. Let the render
    // settle first, then save.
    await cdp.ev(`MMGR.Cloud.render()`);
    await delay(1200);
    await cdp.ev(`MMGR.Cloud.saveToCloud()`);
    const clientSave = await until(
      cdp,
      `(function(){
        var s = document.getElementById('cloud-status');
        var t = s ? s.textContent : '';
        if (/cannot save|Ask the project owner for an editing role/i.test(t)) return { text: t };
        if (!window.__qaSaveSince) window.__qaSaveSince = Date.now();
        if (Date.now() - window.__qaSaveSince > 8000) {
          return {
            text: t,
            hasStatus: !!s,
            escope: sessionStorage.getItem('mmgr_cloud_escope_' + '${projB}'),
            teamUi: typeof (window.MMGR && MMGR.TeamUI),
            pid: (window.MMGR && MMGR.projectId) || '',
            calls: (window.__qaCalls || []).slice(-6)
          };
        }
        return false;
      })()`,
      12000
    );
    check(
      'G10 a team client save is refused in plain words',
      !!clientSave && /cannot save/i.test(clientSave.text || ''),
      clientSave
    );

    // ---- G11: revoke while the page is open ------------------------------
    const listed = await api('/api/cloud/projects/' + encodeURIComponent(projB) + '/team', {
      headers: ck(ownerCookie)
    });
    const memberB = (listed.body && listed.body.members ? listed.body.members : []).filter(
      function (m) {
        return m.role === 'client';
      }
    )[0];
    const revoked = memberB ? await revoke(ownerCookie, projB, memberB.id) : { status: 0 };
    // checkAccess() is the exact body the 60s poll runs; calling it directly
    // proves the same code path without making the suite wait a minute.
    await cdp.ev(`MMGR.TeamUI.checkAccess()`);
    const removed = await until(
      cdp,
      `(function(){
        var b = document.getElementById('team-access-banner');
        var escope = sessionStorage.getItem('mmgr_cloud_escope_' + '${projB}');
        var saveBtns = document.querySelectorAll('[data-action="cloudSave"]');
        var allOff = saveBtns.length > 0;
        for (var i = 0; i < saveBtns.length; i++) { if (!saveBtns[i].disabled) allOff = false; }
        if (b && !b.classList.contains('is-hide') && !escope && allOff) {
          return { banner: true, escopeCleared: true, savesDisabled: true, count: saveBtns.length };
        }
        if (!window.__qaRemovedSince) window.__qaRemovedSince = Date.now();
        if (Date.now() - window.__qaRemovedSince > 10000) {
          return {
            banner: !!b && !b.classList.contains('is-hide'),
            escopeCleared: !escope,
            savesDisabled: allOff,
            count: saveBtns.length,
            teamUi: typeof (window.MMGR && MMGR.TeamUI),
            pid: (window.MMGR && MMGR.projectId) || '',
            path: location.pathname,
            calls: (window.__qaCalls || []).slice(-8)
          };
        }
        return false;
      })()`,
      15000
    );
    check(
      'G11 a revoke reaches the open page and retires the save control',
      revoked.status === 200 &&
        !!removed &&
        removed.banner === true &&
        removed.escopeCleared === true &&
        removed.savesDisabled === true &&
        removed.count > 0,
      { revoke: revoked.status, page: removed }
    );

    // ---- G7b (second project): the shared list opens a contractor -------
    await nav(cdp, BASE + '/app.html', 4000);
    const stillShared = await until(
      cdp,
      `(function(){
        if (!document.documentElement.hasAttribute('data-team-ready')) return false;
        var list = document.getElementById('shared-list');
        if (!list) return false;
        var t = list.textContent;
        if (t.indexOf('Harbour Warehouse') === -1) return false;
        return { hasC: true, hasB: t.indexOf('Client Portal Build') > -1 };
      })()`,
      15000
    );
    check(
      'G11 the revoked project leaves Shared with me, the others stay',
      !!stillShared && stillShared.hasC === true && stillShared.hasB === false,
      stillShared
    );

    // ---- G12/G13: screenshots + 360px header ----------------------------
    // Land on the contractor project (accepted by link in G2) through the same
    // Open-project control, then capture the three states.
    const openC = await until(
      cdp,
      `(function(){
        var b = document.querySelector('#shared-list [data-team-open="' + '${projC}' + '"]');
        if (!b) return false;
        b.click();
        return true;
      })()`,
      15000
    );
    const onC = await until(
      cdp,
      `(function(){
        var isProject = /project(\\.html)?$/.test(location.pathname);
        var banner = document.getElementById('team-scope-banner');
        var txt = document.getElementById('team-scope-text');
        var copy = txt ? txt.textContent : '';
        var ok = isProject && !!banner && !banner.classList.contains('is-hide') && /Contractor/.test(copy);
        if (ok) return { ok: true };
        if (!window.__qaOnCSince) window.__qaOnCSince = Date.now();
        if (Date.now() - window.__qaOnCSince > 14000) {
          return {
            ok: false,
            path: location.pathname,
            bodyClass: document.body.className,
            copy: copy,
            escope: sessionStorage.getItem('mmgr_cloud_escope_' + '${projC}'),
            calls: (window.__qaCalls || []).slice(-10)
          };
        }
        return false;
      })()`,
      20000
    );
    check(
      'G12 the contractor project opens with its banner',
      openC === true && !!onC && onC.ok === true,
      { openC: openC, onC: onC }
    );
    const lightBytes = await shot(cdp, 'team-light-1280');
    const theme = await cdp.ev(
      `(function(){
        if (window.MMGRTheme) { window.MMGRTheme.setMode('dark'); }
        return { dark: document.body.classList.contains('dark-mode') };
      })()`
    );
    await delay(900);
    const darkBytes = await shot(cdp, 'team-dark-1280');
    await cdp.ev(`(function(){ if (window.MMGRTheme) window.MMGRTheme.setMode('light'); })()`);
    await delay(600);
    check(
      'G12 light and dark renders produce real screenshots',
      lightBytes > 10000 && darkBytes > 10000 && !!theme && theme.dark === true,
      { light: lightBytes, dark: darkBytes, theme: theme }
    );

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 360,
      height: 740,
      deviceScaleFactor: 2,
      mobile: true
    });
    await delay(1200);
    const narrow = await cdp.ev(
      `(function(){
        var hdr = document.getElementById('app-header');
        var bell = document.querySelector('[data-team-bell]');
        var badge = document.getElementById('team-bell-count');
        function box(el){ if (!el) return null; var r = el.getBoundingClientRect(); return { l: r.left, r: r.right, h: r.height }; }
        var withBadge = box(hdr);
        var bellBox = box(bell);
        if (badge) badge.hidden = true;
        var without = box(hdr);
        if (badge) badge.hidden = false;
        return {
          scrollW: document.documentElement.scrollWidth,
          inner: window.innerWidth,
          hdrWith: withBadge ? withBadge.h : 0,
          hdrWithout: without ? without.h : 0,
          bell: bellBox,
          bellVisible: !!bell && !bell.hidden
        };
      })()`
    );
    await delay(500);
    const narrowBytes = await shot(cdp, 'team-360');
    check(
      'G13 at 360px the header does not overflow or resize for the badge',
      !!narrow &&
        narrow.scrollW <= narrow.inner + 1 &&
        Math.abs(narrow.hdrWith - narrow.hdrWithout) < 1 &&
        narrow.bellVisible === true &&
        narrow.bell &&
        narrow.bell.r <= narrow.inner + 1 &&
        narrow.bell.l >= 0,
      narrow
    );
    check('G13 the 360px render produces a real screenshot', narrowBytes > 8000, {
      bytes: narrowBytes
    });
    await cdp.send('Emulation.clearDeviceMetricsOverride');

    // ---- G14: no console errors anywhere in the run ----------------------
    const pageErrs = await cdp.ev(`(function(){ return window.__qaErrs || []; })()`);
    const cdpErrs = cdp.events
      .filter(e => e.method === 'Runtime.exceptionThrown')
      .map(e => (e.params.exceptionDetails || {}).text || 'exception')
      .slice(0, 5);
    const errs = [].concat(Array.isArray(pageErrs) ? pageErrs : [], cdpErrs);
    // 401/403 from /api/team/* while signed out is the expected probe, and the
    // module turns it into "no bell" rather than an error - so only real
    // console.error text counts here.
    const real = errs.filter(function (t) {
      return !/Failed to load resource/.test(String(t));
    });
    check('G14 no console error or uncaught exception in the run', real.length === 0, {
      errors: real.slice(0, 6)
    });
  } finally {
    try {
      cdp.ws.close();
    } catch (e) {
      /* ignore */
    }
    try {
      chrome && chrome.kill();
    } catch (e) {
      /* ignore */
    }
  }

  try {
    stub.close();
  } catch (e) {
    /* ignore */
  }
  stopWrangler();

  const failed = results.filter(r => !r.val);
  log('');
  log(
    failed.length === 0 ? 'ALL GATES PASSED (' + results.length + ')' : failed.length + ' FAILED'
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(e => {
  log('FATAL: ' + ((e && e.stack) || e));
  try {
    chrome && chrome.kill();
  } catch (err) {
    /* ignore */
  }
  stopWrangler();
  process.exit(1);
});
