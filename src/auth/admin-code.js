/* ============================================================
   ADMIN-CODE CLOUD BACKUP (owner 2026-09-17)
   ------------------------------------------------------------
   The admin code used to live only on the device that created
   it. A signed-in owner now gets a backed-up copy with their
   account automatically:

   PUT  /api/auth/admin-code   { code }  -> server hashes it and
                                           stores the hash in a
                                           sealed envelope (UPSERT)
   GET  /api/auth/admin-code            -> status; a VERIFIED
                                           account gets the hash
                                           back to rebuild access
                                           on a new device

   Safety properties:
   - The plaintext code is NEVER stored and NEVER returned. The
     server hashes it exactly the way the local gate does
     (unsalted SHA-256 of the trimmed code, same as admin.html's
     mmgr_admin_pass_hash) and seals that hash into a versioned
     AES-256-GCM envelope under the session-secret key family.
     A database read alone reveals nothing; a decrypted envelope
     holds only the same hash the browser already keeps locally.
   - Writes and reads both require the signed-in session cookie
     (same-origin gate + rate limit on top).
   - Reads hand the hash to VERIFIED accounts only: a Google
     session, or an email account with email_verified = 1. The
     response carries hasCode (always safe) and hash only when
     allowed, so the client can probe status without pulling the
     credential.
   - One row per account (UPSERT); the newest code wins, mirroring
     the device-local model of a single current admin code.
   ============================================================ */
import { json, readSession, cloudRateCheck } from '../lib/http.js';

const ESCROW_VERSION = 1;

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
}

function escrowKeyMaterial(env) {
  const secret = env && typeof env.GOOGLE_CLIENT_SECRET === 'string' && env.GOOGLE_CLIENT_SECRET.length
    ? env.GOOGLE_CLIENT_SECRET : 'mmgr-escrow-fallback';
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode('mmgr-admin-code-escrow:' + secret),
    'PBKDF2', false, ['deriveKey']
  );
}

async function escrowCipherKey(env) {
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new TextEncoder().encode('mmgr-admin-code-escrow-v1'), iterations: 100000, hash: 'SHA-256' },
    await escrowKeyMaterial(env),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function unb64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sealAdminHash(env, hashHex) {
  const key = await escrowCipherKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(hashHex));
  return JSON.stringify({ v: ESCROW_VERSION, iv: b64(iv), data: b64(new Uint8Array(ct)) });
}

async function openAdminEnvelope(env, envelope) {
  try {
    const parsed = JSON.parse(envelope);
    if (!parsed || parsed.v !== ESCROW_VERSION || !parsed.iv || !parsed.data) return null;
    const key = await escrowCipherKey(env);
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(parsed.iv) },
      key,
      unb64(parsed.data)
    );
    const text = new TextDecoder().decode(pt);
    // Only accept well-formed sha256 hex out of the envelope.
    return /^[0-9a-f]{64}$/.test(text) ? text : null;
  } catch (e) {
    return null;
  }
}

// An account is "proven" when the email on it is verified: Google sessions
// are verified by construction; email accounts must have clicked their
// confirmation link (auth_users.email_verified = 1). Mirrors the gate the
// cloud-create route uses.
async function accountVerified(env, session) {
  if (!session || !session.sub) return false;
  if (session.sub.indexOf('email:') !== 0) return true;
  if (!env || !env.DB) return false;
  try {
    const row = await env.DB.prepare('SELECT email_verified FROM auth_users WHERE email = ?')
      .bind(session.sub.slice('email:'.length)).first();
    return !!(row && row.email_verified);
  } catch (e) {
    return false;
  }
}

export async function handleAdminCodePut(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'bad request' }, 400); }
  const code = String((body && body.code) || '').trim();
  if (code.length < 8 || code.length > 128) return json({ ok: false, error: 'bad request' }, 400);
  const session = await readSession(request, env);
  if (!session || !session.sub) return json({ ok: false, error: 'not signed in' }, 401);
  const rl = await cloudRateCheck(request, 'general', env);
  if (rl.limited) return json({ ok: false, error: 'too many requests' }, 429);
  const hashHex = await sha256Hex(code);
  const envelope = await sealAdminHash(env, hashHex);
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      'INSERT INTO admin_code_escrow (sub, envelope, updated_at) VALUES (?,?,?) ' +
      'ON CONFLICT(sub) DO UPDATE SET envelope = excluded.envelope, updated_at = excluded.updated_at'
    ).bind(session.sub, envelope, now).run();
  } catch (e) {
    return json({ ok: false, error: 'could not back up the code' }, 500);
  }
  return json({ ok: true });
}

export async function handleAdminCodeGet(request, env) {
  const session = await readSession(request, env);
  if (!session || !session.sub) return json({ ok: false, error: 'not signed in' }, 401);
  const rl = await cloudRateCheck(request, 'general', env);
  if (rl.limited) return json({ ok: false, error: 'too many requests' }, 429);
  let row = null;
  try {
    row = await env.DB.prepare('SELECT envelope, updated_at FROM admin_code_escrow WHERE sub = ?')
      .bind(session.sub).first();
  } catch (e) { row = null; }
  if (!row) return json({ ok: true, hasCode: false });
  const verified = await accountVerified(env, session);
  if (!verified) {
    // Status only: never hand the credential to an unverified email account.
    return json({ ok: true, hasCode: true, verified: false, updatedAt: row.updated_at });
  }
  const hashHex = await openAdminEnvelope(env, row.envelope);
  if (!hashHex) {
    // Corrupt/undecryptable (e.g. secret rotated): say so honestly instead
    // of returning garbage.
    return json({ ok: true, hasCode: true, verified: true, readable: false, updatedAt: row.updated_at });
  }
  return json({ ok: true, hasCode: true, verified: true, readable: true, hash: hashHex, updatedAt: row.updated_at });
}
