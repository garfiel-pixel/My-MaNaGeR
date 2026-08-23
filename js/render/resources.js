/* ============================================================
   My MaNaGeR — Resources Panel
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
    if (resources.length === 0) {
      body.innerHTML = emptyStateRow(9, 'No resources added yet.', '<button class="btn btn-g btn-s" data-action="addResource">+ Add Resource</button>');
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

  ns.RenderResources = {
    renderResources: renderResources,
    renderResourceLeveling: renderResourceLeveling
  };
})(MMGR);
window.MMGR = MMGR;
