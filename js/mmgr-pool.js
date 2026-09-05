/* ============================================================
   My MaNaGeR , Cloud Shared Resource Pool client (C23, Phase 6)
   ------------------------------------------------------------
   The in-project half of the C23 pool. The pool itself is an
   ACCOUNT-scoped library (server: src/cloud/pool.js + migration
   0019) that any of the account's cloud projects can link rows
   from. This module:
     - lists the account pool + which rows THIS project links
     - links / unlinks rows, adds the focused row to the pool,
       updates + deletes pool rows (owner-gated server-side)
     - keeps a per-project OFFLINE queue of pool mutations when
       the fetch fails (mmgr_pool_pending_<projectId>) and flushes
       it on the next successful round trip
     - PULL-MERGES linked rows into state.resources with a
       field-level LWW: a pool row's shared fields (name/type/
       role/availability/rate) overwrite the local copy ONLY when
       the pool's updatedAt is newer than the last-seen stamp,
       never touching hoursAllocated (project-local by design).
   Renders need no network: linked rows carry poolItemId +
   poolUpdatedAt stamps in project state, so the table works
   offline-first (the app's sacred rule).
   ============================================================ */
var MMGR = window.MMGR || {};
(function(ns) {
  'use strict';

  const C = ns.Cloud;
  const U = ns.Utils;
  const R = ns.Render;

  function pid() { return ns.projectId || 'default'; }
  function poolUrl(suffix) {
    return '/api/cloud/projects/' + encodeURIComponent(pid()) + '/pool' + suffix;
  }
  // The credential that authorizes pool routes = the SAME owner/editor
  // credential the Cloud drawer uses (owner code / session). View-only
  // codes are refused server-side for pool writes.
  function headers() {
    const h = { 'Content-Type': 'application/json' };
    try {
      const cred = C && C._activeCredential ? C._activeCredential() : null;
      if (cred && cred.header && cred.code) h[cred.header] = cred.code;
    } catch (e) { /* no cloud credential — server will 401 */ }
    return h;
  }
  function esc(v) { return C && C._esc ? C._esc(v) : String(v == null ? '' : v); }

  let _cache = null; // { items: [], linked: {poolItemId: linkedAt} }

  // ---- offline queue ---------------------------------------------------
  function qKey() { return 'mmgr_pool_pending_' + pid(); }
  function loadQ() {
    try { const raw = localStorage.getItem(qKey()); return raw ? JSON.parse(raw) : []; } catch (e) { return []; }
  }
  function saveQ(q) { try { localStorage.setItem(qKey(), JSON.stringify(q)); } catch (e) { /* quota — drop */ } }
  function enqueue(op) {
    const q = loadQ();
    q.push(Object.assign({ at: new Date().toISOString() }, op));
    saveQ(q);
  }

  // ---- core fetches ----------------------------------------------------
  async function poolFetch(url, method, body) {
    const res = await fetch(url, {
      method: method, credentials: 'same-origin',
      headers: headers(), body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(function() { return {}; });
    return { ok: res.ok, status: res.status, data: data };
  }

  // GET the account pool + this project's link pins. 401/403 → null-ish
  // result so callers can show a "cloud credential needed" state.
  async function refresh() {
    const r = await poolFetch(poolUrl('/items'), 'GET');
    if (!r.ok || !r.data.ok) return { ok: false, status: r.status, error: r.data.error || ('HTTP ' + r.status), items: [], linked: {} };
    _cache = { items: r.data.items || [], linked: r.data.linked || {} };
    return { ok: true, items: _cache.items, linked: _cache.linked };
  }

  async function linkItem(poolItemId) {
    const r = await poolFetch(poolUrl('/links'), 'POST', { poolItemId: poolItemId });
    if (!r.ok) { enqueue({ op: 'link', poolItemId: poolItemId }); }
    return { ok: r.ok && r.data.ok, error: r.data.error, queued: !(r.ok && r.data.ok), linkedAt: r.data.linkedAt };
  }
  async function unlinkItem(poolItemId) {
    const r = await poolFetch(poolUrl('/links/' + encodeURIComponent(poolItemId)), 'DELETE');
    if (!r.ok) { enqueue({ op: 'unlink', poolItemId: poolItemId }); }
    return { ok: r.ok && r.data.ok, error: r.data.error, queued: !(r.ok && r.data.ok) };
  }
  async function createItem(fields) {
    const r = await poolFetch(poolUrl('/items'), 'POST', fields);
    if (!r.ok) { enqueue({ op: 'create', fields: fields }); return { ok: false, error: r.data.error, queued: true }; }
    return { ok: true, item: r.data.item };
  }
  async function updateItem(poolItemId, fields) {
    const r = await poolFetch(poolUrl('/items/' + encodeURIComponent(poolItemId)), 'PUT', fields);
    if (!r.ok) { enqueue({ op: 'update', poolItemId: poolItemId, fields: fields }); return { ok: false, error: r.data.error, queued: true }; }
    return { ok: true, item: r.data.item };
  }
  async function deleteItem(poolItemId) {
    const r = await poolFetch(poolUrl('/items/' + encodeURIComponent(poolItemId)), 'DELETE');
    if (!r.ok) { enqueue({ op: 'delete', poolItemId: poolItemId }); return { ok: false, error: r.data.error, queued: true }; }
    return { ok: true };
  }

  // ---- offline flush ----------------------------------------------------
  // Called after ANY successful pool round trip and on window 'online'.
  // FIFO replay; a still-offline op stays queued (no data loss).
  async function flushPending() {
    const q = loadQ();
    if (!q.length) return;
    for (let i = 0; i < q.length; i++) {
      const op = q[i];
      try {
        if (op.op === 'link') await linkItem(op.poolItemId);
        else if (op.op === 'unlink') await unlinkItem(op.poolItemId);
        else if (op.op === 'create') await createItem(op.fields);
        else if (op.op === 'update') await updateItem(op.poolItemId, op.fields);
        else if (op.op === 'delete') await deleteItem(op.poolItemId);
        // a success (or a definitive 4xx handled inside) drops the op
        if (op.op === 'link' || op.op === 'unlink' || op.op === 'delete') q[i]._done = true;
      } catch (e) { /* offline — stop and retry later */ break; }
    }
    const remaining = q.filter(function(x) { return !x._done; }).map(function(x) { delete x._done; return x; });
    saveQ(remaining);
  }

  // ---- pull-merge into project state -----------------------------------
  // Linked rows are merged on project load / Refresh pool / pre-save.
  // Returns { merged, created } counts so the UI can toast politely.
  function mergeIntoState(items, linked) {
    let merged = 0, created = 0;
    ns.State.updateState(function(s) {
      if (!s.resources) s.resources = [];
      const knownIds = {};
      s.resources.forEach(function(r) { if (r.poolItemId) knownIds[r.poolItemId] = r; });
      (items || []).forEach(function(poolItem) {
        if (!linked || !linked[poolItem.id]) return; // only linked rows come in
        const existing = knownIds[poolItem.id];
        const shared = {
          name: poolItem.name || '',
          type: poolItem.type || (poolItem.kind === 'person' ? 'Labor' : (poolItem.kind === 'equipment' ? 'Equipment' : 'Material')),
          role: poolItem.role || '',
          availability: Number(poolItem.availability) || 0,
          rate: Number(poolItem.rate) || 0
        };
        if (!existing) {
          s.resources.push(Object.assign({
            id: U.genShortId('R'), hoursAllocated: 0, utilization: 0,
            poolItemId: poolItem.id, poolUpdatedAt: poolItem.updatedAt || ''
          }, shared));
          created++;
        } else {
          // LWW: pool wins only when newer than our last-seen stamp.
          const lastSeen = existing.poolUpdatedAt || '';
          if (!lastSeen || (poolItem.updatedAt || '') > lastSeen) {
            Object.keys(shared).forEach(function(k) { existing[k] = shared[k]; });
            existing.poolItemId = poolItem.id;
            existing.poolUpdatedAt = poolItem.updatedAt || '';
            merged++;
          }
        }
      });
    });
    return { merged: merged, created: created };
  }

  // Convenience used by render/resources.js when the picker pulls.
  async function refreshAndMerge() {
    const r = await refresh();
    if (!r.ok) return { ok: false, status: r.status, error: r.error };
    const out = mergeIntoState(r.items, r.linked);
    await flushPending();
    return { ok: true, items: r.items, linked: r.linked, merged: out.merged, created: out.created };
  }

  // "Add to pool" from a focused resource row + link it back.
  async function addRowToPool(resource) {
    const kind = resource.type === 'Equipment' ? 'equipment'
      : (resource.type === 'Material' ? 'material' : 'person');
    const res = await createItem({
      kind: kind,
      name: resource.name || '',
      type: resource.type === 'Subcontractor' ? 'Subcontractor' : (kind === 'person' ? 'Labor' : ''),
      role: resource.role || '',
      availability: Number(resource.availability) || 0,
      rate: Number(resource.rate) || 0,
      notes: ''
    });
    if (!res.ok) return res;
    // stamp the local row so future merges key on it, then link
    ns.State.updateState(function(s) {
      const row = (s.resources || []).find(function(x) { return x.id === resource.id; });
      if (row) { row.poolItemId = res.item.id; row.poolUpdatedAt = res.item.updatedAt || ''; }
    });
    await linkItem(res.item.id);
    return { ok: true, item: res.item };
  }

  // ---- boot hooks --------------------------------------------------------
  let _bootMerged = false;
  async function bootMerge() {
    // Only meaningful for cloud-linked projects held with a credential.
    const cred = (C && C._activeCredential) ? C._activeCredential() : null;
    if (!cred) return;
    if (_bootMerged) return;
    _bootMerged = true;
    try {
      const r = await refreshAndMerge();
      if (r.ok && (r.merged > 0 || r.created > 0) && C && C._render && typeof C._render === 'function') {
        R.renderResources();
      }
    } catch (e) { /* offline at boot — pool merges next refresh */ }
  }

  window.addEventListener('online', function() { flushPending(); });

  // ---- public API ---------------------------------------------------------
  ns.Pool = {
    refresh: refresh,
    linkItem: linkItem,
    unlinkItem: unlinkItem,
    createItem: createItem,
    updateItem: updateItem,
    deleteItem: deleteItem,
    flushPending: flushPending,
    mergeIntoState: mergeIntoState,
    refreshAndMerge: refreshAndMerge,
    addRowToPool: addRowToPool,
    bootMerge: bootMerge,
    _cache: function() { return _cache; },
    _pendingCount: function() { return loadQ().length; },
    _pid: pid
  };
})(MMGR);
window.MMGR = MMGR;
