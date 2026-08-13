/* ============================================================
   My MaNaGeR — "My Cloud Projects" dashboard (app.html launcher)
   A5-3 decision (2026-08-11): a signed-in Google owner sees every
   cloud-linked project under their account and can load any of
   them without re-entering the owner code — the Worker's
   GET /api/cloud/projects is session-gated (sub match) and
   POST /api/cloud/projects/:id/load accepts the linked owner
   session in place of a code.

   Self-contained on purpose: this file loads BEFORE mmgr-utils.js
   on app.html, so it must not touch MMGR.Utils. Zero inline
   handlers, zero dependencies beyond fetch + DOM. Every path
   degrades silently — a static host without the Worker API, or a
   missing session, simply leaves the section hidden.
   ============================================================ */
(function() {
  'use strict';

  const DASH = 'cloud-dash';
  const LIST = 'cloud-dash-list';
  const STATUS = 'cloud-dash-status';

  function $(id) { return document.getElementById(id); }
  function escapeHtml(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtDate(iso) {
    if (!iso) return 'never synced';
    try {
      const d = new Date(iso);
      return isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) { return String(iso); }
  }
  function setStatus(msg, isErr) {
    const el = $(STATUS);
    if (el) { el.textContent = msg || ''; el.style.color = isErr ? 'var(--danger)' : ''; }
  }

  const PLAN = 'cloud-dash-plan';

  // ---- fetch the session-gated project list ----
  async function loadList() {
    const dash = $(DASH);
    const list = $(LIST);
    if (!dash || !list) return;
    let res;
    try {
      res = await fetch('/api/cloud/projects', { method: 'GET', credentials: 'same-origin' });
    } catch (e) {
      // Static host / offline — no Worker API. Leave the section hidden.
      dash.hidden = true;
      return;
    }
    if (!res.ok) { dash.hidden = true; return; }
    let data = null;
    try { data = await res.json(); } catch (e) { dash.hidden = true; return; }
    const projects = (data && data.ok && Array.isArray(data.projects)) ? data.projects : null;
    if (!projects) { dash.hidden = true; return; }
    dash.hidden = false;
    setStatus('');
    loadPlan();
    if (!projects.length) {
      list.innerHTML = '<div class="cd-empty">No cloud-linked projects under this account yet — link one from any project\'s Cloud section (Create Cloud Project).</div>';
      return;
    }
    list.innerHTML = projects.map(function(p) {
      const title = p.label || p.projectId || 'Unnamed project';
      const when = p.updatedAt ? 'Last saved ' + fmtDate(p.updatedAt) : 'Created ' + fmtDate(p.createdAt);
      const snap = p.hasSnapshot ? '' : '<div class="cd-meta">No snapshot saved yet — open it to save the first one.</div>';
      return '<div class="cd-card" role="listitem">' +
        '<div class="cd-title">' + escapeHtml(title) + '</div>' +
        '<div class="cd-meta">' + escapeHtml(p.projectId || '') + '<br>' + escapeHtml(when) + (p.linkedName ? '<br>Linked to ' + escapeHtml(p.linkedName) : '') + '</div>' +
        snap +
        '<button type="button" class="btn btn-g btn-s" data-cd-load="' + escapeHtml(p.projectId) + '" title="Open this project from the cloud snapshot">Load</button>' +
        '</div>';
    }).join('');
  }

  // ---- BILLING-UPGRADE-UI (app.html plan strip, 2026-08-12) ----
  // Free-plan status + Upgrade button, fed by the session-gated
  // /api/billing/status (same origin + cookie as the project list above).
  // Dormant-when-unconfigured: with no LEMONSQUEEZY_* secrets the worker
  // answers configured:false and this strip stays hidden — byte-for-byte
  // unchanged on the current deploy. The button opens the checkout via
  // POST /api/billing/checkout (session-gated) and reports outcomes in the
  // existing live-region status line.
  async function loadPlan() {
    const plan = $(PLAN);
    if (!plan) return;
    let res;
    try {
      res = await fetch('/api/billing/status', { method: 'GET', credentials: 'same-origin' });
    } catch (e) { plan.hidden = true; return; }
    if (!res.ok) { plan.hidden = true; return; }
    let data = null;
    try { data = await res.json(); } catch (e) { plan.hidden = true; return; }
    if (!data || !data.ok || !data.configured) { plan.hidden = true; return; }
    const count = data.projectCount || 0;
    const cap = data.projectCap;
    const atLimit = cap !== null && cap !== undefined && count >= cap;
    let strip;
    if (data.active) {
      strip = '<span class="cd-plan-txt"><strong>' + escapeHtml(data.plan || 'Pro') + ' plan</strong> — unlimited linked projects</span>';
    } else {
      strip = '<span class="cd-plan-txt"><strong>Free plan</strong> — ' + count + ' of ' + cap + ' linked projects' +
        (atLimit ? ' — limit reached' : '') + '</span>' +
        '<button type="button" class="btn btn-g btn-s" data-cd-upgrade="1"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-zap"></use></svg> Upgrade plan</button>';
    }
    plan.classList.toggle('at-limit', !data.active && atLimit);
    plan.innerHTML = strip;
    plan.hidden = false;
  }

  // ---- open the LemonSqueezy checkout (same contract as the drawer's
  //      cloudUpgrade in mmgr-cloud.js — session-gated POST, open URL) ----
  async function upgradePlan() {
    setStatus('Opening checkout…');
    try {
      const res = await fetch('/api/billing/checkout', { method: 'POST', credentials: 'same-origin' });
      const data = await res.json().catch(function() { return {}; });
      if (!res.ok || !data.ok || !data.checkoutUrl) {
        if (res.status === 503) setStatus('Billing isn\u2019t configured on this server yet — no upgrade is available.', true);
        else setStatus((data && data.error) || 'Checkout failed (HTTP ' + res.status + ').', true);
        return;
      }
      window.open(data.checkoutUrl, '_blank', 'noopener');
      setStatus('Checkout opened in a new tab — complete the purchase there, then refresh this page.');
    } catch (e) {
      setStatus('Could not reach the cloud service.', true);
    }
  }

  // ---- Load a project via the linked owner session ----
  async function loadProject(projectId) {
    // projectId is sanitized server-side to [A-Za-z0-9_-] at create, so the
    // attribute selector is safe without CSS.escape. Find the card by its
    // data-cd-load button to flip that button's label while loading.
    const list = $(LIST);
    let card = null;
    if (list) {
      for (let i = 0; i < list.children.length; i++) {
        if (list.children[i].querySelector('[data-cd-load="' + projectId + '"]')) { card = list.children[i]; break; }
      }
    }
    const target = card ? card.querySelector('.btn') : null;
    if (target) { target.disabled = true; target.textContent = 'Loading…'; }
    setStatus('');
    try {
      const res = await fetch('/api/cloud/projects/' + encodeURIComponent(projectId) + '/load', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      if (!res.ok) { setStatus('Could not load — check that this project is linked to the signed-in account.', true); return; }
      const data = await res.json();
      if (!data || !data.ok) { setStatus('Could not load that project right now.', true); return; }
      if (data.state) {
        try {
          localStorage.setItem('mmgr_unlocked_' + projectId, '1');
          localStorage.setItem('mmgr_scope_' + projectId, 'full');
          localStorage.setItem('mmgr_state_' + projectId, JSON.stringify(data.state));
        } catch (e) { setStatus('Storage unavailable — could not open the project.', true); return; }
        // Opens the project viewer with the same ?id= entry the editor-code
        // unlock uses.
        window.location.href = 'project.html?id=' + encodeURIComponent(projectId);
        return;
      }
      // Review pass (2026-08-11): no snapshot yet — there is nothing to open,
      // and navigating would land the user on the access gate for a project
      // that was never actually saved. Tell them to open it once from the
      // project's Cloud section first instead of silently bouncing them.
      setStatus('This project has no cloud snapshot yet — open it once from its Cloud section (Save to Cloud) and it will appear here.', true);
    } catch (e) {
      setStatus('Could not reach the cloud service.', true);
    } finally {
      if (target) { target.disabled = false; target.textContent = 'Load'; }
    }
  }

  // ---- events ----
  document.addEventListener('click', function(e) {
    const el = e.target && e.target.closest ? e.target.closest('[data-cd-load]') : null;
    if (el) {
      e.preventDefault();
      const id = el.getAttribute('data-cd-load');
      if (id) loadProject(id);
      return;
    }
    const up = e.target && e.target.closest ? e.target.closest('[data-cd-upgrade]') : null;
    if (up) {
      e.preventDefault();
      upgradePlan();
    }
  });
  document.addEventListener('mmgr:google-signed-in', function() { loadList(); });
  document.addEventListener('mmgr:google-signed-out', function() {
    const dash = $(DASH);
    if (dash) dash.hidden = true;
  });

  // Boot: render once the session state is known. restoreSession() in
  // mmgr-google-auth.js is async; probe /api/auth/me ourselves — if a
  // session exists the list loads, otherwise the section stays hidden and
  // the sign-in event will reveal it.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadList);
  } else {
    loadList();
  }
})();
