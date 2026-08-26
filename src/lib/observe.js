/* ============================================================
   OBSERVABILITY — structured logging, idempotency keys,
   and error-rate tracking
   ------------------------------------------------------------
   Two things every handler needs:
     1. Structured JSON logging — one consistent log shape across
        every handler so errors are machine-parseable and the
        Worker's log tail becomes a real debugging tool.
     2. Idempotency keys — accept an optional Idempotency-Key
        header on write endpoints, store recently-seen keys with
        a short TTL in D1 or KV, short-circuit a repeat. This is
        the single most common gap between "well-built backend"
        and "backend that's survived real production traffic spikes."

   Usage:
     import { structuredLog, withIdempotency, trackError } from './observe.js';

     // Structured log
     structuredLog(env, 'info', 'cloud-save', { projectId, bytes: stateLen });

     // Idempotent write
     const idemResult = await withIdempotency(request, env, async () => {
       // ... do the actual write ...
       return response;
     });
     if (idemResult) return idemResult;  // cached response

     // Error tracking
     trackError(env, 'cloud-save', error, { projectId });
   ============================================================ */

/* ============================================================
   STRUCTURED LOGGING
   ============================================================ */

/**
 * Write a structured JSON log entry. In production on Cloudflare
 * Workers, console.log/error output appears in the Worker's log
 * tail. This standardizes the shape so every entry is parseable.
 *
 * @param {object} env - Worker env (unused for now, future: KV/D1 log sink)
 * @param {string} level - 'info', 'warn', 'error', 'debug'
 * @param {string} event - Event name (e.g. 'cloud-save', 'auth-login')
 * @param {object} data - Additional context data
 */
export function structuredLog(env, level, event, data = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level: level,
    event: event,
    ...data
  };

  const msg = JSON.stringify(entry);
  switch (level) {
    case 'error':
      console.error(msg);
      break;
    case 'warn':
      console.warn(msg);
      break;
    default:
      console.log(msg);
  }
}

/**
 * Track an error event for observability. Logs the error with
 * structured context and optionally writes to Analytics Engine.
 *
 * @param {object} env - Worker env
 * @param {string} event - Event name
 * @param {Error|any} error - The error object
 * @param {object} context - Additional context
 */
export function trackError(env, event, error, context = {}) {
  structuredLog(env, 'error', event, {
    ...context,
    message: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack.split('\n').slice(0, 3).join(' | ') : undefined
  });

  // Also fire to Analytics Engine if available
  if (env && env.ANALYTICS) {
    try {
      env.ANALYTICS.writeDataPoint({
        indexes: ['error', event],
        blobs: [error && error.message ? error.message : 'unknown', JSON.stringify(context).slice(0, 512), new Date().toISOString()]
      });
    } catch (e) { /* telemetry must never block */ }
  }
}

/**
 * Track a success/info event for observability.
 */
export function trackEvent(env, event, context = {}) {
  structuredLog(env, 'info', event, context);

  if (env && env.ANALYTICS) {
    try {
      env.ANALYTICS.writeDataPoint({
        indexes: ['info', event],
        blobs: [JSON.stringify(context).slice(0, 512), '', new Date().toISOString()]
      });
    } catch (e) { /* telemetry must never block */ }
  }
}

/* ============================================================
   IDEMPOTENCY KEYS
   ============================================================ */

// Default TTL for idempotency keys: 5 minutes (300 seconds).
// This covers network blips and double-clicks without storing
// keys long enough to cause D1/KV bloat.
const IDEMPOTENCY_TTL_SECONDS = 300;

/**
 * Wrap a write handler with idempotency key support.
 * Accepts an optional `Idempotency-Key` header. If the key has been
 * seen within the TTL window, returns the cached response. Otherwise,
 * executes the handler, stores the key+response, and returns it.
 *
 * Uses KV when available (fast, distributed), falls back to D1.
 * If neither is available (local dev without bindings), skips
 * idempotency entirely (the handler runs every time).
 *
 * @param {Request} request - The incoming request
 * @param {object} env - Worker env (needs KV or DB)
 * @param {function} handler - The actual write handler (async)
 * @param {object} opts - { ttlSeconds, bucket }
 * @returns {Response|null} - Cached response if idempotent hit, null to proceed
 */
export async function withIdempotency(request, env, handler, opts = {}) {
  const key = request.headers.get('Idempotency-Key');
  if (!key) return null; // No key provided — proceed normally

  const ttl = opts.ttlSeconds || IDEMPOTENCY_TTL_SECONDS;
  const bucket = opts.bucket || 'idem';
  const cacheKey = bucket + ':' + key;

  // Try KV first (faster, distributed across isolates)
  if (env && env.KV) {
    try {
      const cached = await env.KV.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        return new Response(parsed.body, {
          status: parsed.status,
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Idempotent': 'true' }
        });
      }
    } catch (e) { /* KV failure — fall through to D1 or skip */ }
  }

  // Try D1 (persistent across isolate restarts)
  if (env && env.DB) {
    try {
      const row = await env.DB.prepare(
        'SELECT response_body, response_status FROM idempotency_keys WHERE cache_key = ? AND expires_at > ?'
      ).bind(cacheKey, new Date().toISOString()).first();
      if (row) {
        return new Response(row.response_body, {
          status: row.response_status,
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Idempotent': 'true' }
        });
      }
    } catch (e) {
      // Table might not exist yet — that's fine, skip idempotency
      if (e && e.message && e.message.indexOf('no such table') !== -1) return null;
    }
  }

  // No cached response — execute the handler
  const response = await handler();

  // Store the response for future idempotent requests
  if (response && response.status >= 200 && response.status < 300) {
    try {
      const body = await response.text();
      const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

      // Try KV first
      if (env && env.KV) {
        await env.KV.put(cacheKey, JSON.stringify({ body, status: response.status }), { expirationTtl: ttl });
      }

      // Also try D1 (belt-and-suspenders)
      if (env && env.DB) {
        try {
          await env.DB.prepare(
            'INSERT OR REPLACE INTO idempotency_keys (cache_key, response_body, response_status, created_at, expires_at) VALUES (?,?,?,?,?)'
          ).bind(cacheKey, body, response.status, new Date().toISOString(), expiresAt).run();
        } catch (e) {
          // Table might not exist — fine, KV has it
          if (e && e.message && e.message.indexOf('no such table') !== -1) { /* skip */ }
        }
      }

      // Return a new Response (the original was consumed by .text())
      return new Response(body, {
        status: response.status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    } catch (e) {
      // Response body consumed but storage failed — return original
      return response;
    }
  }

  return response;
}

/* ============================================================
   RATE-LIMIT OBSERVABILITY
   ============================================================ */

/**
 * Wrap cloudRateCheck to add structured logging on rate-limit hits.
 * This makes rate-limit events visible in the log tail for tuning.
 */
export async function observedRateCheck(request, bucket, env) {
  const { cloudRateCheck, cloudRateLimited } = await import('./http.js');
  const result = await cloudRateCheck(request, bucket, env);
  if (result.limited) {
    structuredLog(env, 'warn', 'rate-limited', {
      bucket: bucket,
      retryAfter: result.retryAfter,
      ip: request.headers.get('CF-Connecting-IP') || 'unknown'
    });
  }
  return result;
}
