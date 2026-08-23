/* ============================================================
   My MaNaGeR , Stakeholder, Change & Log Management Module
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
        influence: 'Medium', interest: 'Medium', strategy: '', contact: '',
        // MARKET-FEATURE-ROADMAP A1/A5: subcontractor prequalification
        // tracking , COI/license expiry dates + EMR (Experience Modification
        // Rate). All optional; existing records stay backward-compatible.
        coiExpiry: '', licenseExpiry: '', emr: '', emrVerifiedAt: ''
      });
    });
    R.renderStakeholders();
  }

  // MARKET-FEATURE-ROADMAP A1: pure helper , every stakeholder whose COI or
  // trade-license expiry falls within `withinDays` (default 30). Returns the
  // flagged subset with per-item expiry flags so the UI can badge precisely.
  // Same dependency-free pattern as the schedule audit helpers.
  function getExpiringCompliance(stakeholders, withinDays) {
    const days = (withinDays === undefined || withinDays === null) ? 30 : +withinDays;
    const now = new Date();
    const soon = new Date(now.getTime() + days * 86400000);
    return (stakeholders || []).filter(function(s) {
      const coi = s.coiExpiry ? new Date(s.coiExpiry) : null;
      const lic = s.licenseExpiry ? new Date(s.licenseExpiry) : null;
      return (coi && coi <= soon) || (lic && lic <= soon);
    }).map(function(s) {
      const coi = s.coiExpiry ? new Date(s.coiExpiry) : null;
      const lic = s.licenseExpiry ? new Date(s.licenseExpiry) : null;
      return {
        id: s.id, name: s.name,
        coiExpiring: !!(coi && coi <= soon),
        licenseExpiring: !!(lic && lic <= soon)
      };
    });
  }

  // MARKET-FEATURE-ROADMAP A5: EMR staleness , never verified counts as stale;
  // otherwise stale after `staleAfterDays` (default 365) since verification.
  function isEmrStale(stakeholder, staleAfterDays) {
    if (!stakeholder) return false;
    if (!stakeholder.emrVerifiedAt) return true;
    const days = (staleAfterDays === undefined || staleAfterDays === null) ? 365 : +staleAfterDays;
    const verified = new Date(stakeholder.emrVerifiedAt);
    if (isNaN(verified.getTime())) return true;
    return (Date.now() - verified.getTime()) / 86400000 > days;
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

  // ---- Expiry & renewal rollup (MARKET-FEATURE-ROADMAP C29) ----
  // One dashboard-wide "whose expiry is coming up" view across every dated
  // compliance artifact: subcontractor COI/license + EMR staleness, warranty
  // periods, and permits. Pure function over live state , sorts by due date.
  function getExpiryRollup(withinDays) {
    const days = (withinDays === undefined || withinDays === null) ? 60 : +withinDays;
    const now = new Date();
    const soon = new Date(now.getTime() + days * 86400000);
    const s = ns.State ? ns.State.getState() : null;
    if (!s) return [];
    const out = [];
    function dueIn(d) {
      if (!d) return null;
      const dt = new Date(d);
      if (isNaN(dt.getTime())) return null;
      return Math.round((dt.getTime() - now.getTime()) / 86400000);
    }
    (s.stakeholders || []).forEach(function(st) {
      const coi = dueIn(st.coiExpiry);
      if (coi !== null && coi <= days) out.push({ kind: 'COI', label: (st.name || 'Stakeholder') + ' , COI', date: st.coiExpiry, daysLeft: coi });
      const lic = dueIn(st.licenseExpiry);
      if (lic !== null && lic <= days) out.push({ kind: 'License', label: (st.name || 'Stakeholder') + ' , license', date: st.licenseExpiry, daysLeft: lic });
      if (isEmrStale(st) && (st.emr || st.emr !== undefined)) out.push({ kind: 'EMR', label: (st.name || 'Stakeholder') + ' , EMR re-verification', date: '', daysLeft: null });
    });
    (s.warrantyItems || []).forEach(function(w) {
      const dl = dueIn(w.warrantyEnd);
      if (dl !== null && dl <= days) out.push({ kind: 'Warranty', label: (w.item || 'Warranty item') + ' , ' + (w.provider || 'provider'), date: w.warrantyEnd, daysLeft: dl });
    });
    (s.permits || []).forEach(function(p) {
      if (p.status === 'expired' || p.status === 'closed') return;
      const dl = dueIn(p.expires);
      if (dl !== null && dl <= days) out.push({ kind: 'Permit', label: (p.permitNo || p.id) + ' , ' + (p.agency || 'permit'), date: p.expires, daysLeft: dl });
    });
    return out.sort(function(a, b) {
      const da = a.date || '9999-12-31';
      const db = b.date || '9999-12-31';
      return da.localeCompare(db);
    });
  }

  // ---- API ----
  ns.Stakeholders = {
    addStake: addStake,
    updStake: updStake,
    delStake: delStake,
    getExpiringCompliance: getExpiringCompliance,
    isEmrStale: isEmrStale
  };

  ns.Compliance = {
    getExpiryRollup: getExpiryRollup,
    getExpiringCompliance: getExpiringCompliance,
    isEmrStale: isEmrStale
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