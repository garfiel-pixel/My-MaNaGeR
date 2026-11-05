/* ============================================================
   SEC-03 - RATE-LIMIT KEYING (AUDIT-DIRECTIVE-2026-11-01, wave 4.2)
   ------------------------------------------------------------
   The defect this harness exists to prove fixed: cloudRateKey() hashed
   X-Owner-Code / X-Editor-Code first and fell back to IP only when the
   header was ABSENT, so a caller who rotated the header got a fresh bucket
   on every request and the limiter contributed nothing on exactly the routes
   that authenticate by that header.

   What must be true afterwards (the directive's own fixture):
     R1  100 requests, 100 different random X-Owner-Code values, ONE IP ->
        a 429 by the 31st request. The cap is 30/min, not 40.
     R2  a valid owner code from a DIFFERENT IP still authenticates - the
        attacker's noise never locks a legitimate owner out.
     R3  the per-CODE bucket is kept: one valid code still gets its own
        30/min allowance and no more (per-tenant fairness survives).
     R4  the failed-auth ladder is the only STRICT counter, and it is scoped
        to code-bearing requests - the same locked IP still reaches an
        unauthenticated read, so a shared office NAT cannot lose the API.
     R5  the per-ACCOUNT AI burst bucket exists and trips at 20/min without
        touching another account.
     R6  wiring: the per-code binding call still comes FIRST in
        cloudRateCheck (qa-ai-relay M3 counts it).

   Runs entirely in-process: src/router.js is copied to a temp dir and driven
   through routeApi with a mock DB / R2. No server, no network, no wrangler.
   Exit 0 only when every check passes.
   Usage: node tools/qa-ratelimit-keying.cjs
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const results = [];
const log = s => process.stdout.write('[rlkey] ' + s + '\n');
const check = (name, val, detail) => {
  results.push({ name, val });
  log(
    (val ? 'PASS ' : 'FAIL ') +
      name +
      (val ? '' : '  <-- ' + JSON.stringify(detail === undefined ? null : detail))
  );
};

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode() {
  const bytes = require('crypto').randomBytes(16);
  let s = '';
  for (let i = 0; i < 16; i++) {
    s += ALPHABET[bytes[i] % 32];
  }
  return s.slice(0, 4) + '-' + s.slice(4, 8) + '-' + s.slice(8, 12) + '-' + s.slice(12, 16);
}

(async () => {
  // ---- module under test ---------------------------------------------------
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmgr-rlkey-'));
  fs.cpSync(path.join(__dirname, '..', 'src'), path.join(dir, 'src'), { recursive: true });
  const routerPath = pathToFileURL(path.join(dir, 'src', 'router.js')).href;
  const httpPath = pathToFileURL(path.join(dir, 'src', 'lib', 'http.js')).href;
  const router = await import(routerPath);
  const http = await import(httpPath);

  // ---- fixture projects ----------------------------------------------------
  const OWNER_CODE = 'ABCD-EFGH-JKLM-NPQR';
  const OWNER_SALT = '00112233445566778899aabbccddeeff';
  const OWNER_HASH = await http.hashOwnerCode(OWNER_CODE, OWNER_SALT);
  const PROJECT = 'qa-ratelimit';

  // A second project with its OWN code, so the per-code allowance can be
  // measured without inheriting records from the arms above (the per-code
  // bucket is keyed on the credential, not on the project).
  const SOLO_CODE = 'WXYZ-2345-6789-ABCD';
  const SOLO_SALT = 'ffeeddccbbaa99887766554433221100';
  const SOLO_HASH = await http.hashOwnerCode(SOLO_CODE, SOLO_SALT);
  const SOLO_PROJECT = 'qa-solo';

  const rows = {
    [PROJECT]: {
      owner_code_salt: OWNER_SALT,
      owner_code_hash: OWNER_HASH,
      google_sub: 'qa-sub',
      google_name: 'QA Owner',
      owner_email: 'qa@example.test',
      deleted_at: null,
      latest_r2_key: null
    },
    [SOLO_PROJECT]: {
      owner_code_salt: SOLO_SALT,
      owner_code_hash: SOLO_HASH,
      google_sub: 'qa-sub-2',
      google_name: 'QA Solo',
      owner_email: 'solo@example.test',
      deleted_at: null,
      latest_r2_key: null
    }
  };

  // Every query this route issues is a single-row read against cloud_projects,
  // bound on the project id; anything else answers empty so an unexpected
  // query cannot silently pass.
  const DB = {
    prepare(sql) {
      const q = String(sql);
      return {
        args: [],
        bind() {
          this.args = Array.prototype.slice.call(arguments);
          return this;
        },
        async first() {
          return q.indexOf('FROM cloud_projects') !== -1 ? rows[this.args[0]] || null : null;
        },
        async all() {
          return { results: [] };
        },
        async run() {
          return { meta: { changes: 1 } };
        }
      };
    }
  };
  const R2 = { get: async () => null, put: async () => ({}) };
  const ASSETS = { fetch: async () => new Response('<html>shell</html>') };
  // NO RATE_LIMITER binding: the in-memory table is then the only limiter, so
  // every assertion below is about THIS code's keying and not about a binding
  // whose window the harness cannot see.
  const env = { DB, R2, ASSETS };

  const url = new URL('https://app.example/api/cloud/projects/' + PROJECT + '/api/tasks');
  const soloUrl = new URL('https://app.example/api/cloud/projects/' + SOLO_PROJECT + '/api/tasks');
  const get = (code, ip, target) => {
    const headers = { 'CF-Connecting-IP': ip };
    if (code) {
      headers['X-Owner-Code'] = code;
    }
    return new Request((target || url).href, { method: 'GET', headers });
  };
  const call = req => router.routeApi(req, env, new URL(req.url));

  // ---- R1: 100 rotating codes, one IP --------------------------------------
  http.__resetRateStateForTest();
  const IP_ATTACK = '198.51.100.10';
  const statuses = [];
  let first429 = -1;
  for (let i = 0; i < 100; i++) {
    const res = await call(get(randomCode(), IP_ATTACK));
    statuses.push(res.status);
    if (res.status === 429 && first429 === -1) {
      first429 = i;
    }
  }
  const saw429 = first429 !== -1;
  check(
    'R1 rotating codes cannot buy fresh buckets: a 429 lands by request 31 (directive fixture)',
    saw429 && first429 <= 30,
    { first429: first429 === -1 ? null : first429 + 1, head: statuses.slice(0, 35) }
  );
  check(
    'R1 the ladder is not zero-tolerance: the first 10 attempts still reach the handler',
    statuses.slice(0, 10).every(s => s !== 429),
    { head: statuses.slice(0, 12) }
  );
  check(
    'R1 once tripped, the block holds for the rest of the burst (no intermittent passes)',
    saw429 && statuses.slice(first429).every(s => s === 429),
    { tail: statuses.slice(Math.max(0, first429 - 2)) }
  );

  // ---- R2: a valid owner code from another IP is untouched ------------------
  const IP_OWNER = '203.0.113.55';
  const okRes = await call(get(OWNER_CODE, IP_OWNER));
  const okBody = await okRes.json().catch(() => null);
  check(
    'R2 a valid owner code from a different IP still authenticates (no cross-IP lockout)',
    okRes.status === 200 && okBody && okBody.ok === true,
    { status: okRes.status, body: okBody }
  );

  // ---- R4: the lock is scoped to code-bearing requests ---------------------
  // IP_ATTACK is still over its failed-auth ladder from R1. A read with no
  // code header must still work, so a shared office NAT never loses the API.
  const plainRes = await call(
    new Request('https://app.example/api/turnstile-config', {
      method: 'GET',
      headers: { 'CF-Connecting-IP': IP_ATTACK }
    })
  );
  check(
    'R4 the failed-auth lock is scoped: a code-less read from the locked IP is still served',
    plainRes.status === 200,
    { status: plainRes.status }
  );
  const stillLocked = await call(get(randomCode(), IP_ATTACK));
  check(
    'R4 ...while a code-bearing request from that IP stays blocked',
    stillLocked.status === 429,
    { status: stillLocked.status }
  );

  // ---- R3: the per-code bucket is kept -------------------------------------
  // Its own window: R3 measures the per-CODE allowance alone, so it must not
  // inherit the burst above.
  http.__resetRateStateForTest();
  const IP_SOLO = '203.0.113.77';
  const soloStatuses = [];
  for (let i = 0; i < 31; i++) {
    const res = await call(get(SOLO_CODE, IP_SOLO, soloUrl));
    soloStatuses.push(res.status);
  }
  check(
    'R3 per-code bucket survives: one valid code gets exactly its 30/min allowance',
    soloStatuses.slice(0, 30).every(s => s === 200) && soloStatuses[30] === 429,
    { head: soloStatuses.slice(0, 3), at31: soloStatuses[30], all: soloStatuses }
  );

  // ---- R5: per-account AI burst bucket -------------------------------------
  http.__resetRateStateForTest();
  const acctA = [];
  for (let i = 0; i < 21; i++) {
    acctA.push(await http.cloudRateAccountCheck('qa-account-a', 'aiAccount', env));
  }
  check(
    'R5 per-account AI burst: 20 calls pass, the 21st is limited',
    acctA.slice(0, 20).every(r => r.limited === false) && acctA[20].limited === true,
    { at21: acctA[20] }
  );
  const acctB = await http.cloudRateAccountCheck('qa-account-b', 'aiAccount', env);
  check('R5 ...and a different account is unaffected by that burst', acctB.limited === false, {
    acctB
  });
  check('R5 the burst response carries a Retry-After hint', Number(acctA[20].retryAfter) > 0, {
    retryAfter: acctA[20].retryAfter
  });

  // ---- R6: wiring (binding call order + the IP bucket really exists) -------
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'http.js'), 'utf8');
  const fnBody = src.slice(src.indexOf('export async function cloudRateCheck'));
  const body = fnBody.slice(0, fnBody.indexOf('\n}\n') + 3);
  const perCodeAt = body.indexOf("checkRateBucket(bucket + ':' + key");
  const perIpAt = body.indexOf("checkRateBucket(bucket + ':net:'");
  check(
    'R6 cloudRateCheck keeps the per-code binding call FIRST (qa-ai-relay M3 counts it)',
    perCodeAt !== -1 && perIpAt !== -1 && perCodeAt < perIpAt,
    { perCodeAt, perIpAt }
  );
  check(
    'R6 the per-IP bucket is more generous than the per-code one (office NAT fairness)',
    /IP_RATE_FACTOR\s*=\s*([2-9]|\d\d+)/.test(src) &&
      body.indexOf('cfg.max * IP_RATE_FACTOR') !== -1,
    { factor: (src.match(/IP_RATE_FACTOR\s*=\s*(\d+)/) || [])[1] }
  );
  check(
    'R6 the AI route consults the account bucket on the free-pool rung',
    fs
      .readFileSync(path.join(__dirname, '..', 'src', 'ai-proxy.js'), 'utf8')
      .indexOf("cloudRateAccountCheck(session.sub, 'aiAccount', env)") !== -1,
    {}
  );

  // ---- summary -------------------------------------------------------------
  const passed = results.filter(r => r.val).length;
  log('');
  log(
    passed === results.length
      ? 'ALL GREEN - ' + passed + '/' + results.length
      : 'FAILURES - ' + (results.length - passed) + '/' + results.length + ' failed'
  );
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => {
  log('CRASH ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
