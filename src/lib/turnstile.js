/* ============================================================
   TURNSTILE , the one Cloudflare bot gate
   ------------------------------------------------------------
   Extracted from src/reviews.js when the owner approved the
   challenge on the contact form and on registration as well
   (2026-11-05). One implementation, three callers, so the
   secret, the sitekey lookup and the fail-closed rule can
   never drift between surfaces.

   The SECRET is a Wrangler secret (env.TURNSTILE_SECRET) - never
   in source, never in a var, never logged. The sitekey is public
   and is handed to the browser by handleTurnstileConfig, so the
   two halves can never drift apart in the markup.

   Fail CLOSED: once a secret is configured, a post without a
   valid token is refused before anything is written. If NO
   secret is configured the challenge is off entirely (local
   dev, CI, and the window before the owner creates the widget),
   and the endpoint reports required:false so the client renders
   nothing.
   ============================================================ */
import { json } from './http.js';

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

// The siteverify endpoint is overridable ONLY through the Worker environment
// (never through any request input), so tools/qa-reviews.cjs can point it at a
// local stub and assert the real accept/refuse branches offline. Unset in
// production -> the Cloudflare endpoint above.
function turnstileVerifyUrl(env) {
  const u =
    env && typeof env.TURNSTILE_VERIFY_URL === 'string' ? env.TURNSTILE_VERIFY_URL.trim() : '';
  return u || TURNSTILE_VERIFY_URL;
}

export function turnstileEnabled(env) {
  return !!(env && typeof env.TURNSTILE_SECRET === 'string' && env.TURNSTILE_SECRET.trim());
}

// GET /api/turnstile-config - the public sitekey + whether a challenge is
// required. Public by design (the sitekey is public); reveals nothing secret.
export function handleTurnstileConfig(env) {
  const required = turnstileEnabled(env);
  const sitekey =
    env && typeof env.TURNSTILE_SITEKEY === 'string' ? env.TURNSTILE_SITEKEY.trim() : '';
  // Required but no sitekey to render is a misconfiguration. Report it
  // honestly rather than stranding the visitor with an unfillable form.
  if (required && !sitekey) {
    return json({ ok: false, error: 'turnstile not fully configured' }, 503);
  }
  return json({ ok: true, sitekey: sitekey, required: required });
}

// Cloudflare sets CF-Connecting-IP on every request. Read it defensively:
// it is only ever handed to Turnstile as an optional hint, never trusted
// for authorization, so a missing/garbage value just means no remoteip.
export function clientIp(request) {
  const ip = request.headers.get('CF-Connecting-IP');
  if (typeof ip !== 'string') {
    return '';
  }
  return /^[\d.]{3,45}$|^[0-9a-fA-F:]{3,45}$/.test(ip) ? ip : '';
}

// Verify one token with Cloudflare. Returns { ok:false, error } on any
// failure so the caller can refuse without leaking which part failed.
// `missingMessage` lets each surface name its own action ("send your
// review", "send your message", "create an account") without a second
// copy of the verification rules.
export async function verifyTurnstileToken(token, remoteIp, env, missingMessage) {
  if (!turnstileEnabled(env)) {
    return { ok: true, skipped: true };
  }
  if (typeof token !== 'string' || !token.trim()) {
    return {
      ok: false,
      error: missingMessage || 'please finish the check above before continuing'
    };
  }
  // Bound the token length - siteverify tokens are ~1-2 KB, so this rejects
  // an obvious attempt to push a huge body through the verify call.
  const tok = token.trim();
  if (tok.length > 4096) {
    return { ok: false, error: 'that check could not be read, please try again' };
  }
  let res;
  try {
    res = await fetch(turnstileVerifyUrl(env), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET,
        response: tok,
        ...(remoteIp ? { remoteip: remoteIp } : {})
      })
    });
  } catch (e) {
    // Network trouble reaching CF must NOT become a bypass: refuse.
    return { ok: false, error: 'we could not check that you are human, please try again' };
  }
  if (!res || !res.ok) {
    return { ok: false, error: 'we could not check that you are human, please try again' };
  }
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  if (!data || data.success !== true) {
    return { ok: false, error: 'that check did not pass, please try again' };
  }
  return { ok: true };
}
