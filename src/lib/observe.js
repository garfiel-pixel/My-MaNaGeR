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
 * S-3 (audit 2026-10-18): NOTHING that identifies a person or a
 * credential belongs in a log line. A log tail is kept, exported and
 * read by people who are not the account owner, and a log line is
 * very hard to take back once written.
 *
 * This is the LAST line of defence, not the first. A caller that logs
 * a request header is still a bug; but if one ever does, the secret
 * must not survive the trip into the log tail.
 *
 * Two rules:
 *   1. A KEY that names a secret loses its value. The key stays (so
 *      the shape of the event is still readable), the value becomes
 *      '[redacted]'.
 *   2. A VALUE that LOOKS like a secret is replaced even when the
 *      key is innocent - a whole Cookie header pasted into a
 *      'headers' field carries the session cookie just as well.
 */
const REDACTED = '[redacted]';

// A key that names a credential. Matched loosely on purpose: the
// cost of a false positive is a redacted field, the cost of a false
// negative is a live secret in a log line.
const SENSITIVE_KEY =
  /(^|[^a-z])(authorization|auth[-_]?header|cookie|set[-_]?cookie|id[-_]?token|access[-_]?token|refresh[-_]?token|session[-_]?token|mmgr[-_]?session|session[-_]?id|api[-_]?key|apikey|secret|password|passwd|passphrase|credential|bearer|private[-_]?key)([^a-z]|$)/i;

// A value that looks like a live secret, whatever the key is called.
function redactString(s) {
  let out = String(s);
  // 'Bearer <token>' keeps the scheme word and loses the token.
  out = out.replace(
    /\b(bearer|basic)(\s+)[A-Za-z0-9._~+/-]{8,}=*/gi,
    (m, scheme) => scheme + ' ' + REDACTED
  );
  // A JSON Web Token (three base64url segments) - the whole thing goes.
  out = out.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, REDACTED);
  // Common provider key shapes.
  out = out.replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, REDACTED);
  out = out.replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, REDACTED);
  out = out.replace(/\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, REDACTED);
  // A cookie pair, wherever it is pasted: 'mmgr_session=<value>'.
  out = out.replace(
    /([A-Za-z0-9_-]*(?:session|token|key|secret)[A-Za-z0-9_-]*)=([^;\s"']+)/gi,
    (m, name) => name + '=' + REDACTED
  );
  return out;
}

/**
 * Return a copy of `value` with every credential removed. Objects and
 * arrays are walked; strings are scanned for secret shapes; anything
 * else is returned as it is.
 */
export function redactSensitive(value, depth = 0) {
  if (depth > 6) {
    return '[deep]';
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'string') {
    return redactString(value);
  }
  if (typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(v => redactSensitive(v, depth + 1));
  }
  const out = {};
  for (const key of Object.keys(value)) {
    if (SENSITIVE_KEY.test(key)) {
      out[key] = REDACTED;
      continue;
    }
    out[key] = redactSensitive(value[key], depth + 1);
  }
  return out;
}

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
  // The payload is scrubbed BEFORE it becomes a line. The fixed fields
  // (ts, level, event) are written last so a payload key can never
  // take them over.
  const safe = redactSensitive(data || {});
  const entry = { ts: new Date().toISOString(), level: level, event: event };
  for (const key of Object.keys(safe)) {
    if (key === 'ts' || key === 'level' || key === 'event') {
      continue;
    }
    entry[key] = safe[key];
  }

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
 * W6 (owner 2026-10-15): does this caller ask not to be tracked?
 *
 * Two headers, both set by the browser itself on every request, so no
 * client code and no cookie are involved:
 *   Sec-GPC: 1  - Global Privacy Control (the modern one, backed by law
 *                 in California and the EU)
 *   DNT: 1      - Do Not Track (legacy, still sent by many browsers)
 *
 * privacy.html section 7 promises that a detected signal suppresses the
 * optional analytics telemetry. Before this function that promise was
 * FALSE - the Analytics Engine binding has been live since 2026-08-25 and
 * nothing read either header. A privacy policy that claims a suppression
 * the code does not perform is the worst kind of lie to ship, so the
 * promise is now implemented in the one place that writes data points.
 *
 * Deliberately narrow: it suppresses ANALYTICS writes only. Structured
 * server logs (structuredLog) are operational - they are how a 500 gets
 * diagnosed - and are not shared with any third party.
 */
export function privacySignalRequested(request) {
  const headers = request && request.headers;
  if (!headers || typeof headers.get !== 'function') {
    return false;
  }
  const gpc = String(headers.get('Sec-GPC') || '')
    .trim()
    .toLowerCase();
  if (gpc === '1' || gpc === 'true') {
    return true;
  }
  return String(headers.get('DNT') || '').trim() === '1';
}

/**
 * Track an error event for observability. Logs the error with
 * structured context and optionally writes to Analytics Engine.
 *
 * @param {object} env - Worker env
 * @param {string} event - Event name
 * @param {Error|any} error - The error object
 * @param {object} context - Additional context
 * @param {Request} [request] - The triggering request; when it carries
 *   DNT or Sec-GPC the Analytics Engine write is skipped (the structured
 *   log still runs, so the error remains diagnosable).
 */
export function trackError(env, event, error, context = {}, request = null) {
  const message = error && error.message ? error.message : String(error);
  structuredLog(env, 'error', event, {
    ...context,
    message: message,
    stack: error && error.stack ? error.stack.split('\n').slice(0, 3).join(' | ') : undefined
  });

  // Also fire to Analytics Engine if available - unless the caller asked
  // not to be tracked (W6). The blobs are scrubbed too: an error
  // message can carry a URL with a key in it.
  if (env && env.ANALYTICS && !privacySignalRequested(request)) {
    try {
      env.ANALYTICS.writeDataPoint({
        indexes: ['error', event],
        blobs: [
          redactString(message),
          JSON.stringify(redactSensitive(context)).slice(0, 512),
          new Date().toISOString()
        ]
      });
    } catch (e) {
      /* telemetry must never block */
    }
  }
}

/**
 * Track a success/info event for observability.
 * Same DNT/GPC rule as trackError: the structured log always runs, the
 * Analytics Engine write is skipped when the caller asked not to be
 * tracked (W6).
 */
export function trackEvent(env, event, context = {}, request = null) {
  structuredLog(env, 'info', event, context);

  if (env && env.ANALYTICS && !privacySignalRequested(request)) {
    try {
      env.ANALYTICS.writeDataPoint({
        indexes: ['info', event],
        blobs: [
          JSON.stringify(redactSensitive(context)).slice(0, 512),
          '',
          new Date().toISOString()
        ]
      });
    } catch (e) {
      /* telemetry must never block */
    }
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
  if (!key) {
    return null;
  } // No key provided — proceed normally

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
    } catch (e) {
      /* KV failure — fall through to D1 or skip */
    }
  }

  // Try D1 (persistent across isolate restarts)
  if (env && env.DB) {
    try {
      const row = await env.DB.prepare(
        'SELECT response_body, response_status FROM idempotency_keys WHERE cache_key = ? AND expires_at > ?'
      )
        .bind(cacheKey, new Date().toISOString())
        .first();
      if (row) {
        return new Response(row.response_body, {
          status: row.response_status,
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Idempotent': 'true' }
        });
      }
    } catch (e) {
      // Table might not exist yet — that's fine, skip idempotency
      if (e && e.message && e.message.indexOf('no such table') !== -1) {
        return null;
      }
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
        await env.KV.put(cacheKey, JSON.stringify({ body, status: response.status }), {
          expirationTtl: ttl
        });
      }

      // Also try D1 (belt-and-suspenders)
      if (env && env.DB) {
        try {
          await env.DB.prepare(
            'INSERT OR REPLACE INTO idempotency_keys (cache_key, response_body, response_status, created_at, expires_at) VALUES (?,?,?,?,?)'
          )
            .bind(cacheKey, body, response.status, new Date().toISOString(), expiresAt)
            .run();
        } catch (e) {
          // Table might not exist — fine, KV has it
          if (e && e.message && e.message.indexOf('no such table') !== -1) {
            /* skip */
          }
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
