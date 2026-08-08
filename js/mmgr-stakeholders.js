/* ============================================================
   My MaNaGeR — Stakeholder, Change & Log Management Module
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const U = ns.Utils;
  const R = ns.Render;

  // ---- Stakeholders ----
  function addStake() {
    ns.State.updateState(function(s) {
      if (!s.stakeholders) s.stakeholders = [];
      s.stakeholders.push({
        id: U.genShortId('S'), name: '', role: '',
        influence: 'Medium', interest: 'Medium', strategy: '', contact: ''
      });
    });
    R.renderStakeholders();
  }

  function updStake(index, field, value) {
    ns.State.updateState(function(s) {
      if (s.stakeholders && s.stakeholders[index]) s.stakeholders[index][field] = value;
    });
  }

  function delStake(index) {
    let removedId = null;
    ns.State.updateState(function(s) {
      if (s.stakeholders && s.stakeholders[index]) {
        removedId = s.stakeholders[index].id;
        s.stakeholders.splice(index, 1);
      }
    });
    // Keep the RACI matrix consistent: drop the deleted stakeholder's column.
    if (removedId != null && ns.Raci && ns.Raci.pruneDeleted) ns.Raci.pruneDeleted({ personIds: [removedId] });
    R.renderStakeholders();
  }

  // ---- Changes ----
  function addChange() {
    ns.State.updateState(function(s) {
      if (!s.changes) s.changes = [];
      s.changes.push({
        id: U.genShortId('C'), date: U.todayStr(), title: '',
        requester: '', schedImpact: '', costImpact: '',
        status: 'submitted', approvedBy: '', notes: ''
      });
    });
    R.renderChanges();
  }

  function updChange(index, field, value) {
    ns.State.updateState(function(s) {
      if (s.changes && s.changes[index]) s.changes[index][field] = value;
    });
  }

  function delChange(index) {
    ns.State.updateState(function(s) {
      if (s.changes) s.changes.splice(index, 1);
    });
    R.renderChanges();
  }

  // ---- Log ----
  function addLog() {
    ns.State.updateState(function(s) {
      if (!s.logEntries) s.logEntries = [];
      s.logEntries.push({
        date: new Date().toLocaleString(), decision: '', by: '', actionItems: ''
      });
    });
    R.renderLog();
  }

  function updLog(index, field, value) {
    ns.State.updateState(function(s) {
      if (s.logEntries && s.logEntries[index]) s.logEntries[index][field] = value;
    });
  }

  function delLog(index) {
    ns.State.updateState(function(s) {
      if (s.logEntries) s.logEntries.splice(index, 1);
    });
    R.renderLog();
  }

  // ---- API ----
  ns.Stakeholders = {
    addStake: addStake,
    updStake: updStake,
    delStake: delStake
  };

  ns.Changes = {
    addChange: addChange,
    updChange: updChange,
    delChange: delChange
  };

  ns.Log = {
    addLog: addLog,
    updLog: updLog,
    delLog: delLog
  };

})(MMGR);
window.MMGR = MMGR;