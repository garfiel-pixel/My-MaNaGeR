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
       O6  refresh keeps the same refresh token and extends its expiry
           (Gemini Persistent Linking, 2026-11-26)
       O7  RFC 8414 / RFC 9728 metadata documents carry required fields,
           offline_access and the revocation endpoint
       O8  consent page has NO inline <script> (CSP-safe)
       O13 the Google Gemini redirect host registers and authorizes, and a
           sibling redirect is still refused (exact-match boundary)
       O14 RFC 7009 revocation kills the access and refresh half
       O15 offline_access is accepted at authorize and echoed at token
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
       M12 create_project succeeds and never returns the owner code
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
  if (s.includes('cloud_projects') && s.includes('latest_r2_key')) {
    // OWNER 2026-11-17: create_project seeds the first snapshot and stamps
    // the key back onto the row.
    const row = store.cloud_projects.find(p => p.project_id === args[1]);
    if (row) {
      row.latest_r2_key = args[0];
    }
    return { meta: { changes: row ? 1 : 0 } };
  }
  if (s.includes('mcp_tokens')) {
    let row = null;
    const last = args[args.length - 1];
    // RFC 7009 revoke: either hash can name the row.
    if (s.includes('access_hash = ? or refresh_hash = ?')) {
      row = store.mcp_tokens.find(t => t.access_hash === args[0] || t.refresh_hash === args[1]);
      if (row) {
        row.revoked = 1;
      }
      return { meta: { changes: row ? 1 : 0 } };
    }
    // Persistent Linking (2026-11-26): the refresh keeps the row and renews
    // only the access half, so the refresh token never changes.
    if (s.includes('set access_hash = ?') && s.includes('refresh_expires_at = ?')) {
      row = store.mcp_tokens.find(t => t.token_id === last);
      if (row) {
        row.access_hash = args[0];
        row.expires_at = args[1];
        row.refresh_expires_at = args[2];
      }
      return { meta: { changes: row ? 1 : 0 } };
    }
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
      if (m && world.blobs && world.blobs[m[1]] !== undefined) {
        const blob = world.blobs[m[1]];
        return {
          async text() {
            return blob;
          }
        };
      }
      return null;
    },
    // OWNER 2026-11-17: a real put, so create_project's seeded snapshot is
    // stored exactly as the Worker would store it (encrypted when the row
    // carries a hash + salt).
    async put(key, payload, opts) {
      const m = /^projects\/([^/]+)\/latest\.json$/.exec(String(key || ''));
      if (!m) {
        throw new Error('unexpected R2 key ' + key);
      }
      if (
        opts &&
        opts.onlyIf &&
        opts.onlyIf.etagDoesNotMatch === '*' &&
        world.blobs &&
        world.blobs[m[1]] !== undefined
      ) {
        throw new Error('precondition failed');
      }
      world.blobs = world.blobs || {};
      world.blobs[m[1]] = String(payload);
      return {};
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

  section('MCP transport — the endpoint answers non-POST with 405, never 404');
  {
    // Live probe 2026-11-16: GET https://mymanagerworkspace.com/api/mcp answered
    // 404 because the router matched POST only, so a connector that probes the
    // URL for an SSE stream read it as "no MCP server here".
    const envM = makeEnv({ config: null, subscription: null, projects: [], adoptions: [] });
    for (const m of ['GET', 'DELETE']) {
      const res = await appwide.handleAppwideMcp(
        new Request('http://localhost/api/mcp', { method: m }),
        envM
      );
      const body = await res.json().catch(() => null);
      check(
        m + ' answers 405 with Allow: POST',
        res.status === 405 && (res.headers.get('allow') || '').toUpperCase() === 'POST',
        { status: res.status, allow: res.headers.get('allow') }
      );
      check(
        m + ' body is a JSON-RPC error a client can parse',
        !!body && body.jsonrpc === '2.0' && !!body.error && typeof body.error.message === 'string',
        body
      );
    }
  }

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

  section('OAUTH O6 — refresh keeps the link (Gemini Persistent Linking)');
  const envR = makeEnv({ config: null, subscription: null, projects: [], adoptions: [] });
  const issuedR = await oauth.issueTokens(envR, 'sub-abc', 'client-1', 'account offline_access');
  const rowR = envR.__store.mcp_tokens[0];
  // Move the refresh expiry close to now so the extension is measurable.
  rowR.refresh_expires_at = new Date(Date.now() + 60 * 1000).toISOString();
  const expiryBefore = new Date(rowR.refresh_expires_at).getTime();
  const refreshed = await oauth.refreshTokens(envR, issuedR.refreshToken, 'client-1');
  check(
    'refresh returns a new access token',
    refreshed.ok === true && refreshed.accessToken !== issuedR.accessToken,
    refreshed
  );
  check('refresh returns the SAME refresh token', refreshed.refreshToken === issuedR.refreshToken, {
    issued: issuedR.refreshToken,
    refreshed: refreshed.refreshToken
  });
  check(
    'refresh extends the refresh expiry',
    new Date(rowR.refresh_expires_at).getTime() > expiryBefore + 24 * 60 * 60 * 1000,
    { before: expiryBefore, after: rowR.refresh_expires_at }
  );
  check(
    'refresh does not add a token row',
    envR.__store.mcp_tokens.length === 1,
    envR.__store.mcp_tokens.length
  );
  check(
    'refresh echoes offline_access when it was granted',
    refreshed.scope === 'account offline_access',
    refreshed.scope
  );
  const newUsed = await oauth.verifyAccessToken(envR, refreshed.accessToken);
  check('the new access token verifies', newUsed && newUsed.accountSub === 'sub-abc', newUsed);
  const oldUsed = await oauth.verifyAccessToken(envR, issuedR.accessToken);
  check('the old access token stops working', oldUsed === null, oldUsed);
  const again = await oauth.refreshTokens(envR, issuedR.refreshToken, 'client-1');
  check(
    'a second refresh with the same token still works',
    again.ok === true && again.refreshToken === issuedR.refreshToken,
    again
  );

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
  check(
    'metadata advertises offline_access and a revocation endpoint',
    asMeta.scopes_supported.indexOf('offline_access') > -1 &&
      /\/api\/oauth\/revoke$/.test(asMeta.revocation_endpoint || ''),
    { scopes: asMeta.scopes_supported, revoke: asMeta.revocation_endpoint }
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

  section('OAUTH O13 — Google Gemini redirect (manual client registration)');
  const envG = makeEnv({ config: null, subscription: null, projects: [], adoptions: [] });
  const googleRedirect =
    'https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-f6492779cacd5f618adb99b9';
  const gRegRes = await oauth.handleOauthRegister(
    new Request('http://localhost/api/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Google Gemini',
        redirect_uris: [googleRedirect],
        token_endpoint_auth_method: 'none'
      })
    }),
    envG
  );
  const gReg = await gRegRes.json();
  check(
    'registration accepts the Google Gemini redirect',
    gRegRes.status === 201 && gReg.redirect_uris && gReg.redirect_uris[0] === googleRedirect,
    { status: gRegRes.status, gReg }
  );
  const gCookie = await sessionCookie(envG, 'sub-abc');
  function geminiAuthUrl(uri) {
    return new URL(
      'http://localhost/api/oauth/authorize?response_type=code&client_id=' +
        encodeURIComponent(gReg.client_id) +
        '&redirect_uri=' +
        encodeURIComponent(uri) +
        '&scope=' +
        encodeURIComponent('account offline_access') +
        '&code_challenge=' +
        challenge +
        '&code_challenge_method=S256&state=g1'
    );
  }
  const gUrl = geminiAuthUrl(googleRedirect);
  const gAuth = await oauth.handleOauthAuthorize(
    new Request(gUrl, { headers: { cookie: gCookie } }),
    envG,
    gUrl
  );
  const gConsent = await gAuth.text();
  // Assert the whole registered redirect arrives in the form field, which is
  // stronger than a host check and keeps the gate free of URL-substring logic.
  check(
    'authorize opens the consent page for the Google redirect',
    gAuth.status === 200 &&
      gConsent.indexOf('name="redirect_uri" value="' + googleRedirect + '"') > -1,
    gAuth.status
  );
  const siblingUrl = geminiAuthUrl(
    'https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-other'
  );
  const siblingAuth = await oauth.handleOauthAuthorize(
    new Request(siblingUrl, { headers: { cookie: gCookie } }),
    envG,
    siblingUrl
  );
  check(
    'a sibling Google redirect is refused (exact match, not a host wildcard)',
    siblingAuth.status === 400,
    siblingAuth.status
  );

  section('OAUTH O16 — Gemini dynamic registration (six URIs, client_secret_post)');
  const envGem = makeEnv({ config: null, subscription: null, projects: [], adoptions: [] });
  const geminiRedirects = [
    'https://oauth-redirect-sandbox.googleusercontent.com/r/user_bound_custom-mcp-f6492779cacd5f618adb99b9',
    'https://oauth-redirect-test.googleusercontent.com/r/user_bound_custom-mcp-f6492779cacd5f618adb99b9',
    googleRedirect,
    'https://oauth-redirect-sandbox.googleusercontent.com/a/user_bound_custom-mcp-f6492779cacd5f618adb99b9',
    'https://oauth-redirect-test.googleusercontent.com/a/user_bound_custom-mcp-f6492779cacd5f618adb99b9',
    'https://oauth-redirect.googleusercontent.com/a/user_bound_custom-mcp-f6492779cacd5f618adb99b9'
  ];
  const dcrRes = await oauth.handleOauthRegister(
    new Request('http://localhost/api/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Google',
        redirect_uris: geminiRedirects,
        response_types: ['code'],
        grant_types: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_method: 'client_secret_post'
      })
    }),
    envGem
  );
  const dcr = await dcrRes.json();
  check('Gemini DCR with six redirect URIs is accepted', dcrRes.status === 201, {
    status: dcrRes.status,
    dcr
  });
  check(
    'all six Google relay redirects are stored',
    Array.isArray(dcr.redirect_uris) && dcr.redirect_uris.length === 6,
    dcr.redirect_uris
  );
  check(
    'a client_secret_post request is answered as a public PKCE client',
    dcr.token_endpoint_auth_method === 'none' && !dcr.client_secret,
    dcr.token_endpoint_auth_method
  );
  check(
    'DCR advertises the offline scope Gemini asks for',
    String(dcr.scope || '').indexOf('offline_access') > -1,
    dcr.scope
  );
  const unsupportedRes = await oauth.handleOauthRegister(
    new Request('http://localhost/api/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'key client',
        redirect_uris: [googleRedirect],
        token_endpoint_auth_method: 'private_key_jwt'
      })
    }),
    envGem
  );
  check(
    'an unsupported auth method is still refused',
    unsupportedRes.status === 400,
    unsupportedRes.status
  );

  section('OAUTH O17 — Google relay approval uses a meta-refresh bridge');
  const gemCookie = await sessionCookie(envGem, 'sub-abc');
  const gemApprove = await oauth.handleOauthAuthorize(
    new Request('http://localhost/api/oauth/authorize', {
      method: 'POST',
      headers: { cookie: gemCookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        decision: 'approve',
        client_id: dcr.client_id,
        redirect_uri: googleRedirect,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state: 'g2'
      })
    }),
    envGem,
    new URL('http://localhost/api/oauth/authorize')
  );
  const gemBridge = await gemApprove.text();
  check(
    'Gemini approval answers 200, not a 302 the form-action check would cancel',
    gemApprove.status === 200 && !gemApprove.headers.get('location'),
    gemApprove.status
  );
  check(
    'the bridge page is uncached and carries a meta refresh with the code',
    gemApprove.headers.get('cache-control') === 'no-store' &&
      gemBridge.indexOf('http-equiv="refresh"') > -1 &&
      /[?&]code=/.test(gemBridge),
    { cache: gemApprove.headers.get('cache-control'), head: gemBridge.slice(0, 120) }
  );

  section('OAUTH O14 — RFC 7009 revocation');
  const envX = makeEnv({ config: null, subscription: null, projects: [], adoptions: [] });
  const issuedX = await oauth.issueTokens(envX, 'sub-abc', 'client-1');
  const revAccess = await oauth.handleOauthRevoke(
    new Request('http://localhost/api/oauth/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: issuedX.accessToken, token_type_hint: 'access_token' })
    }),
    envX
  );
  check('revoke answers 200', revAccess.status === 200, revAccess.status);
  check(
    'the revoked access token is refused',
    (await oauth.verifyAccessToken(envX, issuedX.accessToken)) === null,
    ''
  );
  const envY = makeEnv({ config: null, subscription: null, projects: [], adoptions: [] });
  const issuedY = await oauth.issueTokens(envY, 'sub-abc', 'client-1');
  await oauth.handleOauthRevoke(
    new Request('http://localhost/api/oauth/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: issuedY.refreshToken, token_type_hint: 'refresh_token' })
    }),
    envY
  );
  const afterRefreshRevoke = await oauth.refreshTokens(envY, issuedY.refreshToken, 'client-1');
  check(
    'a revoked refresh token cannot mint a new access token',
    afterRefreshRevoke.error === 'invalid_grant',
    afterRefreshRevoke
  );
  const revUnknown = await oauth.handleOauthRevoke(
    new Request('http://localhost/api/oauth/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'mmgr_at_not_a_real_token' })
    }),
    envY
  );
  check(
    'an unknown token still answers 200 (no existence oracle)',
    revUnknown.status === 200,
    revUnknown.status
  );

  section('OAUTH O15 — offline_access is granted and echoed');
  const envS = makeEnv({ config: null, subscription: null, projects: [], adoptions: [] });
  const codeS = await oauth.issueAuthCode(
    envS,
    'sub-abc',
    'client-1',
    challenge,
    'S256',
    'https://app/cb',
    'account offline_access'
  );
  const exS = await oauth.exchangeCode(envS, codeS, verifier, 'client-1', 'https://app/cb');
  check(
    'exchange grants account + offline_access',
    exS.ok === true && exS.scope === 'account offline_access',
    exS
  );

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
    'create_project returns projectId + status and NO ownerCode credential',
    createdJson &&
      createdJson.projectId === 'new-1' &&
      !Object.prototype.hasOwnProperty.call(createdJson, 'ownerCode') &&
      typeof createdJson.status === 'string',
    createdJson
  );
  // MCP-FINAL 2026-11-16 F1.6: the owner code is a full-access credential.
  // Assert on the raw text too, so a nested/renamed echo cannot slip through.
  check(
    'create_project text never mentions the owner code',
    createdText.length > 0 && createdText.toLowerCase().indexOf('ownercode') === -1,
    createdText
  );

  // OWNER 2026-11-17: an MCP-created project must OPEN like a normal one.
  // The create seeds the first snapshot from the app's own default state, so
  // assert the blob really is a project state (decrypted with the row's own
  // credentials) and not an empty placeholder.
  const seededRow = envCreate.__store.cloud_projects.find(p => p.project_id === 'new-1');
  const seededObj = await envCreate.R2.get('projects/new-1/latest.json');
  const seededText = seededObj ? await seededObj.text() : '';
  let seededState = null;
  try {
    const envelope = JSON.parse(seededText);
    const http = await import('../src/lib/http.js');
    seededState = await http.cloudDecryptState(
      envelope,
      seededRow && seededRow.owner_code_hash,
      seededRow && seededRow.owner_code_salt
    );
  } catch (e) {
    seededState = null;
  }
  check(
    'create_project seeds the first snapshot, so the launcher can open it',
    createdJson &&
      createdJson.hasSnapshot === true &&
      !!seededRow &&
      seededRow.latest_r2_key === 'projects/new-1/latest.json' &&
      !!seededState,
    { created: createdJson, key: seededRow && seededRow.latest_r2_key, has: !!seededState }
  );
  check(
    'the seeded snapshot is a real empty project state, named after the project',
    seededState &&
      seededState.projectId === 'new-1' &&
      seededState.charter &&
      seededState.charter.name === 'New Project' &&
      Array.isArray(seededState.tasks) &&
      typeof seededState.schemaVersion === 'number' &&
      seededState.schemaVersion > 0 &&
      seededState.revision === 1,
    seededState && {
      projectId: seededState.projectId,
      name: seededState.charter && seededState.charter.name,
      tasks: Array.isArray(seededState.tasks),
      schema: seededState.schemaVersion,
      revision: seededState.revision
    }
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
    'more than the plan per-call cap is refused with a cap message',
    wCap &&
      wCap.result &&
      wCap.result.isError === true &&
      /per call/.test(wCap.result.content[0].text) &&
      /contractor/.test(wCap.result.content[0].text),
    wCap
  );

  // F2: the app-wide surface applies the CONNECTING account's tier to the same
  // per-call cap, so the same 501-change call is refused at a different number
  // on a company plan than on contractor.
  const envCompany = makeEnv({
    config: { account_sub: 'sub-abc', enabled: 1, policy: 'allow_all', tool_subset: null },
    subscription: { owner_sub: 'sub-abc', status: 'active', tier: 'company' },
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
  const bearerCompany = await tok(envCompany, 'sub-abc');
  const wCapCompany = await mcpCall(
    envCompany,
    {
      jsonrpc: '2.0',
      id: 231,
      method: 'tools/call',
      params: { name: 'apply_changes', arguments: { projectId: 'p1', diffs: tooMany } }
    },
    bearerCompany
  );
  check(
    'a company plan raises the app-wide per-call cap to 500',
    wCapCompany &&
      wCapCompany.result &&
      wCapCompany.result.isError === true &&
      /company plan allows 500/.test(wCapCompany.result.content[0].text),
    wCapCompany && wCapCompany.result && wCapCompany.result.content[0].text
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

  // MCP-AGENT-FIRST 5.1 AT11: the app-wide surface must apply the SAME section
  // gate to reads as the per-project surface. The member holds wbs only, so the
  // task reader answers and every other section reader refuses.
  const READ_PROBES = [
    { name: 'get_tasks', wantRefused: false },
    { name: 'get_risks', wantRefused: true },
    { name: 'get_budget', wantRefused: true },
    { name: 'get_meetings', wantRefused: true }
  ];
  for (let rp = 0; rp < READ_PROBES.length; rp++) {
    const probe = READ_PROBES[rp];
    const res = await mcpCall(
      envScopeW,
      {
        jsonrpc: '2.0',
        id: 270 + rp,
        method: 'tools/call',
        params: { name: probe.name, arguments: { projectId: 'p3' } }
      },
      bearerScopeW
    );
    const refused = !!(res && res.result && res.result.isError === true);
    check(
      'W5b ' +
        probe.name +
        ' ' +
        (probe.wantRefused ? 'refuses' : 'answers') +
        ' on the wbs-only member',
      refused === probe.wantRefused,
      res
    );
  }

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
