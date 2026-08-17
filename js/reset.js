/* ============================================================
   My MaNaGeR — /reset.html controller (AUTH MAINFRAME v2, 2026-08-17)
   ------------------------------------------------------------
   Reads ?token=, validates the new password client-side (min 8,
   match), POSTs /api/auth/reset, drives the card states (form /
   ok / error), and offers a fresh-link recovery form (POST
   /api/auth/forgot) when the 30-min single-use token is dead — the
   recoverable error path (Complete-States §11).

   External file on purpose: CSP script-src 'self', zero hash churn.
   All rendered text uses textContent — nothing here can execute.
   ============================================================ */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  var STATES = ['st-form', 'st-ok', 'st-err', 'st-sent'];
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

  var form = $('reset-form');
  var errEl = $('form-err');
  var btn = $('reset-submit');

  function formErr(msg) {
    if (errEl) { errEl.textContent = msg; errEl.hidden = false; }
  }

  if (!token) {
    // The form is pointless without a token — show the error state directly.
    if (form) form.hidden = true;
    fail('This reset link is incomplete. Use the full link from your email, or request a fresh one below.');
  } else if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var pass = String($('reset-pass').value || '');
      var pass2 = String($('reset-pass2').value || '');
      if (pass.length < 8) { formErr('Password must be at least 8 characters.'); return; }
      if (pass !== pass2) { formErr('The two passwords do not match.'); return; }
      if (errEl) errEl.hidden = true;
      btn.disabled = true;
      var label = btn.textContent;
      btn.textContent = 'Setting your password...';
      fetch('/api/auth/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, newPassword: pass })
      }).then(function (r) {
        return r.json().catch(function () { return null; }).then(function (b) { return { status: r.status, body: b }; });
      }).then(function (res) {
        if (res.status === 200 && res.body && res.body.ok) {
          show('st-ok');
        } else {
          btn.disabled = false;
          btn.textContent = label;
          fail('This reset link is invalid, expired, or has already been used. Request a fresh one below, or contact support if it keeps failing.');
        }
      }).catch(function () {
        btn.disabled = false;
        btn.textContent = label;
        fail('Something went wrong while resetting your password. Check your connection and try again, or contact support.');
      });
    });
  }

  // Fresh-link recovery (recoverable error path). The server answers the
  // SAME generic message whether or not the account exists, so this form
  // can never be used to probe which emails have accounts.
  var recForm = $('recover-form');
  var recErr = $('recover-err');
  var recBtn = $('recover-btn');
  if (recForm) {
    recForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = String($('recover-email').value || '').trim();
      if (!email) {
        if (recErr) { recErr.textContent = 'Enter your email address.'; recErr.hidden = false; }
        return;
      }
      if (recBtn) recBtn.disabled = true;
      if (recErr) recErr.hidden = true;
      fetch('/api/auth/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email })
      }).then(function (r) {
        return r.json().catch(function () { return null; });
      }).then(function () {
        show('st-sent');
      }).catch(function () {
        if (recBtn) recBtn.disabled = false;
        if (recErr) { recErr.textContent = 'Could not send the link right now. Check your connection and try again.'; recErr.hidden = false; }
      });
    });
  }
})();
