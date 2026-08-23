/* ============================================================
   My MaNaGeR , Optional Operator Identity (GOOGLE-OPERATOR-
   IDENTITY-v1)
   ------------------------------------------------------------
   Loaded by app.html, admin.html, and project.html (the project
   Controls drawer mounts the optional Drive backup section there
   via #drive-section), plus the marketing pages (index/about/
   features/contact , the header email sign-in sheet mounts only
   the email+password form via mountEmailAuth('marketing-email-auth')).
   This is an OPTIONAL operator-identity layer ONLY:

   - It NEVER replaces, bypasses, or weakens per-project access
     codes. No code path in this module opens project data , the
     access-code unlock modal and the project grid are untouched.
   - Sign-in posts the Google ID token to /api/auth/google; the
     Worker verifies it server-side (aud/iss/exp) and sets an
     HttpOnly Secure SameSite=Lax session cookie (mmgr_session).
     The Client Secret never appears in this file or any
     client-shipped asset.
   - Not signed in? The button is simply never interacted with , 
     the rest of the page runs completely uninterrupted. Nothing
     here is gated on an identity.
   - /api/auth/me restores the operator identity from the session
     cookie on load. If it is unreachable (static host, offline)
     or unsigned, the page shows the sign-in button and keeps
     working. A failed sign-in leaves the user exactly where they
     are , no false signed-in state, no redirect, no unlock.
   - localStorage is NOT treated as proof of auth , the server
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

  // Public Client ID , safe to ship (also mirrored in worker.js / wrangler
  // vars). The Client Secret lives ONLY in the Worker's env.
  const CLIENT_ID = '297970704704-m05hgt93lfaq286q90br8c96ffg1aph3.apps.googleusercontent.com';
  const GIS_SRC = 'https://accounts.google.com/gsi/client';  let _gisInit = false;   // GIS initialized exactly once
  let _restored = false;  // /api/auth/me consulted at most once per boot
  let _popupWarnShown = false; // BUG-2: popup-blocked warning shown at most once
  let _user = null;  // signed-in operator (session restore, Google, or email) , display-only, never gates anything

  function $(id) { return document.getElementById(id); }
  function gisReady() { return !!(window.google && window.google.accounts && window.google.accounts.id); }


  // BUG-2: detect when the GIS popup is blocked by the browser. The GIS
  // library logs to console.error (GSI_LOGGER) but provides no callback for
  // popup failure. We intercept window.open during the GIS button click , 
  // if it returns null, the popup was blocked , and show a user-facing
  // message instead of a silent console error.
  function installPopupBlockDetector() {
    const host = $('google-signin-button');
    if (!host) return;
    host.addEventListener('click', function onGisClick() {
      const origOpen = window.open;
      window.open = function() {
        window.open = origOpen; // restore immediately
        const w = origOpen.apply(this, arguments);
        if (!w && !_popupWarnShown) {
          _popupWarnShown = true;
          // Surface a clear, actionable message. The toast function may not
          // be available on all pages, so fall back to a visible DOM element.
          if (typeof toast === 'function') {
            toast('Your browser blocked the Google sign-in popup. Allow popups for this site, or use the email sign-in below.', 'err');
          } else {
            const statusEl = $('google-signin-status') || $('drive-sync-status');
            if (statusEl) {
              statusEl.textContent = 'Popup blocked , allow popups for this site, or use email sign-in.';
              statusEl.classList.add('is-err');
            }
          }
        }
        return w;
      };
    }, { capture: true, once: true });
  }


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
        installPopupBlockDetector();
      }
      _gisInit = true;
      return true;
    } catch (e) {
      if (window.console && window.console.warn) window.console.warn('mmgr-google-auth: GIS init failed (optional identity unaffected)', e);
      return false;
    }
  }

  // T5 (2026-08-16): GIS measures the host at RENDER time, so a button drawn
  // into a hidden container comes out 0x0 and never recovers on its own.
  //   - app.html: #google-signin-button lives inside #siom, which is
  //     display:none at boot -> the real Google button iframe is 0x0; the old
  //     openSignIn() re-render guard checked for the fallback div[role=button],
  //     but GIS ALWAYS creates that fallback, so the guard never fired.
  //   - admin.html: the rail is visibility:hidden + translateX(-105%) at boot
  //     -> the whole button (iframe AND fallback) is 0x0 and the rail has no
  //     re-render hook at all.
  // ensureGisButton() re-draws the button into the host when it becomes
  // visible IF the current render is broken (iframe missing or zero-sized).
  // Safe to call repeatedly (no-op when healthy); zero-throw when GIS is
  // absent. Call sites: app.html openSignIn(), admin.html tglAdminNav().
  function ensureGisButton() {
    if (!gisReady()) return false;
    const host = $('google-signin-button');
    if (!host) return false;
    try {
      const ifr = host.querySelector('iframe');
      const broken = !ifr || (ifr.getBoundingClientRect().width === 0 && ifr.getBoundingClientRect().height === 0);
      if (!broken) return true;
      // Wipe the stale 0x0 render and draw a fresh button now that the host
      // is measurable (modal/rail open). GIS allows re-render after wipe.
      host.innerHTML = '';
      window.google.accounts.id.renderButton(host, {
        theme: 'outline',
        size: 'medium',
        shape: 'rectangular',
        text: 'signin_with'
      });
      installPopupBlockDetector();
      return true;
    } catch (e) {
      if (window.console && window.console.warn) window.console.warn('mmgr-google-auth: GIS re-render failed (optional identity unaffected)', e);
      return false;
    }
  }

  function showButton() {
    _user = null;
    syncPwHosts(); // signed out → password-change triggers hide

    const btn = $('google-signin-button');
    const chip = $('google-user-chip');
    if (btn) btn.hidden = false;
    if (chip) chip.hidden = true;
    // OWNER 2026-08-15: project.html header chip hides when signed out.
    const hc = $('hdr-signin');
    if (hc) hc.hidden = true;
    // Signed out -> no plan badge anywhere (mounts stay hidden).
    const pills = document.querySelectorAll('[data-plan-badge]');
    for (let i = 0; i < pills.length; i++) pills[i].hidden = true;
    // Signed out -> the email+password alternative is available again, and
    // the form returns to LOGIN mode (signing back in is the common intent
    // after a sign-out; register stays one click away).
    resetEmailAuthMode();
    const eb = $('email-auth-block');
    if (eb) eb.hidden = false;
  }

  function resetEmailAuthMode() {
    _emailMode = 'login';
    _checkUser = null;
    const block = $('email-auth-block');
    if (!block) return;
    const nameEl = emailAuthQ(block, '.email-auth-name');
    const pass = emailAuthQ(block, '.email-auth-pass');
    const submitBtn = emailAuthQ(block, '.email-auth-submit');
    const modeBtn = emailAuthQ(block, '.email-auth-mode');
    const forgotBtn = emailAuthQ(block, '.email-auth-forgot');
    const resetPanel = emailAuthQ(block, '.email-auth-reset');
    const checkPanel = emailAuthQ(block, '.email-auth-check');
    if (nameEl) nameEl.hidden = true;
    if (pass) pass.autocomplete = 'current-password';
    if (submitBtn) submitBtn.textContent = 'Sign in';
    if (modeBtn) modeBtn.textContent = 'Create an account instead';
    if (forgotBtn) forgotBtn.hidden = false;
    if (resetPanel) resetPanel.hidden = true;
    if (checkPanel) checkPanel.hidden = true;
    // NOTE: form.hidden is intentionally NOT touched here , app.html/admin.html
    // keep the form behind the "Sign in with email instead" toggle; marketing
    // pages restore it explicitly via renderSigninSignedOut().
  }

  // Render the signed-in chip. Google-supplied fields are always written via
  // textContent / DOM APIs (never innerHTML) so remote data can't inject.
  function showUser(user) {
    const btn = $('google-signin-button');
    const chip = $('google-user-chip');
    if (btn) btn.hidden = true;
    // Signed in (Google OR email) -> the email form collapses behind the chip.
    const eb = $('email-auth-block');
    if (eb) eb.hidden = true;
    // Page-level notification covering EVERY signed-in path (session
    // restore, Google, email) so a page without a chip (the marketing
    // sign-in sheet) can render its own signed-in state. App pages listen
    // to mmgr:google-signed-in and ignore this event.
    _user = user;
    // STABILIZATION 2026-08-16: project.html header chip , the signed-in
    // identity, mirroring the app.html rail: a name-initial avatar (or the
    // Google photo when provided) + the operator name + a Premium pill. The
    // pill is a [data-plan-badge] mount that refreshPlan() fills. Clicking
    // the chip opens the Settings drawer at the Controls tab (where
    // sign-in/sign-out live).
    const hc = $('hdr-signin');
    if (hc) {
      hc.hidden = false;
      hc.title = 'Signed in as ' + (user.email || user.name || user.sub || 'Operator');
      hc.innerHTML = '';
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
      const nm = document.createElement('span');
      nm.className = 'hdr-chip-name';
      nm.textContent = user.name || user.email || 'Operator';
      const pill = document.createElement('span');
      pill.className = 'plan-pill';
      pill.setAttribute('data-plan-badge', '');
      pill.hidden = true;
      hc.appendChild(avatar);
      hc.appendChild(nm);
      hc.appendChild(pill);
    }
    document.dispatchEvent(new CustomEvent('mmgr:user-changed', { detail: user }));
    // Plan badge follows the identity (see refreshPlan below).
    refreshPlan();
    // AUTH MAINFRAME 2026-08-17 , password-change triggers follow the
    // account type on EVERY surface (the chip is app.html/admin.html
    // only; marketing pages render their own account row, so this must
    // run before the chip guard below).
    syncPwHosts();
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
    // AUTH MAINFRAME 2026-08-17 , password change (email accounts): the
    // shared control mounts into the signed-in chip; the trigger stays
    // hidden for Google accounts (no password exists for them).
    mountPasswordControl(chip);
  }

  // STABILIZATION 2026-08-16: renders the account's Premium pill into every
  // [data-plan-badge] mount on the page (project.html header chip, marketing
  // sign-in sheet, admin rail Account group) so the plan reflects wherever
  // the identity is shown , exactly like the app.html rail footer, which
  // keeps its own loadPlan() in mmgr-cloud-dash.js (same session-gated
  // endpoint; app.html has no [data-plan-badge] mounts, so no double render).
  // Free or unconfigured plan -> mounts stay hidden. Zero-throw: any failure
  // leaves the pills hidden and the page unaffected.
  async function refreshPlan() {
    let res;
    try {
      res = await fetch('/api/billing/status', { method: 'GET', credentials: 'same-origin' });
    } catch (e) { return; }
    if (!res.ok) return;
    let data = null;
    try { data = await res.json(); } catch (e) { return; }
    if (!data || !data.ok || !data.configured) return;
    const mounts = document.querySelectorAll('[data-plan-badge]');
    for (let i = 0; i < mounts.length; i++) {
      if (data.active) {
        mounts[i].hidden = false;
        mounts[i].innerHTML = '<svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-check"></use></svg> Premium';
      } else {
        mounts[i].hidden = true;
      }
    }
    document.dispatchEvent(new CustomEvent('mmgr:plan-changed', { detail: data }));
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
    } catch (e) { /* static host / offline , fall through */ }
    showButton();
  }

  // GIS credential callback: hand the ID token to the Worker. On success show
  // the chip + notify (event + optional hook). On failure do NOTHING that
  // could imply signed-in state , the user stays exactly where they are.
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
        // Worker rejected the token (or a stale/forged credential) , no false
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

  // OWNER 2026-08-15: programmatic sign-in prompt for cloud actions that
  // need a Google session (owner-code recovery, admin publish-linking).
  // Must run inside a user gesture (a click handler). Shows the GIS One Tap
  // / account chooser immediately , "pop the Google sign-in prompt right
  // there" , and falls back to clicking the rendered GIS button when the
  // prompt API is unavailable (blocked / iframe). Returns true when a prompt
  // path was attempted, false when GIS is genuinely unavailable. If already
  // signed in, it's a no-op success.
  function openSignInPrompt() {
    if (isSignedIn()) return true;
    if (!gisReady() && !initGIS()) return false;
    try {
      const id = window.google && window.google.accounts && window.google.accounts.id;
      if (id && typeof id.prompt === 'function') {
        id.prompt();
        return true;
      }
    } catch (e) { /* fall through to the button-click fallback */ }
    const host = $('google-signin-button');
    if (host) {
      const btn = host.querySelector('div[role="button"], button, iframe');
      if (btn) {
        try { btn.click(); return true; } catch (e) { /* last resort */ }
      }
    }
    return false;
  }

  /* ============================================================
     EMAIL + PASSWORD SIGN-IN (deferred cloud item #14, completed
     2026-08-12) , alternative provider beside Google.
     ------------------------------------------------------------
     Register/login validate against D1 auth_users and issue the SAME
     mmgr_session cookie as Google, with sub = 'email:<address>' , a
     namespace that can never collide with Google's numeric subs, so
     every downstream system (cloud owner identity, prefs R2 keys,
     presence roster, billing owner_sub) treats the account identically.

     UI: a compact "Sign in with email instead" toggle + form mounted
     right after #google-signin-button (the app.html + admin.html auth
     bars). Zero inline handlers (module binds directly); the password
     field is cleared after every attempt (never echoed); failures land
     in a role="status" live region; on success the SAME
     mmgr:google-signed-in event fires so the project.html cloud drawer
     (which re-reads /api/auth/me) and any other listener refresh.
     ============================================================ */
  let _emailMode = 'login'; // 'login' | 'register' (one mount per page)
  // AUTH MAINFRAME v2: the signed-in user behind a register-with-verification
  // "check your inbox" panel. The session cookie is already set server-side;
  // "Got it" completes the sign-in render (showUser + events) for this user.
  let _checkUser = null;

  function emailAuthMarkup() {
    return '<div class="email-auth" id="email-auth-block">' +
      '<button type="button" class="email-auth-toggle">Sign in with email instead</button>' +
      '<form class="email-auth-form" novalidate hidden>' +
      '<div class="email-auth-row">' +
      '<input type="email" class="email-auth-input" placeholder="Email" autocomplete="email" aria-label="Email" inputmode="email" enterkeyhint="next" autocapitalize="none" required>' +
      '<input type="password" class="email-auth-input email-auth-pass" placeholder="Password (8+ chars)" autocomplete="current-password" aria-label="Password" inputmode="text" enterkeyhint="done" autocapitalize="none" minlength="8" required>' +
      '<input type="text" class="email-auth-input email-auth-name" placeholder="Name (optional)" autocomplete="name" aria-label="Name" inputmode="text" enterkeyhint="next" autocapitalize="words" hidden>' +
      '<button type="submit" class="btn btn-n btn-s email-auth-submit">Sign in</button>' +
      '</div>' +
      '<div class="email-auth-alt">' +
      '<button type="button" class="email-auth-mode">Create an account instead</button>' +
      '<button type="button" class="email-auth-forgot">Forgot password?</button>' +
      '</div>' +
      '<div class="email-auth-err" role="status" aria-live="polite"></div>' +
      '</form>' +
      // AUTH MAINFRAME v2 , forgot-password request panel (login sheet). The
      // server answers the SAME generic message whether or not the account
      // exists, so this form can never probe which emails have accounts.
      '<div class="email-auth-reset" hidden>' +
      '<p class="email-auth-reset-title"><strong>Reset your password</strong></p>' +
      '<p class="email-auth-reset-msg">Enter your email and we will send a reset link if an account exists for it.</p>' +
      '<div class="email-auth-row">' +
      '<input type="email" class="email-auth-input" placeholder="Email" autocomplete="email" aria-label="Email for reset" inputmode="email" enterkeyhint="done" autocapitalize="none" required>' +
      '<button type="button" class="btn btn-n btn-s email-auth-submit email-auth-reset-submit">Send reset link</button>' +
      '</div>' +
      '<div class="email-auth-err" role="status" aria-live="polite"></div>' +
      '<div class="email-auth-alt"><button type="button" class="email-auth-reset-back">Back to sign in</button></div>' +
      '</div>' +
      // AUTH MAINFRAME v2 , "check your inbox" panel (register verification /
      // reset-request outcomes). The Resend button only shows for the verify
      // case (POST /api/auth/resend-verify); reset just tells the user to
      // check their inbox (the response is deliberately generic).
      '<div class="email-auth-check" role="status" aria-live="polite" hidden>' +
      '<svg class="ico email-auth-check-ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-mail"></use></svg>' +
      '<p class="email-auth-check-title"><strong>Check your inbox</strong></p>' +
      '<p class="email-auth-check-msg"></p>' +
      '<button type="button" class="email-auth-resend">Resend confirmation link</button>' +
      '<button type="button" class="email-auth-check-close">Got it</button>' +
      '</div>' +
      '</div>';
  }

  function emailAuthQ(block, sel) { return block ? block.querySelector(sel) : null; }

  function setEmailAuthError(block, msg) {
    const err = emailAuthQ(block, '.email-auth-err');
    if (err) err.textContent = msg || '';
  }

  // POST to the Worker and resolve with the signed-in user on success.
  // Rejects with a user-facing message on any failure (incl. the auth
  // rate-limit 429). Never throws on network errors , same zero-throw
  // discipline as the Google path.
  async function emailAuthPost(path, payload) {
    let res;
    try {
      res = await fetch(path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      throw new Error('Sign-in is unavailable on this host (needs the Worker API).');
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON failure */ }
    if (!res.ok || !data || !data.ok) {
      if (res.status === 429) throw new Error('Too many attempts , wait a minute and try again.');
      throw new Error((data && data.error) || 'Sign-in failed (HTTP ' + res.status + ').');
    }
    return data;
  }

  function emailLogin(email, password) {
    return emailAuthPost('/api/auth/login', { email: email, password: password }).then(function(d) { return d.user; });
  }

  // AUTH MAINFRAME v2: register answers { user, emailSent } , emailSent tells
  // the UI whether a confirmation email was dispatched (verification flow).
  function emailRegister(email, password, name) {
    return emailAuthPost('/api/auth/register', { email: email, password: password, name: name }).then(function(d) {
      return { user: d.user, emailSent: d.emailSent === true };
    });
  }

  // Mount the toggle + form. Default host is #google-signin-button (app.html /
  // admin.html auth bars , the block is inserted right after it, preserving the
  // existing layout). Marketing pages pass their own container host (e.g.
  // 'marketing-email-auth'): the block is then appended INSIDE that container
  // and, with opts.showToggle === false, the "Sign in with email instead" toggle
  // is hidden and the form shown directly (there is no Google button there).
  // Idempotent per host: a second call next to the same host is a no-op.
  // No-ops entirely when the host doesn't exist (project.html has no auth bar).
  function mountEmailAuth(hostId, opts) {
    const custom = typeof hostId === 'string' && hostId !== 'google-signin-button';
    const host = $(custom ? hostId : 'google-signin-button');
    if (!host) return;
    if (host.querySelector && host.querySelector('#email-auth-block')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = emailAuthMarkup();
    const block = wrap.firstElementChild;
    if (custom) {
      host.appendChild(block);
    } else {
      if (host.nextElementSibling && host.nextElementSibling.id === 'email-auth-block') return;
      host.insertAdjacentElement('afterend', block);
    }
    if (opts && opts.showToggle === false) {
      const tg = block.querySelector('.email-auth-toggle');
      if (tg) tg.hidden = true;
      const f = block.querySelector('.email-auth-form');
      if (f) f.hidden = false;
    }
    wireEmailAuth(block);
  }

  // AUTH MAINFRAME v2 , show the "check your inbox" panel (form + reset panel
  // hidden). showResend reveals the Resend-confirmation-link button (verify
  // case only , reset sends no follow-up action).
  function showEmailAuthCheck(block, msg, showResend) {
    const f = emailAuthQ(block, '.email-auth-form');
    const rp = emailAuthQ(block, '.email-auth-reset');
    const chk = emailAuthQ(block, '.email-auth-check');
    const msgEl = emailAuthQ(block, '.email-auth-check-msg');
    const resendBtn = emailAuthQ(block, '.email-auth-resend');
    if (f) f.hidden = true;
    if (rp) rp.hidden = true;
    if (msgEl && msg) msgEl.textContent = msg;
    if (resendBtn) resendBtn.hidden = !showResend;
    if (chk) chk.hidden = false;
    setEmailAuthError(block, '');
  }

  function hideEmailAuthCheck(block) {
    const chk = emailAuthQ(block, '.email-auth-check');
    if (chk) chk.hidden = true;
  }

  function wireEmailAuth(block) {
    const form = emailAuthQ(block, '.email-auth-form');
    const toggle = emailAuthQ(block, '.email-auth-toggle');
    const modeBtn = emailAuthQ(block, '.email-auth-mode');
    const errEl = emailAuthQ(block, '.email-auth-err');
    const nameEl = emailAuthQ(block, '.email-auth-name');
    const submitBtn = emailAuthQ(block, '.email-auth-submit');
    const forgotBtn = emailAuthQ(block, '.email-auth-forgot');
    const resetPanel = emailAuthQ(block, '.email-auth-reset');
    const resetBack = emailAuthQ(block, '.email-auth-reset-back');
    const resetSubmit = emailAuthQ(block, '.email-auth-reset-submit');
    const checkPanel = emailAuthQ(block, '.email-auth-check');
    const checkMsg = emailAuthQ(block, '.email-auth-check-msg');
    const resendBtn = emailAuthQ(block, '.email-auth-resend');
    const checkClose = emailAuthQ(block, '.email-auth-check-close');
    if (!form || !toggle || !modeBtn) return;

    toggle.addEventListener('click', function() {
      form.hidden = !form.hidden;
      if (errEl) errEl.textContent = '';
      if (!form.hidden) {
        const em = emailAuthQ(form, 'input[type=email]');
        if (em) { try { em.focus(); } catch (e) { /* focus is a hint, never fatal */ } }
      }
    });

    modeBtn.addEventListener('click', function() {
      _emailMode = (_emailMode === 'login') ? 'register' : 'login';
      const isReg = _emailMode === 'register';
      if (nameEl) nameEl.hidden = !isReg;
      const pass = emailAuthQ(form, '.email-auth-pass');
      if (pass) pass.autocomplete = isReg ? 'new-password' : 'current-password';
      if (submitBtn) submitBtn.textContent = isReg ? 'Create account' : 'Sign in';
      modeBtn.textContent = isReg ? 'Already have an account? Sign in' : 'Create an account instead';
      if (forgotBtn) forgotBtn.hidden = isReg; // forgot-password is a LOGIN-only action
      if (errEl) errEl.textContent = '';
    });

    // AUTH MAINFRAME v2 , forgot-password: swap the form for the reset
    // request panel, POST /api/auth/forgot, then land on the generic
    // check-your-inbox state (no existence leak either way).
    if (forgotBtn) forgotBtn.addEventListener('click', function() {
      setEmailAuthError(block, '');
      form.hidden = true;
      if (resetPanel) resetPanel.hidden = false;
      const ri = resetPanel ? resetPanel.querySelector('input[type=email]') : null;
      if (ri) { try { ri.focus(); } catch (e) { /* focus is a hint */ } }
    });
    if (resetBack) resetBack.addEventListener('click', function() {
      setEmailAuthError(block, '');
      if (resetPanel) resetPanel.hidden = true;
      form.hidden = false;
    });
    if (resetSubmit) resetSubmit.addEventListener('click', function() {
      const ri = resetPanel ? resetPanel.querySelector('input[type=email]') : null;
      const email = (ri && ri.value) ? ri.value.trim() : '';
      const rerr = resetPanel ? emailAuthQ(resetPanel, '.email-auth-err') : null;
      if (!email) { if (rerr) { rerr.textContent = 'Enter your email address.'; rerr.hidden = false; } return; }
      if (rerr) rerr.hidden = true;
      resetSubmit.disabled = true;
      emailAuthPost('/api/auth/forgot', { email: email }).then(function() {
        showEmailAuthCheck(block, 'If an account exists for that email, a reset link is on its way.', false);
      }).catch(function(err) {
        if (rerr) { rerr.textContent = (err && err.message) || 'Could not send the reset link.'; rerr.hidden = false; }
      }).finally(function() {
        resetSubmit.disabled = false;
      });
    });

    // "Check your inbox" panel actions: resend the verification link (verify
    // case) and complete the deferred sign-in render (Got it).
    if (resendBtn) resendBtn.addEventListener('click', function() {
      const email = _checkUser && _checkUser.email ? _checkUser.email : '';
      if (!email) { if (checkMsg) checkMsg.textContent = 'Sign in with the account to request a new link.'; return; }
      resendBtn.disabled = true;
      emailAuthPost('/api/auth/resend-verify', { email: email }).then(function() {
        if (checkMsg) checkMsg.textContent = 'If an account needs verification, a new confirmation link is on its way , check your inbox.';
      }).catch(function(err) {
        if (checkMsg) checkMsg.textContent = (err && err.message) || 'Could not send the link right now.';
      }).finally(function() {
        resendBtn.disabled = false;
      });
    });
    if (checkClose) checkClose.addEventListener('click', function() {
      hideEmailAuthCheck(block);
      const user = _checkUser;
      _checkUser = null;
      if (user) {
        showUser(user);
        document.dispatchEvent(new CustomEvent('mmgr:google-signed-in', { detail: user }));
        if (typeof window.mmgrOnGoogleSignIn === 'function') {
          try { window.mmgrOnGoogleSignIn(user); } catch (e) { /* optional hook */ }
        }
      }
    });

    form.addEventListener('submit', function(e) {
      e.preventDefault();
      if (errEl) errEl.textContent = '';
      const em = emailAuthQ(form, 'input[type=email]');
      const pass = emailAuthQ(form, 'input[type=password]');
      const nm = emailAuthQ(form, '.email-auth-name');
      const email = (em && em.value) ? em.value.trim() : '';
      const password = (pass && pass.value) ? pass.value : '';
      const name = (nm && nm.value) ? nm.value.trim() : '';
      if (!email || !password) { setEmailAuthError(block, 'Enter your email and password.'); return; }
      if (password.length < 8) { setEmailAuthError(block, 'Password must be at least 8 characters.'); return; }
      if (pass) pass.value = ''; // never echo the password in the DOM
      const p = (_emailMode === 'register')
        ? emailRegister(email, password, name)
        : emailLogin(email, password);
      p.then(function(result) {
        // AUTH MAINFRAME v2: register now emails a confirmation link , show
        // the check-your-inbox state INSTEAD of the signed-in chip. The
        // session cookie is already set server-side; "Got it" completes the
        // sign-in render (showUser + events) so the user keeps the account.
        if (_emailMode === 'register' && result && result.emailSent) {
          _checkUser = result.user || null;
          showEmailAuthCheck(block, 'We sent a confirmation link to ' + email + '. Cloud projects unlock once you click it.', true);
          return;
        }
        // Login, or register on a host without email configured (dormant) , 
        // same success path as Google: chip replaces the auth surface, and
        // the identical event fires so the cloud drawer / hooks refresh.
        const user = (result && result.user) ? result.user : result;
        showUser(user);
        document.dispatchEvent(new CustomEvent('mmgr:google-signed-in', { detail: user }));
        if (typeof window.mmgrOnGoogleSignIn === 'function') {
          try { window.mmgrOnGoogleSignIn(user); } catch (e) { /* optional hook */ }
        }
      }).catch(function(err) {
        setEmailAuthError(block, (err && err.message) || 'Sign-in failed.');
      });
    });
  }

  /* ============================================================
     PASSWORD CHANGE (AUTH MAINFRAME , 2026-08-17) , the session-
     gated POST /api/auth/password endpoint wired into every account
     surface via mountPasswordControl(hostEl): the signed-in chip on
     app.html/admin.html (showUser mounts it), the marketing sign-in
     sheet's account row (marketing.js mounts it), and project.html
     Settings > Controls > Profile (auto-mounted into [data-pw-host]).
     The trigger shows ONLY for email accounts (sub = 'email:…');
     Google accounts have no password , the worker answers 400 for
     them , so the button is never rendered for those. States:
     form → busy → inline error (role=status) → success confirmation
     (every other device is signed out server-side). Passwords are
     cleared after every attempt; zero inline handlers; [hidden]
     guards on every panel.
     ============================================================ */
  let _pwRecs = []; // [{host, btn, panel, fields, actions, cur, next, conf, err, ok, submit, cancel}]

  function isEmailAccount(user) {
    return !!(user && user.sub && String(user.sub).indexOf('email:') === 0);
  }

  function pwMarkup() {
    return '<div class="email-auth-pw" hidden>' +
      '<p class="email-auth-pw-title"><strong>Change password</strong></p>' +
      '<p class="email-auth-pw-msg">You will stay signed in on this device. Every other device is signed out when the password changes.</p>' +
      '<div class="email-auth-row email-auth-pw-fields">' +
      '<input type="password" class="email-auth-input email-auth-pw-cur" placeholder="Current password" autocomplete="current-password" aria-label="Current password" inputmode="text" enterkeyhint="next" autocapitalize="none" required>' +
      '<input type="password" class="email-auth-input email-auth-pw-new" placeholder="New password (8+ chars)" autocomplete="new-password" aria-label="New password" inputmode="text" enterkeyhint="next" autocapitalize="none" minlength="8" required>' +
      '<input type="password" class="email-auth-input email-auth-pw-conf" placeholder="Confirm new password" autocomplete="new-password" aria-label="Confirm new password" inputmode="text" enterkeyhint="done" autocapitalize="none" minlength="8" required>' +
      '</div>' +
      '<div class="email-auth-row email-auth-pw-actions">' +
      '<button type="button" class="btn btn-g btn-s email-auth-pw-submit">Update password</button>' +
      '<button type="button" class="email-auth-pw-cancel">Cancel</button>' +
      '</div>' +
      '<div class="email-auth-err email-auth-pw-err" role="status" aria-live="polite"></div>' +
      '<p class="email-auth-pw-ok" role="status" hidden>Password updated. Every other device was signed out.</p>' +
      '</div>';
  }

  function resetPwPanel(rec) {
    if (!rec) return;
    if (rec.cur) rec.cur.value = '';
    if (rec.next) rec.next.value = '';
    if (rec.conf) rec.conf.value = '';
    if (rec.err) rec.err.textContent = '';
    if (rec.ok) rec.ok.hidden = true;
    if (rec.fields) rec.fields.hidden = false;
    if (rec.actions) rec.actions.hidden = false;
    if (rec.submit) { rec.submit.disabled = false; rec.submit.textContent = 'Update password'; }
  }

  function setPwError(rec, msg) {
    if (rec && rec.err) rec.err.textContent = msg || '';
  }

  async function pwAuthPost(payload) {
    let res;
    try {
      res = await fetch('/api/auth/password', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      throw new Error('Password change is unavailable on this host (needs the Worker API).');
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON failure */ }
    if (!res.ok || !data || !data.ok) {
      if (res.status === 429) throw new Error('Too many attempts , wait a minute and try again.');
      if (res.status === 401) throw new Error('Current password is incorrect.');
      throw new Error((data && data.error) || 'Could not update the password (HTTP ' + res.status + ').');
    }
    return data;
  }

  // Mount the Change-password trigger + panel into a host element (signed-in
  // chip / account row / settings section). Idempotent per host; the trigger
  // is hidden unless the signed-in account is an email account.
  function mountPasswordControl(host) {
    if (!host || !host.querySelector) return;
    if (host.querySelector('.email-auth-pw')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = pwMarkup();
    const panel = wrap.firstElementChild;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'email-auth-pw-btn';
    btn.textContent = 'Change password';
    btn.setAttribute('aria-expanded', 'false');
    const rec = {
      host: host, btn: btn, panel: panel,
      fields: panel.querySelector('.email-auth-pw-fields'),
      actions: panel.querySelector('.email-auth-pw-actions'),
      cur: panel.querySelector('.email-auth-pw-cur'),
      next: panel.querySelector('.email-auth-pw-new'),
      conf: panel.querySelector('.email-auth-pw-conf'),
      err: panel.querySelector('.email-auth-pw-err'),
      ok: panel.querySelector('.email-auth-pw-ok'),
      submit: panel.querySelector('.email-auth-pw-submit'),
      cancel: panel.querySelector('.email-auth-pw-cancel')
    };
    btn.addEventListener('click', function() {
      const open = panel.hidden;
      resetPwPanel(rec);
      panel.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open && rec.cur) { try { rec.cur.focus(); } catch (e) { /* focus is a hint */ } }
    });
    rec.cancel.addEventListener('click', function() {
      resetPwPanel(rec);
      panel.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    });
    rec.submit.addEventListener('click', function() {
      const cv = (rec.cur && rec.cur.value) ? rec.cur.value : '';
      const nv = (rec.next && rec.next.value) ? rec.next.value : '';
      const cfv = (rec.conf && rec.conf.value) ? rec.conf.value : '';
      setPwError(rec, '');
      if (!cv) { setPwError(rec, 'Enter your current password.'); return; }
      if (nv.length < 8) { setPwError(rec, 'New password must be at least 8 characters.'); return; }
      if (nv !== cfv) { setPwError(rec, 'New passwords do not match.'); return; }
      if (rec.cur) rec.cur.value = ''; // never echo passwords in the DOM
      if (rec.next) rec.next.value = '';
      if (rec.conf) rec.conf.value = '';
      rec.submit.disabled = true;
      rec.submit.textContent = 'Updating';
      pwAuthPost({ currentPassword: cv, newPassword: nv }).then(function() {
        if (rec.fields) rec.fields.hidden = true;
        if (rec.actions) rec.actions.hidden = true;
        setPwError(rec, '');
        if (rec.ok) rec.ok.hidden = false;
      }).catch(function(err) {
        setPwError(rec, (err && err.message) || 'Could not update the password.');
        if (rec.submit) rec.submit.textContent = 'Update password';
      }).finally(function() {
        if (rec.submit) rec.submit.disabled = false;
      });
    });
    // Trigger before the panel; when the host already ends with a sign-out
    // button (chip / sheet account row), slot both in front of it so the
    // account actions read Change password, then Sign out.
    const outBtn = host.querySelector('.signin-out, .gchip-out');
    if (outBtn) {
      host.insertBefore(btn, outBtn);
      host.insertBefore(panel, outBtn);
    } else {
      host.appendChild(btn);
      host.appendChild(panel);
    }
    _pwRecs.push(rec);
    syncPwHosts();
  }

  // Visibility follows the signed-in account type: only email accounts
  // (sub 'email:…') have a password to change. Signed out → hidden.
  function syncPwHosts() {
    const show = isEmailAccount(_user);
    _pwRecs.forEach(function(rec) {
      if (rec.btn) rec.btn.hidden = !show;
      if (!show && rec.panel && !rec.panel.hidden) {
        resetPwPanel(rec);
        rec.panel.hidden = true;
        if (rec.btn) rec.btn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ============================================================
     GOOGLE-DRIVE-BACKUP , optional Drive backup & restore
     ------------------------------------------------------------
     Strictly client-side, strictly local-first: the workspace JSON
     goes DIRECTLY from this browser to the Google Drive REST API
     using the OAuth access token , no server relay, no third party.

     - The GIS ID-token flow (above) cannot request OAuth scopes, so
       a separate GIS OAuth2 token client is used for Drive. It asks
       for https://www.googleapis.com/auth/drive.file ONLY , the app
       sees files it created (mymanager-backup.json), never the
       user's whole Drive.
     - The access token is kept in a MODULE variable (session memory)
       , never localStorage, never shipped to the Worker, never
       logged. It is refreshed silently by GIS when needed.
     - Backup collects ONLY the workspace slots in localStorage
       (mmgr_state_*, mmgr_unlocked_*, mmgr_scope_*, current project)
       , device-only slots (sync identity, client id, error webhook,
       glass mode, viewport prefs) are deliberately excluded, so they
       never leave this device.
     - OPTIONAL passphrase encryption: when a passphrase is set, the
       envelope is sealed with AES-256-GCM (key derived via PBKDF2,
       250k iterations, fresh salt + IV per backup) BEFORE upload, so
       project-state secrets like AI API keys never sit in Drive as
       plaintext. The passphrase lives in session memory only (module
       var + sessionStorage) and never leaves this device. Encryption
       is FAIL-CLOSED: while it is ON, a backup with no session
       passphrase refuses to upload rather than silently downgrade to
       plaintext. Legacy plaintext backups still restore fine.
     - Restore validates the envelope, writes back only workspace
       keys, then reloads. A stale backup never wipes local state
       without the user confirming first.
     - Zero-throw: missing GIS, offline, denied scope, or a 401 all
       degrade to a status line , never a crash.
     ============================================================ */
  const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const DRIVE_FILE = 'mymanager-backup.json';
  const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
  const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

  let _driveToken = null;      // session memory ONLY (module variable)
  let _driveTokenExpiry = 0;
  let _driveTokenClient = null;
  let _tokenWaiter = null;
  let _tokenInflight = false;  // re-entry guard: one token request at a time

  // Auto-backup device-level prefs (localStorage, same family as the
  // mmgr_sync_* slots , never project state).
  const AUTO_KEY = 'mmgr_drive_auto';   // 'off' | '15' | '30' | '60' (minutes)
  const LAST_KEY = 'mmgr_drive_last';   // ISO timestamp of last successful auto backup

  // The OAuth access token also caches to sessionStorage , literal "session
  // memory" that survives a reload WITHIN the same tab session, so the
  // background auto-backup keeps working after refresh without re-consent.
  // Never localStorage (a token must not outlive the session), never shipped.
  const DRIVE_TOKEN_KEY = 'mmgr_drive_token';
  const DRIVE_TOKEN_EXP_KEY = 'mmgr_drive_token_exp';
  const DRIVE_GRANT_KEY = 'mmgr_drive_granted'; // '1' once a grant was ever obtained

  let _autoInterval = 'off';
  let _autoTimer = null;
  let _driveBusy = false;     // manual/auto mutual exclusion for Drive ops

  // Optional passphrase encryption. The passphrase itself is session memory
  // ONLY (module var + sessionStorage, exactly like the OAuth token) , never
  // localStorage, never shipped , while the "encryption is ON" flag is a
  // persistent device pref (localStorage) so a fresh session fails CLOSED
  // instead of silently uploading plaintext after a browser restart.
  const ENC_FLAG_KEY = 'mmgr_drive_enc';   // '1' = backups must be encrypted
  const ENC_PASS_KEY = 'mmgr_drive_pass';  // sessionStorage: this session's passphrase
  const KDF_ITERS = 250000;                // PBKDF2-SHA256 iterations
  const KDF_HASH = 'SHA-256';
  const CIPHER = 'AES-256-GCM';
  let _drivePass = '';                     // session memory ONLY

  function oauth2Ready() {
    return !!(window.google && window.google.accounts && window.google.accounts.oauth2);
  }

  // The GIS script is async+defer in the page head , if the user clicks a
  // Drive button before it has loaded, wait (briefly) for it instead of
  // reporting "unavailable". Injects the script if the tag is missing
  // (admin.html / offline-first shells). Zero-throw; rejects on timeout.
  function waitForOAuth2() {
    if (oauth2Ready()) return Promise.resolve(true);
    return new Promise(function(resolve) {
      const s = document.querySelector('script[src*="gsi/client"]');
      let t = null;
      let done = false;
      const finish = function(ok) { if (!done) { done = true; if (t) clearTimeout(t); resolve(ok); } };
      if (s && typeof s.addEventListener === 'function') {
        s.addEventListener('load', function() { finish(oauth2Ready()); });
        s.addEventListener('error', function() { finish(false); });
      } else {
        try {
          const tag = document.createElement('script');
          tag.src = GIS_SRC;
          tag.async = true;
          tag.onload = function() { finish(oauth2Ready()); };
          tag.onerror = function() { finish(false); };
          document.head.appendChild(tag);
        } catch (e) { finish(false); return; }
      }
      t = setTimeout(function() { finish(oauth2Ready()); }, 8000);
    });
  }

  // Workspace keys only , device-only slots never ride along (see header).
  function isWorkspaceKey(k) {
    return k === 'mmgr_current_project' ||
      k.indexOf('mmgr_state_') === 0 ||
      k.indexOf('mmgr_unlocked_') === 0 ||
      k.indexOf('mmgr_scope_') === 0;
  }

  // GIS OAuth2 token-client callback: stores the access token in session
  // memory and resolves the pending promise. Never throws.
  function persistDriveToken(token, expiry) {
    _driveToken = token;
    _driveTokenExpiry = expiry;
    try {
      sessionStorage.setItem(DRIVE_TOKEN_KEY, token);
      sessionStorage.setItem(DRIVE_TOKEN_EXP_KEY, String(expiry));
    } catch (e) { /* sessionStorage blocked , module var still holds it */ }
  }
  function clearDriveTokenCache() {
    _driveToken = null;
    _driveTokenExpiry = 0;
    try { sessionStorage.removeItem(DRIVE_TOKEN_KEY); sessionStorage.removeItem(DRIVE_TOKEN_EXP_KEY); } catch (e) { /* ignore */ }
  }
  // Restore the token from sessionStorage if a valid one exists there.
  function restoreDriveToken() {
    if (_driveToken && Date.now() < _driveTokenExpiry) return _driveToken;
    try {
      const t = sessionStorage.getItem(DRIVE_TOKEN_KEY);
      const e = parseInt(sessionStorage.getItem(DRIVE_TOKEN_EXP_KEY) || '0', 10);
      if (t && e > Date.now()) {
        _driveToken = t;
        _driveTokenExpiry = e;
        return t;
      }
    } catch (e2) { /* ignore */ }
    return null;
  }

  function driveTokenCallback(resp) {
    const w = _tokenWaiter;
    _tokenWaiter = null;
    if (!w) return;
    if (resp && resp.access_token) {
      persistDriveToken(resp.access_token, Date.now() + ((resp.expires_in || 3600) * 1000) - 30000); // 30s safety margin
      try { localStorage.setItem(DRIVE_GRANT_KEY, '1'); } catch (e) { /* ignore */ }
      w.resolve(_driveToken);
    } else {
      w.reject(new Error((resp && resp.error_description) || (resp && resp.error) || 'Google Drive access was not granted.'));
    }
  }

  // Lazy-build the GIS OAuth2 token client for drive.file. Zero-throw.
  function driveTokenClient() {
    if (!oauth2Ready()) return null;
    if (_driveTokenClient) return _driveTokenClient;
    try {
      _driveTokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: DRIVE_SCOPE,
        callback: driveTokenCallback
      });
    } catch (e) { _driveTokenClient = null; }
    return _driveTokenClient;
  }

  // Resolves with a drive.file access token. forceConsent pops the consent
  // screen; otherwise GIS stays silent when a previous grant exists.
  function requestDriveToken(forceConsent) {
    const client = driveTokenClient();
    if (!client) {
      return Promise.reject(new Error('Google sign-in is unavailable (offline or blocked) , Drive backup needs Google.'));
    }
    return new Promise(function(resolve, reject) {
      _tokenWaiter = { resolve: resolve, reject: reject };
      try {
        client.requestAccessToken(forceConsent ? { prompt: 'consent' } : {});
      } catch (e) {
        _tokenWaiter = null;
        reject(e);
      }
    });
  }

  async function getDriveToken(forceConsent) {
    if (!forceConsent) {
      const cached = restoreDriveToken();
      if (cached) return cached;
    }
    // Re-entry guard: never stack a second token request on top of a pending
    // one (a stale waiter would orphan the first promise forever).
    if (_tokenInflight) {
      throw new Error('A Google sign-in request is already in progress , wait for it to finish.');
    }
    try {
      if (!oauth2Ready()) await waitForOAuth2(); // let the async GIS script catch up
      _tokenInflight = true;
      const t = await requestDriveToken(forceConsent);
      _tokenInflight = false;
      return t;
    } catch (e) {
      _tokenInflight = false;
      // On the silent path, retry once with the consent screen so real
      // errors (denied scope, misconfigured client) surface to the user.
      if (!forceConsent && !(e && e.message && e.message.indexOf('already in progress') > -1)) {
        return requestDriveToken(true);
      }
      throw e;
    }
  }

  // Silent variant for the background auto-backup timer: NEVER pops the
  // consent screen, NEVER throws. Returns a valid token or null , the timer
  // just skips that tick and tries again on the next interval.
  async function getDriveTokenSilent() {
    const cached = restoreDriveToken();
    if (cached) return cached;
    // No usable token: only attempt a (silent) refresh if a grant was ever
    // obtained on this device , otherwise a timer would surprise the user
    // with a consent popup out of nowhere.
    let granted = false;
    try { granted = localStorage.getItem(DRIVE_GRANT_KEY) === '1'; } catch (e) { /* ignore */ }
    if (!granted || _tokenInflight) return null;
    try {
      if (!oauth2Ready()) await waitForOAuth2();
      if (!oauth2Ready()) return null;
      _tokenInflight = true;
      const t = await requestDriveToken(false); // GIS stays silent when a prior grant exists
      _tokenInflight = false;
      return t;
    } catch (e) {
      _tokenInflight = false;
      if (window.console && window.console.warn) window.console.warn('mmgr-google-auth: silent Drive token refresh skipped', e && e.message);
      return null;
    }
  }

  // Authorized Drive fetch with one 401 → refresh-and-retry. Never throws on
  // HTTP errors; callers inspect res.ok. silentOnly (auto-backup path) keeps
  // the retry quiet: refresh via getDriveTokenSilent (never a consent popup)
  // and bail out , no fallback to the interactive consent screen.
  async function driveFetch(url, options, token, retried, silentOnly) {
    if (!token) token = silentOnly ? await getDriveTokenSilent() : await getDriveToken(false);
    if (!token) throw new Error('No Google Drive access token.');
    const res = await fetch(url, {
      method: (options && options.method) || 'GET',
      headers: Object.assign({ Authorization: 'Bearer ' + token }, (options && options.headers) || {}),
      body: options && options.body
    });
    if (res.status === 401 && !retried) {
      clearDriveTokenCache();
      const fresh = silentOnly ? await getDriveTokenSilent() : await getDriveToken(false);
      if (!fresh) throw new Error('Google Drive session expired , sign in again to back up.');
      return driveFetch(url, options, fresh, true, silentOnly);
    }
    return res;
  }

  function driveApiError(res, data) {
    const e = data && data.error;
    if (typeof e === 'string') return e;
    if (e && e.message) return e.message;
    if (data && data.message) return data.message;
    return '';
  }

  // ---- Passphrase encryption (Web Crypto, secure-context only) ------------
  // AES-256-GCM with a PBKDF2-derived key; fresh 16-byte salt + 12-byte IV on
  // every backup so identical workspaces never produce identical ciphertext.
  // GCM authenticates the ciphertext, so a wrong passphrase FAILS decryption
  // (tag mismatch) instead of yielding garbage , restore can detect it and
  // refuses to overwrite anything.
  function cryptoOk() {
    return !!(window.crypto && window.crypto.subtle && window.TextEncoder && window.TextDecoder);
  }
  function bytesToB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) { // chunked , no call-stack overflow on big states
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // iters/hash default to the current constants but may be overridden from the
  // envelope's recorded kdf metadata (see decryptPayload) so that a future KDF
  // change never bricks older encrypted backups.
  async function derivePassKey(pass, saltBytes, iters, hash) {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: saltBytes, iterations: iters || KDF_ITERS, hash: hash || KDF_HASH },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }
  // Seal a plain JSON object -> { salt, iv, data(base64 ciphertext) }.
  async function encryptPayload(obj, pass) {
    if (!cryptoOk()) throw new Error('Encryption is unavailable in this browser (needs HTTPS).');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await derivePassKey(pass, salt);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
    return { salt: bytesToB64(salt), iv: bytesToB64(iv), data: bytesToB64(new Uint8Array(ct)) };
  }
  // Unseal { salt, iv, data }. GCM auth failure (wrong passphrase / tampered
  // file) rejects with an OperationError, which callers translate to a clear
  // message , nothing is ever written on a failed decrypt.
  // kdfOverride comes from the envelope ({ iterations, hash }) so backups made
  // with different KDF settings still decrypt; falls back to the constants.
  async function decryptPayload(enc, pass, kdfOverride) {
    if (!cryptoOk()) throw new Error('Encryption is unavailable in this browser (needs HTTPS).');
    if (!enc || !enc.salt || !enc.iv || !enc.data) throw new Error('Encrypted backup is missing its key material.');
    const iters = (kdfOverride && kdfOverride.iterations > 0) ? kdfOverride.iterations : KDF_ITERS;
    const hash = (kdfOverride && kdfOverride.hash) ? kdfOverride.hash : KDF_HASH;
    const key = await derivePassKey(pass, b64ToBytes(enc.salt), iters, hash);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(enc.iv) }, key, b64ToBytes(enc.data));
    return JSON.parse(new TextDecoder().decode(pt));
  }

  // ---- Passphrase state (session memory + persistent ON flag) --------------
  function encryptionEnabled() {
    let flag = false;
    try { flag = localStorage.getItem(ENC_FLAG_KEY) === '1'; } catch (e) { /* ignore */ }
    return flag || !!_drivePass;
  }
  function getDrivePass() {
    if (_drivePass) return _drivePass;
    try { _drivePass = sessionStorage.getItem(ENC_PASS_KEY) || ''; } catch (e) { _drivePass = ''; }
    return _drivePass;
  }
  // Setting a non-empty passphrase turns encryption ON (persistent flag);
  // clearing it turns it OFF again. Returns whether encryption is now on.
  function setDrivePass(pass) {
    const p = String(pass || '');
    _drivePass = p;
    try {
      if (p) {
        sessionStorage.setItem(ENC_PASS_KEY, p);
        localStorage.setItem(ENC_FLAG_KEY, '1');
      } else {
        sessionStorage.removeItem(ENC_PASS_KEY);
        localStorage.removeItem(ENC_FLAG_KEY);
      }
    } catch (e) { /* storage blocked , module var still holds it */ }
    return !!p;
  }
  // data-action / auth-bar entry point. Refuses to enable when the browser
  // can't encrypt, and never leaves the passphrase echoing in the input.
  function setDrivePassFrom(el) {
    const v = (el && el.value != null) ? el.value : '';
    if (v && !cryptoOk()) {
      if (el && 'value' in el) el.value = '';
      setDriveStatus('Encryption is unavailable in this browser (needs HTTPS) , passphrase not saved.', 'err');
      return;
    }
    const on = setDrivePass(v);
    if (el && 'value' in el) el.value = ''; // never echo the passphrase in the DOM
    setDriveStatus(on
      ? 'Backup encryption ON , future backups are passphrase-encrypted (AES-256-GCM).'
      : 'Backup encryption OFF , backups upload as plaintext.',
      on ? 'ok' : 'warn');
  }

  // Collect ONLY the workspace slots (see isWorkspaceKey). Envelope has a
  // version + kind so restore can reject foreign JSON safely.
  function collectWorkspace() {
    const data = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && isWorkspaceKey(k)) data[k] = localStorage.getItem(k);
      }
    } catch (e) { /* storage locked , best effort */ }
    return {
      app: 'mymanager',
      kind: 'workspace-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      data: data
    };
  }

  // Find the existing backup so repeated backups UPDATE it instead of
  // piling up duplicate files in Drive. Returns null on first run.
  async function findDriveBackup(silentOnly) {
    const q = encodeURIComponent("name = '" + DRIVE_FILE + "' and trashed = false");
    const res = await driveFetch(DRIVE_API + '?q=' + q + '&spaces=drive&fields=files(id,name,modifiedTime)', null, null, false, silentOnly);
    const data = await res.json().catch(function() { return {}; });
    if (!res.ok) throw new Error(driveApiError(res, data) || 'Drive search failed (HTTP ' + res.status + ').');
    return (data.files && data.files[0]) || null;
  }

  // Package the workspace and push it to Drive (multipart upload). Creates
  // mymanager-backup.json on first run, PATCHes it on later runs. When
  // silentOnly is set (auto-backup) every Drive call stays quiet , no consent
  // popup can ever come from this path.
  async function backupToDrive(silentOnly) {
    const payload = collectWorkspace();
    // Optional passphrase encryption: when ON, seal the workspace envelope
    // with AES-256-GCM BEFORE it leaves this device. Fail-closed , if the
    // flag is on but no passphrase is in session memory (fresh browser
    // session), REFUSE to upload rather than silently write plaintext to
    // Drive. The inner payload (exportedAt + data) is what gets sealed.
    let uploadDoc = payload; // plaintext (legacy envelope v1) when encryption is off
    if (encryptionEnabled()) {
      const pass = getDrivePass();
      if (!pass) {
        throw new Error('Backup encryption is ON , enter your backup passphrase first (a backup never uploads plaintext while it\u2019s on).');
      }
      if (!cryptoOk()) {
        throw new Error('Encryption is unavailable in this browser (needs HTTPS) , turn backup encryption off or use a secure connection.');
      }
      const sealed = await encryptPayload(payload, pass);
      uploadDoc = {
        app: 'mymanager',
        kind: 'workspace-backup',
        version: 2,
        encrypted: true,
        cipher: CIPHER,
        kdf: { name: 'PBKDF2', iterations: KDF_ITERS, hash: KDF_HASH },
        salt: sealed.salt,
        iv: sealed.iv,
        exportedAt: payload.exportedAt,
        data: sealed.data
      };
    }
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify({ name: DRIVE_FILE, mimeType: 'application/json' })], { type: 'application/json' }));
    form.append('file', new Blob([JSON.stringify(uploadDoc)], { type: 'application/json' }));

    const existing = await findDriveBackup(silentOnly);
    const url = existing && existing.id
      ? DRIVE_UPLOAD + '/' + encodeURIComponent(existing.id) + '?uploadType=multipart'
      : DRIVE_UPLOAD + '?uploadType=multipart';
    const method = existing && existing.id ? 'PATCH' : 'POST';

    const res = await driveFetch(url, { method: method, body: form }, null, false, silentOnly);
    const result = await res.json().catch(function() { return {}; });
    if (!res.ok || !result.id) {
      throw new Error(driveApiError(res, result) || 'Backup upload failed (HTTP ' + res.status + ').');
    }
    return {
      fileId: result.id,
      updated: !!(existing && existing.id),
      exportedAt: payload.exportedAt,
      keyCount: Object.keys(payload.data).length
    };
  }

  // Find + download the backup, validate the envelope, restore workspace
  // keys into localStorage. Returns the count written.
  async function restoreFromDrive() {
    const existing = await findDriveBackup();
    if (!existing || !existing.id) {
      throw new Error('No backup found on Drive yet , run "Backup to Drive" first.');
    }
    const res = await driveFetch(DRIVE_API + '/' + encodeURIComponent(existing.id) + '?alt=media');
    if (!res.ok) throw new Error('Restore download failed (HTTP ' + res.status + ').');
    const raw = await res.json().catch(function() { return null; });
    // Encrypted envelope (v2): unseal with the session passphrase first. GCM
    // auth failure on a wrong passphrase throws BEFORE any key is written, so
    // a bad passphrase can never wipe local data.
    let payload = raw;
    if (raw && raw.encrypted) {
      const pass = getDrivePass();
      if (!pass) {
        throw new Error('That backup is encrypted , enter your backup passphrase (Backup settings) to restore it.');
      }
      try {
        // Pass the envelope's recorded KDF settings so a future iteration/hash
        // change never orphans older encrypted backups.
        payload = await decryptPayload(raw, pass, (raw && raw.kdf) ? raw.kdf : null);
      } catch (e) {
        throw new Error('Wrong passphrase or corrupted backup , nothing was restored.');
      }
    }
    if (!payload || payload.app !== 'mymanager' || payload.kind !== 'workspace-backup' || !payload.data || typeof payload.data !== 'object') {
      throw new Error('That Drive file is not a My MaNaGeR workspace backup.');
    }
    let written = 0;
    for (const k of Object.keys(payload.data)) {
      if (!isWorkspaceKey(k)) continue; // never restore device-only slots
      try { localStorage.setItem(k, String(payload.data[k])); written++; } catch (e) { /* skip */ }
    }
    return { written: written, exportedAt: payload.exportedAt };
  }

  // ---- Auto-backup engine -------------------------------------------------
  // Background timer: checks every 60s, backs up at most once per selected
  // interval, and NEVER pops the consent screen (getDriveTokenSilent). A
  // failed or un-granted tick is skipped quietly and retried next interval.
  function getAutoInterval() {
    try {
      const v = localStorage.getItem(AUTO_KEY);
      return (v === '15' || v === '30' || v === '60') ? v : 'off';
    } catch (e) { return 'off'; }
  }
  function setAutoInterval(v) {
    const val = (v === '15' || v === '30' || v === '60') ? v : 'off';
    try { localStorage.setItem(AUTO_KEY, val); } catch (e) { /* ignore */ }
    _autoInterval = val;
    // Keep the auth-bar select in sync when set programmatically.
    const sel = $('drive-auto-interval');
    if (sel && String(sel.value) !== val) sel.value = val;
    startAutoTimer();
    return val;
  }
  function getLastAutoBackup() {
    try { return localStorage.getItem(LAST_KEY) || ''; } catch (e) { return ''; }
  }
  function setLastAutoBackup(iso) {
    try { localStorage.setItem(LAST_KEY, iso || new Date().toISOString()); } catch (e) { /* ignore */ }
  }

  async function runAutoBackupCheck() {
    if (_autoInterval === 'off' || _driveBusy) return false;
    const mins = parseInt(_autoInterval, 10);
    if (!mins || mins <= 0) return false;
    // Respect the chosen interval since the last successful auto backup.
    const last = getLastAutoBackup();
    if (last && Number.isFinite(new Date(last).getTime()) && (Date.now() - new Date(last).getTime()) < mins * 60000) return false;
    // Silent token only , never a consent popup from a background timer.
    const token = await getDriveTokenSilent();
    if (!token) return false;
    _driveBusy = true;
    setDriveBusy(true);
    setDriveStatus('Auto-backup…', 'busy');
    try {
      const r = await backupToDrive(true); // silentOnly , every call stays quiet
      setLastAutoBackup(new Date().toISOString());
      if (!document.hidden) setDriveStatus('Auto-backup saved , ' + r.keyCount + ' workspace keys.', 'ok');
      return true;
    } catch (e) {
      if (window.console && window.console.warn) window.console.warn('mmgr-google-auth: auto-backup skipped', e && e.message);
      // Fail-closed: when encryption is ON but the session passphrase is
      // missing, the user must act to resume backups , show a persistent hint
      // (only when the tab is visible) instead of going completely silent.
      const noPass = /passphrase/i.test((e && e.message) || '');
      if (!document.hidden) setDriveStatus(noPass ? 'Enter your backup passphrase to resume auto-backup.' : '', 'err');
      return false;
    } finally {
      _driveBusy = false;
      setDriveBusy(false);
    }
  }

  function startAutoTimer() {
    if (_autoTimer) { clearInterval(_autoTimer); _autoTimer = null; }
    _autoInterval = getAutoInterval();
    // Controls-gated: no timer on pages without the Drive controls
    // (admin.html loads this module too, but auto-backup is a workspace
    // feature). Either the app.html auth-bar button or the project.html
    // drawer section (#drive-section) counts as a Drive-enabled page.
    if (_autoInterval === 'off' || (!$('btn-drive-backup') && !$('drive-section'))) return;
    _autoTimer = setInterval(function() {
      runAutoBackupCheck().catch(function() { /* timer tick must never throw */ });
    }, 60000);
  }

  // ---- UI wiring (app.html auth bar). No inline onclick , the module
  // binds the buttons directly, matching the zero-inline-handler rule. ----
  function setDriveStatus(msg, kind) {
    const s = $('drive-sync-status');
    if (!s) return;
    s.textContent = msg || '';
    s.className = 'drive-status' + (kind ? ' ds-' + kind : '');
  }
  function setDriveBusy(busy) {
    const b = $('btn-drive-backup');
    const r = $('btn-drive-restore');
    if (b) b.disabled = busy;
    if (r) r.disabled = busy;
    // The project.html drawer buttons use data-action delegation instead of
    // ids , disable them too so a running backup/restore can't be re-triggered
    // there (the _driveBusy guard would also block it, this is just visual).
    document.querySelectorAll('[data-action="driveBackup"], [data-action="driveRestore"]').forEach(function(btn) {
      btn.disabled = busy;
    });
  }

  // Shared auto-interval status line (used by both the app.html auth-bar
  // select and the project.html drawer select): chosen interval + next run.
  function autoIntervalStatus(v) {
    if (v === 'off') { setDriveStatus('Auto-backup off.', 'ok'); return; }
    const next = getLastAutoBackup();
    setDriveStatus('Auto-backup every ' + v + ' min' + (next ? ' , next ' + new Date(new Date(next).getTime() + parseInt(v, 10) * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '') + '.', 'ok');
  }

  // data-action entry point for the project.html drawer select: reads the
  // select's value, persists the device pref, restarts the timer, reports.
  function setAutoIntervalFrom(el) {
    const v = (el && el.value != null) ? el.value : 'off';
    autoIntervalStatus(setAutoInterval(v));
  }

  // Renders the optional Drive backup section into the Controls drawer on
  // project.html (#drive-section, right next to #sync-section). Uses the
  // drawer's existing classes (sr/sr-hint/exp-row/btn/ctl-in) , zero new
  // CSS. Buttons/select use data-action so the readonly guard and ACTION_MAP
  // delegation apply, exactly like the sync section above.
  function renderDriveSection() {
    const wrap = $('drive-section');
    if (!wrap) return;
    const cur = getAutoInterval();
    wrap.innerHTML =
      '<div class="sr"><span class="sl"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-folder"></use></svg> Google Drive Backup</span></div>' +
      '<div class="sr-hint">Optional , push this workspace to Google Drive (drive.file scope only, never your whole Drive) and pull it back on any device. Never required; JSON export/import stays the guaranteed sync path.</div>' +
      '<div class="exp-row">' +
      '<button class="btn btn-n btn-s" data-action="driveBackup"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-upload"></use></svg> Backup to Drive</button>' +
      '<button class="btn btn-n btn-s" data-action="driveRestore"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-download"></use></svg> Restore from Drive</button>' +
      '</div>' +
      '<div class="sr"><span class="sl">Auto backup</span><select class="ctl-in w150" data-action="driveAutoInterval">' +
      '<option value="off"' + (cur === 'off' ? ' selected' : '') + '>Off</option>' +
      '<option value="15"' + (cur === '15' ? ' selected' : '') + '>Every 15 min</option>' +
      '<option value="30"' + (cur === '30' ? ' selected' : '') + '>Every 30 min</option>' +
      '<option value="60"' + (cur === '60' ? ' selected' : '') + '>Every 60 min</option>' +
      '</select></div>' +
      '<div class="sr"><span class="sl"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-lock"></use></svg> Passphrase</span><input type="password" class="ctl-in w150" data-action="driveSetPass" placeholder="' + (encryptionEnabled() ? 'Encryption on , enter to change' : 'Encrypt backups (optional)') + '" autocomplete="new-password"></div>' +
      '<div class="sr-hint">Set a passphrase to encrypt every backup (AES-256-GCM, PBKDF2 key) so AI keys and other project-state secrets never sit in Drive as plaintext. The passphrase stays on this device; re-enter it after restarting the browser. Clear it to go back to plaintext backups.</div>' +
      '<div id="drive-sync-status" class="drive-status"></div>';
  }

  async function triggerBackup() {
    if (_driveBusy) return;
    _driveBusy = true;
    setDriveBusy(true);
    setDriveStatus('Backing up…', 'busy');
    try {
      const r = await backupToDrive();
      // A successful manual backup also resets the auto-interval clock, so
      // the timer never fires right after a manual one.
      setLastAutoBackup(new Date().toISOString());
      setDriveStatus('Backed up ' + r.keyCount + ' workspace keys' + (r.updated ? ' (updated)' : '') + ' , ' + r.exportedAt.slice(0, 10) + '.', 'ok');
    } catch (e) {
      setDriveStatus((e && e.message) || 'Backup failed.', 'err');
    } finally {
      _driveBusy = false;
      setDriveBusy(false);
    }
  }

  async function triggerRestore() {
    if (_driveBusy) return;
    // Restoring overwrites this device's local workspace , confirm first.
    if (!window.confirm('Replace this device\u2019s workspace with the backup from Google Drive? Current local data will be overwritten.')) return;
    _driveBusy = true;
    setDriveBusy(true);
    setDriveStatus('Restoring…', 'busy');
    try {
      const r = await restoreFromDrive();
      setDriveStatus('Restored ' + r.written + ' workspace keys , reloading.', 'ok');
      setTimeout(function() { window.location.reload(); }, 1200);
      // Safety net: if the reload is ever blocked, re-enable the controls.
      // Matches BOTH mounts , the app.html id-based button and the
      // project.html drawer's data-action button (no id).
      setTimeout(function() {
        if ($('btn-drive-restore') || document.querySelector('[data-action="driveRestore"]')) {
          _driveBusy = false;
          setDriveBusy(false);
        }
      }, 5000);
    } catch (e) {
      setDriveStatus((e && e.message) || 'Restore failed.', 'err');
      _driveBusy = false;
      setDriveBusy(false);
    }
  }

  function wireDriveControls() {
    const b = $('btn-drive-backup');
    const r = $('btn-drive-restore');
    if (b) b.addEventListener('click', triggerBackup);
    if (r) r.addEventListener('click', triggerRestore);
    // Auto-backup interval select: value change persists the pref + restarts
    // the timer. Reflects the stored pref on load.
    const sel = $('drive-auto-interval');
    if (sel) {
      _autoInterval = getAutoInterval();
      sel.value = _autoInterval;
      sel.addEventListener('change', function() {
        autoIntervalStatus(setAutoInterval(sel.value));
      });
    }
    // Optional backup passphrase (app.html auth bar; the project.html drawer
    // version routes through data-action="driveSetPass" instead).
    const pp = $('drive-pass');
    if (pp) {
      pp.addEventListener('change', function() { setDrivePassFrom(pp); });
    }
    startAutoTimer();
  }

  // OWNER 2026-08-15: the project.html "Signed in" chip opens the Settings
  // drawer at the Controls tab (the sign-in section). Zero inline handlers.
  function wireHeaderChip() {
    const hc = $('hdr-signin');
    if (!hc || hc.getAttribute('data-wired') === '1') return;
    hc.setAttribute('data-wired', '1');
    hc.addEventListener('click', function() {
      const od = document.querySelector('[data-action="openDrw"]');
      if (od) { try { od.click(); } catch (e) { /* optional */ } }
      const tab = document.querySelector('[data-action="swDtab"][data-tab="ctrl"]');
      if (tab) { try { tab.click(); } catch (e) { /* optional */ } }
    });
  }

  // Show a styled fallback "Sign in with Google" button when GIS fails to
  // load (offline / blocked / network). The button tries to init GIS on
  // click; if GIS still isn't available, it shows a helpful message.
  function showGoogleFallback() {
    var host = $('google-signin-button');
    if (!host) return;
    // Don't show if GIS already rendered a button (iframe present)
    if (host.querySelector('iframe')) return;
    // Don't show if already signed in (chip is showing)
    var chip = $('google-user-chip');
    if (chip && !chip.hidden) return;
    // Don't double-inject
    if (host.querySelector('.gis-fallback-btn')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gis-fallback-btn';
    btn.innerHTML = '<svg class="ico" aria-hidden="true" style="width:18px;height:18px;margin-right:8px;vertical-align:middle"><use href="css/mmgr-icons.svg#i-user"></use></svg>Sign in with Google';
    btn.addEventListener('click', function() {
      if (gisReady()) {
        initGIS();
        // The GIS button should now be rendered; hide the fallback
        var ifr = host.querySelector('iframe');
        if (ifr) btn.remove();
      } else {
        btn.textContent = 'Google sign-in is unavailable right now. Use email sign-in below.';
        btn.disabled = true;
        btn.style.opacity = '0.6';
      }
    });
    host.appendChild(btn);
  }

  function boot() {
    mountEmailAuth();
    // AUTH MAINFRAME 2026-08-17 , password change mounts: any element marked
    // [data-pw-host] (project.html Settings > Controls > Profile) hosts the
    // shared control; visibility syncs with the session.
    const pwHosts = document.querySelectorAll('[data-pw-host]');
    for (let i = 0; i < pwHosts.length; i++) mountPasswordControl(pwHosts[i]);
    wireHeaderChip();
    wireDriveControls();
    // The GIS script tag is async+defer in the page head, so it may still be
    // loading. Initialize the moment it's present; if it never loads
    // (offline / blocked), the button slot stays empty and nothing is gated.
    if (initGIS()) { restoreSession(); return; }
    const s = document.querySelector('script[src*="gsi/client"]');
    if (s && typeof s.addEventListener === 'function') {
      s.addEventListener('load', function() { if (initGIS()) restoreSession(); });
      s.addEventListener('error', function() { /* blocked/offline , fine */ });
    }
    // Fallback poll: covers the case where a cached async script fired its
    // load event before this listener attached. Also guarantees restoreSession
    // still runs (~10s cap) so an existing session chip appears even if GIS
    // never loads.
    let tries = 0;
    const t = setInterval(function() {
      if (gisReady()) { clearInterval(t); if (initGIS()) restoreSession(); }
      else if (++tries > 40) { clearInterval(t); restoreSession(); showGoogleFallback(); }
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
    // T5 (2026-08-16): re-render the GIS button when its host becomes visible
    // (app.html modal open / admin rail open) if the boot render came out 0x0.
    ensureGisButton: ensureGisButton,
    showGoogleFallback: showGoogleFallback,
    restoreSession: restoreSession,
    handleCredentialResponse: handleCredentialResponse,
    // OWNER 2026-08-15: session state getters (display-only) so other
    // modules (mmgr-sync) and the header chip can reflect real sign-in.
    getUser: function() { return _user; },
    isSignedIn: function() { return !!_user; },
    signOut: signOut,
    // EMAIL + PASSWORD (deferred cloud item #14, completed 2026-08-12)
    emailLogin: emailLogin,
    emailRegister: emailRegister,
    mountEmailAuth: mountEmailAuth,
    // AUTH MAINFRAME 2026-08-17 , password change (email accounts)
    mountPasswordControl: mountPasswordControl,
    // OWNER 2026-08-15: pop the sign-in prompt at a user gesture (used by
    // cloud actions that need the session , recovery, admin publish-linking).
    openSignInPrompt: openSignInPrompt,
    // GOOGLE-DRIVE-BACKUP API (optional; safe to call from console too)
    DRIVE_SCOPE: DRIVE_SCOPE,
    DRIVE_FILE: DRIVE_FILE,
    getDriveToken: getDriveToken,
    getDriveTokenSilent: getDriveTokenSilent,
    collectWorkspace: collectWorkspace,
    isWorkspaceKey: isWorkspaceKey,
    backupToDrive: backupToDrive,
    restoreFromDrive: restoreFromDrive,
    triggerBackup: triggerBackup,
    triggerRestore: triggerRestore,
    // Auto-backup API
    getAutoInterval: getAutoInterval,
    setAutoInterval: setAutoInterval,
    setAutoIntervalFrom: setAutoIntervalFrom,
    runAutoBackupCheck: runAutoBackupCheck,
    // Passphrase-encryption API (optional; safe to call from console too)
    encryptionEnabled: encryptionEnabled,
    getDrivePass: getDrivePass,
    setDrivePass: setDrivePass,
    setDrivePassFrom: setDrivePassFrom,
    encryptPayload: encryptPayload,
    decryptPayload: decryptPayload,
    // project.html Controls-drawer rendering (optional; no-ops without #drive-section)
    renderDriveSection: renderDriveSection
  };
})(MMGR);
window.MMGR = MMGR;
