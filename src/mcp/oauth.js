/* ============================================================
   MCP OAUTH AUTHORIZATION SERVER (app-wide MCP, Wave 1)
   ------------------------------------------------------------
   A focused, self-contained OAuth 2.1 authorization server that lets an
   external AI client (Claude, ChatGPT, a terminal) connect to the app-wide
   MCP endpoint and authorize on a web page, reusing the site's existing
   Google sign-in session as the identity behind /authorize.

   It is the smallest-footprint path: no extra Worker, no Durable Object,
   no third-party OAuth package. State lives in D1 (migration 0037).
   Clients are PUBLIC (no secret) and use PKCE only, so there is nothing
   to leak. Bearer tokens are opaque; only their SHA-256 is stored.

   Spec alignment:
     - Authorization Server Metadata (RFC 8414)
     - Protected Resource Metadata (RFC 9728) - how clients discover the AS
     - PKCE (RFC 7636), S256
     - Dynamic Client Registration (RFC 7591)
   ============================================================ */
import { json, cloudForbidden, readSession } from '../lib/http.js';

const ACCESS_TTL_MS = 60 * 60 * 1000; // 1 hour
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function randomHex(bytes) {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    out += buf[i].toString(16).padStart(2, '0');
  }
  return out;
}

async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map(b => b.toString(16).padStart(2, '0')).join('');
}

// S256 PKCE challenge from a verifier.
export async function pkceChallenge(verifier) {
  return sha256Hex(verifier);
}

function isoIn(ms) {
  return new Date(Date.now() + ms).toISOString();
}

// ---- Token issue / verify ----------------------------------------------

export async function issueTokens(env, accountSub, clientId) {
  const tokenId = randomHex(16);
  const accessToken = 'mmgr_at_' + randomHex(24);
  const refreshToken = 'mmgr_rt_' + randomHex(24);
  const accessHash = await sha256Hex(accessToken);
  const refreshHash = await sha256Hex(refreshToken);
  const now = new Date().toISOString();
  await env.DB.prepare(
    'INSERT INTO mcp_tokens (token_id, account_sub, client_id, access_hash, refresh_hash, scope, expires_at, refresh_expires_at, revoked) VALUES (?,?,?,?,?,?,?,?,0)'
  )
    .bind(
      tokenId,
      accountSub,
      clientId,
      accessHash,
      refreshHash,
      'account',
      isoIn(ACCESS_TTL_MS),
      isoIn(REFRESH_TTL_MS)
    )
    .run();
  return { accessToken, refreshToken, expiresAt: isoIn(ACCESS_TTL_MS) };
}

export async function verifyAccessToken(env, bearer) {
  if (!bearer || typeof bearer !== 'string' || bearer.length < 12) {
    return null;
  }
  const accessHash = await sha256Hex(bearer);
  const row = await env.DB.prepare(
    'SELECT token_id, account_sub, client_id, expires_at, revoked FROM mcp_tokens WHERE access_hash = ?'
  )
    .bind(accessHash)
    .first();
  if (!row) {
    return null;
  }
  if (row.revoked === 1 || new Date(row.expires_at).getTime() <= Date.now()) {
    return null;
  }
  // Best-effort: record client use.
  try {
    await env.DB.prepare('UPDATE mcp_clients SET last_used_at = ? WHERE client_id = ?')
      .bind(new Date().toISOString(), row.client_id)
      .run();
  } catch (e) {
    /* non-fatal */
  }
  return { accountSub: row.account_sub, clientId: row.client_id };
}

// ---- Authorization code flow (PKCE) -------------------------------------

export async function issueAuthCode(env, accountSub, clientId, challenge, method, redirectUri) {
  const code = 'mmgr_ac_' + randomHex(20);
  const now = new Date().toISOString();
  await env.DB.prepare(
    'INSERT INTO mcp_auth_codes (code, account_sub, client_id, code_challenge, code_challenge_method, redirect_uri, scope, created_at, expires_at, consumed) VALUES (?,?,?,?,?,?,?,?,?,0)'
  )
    .bind(
      code,
      accountSub,
      clientId,
      challenge,
      method || 'S256',
      redirectUri || '',
      'account',
      now,
      isoIn(CODE_TTL_MS)
    )
    .run();
  return code;
}

export async function exchangeCode(env, code, codeVerifier, clientId, redirectUri) {
  if (!code || !codeVerifier) {
    return { error: 'invalid_request' };
  }
  const row = await env.DB.prepare(
    'SELECT code, account_sub, client_id, code_challenge, code_challenge_method, redirect_uri, expires_at, consumed FROM mcp_auth_codes WHERE code = ?'
  )
    .bind(code)
    .first();
  if (!row) {
    return { error: 'invalid_grant', error_description: 'unknown or expired code' };
  }
  if (row.consumed === 1 || new Date(row.expires_at).getTime() <= Date.now()) {
    return { error: 'invalid_grant', error_description: 'code already used or expired' };
  }
  if (row.client_id !== clientId) {
    return { error: 'invalid_grant', error_description: 'client mismatch' };
  }
  if (redirectUri && row.redirect_uri && row.redirect_uri !== redirectUri) {
    return { error: 'invalid_grant', error_description: 'redirect_uri mismatch' };
  }
  const expected = await pkceChallenge(codeVerifier);
  if (expected !== row.code_challenge) {
    return { error: 'invalid_grant', error_description: 'PKCE verification failed' };
  }
  // Single use.
  await env.DB.prepare('UPDATE mcp_auth_codes SET consumed = 1 WHERE code = ?').bind(code).run();
  const tokens = await issueTokens(env, row.account_sub, clientId);
  return {
    ok: true,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt
  };
}

export async function refreshTokens(env, refreshToken, clientId) {
  if (!refreshToken) {
    return { error: 'invalid_request' };
  }
  const refreshHash = await sha256Hex(refreshToken);
  const row = await env.DB.prepare(
    'SELECT token_id, account_sub, client_id, refresh_expires_at, revoked FROM mcp_tokens WHERE refresh_hash = ?'
  )
    .bind(refreshHash)
    .first();
  if (!row || row.client_id !== clientId) {
    return { error: 'invalid_grant' };
  }
  if (row.revoked === 1 || new Date(row.refresh_expires_at).getTime() <= Date.now()) {
    return { error: 'invalid_grant' };
  }
  // Rotate: revoke the old token row, issue a fresh pair.
  await env.DB.prepare('UPDATE mcp_tokens SET revoked = 1 WHERE token_id = ?')
    .bind(row.token_id)
    .run();
  const tokens = await issueTokens(env, row.account_sub, clientId);
  return {
    ok: true,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt
  };
}

// ---- Dynamic Client Registration (RFC 7591) -----------------------------

export async function registerClient(env, accountSub, name) {
  const clientId = 'mmgr_mc_' + randomHex(12);
  const now = new Date().toISOString();
  await env.DB.prepare(
    'INSERT INTO mcp_clients (client_id, account_sub, name, created_at, revoked) VALUES (?,?,?,?,0)'
  )
    .bind(clientId, accountSub, (name || 'MCP client').slice(0, 120), now)
    .run();
  return { clientId, name: name || 'MCP client', token_endpoint_auth_method: 'none' };
}

export async function revokeClient(env, accountSub, clientId) {
  const res = await env.DB.prepare(
    'UPDATE mcp_clients SET revoked = 1 WHERE client_id = ? AND account_sub = ? AND revoked = 0'
  )
    .bind(clientId, accountSub)
    .run();
  // Also revoke any live tokens for that client.
  try {
    await env.DB.prepare(
      'UPDATE mcp_tokens SET revoked = 1 WHERE client_id = ? AND account_sub = ?'
    )
      .bind(clientId, accountSub)
      .run();
  } catch (e) {
    /* non-fatal */
  }
  return { ok: true, revoked: !!(res.meta && res.meta.changes) };
}

export async function listClients(env, accountSub) {
  const rows = await env.DB.prepare(
    'SELECT client_id, name, created_at, last_used_at, revoked FROM mcp_clients WHERE account_sub = ? ORDER BY created_at DESC'
  )
    .bind(accountSub)
    .all();
  return (rows.results || []).map(function (r) {
    return {
      clientId: r.client_id,
      name: r.name,
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
      revoked: r.revoked === 1
    };
  });
}

// ---- Metadata (RFC 8414 / RFC 9728) -------------------------------------

export function authorizationServerMetadata(origin) {
  return {
    issuer: origin,
    authorization_endpoint: origin + '/api/oauth/authorize',
    token_endpoint: origin + '/api/oauth/token',
    registration_endpoint: origin + '/api/oauth/register',
    scopes_supported: ['account'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    subject_types_supported: ['public']
  };
}

export function protectedResourceMetadata(origin) {
  return {
    resource: origin + '/api/mcp',
    authorization_servers: [origin],
    scopes_supported: ['account']
  };
}

// ---- Consent page (no inline script, CSP-safe form) ----------------------

export function renderConsentHtml(params) {
  const hidden = [
    'response_type',
    'client_id',
    'redirect_uri',
    'scope',
    'state',
    'code_challenge',
    'code_challenge_method'
  ]
    .map(function (k) {
      const v = params[k] || '';
      return '<input type="hidden" name="' + k + '" value="' + v.replace(/"/g, '&quot;') + '">';
    })
    .join('');
  const clientName = (params.client_id || 'this application').replace(/</g, '&lt;');
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Authorize MCP access | My MaNaGeR</title>' +
    '<style>html{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}' +
    'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F5EFE6;color:#1C1917}' +
    'main{max-width:30rem;padding:2rem;text-align:center}' +
    'h1{font-size:1.25rem;margin:0 0 .75rem}p{color:#57606a;line-height:1.6;margin:0 0 1.25rem}' +
    '.btn{border:0;border-radius:.5rem;padding:.6rem 1.1rem;font-size:.95rem;font-weight:600;cursor:pointer;margin:.25rem}' +
    '.allow{background:#B45309;color:#fff}.deny{background:#E7DDD0;color:#1C1917}</style></head>' +
    '<body><main><h1>Connect My MaNaGeR to ' +
    clientName +
    '</h1>' +
    '<p>This application is asking to connect to your My MaNaGeR account through MCP. It will be able to read and act on the projects you choose, under the controls you set in the admin panel. It cannot open the admin panel.</p>' +
    '<form method="post" action="/api/oauth/authorize">' +
    hidden +
    '<button type="submit" class="btn allow" name="decision" value="approve">Allow</button>' +
    '<button type="submit" class="btn deny" name="decision" value="deny">Deny</button>' +
    '</form></main></body></html>'
  );
}

// ---- RFC 9728 / RFC 8414 metadata endpoints -------------------------------

export async function handleOauthMetadata(request, env, url) {
  const origin = url.origin;
  const path = url.pathname;
  if (path === '/.well-known/oauth-authorization-server') {
    return json(authorizationServerMetadata(origin), 200);
  }
  if (path === '/.well-known/oauth-protected-resource') {
    return json(protectedResourceMetadata(origin), 200);
  }
  return json({ error: 'not found' }, 404);
}

// ---- Authorization endpoint (human consent, browser) -----------------------

async function readForm(request) {
  const ct = (request.headers.get('content-type') || '').toLowerCase();
  try {
    if (ct.indexOf('application/json') === 0) {
      return await request.json();
    }
    if (request.formData) {
      const fd = await request.formData();
      const out = {};
      for (const k of fd.keys()) {
        out[k] = fd.get(k);
      }
      return out;
    }
  } catch (e) {
    /* fall through to empty */
  }
  return {};
}

export async function handleOauthAuthorize(request, env, url) {
  const session = await readSession(request, env);
  if (!session || !session.sub) {
    // No signed-in human: the consent page cannot know who is authorising.
    // Tell them to sign in to the same origin first, then reconnect.
    return new Response(
      '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
        '<title>Sign in required | My MaNaGeR</title></head>' +
        '<body style="font-family:system-ui,Arial,sans-serif;text-align:center;padding:3rem">' +
        '<h1>Sign in to My MaNaGeR first</h1>' +
        '<p>You need to be signed in to the same My MaNaGeR account before you can ' +
        'connect an AI client through MCP. Sign in, then start the connection again.</p>' +
        '</body></html>',
      { status: 401, headers: { 'content-type': 'text/html; charset=utf-8' } }
    );
  }

  if (request.method === 'GET') {
    const params = url.searchParams;
    const clientId = params.get('client_id') || '';
    const redirectUri = params.get('redirect_uri') || '';
    const codeChallenge = params.get('code_challenge') || '';
    const codeChallengeMethod = params.get('code_challenge_method') || 'S256';
    const scope = params.get('scope') || 'account';
    const state = params.get('state') || '';
    if (!clientId || !redirectUri || !codeChallenge) {
      return new Response('Missing required OAuth parameters.', { status: 400 });
    }
    // Surface the client name if we know it (best effort, non-fatal).
    let clientName = clientId;
    try {
      const c = await env.DB.prepare('SELECT name FROM mcp_clients WHERE client_id = ?')
        .bind(clientId)
        .first();
      if (c && c.name) {
        clientName = c.name;
      }
    } catch (e) {
      /* non-fatal */
    }
    return new Response(
      renderConsentHtml({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: scope,
        state: state,
        code_challenge: codeChallenge,
        code_challenge_method: codeChallengeMethod
      }).replace('this application', clientName),
      { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }
    );
  }

  if (request.method === 'POST') {
    const form = await readForm(request);
    const decision = form.decision;
    const redirectUri = form.redirect_uri || '';
    const state = form.state || '';
    if (decision !== 'approve') {
      const denyUrl =
        redirectUri +
        (redirectUri.indexOf('?') > -1 ? '&' : '?') +
        'error=access_denied' +
        (state ? '&state=' + encodeURIComponent(state) : '');
      return Response.redirect(denyUrl, 302);
    }
    const code = await issueAuthCode(
      env,
      session.sub,
      form.client_id || '',
      form.code_challenge || '',
      form.code_challenge_method || 'S256',
      redirectUri
    );
    const okUrl =
      redirectUri +
      (redirectUri.indexOf('?') > -1 ? '&' : '?') +
      'code=' +
      encodeURIComponent(code) +
      (state ? '&state=' + encodeURIComponent(state) : '');
    return Response.redirect(okUrl, 302);
  }

  return new Response('Method not allowed', { status: 405 });
}

// ---- Token endpoint --------------------------------------------------------

export async function handleOauthToken(request, env) {
  const form = await readForm(request);
  const grantType = form.grant_type;
  if (grantType === 'authorization_code') {
    const res = await exchangeCode(
      env,
      form.code || '',
      form.code_verifier || '',
      form.client_id || '',
      form.redirect_uri || ''
    );
    if (res.error) {
      return json({ error: res.error, error_description: res.error_description || '' }, 400);
    }
    return json(
      {
        access_token: res.accessToken,
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: res.refreshToken,
        scope: 'account'
      },
      200
    );
  }
  if (grantType === 'refresh_token') {
    const res = await refreshTokens(env, form.refresh_token || '', form.client_id || '');
    if (res.error) {
      return json({ error: res.error }, 400);
    }
    return json(
      {
        access_token: res.accessToken,
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: res.refreshToken,
        scope: 'account'
      },
      200
    );
  }
  return json({ error: 'unsupported_grant_type' }, 400);
}

// ---- Dynamic Client Registration (RFC 7591) -------------------------------
// Account-bound: the admin panel calls this while signed in, so the new client
// is tied to the connecting account from the start. Open DCR without an account
// is intentionally not offered.

export async function handleOauthRegister(request, env) {
  const session = await readSession(request, env);
  if (!session || !session.sub) {
    return json({ error: 'unauthorized', error_description: 'sign in to register a client' }, 401);
  }
  const body = await readForm(request);
  const name = typeof body.client_name === 'string' ? body.client_name : null;
  const client = await registerClient(env, session.sub, name);
  return json(
    {
      client_id: client.clientId,
      client_name: client.name,
      token_endpoint_auth_method: client.token_endpoint_auth_method,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: 'account'
    },
    201
  );
}
