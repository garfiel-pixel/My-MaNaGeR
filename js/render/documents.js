/* ============================================================
   My MaNaGeR , Documents Panel
   RFI Register, Submittal Register, Ball-in-court rollup,
   Drawing Distribution Log, Permit Register.
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

  // ---- RFI Register (MARKET-FEATURE-ROADMAP C1) ----
  function renderRfis() {
    const s = S();
    if (!s) return;
    const body = $('rfi-body');
    if (!body) return;
    const list = s.rfis || [];
    const open = list.filter(r => r.status !== 'closed').length;
    const sum = $('rfi-sum');
    if (sum) sum.textContent = list.length ? (open + ' open · ' + (list.length - open) + ' closed') : '';
    if (list.length === 0) {
      body.innerHTML = emptyStateRow(11, 'No RFIs yet.', '<button class="btn btn-g btn-s" data-action="addRfi">+ Add RFI</button>');
      return;
    }
    const statusColor = (st) => st === 'closed' ? 'var(--green)' : st === 'responded' ? 'var(--gold)' : st === 'routed' ? 'var(--amber)' : 'var(--danger)';
    body.innerHTML = list.map((r, i) => `<tr>
      <td>${U.escapeHtml(r.number || r.id || 'R' + (i+1))}</td>
      <td><input type="text" value="${U.escapeHtml(r.question)}" data-action="updField" data-module="Rfis" data-field="question" data-idx="${i}" style="min-width:180px" placeholder="The question / discrepancy"></td>
      <td><input type="text" value="${U.escapeHtml(r.from || '')}" data-action="updField" data-module="Rfis" data-field="from" data-idx="${i}" placeholder="From"></td>
      <td><input type="text" value="${U.escapeHtml(r.to || '')}" data-action="updField" data-module="Rfis" data-field="to" data-idx="${i}" placeholder="To (designer / engineer)"></td>
      <td><input type="date" value="${r.dateIssued || ''}" data-action="updField" data-module="Rfis" data-field="dateIssued" data-idx="${i}"></td>
      <td><input type="date" value="${r.dueDate || ''}" data-action="updField" data-module="Rfis" data-field="dueDate" data-idx="${i}" title="Response due"></td>
      <td><select data-action="updField" data-module="Rfis" data-field="status" data-idx="${i}" style="color:${statusColor(r.status)}">${['open','routed','responded','closed'].map(v => `<option ${r.status === v ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td><input type="text" value="${U.escapeHtml(r.ballInCourt || '')}" data-action="updField" data-module="Rfis" data-field="ballInCourt" data-idx="${i}" placeholder="Whose turn is it" title="Ball-in-court , whose turn to respond"></td>
      <td><input type="text" value="${U.escapeHtml(r.response || '')}" data-action="updField" data-module="Rfis" data-field="response" data-idx="${i}" style="min-width:140px" placeholder="Response / answer"></td>
      <td><button class="btn btn-s btn-d" data-action="delRfi" data-idx="${i}">×</button></td>
    </tr>`).join('');
  }

  // ---- Submittal Register (MARKET-FEATURE-ROADMAP C2) ----
  function renderSubmittals() {
    const s = S();
    if (!s) return;
    const body = $('sub-body');
    if (!body) return;
    const list = s.submittals || [];
    const approved = list.filter(x => x.status === 'approved' || x.status === 'approved-comments').length;
    const pending = list.filter(x => x.status === 'pending' || x.status === 'review').length;
    const sum = $('sub-sum');
    if (sum) sum.textContent = list.length ? (approved + ' approved · ' + pending + ' pending') : '';
    if (list.length === 0) {
      body.innerHTML = emptyStateRow(10, 'No submittals yet.', '<button class="btn btn-g btn-s" data-action="addSubmittal">+ Add Submittal</button>');
      return;
    }
    const statusColor = (st) => st === 'approved' ? 'var(--green)' : st === 'approved-comments' ? 'var(--gold)' : st === 'rejected' ? 'var(--danger)' : 'var(--amber)';
    body.innerHTML = list.map((x, i) => `<tr>
      <td>${U.escapeHtml(x.number || x.id || 'S' + (i+1))}</td>
      <td><input type="text" value="${U.escapeHtml(x.item)}" data-action="updField" data-module="Submittals" data-field="item" data-idx="${i}" style="min-width:180px" placeholder="Material / shop drawing"></td>
      <td><input type="text" value="${U.escapeHtml(x.trade || '')}" data-action="updField" data-module="Submittals" data-field="trade" data-idx="${i}" placeholder="Trade"></td>
      <td><input type="text" value="${U.escapeHtml(x.submittedTo || '')}" data-action="updField" data-module="Submittals" data-field="submittedTo" data-idx="${i}" placeholder="Architect / engineer"></td>
      <td><input type="date" value="${x.dateSubmitted || ''}" data-action="updField" data-module="Submittals" data-field="dateSubmitted" data-idx="${i}"></td>
      <td><select data-action="updField" data-module="Submittals" data-field="status" data-idx="${i}" style="color:${statusColor(x.status)}">${['pending','review','approved','approved-comments','rejected'].map(v => `<option ${x.status === v ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td><input type="date" value="${x.responseDate || ''}" data-action="updField" data-module="Submittals" data-field="responseDate" data-idx="${i}" title="Response date"></td>
      <td><input type="text" value="${U.escapeHtml(x.ballInCourt || '')}" data-action="updField" data-module="Submittals" data-field="ballInCourt" data-idx="${i}" placeholder="Whose turn is it" title="Ball-in-court"></td>
      <td><input type="text" value="${U.escapeHtml(x.notes || '')}" data-action="updField" data-module="Submittals" data-field="notes" data-idx="${i}" placeholder="-"></td>
      <td><button class="btn btn-s btn-d" data-action="delSubmittal" data-idx="${i}">×</button></td>
    </tr>`).join('');
  }

  // ---- Ball-in-court rollup (MARKET-FEATURE-ROADMAP C6) ----
  function renderBallInCourt() {
    const s = S();
    if (!s) return;
    const body = $('blc-body');
    if (!body) return;
    const list = (ns.BallInCourt && ns.BallInCourt.getBallInCourt)
      ? ns.BallInCourt.getBallInCourt() : [];
    const sum = $('blc-sum');
    if (sum) sum.textContent = list.length ? (list.length + ' items awaiting action') : '';
    if (list.length === 0) {
      body.innerHTML = '<div class="es" style="padding:14px;font-size:.78rem">Nothing awaiting action , every open item has a named next step or none is open.</div>';
      return;
    }
    const kindColor = (k) => k === 'RFI' ? 'var(--gold)' : k === 'Submittal' ? 'var(--cyan)' : 'var(--amber)';
    body.innerHTML = list.map((x) => `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04)">
      <span class="badge" style="color:${kindColor(x.kind)};border-color:${kindColor(x.kind)}">${x.kind}</span>
      <span style="flex:1;font-size:.8rem">${U.escapeHtml(x.ref)} , ${U.escapeHtml(x.who)}${x.due ? ' <span style="color:var(--slate)">due ' + U.escapeHtml(x.due) + '</span>' : ''}</span>
    </div>`).join('');
  }

  // ---- Drawing Distribution Log (MARKET-FEATURE-ROADMAP C11) ----
  function renderDrawLog() {
    const s = S();
    if (!s) return;
    const body = $('drawlog-body');
    if (!body) return;
    const list = s.drawingLog || [];
    const sum = $('drawlog-sum');
    if (sum) sum.textContent = list.length ? (list.length + ' distributions') : '';
    if (list.length === 0) {
      body.innerHTML = emptyStateRow(8, 'No drawing distributions logged yet.', '<button class="btn btn-g btn-s" data-action="addDrawLog">+ Add Distribution</button>');
      return;
    }
    body.innerHTML = list.map((x, i) => `<tr>
      <td>${U.escapeHtml(x.id || 'DL' + (i+1))}</td>
      <td><input type="date" value="${x.date || ''}" data-action="updField" data-module="DrawingLog" data-field="date" data-idx="${i}"></td>
      <td><input type="text" value="${U.escapeHtml(x.drawingNo)}" data-action="updField" data-module="DrawingLog" data-field="drawingNo" data-idx="${i}" style="min-width:100px" placeholder="Drawing no."></td>
      <td><input type="text" value="${U.escapeHtml(x.rev || '')}" data-action="updField" data-module="DrawingLog" data-field="rev" data-idx="${i}" style="width:50px" placeholder="Rev"></td>
      <td><input type="text" value="${U.escapeHtml(x.distributedTo || '')}" data-action="updField" data-module="DrawingLog" data-field="distributedTo" data-idx="${i}" style="min-width:120px" placeholder="Distributed to"></td>
      <td><select data-action="updField" data-module="DrawingLog" data-field="method" data-idx="${i}">${['Email','Print','Portal','Hand'].map(v => `<option ${x.method === v ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td><input type="text" value="${U.escapeHtml(x.notes || '')}" data-action="updField" data-module="DrawingLog" data-field="notes" data-idx="${i}" placeholder="-"></td>
      <td><button class="btn btn-s btn-d" data-action="delDrawLog" data-idx="${i}">×</button></td>
    </tr>`).join('');
  }

  // ---- Permit Register (MARKET-FEATURE-ROADMAP C30) ----
  function renderPermits() {
    const s = S();
    if (!s) return;
    const body = $('permit-body');
    if (!body) return;
    const list = s.permits || [];
    const sum = $('permit-sum');
    const active = list.filter(x => x.status === 'active').length;
    if (sum) sum.textContent = list.length ? (active + ' active') : '';
    if (list.length === 0) {
      body.innerHTML = emptyStateRow(9, 'No permits tracked yet.', '<button class="btn btn-g btn-s" data-action="addPermit">+ Add Permit</button>');
      return;
    }
    function dl(d) {
      if (!d) return null;
      const dt = new Date(d);
      if (isNaN(dt.getTime())) return null;
      return Math.round((dt.getTime() - Date.now()) / 86400000);
    }
    const statusColor = (st) => st === 'active' ? 'var(--green)' : st === 'applied' ? 'var(--amber)' : st === 'expiring' ? 'var(--amber)' : st === 'expired' ? 'var(--danger)' : 'var(--slate)';
    body.innerHTML = list.map((x, i) => {
      const left = dl(x.expires);
      const expiryTxt = left === null ? '' : left < 0 ? ' <span style="color:var(--danger)">expired ' + Math.abs(left) + 'd ago</span>' : left <= 30 ? ' <span style="color:var(--amber)">' + left + 'd left</span>' : '';
      return `<tr>
      <td>${U.escapeHtml(x.id || 'PM' + (i+1))}</td>
      <td><input type="text" value="${U.escapeHtml(x.permitNo)}" data-action="updField" data-module="Permits" data-field="permitNo" data-idx="${i}" style="min-width:90px" placeholder="Permit no."></td>
      <td><input type="text" value="${U.escapeHtml(x.type || '')}" data-action="updField" data-module="Permits" data-field="type" data-idx="${i}" style="width:110px" placeholder="Type"></td>
      <td><input type="text" value="${U.escapeHtml(x.agency || '')}" data-action="updField" data-module="Permits" data-field="agency" data-idx="${i}" style="min-width:110px" placeholder="Agency"></td>
      <td><input type="date" value="${x.dateIssued || ''}" data-action="updField" data-module="Permits" data-field="dateIssued" data-idx="${i}"></td>
      <td><input type="date" value="${x.expires || ''}" data-action="updField" data-module="Permits" data-field="expires" data-idx="${i}">${expiryTxt}</td>
      <td><select data-action="updField" data-module="Permits" data-field="status" data-idx="${i}" style="color:${statusColor(x.status)}">${['applied','active','expiring','expired','closed'].map(v => `<option ${x.status === v ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td><input type="text" value="${U.escapeHtml(x.notes || '')}" data-action="updField" data-module="Permits" data-field="notes" data-idx="${i}" placeholder="-"></td>
      <td><button class="btn btn-s btn-d" data-action="delPermit" data-idx="${i}">×</button></td>
    </tr>`;
    }).join('');
  }

  // ---- Procurement Log (MARKET-FEATURE-ROADMAP C10) ----
  function renderProcurement() {
    const s = S();
    if (!s) return;
    const body = $('proc-body');
    if (!body) return;
    const list = s.procurement || [];
    const sum = $('proc-sum');
    const ordered = list.filter(x => x.status === 'ordered').length;
    const inTransit = list.filter(x => x.status === 'in-transit').length;
    if (sum) sum.textContent = list.length ? (ordered + ' ordered, ' + inTransit + ' in transit') : '';
    if (list.length === 0) {
      body.innerHTML = emptyStateRow(9, 'No procurement items tracked yet.', '<button class="btn btn-g btn-s" data-action="addProcurement">+ Add Order</button>');
      return;
    }
    function dl(d) {
      if (!d) return null;
      const dt = new Date(d);
      if (isNaN(dt.getTime())) return null;
      return Math.round((dt.getTime() - Date.now()) / 86400000);
    }
    const statusColor = (st) => st === 'received' ? 'var(--green)' : st === 'in-transit' ? 'var(--gold)' : st === 'ordered' ? 'var(--slate)' : st === 'cancelled' ? 'var(--danger)' : 'var(--slate)';
    body.innerHTML = list.map((x, i) => {
      const left = dl(x.expectedDate);
      const etaTxt = left === null ? '' : left < 0 ? ' <span style="color:var(--danger)">overdue ' + Math.abs(left) + 'd</span>' : left <= 7 ? ' <span style="color:var(--amber)">' + left + 'd left</span>' : '';
      return `<tr>
      <td>${U.escapeHtml(x.id || 'PO' + (i+1))}</td>
      <td><input type="text" value="${U.escapeHtml(x.material)}" data-action="updField" data-module="Procurement" data-field="material" data-idx="${i}" style="min-width:120px" placeholder="Material"></td>
      <td><input type="text" value="${U.escapeHtml(x.vendor || '')}" data-action="updField" data-module="Procurement" data-field="vendor" data-idx="${i}" style="min-width:100px" placeholder="Vendor"></td>
      <td><input type="text" value="${U.escapeHtml(x.quantity || '')}" data-action="updField" data-module="Procurement" data-field="quantity" data-idx="${i}" style="width:60px" placeholder="Qty"></td>
      <td><input type="text" value="${U.escapeHtml(x.unit || '')}" data-action="updField" data-module="Procurement" data-field="unit" data-idx="${i}" style="width:50px" placeholder="Unit"></td>
      <td><input type="date" value="${x.orderDate || ''}" data-action="updField" data-module="Procurement" data-field="orderDate" data-idx="${i}"></td>
      <td><input type="date" value="${x.expectedDate || ''}" data-action="updField" data-module="Procurement" data-field="expectedDate" data-idx="${i}">${etaTxt}</td>
      <td><input type="date" value="${x.receivedDate || ''}" data-action="updField" data-module="Procurement" data-field="receivedDate" data-idx="${i}"></td>
      <td><select data-action="updField" data-module="Procurement" data-field="status" data-idx="${i}" style="color:${statusColor(x.status)}">${['ordered','in-transit','received','cancelled'].map(v => `<option ${x.status === v ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td><input type="text" value="${U.escapeHtml(x.cost || '')}" data-action="updField" data-module="Procurement" data-field="cost" data-idx="${i}" style="width:80px" placeholder="$"></td>
      <td><input type="text" value="${U.escapeHtml(x.notes || '')}" data-action="updField" data-module="Procurement" data-field="notes" data-idx="${i}" placeholder="-"></td>
      <td><button class="btn btn-s btn-d" data-action="delProcurement" data-idx="${i}">×</button></td>
    </tr>`;
    }).join('');
  }

  function renderDocuments() {
    const s = S();
    if (!s) return;
    renderRfis();
    renderSubmittals();
    renderBallInCourt();
    renderDrawLog();
    renderPermits();
    renderProcurement();
    const body = $('doc-body');
    if (!body) return;
    const docs = s.documents || [];
    if (docs.length === 0) {
      body.innerHTML = emptyStateRow(10, 'No documents registered yet.', '<button class="btn btn-g btn-s" data-action="addDoc">+ Add Document</button>');
      return;
    }
    body.innerHTML = docs.map((d, i) => `<tr>
      <td>${U.escapeHtml(d.id || 'D' + (i+1))}</td>
      <td><input type="text" value="${U.escapeHtml(d.docNo || '')}" data-action="updField" data-module="Documents" data-field="docNo" data-idx="${i}"></td>
      <td><input type="text" value="${U.escapeHtml(d.title)}" data-action="updField" data-module="Documents" data-field="title" data-idx="${i}"></td>
      <td><select data-action="updField" data-module="Documents" data-field="type" data-idx="${i}">${['Drawing','Contract','Permit','Specification','Report','Other'].map(t => `<option ${d.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
      <td><input type="text" value="${d.version || ''}" data-action="updField" data-module="Documents" data-field="version" data-idx="${i}" style="width:50px"></td>
      <td><select data-action="updField" data-module="Documents" data-field="status" data-idx="${i}">${['current','pending-review','superseded','outstanding'].map(s => `<option ${d.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
      <td><input type="text" value="${U.escapeHtml(d.responsible || '')}" data-action="updField" data-module="Documents" data-field="responsible" data-idx="${i}"></td>
      <td><input type="date" value="${d.dateIssued || ''}" data-action="updField" data-module="Documents" data-field="dateIssued" data-idx="${i}"></td>
      <td><input type="text" value="${U.escapeHtml(d.notes || '')}" data-action="updField" data-module="Documents" data-field="notes" data-idx="${i}"></td>
      <td><button class="btn btn-s btn-d" data-action="delDoc" data-idx="${i}">×</button></td>
    </tr>`).join('');
  }

  ns.RenderDocs = {
    renderRfis: renderRfis,
    renderSubmittals: renderSubmittals,
    renderBallInCourt: renderBallInCourt,
    renderDrawLog: renderDrawLog,
    renderPermits: renderPermits,
    renderProcurement: renderProcurement,
    renderDocuments: renderDocuments
  };
})(MMGR);
window.MMGR = MMGR;
