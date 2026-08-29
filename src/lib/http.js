// Shared utilities extracted from worker.js.
// Every API module imports from here instead of duplicating helpers.

// ---- JSON responses --------------------------------------------------------

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

// ---- Cloud auth responses --------------------------------------------------

export function cloudForbidden() {
  return json({ ok: false, error: 'invalid project or owner code' }, 403);
}

export function cloudProjectDeleted() {
  return json({ ok: false, error: 'project_deleted' }, 410);
}

// ---- Timing side-channel guard ---------------------------------------------

const CLOUD_TIMING_FLOOR_MS = 15;
export function cloudTimingSink() {
  return new Promise(function(resolve) {
    setTimeout(resolve, CLOUD_TIMING_FLOOR_MS);
  });
}

// ---- Base64 URL encoding ---------------------------------------------------

export function base64UrlEncode(str) {
  let bin = '';
  for (const b of new TextEncoder().encode(str)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function base64UrlDecode(b64) {
  const s = String(b64).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
export function base64UrlToBytes(b64) {
  const s = String(b64).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
export function bytesToBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---- Constant-time comparison ----------------------------------------------

export function codesEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---- Session handling (Google + email auth) --------------------------------

export const SESSION_COOKIE = 'mmgr_session';
export const SESSION_MAX_AGE = 604800; // 7 days, seconds

let _fallbackSessionKeyPromise = null;

export async function sessionKey(env) {
  const secret = env && typeof env.GOOGLE_CLIENT_SECRET === 'string' && env.GOOGLE_CLIENT_SECRET.length
    ? env.GOOGLE_CLIENT_SECRET : null;
  if (secret) {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  }
  if (!_fallbackSessionKeyPromise) {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    let bin = '';
    for (let i = 0; i < raw.length; i++) bin += String.fromCharCode(raw[i]);
    _fallbackSessionKeyPromise = crypto.subtle.importKey('raw', new TextEncoder().encode(bin), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  }
  return _fallbackSessionKeyPromise;
}

export async function signSession(payload, key) {
  const jsonStr = JSON.stringify(payload);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(jsonStr));
  return base64UrlEncode(jsonStr) + '.' + bytesToBase64Url(new Uint8Array(sig));
}

export async function readSession(request, env) {
  const cookieHeader = request.headers.get('Cookie') || '';
  let raw = null;
  cookieHeader.split(';').forEach(function(part) {
    const idx = part.indexOf('=');
    if (idx < 0) return;
    if (part.slice(0, idx).trim() === SESSION_COOKIE) raw = part.slice(idx + 1).trim();
  });
  if (!raw) return null;
  const dot = raw.indexOf('.');
  if (dot <= 0 || dot >= raw.length - 1) return null;
  let payloadStr, sigBytes;
  try {
    payloadStr = base64UrlDecode(raw.slice(0, dot));
    sigBytes = base64UrlToBytes(raw.slice(dot + 1));
  } catch (e) { return null; }
  let payload;
  try { payload = JSON.parse(payloadStr); } catch (e) { return null; }
  if (!payload || typeof payload !== 'object' || !payload.sub) return null;
  let expected;
  try {
    expected = new Uint8Array(await crypto.subtle.sign('HMAC', await sessionKey(env), new TextEncoder().encode(payloadStr)));
  } catch (e) { return null; }
  if (expected.length !== sigBytes.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ sigBytes[i];
  if (diff !== 0) return null;
  const exp = Number(payload.exp);
  if (!Number.isFinite(exp) || exp * 1000 <= Date.now()) return null;
  if (payload.jti) {
    // KV-CACHE (Rank 3): check KV first for recent revocation status.
    // Avoids a D1 query on every authenticated request. TTL 60s — a
    // revoked session takes at most 60s to propagate to the cache.
    const kvKey = 'sess:' + payload.jti;
    try {
      if (env.KV) {
        const cached = await env.KV.get(kvKey);
        if (cached === 'revoked') return null;
        if (cached === 'valid') return payload;
      }
    } catch (e) { /* KV failure must not block auth */ }
    let sessRow;
    try {
      sessRow = await env.DB.prepare('SELECT revoked_at FROM auth_sessions WHERE jti = ?').bind(payload.jti).first();
    } catch (e) { return null; }
    if (!sessRow || sessRow.revoked_at) {
      try { if (env.KV) await env.KV.put(kvKey, 'revoked', { expirationTtl: 300 }); } catch (e) {}
      return null;
    }
    try { if (env.KV) await env.KV.put(kvKey, 'valid', { expirationTtl: 60 }); } catch (e) {}
  }
  return payload;
}

export function sessionSetCookie(token) {
  return SESSION_COOKIE + '=' + token + '; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=' + SESSION_MAX_AGE;
}

// ---- Auth email (Resend integration) --------------------------------------

const AUTH_FROM_FALLBACK = 'onboarding@resend.dev';
const AUTH_RESEND_BASE = 'https://api.resend.com';

export function authEmailConfigured(env) {
  return !!(env && env.RESEND_API_KEY);
}
export function authEmailFrom(env) {
  const f = env && typeof env.RESEND_FROM_EMAIL === 'string' ? env.RESEND_FROM_EMAIL.trim() : '';
  return f || AUTH_FROM_FALLBACK;
}
export async function sendAuthEmail(env, to, subject, textBody) {
  if (!authEmailConfigured(env)) return false;
  try {
    const base = (env && typeof env.RESEND_API_BASE === 'string' && env.RESEND_API_BASE) || AUTH_RESEND_BASE;
    const res = await fetch(base + '/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + env.RESEND_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from: authEmailFrom(env), to: [to], subject: subject, text: textBody })
    });
    if (!res.ok) console.error('resend email rejected: ' + res.status + ' ' + (await res.text()).slice(0, 200));
    return res.ok;
  } catch (e) {
    console.error('resend email failed:', e && e.message);
    return false;
  }
}

// ---- One-time signed tokens -----------------------------------------------

export async function mintAuthToken(env, email, purpose, ttlMs) {
  const nowSec = Math.floor(Date.now() / 1000);
  const jti = crypto.randomUUID();
  const payload = { t: purpose, e: email, j: jti, iat: nowSec, exp: nowSec + Math.floor(ttlMs / 1000) };
  const token = await signSession(payload, await sessionKey(env));
  try {
    await env.DB.prepare('INSERT INTO auth_tokens (id, email, purpose, created_at, expires_at) VALUES (?,?,?,?,?)')
      .bind(jti, email, purpose, new Date(nowSec * 1000).toISOString(), new Date(nowSec * 1000 + ttlMs).toISOString()).run();
  } catch (e) { /* best-effort */ }
  return token;
}

export async function consumeAuthToken(env, rawToken, purpose) {
  let payload;
  try {
    const dot = String(rawToken).indexOf('.');
    if (dot <= 0) return null;
    const payloadStr = base64UrlDecode(String(rawToken).slice(0, dot));
    payload = JSON.parse(payloadStr);
  } catch (e) { return null; }
  if (!payload || typeof payload !== 'object') return null;
  if (payload.t !== purpose) return null;
  const exp = Number(payload.exp);
  if (!Number.isFinite(exp) || exp * 1000 <= Date.now()) return null;
  const jti = payload.j;
  if (!jti) return null;
  try {
    const row = await env.DB.prepare('SELECT used_at FROM auth_tokens WHERE id = ?').bind(jti).first();
    if (!row) return null;
    if (row.used_at) return null;
    await env.DB.prepare('UPDATE auth_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL')
      .bind(new Date().toISOString(), jti).run();
  } catch (e) { return null; }
  return payload.e || null;
}

export function authVerifyEmailBody(name, origin, token) {
  return (name ? 'Hello ' + name + ',\n\n' : 'Hello,\n\n') +
    'Confirm your email to activate your My MaNaGeR account and enable cloud projects:\n\n' +
    origin + '/verify.html?token=' + encodeURIComponent(token) + '\n\n' +
    'This link expires in 24 hours. If you did not create this account, you can ignore this email.';
}

export async function authSessionResponse(user, env, emailSent) {
  const jti = crypto.randomUUID();
  const expSec = Math.floor(Date.now() / 1000) + 604800;
  const token = await signSession({ sub: user.sub, email: user.email || '', name: user.name || '', jti: jti, exp: expSec }, await sessionKey(env));
  try {
    await env.DB.prepare('INSERT INTO auth_sessions (jti, sub, created_at, expires_at) VALUES (?,?,?,?)')
      .bind(jti, user.sub, new Date().toISOString(), new Date(expSec * 1000).toISOString()).run();
  } catch (e) { /* session write must never break login */ }
  return new Response(JSON.stringify({ ok: true, user: { sub: user.sub, email: user.email || '', name: user.name || '' }, emailSent: !!emailSent }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Set-Cookie': sessionSetCookie(token) }
  });
}

// ---- Cloud code utilities --------------------------------------------------

const CLOUD_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CLOUD_PBKDF2_ITERS = 100000;

export function randomOwnerCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let code = '';
  for (let i = 0; i < bytes.length; i++) code += CLOUD_CODE_ALPHABET[bytes[i] % 32];
  return code.slice(0, 4) + '-' + code.slice(4, 8) + '-' + code.slice(8, 12) + '-' + code.slice(12, 16);
}

export function sanitizeProjectId(raw) {
  const s = String(raw || '').trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : null;
}

export function randomSaltHex() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

export async function hashOwnerCode(code, saltHex) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new TextEncoder().encode(saltHex), iterations: CLOUD_PBKDF2_ITERS, hash: 'SHA-256' },
    key, 256
  );
  const bytes = new Uint8Array(bits);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

export async function fingerprintOf(code) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(code || '')));
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

// ---- Cloud dummy hash (timing guard) --------------------------------------

const CLOUD_DUMMY_CODE = 'ZZZZ-ZZZZ-ZZZZ-ZZZZ';
export const CLOUD_DUMMY_SALT = '00000000000000000000000000000000';
let _cloudDummyHashPromise = null;
export async function cloudDummyHash() {
  if (!_cloudDummyHashPromise) _cloudDummyHashPromise = hashOwnerCode(CLOUD_DUMMY_CODE, CLOUD_DUMMY_SALT);
  return _cloudDummyHashPromise;
}

// ---- Cloud rate limiting ---------------------------------------------------

const CLOUD_RATE = {
  general: { max: 30, windowMs: 60000 },
  recover: { max: 10, windowMs: 300000 }
};
const _cloudBuckets = new Map();

export async function cloudRateKey(request, headerNames) {
  // Prefer code-based keying so each owner/editor gets its own bucket.
  // IP fallback only when no code header is present (anonymous requests).
  for (let i = 0; i < headerNames.length; i++) {
    const code = String(request.headers.get(headerNames[i]) || '').trim();
    if (code) {
      try {
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
        const bytes = new Uint8Array(hash);
        let hex = '';
        for (let j = 0; j < bytes.length; j++) hex += bytes[j].toString(16).padStart(2, '0');
        return 'code:' + hex;
      } catch (e) { return 'anon'; }
    }
  }
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) return 'ip:' + ip;
  return 'anon';
}

export async function cloudRateCheck(request, bucket, env) {
  const headers = bucket === 'recover' ? ['X-Owner-Code'] : ['X-Owner-Code', 'X-Editor-Code'];
  const key = await cloudRateKey(request, headers);
  const ns = bucket + ':' + key;
  if (env && env.RATE_LIMITER) {
    try {
      const { success } = await env.RATE_LIMITER.limit({ key: ns });
      if (!success) return { limited: true, retryAfter: 60 };
      return { limited: false };
    } catch (e) { /* binding unavailable — fall through to in-memory */ }
  }
  const cfg = CLOUD_RATE[bucket] || CLOUD_RATE.general;
  const now = Date.now();
  let list = _cloudBuckets.get(ns);
  if (!list) { list = []; _cloudBuckets.set(ns, list); }
  while (list.length && list[0] <= now - cfg.windowMs) list.shift();
  if (list.length >= cfg.max) {
    return { limited: true, retryAfter: Math.max(1, Math.ceil((list[0] + cfg.windowMs - now) / 1000)) };
  }
  list.push(now);
  if (_cloudBuckets.size > 10000) {
    for (const [k, v] of _cloudBuckets) {
      if (!v.length || v[v.length - 1] <= now - cfg.windowMs * 2) _cloudBuckets.delete(k);
    }
  }
  return { limited: false };
}

export function cloudRateLimited(retryAfter) {
  return new Response(JSON.stringify({ ok: false, error: 'too many requests — slow down and try again in a minute' }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Retry-After': String(retryAfter || 60)
    }
  });
}

// ---- Cloud body reader -----------------------------------------------------

const CLOUD_BODY_LIMIT_BYTES = 8388608;
export async function readCloudBody(request) {
  const cl = Number(request.headers.get('Content-Length') || 0);
  if (cl > CLOUD_BODY_LIMIT_BYTES) return { tooLarge: true };
  if (!request.body) {
    try { return { body: await request.json() }; } catch (e) { return { bad: true }; }
  }
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  let done = false;
  while (!done) {
    const res = await reader.read();
    done = res.done;
    if (res.value) {
      total += res.value.byteLength;
      if (total > CLOUD_BODY_LIMIT_BYTES) return { tooLarge: true };
      chunks.push(res.value);
    }
  }
  const bytes = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { bytes.set(c, off); off += c.byteLength; }
  const text = new TextDecoder().decode(bytes);
  try { return { body: JSON.parse(text) }; } catch (e) { return { bad: true }; }
}

// ---- Same-origin check -----------------------------------------------------

export function sameOriginOnly(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  try {
    const u = new URL(request.url);
    const o = new URL(origin);
    return o.origin === u.origin;
  } catch (e) { return false; }
}

// ---- Cloud owner touch (maintenance stamp) --------------------------------

export async function cloudTouchOwner(env, projectId) {
  try {
    await env.DB.prepare('UPDATE cloud_projects SET last_owner_seen_at = ? WHERE project_id = ?')
      .bind(new Date().toISOString(), projectId).run();
  } catch (e) { /* maintenance stamp must never fail a user request */ }
}

// ---- Cloud state encryption (R2 envelope) ---------------------------------
// Server-side AES-256-GCM encryption for project state blobs in R2.
// Key derived from owner_code_hash + owner_code_salt (both in D1) via
// PBKDF2 — the same KDF as hashOwnerCode. Blob format: { v:2, iv, salt,
// data } (base64). Legacy plaintext blobs (v:1 or no v) are read as-is
// so existing unencrypted projects continue to work without migration.
const R2_ENC_KDF_ITERS = 100000;
const R2_ENC_VERSION = 2;

async function r2DeriveKey(ownerCodeHash, saltHex) {
  // The owner_code_hash is a hex string derived from PBKDF2. Use it as
  // key material for a second PBKDF2 derivation with a fresh salt.
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(ownerCodeHash), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new TextEncoder().encode(saltHex), iterations: R2_ENC_KDF_ITERS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function r2BytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function r2Base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Encrypt a state object for R2 storage. Returns a versioned envelope.
export async function cloudEncryptState(state, ownerCodeHash, ownerCodeSalt) {
  if (!state || !ownerCodeHash || !ownerCodeSalt) return JSON.stringify(state);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await r2DeriveKey(ownerCodeHash, ownerCodeSalt);
  const pt = new TextEncoder().encode(JSON.stringify(state));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, pt);
  return JSON.stringify({
    v: R2_ENC_VERSION,
    iv: r2BytesToBase64(iv),
    salt: ownerCodeSalt,
    data: r2BytesToBase64(new Uint8Array(ct))
  });
}

// Decrypt a state object from R2. Detects legacy plaintext (no v field)
// and returns it as-is. Returns the decrypted state object.
export async function cloudDecryptState(envelope, ownerCodeHash, ownerCodeSalt) {
  if (!envelope) return null;
  // Legacy plaintext — no encryption envelope
  if (envelope.v === undefined || envelope.v === 1) return envelope;
  if (envelope.v !== R2_ENC_VERSION || !envelope.iv || !envelope.data) return envelope;
  // Encrypted — derive key and decrypt
  const salt = envelope.salt || ownerCodeSalt;
  const key = await r2DeriveKey(ownerCodeHash, salt);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: r2Base64ToBytes(envelope.iv) },
    key,
    r2Base64ToBytes(envelope.data)
  );
  return JSON.parse(new TextDecoder().decode(pt));
}

// ---- Cloud state read ------------------------------------------------------
// Reads a state blob from R2, with optional decryption when owner credentials
// are provided. Legacy plaintext blobs are returned as-is.
export async function cloudReadState(env, key, ownerCodeHash, ownerCodeSalt) {
  if (!key) return null;
  const obj = await env.R2.get(key);
  if (!obj) return null;
  const text = await obj.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { return null; }
  // If encryption credentials provided and blob is encrypted, decrypt
  if (ownerCodeHash && ownerCodeSalt && parsed && parsed.v === R2_ENC_VERSION) {
    try { return await cloudDecryptState(parsed, ownerCodeHash, ownerCodeSalt); } catch (e) { return null; }
  }
  return parsed;
}

// ---- Deep equal (for cloud state comparison) -------------------------------

export function cloudDeepEqual(a, b) {
  try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return a === b; }
}

// ---- Cloud sections (scope enforcement) -----------------------------------

export const CLOUD_SECTIONS = {
  charter: { label: 'Charter', keys: ['projectName', 'methodology', 'methodologyLocked', 'charter'] },
  wbs:     { label: 'WBS / Tasks', keys: ['tasks'] },
  res:     { label: 'Resources', keys: ['resources'] },
  bud:     { label: 'Budget', keys: ['budgetLines', 'budgetEnvelope', 'spendLog', 'nspid'] },
  stk:     { label: 'Stakeholders', keys: ['stakeholders'] },
  chg:     { label: 'Changes', keys: ['changes'] },
  log:     { label: 'Decision Log', keys: ['logEntries'] },
  risk:    { label: 'Risk / Issues', keys: ['risks', 'issues'] },
  close:   { label: 'Closure', keys: ['closure'] },
  raci:    { label: 'RACI', keys: ['raci'] },
  comms:   { label: 'Comms Log', keys: ['commsEntries'] },
  docs:    { label: 'Documents', keys: ['documents'] },
  dmaic:   { label: 'DMAIC', keys: ['dmaic'] },
  meet:    { label: 'Meetings', keys: ['meetings', 'meetingPromises', 'activeMeeting', 'nmeetid', 'sentimentHistory'] }
};
export const CLOUD_KEY_TO_SECTION = {};
export const CLOUD_CONTENT_KEYS = [];
Object.keys(CLOUD_SECTIONS).forEach(function(sec) {
  CLOUD_SECTIONS[sec].keys.forEach(function(k) {
    CLOUD_KEY_TO_SECTION[k] = sec;
    CLOUD_CONTENT_KEYS.push(k);
  });
});
export const CLOUD_CONTENT_KEY_SET = {};
CLOUD_CONTENT_KEYS.forEach(function(k) { CLOUD_CONTENT_KEY_SET[k] = 1; });

// Changelog leaf-diff cap
export const CLOUD_MAX_LEAF_DIFFS = 40;

export function handleCloudSections() {
  const sections = Object.keys(CLOUD_SECTIONS).map(function(k) {
    return { key: k, label: CLOUD_SECTIONS[k].label, keys: CLOUD_SECTIONS[k].keys.slice() };
  });
  return json({ ok: true, sections: sections });
}

// ---- Server-side scope enforcement ----------------------------------------

export function cloudScopeMerge(prev, submitted, scope) {
  const base = prev && typeof prev === 'object' && !Array.isArray(prev)
    ? JSON.parse(JSON.stringify(prev)) : {};
  const writable = {};
  scope.forEach(function(sec) {
    (CLOUD_SECTIONS[sec] || { keys: [] }).keys.forEach(function(k) { writable[k] = 1; });
  });
  const applied = []; const blocked = [];
  Object.keys(submitted || {}).forEach(function(k) {
    if (writable[k]) {
      base[k] = submitted[k];
      if (prev === null || prev === undefined || !cloudDeepEqual(prev[k], submitted[k])) {
        const sec = CLOUD_KEY_TO_SECTION[k];
        if (sec && applied.indexOf(sec) === -1) applied.push(sec);
      }
    } else if (CLOUD_CONTENT_KEY_SET[k]) {
      const differs = (prev === null || prev === undefined)
        ? submitted[k] !== undefined
        : !cloudDeepEqual(prev[k], submitted[k]);
      if (differs) {
        const sec = CLOUD_KEY_TO_SECTION[k];
        if (sec && blocked.indexOf(sec) === -1) blocked.push(sec);
      }
    }
  });
  if (prev && prev.fieldTs && typeof prev.fieldTs === 'object' && !Array.isArray(prev.fieldTs)) {
    base.fieldTs = JSON.parse(JSON.stringify(prev.fieldTs));
  }
  const now = new Date().toISOString();
  applied.forEach(function(sec) {
    (CLOUD_SECTIONS[sec] || { keys: [] }).keys.forEach(function(k) {
      if (base.fieldTs && typeof base.fieldTs === 'object') base.fieldTs[k] = now;
    });
  });
  delete base.updatedAt;
  return { next: base, applied: applied, blocked: blocked };
}

// ---- Diff utilities --------------------------------------------------------

export function cloudWalkLeaves(path, v, out) {
  if (v === null || typeof v !== 'object') { out[path] = v; return; }
  if (Array.isArray(v)) {
    if (v.length === 0) { out[path] = []; return; }
    v.forEach(function(item, i) { cloudWalkLeaves(path + '[' + i + ']', item, out); });
    return;
  }
  const keys = Object.keys(v);
  if (keys.length === 0) { out[path] = {}; return; }
  keys.forEach(function(k) { cloudWalkLeaves(path + '.' + k, v[k], out); });
}
export function cloudFlattenLeaves(obj, out) {
  CLOUD_CONTENT_KEYS.forEach(function(k) { cloudWalkLeaves(k, obj ? obj[k] : undefined, out); });
}
export function cloudDiffState(prev, next) {
  if (!prev || typeof prev !== 'object') return null;
  const before = {}; const after = {};
  cloudFlattenLeaves(prev, before);
  cloudFlattenLeaves(next, after);
  const paths = Object.keys(before);
  Object.keys(after).forEach(function(p) { if (paths.indexOf(p) === -1) paths.push(p); });
  const diffs = [];
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    const a = before[p]; const b = after[p];
    if (a === b || cloudDeepEqual(a, b)) continue;
    diffs.push({
      path: p,
      before: a === undefined ? null : a,
      beforeAbsent: a === undefined,
      after: b === undefined ? null : b,
      afterAbsent: b === undefined
    });
  }
  return diffs;
}
export function cloudSectionOfDiffs(diffs) {
  let sec = null;
  for (let i = 0; i < diffs.length; i++) {
    const s = CLOUD_KEY_TO_SECTION[String(diffs[i].path).split(/[.[]/)[0]];
    if (s === undefined) continue;
    if (sec === null) sec = s;
    else if (sec !== s) return 'multiple';
  }
  return sec;
}

// ---- Changelog log ---------------------------------------------------------

export async function cloudLogSave(env, projectId, prev, next, actor, entryType) {
  const diffs = cloudDiffState(prev, next);
  if (diffs === null || diffs.length === 0) return null;
  const now = new Date().toISOString();
  if (diffs.length > CLOUD_MAX_LEAF_DIFFS) {
    const snapKey = 'projects/' + projectId + '/changelog/' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + '.json';
    await env.R2.put(snapKey, JSON.stringify(prev), { httpMetadata: { contentType: 'application/json' } });
    const res = await env.DB.prepare(
      'INSERT INTO cloud_changelog (project_id, entry_type, actor_type, actor_label, section, diffs_json, snapshot_key, created_at) VALUES (?,?,?,?,?,?,?,?)'
    ).bind(projectId, entryType || 'bulk', actor.type, actor.label, null, null, snapKey, now).run();
    return { id: res.meta.last_row_id, type: entryType || 'bulk' };
  }
  const sec = cloudSectionOfDiffs(diffs);
  const res = await env.DB.prepare(
    'INSERT INTO cloud_changelog (project_id, entry_type, actor_type, actor_label, section, diffs_json, snapshot_key, created_at) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(projectId, entryType || 'edit', actor.type, actor.label, sec, JSON.stringify(diffs), null, now).run();
  return { id: res.meta.last_row_id, type: entryType || 'edit' };
}

// ---- State-path utilities (revert) ----------------------------------------

export function cloudPathSegments(p) {
  const segs = []; const s = String(p); let i = 0;
  while (i < s.length) {
    if (s[i] === '[') {
      const j = s.indexOf(']', i);
      if (j < 0) break;
      segs.push({ idx: Number(s.slice(i + 1, j)) });
      i = j + 1;
    } else if (s[i] === '.') {
      i++;
    } else {
      let j = s.indexOf('.', i); let k = s.indexOf('[', i);
      let end = s.length;
      if (j >= 0 && j < end) end = j;
      if (k >= 0 && k < end) end = k;
      segs.push({ key: s.slice(i, end) });
      i = end;
    }
  }
  return segs;
}
export function cloudPathGet(obj, p) {
  let cur = obj;
  const segs = cloudPathSegments(p);
  for (let i = 0; i < segs.length; i++) {
    if (cur === null || cur === undefined) return undefined;
    const seg = segs[i];
    cur = seg.idx !== undefined ? cur[seg.idx] : cur[seg.key];
  }
  return cur;
}
export function cloudPathSet(obj, p, val) {
  const segs = cloudPathSegments(p);
  let cur = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    if (cur === null || cur === undefined) return false;
    const seg = segs[i];
    if (seg.idx !== undefined) {
      if (!Array.isArray(cur)) return false;
      if (cur[seg.idx] === null || cur[seg.idx] === undefined) return false;
      cur = cur[seg.idx];
    } else {
      if (cur[seg.key] === null || cur[seg.key] === undefined) return false;
      cur = cur[seg.key];
    }
  }
  const last = segs[segs.length - 1];
  if (last.idx !== undefined) {
    if (!Array.isArray(cur)) return false;
    cur[last.idx] = val;
  } else {
    if (cur === null || typeof cur !== 'object' || Array.isArray(cur)) return false;
    cur[last.key] = val;
  }
  return true;
}
export function cloudPathDelete(obj, p) {
  const segs = cloudPathSegments(p);
  let cur = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    if (cur === null || cur === undefined) return;
    const seg = segs[i];
    cur = seg.idx !== undefined ? cur[seg.idx] : cur[seg.key];
  }
  const last = segs[segs.length - 1];
  if (cur === null || cur === undefined) return;
  if (last.idx !== undefined && Array.isArray(cur)) cur.splice(last.idx, 1);
  else if (last.key !== undefined && typeof cur === 'object' && !Array.isArray(cur)) delete cur[last.key];
}

// ---- RecordId-aware diff revert -------------------------------------------

export function cloudRevertDiff(s, d) {
  const m = String(d.path || '').match(/^([a-zA-Z]+)(?:\[(\d+)\])?(?:\.(.+))?$/);
  if (!m) return false;
  const listKey = m[1];
  const idxStr = m[2];
  const field = m[3];
  const list = s[listKey];
  if (!Array.isArray(list) || (field !== undefined && field.indexOf('.') !== -1)) {
    if (d.beforeAbsent) { cloudPathDelete(s, d.path); return true; }
    return cloudPathSet(s, d.path, d.before);
  }
  const isDeleteRestore = d.afterAbsent === true && d.beforeAbsent !== true && !field;
  let idx = -1;
  if (!isDeleteRestore && d.recordId !== undefined) {
    idx = list.findIndex(function(r) { return r && String(r.id) === String(d.recordId); });
    if (idx < 0) return false;
  } else if (idxStr !== undefined) {
    idx = Number(idxStr);
  }
  if (d.beforeAbsent) {
    const rec = idx >= 0 && idx < list.length ? list[idx] : null;
    if (field) {
      if (!rec) return false;
      delete rec[field];
      return true;
    }
    if (idx >= 0 && idx < list.length) list.splice(idx, 1);
    return true;
  }
  if (d.afterAbsent) {
    if (idx < 0 || idx > list.length) return false;
    if (field) {
      const rec = list[idx];
      if (!rec || typeof rec !== 'object') return false;
      rec[field] = d.before;
      return true;
    }
    list.splice(idx, 0, JSON.parse(JSON.stringify(d.before)));
    return true;
  }
  if (field) {
    if (idx < 0 || idx >= list.length) return false;
    const rec = list[idx];
    if (!rec || typeof rec !== 'object') return false;
    rec[field] = d.before;
    return true;
  }
  if (idx < 0 || idx >= list.length) return false;
  list[idx] = d.before;
  return true;
}

// ---- Cloud auth (owner/editor/viewer/adoption) ----------------------------

export const CLOUD_EDITOR_AUTH_SLOTS = 4;

export async function cloudAuthOwnerByCode(request, env, projectId, code) {
  if (!code) { await Promise.all([cloudDummyHash(), cloudTimingSink()]); return null; }
  const row = await env.DB.prepare('SELECT owner_code_salt, owner_code_hash, google_sub, google_name, deleted_at FROM cloud_projects WHERE project_id = ?').bind(projectId).first();
  if (!row) { await Promise.all([cloudDummyHash(), cloudTimingSink()]); return null; }
  const hash = await hashOwnerCode(code, row.owner_code_salt);
  if (!codesEqual(hash, row.owner_code_hash)) { await cloudTimingSink(); return null; }
  return { role: 'owner', label: row.google_name || 'Owner', row: row };
}

export async function cloudAuthOwnerSession(request, env, projectId) {
  const session = await readSession(request, env);
  if (!session || !session.sub) { await cloudTimingSink(); return null; }
  const row = await env.DB.prepare('SELECT google_sub, google_name FROM cloud_projects WHERE project_id = ?').bind(projectId).first();
  if (!row || !row.google_sub || row.google_sub !== session.sub) { await cloudTimingSink(); return null; }
  return { role: 'owner', label: row.google_name || session.name || 'Owner', row: row };
}

export async function cloudAuthOwnerEither(request, env, projectId) {
  const code = String(request.headers.get('X-Owner-Code') || '').trim();
  if (code) {
    const a = await cloudAuthOwnerByCode(request, env, projectId, code);
    if (a) return a;
  }
  return cloudAuthOwnerSession(request, env, projectId);
}

export async function cloudAuthSharedCode(request, env, projectId, code, role) {
  if (!code) { await Promise.all([cloudDummyHash(), cloudTimingSink()]); return null; }
  const rows = await env.DB.prepare('SELECT e.id, e.code_salt, e.code_hash, e.label, e.scope, p.deleted_at FROM cloud_editor_codes e JOIN cloud_projects p ON p.project_id = e.project_id WHERE e.project_id = ? AND e.active = 1 AND e.role = ?').bind(projectId, role).all();
  const active = (rows && rows.results) || [];
  const slots = Math.max(active.length, CLOUD_EDITOR_AUTH_SLOTS);
  for (let i = 0; i < slots; i++) {
    const row = active[i];
    const salt = row ? row.code_salt : CLOUD_DUMMY_SALT;
    const hash = await hashOwnerCode(code, salt);
    if (row && codesEqual(hash, row.code_hash)) {
      let scope = [];
      try { const p = JSON.parse(row.scope); if (Array.isArray(p)) scope = p.filter(function(x) { return !!CLOUD_SECTIONS[x]; }); } catch (e) { scope = []; }
      return { role: role, editorId: row.id, label: row.label || (role === 'view' ? 'Viewer' : 'Editor'), scope: scope, row: row };
    }
  }
  await cloudTimingSink();
  return null;
}

export async function cloudAuthEditor(request, env, projectId, code) {
  return cloudAuthSharedCode(request, env, projectId, code, 'editor');
}

export async function cloudAuthViewer(request, env, projectId, code) {
  return cloudAuthSharedCode(request, env, projectId, code, 'view');
}

export async function cloudAdopt(env, projectId, sub, editorCodeId, role) {
  if (!sub || !editorCodeId) return;
  const now = new Date().toISOString();
  await env.DB.prepare(
    'INSERT INTO cloud_adoptions (project_id, recipient_sub, editor_code_id, role, created_at, updated_at) VALUES (?,?,?,?,?,?) ' +
    'ON CONFLICT(project_id, recipient_sub) DO UPDATE SET editor_code_id = excluded.editor_code_id, role = excluded.role, updated_at = excluded.updated_at'
  ).bind(projectId, sub, editorCodeId, role, now, now).run();
}

export async function cloudAuthAdoption(request, env, projectId) {
  const session = await readSession(request, env);
  if (!session || !session.sub) return null;
  const ad = await env.DB.prepare(
    'SELECT editor_code_id, role FROM cloud_adoptions WHERE project_id = ? AND recipient_sub = ?'
  ).bind(projectId, session.sub).first();
  if (!ad) return null;
  const row = await env.DB.prepare(
    'SELECT e.id, e.code_salt, e.code_hash, e.label, e.scope, e.active, e.role, p.deleted_at FROM cloud_editor_codes e JOIN cloud_projects p ON p.project_id = e.project_id WHERE e.id = ?'
  ).bind(ad.editor_code_id).first();
  if (!row || row.active !== 1) return { revoked: true };
  if (row.deleted_at) return { deleted: true };
  let scope = [];
  try { const p = JSON.parse(row.scope); if (Array.isArray(p)) scope = p.filter(function(x) { return !!CLOUD_SECTIONS[x]; }); } catch (e) { scope = []; }
  return { role: row.role === 'view' ? 'view' : 'editor', editorId: row.id, label: row.label || (row.role === 'view' ? 'Viewer' : 'Editor'), scope: scope, row: row };
}

export async function cloudAuthAnyAccess(request, env, projectId) {
  const code = String(request.headers.get('X-Owner-Code') || '').trim();
  if (code) {
    const a = await cloudAuthOwnerByCode(request, env, projectId, code);
    if (a) return a;
  }
  const ecode = String(request.headers.get('X-Editor-Code') || '').trim();
  if (ecode) {
    const a = await cloudAuthEditor(request, env, projectId, ecode);
    if (a) return a;
  }
  const vcode = String(request.headers.get('X-View-Code') || '').trim();
  if (vcode) {
    const a = await cloudAuthViewer(request, env, projectId, vcode);
    if (a) return a;
  }
  const sess = await cloudAuthOwnerSession(request, env, projectId);
  if (sess) return sess;
  const ad = await cloudAuthAdoption(request, env, projectId);
  if (ad && (ad.role === 'editor' || ad.role === 'view')) return ad;
  return null;
}

// ---- Cloud purge constants -------------------------------------------------

export const CLOUD_ORPHAN_RETENTION_MS = 180 * 24 * 60 * 60 * 1000; // 180 days — was 365, tightened for sensitive company data
export const CLOUD_DELETED_PURGE_MS = 7 * 24 * 60 * 60 * 1000;
