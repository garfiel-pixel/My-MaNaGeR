import { routeApi } from './src/router.js';
import { Presence } from './src/cloud/presence.js';
import { purgeStaleCloudProjects } from './src/cloud/projects.js';
import { evaluateWebhooks } from './src/webhooks.js';

export { Presence }; // wrangler requires DO classes in the entrypoint

/* ============================================================
   My MaNaGeR — Thin response-decorating Worker (OBSERVABILITY-
   SECURITY-DOMAIN-EXECUTION-DIRECTIVES DIR-2, branch B)
   ------------------------------------------------------------
   This worker does two things:
     1. Serves static assets via the ASSETS binding with security
        headers (CSP, HSTS, XFO, etc.)
     2. Delegates all /api/* routes to src/router.js

   All API business logic lives in src/router.js and its domain
   modules. This file is deliberately thin — it should never
   grow new route matching or handler logic.
   ============================================================ */

// CSP hash list must match the current served inline scripts — see the
// regen command in the comment below.

const INLINE_SCRIPT_HASHES = [
  "'sha256-xxa9/PuVrm+Taxz+xZPm96NYiSKIHPHZLX8VCKQnrXk='",
  "'sha256-reza4vd5o52LWNUf9lzK6WjApdstd5sm4xVx+lcnK2M='",
  "'sha256-gfsHD0hWPHbqScBzCG03KThLx1uSZyAYZrc0ad1/amk='",
  "'sha256-32OrKvBTd4t3c/ByJMRp2EAI4phrVdX+LEPphWfgSz4='",
  "'sha256-6n6X5blbus8T7LO3a/rxKTOOdes6mm9KXmC/gWtOr1M='",
  "'sha256-PcY9TdIJsXGVPic0Qujx0Ov+GCt9gZG0hEtBVRDiLiM='",
  "'sha256-UbDx44vSDny3VslAGcGApbO56dR8hRvFQbe+phFAAxE='",
  "'sha256-mRpeyoHtzK0Ob8cNq/6yZMdN4ODpOQQmynGjLj+JcHA='",
  "'sha256-7BIp3SE8LrjSq5puH0lRtmP51SnLzcmBy32sBq0Zcps='",
  "'sha256-PcY9TdIJsXGVPic0Qujx0Ov+GCt9gZG0hEtBVRDiLiM='",
  "'sha256-O9lvE/vAuiMHUX3RQGR53K5h6w13/d2P16BoUBsYKAk='",
  "'sha256-8PEd3kmlWle0bpgxoNJ9+vmZ4U5sVIQTVwpYf2cZEjg='",
  "'sha256-Oa7ON+9A164SSXhnxu08mFn0V9Tj2SlZ2SzFXFoqKNE='",
  "'sha256-pmiUsOqQa0BPAXsieggzTCopGA0jQO863MBE2hEoBb8='",
  "'sha256-7cQZf8bzyvMY1EwebBo5YuL3PZ9T/X5CTWFRXO3Aq5E='",
  "'sha256-c2U+m5SzyupzeOrPEiOjlnaSgS1KdAxZTFnYA5dW/Rk='",
  "'sha256-Is0jD76ptemzKTfgnVGlSCSEHBJeveC1gRTl/Wv4JBw='",
  "'sha256-O8tjgX8HAC3naABULMDuIYqJtVsk/JWqKAbIoD83O4I='",
  "'sha256-z4fAK08A0qg3PUv1ejEGYpYFFQ9B8R2/33mul8SlRjs='",
  "'sha256-O8tjgX8HAC3naABULMDuIYqJtVsk/JWqKAbIoD83O4I='",
  "'sha256-O8tjgX8HAC3naABULMDuIYqJtVsk/JWqKAbIoD83O4I='",
  "'sha256-O8tjgX8HAC3naABULMDuIYqJtVsk/JWqKAbIoD83O4I='",
  "'sha256-nsm9D+YbB4LQUmNXHf3kbpV7BWERupRhGClSKaU+DEo='",
  "'sha256-O8tjgX8HAC3naABULMDuIYqJtVsk/JWqKAbIoD83O4I='",
  "'sha256-O8tjgX8HAC3naABULMDuIYqJtVsk/JWqKAbIoD83O4I='"
].join(' ');

// S-2 CONSENT-GATED ANALYTICS (audit 2026-10-18, 8.2). The zone auto-injects
// Cloudflare's Web Analytics beacon into browser navigations at the edge,
// AFTER this Worker's response is built (verified live 2026-10-20), so the
// only enforcement point we own is this header. static.cloudflareinsights.com
// is therefore NOT in the base policy: cspFor() appends it per response only
// when the visitor's consent cookie says analytics was accepted (js/consent.js
// mirrors the mmgr_consent localStorage choice into the mmgr_consent_a
// cookie). Without the cookie the browser refuses the injected beacon before
// fetching it - zero requests before consent, which is exactly GATE S-2. If
// the zone's auto-injection is ever disabled in the dashboard, this gate
// simply stops mattering (nothing is injected); it never becomes wrong.
//
// The cookie is "<inventoryVersion>.<chosenAtMs>", NOT a bare flag: this
// server is the only place that can tell a current choice from a stale one
// on the very first request, before any script has run. A choice made under
// an older inventory, or one older than twelve months, is refused here -
// which is what stops the beacon on pages that never run the consent script
// (the signed-in app shows no banner). See js/consent.js for the client side.
const CONSENT_ANALYTICS_HOST = ' https://static.cloudflareinsights.com';

// MUST match INVENTORY_VERSION in js/consent.js and
// CONSENT_INVENTORY_VERSION in serve.cjs - tools/qa-consent.cjs phase S
// fails the build if the three drift.
const CONSENT_INVENTORY_VERSION = 2;
// A choice is re-asked every 12 months (js/consent.js MAX_AGE_MS).
const CONSENT_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
// Tolerate a device clock a little ahead of this server's.
const CONSENT_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

function analyticsAllowed(request) {
  const cookie = request.headers.get('Cookie') || '';
  const m = /(?:^|;\s*)mmgr_consent_a=(\d+)\.(\d+)(?:\s*;|$)/.exec(cookie);
  if (!m) {
    return false;
  }
  if (Number(m[1]) !== CONSENT_INVENTORY_VERSION) {
    return false; // a choice made under an older inventory: ask again
  }
  const ts = Number(m[2]);
  if (!Number.isFinite(ts) || ts <= 0) {
    return false;
  }
  const age = Date.now() - ts;
  if (age < 0) {
    return age > -CONSENT_CLOCK_SKEW_MS; // clock ahead: only a small skew passes
  }
  return age < CONSENT_MAX_AGE_MS;
}

function cspFor(request, normalized, isDocument) {
  // The analytics host belongs in a DOCUMENT's policy ONLY. The beacon is
  // injected into HTML at the edge, so only an HTML response can ever carry
  // the script that needs the host - a script or stylesheet response has no
  // policy of its own to enforce. Every other response gets the constant
  // base policy, so a cacheable response never holds a header that depends
  // on one visitor's choice.
  const allow = isDocument && analyticsAllowed(request) ? CONSENT_ANALYTICS_HOST : '';
  const base = normalized === '/pricing' || normalized === '/pricing.html' ? PADDLE_CSP : CSP;
  // Both base policies carry an %%ANALYTICS%% placeholder inside script-src;
  // it resolves to the host (consented) or to nothing (default).
  return base.replace('%%ANALYTICS%%', allow);
}

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' https://accounts.google.com https://apis.google.com%%ANALYTICS%% https://challenges.cloudflare.com https://cdn.paddle.com " +
    INLINE_SCRIPT_HASHES,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com",
  "img-src 'self' data: blob: https://lh3.googleusercontent.com https://*.googleusercontent.com",
  "media-src 'self' data: blob:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' https: https://accounts.google.com https://oauth2.googleapis.com blob:",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  'frame-src https://accounts.google.com https://challenges.cloudflare.com https://checkout.paddle.com https://cdn.paddle.com',
  "frame-ancestors 'none'"
].join('; ');

const HEADERS = {
  // NOTE: Content-Security-Policy is deliberately NOT in this static map -
  // it is per-request (consent cookie gates the analytics host), set below.
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // OWNER 2026-09-28: geolocation=(self) - the wxUseLocation button calls
  // navigator.geolocation on OUR page; the old blanket () blocked it in
  // every browser and the button could only ever error.
  'Permissions-Policy': 'camera=(), microphone=(self), geolocation=(self), payment=(), usb=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  'Cross-Origin-Resource-Policy': 'same-origin'
};

// SEO-FILES: robots.txt and sitemap.xml live as real files at the repo root.
const SEO_FILES = {
  '/robots.txt': 'text/plain; charset=utf-8',
  '/sitemap.xml': 'application/xml; charset=utf-8'
};

// WHISPER-CSP: only the vendored whisper runtime gets the relaxed policy.
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

// PADDLE-CSP: only pricing.html (Paddle's default payment link) gets the
// origins Paddle's checkout overlay needs. Everything else keeps the strict
// policy above - notably script-src stays HASH-ONLY with no 'unsafe-inline'.
//
// Why a scoped policy rather than loosening the global one: the overlay is
// third-party code on exactly one page, and the hash allowlist is the app's
// XSS gate. Widening it site-wide would trade a security control for a
// convenience on pages that never run Paddle.
//
// Probe-verified (tools/qa-paddle-csp.cjs), 3 origins and no more:
//   style-src  + https://cdn.paddle.com   -> paddle.css (overlay styling;
//                                            without it checkout renders unstyled)
//   frame-src  + https://buy.paddle.com   -> THIS IS THE REAL BLOCKER. The
//                                            overlay iframe is buy.paddle.com,
//                                            which was NOT in frame-src, so
//                                            checkout could never render.
//   frame-ancestors 'self' instead of 'none' -> 'none' also vetoed the
//                                            overlay iframe, since frame-ancestors
//                                            is inherited by the framed document.
// X-Frame-Options: DENY is deliberately LEFT ALONE - it constrains who may
// frame US and does not affect the outbound overlay (probe-verified: overlay
// loads fine under DENY).
//
// public.profitwell.com is intentionally NOT allowed. Paddle requests it for
// revenue analytics; it is not required for checkout, so it stays blocked.
const PADDLE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' https://accounts.google.com https://apis.google.com%%ANALYTICS%% https://challenges.cloudflare.com https://cdn.paddle.com " +
    INLINE_SCRIPT_HASHES,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com https://cdn.paddle.com",
  "img-src 'self' data: blob: https://lh3.googleusercontent.com https://*.googleusercontent.com",
  "media-src 'self' data: blob:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' https: https://accounts.google.com https://oauth2.googleapis.com blob:",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  'frame-src https://buy.paddle.com https://sandbox-buy.paddle.com https://checkout.paddle.com https://cdn.paddle.com https://accounts.google.com https://challenges.cloudflare.com',
  "frame-ancestors 'self'"
].join('; ');

// 8.3 (2026-10-06): extension-less paths that are NOT real pages must answer
// a real 404. wrangler's assets SPA fallback (not_found_handling:
// single-page-application) answered 200 with index.html for ANY unknown
// path, so a typo looked like a working page and crawlers indexed junk.
// These are the served page paths, extension-less (wrangler maps /pricing to
// pricing.html by itself). /team/ is exempt because the RBAC invite link
// (/team/accept/<token>) is a real app route awaiting its UI.
const PAGE_ROUTES = new Set([
  '/',
  '/index',
  '/about',
  '/admin',
  '/app',
  '/calculator',
  '/contact',
  '/dashboard',
  '/features',
  '/mymanager-field-guide',
  '/pricing',
  '/privacy',
  '/project',
  '/refund',
  '/reset',
  '/reviews',
  '/seed-test',
  '/signin',
  '/terms',
  '/verify'
]);

function notFoundPage() {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Page not found | My MaNaGeR</title>' +
    '<style>html{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}' +
    'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F5EFE6;color:#1C1917}' +
    'main{max-width:34rem;padding:2.5rem;text-align:center}' +
    'h1{font-size:1.5rem;margin:0 0 .5rem}p{color:#57606a;line-height:1.6;margin:0 0 1.25rem}' +
    'a{color:#B45309;font-weight:600}</style></head>' +
    '<body><main><h1>Page not found</h1>' +
    '<p>The page you asked for is not here. It may have moved, or the address may have a typo.</p>' +
    '<p><a href="/">Go to the home page</a></p></main></body></html>'
  );
}

// 8.4: 404 shape shared by the private-path guards (maps + backend sources).
function privateNotFound() {
  return new Response('Not Found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

// 8.4: paths that are build/deploy/dev internals, never runtime assets.
// Prefixes cover the whole trees; DENY_FILES covers the root-level files whose
// names do not reveal what they are; the root-level extension rule catches
// stray docs and config that get added later without anyone updating a list.
const PRIVATE_PREFIXES = [
  '/src/',
  '/test/',
  '/tools/',
  '/mcp/',
  '/docs/',
  '/migrations/',
  '/node_modules/',
  '/.github/',
  '/.githooks/',
  '/_archive/',
  // VCS and tool state. test/private-paths.test.mjs caught /.git/ missing from
  // this list, which is exactly what the test is for.
  '/.git/',
  '/.wrangler/',
  '/.freebuff/',
  '/tmp/',
  '/dogfood-output/'
];
const PRIVATE_FILES = new Set([
  '/worker.js',
  '/build.js',
  '/serve.cjs',
  '/package.json',
  '/package-lock.json',
  '/wrangler.jsonc',
  '/wrangler.ci.jsonc',
  '/eslint.config.js',
  '/skills-lock.json',
  '/CODEOWNERS',
  '/.dev.vars',
  '/.dev.vars.example',
  '/.gitleaks.toml',
  '/.gitleaksignore',
  '/.gitattributes',
  '/.gitignore',
  '/.assetsignore',
  '/.prettierrc.json',
  '/.prettierignore',
  '/.npmrc',
  '/.nvmrc'
]);
// Root-level only: a single-segment path carrying a file extension that is
// never a runtime asset. Nested paths are left alone so real assets such as
// /dist/*.json are never caught by accident.
const PRIVATE_ROOT_EXT = /\.(md|txt|json|jsonc|ya?ml|lock|cjs|mjs|ts|pdf)$/i;
// The two root text files that ARE meant to be public. They are already served
// by the SEO_FILES branch ABOVE this guard; listing them here too keeps the
// predicate correct on its own, so it cannot 404 them if that branch ever
// moves or changes order.
const PUBLIC_ROOT_FILES = new Set(['/robots.txt', '/sitemap.xml']);

// Exported for test/private-paths.test.mjs - the list is only worth having if
// something proves the real assets still pass through it.
export function isPrivatePath(normalized) {
  if (PUBLIC_ROOT_FILES.has(normalized)) {
    return false;
  }
  for (const prefix of PRIVATE_PREFIXES) {
    if (normalized.indexOf(prefix) === 0) {
      return true;
    }
  }
  if (PRIVATE_FILES.has(normalized)) {
    return true;
  }
  const segs = normalized.split('/').filter(Boolean);
  return segs.length === 1 && PRIVATE_ROOT_EXT.test(segs[0]);
}

// Collapse '.'/'..' path segments so traversal can never fool the
// whisper-path check.
function normalizePathname(p) {
  const out = [];
  const segs = String(p).split('/');
  for (const seg of segs) {
    if (seg === '.' || seg === '') {
      continue;
    }
    if (seg === '..') {
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return '/' + out.join('/');
}

export default {
  // A5-2: daily orphan-purge sweep + webhook evaluation + auth session sweep.
  async scheduled(event, env) {
    try {
      const result = await purgeStaleCloudProjects(env);
      console.log(
        'cloud orphan purge: checked=' + result.checked + ' purged=' + result.purged.length
      );
    } catch (e) {
      console.error('cloud orphan purge failed:', e && e.message);
    }
    try {
      const w = await evaluateWebhooks(env);
      console.log('rank9 webhooks: checked=' + w.checked + ' fired=' + w.fired.length);
    } catch (e) {
      console.error('rank9 webhook evaluation failed:', e && e.message);
    }
    try {
      const s7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const s1 = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const sessSweep = await env.DB.prepare(
        'DELETE FROM auth_sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)'
      )
        .bind(s7, s7)
        .run();
      const guardSweep = await env.DB.prepare(
        'DELETE FROM auth_login_guard WHERE locked_until IS NOT NULL AND locked_until < ?'
      )
        .bind(s1)
        .run();
      const tokenSweep = await env.DB.prepare(
        'DELETE FROM auth_tokens WHERE expires_at < ? OR (used_at IS NOT NULL AND used_at < ?) OR (revoked_at IS NOT NULL AND revoked_at < ?)'
      )
        .bind(s7, s7, s7)
        .run();
      // AREA G2: expired or long-consumed admin-recovery OTP rows (mirrors auth_tokens).
      let otpSweep = { meta: { changes: 0 } };
      try {
        otpSweep = await env.DB.prepare(
          'DELETE FROM admin_recovery_otp WHERE expires_at < ? OR (used_at IS NOT NULL AND used_at < ?)'
        )
          .bind(s7, s7)
          .run();
      } catch (e) {
        /* table may not exist yet (pre-migration) */
      }
      // G-2 (2026-10-23): expired sign-in nonce rows (migration 0027).
      // Nonces expire in 5 minutes and are single-use, so anything past its
      // expiry is dead weight; the daily sweep bounds the table.
      let nonceSweep = { meta: { changes: 0 } };
      try {
        nonceSweep = await env.DB.prepare('DELETE FROM auth_nonces WHERE expires_at < ?')
          .bind(s7)
          .run();
      } catch (e) {
        /* table may not exist yet (pre-migration) */
      }
      console.log(
        'auth sweep: sessions=' +
          ((sessSweep.meta && sessSweep.meta.changes) || 0) +
          ' guards=' +
          ((guardSweep.meta && guardSweep.meta.changes) || 0) +
          ' tokens=' +
          ((tokenSweep.meta && tokenSweep.meta.changes) || 0) +
          ' otp=' +
          ((otpSweep.meta && otpSweep.meta.changes) || 0) +
          ' nonces=' +
          ((nonceSweep.meta && nonceSweep.meta.changes) || 0)
      );
    } catch (e) {
      console.error('auth sweep failed:', e && e.message);
    }
    // IDEMPOTENCY SWEEP: clean up expired idempotency keys.
    try {
      const idemSweep = await env.DB.prepare('DELETE FROM idempotency_keys WHERE expires_at < ?')
        .bind(new Date().toISOString())
        .run();
      console.log(
        'idempotency sweep: deleted=' + ((idemSweep.meta && idemSweep.meta.changes) || 0)
      );
    } catch (e) {
      // Table may not exist yet (pre-migration) — that's fine.
    }
  },

  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const normalized = normalizePathname(url.pathname);

      // API routes run BEFORE the ASSETS binding.
      if (normalized.indexOf('/api/') === 0) {
        return routeApi(request, env, url);
      }

      // SEO-FILES: robots.txt/sitemap.xml with pinned Content-Type.
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

      // 8.2: source maps are build artifacts and must never be public.
      if (/\.map$/.test(normalized)) {
        return privateNotFound();
      }

      // 8.4 (2026-10-15): backend + dev tooling must never be public. The
      // assets directory is '.' (wrangler.jsonc), so EVERY repo file is
      // uploaded unless excluded - and it was verified live that the whole
      // server source tree was downloadable: /worker.js, /src/router.js,
      // /src/lib/http.js, /src/auth/session.js, /src/billing.js, /src/ai-proxy.js,
      // /src/cloud/projects.js, /mcp/server.mjs, /package.json, /wrangler.jsonc,
      // /build.js, /eslint.config.js, /test/*.mjs, /skills-lock.json,
      // /.dev.vars.example. No secret VALUES leak (those are Wrangler secrets),
      // but the lockout ladder, rate-limit config, R2 key derivation and the
      // full route map do - and it cannot be un-published.
      //
      // WHY A GUARD AND NOT JUST assets.exclude: exclude is not reliable on its
      // own here - live /robots.txt is served WITH a real text/plain body
      // although 'robots.txt' is already listed in that exclude array. So the
      // exclude list stays as the belt (it also keeps the upload small) and
      // this guard is the braces, which is provable locally.
      // robots.txt / sitemap.xml are unaffected: SEO_FILES is handled above.
      if (isPrivatePath(normalized)) {
        return privateNotFound();
      }

      // 8.3: a real 404 for unknown, extension-less paths (never the SPA
      // fallback). Paths with a file extension are left to the asset layer,
      // which already answers 404 for a genuinely missing asset.
      const lastSeg = normalized.slice(normalized.lastIndexOf('/') + 1);
      if (
        lastSeg.indexOf('.') === -1 &&
        normalized.indexOf('/team/') !== 0 &&
        !PAGE_ROUTES.has(normalized)
      ) {
        const headers = Object.assign(
          { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
          HEADERS
        );
        headers['Content-Security-Policy'] = cspFor(request, normalized, true);
        return new Response(notFoundPage(), { status: 404, headers: headers });
      }

      const response = await env.ASSETS.fetch(request);
      // 8.5 (RB-1, 2026-10-25): A SCRIPT URL IS NEVER ANSWERED WITH A PAGE.
      // not_found_handling is single-page-application, so a missing asset is
      // served index.html with 200. That is right for a person mistyping a
      // page URL and wrong for a script: the browser executes the homepage as
      // JavaScript (a silent syntax error), and a RETIRED data file would keep
      // answering 200 to anyone who asks for it by name. This is exactly the
      // shape RB-1 left behind - js/jic-rates-full.js is now signed-in data -
      // so the old URL must fail loudly instead of returning a page. Anchored
      // to the extensions a page can never carry.
      const reqExt = normalized.replace(/.*\./, '').toLowerCase();
      if (
        ['js', 'mjs', 'css', 'json', 'map', 'webmanifest', 'wasm'].indexOf(reqExt) !== -1 &&
        (response.headers.get('Content-Type') || '').toLowerCase().indexOf('text/html') === 0
      ) {
        return privateNotFound();
      }
      const decorated = new Response(response.body, response);
      for (const [name, value] of Object.entries(HEADERS)) {
        decorated.headers.set(name, value);
      }
      // What kind of response is this? The extensionless routing answers
      // /index.html and /project.html with a 307 that carries no
      // Content-Type at all, and a 304 carries none either - so the
      // CONTENT TYPE alone cannot say "this is a document". The PATH says
      // it: the page routes and the .html files are the documents, and
      // they are documents whatever status the response carries.
      //
      // Both halves matter. A 304 has no body, so its Content-Type is
      // absent - and the browser MERGES a 304's headers into the copy it
      // already stored. A document judged only by its content type would
      // therefore be handed a policy without the host the moment it
      // revalidated, and a consented visitor would silently stop counting.
      const contentType = (response.headers.get('Content-Type') || '').toLowerCase();
      const isHtml = contentType.indexOf('text/html') === 0;
      const isPagePath =
        normalized === '/' || /\.html$/i.test(normalized) || PAGE_ROUTES.has(normalized);
      const isDocument = isHtml || isPagePath;
      // Per-request CSP: the analytics host rides along only for a visitor
      // whose consent cookie allows it (S-2). This also carries the pricing
      // scoped policy, so the separate pricing override below is gone.
      //
      // The host goes into DOCUMENTS only. A browser enforces the policy of
      // the response it finally renders, so an asset's policy is inert.
      // Keeping the host out of every other response means no cacheable
      // response (a script with an hour-long TTL) ever holds a header that
      // depends on one visitor's choice.
      decorated.headers.set('Content-Security-Policy', cspFor(request, normalized, isDocument));

      // Cache-Control strategy
      //
      // S-2 (audit 2026-10-18, 8.2) - A DOCUMENT IS NEVER SERVED FROM A
      // CACHE THAT CAN OUTLIVE THE REQUEST THAT PRODUCED IT. The
      // Content-Security-Policy set just above is PER REQUEST: the analytics
      // host rides along in it only for a visitor whose consent cookie
      // allows it. A response a cache may reuse across consent states hands
      // one visitor another visitor's decision.
      //
      // MEASURED LIVE 2026-10-21, one layer below the server gate: the
      // extensionless page routes (/project, /app, /dashboard, ...) fell
      // through to the short TTL below, so the browser kept the copy it had
      // cached WHILE THE CHOICE WAS CURRENT and replayed its
      // Content-Security-Policy - with the analytics host in it - after the
      // choice had aged out. The beacon ran under a stale choice even
      // though the server refused the stale cookie, because the browser
      // never asked the server again. Pages therefore revalidate on every
      // visit ('no-cache'), exactly as the .html pages already did.
      //
      // Static assets keep the TTL they have always had: a script's policy
      // comes from the document that loads it, so the per-request CSP on an
      // asset never reaches a visitor. (The `ext` test below is the
      // long-standing one; it is left exactly as it is - changing the asset
      // TTL is a separate decision, not part of the consent gate.)
      //
      // The document test is the PATH (see above), so the .html files and
      // the extensionless page routes are both in the set - including the
      // 307 redirect the extensionless routing answers /project.html with,
      // which carries no Content-Type of its own.
      const ext = normalized.replace(/.*\\./, '').toLowerCase();
      const IMMUTABLE = 'public, max-age=31536000, immutable';
      const NO_CACHE = 'no-cache';
      const SHORT_TTL = 'public, max-age=3600';
      if (isDocument) {
        decorated.headers.set('Cache-Control', NO_CACHE);
      } else if (
        ['js', 'css', 'svg', 'png', 'ico', 'webp', 'woff', 'woff2', 'ttf', 'otf'].indexOf(ext) !==
        -1
      ) {
        decorated.headers.set('Cache-Control', IMMUTABLE);
      } else if (ext === 'json' || ext === 'webmanifest') {
        decorated.headers.set('Cache-Control', NO_CACHE);
      } else {
        decorated.headers.set('Cache-Control', SHORT_TTL);
      }

      // Scoped CSP for whisper runtime
      if (normalized.indexOf('/vendor/whisper/') === 0) {
        decorated.headers.set('Content-Security-Policy', WHISPER_CSP);
      }

      // (pricing.html's scoped Paddle CSP is handled inside cspFor above.)

      return decorated;
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: 'not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};
