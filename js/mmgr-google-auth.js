/* ============================================================
   My MaNaGeR — Optional Operator Identity (GOOGLE-OPERATOR-
   IDENTITY-v1)
   ------------------------------------------------------------
   Loaded by app.html (and admin.html). This is an OPTIONAL
   operator-identity layer ONLY:

   - It NEVER replaces, bypasses, or weakens per-project access
     codes. No code path in this module opens project data — the
     access-code unlock modal and the project grid are untouched.
   - Sign-in posts the Google ID token to /api/auth/google; the
     Worker verifies it server-side (aud/iss/exp) and sets an
     HttpOnly Secure SameSite=Lax session cookie (mmgr_session).
     The Client Secret never appears in this file or any
     client-shipped asset.
   - Not signed in? The button is simply never interacted with —
     the rest of the page runs completely uninterrupted. Nothing
     here is gated on an identity.
   - /api/auth/me restores the operator identity from the session
     cookie on load. If it is unreachable (static host, offline)
     or unsigned, the page shows the sign-in button and keeps
     working. A failed sign-in leaves the user exactly where they
     are — no false signed-in state, no redirect, no unlock.
   - localStorage is NOT treated as proof of auth — the server
     session cookie is the only truth; the UI cache below is
     display-only and never gates anything.

   Namespaced as window.MMGR.GoogleAuth (MMGR is created by
   mmgr-portfolio.js on app.html; created here on admin.html if
   absent). No dependency on any other module. Zero-throw: every
   network / GIS / DOM path is guarded so a missing Google global,
   offline load, or blocked script can never break the page.
   ============================================================ */
var MMGR = window.MMGR || {};
(function(ns) {
  'use strict';

  // Public Client ID — safe to ship (also mirrored in worker.js / wrangler
  // vars). The Client Secret lives ONLY in the Worker's env.
  const CLIENT_ID = '297970704704-m05hgt93lfaq286q90br8c96ffg1aph3.apps.googleusercontent.com';
  const GIS_SRC = 'https://accounts.google.com/gsi/client';

  let _gisInit = false;   // GIS initialized exactly once
  let _restored = false;  // /api/auth/me consulted at most once per boot

  function $(id) { return document.getElementById(id); }
  function gisReady() { return !!(window.google && window.google.accounts && window.google.accounts.id); }

  // Render the GIS sign-in button into #google-signin-button. Safe to call
  // only when the element exists AND GIS is present; never throws.
  function initGIS() {
    if (_gisInit) return true;
    try {
      if (!gisReady()) return false;
      window.google.accounts.id.initialize({ client_id: CLIENT_ID, callback: handleCredentialResponse });
      const host = $('google-signin-button');
      if (host) {
        window.google.accounts.id.renderButton(host, {
          theme: 'outline',
          size: 'medium',
          shape: 'rectangular',
          text: 'signin_with'
        });
      }
      _gisInit = true;
      return true;
    } catch (e) {
      if (window.console && window.console.warn) window.console.warn('mmgr-google-auth: GIS init failed (optional identity unaffected)', e);
      return false;
    }
  }

  function showButton() {
    const btn = $('google-signin-button');
    const chip = $('google-user-chip');
    if (btn) btn.hidden = false;
    if (chip) chip.hidden = true;
  }

  // Render the signed-in chip. Google-supplied fields are always written via
  // textContent / DOM APIs (never innerHTML) so remote data can't inject.
  function showUser(user) {
    const btn = $('google-signin-button');
    const chip = $('google-user-chip');
    if (btn) btn.hidden = true;
    if (!chip) return;
    chip.hidden = false;
    chip.innerHTML = '';
    const avatar = document.createElement('span');
    avatar.className = 'gchip-avatar';
    if (user.picture) {
      const img = document.createElement('img');
      img.className = 'gchip-avatar-img';
      img.src = user.picture;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      avatar.appendChild(img);
    } else {
      avatar.textContent = (user.name || user.email || '?').charAt(0).toUpperCase();
    }
    const name = document.createElement('span');
    name.className = 'gchip-name';
    name.textContent = user.name || user.email || user.sub || 'Operator';
    const out = document.createElement('button');
    out.type = 'button';
    out.className = 'gchip-out';
    out.textContent = 'Sign out';
    out.addEventListener('click', signOut);
    chip.appendChild(avatar);
    chip.appendChild(name);
    chip.appendChild(out);
  }

  // Restore the operator identity from the Worker session cookie. Never
  // throws; any failure just leaves the sign-in button visible.
  async function restoreSession() {
    if (_restored) return;
    _restored = true;
    try {
      const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (res.ok) {
        const data = await res.json();
        if (data && data.ok && data.user) { showUser(data.user); return; }
      }
    } catch (e) { /* static host / offline — fall through */ }
    showButton();
  }

  // GIS credential callback: hand the ID token to the Worker. On success show
  // the chip + notify (event + optional hook). On failure do NOTHING that
  // could imply signed-in state — the user stays exactly where they are.
  async function handleCredentialResponse(resp) {
    const credential = resp && resp.credential;
    if (!credential) return;
    try {
      const res = await fetch('/api/auth/google', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: credential })
      });
      let data = null;
      try { data = await res.json(); } catch (e) { /* non-JSON failure */ }
      if (res.ok && data && data.ok && data.user) {
        showUser(data.user);
        document.dispatchEvent(new CustomEvent('mmgr:google-signed-in', { detail: data.user }));
        if (typeof window.mmgrOnGoogleSignIn === 'function') {
          try { window.mmgrOnGoogleSignIn(data.user); } catch (e) { /* optional hook */ }
        }
      } else {
        // Worker rejected the token (or a stale/forged credential) — no false
        // signed-in state, no redirect, no unlock.
        showButton();
      }
    } catch (e) {
      showButton();
    }
  }

  // POST to the Worker to clear the session cookie, then flip the UI back to
  // the sign-in button. The chip clears even if the network call fails.
  async function signOut() {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } catch (e) { /* still clear the local chip */ }
    showButton();
    document.dispatchEvent(new CustomEvent('mmgr:google-signed-out'));
  }

  function boot() {
    // The GIS script tag is async+defer in the page head, so it may still be
    // loading. Initialize the moment it's present; if it never loads
    // (offline / blocked), the button slot stays empty and nothing is gated.
    if (initGIS()) { restoreSession(); return; }
    const s = document.querySelector('script[src*="gsi/client"]');
    if (s && typeof s.addEventListener === 'function') {
      s.addEventListener('load', function() { if (initGIS()) restoreSession(); });
      s.addEventListener('error', function() { /* blocked/offline — fine */ });
    }
    // Fallback poll: covers the case where a cached async script fired its
    // load event before this listener attached. Also guarantees restoreSession
    // still runs (~10s cap) so an existing session chip appears even if GIS
    // never loads.
    let tries = 0;
    const t = setInterval(function() {
      if (gisReady()) { clearInterval(t); if (initGIS()) restoreSession(); }
      else if (++tries > 40) { clearInterval(t); restoreSession(); }
    }, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  ns.GoogleAuth = {
    CLIENT_ID: CLIENT_ID,
    initGIS: initGIS,
    restoreSession: restoreSession,
    handleCredentialResponse: handleCredentialResponse,
    signOut: signOut
  };
})(MMGR);
window.MMGR = MMGR;
