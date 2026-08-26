/* ============================================================
   My MaNaGeR — Confirmation Dialog System
   Shared confirm/cancel modal with callback management.
   Extracted from mmgr-app.js.
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const U = ns.Utils;

  // ---- Confirmation Dialog ----
  let _cfmCb = null;
  let _cfmCancelCb = null;

  function askConfirm(opts) {
    const modal = U.$('cfm-modal');
    if (!modal) {
      // No dialog in the DOM: fall back to native confirm so safety holds.
      if (window.confirm((opts && opts.message) || 'Confirm?')) {
        if (opts && opts.onOk) opts.onOk();
      }
      return;
    }
    _cfmCb = (opts && opts.onOk) || null;
    _cfmCancelCb = (opts && opts.onCancel) || null;
    const title = U.$('cfm-title');
    if (title) title.textContent = (opts && opts.title) || 'Confirm';
    const msg = U.$('cfm-msg');
    if (msg) msg.textContent = (opts && opts.message) || '';
    const items = U.$('cfm-items');
    if (items) {
      const list = (opts && opts.items) || [];
      if (list.length) {
        items.classList.remove('is-hide');
        items.innerHTML = '<div class="cfm-list-label">Affected task IDs:</div><div class="cfm-list">' +
          list.map(id => '<code>' + U.escapeHtml(id) + '</code>').join('') + '</div>';
      } else {
        items.classList.add('is-hide');
      }
    }
    const okBtn = U.$('cfm-ok');
    if (okBtn) {
      okBtn.textContent = (opts && opts.confirmLabel) || 'Confirm';
      if (opts && opts.danger) {
        okBtn.classList.add('btn-d');
        okBtn.classList.remove('btn-g');
      } else {
        okBtn.classList.add('btn-g');
        okBtn.classList.remove('btn-d');
      }
    }
    const cancelBtn = U.$('cfm-cancel');
    if (cancelBtn) cancelBtn.textContent = (opts && opts.cancelLabel) || 'Cancel';
    modal.classList.add('on');
  }

  function cfmOk() {
    const modal = U.$('cfm-modal');
    if (modal) modal.classList.remove('on');
    const items = U.$('cfm-items');
    if (items) items.classList.add('is-hide');
    const cb = _cfmCb;
    _cfmCb = null;
    _cfmCancelCb = null;
    if (cb) cb();
  }

  function cfmCancel() {
    const modal = U.$('cfm-modal');
    if (modal) modal.classList.remove('on');
    const items = U.$('cfm-items');
    if (items) items.classList.add('is-hide');
    const cb = _cfmCancelCb;
    _cfmCb = null;
    _cfmCancelCb = null;
    if (cb) cb();
  }

  // Close every custom modal we own (Escape key path). An Escape on the
  // confirmation dialog behaves exactly like Cancel — the onCancel callback
  // (e.g. a Gantt-drag rollback) must still run.
  function closeModals() {
    ['cfm-modal', 'conflict-modal', 'del-modal'].forEach(function(id) {
      var el = U.$(id);
      if (el) el.classList.remove('on');
    });
    var cb = _cfmCancelCb;
    _cfmCb = null;
    _cfmCancelCb = null;
    if (cb) cb();
  }

  ns.AppConfirm = {
    askConfirm: askConfirm,
    cfmOk: cfmOk,
    cfmCancel: cfmCancel,
    closeModals: closeModals
  };
})(MMGR);
window.MMGR = MMGR;
