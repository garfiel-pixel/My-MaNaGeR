/* ============================================================
   My MaNaGeR , Resources Panel
   Resource table, utilization leveling visual.
   Extracted from mmgr-render.js.
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const S = () => ns.State ? ns.State.getState() : null;
  const U = ns.Utils;
  const $ = U.$;

  function emptyStateRow(colspan, text, actionsHtml) {
    return '<tr><td colspan="' + colspan + '"><div class="es es-row">' +
      '<div>' + text + '</div>' +
      (actionsHtml ? '<div class="es-actions">' + actionsHtml + '</div>' : '') +
      '</div></td></tr>';
  }

  function renderResources() {
    const s = S();
    if (!s) return;
    const body = $('res-body');
    if (!body) return;
    const resources = s.resources || [];
    // C23 (Phase 6): when the Cross-Project toggle is on, the Resources
    // card gets the pool Library (Shared Resource Pool) instead of the old
    // one-time local import; per-row actions + a pool badge appear for
    // linked rows (see mmgr-pool.js + renderResources row below).
    let poolUiOn = false;
    try { poolUiOn = localStorage.getItem('mmgr_cross_project') === '1'; } catch(e) {}
    const P = ns.Pool;
    let crossProjectBtn = '';
    if (poolUiOn && P) {
      crossProjectBtn = ' <button class="btn btn-n btn-s" data-action="poolOpenLibrary" style="font-size:.65rem">Shared Resource Pool</button>';
      // The Library button belongs in the card-title action cluster so it is
      // reachable with rows present too (not just the empty state).
      try {
        const g6 = document.querySelector('#panel-res .card-title .g6');
        if (g6 && !g6.querySelector('[data-action="poolOpenLibrary"]')) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'btn btn-n btn-s';
          b.setAttribute('data-action', 'poolOpenLibrary');
          b.style.fontSize = '.65rem';
          b.textContent = 'Shared Resource Pool';
          g6.insertBefore(b, g6.firstChild);
        }
      } catch(e) {}
    } else {
      try {
        if (localStorage.getItem('mmgr_cross_project') === '1') {
          crossProjectBtn = ' <button class="btn btn-n btn-s" data-action="importCrossProjectResources" style="font-size:.65rem">Import from Other Project</button>';
        }
      } catch(e) {}
    }
    if (resources.length === 0) {
      body.innerHTML = emptyStateRow(9, 'No resources added yet.', '<button class="btn btn-g btn-s" data-action="addResource">+ Add Resource</button>' + crossProjectBtn);
      renderResourceLeveling();
      return;
    }
    body.innerHTML = resources.map((r, i) => {
      const u = (ns.Resources && ns.Resources.resUtil) ? ns.Resources.resUtil(r) : (+r.utilization || 0);
      const over = u > 100;
      const isLinked = !!(r.poolItemId);
      const poolBadge = (poolUiOn && isLinked) ? ' <span class="pool-badge" title="Linked to your Shared Resource Pool">pool</span>' : '';
      const poolAdd = (poolUiOn && P && !isLinked) ? ' <button class="btn btn-n btn-s" data-action="poolAddRow" data-idx="' + i + '" style="font-size:.6rem" title="Add this resource to your Shared Resource Pool">+ pool</button>' : '';
      return '<tr>' +
      '<td>' + U.escapeHtml(r.id || 'R' + (i+1)) + poolBadge + '</td>' +
      '<td><input type="text" value="' + U.escapeHtml(r.name) + '" data-action="updField" data-module="Resources" data-field="name" data-idx="' + i + '"></td>' +
      '<td><select data-action="updField" data-module="Resources" data-field="type" data-idx="' + i + '">' + ['Labor','Equipment','Material','Subcontractor'].map(t => '<option ' + (r.type === t ? 'selected' : '') + '>' + t + '</option>').join('') + '</select></td>' +
      '<td><input type="text" value="' + U.escapeHtml(r.role || '') + '" data-action="updField" data-module="Resources" data-field="role" data-idx="' + i + '" placeholder="Role / Spec"></td>' +
      '<td><input type="number" value="' + (r.availability || 100) + '" min="0" max="100" data-action="updField" data-module="Resources" data-field="availability" data-idx="' + i + '" style="width:60px">%</td>' +
      '<td><input type="number" value="' + (r.rate || 0) + '" min="0" step="5" data-action="updField" data-module="Resources" data-field="rate" data-idx="' + i + '" style="width:80px"></td>' +
      '<td><input type="number" value="' + (r.hoursAllocated || 0) + '" min="0" data-action="updField" data-module="Resources" data-field="hoursAllocated" data-idx="' + i + '" style="width:80px"></td>' +
      '<td class="' + (over ? 'txt-danger' : 'txt-green') + '">' + u + '%' + (over ? '<svg class="ico" aria-hidden="true" style="font-size:.6rem"><use href="css/mmgr-icons.svg#i-alert-triangle"></use></svg>' : '') + '</td>' +
      '<td>' + poolAdd + '<button class="btn btn-s btn-d" data-action="delResource" data-idx="' + i + '">\u00d7</button></td>' +
    '</tr>';
    }).join('');
    renderResourceLeveling();
    renderTimeTracking();
    renderEquipment();
  }

  function renderResourceLeveling() {
    const s = S();
    if (!s) return;
    const el = $('res-leveling');
    if (!el) return;
    const resources = s.resources || [];
    if (!resources.length) { el.innerHTML = ''; return; }
    const util = (ns.Resources && ns.Resources.resUtil) ? ns.Resources.resUtil : null;
    el.innerHTML = '<div class="rl-title"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-bar-chart"></use></svg> Utilization Overview</div>' +
      resources.map(r => {
        const u = util ? util(r) : (+r.utilization || 0);
        const col = u > 100 ? 'var(--danger)' : u >= 85 ? 'var(--amber)' : 'var(--green)';
        const nm = (r.name || 'Unnamed').replace(/</g, '&lt;');
        return '<div class="rl-row">' +
        '<div class="rl-name" title="' + nm + '">' + nm + '</div>' +
        '<div class="rl-bar">' +
          '<div class="rl-fill" style="width:' + Math.min(100, u) + '%;background:' + col + '"></div>' +
        '</div>' +
        '<div class="rl-pct" style="color:' + col + '">' + u + '%' + (u > 100 ? '<svg class="ico" aria-hidden="true" style="font-size:.6rem"><use href="css/mmgr-icons.svg#i-alert-triangle"></use></svg>' : '') + '</div>' +
      '</div>';
      }).join('');
  }

  // ---- Time Tracking (C27) ----
  function renderTimeTracking() {
    const s = S();
    if (!s) return;
    const body = $('time-body');
    if (!body) return;
    const list = s.timeEntries || [];
    const sum = $('time-sum');
    const totalHrs = list.reduce(function(a, x) { return a + (parseFloat(x.hours) || 0); }, 0);
    if (sum) sum.textContent = list.length ? (totalHrs.toFixed(1) + 'h total') : '';
    if (list.length === 0) {
      body.innerHTML = emptyStateRow(6, 'No time entries logged yet.', '<button class="btn btn-g btn-s" data-action="addTimeEntry">+ Log Time</button>');
      return;
    }
    body.innerHTML = list.map((x, i) => {
      return '<tr>' +
      '<td style="color:var(--slate)">' + U.escapeHtml(x.id || 'TE' + (i+1)) + '</td>' +
      '<td><input type="text" value="' + U.escapeHtml(x.task) + '" data-action="updField" data-module="TimeTracking" data-field="task" data-idx="' + i + '" style="min-width:120px" placeholder="Task"></td>' +
      '<td><input type="text" value="' + U.escapeHtml(x.resource || '') + '" data-action="updField" data-module="TimeTracking" data-field="resource" data-idx="' + i + '" style="min-width:100px" placeholder="Resource"></td>' +
      '<td><input type="date" value="' + (x.date || '') + '" data-action="updField" data-module="TimeTracking" data-field="date" data-idx="' + i + '"></td>' +
      '<td><input type="number" value="' + (x.hours || '') + '" data-action="updField" data-module="TimeTracking" data-field="hours" data-idx="' + i + '" style="width:60px" placeholder="Hrs" min="0" step="0.5"></td>' +
      '<td><input type="text" value="' + U.escapeHtml(x.notes || '') + '" data-action="updField" data-module="TimeTracking" data-field="notes" data-idx="' + i + '" placeholder="-"></td>' +
      '<td><button class="btn btn-s btn-d" data-action="delTimeEntry" data-idx="' + i + '">x</button></td>' +
      '</tr>';
    }).join('');
  }

  // ---- Equipment Log (C28) ----
  function renderEquipment() {
    const s = S();
    if (!s) return;
    const body = $('equip-body');
    if (!body) return;
    const list = s.equipment || [];
    const sum = $('equip-sum');
    const active = list.filter(x => x.status === 'active').length;
    const rented = list.filter(x => x.ownership === 'rented').length;
    if (sum) sum.textContent = list.length ? (active + ' active, ' + rented + ' rented') : '';
    if (list.length === 0) {
      body.innerHTML = emptyStateRow(9, 'No equipment tracked yet.', '<button class="btn btn-g btn-s" data-action="addEquipment">+ Add Equipment</button>');
      return;
    }
    const statusColor = (st) => st === 'active' ? 'var(--green)' : st === 'maintenance' ? 'var(--amber)' : st === 'retired' ? 'var(--danger)' : 'var(--slate)';
    body.innerHTML = list.map((x, i) => {
      return '<tr>' +
      '<td style="color:var(--slate)">' + U.escapeHtml(x.id || 'EQ' + (i+1)) + '</td>' +
      '<td><input type="text" value="' + U.escapeHtml(x.name) + '" data-action="updField" data-module="Equipment" data-field="name" data-idx="' + i + '" style="min-width:120px" placeholder="Equipment name"></td>' +
      '<td><input type="text" value="' + U.escapeHtml(x.type || '') + '" data-action="updField" data-module="Equipment" data-field="type" data-idx="' + i + '" style="width:90px" placeholder="Type"></td>' +
      '<td><select data-action="updField" data-module="Equipment" data-field="status" data-idx="' + i + '" style="color:' + statusColor(x.status) + '">' + ['active','maintenance','retired'].map(v => '<option ' + (x.status === v ? 'selected' : '') + '>' + v + '</option>').join('') + '</select></td>' +
      '<td><select data-action="updField" data-module="Equipment" data-field="ownership" data-idx="' + i + '">' + ['owned','rented','leased'].map(v => '<option ' + (x.ownership === v ? 'selected' : '') + '>' + v + '</option>').join('') + '</select></td>' +
      '<td><input type="text" value="' + U.escapeHtml(x.vendor || '') + '" data-action="updField" data-module="Equipment" data-field="vendor" data-idx="' + i + '" style="min-width:90px" placeholder="Vendor"></td>' +
      '<td><input type="date" value="' + (x.startDate || '') + '" data-action="updField" data-module="Equipment" data-field="startDate" data-idx="' + i + '"></td>' +
      '<td><input type="date" value="' + (x.maintenanceDate || '') + '" data-action="updField" data-module="Equipment" data-field="maintenanceDate" data-idx="' + i + '"></td>' +
      '<td><input type="text" value="' + U.escapeHtml(x.notes || '') + '" data-action="updField" data-module="Equipment" data-field="notes" data-idx="' + i + '" placeholder="-"></td>' +
      '<td><button class="btn btn-s btn-d" data-action="delEquipment" data-idx="' + i + '">x</button></td>' +
      '</tr>';
    }).join('');
  }

  /* ---- C23 Shared Resource Pool Library (Phase 6) ----
     The in-project picker: list the account pool, link/unlink rows,
     quick-add a row to the pool, and delete pool rows the account no
     longer needs (deleting unlinks everywhere - the server cascades;
     this project keeps its detached local copy). Server-gated to the
     owner credential; editors/viewers get a friendly note. */
  function poolKindLabel(k) {
    return k === 'person' ? 'Person (Labor/Sub)' : k === 'equipment' ? 'Equipment' : 'Material';
  }
  function poolLinkLabel(l) { return l ? 'Linked ' + String(l || '').slice(0, 10) : ''; }

  function poolOpenLibrary() {
    const modal = document.getElementById('pool-modal');
    if (modal) modal.remove();
    const overlay = document.createElement('div');
    overlay.id = 'pool-modal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:200;display:flex;align-items:center;justify-content:center';
    overlay.innerHTML = '<div class="card m0a" style="padding:16px;max-width:560px;width:calc(100vw - 40px);max-height:80vh;overflow:auto">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><div style="font-weight:600;font-size:.85rem">Shared Resource Pool</div>' +
      '<button class="btn btn-n btn-s" data-action="poolCloseLibrary">Close</button></div>' +
      '<div style="font-size:.72rem;color:var(--slate);margin:6px 0 10px">Your account-wide library. Link a row to pull it into this project; edit shared fields here and every linked project sees the update on refresh.</div>' +
      '<div id="pool-status" style="font-size:.76rem;margin-bottom:8px;color:var(--slate)">Loading…</div>' +
      '<div id="pool-list" style="font-size:.76rem"></div>' +
      '<div style="border-top:1px solid var(--border);margin-top:10px;padding-top:10px">' +
        '<div style="font-weight:600;font-size:.78rem;margin-bottom:6px">Add a row to the pool</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
          '<input id="pool-new-name" type="text" placeholder="Name (e.g. Forman, 60t crane)" style="flex:1;min-width:150px" aria-label="New pool row name">' +
          '<select id="pool-new-kind" aria-label="Pool row kind" style="width:auto"><option value="person">Person</option><option value="equipment">Equipment</option><option value="material">Material</option></select>' +
          '<button class="btn btn-g btn-s" data-action="poolCreateRow">+ Add to pool</button>' +
        '</div>' +
      '</div>' +
      '</div>';
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay || (e.target.getAttribute && e.target.getAttribute('data-action') === 'poolCloseLibrary')) overlay.remove();
      const act = e.target && e.target.getAttribute ? e.target.getAttribute('data-action') : null;
      if (act === 'poolLinkRow') { const id = e.target.getAttribute('data-id'); poolLinkRow(id, overlay); }
      else if (act === 'poolUnlinkRow') { const id = e.target.getAttribute('data-id'); poolUnlinkRow(id, overlay); }
      else if (act === 'poolDeleteRow') { const id = e.target.getAttribute('data-id'); poolDeleteRow(id, overlay); }
      else if (act === 'poolCreateRow') { poolCreateRow(overlay); }
    });
    document.body.appendChild(overlay);
    poolLoadList(overlay);
  }

  async function poolLoadList(overlay) {
    const listEl = overlay.querySelector('#pool-list');
    const statusEl = overlay.querySelector('#pool-status');
    if (!listEl || !statusEl) return;
    const P = ns.Pool;
    statusEl.textContent = 'Loading…';
    const r = await P.refresh();
    if (!r.ok) {
      statusEl.textContent = (r.status === 401 || r.status === 403)
        ? 'Pool needs an owner/editor cloud credential for this project (link the project or sign in).'
        : ('Could not load the pool: ' + (r.error || r.status));
      listEl.innerHTML = '';
      return;
    }
    const items = r.items || [];
    const linked = r.linked || {};
    statusEl.textContent = items.length ? (items.length + ' row(s) in your pool' + (Object.keys(linked).length ? ' · ' + Object.keys(linked).length + ' linked to this project' : '')) : 'Your pool is empty - add rows below.';
    if (!items.length) { listEl.innerHTML = ''; return; }
    listEl.innerHTML = items.map(function(it) {
      const isL = !!linked[it.id];
      return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);flex-wrap:wrap">' +
        '<span style="font-weight:600">' + U.escapeHtml(it.name || '(unnamed)') + '</span>' +
        '<span style="color:var(--slate);font-size:.68rem">' + poolKindLabel(it.kind) + (it.type ? ' · ' + U.escapeHtml(it.type) : '') + (it.role ? ' · ' + U.escapeHtml(it.role) : '') + (it.rate ? ' · $' + Number(it.rate).toFixed(0) + '/hr' : '') + '</span>' +
        (isL ? '<span class="pool-badge" style="color:var(--green)">linked ' + String(linked[it.id] || '').slice(0, 10) + '</span>' : '') +
        '<span style="margin-left:auto;display:flex;gap:4px">' +
          (isL
            ? '<button class="btn btn-n btn-s" data-action="poolUnlinkRow" data-id="' + U.escapeHtml(it.id) + '">Unlink</button>'
            : '<button class="btn btn-g btn-s" data-action="poolLinkRow" data-id="' + U.escapeHtml(it.id) + '">Link to project</button>') +
          '<button class="btn btn-d btn-s" data-action="poolDeleteRow" data-id="' + U.escapeHtml(it.id) + '" title="Delete from pool (unlinks everywhere)">\u00d7</button>' +
        '</span></div>';
    }).join('');
  }

  async function poolLinkRow(id, overlay) {
    const P = ns.Pool;
    const r = await P.linkItem(id);
    if (!r.ok) {
      const statusEl = overlay.querySelector('#pool-status');
      if (statusEl) statusEl.textContent = (r.queued ? 'Offline - link queued and will sync when back online.' : ('Link failed: ' + (r.error || 'unknown')));
    } else {
      const out = await P.refreshAndMerge();
      R.renderResources();
      const toast = ns.App && ns.App.showToast ? ns.App.showToast : null;
      if (toast && out.ok) toast('Linked from pool' + (out.created ? ' - ' + out.created + ' resource(s) added.' : '.'), 'ok');
    }
    poolLoadList(overlay);
  }

  async function poolUnlinkRow(id, overlay) {
    const P = ns.Pool;
    const r = await P.unlinkItem(id);
    const statusEl = overlay.querySelector('#pool-status');
    if (!r.ok && statusEl) statusEl.textContent = (r.queued ? 'Offline - unlink queued.' : ('Unlink failed: ' + (r.error || 'unknown')));
    else R.renderResources();
    poolLoadList(overlay);
  }

  async function poolDeleteRow(id, overlay) {
    const P = ns.Pool;
    const nameEl = overlay.querySelector('#pool-status');
    if (nameEl) nameEl.textContent = 'Deleting…';
    const r = await P.deleteItem(id);
    if (nameEl) nameEl.textContent = r.ok ? 'Deleted from pool. Projects keep their local copy.' : (r.queued ? 'Offline - delete queued.' : ('Delete failed: ' + (r.error || 'unknown')));
    R.renderResources();
    poolLoadList(overlay);
  }

  async function poolCreateRow(overlay) {
    const nameEl = overlay.querySelector('#pool-new-name');
    const kindEl = overlay.querySelector('#pool-new-kind');
    const statusEl = overlay.querySelector('#pool-status');
    const name = nameEl ? nameEl.value.trim() : '';
    if (!name) { if (statusEl) statusEl.textContent = 'Give the pool row a name first.'; return; }
    const P = ns.Pool;
    const r = await P.createItem({ kind: kindEl ? kindEl.value : 'person', name: name, availability: 100, rate: 0 });
    if (!r.ok) { if (statusEl) statusEl.textContent = r.queued ? 'Offline - pool row queued.' : ('Create failed: ' + (r.error || 'unknown')); return; }
    if (nameEl) nameEl.value = '';
    const linked = await P.linkItem(r.item.id);
    if (linked.ok) {
      await P.refreshAndMerge();
      R.renderResources();
      const toast = ns.App && ns.App.showToast ? ns.App.showToast : null;
      if (toast) toast('Added "' + r.item.name + '" to the pool and linked it.', 'ok');
    }
    poolLoadList(overlay);
  }

  function poolAddRow(idx) {
    const s = S();
    const res = s && s.resources && s.resources[idx];
    if (!res) return;
    const toast = ns.App && ns.App.showToast ? ns.App.showToast : null;
    const P = ns.Pool;
    P.addRowToPool(res).then(function(r) {
      if (r && r.ok) { if (toast) toast('Added "' + (r.item.name || '') + '" to the Shared Resource Pool.', 'ok'); }
      else if (toast) toast((r && r.error) ? ('Add to pool failed: ' + r.error) : 'Add to pool failed (offline - row queued).', 'err');
      R.renderResources();
    });
  }

  function poolBootMergeIfLinked() {
    if (ns.Pool && ns.Pool.bootMerge) ns.Pool.bootMerge();
  }

  ns.RenderResources = {
    renderResources: renderResources,
    renderResourceLeveling: renderResourceLeveling,
    renderTimeTracking: renderTimeTracking,
    renderEquipment: renderEquipment,
    poolOpenLibrary: poolOpenLibrary,
    poolAddRow: poolAddRow,
    poolBootMergeIfLinked: poolBootMergeIfLinked
  };
})(MMGR);
window.MMGR = MMGR;
