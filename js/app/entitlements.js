/* ============================================================
   entitlements.js - sole authority for feature gating.
   Tier is written here by the billing status fetch at sign-in.
   Callers ask a named function; the tier logic stays here.
   Adding a new gate = add a function here, wire it nowhere else.
   ============================================================ */
(function (ns) {
  'use strict';

  var _tier = 'free'; // updated by setBillingTier() after status fetch

  function setBillingTier(tier) {
    _tier = (typeof tier === 'string' && tier) ? tier : 'free';
  }

  function tier() { return _tier; }

  function signedIn() {
    try {
      return !!(ns.GoogleAuth && typeof ns.GoogleAuth.isSignedIn === 'function' && ns.GoogleAuth.isSignedIn());
    } catch (e) { return false; }
  }

  // Feature gates - add new ones here, never in callers
  function aiAssistant()     { return signedIn(); }            // signed-in (unchanged)
  function unlimitedCloud()  { return _tier !== 'free'; }      // contractor+
  function rbacAccess()      { return _tier === 'contractor' || _tier === 'company' || _tier === 'enterprise'; }
  function rbacUnlimited()   { return _tier === 'company' || _tier === 'enterprise'; }

  ns.Entitlements = {
    setBillingTier : setBillingTier,
    tier           : tier,
    aiAssistant    : aiAssistant,
    unlimitedCloud : unlimitedCloud,
    rbacAccess     : rbacAccess,
    rbacUnlimited  : rbacUnlimited
  };
})(window.MMGR = window.MMGR || {});
