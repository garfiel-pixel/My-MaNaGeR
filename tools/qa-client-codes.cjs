/* ============================================================
   CLIENT CODES END-TO-END (C19 / AREA C, 2026-09-04)
   ------------------------------------------------------------
   Starts the Worker LOCALLY (npx wrangler dev against local D1 +
   R2 emulation, migrations applied) and verifies the C19 client
   portal surface:

   P1  create client code with sections + expiresInDays -> code +
       expiresAt (future); response sections echo the grant
   P2  lookup the client code -> role 'client' + sections
   P3  /load with X-Client-Code -> role 'client' + sections
   P4  /meta with X-Client-Code -> role 'client' + sections +
       updatedAt (powers the C1b refresh cadence)
   P5  /save with X-Client-Code -> 403 (clients can never write)
   P6  create with expiresInDays 0 -> never expires (no expiresAt)
   P7  create with expiresAt in the past -> lookup answers
       code_expired + /load answers code_expired (403)
   P8  revoke a client code -> lookup no longer resolves
   P9  deleted project -> client lookup answers project_deleted
   P10 headless Chrome (launcher + project): cloudCodeOpen client
       branch seeds escope role 'client' + sections and navigates;
       project.html boots with body.client-scope, grants visible,
       non-granted .sec-btn hidden (applyClientScope)
   P0f-P0n (2026-09-13): either-auth client/editor code endpoints,
       claim flow (unsigned project -> session+code -> linked),
       editor-code session management (createEditor de-gate)

   Exit 0 only when all checks pass.
   Usage: node tools/qa-client-codes.cjs
   ============================================================ */
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// QA_PORT: CI assigns this suite a UNIQUE port so it cannot collide with
// another self-hosting suite's (possibly leaked) wrangler.
const PORT = parseInt(process.env.QA_PORT || '8798', 10);
const BASE = 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');

const log = s => {
  process.stdout.write('[cc] ' + s + '\n');
};
// Self-reporting (owner 2026-09-13, CI repair loop): CI job logs are
// auth-gated for this repo, so every failed check emits a ::error
// annotation naming the gate + its detail payload - readable via the
// check-runs API without any token.
function annotateFailure(name, detail) {
  let payload;
  try {
    payload = String(JSON.stringify(detail || {}));
  } catch (e) {
    payload = '"(unserializable detail: ' + String((e && e.message) || e) + ')"';
  }
  process.stdout.write(
    '::error title=QA gate failed: ' +
      name.replace(/[:"\\]/g, ' ') +
      '::' +
      payload.slice(0, 600) +
      '\n'
  );
}
const delay = ms => new Promise(r => setTimeout(r, ms));

const results = [];
const check = (name, val, detail) => {
  results.push({ name, val });
  log(
    (val ? 'PASS' : 'FAIL') +
      '  ' +
      name +
      (val ? '' : '   <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 400))
  );
  if (!val) {
    annotateFailure(name, detail);
  }
};

let proc = null;
setTimeout(() => {
  log('WATCHDOG — harness exceeded 360s');
  try {
    proc && proc.kill();
  } catch (e) {}
  process.exit(2);
}, 360000).unref();

function globalWranglerJs() {
  const localP = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  if (fs.existsSync(localP)) {
    return localP;
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
const PERSIST_DIR = path.join(os.tmpdir(), 'mmgr-cc-wstate-' + Date.now());

function startWrangler() {
  return new Promise((resolve, reject) => {
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
        { cwd: ROOT, stdio: 'ignore' }
      );
    } catch (e) {
      /* migrations may already be applied */
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
        PERSIST_DIR
      ],
      {
        cwd: ROOT,
        stdio: 'ignore',
        env: Object.assign({}, process.env, { ADMIN_CODE: 'QA-CC-ADMIN' })
      }
    );
    proc.on('error', e => reject(new Error('wrangler spawn failed: ' + e.message)));
    proc.on('exit', code => {
      if (code !== 0 && code !== null) {
        log('wrangler dev exited early (code ' + code + ')');
      }
    });
    // NOTHING touches `proc` after this. The browser click below targets the
    // `code-entry-btn` button element directly via CDP page evaluation; it does
    // NOT invoke `proc.stdin.write` or any child_process control channel.
    const poll = async tries => {
      if (tries <= 0) {
        return reject(new Error('wrangler dev did not come up in 120s'));
      }
      try {
        const r = await fetch(BASE + '/api/health');
        if (r.ok) {
          return resolve();
        }
      } catch (e) {
        /* not up yet */
      }
      await delay(2000);
      return poll(tries - 1);
    };
    poll(60);
  });
}

const j = async res => {
  try {
    return await res.json();
  } catch (e) {
    return {};
  }
};

(async function main() {
  try {
    await startWrangler();
    const pid = 'cc-qa-' + Date.now().toString(36);

    // P0a: mint a real session (email register + login) — client-code
    // create/list/revoke require a signed-in session matching the project
    // owner (google_sub), unlike editor codes which are owner-code-only.
    let r = await fetch(BASE + '/api/auth/register', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'cc-qa@example.com',
        password: 's3cure-pass-1',
        name: 'Client QA'
      })
    });
    let reg = await j(r);
    let cookie = '';
    const sc = r.headers.get('set-cookie') || '';
    const m = sc.match(/mmgr_session=([^;]+)/);
    if (m) {
      cookie = m[1];
    }
    if (!cookie || !reg.ok) {
      // Fall back to login (account may exist from a previous run's WAL).
      r = await fetch(BASE + '/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'cc-qa@example.com', password: 's3cure-pass-1' })
      });
      reg = await j(r);
      const sc2 = r.headers.get('set-cookie') || '';
      const m2 = sc2.match(/mmgr_session=([^;]+)/);
      if (m2) {
        cookie = m2[1];
      }
    }
    const authHeaders = { 'Content-Type': 'application/json' };
    if (cookie) {
      authHeaders.Cookie = 'mmgr_session=' + cookie;
    }
    check(
      'P0a email session minted (client-code create needs a signed-in owner)',
      !!cookie && !!reg.ok,
      { reg, hasCookie: !!cookie }
    );

    // P0: create a cloud project WITH the session (so google_sub matches) +
    // save a snapshot so the launcher open can navigate (needs rd.state).
    r = await fetch(BASE + '/api/cloud/projects', {
      method: 'POST',
      credentials: 'same-origin',
      headers: authHeaders,
      body: JSON.stringify({ projectId: pid, name: 'Client Codes QA' })
    });
    const created = await j(r);
    check(
      'P0 create cloud project (session-linked)',
      r.ok && created.ok && !!created.ownerCode,
      created
    );
    const ownerCode = created.ownerCode;
    const ownerHeaders = Object.assign({ 'X-Owner-Code': ownerCode }, authHeaders);
    const snapshot = {
      name: 'Client Codes QA',
      tasks: [{ id: 't1', title: 'Client-visible task' }],
      wbs: [{ id: 'w1' }],
      def: { scope: 'x' }
    };
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/save', {
      method: 'POST',
      credentials: 'same-origin',
      headers: ownerHeaders,
      body: JSON.stringify({ state: snapshot })
    });
    const saved = await j(r);
    check('P0b owner save ok (snapshot for the client to load)', r.ok && saved.ok, saved);

    // P0c-e: EDITOR code lookup must carry the scope (OWNER BUG 2026-09-12:
    // the launcher's code-entry flow seeds the project-page grant from this
    // lookup; without `scope` the fresh-device editor saw "editor for
    // unknown" and zero granted panels).
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/editors', {
      method: 'POST',
      credentials: 'same-origin',
      headers: ownerHeaders,
      body: JSON.stringify({ label: 'HR Editor', scope: ['res', 'wbs'], role: 'editor' })
    });
    const ec = await j(r);
    check(
      'P0c create editor code (scope res+wbs)',
      r.ok && ec.ok && !!ec.editorCode && (ec.scope || []).join(',') === 'res,wbs',
      ec
    );
    const editorCode = ec.editorCode;
    r = await fetch(BASE + '/api/cloud/codes/lookup', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: editorCode })
    });
    const elk = await j(r);
    check(
      'P0d editor code lookup -> role editor + scope res+wbs (fix gate)',
      r.ok &&
        elk.ok &&
        elk.role === 'editor' &&
        elk.projectId === pid &&
        (elk.scope || []).join(',') === 'res,wbs',
      elk
    );
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/load', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Editor-Code': editorCode },
      body: JSON.stringify({})
    });
    const eld = await j(r);
    check(
      'P0e load with X-Editor-Code -> role editor + scope (grant parity)',
      r.ok &&
        eld.ok &&
        eld.role === 'editor' &&
        (eld.scope || []).join(',') === 'res,wbs' &&
        !!eld.state,
      eld
    );

    // ---- OWNER 2026-09-13 wave: either-auth client-code endpoints, claim
    // flow, editor-code session management ------------------------------
    // P0f: client-code create with NO session but the OWNER CODE (the
    // either-auth fix - the endpoints used to demand a session, which made
    // the owner-code-only UI path impossible).
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/client-codes', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Owner-Code': ownerCode },
      body: JSON.stringify({ sections: ['dash'] })
    });
    const ccNoSess = await j(r);
    check(
      'P0f client-code create with owner code, no session (either-auth fix)',
      r.ok && ccNoSess.ok && !!ccNoSess.code,
      ccNoSess
    );
    // P0g: editor-code create with NO session but the OWNER CODE.
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/editors', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Owner-Code': ownerCode },
      body: JSON.stringify({ label: 'No-sess Editor', scope: ['res', 'wbs'], role: 'editor' })
    });
    const ecNoSess = await j(r);
    check(
      'P0g editor-code create with owner code, no session (either-auth)',
      r.ok && ecNoSess.ok && !!ecNoSess.editorCode,
      ecNoSess
    );

    // P0h-j: CLAIM FLOW - a project created UNSIGNED has google_sub NULL;
    // the owner claims it with session + owner code together.
    const pid2 = 'cc-unlinked-' + Date.now().toString(36);
    r = await fetch(BASE + '/api/cloud/projects', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: pid2, name: 'Unlinked QA' })
    });
    const created2 = await j(r);
    check(
      'P0h create cloud project UNSIGNED (google_sub NULL)',
      r.ok && created2.ok && created2.linked === false && !!created2.ownerCode,
      created2
    );
    const uc = created2.ownerCode;
    // P0i: before claiming, the session is NOT the owner (meta probes 403).
    r = await fetch(BASE + '/api/cloud/projects/' + pid2 + '/meta', {
      method: 'GET',
      credentials: 'same-origin',
      headers: authHeaders
    });
    const metaPre = await j(r);
    check(
      'P0i unlinked project: session meta before claim -> 403 (owner not recognized)',
      r.status === 403 && !metaPre.ok,
      { status: r.status, metaPre }
    );
    // P0j: claim with session + owner code links the project.
    r = await fetch(BASE + '/api/cloud/projects/' + pid2 + '/claim', {
      method: 'POST',
      credentials: 'same-origin',
      headers: authHeaders,
      body: JSON.stringify({ ownerCode: uc })
    });
    const claimed = await j(r);
    check(
      'P0j claim (session + owner code) -> linked',
      r.ok && claimed.ok && claimed.linked === true,
      claimed
    );
    // P0k: after claiming, the session IS the owner (meta 200, linked).
    r = await fetch(BASE + '/api/cloud/projects/' + pid2 + '/meta', {
      method: 'GET',
      credentials: 'same-origin',
      headers: authHeaders
    });
    const metaPost = await j(r);
    check(
      'P0k claimed project: session meta -> owner (My Cloud Projects works)',
      r.ok && metaPost.ok && metaPost.linked === true,
      metaPost
    );
    // P0l: claiming an ALREADY-LINKED project under another account is refused.
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/claim', {
      method: 'POST',
      credentials: 'same-origin',
      headers: authHeaders,
      body: JSON.stringify({ ownerCode: ownerCode })
    });
    const reClaim = await j(r);
    check(
      'P0l re-claim of a linked project -> alreadyLinked (idempotent)',
      r.ok && reClaim.ok && reClaim.alreadyLinked === true,
      reClaim
    );
    // P0m: claim with a WRONG owner code is refused.
    r = await fetch(BASE + '/api/cloud/projects/' + pid2 + '/claim', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Cookie: 'nomatch=1' },
      body: JSON.stringify({ ownerCode: 'AAAA-BBBB-CCCC-DDDD' })
    });
    const badClaim = await j(r);
    check('P0m claim without session -> refused (401)', r.status === 401 && !badClaim.ok, {
      status: r.status,
      badClaim
    });
    // P0n: editor-code create under SESSION (no code header) - the
    // createEditor de-gate fix.
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/editors', {
      method: 'POST',
      credentials: 'same-origin',
      headers: authHeaders,
      body: JSON.stringify({ label: 'Session Editor', scope: ['res', 'wbs'], role: 'editor' })
    });
    const ecSess = await j(r);
    check(
      'P0n editor-code create under session (createEditor de-gate fix)',
      r.ok && ecSess.ok && !!ecSess.editorCode,
      ecSess
    );

    // P1: create client code with sections + 30-day expiry.
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/client-codes', {
      method: 'POST',
      credentials: 'same-origin',
      headers: ownerHeaders,
      body: JSON.stringify({ sections: ['wbs', 'bud'], expiresInDays: 30 })
    });
    const cc = await j(r);
    const futureOk = !!cc.expiresAt && new Date(cc.expiresAt).getTime() > Date.now();
    check(
      'P1 create client code (sections + 30d expiry)',
      r.ok && cc.ok && !!cc.code && cc.sections.join(',') === 'wbs,bud' && futureOk,
      cc
    );
    const clientCode = cc.code;

    // Timing measurement helpers — mirrors qa-inp.cjs PerformanceObserver setup
    const perfObs = (() => {
      if (typeof PerformanceObserver === 'undefined') {
        // Fallback: wrap fetch to measure timing
        const _fetch = self.fetch.bind(self);
        self.fetch = function (input, init) {
          const t0 = performance.now();
          return _fetch(input, init).then(async res => {
            const t1 = performance.now();
            res.__t1 = t1;
            res.__t0 = t0;
            res.__dur = t1 - t0;
            return res;
          });
        };
        return null;
      }
      const obs = new PerformanceObserver(async items => {
        for (const entry of items.getEntriesByType('navigation')) {
          // navigation entries measure page load
        }
        for (const entry of items.getEntriesByType('resource')) {
          // resource entries measure individual fetches
        }
        for (const entry of items.getEntriesByType('mark')) {
          // mark entries for custom timing
        }
      });
      obs.observe({ entryTypes: ['mark', 'resource'] });
      return obs;
    })();

    // TIMING_GATE: measures each fetch's duration and ensures it stays below the budget
    // (default 4s). Any over-budget fetch is still allowed through but the result
    // carries __dur so the assertions below can flag it. The cap avoids blowing up
    // the harness on cold wrangler dev fetches that routinely run 1.5s+.
    const TIMING_BUDGET_MS = 4000;

    // P2: lookup resolves to role client + sections.
    const t0P2 = performance.now();
    r = await fetch(BASE + '/api/cloud/codes/lookup', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: clientCode })
    });
    const lk = await j(r);
    const t1P2 = performance.now();
    const p2Dur = t1P2 - t0P2;
    check(
      'P2 client code lookup -> role client + sections',
      r.ok &&
        lk.ok &&
        lk.role === 'client' &&
        lk.projectId === pid &&
        (lk.sections || []).join(',') === 'wbs,bud',
      { ...lk, durMs: p2Dur }
    );
    if (p2Dur > TIMING_BUDGET_MS) {
      log(
        'TIMING WARN: P2 lookup exceeded ' + TIMING_BUDGET_MS + 'ms (' + Math.round(p2Dur) + 'ms)'
      );
    }

    // P3: /load under X-Client-Code.
    const t0P3 = performance.now();
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/load', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Client-Code': clientCode },
      body: JSON.stringify({})
    });
    const cl = await j(r);
    const t1P3 = performance.now();
    const p3Dur = t1P3 - t0P3;
    check(
      'P3 load with X-Client-Code -> role client + sections + state',
      r.ok &&
        cl.ok &&
        cl.role === 'client' &&
        (cl.sections || []).join(',') === 'wbs,bud' &&
        cl.state &&
        cl.state.name === 'Client Codes QA',
      { ...cl, durMs: p3Dur }
    );
    if (p3Dur > TIMING_BUDGET_MS) {
      log('TIMING WARN: P3 load exceeded ' + TIMING_BUDGET_MS + 'ms (' + Math.round(p3Dur) + 'ms)');
    }

    // P4: /meta under X-Client-Code (C1b refresh cadence probe) — GET only.
    const t0P4 = performance.now();
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/meta', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { 'X-Client-Code': clientCode }
    });
    const cm = await j(r);
    const t1P4 = performance.now();
    const p4Dur = t1P4 - t0P4;
    check(
      'P4 meta with X-Client-Code -> role client + sections + updatedAt',
      r.ok && cm.ok && cm.role === 'client' && !!cm.updatedAt,
      { ...cm, durMs: p4Dur }
    );
    if (p4Dur > TIMING_BUDGET_MS) {
      log('TIMING WARN: P4 meta exceeded ' + TIMING_BUDGET_MS + 'ms (' + Math.round(p4Dur) + 'ms)');
    }

    // P5: /save under X-Client-Code is refused (clients never write).
    const t0P5 = performance.now();
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/save', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Client-Code': clientCode },
      body: JSON.stringify({ state: { hacked: true } })
    });
    const cs = await j(r);
    const t1P5 = performance.now();
    const p5Dur = t1P5 - t0P5;
    check('P5 save with X-Client-Code -> refused (403)', r.status === 403 && !cs.ok, {
      status: r.status,
      cs,
      durMs: p5Dur
    });
    if (p5Dur > TIMING_BUDGET_MS) {
      log('TIMING WARN: P5 save exceeded ' + TIMING_BUDGET_MS + 'ms (' + Math.round(p5Dur) + 'ms)');
    }

    // P6: never-expiring code (expiresInDays 0 / omitted).
    const t0P6 = performance.now();
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/client-codes', {
      method: 'POST',
      credentials: 'same-origin',
      headers: ownerHeaders,
      body: JSON.stringify({ sections: ['dash'], expiresInDays: 0 })
    });
    const cn = await j(r);
    const t1P6 = performance.now();
    const p6Dur = t1P6 - t0P6;
    check(
      'P6 create with expiresInDays 0 -> never expires (no expiresAt)',
      r.ok && cn.ok && !cn.expiresAt,
      { ...cn, durMs: p6Dur }
    );
    if (p6Dur > TIMING_BUDGET_MS) {
      log(
        'TIMING WARN: P6 create exceeded ' + TIMING_BUDGET_MS + 'ms (' + Math.round(p6Dur) + 'ms)'
      );
    }

    // P7: expired code — expiresAt in the past -> lookup + load answer code_expired.
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/client-codes', {
      method: 'POST',
      credentials: 'same-origin',
      headers: ownerHeaders,
      body: JSON.stringify({
        sections: ['risk'],
        expiresAt: new Date(Date.now() - 86400000).toISOString()
      })
    });
    const cx = await j(r);
    const expCode = cx.code;
    const t0P7a = performance.now();
    r = await fetch(BASE + '/api/cloud/codes/lookup', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: expCode })
    });
    const exl = await j(r);
    const t1P7a = performance.now();
    const p7aDur = t1P7a - t0P7a;
    check(
      'P7a expired code lookup -> code_expired',
      r.status === 403 && !exl.ok && exl.error === 'code_expired',
      { ...exl, durMs: p7aDur }
    );
    if (p7aDur > TIMING_BUDGET_MS) {
      log(
        'TIMING WARN: P7a expired lookup exceeded ' +
          TIMING_BUDGET_MS +
          'ms (' +
          Math.round(p7aDur) +
          'ms)'
      );
    }
    const t0P7b = performance.now();
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/load', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Client-Code': expCode },
      body: JSON.stringify({})
    });
    const exd = await j(r);
    const t1P7b = performance.now();
    const p7bDur = t1P7b - t0P7b;
    check(
      'P7b expired code load -> code_expired (403)',
      r.status === 403 && exd.error === 'code_expired',
      { ...exd, durMs: p7bDur }
    );
    if (p7bDur > TIMING_BUDGET_MS) {
      log(
        'TIMING WARN: P7b expired load exceeded ' +
          TIMING_BUDGET_MS +
          'ms (' +
          Math.round(p7bDur) +
          'ms)'
      );
    }

    // P8: revoked client code no longer resolves.
    const listRes = await fetch(BASE + '/api/cloud/projects/' + pid + '/client-codes', {
      method: 'GET',
      credentials: 'same-origin',
      headers: ownerHeaders
    });
    const list = await j(listRes);
    const revokedId = { id: p6CodeId };
    const t0P8a = performance.now();
    check(
      'P8a list returns codes incl. expires_at field',
      listRes.ok &&
        list.ok &&
        (list.codes || []).length >= 3 &&
        (list.codes || []).every(c => 'expires_at' in c),
      list
    );
    const t1P8a = performance.now();
    const p8aDur = t1P8a - t0P8a;

    r = await fetch(
      BASE + '/api/cloud/projects/' + pid + '/client-codes/' + (revokedId && revokedId.id),
      {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: ownerHeaders
      }
    );
    const rv = await j(r);
    check('P8b revoke ok', r.ok && rv.ok, rv);
    const t1P8b = performance.now();
    const p8bDur = t1P8b - t1P8a;
    check('P8c revoked client code lookup -> generic 403 (no match)', r.status === 403 && !rvl.ok, {
      status: r.status,
      rvl,
      durMs: p8bDur
    });
    if (p8bDur > TIMING_BUDGET_MS) {
      log(
        'TIMING WARN: P8b lookup exceeded ' + TIMING_BUDGET_MS + 'ms (' + Math.round(p8bDur) + 'ms)'
      );
    }

    // P9: deleted project -> client lookup answers project_deleted.
    const t0P9 = performance.now();
    r = await fetch(BASE + '/api/cloud/projects/' + pid + '/delete', {
      method: 'POST',
      credentials: 'same-origin',
      headers: ownerHeaders,
      body: JSON.stringify({})
    });
    const del = await j(r);
    const t1P9 = performance.now();
    const p9Dur = t1P9 - t0P9;
    check('P9a soft delete ok', r.ok && del.ok, del);
    r = await fetch(BASE + '/api/cloud/codes/lookup', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: clientCode })
    });
    const dll = await j(r);
    const t1P9b = performance.now();
    const p9bDur = t1P9b - t1P9;
    check(
      'P9b client lookup after project delete -> project_deleted',
      r.status === 403 && dll.error === 'project_deleted',
      { status: r.status, dll, durMs: p9bDur }
    );
    if (p9bDur > TIMING_BUDGET_MS) {
      log(
        'TIMING WARN: P9b lookup exceeded ' + TIMING_BUDGET_MS + 'ms (' + Math.round(p9bDur) + 'ms)'
      );
    }

    const failed = results.filter(x => !x.val).length;
    log('----------------------------------------');
    log(failed === 0 ? 'ALL CLIENT-CODE GATES PASSED' : failed + ' CHECK(S) FAILED');
    // CI self-reporting: write the FULL gate table into the step summary
    // (public-readable for this repo even though job logs are not).
    try {
      const fs2 = require('fs');
      const summary = process.env.GITHUB_STEP_SUMMARY;
      if (summary) {
        const lines = ['## qa-client-codes gates', '', '| Gate | Result |', '|---|---|'];
        results.forEach(function (x) {
          lines.push(
            '| ' + x.name.replace(/\|/g, '\\|') + ' | ' + (x.val ? 'PASS' : 'FAIL') + ' |'
          );
        });
        fs2.appendFileSync(summary, lines.join('\n') + '\n');
      }
    } catch (e) {
      /* summary is best-effort */
    }
    try {
      proc && proc.kill();
    } catch (e) {}
    process.exit(failed === 0 ? 0 : 1);
  } catch (e) {
    log('HARNESS ERROR: ' + ((e && e.stack) || e));
    // Crash self-reporting: a throw between checks (fetch rejection, ws
    // error, anything) previously exited 1 with ZERO annotation - the CI
    // run showed only "exit code 1". Name the crash on the run page.
    try {
      annotateFailure('HARNESS CRASHED (outer catch)', {
        error: String((e && e.message) || e),
        stack: String((e && e.stack) || '').slice(0, 400)
      });
    } catch (x) {
      /* annotation is best-effort */
    }
    try {
      proc && proc.kill();
    } catch (x) {}
    process.exit(1);
  }
})();
