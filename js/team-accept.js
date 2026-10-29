/* ============================================================
   My MaNaGeR - team invitation landing (RBAC sprint 2)
   ------------------------------------------------------------
   Reads the token from /team/accept/<token>, resolves the session,
   and either accepts on the spot or hands the visitor to sign-in
   with a return target. No inline script, no storage write, and
   the token never leaves the path it arrived in.

   The server is the authority: POST /api/team/accept hashes the
   token, requires a pending row, and refuses unless the verified
   email matches the invited address. Nothing here decides access.
   ============================================================ */
(function () {
  'use strict';

  function $(id) {
    return document.getElementById(id);
  }

  var token = '';
  try {
    var m = /^\/team\/accept\/([A-Za-z0-9_-]{8,256})\/?$/.exec(window.location.pathname);
    token = m ? m[1] : '';
  } catch (e) {
    token = '';
  }

  function show(which) {
    ['ta-checking', 'ta-signedout', 'ta-ok', 'ta-err'].forEach(function (id) {
      var el = $(id);
      if (el) {
        el.hidden = id !== which;
      }
    });
  }

  function fail(title, msg) {
    var t = $('ta-err-title');
    var p = $('ta-err-msg');
    if (t && title) {
      t.textContent = title;
    }
    if (p) {
      p.textContent = msg;
    }
    show('ta-err');
  }

  // Plain copy for the structured errors the Worker returns. Anything
  // unrecognised falls back to the message the server sent, never a blank.
  function errorCopy(status, error) {
    if (error === 'wrong_account') {
      return [
        'This invitation is for a different email address',
        'Sign in with the address the invitation was sent to, then open the link again.'
      ];
    }
    if (error === 'invitation_expired' || status === 410) {
      return [
        'This invitation has expired',
        'Invitations last seven days. Ask the project owner to resend it and a fresh one will appear in your notifications.'
      ];
    }
    if (status === 404 || error === 'invalid or expired invitation') {
      return [
        'This invitation is no longer available',
        'It may already have been accepted, declined or replaced by a newer one. Open My MaNaGeR and check your notifications.'
      ];
    }
    if (status === 403) {
      return [
        'Sign in to accept this invitation',
        'The invitation is tied to an email address, so you need to be signed in as that person.'
      ];
    }
    if (status === 0) {
      return ['Could not reach the server', 'Check your connection and open the link again.'];
    }
    return ['This invitation cannot be used', error || 'Please try again in a moment.'];
  }

  function signedOut() {
    var a = $('ta-signin');
    if (a) {
      a.href = 'signin.html?next=' + encodeURIComponent(window.location.pathname);
    }
    show('ta-signedout');
  }

  function jfetch(path, opts) {
    var o = opts || {};
    o.credentials = 'same-origin';
    o.headers = o.headers || {};
    return fetch(path, o)
      .then(function (res) {
        return res
          .json()
          .catch(function () {
            return {};
          })
          .then(function (body) {
            return { status: res.status, ok: res.ok, body: body || {} };
          });
      })
      .catch(function () {
        return { status: 0, ok: false, body: {} };
      });
  }

  function accept() {
    jfetch('/api/team/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token })
    }).then(function (r) {
      if (r.ok && r.body && r.body.ok) {
        var open = $('ta-open');
        var msg = $('ta-ok-msg');
        if (open && r.body.projectId) {
          open.href = 'app.html';
          open.setAttribute('data-project', r.body.projectId);
        }
        if (msg) {
          var role = String(r.body.role || 'member');
          role = role.charAt(0).toUpperCase() + role.slice(1);
          msg.textContent =
            'You joined as a ' +
            role +
            '. The project is now in Shared with me on your projects page.';
        }
        show('ta-ok');
        return;
      }
      var copy = errorCopy(r.status, (r.body && r.body.error) || '');
      fail(copy[0], copy[1]);
    });
  }

  function boot() {
    if (!token) {
      fail(
        'This link is incomplete',
        'Open the invitation from your notifications in My MaNaGeR, or ask the project owner to send it again.'
      );
      return;
    }
    jfetch('/api/auth/me').then(function (r) {
      var user = r.ok && r.body && r.body.user;
      if (!user) {
        signedOut();
        return;
      }
      accept();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
