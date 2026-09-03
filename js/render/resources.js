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
    // C23: Cross-project import button
    let crossProjectBtn = '';
    try {
      if (localStorage.getItem('mmgr_cross_project') === '1') {
        crossProjectBtn = ' <button class="btn btn-n btn-s" data-action="importCrossProjectResources" style="font-size:.65rem">Import from Other Project</button>';
      }
    } catch(e) {}
    if (resources.length === 0) {
      body.innerHTML = emptyStateRow(9, 'No resources added yet.', '<button class="btn btn-g btn-s" data-action="addResource">+ Add Resource</button>' + crossProjectBtn);
      renderResourceLeveling();
      return;
    }
    body.innerHTML = resources.map((r, i) => {
      const u = (ns.Resources && ns.Resources.resUtil) ? ns.Resources.resUtil(r) : (+r.utilization || 0);
      const over = u > 100;
      return '<tr>' +
      '<td>' + U.escapeHtml(r.id || 'R' + (i+1)) + '</td>' +
      '<td><input type="text" value="' + U.escapeHtml(r.name) + '" data-action="updField" data-module="Resources" data-field="name" data-idx="' + i + '"></td>' +
      '<td><select data-action="updField" data-module="Resources" data-field="type" data-idx="' + i + '">' + ['Labor','Equipment','Material','Subcontractor'].map(t => '<option ' + (r.type === t ? 'selected' : '') + '>' + t + '</option>').join('') + '</select></td>' +
      '<td><input type="text" value="' + U.escapeHtml(r.role || '') + '" data-action="updField" data-module="Resources" data-field="role" data-idx="' + i + '" placeholder="Role / Spec"></td>' +
      '<td><input type="number" value="' + (r.availability || 100) + '" min="0" max="100" data-action="updField" data-module="Resources" data-field="availability" data-idx="' + i + '" style="width:60px">%</td>' +
      '<td><input type="number" value="' + (r.rate || 0) + '" min="0" step="5" data-action="updField" data-module="Resources" data-field="rate" data-idx="' + i + '" style="width:80px"></td>' +
      '<td><input type="number" value="' + (r.hoursAllocated || 0) + '" min="0" data-action="updField" data-module="Resources" data-field="hoursAllocated" data-idx="' + i + '" style="width:80px"></td>' +
      '<td class="' + (over ? 'txt-danger' : 'txt-green') + '">' + u + '%' + (over ? '<svg class="ico" aria-hidden="true" style="font-size:.6rem"><use href="css/mmgr-icons.svg#i-alert-triangle"></use></svg>' : '') + '</td>' +
      '<td><button class="btn btn-s btn-d" data-action="delResource" data-idx="' + i + '">\u00d7</button></td>' +
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

  ns.RenderResources = {
    renderResources: renderResources,
    renderResourceLeveling: renderResourceLeveling,
    renderTimeTracking: renderTimeTracking,
    renderEquipment: renderEquipment
  };
})(MMGR);
window.MMGR = MMGR;
