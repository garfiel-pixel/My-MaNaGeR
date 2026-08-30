import { routeApi } from './src/router.js';
import { Presence } from './src/cloud/presence.js';
import { purgeStaleCloudProjects } from './src/cloud/projects.js';
import { evaluateWebhooks } from './src/webhooks.js';

export { Presence };  // wrangler requires DO classes in the entrypoint

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
  "'sha256-zUtIgMoGZXbdKSIgoC/fhYlGEPJluAGG4nNBJOwnNWU='",
  "'sha256-reza4vd5o52LWNUf9lzK6WjApdstd5sm4xVx+lcnK2M='",
  "'sha256-DDYVqby/7w6QiwGTikwlcwwnf1qHWgEmMUmSvXmqy7E='",
  "'sha256-jQGKXr3EKUJqelsBjB7GNSArKx9pbp38QHCOFoVCB3g='",
  "'sha256-V17jc57FVLihwVclv0KysBB8hWAaQToQbR/SXHJtzEo='",
  "'sha256-PcY9TdIJsXGVPic0Qujx0Ov+GCt9gZG0hEtBVRDiLiM='",
  "'sha256-YCro8lbLi7sxkyRUO/k3RRsBdaIELQhDpVbA2FIpQHY='",
  "'sha256-QCztVRfNHrv06dqaIU0ieu69+y/LLL/0IzXpSxTrGBk='",
  "'sha256-mKjC/XtpqhUGoL8mk27AfI+ZUAamESA089+ia8dbRiI='",
  "'sha256-8rpgpTSjx7LcpleTm7RwTJ+pzjvndpRVDPiapb2gNo8='",
  "'sha256-O9lvE/vAuiMHUX3RQGR53K5h6w13/d2P16BoUBsYKAk='",
  "'sha256-/cWZx9YWLn6M4LL3W0jiHWFh8Q4HE6BXDo2d8LPBiik='",
  "'sha256-Oa7ON+9A164SSXhnxu08mFn0V9Tj2SlZ2SzFXFoqKNE='",
  "'sha256-bNdw0+64xL2//htoz+u3InKWYZNEHO/CnuZqtcJIBgU='",
  "'sha256-7cQZf8bzyvMY1EwebBo5YuL3PZ9T/X5CTWFRXO3Aq5E='",
  "'sha256-c2U+m5SzyupzeOrPEiOjlnaSgS1KdAxZTFnYA5dW/Rk='",
  "'sha256-Is0jD76ptemzKTfgnVGlSCSEHBJeveC1gRTl/Wv4JBw='"
].join(' ');

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' https://unpkg.com https://accounts.google.com https://apis.google.com " + INLINE_SCRIPT_HASHES,
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

// Collapse '.'/'..' path segments so traversal can never fool the
// whisper-path check.
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

export default {
  // A5-2: daily orphan-purge sweep + webhook evaluation + auth session sweep.
  async scheduled(event, env) {
    try {
      const result = await purgeStaleCloudProjects(env);
      console.log('cloud orphan purge: checked=' + result.checked + ' purged=' + result.purged.length);
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
    // IDEMPOTENCY SWEEP: clean up expired idempotency keys.
    try {
      const idemSweep = await env.DB.prepare('DELETE FROM idempotency_keys WHERE expires_at < ?')
        .bind(new Date().toISOString()).run();
      console.log('idempotency sweep: deleted=' + ((idemSweep.meta && idemSweep.meta.changes) || 0));
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

      const response = await env.ASSETS.fetch(request);
      const decorated = new Response(response.body, response);
      for (const [name, value] of Object.entries(HEADERS)) {
        decorated.headers.set(name, value);
      }

      // Cache-Control strategy
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

      // Scoped CSP for whisper runtime
      if (normalized.indexOf('/vendor/whisper/') === 0) {
        decorated.headers.set('Content-Security-Policy', WHISPER_CSP);
      }

      return decorated;
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: 'not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};
