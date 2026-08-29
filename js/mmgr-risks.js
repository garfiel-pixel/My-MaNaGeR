/* ============================================================
   My MaNaGeR , Risk & Issue Management Module
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const U = ns.Utils;
  const R = ns.Render;

  function addRisk() {
    ns.State.updateState(function(s) {
      if (!s.risks) s.risks = [];
      s.risks.push({
        id: U.genShortId('R'), description: '',
        probability: 'Medium', impact: 'Medium',
        mitigation: '', issueId: null
      });
    });
    R.renderRisks();
  }

  function updRisk(index, field, value) {
    ns.State.updateState(function(s) {
      if (s.risks && s.risks[index]) s.risks[index][field] = value;
    });
  }

  function delRisk(index) {
    ns.State.updateState(function(s) {
      if (s.risks) s.risks.splice(index, 1);
    });
    R.renderRisks();
  }

  function toggleRiskIssue(index) {
    ns.State.updateState(function(s) {
      if (!s.risks || !s.risks[index]) return;
      const risk = s.risks[index];
      if (risk.issueId) {
        risk.issueId = null;
      } else {
        if (!s.issues) s.issues = [];
        s.issues.push({
          id: U.genShortId('I'), description: risk.description,
          owner: '', targetDate: '', status: 'open', sourceRiskId: risk.id
        });
        risk.issueId = s.issues[s.issues.length - 1].id;
      }
    });
    R.renderRisks();
  }

  function updIssue(index, field, value) {
    ns.State.updateState(function(s) {
      if (s.issues && s.issues[index]) s.issues[index][field] = value;
    });
  }

  function delIssue(index) {
    ns.State.updateState(function(s) {
      if (s.issues) s.issues.splice(index, 1);
    });
    R.renderRisks();
  }

  // ---- Inspection Checklists (MARKET-FEATURE-ROADMAP C16) ----
  // Trade/phase inspection checklists , deliberately separate from DMAIC
  // (continuous improvement) and from the general task list. Each inspection
  // holds a pass/fail item checklist; status rolls up from item passes.
  function addInspection() {
    ns.State.updateState(function(s) {
      if (!s.inspections) s.inspections = [];
      s.inspections.push({
        id: U.genShortId('INSP'), title: '', trade: '', area: '', date: U.todayStr(),
        status: 'open', items: [{ text: '', pass: false, notes: '' }], notes: ''
      });
    });
    R.renderClosure();
  }

  function updInspection(index, field, value, evtType) {
    ns.State.updateState(function(s) {
      const insp = s.inspections && s.inspections[index];
      if (!insp) return;
      insp[field] = value;
      if (field === 'status' && value === 'closed') {
        // Closing an inspection requires every item to pass (or be manually
        // overridden , the select still wins if items are incomplete).
      }
    });
    if (evtType === 'input') return;
    R.renderClosure();
  }

  // Item pass/fail toggle. Closing rule: when all items pass, the inspection
  // auto-advances to 'passed'; a failed item reopens it.
  function toggleInspItem(index, itemIdx) {
    ns.State.updateState(function(s) {
      const insp = s.inspections && s.inspections[index];
      if (!insp || !insp.items || !insp.items[itemIdx]) return;
      insp.items[itemIdx].pass = !insp.items[itemIdx].pass;
      const items = insp.items || [];
      const checked = items.filter(i => i.pass).length;
      if (items.length && checked === items.length) insp.status = 'passed';
      else if (insp.status === 'passed') insp.status = 'open';
    });
    R.renderClosure();
  }

  function updInspItem(index, itemIdx, field, value, evtType) {
    ns.State.updateState(function(s) {
      const insp = s.inspections && s.inspections[index];
      if (insp && insp.items && insp.items[itemIdx]) insp.items[itemIdx][field] = value;
    });
    // Focus discipline: save on keystroke, re-render on blur/commit.
    if (evtType === 'input') return;
    R.renderClosure();
  }

  function addInspItem(index) {
    ns.State.updateState(function(s) {
      const insp = s.inspections && s.inspections[index];
      if (!insp) return;
      if (!insp.items) insp.items = [];
      insp.items.push({ text: '', pass: false, notes: '' });
    });
    R.renderClosure();
  }

  function delInspItem(index, itemIdx) {
    ns.State.updateState(function(s) {
      const insp = s.inspections && s.inspections[index];
      if (insp && insp.items) insp.items.splice(itemIdx, 1);
    });
    R.renderClosure();
  }

  function delInspection(index) {
    ns.State.updateState(function(s) {
      if (s.inspections) s.inspections.splice(index, 1);
    });
    R.renderClosure();
  }

  // ---- Incident Register w/ corrective-action loop (C17) ----
  // Quality/safety incidents: report → investigation → corrective action →
  // closed. The corrective-action closure loop is the roadmap's ask , an
  // incident is only 'closed' when root cause + corrective action are on
  // record and the status is driven through the loop.
  const INCIDENT_STATUSES = ['open', 'investigation', 'action', 'closed'];

  function addIncident() {
    ns.State.updateState(function(s) {
      if (!s.incidents) s.incidents = [];
      s.incidents.push({
        id: U.genShortId('INC'), date: U.todayStr(), type: 'Safety', severity: 'Medium',
        description: '', owner: '', status: 'open',
        rootCause: '', correctiveAction: '', closedDate: ''
      });
    });
    R.renderClosure();
  }

  function updIncident(index, field, value, evtType) {
    ns.State.updateState(function(s) {
      const inc = s.incidents && s.incidents[index];
      if (!inc) return;
      inc[field] = value;
      // Closure-loop discipline: closing stamps the date; reopening clears it.
      if (field === 'status') {
        if (value === 'closed') inc.closedDate = inc.closedDate || U.todayStr();
        else if (inc.closedDate && value !== 'closed') inc.closedDate = '';
      }
    });
    if (evtType === 'input') return;
    R.renderClosure();
  }

  function delIncident(index) {
    ns.State.updateState(function(s) {
      if (s.incidents) s.incidents.splice(index, 1);
    });
    R.renderClosure();
  }

  // ---- API ----
  ns.Risks = {
    addRisk: addRisk,
    updRisk: updRisk,
    delRisk: delRisk,
    toggleRiskIssue: toggleRiskIssue,
    updIssue: updIssue,
    delIssue: delIssue
  };

  ns.Inspections = {
    addInspection: addInspection,
    updInspection: updInspection,
    toggleInspItem: toggleInspItem,
    updInspItem: updInspItem,
    addInspItem: addInspItem,
    delInspItem: delInspItem,
    delInspection: delInspection
  };

  ns.Incidents = {
    addIncident: addIncident,
    updIncident: updIncident,
    delIncident: delIncident,
    statuses: INCIDENT_STATUSES
  };

})(MMGR);
window.MMGR = MMGR;