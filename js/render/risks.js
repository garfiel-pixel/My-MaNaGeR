/* ============================================================
   My MaNaGeR — Risks Panel
   Risk matrix, risk rendering, impact parsing, exposure math.
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

  function parseImpactDays(text) {
    if (!text) return 0;
    const m = String(text).match(/(\d+(?:\.\d+)?)\s*(d|day|days|w|wk|week|weeks|m|mo|month|months)/i);
    if (!m) return 0;
    const n = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    if (unit.charAt(0) === 'd') return Math.round(n);
    if (unit.charAt(0) === 'w') return Math.round(n * 5);
    return Math.round(n * 20);
  }

  function parseImpactCost(text) {
    if (!text) return 0;
    const m = String(text).match(/\$?([\d,]+(?:\.\d+)?)/);
    if (!m) return 0;
    return parseFloat(m[1].replace(/,/g, ''));
  }

  function riskExposure(state) {
    const risks = (state && state.risks) || [];
    const scale = { 'Low': 1, 'low': 1, 'Medium': 2, 'medium': 2, 'High': 3, 'high': 3 };
    return risks.filter(r => !r.issueId).reduce((sum, r) => {
      const p = scale[r.probability] || 1;
      const i = scale[r.impact] || 1;
      return sum + (p * i);
    }, 0);
  }

  function contingencyTotal(state) {
    const risks = (state && state.risks) || [];
    return risks.filter(r => !r.issueId).reduce((sum, r) => sum + (parseImpactCost(r.contingency) || 0), 0);
  }

  let _riskFilter = null;

  function riskMatrixCell(prob, imp) {
    const key = prob + '|' + imp;
    _riskFilter = (_riskFilter === key) ? null : key;
    if (ns.Render && ns.Render.renderRisks) ns.Render.renderRisks();
  }

  function clearRiskFilter() {
    _riskFilter = null;
    if (ns.Render && ns.Render.renderRisks) ns.Render.renderRisks();
  }

  function renderRiskMatrix() {
    const el = $('risk-matrix');
    if (!el) return;
    const s = S();
    const risks = (s && s.risks) || [];
    const probs = ['Low', 'Medium', 'High'];
    const imps = ['Low', 'Medium', 'High'];
    const matrix = {};
    risks.filter(r => !r.issueId).forEach(r => {
      const p = r.probability || 'Low';
      const i = r.impact || 'Low';
      const key = p + '|' + i;
      if (!matrix[key]) matrix[key] = [];
      matrix[key].push(r);
    });
    let html = '<table class="risk-matrix"><thead><tr><th></th>';
    imps.forEach(im => { html += '<th>' + im + ' Impact</th>'; });
    html += '</tr></thead><tbody>';
    probs.reverse().forEach(p => {
      html += '<tr><th>' + p + ' Prob</th>';
      imps.forEach(im => {
        const key = p + '|' + im;
        const cell = matrix[key] || [];
        const active = _riskFilter === key;
        const cls = active ? 'rm-cell rm-active' : 'rm-cell';
        html += '<td class="' + cls + '" data-action="riskMatrixCell" data-prob="' + p + '" data-imp="' + im + '">';
        if (cell.length) {
          html += '<span class="rm-count">' + cell.length + '</span>';
        } else {
          html += '<span class="rm-empty">\u2014</span>';
        }
        html += '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table>';
    if (_riskFilter) {
      html += '<button class="btn btn-n btn-s" data-action="riskMatrixClear" style="margin-top:6px">Clear filter</button>';
    }
    el.innerHTML = html;
  }

  function renderRisks() {
    const s = S();
    const body = $('risk-body');
    if (!body) return;
    renderRiskMatrix();
    let risks = (s && s.risks) || [];
    if (_riskFilter) {
      const [fp, fi] = _riskFilter.split('|');
      risks = risks.filter(r => !r.issueId && (r.probability || 'Low') === fp && (r.impact || 'Low') === fi);
    }
    if (!risks.length) {
      body.innerHTML = emptyStateRow(8, 'No risks tracked yet.', '<button class="btn btn-g btn-s" data-action="addRisk">+ Add Risk</button>');
      return;
    }
    body.innerHTML = risks.map((r, i) => {
      const scale = { 'Low': 1, 'Medium': 2, 'High': 3 };
      const score = (scale[r.probability] || 1) * (scale[r.impact] || 1);
      const cls = score >= 6 ? 'txt-danger' : score >= 4 ? 'txt-warn' : 'txt-green';
      return '<tr class="' + cls + '">' +
        '<td>' + U.escapeHtml(r.name) + '</td>' +
        '<td>' + U.escapeHtml(r.probability || 'Low') + '</td>' +
        '<td>' + U.escapeHtml(r.impact || 'Low') + '</td>' +
        '<td>' + U.escapeHtml(r.contingency || '\u2014') + '</td>' +
        '<td>' + U.escapeHtml(r.mitigation || '\u2014') + '</td>' +
        '<td>' + U.escapeHtml(r.owner || '\u2014') + '</td>' +
        '<td><button class="btn btn-s btn-d" data-action="delRisk" data-idx="' + i + '">\u00d7</button></td>' +
      '</tr>';
    }).join('');
  }

  ns.RenderRisks = {
    parseImpactDays: parseImpactDays,
    parseImpactCost: parseImpactCost,
    riskExposure: riskExposure,
    contingencyTotal: contingencyTotal,
    riskMatrixCell: riskMatrixCell,
    clearRiskFilter: clearRiskFilter,
    renderRiskMatrix: renderRiskMatrix,
    renderRisks: renderRisks
  };
})(MMGR);
window.MMGR = MMGR;
