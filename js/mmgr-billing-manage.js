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
    if (!iso) return '';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
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
  }

  function renderConfirm(plan, periodEnd) {
    plan.hidden = false;
    var when = periodEnd ? ' on ' + fmtDate(periodEnd) : ' at the end of the current period';
    plan.innerHTML =
      badgeActive(periodEnd) +
      '<div class="t-xs lh18" data-bmg="note" role="status">Cancel your plan? It stops the next payment' +
      esc(when) +
      '. You keep Premium until then, and nothing is deleted.</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
      '<button type="button" class="btn btn-d btn-s" data-bmg="confirm">Confirm cancel</button>' +
      '<button type="button" class="btn btn-n btn-s" data-bmg="keep">Keep my plan</button>' +
      '</div>';
  }

  function renderDone(plan, cancelAt) {
    plan.hidden = false;
    plan.innerHTML =
      '<div class="t-xs lh18" role="status">Your plan is set to cancel' +
      (cancelAt ? ' on ' + fmtDate(cancelAt) : ' at the end of the period you paid for') +
      '. Premium stays on until then.</div>';
  }

  function renderError(plan, msg) {
    if (!plan) return;
    plan.hidden = false;
    plan.innerHTML =
      '<div class="t-xs lh18" role="status" style="color:var(--danger)">' + esc(msg) + '</div>';
  }

  var periodEnd = null;

  async function loadPlan() {
    var plan = $(PLAN);
    if (!plan) return;
    var res;
    try {
      res = await fetch('/api/billing/status', { method: 'GET', credentials: 'same-origin' });
    } catch (e) {
      plan.hidden = true;
      return;
    }
    if (!res.ok) {
      plan.hidden = true;
      return;
    }
    var data = null;
    try {
      data = await res.json();
    } catch (e) {
      plan.hidden = true;
      return;
    }
    if (!data || !data.ok || !data.configured || !data.active) {
      plan.hidden = true;
      return;
    }
    periodEnd = data.currentPeriodEnd || null;
    renderActive(plan, periodEnd);
  }

  async function cancelSubscription() {
    var plan = $(PLAN);
    if (!plan || busy) return;
    busy = true;
    try {
      var res = await fetch('/api/billing/subscription', {
        method: 'DELETE',
        credentials: 'same-origin'
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
      renderDone(plan, data.cancelAt || data.currentPeriodEnd);
    } catch (e) {
      renderError(plan, 'Could not reach the server. Try again in a moment.');
    } finally {
      busy = false;
    }
  }

  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-bmg]') : null;
    if (!el) return;
    var act = el.getAttribute('data-bmg');
    var plan = $(PLAN);
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
      cancelSubscription();
      return;
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadPlan);
  } else {
    loadPlan();
  }
})();
