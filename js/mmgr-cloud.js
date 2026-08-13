/* ============================================================
   My MaNaGeR — Cloud Backup & Recovery (CLOUD-BACKEND-
   ARCHITECTURE-PLAN Phase 1 + 2 + 3)
   ------------------------------------------------------------
   Renders the optional "Cloud Backup" section into the Controls
   drawer on project.html (#cloud-section, right next to
   #drive-section). Strictly OPT-IN per project — a project with
   no cloud link behaves exactly as before (fully local, zero
   backend dependency). Never gating, never required.

   Phase 1 (owner code + recovery):
   - Create: POST /api/cloud/projects { projectId, name } — the
     Worker generates the owner/recovery code and returns it
     EXACTLY ONCE. The plaintext code is shown here + kept in
     sessionStorage (session memory only — never localStorage,
     mirroring the Drive token convention) and is never shipped
     back to the server; saves/loads authenticate with it via the
     X-Owner-Code header.
   - Save / Load / Recover / Copy: as before.
   - Sign-in (optional, for recovery): "Sign in with Google"
     lazy-loads Google Identity Services and reuses the existing
     mmgr-google-auth.js identity flow. Recovery is gated by the
     Worker on the linked Google account (plan §9).

   Phase 2 (editor codes with section scoping):
   - The OWNER (owner code in session) can generate editor codes:
     give a label + tick the sections that code may WRITE. The
     code is hashed server-side like the owner code and returned
     once. List + revoke are owner-only.
   - SCOPE IS ENFORCED SERVER-SIDE on every editor save (the
     Worker merges only granted sections into the blob). The UI
     greying-out here is UX only — a compromised editor code
     cannot write outside its grant even by hitting the API
     directly.
   - An EDITOR enters their code via the "Load with Code" field
     (fresh device) or app.html's unlock flow; the app then saves
     with X-Editor-Code and greys out out-of-scope panels.

   Phase 3 (changelog with revert):
   - Every save records a changelog entry: field-level before/after
     diffs for small edits, a full-state snapshot fallback for bulk
     operations (plan §5). The owner can view the log and revert an
     entry; a revert logs its own new entry instead of erasing
     history, and is itself reversible.

   Zero-throw: every network / GIS / DOM path is guarded. On a
   static host with no Worker API (serve.cjs), the section shows a
   quiet "unavailable here" note and the page keeps working — the
   cloud feature is additive, exactly like the Drive section.

   Namespaced as window.MMGR.Cloud (MMGR created by
   mmgr-portfolio.js / mmgr-state.js). Buttons use data-action so
   the readonly guard and ACTION_MAP delegation apply (mmgr-app.js).
   ============================================================ */
var MMGR = window.MMGR || {};
(function(ns) {
  'use strict';

  const CLIENT_ID = '297970704704-m05hgt93lfaq286q90br8c96ffg1aph3.apps.googleusercontent.com';
  const GIS_SRC = 'https://accounts.google.com/gsi/client';

  let _meChecked = false;   // /api/auth/me consulted at most once per boot
  let _signedIn = false;    // last known sign-in state (display only)
  let _sections = null;     // cached GET /api/cloud/sections payload

  function $(id) { return document.getElementById(id); }
  function pid() { return ns.projectId || 'default'; }
  // Local escape — the module cannot depend on mmgr-utils.js being loaded
  // first, and the owner code / name interpolations into innerHTML must be
  // escaped regardless (XSS hygiene, same rule as mmgr-render.js).
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---- session-only code stores (never localStorage) ----------------
  function codeKey() { return 'mmgr_cloud_code_' + pid(); }
  function ecodeKey() { return 'mmgr_cloud_ecode_' + pid(); }
  function escopeKey() { return 'mmgr_cloud_escope_' + pid(); }
  function getCode() {
    try { return sessionStorage.getItem(codeKey()) || ''; } catch (e) { return ''; }
  }
  function setCode(code) {
    try { sessionStorage.setItem(codeKey(), String(code || '')); } catch (e) { /* ignore */ }
  }
  function clearCode() {
    try { sessionStorage.removeItem(codeKey()); } catch (e) { /* ignore */ }
  }
  function getECode() {
    try { return sessionStorage.getItem(ecodeKey()) || ''; } catch (e) { return ''; }
  }
  function setECode(code) {
    try { sessionStorage.setItem(ecodeKey(), String(code || '')); } catch (e) { /* ignore */ }
  }
  function clearECode() {
    try { sessionStorage.removeItem(ecodeKey()); sessionStorage.removeItem(escopeKey()); } catch (e) { /* ignore */ }
  }
  function getEScope() {
    try {
      const raw = sessionStorage.getItem(escopeKey());
      if (!raw) return null;
      const p = JSON.parse(raw);
      return (p && Array.isArray(p.sections)) ? p : null;
    } catch (e) { return null; }
  }
  function setEScope(label, sections) {
    try { sessionStorage.setItem(escopeKey(), JSON.stringify({ label: label || '', sections: sections || [] })); } catch (e) { /* ignore */ }
  }

  // ---- last-seen cloud time (gap-audit B8/B9: last-synced indicator +
  // conflict heads-up). The server stamps updatedAt on every save; keeping
  // the most recent value here lets the app warn when a save we just made
  // overwrote a snapshot another device wrote since our last sync.
  function lastSeenKey() { return 'mmgr_cloud_last_seen_' + pid(); }
  function getLastSeen() {
    try { return sessionStorage.getItem(lastSeenKey()) || ''; } catch (e) { return ''; }
  }
  function setLastSeen(t) {
    try { sessionStorage.setItem(lastSeenKey(), String(t || '')); } catch (e) { /* ignore */ }
  }

  // ---- pending just-created editor code (shown-once banner, gap-audit G23) --
  function pendingCodeKey() { return 'mmgr_cloud_pending_ecode_' + pid(); }
  function getPendingEditorCode() {
    try {
      const raw = sessionStorage.getItem(pendingCodeKey());
      if (!raw) return null;
      const p = JSON.parse(raw);
      return (p && p.code) ? p : null;
    } catch (e) { return null; }
  }
  function setPendingEditorCode(code, label, scope) {
    try { sessionStorage.setItem(pendingCodeKey(), JSON.stringify({ code: code, label: label || '', scope: scope || [] })); } catch (e) { /* ignore */ }
  }
  function clearPendingEditorCode() {
    try { sessionStorage.removeItem(pendingCodeKey()); } catch (e) { /* ignore */ }
  }

  // ---- status line (reuses the drive-status classes already in mmgr.css) --
  function setStatus(msg, kind) {
    const s = $('cloud-status');
    if (!s) return;
    s.textContent = msg || '';
    s.className = 'drive-status' + (kind ? ' ds-' + kind : '');
  }

  // ---- read-only sign-in state via /api/auth/me ---------------------------
  // Independent of GoogleAuth's chip (which only mounts on app.html/admin.html
  // hosts) — the cloud section reports its own state so recovery availability
  // is visible on project.html too.
  async function checkMe() {
    if (_meChecked) return _signedIn;
    _meChecked = true;
    try {
      const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (res.ok) {
        const data = await res.json();
        _signedIn = !!(data && data.ok && data.user);
      }
    } catch (e) { /* static host / offline — stays false */ }
    return _signedIn;
  }

  // ---- canonical section list (single source of truth lives in the Worker)
  async function fetchSections() {
    if (_sections) return _sections;
    try {
      const res = await fetch('/api/cloud/sections', { credentials: 'same-origin' });
      if (!res.ok) return null;
      const data = await res.json();
      if (data && data.ok && Array.isArray(data.sections)) _sections = data.sections;
      return _sections;
    } catch (e) { return null; }
  }
  function sectionLabel(key) {
    if (_sections) {
      for (let i = 0; i < _sections.length; i++) {
        if (_sections[i].key === key) return _sections[i].label;
      }
    }
    return key;
  }

  // ---- GIS lazy load + render (sign-in for recovery) ----------------------
  function ensureGIS() {
    if (window.google && window.google.accounts && window.google.accounts.id) {
      return Promise.resolve(true);
    }
    return new Promise(function(resolve) {
      const s = document.createElement('script');
      s.src = GIS_SRC;
      s.async = true;
      s.onload = function() { resolve(true); };
      s.onerror = function() { resolve(false); };
      document.head.appendChild(s);
    });
  }

  async function renderSignInButton() {
    const host = $('cloud-gis-host');
    if (!host) return false;
    const ok = await ensureGIS();
    if (!ok || !(window.google && window.google.accounts && window.google.accounts.id)) return false;
    try {
      if (!ns.GoogleAuth || !ns.GoogleAuth.initGIS || !ns.GoogleAuth.initGIS()) {
        window.google.accounts.id.initialize({ client_id: CLIENT_ID, callback: function(resp) {
          if (resp && resp.credential && ns.GoogleAuth && ns.GoogleAuth.handleCredentialResponse) {
            ns.GoogleAuth.handleCredentialResponse(resp);
          }
        } });
      }
      window.google.accounts.id.renderButton(host, { theme: 'outline', size: 'medium', shape: 'rectangular', text: 'signin_with' });
      return true;
    } catch (e) {
      if (window.console && window.console.warn) window.console.warn('mmgr-cloud: GIS render failed (optional)', e);
      return false;
    }
  }

  // ---- workspace state for THIS project ----------------------------------
  function readProjectState() {
    try {
      const raw = localStorage.getItem('mmgr_state_' + pid());
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }
  function projectName(state) {
    return (state && (state.projectName || (state.charter && state.charter.name))) || '';
  }

  // ---- create -------------------------------------------------------------
  // ---- billing upgrade affordance (server: /api/billing/*, 2026-08-12) ---
  // When the create gate answers HTTP 402 {upgrade:true} (session-linked free
  // account over FREE_PROJECT_CAP), we set _upgradePending so render() shows an
  // upgrade banner + button; cloudUpgrade() opens the LemonSqueezy checkout.
  // Dormant when billing is unconfigured — the server never 402s then, so the
  // banner never appears and this whole path is inert (byte-for-byte unchanged
  // behavior on the current deploy).
  let _upgradePending = false;

  async function createProject() {
    if (getCode()) { setStatus('This project is already linked to the cloud — use Save / Load below.', 'warn'); return; }
    setStatus('Creating cloud project…', 'busy');
    try {
      const res = await fetch('/api/cloud/projects', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: pid(), name: projectName(readProjectState()) || pid() })
      });
      const data = await res.json().catch(function() { return {}; });
      if (!res.ok || !data.ok || !data.ownerCode) {
        if (res.status === 402 && data && data.upgrade) {
          // Over the free linked-project cap: surface the upgrade affordance
          // instead of a bare error (the client half of the billing tier).
          _upgradePending = true;
          await render();
          setStatus((data && data.error) || 'Free plan limit reached — upgrade to link more projects.', 'err');
        } else {
          setStatus((data && data.error) || 'Cloud create failed (HTTP ' + res.status + ').', 'err');
        }
        return;
      }
      _upgradePending = false;
      setCode(data.ownerCode);
      await render();
      setStatus('Cloud project linked — owner/recovery code: ' + data.ownerCode + '. Store it somewhere safe: if lost, only the linked Google account can recover it.', 'ok');
    } catch (e) {
      setStatus('Cloud is unavailable on this host (needs the Worker API).', 'err');
    }
  }

  // ---- upgrade to a paid plan: opens the session-gated checkout -----------
  // POST /api/billing/checkout returns { checkoutUrl }; we open it in a new
  // tab and clear the pending banner (the drawer re-renders on the
  // mmgr:google-signed-in event after the purchase webhook lands).
  async function cloudUpgrade() {
    setStatus('Opening checkout…', 'busy');
    try {
      const res = await fetch('/api/billing/checkout', { method: 'POST', credentials: 'same-origin' });
      const data = await res.json().catch(function() { return {}; });
      if (!res.ok || !data.ok || !data.checkoutUrl) {
        if (res.status === 503) {
          _upgradePending = false;
          await render();
          setStatus('Billing isn\u2019t configured on this server yet — no upgrade is available.', 'warn');
        } else {
          setStatus((data && data.error) || 'Checkout failed (HTTP ' + res.status + ').', 'err');
        }
        return;
      }
      window.open(data.checkoutUrl, '_blank', 'noopener');
      setStatus('Checkout opened in a new tab — complete the purchase there, then create the project again.', 'ok');
    } catch (e) {
      setStatus('Cloud is unavailable on this host (needs the Worker API).', 'err');
    }
  }

  // ---- which credential is in session, and the right header name ----------
  function activeCredential() {
    const oc = getCode();
    const ec = getECode();
    if (oc) return { code: oc, header: 'X-Owner-Code' };
    if (ec) return { code: ec, header: 'X-Editor-Code' };
    return null;
  }

  // ---- save ---------------------------------------------------------------
  async function saveToCloud() {
    const cred = activeCredential();
    if (!cred) { setStatus('Create a cloud project first (button above).', 'warn'); return; }
    const state = readProjectState();
    if (!state) { setStatus('No local project state to save yet.', 'warn'); return; }
    setStatus('Saving to cloud…', 'busy');
    try {
      const headers = { 'Content-Type': 'application/json' };
      headers[cred.header] = cred.code;
      const res = await fetch('/api/cloud/projects/' + encodeURIComponent(pid()) + '/save', {
        method: 'POST',
        credentials: 'same-origin',
        headers: headers,
        body: JSON.stringify({ state: state })
      });
      const data = await res.json().catch(function() { return {}; });
      if (!res.ok || !data.ok) {
        let msg = (data && data.error) || 'Cloud save failed (HTTP ' + res.status + ').';
        // gap-audit H29: the 8 MB cap deserves a friendly message, not a bare 413.
        if (res.status === 413) msg = 'Project too large for cloud (8 MB cap) — trim voice/claim data or use export/import instead.';
        if (res.status === 403) { if (cred.header === 'X-Owner-Code') clearCode(); else clearECode(); }
        await render();
        setStatus(msg, 'err');
        return;
      }
      const prevSeen = getLastSeen();
      if (data.savedAt) setLastSeen(data.savedAt);
      let statusMsg = 'Saved to cloud — ' + (data.savedAt || '').slice(0, 19).replace('T', ' ') + '.';
      if (data.actor === 'editor') {
        const scopeTxt = (data.scope || []).map(sectionLabel).join(', ');
        statusMsg = 'Saved as editor (' + (data.editorLabel || 'editor') + ') — scope: ' + scopeTxt + '.';
        if (data.applied && data.applied.length) statusMsg += ' Applied: ' + data.applied.map(sectionLabel).join(', ') + '.';
        if (data.blocked && data.blocked.length) statusMsg += ' NOT saved (outside this code\u2019s scope): ' + data.blocked.map(sectionLabel).join(', ') + '.';
      } else {
        statusMsg += ' Snapshot ' + (data.key || '').split('/').pop() + '.';
      }
      // gap-audit B9: last-write-wins WITH a heads-up. If the server reports
      // the previous snapshot was written after our last known sync, someone
      // else saved in between — say so instead of overwriting silently.
      if (data.previousUpdatedAt && prevSeen && data.previousUpdatedAt !== prevSeen) {
        statusMsg += ' Another device saved since you last synced — this save overwrote it.';
      }
      setStatus(statusMsg, 'ok');
    } catch (e) {
      setStatus('Cloud is unavailable on this host (needs the Worker API).', 'err');
    }
  }

  // ---- load (uses whichever credential is in session) ---------------------
  async function loadFromCloud() {
    const cred = activeCredential();
    if (!cred) { setStatus('Create a cloud project first (button above).', 'warn'); return; }
    if (!window.confirm('Replace this device\u2019s local workspace with the cloud snapshot for this project? Current local data will be overwritten.')) return;
    setStatus('Loading from cloud…', 'busy');
    try {
      const headers = { 'Content-Type': 'application/json' };
      headers[cred.header] = cred.code;
      const res = await fetch('/api/cloud/projects/' + encodeURIComponent(pid()) + '/load', {
        method: 'POST',
        credentials: 'same-origin',
        headers: headers,
        body: JSON.stringify({})
      });
      const data = await res.json().catch(function() { return {}; });
      if (!res.ok || !data.ok) {
        const msg = (data && data.error) || 'Cloud load failed (HTTP ' + res.status + ').';
        if (res.status === 403) { if (cred.header === 'X-Owner-Code') clearCode(); else clearECode(); }
        await render();
        setStatus(msg, 'err');
        return;
      }
      if (!data.state) { setStatus('No cloud snapshot saved for this project yet — save once from another device first.', 'warn'); return; }
      try {
        localStorage.setItem('mmgr_state_' + pid(), JSON.stringify(data.state));
        localStorage.setItem('mmgr_unlocked_' + pid(), '1');
        localStorage.setItem('mmgr_scope_' + pid(), 'full');
        localStorage.setItem('mmgr_current_project', pid());
      } catch (e) { /* storage blocked — status below still reports the outcome */ }
      if (data.role === 'editor') setEScope(data.editorLabel, data.scope || []);
      if (data.savedAt) setLastSeen(data.savedAt);
      setStatus('Cloud snapshot restored — reloading.', 'ok');
      setTimeout(function() { window.location.reload(); }, 1200);
    } catch (e) {
      setStatus('Cloud is unavailable on this host (needs the Worker API).', 'err');
    }
  }

  // ---- recover owner code -------------------------------------------------
  async function recoverCode() {
    const linked = await checkMe();
    if (!linked) {
      setStatus('Recovery requires the Google account linked to this project — sign in above first.', 'warn');
      return;
    }
    setStatus('Recovering owner code…', 'busy');
    try {
      const res = await fetch('/api/cloud/projects/' + encodeURIComponent(pid()) + '/recover', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json().catch(function() { return {}; });
      if (!res.ok || !data.ok || !data.ownerCode) {
        setStatus((data && data.error) || 'Recovery failed (HTTP ' + res.status + ').', 'err');
        return;
      }
      setCode(data.ownerCode);
      clearECode();
      await render();
      setStatus('New owner code issued: ' + data.ownerCode + ' — also below + Copy Code. The previous code no longer works.', 'ok');
      if (data.recoveredAt) setLastSeen(data.recoveredAt);
    } catch (e) {
      setStatus('Cloud is unavailable on this host (needs the Worker API).', 'err');
    }
  }

  // ---- normalize a user-typed code ----------------------------------------
  function normalizeCode(raw) {
    const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (s.length === 16) return s.slice(0, 4) + '-' + s.slice(4, 8) + '-' + s.slice(8, 12) + '-' + s.slice(12, 16);
    return s;
  }
  function isCodeShape(code) {
    return /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/.test(code);
  }

  // ---- load with a manually-entered code (fresh-device path) --------------
  // The code could be an OWNER code or an EDITOR code — probe owner first,
  // then editor. On success the credential is kept for this session so
  // subsequent saves work without re-entering it.
  async function loadWithCode() {
    const inp = $('cloud-code-in');
    const code = normalizeCode((inp && inp.value) || '');
    if (!isCodeShape(code)) {
      setStatus('Enter the full 16-character code (XXXX-XXXX-XXXX-XXXX).', 'warn');
      return;
    }
    if (!window.confirm('Replace this device\u2019s local workspace with the cloud snapshot for this project? Current local data will be overwritten.')) return;
    setStatus('Checking code…', 'busy');
    const result = await probeLoad(code);
    if (!result) {
      setStatus('That code was not accepted — check it and try again.', 'err');
      return;
    }
    if (result.role === 'editor') {
      setECode(code);
      setEScope(result.editorLabel, result.scope || []);
    } else {
      setCode(code);
    }
    render();
    await loadFromCloud();
  }

  // Probe /load with a typed code: owner header first, editor header second.
  // Returns the parsed response on success or null. Never throws.
  async function probeLoad(code) {
    for (let i = 0; i < 2; i++) {
      try {
        const header = i === 0 ? 'X-Owner-Code' : 'X-Editor-Code';
        const headers = { 'Content-Type': 'application/json' };
        headers[header] = code;
        const res = await fetch('/api/cloud/projects/' + encodeURIComponent(pid()) + '/load', {
          method: 'POST', credentials: 'same-origin', headers: headers, body: JSON.stringify({})
        });
        if (!res.ok) continue;
        const data = await res.json();
        if (data && data.ok) return data;
      } catch (e) { /* try the other header, then give up */ }
    }
    return null;
  }

  // ---- copy code ----------------------------------------------------------
  async function copyCode() {
    const cred = activeCredential();
    if (!cred) { setStatus('No code stored for this session.', 'warn'); return; }
    try {
      await navigator.clipboard.writeText(cred.code);
      setStatus('Code copied to the clipboard.', 'ok');
    } catch (e) {
      window.prompt('Code (select + copy):', cred.code);
      setStatus('Code shown — copy it from the prompt.', 'ok');
    }
  }

  // =========================================================================
  // PHASE 2 — editor code management (owner-only UI)
  // =========================================================================

  // Create: read the label + checked section boxes -> POST -> show code once.
  async function createEditor() {
    const labelIn = $('cloud-editor-label-in');
    const label = (labelIn && labelIn.value || '').trim().slice(0, 60);
    if (!label) { setStatus('Give this editor code a label first (e.g. \u201CSite Super — Riverside\u201D).', 'warn'); return; }
    const scope = [];
    const boxes = document.querySelectorAll('#cloud-editor-scope-box input[type=checkbox]:checked');
    for (let i = 0; i < boxes.length; i++) scope.push(boxes[i].value);
    if (scope.length === 0) { setStatus('Tick at least one section this code may edit.', 'warn'); return; }
    const code = getCode();
    if (!code) { setStatus('Owner code required to manage editor codes.', 'warn'); return; }
    setStatus('Creating editor code…', 'busy');
    try {
      const res = await fetch('/api/cloud/projects/' + encodeURIComponent(pid()) + '/editors', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Owner-Code': code },
        body: JSON.stringify({ label: label, scope: scope })
      });
      const data = await res.json().catch(function() { return {}; });
      if (!res.ok || !data.ok || !data.editorCode) {
        setStatus((data && data.error) || 'Editor code creation failed (HTTP ' + res.status + ').', 'err');
        return;
      }
      // gap-audit G23: park the code in a shown-once banner (render renders it
      // prominently with a Copy button) — matching the owner-code flow's
      // "copy this now" seriousness.
      setPendingEditorCode(data.editorCode, data.label, data.scope || []);
      await render();
      setStatus('Editor code created for \u201C' + data.label + '\u201D (scope: ' + (data.scope || []).map(sectionLabel).join(', ') + '). Copy it from the banner — it is shown once.', 'ok');
      if (listEditors) listEditors();
    } catch (e) {
      setStatus('Cloud is unavailable on this host (needs the Worker API).', 'err');
    }
  }

  // List existing editor codes (owner-only) into #cloud-editor-list.
  async function listEditors() {
    const wrap = $('cloud-editor-list');
    if (!wrap) return;
    const code = getCode();
    if (!code) { wrap.innerHTML = '<div class="sr-hint">Owner code required.</div>'; return; }
    try {
      const res = await fetch('/api/cloud/projects/' + encodeURIComponent(pid()) + '/editors', {
        method: 'GET', credentials: 'same-origin', headers: { 'X-Owner-Code': code }
      });
      const data = await res.json().catch(function() { return {}; });
      if (!res.ok || !data.ok) { wrap.innerHTML = '<div class="sr-hint">Could not load editor codes.</div>'; return; }
      const eds = data.editors || [];
      if (!eds.length) { wrap.innerHTML = '<div class="sr-hint">No editor codes yet — create one above.</div>'; return; }
      wrap.innerHTML = eds.map(function(e) {
        return '<div class="sr" style="font-size:.72rem;display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
          '<span style="color:var(--gold)">' + esc(e.label || 'Editor') + '</span>' +
          '<span class="sr-hint" style="margin:0">' + esc((e.scope || []).map(sectionLabel).join(', ')) + ' · ' + esc(String(e.createdAt || '').slice(0, 10)) + '</span>' +
          (e.active ? '<button class="btn btn-d btn-s" data-action="cloudEditorRevoke" data-id="' + e.id + '">Revoke</button>' : '<span class="sr-hint" style="margin:0">revoked</span>') +
          '</div>';
      }).join('');
    } catch (e) {
      wrap.innerHTML = '<div class="sr-hint">Cloud unavailable here.</div>';
    }
  }

  // Revoke an editor code (owner-only) — the code stops working immediately.
  async function revokeEditor(id) {
    if (!id) return;
    if (!window.confirm('Revoke this editor code? It stops working immediately and cannot be restored.')) return;
    const code = getCode();
    if (!code) { setStatus('Owner code required to revoke editor codes.', 'warn'); return; }
    setStatus('Revoking editor code…', 'busy');
    try {
      const res = await fetch('/api/cloud/projects/' + encodeURIComponent(pid()) + '/editors/' + encodeURIComponent(id), {
        method: 'DELETE', credentials: 'same-origin', headers: { 'X-Owner-Code': code }
      });
      const data = await res.json().catch(function() { return {}; });
      if (!res.ok || !data.ok) { setStatus((data && data.error) || 'Revoke failed (HTTP ' + res.status + ').', 'err'); return; }
      await render();
      setStatus('Editor code revoked.', 'ok');
      listEditors();
    } catch (e) {
      setStatus('Cloud is unavailable on this host (needs the Worker API).', 'err');
    }
  }

  // =========================================================================
  // PHASE 3 — changelog (owner-only view + revert)
  // =========================================================================

  async function listLog() {
    const wrap = $('cloud-log-list');
    if (!wrap) return;
    const code = getCode();
    if (!code) { wrap.innerHTML = '<div class="sr-hint">Owner code required.</div>'; return; }
    try {
      const res = await fetch('/api/cloud/projects/' + encodeURIComponent(pid()) + '/changelog', {
        method: 'GET', credentials: 'same-origin', headers: { 'X-Owner-Code': code }
      });
      const data = await res.json().catch(function() { return {}; });
      if (!res.ok || !data.ok) { wrap.innerHTML = '<div class="sr-hint">Could not load the changelog.</div>'; return; }
      const entries = data.entries || [];
      if (!entries.length) { wrap.innerHTML = '<div class="sr-hint">No cloud changes logged yet — save once from any device to start the log.</div>'; return; }
      wrap.innerHTML = entries.map(function(en) {
        // MCP-CHANGELOG-UI (backlog, 2026-08-12): entries imported from the MCP
        // AI sidecar (source === 'mcp', set server-side from import_key) render
        // with a distinct purple AI badge + "MCP AI" actor so AI-made changes
        // never masquerade as the owner. Revert stays available — recordId
        // reverts were the whole point of the import pipeline.
        const isMCP = en.source === 'mcp';
        const hasDiffs = Array.isArray(en.diffs) && en.diffs.length > 0;
        const who = (isMCP ? 'MCP AI' : (en.actorType === 'editor' ? 'Editor \u201C' + esc(en.actorLabel || '?') + '\u201D' : 'Owner')) + ' · ' + esc(String(en.createdAt || '').slice(0, 19).replace('T', ' '));
        let what = '';
        let revertBtn = '<button class="btn btn-o btn-s" data-action="cloudLogRevert" data-id="' + en.id + '">Revert</button>';
        if (en.type === 'bulk') what = 'Full-state change (snapshot)';
        else if (en.type === 'revert') what = 'Revert of a previous change';
        else if (en.type === 'recovery') { what = 'Owner code reissued (recovery)'; revertBtn = ''; } // not a content change — not revertible
        else what = (en.diffs ? en.diffs.length : 0) + ' field(s) changed' + (en.section ? ' · ' + esc(sectionLabel(en.section)) : '');
        if (isMCP) what = 'Imported from AI (MCP) — ' + what;
        // Click-to-expand diffs (backlog, 2026-08-12): any entry carrying
        // field-level diffs (edit + revert entries; bulk rows only hold a
        // snapshot key) gets a caret that reveals the before/after panel —
        // pure DOM, view-only, never a server call.
        const toggleBtn = hasDiffs
          ? '<button type="button" class="cl-toggle" data-action="cloudLogToggleDiffs" data-id="' + en.id + '" aria-expanded="false" aria-controls="cl-diffs-' + en.id + '" aria-label="Show field diffs for entry ' + en.id + '" title="Show field-level before/after values"></button>'
          : '';
        const panelHtml = hasDiffs
          ? '<div id="cl-diffs-' + en.id + '" class="cl-diffs is-hide" role="region" aria-label="Field-level diffs for entry ' + en.id + '">' + renderDiffPanel(en) + '</div>'
          : '';
        return '<div class="sr" style="font-size:.72rem;display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
          '<span style="color:var(--gold)">' + esc(String(en.id)) + '</span>' +
          (isMCP ? '<span class="badge-ai" title="Imported from the MCP AI changelog — reverts resolve by stable record id"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-sparkle"></use></svg> AI · MCP</span>' : '') +
          '<span>' + esc(who) + '</span><span class="sr-hint" style="margin:0">' + what + '</span>' +
          toggleBtn +
          revertBtn +
          panelHtml +
          '</div>';
      }).join('');
    } catch (e) {
      wrap.innerHTML = '<div class="sr-hint">Cloud unavailable here.</div>';
    }
  }

  // ---- click-to-expand diff panel (view-only) ----------------------------
  // One diff value cell: primitives render as-is; whole-record values (MCP
  // imports diff entire records on add/delete) become compact JSON. Long
  // strings are ellipsis-truncated on screen with the full value in the
  // title attribute. Everything is escaped — the values are server state.
  function clVal(v, absent, cls) {
    if (absent) return '<em class="cl-absent">absent</em>';
    let s;
    if (v === undefined) v = null; // defensive: absent-but-unflagged renders as null, never "undefined"
    if (v === null) s = 'null';
    else if (typeof v === 'object') {
      try { s = JSON.stringify(v); } catch (e) { s = String(v); }
    } else s = String(v);
    const title = s.length > 140 ? ' title="' + esc(s) + '"' : '';
    const shown = s.length > 140 ? s.slice(0, 137) + '…' : s;
    return '<code class="cl-val ' + cls + '"' + title + '>' + esc(shown) + '</code>';
  }

  // Build the field-level before/after panel markup for one entry (pure
  // string builder — no DOM access, exposed as a test hook). Capped at 60
  // rows; the server's leaf-diff cap (40) makes the cap a sanity guard.
  function renderDiffPanel(en) {
    const diffs = (Array.isArray(en.diffs) ? en.diffs : []).slice(0, 60);
    const n = Array.isArray(en.diffs) ? en.diffs.length : 0;
    if (!diffs.length) return '';
    let rows = '';
    for (let i = 0; i < diffs.length; i++) {
      const d = diffs[i] || {};
      rows += '<div class="cl-diff">' +
        '<code class="cl-diff-path" title="' + esc(String(d.path || '')) + '">' + esc(String(d.path || '?')) + '</code>' +
        clVal(d.before, d.beforeAbsent === true, 'cl-old') +
        '<span class="cl-arr">→</span>' +
        clVal(d.after, d.afterAbsent === true, 'cl-new') +
        '</div>';
    }
    if (n > diffs.length) rows += '<div class="cl-more">… and ' + (n - diffs.length) + ' more field(s)</div>';
    return '<div class="cl-diffs-head"><span>Field</span><span>Before</span><span></span><span>After</span></div>' + rows;
  }

  // Toggle an entry's diff panel open/closed (no server call, nothing
  // mutated — safe in view-only mode, hence in READONLY_SAFE_ACTIONS).
  function toggleDiffs(id) {
    const panel = $('cl-diffs-' + id);
    if (!panel) return;
    const show = panel.classList.contains('is-hide');
    panel.classList.toggle('is-hide');
    const btn = document.querySelector('#cloud-log-list [data-action="cloudLogToggleDiffs"][data-id="' + String(id).replace(/"/g, '&quot;') + '"]');
    if (btn) {
      btn.classList.toggle('open', show);
      btn.setAttribute('aria-expanded', show ? 'true' : 'false');
    }
  }

  async function revertLog(id) {
    if (!id) return;
    if (!window.confirm('Revert this change? The recorded before-values will be written back (or the snapshot restored), and the revert itself is logged.')) return;
    const code = getCode();
    if (!code) { setStatus('Owner code required to revert.', 'warn'); return; }
    setStatus('Reverting…', 'busy');
    try {
      const res = await fetch('/api/cloud/projects/' + encodeURIComponent(pid()) + '/changelog/' + encodeURIComponent(id) + '/revert', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Owner-Code': code },
        body: JSON.stringify({})
      });
      const data = await res.json().catch(function() { return {}; });
      if (!res.ok || !data.ok) {
        setStatus((data && data.error) || 'Revert failed (HTTP ' + res.status + ').', 'err');
        return;
      }
      setStatus('Reverted — the change is now undone on the cloud snapshot. Load from Cloud to pull it into this workspace.', 'ok');
      listLog();
    } catch (e) {
      setStatus('Cloud is unavailable on this host (needs the Worker API).', 'err');
    }
  }

  // =========================================================================
  // EDITOR-SCOPE UI — grey out panels an editor code cannot WRITE (UX only;
  // the Worker enforces the scope regardless).
  // =========================================================================
  // gap-audit B11: the grey-out must mirror the SERVER's writable vocabulary
  // (worker.js CLOUD_SECTIONS), not block panels indiscriminately. Panels that
  // are VIEW-ONLY (dash/def/kan/gantt/claim/digest/baselinen/wxlog) read
  // derived data and are deliberately not scoping targets — an editor can
  // always VIEW them; the server blocks their writes by construction. When the
  // canonical list is available (_sections, fetched from the Worker) it IS the
  // vocabulary, so the two can never drift; the static mirror below only
  // applies where no editor session can exist anyway (static host).
  const VIEW_ONLY_PANELS = ['dash', 'def', 'kan', 'gantt', 'claim', 'digest', 'baselinen', 'wxlog'];
  function isWritableSection(key) {
    if (_sections) {
      for (let i = 0; i < _sections.length; i++) if (_sections[i].key === key) return true;
      return false;
    }
    return VIEW_ONLY_PANELS.indexOf(key) === -1;
  }
  function applyEditorScope() {
    const scope = getEScope();
    const isEditor = !!getECode() && !getCode();
    document.body.classList.toggle('editor-scope', isEditor && !!scope);
    const btns = document.querySelectorAll('.sec-btn[data-section]');
    for (let i = 0; i < btns.length; i++) {
      const sec = btns[i].getAttribute('data-section');
      const blocked = isEditor && scope && isWritableSection(sec) && scope.sections.indexOf(sec) === -1;
      btns[i].classList.toggle('scope-blocked', blocked);
      if (blocked) btns[i].setAttribute('title', 'Outside this editor code\u2019s scope — locked');
      else btns[i].removeAttribute('title');
    }
    const banner = $('editor-scope-banner');
    if (banner) banner.classList.toggle('is-hide', !isEditor);
  }

  // =========================================================================
  // RENDER
  // =========================================================================
  // ---- last cloud sync time for the UI (gap-audit B8) --------------------
  // Fetches /meta with whatever credential is in session and returns a short
  // human line. Also refreshes the last-seen stamp used by the conflict
  // heads-up. Never throws; empty string on any failure (the row simply
  // doesn't render).
  async function cloudMetaStatus() {
    const cred = activeCredential();
    if (!cred) return '';
    try {
      const headers = {};
      headers[cred.header] = cred.code;
      const res = await fetch('/api/cloud/projects/' + encodeURIComponent(pid()) + '/meta', { credentials: 'same-origin', headers: headers });
      const data = await res.json().catch(function() { return {}; });
      if (!res.ok || !data.ok) return '';
      if (data.updatedAt) setLastSeen(data.updatedAt);
      const t = String(data.updatedAt || '').slice(0, 19).replace('T', ' ');
      return t ? ('Last saved to cloud: ' + t) : 'No cloud snapshot yet — save once to start.';
    } catch (e) { return ''; }
  }

  async function render() {
    const wrap = $('cloud-section');
    if (!wrap) return;
    const code = getCode();
    const ecode = getECode();
    const escope = getEScope();
    const signedIn = await checkMe();
    const pendingCode = getPendingEditorCode();
    let pendingBanner = '';
    if (pendingCode) {
      pendingBanner =
        '<div class="sr cloud-new-code" style="border:1px solid var(--gold);background:rgba(var(--gold-rgb),.1);border-radius:var(--radius);padding:8px 10px;margin:6px 0" role="status">' +
        '<div class="sr-hint" style="margin:0 0 4px"><strong>NEW editor code for \u201C' + esc(pendingCode.label || 'editor') + '\u201D — copy it now, it is shown once:</strong></div>' +
        '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
        '<code style="font-family:ui-monospace,monospace;letter-spacing:.05em;color:var(--gold);font-size:1rem;font-weight:700">' + esc(pendingCode.code) + '</code>' +
        '<button class="btn btn-g btn-s" data-action="cloudCopyEditorCode" data-code="' + esc(pendingCode.code) + '"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-clipboard"></use></svg> Copy code</button>' +
        '<button class="btn btn-n btn-s" data-action="cloudEditorCodeDone">Done</button>' +
        '</div></div>';
    }

    let body = '';
    if (!code && !ecode) {
      body =
        '<div class="sr"><span class="sl"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-folder"></use></svg> Cloud Backup (Owner or Editor Code)</span></div>' +
        '<div class="sr-hint">Optional — link this project to the cloud so its state JSON lives in your backend (D1 + R2) and can be pulled back on any device. Never required; JSON export/import stays the guaranteed path.</div>' +
        '<div class="exp-row"><button class="btn btn-g btn-s" data-action="cloudCreate"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-upload"></use></svg> Create Cloud Project</button></div>' +
        '<div class="sr" style="margin-top:6px"><span class="sl"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-download"></use></svg> On another device?</span></div>' +
        '<div class="sr-hint">Enter the owner code you copied when this project was first linked, or an editor code you were given (the code lives only in the creator\u2019s session, so a new device needs it typed in here):</div>' +
        '<div class="exp-row">' +
        '<input type="text" id="cloud-code-in" class="ctl-in w150" placeholder="XXXX-XXXX-XXXX-XXXX" autocomplete="off" spellcheck="false" autocapitalize="characters" style="font-family:ui-monospace,monospace;letter-spacing:.05em">' +
        '<button class="btn btn-n btn-s" data-action="cloudLoadWithCode"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-download"></use></svg> Load with Code</button>' +
        '</div>';
    } else if (ecode && !code) {
      // EDITOR MODE — scoped editing; the server enforces the grant.
      const scopeTxt = escope && escope.sections && escope.sections.length
        ? escope.sections.map(sectionLabel).join(', ')
        : 'unknown';
      body =
        '<div class="sr"><span class="sl"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-folder"></use></svg> Cloud Backup — editing as editor</span></div>' +
        '<div class="sr-hint">Editor code active: <code style="font-family:ui-monospace,monospace;letter-spacing:.05em;color:var(--gold)">' + esc(escope && escope.label || 'editor') + '</code> — you can edit: <strong>' + esc(scopeTxt) + '</strong>. Other panels are locked for this code (enforced by the server, not just greyed out).</div>' +
        '<div class="exp-row">' +
        '<button class="btn btn-n btn-s" data-action="cloudSave"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-upload"></use></svg> Save to Cloud</button>' +
        '<button class="btn btn-n btn-s" data-action="cloudLoad"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-download"></use></svg> Load from Cloud</button>' +
        '<button class="btn btn-n btn-s" data-action="cloudCopyCode"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-clipboard"></use></svg> Copy Code</button>' +
        '<button class="btn btn-o btn-s" data-action="cloudDropEditor"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-x"></use></svg> Use owner code instead</button>' +
        '</div>' +
        '<div class="sr-hint">Changes you save are attributed to this editor label in the owner\u2019s changelog.</div>' +
        '<div id="cloud-last-sync" class="sr-hint" role="status" aria-live="polite"></div>';
    } else {
      // OWNER MODE (owner code in session).
      body =
        '<div class="sr"><span class="sl"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-folder"></use></svg> Cloud Backup — linked (owner)</span></div>' +
        '<div class="sr-hint">Owner/recovery code for this project: <code class="cloud-code" style="font-family:ui-monospace,monospace;letter-spacing:.05em;color:var(--gold)">' + esc(code) + '</code> — stored in this session only (sessionStorage, never localStorage). <strong>Copy it and keep it safe:</strong> if lost, only the linked Google account can recover it.</div>' +
        '<div class="exp-row">' +
        '<button class="btn btn-n btn-s" data-action="cloudSave"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-upload"></use></svg> Save to Cloud</button>' +
        '<button class="btn btn-n btn-s" data-action="cloudLoad"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-download"></use></svg> Load from Cloud</button>' +
        '<button class="btn btn-n btn-s" data-action="cloudCopyCode"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-clipboard"></use></svg> Copy Code</button>' +
        '<button class="btn btn-o btn-s" data-action="cloudRecover"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-refresh"></use></svg> Recover Owner Code</button>' +
        '</div>' +
        // gap-audit B10: deliberate unlink (keep local copy, stop syncing).
        '<div class="exp-row"><button class="btn btn-o btn-s" data-action="cloudUnlink"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-x"></use></svg> Unlink from Cloud (delete cloud copy)</button></div>' +
        pendingBanner +
        '<div id="cloud-last-sync" class="sr-hint" role="status" aria-live="polite"></div>' +
        // ---- Phase 2: editor codes ----
        '<div class="sr" style="margin-top:8px"><span class="sl"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-user"></use></svg> Editor Codes</span>' +
        '<button class="btn btn-n btn-s" data-action="cloudEditorList" style="margin-left:8px"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-refresh"></use></svg> List</button></div>' +
        '<div class="sr-hint">Give someone an editor code that can edit ONLY the sections you tick. Scope is enforced server-side on every save — a shared or leaked code cannot touch anything else.</div>' +
        '<div class="exp-row" style="flex-wrap:wrap">' +
        '<input type="text" id="cloud-editor-label-in" class="ctl-in" placeholder="Label, e.g. Site Super — Riverside" style="min-width:200px" autocomplete="off">' +
        '<button class="btn btn-g btn-s" data-action="cloudEditorCreate"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-plus"></use></svg> Create Editor Code</button>' +
        '</div>' +
        '<div id="cloud-editor-scope-box" style="display:flex;flex-wrap:wrap;gap:4px 10px;margin:6px 0;font-size:.72rem">' +
        '<span class="sr-hint" style="margin:0">Sections this code may edit:</span>' +
        '<span id="cloud-editor-scope-load" class="sr-hint" style="margin:0">loading…</span>' +
        '</div>' +
        '<div id="cloud-editor-list"></div>' +
        // ---- Phase 3: changelog ----
        '<div class="sr" style="margin-top:8px"><span class="sl"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-calendar"></use></svg> Changelog</span>' +
        '<button class="btn btn-n btn-s" data-action="cloudLogList" style="margin-left:8px"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-refresh"></use></svg> View</button></div>' +
        '<div class="sr-hint">Every save is logged with field-level before/after values (or a snapshot for bulk changes). Revert is owner-only and itself logged — history is never erased.</div>' +
        '<div id="cloud-log-list"></div>' +
        // ---- MASTER-ACTION-PLAN RANK 9.2: opt-in webhooks (owner-only) ----
        '<div class="sr" style="margin-top:8px"><span class="sl"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-zap"></use></svg> Webhooks</span>' +
        '<button class="btn btn-n btn-s" data-action="cloudWebhookList" style="margin-left:8px"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-refresh"></use></svg> List</button></div>' +
        '<div class="sr-hint">Opt-in notifications: when this project\u2019s health score drops, or tomorrow is a weather-risk day, My MaNaGeR POSTs a signed event to your URL (X-MMGR-Signature HMAC header). Off by default — nothing fires until you add one.</div>' +
        '<div class="exp-row" style="flex-wrap:wrap">' +
        '<select id="cloud-webhook-event" class="ctl-in" aria-label="Webhook event">' +
        '<option value="health_dropped">Health score dropped</option>' +
        '<option value="weather_risk_tomorrow">Weather-risk day tomorrow</option>' +
        '</select>' +
        '<input type="url" id="cloud-webhook-url" class="ctl-in" placeholder="https://hooks.example.com/mmgr" style="min-width:220px" autocomplete="off" spellcheck="false">' +
        '<button class="btn btn-g btn-s" data-action="cloudWebhookAdd"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-plus"></use></svg> Add Webhook</button>' +
        '</div>' +
        '<div id="cloud-webhook-list"></div>';
    }

    // Google sign-in strip (recovery only; create/save/load never need it).
    body += '<div class="sr" style="margin-top:8px"><span class="sl"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-user"></use></svg> Google</span></div>';
    if (signedIn) {
      // Provider-neutral: the session may be Google OR email+password —
      // both issue the same mmgr_session cookie (sub='email:…' vs a
      // numeric Google sub), and recovery is gated on the sub match alone.
      body += '<div class="sr-hint">Signed in — owner-code recovery is available for a linked project.</div>';
    } else {
      body += '<div class="sr-hint">Optional — sign in with Google to enable owner-code recovery if the code is ever lost.</div>' +
        '<div class="exp-row"><button class="btn btn-n btn-s" data-action="cloudSignIn"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-user"></use></svg> Sign in with Google</button></div>' +
        '<div id="cloud-gis-host" class="is-hide"></div>';
    }
    // gap-audit E18: the cloud status line is a live region so save/load/
    // recover/unlink outcomes are announced to screen-reader users.
    // Billing upgrade banner (only set by a real server 402 — see above).
    if (_upgradePending) {
      body += '<div class="sr" style="border:1px solid var(--gold);background:rgba(var(--gold-rgb),.1);border-radius:var(--radius);padding:8px 10px;margin:6px 0" role="status">' +
        '<div class="sr-hint" style="margin:0 0 6px"><strong>Free plan limit reached</strong> — you\u2019ve used all the linked cloud projects on the free plan. Upgrade to keep linking projects to the cloud.</div>' +
        '<button class="btn btn-g btn-s" data-action="cloudUpgrade"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-zap"></use></svg> Upgrade plan</button>' +
        '</div>';
    }
    body += '<div id="cloud-status" class="drive-status" role="status" aria-live="polite"></div>';

    wrap.innerHTML = body;

    // gap-audit B8: fill the last-synced line from /meta (owner + editor modes).
    if (code || ecode) {
      const ls = $('cloud-last-sync');
      if (ls) {
        ls.textContent = 'Checking cloud sync status…';
        cloudMetaStatus().then(function(txt) {
          const el = $('cloud-last-sync');
          if (el && txt) el.textContent = txt;
        });
      }
    }

    const host = $('cloud-gis-host');
    if (host && !host.querySelector('iframe, div[role=button]')) host.classList.add('is-hide');

    // Load the section checkboxes + existing editor codes into owner mode.
    if (code) {
      const scopeBox = $('cloud-editor-scope-box');
      if (scopeBox) {
        const secs = await fetchSections();
        const loadEl = $('cloud-editor-scope-load');
        if (loadEl) loadEl.remove();
        if (secs && secs.length) {
          secs.forEach(function(sec) {
            const label = document.createElement('label');
            label.className = 'pref';
            label.style.margin = '0';
            label.style.fontSize = '.72rem';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.value = sec.key;
            cb.style.margin = '0 3px 0 0';
            label.appendChild(cb);
            label.appendChild(document.createTextNode(sec.label));
            scopeBox.appendChild(label);
          });
        } else {
          const hint = document.createElement('span');
          hint.className = 'sr-hint';
          hint.style.margin = '0';
          hint.textContent = 'Cloud API unavailable here — editor codes need the Worker.';
          scopeBox.appendChild(hint);
        }
      }
      listEditors();
    } else if (ecode) {
      // gap-audit B11: an EDITOR session must also load the canonical section
      // vocabulary so the scope grey-out uses the SERVER list (never drifts).
      await fetchSections();
    }

    applyEditorScope();
  }

  // ---- sign-in entry (data-action) ----------------------------------------
  async function signIn() {
    const host = $('cloud-gis-host');
    if (!host) return;
    host.classList.remove('is-hide');
    const ok = await renderSignInButton();
    if (!ok) {
      host.classList.add('is-hide');
      setStatus('Google sign-in unavailable (offline or blocked) — recovery can wait.', 'warn');
    }
  }

  // ---- drop an editor credential (back to the owner-code entry) ----------
  async function dropEditor() {
    clearECode();
    await render();
    setStatus('Editor credential cleared — use the owner code (or Create) to link as owner.', 'warn');
  }

  // ---- unlink from cloud (gap-audit B10) ---------------------------------
  // Deletes the CLOUD copy (D1 row, editor codes, changelog, R2 objects).
  // This device's local project stays untouched — "keep local copy, stop
  // syncing". Owner-only, explicit confirm since it is irreversible.
  async function unlinkProject() {
    const cred = activeCredential();
    if (!cred) { setStatus('No cloud credential in this session.', 'warn'); return; }
    if (cred.header !== 'X-Owner-Code') { setStatus('Only the owner can unlink the project from cloud.', 'warn'); return; }
    if (!window.confirm('Delete the CLOUD copy of this project? Your local data on this device stays — only the cloud snapshot, editor codes, and changelog are removed. This cannot be undone.')) return;
    setStatus('Unlinking from cloud…', 'busy');
    try {
      const res = await fetch('/api/cloud/projects/' + encodeURIComponent(pid()), {
        method: 'DELETE', credentials: 'same-origin', headers: { 'X-Owner-Code': cred.code }
      });
      const data = await res.json().catch(function() { return {}; });
      if (!res.ok || !data.ok) { setStatus((data && data.error) || 'Unlink failed (HTTP ' + res.status + ').', 'err'); return; }
      clearCode(); clearECode(); setLastSeen(''); clearPendingEditorCode();
      await render();
      setStatus('Unlinked — the cloud copy is deleted. This device keeps its local data.', 'ok');
    } catch (e) {
      setStatus('Cloud is unavailable on this host (needs the Worker API).', 'err');
    }
  }

  // ---- copy the just-created editor code (shown-once banner, G23) ---------
  async function copyEditorCode(code) {
    if (!code) { setStatus('No code to copy.', 'warn'); return; }
    let copied = false;
    try {
      await navigator.clipboard.writeText(code);
      copied = true;
    } catch (e) {
      window.prompt('Editor code (select + copy):', code);
      copied = true;
    }
    clearPendingEditorCode();
    await render();
    setStatus(copied ? 'Editor code copied to the clipboard.' : 'Editor code shown — copy it from the prompt.', 'ok');
  }
  function editorCodeDone() {
    clearPendingEditorCode();
    render();
  }

  // ---- MASTER-ACTION-PLAN RANK 9.2: webhook management (owner-only) ------
  // Opt-in notification endpoints (off by default — nothing exists until the
  // owner adds one). All three mirror the editor/changelog patterns: owner
  // code in session, fetch, escape, render into a dedicated container.
  async function webhookList() {
    const wrap = $('cloud-webhook-list');
    if (!wrap) return;
    const code = getCode();
    if (!code) { wrap.innerHTML = '<div class="sr-hint">Owner code required.</div>'; return; }
    try {
      const res = await fetch('/api/cloud/projects/' + encodeURIComponent(pid()) + '/webhooks', {
        method: 'GET', credentials: 'same-origin', headers: { 'X-Owner-Code': code }
      });
      const data = await res.json().catch(function() { return {}; });
      if (!res.ok || !data.ok) { wrap.innerHTML = '<div class="sr-hint">Could not load webhooks.</div>'; return; }
      const list = data.webhooks || [];
      if (!list.length) { wrap.innerHTML = '<div class="sr-hint">No webhooks yet — add one above (health drop or weather-risk tomorrow).</div>'; return; }
      wrap.innerHTML = list.map(function(w) {
        const label = w.event === 'health_dropped' ? 'Health score dropped' : 'Weather-risk day tomorrow';
        return '<div class="sr" style="border:1px solid var(--border);border-radius:var(--radius);padding:7px 10px;margin:4px 0;display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
          '<span class="sl" style="font-size:.68rem">' + esc(label) + '</span>' +
          '<code style="font-size:.66rem;color:var(--slate);word-break:break-all">' + esc(w.targetUrl) + '</code>' +
          '<span class="sr-hint" style="margin:0 0 0 auto;font-size:.6rem">' + (w.lastFiredAt ? 'last fired ' + esc(String(w.lastFiredAt).slice(0, 10)) : 'never fired') + '</span>' +
          '<button class="btn btn-o btn-s" data-action="cloudWebhookDel" data-id="' + w.id + '"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-x"></use></svg> Remove</button>' +
          '</div>';
      }).join('');
    } catch (e) {
      wrap.innerHTML = '<div class="sr-hint">Could not reach the cloud service.</div>';
    }
  }

  async function webhookAdd() {
    const code = getCode();
    if (!code) { setStatus('Owner code required.', 'warn'); return; }
    const event = $('cloud-webhook-event');
    const urlEl = $('cloud-webhook-url');
    const targetUrl = urlEl ? urlEl.value.trim() : '';
    if (!targetUrl) { setStatus('Enter a target URL for the webhook.', 'warn'); return; }
    setStatus('Adding webhook…', 'busy');
    try {
      const res = await fetch('/api/cloud/projects/' + encodeURIComponent(pid()) + '/webhooks', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Owner-Code': code },
        body: JSON.stringify({ event: event ? event.value : 'health_dropped', targetUrl: targetUrl })
      });
      const data = await res.json().catch(function() { return {}; });
      if (!res.ok || !data.ok) { setStatus((data && data.error) || 'Add webhook failed (HTTP ' + res.status + ').', 'err'); return; }
      if (urlEl) urlEl.value = '';
      // The signing secret is shown exactly once — tell the owner to keep it.
      setStatus('Webhook added. Signing secret (shown once, store it): ' + data.secret, 'ok');
      webhookList();
    } catch (e) {
      setStatus('Cloud is unavailable on this host (needs the Worker API).', 'err');
    }
  }

  async function webhookDel(id) {
    const code = getCode();
    if (!code) { setStatus('Owner code required.', 'warn'); return; }
    try {
      const res = await fetch('/api/cloud/projects/' + encodeURIComponent(pid()) + '/webhooks/' + encodeURIComponent(id), {
        method: 'DELETE', credentials: 'same-origin', headers: { 'X-Owner-Code': code }
      });
      const data = await res.json().catch(function() { return {}; });
      if (!res.ok || !data.ok) { setStatus((data && data.error) || 'Remove webhook failed (HTTP ' + res.status + ').', 'err'); return; }
      setStatus('Webhook removed.', 'ok');
      webhookList();
    } catch (e) {
      setStatus('Cloud is unavailable on this host (needs the Worker API).', 'err');
    }
  }

  // ---- keep the sign-in state fresh after sign-in/sign-out ----------------
  document.addEventListener('mmgr:google-signed-in', function() { _signedIn = true; render(); });
  document.addEventListener('mmgr:google-signed-out', function() { _signedIn = false; render(); });

  // ---- public API ---------------------------------------------------------
  ns.Cloud = {
    render: render,
    createProject: createProject,
    cloudUpgrade: cloudUpgrade,
    saveToCloud: saveToCloud,
    loadFromCloud: loadFromCloud,
    loadWithCode: loadWithCode,
    recoverCode: recoverCode,
    copyCode: copyCode,
    signIn: signIn,
    createEditor: createEditor,
    listEditors: listEditors,
    revokeEditor: revokeEditor,
    listLog: listLog,
    webhookList: webhookList,
    webhookAdd: webhookAdd,
    webhookDel: webhookDel,
    revertLog: revertLog,
    toggleDiffs: toggleDiffs,
    _renderDiffPanel: renderDiffPanel, // test hook (diff panel is a pure string builder)
    dropEditor: dropEditor,
    unlinkProject: unlinkProject,
    copyEditorCode: copyEditorCode,
    editorCodeDone: editorCodeDone,
    applyEditorScope: applyEditorScope,
    getCode: getCode,
    getECode: getECode,
    getEScope: getEScope,
    // test hooks (qa-cloud-phase1.cjs / qa-cloud-phase2.cjs)
    _pid: pid,
    _readProjectState: readProjectState,
    _probeLoad: probeLoad,
    _normalizeCode: normalizeCode
  };

  // Render on boot (App.init calls this too via the guarded hook; the
  // double-call is safe — render is idempotent).
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})(MMGR);
window.MMGR = MMGR;
