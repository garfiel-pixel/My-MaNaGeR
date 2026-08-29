/* ============================================================
   GOOGLE AUTH — Google Identity Services sign-in, session
   minting, session check, logout
   ------------------------------------------------------------
   Extracted from worker.js handleApi. Handles:
     POST /api/auth/google   — verify ID token, mint session
     GET  /api/auth/me       — check session, lazy renewal
     POST /api/auth/logout   — revoke + clear cookie
     POST /api/auth/logout-all — revoke all sessions
   ============================================================ */
import { json, readSession, signSession, sessionKey, sessionSetCookie,
  SESSION_COOKIE, SESSION_MAX_AGE } from '../lib/http.js';

// Public Client ID (safe to ship — also embedded in the frontend).
// Prefers env.GOOGLE_CLIENT_ID when set in wrangler.jsonc.
const GOOGLE_CLIENT_ID = '297970704704-m05hgt93lfaq286q90br8c96ffg1aph3.apps.googleusercontent.com';

// AUTH-MAINFRAME: lazy sliding renewal + server-side revocation constants.
const SESSION_RENEW_AFTER_MS = 86400000;        // re-issue when 24h old
const SESSION_ABSOLUTE_CAP = 30 * 24 * 60 * 60; // 30 days, seconds

// Verify a Google ID token with oauth2.googleapis.com/tokeninfo.
async function verifyGoogleIdToken(idToken, clientId) {
  let payload;
  try {
    const res = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken));
    if (!res.ok) return null;
    payload = await res.json();
  } catch (e) { return null; }
  if (!payload || typeof payload !== 'object') return null;
  if (payload.aud !== clientId) return null;
  const iss = String(payload.iss || '');
  if (iss !== 'accounts.google.com' && iss !== 'https://accounts.google.com') return null;
  const exp = Number(payload.exp);
  if (!Number.isFinite(exp) || exp * 1000 <= Date.now()) return null;
  const sub = payload.sub ? String(payload.sub) : '';
  if (!sub) return null;
  return {
    sub: sub,
    email: typeof payload.email === 'string' ? payload.email : '',
    name: typeof payload.name === 'string' ? payload.name : '',
    picture: typeof payload.picture === 'string' ? payload.picture : ''
  };
}

// AUTH-MAINFRAME: mint a session — random jti, issued-at, 7-day expiry —
// record it in auth_sessions (so it can be revoked) and return the token.
// A failed D1 write must never block sign-in; revocation then lapses to
// expiry-based expiry only (the cookie is still HMAC-signed).
export async function mintSession(user, env) {
  const nowSec = Math.floor(Date.now() / 1000);
  const exp = nowSec + SESSION_MAX_AGE;
  const jti = crypto.randomUUID();
  const payload = { sub: user.sub, email: user.email, name: user.name, picture: user.picture, jti: jti, iat: nowSec, exp: exp };
  const token = await signSession(payload, await sessionKey(env));
  try {
    await env.DB.prepare('INSERT INTO auth_sessions (jti, sub, created_at, expires_at) VALUES (?,?,?,?)')
      .bind(jti, user.sub, new Date(nowSec * 1000).toISOString(), new Date(exp * 1000).toISOString()).run();
  } catch (e) { /* best-effort — see comment above */ }
  return { token: token, payload: payload };
}

// POST /api/auth/google { idToken } -> verify -> Set-Cookie mmgr_session
export async function handleAuthGoogle(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'bad request' }, 400); }
  const idToken = body && typeof body.idToken === 'string' ? body.idToken : '';
  if (!idToken) return json({ ok: false, error: 'missing id_token' }, 400);
  const clientId = env && typeof env.GOOGLE_CLIENT_ID === 'string' && env.GOOGLE_CLIENT_ID
    ? env.GOOGLE_CLIENT_ID : GOOGLE_CLIENT_ID;
  const user = await verifyGoogleIdToken(idToken, clientId);
  if (!user) return json({ ok: false, error: 'invalid token' }, 401);
  const s = await mintSession(user, env);
  return new Response(JSON.stringify({ ok: true, user }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Set-Cookie': sessionSetCookie(s.token)
    }
  });
}

// GET /api/auth/me -> { ok:true, user } when a valid session cookie exists
export async function handleAuthMe(request, env) {
  const session = await readSession(request, env);
  if (!session) return json({ ok: false, user: null });
  // AUTH-MAINFRAME lazy sliding renewal: re-issue the cookie when the
  // session is older than the renew window (or is a pre-table cookie
  // carrying no jti/iat), bounded by the absolute cap. Same jti, fresh
  // expiry — the revocation row is kept and its expiry bumped.
  const iat = Number(session.iat) || 0;
  const age = iat ? Date.now() - iat * 1000 : SESSION_RENEW_AFTER_MS + 1;
  const absCapMs = iat ? (iat + SESSION_ABSOLUTE_CAP) * 1000 : Date.now();
  if (age > SESSION_RENEW_AFTER_MS && Date.now() < absCapMs) {
    const nowSec = Math.floor(Date.now() / 1000);
    const exp = Math.min(nowSec + SESSION_MAX_AGE, iat + SESSION_ABSOLUTE_CAP);
    const jti = session.jti || crypto.randomUUID();
    const refreshed = await signSession(
      { sub: session.sub, email: session.email, name: session.name, picture: session.picture, jti: jti, iat: nowSec, exp: exp },
      await sessionKey(env)
    );
    try {
      if (session.jti) {
        await env.DB.prepare('UPDATE auth_sessions SET expires_at = ? WHERE jti = ?')
          .bind(new Date(exp * 1000).toISOString(), session.jti).run();
      } else {
        await env.DB.prepare('INSERT INTO auth_sessions (jti, sub, created_at, expires_at) VALUES (?,?,?,?)')
          .bind(jti, session.sub, new Date().toISOString(), new Date(exp * 1000).toISOString()).run();
      }
    } catch (e) { /* renewal bookkeeping is best-effort */ }
    return new Response(JSON.stringify({ ok: true, user: { sub: session.sub, email: session.email, name: session.name, picture: session.picture } }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Set-Cookie': sessionSetCookie(refreshed)
      }
    });
  }
  return json({ ok: true, user: { sub: session.sub, email: session.email, name: session.name, picture: session.picture } });
}

// POST /api/auth/logout -> clear the session cookie
export async function handleAuthLogout(request, env) {
  const sfs = request.headers.get('Sec-Fetch-Site');
  if (sfs && sfs !== 'same-origin' && sfs !== 'none') {
    return json({ ok: false, error: 'forbidden' }, 403);
  }
  const sess = await readSession(request, env);
  if (sess && sess.jti) {
    try {
      await env.DB.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE jti = ?')
        .bind(new Date().toISOString(), sess.jti).run();
      if (env.KV) {
        try { await env.KV.put('sess:' + sess.jti, 'revoked', { expirationTtl: 300 }); } catch (e) {}
      }
    } catch (e) { /* best-effort */ }
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Set-Cookie': SESSION_COOKIE + '=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'
    }
  });
}

// POST /api/auth/logout-all -> revoke EVERY session for the account
export async function handleAuthLogoutAll(request, env) {
  const sfs = request.headers.get('Sec-Fetch-Site');
  if (sfs && sfs !== 'same-origin' && sfs !== 'none') {
    return json({ ok: false, error: 'forbidden' }, 403);
  }
  const sess = await readSession(request, env);
  if (sess && sess.sub) {
    try {
      const toRevoke = await env.DB.prepare('SELECT jti FROM auth_sessions WHERE sub = ? AND revoked_at IS NULL')
        .bind(sess.sub).all();
      await env.DB.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE sub = ? AND revoked_at IS NULL')
        .bind(new Date().toISOString(), sess.sub).run();
      if (env.KV && toRevoke.results) {
        for (const r of toRevoke.results) {
          try { await env.KV.put('sess:' + r.jti, 'revoked', { expirationTtl: 300 }); } catch (e) {}
        }
      }
    } catch (e) { /* best-effort */ }
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Set-Cookie': SESSION_COOKIE + '=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'
    }
  });
}
