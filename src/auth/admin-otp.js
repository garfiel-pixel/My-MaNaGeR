/* ============================================================
   EMAILED ADMIN SIGN-IN (owner 2026-11-24)
   ------------------------------------------------------------
   The operator credential used to be a static site admin code: one shared
   string, typed once per session, sent as X-Admin-Code. This replaces it with
   a code emailed to the owner's fixed inbox, single-use, exchanged for a
   short-lived admin session token.

   Flow
     POST /api/admin/signin/request  (signed-in, verified OWNER account)
       -> 20-digit code emailed to ADMIN_EMAIL, challenge id in an HttpOnly
          cookie so the code only redeems in the browser that asked for it
     POST /api/admin/signin/verify   { code } + challenge cookie
       -> opaque admin token (45 min), stored as SHA-256
     GET  /api/admin/signin/session  -> whether the token is still good
     POST /api/admin/signout         -> revoke it

   The operator routes then accept `X-Admin-Session: <token>`; the legacy
   X-Admin-Code path stays while env.ADMIN_CODE is set.

   Guards
     - session required, the address verified (provenEmail) AND equal to the
       one owner address below - no other account can request a code;
     - the destination address is SERVER-SIDE only - never read from the
       request, so this cannot become an open mail relay;
     - 3 sends/hour/account, 5 verify attempts per challenge, 10-minute code,
       45-minute token, race-safe single use;
     - the code is stored as PBKDF2 (hashOwnerCode) and the token as SHA-256,
       so a D1 dump alone yields nothing usable;
     - a token only authenticates alongside the session cookie of the same
       account, so a stolen header value alone is not enough.
   ============================================================ */
import {
  json,
  readSession,
  provenEmail,
  readJsonBody,
  sendAuthEmail,
  authEmailConfigured,
  hashOwnerCode,
  randomSaltHex,
  codesEqual,
  cloudTimingSink
} from '../lib/http.js';

const CHALLENGE_COOKIE = 'mmgr_admin_chal';
const ADMIN_TOKEN_HEADER = 'X-Admin-Session';
// Owner 2026-11-25: the operator code is 20 random digits, not the old
// 8-character alphabet. Digits only so it reads cleanly from an email on a
// phone, and long enough that an online guess is not a realistic attack.
const CODE_LEN = 20;
export const ADMIN_OWNER_EMAIL = 'garfieldprocis@gmail.com';
const CODE_TTL_MS = 10 * 60 * 1000;
const TOKEN_TTL_MS = 45 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_SENDS_PER_HOUR = 3;
const BODY_CAP = 8192;

// The inbox that receives sign-in codes. Fixed server-side on purpose: a
// request-supplied address would turn this endpoint into a mail relay.
export function adminEmail(env) {
  const v = env && typeof env.ADMIN_EMAIL === 'string' ? env.ADMIN_EMAIL.trim() : '';
  return v || 'admin@mymanagerworkspace.com';
}

function maskEmail(email) {
  const at = String(email || '').indexOf('@');
  if (at <= 0) {
    return 'the admin inbox';
  }
  return String(email).slice(0, 1) + '***@' + String(email).slice(at + 1);
}

function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  let value = null;
  header.split(';').forEach(function (part) {
    const idx = part.indexOf('=');
    if (idx < 0) {
      return;
    }
    if (part.slice(0, idx).trim() === name) {
      value = part.slice(idx + 1).trim();
    }
  });
  return value;
}

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LEN));
  const limit = 256 - (256 % 10);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    let b = bytes[i];
    while (b >= limit) {
      b = crypto.getRandomValues(new Uint8Array(1))[0];
    }
    out += String(b % 10);
  }
  return out;
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map(function (b) {
      return b.toString(16).padStart(2, '0');
    })
    .join('');
}

function clientIp(request) {
  return String(request.headers.get('CF-Connecting-IP') || '').slice(0, 64);
}

function clientUa(request) {
  return String(request.headers.get('User-Agent') || '').slice(0, 200);
}

function challengeCookie(id, maxAge) {
  return (
    CHALLENGE_COOKIE + '=' + id + '; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=' + maxAge
  );
}

async function requireVerifiedSession(request, env) {
  const session = await readSession(request, env);
  if (!session || !session.sub) {
    return { error: json({ ok: false, error: 'sign in to the site first' }, 401) };
  }
  const email = await provenEmail(session, env);
  if (!email) {
    return {
      error: json(
        { ok: false, error: 'confirm your email address before using admin sign-in' },
        403
      )
    };
  }
  if (email !== ADMIN_OWNER_EMAIL) {
    // The operator console belongs to one address. A code for anyone else
    // would still land in the owner's inbox and burn the send quota, so refuse
    // before touching D1 or the mail provider. The message stays generic: no
    // oracle for which accounts exist beyond "not this one".
    await cloudTimingSink();
    return { error: json({ ok: false, error: 'this account cannot use admin sign-in' }, 403) };
  }
  return { session: session, email: email };
}

// POST /api/admin/signin/request - email a fresh single-use code.
export async function handleAdminOtpRequest(request, env) {
  if (!authEmailConfigured(env)) {
    return json({ ok: false, error: 'email is not configured on this deployment' }, 503);
  }
  const who = await requireVerifiedSession(request, env);
  if (who.error) {
    return who.error;
  }
  const sub = who.session.sub;
  const nowIso = new Date().toISOString();

  // Per-account send cap, counted from the rows themselves so it survives a
  // cache eviction and cannot be bypassed with a new IP.
  let sentCount = 0;
  try {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const row = await env.DB.prepare(
      'SELECT COUNT(*) AS c FROM admin_otp_challenges WHERE sub = ? AND created_at > ?'
    )
      .bind(sub, hourAgo)
      .first();
    sentCount = Number(row && row.c) || 0;
  } catch (e) {
    /* a count failure must not break the send */
  }
  if (sentCount >= MAX_SENDS_PER_HOUR) {
    return new Response(
      JSON.stringify({ ok: false, error: 'too many sign-in codes requested - try again later' }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'Retry-After': '3600'
        }
      }
    );
  }

  // Newest code wins: retire every older unused challenge for this account.
  try {
    await env.DB.prepare(
      'UPDATE admin_otp_challenges SET consumed_at = ? WHERE sub = ? AND consumed_at IS NULL'
    )
      .bind(nowIso, sub)
      .run();
  } catch (e) {
    /* best-effort */
  }
  // Bounded cleanup so the table cannot grow without a cron.
  try {
    await env.DB.prepare(
      'DELETE FROM admin_otp_challenges WHERE expires_at < ? AND consumed_at IS NOT NULL'
    )
      .bind(nowIso)
      .run();
  } catch (e) {
    /* best-effort */
  }

  const code = randomCode();
  const salt = randomSaltHex();
  const hash = await hashOwnerCode(code, salt);
  const id = crypto.randomUUID();
  const expiresIso = new Date(Date.now() + CODE_TTL_MS).toISOString();
  try {
    await env.DB.prepare(
      'INSERT INTO admin_otp_challenges (id, sub, email, code_hash, attempts, created_at, expires_at, ip, ua) VALUES (?,?,?,?,0,?,?,?,?)'
    )
      .bind(
        id,
        sub,
        who.email,
        salt + ':' + hash,
        nowIso,
        expiresIso,
        clientIp(request),
        clientUa(request)
      )
      .run();
  } catch (e) {
    return json({ ok: false, error: 'could not start sign-in - try again in a moment' }, 500);
  }

  let sent = false;
  try {
    sent = await sendAuthEmail(
      env,
      adminEmail(env),
      'Your My MaNaGeR admin sign-in code',
      'Your admin sign-in code is:\n\n' +
        code +
        '\n\nIt expires in 10 minutes and can only be used once.\n' +
        'Requested from ' +
        (clientIp(request) || 'an unknown address') +
        ' at ' +
        new Date().toISOString() +
        '.\nIf this was not you, ignore this email - nobody can sign in without the code.'
    );
  } catch (e) {
    sent = false;
  }
  if (!sent) {
    // Fail closed: a challenge nobody can receive is not a usable credential.
    try {
      await env.DB.prepare('UPDATE admin_otp_challenges SET consumed_at = ? WHERE id = ?')
        .bind(new Date().toISOString(), id)
        .run();
    } catch (e) {
      /* best-effort */
    }
    return json({ ok: false, error: 'the sign-in email could not be sent - try again' }, 502);
  }

  return new Response(
    JSON.stringify({ ok: true, sent: true, emailMasked: maskEmail(adminEmail(env)) }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Set-Cookie': challengeCookie(id, Math.floor(CODE_TTL_MS / 1000))
      }
    }
  );
}

// POST /api/admin/signin/verify { code } + challenge cookie -> admin token.
export async function handleAdminOtpVerify(request, env) {
  const session = await readSession(request, env);
  if (!session || !session.sub) {
    return json({ ok: false, error: 'sign in to the site first' }, 401);
  }
  const ownerEmail = await provenEmail(session, env);
  if (!ownerEmail || ownerEmail !== ADMIN_OWNER_EMAIL) {
    await cloudTimingSink();
    return json({ ok: false, error: 'this account cannot use admin sign-in' }, 403);
  }
  const read = await readJsonBody(request, BODY_CAP);
  if (read.tooLarge) {
    return json({ ok: false, error: 'body too large' }, 413);
  }
  if (read.bad) {
    return json({ ok: false, error: 'bad request' }, 400);
  }
  const code = String((read.body && read.body.code) || '')
    .trim()
    .toUpperCase();
  if (!code) {
    return json({ ok: false, error: 'code is required' }, 400);
  }
  const challengeId = readCookie(request, CHALLENGE_COOKIE);
  if (!challengeId) {
    await cloudTimingSink();
    return json({ ok: false, error: 'request a code in this browser first' }, 400);
  }

  const nowIso = new Date().toISOString();
  let row = null;
  try {
    row = await env.DB.prepare(
      'SELECT id, sub, code_hash, attempts, expires_at, consumed_at FROM admin_otp_challenges WHERE id = ?'
    )
      .bind(challengeId)
      .first();
  } catch (e) {
    row = null;
  }
  if (!row || row.consumed_at || row.sub !== session.sub || row.expires_at <= nowIso) {
    await cloudTimingSink();
    return json({ ok: false, error: 'that code is no longer valid - request a new one' }, 400);
  }
  if (Number(row.attempts) >= MAX_ATTEMPTS) {
    return new Response(
      JSON.stringify({ ok: false, error: 'too many attempts - request a new code' }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'Retry-After': '600'
        }
      }
    );
  }

  const sep = String(row.code_hash || '').indexOf(':');
  const salt = sep > 0 ? row.code_hash.slice(0, sep) : '00000000000000000000000000000000';
  const expected = sep > 0 ? row.code_hash.slice(sep + 1) : '';
  const got = await hashOwnerCode(code, salt);
  if (!codesEqual(got, expected)) {
    try {
      await env.DB.prepare(
        'UPDATE admin_otp_challenges SET attempts = attempts + 1 WHERE id = ? AND consumed_at IS NULL'
      )
        .bind(row.id)
        .run();
    } catch (e) {
      /* best-effort */
    }
    return json({ ok: false, error: 'that code is not correct' }, 400);
  }

  // Race-safe single use: the consume must be the row that flips.
  try {
    const consumed = await env.DB.prepare(
      'UPDATE admin_otp_challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL'
    )
      .bind(nowIso, row.id)
      .run();
    const changes =
      consumed && consumed.meta && typeof consumed.meta.changes === 'number'
        ? consumed.meta.changes
        : 1;
    if (changes === 0) {
      return json({ ok: false, error: 'that code is no longer valid - request a new one' }, 400);
    }
  } catch (e) {
    return json({ ok: false, error: 'could not complete sign-in - try again' }, 500);
  }

  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const expiresIso = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  try {
    await env.DB.prepare(
      'INSERT INTO admin_sessions (id, sub, token_hash, created_at, expires_at, ip, ua) VALUES (?,?,?,?,?,?,?)'
    )
      .bind(
        crypto.randomUUID(),
        session.sub,
        tokenHash,
        nowIso,
        expiresIso,
        clientIp(request),
        clientUa(request)
      )
      .run();
  } catch (e) {
    return json({ ok: false, error: 'could not complete sign-in - try again' }, 500);
  }

  return new Response(JSON.stringify({ ok: true, token: token, expiresAt: expiresIso }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Set-Cookie': challengeCookie('', 0)
    }
  });
}

// GET /api/admin/signin/session - is this admin token still good?
export async function handleAdminSessionCheck(request, env) {
  const session = await readSession(request, env);
  if (!session || !session.sub) {
    return json({ ok: false, error: 'not signed in' }, 401);
  }
  const token = String(request.headers.get(ADMIN_TOKEN_HEADER) || '').trim();
  if (!token) {
    return json({ ok: false, error: 'no admin session' }, 401);
  }
  const row = await adminTokenRow(env, token);
  if (!row || row.sub !== session.sub) {
    return json({ ok: false, error: 'admin session expired' }, 401);
  }
  return json({ ok: true, expiresAt: row.expires_at });
}

// POST /api/admin/signout - revoke the presented admin token.
export async function handleAdminSignout(request, env) {
  const token = String(request.headers.get(ADMIN_TOKEN_HEADER) || '').trim();
  if (!token) {
    return json({ ok: true });
  }
  try {
    await env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash = ?')
      .bind(await sha256Hex(token))
      .run();
  } catch (e) {
    /* revoking a token that may not exist is not an error */
  }
  return json({ ok: true });
}

async function adminTokenRow(env, token) {
  if (!token || token.length > 200) {
    return null;
  }
  try {
    const hash = await sha256Hex(token);
    const row = await env.DB.prepare(
      'SELECT sub, expires_at FROM admin_sessions WHERE token_hash = ?'
    )
      .bind(hash)
      .first();
    if (!row || row.expires_at <= new Date().toISOString()) {
      return null;
    }
    return row;
  } catch (e) {
    return null;
  }
}

/* Operator-route authorisation. Accepts the emailed-code session token
   (X-Admin-Session) or, while env.ADMIN_CODE is set, the legacy shared code.
   The token path also requires the site session cookie of the SAME account,
   so the header value alone is useless if it leaks. */
export async function adminAuthorized(request, env) {
  const token = String(request.headers.get(ADMIN_TOKEN_HEADER) || '').trim();
  if (token) {
    const row = await adminTokenRow(env, token);
    const session = await readSession(request, env);
    if (row && session && session.sub && row.sub === session.sub) {
      return { ok: true, via: 'otp' };
    }
    return null;
  }
  return { ok: false, via: 'none' };
}
