/* ============================================================
   My MaNaGeR , Cloud Backup & Recovery (CLOUD-BACKEND-
   ARCHITECTURE-PLAN Phase 1 + 2 + 3)
   ------------------------------------------------------------
   Renders the optional "Cloud Backup" section into the Controls
   drawer on project.html (#cloud-section, right next to
   #drive-section). Strictly OPT-IN per project , a project with
   no cloud link behaves exactly as before (fully local, zero
   backend dependency). Never gating, never required.

   Phase 1 (owner code + recovery):
   - Create: POST /api/cloud/projects { projectId, name } , the
     Worker generates the owner/recovery code and returns it
     EXACTLY ONCE. The plaintext code is shown here + kept in
     sessionStorage (session memory only , never localStorage,
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
     greying-out here is UX only , a compromised editor code
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
   quiet "unavailable here" note and the page keeps working , the
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
  // Local escape , the module cannot depend on mmgr-utils.js being loaded
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
      if (!p || !Array.isArray(p.sections)) return null;
      // CLOUD-CODES-AND-DELETE: role ('editor' | 'view' | 'client') , legacy
      // stored scopes (pre-migration) were always editor; default them here
      // so no caller ever reads an undefined role.
      if (p.role !== 'view' && p.role !== 'client') p.role = 'editor';
      return p;
    } catch (e) { return null; }
  }
  function setEScope(label, sections, role) {
    try { sessionStorage.setItem(escopeKey(), JSON.stringify({ label: label || '', sections: sections || [], role: (role === 'view' || role === 'client') ? role : 'editor' })); } catch (e) { /* ignore */ }
  }

  // ---- CLOUD-FIRST SYNC (PART 3, approved 2026-08-17): offline copies ---
  // A registered copy is a VIEW-ONLY snapshot of the cloud project on this
  // device. The registration lives server-side (offline_copies table, keyed
  // on the device id); the device id + copy id + the cloud revision this
  // copy last pulled are stored here (localStorage , a copy must survive
  // reloads so the "Update offline copy" icon can persist).
  function deviceId() {
    try {
      let id = localStorage.getItem('mmgr_device_id');
      if (!id) {
        id = (crypto.randomUUID ? crypto.randomUUID() : ('dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)));
        localStorage.setItem('mmgr_device_id', id);
      }
      return id;
    } catch (e) {
      return 'dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    }
  }
  function copyKey() { return 'mmgr_offline_copy_' + pid(); }
  function getCopyRecord() {
    try {
      const raw = localStorage.getItem(copyKey());
      if (!raw) return null;
      const p = JSON.parse(raw);
      return (p && p.copyId && p.deviceId) ? p : null;
    } catch (e) { return null; }
  }
  function setCopyRecord(rec) {
    try { localStorage.setItem(copyKey(), JSON.stringify(rec)); } catch (e) { /* ignore */ }
  }
  function clearCopyRecord() {
    try { localStorage.removeItem(copyKey()); } catch (e) { /* ignore */ }
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
      const raw = localStorage.getItem(pendingCodeKey());
      if (!raw) return null;
      const p = JSON.parse(raw);
      return (p && p.code) ? p : null;
    } catch (e) { return null; }
  }
  function setPendingEditorCode(code, label, scope, role) {
    try { localStorage.setItem(pendingCodeKey(), JSON.stringify({ code: code, label: label || '', scope: scope || [], role: role === 'view' ? 'view' : 'editor' })); } catch (e) { /* ignore */ }
  }
  function clearPendingEditorCode() {
    try { localStorage.removeItem(pendingCodeKey()); } catch (e) { /* ignore */ }
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
  // hosts) , the cloud section reports its own state so recovery availability
  // is visible on project.html too.
  async function checkMe(force) {
    if (_meChecked && !force) return _signedIn;
    _meChecked = true;
    try {
      const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (res.ok) {
        const data = await res.json();
        _signedIn = !!(data && data.ok && data.user);
      }
    } catch (e) { /* static host / offline , stays false */ }
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
  function sectionLabel(key) { return ns.CloudShare ? ns.CloudShare.sectionLabel(key) : key; }

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
  // Dormant when billing is unconfigured , the server never 402s then, so the
  // banner never appears and this whole path is inert (byte-for-byte unchanged
  // behavior on the current deploy).
  let _upgradePending = false;
  // AUTH MAINFRAME v2 , verified-email gate: set when create answers HTTP 403
  // {verifyRequired:true} (unverified email account). Mirrors _upgradePending:
  // render() shows a confirm-your-email banner + a resend action. Dormant when
  // email is unconfigured or the session is Google , the server never 403s then.
  let _verifyPending = false;
  let _createInFlight = false;

  async function createProject() {
    if (_createInFlight) return; // BUG-1: debounce rapid clicks
    if (getCode()) { setStatus('This project is already linked to the cloud , use Save / Load below.', 'warn'); return; }
    _createInFlight = true;
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
          setStatus((data && data.error) || 'Free plan limit reached , upgrade to link more projects.', 'err');
        } else if (res.status === 403 && data && data.verifyRequired) {
          // AUTH MAINFRAME v2: the email account has not clicked its
          // confirmation link. Surface the inbox guidance + a resend
          // affordance instead of a bare error (mirrors the 402 pattern).
          _verifyPending = true;
          await render();
          setStatus((data && data.error) || 'Verify your email to enable cloud projects , check your inbox for the confirmation link.', 'err');
        } else if (res.status === 409) {
          // BUG-1: project already linked , reload the drawer to show the
          // existing code instead of a confusing error.
          setStatus('This project is already linked to the cloud.', 'warn');
          await render();
        } else {
          setStatus((data && data.error) || 'Cloud create failed (HTTP ' + res.status + ').', 'err');
        }
        return;
      }
      _upgradePending = false;
      _verifyPending = false;
      setCode(data.ownerCode);
      await render();
      setStatus('Cloud project linked , owner/recovery code: ' + data.ownerCode + '. Store it somewhere safe: if lost, only the linked Google account can recover it.', 'ok');
    } catch (e) {
      var _detail = (e && (e.message || e.name || String(e))) || 'unknown';
      setStatus('Cloud is unavailable on this host (needs the Worker API). [' + _detail + ']', 'err');
      console.error('[cloud] createProject failed:', e);
    } finally {
      _createInFlight = false;
    }
  }

  // AUTH MAINFRAME v2 , resend the verification email for the signed-in
  // account (the confirm-your-email banner's action). The endpoint answers a
  // generic message either way (no existence/status leak); the banner stays
  // until the account verifies or the drawer is reloaded.
  async function cloudResendVerify() {
    setStatus('Sending confirmation link…', 'busy');
    try {
      const meRes = await fetch('/api/auth/me', { credentials: 'same-origin' });
      const me = await meRes.json().catch(function() { return null; });
      const email = (me && me.ok && me.user && me.user.email) ? me.user.email : '';
      if (!email) {
        setStatus('You are not signed in with an email account , sign in to request a new link.', 'warn');
        return;
      }
      const res = await fetch('/api/auth/resend-verify', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email })
      });
      const data = await res.json().catch(function() { return {}; });
      if (res.ok && data && data.ok) {
        setStatus((data && data.message) || 'If an account needs verification, a new confirmation link is on its way , check your inbox.', 'ok');
      } else {
        setStatus((data && data.error) || 'Could not send the link (HTTP ' + res.status + ').', 'err');
      }
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
          setStatus('Billing isn\u2019t configured on this server yet , no upgrade is available.', 'warn');
        } else {
          setStatus((data && data.error) || 'Checkout failed (HTTP ' + res.status + ').', 'err');
        }
        return;
      }
      window.open(data.checkoutUrl, '_blank', 'noopener');
      setStatus('Checkout opened in a new tab , complete the purchase there, then create the project again.', 'ok');
    } catch (e) {
      setStatus('Cloud is unavailable on this host (needs the Worker API).', 'err');
    }
  }

  // ---- which credential is in session, and the right header name ----------
  function activeCredential() {
    const oc = getCode();
    const ec = getECode();
    if (oc) return { code: oc, header: 'X-Owner-Code' };
    if (ec) {
      const es = getEScope();
      // CLOUD-CODES-AND-DELETE: a VIEW code travels under X-View-Code , the
      // server only ever grants reads (role='view'); a view save is refused.
      // C19: a CLIENT code travels under X-Client-Code (role='client'), also
      // read-only everywhere.
      const r = es && es.role;
      return { code: ec, header: r === 'view' ? 'X-View-Code' : (r === 'client' ? 'X-Client-Code' : 'X-Editor-Code') };
    }
    return null;
  }

  // ---- save ---------------------------------------------------------------
  async function saveToCloud() {
    /* DEMO GUARD: demo projects are code-based, non-cloud. */
    if (ns.projectId === 'demo-filled' || ns.projectId === 'demo-empty') { setStatus('Demo projects cannot be saved to the cloud.', 'warn'); return; }
    const cred = activeCredential();
    if (!cred) { setStatus('Create a cloud project first (button above).', 'warn'); return; }
    // CLOUD-CODES-AND-DELETE: a viewer code is read-only everywhere , the
    // server would refuse the save (X-View-Code is never accepted by /save),
    // so refuse it here with a plain explanation instead of a confusing 403.
    if (cred.header === 'X-View-Code') { setStatus('Viewer codes are read-only. You cannot save changes to the cloud. Ask the admin for an editor or owner code to edit.', 'warn'); return; }
    // C19: client codes are read-only too — the server would refuse /save
    // with no client path at all, so refuse it here with plain copy.
    if (cred.header === 'X-Client-Code') { setStatus('Client codes are read-only. You can view the granted sections but cannot change anything. Ask the admin for an editor code to edit.', 'warn'); return; }
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
        if (res.status === 413) msg = 'Project too large for cloud (8 MB cap) , trim voice/claim data or use export/import instead.';
        if (res.status === 403) { if (cred.header === 'X-Owner-Code') clearCode(); else clearECode(); }
        await render();
        setStatus(msg, 'err');
        return;
      }
      const prevSeen = getLastSeen();
      if (data.savedAt) setLastSeen(data.savedAt);
      let statusMsg = 'Saved to cloud , ' + (data.savedAt || '').slice(0, 19).replace('T', ' ') + '.';
      if (data.actor === 'editor') {
        const scopeTxt = (data.scope || []).map(sectionLabel).join(', ');
        // REVIEW QUEUE (approved 2026-08-17, always on): an editor save is a
        // PROPOSAL , the cloud does not move until the owner accepts it.
        // Say exactly that instead of claiming the save landed.
        if (data.review === 'pending') {
          statusMsg = 'Saved for owner review (' + (data.editorLabel || 'editor') + ') , your change is pending acceptance before it reaches the cloud. Scope: ' + scopeTxt + '.';
          if (data.blocked && data.blocked.length) statusMsg += ' Outside this code\u2019s scope: ' + data.blocked.map(sectionLabel).join(', ') + '.';
        } else if (data.review === 'noop') {
          statusMsg = 'Saved as editor (' + (data.editorLabel || 'editor') + ') , nothing new within this code\u2019s scope to send for review.';
          if (data.blocked && data.blocked.length) statusMsg += ' Outside this code\u2019s scope: ' + data.blocked.map(sectionLabel).join(', ') + '.';
        } else {
          statusMsg = 'Saved as editor (' + (data.editorLabel || 'editor') + ') , scope: ' + scopeTxt + '.';
          if (data.applied && data.applied.length) statusMsg += ' Applied: ' + data.applied.map(sectionLabel).join(', ') + '.';
          if (data.blocked && data.blocked.length) statusMsg += ' NOT saved (outside this code\u2019s scope): ' + data.blocked.map(sectionLabel).join(', ') + '.';
        }
      } else {
        statusMsg += ' Snapshot ' + (data.key || '').split('/').pop() + '.';
      }
      // gap-audit B9: last-write-wins WITH a heads-up. If the server reports
      // the previous snapshot was written after our last known sync, someone
      // else saved in between , say so instead of overwriting silently.
      if (data.previousUpdatedAt && prevSeen && data.previousUpdatedAt !== prevSeen) {
        statusMsg += ' Another device saved since you last synced , this save overwrote it.';
      }
      setStatus(statusMsg, 'ok');
    } catch (e) {
      var _detail = (e && (e.message || e.name || String(e))) || 'unknown';
      setStatus('Cloud is unavailable on this host (needs the Worker API). [' + _detail + ']', 'err');
      console.error('[cloud] saveToCloud failed:', e);
    }
  }

  // ---- SILENT background auto-sync (OWNER 2026-08-15) ---------------------
  // Fired by the app's debounced auto-save once the user goes idle (or on
  // pagehide for the final edits), keeping the cloud snapshot current so the
  // header's green "Cloud backed up" chip is honest. Works for BOTH owner
  // and editor sessions , the Worker merges an editor's save through their
  // section scope server-side (cloudScopeMerge), so a silent push can only
  // ever touch the sections that editor is granted. Never toasts; failures
  // land quietly in the drawer status line and are retried on the next edit
  // cycle. Zero-throw like the rest of the module.
  let _autoBusy = false;
  async function autoSaveToCloud(opts) {
    const cred = activeCredential();
    if (!cred) return false;
    if (cred.header === 'X-View-Code') return false; // viewers never push
    if (cred.header === 'X-Client-Code') return false; // C19: clients never push
    if (_autoBusy) return false;
    const state = readProjectState();
    if (!state) return false;
    _autoBusy = true;
    try {
      const headers = { 'Content-Type': 'application/json' };
      headers[cred.header] = cred.code;
      const body = JSON.stringify({ state: state });
      // keepalive:true lets a pagehide flush survive tab close, but keepalive
      // requests are size-capped (~64 KiB), so only use it for small states;
      // large states rely on the idle debounce (which normally already fired).
      const useKeepalive = !!(opts && opts.keepalive) && body.length < 48000;
      const res = await fetch('/api/cloud/projects/' + encodeURIComponent(pid()) + '/save', {
        method: 'POST',
        credentials: 'same-origin',
        headers: headers,
        body: body,
        keepalive: useKeepalive
      });
      const data = await res.json().catch(function() { return {}; });
      if (!res.ok || !data.ok) {
        if (res.status === 403) clearCode(); // stale owner code , drop the link
        setStatus('Auto cloud backup failed , open Cloud Backup and Save manually.', 'err');
        return false;
      }
      if (data.savedAt) setLastSeen(data.savedAt);
      return true;
    } catch (e) {
      // offline / Worker unavailable , retry on the next edit cycle
      return false;
    } finally {
      _autoBusy = false;
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
        const raw = (data && data.error) || '';
        const msg = raw === 'code_revoked' ? 'This code was revoked by the project admin. Contact them for a new one.'
          : raw === 'project_deleted' ? 'This project was deleted by the admin. It is no longer available from the cloud.'
          : raw || 'Cloud load failed (HTTP ' + res.status + ').';
        if (res.status === 403) { if (cred.header === 'X-Owner-Code') clearCode(); else clearECode(); }
        await render();
        setStatus(msg, 'err');
        return;
      }
      if (!data.state) { setStatus('No cloud snapshot saved for this project yet , save once from another device first.', 'warn'); return; }
      try {
        localStorage.setItem('mmgr_state_' + pid(), JSON.stringify(data.state));
        localStorage.setItem('mmgr_unlocked_' + pid(), '1');
        localStorage.setItem('mmgr_scope_' + pid(), 'full');
        localStorage.setItem('mmgr_current_project', pid());
      } catch (e) { /* storage blocked , status below still reports the outcome */ }
      if (data.role === 'view') setEScope(data.viewerLabel || data.editorLabel, data.scope || [], 'view');
      else if (data.role === 'editor') setEScope(data.editorLabel, data.scope || []);
      else if (data.role === 'client') setEScope('Client', data.sections || [], 'client');
      if (data.savedAt) setLastSeen(data.savedAt);
      setStatus('Cloud snapshot restored , reloading.', 'ok');
      startClientRefresh();
      setTimeout(function() { window.location.reload(); }, 1200);
    } catch (e) {
      setStatus('Cloud is unavailable on this host (needs the Worker API).', 'err');
    }
  }

  // ---- route-to-sign-in (OWNER 2026-08-15) --------------------------------
  // A cloud action that needs the Google session pops the sign-in prompt at
  // that exact moment instead of leaving the user to hunt for Settings, then
  // resumes the action automatically once the session exists. The GIS prompt
  // runs inside the click gesture (openSignInPrompt); the in-drawer GIS host
  // is the fallback when GoogleAuth's helper is unavailable.
  let _pendingSignInAction = null;
  function queueAfterSignIn(label, action) {
    _pendingSignInAction = { label: label, action: action };
    setStatus('Sign in to continue , ' + label + ' runs automatically once you are signed in.', 'warn');
    const GA = window.MMGR.GoogleAuth;
    if (GA && typeof GA.openSignInPrompt === 'function') {
      if (GA.openSignInPrompt()) return;
    }
    signIn(); // fallback: reveal the in-drawer GIS host right there
  }
  function resumePendingSignIn() {
    if (!_pendingSignInAction) return;
    const p = _pendingSignInAction;
    _pendingSignInAction = null;
    _meChecked = false; // checkMe cached "not signed in" , re-query the session
    try { p.action(); } catch (e) { /* the action guards itself */ }
  }
  document.addEventListener('mmgr:google-signed-in', resumePendingSignIn);
  document.addEventListener('mmgr:user-changed', resumePendingSignIn);

  // ---- recover owner code -------------------------------------------------
  async function recoverCode() {
    const linked = await checkMe();
    if (!linked) {
      queueAfterSignIn('owner-code recovery', recoverCode);
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
      setStatus('New owner code issued: ' + data.ownerCode + ' , also below + Copy Code. The previous code no longer works.', 'ok');
      if (data.recoveredAt) setLastSeen(data.recoveredAt);
    } catch (e) {
      console.error('[recoverCode] catch:', e && e.message, e && e.stack);
      setStatus('Cloud is unavailable on this host (needs the Worker API). [' + (e && e.message || 'unknown') + ']', 'err');
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
  // The code could be an OWNER code or an EDITOR code , probe owner first,
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
    if (!result || !result.ok) {
      const err = result && result.error;
      setStatus(err === 'code_revoked' ? 'This code was revoked by the project admin. Contact them for a new one.'
        : err === 'project_deleted' ? 'This project was deleted by the admin. It is no longer available from the cloud.'
        : 'That code was not accepted for this project. Check it and try again.', 'err');
      return;
    }
    const r = result.data;
    if (r.role === 'view') {
      setECode(code);
      setEScope(r.viewerLabel || r.editorLabel, r.scope || [], 'view');
    } else if (r.role === 'editor') {
      setECode(code);
      setEScope(r.editorLabel, r.scope || []);
    } else if (r.role === 'client') {
      setECode(code);
      setEScope('Client', r.sections || [], 'client');
    } else {
      setCode(code);
    }
    render();
    await loadFromCloud();
  }

  // Probe /load with a typed code: owner header, editor header, then view
  // header (CLOUD-CODES-AND-DELETE: viewer codes are role='view'). Returns
  // { ok:true, data } on success or { ok:false, error } on failure (the last
  // structured error seen, for friendly copy). Never throws.
  async function probeLoad(code) {
    const headersOrder = ['X-Owner-Code', 'X-Editor-Code', 'X-View-Code', 'X-Client-Code'];
    let lastErr = null;
    for (let i = 0; i < headersOrder.length; i++) {
      try {
        const headers = { 'Content-Type': 'application/json' };
        headers[headersOrder[i]] = code;
        const res = await fetch('/api/cloud/projects/' + encodeURIComponent(pid()) + '/load', {
          method: 'POST', credentials: 'same-origin', headers: headers, body: JSON.stringify({})
        });
        const data = await res.json().catch(function() { return {}; });
        if (res.ok && data && data.ok) return { ok: true, data: data };
        if (data && data.error) lastErr = data.error;
      } catch (e) { /* try the next header, then give up */ }
    }
    return { ok: false, error: lastErr };
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
      setStatus('Code shown , copy it from the prompt.', 'ok');
    }
  }

  // =========================================================================
  // PHASE 2 , editor code management (owner-only UI)
  // =========================================================================

  // Create: read the label + role + checked section boxes -> POST -> show code once.
  // CLOUD-CODES-AND-DELETE: a role picker ('editor' | 'view') sits next to the
  // label , editor = can edit the granted sections, view = read-only everywhere
  // with only the granted sections visible/enabled.
  async function createEditor() {
    const labelIn = $('cloud-editor-label-in');
    const label = (labelIn && labelIn.value || '').trim().slice(0, 60);
    if (!label) { setStatus('Give this code a label first (e.g. \u201CSite Super , Riverside\u201D).', 'warn'); return; }
    const roleIn = $('cloud-editor-role');
    const role = roleIn && roleIn.value === 'view' ? 'view' : 'editor';
    const scope = [];
    const boxes = document.querySelectorAll('#cloud-editor-scope-box input[type=checkbox]:checked');
    for (let i = 0; i < boxes.length; i++) scope.push(boxes[i].value);
    if (scope.length === 0) { setStatus(role === 'view' ? 'Tick at least one section this code may see.' : 'Tick at least one section this code may edit.', 'warn'); return; }
    const code = getCode();
    if (!code) { setStatus('Owner code required to manage codes.', 'warn'); return; }
    setStatus('Creating code…', 'busy');
    try {
      const res = await fetch('/api/cloud/projects/' + encodeURIComponent(pid()) + '/editors', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Owner-Code': code },
        body: JSON.stringify({ label: label, scope: scope, role: role })
      });
      const data = await res.json().catch(function() { return {}; });
      if (!res.ok || !data.ok || !data.editorCode) {
        setStatus((data && data.error) || 'Code creation failed (HTTP ' + res.status + ').', 'err');
        return;
      }
      // gap-audit G23: park the code in a shown-once banner (render renders it
      // prominently with a Copy button) , matching the owner-code flow's
      // "copy this now" seriousness.
      setPendingEditorCode(data.editorCode, data.label, data.scope || [], data.role || 'editor');
      await render();
      setStatus((data.role === 'view' ? 'Viewer' : 'Editor') + ' code created for \u201C' + data.label + '\u201D (scope: ' + (data.scope || []).map(sectionLabel).join(', ') + '). Copy it from the banner, it is shown once.', 'ok');
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
      if (!eds.length) { wrap.innerHTML = '<div class="sr-hint">No codes yet , create one above.</div>'; return; }
      wrap.innerHTML = eds.map(function(e) {
        const isView = e.role === 'view';
        const storedCode = getPendingEditorCode();
        const codeVal = (storedCode && storedCode.code && storedCode.label === e.label) ? storedCode.code : null;
        return '<div class="sr" style="font-size:.72rem;display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
          '<span style="color:var(--gold)">' + esc(e.label || (isView ? 'Viewer' : 'Editor')) + '</span>' +
          '<span class="sr-hint" style="margin:0">' + (isView ? 'viewer · ' : 'editor · ') + esc((e.scope || []).map(sectionLabel).join(', ')) + ' · ' + esc(String(e.createdAt || '').slice(0, 10)) + '</span>' +
          (codeVal ? '<code style="font-family:ui-monospace,monospace;letter-spacing:.05em;color:var(--gold);font-size:.82rem;font-weight:700">' + esc(codeVal) + '</code><button class="btn btn-g btn-s" data-action="cloudCopyEditorCode" data-code="' + esc(codeVal) + '"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-clipboard"></use></svg> Copy</button>' : '') +
          (e.active ? '<button class="btn btn-d btn-s" data-action="cloudEditorRevoke" data-id="' + e.id + '">Revoke</button>' : '<span class="sr-hint" style="margin:0">revoked</span>') +
          '</div>';
      }).join('');
    } catch (e) {
      wrap.innerHTML = '<div class="sr-hint">Cloud unavailable here.</div>';
    }
  }

  // Revoke an editor code (owner-only) , the code stops working immediately.
  async function revokeEditor(id) {
    if (!id) return;
    if (!window.confirm('Revoke this code? It stops working immediately and cannot be restored.')) return;
    const code = getCode();
    if (!code) { setStatus('Owner code required to revoke codes.', 'warn'); return; }
    setStatus('Revoking code…', 'busy');
    try {
      const res = await fetch('/api/cloud/projects/' + encodeURIComponent(pid()) + '/editors/' + encodeURIComponent(id), {
        method: 'DELETE', credentials: 'same-origin', headers: { 'X-Owner-Code': code }
      });
      const data = await res.json().catch(function() { return {}; });
      if (!res.ok || !data.ok) { setStatus((data && data.error) || 'Revoke failed (HTTP ' + res.status + ').', 'err'); return; }
      clearPendingEditorCode();
      await render();
      setStatus('Editor code revoked.', 'ok');
      listEditors();
    } catch (e) {
      setStatus('Cloud is unavailable on this host (needs the Worker API).', 'err');
    }
  }

  // =========================================================================
  // PHASE 3 , changelog (owner-only view + revert)
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
      if (!entries.length) { wrap.innerHTML = '<div class="sr-hint">No cloud changes logged yet , save once from any device to start the log.</div>'; return; }
      wrap.innerHTML = entries.map(function(en) {
        // MCP-CHANGELOG-UI (backlog, 2026-08-12): entries imported from the MCP
        // AI sidecar (source === 'mcp', set server-side from import_key) render
        // with a distinct purple AI badge + "MCP AI" actor so AI-made changes
        // never masquerade as the owner. Revert stays available , recordId
        // reverts were the whole point of the import pipeline.
        const isMCP = en.source === 'mcp';
        const hasDiffs = Array.isArray(en.diffs) && en.diffs.length > 0;
        const who = (isMCP ? 'MCP AI' : (en.actorType === 'editor' ? 'Editor \u201C' + esc(en.actorLabel || '?') + '\u201D' : 'Owner')) + ' · ' + esc(String(en.createdAt || '').slice(0, 19).replace('T', ' '));
        let what = '';
        let revertBtn = '<button class="btn btn-o btn-s" data-action="cloudLogRevert" data-id="' + en.id + '">Revert</button>';
        if (en.type === 'bulk') what = 'Full-state change (snapshot)';
        else if (en.type === 'revert') what = 'Revert of a previous change';
        else if (en.type === 'recovery') { what = 'Owner code reissued (recovery)'; revertBtn = ''; } // not a content change , not revertible
        // CLOUD-FIRST SYNC (2026-08-17): a 'broadcast' entry means the owner
        // pushed the current snapshot to all registered offline copies (or
        // auto-broadcast fired on save). A push is not a content change, so
        // it is not revertible , exactly like 'recovery'.
        else if (en.type === 'broadcast') { what = 'Broadcast to offline copies'; revertBtn = ''; }
        // REVIEW QUEUE (2026-08-17): 'accepted' = the owner approved an
        // inbound change (editor save applied or AI import acknowledged) , 
        // carries the same leaf diffs as an 'edit', so it stays revertible.
        // 'rejected' = the owner declined , nothing changed, not revertible.
        else if (en.type === 'accepted') {
          what = (isMCP ? 'Accepted AI change (MCP)' : 'Accepted change from review') + (en.diffs && en.diffs.length ? ' , ' + en.diffs.length + ' field(s) changed' : '');
        }
        else if (en.type === 'rejected') { what = (isMCP ? 'Rejected AI change (MCP)' : 'Rejected change from review'); revertBtn = ''; }
        else what = (en.diffs ? en.diffs.length : 0) + ' field(s) changed' + (en.section ? ' · ' + esc(sectionLabel(en.section)) : '');
        if (isMCP && en.type !== 'accepted' && en.type !== 'rejected') what = 'Imported from AI (MCP) , ' + what;
        // Click-to-expand diffs (backlog, 2026-08-12): any entry carrying
        // field-level diffs (edit + revert entries; bulk rows only hold a
        // snapshot key) gets a caret that reveals the before/after panel , 
        // pure DOM, view-only, never a server call.
        const toggleBtn = hasDiffs
          ? '<button type="button" class="cl-toggle" data-action="cloudLogToggleDiffs" data-id="' + en.id + '" aria-expanded="false" aria-controls="cl-diffs-' + en.id + '" aria-label="Show field diffs for entry ' + en.id + '" title="Show field-level before/after values"></button>'
          : '';
        const panelHtml = hasDiffs
          ? '<div id="cl-diffs-' + en.id + '" class="cl-diffs is-hide" role="region" aria-label="Field-level diffs for entry ' + en.id + '">' + renderDiffPanel(en) + '</div>'
          : '';
        return '<div class="sr" style="font-size:.72rem;display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
          '<span style="color:var(--gold)">' + esc(String(en.id)) + '</span>' +
          (isMCP ? '<span class="badge-ai" title="Imported from the MCP AI changelog , reverts resolve by stable record id"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-sparkle"></use></svg> AI · MCP</span>' : '') +
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
  // title attribute. Everything is escaped , the values are server state.
  function _clValImpl(v, absent, cls) {
    if (absent) return '<em class="cl-absent">absent</em>';
    let s;
    if (v === undefined) v = null;
    if (v === null) s = 'null';
    else if (typeof v === 'object') {
      try { s = JSON.stringify(v); } catch (e) { s = String(v); }
    } else s = String(v);
    const title = s.length > 140 ? ' title="' + esc(s) + '"' : '';
    const shown = s.length > 140 ? s.slice(0, 137) + '…' : s;
    return '<code class="cl-val ' + cls + '"' + title + '>' + esc(shown) + '</code>';
  }
  function clVal(v, absent, cls) { return ns.CloudDiffs ? ns.CloudDiffs.clVal(v, absent, cls) : _clValImpl(v, absent, cls); }

  // Build the field-level before/after panel markup for one entry (pure
  // string builder , no DOM access, exposed as a test hook). Capped at 60
  // rows; the server's leaf-diff cap (40) makes the cap a sanity guard.
  function _renderDiffPanelImpl(en) {
    const diffs = (Array.isArray(en.diffs) ? en.diffs : []).slice(0, 60);
    const n = Array.isArray(en.diffs) ? en.diffs.length : 0;
    if (!diffs.length) return '';
    let rows = '';
    for (let i = 0; i < diffs.length; i++) {
      const d = diffs[i] || {};
      rows += '<div class="cl-diff">' +
        '<code class="cl-diff-path" title="' + esc(String(d.path || '')) + '">' + esc(String(d.path || '?')) + '</code>' +
        _clValImpl(d.before, d.beforeAbsent === true, 'cl-old') +
        '<span class="cl-arr">→</span>' +
        _clValImpl(d.after, d.afterAbsent === true, 'cl-new') +
        '</div>';
    }
    if (n > diffs.length) rows += '<div class="cl-more">… and ' + (n - diffs.length) + ' more field(s)</div>';
    return '<div class="cl-diffs-head"><span>Field</span><span>Before</span><span></span><span>After</span></div>' + rows;
  }
  function renderDiffPanel(en) { return ns.CloudDiffs ? ns.CloudDiffs.renderDiffPanel(en) : _renderDiffPanelImpl(en); }

  // Toggle an entry's diff panel open/closed (no server call, nothing
  // mutated , safe in view-only mode, hence in READONLY_SAFE_ACTIONS).
  function toggleDiffs(id) { if (ns.CloudDiffs) ns.CloudDiffs.toggleDiffs(id); }

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
      setStatus('Reverted , the change is now undone on the cloud snapshot. Load from Cloud to pull it into this workspace.', 'ok');
      listLog();
    } catch (e) {
      setStatus('Cloud is unavailable on this host (needs the Worker API).', 'err');
    }
  }

  // =========================================================================
  // EDITOR-SCOPE UI , grey out panels an editor code cannot WRITE (UX only;
  // the Worker enforces the scope regardless).
  // =========================================================================
  // gap-audit B11: the grey-out must mirror the SERVER's writable vocabulary
  // (worker.js CLOUD_SECTIONS), not block panels indiscriminately. Panels that
  // are VIEW-ONLY (dash/def/kan/gantt/claim/digest/baselinen/wxlog) read
  // derived data and are deliberately not scoping targets , an editor can
  // always VIEW them; the server blocks their writes by construction. When the
  // canonical list is available (_sections, fetched from the Worker) it IS the
  // vocabulary, so the two can never drift; the static mirror below only
  // applies where no editor session can exist anyway (static host).
  const VIEW_ONLY_PANELS = ['dash', 'def', 'kan', 'gantt', 'claim', 'digest', 'baselinen', 'wxlog'];
  function isWritableSection(key) { return ns.CloudScope ? ns.CloudScope.isWritableSection(key) : true; }
  // Is this section off-limits for the current session's scoped editor code?
  // Mirrors applyEditorScope's block list exactly so the nav grey-out and the
  // section-switch guard (mmgr-render.js showSection) can never drift apart.
  // View-only panels (dash/def/kan/gantt/claim/digest/baselinen/wxlog) are
  // never blocked , they read derived data and the server blocks their writes
  // by construction (B11).
  function isSectionBlocked(section) { return ns.CloudScope ? ns.CloudScope.isSectionBlocked(section) : false; }
  function isClientSectionHidden(section) { return ns.CloudScope ? !!ns.CloudScope.isClientSectionHidden(section) : false; }
  function applyClientScope() { if (ns.CloudScope && ns.CloudScope.applyClientScope) ns.CloudScope.applyClientScope(); }
  function applyEditorScope() {
    // C19: client nav-hiding runs on the SAME pass — mutually exclusive with
    // the editor grey-out (a session is either editor/view or client).
    if (ns.CloudScope) {
      if (ns.CloudScope.applyClientScope) ns.CloudScope.applyClientScope();
      ns.CloudScope.applyEditorScope();
    }
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
      return t ? ('Last saved to cloud: ' + t) : 'No cloud snapshot yet , save once to start.';
    } catch (e) { return ''; }
  }

  // ---- shown-once NEW-editor-code banner (gap-audit G23) -----------------
  function pendingBannerHtml(pendingCode) { return ns.CloudShare ? ns.CloudShare.pendingBannerHtml(pendingCode) : ""; }

  // OWNER 2026-08-15: Share & Access card in the Controls tab (#ctrl-share).
  // Single home for the owner code + editor-code manager (moved out of the
  // cloud section so the sharing feature is visible and not buried). The ids
  // cloud-editor-* stay unchanged , createEditor/listEditors/revokeEditor
  // keep working against them wherever they live.
  function renderShare() { if (ns.CloudShare) ns.CloudShare.renderShare(); }

  // ---- IN-PROJECT DELETE (owner 2026-08-17) ------------------------------
  let _delBusy = false;
  // Settings > Controls > bottom (Danger Zone): the owner deletes THIS
  // cloud project from inside the project , the same owner-only soft delete
  // the launcher/admin use (every other user's copy becomes discontinued;
  // offline copies keep their last snapshot but get no more updates). The
  // confirm modal (#del-modal, static markup on project.html) asks "Are you
  // sure?" and , for EMAIL accounts , requires the account password first
  // (POST /api/auth/verify-password, owner: "you have to put in your
  // password to verify the delete"). Google accounts have no password, so
  // the field stays hidden for them: their signed-in session IS the
  // verification. Server-enforced either way: the delete route is owner-only
  // and the verify endpoint is session-gated + timing-safe.
  function renderDangerZone() {
    const zone = $('del-zone');
    const body = $('del-zone-body');
    if (!zone && !body) return;
    const show = !!getCode(); // owner code held -> this IS the admin's project
    if (zone) zone.hidden = !show;
    if (body) body.hidden = !show;
  }
  // PASSWORD-SAVE-FIX (2026-08-24): the delete-confirm password field is
  // rendered dynamically when the modal opens and removed when it closes,
  // so Chrome's password manager never sees a type="password" input in the
  // static DOM (which triggers a spurious "save as password" prompt even
  // when the field is hidden). The outer wrapper (#del-pw-wrap) stays in
  // the HTML for layout; only the input itself is injected/removed.
  function _ensureDelPwField() {
    const fields = $('del-pw-fields');
    if (!fields) return null;
    let inp = $('del-pw');
    if (inp) return inp;
    inp = document.createElement('input');
    inp.type = 'password';
    inp.id = 'del-pw';
    inp.className = 'email-auth-input email-auth-pw-cur';
    inp.placeholder = 'Your account password';
    inp.autocomplete = 'off';
    inp.setAttribute('aria-label', 'Account password to verify the delete');
    fields.appendChild(inp);
    return inp;
  }
  function _removeDelPwField() {
    const inp = $('del-pw');
    if (inp && inp.parentNode) inp.parentNode.removeChild(inp);
  }
  async function cloudDeleteOpen() {
    const modal = $('del-modal');
    if (!modal) return;
    const err = $('del-err'); if (err) err.textContent = '';
    const wrap = $('del-pw-wrap');
    // Decide the field's visibility from the LIVE session: email account ->
    // password gate; Google/absent -> no field (session is the verification).
    let emailAccount = false;
    try {
      const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (res.ok) {
        const data = await res.json();
        emailAccount = !!(data && data.ok && data.user && String(data.user.sub).indexOf('email:') === 0);
      }
    } catch (e) { /* static host / offline , no field */ }
    if (wrap) wrap.hidden = !emailAccount;
    modal.classList.add('on');
    if (emailAccount) {
      const pw = _ensureDelPwField();
      if (pw) { pw.value = ''; setTimeout(function () { pw.focus(); }, 60); }
    }
  }
  function cloudDeleteClose() {
    const modal = $('del-modal');
    if (modal) modal.classList.remove('on');
    _delBusy = false;
    const ok = $('del-ok'); if (ok) { ok.disabled = false; ok.textContent = 'Delete project'; }
    const err = $('del-err'); if (err) err.textContent = '';
    _removeDelPwField();
  }
  async function cloudDeleteConfirm() {
    if (_delBusy) return;
    const err = $('del-err');
    const code = getCode();
    if (!code) { if (err) err.textContent = 'The owner code is missing from this session. Re-open the project with your owner code and try again.'; return; }
    const wrap = $('del-pw-wrap');
    const needsPw = !!(wrap && !wrap.hidden);
    const pwInp = $('del-pw');
    const pw = needsPw && pwInp ? pwInp.value : '';
    _delBusy = true;
    const ok = $('del-ok'); if (ok) { ok.disabled = true; ok.textContent = 'Deleting…'; }
    const reset = function () {
      _delBusy = false;
      if (ok) { ok.disabled = false; ok.textContent = 'Delete project'; }
    };
    try {
      // 1) Password gate (email accounts only).
      if (needsPw) {
        const vr = await fetch('/api/auth/verify-password', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pw })
        });
        const vd = await vr.json().catch(function () { return {}; });
        if (!vr.ok || !vd.ok) {
          reset();
          if (err) err.textContent = (vd && vd.error === 'password is incorrect')
            ? 'The password is incorrect.'
            : ((vd && vd.error) || 'Could not verify your password. Try again.');
          return;
        }
      }
      // 2) Owner-only soft delete (same route as the launcher/admin).
      const res = await fetch('/api/cloud/projects/' + encodeURIComponent(pid()) + '/delete', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Owner-Code': code },
        body: JSON.stringify({})
      });
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) {
        reset();
        if (err) err.textContent = (data && data.error === 'project_deleted')
          ? 'This project was already deleted.'
          : ((data && data.error) || 'Could not delete the project (HTTP ' + res.status + ').');
        return;
      }
      // 3) Success: drop the local copy (admin list entry) + cloud session
      // codes so nothing re-syncs, then go home. Everyone else already sees
      // the project as discontinued server-side.
      clearCode(); clearECode();
      try {
        const raw = localStorage.getItem('mmgr_admin_projects');
        if (raw) {
          const recs = JSON.parse(raw);
          if (Array.isArray(recs)) {
            const idx = recs.findIndex(function (r) { return r && (String(r.id) === pid() || String(r.cloudId || '') === pid()); });
            if (idx !== -1) { recs.splice(idx, 1); localStorage.setItem('mmgr_admin_projects', JSON.stringify(recs)); }
          }
        }
      } catch (e) { /* best-effort , cloud delete is the source of truth */ }
      cloudDeleteClose();
      const App = window.MMGR.App;
      if (App && App.showToast) App.showToast('Project deleted. Every shared copy now shows as discontinued.', 'ok');
      setTimeout(function () { window.location.href = 'app.html'; }, 900);
    } catch (e) {
      reset();
      if (err) err.textContent = 'Could not reach the cloud service.';
    }
  }

  // OWNER 2026-08-15: adopt a cloud code recorded by the ADMIN panel for
  // this project (mmgr_admin_projects → record.cloudOwnerCode). Publishing
  // from the admin panel stores the owner code beside the project; when the
  // owner opens that project here, this seeds it into the session store so
  // publish → open → auto-sync works with zero re-typing. Runs silently,
  // never overrides a code the user already entered this session, and only
  // reads the admin's own record , the code still lives in sessionStorage
  // (same security posture as every other credential in this module).
  function adoptAdminRecordedCode() {
    if (getCode() || getECode()) return;
    try {
      const raw = localStorage.getItem('mmgr_admin_projects');
      if (!raw) return;
      const recs = JSON.parse(raw);
      if (!Array.isArray(recs)) return;
      const rec = recs.find(function (r) { return r && String(r.id) === pid(); });
      if (!rec || !rec.cloudOwnerCode) return;
      setCode(String(rec.cloudOwnerCode));
    } catch (e) { /* read-only best effort , never throws */ }
  }

  async function render() {
    adoptAdminRecordedCode();
    const wrap = $('cloud-section');
    if (!wrap) return;
    const code = getCode();
    const ecode = getECode();
    const escope = getEScope();
    const signedIn = await checkMe();
    // C19 (C1b): a client session runs the refresh watcher (poll /meta 60s
    // while visible + visibilitychange + rev-changed) — idempotent, so
    // every render pass is safe.
    startClientRefresh();
    // The Controls-tab Share & Access card must mirror the same credential
    // state , render it alongside the cloud section on every render pass.
    renderShare();
    // IN-PROJECT DELETE: reveal the Danger Zone only while an owner code is
    // held (same render pass , one credential read, both surfaces).
    renderDangerZone();

    let body = '';
    if (!code && !ecode) {
      body =
        '<div class="sr"><span class="sl"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-folder"></use></svg> Cloud Backup (Owner or Editor Code)</span></div>' +
        '<div class="sr-hint">Optional , link this project to the cloud so its state JSON lives in your backend (D1 + R2) and can be pulled back on any device. Never required; JSON export/import stays the guaranteed path.</div>' +
        '<div class="exp-row"><button class="btn btn-g btn-s" data-action="cloudCreate"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-upload"></use></svg> Create Cloud Project</button></div>' +
        '<div class="sr" style="margin-top:6px"><span class="sl"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-download"></use></svg> On another device?</span></div>' +
        '<div class="sr-hint">Enter the owner code you copied when this project was first linked, or an editor code you were given (the code lives only in the creator\u2019s session, so a new device needs it typed in here):</div>' +
        '<div class="exp-row">' +
        '<input type="text" id="cloud-code-in" class="ctl-in w150" placeholder="XXXX-XXXX-XXXX-XXXX" autocomplete="off" spellcheck="false" autocapitalize="characters" style="font-family:ui-monospace,monospace;letter-spacing:.05em">' +
        '<button class="btn btn-n btn-s" data-action="cloudLoadWithCode"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-download"></use></svg> Load with Code</button>' +
        '</div>';
    } else if (ecode && !code) {
      // EDITOR / VIEWER / CLIENT MODE , scoped access; the server enforces the
      // grant. Clients are read-only consumers (C19) — no Save, no offline
      // copy, no review queue; just Load + Copy + a live last-sync line.
      const isView = !!(escope && escope.role === 'view');
      const isClient = !!(escope && escope.role === 'client');
      const roleName = isClient ? 'Client' : (isView ? 'Viewer' : 'Editor');
      const scopeTxt = escope && escope.sections && escope.sections.length
        ? escope.sections.map(sectionLabel).join(', ')
        : 'unknown';
      body =
        '<div class="sr"><span class="sl"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-folder"></use></svg> Cloud Backup: ' + (isClient ? 'viewing as client' : (isView ? 'viewing as viewer' : 'editing as editor')) + '</span></div>' +
        '<div class="sr-hint">' + roleName + ' code active: <code style="font-family:ui-monospace,monospace;letter-spacing:.05em;color:var(--gold)">' + esc(escope && escope.label || roleName.toLowerCase()) + '</code>. You can see: <strong>' + esc(scopeTxt) + '</strong>. ' + (isClient || isView ? 'Read-only: nothing here can be changed.' : 'Other panels are locked for this code (enforced by the server, not just greyed out).') + '</div>' +
        '<div class="exp-row">' +
        (isClient || isView ? '' : '<button class="btn btn-n btn-s" data-action="cloudSave"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-upload"></use></svg> Save to Cloud</button>') +
        '<button class="btn btn-n btn-s" data-action="cloudLoad"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-download"></use></svg> Load from Cloud</button>' +
        '<button class="btn btn-n btn-s" data-action="cloudCopyCode"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-clipboard"></use></svg> Copy Code</button>' +
        '<button class="btn btn-o btn-s" data-action="cloudDropEditor"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-x"></use></svg> Use owner code instead</button>' +
        '</div>' +
        // CLOUD-FIRST SYNC: "Make offline copy" (view-only, owner decision
        // 2026-08-17) + "Update offline copy" when the copy is behind. The
        // server registers the copy; this device is view-only so the pull
        // overwrite is always safe (approved reconcile: copies never fight
        // the cloud , the local auto-syncs up, the admin broadcasts down).
        // C19: clients get neither the copy machinery nor the review line.
        (isClient ? '' :
        '<div class="sr" style="margin-top:8px"><span class="sl"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-download"></use></svg> Offline copy</span></div>' +
        '<div id="cloud-offline-copy-box"></div>' +
        // REVIEW QUEUE: the editor's own proposal status line (pending /
        // accepted / rejected) , filled by cloudReviewMine() on render.
        '<div id="cloud-review-mine"></div>') +
        '<div class="sr-hint">' + (isClient ? 'Read-only. This view refreshes automatically when the admin saves.' : (isView ? 'Nothing you do here changes the cloud copy , reload anytime to see fresh data.' : 'Changes you save wait for the owner\u2019s review before they reach the cloud project , accepted edits are logged in the changelog.')) + '</div>' +
        '<div id="cloud-last-sync" class="sr-hint" role="status" aria-live="polite"></div>';
    } else {
      // OWNER MODE (owner code in session). The owner code + editor-code
      // manager live in the Controls tab's Share & Access section
      // (renderShare) , the cloud section keeps backup + changelog + webhooks.
      body =
        '<div class="sr"><span class="sl"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-folder"></use></svg> Cloud Backup , linked (owner)</span></div>' +
        '<div class="sr-hint">Your owner code and editor codes are in <strong>Controls ▸ Share &amp; Access</strong> above. This section is the backup + history side: snapshots auto-sync to the cloud in the background as you work , Save now just pushes immediately; view the changelog, and wire webhooks.</div>' +
        '<div class="exp-row">' +
        '<button class="btn btn-n btn-s" data-action="cloudSave"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-upload"></use></svg> Save to Cloud</button>' +
        '<button class="btn btn-n btn-s" data-action="cloudLoad"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-download"></use></svg> Load from Cloud</button>' +
        '<button class="btn btn-n btn-s" data-action="cloudCopyCode"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-clipboard"></use></svg> Copy Code</button>' +
        '<button class="btn btn-o btn-s" data-action="cloudRecover"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-refresh"></use></svg> Recover Owner Code</button>' +
        '</div>' +
        // gap-audit B10: deliberate unlink (keep local copy, stop syncing).
        '<div class="exp-row"><button class="btn btn-o btn-s" data-action="cloudUnlink"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-x"></use></svg> Unlink from Cloud (delete cloud copy)</button></div>' +
        '<div id="cloud-last-sync" class="sr-hint" role="status" aria-live="polite"></div>' +
        // ---- Phase 3: changelog ----
        '<div class="sr" style="margin-top:8px"><span class="sl"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-calendar"></use></svg> Changelog</span>' +
        '<button class="btn btn-n btn-s" data-action="cloudLogList" style="margin-left:8px"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-refresh"></use></svg> View</button></div>' +
        '<div class="sr-hint">Every save is logged with field-level before/after values (or a snapshot for bulk changes). Revert is owner-only and itself logged , history is never erased.</div>' +
        '<div id="cloud-log-list"></div>' +
        // CLOUD-FIRST SYNC (PART 3, approved 2026-08-17): the owner's
        // broadcast controls , manual "Broadcast to other projects" + the
        // per-project auto-broadcast toggle (owner decision: broadcast
        // overwrites copies when the admin clicks OR auto-broadcast is on).
        '<div class="sr" style="margin-top:8px"><span class="sl"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-upload"></use></svg> Offline copies &amp; broadcast</span>' +
        '<button class="btn btn-n btn-s" data-action="cloudBroadcast" style="margin-left:8px"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-bell"></use></svg> Broadcast to other projects</button></div>' +
        '<div class="sr-hint">Registered offline copies update when you save (live refresh). Broadcast now pushes the current snapshot to every copy and logs it in the changelog.</div>' +
        '<label class="pref" style="margin:6px 0 0;font-size:.72rem;display:flex;align-items:center;gap:6px">' +
        '<input type="checkbox" id="cloud-auto-broadcast" data-action="cloudAutoBroadcast"> Auto-broadcast on every save (this project)</label>' +
        '<div id="cloud-offline-list" style="margin-top:6px"></div>' +
        // REVIEW QUEUE (approved 2026-08-17, always on): the owner's gate
        // for changes from a non-owner source , editor saves and AI imports
        // wait here as proposals until the owner accepts (applies) or
        // rejects (discards). Nothing reaches the project without a decision.
        '<div class="sr" style="margin-top:8px"><span class="sl"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-check"></use></svg> Review incoming changes</span>' +
        '<button class="btn btn-n btn-s" data-action="cloudReviewList" style="margin-left:8px"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-refresh"></use></svg> Refresh</button></div>' +
        '<div class="sr-hint">Edits from editor codes (and AI imports) wait here for your decision , accept to apply them to the cloud project, reject to discard. The editor sees the outcome on their side.</div>' +
        '<div id="cloud-review-list"></div>' +
        // ---- MASTER-ACTION-PLAN RANK 9.2: opt-in webhooks (owner-only) ----
        '<div class="sr" style="margin-top:8px"><span class="sl"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-zap"></use></svg> Webhooks</span>' +
        '<button class="btn btn-n btn-s" data-action="cloudWebhookList" style="margin-left:8px"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-refresh"></use></svg> List</button></div>' +
        '<div class="sr-hint">Opt-in notifications: when this project\u2019s health score drops, or tomorrow is a weather-risk day, My MaNaGeR POSTs a signed event to your URL (X-MMGR-Signature HMAC header). Off by default , nothing fires until you add one.</div>' +
        '<div class="exp-row" style="flex-wrap:wrap">' +
        '<select id="cloud-webhook-event" class="ctl-in" aria-label="Webhook event">' +
        '<option value="health_dropped">Health score dropped</option>' +
        '<option value="weather_risk_tomorrow">Weather-risk day tomorrow</option>' +
        '</select>' +
        '<input type="url" id="cloud-webhook-url" class="ctl-in" placeholder="https://hooks.example.com/mmgr" style="min-width:220px" autocomplete="off" spellcheck="false">' +
        '<button class="btn btn-g btn-s" data-action="cloudWebhookAdd"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-plus"></use></svg> Add Webhook</button>' +
        '</div>' +
        '<div id="cloud-webhook-list"></div>' +
        // MCP SERVER: per-project Model Context Protocol endpoint
        '<div class="sr" style="margin-top:8px"><span class="sl"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-sparkle"></use></svg> MCP Server</span></div>' +
        '<div class="sr-hint">Connect external AI tools (Claude Desktop, Cursor, Windsurf) to this project via the Model Context Protocol. The AI can read your project data and suggest changes (which go through your review queue).</div>' +
        '<div class="exp-row" style="flex-wrap:wrap;align-items:center;gap:8px">' +
        '<input type="text" id="mcp-url" class="ctl-in" readonly style="flex:1;min-width:200px;font-family:ui-monospace,monospace;font-size:.72rem;letter-spacing:.02em;background:var(--tile-bg)" value="" aria-label="MCP Server URL">' +
        '<button class="btn btn-n btn-s" data-action="mcpCopyUrl"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-clipboard"></use></svg> Copy</button>' +
        '</div>' +
        '<div class="sr-hint" style="margin-top:4px">In your MCP client, add this server with: Authorization: Bearer &lt;your-owner-code&gt;</div>' +
        '<div id="mcp-status" class="sr-hint" role="status" aria-live="polite"></div>';
    }

    // Google sign-in strip (recovery only; create/save/load never need it).
    body += '<div class="sr" style="margin-top:8px"><span class="sl"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-user"></use></svg> Google</span></div>';
    if (signedIn) {
      // Provider-neutral: the session may be Google OR email+password , 
      // both issue the same mmgr_session cookie (sub='email:…' vs a
      // numeric Google sub), and recovery is gated on the sub match alone.
      body += '<div class="sr-hint">Signed in , owner-code recovery is available for a linked project.</div>';
    } else {
      body += '<div class="sr-hint">Optional , sign in with Google to enable owner-code recovery if the code is ever lost.</div>' +
        '<div class="exp-row"><button class="btn btn-n btn-s" data-action="cloudSignIn"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-user"></use></svg> Sign in with Google</button></div>' +
        '<div id="cloud-gis-host" class="is-hide"></div>';
    }
    // gap-audit E18: the cloud status line is a live region so save/load/
    // recover/unlink outcomes are announced to screen-reader users.
    // Billing upgrade banner (only set by a real server 402 , see above).
    if (_upgradePending) {
      body += '<div class="sr" style="border:1px solid var(--gold);background:rgba(var(--gold-rgb),.1);border-radius:var(--radius);padding:8px 10px;margin:6px 0" role="status">' +
        '<div class="sr-hint" style="margin:0 0 6px"><strong>Free plan limit reached</strong> , you\u2019ve used all the linked cloud projects on the free plan. Upgrade to keep linking projects to the cloud.</div>' +
        '<button class="btn btn-g btn-s" data-action="cloudUpgrade"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-zap"></use></svg> Upgrade plan</button>' +
        '</div>';
    }
    // AUTH MAINFRAME v2 , verified-email gate banner (only set by a real
    // server 403 {verifyRequired:true} , see createProject above).
    if (_verifyPending) {
      body += '<div class="sr" style="border:1px solid var(--gold);background:rgba(var(--gold-rgb),.1);border-radius:var(--radius);padding:8px 10px;margin:6px 0" role="status">' +
        '<div class="sr-hint" style="margin:0 0 6px"><strong>Confirm your email</strong> , cloud projects unlock once you click the confirmation link we emailed you.</div>' +
        '<button class="btn btn-n btn-s" data-action="cloudResendVerify"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-mail"></use></svg> Resend confirmation link</button>' +
        '</div>';
    }
    body += '<div id="cloud-status" class="drive-status" role="status" aria-live="polite"></div>';

    wrap.innerHTML = body;

    // MCP SERVER URL: fill the read-only input with the project's MCP endpoint.
    if (code) {
      var mcpUrlInput = $('mcp-url');
      if (mcpUrlInput) {
        var projectId = pid();
        mcpUrlInput.value = window.location.origin + '/api/mcp/' + encodeURIComponent(projectId);
      }
    }

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

    // CLOUD-FIRST SYNC: fill the viewer/editor "Offline copy" box (Make /
    // Update / Remove) and, in owner mode, the broadcast list + auto-toggle.
    const copyBox = $('cloud-offline-copy-box');
    if (copyBox) {
      const rec = getCopyRecord();
      if (!rec) {
        copyBox.innerHTML = '<div class="exp-row">' +
          '<button class="btn btn-n btn-s" data-action="cloudMakeCopy"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-download"></use></svg> Make offline copy</button>' +
          '</div>' +
          '<div class="sr-hint">Keep a view-only snapshot of this project on this device. It updates automatically when the project changes or the admin broadcasts.</div>';
      } else {
        copyBox.innerHTML = '<div class="sr" style="font-size:.72rem;display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
          '<span class="sr-hint" style="margin:0">View-only offline copy registered on this device.</span>' +
          '<button class="btn btn-n btn-s" data-action="cloudUpdateCopy"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-refresh"></use></svg> Update offline copy</button>' +
          '<button class="btn btn-o btn-s" data-action="cloudRemoveCopy"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-x"></use></svg> Remove copy</button>' +
          '</div>' +
          '<div class="sr-hint">Updates arrive automatically when the admin saves or broadcasts. The copy is view-only , nothing here can edit the project.</div>';
      }
    }
    if (code) {
      cloudOfflineList();
      cloudReviewList();
    } else if (getECode() && !getCode()) {
      const escope2 = getEScope();
      // REVIEW QUEUE: an EDITOR's own proposal status (pending / accepted /
      // rejected) , the "review list with status" visibility approved for
      // the source side. Viewers cannot save, so they have no proposals.
      if (!(escope2 && escope2.role === 'view')) cloudReviewMine();
    }

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
          hint.textContent = 'Cloud API unavailable here , editor codes need the Worker.';
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
  // Reveals the in-drawer GIS button AND pops the Google prompt immediately
  // (one motion , no second click on a rendered button required).
  async function signIn() {
    const host = $('cloud-gis-host');
    if (!host) return;
    host.classList.remove('is-hide');
    const ok = await renderSignInButton();
    if (!ok) {
      host.classList.add('is-hide');
      setStatus('Google sign-in unavailable (offline or blocked) , recovery can wait.', 'warn');
      return;
    }
    const GA = window.MMGR.GoogleAuth;
    if (GA && typeof GA.openSignInPrompt === 'function') {
      try { GA.openSignInPrompt(); } catch (e) { /* button stays rendered */ }
    }
  }

  // ---- drop an editor credential (back to the owner-code entry) ----------
  async function dropEditor() {
    clearECode();
    await render();
    setStatus('Editor credential cleared , use the owner code (or Create) to link as owner.', 'warn');
  }

  // ---- unlink from cloud (gap-audit B10) ---------------------------------
  // Deletes the CLOUD copy (D1 row, editor codes, changelog, R2 objects).
  // This device's local project stays untouched , "keep local copy, stop
  // syncing". Owner-only, explicit confirm since it is irreversible.
  async function unlinkProject() {
    const cred = activeCredential();
    if (!cred) { setStatus('No cloud credential in this session.', 'warn'); return; }
    if (cred.header !== 'X-Owner-Code') { setStatus('Only the owner can unlink the project from cloud.', 'warn'); return; }
    if (!window.confirm('Delete the CLOUD copy of this project? Your local data on this device stays , only the cloud snapshot, editor codes, and changelog are removed. This cannot be undone.')) return;
    setStatus('Unlinking from cloud…', 'busy');
    try {
      const res = await fetch('/api/cloud/projects/' + encodeURIComponent(pid()), {
        method: 'DELETE', credentials: 'same-origin', headers: { 'X-Owner-Code': cred.code }
      });
      const data = await res.json().catch(function() { return {}; });
      if (!res.ok || !data.ok) { setStatus((data && data.error) || 'Unlink failed (HTTP ' + res.status + ').', 'err'); return; }
      clearCode(); clearECode(); setLastSeen(''); clearPendingEditorCode();
      await render();
      setStatus('Unlinked , the cloud copy is deleted. This device keeps its local data.', 'ok');
    } catch (e) {
      setStatus('Cloud is unavailable on this host (needs the Worker API).', 'err');
    }
  }

  // =========================================================================
  // CLOUD-FIRST SYNC (PART 3, approved 2026-08-17) , offline copies +
  // broadcast. A registered copy is a VIEW-ONLY snapshot of this project on
  // this device (owner decision: "View-only"). It updates when the main
  // device saves (live refresh on save , approved scope) or when the admin
  // broadcasts. Reconcile model (owner): the local is connected to the cloud,
  // so changes made auto-sync up whenever a sync can happen, and the cloud
  // broadcasts down to copies when the admin clicks "Broadcast to other
  // projects" or turns on per-project auto-broadcast.
  // =========================================================================
  async function cloudMakeCopy() {
    const cred = activeCredential();
    if (!cred) { setStatus('No cloud credential in this session.', 'warn'); return; }
    if (getCopyRecord()) { setStatus('This device already has an offline copy of this project.', 'warn'); return; }
    setStatus('Registering offline copy…', 'busy');
    try {
      const headers = { 'Content-Type': 'application/json' };
      headers[cred.header] = cred.code;
      const res = await fetch('/api/cloud/projects/' + encodeURIComponent(pid()) + '/offline-copies', {
        method: 'POST', credentials: 'same-origin', headers: headers,
        body: JSON.stringify({ deviceId: deviceId() })
      });
      const data = await res.json().catch(function() { return {}; });
      if (!res.ok || !data.ok || !data.copyId) {
        setStatus((data && data.error) || 'Offline copy registration failed (HTTP ' + res.status + ').', 'err');
        return;
      }
      setCopyRecord({ copyId: data.copyId, deviceId: deviceId(), lastCloudRev: data.revision || null });
      await render();
      setStatus('Offline copy registered on this device , it updates when the project changes or the admin broadcasts. View-only.', 'ok');
    } catch (e) {
      setStatus('Cloud is unavailable on this host (needs the Worker API).', 'err');
    }
  }

  // Pull the newest cloud snapshot into this device's workspace WITHOUT a
  // full page reload: adopt the state in memory (State.adoptExternal) and
  // re-render (Render.renderAll), then stamp the copy's last_cloud_rev via
  // the X-Device-Id header the server uses for freshness tracking. silent =
  // the live-refresh path (rev-changed push) , no status churn; manual clicks
  // get the friendly confirmation. Never throws.
  async function cloudUpdateCopy(silent) {
    const cred = activeCredential();
    const rec = getCopyRecord();
    if (!cred || !rec) { setStatus('No offline copy registered on this device yet , use Make offline copy first.', 'warn'); return; }
    if (!silent) setStatus('Updating offline copy…', 'busy');
    try {
      const headers = { 'Content-Type': 'application/json', 'X-Device-Id': rec.deviceId };
      headers[cred.header] = cred.code;
      const res = await fetch('/api/cloud/projects/' + encodeURIComponent(pid()) + '/load', {
        method: 'POST', credentials: 'same-origin', headers: headers, body: JSON.stringify({})
      });
      const data = await res.json().catch(function() { return {}; });
      if (!res.ok || !data.ok) {
        const raw = (data && data.error) || '';
        const msg = raw === 'code_revoked' ? 'This code was revoked by the project admin. Contact them for a new one.'
          : raw === 'project_deleted' ? 'This project was deleted by the admin. It is no longer available from the cloud.'
          : raw || 'Offline copy update failed (HTTP ' + res.status + ').';
        if (!silent) setStatus(msg, 'err');
        return;
      }
      if (!data.state) { if (!silent) setStatus('No cloud snapshot to pull yet , the admin needs to save once first.', 'warn'); return; }
      try {
        localStorage.setItem('mmgr_state_' + pid(), JSON.stringify(data.state));
        localStorage.setItem('mmgr_unlocked_' + pid(), '1');
        localStorage.setItem('mmgr_scope_' + pid(), 'full');
        localStorage.setItem('mmgr_current_project', pid());
      } catch (e) { /* storage blocked , in-memory adopt below still applies */ }
      const S = window.MMGR.State;
      if (S && typeof S.adoptExternal === 'function') S.adoptExternal(data.state);
      const R = window.MMGR.Render;
      if (R && typeof R.renderAll === 'function') { try { R.renderAll(); } catch (e) { /* render is best-effort */ } }
      if (data.savedAt) {
        setLastSeen(data.savedAt);
        rec.lastCloudRev = data.savedAt;
        setCopyRecord(rec);
      }
      if (!silent) setStatus('Offline copy updated , this device now matches the cloud (' + (data.savedAt || '').slice(0, 19).replace('T', ' ') + ').', 'ok');
    } catch (e) {
      if (!silent) setStatus('Cloud is unavailable on this host (needs the Worker API).', 'err');
    }
  }

  // Remove this device's offline copy (server unregister + local record).
  async function cloudRemoveCopy() {
    const rec = getCopyRecord();
    const cred = activeCredential();
    if (!rec) { setStatus('No offline copy registered on this device.', 'warn'); return; }
    if (!window.confirm('Remove this device\u2019s offline copy? It stops receiving updates; the cloud project and other copies are untouched.')) return;
    try {
      if (cred) {
        const headers = { 'Content-Type': 'application/json', 'X-Device-Id': rec.deviceId };
        headers[cred.header] = cred.code;
        const res = await fetch('/api/cloud/projects/' + encodeURIComponent(pid()) + '/offline-copies/' + encodeURIComponent(rec.copyId), {
          method: 'DELETE', credentials: 'same-origin', headers: headers,
          body: JSON.stringify({ deviceId: rec.deviceId })
        });
        // 404/403 on an already-gone copy is fine , the local record is the
        // source of truth for "this device has a copy" going forward.
        if (!res.ok) { /* keep going , clear the local record either way */ }
      }
      clearCopyRecord();
      await render();
      setStatus('Offline copy removed.', 'ok');
    } catch (e) {
      setStatus('Cloud is unavailable on this host (needs the Worker API).', 'err');
    }
  }

  // Owner: list registered offline copies into the broadcast UI + refresh
  // the auto-broadcast toggle state. Zero-throw; failure leaves the row
  // with a quiet "could not load" note.
  async function cloudOfflineList() {
    const wrap = $('cloud-offline-list');
    if (!wrap) return;
    const code = getCode();
    if (!code) { wrap.innerHTML = '<div class="sr-hint">Owner code required.</div>'; return; }
    try {
      const res = await fetch('/api/cloud/projects/' + encodeURIComponent(pid()) + '/offline-copies', {
        method: 'GET', credentials: 'same-origin', headers: { 'X-Owner-Code': code }
      });
      const data = await res.json().catch(function() { return {}; });
      if (!res.ok || !data.ok) { wrap.innerHTML = '<div class="sr-hint">Could not load offline copies.</div>'; return; }
      const copies = data.copies || [];
      const toggle = $('cloud-auto-broadcast');
      if (toggle) toggle.checked = !!data.autoBroadcast;
      if (!copies.length) {
        wrap.innerHTML = '<div class="sr-hint">No offline copies registered yet , recipients click Make offline copy inside their view.</div>';
        return;
      }
      wrap.innerHTML = copies.map(function(c) {
        const pulled = c.lastPulledAt ? String(c.lastPulledAt).slice(0, 19).replace('T', ' ') : 'never';
        return '<div class="sr" style="font-size:.72rem;display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
          '<span class="sr-hint" style="margin:0">' + esc(String(c.deviceId).slice(0, 24)) + '</span>' +
          '<span class="sr-hint" style="margin:0">last pulled ' + esc(pulled) + '</span>' +
          '<button class="btn btn-o btn-s" data-action="cloudOfflineRemove" data-id="' + esc(c.id) + '">Remove</button>' +
          '</div>';
      }).join('');
    } catch (e) {
      wrap.innerHTML = '<div class="sr-hint">Cloud unavailable here.</div>';
    }
  }

  // Owner: manual "Broadcast to other projects" , pushes the current
  // revision to every registered copy (connected ones refresh instantly via
  // the Presence DO) and records a changelog 'broadcast' entry.
  async function cloudBroadcast() {
    const code = getCode();
    if (!code) { setStatus('Owner code required to broadcast.', 'warn'); return; }
    if (!window.confirm('Broadcast to other projects now? Every registered offline copy is told the cloud moved and will pull the latest snapshot. View-only copies cannot edit, so nothing is lost.')) return;
    setStatus('Broadcasting…', 'busy');
    try {
      const res = await fetch('/api/cloud/projects/' + encodeURIComponent(pid()) + '/broadcast', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': code },
        body: JSON.stringify({})
      });
      const data = await res.json().catch(function() { return {}; });
      if (!res.ok || !data.ok) { setStatus((data && data.error) || 'Broadcast failed (HTTP ' + res.status + ').', 'err'); return; }
      setStatus('Broadcast sent , ' + (data.copies || 0) + ' registered copy/copies will update to the current snapshot.', 'ok');
      cloudOfflineList();
    } catch (e) {
      setStatus('Cloud is unavailable on this host (needs the Worker API).', 'err');
    }
  }

  // Owner: toggle per-project auto-broadcast (every save also broadcasts).
  async function cloudAutoBroadcast() {
    const code = getCode();
    if (!code) { setStatus('Owner code required.', 'warn'); return; }
    const toggle = $('cloud-auto-broadcast');
    const enabled = !!(toggle && toggle.checked);
    try {
      const res = await fetch('/api/cloud/projects/' + encodeURIComponent(pid()) + '/auto-broadcast', {
        method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': code },
        body: JSON.stringify({ enabled: enabled })
      });
      const data = await res.json().catch(function() { return {}; });
      if (!res.ok || !data.ok) {
        if (toggle) toggle.checked = !enabled; // revert the checkbox on failure
        setStatus((data && data.error) || 'Auto-broadcast toggle failed (HTTP ' + res.status + ').', 'err');
        return;
      }
      setStatus(enabled ? 'Auto-broadcast ON , every save also broadcasts to registered copies.' : 'Auto-broadcast OFF , broadcast manually when you want to push.', 'ok');
    } catch (e) {
      if (toggle) toggle.checked = !enabled;
      setStatus('Cloud is unavailable on this host (needs the Worker API).', 'err');
    }
  }

  // Owner: remove a specific registered copy from the broadcast list.
  async function cloudOfflineRemove(id) {
    const code = getCode();
    if (!code || !id) return;
    if (!window.confirm('Remove this offline copy? The device stops receiving updates; the cloud project and its other copies are untouched.')) return;
    try {
      const res = await fetch('/api/cloud/projects/' + encodeURIComponent(pid()) + '/offline-copies/' + encodeURIComponent(id), {
        method: 'DELETE', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Owner-Code': code }
      });
      const data = await res.json().catch(function() { return {}; });
      if (!res.ok || !data.ok) { setStatus((data && data.error) || 'Remove failed (HTTP ' + res.status + ').', 'err'); return; }
      setStatus('Offline copy removed.', 'ok');
      cloudOfflineList();
    } catch (e) {
      setStatus('Cloud is unavailable on this host (needs the Worker API).', 'err');
    }
  }

  // ---- REVIEW QUEUE (2026-08-17, approved "always on") -------------------
  // Owner: list proposals (pending first) into the Review section. Each
  // row shows the source (editor label or MCP AI), proposed time, an
  // expandable before/after diff panel, and Accept / Reject for pending
  // ones; decided rows show their status. Zero-throw.
  function cloudReviewList() { if (ns.CloudReview) ns.CloudReview.cloudReviewList(); }

  // Editor: their own proposal status (pending / accepted / rejected) , the
  // "review list with status" visibility approved for the source side.
  function cloudReviewMine() { if (ns.CloudReview) ns.CloudReview.cloudReviewMine(); }

  // Toggle a proposal's diff panel (mirror of toggleDiffs, review list).
  function reviewToggleDiffs(id) { if (ns.CloudReview) ns.CloudReview.reviewToggleDiffs(id); }

  // Owner: accept a proposal , the scoped merge applies to the cloud
  // snapshot (or the MCP audit row is written), changelog 'accepted'.
  function cloudReviewAccept(id) { if (ns.CloudReview) ns.CloudReview.cloudReviewAccept(id); }

  // Owner: reject a proposal , discarded, changelog 'rejected', no state change.
  function cloudReviewReject(id) { if (ns.CloudReview) ns.CloudReview.cloudReviewReject(id); }

  // ---- copy the just-created editor code (shown-once banner, G23) ---------
  function copyEditorCode(code) { if (ns.CloudReview) ns.CloudReview.copyEditorCode(code); }
  function editorCodeDone() { if (ns.CloudReview) ns.CloudReview.editorCodeDone(); }

  // ---- MASTER-ACTION-PLAN RANK 9.2: webhook management (owner-only) ------
  // Opt-in notification endpoints (off by default , nothing exists until the
  // owner adds one). All three mirror the editor/changelog patterns: owner
  // code in session, fetch, escape, render into a dedicated container.
  function webhookList() { if (ns.CloudWebhooks) ns.CloudWebhooks.webhookList(); }

  function webhookAdd() { if (ns.CloudWebhooks) ns.CloudWebhooks.webhookAdd(); }

  function webhookDel(id) { if (ns.CloudWebhooks) ns.CloudWebhooks.webhookDel(id); }

  // ---- keep the sign-in state fresh after sign-in/sign-out ----------------
  document.addEventListener('mmgr:google-signed-in', function() { _signedIn = true; render(); });
  document.addEventListener('mmgr:google-signed-out', function() { _signedIn = false; render(); });

  // ---- CLOUD-FIRST SYNC: live refresh on save (approved scope) -----------
  // The Presence WebSocket delivers `{type:'rev-changed', revision}` when the
  // main device saves or the admin broadcasts. A REGISTERED copy on this
  // device auto-pulls the fresh snapshot (view-only, so the overwrite is
  // always safe , approved reconcile: copies never fight the cloud). Only
  // viewers auto-pull; an editor with a registered copy pulls manually (their
  // workspace may hold in-flight scoped edits , the manual button pushes
  // local changes up first, then pulls, per the owner's auto-sync-up model).
  // C19: a CLIENT session (no copy record) refreshes via the meta-poll below.
  let _revPullBusy = false;
  document.addEventListener('mmgr:rev-changed', function(ev) {
    if (isClientSession()) { clientPollTick(true); return; }
    const rec = getCopyRecord();
    if (!rec) return; // no copy on this device , nothing to refresh
    if (_revPullBusy) return;
    const escope = getEScope();
    const isView = !!(getECode() && !getCode() && escope && escope.role === 'view');
    if (!isView) { render(); return; } // editor copy: just refresh the box (manual Update)
    _revPullBusy = true;
    cloudUpdateCopy(true).then(function() { _revPullBusy = false; });
  });

  // ---- C19 CLIENT REFRESH CADENCE (C1b, 2026-09-04) ----------------------
  // A client tab is read-only, so the app can silently re-pull when the
  // admin publishes: poll /meta every 60s while the tab is visible + on
  // visibilitychange, and refresh immediately when the presence heartbeat
  // reports rev-changed. When updatedAt advances, re-load the snapshot and
  // reload the workspace (safe: the client never holds local edits).
  let _clientPoll = null;
  function isClientSession() {
    const es = getEScope();
    return !!getECode() && !getCode() && es && es.role === 'client';
  }
  async function clientMetaUpdatedAt() {
    const cred = activeCredential();
    if (!cred) return null;
    try {
      const headers = {};
      headers[cred.header] = cred.code;
      const res = await fetch('/api/cloud/projects/' + encodeURIComponent(pid()) + '/meta', { credentials: 'same-origin', headers: headers });
      const data = await res.json().catch(function() { return {}; });
      return (res.ok && data && data.ok && data.updatedAt) ? data.updatedAt : null;
    } catch (e) { return null; }
  }
  async function clientLoadState() {
    const cred = activeCredential();
    if (!cred) return null;
    try {
      const headers = {};
      headers[cred.header] = cred.code;
      const res = await fetch('/api/cloud/projects/' + encodeURIComponent(pid()) + '/load', { method: 'POST', credentials: 'same-origin', headers: headers, body: JSON.stringify({}) });
      const data = await res.json().catch(function() { return {}; });
      return (res.ok && data && data.ok && data.state) ? data.state : null;
    } catch (e) { return null; }
  }
  async function clientPollTick(force) {
    if (!isClientSession()) return;
    if (!force && document.visibilityState !== 'visible') return;
    const now = await clientMetaUpdatedAt();
    if (!now) return;
    const last = getLastSeen();
    const changed = !!last && now !== last;
    setLastSeen(now);
    if (!changed && !force) return;
    const state = await clientLoadState();
    if (!state) return;
    try { localStorage.setItem('mmgr_state_' + pid(), JSON.stringify(state)); } catch (e) { /* storage blocked — reload would lose nothing */ }
    // Full reload is the honest refresh: read-only workspace, no local edits
    // to lose, and every renderer picks the new state up at boot.
    if (changed) window.location.reload();
  }
  function startClientRefresh() {
    if (!isClientSession() || _clientPoll) return;
    _clientPoll = setInterval(function() { clientPollTick(false); }, 60000);
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible') clientPollTick(false);
    });
    // First tick soon after boot so a code created moments before opening
    // still gets the freshest snapshot without waiting a minute.
    setTimeout(function() { clientPollTick(false); }, 4000);
  }

  // ---- public API ---------------------------------------------------------
  ns.Cloud = {
    render: render,
    createProject: createProject,
    cloudUpgrade: cloudUpgrade,
    cloudResendVerify: cloudResendVerify,
    saveToCloud: saveToCloud,
    autoSaveToCloud: autoSaveToCloud,
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
    _renderDiffPanel: _renderDiffPanelImpl, // test hook (pure string builder, no DOM)
    dropEditor: dropEditor,
    unlinkProject: unlinkProject,
    copyEditorCode: copyEditorCode,
    editorCodeDone: editorCodeDone,
    applyEditorScope: applyEditorScope,
    isSectionBlocked: isSectionBlocked,
    // C19 client-scope helpers: isClientSession() gates the refresh watcher +
    // the render branch; clientFirstSection()/isClientSectionHidden() drive
    // the nav hiding + showSection redirect in js/cloud/scope.js.
    isClientSession: isClientSession,
    clientFirstSection: function() {
      const es = getEScope();
      if (es && Array.isArray(es.sections) && es.sections.length) return es.sections[0];
      return 'dash';
    },
    isClientSectionHidden: function(section) {
      if (!isClientSession()) return false;
      const es = getEScope();
      return !(es && Array.isArray(es.sections) && es.sections.indexOf(section) > -1);
    },
    getCode: getCode,
    getECode: getECode,
    getEScope: getEScope,
    // CLOUD-FIRST SYNC (PART 3, approved 2026-08-17): offline copies +
    // broadcast. cloudMakeCopy registers this device (view-only);
    // cloudUpdateCopy pulls the newest snapshot (silent = live refresh);
    // cloudRemoveCopy unregisters; cloudBroadcast/cloudAutoBroadcast are the
    // owner's manual + automatic broadcast controls; cloudOfflineList feeds
    // the owner's Broadcast UI; cloudOfflineRemove drops one registered copy.
    cloudMakeCopy: cloudMakeCopy,
    cloudUpdateCopy: cloudUpdateCopy,
    cloudRemoveCopy: cloudRemoveCopy,
    cloudBroadcast: cloudBroadcast,
    cloudAutoBroadcast: cloudAutoBroadcast,
    cloudOfflineList: cloudOfflineList,
    cloudOfflineRemove: cloudOfflineRemove,
    // REVIEW QUEUE (2026-08-17, approved "always on"): the owner's review
    // list + accept/reject decisions and the editor's own status view.
    cloudReviewList: cloudReviewList,
    cloudReviewMine: cloudReviewMine,
    cloudReviewAccept: cloudReviewAccept,
    cloudReviewReject: cloudReviewReject,
    reviewToggleDiffs: reviewToggleDiffs,
    // IN-PROJECT DELETE (owner 2026-08-17): Settings > Controls > Danger
    // Zone , confirm modal + password verify + the owner-only soft delete.
    cloudDeleteOpen: cloudDeleteOpen,
    cloudDeleteClose: cloudDeleteClose,
    cloudDeleteConfirm: cloudDeleteConfirm,
    _deviceId: deviceId,
    _getCopyRecord: getCopyRecord,
    // test hooks (qa-cloud-phase1.cjs / qa-cloud-phase2.cjs)
    _pid: pid,
    _readProjectState: readProjectState,
    _probeLoad: probeLoad,
    _normalizeCode: normalizeCode,
    // Internal utilities exposed for extracted modules (js/cloud/*.js)
    _pid: pid,
    _esc: esc,
    _setStatus: setStatus,
    _render: render,
    _listLog: listLog,
    _activeCredential: activeCredential,
    _getSections: function() { return _sections; }
  };

  // Render on boot (App.init calls this too via the guarded hook; the
  // double-call is safe , render is idempotent).
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})(MMGR);
window.MMGR = MMGR;
