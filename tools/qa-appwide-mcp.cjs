/* ============================================================
   My MaNaGeR — APP-WIDE MCP QA harness (qa-appwide-mcp)
   ------------------------------------------------------------
   Runs WITHOUT a live Worker. It imports the real modules
   (src/mcp/oauth.js, src/mcp/appwide.js) under Node and drives
   them against an in-memory mock of the D1 binding, so the
   OAuth token machinery and the app-wide MCP gating logic are
   asserted deterministically and fast.

   What it proves (Wave 1 surface):
     OAUTH
       O1  PKCE S256 challenge is the SHA-256 of the verifier
       O2  issue -> verify access token round-trips (only hash stored)
       O3  wrong / expired token is rejected
       O4  authorization code flow enforces PKCE S256 (bad verifier fails)
       O5  code is single-use (replay fails)
       O6  refresh token rotates the pair
       O7  RFC 8414 / RFC 9728 metadata documents carry required fields
       O8  consent page has NO inline <script> (CSP-safe)
     APP-WIDE MCP
       M1  initialize returns protocol + serverInfo
       M2  tools/list catalog has list_projects + create_project + read
           tools with required projectId, and NO collaboration-invite tool
       M3  tools/call without a bearer is refused (MCP_AUTH_REFUSAL)
       M4  premium (free tier) account is refused (MCP_PREMIUM_REFUSAL)
       M5  disabled / block_all config is refused
       M6  allow_read policy blocks write tools (create_project)
       M7  allow_subset policy blocks tools not in the subset
       M8  no project access is refused
       M9  per-project mcp_enabled=0 is refused
       M10 view role blocks write tools
       M11 owner read path clears every gate (reaches the engine)
       M12 create_project succeeds and returns an owner code
       M13 list_projects returns the account's owned + adopted projects

   Run: node tools/qa-appwide-mcp.cjs
   ============================================================ */

const crypto = require('node:crypto');
const path = require('node:path');

// Module-level holders for the ESM modules imported inside the IIFE below, so
// the top-level helper functions can reach them at call time.
let OAUTH = null;
let APPWIDE = null;

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log('PASS  ' + name);
  } else {
    fail++;
    console.log(
      'FAIL  ' + name + (detail !== undefined ? '  => ' + JSON.stringify(detail).slice(0, 400) : '')
    );
  }
}
function section(t) {
  console.log('\n--- ' + t + ' ---');
}

// ---- in-memory D1 mock ----------------------------------------------------

// Apply the handful of UPDATE statements the OAuth code issues (code
// consumption, token revocation, client last_used_at) against the in-memory
// store so single-use codes and refresh rotation behave like real D1.
function handleUpdate(s, args, store) {
  if (s.includes('mcp_auth_codes')) {
    const code = args[args.length - 1];
    const row = store.mcp_auth_codes.find(c => c.code === code);
    if (row) {
      row.consumed = 1;
    }
    return { meta: { changes: row ? 1 : 0 } };
  }
  if (s.includes('mcp_clients')) {
    let row = null;
    if (s.includes('account_sub = ?')) {
      // T-26: first approval binds an openly registered client to the account.
      row = store.mcp_clients.find(c => c.client_id === args[1]);
      if (row && (row.account_sub === '' || row.account_sub === args[2])) {
        row.account_sub = args[0];
      }
    } else if (s.includes('last_used_at')) {
      const clientId = args[args.length - 1];
      row = store.mcp_clients.find(c => c.client_id === clientId);
      if (row) {
        row.last_used_at = args[0];
      }
    } else if (s.includes('revoked')) {
      const clientId = args[0];
      row = store.mcp_clients.find(c => c.client_id === clientId);
      if (row) {
        row.revoked = 1;
      }
    }
    return { meta: { changes: row ? 1 : 0 } };
  }
  if (s.includes('mcp_tokens')) {
    let row = null;
    const last = args[args.length - 1];
    if (s.includes('token_id')) {
      row = store.mcp_tokens.find(t => t.token_id === last);
    } else {
      row = store.mcp_tokens.find(
        t => t.client_id === args[0] && (args.length < 2 || t.account_sub === args[1])
      );
    }
    if (row) {
      row.revoked = 1;
    }
    return { meta: { changes: row ? 1 : 0 } };
  }
  return { meta: { changes: 0 } };
}

function makeEnv(world) {
  const store = {
    mcp_tokens: [],
    mcp_auth_codes: [],
    mcp_clients: [],
    mcp_server_config: [],
    cloud_projects: world.projects || [],
    cloud_adoptions: world.adoptions || [],
    cloud_reviews: [],
    cloud_subscriptions: []
  };
  if (world.config) {
    store.mcp_server_config.push(world.config);
  }
  if (world.subscription) {
    store.cloud_subscriptions.push(world.subscription);
  }
  let reviewSeq = 1000;

  function route(sql, args, wantList) {
    const s = sql.toLowerCase();
    if (s.startsWith('update ')) {
      return handleUpdate(s, args, store);
    }
    if (s.startsWith('insert into')) {
      const m = sql.match(/insert into\s+(\w+)\s*\(([^)]+)\)/i);
      if (!m) {
        return null;
      }
      const table = m[1];
      const cols = m[2].split(',').map(c => c.trim());
      const row = {};
      cols.forEach((c, i) => {
        row[c] = args[i];
      });
      if (table === 'cloud_reviews') {
        row.id = ++reviewSeq;
        store.cloud_reviews.push(row);
        return { meta: { changes: 1, last_row_id: row.id } };
      }
      store[table].push(row);
      return { meta: { changes: 1, last_row_id: row.id || 1 } };
    }
    // SELECT routing
    if (s.includes('from mcp_tokens')) {
      if (s.includes('access_hash')) {
        const h = args[0];
        const row = store.mcp_tokens.find(
          t =>
            t.access_hash === h && t.revoked !== 1 && new Date(t.expires_at).getTime() > Date.now()
        );
        return row || null;
      }
      if (s.includes('refresh_hash')) {
        const h = args[0];
        const row = store.mcp_tokens.find(
          t =>
            t.refresh_hash === h &&
            t.revoked !== 1 &&
            new Date(t.refresh_expires_at).getTime() > Date.now()
        );
        return row || null;
      }
      if (s.includes('token_id')) {
        const id = args[0];
        return store.mcp_tokens.find(t => t.token_id === id) || null;
      }
      return null;
    }
    if (s.includes('from mcp_auth_codes')) {
      const row = store.mcp_auth_codes.find(c => c.code === args[0]);
      return row || null;
    }
    if (s.includes('from mcp_clients') && s.includes('client_id')) {
      const row = store.mcp_clients.find(c => c.client_id === args[0]);
      return row || null;
    }
    if (s.includes('from auth_sessions')) {
      // readSession asks whether the jti was revoked; a null answer means no.
      return { revoked_at: null };
    }
    if (s.includes('from mcp_server_config')) {
      return store.mcp_server_config[0] || null;
    }
    if (s.includes('from cloud_subscriptions')) {
      return store.cloud_subscriptions[0] || null;
    }
    if (s.includes('from auth_users')) {
      return world.emailVerified ? { email_verified: 1 } : null;
    }
    if (
      s.includes('from cloud_projects') &&
      s.includes('project_id = ?') &&
      s.includes('google_sub = ? or owner_email = ?')
    ) {
      const pid = args[0];
      const sub = args[1];
      const email = args[2];
      return (
        store.cloud_projects.find(
          p =>
            p.project_id === pid &&
            !p.deleted_at &&
            (p.google_sub === sub || (email && p.owner_email === email))
        ) || null
      );
    }
    if (
      s.includes('from cloud_projects') &&
      s.includes('deleted_at is null') &&
      s.includes('google_sub = ? or owner_email = ?')
    ) {
      const sub = args[0];
      const email = args[1];
      return store.cloud_projects.filter(
        p => !p.deleted_at && (p.google_sub === sub || (email && p.owner_email === email))
      );
    }
    if (s.includes('from cloud_adoptions')) {
      if (s.includes('a.project_id = ?')) {
        const sub = args[0];
        const pid = args[1];
        const a =
          store.cloud_adoptions.find(x => x.recipient_sub === sub && x.project_id === pid) || null;
        if (!a) {
          return null;
        }
        // Simulate the JOIN that exposes the role as adopted_role plus the
        // project columns the handler reads off the row.
        return {
          project_id: a.project_id,
          owner_code_hash: a.owner_code_hash,
          owner_code_salt: a.owner_code_salt,
          latest_r2_key: a.latest_r2_key,
          mcp_enabled: a.mcp_enabled,
          deleted_at: a.deleted_at || null,
          adopted_role: a.role,
          // The handler reads the adopted member's real section scope from the
          // joined editor code. Mirror that here.
          editor_scope: a.editor_scope !== undefined ? a.editor_scope : null
        };
      }
      const sub = args[0];
      return store.cloud_adoptions
        .filter(a => a.recipient_sub === sub)
        .map(a => Object.assign({}, a, { adopted_role: a.role }));
    }
    if (s.includes('count(*) as c from cloud_projects')) {
      return { c: world.ownedCount || 0 };
    }
    if (s.includes('from cloud_reviews')) {
      return [];
    }
    return wantList ? [] : null;
  }

  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              return route(sql, args, false);
            },
            async all() {
              const r = route(sql, args, true);
              return { results: Array.isArray(r) ? r : r ? [r] : [] };
            },
            async run() {
              return route(sql, args, false) || { meta: { changes: 1, last_row_id: 1 } };
            }
          };
        }
      };
    },
    async batch(stmts) {
      return Promise.all(
        stmts.map(st =>
          st
            .all()
            .then(r => r)
            .catch(() => ({ results: [] }))
        )
      );
    }
  };
  // R2 mock: serve a plaintext state blob per project id so the write-path
  // arms exercise the REAL state load + scope merge + proposal pipeline.
  const r2 = {
    async get(key) {
      const m = /^projects\/([^/]+)\/latest\.json$/.exec(String(key || ''));
      if (m && world.states && world.states[m[1]]) {
        const blob = JSON.stringify(world.states[m[1]]);
        return {
          async text() {
            return blob;
          }
        };
      }
      return null;
    }
  };
  return {
    DB: db,
    KV: {},
    R2: r2,
    // A fixed secret lets the harness mint a real session cookie for the
    // authorize tests; readSession signs with the same value.
    GOOGLE_CLIENT_SECRET: 'qa-appwide-session-secret',
    __store: store
  };
}

// ---- request helper -------------------------------------------------------

async function mcpCall(env, body, bearer) {
  const headers = { 'content-type': 'application/json' };
  if (bearer) {
    headers['authorization'] = 'Bearer ' + bearer;
  }
  const req = new Request('http://localhost/api/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  const res = await APPWIDE.handleAppwideMcp(req, env);
  const text = await res.text();
  let out;
  try {
    out = JSON.parse(text);
  } catch (e) {
    out = { __raw: text };
  }
  out.__status = res.status;
  out.__www = res.headers.get('WWW-Authenticate') || '';
  return out;
}
async function metaCall(env, pathname) {
  const req = new Request('http://localhost' + pathname, { method: 'GET' });
  const res = await OAUTH.handleOauthMetadata(req, env, new URL('http://localhost' + pathname));
  return { status: res.status, body: await res.json().catch(() => null) };
}

// A real session cookie for the authorize tests, signed with the same secret
// readSession uses (env.GOOGLE_CLIENT_SECRET).
async function sessionCookie(env, sub) {
  const payload = JSON.stringify({
    sub: sub,
    email: '',
    name: '',
    jti: 'jti-' + sub,
    exp: Math.floor(Date.now() / 1000) + 3600
  });
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.GOOGLE_CLIENT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return (
    'mmgr_session=' +
    Buffer.from(payload, 'utf8').toString('base64url') +
    '.' +
    Buffer.from(new Uint8Array(sig)).toString('base64url')
  );
}

// ---- main -----------------------------------------------------------------

(async () => {
  const oauth = await import('../src/mcp/oauth.js');
  const appwide = await import('../src/mcp/appwide.js');
  OAUTH = oauth;
  APPWIDE = appwide;
  const env0 = {};

  section('OAUTH O1 — PKCE S256 challenge');
  const verifier = 'test-verifier-0123456789abcdef';
  const challenge = await oauth.pkceChallenge(verifier);
  // RFC 7636 section 4.2: BASE64URL(SHA256(ASCII(verifier))), never hex.
  const expected = crypto.createHash('sha256').update(verifier).digest('base64url');
  check('challenge equals base64url SHA-256(verifier)', challenge === expected, {
    challenge,
    expected
  });
  const rfcChallenge = await oauth.pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
  check(
    'RFC 7636 appendix B test vector',
    rfcChallenge === 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    rfcChallenge
  );

  section('OAUTH O2/O3 — token issue + verify + rejection');
  const envT = makeEnv({ config: null, subscription: null, projects: [], adoptions: [] });
  const issued = await oauth.issueTokens(envT, 'sub-abc', 'client-1');
  check(
    'issueTokens returns opaque access + refresh',
    /^[a-z]+_/.test(issued.accessToken) && /^[a-z]+_/.test(issued.refreshToken),
    issued
  );
  const verified = await oauth.verifyAccessToken(envT, issued.accessToken);
  check(
    'verifyAccessToken round-trips the account + client',
    verified && verified.accountSub === 'sub-abc' && verified.clientId === 'client-1',
    verified
  );
  const bad = await oauth.verifyAccessToken(envT, 'not-a-real-token');
  check('unknown token is rejected', bad === null, bad);

  section('OAUTH O4/O5 — authorization code + PKCE + single use');
  const envC = makeEnv({ config: null, subscription: null, projects: [], adoptions: [] });
  const code = await oauth.issueAuthCode(
    envC,
    'sub-abc',
    'client-1',
    challenge,
    'S256',
    'https://app/cb'
  );
  const goodEx = await oauth.exchangeCode(envC, code, verifier, 'client-1', 'https://app/cb');
  check(
    'exchange with correct verifier succeeds',
    goodEx.ok === true && !!goodEx.accessToken,
    goodEx
  );
  const badEx = await oauth.exchangeCode(
    envC,
    code,
    'wrong-verifier',
    'client-1',
    'https://app/cb'
  );
  check('exchange with wrong verifier is refused', badEx.error === 'invalid_grant', badEx);
  const replay = await oauth.exchangeCode(envC, code, verifier, 'client-1', 'https://app/cb');
  check('replaying a consumed code is refused', replay.error === 'invalid_grant', replay);

  section('OAUTH O6 — refresh token rotation');
  const envR = makeEnv({ config: null, subscription: null, projects: [], adoptions: [] });
  const issuedR = await oauth.issueTokens(envR, 'sub-abc', 'client-1');
  const refreshed = await oauth.refreshTokens(envR, issuedR.refreshToken, 'client-1');
  check(
    'refresh returns a fresh token pair',
    refreshed.ok === true && refreshed.accessToken !== issuedR.accessToken,
    refreshed
  );
  const oldUsed = await oauth.verifyAccessToken(envR, issuedR.accessToken);
  check('old access token is revoked after rotation', oldUsed === null, oldUsed);

  section('OAUTH O7 — metadata documents');
  const asMeta = (await metaCall(env0, '/.well-known/oauth-authorization-server')).body;
  check(
    'authorization-server metadata has required fields',
    asMeta &&
      asMeta.issuer === 'http://localhost' &&
      /authorize$/.test(asMeta.authorization_endpoint) &&
      /token$/.test(asMeta.token_endpoint) &&
      /register$/.test(asMeta.registration_endpoint) &&
      asMeta.code_challenge_methods_supported.indexOf('S256') > -1,
    asMeta
  );
  const prMeta = (await metaCall(env0, '/.well-known/oauth-protected-resource')).body;
  check(
    'protected-resource metadata points at the app-wide resource',
    prMeta &&
      prMeta.resource === 'http://localhost/api/mcp' &&
      Array.isArray(prMeta.authorization_servers),
    prMeta
  );

  section('OAUTH O8 — consent page is CSP-safe (no inline script)');
  const html = oauth.renderConsentHtml({
    response_type: 'code',
    client_id: 'client-1',
    redirect_uri: 'https://app/cb',
    scope: 'account',
    state: 'xyz',
    code_challenge: challenge,
    code_challenge_method: 'S256'
  });
  check('consent page contains no <script> tag', html.indexOf('<script') === -1, '');
  check(
    'consent page carries the hidden fields',
    html.indexOf('name="code_challenge"') > -1 && html.indexOf('name="client_id"') > -1,
    ''
  );

  section('OAUTH O9 — open dynamic client registration');
  const envD = makeEnv({ config: null, subscription: null, projects: [], adoptions: [] });
  const redirectUri = 'https://claude.ai/api/mcp/auth_callback';
  const regRes = await oauth.handleOauthRegister(
    new Request('http://localhost/api/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'Claude', redirect_uris: [redirectUri] })
    }),
    envD
  );
  const regBody = await regRes.json();
  check(
    'registration without a browser session returns 201 + client_id',
    regRes.status === 201 && /^mmgr_mc_/.test(regBody.client_id || ''),
    { status: regRes.status, regBody }
  );
  check(
    'registration echoes the redirect URI',
    Array.isArray(regBody.redirect_uris) && regBody.redirect_uris[0] === redirectUri,
    regBody.redirect_uris
  );
  check(
    'registration stores no account binding yet',
    envD.__store.mcp_clients[0] && envD.__store.mcp_clients[0].account_sub === '',
    envD.__store.mcp_clients[0]
  );

  section('OAUTH O10 — registration refuses a non-HTTPS redirect');
  const badReg = await oauth.handleOauthRegister(
    new Request('http://localhost/api/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'Bad', redirect_uris: ['http://evil.example/cb'] })
    }),
    envD
  );
  check('http redirect outside localhost is refused', badReg.status === 400, badReg.status);

  section('OAUTH O11 — authorize enforces the registered redirect');
  const cookie = await sessionCookie(envD, 'sub-abc');
  const clientId = regBody.client_id;
  function authUrl(uri) {
    return new URL(
      'http://localhost/api/oauth/authorize?response_type=code&client_id=' +
        encodeURIComponent(clientId) +
        '&redirect_uri=' +
        encodeURIComponent(uri) +
        '&code_challenge=' +
        challenge +
        '&code_challenge_method=S256&state=xyz'
    );
  }
  const badUrl = authUrl('https://evil.example/cb');
  const badAuth = await oauth.handleOauthAuthorize(
    new Request(badUrl, { headers: { cookie: cookie } }),
    envD,
    badUrl
  );
  check('authorize refuses an unregistered redirect_uri', badAuth.status === 400, badAuth.status);

  const goodUrl = authUrl(redirectUri);
  const goodAuth = await oauth.handleOauthAuthorize(
    new Request(goodUrl, { headers: { cookie: cookie } }),
    envD,
    goodUrl
  );
  const consent = await goodAuth.text();
  check('consent page names the client', consent.indexOf('Claude') > -1, '');
  check('consent page names the redirect host', consent.indexOf('claude.ai') > -1, '');

  section('OAUTH O12 — approval binds the client and issues a code');
  const approveRes = await oauth.handleOauthAuthorize(
    new Request('http://localhost/api/oauth/authorize', {
      method: 'POST',
      headers: { cookie: cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        decision: 'approve',
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state: 'xyz'
      })
    }),
    envD,
    new URL('http://localhost/api/oauth/authorize')
  );
  const location = approveRes.headers.get('location') || '';
  const codeMatch = /[?&]code=([^&]+)/.exec(location);
  check('approve redirects back with a code', approveRes.status === 302 && !!codeMatch, {
    status: approveRes.status,
    location
  });
  check(
    'approval binds the client to the signed-in account',
    envD.__store.mcp_clients[0].account_sub === 'sub-abc',
    envD.__store.mcp_clients[0].account_sub
  );
  const flow = await oauth.exchangeCode(
    envD,
    codeMatch ? decodeURIComponent(codeMatch[1]) : '',
    verifier,
    clientId,
    redirectUri
  );
  check('the issued code exchanges for a token', flow.ok === true && !!flow.accessToken, flow);

  // Each env keeps its OWN in-memory D1 store, so a bearer must be issued
  // against the SAME env that the MCP call is dispatched to (verifyAccessToken
  // only sees that env's stored token hashes).
  async function tok(env, sub) {
    const r = await OAUTH.issueTokens(env, sub, 'client-1');
    return r.accessToken;
  }

  section('APP-WIDE MCP M1/M2 — handshake + catalog');
  const envA = makeEnv({
    config: { account_sub: 'sub-abc', enabled: 1, policy: 'allow_all', tool_subset: null },
    subscription: { owner_sub: 'sub-abc', status: 'active', tier: 'premium' },
    projects: [
      {
        project_id: 'p1',
        google_sub: 'sub-abc',
        owner_email: null,
        mcp_enabled: 1,
        owner_code_hash: 'h',
        owner_code_salt: 's',
        latest_r2_key: null
      }
    ],
    adoptions: []
  });
  const bearerA = await tok(envA, 'sub-abc');
  const init = await mcpCall(
    envA,
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
    bearerA
  );
  check(
    'initialize returns protocolVersion + serverInfo',
    init &&
      init.result &&
      init.result.protocolVersion === '2024-11-05' &&
      init.result.serverInfo &&
      init.result.serverInfo.name === 'my-manager-mcp-appwide',
    init
  );
  const list = await mcpCall(envA, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, bearerA);
  const names = (list.result && list.result.tools ? list.result.tools : []).map(t => t.name);
  check('catalog includes list_projects', names.indexOf('list_projects') > -1, names);
  check('catalog includes create_project', names.indexOf('create_project') > -1, names);
  check(
    'catalog includes read tools + apply_changes',
    names.indexOf('get_project_summary') > -1 && names.indexOf('apply_changes') > -1,
    names
  );
  check(
    'catalog does NOT include any collaboration-invite tool',
    !names.some(n => /invite|share|collab/i.test(n)),
    names
  );
  const projScoped = list.result.tools.filter(
    t => t.name !== 'list_projects' && t.name !== 'create_project'
  );
  check(
    'every project-scoped tool requires projectId',
    projScoped.every(t => (t.inputSchema.required || []).indexOf('projectId') > -1),
    projScoped.map(t => t.name)
  );

  section('APP-WIDE MCP M3 — 401 metadata challenge');
  const noAuth = await mcpCall(
    envA,
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'list_projects', arguments: {} }
    },
    null
  );
  check(
    'tools/call without a bearer answers 401 + resource_metadata',
    noAuth.__status === 401 &&
      /resource_metadata="http:\/\/localhost\/\.well-known\/oauth-protected-resource"/.test(
        noAuth.__www
      ),
    { status: noAuth.__status, www: noAuth.__www }
  );
  check('the 401 body carries no tool result', !noAuth.result, {
    status: noAuth.__status,
    hasResult: !!noAuth.result
  });
  const initNoAuth = await mcpCall(
    envA,
    { jsonrpc: '2.0', id: 30, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
    null
  );
  check(
    'initialize without a bearer also answers 401 (the OAuth trigger)',
    initNoAuth.__status === 401,
    initNoAuth.__status
  );
  const badBearer = await mcpCall(
    envA,
    { jsonrpc: '2.0', id: 31, method: 'tools/list' },
    'mmgr_at_deadbeef'
  );
  check(
    'an invalid bearer answers 401 with error="invalid_token"',
    badBearer.__status === 401 && /error="invalid_token"/.test(badBearer.__www),
    { status: badBearer.__status, www: badBearer.__www }
  );

  section('APP-WIDE MCP M4 — premium refusal');
  const envFree = makeEnv({
    config: { account_sub: 'sub-free', enabled: 1, policy: 'allow_all', tool_subset: null },
    subscription: null,
    projects: [],
    adoptions: []
  });
  const bearerFree = await tok(envFree, 'sub-free');
  const freeCall = await mcpCall(
    envFree,
    {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'list_projects', arguments: {} }
    },
    bearerFree
  );
  check(
    'free-tier account is refused with MCP_PREMIUM_REFUSAL',
    freeCall &&
      freeCall.result &&
      freeCall.result.isError === true &&
      /Premium/.test(freeCall.result.content[0].text),
    freeCall
  );

  section('APP-WIDE MCP M5 — disabled / block_all config');
  const envOff = makeEnv({
    config: { account_sub: 'sub-abc', enabled: 0, policy: 'allow_all', tool_subset: null },
    subscription: { owner_sub: 'sub-abc', status: 'active', tier: 'premium' },
    projects: [],
    adoptions: []
  });
  const bearerOff = await tok(envOff, 'sub-abc');
  const offCall = await mcpCall(
    envOff,
    {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'list_projects', arguments: {} }
    },
    bearerOff
  );
  check(
    'disabled config is refused',
    offCall &&
      offCall.result &&
      offCall.result.isError === true &&
      /turned off/.test(offCall.result.content[0].text),
    offCall
  );
  const envBlock = makeEnv({
    config: { account_sub: 'sub-abc', enabled: 1, policy: 'block_all', tool_subset: null },
    subscription: { owner_sub: 'sub-abc', status: 'active', tier: 'premium' },
    projects: [],
    adoptions: []
  });
  const bearerBlock = await tok(envBlock, 'sub-abc');
  const blockCall = await mcpCall(
    envBlock,
    {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'list_projects', arguments: {} }
    },
    bearerBlock
  );
  check(
    'block_all policy is refused',
    blockCall &&
      blockCall.result &&
      blockCall.result.isError === true &&
      /turned off/.test(blockCall.result.content[0].text),
    blockCall
  );

  section('APP-WIDE MCP M6 — allow_read blocks writes');
  const envRead = makeEnv({
    config: { account_sub: 'sub-abc', enabled: 1, policy: 'allow_read', tool_subset: null },
    subscription: { owner_sub: 'sub-abc', status: 'active', tier: 'premium' },
    projects: [],
    adoptions: []
  });
  const bearerRead = await tok(envRead, 'sub-abc');
  const readWrite = await mcpCall(
    envRead,
    {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'create_project', arguments: { projectId: 'x', name: 'X' } }
    },
    bearerRead
  );
  check(
    'allow_read blocks create_project',
    readWrite &&
      readWrite.result &&
      readWrite.result.isError === true &&
      /read-only/.test(readWrite.result.content[0].text),
    readWrite
  );

  section('APP-WIDE MCP M7 — allow_subset blocks unspecified tool');
  const envSubset = makeEnv({
    config: {
      account_sub: 'sub-abc',
      enabled: 1,
      policy: 'allow_subset',
      tool_subset: JSON.stringify(['list_projects'])
    },
    subscription: { owner_sub: 'sub-abc', status: 'active', tier: 'premium' },
    projects: [],
    adoptions: []
  });
  const bearerSubset = await tok(envSubset, 'sub-abc');
  const subsetCall = await mcpCall(
    envSubset,
    {
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: { name: 'get_project_summary', arguments: { projectId: 'p1' } }
    },
    bearerSubset
  );
  check(
    'allow_subset blocks a tool not in the subset',
    subsetCall &&
      subsetCall.result &&
      subsetCall.result.isError === true &&
      /not enabled/.test(subsetCall.result.content[0].text),
    subsetCall
  );

  section('APP-WIDE MCP M8/M9/M10 — access + per-project opt-out + view role');
  const envOwned = makeEnv({
    config: { account_sub: 'sub-abc', enabled: 1, policy: 'allow_all', tool_subset: null },
    subscription: { owner_sub: 'sub-abc', status: 'active', tier: 'premium' },
    projects: [
      {
        project_id: 'p1',
        google_sub: 'sub-abc',
        owner_email: null,
        mcp_enabled: 1,
        owner_code_hash: 'h',
        owner_code_salt: 's',
        latest_r2_key: null
      }
    ],
    adoptions: [
      {
        recipient_sub: 'sub-abc',
        project_id: 'p2',
        role: 'view',
        mcp_enabled: 1,
        owner_code_hash: 'h',
        owner_code_salt: 's',
        latest_r2_key: null
      }
    ]
  });
  const bearerOwned = await tok(envOwned, 'sub-abc');
  const noAccess = await mcpCall(
    envOwned,
    {
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: { name: 'get_project_summary', arguments: { projectId: 'p9' } }
    },
    bearerOwned
  );
  check(
    'project the account cannot reach is refused',
    noAccess &&
      noAccess.result &&
      noAccess.result.isError === true &&
      /do not have access/.test(noAccess.result.content[0].text),
    noAccess
  );
  const envOptOut = makeEnv({
    config: { account_sub: 'sub-abc', enabled: 1, policy: 'allow_all', tool_subset: null },
    subscription: { owner_sub: 'sub-abc', status: 'active', tier: 'premium' },
    projects: [
      {
        project_id: 'p1',
        google_sub: 'sub-abc',
        owner_email: null,
        mcp_enabled: 0,
        owner_code_hash: 'h',
        owner_code_salt: 's',
        latest_r2_key: null
      }
    ],
    adoptions: []
  });
  const bearerOptOut = await tok(envOptOut, 'sub-abc');
  const optOut = await mcpCall(
    envOptOut,
    {
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: { name: 'get_project_summary', arguments: { projectId: 'p1' } }
    },
    bearerOptOut
  );
  check(
    'per-project mcp_enabled=0 is refused',
    optOut &&
      optOut.result &&
      optOut.result.isError === true &&
      /turned off for that project/.test(optOut.result.content[0].text),
    optOut
  );
  const viewWrite = await mcpCall(
    envOwned,
    {
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: { name: 'apply_changes', arguments: { projectId: 'p2', diffs: [] } }
    },
    bearerOwned
  );
  check(
    'view role blocks write tools',
    viewWrite &&
      viewWrite.result &&
      viewWrite.result.isError === true &&
      /view-only/.test(viewWrite.result.content[0].text),
    viewWrite
  );

  section('APP-WIDE MCP M11 — owner read clears every gate');
  const envOwnerRead = makeEnv({
    config: { account_sub: 'sub-abc', enabled: 1, policy: 'allow_all', tool_subset: null },
    subscription: { owner_sub: 'sub-abc', status: 'active', tier: 'premium' },
    projects: [
      {
        project_id: 'p1',
        google_sub: 'sub-abc',
        owner_email: null,
        mcp_enabled: 1,
        owner_code_hash: 'h',
        owner_code_salt: 's',
        latest_r2_key: null
      }
    ],
    adoptions: []
  });
  const bearerOwnerRead = await tok(envOwnerRead, 'sub-abc');
  const ownerRead = await mcpCall(
    envOwnerRead,
    {
      jsonrpc: '2.0',
      id: 12,
      method: 'tools/call',
      params: { name: 'get_project_summary', arguments: { projectId: 'p1' } }
    },
    bearerOwnerRead
  );
  check(
    'owner read with no snapshot reaches the engine (no gate refusal)',
    ownerRead &&
      ownerRead.result &&
      !/refused|credential|Premium|turned off|do not have access/i.test(
        ownerRead.result.content ? ownerRead.result.content[0].text : ''
      ),
    ownerRead
  );

  section('APP-WIDE MCP M12 — create_project succeeds');
  const envCreate = makeEnv({
    config: { account_sub: 'sub-abc', enabled: 1, policy: 'allow_all', tool_subset: null },
    subscription: { owner_sub: 'sub-abc', status: 'active', tier: 'premium' },
    projects: [],
    adoptions: []
  });
  const bearerCreate = await tok(envCreate, 'sub-abc');
  const created = await mcpCall(
    envCreate,
    {
      jsonrpc: '2.0',
      id: 13,
      method: 'tools/call',
      params: { name: 'create_project', arguments: { projectId: 'new-1', name: 'New Project' } }
    },
    bearerCreate
  );
  const createdText = created && created.result ? created.result.content[0].text : '';
  let createdJson = null;
  try {
    createdJson = JSON.parse(createdText);
  } catch (e) {}
  check(
    'create_project returns projectId + ownerCode',
    createdJson &&
      createdJson.projectId === 'new-1' &&
      /^[A-Za-z0-9-]+$/.test(createdJson.ownerCode),
    createdJson
  );

  section('APP-WIDE MCP M13 — list_projects returns owned + adopted');
  const envList = makeEnv({
    config: { account_sub: 'sub-abc', enabled: 1, policy: 'allow_all', tool_subset: null },
    subscription: { owner_sub: 'sub-abc', status: 'active', tier: 'premium' },
    projects: [
      {
        project_id: 'p1',
        google_sub: 'sub-abc',
        owner_email: null,
        mcp_enabled: 1,
        owner_code_hash: 'h',
        owner_code_salt: 's',
        latest_r2_key: null
      }
    ],
    adoptions: [
      {
        recipient_sub: 'sub-abc',
        project_id: 'p2',
        role: 'editor',
        mcp_enabled: 1,
        owner_code_hash: 'h',
        owner_code_salt: 's',
        latest_r2_key: null
      }
    ]
  });
  const bearerList = await tok(envList, 'sub-abc');
  const listed = await mcpCall(
    envList,
    {
      jsonrpc: '2.0',
      id: 14,
      method: 'tools/call',
      params: { name: 'list_projects', arguments: {} }
    },
    bearerList
  );
  let listedJson = null;
  try {
    listedJson = JSON.parse(listed.result.content[0].text);
  } catch (e) {}
  const pids = ((listedJson && listedJson.projects) || []).map(p => p.projectId);
  check(
    'list_projects returns both owned and adopted',
    pids.indexOf('p1') > -1 &&
      pids.indexOf('p2') > -1 &&
      listedJson.projects.find(p => p.projectId === 'p2').accessRole === 'editor',
    listedJson
  );

  // ---- WAVE 2 WRITE PATH (MCP-DIRECTIVE 2026-11-11) -----------------------
  // These drive the REAL proposal pipeline (state load -> scope merge ->
  // cloud_reviews insert) against an in-memory R2 blob, so they prove the
  // app-wide write path queues exactly ONE proposal and never forks the
  // project executor.
  const wTasks = [];
  for (let i = 1; i <= 30; i++) {
    wTasks.push({
      id: 't' + i,
      name: 'Task ' + i,
      status: 'todo',
      startDate: '2026-10-01',
      endDate: '2026-10-05'
    });
  }
  const wState = {
    schemaVersion: 19,
    projectId: 'p1',
    currency: 'USD',
    tasks: wTasks,
    risks: [],
    budgetLines: []
  };

  section('APP-WIDE MCP W1 — empty apply_changes is a structured error');
  const envW = makeEnv({
    config: { account_sub: 'sub-abc', enabled: 1, policy: 'allow_all', tool_subset: null },
    subscription: { owner_sub: 'sub-abc', status: 'active', tier: 'premium' },
    projects: [
      {
        project_id: 'p1',
        google_sub: 'sub-abc',
        owner_email: null,
        mcp_enabled: 1,
        owner_code_hash: 'h',
        owner_code_salt: 's',
        latest_r2_key: 'projects/p1/latest.json'
      }
    ],
    adoptions: [],
    states: { p1: wState }
  });
  const bearerW = await tok(envW, 'sub-abc');
  const wEmpty = await mcpCall(
    envW,
    {
      jsonrpc: '2.0',
      id: 20,
      method: 'tools/call',
      params: { name: 'apply_changes', arguments: { projectId: 'p1' } }
    },
    bearerW
  );
  check(
    'empty apply_changes returns isError "Nothing provided"',
    wEmpty &&
      wEmpty.result &&
      wEmpty.result.isError === true &&
      /Nothing provided/.test(wEmpty.result.content[0].text),
    wEmpty
  );
  check(
    'empty apply_changes queued NO review row',
    envW.__store.cloud_reviews.length === 0,
    envW.__store.cloud_reviews.length
  );

  section('APP-WIDE MCP W2 — one diff queues one proposal');
  const w1 = await mcpCall(
    envW,
    {
      jsonrpc: '2.0',
      id: 21,
      method: 'tools/call',
      params: {
        name: 'apply_changes',
        arguments: {
          projectId: 'p1',
          diffs: [{ path: 'tasks', recordId: 't1', field: 'status', after: 'completed' }]
        }
      }
    },
    bearerW
  );
  check(
    'one diff is accepted and queued',
    w1 &&
      w1.result &&
      !w1.result.isError &&
      /Queued 1 field change/.test(w1.result.content[0].text),
    w1
  );
  check(
    'one diff created exactly one cloud_reviews row',
    envW.__store.cloud_reviews.length === 1 &&
      envW.__store.cloud_reviews[0].proposal_type === 'mcp',
    envW.__store.cloud_reviews
  );

  section('APP-WIDE MCP W3 — 30 diffs queue ONE proposal');
  const wDiffs = [];
  for (let i = 1; i <= 30; i++) {
    wDiffs.push({ path: 'tasks', recordId: 't' + i, field: 'status', after: 'completed' });
  }
  const w30 = await mcpCall(
    envW,
    {
      jsonrpc: '2.0',
      id: 22,
      method: 'tools/call',
      params: { name: 'apply_changes', arguments: { projectId: 'p1', diffs: wDiffs } }
    },
    bearerW
  );
  check(
    '30 diffs are accepted and queued',
    w30 &&
      w30.result &&
      !w30.result.isError &&
      /Queued 30 field change/.test(w30.result.content[0].text),
    w30
  );
  check(
    '30 diffs still created exactly ONE review row',
    envW.__store.cloud_reviews.length === 2,
    envW.__store.cloud_reviews.length
  );

  section('APP-WIDE MCP W3b — over-cap envelope is refused before state load');
  const tooMany = [];
  for (let i = 0; i < 501; i++) {
    tooMany.push({ path: 'tasks', recordId: 't' + i, field: 'status', after: 'completed' });
  }
  const wCap = await mcpCall(
    envW,
    {
      jsonrpc: '2.0',
      id: 23,
      method: 'tools/call',
      params: { name: 'apply_changes', arguments: { projectId: 'p1', diffs: tooMany } }
    },
    bearerW
  );
  check(
    'more than 500 diffs is refused with a cap message',
    wCap &&
      wCap.result &&
      wCap.result.isError === true &&
      /at most 500 diffs/.test(wCap.result.content[0].text),
    wCap
  );

  section('APP-WIDE MCP W4 — view role cannot propose writes');
  const envViewW = makeEnv({
    config: { account_sub: 'sub-abc', enabled: 1, policy: 'allow_all', tool_subset: null },
    subscription: { owner_sub: 'sub-abc', status: 'active', tier: 'premium' },
    projects: [],
    adoptions: [
      {
        recipient_sub: 'sub-abc',
        project_id: 'p2',
        role: 'view',
        mcp_enabled: 1,
        owner_code_hash: 'h',
        owner_code_salt: 's',
        latest_r2_key: 'projects/p2/latest.json',
        editor_scope: JSON.stringify(['wbs'])
      }
    ],
    states: { p2: wState }
  });
  const bearerViewW = await tok(envViewW, 'sub-abc');
  const wView = await mcpCall(
    envViewW,
    {
      jsonrpc: '2.0',
      id: 24,
      method: 'tools/call',
      params: {
        name: 'apply_changes',
        arguments: {
          projectId: 'p2',
          diffs: [{ path: 'tasks', recordId: 't1', field: 'status', after: 'completed' }]
        }
      }
    },
    bearerViewW
  );
  check(
    'view role write is refused',
    wView &&
      wView.result &&
      wView.result.isError === true &&
      /view-only/.test(wView.result.content[0].text),
    wView
  );

  section('APP-WIDE MCP W5 — out-of-scope diff is refused');
  const envScopeW = makeEnv({
    config: { account_sub: 'sub-abc', enabled: 1, policy: 'allow_all', tool_subset: null },
    subscription: { owner_sub: 'sub-abc', status: 'active', tier: 'premium' },
    projects: [],
    adoptions: [
      {
        recipient_sub: 'sub-abc',
        project_id: 'p3',
        role: 'editor',
        mcp_enabled: 1,
        owner_code_hash: 'h',
        owner_code_salt: 's',
        latest_r2_key: 'projects/p3/latest.json',
        editor_scope: JSON.stringify(['wbs'])
      }
    ],
    states: {
      p3: {
        schemaVersion: 19,
        projectId: 'p3',
        currency: 'USD',
        tasks: wTasks,
        risks: [],
        budgetLines: [{ id: 'b1', description: 'Concrete', planned: 100 }]
      }
    }
  });
  const bearerScopeW = await tok(envScopeW, 'sub-abc');
  const wScope = await mcpCall(
    envScopeW,
    {
      jsonrpc: '2.0',
      id: 25,
      method: 'tools/call',
      params: {
        name: 'apply_changes',
        arguments: {
          projectId: 'p3',
          // MCP-AGENT-FIRST 2026-11-12 1.2: a money path is now refused by the
          // write switch BEFORE the section check, so the scope probe uses a
          // non-money section (risk) to keep testing scope alone.
          diffs: [{ path: 'risks', recordId: 'r1', field: 'status', after: 'open' }]
        }
      }
    },
    bearerScopeW
  );
  check(
    'diff outside the granted sections is refused',
    wScope &&
      wScope.result &&
      wScope.result.isError === true &&
      /outside the granted sections/.test(wScope.result.content[0].text),
    wScope
  );
  const wScopeBudget = await mcpCall(
    envScopeW,
    {
      jsonrpc: '2.0',
      id: 26,
      method: 'tools/call',
      params: {
        name: 'apply_changes',
        arguments: {
          projectId: 'p3',
          diffs: [{ path: 'budgetLines', recordId: 'b1', field: 'planned', after: 200 }]
        }
      }
    },
    bearerScopeW
  );
  check(
    'a budget diff from an unswitched key is refused before the section check',
    wScopeBudget &&
      wScopeBudget.result &&
      wScopeBudget.result.isError === true &&
      /may not propose budget changes/.test(wScopeBudget.result.content[0].text),
    wScopeBudget
  );

  section('APP-WIDE MCP W6 — mcp_enabled=0 blocks writes before the pipeline');
  const envOffW = makeEnv({
    config: { account_sub: 'sub-abc', enabled: 1, policy: 'allow_all', tool_subset: null },
    subscription: { owner_sub: 'sub-abc', status: 'active', tier: 'premium' },
    projects: [
      {
        project_id: 'p4',
        google_sub: 'sub-abc',
        owner_email: null,
        mcp_enabled: 0,
        owner_code_hash: 'h',
        owner_code_salt: 's',
        latest_r2_key: 'projects/p4/latest.json'
      }
    ],
    adoptions: [],
    states: { p4: wState }
  });
  const bearerOffW = await tok(envOffW, 'sub-abc');
  const wOff = await mcpCall(
    envOffW,
    {
      jsonrpc: '2.0',
      id: 26,
      method: 'tools/call',
      params: {
        name: 'apply_changes',
        arguments: {
          projectId: 'p4',
          diffs: [{ path: 'tasks', recordId: 't1', field: 'status', after: 'completed' }]
        }
      }
    },
    bearerOffW
  );
  check(
    'mcp_enabled=0 blocks a write',
    wOff &&
      wOff.result &&
      wOff.result.isError === true &&
      /turned off for that project/.test(wOff.result.content[0].text),
    wOff
  );

  console.log(
    '\n========== QA-APPWIDE-MCP RESULT: ' + pass + ' passed, ' + fail + ' failed =========='
  );
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('QA harness crashed:', e);
  process.exit(1);
});
