/* ==========================================================================
   My MaNaGeR , standalone sign-in page (owner 2026-10-05)

   Responsibilities, and deliberately nothing else:
     1. Mount the SHARED email auth form and the Google button. This page
        owns no auth logic of its own - register/login/password all live in
        js/mmgr-google-auth.js, so this page and the in-page sheet can never
        drift apart in behaviour.
     2. Own the REDIRECT contract: read ?next=, validate it, and return the
        browser there after a successful sign-in.
     3. Own the email disclosure (the "or use your email" dropdown).

   NO EMOJI (owner hard gate). No inline script - this file is external so
   the CSP inline-hash set stays byte-identical.
   ========================================================================== */
(function () {
  'use strict';

  /* The shared auth module. This page mounts the SAME form the marketing
     sign-in sheet uses, so the two doors cannot drift apart in behaviour.
     The global is window.MMGR.GoogleAuth - the same handle js/marketing.js
     reads - NOT window.GA. If the bundle ever fails to load we degrade to a
     readable page rather than throwing. */
  var GA = (window.MMGR && window.MMGR.GoogleAuth) ? window.MMGR.GoogleAuth : null;

  /* Where to send people when they have nothing to return to. */
  var DEFAULT_NEXT = 'app.html';

  /* ---------------------------------------------------------------------
     Safe return target.

     ?next= is attacker-controllable, so it is NOT trusted. Anything that
     could leave this origin is discarded:
       - absolute URLs        http://evil.com, https://evil.com
       - protocol-relative    //evil.com
       - scheme-ish values    javascript:, data:
       - backslash variants   /\evil.com  (browsers treat this as //)
       - a bare host           evil.com
     Only a same-site RELATIVE path survives, and it is additionally forced
     to start with a single "/" so "/../../x" cannot be used to climb out of
     the intended folder. An open redirect on a sign-in page is a
     credential-phishing primitive, so this is deliberately strict.
     --------------------------------------------------------------------- */
  function safeNext(raw) {
    if (!raw) return '';
    var v = String(raw);
    // Trim control characters/whitespace that could hide a scheme.
    v = v.replace(/[\u0000-\u001f\u007f\s]/g, '');
    if (!v) return '';
    // Must begin with exactly one slash, and not a double slash or a
    // backslash-smuggled protocol-relative URL.
    if (v.charAt(0) !== '/') return '';
    if (v.charAt(1) === '/') return '';
    if (v.charAt(1) === '\\') return '';
    if (/^\/[\\]/.test(v)) return '';
    // Reject a scheme hiding behind the slash, e.g. /javascript:alert(1)
    // is harmless as a path, but /https:/evil.com is not worth allowing.
    if (/^\/[a-z][a-z0-9+.-]*:/i.test(v)) return '';
    return v;
  }

  function nextFromQuery() {
    try {
      var p = new URLSearchParams(window.location.search);
      return safeNext(p.get('next'));
    } catch (e) {
      return '';
    }
  }

  /* Where the ?next= value came from, so we can return there after sign-in
     and so the UI can tell the user. Session-scoped, not persisted: a stale
     return target from an hour ago is a surprise, not a feature. */
  var RETURN_TO = '';
  try { RETURN_TO = sessionStorage.getItem('mmgr_signin_next') || ''; } catch (e) { RETURN_TO = ''; }

  function setReturn(v) {
    RETURN_TO = v;
    try {
      if (v) sessionStorage.setItem('mmgr_signin_next', v);
      else sessionStorage.removeItem('mmgr_signin_next');
    } catch (e) { /* private mode: the query param still works this visit */ }
  }

  var qNext = nextFromQuery();
  if (qNext) setReturn(qNext);

  function goNext() {
    var target = safeNext(RETURN_TO);
    window.location.href = target || DEFAULT_NEXT;
  }

  /* ---------------------------------------------------------------------
     Email disclosure. A real <button> with aria-expanded/aria-controls, so
     it is operable by keyboard and announced correctly. Escape closes it.
     --------------------------------------------------------------------- */
  var toggle = document.getElementById('signin-email-toggle');
  var panel = document.getElementById('signin-email-panel');

  function setEmailOpen(open) {
    if (!toggle || !panel) return;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.classList.toggle('is-open', open);
    /* The shared form measures nothing, but the first field should take
       focus when opened by keyboard so the next Tab is useful. */
    if (open) {
      var f = panel.querySelector('input:not([type=hidden])');
      if (f && document.activeElement === toggle) f.focus();
    }
    /* GIS measures its host at render time; after a layout change the
       button can be stale, so re-render once the panel settles. */
    if (GA && typeof GA.ensureGisButton === 'function') {
      window.setTimeout(function () { GA.ensureGisButton(); }, 60);
    }
  }

  if (toggle && panel) {
    toggle.addEventListener('click', function () {
      setEmailOpen(panel.hidden);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !panel.hidden) {
        setEmailOpen(false);
        toggle.focus();
      }
    });
  }

  /* ---------------------------------------------------------------------
     Mount the shared auth pieces, in the order the measurements support:
     Google above, email below. mountEmailAuth is idempotent, and we skip it
     entirely if the sheet already mounted one on this page.
     --------------------------------------------------------------------- */
  if (GA) {
    if (!document.getElementById('email-auth-block')) {
      GA.mountEmailAuth('marketing-email-auth', { showToggle: false });
    }
    /* Re-render the Google button once it has a measurable host. */
    if (typeof GA.ensureGisButton === 'function') GA.ensureGisButton();
    GA.mountPasswordControl(document.getElementById('signin-done'));
    /* Change-password control lives inside the signed-in block. */
    GA.restoreSession();
  }

  /* ---------------------------------------------------------------------
     Signed-in state. Hide the forms, show the confirmation, and send the
     user onward rather than leaving them stranded on a sign-in page they no
     longer need.
     --------------------------------------------------------------------- */
  var done = document.getElementById('signin-done');
  var cont = document.getElementById('signin-continue');

  function renderSignedIn(user) {
    var signedIn = !!(user && (user.sub || user.email));
    if (!done) return;
    done.hidden = !signedIn;
    var card = document.querySelector('.signin-card');
    if (card) {
      /* Keep the heading and legal line; drop the two sign-in doors. */
      var g = document.getElementById('google-signin-button');
      var div = document.querySelector('.signin-divider');
      var tgl = document.querySelector('.signin-email-toggle');
      var ret = document.getElementById('signin-return');
      [g, div, tgl, ret].forEach(function (el) { if (el) el.hidden = signedIn; });
      if (panel) panel.hidden = true;
      var h1 = card.querySelector('h1');
      if (h1) h1.hidden = signedIn;
      var lede = document.querySelector('.signin-lede');
      if (lede) lede.hidden = signedIn;
    }
    var nameEl = document.getElementById('signin-done-name');
    if (nameEl && signedIn) {
      var nm = (user && (user.name || user.email)) || '';
      nameEl.textContent = nm ? ('Signed in as ' + nm + '.') : 'Your projects are ready.';
    }
    if (cont) cont.href = safeNext(RETURN_TO) || DEFAULT_NEXT;
    if (signedIn && RETURN_TO) {
      /* Return automatically, but not so fast the user cannot read the
         confirmation - and never instantly on first paint. */
      window.setTimeout(goNext, 900);
    }
  }

  function renderSignedOut() {
    renderSignedIn(null);
  }

  document.addEventListener('mmgr:user-changed', function (e) { renderSignedIn(e.detail); });
  document.addEventListener('mmgr:google-signed-out', function () { renderSignedOut(); });

  /* Sign out from the confirmation block. */
  var out = document.getElementById('signin-out');
  if (out) {
    out.addEventListener('click', function () {
      if (GA && typeof GA.signOut === 'function') GA.signOut();
      else window.location.reload();
    });
  }

  /* Tell the user where they will land, when there IS somewhere to land.
     Purely informational - the real return happens via RETURN_TO. */
  var retBox = document.getElementById('signin-return');
  var retLabel = document.getElementById('signin-return-label');
  if (retBox && retLabel) {
    var t = safeNext(RETURN_TO);
    if (t) {
      /* Show the last readable segment rather than the raw path, so the
         sentence stays short and cannot be used to inject markup. */
      var seg = t.split('?')[0].split('#')[0].split('/').filter(Boolean).pop() || 'the app';
      retLabel.textContent = seg.replace(/[-_]+/g, ' ');
      retBox.hidden = false;
    }
  }

  /* Expose the validated return target for tests and harnesses. Reading it
     off a data attribute keeps it inspectable without a global. */
  document.body.setAttribute('data-signin-next', safeNext(RETURN_TO));
})();