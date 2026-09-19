/* ============================================================
   My MaNaGeR - Baseline Guard (auto-capture + nudge)
   ------------------------------------------------------------
   Owner directive (2026-09-19): a project with scheduled tasks
   must never sit there with nothing to calculate variance
   against. Two behaviors, both visible:
   1. AUTO-CAPTURE (once): when the project first reaches
      "schedulable" (>=1 non-phase task with duration + start +
      end) and no baseline exists, snapshot one automatically and
      SAY SO (toast + dashboard line). Never silent.
   2. NUDGE (persistent): while no baseline exists AND the
      auto-capture already happened once (baselineAutoAt set),
      every [data-baseline-dot] shows a red dot next to Save
      Baseline - a human must decide the new reference point
      (import, undo, or deliberate clear). Plain-language tooltip.
   Recapture stays a deliberate human act - an auto-recapture
   would silently move the variance reference. Zero-throw: any
   error leaves state untouched.
   Namespaced as window.MMGR.BaselineGuard. Loaded by build.js
   after the app sub-modules.
   ============================================================ */
var MMGR = window.MMGR || {};
(function(ns) {
  'use strict';

  function isSchedulable(s) {
    return (s.tasks || []).some(function(t) {
      return t && !t.isPhase && t.duration && t.startDate && t.endDate;
    });
  }

  function ensure() {
    try {
      const s = ns.State.getState();
      if (!s || !s.tasks) return;
      const sched = isSchedulable(s);
      // Nudge dots (cheap, every call): visible only while the project is
      // schedulable, has NO baseline, and the one-shot auto-capture already
      // happened (baselineAutoAt set). In that state auto-recapture would
      // silently move the variance reference - a human decides instead.
      // First-time gap never shows the dot: the auto-capture below resolves
      // it in the same pass (the toast is the signal there).
      const needDot = sched && !s.baseline && !!s.baselineAutoAt;
      document.querySelectorAll('[data-baseline-dot]').forEach(function(el) {
        el.hidden = !needDot;
      });
      // Auto-capture: only when truly missing and never yet auto-captured.
      if (!s.baseline && sched && !s.baselineAutoAt) {
        ns.State.saveBaseline();
        ns.State.updateState(function(st) { st.baselineAutoAt = new Date().toISOString(); });
        if (ns.App && ns.App.showToast) {
          ns.App.showToast('Baseline auto-captured - your schedule now has a reference point. You can recapture it anytime in Controls.', 'ok');
        }
      }
    } catch (e) { /* zero-throw */ }
  }

  ns.BaselineGuard = { ensure: ensure, isSchedulable: isSchedulable };
})(MMGR);
window.MMGR = MMGR;
