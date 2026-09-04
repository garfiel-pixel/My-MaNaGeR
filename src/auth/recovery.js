/* ============================================================
   ADMIN PASSWORD RECOVERY TIER A — email OTP (dormant by default)
   ------------------------------------------------------------
   Owner D8 / AREA G2 (2026-09-03). When EMAIL_RECOVERY_ENABLED is
   true, a SIGNED-IN admin with a verified email on file can prove
   email ownership with a single-use, 15-minute OTP and then set a
   new LOCAL admin password. The server verifies email ownership
   only — the device-local password hash is re-set by the client
   after a successful verify, so no secret ever leaves the device.

   Guards:
     - Flag off / unset -> 503 (same dormant pattern as billing).
     - Session required (never for local-only sessions -> Tier B).
     - Email-auth accounts need auth_users.email_verified = 1;
       Google sessions are treated as verified by Google.
     - 3 sends/hour/account, 5 verify attempts then lock to the
       row's 15-minute expiry (429 + Retry-After), newest OTP
       invalidates older unused rows, race-safe single-use.
     - Code is 8 chars over an unambiguous alphabet, emailed ONLY
       (no reset link / embedded token), stored as PBKDF2.
   ============================================================ */
import { json, cloudTimingSink, randomSaltHex, hashOwnerCode, codesEqual,
  readSession, authEmailConfigured, sendAuthEmail } from '../lib/http.js';

const REC_ENABLED_KEY = 'EMAIL_RECOVERY_ENABLED';
const REC_OTP_LEN = 8;
const REC_OTP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/l
const REC_TTL_MS = 15 * 60 * 1000;                 // owner confirmed
const REC_MAX_PER_HOUR = 3;
const REC_MAX_ATTEMPTS = 5;

function recFlagOn(env) {
  const v = env && env[REC_ENABLED_KEY];
  return v === true || v === 'true' || v === '1';
}

function recEnabledOffResponse() {
  return json({ ok: false, error: 'email-based admin recovery is not enabled' }, 503);
}

function recMaskEmail(email) {
  const at = String(email || '').indexOf('@');
  if (at <= 0) return 'your email';
  return String(email).slice(0, 1) + '***@' + String(email).slice(at + 1);
}

async function recDummyWork() {
  await Promise.all([cloudTimingSink(), hashOwnerCode('ZZZZZZZZ', randomSaltHex())]);
}

// Email-auth accounts must be verified; Google sessions carry a Google-
// verified address in the session payload. Local-only visitors have no
// session at all (handled by the caller's 401).
async function recEligible(env, session) {
  const email = String(session.email || '');
  if (!email) return false;
  if (String(session.sub || '').indexOf('email:') === 0) {
    try {
      const row = await env.DB.prepare('SELECT email_verified FROM auth_users WHERE email = ?')
        .bind(email).first();
      return !!(row && Number(row.email_verified) === 1);
    } catch (e) { return false; }
  }
  return true; // Google session
}

function recNewOtp() {
  const bytes = crypto.getRandomValues(new Uint8Array(REC_OTP_LEN));
  let code = '';
  for (let i = 0; i < bytes.length; i++) code += REC_OTP_ALPHABET[bytes[i] % REC_OTP_ALPHABET.length];
  return code;
}

// GET /api/auth/admin-recovery/status (session-gated, never 503): the
// forgot panel asks once whether email recovery is offered for THIS admin.
export async function handleAdminRecoveryStatus(request, env) {
  const session = await readSession(request, env);
  if (!session || !session.sub) return json({ ok: false, error: 'not signed in' }, 401);
  const eligible = await recEligible(env, session);
  return json({
    ok: true,
    enabled: recFlagOn(env) && eligible,
    emailMasked: eligible ? recMaskEmail(session.email) : ''
  });
}

// POST /api/auth/admin-recovery/send — email the admin a single-use OTP.
export async function handleAdminRecoverySend(request, env) {
  const session = await readSession(request, env);
  if (!session || !session.sub) return json({ ok: false, error: 'not signed in' }, 401);
  if (!recFlagOn(env)) return recEnabledOffResponse();
  if (!(await recEligible(env, session))) {
    return json({ ok: false, error: 'this account has no verified email on file' }, 403);
  }
  const email = String(session.email || '');
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  let sentCount = 0;
  try {
    const cnt = await env.DB.prepare(
      'SELECT COUNT(*) AS c FROM admin_recovery_otp WHERE sub = ? AND created_at > ?')
      .bind(session.sub, hourAgo).first();
    sentCount = (cnt && cnt.c) || 0;
  } catch (e) { /* count failure must never break send */ }
  if (sentCount >= REC_MAX_PER_HOUR) {
    return new Response(JSON.stringify({ ok: false, error: 'too many recovery codes sent — try again in an hour' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '3600' }
    });
  }
  // Newest OTP invalidates every older unused row for this account.
  const nowIso = new Date().toISOString();
  try {
    await env.DB.prepare('UPDATE admin_recovery_otp SET used_at = ? WHERE sub = ? AND used_at IS NULL')
      .bind(nowIso, session.sub).run();
  } catch (e) { /* best-effort */ }
  const code = recNewOtp();
  const salt = randomSaltHex();
  const otpHash = await hashOwnerCode(code, salt);
  const id = crypto.randomUUID();
  const expiresIso = new Date(Date.now() + REC_TTL_MS).toISOString();
  try {
    await env.DB.prepare(
      'INSERT INTO admin_recovery_otp (id, sub, email, otp_hash, created_at, expires_at) VALUES (?,?,?,?,?,?)')
      .bind(id, session.sub, email, salt + ':' + otpHash, nowIso, expiresIso).run();
  } catch (e) {
    return json({ ok: false, error: 'could not start recovery — try again in a moment' }, 500);
  }
  let sent = false;
  if (authEmailConfigured(env)) {
    try {
      sent = await sendAuthEmail(env, email, 'Your My MaNaGeR admin recovery code',
        'Your admin recovery code is:\n\n' + code + '\n\nIt expires in 15 minutes and can only be used once. ' +
        'If you did not request this code, you can ignore this email.');
    } catch (e) { /* mail failure handled below */ }
  }
  return json({ ok: true, sent: sent, emailMasked: recMaskEmail(email) });
}

// POST /api/auth/admin-recovery/verify — { code } -> ok when the newest
// unused, unexpired OTP matches (single-use, race-safe).
export async function handleAdminRecoveryVerify(request, env) {
  const session = await readSession(request, env);
  if (!session || !session.sub) return json({ ok: false, error: 'not signed in' }, 401);
  if (!recFlagOn(env)) return recEnabledOffResponse();
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'bad request' }, 400); }
  const code = String((body && body.code) || '').trim().toUpperCase();
  if (!code) return json({ ok: false, error: 'code is required' }, 400);
  const now = new Date().toISOString();
  let row;
  try {
    row = await env.DB.prepare(
      'SELECT id, otp_hash, expires_at, attempt_count FROM admin_recovery_otp ' +
      'WHERE sub = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1')
      .bind(session.sub, now).first();
  } catch (e) { row = null; }
  if (!row) {
    await recDummyWork();
    return json({ ok: false, error: 'invalid or expired recovery code' }, 400);
  }
  const locked = Number(row.attempt_count) >= REC_MAX_ATTEMPTS;
  if (locked) {
    const retryAfter = Math.max(1, Math.ceil((new Date(row.expires_at).getTime() - Date.now()) / 1000));
    return new Response(JSON.stringify({ ok: false, error: 'too many attempts — the code is now locked' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': String(retryAfter) }
    });
  }
  const sep = String(row.otp_hash || '').indexOf(':');
  const salt = sep > 0 ? row.otp_hash.slice(0, sep) : '';
  const hash = await hashOwnerCode(code, salt || '00000000000000000000000000000000');
  const expected = sep > 0 ? row.otp_hash.slice(sep + 1) : '';
  if (!codesEqual(hash, expected)) {
    try {
      await env.DB.prepare('UPDATE admin_recovery_otp SET attempt_count = attempt_count + 1 WHERE id = ? AND used_at IS NULL')
        .bind(row.id).run();
    } catch (e) { /* best-effort */ }
    if (Number(row.attempt_count) + 1 >= REC_MAX_ATTEMPTS) {
      const retryAfter = Math.max(1, Math.ceil((new Date(row.expires_at).getTime() - Date.now()) / 1000));
      return new Response(JSON.stringify({ ok: false, error: 'too many attempts — the code is now locked' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': String(retryAfter) }
      });
    }
    return json({ ok: false, error: 'invalid or expired recovery code' }, 400);
  }
  // Race-safe single-use: only one concurrent verify can consume the row.
  let changes = 0;
  try {
    const up = await env.DB.prepare('UPDATE admin_recovery_otp SET used_at = ? WHERE id = ? AND used_at IS NULL')
      .bind(now, row.id).run();
    changes = (up.meta && up.meta.changes) || 0;
  } catch (e) { changes = 0; }
  if (changes !== 1) {
    await recDummyWork();
    return json({ ok: false, error: 'invalid or expired recovery code' }, 400);
  }
  return json({ ok: true });
}
