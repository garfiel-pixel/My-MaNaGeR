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
  // NEW-UI-CREATION-BRIEF I1 follow-up (2026-08-14): the launcher rail also
  // carries a compact Cloud Projects accordion + an Upgrade to Premium button
  // in the rail footer — both fed by the SAME fetches as the main dashboard
  // (one network round-trip, two surfaces).
  const RAIL_CLOUD = 'rail-cloud-list';
  const RAIL_UPGRADE = 'rail-upgrade';
  const RAIL_PLAN = 'rail-plan';

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

  // Rail Cloud Projects accordion content. Compact rows; clicking one loads
  // the project through the SAME data-cd-load path as the dashboard cards.
  function renderRailCloud(projects) {
    const list = $(RAIL_CLOUD);
    if (!list) return;
    if (!projects || !projects.length) {
      list.innerHTML = '<div class="db-sub-empty">No cloud projects yet. Link one from any project\'s Cloud section.</div>';
      return;
    }
    list.innerHTML = projects.map(function(p) {
      const title = p.label || p.projectId || 'Unnamed project';
      return '<button type="button" class="db-project" data-cd-load="' + escapeHtml(p.projectId) + '" title="Open ' + escapeHtml(title) + ' from the cloud">' +
        '<span class="db-project-ico"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-cloud"></use></svg></span>' +
        '<span class="db-project-name">' + escapeHtml(title) + '</span>' +
        '</button>';
    }).join('');
  }
  function setRailCloudEmpty(msg) {
    const list = $(RAIL_CLOUD);
    if (list) list.innerHTML = '<div class="db-sub-empty">' + escapeHtml(msg || 'No cloud projects.') + '</div>';
  }

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
      setRailCloudEmpty('Cloud sync is unavailable on this host.');
      return;
    }
    if (!res.ok) { dash.hidden = true; setRailCloudEmpty('Sign in to see your cloud projects.'); return; }
    let data = null;
    try { data = await res.json(); } catch (e) { dash.hidden = true; setRailCloudEmpty('Could not load cloud projects.'); return; }
    const projects = (data && data.ok && Array.isArray(data.projects)) ? data.projects : null;
    if (!projects) { dash.hidden = true; setRailCloudEmpty('Could not load cloud projects.'); return; }
    dash.hidden = false;
    setStatus('');
    loadPlan();
    renderRailCloud(projects);
    if (!projects.length) {
      list.innerHTML = '<div class="cd-empty">No cloud-linked projects under this account yet. Link one from any project\'s Cloud section (Create Cloud Project).</div>';
      return;
    }
    list.innerHTML = projects.map(function(p) {
      const title = p.label || p.projectId || 'Unnamed project';
      const when = p.updatedAt ? 'Last saved ' + fmtDate(p.updatedAt) : 'Created ' + fmtDate(p.createdAt);
      const snap = p.hasSnapshot ? '' : '<div class="cd-meta">No snapshot saved yet. Open it to save the first one.</div>';
      // PART F T9: adopted (shared) projects render a role chip + an Unpin
      // button so a recipient can drop a pinned project from THEIR list;
      // the owner's own projects are untouched. The chip tells the user what
      // a code grants before they open it (read-only vs scoped edit).
      const shared = p.accessRole && p.accessRole !== 'owner';
      const chip = shared ? '<span class="cd-role">Shared ' + escapeHtml(p.accessRole === 'view' ? 'Viewer (read-only)' : 'Editor') + '</span>' : '';
      const unpin = shared ? '<button type="button" class="cd-unpin" data-cd-unpin="' + escapeHtml(p.projectId) + '" title="Remove this shared project from your list (the owner\'s project is not affected)">Unpin</button>' : '';
      return '<div class="cd-card" role="listitem">' +
        '<div class="cd-title">' + escapeHtml(title) + chip + '</div>' +
        '<div class="cd-meta">' + escapeHtml(p.projectId || '') + '<br>' + escapeHtml(when) + (p.linkedName ? '<br>Shared by ' + escapeHtml(p.linkedName) : '') + '</div>' +
        snap +
        '<div class="cd-actions">' +
        '<button type="button" class="btn btn-g btn-s" data-cd-load="' + escapeHtml(p.projectId) + '" title="Open this project from the cloud snapshot">Load</button>' +
        unpin +
        '</div>' +
        '</div>';
    }).join('');
  }

  // ---- BILLING-UPGRADE-UI (app.html RAIL FOOTER, 2026-08-12/14) ----
  // Plan status lives in the rail footer where it is always visible (owner
  // polish 2026-08-14: the main dashboard shows ONLY cloud projects — the
  // plan/upgrade strip was removed from there). Paid plan -> a "Premium"
  // badge; free plan -> an "Upgrade to Premium" button. Both fed by the
  // session-gated /api/billing/status (same origin + cookie as the project
  // list above). Dormant-when-unconfigured: with no LEMONSQUEEZY_* secrets
  // the worker answers configured:false and both stay hidden — byte-for-byte
  // unchanged on the current deploy. The button opens the checkout via
  // POST /api/billing/checkout (session-gated) and reports outcomes in the
  // existing live-region status line.
  async function loadPlan() {
    const plan = $(RAIL_PLAN);
    const railUp = $(RAIL_UPGRADE);
    if (!plan && !railUp) return;
    let res;
    try {
      res = await fetch('/api/billing/status', { method: 'GET', credentials: 'same-origin' });
    } catch (e) { if (plan) plan.hidden = true; if (railUp) railUp.hidden = true; return; }
    if (!res.ok) { if (plan) plan.hidden = true; if (railUp) railUp.hidden = true; return; }
    let data = null;
    try { data = await res.json(); } catch (e) { if (plan) plan.hidden = true; if (railUp) railUp.hidden = true; return; }
    if (!data || !data.ok || !data.configured) { if (plan) plan.hidden = true; if (railUp) railUp.hidden = true; return; }
    const count = data.projectCount || 0;
    const cap = data.projectCap;
    const atLimit = cap !== null && cap !== undefined && count >= cap;
    if (data.active) {
      // Paid plan -> Premium badge (visible whenever billing is on).
      if (plan) {
        plan.innerHTML = '<span class="db-plan-badge"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-check"></use></svg> Premium</span>';
        plan.hidden = false;
      }
      if (railUp) railUp.hidden = true;
    } else {
      // Free plan -> a simple Upgrade to Premium button (owner: "something
      // simple like upgrade to premium"), with a small note at the cap.
      if (plan) plan.hidden = true;
      if (railUp) {
        railUp.hidden = false;
        railUp.innerHTML = '<svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-zap"></use></svg> Upgrade to Premium' +
          (atLimit ? '<span class="db-upgrade-note">' + count + ' of ' + cap + ' used</span>' : '');
      }
    }
  }

  // ---- open the LemonSqueezy checkout (same contract as the drawer's
  //      cloudUpgrade in mmgr-cloud.js — session-gated POST, open URL) ----
  async function upgradePlan() {
    setStatus('Opening checkout...');
    try {
      const res = await fetch('/api/billing/checkout', { method: 'POST', credentials: 'same-origin' });
      const data = await res.json().catch(function() { return {}; });
      if (!res.ok || !data.ok || !data.checkoutUrl) {
        if (res.status === 503) setStatus('Billing isn\u2019t configured on this server yet, so no upgrade is available.', true);
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
          // PART F T9: a load through an adoption row returns the LIVE code
          // role + scope — seed the same session slot mmgr-cloud.js writes
          // (escopeKey) so the opened project applies the grant: viewers drop
          // into read-only from boot, editors get only their granted sections.
          // Without this, a pinned shared project would open full-access on
          // the client (the server still enforces, but the UI must match).
          if (data.role === 'view' || data.role === 'editor') {
            try {
              sessionStorage.setItem('mmgr_cloud_escope_' + projectId, JSON.stringify({
                label: data.editorLabel || data.viewerLabel || (data.role === 'view' ? 'Viewer' : 'Editor'),
                sections: data.scope || [],
                role: data.role === 'view' ? 'view' : 'editor'
              }));
              if (data.role === 'view') localStorage.setItem('mmgr_scope_' + projectId, 'readonly');
            } catch (e) { /* ignore — server still enforces */ }
          }
        } catch (e) { setStatus('Storage unavailable — could not open the project.', true); return; }
        // Opens the project viewer with the same ?id= entry the editor-code
        // unlock uses.
        window.location.href = 'project.html?id=' + encodeURIComponent(projectId);
        return;
      }
      // PART F T9: no snapshot yet — the OLD copy told the user to open it
      // once from "its Cloud section", which only makes sense for the OWNER.
      // A recipient who pinned a shared project has no Cloud section for
      // someone else's project — explain clearly instead of dead-ending.
      setStatus(data.role === 'view' || data.role === 'editor'
        ? 'This shared project has no cloud snapshot yet. The admin needs to save it once first, then it will open here.'
        : 'This project has no cloud snapshot yet. Open it once from its Cloud section (Save to Cloud) and it will appear here.', true);
    } catch (e) {
      setStatus('Could not reach the cloud service.', true);
    } finally {
      if (target) { target.disabled = false; target.textContent = 'Load'; }
    }
  }

  // ---- PART F T9: unpin an adopted (shared) project ----
  // Recipient-only action: DELETE /api/cloud/projects/:id/adopt drops the
  // adoption row. The owner's project is never touched — the row is keyed on
  // the recipient's own sub. On success the list reloads without the card.
  async function unpinProject(projectId) {
    setStatus('Removing from your list…');
    try {
      const res = await fetch('/api/cloud/projects/' + encodeURIComponent(projectId) + '/adopt', {
        method: 'DELETE',
        credentials: 'same-origin'
      });
      const data = await res.json().catch(function() { return {}; });
      if (!res.ok || !data.ok) {
        setStatus((data && data.error) || 'Could not unpin the project.', true);
        return;
      }
      setStatus('Unpinned. The project is gone from your list.');
      loadList();
    } catch (e) {
      setStatus('Could not reach the cloud service.', true);
    }
  }

  // ---- events ----
  document.addEventListener('click', function(e) {
    const un = e.target && e.target.closest ? e.target.closest('[data-cd-unpin]') : null;
    if (un) {
      e.preventDefault();
      const id = un.getAttribute('data-cd-unpin');
      if (id) unpinProject(id);
      return;
    }
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
    const rl = $(RAIL_CLOUD);
    if (rl) rl.innerHTML = '<div class="db-sub-empty">Sign in to see your cloud projects.</div>';
  });

  // ---- PROJECTS CAROUSEL (owner 2026-08-16) -----------------------------
  // The launcher #grid is paged: up to PG_PER_PAGE cards per page with
  // prev/next + a counter, so a 9-project wall reads 1-2-3-4 -> next ->
  // 5-6-7-8 -> next -> 9 instead of a grid you count. Cards STAY in the DOM
  // (the qa harnesses query .pcard) — hidden pages get .pg-off. The pager
  // (#pg-nav) lives OUTSIDE #grid so renderCards() innerHTML wipes can't
  // orphan it; a MutationObserver re-paginates after every render (boot,
  // reseed, admin import). Zero dependencies; never throws.
  const PG_PER_PAGE = 4;
  let pgCurrent = 0;

  function paginateGrid() {
    const grid = document.getElementById('grid');
    if (!grid) return;
    const cards = Array.prototype.slice.call(grid.querySelectorAll('.pcard'));
    let nav = document.getElementById('pg-nav');
    if (cards.length <= PG_PER_PAGE) {
      cards.forEach(function(c) { c.classList.remove('pg-off'); });
      if (nav) nav.remove();
      return;
    }
    const pages = Math.ceil(cards.length / PG_PER_PAGE);
    if (pgCurrent > pages - 1) pgCurrent = pages - 1;

    function showPage(i) {
      pgCurrent = i;
      cards.forEach(function(c, idx) {
        const on = Math.floor(idx / PG_PER_PAGE) === pgCurrent;
        c.classList.toggle('pg-off', !on);
        if (on) c.classList.add('pg-on'); else c.classList.remove('pg-on');
      });
      const prev = document.getElementById('pg-prev');
      const next = document.getElementById('pg-next');
      const cnt = document.getElementById('pg-count');
      if (prev) prev.disabled = pgCurrent === 0;
      if (next) next.disabled = pgCurrent === pages - 1;
      if (cnt) cnt.textContent = (pgCurrent + 1) + ' of ' + pages;
      const dots = document.querySelectorAll('.pg-dot');
      for (let d = 0; d < dots.length; d++) dots[d].classList.toggle('is-on', d === pgCurrent);
    }

    function buildDots() {
      const dotsEl = document.getElementById('pg-dots');
      if (!dotsEl || dotsEl.children.length === pages) return;
      let html = '';
      for (let p = 0; p < pages; p++) {
        html += '<button type="button" class="pg-dot" data-pg="' + p + '" aria-label="Go to page ' + (p + 1) + '" aria-pressed="' + (p === pgCurrent ? 'true' : 'false') + '"></button>';
      }
      dotsEl.innerHTML = html;
    }

    if (!nav) {
      nav = document.createElement('div');
      nav.id = 'pg-nav';
      nav.className = 'pg-nav';
      nav.setAttribute('aria-label', 'Project pages');
      nav.innerHTML =
        '<button type="button" class="pg-btn" id="pg-prev" aria-label="Previous projects"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-arrow-left"></use></svg> Prev</button>' +
        '<span class="pg-count" id="pg-count" role="status" aria-live="polite"></span>' +
        '<span class="pg-dots" id="pg-dots" role="group" aria-label="Project pages"></span>' +
        '<button type="button" class="pg-btn" id="pg-next" aria-label="Next projects">Next <svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-arrow-right"></use></svg></button>';
      grid.parentNode.insertBefore(nav, grid.nextSibling);
      document.getElementById('pg-prev').addEventListener('click', function() { if (pgCurrent > 0) showPage(pgCurrent - 1); });
      document.getElementById('pg-next').addEventListener('click', function() { if (pgCurrent < pages - 1) showPage(pgCurrent + 1); });
      document.getElementById('pg-dots').addEventListener('click', function(e) {
        const dot = e.target && e.target.closest ? e.target.closest('.pg-dot') : null;
        if (dot) showPage(parseInt(dot.getAttribute('data-pg'), 10) || 0);
      });
    }
    buildDots();
    showPage(pgCurrent);
  }

  function initGridPager() {
    const grid = document.getElementById('grid');
    if (grid && window.MutationObserver) {
      new MutationObserver(function() { paginateGrid(); })
        .observe(grid, { childList: true });
    }
    paginateGrid();
  }

  // Boot: render once the session state is known. restoreSession() in
  // mmgr-google-auth.js is async; probe /api/auth/me ourselves — if a
  // session exists the list loads, otherwise the section stays hidden and
  // the sign-in event will reveal it.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { loadList(); initGridPager(); });
  } else {
    loadList();
    initGridPager();
  }
})();
