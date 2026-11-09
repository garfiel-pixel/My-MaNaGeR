/* ============================================================
   PRODUCT EVENT INTAKE (B, 2026-11-09)
   ------------------------------------------------------------
   The calculator export happens in the browser, so the server cannot see it.
   This route is the narrow bridge: one POST, one field, one allowlisted name.

   Rules that keep it from becoming a tracking pixel:
     - same-origin only (checked by the router before this handler);
     - the body is capped at 512 bytes and only `{ event }` is read;
     - only the CLIENT_EVENTS set is accepted - a browser cannot claim a
       signup, a project creation, a key creation or a photo upload;
     - trackEvent applies the DNT/Sec-GPC skip and writes no identifier;
     - the answer is 204 with no body, so there is nothing to probe.
   ============================================================ */
import { readJsonBody } from './lib/http.js';
import { trackEvent } from './lib/observe.js';

const CLIENT_EVENTS = new Set(['calculator_export']);
const EVENT_BODY_LIMIT = 512;

function noContent() {
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

export async function handleProductEvent(request, env) {
  const read = await readJsonBody(request, EVENT_BODY_LIMIT);
  if (read.tooLarge) {
    return new Response(null, { status: 413, headers: { 'Cache-Control': 'no-store' } });
  }
  if (read.bad || !read.body || typeof read.body !== 'object') {
    return noContent();
  }
  const name = String(read.body.event || '');
  if (CLIENT_EVENTS.has(name)) {
    trackEvent(env, name, {}, request);
  }
  return noContent();
}
