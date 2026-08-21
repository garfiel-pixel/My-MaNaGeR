// Shared HTTP utilities extracted from worker.js.
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
    let sessRow;
    try {
      sessRow = await env.DB.prepare('SELECT revoked_at FROM auth_sessions WHERE jti = ?').bind(payload.jti).first();
    } catch (e) { return null; }
    if (!sessRow || sessRow.revoked_at) return null;
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
    const row = await env.DB.prepare('SELECT consumed_at FROM auth_tokens WHERE id = ?').bind(jti).first();
    if (!row) return null;
    if (row.consumed_at) return null;
    await env.DB.prepare('UPDATE auth_tokens SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL')
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

// ---- Auth session response (shared by register + login) --------------------

export async function authSessionResponse(user, env, emailSent) {
  const token = await signSession({ sub: user.sub, email: user.email || '', name: user.name || '', exp: Math.floor(Date.now() / 1000) + 604800 }, await sessionKey(env));
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
const CLOUD_DUMMY_SALT = '00000000000000000000000000000000';
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
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) return 'ip:' + ip;
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
  return 'anon';
}

export async function cloudRateCheck(request, bucket, env) {
  const headers = bucket === 'recover' ? ['X-Owner-Code'] : ['X-Owner-Code', 'X-Editor-Code'];
  const key = await cloudRateKey(request, headers);
  const ns = bucket + ':' + key;
  if (env && env.RATE_LIMITER) {
    const { success } = await env.RATE_LIMITER.limit({ key: ns });
    if (!success) return { limited: true, retryAfter: 60 };
    return { limited: false };
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

// ---- Cloud state read ------------------------------------------------------

export async function cloudReadState(env, key) {
  const obj = await env.R2.get(key, 'json');
  return obj || {};
}

// ---- Deep equal (for cloud state comparison) -------------------------------

export function cloudDeepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i] || !cloudDeepEqual(a[ka[i]], b[kb[i]])) return false;
  }
  return true;
}

// ---- Cloud diff utilities --------------------------------------------------

export function cloudWalkLeaves(path, v, out) {
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    for (const k of Object.keys(v)) cloudWalkLeaves(path ? path + '.' + k : k, v[k], out);
  } else {
    out.push({ path: path, value: v });
  }
}
export function cloudFlattenLeaves(obj, out) {
  out = out || [];
  cloudWalkLeaves('', obj, out);
  return out;
}
export function cloudDiffState(prev, next) {
  const a = cloudFlattenLeaves(prev), b = cloudFlattenLeaves(next);
  const map = {};
  for (const e of a) map[e.path] = { old: e.value };
  for (const e of b) {
    if (map[e.path]) { map[e.path].cur = e.value; } else { map[e.path] = { cur: e.value }; }
  }
  const diffs = [];
  for (const p of Object.keys(map)) {
    const e = map[p];
    const o = 'old' in e ? e.old : undefined;
    const c = 'cur' in e ? e.cur : undefined;
    if (JSON.stringify(o) !== JSON.stringify(c)) diffs.push({ path: p, old: o, cur: c });
  }
  return diffs;
}
export function cloudSectionOfDiffs(diffs) {
  const sections = new Set();
  for (const d of (diffs || [])) {
    const root = String(d.path || '').split('.')[0];
    if (root) sections.add(root);
  }
  return Array.from(sections);
}
export function cloudScopeMerge(prev, submitted, scope) {
  if (!submitted || typeof submitted !== 'object') return prev || {};
  const base = prev && typeof prev === 'object' ? Object.assign({}, prev) : {};
  if (scope && typeof scope === 'string' && scope !== '*') {
    const keys = scope.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    for (const k of keys) { if (k in submitted) base[k] = submitted[k]; }
    return base;
  }
  for (const k of Object.keys(submitted)) base[k] = submitted[k];
  return base;
}
export function cloudRevertDiff(s, d) {
  if (!d || !d.path) return s;
  const segs = d.path.split('.');
  const clone = JSON.parse(JSON.stringify(s));
  let cur = clone;
  for (let i = 0; i < segs.length - 1; i++) {
    if (cur === null || typeof cur !== 'object') return s;
    cur = cur[segs[i]];
  }
  if (cur === null || typeof cur !== 'object') return s;
  if (d.old === undefined) { delete cur[segs[segs.length - 1]]; } else { cur[segs[segs.length - 1]] = d.old; }
  return clone;
}

// ---- Cloud path utilities --------------------------------------------------

export function cloudPathSegments(p) {
  return String(p || '').split('.').filter(Boolean);
}
export function cloudPathGet(obj, p) {
  const segs = cloudPathSegments(p);
  let cur = obj;
  for (const s of segs) { if (cur === null || typeof cur !== 'object') return undefined; cur = cur[s]; }
  return cur;
}
export function cloudPathSet(obj, p, val) {
  const segs = cloudPathSegments(p);
  const clone = JSON.parse(JSON.stringify(obj));
  let cur = clone;
  for (let i = 0; i < segs.length - 1; i++) {
    if (cur === null || typeof cur !== 'object') return clone;
    if (typeof cur[segs[i]] !== 'object' || cur[segs[i]] === null) cur[segs[i]] = {};
    cur = cur[segs[i]];
  }
  if (cur !== null && typeof cur === 'object') cur[segs[segs.length - 1]] = val;
  return clone;
}
export function cloudPathDelete(obj, p) {
  const segs = cloudPathSegments(p);
  const clone = JSON.parse(JSON.stringify(obj));
  let cur = clone;
  for (let i = 0; i < segs.length - 1; i++) {
    if (cur === null || typeof cur !== 'object') return clone;
    cur = cur[segs[i]];
  }
  if (cur !== null && typeof cur === 'object') delete cur[segs[segs.length - 1]];
  return clone;
}

// ---- Cloud log save --------------------------------------------------------

export async function cloudLogSave(env, projectId, prev, next, actor, entryType) {
  const diffs = cloudDiffState(prev, next);
  if (!diffs.length) return;
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      'INSERT INTO cloud_changelog (project_id, entry_type, diffs_json, actor, created_at) VALUES (?,?,?,?,?)'
    ).bind(projectId, entryType || 'update', JSON.stringify(diffs), actor || 'unknown', now).run();
  } catch (e) { /* changelog write must never block a save */ }
}

// ---- Cloud purge constants -------------------------------------------------

const CLOUD_ORPHAN_RETENTION_MS = 365 * 24 * 60 * 60 * 1000; // 12 months
const CLOUD_DELETED_PURGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export { CLOUD_ORPHAN_RETENTION_MS, CLOUD_DELETED_PURGE_MS, CLOUD_PBKDF2_ITERS };
