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
       https://accounts.google.com + https://fonts.googleapis.com
       are ALSO allowed so Google Identity Services can load its own
       sign-in button/popup stylesheet (see DIR-1 of
       PROJECT-UX-NAV-WEATHER-EXPORT-DIRECTIVE — without them the GIS
       popup fails with a style-src violation).
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
  "'sha256-Jd4HFQYDoZo8X42G7dwI7h9WPPvRgUYBtXk8UPdTY3Q='", // app.html (early-apply theme snippet + desktop rail-open default)
  "'sha256-9ajvGrjnsFPwCtr5PvlDV+SVKzwxAyNkRPQ3CTXRuCE='", // app.html (launcher + 2026-08-15: rail-head hamburger toggle + pill toast(); 2026-08-16: dash-cleanup + T5 Google-icon fix — openSignIn() calls GoogleAuth.ensureGisButton() + CLOUD-CODES-AND-DELETE — 'Have a code?' code-entry card (cloudCodeOpen: POST /api/cloud/codes/lookup → /load with role header → seed session → open project.html))
  "'sha256-qbHZHLyhdEDRwWrA8/I8ty4xIjUv+L/+Y6/0cIXdkJo='", // admin.html (early-apply theme snippet)
  "'sha256-X90hx47K5Wed3kK6semkRqdr3BLX1r8wBn8iIhja0mU='", // admin.html (2026-08-15: pill toast() + rail sign-in/customize + Import Project + Publish to Cloud + cloud-code adoption + sign-in routing from publish; 2026-08-16: dash-cleanup + BUG-5 cloud publish fix + T5 Google-icon fix + CLOUD-CODES-AND-DELETE — delete-with-Undo toast (soft delete/restore), per-row Codes manager (editor/viewer create/list/revoke), honest cloud-admin error copy; STABILIZATION 2026-08-16 — delete-link coherence: local delete cascades on cloudId alone (session fallback), cloud-admin list renders the tombstone 'Deleted' state with Undo + Delete permanently (purge) + auto-refresh, hamburger rail reveal fix, dash-free purge confirm copy)
  "'sha256-Oa7ON+9A164SSXhnxu08mFn0V9Tj2SlZ2SzFXFoqKNE='", // dashboard.html
  "'sha256-bNdw0+64xL2//htoz+u3InKWYZNEHO/CnuZqtcJIBgU='", // seed-test.html
  "'sha256-AxkduQ155AQ7I921Ow+mZyri0uQY4ygsDy1i/x/xbCc='", // mymanager-field-guide.html
  "'sha256-c2U+m5SzyupzeOrPEiOjlnaSgS1KdAxZTFnYA5dW/Rk='", // monolith ref (block 1)
  "'sha256-Mvj9ZjVlVJ2yrW230N22X9aZl7s8NDVU8mXyscP1DHQ='"  // monolith ref (block 2)
].join(' ');

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' https://unpkg.com https://accounts.google.com https://apis.google.com " + INLINE_SCRIPT_HASHES,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com",
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

// SEO-FILES (2026-08-17): robots.txt and sitemap.xml live as real files at
// the repo root and are served by the ASSETS binding. This route pins the
// correct Content-Type for each and — belt-and-suspenders — if a file is
// ever missing (the single-page-app fallback would otherwise answer
// index.html with 200), it 404s instead of feeding a crawler the homepage.
const SEO_FILES = {
  '/robots.txt': 'text/plain; charset=utf-8',
  '/sitemap.xml': 'application/xml; charset=utf-8'
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
// AUTH-MAINFRAME (2026-08-17, owner-approved): lazy sliding renewal +
// server-side revocation. Sessions are re-issued on /api/auth/me when
// older than SESSION_RENEW_AFTER_MS (same jti, fresh expiry), bounded by
// the ABSOLUTE cap — active users are no longer silently logged out at 7
// days, and a stolen cookie can never outlive the cap. Every session
// carries a random jti recorded in auth_sessions (migration 0012) so it
// can be revoked: logout, sign-out-everywhere, password change.
const SESSION_RENEW_AFTER_MS = 86400000;        // re-issue when 24h old
const SESSION_ABSOLUTE_CAP = 30 * 24 * 60 * 60; // 30 days, seconds
// Per-account login lockout (auth_login_guard): 5 failed passwords ->
// 15 min; 10+ -> 1 hour. A successful login clears the row.
const AUTH_LOCK_FAILS = 5;
const AUTH_LOCK_WINDOW_MS = 15 * 60 * 1000;
const AUTH_LOCK_ESCALATE_FAILS = 10;
const AUTH_LOCK_ESCALATE_MS = 60 * 60 * 1000;

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
  // AUTH-MAINFRAME revocation check: a revoked (or swept) jti kills the
  // session on EVERY authenticated route. Sessions minted before migration
  // 0012 carry no jti — accept them once (they are renewed with a jti on
  // the next /api/auth/me) instead of logging everyone out on deploy.
  if (payload.jti) {
    let sessRow;
    try {
      sessRow = await env.DB.prepare('SELECT revoked_at FROM auth_sessions WHERE jti = ?').bind(payload.jti).first();
    } catch (e) { return null; }
    if (!sessRow || sessRow.revoked_at) return null;
  }
  return payload;
}

// AUTH-MAINFRAME: mint a session — random jti, issued-at, 7-day expiry —
// record it in auth_sessions (so it can be revoked) and return the token.
// A failed D1 write must never block sign-in; revocation then lapses to
// expiry-based expiry only (the cookie is still HMAC-signed).
async function mintSession(user, env) {
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

function sessionSetCookie(token) {
  return SESSION_COOKIE + '=' + token + '; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=' + SESSION_MAX_AGE;
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

// sha256 hex fingerprint of a code — the lookup key used by
// POST /api/cloud/codes/lookup (migration 0009). Safe as a stored key
// because codes are high-entropy random strings (~80 bits): sha256 of
// the code is not brute-forceable, and the code itself is still never
// stored beyond the existing PBKDF2 hashes.
async function fingerprintOf(code) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(code || '')));
  const bytes = new Uint8Array(buf);
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

// The DISTINCT failure shape for a soft-deleted project (admin delete,
// migration 0009 deleted_at tombstone). Deliberately separate from
// cloudForbidden: per the owner's directive, a code holder must be told
// the project is gone (they already knew the code — no existence leak).
function cloudProjectDeleted() {
  return json({ ok: false, error: 'project_deleted' }, 410);
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
  recover: { max: 6, windowMs: 60000 }, // recovery is the sensitive reissue path
  // email+password register/login (deferred cloud item #14, 2026-08-12):
  // login is the CREDENTIAL-GUESSING surface — a scripted loop trying
  // passwords is the one auth path with no platform OAuth to stop it, so
  // it gets a tighter bucket than general. AUTH-MAINFRAME (2026-08-17):
  // register and login get SEPARATE buckets so a login-spam script can
  // never consume register's budget (or vice versa) — 30/min per key is
  // generous for any legit flow (one click per sign-in). The per-account
  // lockout (auth_login_guard) is the second line behind this.
  authRegister: { max: 30, windowMs: 60000 },
  authLogin: { max: 30, windowMs: 60000 },
  // AUTH MAINFRAME v2 (2026-08-17): forgot-password is its own
  // unauthenticated surface — tighter IP bucket than login; verify/reset are
  // token-consumption surfaces (a guessed token is rejected by HMAC anyway;
  // the bucket just slows hammering).
  authForgot: { max: 10, windowMs: 60000 },
  authToken: { max: 30, windowMs: 60000 },
  // PART F T7 (2026-08-16) — public reviews window POST. UNauthenticated
  // write surface (anyone can review), so it gets its own bucket tighter
  // than general: 10 posts/min per IP is plenty for one human review and
  // deters a scripted spam loop. GET (the public list) rides the general
  // bucket — cheap read, generous limit.
  reviews: { max: 10, windowMs: 60000 }
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
  // BUGFIX (STABILIZATION 2026-08-16): the sliding-window slots are stored in
  // one shared map keyed only by the request key ('anon' / 'ip:...'), so every
  // bucket raced on the SAME slot list — general-bucket traffic (e.g. the
  // public reviews page's GETs) consumed the reviews bucket's 10/min budget
  // and could 429 a human's POST before they ever submitted. Namespacing the
  // key by bucket makes each limit independent, as intended.
  const ns = bucket + ':' + key;
  const r = cloudRateAllow(ns, cfg);
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

// ---- ORPHAN-PURGE (A5-2 decision, 2026-08-11) ----------------------------
// Auto-delete cloud projects after a retention window with NO owner
// activity (see migration 0004). The window is measured on
// last_owner_seen_at — stamped on owner-authenticated requests only — so an
// abandoned project cannot be kept alive by an editor's saves. The purge
// runs on the Worker's scheduled (cron) handler; it is intentionally
// conservative: a project whose last_owner_seen_at is null is never purged
// (legacy rows are back-filled by the migration, and the null guard is a
// belt-and-suspenders so a schema race can never delete a live project).
const CLOUD_ORPHAN_RETENTION_MS = 365 * 24 * 60 * 60 * 1000; // 12 months
// Tombstone grace for admin-deleted projects (migration 0009 deleted_at):
// the admin Undo window is seconds, so a multi-day grace is generous — but
// the blob should not linger forever for a project that is never coming back.
const CLOUD_DELETED_PURGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Stamp last_owner_seen_at on an owner-authenticated request. Fire-and-
// forget semantics: this is a maintenance bump, never a failure point —
// callers await it only when they want the write ordered with their own
// response (recover, save); meta/load can await it too since it is a single
// cheap UPDATE and D1 batches it with their own row read on the same conn.
async function cloudTouchOwner(env, projectId) {
  try {
    await env.DB.prepare('UPDATE cloud_projects SET last_owner_seen_at = ? WHERE project_id = ?')
      .bind(new Date().toISOString(), projectId).run();
  } catch (e) { /* maintenance stamp must never fail a user request */ }
}

// Purge every cloud project whose owner has been absent for longer than the
// retention window: D1 row + editor codes + changelog + every R2 object under
// the project prefix (mirrors handleCloudUnlink's cleanup, minus auth).
async function purgeStaleCloudProjects(env) {
  const cutoff = new Date(Date.now() - CLOUD_ORPHAN_RETENTION_MS).toISOString();
  // Review pass (2026-08-11): cap the batch so one oversized sweep cannot
  // blow the cron CPU-time budget — the daily cadence catches the rest
  // tomorrow. The cap applies AFTER selection so ordering stays stable.
  const rows = await env.DB.prepare(
    'SELECT project_id, owner_label FROM cloud_projects WHERE last_owner_seen_at IS NOT NULL AND last_owner_seen_at < ? ORDER BY last_owner_seen_at ASC LIMIT 200'
  ).bind(cutoff).all();
  const stale = (rows && rows.results) || [];
  const purged = [];
  for (let i = 0; i < stale.length; i++) {
    const pid = stale[i].project_id;
    let cursor = undefined;
    do {
      const listed = await env.R2.list({ prefix: 'projects/' + pid + '/', cursor: cursor });
      for (let j = 0; j < (listed.objects || []).length; j++) {
        try { await env.R2.delete(listed.objects[j].key); } catch (e) { /* best-effort per object */ }
      }
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
    await env.DB.prepare('DELETE FROM cloud_editor_codes WHERE project_id = ?').bind(pid).run();
    await env.DB.prepare('DELETE FROM cloud_adoptions WHERE project_id = ?').bind(pid).run();
    await env.DB.prepare('DELETE FROM cloud_changelog WHERE project_id = ?').bind(pid).run();
    await env.DB.prepare('DELETE FROM offline_copies WHERE project_id = ?').bind(pid).run();
    await env.DB.prepare('DELETE FROM cloud_reviews WHERE project_id = ?').bind(pid).run();
    await env.DB.prepare('DELETE FROM cloud_projects WHERE project_id = ?').bind(pid).run();
    purged.push({ projectId: pid, label: stale[i].owner_label || null, purgedAt: new Date().toISOString() });
  }
  // CLOUD-CODES-AND-DELETE: hard-purge soft-deleted (admin-deleted) projects
  // whose tombstone is older than the grace window — the R2 blob, editor/view
  // codes, and changelog all go, mirroring the unlink cleanup above.
  const delCutoff = new Date(Date.now() - CLOUD_DELETED_PURGE_MS).toISOString();
  const delRows = await env.DB.prepare(
    'SELECT project_id FROM cloud_projects WHERE deleted_at IS NOT NULL AND deleted_at < ? ORDER BY deleted_at ASC LIMIT 200'
  ).bind(delCutoff).all();
  const gone = (delRows && delRows.results) || [];
  for (let i = 0; i < gone.length; i++) {
    const pid = gone[i].project_id;
    let cursor = undefined;
    do {
      const listed = await env.R2.list({ prefix: 'projects/' + pid + '/', cursor: cursor });
      for (let j = 0; j < (listed.objects || []).length; j++) {
        try { await env.R2.delete(listed.objects[j].key); } catch (e) { /* best-effort per object */ }
      }
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
    await env.DB.prepare('DELETE FROM cloud_editor_codes WHERE project_id = ?').bind(pid).run();
    await env.DB.prepare('DELETE FROM cloud_adoptions WHERE project_id = ?').bind(pid).run();
    await env.DB.prepare('DELETE FROM cloud_changelog WHERE project_id = ?').bind(pid).run();
    await env.DB.prepare('DELETE FROM offline_copies WHERE project_id = ?').bind(pid).run();
    await env.DB.prepare('DELETE FROM cloud_reviews WHERE project_id = ?').bind(pid).run();
    await env.DB.prepare('DELETE FROM cloud_projects WHERE project_id = ?').bind(pid).run();
    purged.push({ projectId: pid, label: 'deleted', purgedAt: new Date().toISOString() });
  }
  return { purged: purged, checked: stale.length };
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
  const row = await env.DB.prepare('SELECT owner_code_salt, owner_code_hash, google_sub, google_name, deleted_at FROM cloud_projects WHERE project_id = ?').bind(projectId).first();
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
// Shared-code auth for BOTH roles (migration 0009 role column): the JOIN
// pulls the project's deleted_at so load/save/meta can answer
// 'project_deleted' with the same row read (no extra SELECT on hot paths).
async function cloudAuthSharedCode(request, env, projectId, code, role) {
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
async function cloudAuthEditor(request, env, projectId, code) {
  return cloudAuthSharedCode(request, env, projectId, code, 'editor');
}
// Viewer identity: an active VIEW code can LOAD (read-only + section
// scope) but can never SAVE — the save path never accepts X-View-Code
// and cloudAuthEditor only matches role='editor'.
async function cloudAuthViewer(request, env, projectId, code) {
  return cloudAuthSharedCode(request, env, projectId, code, 'view');
}

// ---- PART F T9 (2026-08-16): recipient adoption (pin-into-list) ----
// cloud_adoptions links a signed-in recipient to a project they loaded
// with an editor/viewer code. The adoption is keyed on the recipient's own
// session sub (server-side only — never a client-supplied claim) and
// stores the editor-code id so the grant stays CURRENT: every
// session-authenticated load/save re-reads the live code row. A revoked
// code answers code_revoked (the adoption stops working); a tombstoned
// project answers project_deleted. No PBKDF2/timing floor needed here —
// the adoption row is a per-user capability read, not an existence oracle
// (the caller already holds a valid session cookie).
async function cloudAdopt(env, projectId, sub, editorCodeId, role) {
  if (!sub || !editorCodeId) return;
  const now = new Date().toISOString();
  await env.DB.prepare(
    'INSERT INTO cloud_adoptions (project_id, recipient_sub, editor_code_id, role, created_at, updated_at) VALUES (?,?,?,?,?,?) ' +
    'ON CONFLICT(project_id, recipient_sub) DO UPDATE SET editor_code_id = excluded.editor_code_id, role = excluded.role, updated_at = excluded.updated_at'
  ).bind(projectId, sub, editorCodeId, role, now, now).run();
}
// Returns { role, editorId, label, scope, row } for an active adoption,
// { revoked: true } when the linked code was revoked/deleted, or null when
// this session has no adoption row for the project.
async function cloudAuthAdoption(request, env, projectId) {
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
// snapshot 'bulk' above it. entryType (optional) overrides the entry
// type — REVIEW QUEUE (2026-08-17) uses 'accepted' so an accepted
// proposal is logged as the audit record of the owner's decision
// (still revertible via the same leaf/snapshot machinery).
async function cloudLogSave(env, projectId, prev, next, actor, entryType) {
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

// ---- recordId-aware diff revert (CLOUD-MCP-IMPORT, 2026-08-11) ----------
// Apply the INVERSE of one stored changelog diff to a state object
// (MUTATES s). Mirrors the MCP sidecar's applyInverseDiffs semantics
// (mcp/lib/changelog.mjs): record diffs resolve by STABLE recordId when the
// diff carries one (MCP-imported entries, so reverts survive later index
// drift), falling back to the recorded array index for cloud-native leaf
// diffs. A delete-restore re-INSERTS the record at a clamped position —
// never overwriting a possibly-drifted neighbor — and a diff whose target
// record was removed by a LATER edit is SKIPPED rather than written onto
// whatever record sits there now. Returns true when the write actually
// landed (so the revert log only claims applied diffs).
function cloudRevertDiff(s, d) {
  // field may itself be dotted for object content keys (raci.matrix.<key>).
  const m = String(d.path || '').match(/^([a-zA-Z]+)(?:\[(\d+)\])?(?:\.(.+))?$/);
  if (!m) return false;
  const listKey = m[1];
  const idxStr = m[2];
  const field = m[3];
  const list = s[listKey];
  // Object content keys (charter, closure, raci, dmaic, activeMeeting, ...)
  // and any nested leaf are diffed by the app's own saves too — revert them
  // with the generic path helpers, exactly like the pre-recordId code did.
  // REVIEW FIX (2026-08-11 #2): the first rewrite only special-cased
  // charter + arrays, silently no-opping every other object key's revert.
  if (!Array.isArray(list) || (field !== undefined && field.indexOf('.') !== -1)) {
    if (d.beforeAbsent) { cloudPathDelete(s, d.path); return true; }
    return cloudPathSet(s, d.path, d.before);
  }
  // A delete diff records the id of the record that WAS there — on revert it
  // is intentionally absent, so delete-restores resolve by the recorded
  // index, never by id lookup.
  const isDeleteRestore = d.afterAbsent === true && d.beforeAbsent !== true && !field;
  let idx = -1;
  if (!isDeleteRestore && d.recordId !== undefined) {
    idx = list.findIndex(function(r) { return r && String(r.id) === String(d.recordId); });
    if (idx < 0) return false; // target record gone — skip rather than clobber
  } else if (idxStr !== undefined) {
    idx = Number(idxStr);
  }
  if (d.beforeAbsent) {
    // A FIELD-level add (leaf diff — the field was undefined before the
    // change) reverts to deleting just that field; only a WHOLE-RECORD add
    // removes the record. REVIEW FIX (2026-08-11): the previous version
    // spliced for every beforeAbsent diff, which turned cloud-native leaf
    // reverts into corruption — reverting a record-add (leaf diffs at the
    // same index) repeatedly removed the shifted FOLLOWING records.
    const rec = idx >= 0 && idx < list.length ? list[idx] : null;
    if (field) {
      if (!rec) return false;
      delete rec[field];
      return true;
    }
    if (idx >= 0 && idx < list.length) { list.splice(idx, 1); return true; }
    return false;
  }
  if (isDeleteRestore) {
    // record was deleted by the logged change -> re-insert at a clamped
    // position (never overwrite a possibly-drifted neighbor)
    list.splice(Math.min(idx < 0 ? 0 : idx, list.length), 0, d.before);
    return true;
  }
  const rec = idx >= 0 && idx < list.length ? list[idx] : null;
  if (!rec) return false;
  if (field) { rec[field] = d.before; return true; }
  list[idx] = d.before;
  return true;
}

// ---- editor code management (owner-only) -------------------------
// GET /api/cloud/sections — canonical section vocabulary (public).
function handleCloudSections() {
  const sections = Object.keys(CLOUD_SECTIONS).map(function(k) {
    return { key: k, label: CLOUD_SECTIONS[k].label, keys: CLOUD_SECTIONS[k].keys.slice() };
  });
  return json({ ok: true, sections: sections });
}

// ---- PART F T7 — PUBLIC REVIEWS WINDOW (2026-08-16) -------------------
// reviews.html: anyone leaves a review (name optional, "Anonymous" when
// blank), stored in D1 + R2, listed newest-first for everyone instantly
// (no moderation, per the owner). Star-READY: the schema carries
// `stars` (nullable, 0 = not rated) + `votes` now; the star/priority
// UI is a FOLLOW-UP session per the owner, so this endpoint accepts an
// optional 1-5 `stars` value but the page form does not send it yet.
//
// Content discipline (owner directive): PLAIN TEXT ONLY. The page
// renders with textContent (never innerHTML), and the server rejects
// HTML/links outright — angle brackets, URL schemes, and www. prefixes
// are stripped into a 400 so a crafted payload cannot survive to the
// DOM at all. Size-capped (a review is short prose — a 2 KB review
// text + 60-char name is far beyond generous) and rate-limited with
// the dedicated `reviews` bucket (10/min per IP).
const REVIEW_TEXT_MAX = 2000;
const REVIEW_NAME_MAX = 60;
const REVIEW_BODY_LIMIT_BYTES = 8192;

// Read the JSON body with a review-sized cap (reviews are short prose;
// the cloud 8 MB body reader would accept junk we then reject anyway).
async function readReviewBody(request) {
  const cl = Number(request.headers.get('Content-Length') || 0);
  if (cl > REVIEW_BODY_LIMIT_BYTES) return { tooLarge: true };
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
      if (total > REVIEW_BODY_LIMIT_BYTES) return { tooLarge: true };
      chunks.push(res.value);
    }
  }
  const bytes = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { bytes.set(c, off); off += c.byteLength; }
  const text = new TextDecoder().decode(bytes);
  try { return { body: JSON.parse(text) }; } catch (e) { return { bad: true }; }
}

// PLAIN-TEXT-ONLY guard: reject HTML markup and URL scaffolding.
// Returns the problem as a human message, or null when the text is clean.
function reviewPlainTextProblem(s) {
  if (/[<>]/.test(s)) return 'plain text only — no HTML or markup in reviews';
  if (/https?:\/\/|www\./i.test(s)) return 'plain text only — no links in reviews';
  return null;
}

// POST /api/reviews  { name?, review, stars? }  →  { ok, review }
// Writes BOTH D1 (listing source) and R2 reviews/<id>.json (durable
// copy) — the same dual-write the cloud project rows use.
async function handleReviewsCreate(request, env) {
  const read = await readReviewBody(request);
  if (read.tooLarge) return json({ ok: false, error: 'review too large' }, 413);
  if (read.bad || !read.body || typeof read.body !== 'object') return json({ ok: false, error: 'bad request' }, 400);
  const rawName = typeof read.body.name === 'string' ? read.body.name.trim().slice(0, REVIEW_NAME_MAX) : '';
  const rawText = typeof read.body.review === 'string' ? read.body.review.trim() : '';
  if (!rawText) return json({ ok: false, error: 'review text is required' }, 400);
  if (rawText.length > REVIEW_TEXT_MAX) return json({ ok: false, error: 'review too long (max ' + REVIEW_TEXT_MAX + ' characters)' }, 400);
  const prob = reviewPlainTextProblem(rawText) || reviewPlainTextProblem(rawName);
  if (prob) return json({ ok: false, error: prob }, 400);
  // Star-READY: accept an optional 1-5 rating (the follow-up UI sends it).
  let stars = null;
  if (read.body.stars !== undefined && read.body.stars !== null && read.body.stars !== 0) {
    const n = Number(read.body.stars);
    if (Number.isInteger(n) && n >= 1 && n <= 5) stars = n;
    else return json({ ok: false, error: 'stars must be a whole number from 1 to 5' }, 400);
  }
  const name = rawName ? rawName : null;
  const now = new Date().toISOString();
  const res = await env.DB.prepare(
    'INSERT INTO reviews (name, review_text, stars, votes, created_at) VALUES (?,?,?,0,?)'
  ).bind(name, rawText, stars, now).run();
  const id = Number(res.meta.last_row_id);
  const review = { id: id, name: name, review: rawText, stars: stars, votes: 0, createdAt: now };
  try {
    await env.R2.put('reviews/' + id + '.json', JSON.stringify(review), { httpMetadata: { contentType: 'application/json' } });
  } catch (e) {
    // D1 is the listing source of truth; a blob write failure must not
    // fail the review itself (same best-effort discipline as cloud saves).
  }
  return json({ ok: true, review: review });
}

// GET /api/reviews — public, newest first. Never exposes anything beyond
// the four public fields; no moderation (owner: everyone sees all reviews
// instantly).
async function handleReviewsList(env) {
  const rows = await env.DB.prepare(
    'SELECT id, name, review_text, stars, votes, created_at FROM reviews ORDER BY created_at DESC, id DESC LIMIT 200'
  ).all();
  const reviews = (rows.results || []).map(function(r) {
    return { id: r.id, name: r.name, review: r.review_text, stars: r.stars, votes: r.votes, createdAt: r.created_at };
  });
  return json({ ok: true, reviews: reviews });
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
  // CLOUD-CODES-AND-DELETE-DIRECTIVE (migration 0009): shared codes now
  // carry a ROLE — 'editor' (edit the granted sections, the original
  // behaviour) or 'view' (read-only everywhere, only the granted sections
  // visible/enabled). Same scope validation for both; a view code's scope
  // is what the holder may SEE.
  const role = read.body.role === 'view' ? 'view' : 'editor';
  const scope = Array.isArray(read.body.scope)
    ? read.body.scope.filter(function(s) { return typeof s === 'string' && !!CLOUD_SECTIONS[s]; })
    : [];
  const seen = {}; const unique = scope.filter(function(s) { if (seen[s]) return false; seen[s] = 1; return true; });
  if (unique.length === 0) return json({ ok: false, error: 'at least one section is required' }, 400);
  const salt = randomSaltHex();
  const code = randomOwnerCode();
  const hash = await hashOwnerCode(code, salt);
  const fp = await fingerprintOf(code);
  const now = new Date().toISOString();
  const res = await env.DB.prepare(
    'INSERT INTO cloud_editor_codes (project_id, label, scope, code_salt, code_hash, code_fingerprint, role, active, created_at) VALUES (?,?,?,?,?,?,?,1,?)'
  ).bind(projectId, label, JSON.stringify(unique), salt, hash, fp, role, now).run();
  return json({ ok: true, editorCode: code, editorId: res.meta.last_row_id, label: label, scope: unique, role: role, createdAt: now });
}

// GET /api/cloud/projects/:id/editors — owner-only list (never codes/hashes).
async function handleCloudEditorList(request, env, projectId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const rows = await env.DB.prepare('SELECT id, label, scope, role, active, created_at FROM cloud_editor_codes WHERE project_id = ? ORDER BY id DESC').bind(projectId).all();
  const editors = (rows.results || []).map(function(r) {
    let scope = [];
    try { const p = JSON.parse(r.scope); if (Array.isArray(p)) scope = p; } catch (e) { scope = []; }
    return { id: r.id, label: r.label, scope: scope, role: r.role || 'editor', active: r.active === 1, createdAt: r.created_at };
  });
  return json({ ok: true, editors: editors });
}

// DELETE /api/cloud/projects/:id/editors/:editorId — owner-only revoke.
// CLOUD-CODES-AND-DELETE (2026-08-16): revocation is now a SOFT revoke
// (active = 0) instead of a row DELETE — a revoked code stays on record so
// the launcher lookup can answer 'code_revoked' (the owner's explicit UX
// requirement: "it would say project code expired or project code revoked")
// instead of the indistinguishable 'invalid_code', and the client list can
// finally show its own "revoked" state. Auth is unchanged and still airtight:
// every editor/viewer save and load authenticates by SELECTing the project's
// ACTIVE rows at request-processing time (cloudAuthSharedCode, active = 1), so
// a revoked code stops working immediately with zero token-lifetime gap — a
// request that authenticated before the UPDATE commits completes under the
// permission that was valid when it started (standard request-boundary
// revocation). The 25-code cap counts ACTIVE codes only, so revoked rows never
// block new codes.
async function handleCloudEditorRevoke(request, env, projectId, editorId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const res = await env.DB.prepare('UPDATE cloud_editor_codes SET active = 0 WHERE id = ? AND project_id = ? AND active = 1').bind(editorId, projectId).run();
  if (!res.meta.changes) return json({ ok: false, error: 'editor code not found' }, 404);
  return json({ ok: true, revokedEditorId: editorId });
}

// ---- changelog (Phase 3) -----------------------------------------
// GET /api/cloud/projects/:id/changelog — owner-only (code or session).
async function handleCloudChangelogList(request, env, projectId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  // MCP-CHANGELOG-UI (backlog, 2026-08-12): import_key is selected so the
  // client can tell MCP-imported entries from native ones — the changelog UI
  // renders imported AI entries with a distinct badge. The import_key value
  // itself is never exposed, only the derived source flag.
  const rows = await env.DB.prepare('SELECT id, entry_type, actor_type, actor_label, section, diffs_json, snapshot_key, import_key, created_at FROM cloud_changelog WHERE project_id = ? ORDER BY id DESC LIMIT 100').bind(projectId).all();
  const entries = (rows.results || []).map(function(r) {
    let diffs = null;
    try { if (r.diffs_json) diffs = JSON.parse(r.diffs_json); } catch (e) { diffs = null; }
    return { id: r.id, type: r.entry_type, actorType: r.actor_type, actorLabel: r.actor_label, section: r.section, diffs: diffs, hasSnapshot: !!r.snapshot_key, source: r.import_key ? 'mcp' : 'cloud', createdAt: r.created_at };
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
  // REVIEW QUEUE (2026-08-17): an 'accepted' entry carries the same
  // field-level diffs as an 'edit' — reverting it undoes the accepted
  // proposal exactly like an editor save.
  if (entry.entry_type === 'edit' || entry.entry_type === 'accepted' || (entry.entry_type === 'revert' && !entry.snapshot_key)) {
    let diffs = [];
    try { if (entry.diffs_json) diffs = JSON.parse(entry.diffs_json); } catch (e) { diffs = []; }
    const pre = JSON.parse(JSON.stringify(cur));
    const revDiffs = [];
    diffs.forEach(function(d) {
      const curVal = cloudPathGet(pre, d.path);
      // CLOUD-MCP-IMPORT: cloudRevertDiff resolves record diffs by stable
      // recordId (MCP-imported entries) with the recorded-index fallback for
      // cloud-native leaf diffs — behavior identical to the old inline
      // cloudPathSet/cloudPathDelete when no recordId is present.
      const applied = cloudRevertDiff(pre, d);
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

// ---- MCP changelog importer (CLOUD-MCP-IMPORT, 2026-08-11) --------
// POST /api/cloud/projects/:id/changelog/import — owner-only.
// The MCP server (mcp/) records AI edits in a cloud-shaped sidecar
// changelog (<project>.mcp-changelog.json). This endpoint imports those
// entries into the D1 changelog so AI edits become cloud-auditable AND
// cloud-revertible through the existing revert route.
//
// Honesty gate: every diff in an imported entry is VERIFIED against the
// current cloud blob — the blob must already be in the state the MCP edit
// produced (record diffs resolve by recordId, field diffs by recorded
// path). An entry whose diffs no longer match the blob (the cloud moved on,
// or the exported file was edited after the AI run) is SKIPPED and reported
// as stale, NEVER stored: a stale diff would write the wrong value on a
// later revert. A project with no snapshot yet has nothing to verify
// against, so every entry is skipped with that reason.
//
// Idempotency: each stored row carries import_key 'mcp:<projectId>:<localId>'
// (UNIQUE, migration 0005) — re-importing the same local entry is a silent
// no-op (ON CONFLICT DO NOTHING), so a lost CLI ledger can never duplicate
// audit rows.
//
// Normalization: MCP 'bulk' entries carry field diffs but NO R2 snapshot
// (the sidecar has no snapshot machinery) — they are stored as 'edit' so
// the revert route can undo them; 'bulk' without diffs and 'recovery' are
// rejected (nothing reversible).
const CLOUD_IMPORT_MAX_ENTRIES = 500;
const CLOUD_IMPORT_MAX_DIFFS = 1000;

// Sanitize + validate ONE submitted entry. The sidecar's diffs_json may be
// a JSON string or an array; note that JSON round-trip DROPS undefined
// before/after values, so only path/beforeAbsent/afterAbsent are required
// structural invariants (recordId is optional but always present on MCP
// record diffs). Returns { ok:true, entry } or { ok:false, reason }.
function sanitizeImportEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'malformed entry' };
  const localId = Number(raw.localId !== undefined ? raw.localId : raw.id);
  if (!Number.isInteger(localId) || localId < 1) return { ok: false, reason: 'localId must be a positive integer' };
  const type = String(raw.entry_type || '');
  if (type !== 'edit' && type !== 'bulk' && type !== 'revert') return { ok: false, reason: 'unsupported entry_type "' + type + '"' };
  const actorType = raw.actor_type === 'editor' ? 'editor' : 'owner';
  const label = typeof raw.actor_label === 'string' && raw.actor_label.trim()
    ? raw.actor_label.trim().slice(0, 60) : 'mcp-ai';
  const createdAt = String(raw.created_at || '');
  if (!createdAt || Number.isNaN(Date.parse(createdAt))) return { ok: false, reason: 'created_at must be an ISO date' };
  let diffs = null;
  if (raw.diffs_json !== undefined && raw.diffs_json !== null) {
    if (typeof raw.diffs_json === 'string') {
      try { diffs = JSON.parse(raw.diffs_json); } catch (e) { return { ok: false, reason: 'diffs_json is not valid JSON' }; }
    } else {
      diffs = raw.diffs_json;
    }
    if (!Array.isArray(diffs)) return { ok: false, reason: 'diffs_json must be an array' };
    if (diffs.length > CLOUD_IMPORT_MAX_DIFFS) return { ok: false, reason: 'too many diffs (max ' + CLOUD_IMPORT_MAX_DIFFS + ')' };
    for (let i = 0; i < diffs.length; i++) {
      const d = diffs[i];
      if (!d || typeof d !== 'object' || typeof d.path !== 'string' || !d.path) return { ok: false, reason: 'diff missing path' };
      if (typeof d.beforeAbsent !== 'boolean' || typeof d.afterAbsent !== 'boolean') return { ok: false, reason: 'diff missing beforeAbsent/afterAbsent' };
    }
  }
  return { ok: true, entry: { localId: localId, type: type, actorType: actorType, label: label, createdAt: createdAt, diffs: diffs } };
}

// Verify one entry's diffs against the current blob (the MCP edit's AFTER
// state). Record diffs resolve by recordId — an add must be present and
// equal to d.after, a delete must be absent, an update must equal d.after
// (whole-record or field) — exactly the resolution the revert route will
// use, so a verified entry reverts correctly by construction. Charter/leaf
// diffs compare by path. Returns { ok:true } or { ok:false, reason }.
function cloudVerifyImportedDiffs(blob, diffs) {
  for (let i = 0; i < diffs.length; i++) {
    const d = diffs[i];
    const m = String(d.path).match(/^([a-zA-Z]+)(?:\[(\d+)\])?(?:\.([a-zA-Z]+))?$/);
    if (!m) return { ok: false, reason: 'malformed diff path ' + d.path };
    const listKey = m[1];
    const field = m[3];
    if (listKey === 'charter') {
      const v = cloudPathGet(blob, d.path);
      if (d.afterAbsent ? v !== undefined : !cloudDeepEqual(v, d.after)) {
        return { ok: false, reason: 'blob diverged from the MCP edit at ' + d.path };
      }
      continue;
    }
    const list = blob[listKey];
    if (!Array.isArray(list)) return { ok: false, reason: 'no "' + listKey + '" in the cloud blob (blob diverged from the MCP edit)' };
    if (d.recordId !== undefined) {
      const rec = list.find(function(r) { return r && String(r.id) === String(d.recordId); });
      if (d.afterAbsent) {
        if (rec !== undefined) return { ok: false, reason: 'deleted record ' + d.recordId + ' still exists in the cloud (blob diverged from the MCP edit)' };
      } else if (d.beforeAbsent) {
        if (rec === undefined || !cloudDeepEqual(rec, d.after)) return { ok: false, reason: 'added record ' + d.recordId + ' missing from the cloud (blob diverged from the MCP edit)' };
      } else if (field) {
        if (rec === undefined || !cloudDeepEqual(rec[field], d.after)) return { ok: false, reason: 'field ' + d.path + ' diverged from the MCP edit' };
      } else {
        if (rec === undefined || !cloudDeepEqual(rec, d.after)) return { ok: false, reason: 'record ' + d.recordId + ' diverged from the MCP edit' };
      }
      continue;
    }
    // Defensive fallback (cloud-native leaf diff, no recordId): index compare.
    const v = cloudPathGet(blob, d.path);
    if (d.afterAbsent ? v !== undefined : !cloudDeepEqual(v, d.after)) {
      return { ok: false, reason: 'blob diverged from the MCP edit at ' + d.path };
    }
  }
  return { ok: true };
}

async function handleCloudChangelogImport(request, env, projectId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const read = await readCloudBody(request);
  if (read.tooLarge) return json({ ok: false, error: 'body too large' }, 413);
  if (read.bad || !read.body || typeof read.body !== 'object') return json({ ok: false, error: 'bad request' }, 400);
  const submitted = Array.isArray(read.body.entries) ? read.body.entries : null;
  if (!submitted || submitted.length === 0) return json({ ok: false, error: 'entries required' }, 400);
  if (submitted.length > CLOUD_IMPORT_MAX_ENTRIES) return json({ ok: false, error: 'too many entries (max ' + CLOUD_IMPORT_MAX_ENTRIES + ')' }, 400);
  const key = 'projects/' + projectId + '/latest.json';
  const cur = await cloudReadState(env, key);
  const imported = [];
  const skipped = [];
  for (let i = 0; i < submitted.length; i++) {
    const s = sanitizeImportEntry(submitted[i]);
    if (!s.ok) { skipped.push({ localId: submitted[i] && submitted[i].localId !== undefined ? submitted[i].localId : (submitted[i] && submitted[i].id !== undefined ? submitted[i].id : null), reason: s.reason }); continue; }
    const e = s.entry;
    if (!e.diffs || e.diffs.length === 0) {
      // Nothing to verify, nothing the revert route can undo.
      skipped.push({ localId: e.localId, reason: 'entry has no diffs' });
      continue;
    }
    if (!cur) {
      skipped.push({ localId: e.localId, reason: 'no cloud snapshot to verify against' });
      continue;
    }
    const v = cloudVerifyImportedDiffs(cur, e.diffs);
    if (!v.ok) { skipped.push({ localId: e.localId, reason: v.reason }); continue; }
    // REVIEW QUEUE (2026-08-17, always on): an imported AI edit becomes a
    // PENDING PROPOSAL, not an instant changelog row — the owner reviews it
    // in the Review section and ACCEPTS (the audit 'accepted' row is then
    // written) or REJECTS ('rejected' row, no audit entry). The blob is
    // already in the produced state (verified above), so accept is an
    // audit-acknowledgement; the diffs + original actor ride the proposal.
    const sec = cloudSectionOfDiffs(e.diffs);
    const res = await env.DB.prepare(
      'INSERT INTO cloud_reviews (project_id, proposal_type, source_type, source_label, diffs_json, section, actor_type, import_key, status, proposed_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(import_key) DO NOTHING'
    ).bind(projectId, 'mcp', 'mcp', e.label || 'MCP AI', JSON.stringify(e.diffs), sec, e.actorType || 'mcp', 'mcp:' + projectId + ':' + e.localId, 'pending', e.createdAt).run();
    if (!res.meta.changes) { skipped.push({ localId: e.localId, reason: 'already imported' }); continue; }
    imported.push({ localId: e.localId, reviewId: res.meta.last_row_id, type: 'mcp', section: sec });
  }
  // An import is the owner proving presence — refresh the purge window.
  if (imported.length) await cloudTouchOwner(env, projectId);
  return json({ ok: true, projectId: projectId, imported: imported, skipped: skipped, total: submitted.length });
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
  // PREF-SURFACING (backlog, 2026-08-12): the linked account's stored theme
  // preference (R2 prefs/<sub>.json) rides along per project so the operator
  // can see the prefs store in use from the admin cloud listing. google_sub is
  // selected INTERNALLY only — the raw sub is never exposed in the response,
  // just the derived themePrefs (palette/dark/updatedAt).
  // STABILIZATION (2026-08-16): deleted_at rides along so the admin Cloud
  // Projects list can render a tombstoned row as its "Deleted" state (Undo +
  // Delete permanently) instead of looking live — the owner's report: "when I
  // delete the local version from the admin panel, it is still showing in the
  // cloud project section at the bottom."
  const rows = await env.DB.prepare('SELECT project_id, owner_label, google_name, google_sub, latest_r2_key, created_at, updated_at, deleted_at FROM cloud_projects ORDER BY updated_at DESC').all();
  const projects = [];
  for (const r of (rows.results || [])) {
    let themePrefs = null;
    if (r.google_sub) {
      try {
        const obj = await env.R2.get(cloudPrefsKey(r.google_sub));
        if (obj) {
          const p = JSON.parse(await obj.text());
          if (p) themePrefs = {
            palette: cloudSanitizePalette(p.palette) || 'default',
            dark: !!p.dark,
            updatedAt: p.updatedAt || null
          };
        }
      } catch (e) { themePrefs = null; }
    }
    projects.push({ projectId: r.project_id, label: r.owner_label || null, linkedName: r.google_name || null, hasSnapshot: !!r.latest_r2_key, createdAt: r.created_at, updatedAt: r.updated_at, deletedAt: r.deleted_at || null, themePrefs: themePrefs });
  }
  return json({ ok: true, projects: projects });
}

// GET /api/cloud/projects — session-gated list of the SIGNED-IN OWNER'S
// cloud-linked projects (A5-3 decision, 2026-08-11: the multi-project
// "all my cloud projects" dashboard). Lists only rows whose google_sub
// matches the session — never another account's projects, and never leaks
// existence of ids the session does not own (same generic 403 as the rest
// of the API when no valid session rides along). No codes, no hashes.
async function handleCloudProjectList(request, env) {
  const session = await readSession(request, env);
  if (!session || !session.sub) return cloudForbidden();
  // PART F T9: the signed-in account sees its OWN projects (google_sub match)
  // plus every project it PINNED via an editor/viewer code (cloud_adoptions).
  // Adopted rows carry accessRole + adoptedAt so the launcher can render the
  // "Shared" chip; they are never confused with owned projects and never
  // leak projects the session has no capability for (adoption is keyed on
  // the session's own sub, created only after a real code load).
  const owned = await env.DB.prepare(
    'SELECT project_id, owner_label, google_name, latest_r2_key, created_at, updated_at, last_owner_seen_at FROM cloud_projects WHERE google_sub = ? AND deleted_at IS NULL'
  ).bind(session.sub).all();
  // LAUNCHER DELETE (owner 2026-08-17): adopted rows are NOT filtered on
  // deleted_at — when the owner deletes the main version, every recipient's
  // copy becomes DISCONTINUED (there is no continuation, no update — "just
  // what they have always had, and it will not work for them", per the
  // owner's words). The recipient still sees the card with a discontinued
  // flag + deletedAt so the launcher can prompt them to remove it; the
  // owner's OWN rows stay filtered (their delete is the intent, and the
  // launcher's undo toast + admin's tombstone view cover mistakes).
  const adopted = await env.DB.prepare(
    'SELECT p.project_id, p.owner_label, p.google_name, p.latest_r2_key, p.created_at, p.updated_at, p.last_owner_seen_at, p.deleted_at, a.role AS adopted_role, a.created_at AS adopted_at ' +
    'FROM cloud_adoptions a JOIN cloud_projects p ON p.project_id = a.project_id ' +
    'WHERE a.recipient_sub = ?'
  ).bind(session.sub).all();
  const seen = {};
  const projects = [];
  ((owned && owned.results) || []).forEach(function(r) {
    seen[r.project_id] = 1;
    projects.push({
      projectId: r.project_id,
      label: r.owner_label || null,
      linkedName: r.google_name || null,
      hasSnapshot: !!r.latest_r2_key,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      lastOwnerSeenAt: r.last_owner_seen_at || null,
      accessRole: 'owner',
      adoptedAt: null
    });
  });
  ((adopted && adopted.results) || []).forEach(function(r) {
    if (seen[r.project_id]) return; // owner rows win the dedup
    // LAUNCHER DELETE: a tombstoned project the recipient pinned renders as
    // discontinued (the launcher prompts them to remove it) instead of
    // silently vanishing — the owner's delete is still the ONLY thing that
    // can kill the main version, and the recipient only ever gets a
    // remove-from-my-list action for it.
    const discontinued = !!r.deleted_at;
    projects.push({
      projectId: r.project_id,
      label: r.owner_label || null,
      linkedName: r.google_name || null,
      hasSnapshot: !!r.latest_r2_key,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      lastOwnerSeenAt: r.last_owner_seen_at || null,
      accessRole: r.adopted_role === 'view' ? 'view' : 'editor',
      adoptedAt: r.adopted_at || null,
      discontinued: discontinued,
      deletedAt: discontinued ? (r.deleted_at || null) : null
    });
  });
  projects.sort(function(a, b) { return String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')); });
  return json({ ok: true, projects: projects });
}

// DELETE /api/cloud/projects/:id/adopt — a recipient removes a PINNED
// (adopted) project from their own My Cloud Projects list. Session + adoption
// row gated: only the adopting account itself can drop its own pin, and an
// owner's own project is never touched (the adoption row is keyed on the
// session's sub). No timing floor needed — same per-user capability read as
// cloudAuthAdoption.
async function handleCloudUnadopt(request, env, projectId) {
  const session = await readSession(request, env);
  if (!session || !session.sub) return cloudForbidden();
  const res = await env.DB.prepare('DELETE FROM cloud_adoptions WHERE project_id = ? AND recipient_sub = ?').bind(projectId, session.sub).run();
  if (!res.meta.changes) return json({ ok: false, error: 'not adopted' }, 404);
  return json({ ok: true, removed: projectId });
}

// ---- account theme preference (THEME-SYSTEM-AND-MOBILE-UI-ACTION-PLAN §2.3) ----
// GET/PUT /api/cloud/prefs/theme — session-gated (the signed-in Google
// account), stored as a tiny JSON blob in R2 (prefs/<sub>.json). No D1
// migration needed and offline-first is untouched: the client always applies
// localStorage instantly and treats this endpoint as the preferred-but-
// optional source of truth. A 403 here (no valid session) simply means the
// client keeps its local cache. Same generic forbidden as the rest of the
// API — nothing leaks about whether the account exists.
const CLOUD_PREFS_PREFIX = 'prefs/';
function cloudPrefsKey(sub) { return CLOUD_PREFS_PREFIX + sub + '.json'; }
function cloudSanitizePalette(v) { return v === 'cyan' || v === 'default' ? v : null; }
// SIDEBAR-HAMBURGER-TOGGLE-PLAN: the desktop sidebar layout lives in the SAME
// R2 prefs blob as palette/dark — one session-gated endpoint serves the whole
// device-preference set, so a signed-in account's layout follows across devices.
function cloudSanitizeSidebar(v) { return v === 'on' || v === 'off' ? v : null; }

async function handleCloudPrefsGet(request, env) {
  const session = await readSession(request, env);
  if (!session || !session.sub) return cloudForbidden();
  const obj = await env.R2.get(cloudPrefsKey(session.sub));
  if (!obj) return json({ ok: true, theme: { palette: 'default', dark: false, sidebar: null } });
  let parsed = null;
  try { parsed = JSON.parse(await obj.text()); } catch (e) { parsed = null; }
  const palette = cloudSanitizePalette(parsed && parsed.palette) || 'default';
  // sidebar is nullable — a pre-sidebar blob or an untouched account simply
  // has no layout preference yet (client keeps its local default).
  const sidebar = cloudSanitizeSidebar(parsed && parsed.sidebar);
  return json({ ok: true, theme: { palette: palette, dark: !!(parsed && parsed.dark), sidebar: sidebar } });
}

async function handleCloudPrefsPut(request, env) {
  const session = await readSession(request, env);
  if (!session || !session.sub) return cloudForbidden();
  // The payload is at most two tiny fields — reject anything bigger up front
  // so a session-holding client can't stuff the endpoint (cheap hardening).
  const cl = Number(request.headers.get('content-length') || 0);
  if (cl > 2048) return json({ ok: false, error: 'payload too large' }, 413);
  let body = null;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'invalid JSON body' }, 400); }
  const palette = cloudSanitizePalette(body && body.palette);
  const dark = body && typeof body.dark === 'boolean' ? body.dark : null;
  const sidebar = cloudSanitizeSidebar(body && body.sidebar);
  if (palette === null && dark === null && sidebar === null) return json({ ok: false, error: 'nothing to save (palette must be "default"|"cyan", dark a boolean, sidebar "on"|"off")' }, 400);
  const key = cloudPrefsKey(session.sub);
  let cur = { palette: 'default', dark: false, sidebar: null };
  const existing = await env.R2.get(key);
  if (existing) { try { const p = JSON.parse(await existing.text()); if (p) cur = p; } catch (e) { /* keep defaults */ } }
  const next = {
    palette: palette === null ? (cloudSanitizePalette(cur.palette) || 'default') : palette,
    dark: dark === null ? !!cur.dark : dark,
    sidebar: sidebar === null ? (cloudSanitizeSidebar(cur.sidebar) || null) : sidebar,
    updatedAt: new Date().toISOString()
  };
  await env.R2.put(key, JSON.stringify(next), { httpMetadata: { contentType: 'application/json' } });
  return json({ ok: true, theme: { palette: next.palette, dark: next.dark, sidebar: next.sidebar } });
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
  // AUTH MAINFRAME v2 (verified-email gate): an EMAIL account must have
  // verified its address before it can OWN (link) a cloud project — this is
  // what makes account-occupation (registering someone else's email first)
  // useless. Google sessions (platform-verified identities) are never gated,
  // and the gate is off entirely when email is unconfigured (no
  // RESEND_API_KEY) so the dormant path behaves byte-for-byte as before.
  // Enforced at create, so a freshly-verified session works on the next
  // attempt — no cached state to go stale.
  if (session && session.sub && session.sub.indexOf('email:') === 0 && authEmailConfigured(env)) {
    const userRow = await env.DB.prepare('SELECT email_verified FROM auth_users WHERE email = ?').bind(session.sub.slice('email:'.length)).first();
    if (!userRow || !userRow.email_verified) {
      return json({ ok: false, error: 'verify your email to enable cloud projects — check your inbox for the confirmation link', verifyRequired: true }, 403);
    }
  }
  // BILLING TIER (deferred cloud item #15, 2026-08-12): a session-LINKED
  // free account is capped at FREE_PROJECT_CAP linked projects (default 8,
  // per the owner's decision 2026-08-14);
  // over the cap requires an active subscription (HTTP 402 + upgrade flag).
  // Only enforced when the tier is configured (all three LEMONSQUEEZY_*
  // secrets present) and only for session-linked creates — code-only
  // (unlinked) creates are never capped, so the dormant/unconfigured path
  // behaves byte-for-byte as before.
  if (session && session.sub && billingConfigured(env)) {
    const cnt = await env.DB.prepare('SELECT COUNT(*) AS c FROM cloud_projects WHERE google_sub = ? AND deleted_at IS NULL').bind(session.sub).first();
    const owned = (cnt && cnt.c) || 0;
    if (owned >= billingFreeCap(env)) {
      // Over the free cap: allowed only while an ACTIVE subscription exists
      // (qa-email-auth B5 caught the missing active-check — the cap must
      // gate FREE accounts, never block a paying one).
      const sub = await env.DB.prepare('SELECT status FROM cloud_subscriptions WHERE owner_sub = ?').bind(session.sub).first();
      if (!(sub && billingStatusActive(sub.status))) {
        return json({ ok: false, error: 'free plan limit reached — upgrade to create more linked projects', upgrade: true }, 402);
      }
    }
  }
  const salt = randomSaltHex();
  const ownerCode = randomOwnerCode();
  const hash = await hashOwnerCode(ownerCode, salt);
  const ownerFp = await fingerprintOf(ownerCode);
  const now = new Date().toISOString();
  // CREATE-RACE GUARD (review finding): two concurrent creates for the same
  // id can both pass the SELECT above and then both INSERT — the second
  // duplicate-key throw would bubble to the outer fetch catch and answer
  // 404 Not Found instead of the intended 409. Catching the insert and
  // re-checking turns that race into the same "already linked" 409.
  try {
    // A5-2: the owner is provably present at creation — stamp the purge
    // window immediately so a created-but-never-saved project is not exempt
    // from the retention policy forever (NULL would be treated as immortal
    // by the purge's IS NOT NULL guard).
    await env.DB.prepare(
      'INSERT INTO cloud_projects (project_id, owner_code_salt, owner_code_hash, owner_code_fingerprint, owner_label, google_sub, google_name, latest_r2_key, created_at, updated_at, last_owner_seen_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
    ).bind(projectId, salt, hash, ownerFp, name, session ? session.sub : null, session ? session.name : null, null, now, now, now).run();
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
//  // MAINTENANCE TRAP (gap-audit item A7): this list is the ONLY server-side
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
// ---- REVIEW QUEUE (2026-08-17, approved "always on") ----------------
// An editor's scoped save becomes a PENDING proposal instead of moving the
// blob. The raw submission + grant scope are stored so ACCEPT re-runs the
// SAME cloudScopeMerge against the then-current snapshot (honest diffs at
// apply time, same enforcement as today's save). Leaf diffs vs the snapshot
// at propose time are stored for the review UI (fieldTs excluded — it is
// server-managed metadata, not content). Last-proposal-wins: a new save
// from the same editor code REPLACES that editor's still-pending proposal.
// Returns { status, reviewId, applied, blocked }; status 'noop' means the
// editor's grant would change nothing (no proposal row created).
async function queueEditorProposal(env, projectId, a, submitted, prev, now) {
  const merged = cloudScopeMerge(prev, submitted, a.scope);
  const scope = Array.isArray(a.scope) ? a.scope : [];
  if (!merged.applied.length) return { status: 'noop', reviewId: null, applied: merged.applied, blocked: merged.blocked };
  let diffs = cloudDiffState(prev, merged.next) || [];
  diffs = diffs.filter(function(d) { return String(d.path).indexOf('fieldTs') !== 0; });
  await env.DB.prepare('DELETE FROM cloud_reviews WHERE project_id = ? AND editor_code_id = ? AND status = ?')
    .bind(projectId, a.editorId, 'pending').run();
  const res = await env.DB.prepare(
    'INSERT INTO cloud_reviews (project_id, proposal_type, source_type, source_label, editor_code_id, scope, submitted_json, diffs_json, status, proposed_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).bind(projectId, 'save', 'editor', a.label || 'Editor', a.editorId, JSON.stringify(scope),
    JSON.stringify(stripStateSecrets(submitted)), JSON.stringify(diffs), 'pending', now).run();
  return { status: 'pending', reviewId: res.meta.last_row_id, applied: merged.applied, blocked: merged.blocked };
}

async function handleCloudSave(request, env, projectId) {
  const read = await readCloudBody(request);
  if (read.tooLarge) return json({ ok: false, error: 'body too large' }, 413);
  if (read.bad || !read.body || typeof read.body !== 'object') return json({ ok: false, error: 'bad request' }, 400);
  if (read.body.state === undefined || read.body.state === null) return json({ ok: false, error: 'missing state' }, 400);
  const ownerCode = String(request.headers.get('X-Owner-Code') || '').trim()
    || (typeof read.body.ownerCode === 'string' ? read.body.ownerCode.trim() : '');
  const editorCode = String(request.headers.get('X-Editor-Code') || '').trim()
    || (typeof read.body.editorCode === 'string' ? read.body.editorCode.trim() : '');
  // PART F T9: with NO code, an adopted editor (a project pinned after an
  // editor-code load) saves through the session + adoption row — the same
  // server-side scope merge as a code-holder. Adopted VIEWERS never save
  // (the adoption row itself re-reads the live code row, so a revoked code
  // answers code_revoked and a downgraded role is enforced here).
  let adoptAuth = null;
  if (!ownerCode && !editorCode) {
    adoptAuth = await cloudAuthAdoption(request, env, projectId);
    if (adoptAuth && adoptAuth.revoked) return json({ ok: false, error: 'code_revoked' }, 403);
    if (adoptAuth && adoptAuth.deleted) return cloudProjectDeleted();
    if (!adoptAuth) { await Promise.all([cloudDummyHash(), cloudTimingSink()]); return cloudForbidden(); }
    if (adoptAuth.role !== 'editor') { await cloudTimingSink(); return cloudForbidden(); }
  }
  const now = new Date().toISOString();
  const key = 'projects/' + projectId + '/latest.json';
  const prev = await cloudReadState(env, key);
  let next; let actor; let scopeReport = null; let authRow = null;
  if (ownerCode) {
    const a = await cloudAuthOwnerByCode(request, env, projectId, ownerCode);
    if (!a) return cloudForbidden();
    authRow = a.row;
    actor = { type: 'owner', label: a.label };
    next = JSON.parse(JSON.stringify(read.body.state));
    stripStateSecrets(next);
    // A5-2: an owner save is owner activity — refresh the purge window.
    await cloudTouchOwner(env, projectId);
  } else if (adoptAuth) {
    const a = adoptAuth;
    authRow = a.row;
    actor = { type: 'editor', label: a.label };
    // REVIEW QUEUE (approved 2026-08-17, always on): an editor's save is a
    // PROPOSAL — never applied directly. The blob does not move (and no
    // rev-changed push fires) until the owner accepts. The raw submission
    // + grant scope are stored so ACCEPT re-runs this same scope merge.
    const queued = await queueEditorProposal(env, projectId, a, read.body.state, prev, now);
    return json({ ok: true, review: queued.status, reviewId: queued.reviewId, actor: 'editor', editorLabel: a.label, scope: a.scope, applied: queued.applied, blocked: queued.blocked, previousUpdatedAt: (prev && prev.updatedAt) || null });
  } else {
    const a = await cloudAuthEditor(request, env, projectId, editorCode);
    if (!a) return cloudForbidden();
    authRow = a.row;
    actor = { type: 'editor', label: a.label };
    // CLOUD-CODES-AND-DELETE: a soft-deleted (admin-deleted) project must
    // not accept proposals either — checked on the SAME row read the auth
    // already did.
    if (authRow && authRow.deleted_at) return cloudProjectDeleted();
    const queued = await queueEditorProposal(env, projectId, a, read.body.state, prev, now);
    return json({ ok: true, review: queued.status, reviewId: queued.reviewId, actor: 'editor', editorLabel: a.label, scope: a.scope, applied: queued.applied, blocked: queued.blocked, previousUpdatedAt: (prev && prev.updatedAt) || null });
  }
  // CLOUD-CODES-AND-DELETE: a soft-deleted (admin-deleted) project must not
  // accept any further writes — the tombstone is checked on the SAME row
  // read the auth already did (no extra SELECT on hot paths).
  if (authRow && authRow.deleted_at) return cloudProjectDeleted();
  next.updatedAt = now;
  await env.R2.put(key, JSON.stringify(next), { httpMetadata: { contentType: 'application/json' } });
  await env.DB.prepare('UPDATE cloud_projects SET latest_r2_key = ?, updated_at = ? WHERE project_id = ?').bind(key, now, projectId).run();
  const entry = await cloudLogSave(env, projectId, prev, next, actor);
  const resp = { ok: true, savedAt: now, key: key, actor: actor.type };
  // A5-2 (review pass): only the owner path needs the touch — and it was
  // already stamped above. The earlier version probed the session on EVERY
  // save (including editor saves), adding a D1 SELECT to the hottest path.
  // No extra work here: the owner branch already called cloudTouchOwner.
  // Gap-audit item B9: report the PREVIOUS snapshot's update time so the
  // client can warn when another device saved between this device's last
  // sync and this save (last-write-wins WITH a heads-up, not silently).
  resp.previousUpdatedAt = (prev && prev.updatedAt) || null;
  if (scopeReport) Object.assign(resp, scopeReport);
  if (entry) resp.changelog = entry;
  // CLOUD-FIRST SYNC (PART 3, approved 2026-08-17): live refresh on save —
  // every successful save pushes rev-changed to CONNECTED copies so they
  // update instantly (the approved "copies update when the main device
  // saves" scope; still never project content over the socket). When the
  // owner has turned on per-project AUTO-BROADCAST, the save also records a
  // changelog 'broadcast' entry so the audit trail shows the propagation.
  // Both are gated on the project having >=1 registered copy — a project
  // with no copies needs neither the push nor the entry (and a DO fetch
  // would otherwise wake an idle DO for nothing). Never fails the save.
  await cloudPushRevChangedIfCopies(env, projectId, now, actor);
  return json(resp);
}

// REVIEW QUEUE shared push: after an ACCEPT (or any save) moves the blob,
// tell connected copies + log the auto-broadcast entry when the project has
// >=1 registered copy. Same additive discipline as the save path.
async function cloudPushRevChangedIfCopies(env, projectId, now, actor) {
  try {
    const syncRow = await env.DB.prepare(
      'SELECT auto_broadcast, (SELECT COUNT(*) FROM offline_copies WHERE project_id = ?) AS copies FROM cloud_projects WHERE project_id = ?'
    ).bind(projectId, projectId).first();
    const nCopies = syncRow ? Number(syncRow.copies || 0) : 0;
    if (nCopies > 0) {
      await presencePushRevChanged(env, projectId, now);
      if (syncRow && syncRow.auto_broadcast) {
        await env.DB.prepare(
          'INSERT INTO cloud_changelog (project_id, entry_type, actor_type, actor_label, section, diffs_json, snapshot_key, created_at) VALUES (?,?,?,?,?,?,?,?)'
        ).bind(projectId, 'broadcast', actor.type, actor.label || (actor.type === 'owner' ? 'Owner' : 'Editor'), null, null, null, now).run();
      }
    }
  } catch (e) { /* sync push is additive — never fail a save */ }
}

// POST /api/cloud/projects/:id/load  (X-Owner-Code header or body.ownerCode)
// Verifies the code, streams the latest R2 snapshot back. A project with no
// snapshot yet returns state:null (still ok).

// POST /api/cloud/projects/:id/load
// Auth: X-Owner-Code OR X-Editor-Code (headers — the client always sends
// the credential in the header), OR the linked owner's Google session
// (A5-3: the multi-project dashboard lets a signed-in owner load any of
// their own projects without re-entering the code — same sub-match gate
// handleCloudMeta uses). An EDITOR load additionally returns
// role/editorLabel/scope so the app can grey out (UX) what the server
// already enforces. No blob yet -> state:null.
async function handleCloudLoad(request, env, projectId) {
  const ownerCode = String(request.headers.get('X-Owner-Code') || '').trim();
  const editorCode = String(request.headers.get('X-Editor-Code') || '').trim();
  const viewCode = String(request.headers.get('X-View-Code') || '').trim();
  // Review pass (2026-08-11): resolve the session fallback ONCE up front and
  // reuse it — the earlier version verified the session twice (two row reads
  // + two timing sinks per session-only load). The no-credential failure path
  // still runs the same dummy-hash + timing-floor composite as every other
  // "no row / wrong code" branch.
  // PART F T9: a non-owner signed-in session may still hold a recipient
  // adoption — probe it BEFORE the generic rejection so a pinned project
  // re-opens without re-typing the code. No session at all still gets the
  // generic rejection (timing discipline preserved); a revoked/tombstoned
  // adoption surfaces its distinct message in the branch below.
  let sessFallback = null;
  let adoptFallback = null;
  if (!ownerCode && !editorCode && !viewCode) {
    sessFallback = await cloudAuthOwnerSession(request, env, projectId);
    if (!sessFallback) {
      adoptFallback = await cloudAuthAdoption(request, env, projectId);
      if (!adoptFallback) { await Promise.all([cloudDummyHash(), cloudTimingSink()]); return cloudForbidden(); }
    }
  }
  const row = await env.DB.prepare('SELECT owner_code_salt, owner_code_hash, latest_r2_key, updated_at, deleted_at FROM cloud_projects WHERE project_id = ?').bind(projectId).first();
  if (!row) { await Promise.all([cloudDummyHash(), cloudTimingSink()]); return cloudForbidden(); }
  let editorAuth = null;
  let viewerAuth = null;
  let ownerAuth = false;
  if (ownerCode) {
    const hash = await hashOwnerCode(ownerCode, row.owner_code_salt);
    if (!codesEqual(hash, row.owner_code_hash)) { await cloudTimingSink(); return cloudForbidden(); }
    ownerAuth = true;
  } else if (editorCode) {
    editorAuth = await cloudAuthEditor(request, env, projectId, editorCode);
    if (!editorAuth) return cloudForbidden();
    // PART F T9: a signed-in recipient loading with an editor code pins the
    // project into their My Cloud Projects list (server-side adoption).
    const sess = await readSession(request, env);
    if (sess && sess.sub) await cloudAdopt(env, projectId, sess.sub, editorAuth.editorId, 'editor');
  } else if (viewCode) {
    viewerAuth = await cloudAuthViewer(request, env, projectId, viewCode);
    if (!viewerAuth) return cloudForbidden();
    const sess = await readSession(request, env);
    if (sess && sess.sub) await cloudAdopt(env, projectId, sess.sub, viewerAuth.editorId, 'view');
  } else if (sessFallback) {
    ownerAuth = true;
  } else if (adoptFallback) {
    // PART F T9: session-only load falls back to the recipient adoption row
    // (a project pinned after an editor/viewer code load re-opens without
    // re-typing the code). The adoption re-reads the LIVE code row so a
    // revoked code answers code_revoked here too.
    if (adoptFallback.revoked) return json({ ok: false, error: 'code_revoked' }, 403);
    if (adoptFallback.deleted) return cloudProjectDeleted();
    if (adoptFallback.role === 'view') viewerAuth = adoptFallback;
    else editorAuth = adoptFallback;
  }
  // CLOUD-CODES-AND-DELETE: tombstoned projects refuse every read too —
  // checked only after a successful auth so the message goes only to
  // people who held a valid credential.
  if (row.deleted_at) return cloudProjectDeleted();
  // A5-2: an owner load (code or session) is owner activity.
  if (ownerAuth) await cloudTouchOwner(env, projectId);
  if (!row.latest_r2_key) {
    const base = { ok: true, state: null, savedAt: null };
    if (editorAuth) { base.role = 'editor'; base.editorLabel = editorAuth.label; base.scope = editorAuth.scope; }
    if (viewerAuth) { base.role = 'view'; base.viewerLabel = viewerAuth.label; base.scope = viewerAuth.scope; }
    return json(base);
  }
  // CLOUD-FIRST SYNC (PART 3, approved 2026-08-17): when a REGISTERED
  // offline copy pulls (X-Device-Id rides the pull), stamp the copy's
  // freshness — last_pulled_at + last_cloud_rev = the revision just pulled —
  // so the owner's Broadcast UI shows accurate "last pulled" data. Only the
  // copy-pull path sends the header; ordinary loads never stamp. Best-effort.
  const pullDevice = String(request.headers.get('X-Device-Id') || '').trim();
  if (pullDevice) {
    try {
      await env.DB.prepare(
        'UPDATE offline_copies SET last_pulled_at = ?, last_cloud_rev = ? WHERE project_id = ? AND device_id = ?'
      ).bind(new Date().toISOString(), row.updated_at, projectId, pullDevice).run();
    } catch (e) { /* stamping a pull is best-effort */ }
  }
  const state = await cloudReadState(env, row.latest_r2_key);
  const resp = { ok: true, state: state, savedAt: row.updated_at };
  if (editorAuth) { resp.role = 'editor'; resp.editorLabel = editorAuth.label; resp.scope = editorAuth.scope; }
  if (viewerAuth) { resp.role = 'view'; resp.viewerLabel = viewerAuth.label; resp.scope = viewerAuth.scope; }
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
  const ownerFp = await fingerprintOf(ownerCode);
  const now = new Date().toISOString();
  await env.DB.prepare('UPDATE cloud_projects SET owner_code_salt = ?, owner_code_hash = ?, owner_code_fingerprint = ?, updated_at = ? WHERE project_id = ?')
    .bind(salt, hash, ownerFp, now, projectId).run();
  // Gap-audit items A3/A4: a recovery is now its own changelog event so the
  // owner can see IN-APP that a reissue ever happened. Attribution is
  // preserved — existing rows keep their recorded actor labels; only the
  // owner-code salt/hash are rotated, never history. entry_type 'recovery'
  // carries no diffs/snapshot and is not revertible by design (re-issueing
  // a code is an identity action, not a content change).
  await env.DB.prepare(
    'INSERT INTO cloud_changelog (project_id, entry_type, actor_type, actor_label, section, diffs_json, snapshot_key, created_at) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(projectId, 'recovery', 'owner', row.google_name || 'Owner', null, null, null, now).run();
  // A5-2: a recovery is the owner proving they are present — refresh the
  // purge window.
  await cloudTouchOwner(env, projectId);
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
  const vcode = String(request.headers.get('X-View-Code') || '').trim();
  const session = await readSession(request, env);
  const row = await env.DB.prepare('SELECT owner_code_salt, owner_code_hash, google_sub, google_name, owner_label, latest_r2_key, updated_at, deleted_at FROM cloud_projects WHERE project_id = ?').bind(projectId).first();
  if (!row) { await Promise.all([cloudDummyHash(), cloudTimingSink()]); return cloudForbidden(); }
  let authorized = false;
  let isEditor = false; let editorScope = null; let editorLabel = null;
  let viewer = false; let viewerScope = null;
  // PART F T9: only an OWNER probe (session or code) counts as owner
  // activity — adopted recipients must never refresh the owner's purge window.
  let ownerProbe = false;
  if (code) {
    const hash = await hashOwnerCode(code, row.owner_code_salt);
    authorized = codesEqual(hash, row.owner_code_hash);
    if (authorized) ownerProbe = true;
  } else if (ecode) {
    const ea = await cloudAuthEditor(request, env, projectId, ecode);
    if (ea) { authorized = true; isEditor = true; editorScope = ea.scope; editorLabel = ea.label; }
  } else if (vcode) {
    const va = await cloudAuthViewer(request, env, projectId, vcode);
    if (va) { authorized = true; isEditor = true; viewerScope = va.scope; editorLabel = va.label; viewer = true; }
  }
  if (!authorized && session && session.sub && row.google_sub && row.google_sub === session.sub) { authorized = true; ownerProbe = true; }
  if (!authorized && !ownerProbe) {
    // PART F T9: session-only meta falls back to the recipient adoption row
    // (pinned projects re-open without re-typing the code).
    const ad = await cloudAuthAdoption(request, env, projectId);
    if (ad && ad.revoked) return json({ ok: false, error: 'code_revoked' }, 403);
    if (ad && ad.deleted) return cloudProjectDeleted();
    if (ad) {
      authorized = true; isEditor = true;
      editorScope = ad.scope; editorLabel = ad.label;
      viewer = ad.role === 'view';
      if (viewer) viewerScope = ad.scope;
    }
  }
  if (!authorized) return cloudForbidden();
  // CLOUD-CODES-AND-DELETE: tombstoned projects refuse every read.
  if (row.deleted_at) return cloudProjectDeleted();
  // A5-2: only an OWNER meta probe (session or code) is owner activity — an
  // adopted recipient probing must never refresh the owner's purge window.
  if (ownerProbe) await cloudTouchOwner(env, projectId);
  const resp = {
    ok: true, projectId: projectId, linked: !!row.google_sub,
    linkedName: row.google_name || null, label: row.owner_label || null,
    hasSnapshot: !!row.latest_r2_key, updatedAt: row.updated_at
  };
  if (isEditor && !viewer) { resp.role = 'editor'; resp.editorLabel = editorLabel; resp.scope = editorScope; }
  if (viewer) { resp.role = 'view'; resp.editorLabel = editorLabel; resp.scope = viewerScope; }
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
  // PART F T9: unlink drops every recipient adoption too (the codes they
  // pointed at are gone with the project).
  await env.DB.prepare('DELETE FROM cloud_adoptions WHERE project_id = ?').bind(projectId).run();
  // CLOUD-FIRST SYNC: unlink drops every registered offline copy as well.
  await env.DB.prepare('DELETE FROM offline_copies WHERE project_id = ?').bind(projectId).run();
  // REVIEW QUEUE: unlink drops every pending/decided proposal too.
  await env.DB.prepare('DELETE FROM cloud_reviews WHERE project_id = ?').bind(projectId).run();
  return json({ ok: true, unlinked: projectId, unlinkedAt: now });
}

// ---- CLOUD-FIRST SYNC (PART 3, approved 2026-08-17): offline copies ----
// Any VALID access to the project can register an offline copy (viewer,
// editor, owner code, linked session, or adoption) — a copy is view-only by
// design, so registering it needs no special role. Returns the auth result
// or null after the standard timing discipline.
async function cloudAuthAnyAccess(request, env, projectId) {
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

// POST /api/cloud/projects/:id/offline-copies  { deviceId }
// Registers this device as a view-only offline copy of the cloud project.
// Idempotent per device (UNIQUE(project_id, device_id) upsert): a device
// re-registering gets its existing row back, never a duplicate. The device
// id is client-supplied (a stable per-device id, e.g. a localStorage uuid)
// and shape-checked. Returns the copy id + the current cloud revision so
// the client can store its starting last_cloud_rev without a second call.
async function handleOfflineCopyRegister(request, env, projectId) {
  const read = await readCloudBody(request);
  if (read.tooLarge) return json({ ok: false, error: 'body too large' }, 413);
  if (read.bad || !read.body || typeof read.body !== 'object') return json({ ok: false, error: 'bad request' }, 400);
  const deviceId = String(read.body.deviceId || '').trim();
  if (!deviceId || deviceId.length > 64 || !/^[A-Za-z0-9._:-]{1,64}$/.test(deviceId)) {
    return json({ ok: false, error: 'deviceId is required (letters, numbers, . _ : -)' }, 400);
  }
  const auth = await cloudAuthAnyAccess(request, env, projectId);
  if (!auth) return cloudForbidden();
  const row = await env.DB.prepare('SELECT deleted_at, updated_at FROM cloud_projects WHERE project_id = ?').bind(projectId).first();
  if (!row) return cloudForbidden();
  if (row.deleted_at) return cloudProjectDeleted();
  const now = new Date().toISOString();
  const copyId = crypto.randomUUID();
  const res = await env.DB.prepare(
    'INSERT INTO offline_copies (id, project_id, device_id, created_at) VALUES (?,?,?,?) ' +
    'ON CONFLICT(project_id, device_id) DO NOTHING'
  ).bind(copyId, projectId, deviceId, now).run();
  // DO NOTHING keeps the EXISTING row (stable id) when a device re-registers:
  // the copy's id is the client's handle for deleting its own copy, so it
  // must never churn. changes = 0 on conflict -> return the original id.
  const finalId = (res.meta && res.meta.changes > 0)
    ? copyId // inserted
    : (await env.DB.prepare('SELECT id FROM offline_copies WHERE project_id = ? AND device_id = ?').bind(projectId, deviceId).first() || {}).id;
  return json({ ok: true, copyId: finalId || copyId, deviceId: deviceId, registeredAt: now, revision: row.updated_at || null });
}

// GET /api/cloud/projects/:id/offline-copies — owner-only list of every
// registered offline copy (id, device, registered, last pulled + the rev
// it last pulled) plus the project's current revision and auto-broadcast
// flag, so the owner's Broadcast UI can show count + freshness.
async function handleOfflineCopyList(request, env, projectId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const row = await env.DB.prepare('SELECT deleted_at, updated_at, auto_broadcast FROM cloud_projects WHERE project_id = ?').bind(projectId).first();
  if (!row) return cloudForbidden();
  if (row.deleted_at) return cloudProjectDeleted();
  const rows = await env.DB.prepare(
    'SELECT id, device_id, created_at, last_pulled_at, last_cloud_rev FROM offline_copies WHERE project_id = ? ORDER BY created_at ASC'
  ).bind(projectId).all();
  const copies = (rows.results || []).map(function(r) {
    return {
      id: r.id, deviceId: r.device_id, createdAt: r.created_at,
      lastPulledAt: r.last_pulled_at, lastCloudRev: r.last_cloud_rev
    };
  });
  return json({ ok: true, copies: copies, revision: row.updated_at || null, autoBroadcast: !!row.auto_broadcast });
}

// DELETE /api/cloud/projects/:id/offline-copies/:copyId — unregister a
// copy. Owner (code or session) may remove any copy; the registering device
// itself may also remove its own (deviceId in the body). Same generic 403
// for everyone without the right.
async function handleOfflineCopyDelete(request, env, projectId, copyId) {
  const owner = await cloudAuthOwnerEither(request, env, projectId);
  let deviceId = '';
  if (!owner) {
    const read = await readCloudBody(request);
    if (!read.bad && read.body && typeof read.body === 'object') deviceId = String(read.body.deviceId || '').trim();
    if (!deviceId) return cloudForbidden();
  }
  const where = owner
    ? await env.DB.prepare('SELECT id FROM offline_copies WHERE id = ? AND project_id = ?').bind(copyId, projectId).first()
    : await env.DB.prepare('SELECT id FROM offline_copies WHERE id = ? AND project_id = ? AND device_id = ?').bind(copyId, projectId, deviceId).first();
  if (!where) return json({ ok: false, error: 'offline copy not found' }, 404);
  await env.DB.prepare('DELETE FROM offline_copies WHERE id = ? AND project_id = ?').bind(copyId, projectId).run();
  return json({ ok: true, removed: copyId });
}

// POST /api/cloud/projects/:id/broadcast — owner-only MANUAL broadcast:
// pushes the project's current revision to every connected copy via the
// Presence DO (connected copies refresh instantly; offline copies pick up
// the new rev on their next meta/load and show the Update icon), and logs
// a changelog entry type 'broadcast' so the audit trail shows it.
async function handleCloudBroadcast(request, env, projectId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const row = await env.DB.prepare('SELECT deleted_at, updated_at FROM cloud_projects WHERE project_id = ?').bind(projectId).first();
  if (!row) return cloudForbidden();
  if (row.deleted_at) return cloudProjectDeleted();
  const now = new Date().toISOString();
  const revision = row.updated_at || now;
  await presencePushRevChanged(env, projectId, revision);
  const cnt = await env.DB.prepare('SELECT COUNT(*) AS n FROM offline_copies WHERE project_id = ?').bind(projectId).first();
  const copies = cnt ? Number(cnt.n || 0) : 0;
  // Changelog 'broadcast' entry — not revertible (it is a push event, not a
  // content change), but visible in the owner's history.
  await env.DB.prepare(
    'INSERT INTO cloud_changelog (project_id, entry_type, actor_type, actor_label, section, diffs_json, snapshot_key, created_at) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(projectId, 'broadcast', 'owner', auth.label || 'Owner', null, null, null, now).run();
  return json({ ok: true, broadcastAt: now, revision: revision, copies: copies });
}

// PUT /api/cloud/projects/:id/auto-broadcast  { enabled }
// Owner-only per-project switch: when enabled, EVERY save also broadcasts
// its new revision to all registered copies (the auto form of the manual
// button — the owner "turns on auto broadcast for that specific project").
async function handleCloudAutoBroadcast(request, env, projectId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const read = await readCloudBody(request);
  if (read.tooLarge) return json({ ok: false, error: 'body too large' }, 413);
  if (read.bad || !read.body || typeof read.body !== 'object') return json({ ok: false, error: 'bad request' }, 400);
  const enabled = read.body.enabled === true || read.body.enabled === 1;
  const row = await env.DB.prepare('SELECT deleted_at FROM cloud_projects WHERE project_id = ?').bind(projectId).first();
  if (!row) return cloudForbidden();
  if (row.deleted_at) return cloudProjectDeleted();
  await env.DB.prepare('UPDATE cloud_projects SET auto_broadcast = ? WHERE project_id = ?').bind(enabled ? 1 : 0, projectId).run();
  return json({ ok: true, enabled: enabled });
}

// ---- REVIEW QUEUE (2026-08-17, approved "always on") ---------------------
// The owner's gate for changes from a non-owner source (editor saves +
// MCP imports). GET lists proposals; POST :id/accept applies + logs
// 'accepted'; POST :id/reject discards + logs 'rejected'. Owner-only for
// the list/decide endpoints; an editor can read their OWN proposals via
// ?mine=1 with the editor credential (status visibility on the source
// side — approved "review list with status").
async function handleReviewList(request, env, projectId, mine) {
  const code = String(request.headers.get('X-Owner-Code') || '').trim();
  const owner = code ? await cloudAuthOwnerEither(request, env, projectId) : null;
  let editorId = null; let editorLabel = null;
  if (!owner) {
    const ecode = String(request.headers.get('X-Editor-Code') || '').trim();
    if (ecode) {
      const a = await cloudAuthEditor(request, env, projectId, ecode);
      if (a) { editorId = a.editorId; editorLabel = a.label; }
    } else {
      const ad = await cloudAuthAdoption(request, env, projectId);
      if (ad && ad.role === 'editor') { editorId = ad.editorId; editorLabel = ad.label; }
    }
    if (!editorId) { await cloudTimingSink(); return cloudForbidden(); }
  }
  const row = await env.DB.prepare('SELECT deleted_at FROM cloud_projects WHERE project_id = ?').bind(projectId).first();
  if (!row) return cloudForbidden();
  if (row.deleted_at) return cloudProjectDeleted();
  if (owner && !mine) {
    const rows = await env.DB.prepare(
      'SELECT id, proposal_type, source_type, source_label, status, diffs_json, proposed_at, decided_at, decided_by, accepted_entry_id FROM cloud_reviews WHERE project_id = ? ORDER BY CASE WHEN status = ? THEN 0 ELSE 1 END, id DESC LIMIT 100'
    ).bind(projectId, 'pending').all();
    const proposals = (rows.results || []).map(function(r) {
      let diffs = null;
      try { if (r.diffs_json) diffs = JSON.parse(r.diffs_json); } catch (e) { diffs = null; }
      return { id: r.id, proposalType: r.proposal_type, sourceType: r.source_type, sourceLabel: r.source_label, status: r.status, diffs: diffs, proposedAt: r.proposed_at, decidedAt: r.decided_at, decidedBy: r.decided_by, acceptedEntryId: r.accepted_entry_id };
    });
    return json({ ok: true, proposals: proposals });
  }
  // Editor's own view (mine=1 or an editor credential): their proposals only.
  const mineRows = await env.DB.prepare(
    'SELECT id, proposal_type, source_type, source_label, status, diffs_json, proposed_at, decided_at FROM cloud_reviews WHERE project_id = ? AND editor_code_id = ? ORDER BY id DESC LIMIT 20'
  ).bind(projectId, editorId).all();
  const mineList = (mineRows.results || []).map(function(r) {
    let diffs = null;
    try { if (r.diffs_json) diffs = JSON.parse(r.diffs_json); } catch (e) { diffs = null; }
    return { id: r.id, proposalType: r.proposal_type, sourceType: r.source_type, sourceLabel: r.source_label || editorLabel, status: r.status, diffs: diffs, proposedAt: r.proposed_at, decidedAt: r.decided_at };
  });
  return json({ ok: true, proposals: mineList });
}

async function handleReviewAccept(request, env, projectId, reviewId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const row = await env.DB.prepare('SELECT * FROM cloud_reviews WHERE id = ? AND project_id = ?').bind(reviewId, projectId).first();
  if (!row) return json({ ok: false, error: 'proposal not found' }, 404);
  if (row.status !== 'pending') return json({ ok: false, error: 'proposal is not pending' }, 409);
  const now = new Date().toISOString();
  const resp = { ok: true, reviewId: reviewId, status: 'accepted', decidedAt: now };
  if (row.proposal_type === 'save') {
    const key = 'projects/' + projectId + '/latest.json';
    const prev = await cloudReadState(env, key);
    let scope = [];
    try { const p = JSON.parse(row.scope); if (Array.isArray(p)) scope = p; } catch (e) { scope = []; }
    let submitted = {};
    try { submitted = JSON.parse(row.submitted_json); } catch (e) { submitted = {}; }
    const merged = cloudScopeMerge(prev, submitted, scope);
    resp.applied = merged.applied;
    resp.blocked = merged.blocked;
    if (merged.applied.length > 0) {
      merged.next.updatedAt = now;
      await env.R2.put(key, JSON.stringify(merged.next), { httpMetadata: { contentType: 'application/json' } });
      await env.DB.prepare('UPDATE cloud_projects SET latest_r2_key = ?, updated_at = ? WHERE project_id = ?').bind(key, now, projectId).run();
      const entry = await cloudLogSave(env, projectId, prev, merged.next, { type: 'owner', label: auth.label || 'Owner' }, 'accepted');
      if (entry) resp.changelog = entry;
      await cloudPushRevChangedIfCopies(env, projectId, now, { type: 'owner', label: auth.label || 'Owner' });
      resp.savedAt = now;
    }
  } else if (row.proposal_type === 'mcp') {
    // The blob is already in the state the AI edit produced (verified at
    // import time). Accept = the owner acknowledges the AI change: the
    // audit row that today's importer wrote directly is written now, as
    // an 'accepted' entry carrying the original actor + diffs + import_key.
    const ins = await env.DB.prepare(
      "INSERT INTO cloud_changelog (project_id, entry_type, actor_type, actor_label, section, diffs_json, snapshot_key, created_at, import_key) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(import_key) DO NOTHING"
    ).bind(projectId, 'accepted', row.actor_type || 'mcp', row.source_label || 'MCP AI', row.section || null, row.diffs_json || null, null, now, row.import_key).run();
    resp.entryId = ins.meta.last_row_id;
  } else {
    return json({ ok: false, error: 'unsupported proposal type' }, 400);
  }
  const acceptedEntryId = resp.entryId || (resp.changelog && resp.changelog.id) || null;
  await env.DB.prepare('UPDATE cloud_reviews SET status = ?, decided_at = ?, decided_by = ?, accepted_entry_id = ? WHERE id = ?')
    .bind('accepted', now, auth.label || 'Owner', acceptedEntryId, reviewId).run();
  resp.acceptedEntryId = acceptedEntryId;
  return json(resp);
}

async function handleReviewReject(request, env, projectId, reviewId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const row = await env.DB.prepare('SELECT * FROM cloud_reviews WHERE id = ? AND project_id = ?').bind(reviewId, projectId).first();
  if (!row) return json({ ok: false, error: 'proposal not found' }, 404);
  if (row.status !== 'pending') return json({ ok: false, error: 'proposal is not pending' }, 409);
  const now = new Date().toISOString();
  // A 'rejected' changelog entry (diffs carried for audit context, but the
  // revert route only handles edit/accepted/bulk/revert — so it is
  // intentionally not revertible; nothing changed, nothing to undo).
  await env.DB.prepare(
    'INSERT INTO cloud_changelog (project_id, entry_type, actor_type, actor_label, section, diffs_json, snapshot_key, created_at) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(projectId, 'rejected', 'owner', auth.label || 'Owner', row.section || null, row.diffs_json || null, null, now).run();
  await env.DB.prepare('UPDATE cloud_reviews SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?')
    .bind('rejected', now, auth.label || 'Owner', reviewId).run();
  return json({ ok: true, reviewId: reviewId, status: 'rejected', decidedAt: now });
}

// ---- CLOUD-CODES-AND-DELETE-DIRECTIVE (2026-08-16) -----------------------
// POST /api/cloud/codes/lookup  { code }
// The launcher's single door: resolves ANY code (owner / editor / view) to
// its cloud project WITHOUT returning state or the code itself. Lookup is
// by sha256 fingerprint (migration 0009) — safe because codes are
// high-entropy random strings, and the plaintext is still never stored
// beyond the existing PBKDF2 hashes. Distinct user-facing outcomes per
// the owner's directive: invalid_code (nothing matches), code_revoked (a
// shared code that was revoked), project_deleted (admin-deleted project).
async function handleCloudCodeLookup(request, env) {
  const read = await readCloudBody(request);
  if (read.tooLarge) return json({ ok: false, error: 'body too large' }, 413);
  if (read.bad || !read.body || typeof read.body !== 'object') return json({ ok: false, error: 'bad request' }, 400);
  const code = typeof read.body.code === 'string' ? read.body.code.trim() : '';
  if (!code || code.length > 64) { await Promise.all([cloudDummyHash(), cloudTimingSink()]); return json({ ok: false, error: 'invalid_code' }, 403); }
  const fp = await fingerprintOf(code);
  // Shared codes first (editor + view live in cloud_editor_codes).
  const shared = await env.DB.prepare(
    'SELECT e.project_id, e.role, e.label, e.scope, e.active, p.owner_label, p.deleted_at FROM cloud_editor_codes e JOIN cloud_projects p ON p.project_id = e.project_id WHERE e.code_fingerprint = ?'
  ).bind(fp).first();
  if (shared) {
    if (shared.active !== 1) return json({ ok: false, error: 'code_revoked' }, 403);
    if (shared.deleted_at) return cloudProjectDeleted();
    let scope = [];
    try { const p = JSON.parse(shared.scope); if (Array.isArray(p)) scope = p.filter(function(x) { return !!CLOUD_SECTIONS[x]; }); } catch (e) { scope = []; }
    return json({ ok: true, projectId: shared.project_id, projectName: shared.owner_label || shared.label || 'Unnamed project', role: shared.role === 'view' ? 'view' : 'editor', label: shared.label || (shared.role === 'view' ? 'Viewer' : 'Editor'), scope: scope });
  }
  // Owner code next (cloud_projects row — fingerprint written at create/recover).
  const owner = await env.DB.prepare('SELECT project_id, owner_label, deleted_at FROM cloud_projects WHERE owner_code_fingerprint = ?').bind(fp).first();
  if (owner) {
    if (owner.deleted_at) return cloudProjectDeleted();
    return json({ ok: true, projectId: owner.project_id, projectName: owner.owner_label || 'Unnamed project', role: 'owner', label: 'Owner', scope: [] });
  }
  await cloudTimingSink();
  return json({ ok: false, error: 'invalid_code' }, 403);
}

// POST /api/cloud/projects/:id/delete — owner-only SOFT delete (admin
// panel Delete). Tombstones the row (deleted_at) so every load/save/meta
// and the launcher lookup immediately answer 'project_deleted', while
// POST .../restore can bring it all back within the undo window. Hard
// purge of tombstoned rows happens in the scheduled() cleanup
// (CLOUD_DELETED_PURGE_MS).
async function handleCloudProjectDelete(request, env, projectId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const now = new Date().toISOString();
  const res = await env.DB.prepare('UPDATE cloud_projects SET deleted_at = ?, updated_at = ? WHERE project_id = ? AND deleted_at IS NULL').bind(now, now, projectId).run();
  if (!res.meta.changes) return json({ ok: false, error: 'project not found' }, 404);
  return json({ ok: true, deleted: projectId, deletedAt: now });
}

// POST /api/cloud/projects/:id/restore — owner-only undo of the soft
// delete above (admin Undo within the toast window). Clears the tombstone;
// the project is live again for every code holder. FULL restore (local +
// cloud + codes) per the owner's planning decision.
async function handleCloudProjectRestore(request, env, projectId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) {
    // STABILIZATION (2026-08-16): the admin Cloud Projects list's "Deleted"
    // Undo needs a restore path after the 5s toast window expires — the site
    // operator (ADMIN_CODE) may restore a tombstoned project too.
    const admin = await cloudAdminAuth(request, env);
    if (!admin || admin.disabled) return cloudForbidden();
  }
  const now = new Date().toISOString();
  const res = await env.DB.prepare('UPDATE cloud_projects SET deleted_at = NULL, updated_at = ? WHERE project_id = ? AND deleted_at IS NOT NULL').bind(now, projectId).run();
  if (!res.meta.changes) return json({ ok: false, error: 'project not found or not deleted' }, 404);
  return json({ ok: true, restored: projectId, restoredAt: now });
}

// POST /api/cloud/projects/:id/purge — owner OR site-admin HARD delete
// (STABILIZATION directive 2026-08-16, owner decision: soft delete + Undo,
// with a "Delete permanently" fortify button). Removes the project from the
// backend NOW — R2 blobs (every revision under projects/<id>/), editor/viewer
// codes, recipient adoptions, the changelog, and the D1 row itself. This is
// the manual version of the 7-day cron tombstone purge: a deliberate,
// destructive operator action with no tombstone and no undo — "there will be
// no more cloud until another cloud upload" (owner's words).
async function handleCloudProjectPurge(request, env, projectId) {
  const owner = await cloudAuthOwnerEither(request, env, projectId);
  if (!owner) {
    const admin = await cloudAdminAuth(request, env);
    if (!admin || admin.disabled) return cloudForbidden();
  }
  const row = await env.DB.prepare('SELECT project_id FROM cloud_projects WHERE project_id = ?').bind(projectId).first();
  if (!row) return json({ ok: false, error: 'project not found' }, 404);
  let cursor = undefined;
  do {
    const listed = await env.R2.list({ prefix: 'projects/' + projectId + '/', cursor: cursor });
    for (let j = 0; j < (listed.objects || []).length; j++) {
      try { await env.R2.delete(listed.objects[j].key); } catch (e) { /* best-effort per object */ }
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  await env.DB.prepare('DELETE FROM cloud_editor_codes WHERE project_id = ?').bind(projectId).run();
  await env.DB.prepare('DELETE FROM cloud_adoptions WHERE project_id = ?').bind(projectId).run();
  await env.DB.prepare('DELETE FROM cloud_changelog WHERE project_id = ?').bind(projectId).run();
  // CLOUD-FIRST SYNC: purge drops registered offline copies too.
  await env.DB.prepare('DELETE FROM offline_copies WHERE project_id = ?').bind(projectId).run();
  // REVIEW QUEUE: purge drops every proposal as well.
  await env.DB.prepare('DELETE FROM cloud_reviews WHERE project_id = ?').bind(projectId).run();
  await env.DB.prepare('DELETE FROM cloud_projects WHERE project_id = ?').bind(projectId).run();
  return json({ ok: true, purged: projectId, purgedAt: new Date().toISOString() });
}

/* ============================================================
   ADDITIONAL SIGN-IN PROVIDER (deferred cloud item #14,
   EXECUTED 2026-08-12) — email + password
   ------------------------------------------------------------
   Self-contained provider (Yahoo/Microsoft need their own OAuth
   client IDs/secrets — user credentials, not buildable without
   them). Register/login validate against D1 auth_users and issue
   the SAME mmgr_session cookie as Google, with
   sub = 'email:<address>' — a namespace that can never collide
   with Google's numeric subs, so every downstream system
   (cloud_projects.google_sub, prefs R2 keys, presence roster,
   billing owner_sub) treats the account identically.
   Passwords: PBKDF2-SHA256, 100k iterations, per-account random
   salt stored 'salt:hex' next to the hash — the exact KDF the
   owner-code path uses. Never stored or logged in plaintext.
   ============================================================ */
const AUTH_MIN_PASSWORD = 8;

// AUTH MAINFRAME v2 (2026-08-17) — email verification + forgot/reset via
// Resend (RESEND_API_KEY / RESEND_FROM_EMAIL Wrangler secrets). DORMANT
// until configured: with no RESEND_API_KEY the app sends no email and the
// verified-email cloud gate is off — behavior is byte-for-byte unchanged.
const AUTH_VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // verify link: 24 hours
const AUTH_RESET_TTL_MS = 30 * 60 * 1000;        // reset link: 30 minutes
const AUTH_RESET_MAX_PER_EMAIL_H = 5;            // forgot: 5/hour/email
const AUTH_FROM_FALLBACK = 'onboarding@resend.dev';
const AUTH_RESEND_BASE = 'https://api.resend.com';

function authNormalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

function authEmailValid(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

// hashOwnerCode IS the PBKDF2-SHA256 (iterations, salt) helper — reuse it
// verbatim so the password path and the owner-code path share one KDF.
async function authHashPassword(password, saltHex) {
  return hashOwnerCode(password, saltHex);
}

// ---- Resend transactional email (AUTH MAINFRAME v2, 2026-08-17) ----------
// Plain REST from the Worker (no SDK), dormant until configured: with no
// RESEND_API_KEY the app sends nothing and every caller behaves exactly as
// before. RESEND_API_BASE is a TEST-ONLY seam (qa-email-auth points it at a
// local stub) — never set it in production.
function authEmailConfigured(env) {
  return !!(env && env.RESEND_API_KEY);
}
function authEmailFrom(env) {
  const f = env && typeof env.RESEND_FROM_EMAIL === 'string' ? env.RESEND_FROM_EMAIL.trim() : '';
  return f || AUTH_FROM_FALLBACK;
}
// Send a plain-text transactional email. Returns true when Resend accepted
// it; never throws — a mail failure must not break a signup/login/webhook.
async function sendAuthEmail(env, to, subject, textBody) {
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

// ---- One-time signed tokens (verify + reset) ------------------------------
// Mint: random jti, HMAC-signed payload (t = purpose, e = email, j = jti,
// iat/exp), ledger row in auth_tokens. A failed D1 write must never block
// the flow — the token is still signed and expiry-bounded; server-side
// revocation then lapses to expiry-only (same accepted trade-off as
// mintSession).
async function mintAuthToken(env, email, purpose, ttlMs) {
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

// Shared verification-email body — used by register (initial link) and
// /api/auth/resend-verify (expired/used-link recovery) so the two paths can
// never drift apart.
function authVerifyEmailBody(name, origin, token) {
  return (name ? 'Hello ' + name + ',\n\n' : 'Hello,\n\n') +
    'Confirm your email to activate your My MaNaGeR account and enable cloud projects:\n\n' +
    origin + '/verify.html?token=' + encodeURIComponent(token) + '\n\n' +
    'This link expires in 24 hours. If you did not create this account, you can ignore this email.';
}

// Consume a one-time token for a purpose. Returns the bound email on
// success, null on any failure (bad signature, wrong purpose, expired,
// unknown row, or already consumed). Single-use is a conditional UPDATE —
// two racing replays cannot both consume the same row.
async function consumeAuthToken(env, rawToken, purpose) {
  if (!rawToken || typeof rawToken !== 'string') return null;
  const dot = rawToken.indexOf('.');
  if (dot <= 0 || dot >= rawToken.length - 1) return null;
  let payloadStr, sigBytes;
  try {
    payloadStr = base64UrlDecode(rawToken.slice(0, dot));
    sigBytes = base64UrlToBytes(rawToken.slice(dot + 1));
  } catch (e) { return null; }
  let payload;
  try { payload = JSON.parse(payloadStr); } catch (e) { return null; }
  if (!payload || typeof payload !== 'object' || payload.t !== purpose || typeof payload.e !== 'string' || !payload.j) return null;
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
  try {
    const nowIso = new Date().toISOString();
    const upd = await env.DB.prepare('UPDATE auth_tokens SET used_at = ? WHERE id = ? AND purpose = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?')
      .bind(nowIso, payload.j, purpose, nowIso).run();
    if (!upd || !upd.meta || !upd.meta.changes || upd.meta.changes < 1) return null;
    return payload.e;
  } catch (e) { return null; }
}

// Sign a session for an email account and return the Set-Cookie response,
// mirroring the /api/auth/google response shape exactly.
async function authSessionResponse(user, env, emailSent) {
  const s = await mintSession({ sub: 'email:' + user.email, email: user.email, name: user.name, picture: '' }, env);
  return new Response(JSON.stringify({ ok: true, user: { sub: 'email:' + user.email, email: user.email, name: user.name }, emailSent: !!emailSent }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Set-Cookie': sessionSetCookie(s.token)
    }
  });
}

// POST /api/auth/register { email, password, name? }
async function handleAuthRegister(request, env) {
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
    // CREATE-RACE GUARD (same pattern as handleCloudCreate): a concurrent
    // duplicate register throws on the PK — re-check and answer 409, not 404.
    await env.DB.prepare('INSERT INTO auth_users (email, password_hash, name, created_at) VALUES (?,?,?,?)')
      .bind(email, salt + ':' + hash, name, now).run();
  } catch (e) {
    const raced = await env.DB.prepare('SELECT email FROM auth_users WHERE email = ?').bind(email).first();
    if (raced) return json({ ok: false, error: 'account already exists — sign in instead' }, 409);
    throw e;
  }
  // AUTH MAINFRAME v2: mint a one-time verify token (24h) and email it. With
  // RESEND_API_KEY unset this is a no-op (emailSent: false) — register then
  // behaves exactly as before, and the cloud-create verified gate is off.
  let emailSent = false;
  if (authEmailConfigured(env)) {
    try {
      const origin = new URL(request.url).origin;
      const vtoken = await mintAuthToken(env, email, 'verify', AUTH_VERIFY_TTL_MS);
      emailSent = await sendAuthEmail(env, email, 'Confirm your My MaNaGeR account', authVerifyEmailBody(name, origin, vtoken));
    } catch (e) { /* a mail failure must never break signup */ }
  }
  return authSessionResponse({ email: email, name: name }, env, emailSent);
}

// POST /api/auth/login { email, password }
async function handleAuthLogin(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'bad request' }, 400); }
  const email = authNormalizeEmail(body && body.email);
  const password = String((body && body.password) || '');
  // AUTH-MAINFRAME per-account lockout (owner: "we cannot have someone
  // spamming down our thing"). Checked for EXISTING accounts only — the
  // unknown-email path keeps the generic 401 + dummy-PBKDF2 timing (no
  // existence leak). A locked account gets an explicit 429 with Retry-After
  // and the owner's exact guidance ("try again later or contact support").
  const guard = await env.DB.prepare('SELECT failed_attempts, locked_until FROM auth_login_guard WHERE email = ?').bind(email).first();
  if (guard && guard.locked_until && new Date(guard.locked_until).getTime() > Date.now()) {
    const retryAfter = Math.max(1, Math.ceil((new Date(guard.locked_until).getTime() - Date.now()) / 1000));
    return new Response(JSON.stringify({ ok: false, error: 'Too many failed attempts — try again later or contact support.' }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Retry-After': String(retryAfter)
      }
    });
  }
  const row = await env.DB.prepare('SELECT email, password_hash, name FROM auth_users WHERE email = ?').bind(email).first();
  if (!row) {
    // TIMING-SIDE-CHANNEL GUARD: an unknown email returns after a real PBKDF2
    // (the same work a known-email wrong-password probe costs) so a wall-clock
    // difference cannot reveal which emails have accounts.
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
    } catch (e) { /* a guard write must never break login */ }
    return json({ ok: false, error: 'invalid email or password' }, 401);
  }
  try {
    await env.DB.prepare('DELETE FROM auth_login_guard WHERE email = ?').bind(email).run();
  } catch (e) { /* best-effort */ }
  return authSessionResponse({ email: row.email, name: row.name }, env);
}

// POST /api/auth/password { currentPassword, newPassword } — session-gated
// password change. Email accounts only (Google-linked sessions have no
// password). Verifies the CURRENT password, swaps the PBKDF2 hash, and
// revokes every OTHER session for the account (the present one survives) —
// a password change is a theft signal, so old sessions should not outlive it.
async function handleAuthPasswordChange(request, env) {
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
  // Revoke every OTHER session (the present one survives).
  try {
    await env.DB.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE sub = ? AND revoked_at IS NULL AND jti != ?')
      .bind(new Date().toISOString(), session.sub, session.jti || '').run();
  } catch (e) { /* best-effort */ }
  return json({ ok: true });
}

// POST /api/auth/verify-password { password } — session-gated password
// verification for destructive actions (owner 2026-08-17: "you have to put
// in your password for the Google account to verify the delete"). Email
// accounts only (Google-linked sessions have no password — their signed-in
// session IS the verification, the worker answers 400 for them exactly like
// the password-change flow). Same timing-safe PBKDF2 check as
// handleAuthPasswordChange; a wrong password answers 401 'password is
// incorrect' and a non-empty session is required. Used by the in-project
// Delete Project flow BEFORE the owner-only cloud delete is called.
async function handleAuthVerifyPassword(request, env) {
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

// POST /api/auth/verify { token } — consume the one-time verify token and
// mark the account's email verified. Replays answer 400 (single-use); a
// second click on the same link is therefore a clean 'already used' error,
// not a double-write.
async function handleAuthVerify(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'bad request' }, 400); }
  const email = await consumeAuthToken(env, String((body && body.token) || ''), 'verify');
  if (!email) return json({ ok: false, error: 'invalid or expired verification link' }, 400);
  try {
    await env.DB.prepare('UPDATE auth_users SET email_verified = 1 WHERE email = ?').bind(email).run();
  } catch (e) { /* best-effort */ }
  return json({ ok: true, email: email });
}

// POST /api/auth/forgot { email } — request a password reset. The response
// is IDENTICAL whether or not the email exists (dummy-PBKDF2 timing on the
// unknown path — no existence leak), and the per-email quota (5/hour) also
// answers the same generic message so the quota itself cannot be probed.
async function handleAuthForgot(request, env) {
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
          'We received a request to reset your My MaNaGeR password.\n\n' +
          'Reset it here (the link expires in 30 minutes):\n\n' +
          origin + '/reset.html?token=' + encodeURIComponent(rtoken) + '\n\n' +
          'If you did not request this, you can ignore this email.');
      }
    } catch (e) { /* a mail failure must never break the generic response */ }
  }
  return json(generic);
}

// POST /api/auth/reset { token, newPassword } — consume the one-time reset
// token, swap the PBKDF2 hash, revoke EVERY session for the account (a
// password reset is a takeover signal — old sessions must not outlive it),
// and clear any login lockout for the account.
async function handleAuthReset(request, env) {
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

// POST /api/auth/resend-verify { email } — request a FRESH verification link
// (the 24h single-use link died). Same generic-response + quota discipline as
// forgot: the response is IDENTICAL whether the account is unknown, unverified,
// or already verified (dummy-PBKDF2 timing on the unknown path — no existence
// leak), and the per-email quota (5/hour) answers the same generic message.
async function handleAuthResendVerify(request, env) {
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
  if (row.email_verified) return json(generic); // nothing to verify — same generic
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
    } catch (e) { /* a mail failure must never break the generic response */ }
  }
  return json(generic);
}

/* ============================================================
   BILLING TIER (deferred cloud item #15, EXECUTED 2026-08-12)
   ------------------------------------------------------------
   Provider: LemonSqueezy — merchant of record (LS collects and
   remits sales tax/VAT itself, so the app never computes or
   files tax; chosen over a raw processor for exactly that
   reason). The tier is DORMANT until configured: with none of
   LEMONSQUEEZY_WEBHOOK_SECRET / LEMONSQUEEZY_API_KEY /
   LEMONSQUEEZY_VARIANT_ID / LEMONSQUEEZY_STORE_ID set, the
   status endpoint reports "not configured", checkout returns 503,
   and the cloud-create gate is OFF — behavior is byte-for-byte
   unchanged (offline-first untouched). When configured:
     - POST /api/billing/webhook   signature-verified lifecycle
       events upsert cloud_subscriptions (the ONLY writer).
     - GET  /api/billing/status    session-gated plan/entitlement.
     - POST /api/billing/checkout  session-gated LS checkout URL
       with custom_data.sub so the webhook can attribute it.
     - Cloud create gate: a session-linked free account is capped
       at FREE_PROJECT_CAP linked projects (default 8, owner
       decision 2026-08-14); over the cap requires an active
       subscription (HTTP 402 + upgrade flag). Unlinked
       (code-only) creates are never capped.
   ============================================================ */
const LS_API_BASE = 'https://api.lemonsqueezy.com/v1';

// All four are required: the Checkouts API relationships block pins the
// checkout to a specific store + variant, so a missing store ID must keep
// the tier dormant rather than send a malformed request.
function billingConfigured(env) {
  return !!(env && env.LEMONSQUEEZY_WEBHOOK_SECRET && env.LEMONSQUEEZY_API_KEY && env.LEMONSQUEEZY_VARIANT_ID && env.LEMONSQUEEZY_STORE_ID);
}

function billingFreeCap(env) {
  const v = Number(env && env.FREE_PROJECT_CAP);
  // Default 8 free linked projects (owner decision 2026-08-14). Env
  // override FREE_PROJECT_CAP still wins when set.
  return Number.isFinite(v) && v > 0 ? v : 8;
}

function billingStatusActive(status) {
  return status === 'active' || status === 'on_trial';
}

// LS signs the RAW body: X-Signature = lowercase hex HMAC-SHA256(body,
// webhook_secret). Constant-time compare (codesEqual) against the header.
async function billingVerifySignature(env, rawBody, sigHeader) {
  if (!env || !env.LEMONSQUEEZY_WEBHOOK_SECRET) return false;
  try {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.LEMONSQUEEZY_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
    let hex = '';
    const arr = new Uint8Array(sigBytes);
    for (let i = 0; i < arr.length; i++) hex += arr[i].toString(16).padStart(2, '0');
    return codesEqual(hex, String(sigHeader || '').toLowerCase());
  } catch (e) { return false; }
}

// POST /api/billing/webhook — the ONLY writer of cloud_subscriptions.
// Authenticated by HMAC signature, NOT a session cookie (LS servers don't
// hold one). Lifecycle events upsert the row keyed on custom_data.sub.
async function handleBillingWebhook(request, env) {
  if (!env || !env.LEMONSQUEEZY_WEBHOOK_SECRET) return json({ ok: false, error: 'webhook not configured' }, 503);
  const rawBody = await request.text();
  const sig = request.headers.get('X-Signature') || '';
  if (!(await billingVerifySignature(env, rawBody, sig))) return json({ ok: false, error: 'invalid signature' }, 401);
  let payload;
  try { payload = JSON.parse(rawBody); } catch (e) { return json({ ok: false, error: 'bad payload' }, 400); }
  const meta = (payload && payload.meta) || {};
  const event = String(meta.event_name || '');
  const custom = (meta.custom_data && typeof meta.custom_data === 'object') ? meta.custom_data : {};
  const ownerSub = String(custom.sub || '');
  const lsId = String((payload && payload.data && payload.data.id) || '');
  const attrs = (payload && payload.data && payload.data.attributes) || {};
  const lifecycle = ['subscription_created', 'subscription_updated', 'subscription_cancelled', 'subscription_expired', 'subscription_paused', 'subscription_resumed'];
  if (lifecycle.indexOf(event) === -1) return json({ ok: true, ignored: event }); // test_request & friends: 200, no row
  if (!ownerSub || !lsId) return json({ ok: false, error: 'missing owner identity in custom_data' }, 400);
  const status = String(attrs.status || '');
  const periodEndRaw = attrs.renews_at || attrs.ends_at;
  const periodEnd = periodEndRaw ? Math.floor(new Date(periodEndRaw).getTime() / 1000) : null;
  const now = new Date().toISOString();
  await env.DB.prepare(
    'INSERT INTO cloud_subscriptions (owner_sub, ls_subscription_id, status, plan, current_period_end, created_at, updated_at) VALUES (?,?,?,?,?,?,?) ' +
    'ON CONFLICT(owner_sub) DO UPDATE SET ls_subscription_id = excluded.ls_subscription_id, status = excluded.status, ' +
    'current_period_end = excluded.current_period_end, updated_at = excluded.updated_at'
  ).bind(ownerSub, lsId, status, 'pro', periodEnd, now, now).run();
  // PART 4 (subscription emails, 2026-08-17): purchase confirmation on
  // subscription_created, cancellation notice on subscription_cancelled —
  // via Resend. DORMANT until RESEND_API_KEY is set; never blocks or
  // changes the webhook result. Recipient: the LS customer email
  // (attrs.user_email) or the account's own email for email accounts.
  if (authEmailConfigured(env) && (event === 'subscription_created' || event === 'subscription_cancelled')) {
    const recipient = String(attrs.user_email || '').trim() || (ownerSub.indexOf('email:') === 0 ? ownerSub.slice('email:'.length) : '');
    if (recipient) {
      const confirmed = event === 'subscription_created';
      await sendAuthEmail(env, recipient,
        confirmed ? 'Your My MaNaGeR subscription is confirmed' : 'Your My MaNaGeR subscription was cancelled',
        confirmed
          ? 'Your My MaNaGeR subscription is confirmed and your plan is locked in. Thank you for supporting the project.\n\nIf you have any questions, reply to this email.'
          : 'Your My MaNaGeR subscription has been cancelled. You can resubscribe at any time from your account.');
    }
  }
  return json({ ok: true, event: event, status: status });
}

// GET /api/billing/status — session-gated plan + entitlement.
async function handleBillingStatus(request, env) {
  const session = await readSession(request, env);
  if (!session || !session.sub) return cloudForbidden();
  const configured = billingConfigured(env);
  const cap = billingFreeCap(env);
  const cnt = await env.DB.prepare('SELECT COUNT(*) AS c FROM cloud_projects WHERE google_sub = ?').bind(session.sub).first();
  const projectCount = (cnt && cnt.c) || 0;
  if (!configured) return json({ ok: true, configured: false, plan: 'free', active: false, projectCap: null, projectCount: projectCount });
  const sub = await env.DB.prepare('SELECT status, plan, current_period_end FROM cloud_subscriptions WHERE owner_sub = ?').bind(session.sub).first();
  const active = !!(sub && billingStatusActive(sub.status));
  return json({
    ok: true, configured: true, plan: active ? (sub.plan || 'pro') : 'free', active: active,
    currentPeriodEnd: (sub && sub.current_period_end) || null, projectCap: cap, projectCount: projectCount
  });
}

// POST /api/billing/checkout — session-gated LS checkout with custom_data.sub
// so the webhook can attribute the resulting subscription to this account.
// The Checkouts API (POST /v1/checkouts) requires the JSON:API relationships
// block — store + variant (string ids per the JSON:API spec, per LS's own
// docs example) — alongside the attributes; without it LS rejects the
// checkout. enabled_variants keeps only the paid variant selectable.
async function handleBillingCheckout(request, env) {
  const session = await readSession(request, env);
  if (!session || !session.sub) return cloudForbidden();
  if (!billingConfigured(env)) return json({ ok: false, error: 'billing not configured' }, 503);
  try {
    const variantId = Number(env.LEMONSQUEEZY_VARIANT_ID);
    const res = await fetch(LS_API_BASE + '/checkouts', {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
        'Authorization': 'Bearer ' + env.LEMONSQUEEZY_API_KEY
      },
      body: JSON.stringify({
        data: {
          type: 'checkouts',
          attributes: {
            checkout_data: { email: session.email || '', custom: { sub: session.sub } },
            product_options: { enabled_variants: [variantId] }
          },
          relationships: {
            store: { data: { type: 'stores', id: String(env.LEMONSQUEEZY_STORE_ID) } },
            variant: { data: { type: 'variants', id: String(env.LEMONSQUEEZY_VARIANT_ID) } }
          }
        }
      })
    });
    const data = await res.json().catch(function() { return {}; });
    const url = data && data.data && data.data.attributes && data.data.attributes.url;
    if (!res.ok || !url) {
      // Surface LemonSqueezy's own JSON:API error detail (this route is session-
      // gated to the owner only, so the upstream text is safe to show) — a bare
      // 'HTTP 4xx' hides whether the real cause is a bad API key, a payment-link
      // variant that can't create API checkouts, or a store/variant ID mismatch.
      let detail = '';
      try {
        const err = (data && data.errors && data.errors[0]) || {};
        detail = String(err.detail || err.title || '').slice(0, 300);
      } catch (e) { /* keep detail empty */ }
      return json({ ok: false, error: 'checkout creation failed (LemonSqueezy HTTP ' + res.status + ')' + (detail ? ' — ' + detail : '') }, 502);
    }
    return json({ ok: true, checkoutUrl: url });
  } catch (e) {
    return json({ ok: false, error: 'checkout creation failed (upstream unreachable)' }, 502);
  }
}

// ===========================================================================
// MASTER-ACTION-PLAN RANK 9 (2026-08-12) — API / webhook layer
// ---------------------------------------------------------------------------
// 9.1 — stable JSON resource shapes (READ-ONLY): GET
//   /api/cloud/projects/:id/api/:shape  (tasks|baseline|risks|weather|evm|
//   portfolio). Owner-gated (code or linked session) like every cloud read.
//   Every shape is a projection of the SAVED R2 state (secrets already
//   stripped at save time) — no new computation lives in the client, and the
//   shapes are deliberately flat/stable so an integration (Zapier/Make,
//   owner portal, accounting export) never depends on the app's internal
//   schema. Only enumerated fields are read — AI keys and passwords can
//   never appear because they're stripped before R2 storage (stripStateSecrets
//   on save) AND these builders only touch the whitelisted arrays below.
//
// 9.2 — webhook triggers (OPT-IN, off by default): owner-gated CRUD on
//   /api/cloud/projects/:id/webhooks (+ /:id) backed by migration 0008, and
//   the scheduled() evaluator fires matching subscriptions with an
//   HMAC-SHA256 signature header (X-MMGR-Signature). With no subscription
//   rows (the default) the evaluator does nothing — dormant-until-configured,
//   byte-for-byte unchanged behavior.
// ===========================================================================

// ---- 9.1 pure shape builders (worker-side ports of the app's math) --------
// These are dependency-free ports of mmgr-evm.js computeEVM / mmgr-health.js
// computeHealthScore / mmgr-portfolio.js wxRiskDays — kept faithful so the
// API shape and the in-app number never disagree. Date handling mirrors
// mmgr-utils.js (DL strings are YYYY-MM-DD; compare via day buckets).
function apiDaysBetween(a, b) {
  const A = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const B = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.round((B - A) / 86400000);
}
function apiIsOverdue(endDate) {
  if (!endDate) return false;
  const d = new Date(String(endDate).replace(/-/g, '/') + ' 00:00:00');
  if (isNaN(d)) return false;
  return d < new Date();
}
function apiDayStart(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

// tasks — counts + the raw list (id/name/status/dates/critical only).
function apiTasks(state) {
  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  const now = new Date();
  const in7 = new Date(now.getTime() + 7 * 86400000);
  const done = tasks.filter(t => t.status === 'completed').length;
  const overdue = tasks.filter(t => t.status !== 'completed' && apiIsOverdue(t.endDate));
  const dueSoon = tasks.filter(t => t.status !== 'completed' && t.endDate && !apiIsOverdue(t.endDate) && new Date(String(t.endDate).replace(/-/g, '/')) <= in7);
  const blocked = tasks.filter(t => t.status === 'blocked').length;
  return {
    shape: 'tasks', count: tasks.length, completed: done, inProgress: tasks.filter(t => t.status === 'inprogress').length,
    blocked: blocked, overdueCount: overdue.length, dueSoonCount: dueSoon.length,
    overdue: overdue.map(t => ({ id: t.id, name: t.name || t.id, endDate: t.endDate || null })),
    dueSoon: dueSoon.map(t => ({ id: t.id, name: t.name || t.id, endDate: t.endDate || null })),
    tasks: tasks.map(t => ({ id: t.id, name: t.name || t.id, status: t.status || 'todo', startDate: t.startDate || null, endDate: t.endDate || null, critical: !!t.critical }))
  };
}

// baseline — saved baseline vs current completion.
function apiBaseline(state) {
  const base = state.baseline || null;
  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  const baseTasks = (base && Array.isArray(base.tasks)) ? base.tasks : [];
  const curDone = tasks.filter(t => t.status === 'completed').length;
  const baseDone = baseTasks.filter(t => t.status === 'completed').length;
  return {
    shape: 'baseline', saved: !!base, capturedAt: (base && base.capturedAt) || null,
    currentTotal: tasks.length, currentCompleted: curDone, currentPct: tasks.length ? Math.round(curDone / tasks.length * 100) : 0,
    baselineTotal: baseTasks.length, baselineCompleted: baseDone, baselinePct: baseTasks.length ? Math.round(baseDone / baseTasks.length * 100) : null
  };
}

// risks — open vs resolved + high/critical flags. issueId means the risk was
// promoted to an issue (no longer a pure risk).
function apiRisks(state) {
  const risks = Array.isArray(state.risks) ? state.risks : [];
  const issues = Array.isArray(state.issues) ? state.issues : [];
  const open = risks.filter(r => !r.issueId);
  const high = open.filter(r => /high/i.test(r.probability || '') || /high/i.test(r.impact || ''));
  return {
    shape: 'risks', count: risks.length, openCount: open.length,
    highCount: high.length, issuesCount: issues.length,
    risks: risks.map(r => ({ id: r.id, description: r.description || '(untitled)', probability: r.probability || null, impact: r.impact || null, status: r.status || 'open', promoted: !!r.issueId })),
    issues: issues.map(i => ({ id: i.id, description: i.description || '(untitled)', status: i.status || 'open', owner: i.owner || null }))
  };
}

// weather — cached forecast risk days (same thresholds as wxRiskDays:
// precip>=60 || tMax>=32 || tMin<=0, next 7 days) + the delay log.
function apiWeather(state) {
  const cache = state.wxCache || null;
  const days = (cache && Array.isArray(cache.days)) ? cache.days : [];
  const today = apiDayStart(new Date());
  const in7 = new Date(today.getTime() + 7 * 86400000);
  const riskDays = days.filter(d => {
    const dateObj = new Date(String(d.date).replace(/-/g, '/') + ' 00:00:00');
    if (isNaN(dateObj) || dateObj < today || dateObj > in7) return false;
    return (+d.precip || 0) >= 60 || (+d.tMax || 0) >= 32 || (+d.tMin || 0) <= 0;
  }).map(d => ({ date: d.date, precip: +d.precip || 0, tMax: +d.tMax || 0, tMin: +d.tMin || 0 }));
  const log = Array.isArray(state.weatherLog) ? state.weatherLog : [];
  return {
    shape: 'weather', cachedAt: (cache && cache.at) ? new Date(cache.at).toISOString() : null,
    riskDayCount: riskDays.length, riskDays: riskDays,
    logCount: log.length,
    log: log.map(w => ({ date: w.date || null, condition: w.condition || null, delayDays: +w.delayDays || 0, cause: w.cause || null })).slice(-30)
  };
}

// evm — faithful port of computeEVM (Spend math: spendLog-driven actuals,
// time-phased planned value via linked-task windows + curve shapes). Returns
// nulls where the app would (no tasks / no planned budget = no fabricated
// numbers).
function apiEVM(state) {
  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  const tot = tasks.length;
  if (!tot) return { shape: 'evm', available: false };
  const dn = tasks.filter(t => t.status === 'completed').length;
  const pct = dn / tot;
  const lines = Array.isArray(state.budgetLines) ? state.budgetLines : [];
  const spendLog = Array.isArray(state.spendLog) ? state.spendLog : [];
  const lineActual = function(line) {
    const log = spendLog.filter(e => e.budgetLineId === line.id);
    if (log.length) return log.reduce((s, e) => s + (+e.amount || 0), 0);
    return +line.actual || 0;
  };
  const tp = lines.reduce((sum, l) => sum + (+l.planned || 0), 0);
  const ta = lines.reduce((sum, l) => sum + lineActual(l), 0);
  if (!tp) return { shape: 'evm', available: false };
  // budget line window: linked task dates, else project span.
  const windowOf = function(line) {
    const linkId = line.linkedTaskId || line.taskId || null;
    if (linkId) {
      const t = tasks.find(x => String(x.id) === String(linkId));
      if (t && t.startDate && t.endDate) return { start: new Date(String(t.startDate).replace(/-/g, '/')), end: new Date(String(t.endDate).replace(/-/g, '/')) };
    }
    const dated = tasks.filter(t => t.startDate && t.endDate);
    if (!dated.length) return null;
    const starts = dated.map(t => new Date(String(t.startDate).replace(/-/g, '/')).getTime());
    const ends = dated.map(t => new Date(String(t.endDate).replace(/-/g, '/')).getTime());
    return { start: new Date(Math.min.apply(null, starts)), end: new Date(Math.max.apply(null, ends)) };
  };
  const curveFraction = function(t, shape) {
    t = Math.max(0, Math.min(1, t));
    const s = shape === 'bell' ? 'scurve' : shape === 'front-loaded' ? 'front' : shape === 'back-loaded' ? 'back' : shape;
    if (s === 'scurve') return t * t * (3 - 2 * t);
    if (s === 'front') return 1 - Math.pow(1 - t, 2);
    if (s === 'back') return t * t;
    return t;
  };
  const today = apiDayStart(new Date());
  const pv = lines.reduce((sum, l) => {
    const planned = +l.planned || 0;
    const w = windowOf(l);
    if (!w) return sum + planned * pct;
    const span = w.end - w.start;
    if (today <= w.start) return sum;
    if (today >= w.end || span <= 0) return sum + planned;
    return sum + planned * curveFraction((today - w.start) / span, l.curveShape || l.curve || 'linear');
  }, 0);
  const ev = lines.reduce((sum, l) => {
    const planned = +l.planned || 0;
    const linkId = l.linkedTaskId || l.taskId || null;
    if (linkId) {
      const t = tasks.find(x => String(x.id) === String(linkId));
      if (t) return sum + planned * (t.status === 'completed' ? 1 : 0);
    }
    return sum + planned * pct;
  }, 0);
  const ac = ta;
  const spi = pv ? ev / pv : null;
  const cpi = ac ? ev / ac : null;
  const bac = tp;
  const eac = cpi ? ac + (bac - ev) / cpi : null;
  const etc = (eac !== null) ? eac - ac : null;
  const vac = (eac !== null) ? bac - eac : null;
  const tden = bac - ac;
  const tcpi = (tden !== 0) ? (bac - ev) / tden : null;
  return { shape: 'evm', available: true, pct: Math.round(pct * 100), planned: tp, actual: ta, pv: Math.round(pv), ev: Math.round(ev), ac: Math.round(ac), spi: spi !== null ? +spi.toFixed(3) : null, cpi: cpi !== null ? +cpi.toFixed(3) : null, sv: Math.round(ev - pv), cv: Math.round(ev - ac), bac: bac, eac: eac !== null ? Math.round(eac) : null, etc: etc !== null ? Math.round(etc) : null, vac: vac !== null ? Math.round(vac) : null, tcpi: tcpi !== null ? +tcpi.toFixed(3) : null };
}

// portfolio — health score (faithful 5-factor port) + derived summary.
function apiPortfolio(state) {
  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  const tot = tasks.length;
  if (!tot) return { shape: 'portfolio', available: false };
  const dn = tasks.filter(t => t.status === 'completed').length;
  const overdue = tasks.filter(t => apiIsOverdue(t.endDate) && t.status !== 'completed').length;
  const liveIssues = (Array.isArray(state.issues) ? state.issues : []).filter(i => i.status !== 'resolved' && i.status !== 'closed').length;
  const highRisks = (Array.isArray(state.risks) ? state.risks : []).filter(r => !r.issueId && /^high$/i.test(r.probability || '') && /^high$/i.test(r.impact || '')).length;
  const pendingChg = (Array.isArray(state.changes) ? state.changes : []).filter(c => c.status === 'submitted' || c.status === 'review' || !c.status).length;
  const lines = Array.isArray(state.budgetLines) ? state.budgetLines : [];
  const spendLog = Array.isArray(state.spendLog) ? state.spendLog : [];
  const lineActual = function(line) {
    const log = spendLog.filter(e => e.budgetLineId === line.id);
    if (log.length) return log.reduce((s, e) => s + (+e.amount || 0), 0);
    return +line.actual || 0;
  };
  const tp = lines.reduce((sum, b) => sum + (+b.planned || 0), 0);
  const ta = lines.reduce((sum, b) => sum + lineActual(b), 0);
  const pct = dn / tot;
  const cpi = (ta && tp) ? (tp * pct) / ta : null;
  const hasSchedule = tasks.some(t => t.startDate && t.endDate);
  const hasBudget = !!(ta && tp);
  const hasRisks = (Array.isArray(state.risks) ? state.risks : []).length > 0;
  const hasChanges = (Array.isArray(state.changes) ? state.changes : []).length > 0;
  const f1 = (dn / tot) * 100;
  const f2 = hasSchedule ? Math.max(0, 100 - (overdue / tot) * 100) : null;
  const f3 = hasBudget ? Math.max(0, 100 - Math.abs(cpi - 1) * 200) : null;
  const f4 = hasRisks ? Math.max(0, 100 - (liveIssues * 15) - (highRisks * 5)) : null;
  const f5 = hasChanges ? Math.max(0, 100 - (pendingChg * 10)) : null;
  const weights = { f1: 0.30, f2: 0.25, f3: 0.20, f4: 0.15, f5: 0.10 };
  let weightSum = 0, scoreSum = 0;
  [f1, f2, f3, f4, f5].forEach((v, i) => {
    if (v !== null) { weightSum += weights['f' + (i + 1)]; scoreSum += v * weights['f' + (i + 1)]; }
  });
  const score = weightSum ? Math.round(scoreSum / weightSum) : Math.round(f1);
  const atRisk = score < 60;
  return { shape: 'portfolio', available: true, healthScore: score, atRisk: atRisk, completion: Math.round(pct * 100), overdueCount: overdue, liveIssues: liveIssues, highRisks: highRisks, pendingChanges: pendingChg };
}

// ---- route: GET /api/cloud/projects/:id/api/:shape (owner-gated, read-only)
const API_SHAPES = { tasks: apiTasks, baseline: apiBaseline, risks: apiRisks, weather: apiWeather, evm: apiEVM, portfolio: apiPortfolio };
async function handleApiShape(request, env, projectId, shape) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const row = await env.DB.prepare('SELECT latest_r2_key FROM cloud_projects WHERE project_id = ?').bind(projectId).first();
  const state = row && row.latest_r2_key ? await cloudReadState(env, row.latest_r2_key) : null;
  if (!state) return json({ ok: true, shape: shape, exists: false, data: null });
  const builder = API_SHAPES[shape];
  return json({ ok: true, shape: shape, exists: true, generatedAt: new Date().toISOString(), data: builder(state) });
}

// ---- 9.2 webhook subscriptions (owner-gated CRUD) -------------------------
// Events: health_dropped | weather_risk_tomorrow. target_url must be http(s).
const WEBHOOK_EVENTS = ['health_dropped', 'weather_risk_tomorrow'];
async function webhookCryptoSecret() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function handleWebhookCreate(request, env, projectId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const read = await readCloudBody(request);
  if (read.tooLarge) return json({ ok: false, error: 'body too large' }, 413);
  if (read.bad || !read.body || typeof read.body !== 'object') return json({ ok: false, error: 'bad request' }, 400);
  const event = String(read.body.event || '').trim();
  const targetUrl = String(read.body.targetUrl || '').trim();
  if (WEBHOOK_EVENTS.indexOf(event) === -1) return json({ ok: false, error: 'unknown event — use health_dropped or weather_risk_tomorrow' }, 400);
  let u;
  try { u = new URL(targetUrl); } catch (e) { return json({ ok: false, error: 'targetUrl must be a valid URL' }, 400); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return json({ ok: false, error: 'targetUrl must be http(s)' }, 400);
  const secret = await webhookCryptoSecret();
  const now = new Date().toISOString();
  const res = await env.DB.prepare('INSERT INTO webhook_subscriptions (project_id, event, target_url, secret, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)').bind(projectId, event, targetUrl, secret, now).run();
  return json({ ok: true, id: res.meta.last_row_id, event: event, targetUrl: targetUrl, secret: secret, created: true });
}

async function handleWebhookList(request, env, projectId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const rows = await env.DB.prepare('SELECT id, project_id, event, target_url, enabled, last_fired_at, created_at FROM webhook_subscriptions WHERE project_id = ? ORDER BY id').bind(projectId).all();
  // The secret is NEVER returned after creation (shown once at create).
  return json({ ok: true, webhooks: (rows.results || []).map(r => ({ id: r.id, event: r.event, targetUrl: r.target_url, enabled: !!r.enabled, lastFiredAt: r.last_fired_at || null, createdAt: r.created_at })) });
}

async function handleWebhookDelete(request, env, projectId, subId) {
  const auth = await cloudAuthOwnerEither(request, env, projectId);
  if (!auth) return cloudForbidden();
  const res = await env.DB.prepare('DELETE FROM webhook_subscriptions WHERE id = ? AND project_id = ?').bind(Number(subId) || 0, projectId).run();
  if (!res.meta.changes) return json({ ok: false, error: 'webhook not found' }, 404);
  return json({ ok: true, deleted: true });
}

// ---- webhook delivery: HMAC-SHA256 signature + POST -----------------------
async function webhookDeliver(env, sub, payload) {
  const body = JSON.stringify(payload);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(sub.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const sig = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
  try {
    const res = await fetch(sub.target_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-MMGR-Signature': 'sha256=' + sig, 'User-Agent': 'My-MaNaGeR-Rank9/1.0' },
      body: body,
      signal: AbortSignal.timeout(10000)
    });
    return { delivered: true, status: res.status };
  } catch (e) {
    return { delivered: false, error: (e && e.message) || 'delivery failed' };
  }
}

// ---- scheduled evaluator (called from the cron; never touches user requests)
// Reads the state snapshot for every project with enabled subscriptions and
// fires the matching event. Failures are logged, never surfaced.
async function evaluateWebhooks(env) {
  const rows = await env.DB.prepare('SELECT * FROM webhook_subscriptions WHERE enabled = 1').all();
  const subs = rows.results || [];
  if (!subs.length) return { checked: 0, fired: [] };
  const fired = [];
  const todayKey = new Date().toISOString().slice(0, 10);
  const seen = {};
  for (let i = 0; i < subs.length; i++) {
    const sub = subs[i];
    try {
      const row = await env.DB.prepare('SELECT latest_r2_key FROM cloud_projects WHERE project_id = ?').bind(sub.project_id).first();
      const state = row && row.latest_r2_key ? await cloudReadState(env, row.latest_r2_key) : null;
      if (!state) continue;
      let fire = false; let payload = null;
      if (sub.event === 'health_dropped') {
        const p = apiPortfolio(state);
        if (p.available) {
          const prev = sub.last_value !== null && sub.last_value !== undefined ? +sub.last_value : null;
          // Store the current score on EVERY run so a drop is a real
          // comparison, not a first-run surprise.
          if (prev !== null && p.healthScore < prev) {
            fire = true;
            payload = { event: 'health_dropped', projectId: sub.project_id, at: new Date().toISOString(), previousScore: prev, currentScore: p.healthScore };
          }
          await env.DB.prepare('UPDATE webhook_subscriptions SET last_value = ? WHERE id = ?').bind(String(p.healthScore), sub.id).run();
        }
      } else if (sub.event === 'weather_risk_tomorrow') {
        // Tomorrow is a risk day per the cached forecast (same thresholds as
        // the app's wxRiskDays). Fire at most once per calendar day.
        if (sub.last_fired_at !== todayKey) {
          const cache = state.wxCache;
          const days = (cache && Array.isArray(cache.days)) ? cache.days : [];
          const tm = new Date(Date.now() + 86400000);
          const tmKey = tm.toISOString().slice(0, 10);
          const day = days.find(d => String(d.date).slice(0, 10) === tmKey);
          if (day && ((+day.precip || 0) >= 60 || (+day.tMax || 0) >= 32 || (+day.tMin || 0) <= 0)) {
            fire = true;
            payload = { event: 'weather_risk_tomorrow', projectId: sub.project_id, at: new Date().toISOString(), date: tmKey, precip: +day.precip || 0, tMax: +day.tMax || 0, tMin: +day.tMin || 0 };
          }
        }
        if (fire || sub.last_fired_at !== todayKey) {
          // Record the evaluation date regardless so the once-per-day guard holds.
          await env.DB.prepare('UPDATE webhook_subscriptions SET last_fired_at = ? WHERE id = ?').bind(todayKey, sub.id).run();
        }
      }
      if (fire && payload) {
        const outcome = await webhookDeliver(env, sub, payload);
        fired.push({ id: sub.id, event: sub.event, projectId: sub.project_id, outcome: outcome });
      }
      seen[sub.id] = true;
    } catch (e) {
      console.error('rank9 webhook eval failed for sub ' + sub.id + ':', e && e.message);
    }
  }
  return { checked: Object.keys(seen).length, fired: fired };
}

// ---- /api/auth/* routes --------------------------------------------------
async function handleApi(request, env, url) {
  const path = url.pathname;

  // WEBHOOK EXEMPTION (billing tier): LemonSqueezy posts server-to-server
  // with no browser Origin (sameOriginOnly would pass anyway), but if an
  // Origin ever rides along it must not 403 — the HMAC signature, not origin,
  // is the webhook's auth. Routed before the same-origin gate on purpose.
  if (path === '/api/billing/webhook' && request.method === 'POST') {
    return handleBillingWebhook(request, env);
  }

  // CORS POLICY (gap-audit item A2): enforce same-origin-only for the whole
  // API before any route logic runs. Cross-origin requests are rejected with
  // a plain 403 and no ACAO header is ever emitted on an API response.
  if (!sameOriginOnly(request)) {
    return json({ ok: false, error: 'cross-origin requests are not allowed' }, 403);
  }

  // CLOUD-BACKEND-ARCHITECTURE-PLAN Phase 1 — /api/cloud/* routes. These run
  // BEFORE the ASSETS binding, exactly like /api/auth/*, so they can never be
  // swallowed by the SPA fallback.
  if (path === '/api/cloud/projects') {
    const rl = await cloudRateCheck(request, 'general');
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    // POST = create (Phase 1); GET = session-gated owner project list (A5-3).
    if (request.method === 'POST') return handleCloudCreate(request, env);
    if (request.method === 'GET') return handleCloudProjectList(request, env);
  }
  const cloudMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/(save|load|recover|meta|delete|restore|purge)$/);
  if (cloudMatch) {
    const pid = cloudMatch[1];
    const op = cloudMatch[2];
    const rl = await cloudRateCheck(request, op === 'recover' ? 'recover' : 'general');
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    if (op === 'meta' && request.method === 'GET') return handleCloudMeta(request, env, pid);
    if (op === 'save' && request.method === 'POST') return handleCloudSave(request, env, pid);
    if (op === 'load' && request.method === 'POST') return handleCloudLoad(request, env, pid);
    if (op === 'recover' && request.method === 'POST') return handleCloudRecover(request, env, pid);
    if (op === 'delete' && request.method === 'POST') return handleCloudProjectDelete(request, env, pid);
    if (op === 'restore' && request.method === 'POST') return handleCloudProjectRestore(request, env, pid);
    // STABILIZATION (2026-08-16): 'purge' = the admin's "Delete permanently"
    // fortify action — hard-deletes the backend NOW (no tombstone, no undo).
    if (op === 'purge' && request.method === 'POST') return handleCloudProjectPurge(request, env, pid);
  }
  // CLOUD-CODES-AND-DELETE-DIRECTIVE: the launcher's single code door.
  if (path === '/api/cloud/codes/lookup' && request.method === 'POST') {
    const rl = await cloudRateCheck(request, 'general');
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleCloudCodeLookup(request, env);
  }
  // PART F T9: DELETE /api/cloud/projects/:id/adopt — recipient unpins a
  // project from their own My Cloud Projects list.
  const cloudUnadoptMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/adopt$/);
  if (cloudUnadoptMatch && request.method === 'DELETE') {
    const rl = await cloudRateCheck(request, 'general');
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleCloudUnadopt(request, env, cloudUnadoptMatch[1]);
  }
  // DELETE /api/cloud/projects/:id — owner-only unlink (gap-audit item B10).
  const cloudUnlinkMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})$/);
  if (cloudUnlinkMatch && request.method === 'DELETE') {
    const rl = await cloudRateCheck(request, 'general');
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleCloudUnlink(request, env, cloudUnlinkMatch[1]);
  }
  // MASTER-ACTION-PLAN RANK 9 (2026-08-12) — read-only resource shapes +
  // opt-in webhook subscriptions. Runs before the ASSETS binding like every
  // /api/cloud route; both are owner-gated.
  const apiShapeMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/api\/([a-z]+)$/);
  if (apiShapeMatch && request.method === 'GET') {
    const rl = await cloudRateCheck(request, 'general');
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    const shape = apiShapeMatch[2];
    if (!API_SHAPES[shape]) return json({ ok: false, error: 'unknown shape — use tasks, baseline, risks, weather, evm or portfolio' }, 404);
    return handleApiShape(request, env, apiShapeMatch[1], shape);
  }
  const webhookListMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/webhooks$/);
  if (webhookListMatch) {
    const rl = await cloudRateCheck(request, 'general');
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    if (request.method === 'POST') return handleWebhookCreate(request, env, webhookListMatch[1]);
    if (request.method === 'GET') return handleWebhookList(request, env, webhookListMatch[1]);
  }
  const webhookDelMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/webhooks\/(\d+)$/);
  if (webhookDelMatch && request.method === 'DELETE') {
    const rl = await cloudRateCheck(request, 'general');
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleWebhookDelete(request, env, webhookDelMatch[1], webhookDelMatch[2]);
  }

  // THEME-SYSTEM-AND-MOBILE-UI-ACTION-PLAN §2.3 — session-gated account
  // theme preference (GET returns the stored pref, PUT accepts { palette,
  // dark }); R2-backed, no D1 migration. Runs before the ASSETS binding
  // like every /api/cloud route.
  if (path === '/api/cloud/prefs/theme') {
    const rl = await cloudRateCheck(request, 'general');
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    if (request.method === 'GET') return handleCloudPrefsGet(request, env);
    if (request.method === 'PUT') return handleCloudPrefsPut(request, env);
  }
  // REAL-TIME PRESENCE (deferred cloud item, EXECUTED 2026-08-12): WebSocket
  // upgrade. Access is validated HERE with the same generic-403 discipline as
  // every cloud route, then the validated handshake is forwarded to the
  // per-project Presence Durable Object (wrangler.jsonc durable_objects
  // binding + migrations v1-presence).
  if (path === '/api/cloud/presence') {
    const rl = await cloudRateCheck(request, 'general');
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handlePresenceUpgrade(request, env, url);
  }
  // CLOUD-FIRST SYNC (PART 3, approved 2026-08-17): offline-copy
  // registration + the admin broadcast controls. POST = register this
  // device as a view-only offline copy (any valid credential); GET =
  // owner-only list (the broadcast UI needs the count + freshness).
  const offlineListMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/offline-copies$/);
  if (offlineListMatch) {
    const rl = await cloudRateCheck(request, 'general');
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    if (request.method === 'POST') return handleOfflineCopyRegister(request, env, offlineListMatch[1]);
    if (request.method === 'GET') return handleOfflineCopyList(request, env, offlineListMatch[1]);
  }
  // DELETE /api/cloud/projects/:id/offline-copies/:copyId — unregister
  // (owner, or the registering device itself).
  const offlineDelMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/offline-copies\/([A-Za-z0-9-]{1,64})$/);
  if (offlineDelMatch && request.method === 'DELETE') {
    const rl = await cloudRateCheck(request, 'general');
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleOfflineCopyDelete(request, env, offlineDelMatch[1], offlineDelMatch[2]);
  }
  // REVIEW QUEUE (2026-08-17): GET /reviews lists proposals — owner sees
  // every proposal (pending first), an editor credential (or mine=1 with
  // one) sees only their own (status visibility on the source side).
  const reviewListMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/reviews$/);
  if (reviewListMatch && request.method === 'GET') {
    const rl = await cloudRateCheck(request, 'general');
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleReviewList(request, env, reviewListMatch[1], url.searchParams.get('mine') === '1');
  }
  // POST /reviews/:id/accept + /reviews/:id/reject — owner-only decisions.
  const reviewAcceptMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/reviews\/(\d+)\/accept$/);
  if (reviewAcceptMatch && request.method === 'POST') {
    const rl = await cloudRateCheck(request, 'general');
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleReviewAccept(request, env, reviewAcceptMatch[1], Number(reviewAcceptMatch[2]));
  }
  const reviewRejectMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/reviews\/(\d+)\/reject$/);
  if (reviewRejectMatch && request.method === 'POST') {
    const rl = await cloudRateCheck(request, 'general');
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleReviewReject(request, env, reviewRejectMatch[1], Number(reviewRejectMatch[2]));
  }
  // POST /api/cloud/projects/:id/broadcast — owner-only manual broadcast:
  // push the current revision to every registered copy + record a
  // changelog 'broadcast' entry so the audit trail shows it.
  const broadcastMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/broadcast$/);
  if (broadcastMatch && request.method === 'POST') {
    const rl = await cloudRateCheck(request, 'general');
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleCloudBroadcast(request, env, broadcastMatch[1]);
  }
  // PUT /api/cloud/projects/:id/auto-broadcast — owner-only per-project
  // switch: when enabled, EVERY save also broadcasts (the auto form of the
  // manual button).
  const autoBcMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/auto-broadcast$/);
  if (autoBcMatch && request.method === 'PUT') {
    const rl = await cloudRateCheck(request, 'general');
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleCloudAutoBroadcast(request, env, autoBcMatch[1]);
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
  const cloudImportMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/changelog\/import$/);
  if (cloudImportMatch && request.method === 'POST') {
    const rl = await cloudRateCheck(request, 'general');
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleCloudChangelogImport(request, env, cloudImportMatch[1]);
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

  // PART F T7 (2026-08-16) — public reviews window (reviews.html).
  // GET = public list (newest first, no auth); POST = leave a review.
  // Both ride the same-origin gate at the top of handleApi. POST is
  // rate-limited with the dedicated `reviews` bucket (unauthenticated
  // write surface) and validates plain text only — no HTML, no links;
  // the page renders everything via textContent so nothing can execute.
  if (path === '/api/reviews') {
    if (request.method === 'GET') {
      const rl = await cloudRateCheck(request, 'general');
      if (rl.limited) return cloudRateLimited(rl.retryAfter);
      return handleReviewsList(env);
    }
    if (request.method === 'POST') {
      const rl = await cloudRateCheck(request, 'reviews');
      if (rl.limited) return cloudRateLimited(rl.retryAfter);
      return handleReviewsCreate(request, env);
    }
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
  if (path === '/api/auth/me' && request.method === 'GET') {
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

  // ADDITIONAL SIGN-IN PROVIDER (deferred cloud item #14, EXECUTED
  // 2026-08-12) — email + password. Register/login validate against D1
  // auth_users and issue the SAME mmgr_session cookie as Google, with
  // sub = 'email:<address>' — a namespace that can never collide with
  // Google's numeric subs, so every downstream system (cloud_projects.
  // google_sub, prefs R2 keys, presence roster, billing owner_sub) treats
  // the account identically. Routed here behind the same-origin gate like
  // every /api/auth/* route; the auth rate bucket covers the brute-force
  // surface (see CLOUD_RATE above).
  if (path === '/api/auth/register' && request.method === 'POST') {
    const rl = await cloudRateCheck(request, 'authRegister');
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleAuthRegister(request, env);
  }
  if (path === '/api/auth/login' && request.method === 'POST') {
    const rl = await cloudRateCheck(request, 'authLogin');
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleAuthLogin(request, env);
  }
  // POST /api/auth/password — session-gated password change (email accounts
  // only; revokes every OTHER session). Rides the login bucket: it is the
  // same credential surface (verifies the current password).
  if (path === '/api/auth/password' && request.method === 'POST') {
    const rl = await cloudRateCheck(request, 'authLogin');
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleAuthPasswordChange(request, env);
  }
  // POST /api/auth/verify-password — session-gated password verification
  // for destructive actions (in-project Delete Project, owner 2026-08-17).
  // Same credential surface + login bucket as the password change above.
  if (path === '/api/auth/verify-password' && request.method === 'POST') {
    const rl = await cloudRateCheck(request, 'authLogin');
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleAuthVerifyPassword(request, env);
  }
  // AUTH MAINFRAME v2 — email verification + forgot/reset. verify/reset
  // consume one-time signed tokens (single-use, HMAC-bound to the account);
  // forgot rides the unauthenticated surface like register/login (same-
  // origin gate above) and answers a generic message either way (no
  // existence leak).
  if (path === '/api/auth/verify' && request.method === 'POST') {
    const rl = await cloudRateCheck(request, 'authToken');
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleAuthVerify(request, env);
  }
  if (path === '/api/auth/forgot' && request.method === 'POST') {
    const rl = await cloudRateCheck(request, 'authForgot');
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleAuthForgot(request, env);
  }
  if (path === '/api/auth/reset' && request.method === 'POST') {
    const rl = await cloudRateCheck(request, 'authToken');
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleAuthReset(request, env);
  }
  // POST /api/auth/resend-verify — fresh verification link for a dead
  // 24h/single-use link (verify.html's recoverable error path). Rides the
  // authForgot bucket (same unauthenticated, quota-guarded surface).
  if (path === '/api/auth/resend-verify' && request.method === 'POST') {
    const rl = await cloudRateCheck(request, 'authForgot');
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleAuthResendVerify(request, env);
  }

  // BILLING TIER (deferred cloud item #15, EXECUTED 2026-08-12) —
  // session-gated plan/entitlement + LemonSqueezy checkout. DORMANT until
  // configured: with no LEMONSQUEEZY_* secrets the status endpoint reports
  // configured:false and checkout answers 503, so behavior is byte-for-byte
  // unchanged (offline-first untouched). The webhook (signature-verified,
  // the ONLY writer of cloud_subscriptions) is routed before the same-
  // origin gate at the top of handleApi.
  if (path === '/api/billing/status' && request.method === 'GET') {
    const rl = await cloudRateCheck(request, 'general');
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleBillingStatus(request, env);
  }
  if (path === '/api/billing/checkout' && request.method === 'POST') {
    const rl = await cloudRateCheck(request, 'general');
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleBillingCheckout(request, env);
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
    // AUTH-MAINFRAME: revoke THIS session server-side before clearing the
    // cookie, so a captured cookie is dead even if it is replayed later.
    const sess = await readSession(request, env);
    if (sess && sess.jti) {
      try {
        await env.DB.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE jti = ?')
          .bind(new Date().toISOString(), sess.jti).run();
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
  // (sign out everywhere). Same Sec-Fetch-Site logout-CSRF guard as logout.
  if (path === '/api/auth/logout-all' && request.method === 'POST') {
    const sfs = request.headers.get('Sec-Fetch-Site');
    if (sfs && sfs !== 'same-origin' && sfs !== 'none') {
      return json({ ok: false, error: 'forbidden' }, 403);
    }
    const sess = await readSession(request, env);
    if (sess && sess.sub) {
      try {
        await env.DB.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE sub = ? AND revoked_at IS NULL')
          .bind(new Date().toISOString(), sess.sub).run();
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

  return json({ ok: false, error: 'not found' }, 404);
}

/* ============================================================
   REAL-TIME PRESENCE (deferred cloud item, EXECUTED 2026-08-12)
   ------------------------------------------------------------
   OPT-IN, purely additive collaboration: a quiet "who else is viewing"
   chip on project.html. Architecture:
     - The browser opens a WebSocket to /api/cloud/presence?project=<id>
       (an owner/editor code may ride the query string; the linked Google
       session rides the cookie automatically).
     - handlePresenceUpgrade() validates access with the SAME generic-403 +
       timing-sink discipline as every cloud route — linked session, D1
       owner code, D1 editor code, or a published-manifest access code
       (sha256 of trim().toUpperCase(), mirroring app.html's unlock check) —
       then forwards the validated handshake to the Presence DO.
     - One DO per project (idFromName(projectId), WebSocket Collab pattern,
       Hibernation API). It tracks ONLY {id, name, since} per open socket —
       never project content — and broadcasts init/join/leave so every
       viewer sees the roster. Stale sockets are swept on activity.
   Offline-first is untouched: an unavailable/failed socket leaves the app
   byte-for-byte as before (the frontend chip simply stays hidden).
   ============================================================ */

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
}

// Verify an access code against the PUBLISHED manifest (projects-data.js) —
// the exact check app.html performs client-side (sha256 of trimmed-uppercased
// code vs codeHash / roCodeHash). Read through the ASSETS binding; any
// read/parse failure returns false (presence simply unavailable, nothing leaks).
async function cloudManifestCodeOk(env, projectId, code) {
  try {
    const res = await env.ASSETS.fetch('/projects-data.js');
    if (!res.ok) return false;
    const text = await res.text();
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start < 0 || end <= start) return false;
    const projects = JSON.parse(text.slice(start, end + 1));
    const p = (projects || []).find(function(x) { return x && x.id === projectId; });
    if (!p) return false;
    const hash = await sha256Hex(String(code || '').trim().toUpperCase());
    return hash === p.codeHash || hash === (p.roCodeHash || p.readOnlyCodeHash || '');
  } catch (e) { return false; }
}

// GET /api/cloud/presence?project=<id>[&code=<owner|editor code>]
// Validates access, then hands the upgrade to the Presence DO. Every failure
// is the same generic 403 (cloudForbidden) — never a distinction leak.
async function handlePresenceUpgrade(request, env, url) {
  const projectId = String(url.searchParams.get('project') || '').slice(0, 64);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(projectId)) { await cloudTimingSink(); return cloudForbidden(); }
  let name = 'Viewer';
  let authed = false;
  // (a) Linked Google session — the cookie rides the handshake automatically.
  const session = await readSession(request, env);
  if (session && session.sub) {
    const row = await env.DB.prepare('SELECT google_sub FROM cloud_projects WHERE project_id = ?').bind(projectId).first();
    if (row) {
      if (row.google_sub === session.sub) { authed = true; name = session.name || 'Owner'; }
      else { await cloudTimingSink(); return cloudForbidden(); } // linked to another account
    }
  }
  // (b) Owner/editor code from the D1 row, or (c) published-manifest code.
  if (!authed) {
    const code = String(url.searchParams.get('code') || '').trim();
    if (code) {
      const row = await env.DB.prepare('SELECT owner_code_salt, owner_code_hash FROM cloud_projects WHERE project_id = ?').bind(projectId).first();
      if (row) {
        const hash = await hashOwnerCode(code, row.owner_code_salt);
        if (codesEqual(hash, row.owner_code_hash)) { authed = true; name = 'Owner'; }
        else {
          const ed = await cloudAuthEditor(request, env, projectId, code);
          if (ed) { authed = true; name = ed.label || 'Editor'; }
        }
      } else if (await cloudManifestCodeOk(env, projectId, code)) {
        authed = true; // published local project — anonymous viewer
      }
    }
  }
  if (!authed) { await cloudTimingSink(); return cloudForbidden(); }
  const headers = new Headers(request.headers);
  headers.set('X-Presence-Name', encodeURIComponent(name));
  const upgraded = new Request(request.url, { method: request.method, headers: headers });
  return env.PRESENCE.get(env.PRESENCE.idFromName(projectId)).fetch(upgraded);
}

// CLOUD-FIRST SYNC (2026-08-17): push a rev-changed message to the
// project's Presence DO so CONNECTED copies refresh instantly (live
// refresh on save — the approved scope). Fire-and-forget from the save
// path's perspective; presence is additive, a failed push changes nothing.
async function presencePushRevChanged(env, projectId, revision) {
  try {
    const stub = env.PRESENCE.get(env.PRESENCE.idFromName(projectId));
    await stub.fetch(new Request('https://presence.internal/broadcast', {
      method: 'POST',
      body: JSON.stringify({ type: 'rev-changed', revision: revision })
    }));
  } catch (e) { /* presence is additive — a failed push changes nothing */ }
}

// Presence Durable Object — WebSocket Collab per project (Hibernation API).
// One instance per project (idFromName(projectId)); in-memory roster only,
// no persistent storage of any kind.
export class Presence {
  constructor(state, env) { this.state = state; this.env = env; }

  async fetch(request) {
    // CLOUD-FIRST SYNC (2026-08-17): internal broadcast path. When the
    // Worker calls this DO with a plain POST (no WebSocket upgrade), the
    // JSON body is relayed to every connected socket. Only the Worker can
    // reach the DO (the binding stub); no public route maps to it and
    // /api/cloud/presence validates access before forwarding upgrades, so
    // this path is Worker-internal by construction.
    const upgrade = (request.headers.get('Upgrade') || '').toLowerCase();
    if (upgrade !== 'websocket') {
      try {
        const msg = await request.text();
        if (msg) this.broadcast(msg);
      } catch (e) { /* ignore malformed internal calls */ }
      return new Response('ok');
    }
    const name = decodeURIComponent(request.headers.get('X-Presence-Name') || 'Viewer');
    const pair = new WebSocketPair();
    const id = crypto.randomUUID();
    const server = pair[1];
    server.serializeAttachment({ id: id, name: name, since: Date.now(), lastSeen: Date.now() });
    this.state.acceptWebSocket(server);
    const members = [];
    for (const ws of this.state.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a && a.id !== id) members.push({ id: a.id, name: a.name, since: a.since });
    }
    server.send(JSON.stringify({ type: 'init', self: id, members: members }));
    this.broadcast(JSON.stringify({ type: 'join', id: id, name: name, since: Date.now() }), id);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws, msg) {
    const now = Date.now();
    const att = ws.deserializeAttachment() || {};
    att.lastSeen = now;
    ws.serializeAttachment(att);
    // Sweep stale sockets (client died without a close frame) on activity.
    for (const w of this.state.getWebSockets()) {
      const a = w.deserializeAttachment();
      if (a && now - (a.lastSeen || 0) > 75000) { try { w.close(4000, 'stale'); } catch (e) { /* already gone */ } }
    }
    try {
      const data = JSON.parse(msg);
      if (data && data.type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); }
    } catch (e) { /* non-JSON frames are ignored */ }
  }

  async webSocketClose(ws, code, reason, wasClean) {
    const a = ws.deserializeAttachment() || {};
    if (a && a.id) this.broadcast(JSON.stringify({ type: 'leave', id: a.id }), null);
  }

  async webSocketError(ws, err) {
    const a = ws.deserializeAttachment() || {};
    if (a && a.id) this.broadcast(JSON.stringify({ type: 'leave', id: a.id }), null);
  }

  broadcast(message, exceptId) {
    for (const ws of this.state.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (exceptId && a && a.id === exceptId) continue;
      try { ws.send(message); } catch (e) { /* closing socket */ }
    }
  }
}

export default {
  // A5-2 (2026-08-11): daily orphan-purge sweep — deletes cloud projects
  // whose owner has been absent for the retention window (12 months). Runs
  // on the cron trigger declared in wrangler.jsonc. Never touches asset
  // serving; a purge failure is logged-and-ignored, never surfaced to a
  // user request.
  async scheduled(event, env) {
    // The runtime ignores a scheduled handler's return value — this is
    // fire-and-forget by design; log the outcome only.
    try {
      const result = await purgeStaleCloudProjects(env);
      console.log('cloud orphan purge: checked=' + result.checked + ' purged=' + result.purged.length);
    } catch (e) {
      console.error('cloud orphan purge failed:', e && e.message);
    }
    // MASTER-ACTION-PLAN RANK 9.2 — opt-in webhook evaluation. With no
    // subscription rows the evaluator no-ops (off by default). Fire-and-
    // forget like the purge: log the outcome, never surface to a user.
    try {
      const w = await evaluateWebhooks(env);
      console.log('rank9 webhooks: checked=' + w.checked + ' fired=' + w.fired.length);
    } catch (e) {
      console.error('rank9 webhook evaluation failed:', e && e.message);
    }
    // AUTH-MAINFRAME: sweep stale session + guard rows so auth_sessions
    // cannot grow unbounded — expired rows and sessions revoked more than
    // 7 days ago, and lockout rows whose lock expired over a day ago.
    try {
      const s7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const s1 = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const sessSweep = await env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)')
        .bind(s7, s7).run();
      const guardSweep = await env.DB.prepare('DELETE FROM auth_login_guard WHERE locked_until IS NOT NULL AND locked_until < ?')
        .bind(s1).run();
      const tokenSweep = await env.DB.prepare('DELETE FROM auth_tokens WHERE expires_at < ? OR (used_at IS NOT NULL AND used_at < ?) OR (revoked_at IS NOT NULL AND revoked_at < ?)')
        .bind(s7, s7, s7).run();
      console.log('auth sweep: sessions=' + ((sessSweep.meta && sessSweep.meta.changes) || 0) + ' guards=' + ((guardSweep.meta && guardSweep.meta.changes) || 0) + ' tokens=' + ((tokenSweep.meta && tokenSweep.meta.changes) || 0));
    } catch (e) {
      console.error('auth sweep failed:', e && e.message);
    }
  },
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
      // SEO-FILES (2026-08-17): robots.txt/sitemap.xml must never fall
      // through to the SPA fallback (which serves index.html with 200).
      // Serve the real asset with a pinned Content-Type, or 404 if missing.
      if (SEO_FILES[normalized]) {
        const seoRes = await env.ASSETS.fetch(request);
        const seoType = seoRes.headers.get('Content-Type') || '';
        if (seoRes.ok && seoType.indexOf('text/html') !== 0) {
          const seoDecorated = new Response(seoRes.body, seoRes);
          seoDecorated.headers.set('Content-Type', SEO_FILES[normalized]);
          for (const [name, value] of Object.entries(HEADERS)) {
            seoDecorated.headers.set(name, value);
          }
          return seoDecorated;
        }
        return new Response('Not Found', { status: 404 });
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
