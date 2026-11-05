/* ============================================================
   SEC-06 - CSP violation report sink
   ------------------------------------------------------------
   The tightened connect-src ships in REPORT-ONLY first, so something has to
   receive the reports. This is that something, and it is deliberately the
   smallest route on the Worker:

     - no auth (a browser posts these anonymously, and a report is not data)
     - rate-limited on its own `csp` bucket, so a page stuck in a report loop
       cannot become a cost problem
     - body-capped at 16 KiB and parsed through the shared reader, so an
       oversized or malformed body costs one bounded read and nothing else
     - answers 204 with NO body: the browser ignores the response, and an
       empty body cannot echo an attacker-controlled URI back into a log line
       or a cached response
     - every string is truncated and the whole payload goes through
       structuredLog, which already redacts sensitive keys

   Both report shapes are understood: the legacy `{"csp-report": {...}}`
   envelope (report-uri) and the Reporting API array
   `[{ type, body: {...} }]` (report-to), so the sink keeps working when the
   header moves to the modern mechanism.
   ============================================================ */
import { readJsonBody, cloudRateCheck, cloudRateLimited } from './lib/http.js';
import { structuredLog } from './lib/observe.js';

const CSP_REPORT_LIMIT = 16384;
const MAX_FIELD = 300;

function short(v) {
  const s = typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v);
  return s.length > MAX_FIELD ? s.slice(0, MAX_FIELD) : s;
}

function noContent() {
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

function reportFrom(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  // Reporting API: { type, body: {...} }
  if (entry.body && typeof entry.body === 'object') {
    return {
      directive: short(entry.body.effectiveDirective || entry.body.violatedDirective),
      blocked: short(entry.body.blockedURL),
      document: short(entry.body.documentURL),
      disposition: short(entry.body.disposition)
    };
  }
  return null;
}

function reportFromLegacy(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  return {
    directive: short(entry['effective-directive'] || entry['violated-directive']),
    blocked: short(entry['blocked-uri']),
    document: short(entry['document-uri']),
    disposition: short(entry.disposition)
  };
}

export async function handleCspReport(request, env) {
  const rl = await cloudRateCheck(request, 'csp', env);
  if (rl.limited) {
    return cloudRateLimited(rl.retryAfter);
  }
  const read = await readJsonBody(request, CSP_REPORT_LIMIT);
  if (read.tooLarge) {
    return new Response(null, { status: 413, headers: { 'Cache-Control': 'no-store' } });
  }
  if (read.bad || !read.body) {
    // A malformed report is still a report; the browser only cares that the
    // request completed. Never answer with an error the page could surface.
    return noContent();
  }
  const payload = read.body;
  const entries = Array.isArray(payload) ? payload.slice(0, 5) : [payload];
  for (let i = 0; i < entries.length; i++) {
    const item = entries[i];
    const report = reportFrom(item) || reportFromLegacy(item['csp-report'] || item);
    if (!report) {
      continue;
    }
    structuredLog(env, 'warn', 'csp-violation', {
      directive: report.directive,
      blocked: report.blocked,
      document: report.document,
      disposition: report.disposition,
      ua: short(request.headers.get('User-Agent'))
    });
  }
  return noContent();
}
