/* ============================================================
   My MaNaGeR , Closure, Comms & Documents Management Module
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const U = ns.Utils;
  const R = ns.Render;

  // ---- Closure ----
  function addCloseItem() {
    ns.State.updateState(function(s) {
      if (!s.closure) s.closure = { items: [], well: '', imp: '', rec: '' };
      if (!s.closure.items) s.closure.items = [];
      s.closure.items.push({ text: '', done: false });
    });
    R.renderClosure();
  }

  function updCloseItem(index, done) {
    ns.State.updateState(function(s) {
      if (s.closure && s.closure.items && s.closure.items[index]) {
        s.closure.items[index].done = !!done;
      }
    });
    R.renderClosure(); // reflect the checkbox strikethrough immediately
  }

  function delCloseItem(index) {
    ns.State.updateState(function(s) {
      if (s.closure && s.closure.items) s.closure.items.splice(index, 1);
    });
    R.renderClosure();
  }

  function updClose(field, value) {
    ns.State.updateState(function(s) {
      if (!s.closure) s.closure = { items: [], well: '', imp: '', rec: '' };
      s.closure[field] = value;
    });
  }

  // ---- Comms ----
  function addComms() {
    ns.State.updateState(function(s) {
      if (!s.commsEntries) s.commsEntries = [];
      s.commsEntries.push({
        id: U.genShortId('C'), date: U.todayStr(), type: 'Meeting',
        attendees: '', summary: '', actionItems: '', followUp: ''
      });
    });
    R.renderComms();
  }

  function updComms(index, field, value) {
    ns.State.updateState(function(s) {
      if (s.commsEntries && s.commsEntries[index]) s.commsEntries[index][field] = value;
    });
  }

  function delComms(index) {
    ns.State.updateState(function(s) {
      if (s.commsEntries) s.commsEntries.splice(index, 1);
    });
    R.renderComms();
  }

  // ---- RFI Register (MARKET-FEATURE-ROADMAP C1) ----
  // question → routing → response → ball-in-court status. Zero third-party:
  // plain state records with a lifecycle + a "whose turn is it" field.
  function addRfi() {
    ns.State.updateState(function(s) {
      if (!s.rfis) s.rfis = [];
      s.rfis.push({
        id: U.genShortId('RFI'), number: '', question: '', from: '', to: '',
        dateIssued: U.todayStr(), dueDate: '', status: 'open',
        response: '', ballInCourt: '', linkedTaskId: ''
      });
    });
    R.renderDocuments();
  }

  function updRfi(index, field, value, evtType) {
    ns.State.updateState(function(s) {
      if (s.rfis && s.rfis[index]) s.rfis[index][field] = value;
    });
    // Focus discipline: save on keystroke, re-render on blur/commit so the
    // open/closed summary stays live.
    if (evtType === 'input') return;
    R.renderDocuments();
  }

  function delRfi(index) {
    ns.State.updateState(function(s) {
      if (s.rfis) s.rfis.splice(index, 1);
    });
    R.renderDocuments();
  }

  // ---- Submittal Register (MARKET-FEATURE-ROADMAP C2) ----
  // material/shop-drawing approval workflow , distinct from RFIs (they are
  // document approvals, not questions).
  function addSubmittal() {
    ns.State.updateState(function(s) {
      if (!s.submittals) s.submittals = [];
      s.submittals.push({
        id: U.genShortId('SUB'), number: '', item: '', trade: '',
        submittedTo: '', dateSubmitted: U.todayStr(), status: 'pending',
        responseDate: '', notes: '', ballInCourt: ''
      });
    });
    R.renderDocuments();
  }

  function updSubmittal(index, field, value, evtType) {
    ns.State.updateState(function(s) {
      if (s.submittals && s.submittals[index]) s.submittals[index][field] = value;
    });
    if (evtType === 'input') return;
    R.renderDocuments();
  }

  function delSubmittal(index) {
    ns.State.updateState(function(s) {
      if (s.submittals) s.submittals.splice(index, 1);
    });
    R.renderDocuments();
  }

  // ---- Punch List (MARKET-FEATURE-ROADMAP C3) ----
  // Dedicated defect/closeout items with photo-less location + assignee +
  // category + priority , separate from the general task list AND from the
  // simple closeout checklist (which stays as-is for broad closeout items).
  function addPunch() {
    ns.State.updateState(function(s) {
      if (!s.punchList) s.punchList = [];
      s.punchList.push({
        id: U.genShortId('P'), item: '', location: '', assignee: '',
        category: 'Defect', priority: 'Medium', status: 'open', notes: ''
      });
    });
    R.renderClosure();
  }

  function updPunch(index, field, value, evtType) {
    ns.State.updateState(function(s) {
      if (s.punchList && s.punchList[index]) s.punchList[index][field] = value;
    });
    if (evtType === 'input') return;
    R.renderClosure();
  }

  function delPunch(index) {
    ns.State.updateState(function(s) {
      if (s.punchList) s.punchList.splice(index, 1);
    });
    R.renderClosure();
  }

  // ---- Handover / Closeout Package (MARKET-FEATURE-ROADMAP C18) ----
  // Bundled O&M / warranty / as-built / certificate / sign-off package , the
  // roadmap's ask was a bundled package distinct from the Closure checklist.
  function addHandoverItem() {
    ns.State.updateState(function(s) {
      if (!s.handover) s.handover = [];
      s.handover.push({
        id: U.genShortId('HO'), item: '', category: 'O&M Manual',
        status: 'required', notes: ''
      });
    });
    R.renderClosure();
  }

  function updHandoverItem(index, field, value, evtType) {
    ns.State.updateState(function(s) {
      if (s.handover && s.handover[index]) s.handover[index][field] = value;
    });
    if (evtType === 'input') return;
    R.renderClosure();
  }

  function delHandoverItem(index) {
    ns.State.updateState(function(s) {
      if (s.handover) s.handover.splice(index, 1);
    });
    R.renderClosure();
  }

  // ---- Warranty Tracker (MARKET-FEATURE-ROADMAP C26) ----
  // Warranty periods with end dates , feeds the C29 expiry rollup.
  function addWarranty() {
    ns.State.updateState(function(s) {
      if (!s.warrantyItems) s.warrantyItems = [];
      s.warrantyItems.push({
        id: U.genShortId('WR'), item: '', provider: '',
        warrantyStart: '', warrantyEnd: '', notes: ''
      });
    });
    R.renderClosure();
  }

  function updWarranty(index, field, value, evtType) {
    ns.State.updateState(function(s) {
      if (s.warrantyItems && s.warrantyItems[index]) s.warrantyItems[index][field] = value;
    });
    if (evtType === 'input') return;
    R.renderClosure();
  }

  function delWarranty(index) {
    ns.State.updateState(function(s) {
      if (s.warrantyItems) s.warrantyItems.splice(index, 1);
    });
    R.renderClosure();
  }

  // ---- Drawing Distribution Log (MARKET-FEATURE-ROADMAP C11) ----
  // Who received which drawing revision, when, and by what method.
  function addDrawLog() {
    ns.State.updateState(function(s) {
      if (!s.drawingLog) s.drawingLog = [];
      s.drawingLog.push({
        id: U.genShortId('DL'), date: U.todayStr(), drawingNo: '', rev: '',
        distributedTo: '', method: 'Email', notes: ''
      });
    });
    R.renderDocuments();
  }

  function updDrawLog(index, field, value, evtType) {
    ns.State.updateState(function(s) {
      if (s.drawingLog && s.drawingLog[index]) s.drawingLog[index][field] = value;
    });
    if (evtType === 'input') return;
    R.renderDocuments();
  }

  function delDrawLog(index) {
    ns.State.updateState(function(s) {
      if (s.drawingLog) s.drawingLog.splice(index, 1);
    });
    R.renderDocuments();
  }

  // ---- Permit Register (MARKET-FEATURE-ROADMAP C30) ----
  // Dedicated permit status/expiry tracking , feeds the C29 expiry rollup.
  function addPermit() {
    ns.State.updateState(function(s) {
      if (!s.permits) s.permits = [];
      s.permits.push({
        id: U.genShortId('PM'), permitNo: '', type: '', agency: '',
        dateIssued: '', expires: '', status: 'active', notes: ''
      });
    });
    R.renderDocuments();
  }

  function updPermit(index, field, value, evtType) {
    ns.State.updateState(function(s) {
      if (s.permits && s.permits[index]) s.permits[index][field] = value;
    });
    if (evtType === 'input') return;
    R.renderDocuments();
  }

  function delPermit(index) {
    ns.State.updateState(function(s) {
      if (s.permits) s.permits.splice(index, 1);
    });
    R.renderDocuments();
  }

  // ---- Ball-in-court rollup (MARKET-FEATURE-ROADMAP C6) ----
  // Cross-module "whose turn is it": open RFIs + submittals awaiting action
  // (their explicit ballInCourt fields) plus every open issue (its owner).
  // Pure function over state , reads live state, renders nothing.
  function getBallInCourt() {
    const s = ns.State ? ns.State.getState() : null;
    if (!s) return [];
    const out = [];
    (s.rfis || []).forEach(function(r) {
      if (r.status === 'open' || r.status === 'routed') {
        out.push({ kind: 'RFI', ref: r.number || r.id, who: r.ballInCourt || 'You', due: r.dueDate || '', tag: 'rfis' });
      }
    });
    (s.submittals || []).forEach(function(m) {
      if (m.status === 'pending' || m.status === 'review') {
        out.push({ kind: 'Submittal', ref: m.number || m.id, who: m.ballInCourt || 'You', due: m.responseDate || '', tag: 'submittals' });
      }
    });
    (s.issues || []).forEach(function(i) {
      if (i.status && i.status !== 'closed' && i.status !== 'resolved') {
        out.push({ kind: 'Issue', ref: i.id, who: i.owner || '-', due: i.targetDate || '', tag: 'issues' });
      }
    });
    return out.sort(function(a, b) { return (a.due || '9999').localeCompare(b.due || '9999'); });
  }

  // ---- Documents ----
  function addDoc() {
    ns.State.updateState(function(s) {
      if (!s.documents) s.documents = [];
      s.documents.push({
        id: U.genShortId('D'), docNo: '', title: '', type: 'Drawing',
        version: '1', status: 'current', responsible: '', dateIssued: '', notes: ''
      });
    });
    R.renderDocuments();
  }

  function updDoc(index, field, value) {
    ns.State.updateState(function(s) {
      if (s.documents && s.documents[index]) s.documents[index][field] = value;
    });
  }

  function delDoc(index) {
    ns.State.updateState(function(s) {
      if (s.documents) s.documents.splice(index, 1);
    });
    R.renderDocuments();
  }

  // ---- API ----
  ns.Closure = {
    addCloseItem: addCloseItem,
    updCloseItem: updCloseItem,
    delCloseItem: delCloseItem,
    updClose: updClose
  };

  ns.Comms = {
    addComms: addComms,
    updComms: updComms,
    delComms: delComms
  };

  ns.Documents = {
    addDoc: addDoc,
    updDoc: updDoc,
    delDoc: delDoc
  };

  ns.Rfis = {
    addRfi: addRfi,
    updRfi: updRfi,
    delRfi: delRfi
  };

  ns.Submittals = {
    addSubmittal: addSubmittal,
    updSubmittal: updSubmittal,
    delSubmittal: delSubmittal
  };

  ns.PunchList = {
    addPunch: addPunch,
    updPunch: updPunch,
    delPunch: delPunch
  };

  ns.Handover = {
    addHandoverItem: addHandoverItem,
    updHandoverItem: updHandoverItem,
    delHandoverItem: delHandoverItem
  };

  ns.Warranty = {
    addWarranty: addWarranty,
    updWarranty: updWarranty,
    delWarranty: delWarranty
  };

  ns.DrawingLog = {
    addDrawLog: addDrawLog,
    updDrawLog: updDrawLog,
    delDrawLog: delDrawLog
  };

  ns.Permits = {
    addPermit: addPermit,
    updPermit: updPermit,
    delPermit: delPermit
  };

  // ---- Procurement Log (MARKET-FEATURE-ROADMAP C10) ----
  // Material orders, delivery tracking, lead times.
  function addProcurement() {
    ns.State.updateState(function(s) {
      if (!s.procurement) s.procurement = [];
      s.procurement.push({
        id: U.genShortId('PO'), material: '', vendor: '', quantity: '',
        unit: '', orderDate: '', expectedDate: '', receivedDate: '',
        status: 'ordered', cost: '', notes: ''
      });
    });
    R.renderDocuments();
  }

  function updProcurement(index, field, value, evtType) {
    ns.State.updateState(function(s) {
      if (s.procurement && s.procurement[index]) s.procurement[index][field] = value;
    });
    if (evtType === 'input') return;
    R.renderDocuments();
  }

  function delProcurement(index) {
    ns.State.updateState(function(s) {
      if (s.procurement) s.procurement.splice(index, 1);
    });
    R.renderDocuments();
  }

  ns.Procurement = {
    addProcurement: addProcurement,
    updProcurement: updProcurement,
    delProcurement: delProcurement
  };

  ns.BallInCourt = {
    getBallInCourt: getBallInCourt
  };

})(MMGR);
window.MMGR = MMGR;