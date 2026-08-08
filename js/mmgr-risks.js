/* ============================================================
   My MaNaGeR — Risk & Issue Management Module
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

  // ---- API ----
  ns.Risks = {
    addRisk: addRisk,
    updRisk: updRisk,
    delRisk: delRisk,
    toggleRiskIssue: toggleRiskIssue,
    updIssue: updIssue,
    delIssue: delIssue
  };

})(MMGR);
window.MMGR = MMGR;