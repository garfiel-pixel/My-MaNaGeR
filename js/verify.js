/* ============================================================
   My MaNaGeR , /verify.html controller (AUTH MAINFRAME v2, 2026-08-17)
   ------------------------------------------------------------
   Reads ?token=, POSTs /api/auth/verify, drives the card states
   (loading / ok / error), and offers a fresh-link recovery form
   (POST /api/auth/resend-verify) when the 24h single-use token is
   dead , the recoverable error path (Complete-States §11).

   External file on purpose: CSP script-src 'self', zero hash churn.
   All rendered text uses textContent , nothing here can execute.
   ============================================================ */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  var STATES = ['st-loading', 'st-ok', 'st-err', 'st-sent'];
  function show(id) {
    for (var i = 0; i < STATES.length; i++) {
      var el = $(STATES[i]);
      if (el) el.hidden = (STATES[i] !== id);
    }
  }

  var token = new URLSearchParams(location.search).get('token') || '';

  function fail(msg) {
    var m = $('st-err-msg');
    if (m) m.textContent = msg;
    show('st-err');
  }

  if (!token) {
    fail('This confirmation link is incomplete. Use the full link from your email, or request a fresh one below.');
  } else {
    fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token })
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (b) { return { status: r.status, body: b }; });
    }).then(function (res) {
      if (res.status === 200 && res.body && res.body.ok) {
        show('st-ok');
      } else {
        fail('This confirmation link is invalid, expired, or has already been used. Request a fresh one below, or contact support if it keeps failing.');
      }
    }).catch(function () {
      fail('Something went wrong while confirming your email. Check your connection and try again, or contact support.');
    });
  }

  // Fresh-link recovery (recoverable error path). The server answers the
  // SAME generic message whether or not the account needs verification, so
  // this form can never be used to probe which emails have accounts.
  var form = $('recover-form');
  var errEl = $('recover-err');
  var btn = $('recover-btn');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = String($('recover-email').value || '').trim();
      if (!email) {
        if (errEl) { errEl.textContent = 'Enter your email address.'; errEl.hidden = false; }
        return;
      }
      if (btn) btn.disabled = true;
      if (errEl) errEl.hidden = true;
      fetch('/api/auth/resend-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email })
      }).then(function (r) {
        return r.json().catch(function () { return null; });
      }).then(function () {
        show('st-sent');
      }).catch(function () {
        if (btn) btn.disabled = false;
        if (errEl) { errEl.textContent = 'Could not send the link right now. Check your connection and try again.'; errEl.hidden = false; }
      });
    });
  }
})();
