/* ============================================================
   js/mmgr-onhold.js - the on-hold notice and its finalize gate
   ------------------------------------------------------------
   OWNER decision (UI-WAVE 2026-11-20 L): when a project is put on hold,
   everyone who opens it sees a banner and has to acknowledge it before the
   project can be changed. In-app only - no email and no server event, because
   the status already lives in the shared project state that a collaborator
   pulls when they open the project.

   The acknowledgement is per project and per device (localStorage), so it
   survives a reload and never travels to anyone else. This is a warning gate,
   not a security boundary: the server does not enforce it, and the note in
   docs/UI-POLISH-WAVE-PLAN-2026-11-20.md records that limitation.
   ============================================================ */
(function () {
  'use strict';
  const ns = (window.MMGR = window.MMGR || {});
  const PREFIX = 'mmgr_onhold_ack_';
  let _lastRefusal = 0;

  function state() {
    return (ns.State && ns.State.getState && ns.State.getState()) || null;
  }

  function projectId() {
    const s = state();
    return String((s && s.projectId) || ns.projectId || 'default');
  }

  function acknowledged() {
    try {
      return localStorage.getItem(PREFIX + projectId()) === '1';
    } catch (e) {
      return false;
    }
  }

  function onHold() {
    const s = state();
    return !!s && s.status === 'on-hold';
  }

  function locked() {
    return onHold() && !acknowledged();
  }

  // Paint the banner from state. Called on boot, after a status change and
  // after the acknowledgement. `.is-hide` is the stack's own visibility flag
  // (the header banner rule keys off it), never the `hidden` attribute.
  function render() {
    const bar = document.getElementById('onhold-banner');
    if (!bar) {
      return;
    }
    const on = onHold();
    bar.classList.toggle('is-hide', !on);
    document.body.classList.toggle('onhold', on);
    document.body.classList.toggle('onhold-locked', on && !acknowledged());
  }

  function acknowledge() {
    try {
      localStorage.setItem(PREFIX + projectId(), '1');
    } catch (e) {
      /* private mode: the gate re-arms on the next load, which is safe */
    }
    render();
    if (ns.Render && ns.Render.renderStatusChip) {
      ns.Render.renderStatusChip();
    }
    return true;
  }

  // One message, not one per refused click: a locked project would otherwise
  // stack a toast for every cell the person tries to edit.
  function refused() {
    const now = Date.now();
    if (now - _lastRefusal < 1500) {
      return;
    }
    _lastRefusal = now;
    if (ns.App && typeof ns.App.showToast === 'function') {
      ns.App.showToast(
        'This project is on hold. Choose "Finalize and continue" in the banner before changing it.',
        'err'
      );
    }
  }

  ns.OnHold = {
    onHold: onHold,
    locked: locked,
    acknowledged: acknowledged,
    acknowledge: acknowledge,
    render: render,
    refused: refused
  };
})();
