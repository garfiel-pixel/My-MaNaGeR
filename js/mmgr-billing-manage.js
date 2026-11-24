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
  var PRICING_PAGE = '/pricing';
  /* OWNER 2026-11-17: "Premium status must be server-checked and persist
     across refresh". The badge is painted from the last CONFIRMED billing
     answer the moment the rail already shows a signed-in person, so a paid
     account never reads "Upgrade to Premium" for a second after a reload. The
     server still answers every load and corrects the badge; the cache only
     removes the flash. It is deleted on sign-out, so it never outlives the
     session it belongs to. */
  var PLAN_CACHE = 'mmgr_plan_cache';
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
    // Two deliberate lines (plan, then the date) instead of one long pill that
    // breaks wherever it runs out of room - the old badge split the year onto
    // its own line inside the 211px popover.
    var when = periodEnd ? 'until ' + fmtDate(periodEnd) : 'active';
    return (
      '<span class="db-plan-badge"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-check"></use></svg>' +
      '<span class="db-plan-badge-txt"><b>Premium</b><span>' +
      esc(when) +
      '</span></span></span>'
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
      ico.setAttribute('href', 'css/mmgr-icons.svg#' + (active ? 'i-check' : 'i-mpw'));
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

  /* A returning browser can run this script against the PREVIOUS deploy's
     HTML (HTTP cache or a service-worker copy). That markup had no plan mount
     in the rail footer, which is how the owner twice saw an account row with
     no Upgrade button. Build the mount when it is missing instead of trusting
     the HTML version; idempotent, so the normal path is a single lookup. */
  function ensureMount() {
    if ($(BADGE)) {
      return;
    }
    var user = $('rail-user');
    if (!user || !user.parentNode) {
      return;
    }
    var wrap = document.createElement('div');
    wrap.className = 'plan-wrap';
    wrap.id = 'plan-wrap';
    wrap.innerHTML =
      '<button type="button" class="plan-badge" id="plan-badge" aria-expanded="false" aria-controls="plan-pop">' +
      '<svg class="ico" aria-hidden="true"><use id="plan-badge-ico" href="css/mmgr-icons.svg#i-mpw"></use></svg>' +
      '<span id="plan-badge-text">Upgrade to Premium</span>' +
      '</button>' +
      '<div class="plan-pop" id="plan-pop" role="group" aria-label="Your plan" hidden>' +
      '<div class="plan-pop-h">Your plan</div>' +
      '<div class="db-plan" id="plan-body" hidden></div>' +
      '</div>';
    user.parentNode.insertBefore(wrap, user);
  }

  /* The rail's account row renders the stored profile, so it can outlive the
     session cookie. It is the client's answer to "is anyone signed in?". */
  function railSignedIn() {
    var user = $('rail-user');
    return !!(user && user.querySelector('.db-user-name, .db-signout'));
  }

  /* The safe default whenever a paid plan cannot be confirmed: the free
     "Upgrade to Premium" badge, which links to pricing.html and works for a
     visitor with no session too. */
  function showFree(plan) {
    setBadge(false);
    if (plan) {
      plan.hidden = true;
      plan.innerHTML = '';
    }
    closePop();
  }

  /* The last confirmed billing answer, stored on this device. Only the fields
     the control renders are kept - never a token, a price id or a customer
     id. */
  function readPlanCache() {
    try {
      var raw = localStorage.getItem(PLAN_CACHE);
      if (!raw) {
        return null;
      }
      var p = JSON.parse(raw);
      return p && typeof p === 'object' ? p : null;
    } catch (e) {
      return null;
    }
  }
  function writePlanCache(data) {
    try {
      localStorage.setItem(
        PLAN_CACHE,
        JSON.stringify({
          at: Date.now(),
          active: !!data.active,
          plan: data.plan || 'free',
          currentPeriodEnd: data.currentPeriodEnd || null,
          canceling: !!data.canceling,
          cancelAt: data.cancelAt || null
        })
      );
    } catch (e) {
      /* storage may be blocked */
    }
  }
  function clearPlanCache() {
    try {
      localStorage.removeItem(PLAN_CACHE);
    } catch (e) {
      /* storage may be blocked */
    }
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

  function renderActive(plan, periodEnd, data) {
    plan.hidden = false;
    // UI-IA Phase 5 (owner 2026-11-12): a cancel that has not taken effect yet
    // keeps Premium. Say when it ends, and never offer a second Cancel - offer
    // the plan change instead.
    if (data && data.canceling) {
      var ends = data.cancelAt || periodEnd;
      plan.innerHTML =
        badgeActive(ends) +
        '<div class="t-xs lh18" data-bmg="note" role="status">Cancelling on ' +
        esc(ends ? fmtDate(ends) : 'the end of this period') +
        '. You keep Premium until then, and you can change plans any time.</div>' +
        '<button type="button" class="btn btn-g btn-s" data-bmg="upgrade">Upgrade plan</button>';
      return;
    }
    plan.innerHTML =
      badgeActive(periodEnd) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
      '<button type="button" class="btn btn-g btn-s" data-bmg="upgrade">Upgrade plan</button>' +
      '<button type="button" class="btn btn-n btn-s" data-bmg="manage">Manage subscription</button>' +
      '</div>';
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
    // Signing out is the one failure this cache must never outlive: the next
    // person on the device must not be told this account is Premium.
    clearPlanCache();
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

  var _retried = false;

  var periodEnd = null;
  var planState = null;

  /* OWNER 2026-11-19 (chrome-truth): ONE status request per page.
     loadPlan() is wired to five lifecycle moments (DOMContentLoaded,
     google-signed-in, user-changed, plan-changed and the header chip's own
     refreshPlan), and each one used to issue its own fetch. Any single one of
     them failing flipped a paying account to "Upgrade to Premium" - the
     owner's report - because five independent chances to be wrong is not a
     plan check. The promise is memoised for the page; a real plan CHANGE
     arrives on mmgr:plan-changed with its own body, so it never needs a
     refetch. */
  var _statusPromise = null;
  function statusOnce() {
    if (_statusPromise) {
      return _statusPromise;
    }
    var E = window.MMGR && window.MMGR.Entitlements;
    if (E && typeof E.status === 'function') {
      _statusPromise = E.status();
      return _statusPromise;
    }
    _statusPromise = (function () {
      var call;
      try {
        call = fetch('/api/billing/status', { method: 'GET', credentials: 'same-origin' });
      } catch (e) {
        return Promise.resolve({ ok: false, code: 0, data: null });
      }
      return Promise.resolve(call).then(
        function (res) {
          var code = res ? res.status : 0;
          var ok = !!(res && res.ok);
          return Promise.resolve(res ? res.json() : null).then(
            function (data) {
              return { ok: ok, code: code, data: data };
            },
            function () {
              return { ok: ok, code: code, data: null };
            }
          );
        },
        function () {
          return { ok: false, code: 0, data: null };
        }
      );
    })();
    return _statusPromise;
  }

  /* A transient failure - offline, a 5xx, a static host with no billing route,
     an unparseable body - tells us NOTHING about the plan. The safe reading is
     "keep whatever we already know": a paid account keeps its Premium badge
     instead of being silently downgraded to an upgrade pitch it does not need.
     Only an authoritative answer (200 with a plan, or 403) may move the
     control. */
  function keepKnownPlan(plan) {
    var cached = readPlanCache();
    if (railSignedIn() && cached && cached.active) {
      setBadge(true);
      if (plan) {
        renderActive(plan, cached.currentPeriodEnd || null, cached);
      }
      return;
    }
    if (!$(BADGE) || !$(BADGE).classList.contains('on')) {
      showFree(plan);
    }
  }

  /* Apply an authoritative billing body - the tail loadPlan() always ran, and
     the whole handler for mmgr:plan-changed, which already carries the body. */
  function applyPlanData(data) {
    var plan = $(PLAN);
    if (!data || !data.ok) {
      showFree(plan);
      return;
    }
    if (!data.active) {
      writePlanCache(data);
      showFree(plan);
      return;
    }
    writePlanCache(data);
    setBadge(true);
    planState = data;
    periodEnd = data.currentPeriodEnd || null;
    if (plan) {
      renderActive(plan, periodEnd, data);
    }
  }

  async function loadPlan() {
    ensureMount();
    var plan = $(PLAN);
    var badge = $(BADGE);
    if (!plan && !badge) {
      return;
    }
    // Paint the last CONFIRMED plan first, so a paid account never reads
    // "Upgrade to Premium" while the request is in flight. Only when the rail
    // already shows a signed-in person: the cache belongs to that account, and
    // a signed-out visitor must never inherit it. The fetch below still
    // decides; this only removes the flash.
    if (railSignedIn()) {
      var cached = readPlanCache();
      if (cached) {
        setBadge(!!cached.active);
      }
    }
    var r = await statusOnce();
    if (r && r.code === 403) {
      /* 403 means the SERVER session is gone. Hiding the control is only right
         when the page agrees the visitor is signed out: an expired cookie
         leaves the stored profile (name + Sign out) in the rail, and blanking
         the upgrade path under a visible name is exactly the "no upgrade
         button" report the owner filed twice. Someone whose name is on screen
         can still buy, so they keep the free badge. */
      if (railSignedIn()) {
        showFree(plan);
      } else {
        hidePlan();
      }
      return;
    }
    if (!r || !r.ok) {
      // Transient. One retry, then keep what we know.
      if (!_retried) {
        _retried = true;
        _statusPromise = null;
        setTimeout(function () {
          loadPlan();
        }, 1500);
        return;
      }
      keepKnownPlan(plan);
      return;
    }
    _retried = false;
    applyPlanData(r.data);
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
        renderActive(plan, periodEnd, planState);
        return;
      }
      if (act === 'upgrade') {
        e.preventDefault();
        window.location.href = PRICING_PAGE;
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
     than leaving a stale control that can only answer 403. The memoised
     status promise is dropped on both edges, because the answer belongs to the
     session that asked for it: without the reset a page that booted signed out
     (a memoised 403) would keep hiding the badge after the person signed in. */
  document.addEventListener('mmgr:google-signed-in', function () {
    _statusPromise = null;
    loadPlan();
  });
  document.addEventListener('mmgr:google-signed-out', function () {
    _statusPromise = null;
    hidePlan();
  });
  /* The identity reaches the rail through mmgr:user-changed, and a restored
     session fires that WITHOUT mmgr:google-signed-in. Without this listener
     the first loadPlan ran against the static "Sign in" row, read the 403 an
     expired cookie earns, and hid the badge - then the restore painted the
     name underneath it. That is the screenshot the owner filed: a signed-in
     account row with no Upgrade button. */
  document.addEventListener('mmgr:user-changed', loadPlan);
  /* A plan change made from the checkout path (upgrade on the same
     subscription) lands here WITH its body, so the header updates without a
     reload and without a second request. */
  document.addEventListener('mmgr:plan-changed', function (e) {
    if (e && e.detail) {
      applyPlanData(e.detail);
    } else {
      loadPlan();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadPlan);
  } else {
    loadPlan();
  }
})();
