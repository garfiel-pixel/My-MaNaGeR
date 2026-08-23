import { handleAiChat } from './src/ai-proxy.js';
import { handleBillingWebhook, handleBillingStatus, handleBillingCheckout, billingConfigured, billingFreeCap } from './src/billing.js';
import { cloudAdminAuth, handleAdminCloudList } from './src/admin.js';
import { handleReviewsCreate, handleReviewsList, handleReviewList, handleReviewAccept, handleReviewReject } from './src/reviews.js';
import { handleCloudEditorCreate, handleCloudEditorList, handleCloudEditorRevoke } from './src/cloud/editors.js';
import { handleCloudChangelogList, handleCloudChangelogRevert, handleCloudChangelogImport } from './src/cloud/changelog.js';
import { handleCloudPrefsGet, handleCloudPrefsPut, cloudPrefsKey, cloudSanitizePalette, handleOfflineCopyRegister, handleOfflineCopyList, handleOfflineCopyDelete, handleCloudBroadcast, handleCloudAutoBroadcast } from './src/cloud/sync.js';
import { handleCloudProjectList, handleCloudUnadopt, handleCloudCreate, handleCloudSave, handleCloudLoad, handleCloudRecover, handleCloudMeta, handleCloudUnlink, handleCloudCodeLookup, handleCloudProjectDelete, handleCloudProjectRestore, handleCloudProjectPurge, cloudDeleteProjectFully, cloudPushRevChangedIfCopies, queueEditorProposal } from './src/cloud/projects.js';
import { API_SHAPES, apiPortfolio, handleApiShape } from './src/api/shapes.js';
import { handleWebhookCreate, handleWebhookList, handleWebhookDelete, evaluateWebhooks, WEBHOOK_EVENTS } from './src/webhooks.js';
import { Presence, handlePresenceUpgrade, presencePushRevChanged, cloudManifestCodeOk } from './src/cloud/presence.js';
export { Presence };  // wrangler requires DO classes in the entrypoint
import { handleAuthRegister, handleAuthLogin, handleAuthPasswordChange, handleAuthVerifyPassword, handleAuthVerify, handleAuthForgot, handleAuthReset, handleAuthResendVerify, handleAuthDeleteAccount } from './src/auth/session.js';
import {
  json, cloudForbidden, cloudProjectDeleted, cloudTimingSink, cloudDummyHash,
  codesEqual, base64UrlEncode, base64UrlDecode, base64UrlToBytes, bytesToBase64Url,
  sessionKey, signSession, readSession, sessionSetCookie, SESSION_COOKIE, SESSION_MAX_AGE,
  authEmailConfigured, authEmailFrom, sendAuthEmail, mintAuthToken, consumeAuthToken, authVerifyEmailBody, authSessionResponse,
  randomOwnerCode, sanitizeProjectId, randomSaltHex, hashOwnerCode, fingerprintOf,
  sameOriginOnly, readCloudBody, cloudReadState, cloudDeepEqual,
  CLOUD_SECTIONS, CLOUD_KEY_TO_SECTION, CLOUD_CONTENT_KEYS, CLOUD_CONTENT_KEY_SET, CLOUD_MAX_LEAF_DIFFS,
  cloudAuthOwnerByCode, cloudAuthOwnerSession, cloudAuthOwnerEither, cloudAuthSharedCode,
  cloudAuthEditor, cloudAuthViewer, cloudAdopt, cloudAuthAdoption, cloudAuthAnyAccess,
  cloudScopeMerge, cloudWalkLeaves, cloudFlattenLeaves, cloudDiffState, cloudSectionOfDiffs,
  cloudLogSave, cloudPathSegments, cloudPathGet, cloudPathSet, cloudPathDelete, cloudRevertDiff,
  cloudRateCheck, cloudRateLimited, cloudRateKey, cloudTouchOwner,
  handleCloudSections, CLOUD_EDITOR_AUTH_SLOTS, CLOUD_DUMMY_SALT, CLOUD_ORPHAN_RETENTION_MS, CLOUD_DELETED_PURGE_MS
} from './src/lib/http.js';

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
  "'sha256-LPhcYyVaGsoAWUYIPRyfwYSw2y82UmyNSa5ktKilmyA='", // project.html (head theme snippet — FOUC prevention)
  "'sha256-reza4vd5o52LWNUf9lzK6WjApdstd5sm4xVx+lcnK2M='", // project.html (body dark-mode transfer)
  "'sha256-QGpZbs5feaCjwpPp0+906ZIVPum27F+t6c16pf8K4LA='", // project.html (dev fallback script)
  "'sha256-jQGKXr3EKUJqelsBjB7GNSArKx9pbp38QHCOFoVCB3g='", // project.html (main inline script)
  "'sha256-59YXuH6ak9jBNEE5DGbQyi6pC3MiFmPHLBdvphq/ElQ='", // app.html (head theme + rail-open snippet — FOUC prevention)
  "'sha256-PcY9TdIJsXGVPic0Qujx0Ov+GCt9gZG0hEtBVRDiLiM='", // app.html (body class transfer)
  "'sha256-wbQHVPUuBhoFCNBpJBX8hjCDtoBTwuDB/PIL4YAPbo4='", // app.html (dev fallback script)
  "'sha256-6cm8By4LxG7o2HEW/Av42ySYb5kwhxxxP0Cj86/BxmY='", // app.html (dashboard logic)

  "'sha256-cCWiNSMtCJLjwt0mcR0GscIEccMUKMKocExGYJ4z96M='", // admin.html (head theme snippet — FOUC prevention)
  "'sha256-8rpgpTSjx7LcpleTm7RwTJ+pzjvndpRVDPiapb2gNo8='", // admin.html (body dark-mode transfer)
  "'sha256-O9lvE/vAuiMHUX3RQGR53K5h6w13/d2P16BoUBsYKAk='", // admin.html (dev fallback script)
  "'sha256-E7yiGOIyl3wYkOorh1fQgqNS+YxBEOsjuDyAF7I7J5g='", // admin.html (main inline script)
  "'sha256-Oa7ON+9A164SSXhnxu08mFn0V9Tj2SlZ2SzFXFoqKNE='", // dashboard.html
  "'sha256-bNdw0+64xL2//htoz+u3InKWYZNEHO/CnuZqtcJIBgU='", // seed-test.html
  "'sha256-7cQZf8bzyvMY1EwebBo5YuL3PZ9T/X5CTWFRXO3Aq5E='", // mymanager-field-guide.html
  "'sha256-c2U+m5SzyupzeOrPEiOjlnaSgS1KdAxZTFnYA5dW/Rk='", // monolith ref (block 1)
  "'sha256-Is0jD76ptemzKTfgnVGlSCSEHBJeveC1gRTl/Wv4JBw='"  // monolith ref (block 2)
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
  'Permissions-Policy': 'camera=(), microphone=(self), geolocation=(), payment=(), usb=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  // §5.1 audit fix: COOP/CORP headers prevent cross-origin window embedding
  // and resource loading — defense-in-depth alongside the CSP frame-ancestors.
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin'
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
// SESSION_COOKIE + SESSION_MAX_AGE imported from src/lib/http.js
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
// json() imported from src/lib/http.js

// AI relay extracted to src/ai-proxy.js — imported below.

// base64 utilities imported from src/lib/http.js

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
// sessionKey, signSession, readSession imported from src/lib/http.js

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

// sessionSetCookie imported from src/lib/http.js

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
const CLOUD_BODY_LIMIT_BYTES = 8388608; // 8 MB — state can include voice/claim data

// 16 chars from a 32-char unambiguous alphabet -> ~80 bits of entropy,
// formatted XXXX-XXXX-XXXX-XXXX. crypto.getRandomValues, never Math.random.

// The local project id becomes the cloud row's primary key. Only safe slug
// chars survive; anything else is rejected (never stored).

// Fresh 16-byte salt per project (hex). Stored next to the hash.

// PBKDF2-SHA256(salt, code) -> 32-byte hex. The code itself is never
// retained; only this derived value is persisted.

// sha256 hex fingerprint of a code — the lookup key used by
// POST /api/cloud/codes/lookup (migration 0009). Safe as a stored key
// because codes are high-entropy random strings (~80 bits): sha256 of
// the code is not brute-forceable, and the code itself is still never
// stored beyond the existing PBKDF2 hashes.

// Constant-time comparison (same XOR-accumulate pattern as readSession).

// TIMING-SIDE-CHANNEL GUARD (review finding): the unknown-project path must
// cost the SAME wall-clock as the known-project-wrong-code path. PBKDF2 at
// 100k iterations takes ~5-50ms; an unknown id that returns instantly would
// let an attacker distinguish "no such project" from "bad code" by timing
// alone — the exact leak check 5 forbids. So every "no row" branch runs one
// dummy PBKDF2 with a fixed code/salt before returning the generic 403.
// REVIEW FIX (timing existence leak): NEVER cache the dummy hash. A cached
// promise made repeat unknown-project probes resolve in ~0ms while a
// known-project wrong-code probe pays a real 100k-iteration PBKDF2 (~5-50ms)
// — wall-clock then leaks project existence (check 5). Uncached, every
// failure probe burns the same real PBKDF2 work as the honest path.
// Also drain a fixed deadline on the fast paths so even the dummy-hash
// shortcut cannot be profiled to sub-millisecond precision.

// The ONE 403 shape for every auth failure on cloud routes — unknown
// project, wrong code, missing code, and unlinked recovery are
// indistinguishable on purpose (no existence leak).

// The DISTINCT failure shape for a soft-deleted project (admin delete,
// migration 0009 deleted_at tombstone). Deliberately separate from
// cloudForbidden: per the owner's directive, a code holder must be told
// the project is gone (they already knew the code — no existence leak).

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

// ---- ORPHAN-PURGE (A5-2 decision, 2026-08-11) ----------------------------
// Auto-delete cloud projects after a retention window with NO owner
// activity (see migration 0004). The window is measured on
// last_owner_seen_at — stamped on owner-authenticated requests only — so an
// abandoned project cannot be kept alive by an editor's saves. The purge
// runs on the Worker's scheduled (cron) handler; it is intentionally
// conservative: a project whose last_owner_seen_at is null is never purged
// (legacy rows are back-filled by the migration, and the null guard is a
// belt-and-suspenders so a schema race can never delete a live project).
// CLOUD_ORPHAN_RETENTION_MS + CLOUD_DELETED_PURGE_MS imported from src/lib/http.js

// Stamp last_owner_seen_at on an owner-authenticated request. Fire-and-
// forget semantics: this is a maintenance bump, never a failure point —
// callers await it only when they want the write ordered with their own
// response (recover, save); meta/load can await it too since it is a single
// cheap UPDATE and D1 batches it with their own row read on the same conn.

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
    await cloudDeleteProjectFully(env, pid);
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
    await cloudDeleteProjectFully(env, pid);
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

// Size-capped body reader (mirror of readAiBody with a larger budget).


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

// CLOUD_SECTIONS, CLOUD_KEY_TO_SECTION, CLOUD_CONTENT_KEYS, CLOUD_CONTENT_KEY_SET,
// CLOUD_MAX_LEAF_DIFFS, cloudDeepEqual, cloudReadState imported from src/lib/http.js

// Read the latest state blob for a project (null when none exists).

// ---- owner identity: owner code OR the linked Google session ----
// Mirrors the timing discipline of the Phase 1 paths: unknown project,
// wrong code, missing code, unlinked session all burn the same
// dummy-PBKDF2 + timing floor before returning null (no existence leak).

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
// Shared-code auth for BOTH roles (migration 0009 role column): the JOIN
// pulls the project's deleted_at so load/save/meta can answer
// 'project_deleted' with the same row read (no extra SELECT on hot paths).
// Viewer identity: an active VIEW code can LOAD (read-only + section
// scope) but can never SAVE — the save path never accepts X-View-Code
// and cloudAuthEditor only matches role='editor'.

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
// Returns { role, editorId, label, scope, row } for an active adoption,
// { revoked: true } when the linked code was revoked/deleted, or null when
// this session has no adoption row for the project.

// ---- SERVER-SIDE SCOPE ENFORCEMENT (Phase 2, plan §3) -----------
// An editor's save is merged, never trusted wholesale: the new blob is
// the previous blob with ONLY the granted sections' state keys replaced
// by the submission. Anything outside the grant is carried over from the
// previous blob (physically impossible to change), and content-key
// differences outside the grant are reported as `blocked`. Metadata
// (updatedAt/fieldTs/...) is server-managed, never taken from an editor
// submission. fieldTs is kept consistent so the app's per-field
// last-write-wins merge sees the editor's applied keys as fresh.

// ---- Phase 3 changelog: leaf-level diffing + snapshot fallback ----

// Record one changelog row for a save. Returns {id,type} or null when
// nothing changed / first save. Field-level 'edit' for <= cap leaves,
// snapshot 'bulk' above it. entryType (optional) overrides the entry
// type — REVIEW QUEUE (2026-08-17) uses 'accepted' so an accepted
// proposal is logged as the audit record of the owner's decision
// (still revertible via the same leaf/snapshot machinery).

// ---- state-path utilities (revert) ------------------------------
// REVIEW FIX: never fabricate missing intermediate containers. Reverting a
// leaf whose parent element was deleted (e.g. tasks[0].name after tasks[0]
// was removed) must not resurrect a partial shell ({name:...} with no
// id/status/dates). Returns true only when the write actually landed.

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

// ---- editor code management (owner-only) -------------------------
// GET /api/cloud/sections — canonical section vocabulary (public).

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

// Read the JSON body with a review-sized cap (reviews are short prose;
// the cloud 8 MB body reader would accept junk we then reject anyway).

// PLAIN-TEXT-ONLY guard: reject HTML markup and URL scaffolding.
// Returns the problem as a human message, or null when the text is clean.

// POST /api/reviews  { name?, review, stars? }  →  { ok, review }
// Writes BOTH D1 (listing source) and R2 reviews/<id>.json (durable
// copy) — the same dual-write the cloud project rows use.

// GET /api/reviews — public, newest first. Never exposes anything beyond
// the four public fields; no moderation (owner: everyone sees all reviews
// instantly).

// POST /api/cloud/projects/:id/editors  { label, scope: [section...] }
// Owner-only (owner code or linked session). Generates the editor code,
// returns it EXACTLY ONCE, stores only salt+hash.
// Editor codes are capped per project (gap-audit item A6): an unbounded
// count is not a security hole but lets an automation loop / mistake silently
// create hundreds of rows. Generous cap, enforced on ACTIVE codes only.

// GET /api/cloud/projects/:id/editors — owner-only list (never codes/hashes).

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

// ---- changelog (Phase 3) -----------------------------------------
// GET /api/cloud/projects/:id/changelog — owner-only (code or session).

// POST /api/cloud/projects/:id/changelog/:entryId/revert — owner-only.

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

// Sanitize + validate ONE submitted entry. The sidecar's diffs_json may be
// a JSON string or an array; note that JSON round-trip DROPS undefined
// before/after values, so only path/beforeAbsent/afterAbsent are required
// structural invariants (recordId is optional but always present on MCP
// record diffs). Returns { ok:true, entry } or { ok:false, reason }.

// Verify one entry's diffs against the current blob (the MCP edit's AFTER
// state). Record diffs resolve by recordId — an add must be present and
// equal to d.after, a delete must be absent, an update must equal d.after
// (whole-record or field) — exactly the resolution the revert route will
// use, so a verified entry reverts correctly by construction. Charter/leaf
// diffs compare by path. Returns { ok:true } or { ok:false, reason }.


// ---- admin cloud visibility (operator-gated listing) --------------

// GET /api/cloud/projects — session-gated list of the SIGNED-IN OWNER'S
// cloud-linked projects (A5-3 decision, 2026-08-11: the multi-project
// "all my cloud projects" dashboard). Lists only rows whose google_sub
// matches the session — never another account's projects, and never leaks
// existence of ids the session does not own (same generic 403 as the rest
// of the API when no valid session rides along). No codes, no hashes.

// DELETE /api/cloud/projects/:id/adopt — a recipient removes a PINNED
// (adopted) project from their own My Cloud Projects list. Session + adoption
// row gated: only the adopting account itself can drop its own pin, and an
// owner's own project is never touched (the adoption row is keyed on the
// session's sub). No timing floor needed — same per-user capability read as
// cloudAuthAdoption.

// ---- account theme preference (THEME-SYSTEM-AND-MOBILE-UI-ACTION-PLAN §2.3) ----
// GET/PUT /api/cloud/prefs/theme — session-gated (the signed-in Google
// account), stored as a tiny JSON blob in R2 (prefs/<sub>.json). No D1
// migration needed and offline-first is untouched: the client always applies
// localStorage instantly and treats this endpoint as the preferred-but-
// optional source of truth. A 403 here (no valid session) simply means the
// client keeps its local cache. Same generic forbidden as the rest of the
// API — nothing leaks about whether the account exists.
// SIDEBAR-HAMBURGER-TOGGLE-PLAN: the desktop sidebar layout lives in the SAME
// R2 prefs blob as palette/dark — one session-gated endpoint serves the whole
// device-preference set, so a signed-in account's layout follows across devices.



// POST /api/cloud/projects  { projectId, name? }
// Creates the D1 row, generates the owner code (returned ONCE), links the
// Google account when a valid session cookie rides along. 409 if the
// project id is already linked.

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


// REVIEW QUEUE shared push: after an ACCEPT (or any save) moves the blob,
// tell connected copies + log the auto-broadcast entry when the project has
// >=1 registered copy. Same additive discipline as the save path.

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

// POST /api/cloud/projects/:id/recover  (session-cookie gated)
// Owner-code reissue. The requester MUST hold a valid mmgr_session whose
// sub matches the row's google_sub (Garfield's decision: recovery requires
// the Google account on file). Unknown id / unlinked / wrong account are
// all the SAME generic 403. Issues a brand-new code, re-hashes, returns it
// once.

// GET /api/cloud/projects/:id/meta  (X-Owner-Code header OR linked session)
// Lightweight status for the UI: is it linked, does a snapshot exist, when
// was it last updated, what label was stored. Same generic 403 on failure.

// GET /api/cloud/projects/:id/meta  (X-Owner-Code / X-Editor-Code / session)
// Lightweight status for the UI: linked, snapshot, updated, label. Editor
// loads additionally return the editor's scope. Same generic 403 on failure.

// ---- owner-only unlink (gap-audit item B10) -------------------------------
// DELETE /api/cloud/projects/:id — deletes the CLOUD copy of the project:
// D1 row, all editor codes, the changelog, and every R2 object under the
// project prefix (latest.json + changelog snapshots). The device's LOCAL
// project data is untouched — "keep local copy, stop syncing". Owner-only
// (code or linked session), same generic 403 as everything else.

// ---- CLOUD-FIRST SYNC (PART 3, approved 2026-08-17): offline copies ----
// Any VALID access to the project can register an offline copy (viewer,
// editor, owner code, linked session, or adoption) — a copy is view-only by
// design, so registering it needs no special role. Returns the auth result
// or null after the standard timing discipline.

// POST /api/cloud/projects/:id/offline-copies  { deviceId }
// Registers this device as a view-only offline copy of the cloud project.
// Idempotent per device (UNIQUE(project_id, device_id) upsert): a device
// re-registering gets its existing row back, never a duplicate. The device
// id is client-supplied (a stable per-device id, e.g. a localStorage uuid)
// and shape-checked. Returns the copy id + the current cloud revision so
// the client can store its starting last_cloud_rev without a second call.

// GET /api/cloud/projects/:id/offline-copies — owner-only list of every
// registered offline copy (id, device, registered, last pulled + the rev
// it last pulled) plus the project's current revision and auto-broadcast
// flag, so the owner's Broadcast UI can show count + freshness.

// DELETE /api/cloud/projects/:id/offline-copies/:copyId — unregister a
// copy. Owner (code or session) may remove any copy; the registering device
// itself may also remove its own (deviceId in the body). Same generic 403
// for everyone without the right.

// POST /api/cloud/projects/:id/broadcast — owner-only MANUAL broadcast:
// pushes the project's current revision to every connected copy via the
// Presence DO (connected copies refresh instantly; offline copies pick up
// the new rev on their next meta/load and show the Update icon), and logs
// a changelog entry type 'broadcast' so the audit trail shows it.

// PUT /api/cloud/projects/:id/auto-broadcast  { enabled }
// Owner-only per-project switch: when enabled, EVERY save also broadcasts
// its new revision to all registered copies (the auto form of the manual
// button — the owner "turns on auto broadcast for that specific project").

// ---- REVIEW QUEUE (2026-08-17, approved "always on") ---------------------
// The owner's gate for changes from a non-owner source (editor saves +
// MCP imports). GET lists proposals; POST :id/accept applies + logs
// 'accepted'; POST :id/reject discards + logs 'rejected'. Owner-only for
// the list/decide endpoints; an editor can read their OWN proposals via
// ?mine=1 with the editor credential (status visibility on the source
// side — approved "review list with status").



// ---- CLOUD-CODES-AND-DELETE-DIRECTIVE (2026-08-16) -----------------------
// POST /api/cloud/codes/lookup  { code }
// The launcher's single door: resolves ANY code (owner / editor / view) to
// its cloud project WITHOUT returning state or the code itself. Lookup is
// by sha256 fingerprint (migration 0009) — safe because codes are
// high-entropy random strings, and the plaintext is still never stored
// beyond the existing PBKDF2 hashes. Distinct user-facing outcomes per
// the owner's directive: invalid_code (nothing matches), code_revoked (a
// shared code that was revoked), project_deleted (admin-deleted project).

// POST /api/cloud/projects/:id/delete — owner-only SOFT delete (admin
// panel Delete). Tombstones the row (deleted_at) so every load/save/meta
// and the launcher lookup immediately answer 'project_deleted', while
// POST .../restore can bring it all back within the undo window. Hard
// purge of tombstoned rows happens in the scheduled() cleanup
// (CLOUD_DELETED_PURGE_MS).

// POST /api/cloud/projects/:id/restore — owner-only undo of the soft
// delete above (admin Undo within the toast window). Clears the tombstone;
// the project is live again for every code holder. FULL restore (local +
// cloud + codes) per the owner's planning decision.

// POST /api/cloud/projects/:id/purge — owner OR site-admin HARD delete
// (STABILIZATION directive 2026-08-16, owner decision: soft delete + Undo,
// with a "Delete permanently" fortify button). Removes the project from the
// backend NOW — R2 blobs (every revision under projects/<id>/), editor/viewer
// codes, recipient adoptions, the changelog, and the D1 row itself. This is
// the manual version of the 7-day cron tombstone purge: a deliberate,
// destructive operator action with no tombstone and no undo — "there will be
// no more cloud until another cloud upload" (owner's words).

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

// AUTH MAINFRAME v2 (2026-08-17) — email verification + forgot/reset via
// Resend (RESEND_API_KEY / RESEND_FROM_EMAIL Wrangler secrets). DORMANT
// until configured: with no RESEND_API_KEY the app sends no email and the
// verified-email cloud gate is off — behavior is byte-for-byte unchanged.
const AUTH_VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // verify link: 24 hours
const AUTH_RESET_TTL_MS = 30 * 60 * 1000;        // reset link: 30 minutes
const AUTH_RESET_MAX_PER_EMAIL_H = 5;            // forgot: 5/hour/email



// hashOwnerCode IS the PBKDF2-SHA256 (iterations, salt) helper — reuse it
// verbatim so the password path and the owner-code path share one KDF.

// ---- Resend transactional email (AUTH MAINFRAME v2, 2026-08-17) ----------
// Plain REST from the Worker (no SDK), dormant until configured: with no
// RESEND_API_KEY the app sends nothing and every caller behaves exactly as
// before. RESEND_API_BASE is a TEST-ONLY seam (qa-email-auth points it at a
// local stub) — never set it in production.
// Send a plain-text transactional email. Returns true when Resend accepted
// it; never throws — a mail failure must not break a signup/login/webhook.

// ---- One-time signed tokens (verify + reset) ------------------------------
// Mint: random jti, HMAC-signed payload (t = purpose, e = email, j = jti,
// iat/exp), ledger row in auth_tokens. A failed D1 write must never block
// the flow — the token is still signed and expiry-bounded; server-side
// revocation then lapses to expiry-only (same accepted trade-off as
// mintSession).

// Shared verification-email body — used by register (initial link) and
// /api/auth/resend-verify (expired/used-link recovery) so the two paths can
// never drift apart.

// Consume a one-time token for a purpose. Returns the bound email on
// success, null on any failure (bad signature, wrong purpose, expired,
// unknown row, or already consumed). Single-use is a conditional UPDATE —
// two racing replays cannot both consume the same row.

// Sign a session for an email account and return the Set-Cookie response,
// mirroring the /api/auth/google response shape exactly.

// POST /api/auth/register { email, password, name? }

// POST /api/auth/login { email, password }

// POST /api/auth/password { currentPassword, newPassword } — session-gated
// password change. Email accounts only (Google-linked sessions have no
// password). Verifies the CURRENT password, swaps the PBKDF2 hash, and
// revokes every OTHER session for the account (the present one survives) —
// a password change is a theft signal, so old sessions should not outlive it.

// POST /api/auth/verify-password { password } — session-gated password
// verification for destructive actions (owner 2026-08-17: "you have to put
// in your password for the Google account to verify the delete"). Email
// accounts only (Google-linked sessions have no password — their signed-in
// session IS the verification, the worker answers 400 for them exactly like
// the password-change flow). Same timing-safe PBKDF2 check as
// handleAuthPasswordChange; a wrong password answers 401 'password is
// incorrect' and a non-empty session is required. Used by the in-project
// Delete Project flow BEFORE the owner-only cloud delete is called.

// POST /api/auth/verify { token } — consume the one-time verify token and
// mark the account's email verified. Replays answer 400 (single-use); a
// second click on the same link is therefore a clean 'already used' error,
// not a double-write.

// POST /api/auth/forgot { email } — request a password reset. The response
// is IDENTICAL whether or not the email exists (dummy-PBKDF2 timing on the
// unknown path — no existence leak), and the per-email quota (5/hour) also
// answers the same generic message so the quota itself cannot be probed.

// POST /api/auth/reset { token, newPassword } — consume the one-time reset
// token, swap the PBKDF2 hash, revoke EVERY session for the account (a
// password reset is a takeover signal — old sessions must not outlive it),
// and clear any login lockout for the account.

// POST /api/auth/resend-verify { email } — request a FRESH verification link
// (the 24h single-use link died). Same generic-response + quota discipline as
// forgot: the response is IDENTICAL whether the account is unknown, unverified,
// or already verified (dummy-PBKDF2 timing on the unknown path — no existence
// leak), and the per-email quota (5/hour) answers the same generic message.

/* ============================================================
   BILLING TIER (deferred cloud item #15, EXECUTED 2026-08-12)
   ------------------------------------------------------------
   Provider: LemonSqueezy — merchant of record (LS collects and
   remits sales tax/VAT itself, so the app never computes or
   files tax; chosen over a raw processor for exactly that
   reason). The tier is DORMANT until configured: with none of
   Billing extracted to src/billing.js — imported above.
   ============================================================ */

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

// ---- /api/auth/* routes --------------------------------------------------
async function handleApi(request, env, url) {
  try {
  const path = url.pathname;

  // WEBHOOK EXEMPTION (billing tier): LemonSqueezy posts server-to-server
  // with no browser Origin (sameOriginOnly would pass anyway), but if an
  // Origin ever rides along it must not 403 — the HMAC signature, not origin,
  // is the webhook's auth. Routed before the same-origin gate on purpose.
  if (path === '/api/billing/webhook' && request.method === 'POST') {
    return handleBillingWebhook(request, env);
  }

  // INTERNAL PRESENCE AUTH — validates a code for WebSocket upgrade.
  // Reached via the INTERNAL_AUTH service binding from the Presence DO,
  // but also reachable as a public path. Rate-limited and hardened
  // identically to every other auth path to prevent oracle probing.
  if (path === '/api/internal/presence-auth' && request.method === 'POST') {
    const rl = await cloudRateCheck(request, 'general', env);
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    try {
      const body = await request.json();
      const projectId = String(body.projectId || '').slice(0, 64);
      const code = String(body.code || '').trim();
      if (!projectId || !code) { await Promise.all([cloudDummyHash(), cloudTimingSink()]); return json({ ok: false }); }
      const row = await env.DB.prepare('SELECT owner_code_salt, owner_code_hash, google_sub FROM cloud_projects WHERE project_id = ?').bind(projectId).first();
      if (!row) { await Promise.all([cloudDummyHash(), cloudTimingSink()]); return json({ ok: false }); }
      const hash = await hashOwnerCode(code, row.owner_code_salt);
      if (codesEqual(hash, row.owner_code_hash)) return json({ ok: true, name: 'Owner' });
      const ed = await cloudAuthEditor(request, env, projectId, code);
      if (ed) return json({ ok: true, name: ed.label || 'Editor' });
      if (await cloudManifestCodeOk(env, projectId, code)) return json({ ok: true, name: 'Viewer' });
      await Promise.all([cloudDummyHash(), cloudTimingSink()]);
      return json({ ok: false });
    } catch (e) { await Promise.all([cloudDummyHash(), cloudTimingSink()]); return json({ ok: false }); }
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
    const rl = await cloudRateCheck(request, 'general', env);
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
    if (op === 'save' && request.method === 'POST') return handleCloudSave(request, env, pid, async function(env, projectId, now, actor) { await cloudPushRevChangedIfCopies(env, projectId, now, actor); });
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
    const rl = await cloudRateCheck(request, 'general', env);
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleCloudCodeLookup(request, env);
  }
  // PART F T9: DELETE /api/cloud/projects/:id/adopt — recipient unpins a
  // project from their own My Cloud Projects list.
  const cloudUnadoptMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/adopt$/);
  if (cloudUnadoptMatch && request.method === 'DELETE') {
    const rl = await cloudRateCheck(request, 'general', env);
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleCloudUnadopt(request, env, cloudUnadoptMatch[1]);
  }
  // DELETE /api/cloud/projects/:id — owner-only unlink (gap-audit item B10).
  const cloudUnlinkMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})$/);
  if (cloudUnlinkMatch && request.method === 'DELETE') {
    const rl = await cloudRateCheck(request, 'general', env);
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleCloudUnlink(request, env, cloudUnlinkMatch[1]);
  }
  // MASTER-ACTION-PLAN RANK 9 (2026-08-12) — read-only resource shapes +
  // opt-in webhook subscriptions. Runs before the ASSETS binding like every
  // /api/cloud route; both are owner-gated.
  const apiShapeMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/api\/([a-z]+)$/);
  if (apiShapeMatch && request.method === 'GET') {
    const rl = await cloudRateCheck(request, 'general', env);
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    const shape = apiShapeMatch[2];
    if (!API_SHAPES[shape]) return json({ ok: false, error: 'unknown shape — use tasks, baseline, risks, weather, evm or portfolio' }, 404);
    return handleApiShape(request, env, apiShapeMatch[1], shape);
  }
  const webhookListMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/webhooks$/);
  if (webhookListMatch) {
    const rl = await cloudRateCheck(request, 'general', env);
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    if (request.method === 'POST') return handleWebhookCreate(request, env, webhookListMatch[1]);
    if (request.method === 'GET') return handleWebhookList(request, env, webhookListMatch[1]);
  }
  const webhookDelMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/webhooks\/(\d+)$/);
  if (webhookDelMatch && request.method === 'DELETE') {
    const rl = await cloudRateCheck(request, 'general', env);
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleWebhookDelete(request, env, webhookDelMatch[1], webhookDelMatch[2]);
  }

  // THEME-SYSTEM-AND-MOBILE-UI-ACTION-PLAN §2.3 — session-gated account
  // theme preference (GET returns the stored pref, PUT accepts { palette,
  // dark }); R2-backed, no D1 migration. Runs before the ASSETS binding
  // like every /api/cloud route.
  if (path === '/api/cloud/prefs/theme') {
    const rl = await cloudRateCheck(request, 'general', env);
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
    const rl = await cloudRateCheck(request, 'general', env);
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handlePresenceUpgrade(request, env, url);
  }
  // CLOUD-FIRST SYNC (PART 3, approved 2026-08-17): offline-copy
  // registration + the admin broadcast controls. POST = register this
  // device as a view-only offline copy (any valid credential); GET =
  // owner-only list (the broadcast UI needs the count + freshness).
  const offlineListMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/offline-copies$/);
  if (offlineListMatch) {
    const rl = await cloudRateCheck(request, 'general', env);
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    if (request.method === 'POST') return handleOfflineCopyRegister(request, env, offlineListMatch[1]);
    if (request.method === 'GET') return handleOfflineCopyList(request, env, offlineListMatch[1]);
  }
  // DELETE /api/cloud/projects/:id/offline-copies/:copyId — unregister
  // (owner, or the registering device itself).
  const offlineDelMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/offline-copies\/([A-Za-z0-9-]{1,64})$/);
  if (offlineDelMatch && request.method === 'DELETE') {
    const rl = await cloudRateCheck(request, 'general', env);
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleOfflineCopyDelete(request, env, offlineDelMatch[1], offlineDelMatch[2]);
  }
  // REVIEW QUEUE (2026-08-17): GET /reviews lists proposals — owner sees
  // every proposal (pending first), an editor credential (or mine=1 with
  // one) sees only their own (status visibility on the source side).
  const reviewListMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/reviews$/);
  if (reviewListMatch && request.method === 'GET') {
    const rl = await cloudRateCheck(request, 'general', env);
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleReviewList(request, env, reviewListMatch[1], url.searchParams.get('mine') === '1');
  }
  // POST /reviews/:id/accept + /reviews/:id/reject — owner-only decisions.
  const reviewAcceptMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/reviews\/(\d+)\/accept$/);
  if (reviewAcceptMatch && request.method === 'POST') {
    const rl = await cloudRateCheck(request, 'general', env);
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleReviewAccept(request, env, reviewAcceptMatch[1], Number(reviewAcceptMatch[2]), cloudPushRevChangedIfCopies);
  }
  const reviewRejectMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/reviews\/(\d+)\/reject$/);
  if (reviewRejectMatch && request.method === 'POST') {
    const rl = await cloudRateCheck(request, 'general', env);
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleReviewReject(request, env, reviewRejectMatch[1], Number(reviewRejectMatch[2]));
  }
  // POST /api/cloud/projects/:id/broadcast — owner-only manual broadcast:
  // push the current revision to every registered copy + record a
  // changelog 'broadcast' entry so the audit trail shows it.
  const broadcastMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/broadcast$/);
  if (broadcastMatch && request.method === 'POST') {
    const rl = await cloudRateCheck(request, 'general', env);
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleCloudBroadcast(request, env, broadcastMatch[1], presencePushRevChanged);
  }
  // PUT /api/cloud/projects/:id/auto-broadcast — owner-only per-project
  // switch: when enabled, EVERY save also broadcasts (the auto form of the
  // manual button).
  const autoBcMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/auto-broadcast$/);
  if (autoBcMatch && request.method === 'PUT') {
    const rl = await cloudRateCheck(request, 'general', env);
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleCloudAutoBroadcast(request, env, autoBcMatch[1]);
  }


  // CLOUD-BACKEND-ARCHITECTURE-PLAN Phase 2/3 — editor codes, changelog,
  // and admin cloud visibility. All cloud routes run before the ASSETS
  // binding, exactly like the Phase 1 routes above.
  if (path === '/api/cloud/sections' && request.method === 'GET') {
    const rl = await cloudRateCheck(request, 'general', env);
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleCloudSections();
  }
  if (path === '/api/cloud/admin/projects' && request.method === 'GET') {
    const rl = await cloudRateCheck(request, 'general', env);
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleAdminCloudList(request, env);
  }
  const cloudEditorsMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/editors$/);
  if (cloudEditorsMatch) {
    const pid = cloudEditorsMatch[1];
    const rl = await cloudRateCheck(request, 'general', env);
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    if (request.method === 'POST') return handleCloudEditorCreate(request, env, pid);
    if (request.method === 'GET') return handleCloudEditorList(request, env, pid);
  }
  const cloudEditorDelMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/editors\/(\d+)$/);
  if (cloudEditorDelMatch && request.method === 'DELETE') {
    const rl = await cloudRateCheck(request, 'general', env);
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleCloudEditorRevoke(request, env, cloudEditorDelMatch[1], cloudEditorDelMatch[2]);
  }
  const cloudLogMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/changelog$/);
  if (cloudLogMatch && request.method === 'GET') {
    const rl = await cloudRateCheck(request, 'general', env);
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleCloudChangelogList(request, env, cloudLogMatch[1]);
  }
  const cloudImportMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/changelog\/import$/);
  if (cloudImportMatch && request.method === 'POST') {
    const rl = await cloudRateCheck(request, 'general', env);
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleCloudChangelogImport(request, env, cloudImportMatch[1]);
  }
  const cloudRevertMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/changelog\/(\d+)\/revert$/);
  if (cloudRevertMatch && request.method === 'POST') {
    const rl = await cloudRateCheck(request, 'general', env);
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
      const rl = await cloudRateCheck(request, 'general', env);
      if (rl.limited) return cloudRateLimited(rl.retryAfter);
      return handleReviewsList(env);
    }
    if (request.method === 'POST') {
      const rl = await cloudRateCheck(request, 'reviews', env);
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
    const rl = await cloudRateCheck(request, 'authRegister', env);
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleAuthRegister(request, env);
  }
  if (path === '/api/auth/login' && request.method === 'POST') {
    const rl = await cloudRateCheck(request, 'authLogin', env);
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleAuthLogin(request, env);
  }
  // POST /api/auth/password — session-gated password change (email accounts
  // only; revokes every OTHER session). Rides the login bucket: it is the
  // same credential surface (verifies the current password).
  if (path === '/api/auth/password' && request.method === 'POST') {
    const rl = await cloudRateCheck(request, 'authLogin', env);
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleAuthPasswordChange(request, env);
  }
  // POST /api/auth/verify-password — session-gated password verification
  // for destructive actions (in-project Delete Project, owner 2026-08-17).
  // Same credential surface + login bucket as the password change above.
  if (path === '/api/auth/verify-password' && request.method === 'POST') {
    const rl = await cloudRateCheck(request, 'authLogin', env);
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleAuthVerifyPassword(request, env);
  }
  // POST /api/auth/delete-account — session-gated account deletion
  // (GDPR/CCPA right to erasure). Email accounts require password;
  // Google accounts require typing DELETE. Active subscriptions block.
  if (path === '/api/auth/delete-account' && request.method === 'POST') {
    const rl = await cloudRateCheck(request, 'authLogin', env);
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleAuthDeleteAccount(request, env);
  }
  // AUTH MAINFRAME v2 — email verification + forgot/reset. verify/reset
  // consume one-time signed tokens (single-use, HMAC-bound to the account);
  // forgot rides the unauthenticated surface like register/login (same-
  // origin gate above) and answers a generic message either way (no
  // existence leak).
  if (path === '/api/auth/verify' && request.method === 'POST') {
    const rl = await cloudRateCheck(request, 'authToken', env);
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleAuthVerify(request, env);
  }
  if (path === '/api/auth/forgot' && request.method === 'POST') {
    const rl = await cloudRateCheck(request, 'authForgot', env);
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleAuthForgot(request, env);
  }
  if (path === '/api/auth/reset' && request.method === 'POST') {
    const rl = await cloudRateCheck(request, 'authToken', env);
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleAuthReset(request, env);
  }
  // POST /api/auth/resend-verify — fresh verification link for a dead
  // 24h/single-use link (verify.html's recoverable error path). Rides the
  // authForgot bucket (same unauthenticated, quota-guarded surface).
  if (path === '/api/auth/resend-verify' && request.method === 'POST') {
    const rl = await cloudRateCheck(request, 'authForgot', env);
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
    const rl = await cloudRateCheck(request, 'general', env);
    if (rl.limited) return cloudRateLimited(rl.retryAfter);
    return handleBillingStatus(request, env);
  }
  if (path === '/api/billing/checkout' && request.method === 'POST') {
    const rl = await cloudRateCheck(request, 'general', env);
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
  } catch (e) {
    // §3.2 audit fix: unhandled API exceptions now return 500 with logging
    // instead of silently becoming a misleading 404.
    console.error('API unhandled error:', e && e.message);
    return json({ ok: false, error: 'internal server error' }, 500);
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
      // CACHE-CONTROL: HTML is revalidated on every visit (no-cache) so
      // users always get the latest markup and inline-script CSP hashes.
      // Static assets (JS, CSS, images, SVG, fonts) are immutable for 1
      // year — content changes are cache-busted by the SW version bump.
      // JSON/manifest files revalidate (they may change with schema or
      // metadata updates). Everything else gets a short 1-hour TTL.
      // The SW cache is the primary offline layer; these HTTP headers
      // are a safety net for direct requests that bypass the SW.
      const ext = normalized.replace(/.*\./, '').toLowerCase();
      const IMMUTABLE = 'public, max-age=31536000, immutable';
      const NO_CACHE  = 'no-cache';
      const SHORT_TTL = 'public, max-age=3600';
      if (/\.html$/.test(normalized) || normalized === '/' || ext === normalized.replace('/', '')) {
        decorated.headers.set('Cache-Control', NO_CACHE);
      } else if (['js', 'css', 'svg', 'png', 'ico', 'webp', 'woff', 'woff2', 'ttf', 'otf'].indexOf(ext) !== -1) {
        decorated.headers.set('Cache-Control', IMMUTABLE);
      } else if (ext === 'json' || ext === 'webmanifest') {
        decorated.headers.set('Cache-Control', NO_CACHE);
      } else {
        decorated.headers.set('Cache-Control', SHORT_TTL);
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
