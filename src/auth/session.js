/* ============================================================
   AUTH SESSION — register, login, password, verify, forgot, reset
   ------------------------------------------------------------
   Extracted from worker.js. Email+password auth with PBKDF2
   hashing, per-account lockout, one-time tokens, and Resend
   transactional email.
   ============================================================ */
import { json, cloudTimingSink, randomSaltHex, hashOwnerCode, codesEqual,
  readSession, authEmailConfigured, sendAuthEmail, mintAuthToken,
  consumeAuthToken, authVerifyEmailBody, authSessionResponse,
  CLOUD_DUMMY_SALT } from '../lib/http.js';

const AUTH_MIN_PASSWORD = 8;
const AUTH_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const AUTH_RESET_TTL_MS = 30 * 60 * 1000;
const AUTH_RESET_MAX_PER_EMAIL_H = 5;
const AUTH_LOCK_FAILS = 5;
const AUTH_LOCK_WINDOW_MS = 15 * 60 * 1000;
const AUTH_LOCK_ESCALATE_FAILS = 10;
const AUTH_LOCK_ESCALATE_MS = 60 * 60 * 1000;

function authNormalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

function authEmailValid(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

async function authHashPassword(password, saltHex) {
  return hashOwnerCode(password, saltHex);
}

export async function handleAuthRegister(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'bad request' }, 400); }
  const email = authNormalizeEmail(body && body.email);
  if (!authEmailValid(email)) return json({ ok: false, error: 'invalid email address' }, 400);
  const password = String((body && body.password) || '');
  if (password.length < AUTH_MIN_PASSWORD) return json({ ok: false, error: 'password must be at least ' + AUTH_MIN_PASSWORD + ' characters' }, 400);
  const name = String((body && body.name) || '').slice(0, 80);
  const existing = await env.DB.prepare('SELECT email FROM auth_users WHERE email = ?').bind(email).first();
  if (existing) return json({ ok: false, error: 'account already exists — sign in instead' }, 409);
  const salt = randomSaltHex();
  const hash = await authHashPassword(password, salt);
  const now = new Date().toISOString();
  try {
    await env.DB.prepare('INSERT INTO auth_users (email, password_hash, name, created_at) VALUES (?,?,?,?)')
      .bind(email, salt + ':' + hash, name, now).run();
  } catch (e) {
    const raced = await env.DB.prepare('SELECT email FROM auth_users WHERE email = ?').bind(email).first();
    if (raced) return json({ ok: false, error: 'account already exists — sign in instead' }, 409);
    throw e;
  }
  let emailSent = false;
  if (authEmailConfigured(env)) {
    try {
      const origin = new URL(request.url).origin;
      const vtoken = await mintAuthToken(env, email, 'verify', AUTH_VERIFY_TTL_MS);
      emailSent = await sendAuthEmail(env, email, 'Confirm your My MaNaGeR account', authVerifyEmailBody(name, origin, vtoken));
    } catch (e) { /* mail failure must never break signup */ }
  }
  return authSessionResponse({ email: email, name: name }, env, emailSent);
}

export async function handleAuthLogin(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'bad request' }, 400); }
  const email = authNormalizeEmail(body && body.email);
  const password = String((body && body.password) || '');
  const guard = await env.DB.prepare('SELECT failed_attempts, locked_until FROM auth_login_guard WHERE email = ?').bind(email).first();
  if (guard && guard.locked_until && new Date(guard.locked_until).getTime() > Date.now()) {
    const retryAfter = Math.max(1, Math.ceil((new Date(guard.locked_until).getTime() - Date.now()) / 1000));
    return new Response(JSON.stringify({ ok: false, error: 'Too many failed attempts — try again later or contact support.' }), {
      status: 429, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': String(retryAfter) }
    });
  }
  const row = await env.DB.prepare('SELECT email, password_hash, name FROM auth_users WHERE email = ?').bind(email).first();
  if (!row) {
    await cloudTimingSink();
    await authHashPassword('x'.repeat(AUTH_MIN_PASSWORD), CLOUD_DUMMY_SALT);
    return json({ ok: false, error: 'invalid email or password' }, 401);
  }
  const sep = row.password_hash.indexOf(':');
  if (sep <= 0) return json({ ok: false, error: 'invalid email or password' }, 401);
  const hash = await authHashPassword(password, row.password_hash.slice(0, sep));
  if (!codesEqual(hash, row.password_hash.slice(sep + 1))) {
    const fails = (guard ? (Number(guard.failed_attempts) || 0) : 0) + 1;
    const lockMs = fails >= AUTH_LOCK_ESCALATE_FAILS ? AUTH_LOCK_ESCALATE_MS : fails >= AUTH_LOCK_FAILS ? AUTH_LOCK_WINDOW_MS : 0;
    const lockedUntil = lockMs ? new Date(Date.now() + lockMs).toISOString() : null;
    try {
      await env.DB.prepare('INSERT INTO auth_login_guard (email, failed_attempts, locked_until) VALUES (?,?,?) ON CONFLICT(email) DO UPDATE SET failed_attempts = excluded.failed_attempts, locked_until = excluded.locked_until')
        .bind(email, fails, lockedUntil).run();
    } catch (e) { /* guard write must never break login */ }
    return json({ ok: false, error: 'invalid email or password' }, 401);
  }
  try { await env.DB.prepare('DELETE FROM auth_login_guard WHERE email = ?').bind(email).run(); } catch (e) { /* best-effort */ }
  return authSessionResponse({ email: row.email, name: row.name }, env);
}

export async function handleAuthPasswordChange(request, env) {
  const session = await readSession(request, env);
  if (!session || !session.sub) return json({ ok: false, error: 'not signed in' }, 401);
  if (session.sub.indexOf('email:') !== 0) return json({ ok: false, error: 'this account has no password' }, 400);
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'bad request' }, 400); }
  const email = session.sub.slice('email:'.length);
  const current = String((body && body.currentPassword) || '');
  const next = String((body && body.newPassword) || '');
  if (next.length < AUTH_MIN_PASSWORD) return json({ ok: false, error: 'password must be at least ' + AUTH_MIN_PASSWORD + ' characters' }, 400);
  const row = await env.DB.prepare('SELECT password_hash FROM auth_users WHERE email = ?').bind(email).first();
  if (!row) return json({ ok: false, error: 'account not found' }, 404);
  const sep = row.password_hash.indexOf(':');
  if (sep <= 0) return json({ ok: false, error: 'account not found' }, 404);
  const hash = await authHashPassword(current, row.password_hash.slice(0, sep));
  if (!codesEqual(hash, row.password_hash.slice(sep + 1))) {
    return json({ ok: false, error: 'current password is incorrect' }, 401);
  }
  const salt = randomSaltHex();
  const newHash = await authHashPassword(next, salt);
  await env.DB.prepare('UPDATE auth_users SET password_hash = ? WHERE email = ?').bind(salt + ':' + newHash, email).run();
  try {
    await env.DB.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE sub = ? AND revoked_at IS NULL AND jti != ?')
      .bind(new Date().toISOString(), session.sub, session.jti || '').run();
  } catch (e) { /* best-effort */ }
  return json({ ok: true });
}

export async function handleAuthVerifyPassword(request, env) {
  const session = await readSession(request, env);
  if (!session || !session.sub) return json({ ok: false, error: 'not signed in' }, 401);
  if (session.sub.indexOf('email:') !== 0) return json({ ok: false, error: 'this account has no password' }, 400);
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'bad request' }, 400); }
  const password = String((body && body.password) || '');
  if (!password) return json({ ok: false, error: 'password is required' }, 400);
  const email = session.sub.slice('email:'.length);
  const row = await env.DB.prepare('SELECT password_hash FROM auth_users WHERE email = ?').bind(email).first();
  if (!row) return json({ ok: false, error: 'account not found' }, 404);
  const sep = row.password_hash.indexOf(':');
  if (sep <= 0) return json({ ok: false, error: 'account not found' }, 404);
  const hash = await authHashPassword(password, row.password_hash.slice(0, sep));
  if (!codesEqual(hash, row.password_hash.slice(sep + 1))) {
    return json({ ok: false, error: 'password is incorrect' }, 401);
  }
  return json({ ok: true, verified: true });
}

export async function handleAuthVerify(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'bad request' }, 400); }
  const email = await consumeAuthToken(env, String((body && body.token) || ''), 'verify');
  if (!email) return json({ ok: false, error: 'invalid or expired verification link' }, 400);
  try { await env.DB.prepare('UPDATE auth_users SET email_verified = 1 WHERE email = ?').bind(email).run(); } catch (e) { /* best-effort */ }
  return json({ ok: true, email: email });
}

export async function handleAuthForgot(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'bad request' }, 400); }
  const email = authNormalizeEmail(body && body.email);
  if (!authEmailValid(email)) return json({ ok: false, error: 'invalid email address' }, 400);
  const generic = { ok: true, message: 'If an account exists for that email, a reset link is on its way.' };
  const row = await env.DB.prepare('SELECT email FROM auth_users WHERE email = ?').bind(email).first();
  if (!row) {
    await cloudTimingSink();
    await authHashPassword('x'.repeat(AUTH_MIN_PASSWORD), CLOUD_DUMMY_SALT);
    return json(generic);
  }
  if (authEmailConfigured(env)) {
    try {
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const cnt = await env.DB.prepare('SELECT COUNT(*) AS c FROM auth_tokens WHERE email = ? AND purpose = ? AND created_at > ?')
        .bind(email, 'reset', hourAgo).first();
      if (!cnt || (cnt.c || 0) < AUTH_RESET_MAX_PER_EMAIL_H) {
        const origin = new URL(request.url).origin;
        const rtoken = await mintAuthToken(env, email, 'reset', AUTH_RESET_TTL_MS);
        await sendAuthEmail(env, email,
          'Reset your My MaNaGeR password',
          'We received a request to reset your My MaNaGeR password.\n\nReset it here (the link expires in 30 minutes):\n\n' +
          origin + '/reset.html?token=' + encodeURIComponent(rtoken) + '\n\nIf you did not request this, you can ignore this email.');
      }
    } catch (e) { /* mail failure must never break the generic response */ }
  }
  return json(generic);
}

export async function handleAuthReset(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'bad request' }, 400); }
  const next = String((body && body.newPassword) || '');
  if (next.length < AUTH_MIN_PASSWORD) return json({ ok: false, error: 'password must be at least ' + AUTH_MIN_PASSWORD + ' characters' }, 400);
  const email = await consumeAuthToken(env, String((body && body.token) || ''), 'reset');
  if (!email) return json({ ok: false, error: 'invalid or expired reset link' }, 400);
  const row = await env.DB.prepare('SELECT email FROM auth_users WHERE email = ?').bind(email).first();
  if (!row) return json({ ok: false, error: 'invalid or expired reset link' }, 400);
  const salt = randomSaltHex();
  const newHash = await authHashPassword(next, salt);
  await env.DB.prepare('UPDATE auth_users SET password_hash = ? WHERE email = ?').bind(salt + ':' + newHash, email).run();
  try {
    await env.DB.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE sub = ? AND revoked_at IS NULL')
      .bind(new Date().toISOString(), 'email:' + email).run();
    await env.DB.prepare('DELETE FROM auth_login_guard WHERE email = ?').bind(email).run();
  } catch (e) { /* best-effort */ }
  return json({ ok: true });
}

export async function handleAuthResendVerify(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'bad request' }, 400); }
  const email = authNormalizeEmail(body && body.email);
  if (!authEmailValid(email)) return json({ ok: false, error: 'invalid email address' }, 400);
  const generic = { ok: true, message: 'If an account needs verification, a new confirmation link is on its way.' };
  const row = await env.DB.prepare('SELECT email, email_verified, name FROM auth_users WHERE email = ?').bind(email).first();
  if (!row) {
    await cloudTimingSink();
    await authHashPassword('x'.repeat(AUTH_MIN_PASSWORD), CLOUD_DUMMY_SALT);
    return json(generic);
  }
  if (row.email_verified) return json(generic);
  if (authEmailConfigured(env)) {
    try {
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const cnt = await env.DB.prepare('SELECT COUNT(*) AS c FROM auth_tokens WHERE email = ? AND purpose = ? AND created_at > ?')
        .bind(email, 'verify', hourAgo).first();
      if (!cnt || (cnt.c || 0) < AUTH_RESET_MAX_PER_EMAIL_H) {
        const origin = new URL(request.url).origin;
        const vtoken = await mintAuthToken(env, email, 'verify', AUTH_VERIFY_TTL_MS);
        await sendAuthEmail(env, email, 'Confirm your My MaNaGeR account', authVerifyEmailBody(row.name, origin, vtoken));
      }
    } catch (e) { /* mail failure must never break the generic response */ }
  }
  return json(generic);
}
