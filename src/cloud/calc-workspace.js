/* ============================================================
   CALC WORKSPACE - everything follows the account (client-docs W5)
   ------------------------------------------------------------
   The Build Cost Calculator keeps its data on-device (offline-first
   is sacred); this route lets a signed-in account carry it across
   devices as an OPT-IN background sync. One JSON blob per account
   in R2 (calc-ws/<sub>.json), same trust boundary as the prefs
   route: the mmgr_session cookie only, 403 when signed out, no
   cross-account reads. The client merges per-section by updatedAt
   stamps - the server never interprets the sections.
   ============================================================ */
import { json, cloudForbidden, readSession } from '../lib/http.js';

const WS_CAP = 4000000; // 4 MB - the logo dataURL dominates the payload

export async function handleCalcWorkspaceGet(request, env) {
  const session = await readSession(request, env);
  if (!session || !session.sub) return cloudForbidden();
  const obj = await env.R2.get('calc-ws/' + session.sub + '.json');
  if (!obj) return json({ ok: true, plan: 'free', ws: null });
  let parsed = null;
  try { parsed = JSON.parse(await obj.text()); } catch (e) { parsed = null; }
  if (!parsed || typeof parsed !== 'object') return json({ ok: true, plan: 'free', ws: null });
  return json({ ok: true, plan: 'free', ws: parsed });
}

export async function handleCalcWorkspacePut(request, env) {
  const session = await readSession(request, env);
  if (!session || !session.sub) return cloudForbidden();
  const cl = Number(request.headers.get('content-length') || 0);
  if (cl > WS_CAP) return json({ ok: false, error: 'workspace too large' }, 413);
  let body = null;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'invalid JSON body' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ ok: false, error: 'workspace must be a JSON object' }, 400);
  }
  const savedAt = new Date().toISOString();
  const payload = Object.assign({}, body, { savedAt: savedAt });
  await env.R2.put('calc-ws/' + session.sub + '.json', JSON.stringify(payload), { httpMetadata: { contentType: 'application/json' } });
  return json({ ok: true, savedAt: savedAt });
}
