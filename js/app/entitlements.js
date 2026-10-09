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
    _tier = typeof tier === 'string' && tier ? tier : 'free';
  }

  function tier() {
    return _tier;
  }

  function signedIn() {
    try {
      return !!(
        ns.GoogleAuth &&
        typeof ns.GoogleAuth.isSignedIn === 'function' &&
        ns.GoogleAuth.isSignedIn()
      );
    } catch (e) {
      return false;
    }
  }

  // Feature gates - add new ones here, never in callers
  function aiAssistant() {
    return signedIn();
  } // signed-in (unchanged)
  // OWNER 2026-10-09: the ESTIMATOR tier is not contractor-level. The server
  // returns the FREE project cap for every tier (src/billing.js, the
  // projectCap field), so the old `_tier !== 'free'` promised unlimited cloud
  // to a homeowner subscriber and then let the create gate refuse the 2nd
  // project - a gate that lied is worse than no gate. contractor+ only.
  function unlimitedCloud() {
    return _tier === 'contractor' || _tier === 'company' || _tier === 'enterprise';
  }
  // All paid tiers may use the AI estimator. The free tier is NOT excluded: it
  // gets a small daily allowance through the managed key pool (see the free
  // rung in src/ai-proxy.js), which is enforced server-side per account.
  function estimatorAccess() {
    return (
      _tier === 'estimator' ||
      _tier === 'contractor' ||
      _tier === 'company' ||
      _tier === 'enterprise'
    );
  }
  function rbacAccess() {
    return _tier === 'contractor' || _tier === 'company' || _tier === 'enterprise';
  }
  function rbacUnlimited() {
    return _tier === 'company' || _tier === 'enterprise';
  }

  ns.Entitlements = {
    setBillingTier: setBillingTier,
    tier: tier,
    aiAssistant: aiAssistant,
    unlimitedCloud: unlimitedCloud,
    estimatorAccess: estimatorAccess,
    rbacAccess: rbacAccess,
    rbacUnlimited: rbacUnlimited
  };
})((window.MMGR = window.MMGR || {}));
