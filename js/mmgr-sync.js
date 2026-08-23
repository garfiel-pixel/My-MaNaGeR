/* ============================================================
   My MaNaGeR , Optional Google Identity for Sync (Rank 4.5)
   (PLAN-OF-ACTION-AI-VOICE-SYNC-v1, Rank 4.5)
   ------------------------------------------------------------
   NEVER GATING , this module is 100% optional and adds zero
   requirements to the app:

   - Login stays 100% optional. Every feature works forever with
     zero login; nothing in this app is behind a login wall.
   - What Google identity is FOR: a LABEL attached to this
     device's sync/merge activity so Rank 4.4's merge mechanism
     knows which devices belong to the same user. Nothing more.
   - What it is explicitly NOT: not an account system, not a gate
     to any feature, not a dependency for core CRUD (task edit,
     budget entry, risk log, claim log), not a requirement for
     the JSON export/import path , the guaranteed fallback.

   Implementation shape (per the plan):
   - GIS (Google Identity Services) client-side sign-in button,
     lazy-loaded from https://accounts.google.com/gsi/client ONLY
     when the user clicks Connect , zero mandatory network, and
     circuit-broken: an offline/CSP-blocked load degrades to a
     toast, never an error.
   - The ID token is decoded client-side (JWT payload) into a
     device label: { sub, email, name, picture }. Stored in a
     DEVICE-LEVEL localStorage slot , deliberately NOT project
     state, so it can never leak into the portable .json export
     (constraint #5) or ride along in a merge.
   - The Cloudflare Workers sync relay from the earlier hybrid
     discussion stays optional/absent; JSON export/import remains
     the guaranteed transport either way.
   - Recommended, not required , surfaced as a SINGLE, dismissible
     suggestion (never a blocking modal, never repeated nagging),
     offered once multi-device use is detected (a merge) or when
     the user opens the Sync section with no identity attached.
   - OWNER 2026-08-15 (GOOGLE-SIGNIN-THREADS-THE-SITE): the
     Settings sign-in now uses the SAME shared public Client ID as
     the main site (mmgr-google-auth.js / worker.js) , the old
     BYO "paste your client ID" field is gone. Signing in here
     ALSO creates the real site-wide session (the ID token is
     handed to GoogleAuth.handleCredentialResponse), so one sign-in
     shows "Signed in" on every page. A legacy mmgr_sync_clientid
     device slot still overrides when present.
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const U = ns.Utils;

  // Device-level slots (localStorage, NOT project state).
  const IDENTITY_KEY = 'mmgr_sync_identity';      // { sub, email, name, picture, at }
  const SUGGEST_KEY = 'mmgr_sync_suggest';         // '1' = suggestion dismissed on this device
  const GIS_URL = 'https://accounts.google.com/gsi/client';

  // ---- Identity (device label) -------------------------------------------
  function getIdentity() {
    try {
      const raw = localStorage.getItem(IDENTITY_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function isSignedIn() {
    const id = getIdentity();
    return !!(id && id.sub);
  }
  function deviceLabel() {
    const id = getIdentity();
    if (!id) return '';
    return id.name || id.email || id.sub || 'this device';
  }
  function setIdentity(id) {
    try { localStorage.setItem(IDENTITY_KEY, JSON.stringify(id)); } catch (e) { /* ignore */ }
  }
  function clearIdentity() {
    try { localStorage.removeItem(IDENTITY_KEY); } catch (e) { /* ignore */ }
  }

  // ---- GIS lazy-load (opt-in, circuit-broken) ----------------------------
  let _gisLoaded = false;
  function loadGIS() {
    if (_gisLoaded || (window.google && window.google.accounts && window.google.accounts.id)) {
      _gisLoaded = true;
      return Promise.resolve(true);
    }
    return new Promise(function(resolve) {
      try {
        const s = document.createElement('script');
        s.src = GIS_URL;
        s.async = true;
        s.onload = function() {
          _gisLoaded = true;
          resolve(!!(window.google && window.google.accounts && window.google.accounts.id));
        };
        s.onerror = function() { _gisLoaded = false; resolve(false); };
        document.head.appendChild(s);
      } catch (e) { resolve(false); }
    });
  }

  // Client-side ID-token decode (JWT payload, base64url). Purely a label , 
  // no signature verification, because the token is never used to authorize
  // anything. If the shape ever changes, degrade to a null label, never crash.
  function decodeIdToken(token) {
    try {
      const parts = String(token || '').split('.');
      if (parts.length < 2) return null;
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(Array.prototype.map.call(atob(b64), function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
      return JSON.parse(json);
    } catch (e) { return null; }
  }

  // GIS credential callback. Extracts ONLY the pairing label fields.
  function handleCredential(resp) {
    const payload = resp && resp.credential ? decodeIdToken(resp.credential) : null;
    if (!payload || !payload.sub) {
      if (ns.App && ns.App.showToast) ns.App.showToast('Google sign-in returned no usable identity.', 'err');
      return;
    }
    setIdentity({
      sub: payload.sub,
      email: payload.email || '',
      name: payload.name || '',
      picture: payload.picture || '',
      at: new Date().toISOString()
    });
    renderSyncSection();
    if (ns.App && ns.App.showToast) {
      ns.App.showToast('Signed in as ' + (payload.email || payload.sub) + ' , this device is signed in across the app; optional, nothing is gated.', 'ok');
    }
  }

  // Shared Google Client ID , the same public ID the main site's sign-in
  // uses (mirrored in mmgr-google-auth.js / worker.js / wrangler.jsonc). It
  // replaces the old BYO requirement: the Settings sign-in works out of the
  // box, no per-device paste needed.
  function sharedClientId() {
    return (ns.GoogleAuth && ns.GoogleAuth.CLIENT_ID) || '';
  }

  // GIS credential callback for the connect flow: records the device label
  // (merge labeling) AND hands the same ID token to GoogleAuth so the REAL
  // site-wide session is created , one sign-in threads through every page.
  function onConnectCredential(resp) {
    handleCredential(resp);
    if (ns.GoogleAuth && ns.GoogleAuth.handleCredentialResponse) {
      try { ns.GoogleAuth.handleCredentialResponse(resp); } catch (e) { /* label already saved , session is optional */ }
    }
  }

  // Start the sign-in flow: lazily load GIS, then render its button into
  // #sync-gis-btn. Client ID is the shared public ID (a legacy BYO device
  // slot overrides it); with neither present it toasts , never crashes.
  async function connect() {
    const ok = await loadGIS();
    if (!ok || !window.google || !window.google.accounts || !window.google.accounts.id) {
      if (ns.App && ns.App.showToast) ns.App.showToast('Google sign-in unavailable (offline?) , file export/import sync still works.', 'err');
      return false;
    }
    const clientId = getClientId() || sharedClientId();
    if (!clientId) {
      if (ns.App && ns.App.showToast) ns.App.showToast('Google sign-in is not configured on this host.', 'err');
      return false;
    }
    try {
      window.google.accounts.id.initialize({ client_id: clientId, callback: onConnectCredential });
      const btn = U.$('sync-gis-btn');
      if (btn) window.google.accounts.id.renderButton(btn, { theme: 'outline', size: 'medium', text: 'continue_with' });
      // OWNER 2026-08-15: pop the Google prompt immediately (one motion , 
      // the rendered button is the fallback when the prompt API is blocked).
      if (window.google.accounts.id && typeof window.google.accounts.id.prompt === 'function') {
        try { window.google.accounts.id.prompt(); } catch (e) { /* button stays rendered */ }
      }
      return true;
    } catch (e) {
      if (ns.Errors && ns.Errors.log) ns.Errors.log('gis: ' + (e && e.message), 'sync');
      return false;
    }
  }

  function getClientId() {
    try { return localStorage.getItem('mmgr_sync_clientid') || ''; } catch (e) { return ''; }
  }
  // Accepts either a raw string ('xxxx.apps.googleusercontent.com') or an
  // input element (the data-action path passes the el). Normalizes both.
  function setClientId(v) {
    const raw = (typeof v === 'string') ? v : ((v && v.value != null) ? v.value : '');
    try { localStorage.setItem('mmgr_sync_clientid', String(raw || '').trim()); } catch (e) { /* ignore */ }
  }

  function signOut() {
    clearIdentity();
    // When the identity came from a real site-wide session, sign THAT out
    // too so the whole site flips back to signed-out together.
    if (ns.GoogleAuth && ns.GoogleAuth.isSignedIn && ns.GoogleAuth.isSignedIn() && ns.GoogleAuth.signOut) {
      try { ns.GoogleAuth.signOut(); } catch (e) { /* device label already cleared */ }
    }
    renderSyncSection();
    if (ns.App && ns.App.showToast) ns.App.showToast('Signed out , device label removed. All features still work.', 'ok');
  }

  // ---- Single dismissible suggestion (no spam, never a modal) ------------
  function suggestionDismissed() {
    try { return localStorage.getItem(SUGGEST_KEY) === '1'; } catch (e) { return false; }
  }
  // Multi-device use flag: set only by noteMultiDeviceUse() when a merge
  // actually happens. The suggestion is NOT shown at boot , it appears only
  // once multi-device use is DETECTED, per the plan's no-spam rule.
  function multiDeviceDetected() {
    try { return localStorage.getItem('mmgr_sync_mdu') === '1'; } catch (e) { return false; }
  }
  function dismissSuggestion() {
    try { localStorage.setItem(SUGGEST_KEY, '1'); } catch (e) { /* ignore */ }
    renderSyncSection();
  }

  // Called when multi-device use is detected (a merge just succeeded). Shows
  // the single dismissible suggestion if the user isn't signed in and hasn't
  // dismissed it before on this device. Never a modal, never re-prompted.
  function noteMultiDeviceUse() {
    try { localStorage.setItem('mmgr_sync_mdu', '1'); } catch (e) { /* ignore */ }
    if (isSignedIn() || suggestionDismissed()) return;
    renderSyncSection();
  }

  // ---- Render -------------------------------------------------------------
  // Renders the Sync section inside the Controls drawer (db-ctrl). Uses
  // existing classes (sr/sr-hint/exp-row/btn) so it needs zero new CSS.
  function renderSyncSection() {
    const wrap = U.$('sync-section');
    if (!wrap) return;
    const signedIn = isSignedIn();
    const id = getIdentity();
    let html = '';

    // Status line.
    html += '<div class="sr"><span class="sl"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-users"></use></svg> Sign-in</span></div>';
    html += '<div class="sr-hint">Optional , sign in once and the whole app (launcher, admin, every project) shares the same signed-in state. It never gates a feature and never leaves this device.</div>';

    if (signedIn && id) {
      html += '<div class="sr"><span class="sl"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-check-circle"></use></svg> Already signed in as <strong>' + U.escapeHtml(id.email || id.name || id.sub) + '</strong></span>' +
        '<button class="btn btn-n btn-s" data-action="syncSignOut"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-x"></use></svg> Sign Out</button></div>';
    } else {
      html += '<div class="sr"><span class="sl"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-lock"></use></svg> Not signed in , works fully without an account</span></div>';
      html += '<div class="exp-row"><button class="btn btn-n btn-s" data-action="syncConnect"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-users"></use></svg> Sign in with Google (optional)</button></div>';
      html += '<div id="sync-gis-btn" class="sync-gis-btn"></div>';

      // Single dismissible suggestion , ONLY after multi-device use was
      // detected (a merge happened), and never again after dismissal.
      if (multiDeviceDetected() && !suggestionDismissed()) {
        html += '<div class="sync-suggest"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-refresh"></use></svg> Merging projects across devices? Sign in to label this device , optional, dismissible, never required. ' +
          '<button class="btn btn-n btn-s" data-action="syncDismissSuggest">Dismiss</button></div>';
      }
    }
    wrap.innerHTML = html;
  }

  // Thread the real site-wide session into the device label: whenever
  // GoogleAuth signs in / restores a session, mirror the user into the sync
  // identity so merge labeling + this section stay consistent everywhere.
  // Signing out clears it again. Registers at module load (project.html);
  // render no-ops without #sync-section.
  document.addEventListener('mmgr:user-changed', function(e) {
    const u = e && e.detail;
    if (u && u.sub) {
      setIdentity({ sub: u.sub, email: u.email || '', name: u.name || '', picture: u.picture || '', at: new Date().toISOString() });
    }
    renderSyncSection();
  });
  document.addEventListener('mmgr:google-signed-out', function() {
    clearIdentity();
    renderSyncSection();
  });

  function setClientIdFrom(el) { setClientId(el); }

  // ---- API ----
  ns.Sync = {
    getIdentity: getIdentity,
    isSignedIn: isSignedIn,
    deviceLabel: deviceLabel,
    loadGIS: loadGIS,
    connect: connect,
    signOut: signOut,
    handleCredential: handleCredential,
    decodeIdToken: decodeIdToken,
    getClientId: getClientId,
    setClientId: setClientIdFrom,
    noteMultiDeviceUse: noteMultiDeviceUse,
    dismissSuggestion: dismissSuggestion,
    suggestionDismissed: suggestionDismissed,
    renderSyncSection: renderSyncSection
  };
})(MMGR);
window.MMGR = MMGR;
