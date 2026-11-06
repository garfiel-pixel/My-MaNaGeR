/* ============================================================
   mmgr-billing-manage.js - Admin Panel "Manage subscription"
   (Wave 8.10, owner 2026-10-06)
   ------------------------------------------------------------
   Renders into the admin rail's #rail-plan strip when the signed-in
   owner has an ACTIVE subscription, and lets them cancel at the end
   of the period they already paid for. The cancel is a session-gated
   DELETE /api/billing/subscription; the server schedules the change
   on Paddle and only Paddle's webhook flips the local status, so
   access is never revoked early and the row is never deleted.
   Self-contained: delegated clicks, no inline script, no ACTION_MAP
   entry, so no CSP hash changes. Dormant when billing is unconfigured
   or no plan is active, so a static host is unaffected.
   ============================================================ */
(function () {
  'use strict';

  var PLAN = 'rail-plan';
  var UPGRADE = 'rail-upgrade';
  var busy = false;

  function $(id) {
    return document.getElementById(id);
  }
  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function fmtDate(iso) {
    if (!iso) {
      return '';
    }
    try {
      /* The API sends ISO strings. A bare number below 1e11 is epoch SECONDS
         (1794154608 = Nov 2026); Date() wants ms, and skipping this made it
         render as Jan 21, 1970. */
      var d = new Date(typeof iso === 'number' && iso < 1e11 ? iso * 1000 : iso);
      if (isNaN(d.getTime())) {
        return String(iso);
      }
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) {
      return String(iso);
    }
  }

  function badgeActive(periodEnd) {
    var when = periodEnd ? ' until ' + fmtDate(periodEnd) : '';
    return (
      '<span class="db-plan-badge"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-check"></use></svg> Premium' +
      esc(when) +
      '</span>'
    );
  }

  function renderActive(plan, periodEnd) {
    plan.hidden = false;
    plan.innerHTML =
      badgeActive(periodEnd) +
      '<button type="button" class="btn btn-n btn-s" data-bmg="manage">Manage subscription</button>';
    var up = $(UPGRADE);
    if (up) {
      up.hidden = true;
    }
  }

  /* FREE PLAN (owner 2026-11-05): the rail shows the same simple "Upgrade to
     Premium" control as app.html. At the project cap it also says how much of
     the allowance is used, so the reason to upgrade is visible rather than
     implied. Hidden entirely while billing is unconfigured. */
  function renderUpgrade(count, cap) {
    var plan = $(PLAN);
    var up = $(UPGRADE);
    if (plan) {
      plan.hidden = true;
    }
    if (!up) {
      return;
    }
    var atLimit = cap !== null && cap !== undefined && count >= cap;
    up.hidden = false;
    up.innerHTML =
      'Upgrade to Premium' +
      (atLimit
        ? '<span class="db-upgrade-note">' + Number(count) + ' of ' + Number(cap) + ' used</span>'
        : '');
  }

  function hidePlan() {
    var plan = $(PLAN);
    var up = $(UPGRADE);
    if (plan) {
      plan.hidden = true;
    }
    if (up) {
      up.hidden = true;
    }
  }

  /* OWNER 2026-10-09: cancelling takes TWO deliberate acts - type the word, then
     press the button - because one stray click on a phone should never end a
     subscription. The button stays DISABLED (not merely styled as disabled, so
     a keyboard or screen-reader user gets the same contract) until the typed
     value matches, and the server refuses any cancel that does not carry the
     word as well. */
  var CONFIRM_WORD = 'CANCEL';

  function wordMatches(value) {
    return (
      String(value || '')
        .trim()
        .toUpperCase() === CONFIRM_WORD
    );
  }

  function renderConfirm(plan, periodEnd) {
    plan.hidden = false;
    var when = periodEnd ? ' on ' + fmtDate(periodEnd) : ' at the end of the current period';
    plan.innerHTML =
      badgeActive(periodEnd) +
      '<div class="t-xs lh18" data-bmg="note" role="status">Cancel your plan? It stops the next payment' +
      esc(when) +
      '. You keep Premium until then, and nothing is deleted.</div>' +
      '<label class="t-xs bmg-label" for="bmg-code">Type ' +
      CONFIRM_WORD +
      ' to confirm</label>' +
      '<input id="bmg-code" class="bmg-code" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-describedby="bmg-why">' +
      '<div class="t-xs lh18 bmg-why" id="bmg-why" role="status">The cancel button turns on once the word matches.</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
      '<button type="button" class="btn btn-d btn-s" data-bmg="confirm" disabled aria-disabled="true">Confirm cancel</button>' +
      '<button type="button" class="btn btn-n btn-s" data-bmg="keep">Keep my plan</button>' +
      '</div>';
  }

  function renderDone(plan, data) {
    // Already-scheduled cancels are real successes here, not errors: the second
    // press and a stale open tab land here with alreadyScheduled:true and
    // cancelAt, never with an error chip.
    plan.hidden = false;
    var chip;
    if (data && data.alreadyScheduled) {
      chip =
        '<div class="t-xs lh18 bmg-ok" role="status">Cancelling on ' +
        (data.cancelAt ? esc(fmtDate(data.cancelAt)) : 'an unknown date') +
        '. You keep Premium until then. This cancel was already on file.</div>';
    } else {
      chip =
        '<div class="t-xs lh18 bmg-ok" role="status">Cancelling on ' +
        (data && data.cancelAt ? esc(fmtDate(data.cancelAt)) : 'an unknown date') +
        '. You keep Premium until then.</div>';
    }
    plan.innerHTML = chip;
  }

  function renderError(plan, msg) {
    if (!plan) {
      return;
    }
    plan.hidden = false;
    plan.innerHTML =
      '<div class="t-xs lh18" role="status" style="color:var(--danger)">' + esc(msg) + '</div>';
  }

  var periodEnd = null;

  async function loadPlan() {
    var plan = $(PLAN);
    if (!plan) {
      return;
    }
    var res;
    try {
      res = await fetch('/api/billing/status', { method: 'GET', credentials: 'same-origin' });
    } catch (e) {
      hidePlan();
      return;
    }
    if (!res.ok) {
      hidePlan();
      return;
    }
    var data = null;
    try {
      data = await res.json();
    } catch (e) {
      hidePlan();
      return;
    }
    if (!data || !data.ok || !data.configured) {
      hidePlan();
      return;
    }
    if (!data.active) {
      // Free plan: the rail offers the upgrade, exactly like app.html.
      renderUpgrade(data.projectCount || 0, data.projectCap);
      return;
    }
    periodEnd = data.currentPeriodEnd || null;
    renderActive(plan, periodEnd);
  }

  /* Same contract as app.html's upgradePlan(): open the tab SYNCHRONOUSLY
     inside the click so the browser keeps the user activation, then point it
     at the checkout URL. Opening after the await is what made the launcher's
     button silently do nothing. */
  async function upgradePlan() {
    var plan = $(PLAN);
    var tab = window.open('about:blank', '_blank');
    try {
      var res = await fetch('/api/billing/checkout', {
        method: 'POST',
        credentials: 'same-origin'
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.ok || !data.checkoutUrl) {
        if (tab) {
          try {
            tab.close();
          } catch (e) {
            /* already gone */
          }
        }
        renderError(
          plan,
          res.status === 503
            ? 'Billing is not configured on this server yet, so no upgrade is available.'
            : (data && data.error) || 'Checkout failed (HTTP ' + res.status + ').'
        );
        return;
      }
      if (tab) {
        try {
          tab.opener = null;
          tab.location.replace(data.checkoutUrl);
        } catch (e) {
          window.open(data.checkoutUrl, '_blank', 'noopener');
        }
      } else {
        window.open(data.checkoutUrl, '_blank', 'noopener');
      }
    } catch (e) {
      if (tab) {
        try {
          tab.close();
        } catch (e2) {
          /* already gone */
        }
      }
      renderError(plan, 'Could not reach the server. Try again in a moment.');
    }
  }

  async function cancelSubscription() {
    var plan = $(PLAN);
    if (!plan || busy) {
      return;
    }
    busy = true;
    try {
      // The word travels with the request: the server refuses a cancel that
      // does not carry it, so this is not a client-side gesture only.
      var res = await fetch('/api/billing/subscription', {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: CONFIRM_WORD })
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.ok) {
        renderError(
          plan,
          (data && data.error) || 'Could not cancel right now (HTTP ' + res.status + ').'
        );
        return;
      }
      renderDone(plan, data);
    } catch (e) {
      renderError(plan, 'Could not reach the server. Try again in a moment.');
    } finally {
      busy = false;
    }
  }

  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-bmg]') : null;
    if (!el) {
      return;
    }
    var act = el.getAttribute('data-bmg');
    var plan = $(PLAN);
    if (act === 'upgrade') {
      e.preventDefault();
      upgradePlan();
      return;
    }
    if (act === 'manage') {
      e.preventDefault();
      renderConfirm(plan, periodEnd);
      return;
    }
    if (act === 'keep') {
      e.preventDefault();
      renderActive(plan, periodEnd);
      return;
    }
    if (act === 'confirm') {
      e.preventDefault();
      // Belt and braces: the button is disabled until the word matches, but the
      // typed value is re-read here too, so a programmatic click cannot fire a
      // cancel that the user never confirmed.
      var code = $('bmg-code');
      if (!wordMatches(code && code.value)) {
        return;
      }
      cancelSubscription();
      return;
    }
  });

  /* The confirm button is only usable once the typed word matches. Uses the
     event-delegated input event so it survives every re-render of the panel. */
  document.addEventListener('input', function (e) {
    var el = e.target;
    if (!el || el.id !== 'bmg-code') {
      return;
    }
    var plan = $(PLAN);
    if (!plan) {
      return;
    }
    var btn = plan.querySelector('[data-bmg="confirm"]');
    if (!btn) {
      return;
    }
    var ok = wordMatches(el.value);
    btn.disabled = !ok;
    btn.setAttribute('aria-disabled', ok ? 'false' : 'true');
  });

  /* A session can start or end in another tab. Keep the rail truthful rather
     than leaving a stale control that can only answer 403. */
  document.addEventListener('mmgr:google-signed-in', loadPlan);
  document.addEventListener('mmgr:google-signed-out', hidePlan);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadPlan);
  } else {
    loadPlan();
  }
})();
