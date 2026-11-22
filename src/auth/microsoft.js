/* ============================================================
   MICROSOFT AUTH — "Sign in with Microsoft" for outlook.com,
   hotmail.com, live.com and Entra ID work/school accounts
   ------------------------------------------------------------
   Two routes, both GET, because the browser is redirected rather
   than posting a token the way Google Identity Services does:

     GET /api/auth/microsoft/start     -> 302 to login.microsoftonline.com
     GET /api/auth/callback/microsoft -> exchange the code, mint the
                                          same mmgr_session cookie

   WHY THE SERVER-SIDE CODE FLOW (and not a popup like Google):
   Google's popup hands the page an ID token, which the page POSTs to
   /api/auth/google. Microsoft's equivalent needs a JS library loaded from a
   third-party origin, a CSP script-src addition and a service-worker shell
   change on every page that shows a button. The redirect flow needs none of
   that: the page has a plain link, the Worker does the OAuth dance with the
   client secret it already holds, and the secret never reaches the browser.
   It also means signin.html keeps its "NO INLINE SCRIPT" property, so the
   CSP hash set is untouched by this feature.

   SECURITY SHAPE
   - state: 32 random bytes, HttpOnly cookie, constant-time compared.
   - PKCE S256: the verifier never leaves the HttpOnly cookie.
   - Cookies are Path=/api/auth so they are never sent to any page.
   - The ID token is validated for audience, issuer and expiry. Signature
     checking is deliberately omitted: OIDC Core 3.1.3.7 makes that check
     OPTIONAL when the ID token is received directly from the token endpoint
     over a TLS-encrypted connection, which is exactly this path, and the
     token is fetched with the client secret in the same request that
     presents the single-use code.
   - Nothing here trusts a query parameter to decide where to land: the
     return path is re-validated with the same rules as js/signin.js.
   ============================================================ */
import { codesEqual, sessionSetCookie } from '../lib/http.js';
import { mintSession } from './google.js';

// Public application (client) ID from the Azure app registration. Not a
// secret — it travels in the authorize URL and is visible in the browser.
// MICROSOFT_CLIENT_ID in wrangler.jsonc overrides this constant.
const DEFAULT_CLIENT_ID = 'd1bd5df2-946d-469e-a2d8-6656d2a63dae';

// "common" accepts both organisational (Entra ID) tenants and personal
// Microsoft accounts, which is the "all Microsoft account users" choice the
// owner made. A single-tenant app would set its directory GUID here instead.
const DEFAULT_TENANT = 'common';

const FLOW_COOKIE_PATH = '/api/auth';
const FLOW_TTL_S = 600; // 10 minutes: one consent screen and a redirect
const STATE_COOKIE = 'mmgr_ms_state';
const PKCE_COOKIE = 'mmgr_ms_pkce';
const NEXT_COOKIE = 'mmgr_ms_next';
const SCOPE = 'openid profile email';
const AUTHORITY = 'https://login.microsoftonline.com/';

// The return paths this file will redirect to. Mirrors js/signin.js safeNext:
// one leading slash, no protocol-relative form, no scheme, no backslash.
function safeNext(raw) {
  if (!raw) {
    return '';
  }
  const v = String(raw).replace(/[\u0000-\u001f\u007f\s]/g, '');
  if (!v || v.charAt(0) !== '/') {
    return '';
  }
  if (v.charAt(1) === '/' || v.charAt(1) === '\\') {
    return '';
  }
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(v)) {
    return '';
  }
  if (v.length > 512) {
    return '';
  }
  return v;
}

function microsoftConfig(env, request) {
  const clientId =
    env && typeof env.MICROSOFT_CLIENT_ID === 'string' && env.MICROSOFT_CLIENT_ID
      ? env.MICROSOFT_CLIENT_ID
      : DEFAULT_CLIENT_ID;
  const tenant =
    env && typeof env.MICROSOFT_TENANT === 'string' && env.MICROSOFT_TENANT
      ? env.MICROSOFT_TENANT
      : DEFAULT_TENANT;
  // OUTLOOK_LOGINVALUE is the name the owner originally stored the client
  // secret under. Reading both means the credential already in the Worker
  // works without a re-upload, and a future rename needs no code change.
  const clientSecret =
    (env && typeof env.MICROSOFT_CLIENT_SECRET === 'string' && env.MICROSOFT_CLIENT_SECRET) ||
    (env && typeof env.OUTLOOK_LOGINVALUE === 'string' && env.OUTLOOK_LOGINVALUE) ||
    '';
  const origin = new URL(request.url).origin;
  const redirectUri =
    env && typeof env.MICROSOFT_REDIRECT_URI === 'string' && env.MICROSOFT_REDIRECT_URI
      ? env.MICROSOFT_REDIRECT_URI
      : origin + '/api/auth/callback/microsoft';
  return { clientId, tenant, clientSecret, redirectUri };
}

function flowCookie(name, value, maxAge) {
  return (
    name +
    '=' +
    value +
    '; HttpOnly; Secure; SameSite=Lax; Path=' +
    FLOW_COOKIE_PATH +
    '; Max-Age=' +
    maxAge
  );
}

function readCookie(request, name) {
  const raw = request.headers.get('Cookie') || '';
  const parts = raw.split(';');
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const idx = part.indexOf('=');
    if (idx < 0) {
      continue;
    }
    if (part.slice(0, idx).trim() === name) {
      return part.slice(idx + 1).trim();
    }
  }
  return '';
}

function randomHex(bytes) {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    out += buf[i].toString(16).padStart(2, '0');
  }
  return out;
}

function base64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeJwtPayload(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || !parts[1]) {
    return null;
  }
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const parsed = JSON.parse(atob(padded));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) {
    return null;
  }
}

// A failed start or callback must never dump the provider's error text on the
// page: it can echo the client id or a redirect mismatch into the address bar.
// One short code, and the page says something plain.
function bounce(location, clearFlow) {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  if (clearFlow) {
    headers.append('Set-Cookie', flowCookie(STATE_COOKIE, '', 0));
    headers.append('Set-Cookie', flowCookie(PKCE_COOKIE, '', 0));
    headers.append('Set-Cookie', flowCookie(NEXT_COOKIE, '', 0));
  }
  return new Response(null, { status: 302, headers: headers });
}

function signInFailed(reason, _env) {
  // Logged for the operator, never shown to the visitor. A live provider
  // failure is otherwise a blind "it did not work".
  console.warn('microsoft sign-in refused: ' + reason);
  return bounce('/signin.html?microsoft=failed', true);
}

// GET /api/auth/microsoft/start?next=<same-site path>
export async function handleMicrosoftStart(request, env) {
  const cfg = microsoftConfig(env, request);
  if (!cfg.clientSecret) {
    console.warn('microsoft sign-in unavailable: provider not configured');
    return bounce('/signin.html?microsoft=unavailable', false);
  }
  const state = randomHex(32);
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = base64Url(new Uint8Array(digest));
  const next = safeNext(new URL(request.url).searchParams.get('next'));

  const authorize = new URL(AUTHORITY + encodeURIComponent(cfg.tenant) + '/oauth2/v2.0/authorize');
  authorize.searchParams.set('client_id', cfg.clientId);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('redirect_uri', cfg.redirectUri);
  authorize.searchParams.set('response_mode', 'query');
  authorize.searchParams.set('scope', SCOPE);
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('code_challenge', challenge);
  authorize.searchParams.set('code_challenge_method', 'S256');
  // Let someone with more than one Microsoft account pick which one; the
  // default would silently reuse the last session.
  authorize.searchParams.set('prompt', 'select_account');

  const headers = new Headers({
    Location: authorize.toString(),
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer'
  });
  headers.append('Set-Cookie', flowCookie(STATE_COOKIE, state, FLOW_TTL_S));
  headers.append('Set-Cookie', flowCookie(PKCE_COOKIE, verifier, FLOW_TTL_S));
  headers.append('Set-Cookie', flowCookie(NEXT_COOKIE, next, FLOW_TTL_S));
  return new Response(null, { status: 302, headers: headers });
}

// GET /api/auth/callback/microsoft?code=...&state=...
export async function handleMicrosoftCallback(request, env) {
  const url = new URL(request.url);
  const providerError = url.searchParams.get('error');
  if (providerError) {
    // User cancelled, or the tenant refused the account type. Both land on
    // the same plain page message; the console line names which.
    return signInFailed('provider_' + providerError, env);
  }
  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  const savedState = readCookie(request, STATE_COOKIE);
  const verifier = readCookie(request, PKCE_COOKIE);
  const next = safeNext(readCookie(request, NEXT_COOKIE));
  if (!code || !state || !savedState || !verifier) {
    return signInFailed('missing_code_or_flow_cookie', env);
  }
  if (!codesEqual(state, savedState)) {
    return signInFailed('state_mismatch', env);
  }

  const cfg = microsoftConfig(env, request);
  if (!cfg.clientSecret) {
    return signInFailed('no_client_secret', env);
  }

  let tokens;
  try {
    const res = await fetch(AUTHORITY + encodeURIComponent(cfg.tenant) + '/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        code: code,
        redirect_uri: cfg.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: verifier,
        scope: SCOPE
      }).toString()
    });
    tokens = await res.json();
    if (!res.ok) {
      // AADSTS error codes are the only way to diagnose a portal mismatch
      // (wrong platform type, redirect URI typo, unverified publisher). They
      // go to the log, not to the visitor.
      return signInFailed(
        'token_' + res.status + '_' + String((tokens && tokens.error) || ''),
        env
      );
    }
  } catch (e) {
    return signInFailed('token_unreachable', env);
  }

  const claims = decodeJwtPayload(tokens && tokens.id_token);
  if (!claims) {
    return signInFailed('id_token_shape', env);
  }
  if (String(claims.aud || '') !== cfg.clientId) {
    return signInFailed('audience', env);
  }
  const iss = String(claims.iss || '');
  if (
    !/^https:\/\/login\.microsoftonline\.com\/[^/]+\/v2\.0$/.test(iss) &&
    !/^https:\/\/sts\.windows\.net\/[^/]+\/$/.test(iss)
  ) {
    return signInFailed('issuer', env);
  }
  const exp = Number(claims.exp);
  if (!Number.isFinite(exp) || exp * 1000 <= Date.now()) {
    return signInFailed('expired', env);
  }
  const subject = String(claims.oid || claims.sub || '');
  if (!subject) {
    return signInFailed('no_subject', env);
  }
  // Personal accounts carry the address as preferred_username; work accounts
  // also carry email or upn. Any of the three identifies the same person.
  const email = String(claims.email || claims.preferred_username || claims.upn || '').trim();
  if (!email) {
    return signInFailed('no_email', env);
  }

  // Same session table, same cookie, same 7-day sliding renewal as Google:
  // the namespace prefix only keeps the two providers' subjects apart.
  const session = await mintSession(
    {
      sub: 'microsoft:' + subject,
      email: email,
      name: typeof claims.name === 'string' ? claims.name : '',
      picture: ''
    },
    env
  );

  const headers = new Headers({
    Location: next || '/app.html',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer'
  });
  headers.append('Set-Cookie', sessionSetCookie(session.token));
  headers.append('Set-Cookie', flowCookie(STATE_COOKIE, '', 0));
  headers.append('Set-Cookie', flowCookie(PKCE_COOKIE, '', 0));
  headers.append('Set-Cookie', flowCookie(NEXT_COOKIE, '', 0));
  return new Response(null, { status: 302, headers: headers });
}
