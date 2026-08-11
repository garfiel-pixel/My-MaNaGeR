/* ============================================================
   My MaNaGeR — Thin response-decorating Worker (OBSERVABILITY-
   SECURITY-DOMAIN-EXECUTION-DIRECTIVES DIR-2, branch B)
   ------------------------------------------------------------
   Verified first: Cloudflare Workers static-assets deployments
   do NOT honor a `_headers` file the way Cloudflare Pages does.
   The only way to add response headers on this deployment type
   is a Worker `fetch()` handler that serves the assets via the
   automatic `ASSETS` binding (see wrangler.jsonc `main` field)
   and decorates every response. This is the app's FIRST
   server-side code — deliberately the thinnest possible: no
   state, no storage, no bindings beyond ASSETS, zero behavior
   change for the app. It only adds headers and passes the body
   through untouched (status/body preserved, streamed).

   The CSP below was built from a VERIFIED inventory of this
   app's actual origins (skeptical audit, not a generic
   template):
     - script-src: same-origin JS + the pinned Three.js CDN
       (unpkg.com, three@0.160.0, js/mmgr-glass.js dynamic
       import) + SHA-256 hashes of every inline <script> block
       in the served pages (recompute via the node command
       listed below when any inline script changes — a stale
       hash silently blocks that page) + 'wasm-unsafe-eval'
       (the bundled whisper WASM runtime instantiates).
     - connect-src: 'self' + https: (BYO-endpoint design: AI
       providers, weather, whisper model on huggingface.co,
       and the DIR-1b user-supplied webhook are all arbitrary
       https origins the app cannot enumerate) + blob: (whisper
       bundled-model fallback passes the model via a blob URL).
     - style-src 'unsafe-inline': admin.html ships inline
       style attributes; hashing them all is not feasible.
     - GOOGLE-OPERATOR-IDENTITY-v1 (optional operator identity):
       script-src allows the Google Identity Services hosts
       (accounts.google.com, apis.google.com); connect-src allows
       oauth2.googleapis.com (server-side ID-token verify); frame-src
       allows accounts.google.com — the GIS sign-in button iframe.
       frame-ancestors 'none' is unchanged (the app still refuses to
       be framed; frame-src only lets the app embed Google's button).
     - frame-ancestors 'none' + X-Frame-Options: DENY (belt and
       suspenders against clickjacking).

   Regenerate inline-script hashes after editing any inline
   <script> in a served .html file:
     node -e "const fs=require('fs'),c=require('crypto');for(const f of ['project.html','app.html','admin.html','dashboard.html','seed-test.html','mymanager-field-guide.html','monolith html to reference from all features.html']){const h=fs.readFileSync(f,'utf8');let m;const re=/<script>([\s\S]*?)<\/script>/g;let i=0;while((m=re.exec(h))!==null){i++;console.log(f,'#'+i,'sha256-'+c.createHash('sha256').update(m[1]).digest('base64'));}}"
   ============================================================ */

// The five required headers (DIR-2). CSP hash list must match the
// current served inline scripts — see the regen command above.
// IMPORTANT construction rule: every SHA-256 hash source must stay INSIDE the
// script-src directive (space-separated). A hash on its own line joined with
// ';' becomes an invalid standalone directive and the browser rejects the
// WHOLE policy — silently breaking every inline script (verified the hard
// way during implementation; the qa battery catches it via console errors).
const INLINE_SCRIPT_HASHES = [
  "'sha256-gCwlAVKUNamFRjZeFSwcBd1zxQs+/mZ2GoLF8lqT/II='", // project.html (early-apply theme snippet)
  "'sha256-o+0No2XpbES4E5QJh31mY9JsJFqSmE+B4x+z1fNPjVc='", // project.html
  "'sha256-gCwlAVKUNamFRjZeFSwcBd1zxQs+/mZ2GoLF8lqT/II='", // app.html (early-apply theme snippet)
  "'sha256-gh1pJ1rSyd7LP4eITg17YwZIFfNkKQgLCGxUMAf1tkc='", // app.html
  "'sha256-qbHZHLyhdEDRwWrA8/I8ty4xIjUv+L/+Y6/0cIXdkJo='", // admin.html (early-apply theme snippet)
  "'sha256-zTSNRzMhnvwuiiAKdVsLTpLHaN9XACR8m4E6jrA8VU0='", // admin.html
  "'sha256-Oa7ON+9A164SSXhnxu08mFn0V9Tj2SlZ2SzFXFoqKNE='", // dashboard.html
  "'sha256-DRiA9m7qJLb4z1QyfjbEUFyubzWHRCl2Cgf+YJkjyi8='", // seed-test.html
  "'sha256-l7T1LLezhae1ZGfmUGxTadrqmveWG2jA4nLGwRkmB3k='", // mymanager-field-guide.html
  "'sha256-c2U+m5SzyupzeOrPEiOjlnaSgS1KdAxZTFnYA5dW/Rk='", // monolith ref (block 1)
  "'sha256-3TjcOBgQeATMpPC1MUJPRDjeq7SvgohH62pIViDmtnk='"  // monolith ref (block 2)
].join(' ');

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' https://unpkg.com https://accounts.google.com https://apis.google.com " + INLINE_SCRIPT_HASHES,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' https: https://accounts.google.com https://oauth2.googleapis.com blob:",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-src https://accounts.google.com",
  "frame-ancestors 'none'"
].join('; ');

const HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(self), geolocation=(), payment=(), usb=()'
};

// WHISPER-CSP (QA-STRESS DIR-2 finding, Aug 2026): the bundled offline
// whisper runtime (vendor/whisper/) runs its Emscripten glue inside a
// module worker, and that glue builds function invokers with `new Function`
// (Asyncify invoker generation + embind method callers). Chrome enforces
// the CSP delivered WITH THE WORKER SCRIPT for the worker's own script
// execution — NOT the embedding document's CSP (probe-verified: the
// tools/csp-probe* harness shows evalAllowed:true when only the worker
// script's response is relaxed). So the app pages keep the STRICT CSP
// above, and ONLY this vendored, trusted whisper subtree gets the eval
// allowance it needs. Must stay in sync with serve.cjs's WHISPER_CSP.
const WHISPER_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join('; ');

// Collapse '.'/'..' path segments so the whisper-path test below can never
// be fooled by traversal (/vendor/whisper/../../js/x.js). Mirrors what a
// browser/static host would resolve the URL to before serving.
function normalizePathname(p) {
  const out = [];
  const segs = String(p).split('/');
  for (const seg of segs) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') { out.pop(); continue; }
    out.push(seg);
  }
  return '/' + out.join('/');
}

/* ============================================================
   GOOGLE-OPERATOR-IDENTITY-v1 — optional operator identity
   ------------------------------------------------------------
   Google Sign-In is an OPTIONAL operator-identity layer ONLY. It
   never replaces, bypasses, or weakens per-project access codes
   (those are enforced client-side by SHA-256 hash checks against
   projects-data.js and are unchanged). The Client Secret never
   appears in this file or any client-shipped asset — it is read
   exclusively from the Wrangler secret env.GOOGLE_CLIENT_SECRET.

   Session model: after the Worker verifies a Google ID token via
   the (unauthenticated) tokeninfo endpoint — aud, iss, and exp
   all checked — it sets an HttpOnly Secure SameSite=Lax cookie
   named mmgr_session. The cookie is HMAC-SHA256-signed with the
   Client Secret so it cannot be forged or edited client-side.
   /api/auth/me reads the cookie (server-side only, never exposed
   to JS); /api/auth/logout clears it. No server-side session
   storage: stateless and durable across Worker restarts.
   ============================================================ */

// Public Client ID (safe to ship — also embedded in the frontend).
// Prefers env.GOOGLE_CLIENT_ID when set in wrangler.jsonc.
const GOOGLE_CLIENT_ID = '297970704704-m05hgt93lfaq286q90br8c96ffg1aph3.apps.googleusercontent.com';
const SESSION_COOKIE = 'mmgr_session';
const SESSION_MAX_AGE = 604800; // 7 days, seconds (spec: Max-Age=604800)

// JSON responses for the API — never the page CSP, always no-store.
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

/* ============================================================
   BYO-AI-KEY-SESSION-ONLY-v1 STEP-5 — /api/ai/chat relay
   ------------------------------------------------------------
   Stateless forwarder ONLY: the user's key is read from the per-request
   X-User-Api-Key header (or the body apiKey field) for that single request,
   forwarded to the provider endpoint over HTTPS, and never persisted. The
   key is not logged, not written to any binding (KV/D1/secrets), and never
   echoed in any error response. Enforced: max body size + hard upstream
   timeout. Missing key -> 401; bad body -> 400.
   ============================================================ */
const AI_PROVIDERS = {
  openai: { url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
  // MODEL-FALLBACK-LADDER fast-follow (DIR-5): Anthropic joins the relay so
  // relay-hosted deployments get the same ladder as the direct path. The
  // Messages API authenticates with x-api-key + anthropic-version headers and
  // returns text in content[].text (handled below).
  anthropic: { url: 'https://api.anthropic.com/v1/messages', model: 'claude-3-5-sonnet-latest' },
  // GEMINI-MODEL-FALLBACK-LADDER (DIR-2): the Gemini model name is embedded in
  // the URL path, so the upstream URL is built per request via geminiUrl() —
  // the static default above is only a fallback. The client drives the model
  // ladder THROUGH this relay (DIR-3): each attempt posts a validated `model`
  // field and the relay forwards to exactly that model; capacity statuses
  // (429/503) pass through with their own status so the client can advance.
  'google-gemini': { url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent', model: 'gemini-flash-latest' }
};
// Strict model-id validation: the value is interpolated into the upstream URL
// path, so it must be a plain Gemini model id (letters/digits/dash/dot/underscore
// only — no slashes/colons/query): path-injection guard. Invalid -> default.
const GEMINI_MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
function geminiUrl(model) {
  return 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent';
}
const AI_BODY_LIMIT_BYTES = 262144; // 256 KB max request body
const AI_TIMEOUT_MS = 30000;        // hard upstream timeout

// OpenAI-style [{role,content}] -> Gemini generateContent payload.
function aiGeminiPayload(messages) {
  let system = '';
  const contents = [];
  (messages || []).forEach(function(m) {
    if (m && m.role === 'system') system += (system ? '\n' : '') + (m.content || '');
    else if (m && m.content) contents.push({ role: (m.role === 'assistant' || m.role === 'model') ? 'model' : 'user', parts: [{ text: m.content }] });
  });
  const p = { contents: contents };
  if (system) p.systemInstruction = { parts: [{ text: system }] };
  return p;
}

function aiExtractText(provider, data) {
  if (provider === 'google-gemini') {
    return data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts
      ? data.candidates[0].content.parts.map(function(p) { return p.text || ''; }).join('') : null;
  }
  if (provider === 'anthropic') {
    return data && Array.isArray(data.content)
      ? data.content.map(function(c) { return (c && c.type === 'text' && c.text) ? c.text : ''; }).join('') : null;
  }
  return data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
}

// OpenAI-style [{role,content}] -> Anthropic Messages API payload (mirror of
// mmgr-ai.js anthropicPayload): system split out, max_tokens required.
function aiAnthropicPayload(model, messages) {
  let system = '';
  const msgs = [];
  (messages || []).forEach(function(m) {
    if (m && m.role === 'system') system += (system ? '\n' : '') + (m.content || '');
    else if (m && m.content) msgs.push({ role: (m.role === 'assistant' || m.role === 'model') ? 'assistant' : 'user', content: m.content });
  });
  const p = { model: model, max_tokens: 4096, messages: msgs };
  if (system) p.system = system;
  return p;
}

// Read + parse the JSON body with a hard size cap. Content-Length alone is
// not enough (string bodies from browsers often omit it), so the stream is
// read with a running byte budget and abandoned once it exceeds the limit.
async function readAiBody(request) {
  const cl = Number(request.headers.get('Content-Length') || 0);
  if (cl > AI_BODY_LIMIT_BYTES) return { tooLarge: true };
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
      if (total > AI_BODY_LIMIT_BYTES) return { tooLarge: true };
      chunks.push(res.value);
    }
  }
  const bytes = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { bytes.set(c, off); off += c.byteLength; }
  const text = new TextDecoder().decode(bytes);
  try { return { body: JSON.parse(text) }; } catch (e) { return { bad: true }; }
}

async function handleAiChat(request) {
  const read = await readAiBody(request);
  if (read.tooLarge) return json({ ok: false, error: 'body too large' }, 413);
  if (read.bad) return json({ ok: false, error: 'bad request' }, 400);
  const body = read.body;
  if (!body || typeof body !== 'object') return json({ ok: false, error: 'bad request' }, 400);
  const provider = String(body.provider || '').toLowerCase();
  if (!AI_PROVIDERS[provider]) return json({ ok: false, error: 'unsupported provider' }, 400);
  // GEMINI-MODEL-FALLBACK-LADDER (DIR-3): optional per-attempt model override
  // (client-driven ladder). Strictly validated; an invalid value falls back
  // to the provider default instead of erroring.
  const reqModel = (typeof body.model === 'string' && GEMINI_MODEL_RE.test(body.model)) ? body.model : null;
  const model = reqModel || AI_PROVIDERS[provider].model;
  // Key for THIS request only — header preferred, body field accepted.
  const key = String(request.headers.get('X-User-Api-Key') || '').trim()
    || (typeof body.apiKey === 'string' ? String(body.apiKey).trim() : '');
  if (!key) return json({ ok: false, error: 'missing api key' }, 401);
  if (!Array.isArray(body.messages) || !body.messages.length) return json({ ok: false, error: 'bad request' }, 400);
  const ctrl = new AbortController();
  const timer = setTimeout(function() { ctrl.abort(); }, AI_TIMEOUT_MS);
  let upstream;
  try {
    const isGemini = provider === 'google-gemini';
    const isAnthropic = provider === 'anthropic';
    upstream = await fetch(isGemini ? geminiUrl(model) : AI_PROVIDERS[provider].url, {
      method: 'POST',
      headers: isGemini
        ? { 'Content-Type': 'application/json', 'x-goog-api-key': key }
        : isAnthropic
          ? { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }
          : { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify(isGemini ? aiGeminiPayload(body.messages) : isAnthropic ? aiAnthropicPayload(model, body.messages) : { model: model, messages: body.messages }),
      signal: ctrl.signal
    });
  } catch (e) {
    clearTimeout(timer);
    return json({ ok: false, error: 'upstream unreachable or timed out' }, 502);
  }
  clearTimeout(timer);
  if (!upstream.ok) {
    // Provider auth failures surface as 401 so the client clears its session
    // key (STEP-4). The key itself is never echoed anywhere.
    if (upstream.status === 401 || upstream.status === 403) return json({ ok: false, error: 'provider rejected the key' }, 401);
    // GEMINI-MODEL-FALLBACK-LADDER (DIR-3): capacity rejections (429 rate
    // limit / 503 overload) pass through with their own status so the client's
    // model ladder can detect them and retry the NEXT model through this same
    // relay. Everything else collapses to a generic 502.
    if (upstream.status === 429 || upstream.status === 503) return json({ ok: false, error: 'provider rate limited (HTTP ' + upstream.status + ')' }, upstream.status);
    return json({ ok: false, error: 'provider error ' + upstream.status }, 502);
  }
  let data;
  try { data = await upstream.json(); } catch (e) { return json({ ok: false, error: 'bad provider response' }, 502); }
  const text = aiExtractText(provider, data);
  if (!text) return json({ ok: false, error: 'empty provider response' }, 502);
  // Echo the model that actually answered so the client can report it (DIR-4).
  return json({ ok: true, text: String(text), model: model });
}

function base64UrlEncode(str) {
  let bin = '';
  for (const b of new TextEncoder().encode(str)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64UrlDecode(b64) {
  const s = String(b64).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function base64UrlToBytes(b64) {
  const s = String(b64).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function bytesToBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Verify a Google ID token with oauth2.googleapis.com/tokeninfo (no Client
// Secret needed for this endpoint). Rejects on: non-OK response, aud
// mismatch, iss mismatch, or expired exp. Returns a sanitized user object.
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
  // A token without a subject is useless for identity — reject it outright.
  const sub = payload.sub ? String(payload.sub) : '';
  if (!sub) return null;
  return {
    sub: sub,
    email: typeof payload.email === 'string' ? payload.email : '',
    name: typeof payload.name === 'string' ? payload.name : '',
    picture: typeof payload.picture === 'string' ? payload.picture : ''
  };
}

// HMAC key for signing session cookies. Client Secret from the Wrangler
// secret env.GOOGLE_CLIENT_SECRET is preferred; when absent (e.g. local
// wrangler dev without the secret) a per-instance random key is used — the
// cookie then only survives for that Worker instance, which is fine for
// local testing and never weakens access codes.
let _fallbackSessionKeyPromise = null;
async function sessionKey(env) {
  const secret = env && typeof env.GOOGLE_CLIENT_SECRET === 'string' && env.GOOGLE_CLIENT_SECRET.length
    ? env.GOOGLE_CLIENT_SECRET : null;
  if (secret) {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  }
  // Cache the PROMISE, not the resolved key: concurrent /api/auth/* requests
  // must share one key, or a sign/verify pair across the race would look like
  // a tampered cookie (review finding).
  if (!_fallbackSessionKeyPromise) {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    let bin = '';
    for (let i = 0; i < raw.length; i++) bin += String.fromCharCode(raw[i]);
    _fallbackSessionKeyPromise = crypto.subtle.importKey('raw', new TextEncoder().encode(bin), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  }
  return _fallbackSessionKeyPromise;
}

async function signSession(payload, key) {
  const jsonStr = JSON.stringify(payload);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(jsonStr));
  return base64UrlEncode(jsonStr) + '.' + bytesToBase64Url(new Uint8Array(sig));
}

// Read + verify the mmgr_session cookie. Returns the session payload or null.
async function readSession(request, env) {
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
  return payload;
}

/* ============================================================
   CLOUD-BACKEND-ARCHITECTURE-PLAN Phase 1 — /api/cloud/*
   ------------------------------------------------------------
   D1 + R2 cloud project storage. OPT-IN per project: a local-only
   project never touches these routes (the app's offline-first
   behavior is unchanged). One D1 row per project:

     - project_id: the sanitized LOCAL project id (same id on every
       device) — the natural key for "my project lives in the cloud".
     - owner_code: generated here, hashed (PBKDF2-SHA256, per-project
       random salt) and NEVER stored or logged in plaintext. The
       plaintext is returned exactly once, at create/recover time.
     - google_sub: linked when the create request carries a valid
       mmgr_session cookie (the owner's Google account). Owner-code
       recovery is gated on this: only the linked Google account can
       reissue a lost code (Garfield's decision, plan §9).
     - latest_r2_key: D1 rows reference the R2 object; the actual
       state JSON blob lives in R2 (plan §2).

   Existence is not leaked: unknown project id, wrong owner code,
   missing code, and unlinked recovery all return the SAME generic
   403 (cloudForbidden). An attacker cannot distinguish "no such
   project" from "bad code" (user's check 5).

   Session model reuses GOOGLE-OPERATOR-IDENTITY-v1: the HttpOnly
   mmgr_session cookie is the only proof of Google identity; the
   frontend never ships the sub claim itself.
   ============================================================ */
const CLOUD_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
const CLOUD_PBKDF2_ITERS = 100000;
const CLOUD_BODY_LIMIT_BYTES = 8388608; // 8 MB — state can include voice/claim data

// 16 chars from a 32-char unambiguous alphabet -> ~80 bits of entropy,
// formatted XXXX-XXXX-XXXX-XXXX. crypto.getRandomValues, never Math.random.
function randomOwnerCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let code = '';
  for (let i = 0; i < bytes.length; i++) code += CLOUD_CODE_ALPHABET[bytes[i] % 32];
  return code.slice(0, 4) + '-' + code.slice(4, 8) + '-' + code.slice(8, 12) + '-' + code.slice(12, 16);
}

// The local project id becomes the cloud row's primary key. Only safe slug
// chars survive; anything else is rejected (never stored).
function sanitizeProjectId(raw) {
  const s = String(raw || '').trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : null;
}

// Fresh 16-byte salt per project (hex). Stored next to the hash.
function randomSaltHex() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

// PBKDF2-SHA256(salt, code) -> 32-byte hex. The code itself is never
// retained; only this derived value is persisted.
async function hashOwnerCode(code, saltHex) {
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

// Constant-time comparison (same XOR-accumulate pattern as readSession).
function codesEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// TIMING-SIDE-CHANNEL GUARD (review finding): the unknown-project path must
// cost the SAME wall-clock as the known-project-wrong-code path. PBKDF2 at
// 100k iterations takes ~5-50ms; an unknown id that returns instantly would
// let an attacker distinguish "no such project" from "bad code" by timing
// alone — the exact leak check 5 forbids. So every "no row" branch runs one
// dummy PBKDF2 with a fixed code/salt before returning the generic 403.
const CLOUD_DUMMY_CODE = 'ZZZZ-ZZZZ-ZZZZ-ZZZZ';
const CLOUD_DUMMY_SALT = '00000000000000000000000000000000';
// REVIEW FIX (timing existence leak): NEVER cache the dummy hash. A cached
// promise made repeat unknown-project probes resolve in ~0ms while a
// known-project wrong-code probe pays a real 100k-iteration PBKDF2 (~5-50ms)
// — wall-clock then leaks project existence (check 5). Uncached, every
// failure probe burns the same real PBKDF2 work as the honest path.
async function cloudDummyHash() {
  return hashOwnerCode(CLOUD_DUMMY_CODE, CLOUD_DUMMY_SALT);
}
// Also drain a fixed deadline on the fast paths so even the dummy-hash
// shortcut cannot be profiled to sub-millisecond precision.
const CLOUD_TIMING_FLOOR_MS = 15;
function cloudTimingSink() {
  return new Promise(function(resolve) {
    setTimeout(resolve, CLOUD_TIMING_FLOOR_MS);
  });
}

// The ONE 403 shape for every auth failure on cloud routes — unknown
// project, wrong code, missing code, and unlinked recovery are
// indistinguishable on purpose (no existence leak).
function cloudForbidden() {
  return json({ ok: false, error: 'invalid project or owner code' }, 403);
}

// ---- CLOUD RATE LIMITING (gap-audit item A1) -----------------------------
// Cheap hammer-deterrent + cost-inflation guard for the cloud endpoints.
// Code entropy is ~80 bits so brute force is not the threat model — the risk
// is a scripted loop hammering meta/load/save thousands of times a minute
// against our own D1/R2 usage. This is an IN-MEMORY sliding window, which on
// Cloudflare Workers is per-isolate and best-effort (isolates are ephemeral)
// — deliberately noted as such: it deters and smooths abuse, but at true
// scale the platform rate-limiting product (or D1-level backpressure) is the
// real control. Limits are generous so legit multi-device flows never trip.
// Keys: CF-Connecting-IP when present, else a SHA-256 of the presented code
// (never the raw code in memory beyond the request), else 'anon'.
const CLOUD_RATE = {
  general: { max: 120, windowMs: 60000 },
  recover: { max: 6, windowMs: 60000 } // recovery is the sensitive reissue path
};
const _cloudBuckets = new Map();
async function cloudRateKey(request, headerNames) {
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
function cloudRateAllow(key, cfg) {
  const now = Date.now();
  let list = _cloudBuckets.get(key);
  if (!list) { list = []; _cloudBuckets.set(key, list); }
  while (list.length && list[0] <= now - cfg.windowMs) list.shift();
  if (list.length >= cfg.max) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((list[0] + cfg.windowMs - now) / 1000)) };
  }
  list.push(now);
  // Bound memory: drop buckets that have gone quiet for two windows.
  if (_cloudBuckets.size > 10000) {
    for (const [k, v] of _cloudBuckets) {
      if (!v.length || v[v.length - 1] <= now - cfg.windowMs * 2) _cloudBuckets.delete(k);
    }
  }
  return { allowed: true };
}
async function cloudRateCheck(request, bucket) {
  const cfg = CLOUD_RATE[bucket] || CLOUD_RATE.general;
  const headers = bucket === 'recover' ? ['X-Owner-Code'] : ['X-Owner-Code', 'X-Editor-Code'];
  const key = await cloudRateKey(request, headers);
  const r = cloudRateAllow(key, cfg);
  if (!r.allowed) return { limited: true, retryAfter: r.retryAfter };
  return { limited: false };
}
function cloudRateLimited(retryAfter) {
  return new Response(JSON.stringify({ ok: false, error: 'too many requests — slow down and try again in a minute' }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Retry-After': String(retryAfter || 60)
    }
  });
}

// ---- CORS POLICY (gap-audit item A2) -------------------------------------
// Deliberate and explicit: the API is SAME-ORIGIN ONLY. Every browser
// cross-origin fetch sends an Origin header; it must match this Worker's own
// origin or the request is rejected outright (403), and API responses NEVER
// carry an Access-Control-Allow-Origin header — so a cross-origin read is
// impossible even for a request a browser would otherwise let through. This
// turns the current "fine because the app is same-origin" default into a
// written, enforced policy that a future refactor cannot accidentally open.
function sameOriginOnly(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return true; // non-browser / same-origin GETs — no CORS involved
  try {
    const u = new URL(request.url);
    const o = new URL(origin);
    return o.origin === u.origin;
  } catch (e) { return false; }
}

// Size-capped body reader (mirror of readAiBody with a larger budget).
async function readCloudBody(request) {
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


/* ============================================================
   CLOUD-BACKEND-ARCHITECTURE-PLAN Phase 2 + 3 — editor codes,
   server-side section scoping, changelog with revert, and admin
   cloud visibility.
   ------------------------------------------------------------
   Phase 2 (editor codes):
     - CLOUD_SECTIONS is the single source of truth for what a
       section may WRITE (top-level state keys -> section).
     - Editor codes are hashed exactly like owner codes (per-code
       random salt + PBKDF2-SHA256, constant-time compare, never
       stored or logged in plaintext) and carry a scope: the owner
       toggles which sections the code can touch.
     - SCOPE IS ENFORCED HERE, SERVER-SIDE, on every editor save:
       the Worker merges ONLY the granted sections' state keys
       into the stored blob and carries everything else over from
       the previous snapshot. An editor (or an attacker holding a
       compromised editor code) physically cannot write outside
       the grant — the UI greying-out is UX only; this is the
       control. Out-of-grant differences are reported back as
       `blocked` so the UI can warn honestly.
   Phase 3 (changelog):
     - Every save (owner or editor) diffs the previous blob against
       the new one at LEAF granularity for the content keys and
       stores field-level before/after diffs (plan §5 option A).
       When a save touches more than CLOUD_MAX_LEAF_DIFFS leaves
       (bulk import / paste / AI generation), the pre-save blob is
       snapshotted to R2 and referenced instead (option B).
     - Revert is owner-only and never erases history: it applies
       the recorded before-values (or restores the snapshot) and
       logs a NEW 'revert' changelog row describing exactly what
       was changed back. A revert of a revert restores the
       pre-revert state — every entry is itself reversible.
   Admin visibility:
     - GET /api/cloud/admin/projects lists cloud-linked projects
       for the operator, gated by the ADMIN_CODE Wrangler secret
       (X-Admin-Code header). When ADMIN_CODE is not configured the
       endpoint answers 503 and leaks nothing. Owner-code reissue
       on the admin page reuses /recover, which already enforces
       plan §9: the requester's Google sub must match the record
       on file.
   ============================================================ */

// ---- canonical writable sections (Phase 2 scope vocabulary) ----
// One top-level state key belongs to EXACTLY one section. View-only
// panels (dash/def/kan/gantt/claim) read derived data and are not
// independently writable, so they are not scoping targets.
const CLOUD_SECTIONS = {
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
const CLOUD_KEY_TO_SECTION = {};
const CLOUD_CONTENT_KEYS = [];
Object.keys(CLOUD_SECTIONS).forEach(function(sec) {
  CLOUD_SECTIONS[sec].keys.forEach(function(k) {
    CLOUD_KEY_TO_SECTION[k] = sec;
    CLOUD_CONTENT_KEYS.push(k);
  });
});
const CLOUD_CONTENT_KEY_SET = {};
CLOUD_CONTENT_KEYS.forEach(function(k) { CLOUD_CONTENT_KEY_SET[k] = 1; });

// Changelog leaf-diff cap: a save touching more leaves than this is a
// bulk operation and falls back to the snapshot path (plan §5 option B).
const CLOUD_MAX_LEAF_DIFFS = 40;

function cloudDeepEqual(a, b) {
  try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return a === b; }
}

// Read the latest state blob for a project (null when none exists).
async function cloudReadState(env, key) {
  if (!key) return null;
  const obj = await env.R2.get(key);
  if (!obj) return null;
  const text = await obj.text();
  try { return JSON.parse(text); } catch (e) { return null; }
}

// ---- owner identity: owner code OR the linked Google session ----
// Mirrors the timing discipline of the Phase 1 paths: unknown project,
// wrong code, missing code, unlinked session all burn the same
// dummy-PBKDF2 + timing floor before returning null (no existence leak).
async function cloudAuthOwnerByCode(request, env, projectId, code) {
  if (!code) { await Promise.all([cloudDummyHash(), cloudTimingSink()]); return null; }
  const row = await env.DB.prepare('SELECT owner_code_salt, owner_code_hash, google_sub, google_name FROM cloud_projects WHERE project_id = ?').bind(projectId).first();
  if (!row) { await Promise.all([cloudDummyHash(), cloudTimingSink()]); return null; }
  const hash = await hashOwnerCode(code, row.owner_code_salt);
  if (!codesEqual(hash, row.owner_code_hash)) { await cloudTimingSink(); return null; }
  return { role: 'owner', label: row.google_name || 'Owner', row: row };
}
async function cloudAuthOwnerSession(request, env, projectId) {
  const session = await readSession(request, env);
  if (!session || !session.sub) { await cloudTimingSink(); return null; }
  const row = await env.DB.prepare('SELECT google_sub, google_name FROM cloud_projects WHERE project_id = ?').bind(projectId).first();
  if (!row || !row.google_sub || row.google_sub !== session.sub) { await cloudTimingSink(); return null; }
  return { role: 'owner', label: row.google_name || session.name || 'Owner', row: row };
}
async function cloudAuthOwnerEither(request, env, projectId) {
  const code = String(request.headers.get('X-Owner-Code') || '').trim();
  if (code) {
    const a = await cloudAuthOwnerByCode(request, env, projectId, code);
    if (a) return a;
  }
  return cloudAuthOwnerSession(request, env, projectId);
}

// ---- editor identity: active editor code for this project ----
// Every failure path (missing code / no row / revoked / wrong code)
// returns null after the same dummy-PBKDF2 + timing floor as owner.
// REVIEW FIX (timing side-channel): the number of PBKDF2 ops must not depend
// on how many active editor codes exist — that count would be observable in
// response time and would leak project existence (check 5). Always burn
// exactly max(active.length, CLOUD_EDITOR_AUTH_SLOTS) hashes: real row salts
// where rows exist, the dummy salt otherwise (dummy is itself a real hash).
// The submitted code is compared at every real slot, so a code issued for any
// active row authenticates; an attacker probing with a wrong code cannot
// distinguish unknown/1-code/N-code projects by timing.
const CLOUD_EDITOR_AUTH_SLOTS = 4;
async function cloudAuthEditor(request, env, projectId, code) {
  if (!code) { await Promise.all([cloudDummyHash(), cloudTimingSink()]); return null; }
  const rows = await env.DB.prepare('SELECT id, code_salt, code_hash, label, scope FROM cloud_editor_codes WHERE project_id = ? AND active = 1').bind(projectId).all();
  const active = (rows && rows.results) || [];
  const slots = Math.max(active.length, CLOUD_EDITOR_AUTH_SLOTS);
  for (let i = 0; i < slots; i++) {
    const row = active[i];
    const salt = row ? row.code_salt : CLOUD_DUMMY_SALT;
    const hash = await hashOwnerCode(code, salt);
    if (row && codesEqual(hash, row.code_hash)) {
      let scope = [];
      try { const p = JSON.parse(row.scope); if (Array.isArray(p)) scope = p.filter(function(x) { return !!CLOUD_SECTIONS[x]; }); } catch (e) { scope = []; }
      return { role: 'editor', editorId: row.id, label: row.label || 'Editor', scope: scope, row: row };
    }
  }
  await cloudTimingSink();
  return null;
}

// ---- SERVER-SIDE SCOPE ENFORCEMENT (Phase 2, plan §3) -----------
// An editor's save is merged, never trusted wholesale: the new blob is
// the previous blob with ONLY the granted sections' state keys replaced
// by the submission. Anything outside the grant is carried over from the
// previous blob (physically impossible to change), and content-key
// differences outside the grant are reported as `blocked`. Metadata
// (updatedAt/fieldTs/...) is server-managed, never taken from an editor
// submission. fieldTs is kept consistent so the app's per-field
// last-write-wins merge sees the editor's applied keys as fresh.
function cloudScopeMerge(prev, submitted, scope) {
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
    // non-content keys (fieldTs, updatedAt, config, flags, ...) are
    // silently ignored — they never flow out of an editor's grant.
  });
  // Server-managed metadata: fieldTs carries over, and applied keys get a
  // fresh stamp so the blob's timestamp map matches what it contains.
  if (prev && prev.fieldTs && typeof prev.fieldTs === 'object' && !Array.isArray(prev.fieldTs)) {
    base.fieldTs = JSON.parse(JSON.stringify(prev.fieldTs));
  }
  const now = new Date().toISOString();
  applied.forEach(function(sec) {
    (CLOUD_SECTIONS[sec] || { keys: [] }).keys.forEach(function(k) {
      if (base.fieldTs && typeof base.fieldTs === 'object') base.fieldTs[k] = now;
    });
  });
  delete base.updatedAt; // caller stamps a fresh updatedAt
  return { next: base, applied: applied, blocked: blocked };
}

// ---- Phase 3 changelog: leaf-level diffing + snapshot fallback ----
function cloudWalkLeaves(path, v, out) {
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
function cloudFlattenLeaves(obj, out) {
  CLOUD_CONTENT_KEYS.forEach(function(k) { cloudWalkLeaves(k, obj ? obj[k] : undefined, out); });
}
function cloudDiffState(prev, next) {
  if (!prev || typeof prev !== 'object') return null; // first save — nothing to diff
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
function cloudSectionOfDiffs(diffs) {
  let sec = null;
  for (let i = 0; i < diffs.length; i++) {
    const s = CLOUD_KEY_TO_SECTION[String(diffs[i].path).split(/[.[]/)[0]];
    if (s === undefined) continue;
    if (sec === null) sec = s;
    else if (sec !== s) return 'multiple';
  }
  return sec;
}

// Record one changelog row for a save. Returns {id,type} or null when
// nothing changed / first save. Field-level 'edit' for <= cap leaves,
// snapshot 'bulk' above it.
async function cloudLogSave(env, projectId, prev, next, actor) {
  const diffs = cloudDiffState(prev, next);
  if (diffs === null || diffs.length === 0) return null;
  const now = new Date().toISOString();
  if (diffs.length > CLOUD_MAX_LEAF_DIFFS) {
    const snapKey = 'projects/' + projectId + '/changelog/' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + '.json';
    await env.R2.put(snapKey, JSON.stringify(prev), { httpMetadata: { contentType: 'application/json' } });
    const res = await env.DB.prepare(
      'INSERT INTO cloud_changelog (project_id, entry_type, actor_type, actor_label, section, diffs_json, snapshot_key, created_at) VALUES (?,?,?,?,?,?,?,?)'
    ).bind(projectId, 'bulk', actor.type, actor.label, null, null, snapKey, now).run();
    return { id: res.meta.last_row_id, type: 'bulk' };
  }
  const sec = cloudSectionOfDiffs(diffs);
  const res = await env.DB.prepare(
    'INSERT INTO cloud_changelog (project_id, entry_type, actor_type, actor_label, section, diffs_json, snapshot_key, created_at) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(projectId, 'edit', actor.type, actor.label, sec, JSON.stringify(diffs), null, now).run();
  return { id: res.meta.last_row_id, type: 'edit' };
}

// ---- state-path utilities (revert) ------------------------------
function cloudPathSegments(p) {
  // Tokenizes 'a.b[2].c' into [{key:'a'},{key:'b'},{idx:2},{key:'c'}].
  // The '.' separator must be SKIPPED, never treated as an empty key —
  // the original parser looped forever on any dotted path (found by
  // qa-cloud-phase2 P3.2c: the revert request hung and the worker wedged).
  const segs = []; const s = String(p); let i = 0;
  while (i < s.length) {
    if (s[i] === '[') {
      const j = s.indexOf(']', i);
      if (j < 0) break;
      segs.push({ idx: Number(s.slice(i + 1, j)) });
      i = j + 1;
    } else if (s[i] === '.') {
      i++; // skip separator
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
function cloudPathGet(obj, p) {
  let cur = obj;
  const segs = cloudPathSegments(p);
  for (let i = 0; i < segs.length; i++) {
    if (cur === null || cur === undefined) return undefined;
    const seg = segs[i];
    cur = seg.idx !== undefined ? cur[seg.idx] : cur[seg.key];
  }
  return cur;
}
// REVIEW FIX: never fabricate missing intermediate containers. Reverting a
// leaf whose parent element was deleted (e.g. tasks[0].name after tasks[0]
// was removed) must not resurrect a partial shell ({name:...} with no
// id/status/dates). Returns true only when the write actually landed.
function cloudPathSet(obj, p, val) {
  const segs = cloudPathSegments(p);
  let cur = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    if (cur === null || cur === undefined) return false;
    const seg = segs[i];
    const next = segs[i + 1];
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
function cloudPathDelete(obj, p) {
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

// ---- editor code management (owner-only) -------------------------
// GET /api/cloud/sections — canonical section vocabulary (public).
function handleCloudSections() {
  const sections = Object.keys(CLOUD_SECTIONS).map(function(k) {
    return { key: k, label: CLOUD_SECTIONS[k].label, keys: CLOUD_SECTIONS[k].keys.slice() };
  });
  return json({ ok: true, sections: sections });
}

// POST /api/cloud/projects/:id/editors  { label, scope: [section...] }
// Owner-only (owner code or linked session). Generates the editor code,
// returns it EXACTLY ONCE, stores only salt+hash.
// Editor codes are capped per project (gap-audit item A6): an unbounded
// count is not a security hole but lets an automation loop / mistake silently
// create hundreds of rows. Generous cap, enforced on ACTIVE codes only.
const CLOUD_MAX_EDITOR_CODES = 25;
async function handleCloudEditorCreate(request, env, projectId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const activeRows = await env.DB.prepare('SELECT COUNT(*) AS n FROM cloud_editor_codes WHERE project_id = ? AND active = 1').bind(projectId).first();
  if (activeRows && Number(activeRows.n) >= CLOUD_MAX_EDITOR_CODES) {
    return json({ ok: false, error: 'too many active editor codes (max ' + CLOUD_MAX_EDITOR_CODES + ') — revoke unused codes first' }, 400);
  }
  const read = await readCloudBody(request);
  if (read.tooLarge) return json({ ok: false, error: 'body too large' }, 413);
  if (read.bad || !read.body || typeof read.body !== 'object') return json({ ok: false, error: 'bad request' }, 400);
  const label = typeof read.body.label === 'string' ? read.body.label.trim().slice(0, 60) : '';
  const scope = Array.isArray(read.body.scope)
    ? read.body.scope.filter(function(s) { return typeof s === 'string' && !!CLOUD_SECTIONS[s]; })
    : [];
  const seen = {}; const unique = scope.filter(function(s) { if (seen[s]) return false; seen[s] = 1; return true; });
  if (unique.length === 0) return json({ ok: false, error: 'at least one section is required' }, 400);
  const salt = randomSaltHex();
  const code = randomOwnerCode();
  const hash = await hashOwnerCode(code, salt);
  const now = new Date().toISOString();
  const res = await env.DB.prepare(
    'INSERT INTO cloud_editor_codes (project_id, label, scope, code_salt, code_hash, active, created_at) VALUES (?,?,?,?,?,1,?)'
  ).bind(projectId, label, JSON.stringify(unique), salt, hash, now).run();
  return json({ ok: true, editorCode: code, editorId: res.meta.last_row_id, label: label, scope: unique, createdAt: now });
}

// GET /api/cloud/projects/:id/editors — owner-only list (never codes/hashes).
async function handleCloudEditorList(request, env, projectId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const rows = await env.DB.prepare('SELECT id, label, scope, active, created_at FROM cloud_editor_codes WHERE project_id = ? ORDER BY id DESC').bind(projectId).all();
  const editors = (rows.results || []).map(function(r) {
    let scope = [];
    try { const p = JSON.parse(r.scope); if (Array.isArray(p)) scope = p; } catch (e) { scope = []; }
    return { id: r.id, label: r.label, scope: scope, active: r.active === 1, createdAt: r.created_at };
  });
  return json({ ok: true, editors: editors });
}

// DELETE /api/cloud/projects/:id/editors/:editorId — owner-only revoke.
// In-flight-save guarantee (gap-audit item A5): the DELETE commits atomically
// in D1, and every editor save authenticates by SELECTing the project's ACTIVE
// editor rows at request-processing time (cloudAuthEditor). A save whose auth
// SELECT runs after this commit sees no matching row and returns the generic
// 403; a save that already authenticated before the commit completes is
// processed under the permission that was valid when it started — standard
// request-boundary revocation, no token-lifetime gap beyond the in-flight
// request itself.
async function handleCloudEditorRevoke(request, env, projectId, editorId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const res = await env.DB.prepare('DELETE FROM cloud_editor_codes WHERE id = ? AND project_id = ?').bind(editorId, projectId).run();
  if (!res.meta.changes) return json({ ok: false, error: 'editor code not found' }, 404);
  return json({ ok: true, revokedEditorId: editorId });
}

// ---- changelog (Phase 3) -----------------------------------------
// GET /api/cloud/projects/:id/changelog — owner-only (code or session).
async function handleCloudChangelogList(request, env, projectId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const rows = await env.DB.prepare('SELECT id, entry_type, actor_type, actor_label, section, diffs_json, snapshot_key, created_at FROM cloud_changelog WHERE project_id = ? ORDER BY id DESC LIMIT 100').bind(projectId).all();
  const entries = (rows.results || []).map(function(r) {
    let diffs = null;
    try { if (r.diffs_json) diffs = JSON.parse(r.diffs_json); } catch (e) { diffs = null; }
    return { id: r.id, type: r.entry_type, actorType: r.actor_type, actorLabel: r.actor_label, section: r.section, diffs: diffs, hasSnapshot: !!r.snapshot_key, createdAt: r.created_at };
  });
  return json({ ok: true, entries: entries });
}

// POST /api/cloud/projects/:id/changelog/:entryId/revert — owner-only.
async function handleCloudChangelogRevert(request, env, projectId, entryId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const entry = await env.DB.prepare('SELECT id, entry_type, section, diffs_json, snapshot_key FROM cloud_changelog WHERE id = ? AND project_id = ?').bind(entryId, projectId).first();
  if (!entry) return json({ ok: false, error: 'entry not found' }, 404);
  const key = 'projects/' + projectId + '/latest.json';
  const cur = await cloudReadState(env, key);
  if (!cur) return json({ ok: false, error: 'no snapshot to revert against' }, 400);
  const now = new Date().toISOString();
  let next; let logDiffs = null; let logSnapKey = null;
  if (entry.entry_type === 'edit' || (entry.entry_type === 'revert' && !entry.snapshot_key)) {
    let diffs = [];
    try { if (entry.diffs_json) diffs = JSON.parse(entry.diffs_json); } catch (e) { diffs = []; }
    const pre = JSON.parse(JSON.stringify(cur));
    const revDiffs = [];
    diffs.forEach(function(d) {
      const curVal = cloudPathGet(pre, d.path);
      const applied = d.beforeAbsent ? (cloudPathDelete(pre, d.path), true) : cloudPathSet(pre, d.path, d.before);
      // REVIEW FIX: only record diffs that actually applied — a path whose
      // container vanished (element deleted by a later change) is skipped
      // rather than fabricated, and must not be claimed in the log entry.
      if (!applied) return;
      revDiffs.push({
        path: d.path,
        before: curVal === undefined ? null : curVal,
        beforeAbsent: curVal === undefined,
        after: d.before,
        afterAbsent: !!d.beforeAbsent
      });
    });
    next = pre;
    logDiffs = revDiffs;
  } else if (entry.entry_type === 'bulk' || (entry.entry_type === 'revert' && entry.snapshot_key)) {
    if (!entry.snapshot_key) return json({ ok: false, error: 'entry has no snapshot' }, 400);
    const snap = await env.R2.get(entry.snapshot_key);
    if (!snap) return json({ ok: false, error: 'snapshot missing' }, 410);
    let snapState = null;
    try { snapState = JSON.parse(await snap.text()); } catch (e) { snapState = null; }
    if (!snapState) return json({ ok: false, error: 'snapshot corrupt' }, 410);
    // Keep the CURRENT blob as a snapshot so this revert is itself reversible.
    logSnapKey = 'projects/' + projectId + '/changelog/' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + '.json';
    await env.R2.put(logSnapKey, JSON.stringify(cur), { httpMetadata: { contentType: 'application/json' } });
    next = snapState;
  } else {
    return json({ ok: false, error: 'unsupported entry type' }, 400);
  }
  next.updatedAt = now;
  await env.R2.put(key, JSON.stringify(next), { httpMetadata: { contentType: 'application/json' } });
  await env.DB.prepare('UPDATE cloud_projects SET latest_r2_key = ?, updated_at = ? WHERE project_id = ?').bind(key, now, projectId).run();
  const res = await env.DB.prepare(
    'INSERT INTO cloud_changelog (project_id, entry_type, actor_type, actor_label, section, diffs_json, snapshot_key, created_at) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(projectId, 'revert', 'owner', auth.label, entry.section || null, logDiffs ? JSON.stringify(logDiffs) : null, logSnapKey, now).run();
  return json({ ok: true, revertedEntryId: entry.id, revertEntryId: res.meta.last_row_id, savedAt: now });
}

// ---- admin cloud visibility (operator-gated listing) --------------
async function cloudAdminAuth(request, env) {
  const expected = env && typeof env.ADMIN_CODE === 'string' ? env.ADMIN_CODE.trim() : '';
  if (!expected) return { disabled: true };
  const code = String(request.headers.get('X-Admin-Code') || '').trim();
  if (!code || !codesEqual(code, expected)) return null;
  return { ok: true };
}
async function handleAdminCloudList(request, env) {
  const auth = await cloudAdminAuth(request, env);
  if (auth && auth.disabled) return json({ ok: false, error: 'admin API not configured — set the ADMIN_CODE secret' }, 503);
  if (!auth) return json({ ok: false, error: 'invalid admin code' }, 403);
  const rows = await env.DB.prepare('SELECT project_id, owner_label, google_name, latest_r2_key, created_at, updated_at FROM cloud_projects ORDER BY updated_at DESC').all();
  const projects = (rows.results || []).map(function(r) {
    return { projectId: r.project_id, label: r.owner_label || null, linkedName: r.google_name || null, hasSnapshot: !!r.latest_r2_key, createdAt: r.created_at, updatedAt: r.updated_at };
  });
  return json({ ok: true, projects: projects });
}

// POST /api/cloud/projects  { projectId, name? }
// Creates the D1 row, generates the owner code (returned ONCE), links the
// Google account when a valid session cookie rides along. 409 if the
// project id is already linked.
async function handleCloudCreate(request, env) {
  const read = await readCloudBody(request);
  if (read.tooLarge) return json({ ok: false, error: 'body too large' }, 413);
  if (read.bad || !read.body || typeof read.body !== 'object') return json({ ok: false, error: 'bad request' }, 400);
  const projectId = sanitizeProjectId(read.body.projectId);
  if (!projectId) return json({ ok: false, error: 'bad project id' }, 400);
  const name = typeof read.body.name === 'string' ? read.body.name.slice(0, 120) : '';
  const existing = await env.DB.prepare('SELECT project_id FROM cloud_projects WHERE project_id = ?').bind(projectId).first();
  if (existing) return json({ ok: false, error: 'project already linked' }, 409);
  const session = await readSession(request, env);
  const salt = randomSaltHex();
  const ownerCode = randomOwnerCode();
  const hash = await hashOwnerCode(ownerCode, salt);
  const now = new Date().toISOString();
  // CREATE-RACE GUARD (review finding): two concurrent creates for the same
  // id can both pass the SELECT above and then both INSERT — the second
  // duplicate-key throw would bubble to the outer fetch catch and answer
  // 404 Not Found instead of the intended 409. Catching the insert and
  // re-checking turns that race into the same "already linked" 409.
  try {
    await env.DB.prepare(
      'INSERT INTO cloud_projects (project_id, owner_code_salt, owner_code_hash, owner_label, google_sub, google_name, latest_r2_key, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)'
    ).bind(projectId, salt, hash, name, session ? session.sub : null, session ? session.name : null, null, now, now).run();
  } catch (e) {
    const raced = await env.DB.prepare('SELECT project_id FROM cloud_projects WHERE project_id = ?').bind(projectId).first();
    if (raced) return json({ ok: false, error: 'project already linked' }, 409);
    throw e; // genuine DB failure — let the outer guard 404 it
  }
  return json({ ok: true, projectId: projectId, ownerCode: ownerCode, linked: !!session });
}

// SECRET STRIP (review finding): the state blob stored in R2 is access-
// controlled by the owner code, not encrypted. Mirror the client export
// convention (mmgr-state.js stripSecrets) so a stale/legacy apiKey riding in
// state.config.ai can never land in the blob even if the client ever ships
// one. Pure belt-and-suspenders — the live session vault never writes keys
// into state today, but the blob should not depend on that invariant.
//
// ⛔ MAINTENANCE TRAP (gap-audit item A7): this list is the ONLY server-side
// gate between a future secret-shaped state field and the R2 blob. When any
// future feature adds a new credential slot to state (Gemini/Anthropic
// credential-slot work, webhook tokens, etc.), it MUST be added here in the
// same change — there is no generic key-name scan, by design (state keys are
// data, not a registry). Treat every new state credential as "add to
// CLOUD_STATE_SECRET_PATHS or the blob will leak it."
const CLOUD_STATE_SECRET_PATHS = [
  'config.ai.apiKey',
  'config.ai.azureKey',
  'config.api.keys'
];
function stripStateSecrets(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  // Iterate the canonical path list — cloudPathDelete is a hoisted function
  // declaration defined below (Phase 3 helpers), so it is available here at
  // call time. Adding a new path to CLOUD_STATE_SECRET_PATHS therefore
  // ACTUALLY strips it: the maintenance trap is real, not documented-only.
  for (let i = 0; i < CLOUD_STATE_SECRET_PATHS.length; i++) {
    cloudPathDelete(obj, CLOUD_STATE_SECRET_PATHS[i]);
  }
  return obj;
}

// POST /api/cloud/projects/:id/save  { state }  (X-Owner-Code header or
// body.ownerCode). Verifies the code, writes the state JSON to R2 as
// projects/{id}/latest.json, points the D1 row at it, bumps updated_at.

// POST /api/cloud/projects/:id/save
// Auth: X-Owner-Code (owner, full-replace — Phase 1 semantics unchanged)
//   OR X-Editor-Code (editor, server-side section-scope merge — Phase 2).
// Body: { state } (+ optional ownerCode/editorCode fallback).
// On every successful save a changelog row is recorded (Phase 3).
async function handleCloudSave(request, env, projectId) {
  const read = await readCloudBody(request);
  if (read.tooLarge) return json({ ok: false, error: 'body too large' }, 413);
  if (read.bad || !read.body || typeof read.body !== 'object') return json({ ok: false, error: 'bad request' }, 400);
  if (read.body.state === undefined || read.body.state === null) return json({ ok: false, error: 'missing state' }, 400);
  const ownerCode = String(request.headers.get('X-Owner-Code') || '').trim()
    || (typeof read.body.ownerCode === 'string' ? read.body.ownerCode.trim() : '');
  const editorCode = String(request.headers.get('X-Editor-Code') || '').trim()
    || (typeof read.body.editorCode === 'string' ? read.body.editorCode.trim() : '');
  if (!ownerCode && !editorCode) { await Promise.all([cloudDummyHash(), cloudTimingSink()]); return cloudForbidden(); }
  const now = new Date().toISOString();
  const key = 'projects/' + projectId + '/latest.json';
  const prev = await cloudReadState(env, key);
  let next; let actor; let scopeReport = null;
  if (ownerCode) {
    const a = await cloudAuthOwnerByCode(request, env, projectId, ownerCode);
    if (!a) return cloudForbidden();
    actor = { type: 'owner', label: a.label };
    next = JSON.parse(JSON.stringify(read.body.state));
    stripStateSecrets(next);
  } else {
    const a = await cloudAuthEditor(request, env, projectId, editorCode);
    if (!a) return cloudForbidden();
    actor = { type: 'editor', label: a.label };
    const merged = cloudScopeMerge(prev, read.body.state, a.scope);
    next = merged.next;
    scopeReport = { scope: a.scope, editorLabel: a.label, applied: merged.applied, blocked: merged.blocked };
  }
  next.updatedAt = now;
  await env.R2.put(key, JSON.stringify(next), { httpMetadata: { contentType: 'application/json' } });
  await env.DB.prepare('UPDATE cloud_projects SET latest_r2_key = ?, updated_at = ? WHERE project_id = ?').bind(key, now, projectId).run();
  const entry = await cloudLogSave(env, projectId, prev, next, actor);
  const resp = { ok: true, savedAt: now, key: key, actor: actor.type };
  // Gap-audit item B9: report the PREVIOUS snapshot's update time so the
  // client can warn when another device saved between this device's last
  // sync and this save (last-write-wins WITH a heads-up, not silently).
  resp.previousUpdatedAt = (prev && prev.updatedAt) || null;
  if (scopeReport) Object.assign(resp, scopeReport);
  if (entry) resp.changelog = entry;
  return json(resp);
}

// POST /api/cloud/projects/:id/load  (X-Owner-Code header or body.ownerCode)
// Verifies the code, streams the latest R2 snapshot back. A project with no
// snapshot yet returns state:null (still ok).

// POST /api/cloud/projects/:id/load
// Auth: X-Owner-Code OR X-Editor-Code (headers only — the client always
// sends the credential in the header). Owner loads are unchanged. An
// EDITOR load additionally returns role/editorLabel/scope so the app can
// grey out (UX) what the server already enforces. No blob yet -> state:null.
async function handleCloudLoad(request, env, projectId) {
  const ownerCode = String(request.headers.get('X-Owner-Code') || '').trim();
  const editorCode = String(request.headers.get('X-Editor-Code') || '').trim();
  if (!ownerCode && !editorCode) { await Promise.all([cloudDummyHash(), cloudTimingSink()]); return cloudForbidden(); }
  const row = await env.DB.prepare('SELECT owner_code_salt, owner_code_hash, latest_r2_key, updated_at FROM cloud_projects WHERE project_id = ?').bind(projectId).first();
  if (!row) { await Promise.all([cloudDummyHash(), cloudTimingSink()]); return cloudForbidden(); }
  let editorAuth = null;
  if (ownerCode) {
    const hash = await hashOwnerCode(ownerCode, row.owner_code_salt);
    if (!codesEqual(hash, row.owner_code_hash)) { await cloudTimingSink(); return cloudForbidden(); }
  } else {
    editorAuth = await cloudAuthEditor(request, env, projectId, editorCode);
    if (!editorAuth) return cloudForbidden();
  }
  if (!row.latest_r2_key) {
    const base = { ok: true, state: null, savedAt: null };
    if (editorAuth) { base.role = 'editor'; base.editorLabel = editorAuth.label; base.scope = editorAuth.scope; }
    return json(base);
  }
  const state = await cloudReadState(env, row.latest_r2_key);
  const resp = { ok: true, state: state, savedAt: row.updated_at };
  if (editorAuth) { resp.role = 'editor'; resp.editorLabel = editorAuth.label; resp.scope = editorAuth.scope; }
  return json(resp);
}

// POST /api/cloud/projects/:id/recover  (session-cookie gated)
// Owner-code reissue. The requester MUST hold a valid mmgr_session whose
// sub matches the row's google_sub (Garfield's decision: recovery requires
// the Google account on file). Unknown id / unlinked / wrong account are
// all the SAME generic 403. Issues a brand-new code, re-hashes, returns it
// once.
async function handleCloudRecover(request, env, projectId) {
  const session = await readSession(request, env);
  if (!session || !session.sub) { await cloudTimingSink(); return cloudForbidden(); }
  const row = await env.DB.prepare('SELECT owner_code_salt, owner_code_hash, google_sub, google_name FROM cloud_projects WHERE project_id = ?').bind(projectId).first();
  if (!row || !row.google_sub || row.google_sub !== session.sub) { await cloudTimingSink(); return cloudForbidden(); }
  const salt = randomSaltHex();
  const ownerCode = randomOwnerCode();
  const hash = await hashOwnerCode(ownerCode, salt);
  const now = new Date().toISOString();
  await env.DB.prepare('UPDATE cloud_projects SET owner_code_salt = ?, owner_code_hash = ?, updated_at = ? WHERE project_id = ?')
    .bind(salt, hash, now, projectId).run();
  // Gap-audit items A3/A4: a recovery is now its own changelog event so the
  // owner can see IN-APP that a reissue ever happened. Attribution is
  // preserved — existing rows keep their recorded actor labels; only the
  // owner-code salt/hash are rotated, never history. entry_type 'recovery'
  // carries no diffs/snapshot and is not revertible by design (re-issueing
  // a code is an identity action, not a content change).
  await env.DB.prepare(
    'INSERT INTO cloud_changelog (project_id, entry_type, actor_type, actor_label, section, diffs_json, snapshot_key, created_at) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(projectId, 'recovery', 'owner', row.google_name || 'Owner', null, null, null, now).run();
  return json({ ok: true, ownerCode: ownerCode, recoveredAt: now });
}

// GET /api/cloud/projects/:id/meta  (X-Owner-Code header OR linked session)
// Lightweight status for the UI: is it linked, does a snapshot exist, when
// was it last updated, what label was stored. Same generic 403 on failure.

// GET /api/cloud/projects/:id/meta  (X-Owner-Code / X-Editor-Code / session)
// Lightweight status for the UI: linked, snapshot, updated, label. Editor
// loads additionally return the editor's scope. Same generic 403 on failure.
async function handleCloudMeta(request, env, projectId) {
  const code = String(request.headers.get('X-Owner-Code') || '').trim();
  const ecode = String(request.headers.get('X-Editor-Code') || '').trim();
  const session = await readSession(request, env);
  const row = await env.DB.prepare('SELECT owner_code_salt, owner_code_hash, google_sub, google_name, owner_label, latest_r2_key, updated_at FROM cloud_projects WHERE project_id = ?').bind(projectId).first();
  if (!row) { await Promise.all([cloudDummyHash(), cloudTimingSink()]); return cloudForbidden(); }
  let authorized = false;
  let isEditor = false; let editorScope = null; let editorLabel = null;
  if (code) {
    const hash = await hashOwnerCode(code, row.owner_code_salt);
    authorized = codesEqual(hash, row.owner_code_hash);
  } else if (ecode) {
    const ea = await cloudAuthEditor(request, env, projectId, ecode);
    if (ea) { authorized = true; isEditor = true; editorScope = ea.scope; editorLabel = ea.label; }
  }
  if (!authorized && session && session.sub && row.google_sub && row.google_sub === session.sub) authorized = true;
  if (!authorized) return cloudForbidden();
  const resp = {
    ok: true, projectId: projectId, linked: !!row.google_sub,
    linkedName: row.google_name || null, label: row.owner_label || null,
    hasSnapshot: !!row.latest_r2_key, updatedAt: row.updated_at
  };
  if (isEditor) { resp.role = 'editor'; resp.editorLabel = editorLabel; resp.scope = editorScope; }
  return json(resp);
}

// ---- owner-only unlink (gap-audit item B10) -------------------------------
// DELETE /api/cloud/projects/:id — deletes the CLOUD copy of the project:
// D1 row, all editor codes, the changelog, and every R2 object under the
// project prefix (latest.json + changelog snapshots). The device's LOCAL
// project data is untouched — "keep local copy, stop syncing". Owner-only
// (code or linked session), same generic 403 as everything else.
async function handleCloudUnlink(request, env, projectId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const now = new Date().toISOString();
  // The project row is the source of truth for "is this linked" — delete it
  // FIRST so a mid-way failure leaves at worst orphaned child rows (which are
  // never queried without the project) rather than a live-looking project
  // pointing at deleted R2. R2 + D1 cannot be wrapped in one transaction, so
  // everything after the row delete is deliberately best-effort.
  const res = await env.DB.prepare('DELETE FROM cloud_projects WHERE project_id = ?').bind(projectId).run();
  if (!res.meta.changes) return json({ ok: false, error: 'project not found' }, 404);
  // Delete R2 objects under the project prefix (latest + changelog snapshots).
  let cursor = undefined;
  do {
    const listed = await env.R2.list({ prefix: 'projects/' + projectId + '/', cursor: cursor });
    for (let i = 0; i < (listed.objects || []).length; i++) {
      try { await env.R2.delete(listed.objects[i].key); } catch (e) { /* best-effort per object */ }
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  await env.DB.prepare('DELETE FROM cloud_editor_codes WHERE project_id = ?').bind(projectId).run();
  await env.DB.prepare('DELETE FROM cloud_changelog WHERE project_id = ?').bind(projectId).run();
  return json({ ok: true, unlinked: projectId, unlinkedAt: now });
}

// ---- /api/auth/* routes --------------------------------------------------
async function handleApi(request, env, url) {
  const path = url.pathname;

  // CORS POLICY (gap-audit item A2): enforce same-origin-only for the whole
  // API before any route logic runs. Cross-origin requests are rejected with
  // a plain 403 and no ACAO header is ever emitted on an API response.
  if (!sameOriginOnly(request)) {
    return json({ ok: false, error: 'cross-origin requests are not allowed' }, 403);
  }

  // CLOUD-BACKEND-ARCHITECTURE-PLAN Phase 1 — /api/cloud/* routes. These run
  // BEFORE the ASSETS binding, exactly like /api/auth/*, so they can never be
  // swallowed by the SPA fallback.
  if (path === '/api/cloud/projects' && request.method === 'POST') {
    const rl = await cloudRateCheck(request, 'general');
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleCloudCreate(request, env);
  }
  const cloudMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/(save|load|recover|meta)$/);
  if (cloudMatch) {
    const pid = cloudMatch[1];
    const op = cloudMatch[2];
    const rl = await cloudRateCheck(request, op === 'recover' ? 'recover' : 'general');
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    if (op === 'meta' && request.method === 'GET') return handleCloudMeta(request, env, pid);
    if (op === 'save' && request.method === 'POST') return handleCloudSave(request, env, pid);
    if (op === 'load' && request.method === 'POST') return handleCloudLoad(request, env, pid);
    if (op === 'recover' && request.method === 'POST') return handleCloudRecover(request, env, pid);
  }
  // DELETE /api/cloud/projects/:id — owner-only unlink (gap-audit item B10).
  const cloudUnlinkMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})$/);
  if (cloudUnlinkMatch && request.method === 'DELETE') {
    const rl = await cloudRateCheck(request, 'general');
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleCloudUnlink(request, env, cloudUnlinkMatch[1]);
  }


  // CLOUD-BACKEND-ARCHITECTURE-PLAN Phase 2/3 — editor codes, changelog,
  // and admin cloud visibility. All cloud routes run before the ASSETS
  // binding, exactly like the Phase 1 routes above.
  if (path === '/api/cloud/sections' && request.method === 'GET') {
    const rl = await cloudRateCheck(request, 'general');
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleCloudSections();
  }
  if (path === '/api/cloud/admin/projects' && request.method === 'GET') {
    const rl = await cloudRateCheck(request, 'general');
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleAdminCloudList(request, env);
  }
  const cloudEditorsMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/editors$/);
  if (cloudEditorsMatch) {
    const pid = cloudEditorsMatch[1];
    const rl = await cloudRateCheck(request, 'general');
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    if (request.method === 'POST') return handleCloudEditorCreate(request, env, pid);
    if (request.method === 'GET') return handleCloudEditorList(request, env, pid);
  }
  const cloudEditorDelMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/editors\/(\d+)$/);
  if (cloudEditorDelMatch && request.method === 'DELETE') {
    const rl = await cloudRateCheck(request, 'general');
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleCloudEditorRevoke(request, env, cloudEditorDelMatch[1], cloudEditorDelMatch[2]);
  }
  const cloudLogMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/changelog$/);
  if (cloudLogMatch && request.method === 'GET') {
    const rl = await cloudRateCheck(request, 'general');
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleCloudChangelogList(request, env, cloudLogMatch[1]);
  }
  const cloudRevertMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/changelog\/(\d+)\/revert$/);
  if (cloudRevertMatch && request.method === 'POST') {
    const rl = await cloudRateCheck(request, 'general');
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleCloudChangelogRevert(request, env, cloudRevertMatch[1], cloudRevertMatch[2]);
  }

  // GET /api/health — liveness probe (INTEGRATED-STRUCTURE-API-WINDOW plan
  // §1: the plan's client.py check_connection() pings /health; the Worker
  // equivalent is this same-origin route that the AI window's status badge
  // pings on open). Stateless, no auth, always 200 while the Worker is up.
  if (path === '/api/health' && request.method === 'GET') {
    return json({ ok: true, status: 'ok', app: 'my-manager', time: new Date().toISOString() });
  }

  // POST /api/auth/google { idToken } -> verify -> Set-Cookie mmgr_session
  if (path === '/api/auth/google' && request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'bad request' }, 400); }
    const idToken = body && typeof body.idToken === 'string' ? body.idToken : '';
    if (!idToken) return json({ ok: false, error: 'missing id_token' }, 400);
    const clientId = env && typeof env.GOOGLE_CLIENT_ID === 'string' && env.GOOGLE_CLIENT_ID
      ? env.GOOGLE_CLIENT_ID : GOOGLE_CLIENT_ID;
    const user = await verifyGoogleIdToken(idToken, clientId);
    if (!user) return json({ ok: false, error: 'invalid token' }, 401);
    const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
    const token = await signSession(
      { sub: user.sub, email: user.email, name: user.name, picture: user.picture, exp },
      await sessionKey(env)
    );
    return new Response(JSON.stringify({ ok: true, user }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Set-Cookie': SESSION_COOKIE + '=' + token + '; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=' + SESSION_MAX_AGE
      }
    });
  }

  // GET /api/auth/me -> { ok:true, user } when a valid session cookie exists
  if (path === '/api/auth/me' && request.method === 'GET') {
    const session = await readSession(request, env);
    if (!session) return json({ ok: false, user: null });
    return json({ ok: true, user: { sub: session.sub, email: session.email, name: session.name, picture: session.picture } });
  }

  // POST /api/ai/chat (BYO-AI-KEY-SESSION-ONLY-v1 STEP-5) — stateless relay.
  if (path === '/api/ai/chat' && request.method === 'POST') {
    return handleAiChat(request);
  }

  // POST /api/auth/logout -> clear the session cookie
  if (path === '/api/auth/logout' && request.method === 'POST') {
    // Cheap same-origin guard: a cross-site form POST must not be able to log
    // the operator out (logout CSRF). Sec-Fetch-Site is sent by all modern
    // browsers; when absent (rare), the request is allowed (spec-compliant
    // SameSite=Lax cookie policy remains in effect regardless).
    const sfs = request.headers.get('Sec-Fetch-Site');
    if (sfs && sfs !== 'same-origin' && sfs !== 'none') {
      return json({ ok: false, error: 'forbidden' }, 403);
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

  return json({ ok: false, error: 'not found' }, 404);
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const normalized = normalizePathname(url.pathname);
      // GOOGLE-OPERATOR-IDENTITY-v1: API routes run BEFORE the ASSETS binding
      // so the single-page-app fallback can never serve index.html for /api/*
      // paths (and auth responses never carry the page CSP).
      if (normalized.indexOf('/api/') === 0) {
        return handleApi(request, env, url);
      }
      const response = await env.ASSETS.fetch(request);
      // Copy status/statusText/headers into a new Response, then add ours.
      const decorated = new Response(response.body, response);
      for (const [name, value] of Object.entries(HEADERS)) {
        decorated.headers.set(name, value);
      }
      // Scoped CSP: only the vendored whisper runtime files get the relaxed
      // policy (see WHISPER_CSP above). Everything else stays strict.
      // The check runs on the normalized pathname so dot-segment traversal
      // can never hand the relaxed CSP to non-whisper content (review
      // finding).
      if (normalized.indexOf('/vendor/whisper/') === 0) {
        decorated.headers.set('Content-Security-Policy', WHISPER_CSP);
      }
      return decorated;
    } catch (e) {
      // ASSETS.fetch should handle 404/SPA fallback itself; this guard
      // only covers an unexpected internal failure — never a crash.
      return new Response('Not Found', { status: 404 });
    }
  }
};
