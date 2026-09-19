/* ============================================================
   entitlements.js - the ONE future door for gating AI-powered
   features (owner directive 2026-09-19: AI features are part of
   the signed-in experience; premium/feature-flag rules land
   INSIDE these functions later - callers never change).

   Strict-grammar features (paste import, validation) stay
   available signed-out; only the AI-assisted paths consult this.
   Offline-first: when the auth module has not booted (e.g. the
   guide or a fresh crash), the safe default is DENY for AI -
   the strict path still works everywhere.

   API (both sync, both boolean):
     MMGR.Entitlements.aiAssistant()   -> background assistant / AI reads
   ============================================================ */
(function (ns) {
  'use strict';

  function signedIn() {
    try {
      return !!(ns.GoogleAuth && typeof ns.GoogleAuth.isSignedIn === 'function' && ns.GoogleAuth.isSignedIn());
    } catch (e) { return false; }
  }

  // The AI-assisted tier rides the sign-in (owner directive). When premium
  // gating arrives it lives HERE (e.g. also require a plan flag); every
  // caller keeps asking the same question and never learns the difference.
  function aiAssistant() {
    return signedIn();
  }

  ns.Entitlements = {
    aiAssistant: aiAssistant
  };
})(window.MMGR = window.MMGR || {});
