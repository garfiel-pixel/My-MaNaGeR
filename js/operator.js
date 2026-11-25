/* ============================================================
   Site operator console (owner 2026-11-25)
   ------------------------------------------------------------
   The page itself is server-gated to the owner address; this module
   only drives the emailed-code unlock and the two operator API cards.
   The admin token is a short-lived X-Admin-Session value held in
   sessionStorage, valid only alongside the owner's site-session
   cookie. Nothing here falls back to the static admin code: that
   stays a hidden server-side fallback for an existing deployment.
   ============================================================ */
(function () {
  'use strict';

  var TOKEN_KEY = 'mmgr_admin_token';

  function $(id) {
    return document.getElementById(id);
  }

  function token() {
    try {
      return sessionStorage.getItem(TOKEN_KEY) || '';
    } catch (e) {
      return '';
    }
  }

  function setToken(value) {
    try {
      if (value) {
        sessionStorage.setItem(TOKEN_KEY, value);
      } else {
        sessionStorage.removeItem(TOKEN_KEY);
      }
    } catch (e) {
      /* a private tab may refuse storage; the tab still works in memory */
    }
  }

  function headers(extra) {
    var h = Object.assign({}, extra || {});
    var t = token();
    if (t) {
      h['X-Admin-Session'] = t;
    }
    return h;
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function status(id, message, kind) {
    var el = $(id);
    if (!el) {
      return;
    }
    el.textContent = message || '';
    if (kind) {
      el.setAttribute('data-kind', kind);
    } else {
      el.removeAttribute('data-kind');
    }
  }

  function showLock() {
    $('op-console').hidden = true;
    $('op-lock').hidden = false;
  }

  function showConsole() {
    $('op-lock').hidden = true;
    $('op-console').hidden = false;
    loadCloud();
    loadBilling();
  }

  async function checkSession() {
    var t = token();
    if (!t) {
      showLock();
      return;
    }
    try {
      var res = await fetch('/api/admin/signin/session', {
        headers: headers(),
        credentials: 'same-origin'
      });
      if (res.ok) {
        showConsole();
      } else {
        setToken('');
        showLock();
      }
    } catch (e) {
      showLock();
    }
  }

  async function sendCode() {
    var button = $('op-send');
    if (button.disabled) {
      return;
    }
    button.disabled = true;
    status('op-status', 'Sending the code...', '');
    try {
      var res = await fetch('/api/admin/signin/request', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.ok) {
        status('op-status', (data && data.error) || 'The code could not be sent.', 'err');
        return;
      }
      $('op-verify-form').hidden = false;
      status(
        'op-status',
        'Code sent to ' +
          (data.emailMasked || 'the operator inbox') +
          '. It expires in 10 minutes.',
        'ok'
      );
      $('op-code').focus();
    } catch (e) {
      status('op-status', 'The code could not be sent. Try again.', 'err');
    } finally {
      button.disabled = false;
    }
  }

  async function verifyCode(event) {
    event.preventDefault();
    var code = $('op-code').value.trim();
    var err = $('op-error');
    err.textContent = '';
    if (!/^\d{20}$/.test(code)) {
      err.textContent = 'Enter the 20 digits from the email, with no spaces.';
      return;
    }
    var button = $('op-verify');
    button.disabled = true;
    try {
      var res = await fetch('/api/admin/signin/verify', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code })
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.ok || !data.token) {
        err.textContent = (data && data.error) || 'That code was not accepted.';
        return;
      }
      setToken(data.token);
      $('op-code').value = '';
      $('op-verify-form').hidden = true;
      status('op-status', '', '');
      showConsole();
    } catch (e) {
      err.textContent = 'The code could not be checked. Try again.';
    } finally {
      button.disabled = false;
    }
  }

  async function signOut() {
    var t = token();
    if (t) {
      try {
        await fetch('/api/admin/signout', {
          method: 'POST',
          credentials: 'same-origin',
          headers: headers()
        });
      } catch (e) {
        /* a failed network call must not keep the local token alive */
      }
    }
    setToken('');
    showLock();
  }

  async function loadCloud() {
    status('op-cloud-status', 'Loading...', '');
    try {
      var res = await fetch('/api/cloud/admin/projects', {
        headers: headers(),
        credentials: 'same-origin'
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.ok) {
        status('op-cloud-status', (data && data.error) || 'Could not load cloud projects.', 'err');
        return;
      }
      var projects = data.projects || [];
      var list = $('op-cloud-list');
      if (!projects.length) {
        list.innerHTML = '<p class="op-empty">No cloud-linked projects yet.</p>';
        status('op-cloud-status', '', '');
        return;
      }
      list.innerHTML = projects
        .map(function (p) {
          var deleted = !!p.deletedAt;
          var actions = deleted
            ? '<button type="button" class="btn btn-o btn-s" data-op-action="restore" data-id="' +
              esc(p.projectId) +
              '">Undo</button>' +
              '<button type="button" class="btn btn-d btn-s" data-op-action="purge" data-id="' +
              esc(p.projectId) +
              '">Delete permanently</button>'
            : '<button type="button" class="btn btn-o btn-s" data-op-action="reissue" data-id="' +
              esc(p.projectId) +
              '">Reissue owner code</button>';
          return (
            '<div class="op-row">' +
            '<div class="op-title">' +
            esc(p.label || p.projectId) +
            '</div>' +
            '<div class="op-meta">ID: ' +
            esc(p.projectId) +
            ' · account: ' +
            esc(p.linkedName || 'none') +
            ' · snapshot: ' +
            (p.hasSnapshot ? 'yes' : 'no') +
            (deleted
              ? ' · deleted ' + esc(String(p.deletedAt).slice(0, 19).replace('T', ' '))
              : '') +
            '</div>' +
            '<div class="op-actions">' +
            actions +
            '</div>' +
            '</div>'
          );
        })
        .join('');
      status('op-cloud-status', projects.length + ' cloud project(s) loaded.', 'ok');
    } catch (e) {
      status('op-cloud-status', 'Cloud API unreachable on this host.', 'err');
    }
  }

  async function loadBilling() {
    status('op-billing-status', 'Loading...', '');
    try {
      var res = await fetch('/api/admin/billing/subscriptions', {
        headers: headers(),
        credentials: 'same-origin'
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.ok) {
        status('op-billing-status', (data && data.error) || 'Could not load subscriptions.', 'err');
        return;
      }
      var rows = data.subscriptions || [];
      var list = $('op-billing-list');
      if (!rows.length) {
        list.innerHTML = '<p class="op-empty">No subscriptions on this site.</p>';
        status('op-billing-status', '', '');
        return;
      }
      list.innerHTML = rows
        .map(function (s) {
          var orphan = !!s.orphaned;
          var action =
            orphan && data.cancellable
              ? '<button type="button" class="btn btn-d btn-s" data-op-action="clear" data-id="' +
                esc(s.ownerSub) +
                '">Cancel and clear</button>'
              : '';
          return (
            '<div class="op-row">' +
            '<div class="op-title">' +
            esc(s.ownerSub) +
            (orphan ? ' (orphan)' : '') +
            '</div>' +
            '<div class="op-meta">Plan: ' +
            esc(s.tier || 'unknown') +
            ' · provider id: ' +
            esc(s.subscriptionId || 'none') +
            ' · why: ' +
            esc(s.evidence) +
            '</div>' +
            '<div class="op-actions">' +
            action +
            '</div>' +
            '</div>'
          );
        })
        .join('');
      var orphans = rows.filter(function (s) {
        return !!s.orphaned;
      }).length;
      status(
        'op-billing-status',
        orphans + ' orphaned of ' + rows.length + ' listed.',
        orphans ? 'err' : 'ok'
      );
    } catch (e) {
      status('op-billing-status', 'Cloud API unreachable on this host.', 'err');
    }
  }

  async function cloudAction(action, id) {
    if (!id) {
      return;
    }
    var path;
    var needAdminHeader = action !== 'reissue';
    if (action === 'reissue') {
      // Recovery reissues only to the Google account on file; the Worker
      // enforces that match, so this route needs no operator token.
      path = '/api/cloud/projects/' + encodeURIComponent(id) + '/recover';
    } else if (action === 'restore') {
      path = '/api/cloud/projects/' + encodeURIComponent(id) + '/restore';
    } else if (action === 'purge') {
      path = '/api/cloud/projects/' + encodeURIComponent(id) + '/purge';
    } else {
      return;
    }
    var label =
      action === 'reissue'
        ? 'Reissue the owner code for this project? The old code stops working.'
        : action === 'restore'
          ? 'Restore this project? It becomes live again for existing code holders.'
          : 'Delete this project permanently from the cloud? This cannot be undone.';
    if (!window.confirm(label)) {
      return;
    }
    status('op-cloud-status', 'Working...', '');
    try {
      var res = await fetch(path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: needAdminHeader
          ? headers({ 'Content-Type': 'application/json' })
          : { 'Content-Type': 'application/json' },
        body: '{}'
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.ok) {
        status('op-cloud-status', (data && data.error) || 'The action was refused.', 'err');
        return;
      }
      status(
        'op-cloud-status',
        action === 'reissue' ? 'New owner code: ' + (data.ownerCode || '') : 'Done.',
        'ok'
      );
      loadCloud();
    } catch (e) {
      status('op-cloud-status', 'Cloud API unreachable on this host.', 'err');
    }
  }

  async function clearSubscription(id) {
    if (!id || !window.confirm('Cancel this subscription at the provider and clear the row?')) {
      return;
    }
    status('op-billing-status', 'Cancelling at the provider...', '');
    try {
      var res = await fetch('/api/admin/billing/subscriptions/clear', {
        method: 'POST',
        credentials: 'same-origin',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ ownerSub: id })
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.ok) {
        status('op-billing-status', (data && data.error) || 'Not cleared.', 'err');
        return;
      }
      status('op-billing-status', 'Cancelled at the provider and cleared.', 'ok');
      loadBilling();
    } catch (e) {
      status('op-billing-status', 'Cloud API unreachable on this host.', 'err');
    }
  }

  document.addEventListener('click', function (event) {
    var el = event.target && event.target.closest ? event.target.closest('[data-op-action]') : null;
    if (!el) {
      return;
    }
    var action = el.getAttribute('data-op-action');
    var id = el.getAttribute('data-id');
    if (action === 'clear') {
      clearSubscription(id);
    } else {
      cloudAction(action, id);
    }
  });

  $('op-send').addEventListener('click', sendCode);
  $('op-verify-form').addEventListener('submit', verifyCode);
  $('op-signout').addEventListener('click', signOut);
  $('op-cloud-load').addEventListener('click', loadCloud);
  $('op-billing-load').addEventListener('click', loadBilling);
  checkSession();
})();
