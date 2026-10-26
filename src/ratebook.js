/* ============================================================
   RATE BOOK API - GET /api/ratebook (RB-1, 2026-10-25)
   ------------------------------------------------------------
   REFINEMENT-DIRECTIVE-2026-10-24 3.4: the 811 planning rates used
   to be a PUBLIC static file (js/jic-rates-full.js) that anyone
   could download, and the service worker precached it for every
   visitor - so the sign-in gate on the rate-book card was a screen,
   not a lock. The book now comes from here instead.

   WHO MAY OPEN IT: the pricing page, which is the product's own
   statement of the deal. Every plan, including Free, lists the
   Build Cost Calculator and "the My MaNaGeR Rate Book: 811 planning
   rates (sign in to open it)". The only condition it names is being
   signed in, so that is exactly the gate here - no paid-plan check
   was invented on top of what the plan table promises.

   Cache policy: 'private'. The data sits behind a session, so no
   shared cache may keep a copy. The browser may hold it, and the
   calculator also stores it in the Cache API (mmgr-ratebook-v1) so
   the book opens with no network after one signed-in load; that copy
   is cleared on sign-out (js/mmgr-google-auth.js).

   Provenance: RATEBOOK_PROVENANCE stays inside the Worker. It is
   never serialised into this response - the source record is a
   private note, not something a customer reads.
   ============================================================ */
import { RATEBOOK } from './data/ratebook.js';
import { json, readSession } from './lib/http.js';

export async function handleRatebook(request, env) {
  let session = null;
  try {
    session = await readSession(request, env);
  } catch (e) {
    session = null;
  }
  // Signed out (or a forged/expired cookie): 401 and NOTHING of the book.
  // The wording stays plain and says what to do next, and it matches the
  // sentence the pricing page already prints.
  if (!session || !session.sub) {
    return json(
      {
        ok: false,
        error: 'Sign in to open the rate book. It is free, and it stays on your device.'
      },
      401
    );
  }
  const body = JSON.stringify({ ok: true, book: RATEBOOK });
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, max-age=3600',
      Vary: 'Cookie'
    }
  });
}
