/* ============================================================
 My MaNaGeR, Risks Panel
 Risk matrix, risk rendering, impact parsing, exposure math.
 Extracted from mmgr-render.js.
 ============================================================ */
var MMGR = window.MMGR || {};

(function (ns) {
  'use strict';

  const S = () => (ns.State ? ns.State.getState() : null);
  const U = ns.Utils;
  const $ = U.$;

  // S-5 (audit 2026-10-18): colspan is a column count and text is plain
  // text, so both are escaped. actionsHtml is the caller's action-button
  // MARKUP (every caller passes a literal <button>), so it is not text and
  // must not be escaped.
  function emptyStateRow(colspan, text, actionsHtml) {
    return (
      '<tr><td colspan="' +
      U.escapeHtml(colspan) +
      '"><div class="es es-row">' +
      '<div>' +
      U.escapeHtml(text) +
      '</div>' +
      // ok: actionsHtml is the caller's action-button markup, not user text
      (actionsHtml ? '<div class="es-actions">' + actionsHtml + '</div>' : '') +
      '</div></td></tr>'
    );
  }

  function parseImpactDays(text) {
    if (!text) {
      return 0;
    }
    const m = String(text).match(
      /(\d+(?:\.\d+)?)\s*(d|day|days|w|wk|week|weeks|m|mo|month|months)/i
    );
    if (!m) {
      return 0;
    }
    const n = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    if (unit.charAt(0) === 'd') {
      return Math.round(n);
    }
    if (unit.charAt(0) === 'w') {
      return Math.round(n * 5);
    }
    return Math.round(n * 20);
  }

  function parseImpactCost(text) {
    if (!text) {
      return 0;
    }
    const m = String(text).match(/\$?([\d,]+(?:\.\d+)?)/);
    if (!m) {
      return 0;
    }
    return parseFloat(m[1].replace(/,/g, ''));
  }

  function riskExposure(state) {
    const risks = (state && state.risks) || [];
    const scale = { Low: 1, low: 1, Medium: 2, medium: 2, High: 3, high: 3 };
    return risks
      .filter(r => !r.issueId)
      .reduce((sum, r) => {
        // Use dollar-based costImpactEstimate when available (weighted by
        // probability), fall back to the 1-9 ordinal scale.
        if (r.costImpactEstimate) {
          const pFactor = { Low: 0.3, low: 0.3, Medium: 0.5, medium: 0.5, High: 0.7, high: 0.7 };
          return sum + Math.round((pFactor[r.probability] || 0.5) * (+r.costImpactEstimate || 0));
        }
        const p = scale[r.probability] || 1;
        const i = scale[r.impact] || 1;
        return sum + p * i;
      }, 0);
  }

  function contingencyTotal(state) {
    const s = state || ns.State.getState();
    // Sum dollar amounts from budget lines flagged as contingency reserves.
    const bud = (s.budgetLines || []).filter(l => l.isContingency);
    return bud.reduce((sum, l) => sum + (+l.planned || 0), 0);
  }

  let _riskFilter = null;

  function riskMatrixCell(prob, imp) {
    const key = prob + '|' + imp;
    _riskFilter = _riskFilter === key ? null : key;
    if (ns.Render && ns.Render.renderRisks) {
      ns.Render.renderRisks();
    }
  }

  function clearRiskFilter() {
    _riskFilter = null;
    if (ns.Render && ns.Render.renderRisks) {
      ns.Render.renderRisks();
    }
  }

  function renderRiskMatrix() {
    const el = $('risk-matrix');
    if (!el) {
      return;
    }
    const s = S();
    const risks = (s && s.risks) || [];
    const probs = ['Low', 'Medium', 'High'];
    const imps = ['Low', 'Medium', 'High'];
    const matrix = {};
    risks
      .filter(r => !r.issueId)
      .forEach(r => {
        const p = r.probability || 'Low';
        const i = r.impact || 'Low';
        const key = p + '|' + i;
        if (!matrix[key]) {
          matrix[key] = [];
        }
        matrix[key].push(r);
      });
    let html = '<table class="risk-matrix"><thead><tr><th></th>';
    imps.forEach(im => {
      html += '<th>' + im + ' Impact</th>';
    });
    html += '</tr></thead><tbody>';
    probs.reverse().forEach(p => {
      html += '<tr><th>' + p + ' Prob</th>';
      imps.forEach(im => {
        const key = p + '|' + im;
        const cell = matrix[key] || [];
        const active = _riskFilter === key;
        // Severity heat: the Low/Medium/High axes rank the cell, so the tint is a
        // pure function of (prob, imp) position - CSS-only heat via a per-cell
        // severity class, keeping the render data-driven and the palette in tokens.
        const rank = v => (v === 'High' ? 3 : v === 'Medium' ? 2 : 1);
        const sev = rank(p) * rank(im);
        const sevCls = sev >= 6 ? ' rm-hi' : sev >= 3 ? ' rm-med' : '';
        const cls = (active ? 'rm-cell rm-active' : 'rm-cell') + sevCls;
        html +=
          '<td class="' +
          cls +
          '" data-action="riskMatrixCell" data-prob="' +
          p +
          '" data-imp="' +
          im +
          '">';
        if (cell.length) {
          html += '<span class="rm-count">' + cell.length + '</span>';
        } else {
          html += '<span class="rm-empty">-</span>';
        }
        html += '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table>';
    if (_riskFilter) {
      html +=
        '<button class="btn btn-n btn-s" data-action="riskMatrixClear" style="margin-top:6px">Clear filter</button>';
    }
    el.innerHTML = html;
  }

  function renderRisks() {
    const s = S();
    const body = $('risk-body');
    if (!body) {
      return;
    }
    renderRiskMatrix();
    // Keep the ORIGINAL index with every row: the editors write back through
    // data-idx, and the matrix filter drops rows - mapping over the filtered
    // array used to point every edit at the wrong record.
    const all = ((s && s.risks) || []).map((r, i) => ({
      r: ns.Risks && ns.Risks.normalize ? ns.Risks.normalize(r) : r,
      i: i
    }));
    let rows = all;
    if (_riskFilter) {
      const [fp, fi] = _riskFilter.split('|');
      rows = all.filter(
        x => !x.r.issueId && (x.r.probability || 'Low') === fp && (x.r.impact || 'Low') === fi
      );
    }
    if (!rows.length) {
      body.innerHTML = emptyStateRow(
        9,
        _riskFilter ? 'No risks in this matrix cell.' : 'No risks tracked yet.',
        '<button class="btn btn-g btn-s" data-action="addRisk">+ Add Risk</button>'
      );
      return;
    }
    const tasks = (s && s.tasks) || [];
    const levels = ['Low', 'Medium', 'High'];
    const opts = sel =>
      levels
        .map(
          lv =>
            '<option value="' + lv + '"' + (lv === sel ? ' selected' : '') + '>' + lv + '</option>'
        )
        .join('');
    const textCell = (field, value, idx, placeholder, width) =>
      '<input type="text" value="' +
      U.escapeHtml(value == null ? '' : String(value)) +
      '" data-action="updField" data-module="Risks" data-field="' +
      field +
      '" data-idx="' +
      idx +
      '" placeholder="' +
      placeholder +
      '"' +
      (width ? ' style="min-width:' + width + 'px"' : '') +
      '>';
    body.innerHTML = rows
      .map((x, i) => {
        const r = x.r;
        const scale = { Low: 1, Medium: 2, High: 3 };
        const score = (scale[r.probability] || 1) * (scale[r.impact] || 1);
        const cls = score >= 6 ? 'txt-danger' : score >= 4 ? 'txt-warn' : 'txt-green';
        // LINKED-TASK PROPAGATION: a risk tied to an overdue task is flagged
        // LATE in its Linked Task cell, beside the task it will land on.
        const lt = r.linkedTaskId ? tasks.find(t => t.id === r.linkedTaskId) : null;
        const late = lt && lt.endDate && U.isOverdue(lt.endDate) && lt.status !== 'completed';
        const taskOpts =
          '<option value=""' +
          (r.linkedTaskId ? '' : ' selected') +
          '>None</option>' +
          tasks
            .map(
              t =>
                '<option value="' +
                U.escapeHtml(t.id) +
                '"' +
                (t.id === r.linkedTaskId ? ' selected' : '') +
                '>' +
                U.escapeHtml(t.name) +
                '</option>'
            )
            .join('');
        return (
          '<tr class="' +
          cls +
          '">' +
          '<td>' +
          U.escapeHtml(r.id || '-') +
          '</td>' +
          '<td>' +
          textCell('description', r.description, i, 'Risk description', 150) +
          '</td>' +
          '<td><select data-action="updField" data-module="Risks" data-field="probability" data-idx="' +
          i +
          '">' +
          opts(r.probability) +
          '</select></td>' +
          '<td><select data-action="updField" data-module="Risks" data-field="impact" data-idx="' +
          i +
          '">' +
          opts(r.impact) +
          '</select></td>' +
          '<td>' +
          textCell('mitigation', r.mitigation, i, 'Mitigation plan', 140) +
          '</td>' +
          '<td><select data-action="updField" data-module="Risks" data-field="linkedTaskId" data-idx="' +
          i +
          '">' +
          taskOpts +
          '</select>' +
          (late
            ? ' <span class="txt-danger" style="font-size:.7rem;font-weight:700">LATE</span>'
            : '') +
          '</td>' +
          '<td><input type="number" min="0" step="100" value="' +
          (r.costImpactEstimate == null ? '' : U.escapeHtml(String(r.costImpactEstimate))) +
          '" data-action="updField" data-module="Risks" data-field="costImpactEstimate" data-idx="' +
          i +
          '" style="min-width:80px" placeholder="0"></td>' +
          '<td>' +
          (r.issueId
            ? '<span style="font-size:.72rem">' +
              U.escapeHtml(r.issueId) +
              ' <button class="btn btn-s btn-n" data-action="toggleRiskIssue" data-idx="' +
              i +
              '" title="Unlink from the issue register">Unlink</button></span>'
            : '<button class="btn btn-s btn-o" data-action="toggleRiskIssue" data-idx="' +
              i +
              '" title="Promote this risk to the issue register">Raise</button>') +
          '</td>' +
          `<td><button class="btn btn-s btn-d" data-action="delRisk" data-idx="${i}" title="Delete this risk">\u00d7</button></td>` +
          '</tr>'
        );
      })
      .join('');
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
