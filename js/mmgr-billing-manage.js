/* ============================================================
   mmgr-billing-manage.js - Admin Panel "Your plan"
   (Wave 8.10, owner 2026-10-06; header control 2026-11-06)
   ------------------------------------------------------------
   Renders the signed-in owner's plan in the admin HEADER, where it is
   visible without opening the off-canvas rail:
     - free plan  -> "Upgrade to Premium", one click to pricing.html
     - paid plan  -> "Premium", opening a popover with Manage subscription
   Manage subscription lets the owner cancel at the end of the period they
   already paid for. The cancel is a session-gated DELETE
   /api/billing/subscription; the server schedules the change on Paddle and
   only Paddle's webhook flips the local status, so access is never revoked
   early and the row is never deleted.
   Self-contained: delegated clicks, no inline script, no ACTION_MAP entry,
   so no CSP hash changes. Dormant when billing is unconfigured or the
   visitor is signed out, so a static host is unaffected.
   ============================================================ */
(function () {
  'use strict';

  var PLAN = 'plan-body';
  var BADGE = 'plan-badge';
  var BADGE_TEXT = 'plan-badge-text';
  var BADGE_ICO = 'plan-badge-ico';
  var POP = 'plan-pop';
  var PRICING_PAGE = 'pricing.html';
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

  /* The header badge is the one control: its label, icon and state class all
     come from the same billing answer as the popover body. */
  function setBadge(active) {
    var badge = $(BADGE);
    if (!badge) {
      return;
    }
    var ico = $(BADGE_ICO);
    if (ico) {
      ico.setAttribute('href', 'css/mmgr-icons.svg#' + (active ? 'i-check' : 'i-sparkle'));
    }
    var txt = $(BADGE_TEXT);
    if (txt) {
      txt.textContent = active ? 'Premium' : 'Upgrade to Premium';
    }
    badge.setAttribute(
      'aria-label',
      active ? 'Premium - manage your subscription' : 'Upgrade to Premium - view plans'
    );
    badge.classList.toggle('on', active);
    badge.hidden = false;
  }

  function closePop() {
    var pop = $(POP);
    var badge = $(BADGE);
    if (pop) {
      pop.hidden = true;
    }
    if (badge) {
      badge.setAttribute('aria-expanded', 'false');
    }
  }

  function openPop() {
    var pop = $(POP);
    var badge = $(BADGE);
    if (pop) {
      pop.hidden = false;
    }
    if (badge) {
      badge.setAttribute('aria-expanded', 'true');
    }
  }

  function renderActive(plan, periodEnd) {
    plan.hidden = false;
    plan.innerHTML =
      badgeActive(periodEnd) +
      '<button type="button" class="btn btn-n btn-s" data-bmg="manage">Manage subscription</button>';
  }

  function hidePlan() {
    var plan = $(PLAN);
    var badge = $(BADGE);
    if (plan) {
      plan.hidden = true;
      plan.innerHTML = '';
    }
    if (badge) {
      badge.hidden = true;
      badge.classList.remove('on');
    }
    closePop();
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
    var badge = $(BADGE);
    if (!plan && !badge) {
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
      // Free plan: the badge itself is the upgrade path (pricing.html).
      setBadge(false);
      if (plan) {
        plan.hidden = true;
        plan.innerHTML = '';
      }
      closePop();
      return;
    }
    setBadge(true);
    periodEnd = data.currentPeriodEnd || null;
    renderActive(plan, periodEnd);
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
    var badge = e.target && e.target.closest ? e.target.closest('#' + BADGE) : null;
    if (badge) {
      e.preventDefault();
      if (!badge.classList.contains('on')) {
        window.location.href = PRICING_PAGE;
        return;
      }
      var pop = $(POP);
      if (pop && pop.hidden) {
        openPop();
      } else {
        closePop();
      }
      return;
    }
    var el = e.target && e.target.closest ? e.target.closest('[data-bmg]') : null;
    if (el) {
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
    }
    // A click anywhere outside the plan control closes the popover.
    var wrap = e.target && e.target.closest ? e.target.closest('#plan-wrap') : null;
    if (!wrap) {
      closePop();
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closePop();
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

  /* A session can start or end in another tab. Keep the header truthful rather
     than leaving a stale control that can only answer 403. */
  document.addEventListener('mmgr:google-signed-in', loadPlan);
  document.addEventListener('mmgr:google-signed-out', hidePlan);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadPlan);
  } else {
    loadPlan();
  }
})();
