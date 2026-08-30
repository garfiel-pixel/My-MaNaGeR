/* ============================================================
   API ROUTER — path matching + delegation (no business logic)
   ------------------------------------------------------------
   Extracted from worker.js handleApi. This module does nothing
   but match request paths/methods and call the appropriate
   domain handler. Zero business logic lives here.

   The router is organized by domain section:
     1. Billing webhook (CORS-exempt)
     2. Internal presence auth
     3. Same-origin gate
     4. Cloud project routes (/api/cloud/projects/*)
     5. Cloud preference/presence routes
     6. Cloud sync (offline copies, broadcast)
     7. Cloud review queue
     8. Cloud admin
     9. Cloud editors/changelog
    10. Health probe
    11. Public reviews
    12. Auth (Google, email, session)
    13. Billing (status, checkout)
    14. AI relay
    15. 404 fallback
   ============================================================ */
import { json, sameOriginOnly, cloudRateCheck, cloudRateLimited, readSession, cloudForbidden } from './lib/http.js';
import { trackError, structuredLog } from './lib/observe.js';
import { handleBillingWebhook, handleBillingStatus, handleBillingCheckout } from './billing.js';
import { handleCloudProjectList, handleCloudCreate, handleCloudSave, handleCloudLoad,
  handleCloudRecover, handleCloudMeta, handleCloudUnlink, handleCloudCodeLookup,
  handleCloudProjectDelete, handleCloudProjectRestore, handleCloudProjectPurge,
  handleCloudUnadopt, cloudPushRevChangedIfCopies } from './cloud/projects.js';
import { handleCloudEditorCreate, handleCloudEditorList, handleCloudEditorRevoke } from './cloud/editors.js';
import { handleCloudChangelogList, handleCloudChangelogRevert, handleCloudChangelogImport } from './cloud/changelog.js';
import { handleCloudPrefsGet, handleCloudPrefsPut, handleCloudBroadcast, handleCloudAutoBroadcast,
  handleOfflineCopyRegister, handleOfflineCopyList, handleOfflineCopyDelete } from './cloud/sync.js';
import { handlePresenceUpgrade, presencePushRevChanged, cloudManifestCodeOk } from './cloud/presence.js';
import { API_SHAPES, handleApiShape } from './api/shapes.js';
import { handleWebhookCreate, handleWebhookList, handleWebhookDelete } from './webhooks.js';
import { handleAdminCloudList } from './admin.js';
import { handleReviewsCreate, handleReviewsList, handleReviewList,
  handleReviewAccept, handleReviewReject } from './reviews.js';
import { handleAiChat } from './ai-proxy.js';
import { handleMcpServer } from './mcp/server.js';
import { handleAuthGoogle, handleAuthMe, handleAuthLogout, handleAuthLogoutAll, mintSession } from './auth/google.js';
import { handleAuthRegister, handleAuthLogin, handleAuthPasswordChange,
  handleAuthVerifyPassword, handleAuthVerify, handleAuthForgot,
  handleAuthReset, handleAuthResendVerify, handleAuthDeleteAccount } from './auth/session.js';
import { hashOwnerCode, codesEqual, cloudDummyHash, cloudTimingSink,
  cloudAuthEditor, handleCloudSections } from './lib/http.js';

// Presence push rev + fallback for review accept broadcasts
const _cloudPushRev = cloudPushRevChangedIfCopies;

/* ============================================================
   TRACKING — lightweight event logging (Analytics Engine)
   ============================================================ */
function trackEvent(env, idx1, idx2, blob1, blob2) {
  if (!env || !env.ANALYTICS) return;
  try {
    env.ANALYTICS.writeDataPoint({
      indexes: [String(idx1 || ''), String(idx2 || '')],
      blobs: [String(blob1 || ''), String(blob2 || ''), new Date().toISOString()]
    });
  } catch (e) { /* telemetry must never block the request */ }
}

/* ============================================================
   INTERNAL PRESENCE AUTH — validates a code for WebSocket upgrade
   (reached via INTERNAL_AUTH service binding from the Presence DO)
   ============================================================ */
async function handlePresenceAuth(request, env) {
  const rl = await cloudRateCheck(request, 'general', env);
  if (rl.limited) return cloudRateLimited(rl.retryAfter);
  try {
    const body = await request.json();
    const projectId = String(body.projectId || '').slice(0, 64);
    const code = String(body.code || '').trim();
    if (!projectId || !code) { await Promise.all([cloudDummyHash(), cloudTimingSink()]); return json({ ok: false }); }
    const row = await env.DB.prepare('SELECT owner_code_salt, owner_code_hash, google_sub FROM cloud_projects WHERE project_id = ?').bind(projectId).first();
    if (!row) { await Promise.all([cloudDummyHash(), cloudTimingSink()]); return json({ ok: false }); }
    const hash = await hashOwnerCode(code, row.owner_code_salt);
    if (codesEqual(hash, row.owner_code_hash)) return json({ ok: true, name: 'Owner' });
    const ed = await cloudAuthEditor(request, env, projectId, code);
    if (ed) return json({ ok: true, name: ed.label || 'Editor' });
    if (await cloudManifestCodeOk(env, projectId, code)) return json({ ok: true, name: 'Viewer' });
    await Promise.all([cloudDummyHash(), cloudTimingSink()]);
    return json({ ok: false });
  } catch (e) { await Promise.all([cloudDummyHash(), cloudTimingSink()]); return json({ ok: false }); }
}

/* ============================================================
   RATE-LIMITED WRAPPER — every route gets this pattern:
     const rl = await cloudRateCheck(request, BUCKET, env);
     if (rl.limited) return cloudRateLimited(rl.retryAfter);
   ============================================================ */
async function rl(request, bucket, env) {
  const r = await cloudRateCheck(request, bucket, env);
  if (r.limited) return cloudRateLimited(r.retryAfter);
  return null; // not limited
}

/* ============================================================
   MAIN ROUTER
   ============================================================ */
export async function routeApi(request, env, url) {
  try {
    const path = url.pathname;

    // 1. BILLING WEBHOOK — CORS-exempt (HMAC, not Origin)
    if (path === '/api/billing/webhook' && request.method === 'POST') {
      return handleBillingWebhook(request, env);
    }

    // 2. INTERNAL PRESENCE AUTH
    if (path === '/api/internal/presence-auth' && request.method === 'POST') {
      return handlePresenceAuth(request, env);
    }

    // 3. SAME-ORIGIN GATE
    if (!sameOriginOnly(request)) {
      return json({ ok: false, error: 'cross-origin requests are not allowed' }, 403);
    }

    // 4. CLOUD PROJECT ROUTES (/api/cloud/projects)
    if (path === '/api/cloud/projects') {
      const r = await rl(request, 'general', env);
      if (r) return r;
      if (request.method === 'POST') { trackEvent(env, 'api', 'cloud-create'); structuredLog(env, 'info', 'cloud-create-start'); return handleCloudCreate(request, env); }
      if (request.method === 'GET') return handleCloudProjectList(request, env);
    }

    const cloudMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/(save|load|recover|meta|delete|restore|purge)$/);
    if (cloudMatch) {
      const pid = cloudMatch[1];
      const op = cloudMatch[2];
      const r = await rl(request, op === 'recover' ? 'recover' : 'general', env);
      if (r) return r;
      if (op === 'meta' && request.method === 'GET') return handleCloudMeta(request, env, pid);
      if (op === 'save' && request.method === 'POST') { trackEvent(env, 'api', 'cloud-save', pid); structuredLog(env, 'info', 'cloud-save-start', { projectId: pid }); return handleCloudSave(request, env, pid, async function(env, projectId, now, actor) { await _cloudPushRev(env, projectId, now, actor); }); }
      if (op === 'load' && request.method === 'POST') return handleCloudLoad(request, env, pid);
      if (op === 'recover' && request.method === 'POST') return handleCloudRecover(request, env, pid);
      if (op === 'delete' && request.method === 'POST') return handleCloudProjectDelete(request, env, pid);
      if (op === 'restore' && request.method === 'POST') return handleCloudProjectRestore(request, env, pid);
      if (op === 'purge' && request.method === 'POST') return handleCloudProjectPurge(request, env, pid);
    }

    // DELETED PROJECTS LIST (for Recover UI)
    if (path === '/api/cloud/projects/deleted' && request.method === 'GET') {
      const r = await rl(request, 'general', env);
      if (r) return r;
      try {
        const session = await readSession(request, env);
        if (!session || !session.sub) return cloudForbidden();
        const graceMs = 5 * 24 * 60 * 60 * 1000; // 5-day grace period
        const cutoff = new Date(Date.now() - graceMs).toISOString();
        const rows = await env.DB.prepare(
          'SELECT project_id, owner_label, deleted_at FROM cloud_projects WHERE google_sub = ? AND deleted_at IS NOT NULL AND deleted_at > ? ORDER BY deleted_at DESC'
        ).bind(session.sub, cutoff).all();
        const deleted = (rows.results || []).map(function(r) {
          return { projectId: r.project_id, label: r.owner_label || r.project_id, deletedAt: r.deleted_at };
        });
        return json({ ok: true, deleted: deleted });
      } catch (e) {
        console.error('deleted-list error:', e && e.message);
        return json({ ok: false, error: 'internal server error' }, 500);
      }
    }

    // CODE LOOKUP
    if (path === '/api/cloud/codes/lookup' && request.method === 'POST') {
      const r = await rl(request, 'general', env);
      if (r) return r;
      return handleCloudCodeLookup(request, env);
    }

    // ADOPT / UNLINK
    const cloudUnadoptMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/adopt$/);
    if (cloudUnadoptMatch && request.method === 'DELETE') {
      const r = await rl(request, 'general', env);
      if (r) return r;
      return handleCloudUnadopt(request, env, cloudUnadoptMatch[1]);
    }
    const cloudUnlinkMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})$/);
    if (cloudUnlinkMatch && request.method === 'DELETE') {
      const r = await rl(request, 'general', env);
      if (r) return r;
      return handleCloudUnlink(request, env, cloudUnlinkMatch[1]);
    }

    // API SHAPES (read-only resource projections)
    const apiShapeMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/api\/([a-z]+)$/);
    if (apiShapeMatch && request.method === 'GET') {
      const r = await rl(request, 'general', env);
      if (r) return r;
      const shape = apiShapeMatch[2];
      if (!API_SHAPES[shape]) return json({ ok: false, error: 'unknown shape — use tasks, baseline, risks, weather, evm or portfolio' }, 404);
      return handleApiShape(request, env, apiShapeMatch[1], shape);
    }

    // WEBHOOKS
    const webhookListMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/webhooks$/);
    if (webhookListMatch) {
      const r = await rl(request, 'general', env);
      if (r) return r;
      if (request.method === 'POST') return handleWebhookCreate(request, env, webhookListMatch[1]);
      if (request.method === 'GET') return handleWebhookList(request, env, webhookListMatch[1]);
    }
    const webhookDelMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/webhooks\/(\d+)$/);
    if (webhookDelMatch && request.method === 'DELETE') {
      const r = await rl(request, 'general', env);
      if (r) return r;
      return handleWebhookDelete(request, env, webhookDelMatch[1], webhookDelMatch[2]);
    }

    // 5. CLOUD PREFS / PRESENCE
    if (path === '/api/cloud/prefs/theme') {
      const r = await rl(request, 'general', env);
      if (r) return r;
      if (request.method === 'GET') return handleCloudPrefsGet(request, env);
      if (request.method === 'PUT') return handleCloudPrefsPut(request, env);
    }
    if (path === '/api/cloud/presence') {
      const r = await rl(request, 'general', env);
      if (r) return r;
      return handlePresenceUpgrade(request, env, url);
    }

    // 6. CLOUD SYNC (offline copies, broadcast)
    const offlineListMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/offline-copies$/);
    if (offlineListMatch) {
      const r = await rl(request, 'general', env);
      if (r) return r;
      if (request.method === 'POST') return handleOfflineCopyRegister(request, env, offlineListMatch[1]);
      if (request.method === 'GET') return handleOfflineCopyList(request, env, offlineListMatch[1]);
    }
    const offlineDelMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/offline-copies\/([A-Za-z0-9-]{1,64})$/);
    if (offlineDelMatch && request.method === 'DELETE') {
      const r = await rl(request, 'general', env);
      if (r) return r;
      return handleOfflineCopyDelete(request, env, offlineDelMatch[1], offlineDelMatch[2]);
    }

    // 7. CLOUD REVIEW QUEUE
    const reviewListMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/reviews$/);
    if (reviewListMatch && request.method === 'GET') {
      const r = await rl(request, 'general', env);
      if (r) return r;
      return handleReviewList(request, env, reviewListMatch[1], url.searchParams.get('mine') === '1');
    }
    const reviewAcceptMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/reviews\/(\d+)\/accept$/);
    if (reviewAcceptMatch && request.method === 'POST') {
      const r = await rl(request, 'general', env);
      if (r) return r;
      return handleReviewAccept(request, env, reviewAcceptMatch[1], Number(reviewAcceptMatch[2]), _cloudPushRev);
    }
    const reviewRejectMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/reviews\/(\d+)\/reject$/);
    if (reviewRejectMatch && request.method === 'POST') {
      const r = await rl(request, 'general', env);
      if (r) return r;
      return handleReviewReject(request, env, reviewRejectMatch[1], Number(reviewRejectMatch[2]));
    }

    // BROADCAST
    const broadcastMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/broadcast$/);
    if (broadcastMatch && request.method === 'POST') {
      const r = await rl(request, 'general', env);
      if (r) return r;
      return handleCloudBroadcast(request, env, broadcastMatch[1], presencePushRevChanged);
    }
    const autoBcMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/auto-broadcast$/);
    if (autoBcMatch && request.method === 'PUT') {
      const r = await rl(request, 'general', env);
      if (r) return r;
      return handleCloudAutoBroadcast(request, env, autoBcMatch[1]);
    }

    // 8. CLOUD ADMIN
    if (path === '/api/cloud/admin/projects' && request.method === 'GET') {
      const r = await rl(request, 'general', env);
      if (r) return r;
      return handleAdminCloudList(request, env);
    }

    // 9. CLOUD EDITORS / CHANGELOG
    if (path === '/api/cloud/sections' && request.method === 'GET') {
      return handleCloudSections();
    }
    const cloudEditorsMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/editors$/);
    if (cloudEditorsMatch) {
      const r = await rl(request, 'general', env);
      if (r) return r;
      if (request.method === 'POST') return handleCloudEditorCreate(request, env, cloudEditorsMatch[1]);
      if (request.method === 'GET') return handleCloudEditorList(request, env, cloudEditorsMatch[1]);
    }
    const cloudEditorDelMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/editors\/(\d+)$/);
    if (cloudEditorDelMatch && request.method === 'DELETE') {
      const r = await rl(request, 'general', env);
      if (r) return r;
      return handleCloudEditorRevoke(request, env, cloudEditorDelMatch[1], cloudEditorDelMatch[2]);
    }
    const cloudLogMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/changelog$/);
    if (cloudLogMatch && request.method === 'GET') {
      const r = await rl(request, 'general', env);
      if (r) return r;
      return handleCloudChangelogList(request, env, cloudLogMatch[1]);
    }
    const cloudImportMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/changelog\/import$/);
    if (cloudImportMatch && request.method === 'POST') {
      const r = await rl(request, 'general', env);
      if (r) return r;
      return handleCloudChangelogImport(request, env, cloudImportMatch[1]);
    }
    const cloudRevertMatch = path.match(/^\/api\/cloud\/projects\/([A-Za-z0-9_-]{1,64})\/changelog\/(\d+)\/revert$/);
    if (cloudRevertMatch && request.method === 'POST') {
      const r = await rl(request, 'general', env);
      if (r) return r;
      return handleCloudChangelogRevert(request, env, cloudRevertMatch[1], cloudRevertMatch[2]);
    }

    // 10. HEALTH PROBE
    if (path === '/api/health' && request.method === 'GET') {
      return json({ ok: true, status: 'ok', app: 'my-manager', time: new Date().toISOString() });
    }

    // 11. PUBLIC REVIEWS
    if (path === '/api/reviews') {
      if (request.method === 'GET') {
        const r = await rl(request, 'general', env);
        if (r) return r;
        return handleReviewsList(env);
      }
    if (request.method === 'POST') {
      const r = await rl(request, 'reviews', env);
      if (r) return r;
      structuredLog(env, 'info', 'review-create-start');
      return handleReviewsCreate(request, env);
    }
    }

    // 12. AUTH ROUTES
    if (path === '/api/auth/google' && request.method === 'POST') {
      structuredLog(env, 'info', 'auth-google-start');
      return handleAuthGoogle(request, env);
    }
    if (path === '/api/auth/me' && request.method === 'GET') {
      return handleAuthMe(request, env);
    }
    if (path === '/api/auth/register' && request.method === 'POST') {
      const r = await rl(request, 'authRegister', env);
      if (r) return r;
      return handleAuthRegister(request, env);
    }
    if (path === '/api/auth/login' && request.method === 'POST') {
      const r = await rl(request, 'authLogin', env);
      if (r) return r;
      return handleAuthLogin(request, env);
    }
    if (path === '/api/auth/password' && request.method === 'POST') {
      const r = await rl(request, 'authLogin', env);
      if (r) return r;
      return handleAuthPasswordChange(request, env);
    }
    if (path === '/api/auth/verify-password' && request.method === 'POST') {
      const r = await rl(request, 'authLogin', env);
      if (r) return r;
      return handleAuthVerifyPassword(request, env);
    }
    if (path === '/api/auth/delete-account' && request.method === 'POST') {
      const r = await rl(request, 'authLogin', env);
      if (r) return r;
      return handleAuthDeleteAccount(request, env);
    }
    if (path === '/api/auth/verify' && request.method === 'POST') {
      const r = await rl(request, 'authToken', env);
      if (r) return r;
      return handleAuthVerify(request, env);
    }
    if (path === '/api/auth/forgot' && request.method === 'POST') {
      const r = await rl(request, 'authForgot', env);
      if (r) return r;
      return handleAuthForgot(request, env);
    }
    if (path === '/api/auth/reset' && request.method === 'POST') {
      const r = await rl(request, 'authToken', env);
      if (r) return r;
      return handleAuthReset(request, env);
    }
    if (path === '/api/auth/resend-verify' && request.method === 'POST') {
      const r = await rl(request, 'authForgot', env);
      if (r) return r;
      return handleAuthResendVerify(request, env);
    }
    if (path === '/api/auth/logout' && request.method === 'POST') {
      return handleAuthLogout(request, env);
    }
    if (path === '/api/auth/logout-all' && request.method === 'POST') {
      return handleAuthLogoutAll(request, env);
    }

    // 13. BILLING ROUTES
    if (path === '/api/billing/status' && request.method === 'GET') {
      const r = await rl(request, 'general', env);
      if (r) return r;
      return handleBillingStatus(request, env);
    }
    if (path === '/api/billing/checkout' && request.method === 'POST') {
      const r = await rl(request, 'general', env);
      if (r) return r;
      return handleBillingCheckout(request, env);
    }

    // 14. AI RELAY
    if (path === '/api/ai/chat' && request.method === 'POST') {
      trackEvent(env, 'api', 'ai-chat');
      return handleAiChat(request, env);
    }

    // 15. MCP SERVER — per-project Model Context Protocol endpoint
    const mcpMatch = path.match(/^\/api\/mcp\/([A-Za-z0-9_-]{1,64})$/);
    if (mcpMatch) {
      return handleMcpServer(request, env, mcpMatch[1]);
    }

    // 16. 404 FALLBACK
    return json({ ok: false, error: 'not found' }, 404);
  } catch (e) {
    trackError(env, 'api-unhandled', e, { path: url.pathname, method: request.method });
    return json({ ok: false, error: 'internal server error' }, 500);
  }
}
