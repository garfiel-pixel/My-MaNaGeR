/* ============================================================
   RATE BOOK API - single-rate lookup (owner decision 2026-11-17)
   ------------------------------------------------------------
   The My MaNaGeR Rate Book is the product's OWN first-party data
   and a trade secret. No endpoint returns the whole book. A signed-in
   session may look up ONE rate by its stable id (trade + row number,
   e.g. "excavation-1") so a line in the current estimate can show the
   rate it used. Reads are rate-limited by the router, same-origin
   only, and the response is private (never a shared cache).

   RATEBOOK_PROVENANCE stays inside the Worker and is NEVER serialised.

   Signed out (or a forged/expired cookie): 401 and NOTHING of the book.
   Unknown id: 404. Rate limited: 429 (added by the router's rl()).
   ============================================================ */
import { RATEBOOK } from './data/ratebook.js';
import { json, readSession } from './lib/http.js';

// Stable id = trade id + '-' + row number. Built once at module load; this is
// immutable reference data, not request-scoped state.
const ID = /^([a-z][a-z0-9]*)-(\d{1,4})$/;
const BY_ID = Object.create(null);
for (const r of RATEBOOK.rows) {
  BY_ID[r.t + '-' + r.n] = r;
}

// The single row in the client's display shape. Provenance is never included.
function rateOf(r) {
  return {
    id: r.t + '-' + r.n,
    t: r.t,
    n: r.n,
    d: r.d,
    iu: r.iu,
    ir: r.ir,
    mu: r.mu,
    mr: r.mr,
    b: r.b || 'S',
    note: r.note || '',
    app: !!r.app
  };
}

export async function handleRatebookRate(request, env, id) {
  let session = null;
  try {
    session = await readSession(request, env);
  } catch (e) {
    session = null;
  }
  // Signed out (or a forged/expired cookie): 401 and NOTHING of the book.
  if (!session || !session.sub) {
    return json(
      {
        ok: false,
        error: 'Sign in to use My MaNaGeR planning rates and your own uploaded rate book.'
      },
      401
    );
  }
  // Only a well-formed, known id resolves - one row, never a list.
  let row = null;
  if (typeof id === 'string' && ID.test(id) && Object.prototype.hasOwnProperty.call(BY_ID, id)) {
    row = BY_ID[id];
  }
  if (!row) {
    return json({ ok: false, error: 'No planning rate has that reference.' }, 404);
  }
  const body = JSON.stringify({ ok: true, rate: rateOf(row) });
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, max-age=3600',
      Vary: 'Cookie'
    }
  });
}
