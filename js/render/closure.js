/* ============================================================
   My MaNaGeR — Closure Panel
   Punch List, Handover / Closeout Package, Warranty Tracker.
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

  // ---- Punch List (MARKET-FEATURE-ROADMAP C3) ----
  function renderPunchList() {
    const s = S();
    if (!s) return;
    const body = $('punch-body');
    if (!body) return;
    const items = s.punchList || [];
    const open = items.filter(i => i.status !== 'done').length;
    const done = items.length - open;
    const sum = $('punch-sum');
    if (sum) sum.textContent = items.length ? (done + ' done · ' + open + ' open') : '';
    if (items.length === 0) {
      body.innerHTML = emptyStateRow(9, 'No punch-list items yet.', '<button class="btn btn-g btn-s" data-action="addPunch">+ Add Punch Item</button>');
      return;
    }
    const p = (v) => v === 'High' ? 'var(--danger)' : v === 'Medium' ? 'var(--amber)' : 'var(--slate)';
    body.innerHTML = items.map((it, i) => `<tr>
      <td>${U.escapeHtml(it.id || 'P' + (i+1))}</td>
      <td><input type="text" value="${U.escapeHtml(it.item)}" data-action="updField" data-module="PunchList" data-field="item" data-idx="${i}" style="min-width:160px"></td>
      <td><input type="text" value="${U.escapeHtml(it.location || '')}" data-action="updField" data-module="PunchList" data-field="location" data-idx="${i}" placeholder="e.g. Level 2, Room 204"></td>
      <td><input type="text" value="${U.escapeHtml(it.assignee || '')}" data-action="updField" data-module="PunchList" data-field="assignee" data-idx="${i}"></td>
      <td><select data-action="updField" data-module="PunchList" data-field="category" data-idx="${i}">${['Defect','Snag','Touch-up','Safety','Other'].map(v => `<option ${it.category === v ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td><select data-action="updField" data-module="PunchList" data-field="priority" data-idx="${i}" style="color:${p(it.priority)}">${['Low','Medium','High'].map(v => `<option ${it.priority === v ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td><select data-action="updField" data-module="PunchList" data-field="status" data-idx="${i}">${['open','inprogress','done'].map(v => `<option ${it.status === v ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td><input type="text" value="${U.escapeHtml(it.notes || '')}" data-action="updField" data-module="PunchList" data-field="notes" data-idx="${i}" placeholder="—"></td>
      <td><button class="btn btn-s btn-d" data-action="delPunch" data-idx="${i}">×</button></td>
    </tr>`).join('');
  }

  // ---- Handover / Closeout Package (MARKET-FEATURE-ROADMAP C18) ----
  function renderHandover() {
    const s = S();
    if (!s) return;
    const body = $('handover-body');
    if (!body) return;
    const list = s.handover || [];
    const filed = list.filter(x => x.status === 'filed').length;
    const sum = $('handover-sum');
    if (sum) sum.textContent = list.length ? (filed + ' of ' + list.length + ' filed') : '';
    if (list.length === 0) {
      body.innerHTML = emptyStateRow(6, 'No handover items yet. Bundle O&M manuals, as-builts, warranties, certificates and sign-offs for handover.', '<button class="btn btn-g btn-s" data-action="addHandoverItem">+ Add Item</button>');
      return;
    }
    body.innerHTML = list.map((x, i) => `<tr>
      <td>${U.escapeHtml(x.id || 'HO' + (i+1))}</td>
      <td><input type="text" value="${U.escapeHtml(x.item)}" data-action="updField" data-module="Handover" data-field="item" data-idx="${i}" style="min-width:150px" placeholder="Item / document"></td>
      <td><select data-action="updField" data-module="Handover" data-field="category" data-idx="${i}">${['O&M Manual','Warranty','As-Built','Certificates','Sign-off','Other'].map(v => `<option ${x.category === v ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td><select data-action="updField" data-module="Handover" data-field="status" data-idx="${i}" style="color:${x.status === 'filed' ? 'var(--green)' : x.status === 'ready' ? 'var(--gold)' : 'var(--amber)'}">${['required','ready','filed'].map(v => `<option ${x.status === v ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td><input type="text" value="${U.escapeHtml(x.notes || '')}" data-action="updField" data-module="Handover" data-field="notes" data-idx="${i}" placeholder="—"></td>
      <td><button class="btn btn-s btn-d" data-action="delHandoverItem" data-idx="${i}">×</button></td>
    </tr>`).join('');
  }

  // ---- Warranty Tracker (MARKET-FEATURE-ROADMAP C26) ----
  function renderWarranty() {
    const s = S();
    if (!s) return;
    const body = $('warranty-body');
    if (!body) return;
    const list = s.warrantyItems || [];
    const sum = $('warranty-sum');
    if (sum) sum.textContent = list.length ? (list.length + ' tracked') : '';
    if (list.length === 0) {
      body.innerHTML = emptyStateRow(8, 'No warranty items yet.', '<button class="btn btn-g btn-s" data-action="addWarranty">+ Add Warranty</button>');
      return;
    }
    function dl(d) {
      if (!d) return null;
      const dt = new Date(d);
      if (isNaN(dt.getTime())) return null;
      return Math.round((dt.getTime() - Date.now()) / 86400000);
    }
    body.innerHTML = list.map((x, i) => {
      const left = dl(x.warrantyEnd);
      const leftTxt = left === null ? '—' : left < 0 ? (Math.abs(left) + 'd ago') : left + 'd left';
      const leftColor = left === null ? 'var(--slate)' : left < 0 ? 'var(--danger)' : left <= 60 ? 'var(--amber)' : 'var(--green)';
      return `<tr>
      <td>${U.escapeHtml(x.id || 'WR' + (i+1))}</td>
      <td><input type="text" value="${U.escapeHtml(x.item)}" data-action="updField" data-module="Warranty" data-field="item" data-idx="${i}" style="min-width:150px" placeholder="Item / system"></td>
      <td><input type="text" value="${U.escapeHtml(x.provider || '')}" data-action="updField" data-module="Warranty" data-field="provider" data-idx="${i}" placeholder="Provider"></td>
      <td><input type="date" value="${x.warrantyStart || ''}" data-action="updField" data-module="Warranty" data-field="warrantyStart" data-idx="${i}"></td>
      <td><input type="date" value="${x.warrantyEnd || ''}" data-action="updField" data-module="Warranty" data-field="warrantyEnd" data-idx="${i}"></td>
      <td style="color:${leftColor}">${leftTxt}</td>
      <td><input type="text" value="${U.escapeHtml(x.notes || '')}" data-action="updField" data-module="Warranty" data-field="notes" data-idx="${i}" placeholder="—"></td>
      <td><button class="btn btn-s btn-d" data-action="delWarranty" data-idx="${i}">×</button></td>
    </tr>`;
    }).join('');
  }

  function renderClosure() {
    const s = S();
    if (!s) return;
    renderPunchList();
    renderHandover();
    renderWarranty();
    if (!s.closure) return;
    const items = s.closure.items || [];
    const chk = $('close-chk');
    if (chk) {
      if (items.length === 0) {
        chk.innerHTML = '<div class="es" style="padding:16px;font-size:.78rem">No closeout items yet.</div>';
      } else {
        chk.innerHTML = items.map((item, i) => `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04)">
          <input type="checkbox" ${item.done ? 'checked' : ''} data-action="updField" data-module="CloseItems" data-field="done" data-idx="${i}">
          <span style="${item.done ? 'text-decoration:line-through;color:var(--slate)' : ''}">${U.escapeHtml(item.text)}</span>
          <button class="btn btn-s btn-d" style="margin-left:auto" data-action="delCloseItem" data-idx="${i}">×</button>
        </div>`).join('');
      }
    }
    const well = $('ll-well');
    if (well) well.value = s.closure.well || '';
    const imp = $('ll-imp');
    if (imp) imp.value = s.closure.imp || '';
    const rec = $('ll-rec');
    if (rec) rec.value = s.closure.rec || '';
  }

  ns.RenderClosure = {
    renderPunchList: renderPunchList,
    renderHandover: renderHandover,
    renderWarranty: renderWarranty,
    renderClosure: renderClosure
  };
})(MMGR);
window.MMGR = MMGR;
