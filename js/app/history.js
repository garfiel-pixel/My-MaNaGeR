/* ============================================================
   My MaNaGeR , History (Undo / Redo / Hold-to-Clear)
   Persistent undo/redo stack, hold-to-clear, section clear.
   Extracted from mmgr-app.js.
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const U = ns.Utils;
  const $ = U.$;

  function _toast(msg, type) { if (ns.App && ns.App.showToast) ns.App.showToast(msg, type); }
  function _R() { return ns.Render; }

  // ---- Hold to Clear ----
  let holdTimer = null;
  let holdShowedBar = false;
  const HOLD_MSG_ON = ' Hold to clear , release to cancel';
  const HOLD_MSG_OFF = ' Page cleared.';

  function startHold(section) {
    if (holdTimer) return;
    const dur = $('ut');
    if (dur) dur.textContent = '10';
    const ub = $('ub');
    if (ub && !ub.classList.contains('vis')) {
      ub.classList.add('vis');
      holdShowedBar = true;
    }
    const msg = $('ub-msg');
    if (msg) msg.textContent = HOLD_MSG_ON;
    holdTimer = setInterval(() => {
      const el = $('ut');
      if (el) {
        const v = parseInt(el.textContent) - 1;
        el.textContent = v;
        if (v <= 0) {
          clearInterval(holdTimer);
          holdTimer = null;
          holdShowedBar = false;
          clearSection(section);
        }
      }
    }, 1000);
  }

  function cancelHold() {
    if (!holdTimer) return;
    clearInterval(holdTimer);
    holdTimer = null;
    if (holdShowedBar) {
      const ub = $('ub');
      if (ub) ub.classList.remove('vis');
      holdShowedBar = false;
    }
    const msg = $('ub-msg');
    if (msg) msg.textContent = HOLD_MSG_OFF;
    const dur = $('ut');
    if (dur) dur.textContent = '5';
  }

  function clearSection(section) {
    ns.State.pushUndo();
    ns.State.updateState(function(s) {
      switch(section) {
        case 'wbs': s.tasks = []; break;
        case 'risk': s.risks = []; s.issues = []; break;
        case 'log': s.logEntries = []; break;
        case 'kan': s.tasks = s.tasks.filter(t => t.status === 'completed'); break;
        case 'comms': s.commsEntries = []; break;
      }
    });
    _R().renderWbs();
    _R().renderKanban();
    _R().renderRisks();
    _R().renderLog();
    _R().renderComms();
    _R().renderDash();
    const ub = $('ub');
    if (ub) { ub.classList.add('vis'); setTimeout(() => ub.classList.remove('vis'), 5000); }
    const msg = $('ub-msg');
    if (msg) msg.textContent = HOLD_MSG_OFF;
    updateUndoUi();
  }

  function undoClr() {
    const ub = $('ub');
    if (ub) ub.classList.remove('vis');
    if (ns.State.undo()) {
      _R().renderAll();
      if (ns.Charter) ns.Charter.loadCharterData();
      if (ns.Sprint) ns.Sprint.loadSprintData();
      _toast('Undone.', 'ok');
    } else {
      _toast('Nothing to undo.', 'err');
    }
    updateUndoUi();
  }

  // ---- Persistent Undo / Redo ----
  function undo() {
    if (ns.State.undo()) {
      _R().renderAll();
      if (ns.Charter) ns.Charter.loadCharterData();
      if (ns.Sprint) ns.Sprint.loadSprintData();
      _toast('Undone.', 'ok');
    } else {
      _toast('Nothing to undo.', 'err');
    }
    updateUndoUi();
  }

  function redo() {
    if (ns.State.redo()) {
      _R().renderAll();
      if (ns.Charter) ns.Charter.loadCharterData();
      if (ns.Sprint) ns.Sprint.loadSprintData();
      _toast('Redone.', 'ok');
    } else {
      _toast('Nothing to redo.', 'err');
    }
    updateUndoUi();
  }

  function updateUndoUi() {
    const u = $('undo-btn');
    if (u) u.textContent = 'Undo' + (ns.State.undoDepth() ? ' (' + ns.State.undoDepth() + ')' : '');
    const r = $('redo-btn');
    if (r) r.textContent = 'Redo' + (ns.State.redoDepth() ? ' (' + ns.State.redoDepth() + ')' : '');
  }

  ns.AppHistory = {
    startHold: startHold,
    cancelHold: cancelHold,
    clearSection: clearSection,
    undoClr: undoClr,
    undo: undo,
    redo: redo,
    updateUndoUi: updateUndoUi
  };
})(MMGR);
window.MMGR = MMGR;
