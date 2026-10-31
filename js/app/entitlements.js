/* ============================================================
   entitlements.js - sole authority for feature gating.
   Tier is written here by the billing status fetch at sign-in.
   Callers ask a named function; the tier logic stays here.
   Adding a new gate = add a function here, wire it nowhere else.
   ============================================================ */
(function (ns) {
  'use strict';

  var _tier = 'free'; // updated by setBillingTier() after status fetch
  var _adopted = false; // a caller has already answered from a status fetch

  function setBillingTier(tier) {
    _tier = typeof tier === 'string' && tier ? tier : 'free';
    _adopted = true;
  }

  /* S7 (audit 2026-10-31): the workspace asks the SERVER what plan it is on,
     once per page, instead of waiting for the header chip to render. Only the
     launcher's sign-in path and the project header used to fetch the plan, so
     on project.html the tier stayed 'free' for the whole session whenever the
     header chip never rendered (it is deliberately hidden on the sections
     page) and for the first ten seconds of every load while the Google script
     settled - the team panel showed no collaborators and every enterprise
     control was suppressed for a paying account. The endpoint is
     session-gated: anonymous, unconfigured and offline loads all leave the
     tier at 'free', which is the same answer the gates gave before. */
  var _hydrate = null; // one request per page, shared by every caller
  function hydrate() {
    if (_hydrate) {
      return _hydrate;
    }
    _hydrate = (function () {
      var done = function (d) {
        // Never stomp an answer a caller already adopted (the launcher's
        // sign-in path and the billing panel both call setBillingTier); this
        // request exists only for pages where nobody else asks.
        if (!_adopted && d && d.ok && d.configured) {
          _tier = typeof d.plan === 'string' && d.plan ? d.plan : 'free';
        }
        return _tier;
      };
      try {
        return fetch('/api/billing/status', { method: 'GET', credentials: 'same-origin' })
          .then(function (res) {
            return res && res.ok ? res.json() : null;
          })
          .then(done, function () {
            return done(null);
          });
      } catch (e) {
        return Promise.resolve(done(null));
      }
    })();
    return _hydrate;
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
  // OWNER 2026-10-09 (L11): FREE = one linked project; EVERY PAID TIER -
  // estimator included - is unlimited, and the server now says the same thing
  // (src/billing.js returns projectCap null for any active subscription, and
  // the create gate in src/cloud/projects.js has always let an active
  // subscription past the cap). The estimator exclusion that lived here for a
  // few hours existed only because the status response reported the free cap
  // for every tier; with the server fixed, the client and server agree again.
  // Offline/local projects are not counted by this gate at all - they are
  // unlimited on every tier, signed in or not.
  function unlimitedCloud() {
    return _tier !== 'free';
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
  // RBAC sprint 3 (directive 2026-10-25): the enterprise layer - a custom
  // permission matrix, time-boxed access, bulk invite, reusable templates and
  // the audit export. Same two tiers as rbacUnlimited, kept as its own name so
  // a future change to seat caps cannot silently move these features.
  function rbacEnterprise() {
    return _tier === 'company' || _tier === 'enterprise';
  }

  ns.Entitlements = {
    setBillingTier: setBillingTier,
    hydrate: hydrate,
    tier: tier,
    aiAssistant: aiAssistant,
    unlimitedCloud: unlimitedCloud,
    estimatorAccess: estimatorAccess,
    rbacAccess: rbacAccess,
    rbacUnlimited: rbacUnlimited,
    rbacEnterprise: rbacEnterprise
  };

  // Ask once, at parse time: every gate above answers in the same tick, the
  // plan lands as soon as the cookie fetch returns.
  hydrate();
})((window.MMGR = window.MMGR || {}));
