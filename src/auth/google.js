/* ============================================================
   GOOGLE AUTH — Google Identity Services sign-in, session
   minting, session check, logout
   ------------------------------------------------------------
   Extracted from worker.js handleApi. Handles:
     POST /api/auth/google   — verify ID token, mint session
     GET  /api/auth/nonce    - mint a single-use sign-in nonce (G-2)
     GET  /api/auth/me       — check session, lazy renewal
     POST /api/auth/logout   — revoke + clear cookie
     POST /api/auth/logout-all — revoke all sessions
   ============================================================ */
import {
  json,
  readSession,
  signSession,
  sessionKey,
  sessionSetCookie,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  readJsonBody
} from '../lib/http.js';

// Public Client ID (safe to ship — also embedded in the frontend).
// Prefers env.GOOGLE_CLIENT_ID when set in wrangler.jsonc.
const GOOGLE_CLIENT_ID = '297970704704-m05hgt93lfaq286q90br8c96ffg1aph3.apps.googleusercontent.com';

// AUTH-MAINFRAME: lazy sliding renewal + server-side revocation constants.
const SESSION_RENEW_AFTER_MS = 86400000; // re-issue when 24h old
const SESSION_ABSOLUTE_CAP = 30 * 24 * 60 * 60; // 30 days, seconds

// G-2 (2026-10-23): sign-in nonce constants. A nonce lives 5 minutes
// (GIS button sessions are short; a long TTL just widens the replay
// window) and is single-use, consumed by the atomic DELETE in
// consumeSignInNonce.
const NONCE_TTL_MS = 5 * 60 * 1000;
const NONCE_RE = /^[0-9a-f]{32,128}$/;
const BODY_CAP = 16384; // T-5: an ID token JWT is a few KB; headroom over it

// Rollout flag (DIRECTIVE G-2.5, default OFF): while off, a request with NO
// nonce still signs in (a cached old page keeps working) but a request that
// HAS a nonce must pass every check. Flip the GOOGLE_NONCE_REQUIRED worker
// var on once the fleet has re-fetched, and a nonceless sign-in is refused.
export function googleNonceRequired(env) {
  const v = env && env.GOOGLE_NONCE_REQUIRED;
  return v === true || v === '1' || v === 'true' || v === 'on';
}

async function sha256Hex(text) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const bytes = new Uint8Array(hash);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

// GET /api/auth/nonce - mint a single-use sign-in nonce. Stores only the
// SHA-256 hash, never the nonce. Best-effort on the D1 write: if the row
// cannot be stored we answer 503 rather than a nonce that could never
// validate (the client then signs in without one, which the flag-off server
// still accepts), and the router's rate bucket caps the churn.
export async function handleAuthNonce(request, env) {
  const sfs = request.headers.get('Sec-Fetch-Site');
  if (sfs && sfs !== 'same-origin' && sfs !== 'none') {
    return json({ ok: false, error: 'forbidden' }, 403);
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let nonce = '';
  for (let i = 0; i < bytes.length; i++) {
    nonce += bytes[i].toString(16).padStart(2, '0');
  }
  const now = Date.now();
  try {
    await env.DB.prepare(
      'INSERT INTO auth_nonces (nonce_hash, created_at, expires_at) VALUES (?,?,?)'
    )
      .bind(
        await sha256Hex(nonce),
        new Date(now).toISOString(),
        new Date(now + NONCE_TTL_MS).toISOString()
      )
      .run();
  } catch (e) {
    return json({ ok: false, error: 'nonce unavailable, try again' }, 503);
  }
  return new Response(JSON.stringify({ ok: true, nonce: nonce }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

// Consume a posted nonce: the row must exist, be unexpired and unused, and
// the atomic DELETE (changes === 1) makes it single-use even under racing
// replays. Any D1 failure is a refusal: a nonce that cannot be proven live
// must fail closed.
async function consumeSignInNonce(env, nonce) {
  try {
    const res = await env.DB.prepare(
      'DELETE FROM auth_nonces WHERE nonce_hash = ? AND expires_at > ?'
    )
      .bind(await sha256Hex(nonce), new Date().toISOString())
      .run();
    return !!(res && res.meta && res.meta.changes === 1);
  } catch (e) {
    return false;
  }
}

// Verify a Google ID token with oauth2.googleapis.com/tokeninfo.
// G-2 (2026-10-23): also enforces email_verified and the sign-in nonce
// contract. nonce/env are optional so legacy call shapes keep working.
async function verifyGoogleIdToken(idToken, clientId, nonce, env) {
  let payload;
  try {
    const res = await fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken)
    );
    if (!res.ok) {
      return null;
    }
    payload = await res.json();
  } catch (e) {
    return null;
  }
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  if (payload.aud !== clientId) {
    return null;
  }
  const iss = String(payload.iss || '');
  if (iss !== 'accounts.google.com' && iss !== 'https://accounts.google.com') {
    return null;
  }
  const exp = Number(payload.exp);
  if (!Number.isFinite(exp) || exp * 1000 <= Date.now()) {
    return null;
  }
  const sub = payload.sub ? String(payload.sub) : '';
  if (!sub) {
    return null;
  }
  // G-2.4: an unverified (or silently absent) email claim is not an identity
  // this app will mint a session for.
  if (payload.email_verified !== true) {
    return null;
  }
  // G-2.3: nonce contract. No nonce posted + flag off -> legacy path (a
  // cached old page keeps signing in). Anything else must fully prove: the
  // token's own nonce claim must equal the posted nonce, and the posted
  // nonce must consume a live single-use row (single statement, race-safe).
  const postNonce = typeof nonce === 'string' && NONCE_RE.test(nonce) ? nonce : '';
  if (!postNonce) {
    if (googleNonceRequired(env)) {
      return null;
    }
    return {
      sub: sub,
      email: typeof payload.email === 'string' ? payload.email : '',
      name: typeof payload.name === 'string' ? payload.name : '',
      picture: typeof payload.picture === 'string' ? payload.picture : ''
    };
  }
  if (typeof payload.nonce !== 'string' || payload.nonce !== postNonce) {
    return null;
  }
  if (!(await consumeSignInNonce(env, postNonce))) {
    return null;
  }
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
  const payload = {
    sub: user.sub,
    email: user.email,
    name: user.name,
    picture: user.picture,
    jti: jti,
    iat: nowSec,
    exp: exp
  };
  const token = await signSession(payload, await sessionKey(env));
  try {
    await env.DB.prepare(
      'INSERT INTO auth_sessions (jti, sub, created_at, expires_at) VALUES (?,?,?,?)'
    )
      .bind(
        jti,
        user.sub,
        new Date(nowSec * 1000).toISOString(),
        new Date(exp * 1000).toISOString()
      )
      .run();
  } catch (e) {
    /* best-effort — see comment above */
  }
  return { token: token, payload: payload };
}

// POST /api/auth/google { idToken } -> verify -> Set-Cookie mmgr_session
export async function handleAuthGoogle(request, env) {
  const read = await readJsonBody(request, BODY_CAP);
  if (read.tooLarge) {
    return json({ ok: false, error: 'body too large' }, 413);
  }
  if (read.bad) {
    return json({ ok: false, error: 'bad request' }, 400);
  }
  const body = read.body;
  const idToken = body && typeof body.idToken === 'string' ? body.idToken : '';
  if (!idToken) {
    return json({ ok: false, error: 'missing id_token' }, 400);
  }
  // G-2: the client posts the nonce it fetched (absent on legacy cached
  // pages). A present-but-bogus nonce is kept as a non-matching sentinel so
  // it fails the equality check instead of silently taking the legacy path.
  const nonce =
    body && typeof body.nonce === 'string'
      ? body.nonce.slice(0, 128)
      : body && body.nonce
        ? 'invalid'
        : '';
  const clientId =
    env && typeof env.GOOGLE_CLIENT_ID === 'string' && env.GOOGLE_CLIENT_ID
      ? env.GOOGLE_CLIENT_ID
      : GOOGLE_CLIENT_ID;
  const user = await verifyGoogleIdToken(idToken, clientId, nonce, env);
  if (!user) {
    return json({ ok: false, error: 'invalid token' }, 401);
  }
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
  if (!session) {
    return json({ ok: false, user: null });
  }
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
      {
        sub: session.sub,
        email: session.email,
        name: session.name,
        picture: session.picture,
        jti: jti,
        iat: nowSec,
        exp: exp
      },
      await sessionKey(env)
    );
    try {
      if (session.jti) {
        await env.DB.prepare('UPDATE auth_sessions SET expires_at = ? WHERE jti = ?')
          .bind(new Date(exp * 1000).toISOString(), session.jti)
          .run();
      } else {
        await env.DB.prepare(
          'INSERT INTO auth_sessions (jti, sub, created_at, expires_at) VALUES (?,?,?,?)'
        )
          .bind(jti, session.sub, new Date().toISOString(), new Date(exp * 1000).toISOString())
          .run();
      }
    } catch (e) {
      /* renewal bookkeeping is best-effort */
    }
    return new Response(
      JSON.stringify({
        ok: true,
        user: {
          sub: session.sub,
          email: session.email,
          name: session.name,
          picture: session.picture
        }
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'Set-Cookie': sessionSetCookie(refreshed)
        }
      }
    );
  }
  return json({
    ok: true,
    user: { sub: session.sub, email: session.email, name: session.name, picture: session.picture }
  });
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
        .bind(new Date().toISOString(), sess.jti)
        .run();
      if (env.KV) {
        try {
          await env.KV.put('sess:' + sess.jti, 'revoked', { expirationTtl: 300 });
        } catch (e) {}
      }
    } catch (e) {
      /* best-effort */
    }
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
      const toRevoke = await env.DB.prepare(
        'SELECT jti FROM auth_sessions WHERE sub = ? AND revoked_at IS NULL'
      )
        .bind(sess.sub)
        .all();
      await env.DB.prepare(
        'UPDATE auth_sessions SET revoked_at = ? WHERE sub = ? AND revoked_at IS NULL'
      )
        .bind(new Date().toISOString(), sess.sub)
        .run();
      if (env.KV && toRevoke.results) {
        for (const r of toRevoke.results) {
          try {
            await env.KV.put('sess:' + r.jti, 'revoked', { expirationTtl: 300 });
          } catch (e) {}
        }
      }
    } catch (e) {
      /* best-effort */
    }
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
