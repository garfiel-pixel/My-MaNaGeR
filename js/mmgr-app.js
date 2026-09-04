/* ============================================================
   My MaNaGeR , Application Controller Module
   Initialization, event handlers, drawer, modals, toast,
   keyboard shortcuts, theme, crosshair, methodology learning card.
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const S = () => ns.State.getState();
  const U = ns.Utils;
  const R = ns.Render;

  // ---- Project ID ----
  const urlParams = new URLSearchParams(window.location.search);
  ns.projectId = urlParams.get('id') || localStorage.getItem('mmgr_current_project') || 'default';

  // DEMO VIEW-ONLY: the filled demo project is always read-only.
  if (ns.projectId === 'demo-filled') {
    ns.scope = 'readonly';
  }

  // ---- Access Gate ----
  // Full codes set mmgr_unlocked_<id>='1'. A VIEW-ONLY code (ACTION-PLAN
  // 4.1) sets the same unlock flag PLUS mmgr_scope_<id>='readonly' , the
  // project opens in a reduced, non-editable view. Both paths are
  // client-side localStorage (simulated backend), matching the existing
  // SHA-256 model; the plaintext code never leaves the browser.
  // ---- DIR-1 (ADMIN-PUBLISH-SYNC-AND-PROJECT-SELECT-POLISH): local-first
  // creator access. A project id present in this device's admin working list
  // (localStorage mmgr_admin_projects) is owned HERE , the creator's own
  // access must never depend on the publish/deploy step, which gates only
  // OTHER people's access. Locally-owned projects open with full scope, no
  // code re-entry, even on a deep link straight to project.html.
  // Security note: this is exactly equivalent to the pre-existing ability to
  // set mmgr_unlocked_<id> directly in localStorage , convenience protection
  // for a personal tool, not server-side security (per the admin banner). ----
  function isLocallyOwned(id) {
    try {
      const raw = localStorage.getItem('mmgr_admin_projects');
      if (!raw) return false;
      const list = JSON.parse(raw);
      return Array.isArray(list) && list.some(function(p) { return p && p.id === id; });
    } catch (e) { return false; }
  }

  function checkAccess() {
    const projectId = ns.projectId;
    const locallyOwned = isLocallyOwned(projectId);
    const unlocked = locallyOwned || localStorage.getItem('mmgr_unlocked_' + projectId) === '1';
    if (!unlocked) {
      // The app entry now lives at app.html (index.html is the marketing
      // site). A locked visitor is sent back to the project list + unlock.
      window.location.href = 'app.html?locked=' + encodeURIComponent(projectId);
      return false;
    }
    // If this browser opened the project with a view-only code, drop the
    // app into read-only mode (reduced view). A locally-owned project is
    // always full scope , the creator is never gated by a code they set.
    // Demo projects are always view-only (readonly scope set above must
    // not be overridden by the code-based scope path).
    if (projectId === 'demo-filled') {
      ns.scope = 'readonly';
    } else {
      ns.scope = locallyOwned ? 'full' : (localStorage.getItem('mmgr_scope_' + projectId) === 'readonly' ? 'readonly' : 'full');
    }
    // CLOUD-CODES-AND-DELETE: a cloud VIEWER code (session escope role
    // 'view', set when the code was entered on the launcher or in the Cloud
    // drawer) drops the app into read-only mode from boot , every mutating
    // data-action is refused via READONLY_SAFE_ACTIONS, and the cloud
    // module's applyEditorScope blocks the sections outside the viewer's
    // grant. Reads the same session slot mmgr-cloud.js writes (escopeKey).
    if (ns.scope === 'full') {
      try {
        const es = JSON.parse(sessionStorage.getItem('mmgr_cloud_escope_' + projectId) || 'null');
        if (es && Array.isArray(es.sections) && es.role === 'view') ns.scope = 'readonly';
      } catch (e) { /* ignore */ }
    }
    return true;
  }

  function isReadonly() { return ns.scope === 'readonly'; }

  // PART F T9 (no-offline-copy guarantee): TRUE when this project was opened
  // with a cloud editor/viewer code (session escope role set , the same slot
  // mmgr-cloud.js writes). A recipient must never be able to export the
  // project as an offline-copyable file: the server enforces scope on writes,
  // but export runs entirely client-side, so the UI must refuse it here.
  function cloudCodeHeld() {
    try {
      const es = JSON.parse(sessionStorage.getItem('mmgr_cloud_escope_' + ns.projectId) || 'null');
      return !!(es && (es.role === 'editor' || es.role === 'view'));
    } catch (e) { return false; }
  }
  function cloudExportBlocked(action) {
    // openOM (export modal), cpOut (copy JSON), saveProjectFile (download
    // .json) and driveBackup (writes the workspace to the recipient's own
    // Drive) are the offline-copy surfaces , refused while a share code is
    // held. Everything else proceeds normally.
    if (action !== 'openOM' && action !== 'cpOut' && action !== 'saveProjectFile' && action !== 'driveBackup') return false;
    if (!cloudCodeHeld()) return false;
    if (window.MMGR.App && typeof window.MMGR.App.showToast === 'function') {
      window.MMGR.App.showToast('Shared projects can\u2019t be copied offline. This project was opened with a share code.', 'err');
    }
    return true;
  }

  // ---- Init ----
  // C21: @mention dropdown for task comments
  function initMentionDropdown() {
    let _mentionIdx = -1; // keyboard selection index
    
    function selectMention(input, name) {
      const val = input.value;
      const atIdx = val.lastIndexOf('@');
      if (atIdx > -1) {
        input.value = val.substring(0, atIdx) + '@' + name + ' ';
      }
      input.focus();
      const dropdown = document.getElementById('mention-dropdown');
      if (dropdown) { dropdown.style.display = 'none'; dropdown.innerHTML = ''; }
      _mentionIdx = -1;
    }
    
    function renderMentionItems(dropdown, matches) {
      _mentionIdx = -1;
      // Stakeholder names are user-entered (RACI people) - escape fully so a
      // name containing markup can never inject HTML into the dropdown.
      const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      dropdown.innerHTML = matches.map((n, i) =>
        '<div class="mention-item" role="option" aria-selected="false" style="padding:7px 10px;cursor:pointer;font-size:.75rem;border-bottom:1px solid var(--border);transition:background .1s" data-name="' + esc(n) + '" data-idx="' + i + '">' +
        '<span style="color:var(--gold);font-weight:600">@</span> ' + esc(n) + '</div>'
      ).join('');
    }
    
    document.addEventListener('input', function(e) {
      if (!e.target.id || !e.target.id.startsWith('comment-input-')) return;
      const input = e.target;
      const val = input.value;
      const atIdx = val.lastIndexOf('@');
      const dropdown = document.getElementById('mention-dropdown');
      if (!dropdown) return;

      if (atIdx === -1 || (atIdx > 0 && val[atIdx - 1] !== ' ')) {
        dropdown.style.display = 'none';
        return;
      }

      const query = val.substring(atIdx + 1).toLowerCase();
      const stakeholders = window._mentionStakeholders || [];
      const matches = stakeholders.filter(n => n.toLowerCase().indexOf(query) > -1).slice(0, 8);

      if (!matches.length) {
        dropdown.style.display = 'none';
        return;
      }

      renderMentionItems(dropdown, matches);
      dropdown.style.display = 'block';
    });
    
    // Keyboard navigation (arrow keys + Enter + Escape)
    document.addEventListener('keydown', function(e) {
      if (!e.target.id || !e.target.id.startsWith('comment-input-')) return;
      const dropdown = document.getElementById('mention-dropdown');
      if (!dropdown || dropdown.style.display === 'none') return;
      const items = dropdown.querySelectorAll('.mention-item');
      if (!items.length) return;
      
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        _mentionIdx = Math.min(_mentionIdx + 1, items.length - 1);
        items.forEach((it, i) => {
          // rgba(var(--gold-rgb), .08) - the codebase's established form; the
          // old 'rgba(var(--gold-rgb,.08))' was invalid CSS (missing alpha
          // argument) so the selection highlight never rendered.
          it.style.background = i === _mentionIdx ? 'rgba(var(--gold-rgb), .08)' : '';
          it.setAttribute('aria-selected', i === _mentionIdx ? 'true' : 'false');
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        _mentionIdx = Math.max(_mentionIdx - 1, 0);
        items.forEach((it, i) => {
          it.style.background = i === _mentionIdx ? 'rgba(var(--gold-rgb), .08)' : '';
          it.setAttribute('aria-selected', i === _mentionIdx ? 'true' : 'false');
        });
      } else if (e.key === 'Enter' && _mentionIdx >= 0) {
        e.preventDefault();
        selectMention(e.target, items[_mentionIdx].getAttribute('data-name'));
      } else if (e.key === 'Escape') {
        dropdown.style.display = 'none';
        _mentionIdx = -1;
      }
    });

    document.addEventListener('click', function(e) {
      if (e.target.classList.contains('mention-item')) {
        const name = e.target.getAttribute('data-name');
        const input = e.target.closest('.card') ? e.target.closest('.card').querySelector('input[id^="comment-input-"]') : null;
        if (input && name) selectMention(input, name);
      }
    });

    document.addEventListener('blur', function(e) {
      if (e.target.id && e.target.id.startsWith('comment-input-')) {
        setTimeout(function() {
          const dropdown = document.getElementById('mention-dropdown');
          if (dropdown) { dropdown.style.display = 'none'; _mentionIdx = -1; }
        }, 200);
      }
    }, true);
  }

  function init() {
    if (!checkAccess()) return;

    ns.State.load();

    const s = S();

    // ACTION-PLAN 4.1: view-only scope , reduced read-only view. The body
    // class + banner are the visible state; the delegated event guards below
    // block every mutating data-action, while navigation / Copy All / Print
    // keep working.
    if (isReadonly()) {
      document.body.classList.add('readonly-mode');
      const banner = U.$('readonly-banner');
      if (banner) banner.classList.remove('is-hide');
    }

    // Apply theme: the device-level pref (localStorage mmgr_theme — the same
    // slot the launcher and admin write, and the same slot tglTheme writes) is
    // the MASTER so the choice made anywhere persists everywhere; per-project
    // state.theme is the portable fallback for a fresh device or an imported
    // project file. System mode follows the OS (owner D6, restored 2026-09-03):
    // the FOUC script + mmgr-theme.js already applied the correct class
    // pre-paint, so this block only reconciles the state-theme fallback and
    // must never fight a stored 'system' choice (a stored System + dark OS
    // must stay dark here).
    const thmTgl = U.$('thm-tgl');
    let theme = s.theme || 'light';
    try { theme = localStorage.getItem('mmgr_theme') || theme; } catch (e) { /* ignore */ }
    const dark =
      theme === 'dark' ||
      (theme === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.body.classList.toggle('dark-mode', dark);
    if (thmTgl) thmTgl.checked = !dark;
    // Apply crosshair
    if (s.crosshairOn) {
      document.body.classList.add('crosshair-on');
      const tgl = U.$('ch-tgl');
      if (tgl) tgl.checked = true;
    }
    // Crosshair alignment lines (#cx horizontal, #cy vertical) follow the
    // pointer. Monolith parity: bound once at init, CSS hides the lines when
    // the toggle is off.
    const cxEl = U.$('cx');
    const cyEl = U.$('cy');
    if (cxEl && cyEl) {
      document.addEventListener('mousemove', function(ev) {
        cxEl.style.top = ev.clientY + 'px';
        cyEl.style.left = ev.clientX + 'px';
      });
    }
    // Persisted focus mode (monolith S.focus parity)
    if (s.focusMode) document.body.classList.add('focus-mode');
    // Set user name
    const nameIn = U.$('user-name-in');
    if (nameIn) nameIn.value = s.userName || '';

    // Set work week
    const ww = U.$('ww-sel');
    if (ww) ww.value = s.workWeek || 5;

    // Load charter data
    ns.Charter && ns.Charter.loadCharterData();

    // Load sprint data
    ns.Sprint && ns.Sprint.loadSprintData();

    // Load budget envelope
    const env = U.$('bud-envelope');
    if (env) env.value = s.budgetEnvelope || 0;

    // SIDEBAR-HAMBURGER-TOGGLE-PLAN: build the desktop sidebar (a clone of
    // the .sec-nav groups) BEFORE the first render so the pack/methodology
    // gates land on both navs together; then boot the rail open and install
    // the drawer/sidebar dismiss bindings.
    buildSidebar();
    // OWNER 2026-08-15: the sidebar IS the view on desktop , boot the pinned
    // rail OPEN (body.sidebar-open). Mobile keeps the off-canvas drawer
    // (sidebar-open is never set there, so the scrim can't flash at boot).
    if (window.innerWidth > 768) document.body.classList.add('sidebar-open');
    syncSidebarChrome();
    bindNavDismiss();

    // Initial render
    R.renderAll();
    updateUndoUi();

    // DIR-2 (PROJECT-UX-NAV-WEATHER-EXPORT-DIRECTIVE): measure the header so
    // the sticky section nav sits exactly below it; re-measure on resize (the
    // header wraps on narrow screens).
    if (ns.Viewport && ns.Viewport.syncHeaderStack) {
      ns.Viewport.syncHeaderStack();
      window.addEventListener('resize', function() { ns.Viewport.syncHeaderStack(); });
    }

    // Phase 2: hook the client error surface (window error + unhandledrejection)
    if (ns.Errors && ns.Errors.hookGlobals) ns.Errors.hookGlobals();

    // Rank 4.2: crash-durability journal restore , if the IndexedDB journal
    // holds a NEWER state than localStorage (a hard kill happened mid-edit),
    // adopt it and re-render. Async best-effort; never blocks first paint.
    ns.State.restoreFromJournal().then(function(restored) {
      if (restored) R.renderAll();
    });

    // Populate weather region selector + set current value
    const regSel = U.$('weather-region-sel');
    if (regSel && ns.Weather && ns.Weather.getRegions) {
      regSel.innerHTML = ns.Weather.getRegions().map(r =>
        '<option value="' + r.id + '"' + (r.id === (s.weatherRegion || 'northern-temperate') ? ' selected' : '') + '>' + U.escapeHtml(r.name) + '</option>'
      ).join('');
    }

    // Live dirty indicator: any state change (typing, toggles, imports)
    // updates the header badge immediately without a full re-render.
    ns.State.onChange(function() { R.renderDirtyIndicator(); });

    // OWNER 2026-08-15: background cloud auto-sync , once the user goes
    // idle (~25s), a cloud-linked project's snapshot is pushed silently so
    // the header's green "Cloud backed up" chip stays honest. No-op for
    // unlinked / editor-only / readonly projects (Cloud.autoSaveToCloud
    // guards on the owner credential). The timer resets on every edit.
    ns.State.onChange(function() { scheduleCloudAutoSave(); });

    // Multi-tab conflict detection: storage events fire in OTHER tabs, so
    // this tab is notified whenever a peer overwrites the shared key.
    window.addEventListener('storage', function(e) {
      if (!ns.State.getProjectKey || e.key !== ns.State.getProjectKey() || !e.newValue) return;
      try {
        onExternalChange(JSON.parse(e.newValue));
      } catch(err) {
        console.warn('External change parse failed:', err);
      }
    });

    // Hide the boot loading skeleton after first paint of the real UI
    const splash = U.$('boot-splash');
    if (splash) {
      requestAnimationFrame(() => splash.classList.add('off'));
    }

    // C21: @mention dropdown
    initMentionDropdown();

    // Keyboard shortcuts
    document.addEventListener('keydown', function(e) {
      // Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z redo (not inside text inputs,
      // where the browser owns undo).
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        const inInput = e.target.closest && e.target.closest('input,textarea,select');
        if (!inInput) {
          e.preventDefault();
          if (e.shiftKey) { redo(); } else { undo(); }
          return;
        }
      }
      if (e.key === 'f' || e.key === 'F') {
        // e.target can be the document node (no closest) when nothing has
        // focus , guard so the shortcut never throws.
        const inInput = e.target.closest && e.target.closest('input,textarea,select');
        if (!e.ctrlKey && !e.metaKey && !inInput) {
          e.preventDefault();
          tglFocusMode();
        }
      }
      if (e.key === 'Escape') {
        closeDrw();
        closeOM();
        closeModals();
        if (ns.Bids && ns.Bids.closeBidPkgModal) ns.Bids.closeBidPkgModal();
        if (ns.Charter) { ns.Charter.closeChartUp(); }
        if (ns.WbsImport) { ns.WbsImport.closeWbsImport(); }
        if (ns.ImportDates) { ns.ImportDates.closeImportDates(); }
        if (ns.AiWin) { ns.AiWin.close(); }
      }
    });

    // PLAN-OF-ACTION-LIQUID-GLASS-UI 3.5.2/3.5.4: apply the glass engine on
    // boot if the device preference + capability floor allow it. Also sync
    // the settings toggle's checked state to the stored preference. The
    // engine is dynamically imported and only then , zero cost otherwise.
    if (ns.Viewport && ns.Viewport.getGlassMode) {
      const gt = U.$('glass-tgl');
      if (gt) gt.checked = ns.Viewport.getGlassMode() === 'premium';
    }
    if (ns.Glass && ns.Glass.sync) ns.Glass.sync();

    // DIR-1b: reflect the device-level remote-error-reporting preference
    // (localStorage slot, like the glass mode toggle above , never project
    // state) into the Controls drawer controls on boot.
    if (ns.Errors && ns.Errors.getReportCfg) {
      const rc = ns.Errors.getReportCfg();
      const rt = U.$('err-report-tgl');
      if (rt) rt.checked = !!rc.enabled;
      const rw = U.$('err-webhook');
      if (rw && rw.value !== rc.url) rw.value = rc.url;
    }

    // Rank 4.5: render the optional sync identity section (device label,
    // never a gate) into the Controls drawer.
    if (ns.Sync && ns.Sync.renderSyncSection) ns.Sync.renderSyncSection();

    // GOOGLE-DRIVE-BACKUP: render the optional Drive backup/restore section
    // into the Controls drawer (project.html only , app.html uses its
    // auth-bar controls). Same zero-throw guard as the sync section above.
    if (ns.GoogleAuth && ns.GoogleAuth.renderDriveSection) ns.GoogleAuth.renderDriveSection();

    // CLOUD-BACKEND-ARCHITECTURE-PLAN Phase 1: render the optional Cloud
    // Backup (D1 + R2 owner-code storage) section into the Controls drawer.
    // Strictly additive and never gating , the module no-ops without
    // #cloud-section (project.html only), and the Worker API absence degrades
    // to a quiet "unavailable here" note.
    if (ns.Cloud && ns.Cloud.render) ns.Cloud.render();

    // Run validation
    const issues = ns.State.validate();
    if (issues.length > 0) {
      console.warn('State validation issues:', issues);
    }

    console.log('My MaNaGeR initialized. Project:', ns.projectId, '| Schema v' + ns.State.SCHEMA_VERSION);
  }

  // ---- Theme & Settings ----
  function setUserName(name) {
    ns.State.updateState(function(s) { s.userName = name; });
    R.renderGreeting();
  }

  function tglTheme() {
    const tgl = U.$('thm-tgl');
    const isLight = tgl ? tgl.checked : S().theme !== 'dark';
    const theme = isLight ? 'light' : 'dark';
    document.body.classList.toggle('dark-mode', !isLight);
    // Device-level preference (shared slot with the launcher + admin): the
    // choice persists across every page. state.theme stays in step so the
    // portable export still carries the theme for fresh devices , but that
    // project-state write is skipped in view-only (a read-only scope must not
    // mutate project state; the device pref + body class are enough there).
    try { localStorage.setItem('mmgr_theme', theme); } catch (e) { /* ignore */ }
    if (!isReadonly()) ns.State.updateState(function(s) { s.theme = theme; });
    // Rank 3.5: keep the premium glass shader's dark flag in step with the
    // theme (a toggle between light/dark must not leave a stale backdrop).
    if (ns.Glass && ns.Glass.refreshTheme) ns.Glass.refreshTheme();
  }

  // ---- PLAN-OF-ACTION-LIQUID-GLASS-UI 3.5.3: Premium visual mode toggle ----
  // A single, clearly-labeled settings toggle, off by default, persisted to
  // the shared device-preference slot (localStorage , NOT project state, so
  // it can never travel in the .json export). Never a popup or forced
  // prompt. The capability floor (Viewport.effectiveGlassMode) overrides the
  // stored preference: a low-end device stays on CSS glass no matter what.
  function tglGlassMode() {
    const tgl = U.$('glass-tgl');
    const on = tgl ? tgl.checked : false;
    if (ns.Viewport) ns.Viewport.setGlassMode(on ? 'premium' : 'css');
    if (ns.Glass) ns.Glass.sync();
    const effective = (ns.Viewport && ns.Viewport.effectiveGlassMode) ? ns.Viewport.effectiveGlassMode() : 'css';
    showToast(on
      ? (effective === 'premium' ? 'Premium visual mode on , liquid-glass backdrop active.' : 'Preference saved , this device uses CSS glass (capability floor).')
      : 'Premium visual mode off , CSS glass stays on.',
      effective === 'premium' ? 'ok' : 'warn');
  }

  // ---- THEME-SYSTEM-AND-MOBILE-UI-ACTION-PLAN §4.2: mobile nav drawer ----
  // Hamburger + scrim toggle body.nav-open, which slides the .sec-nav off-canvas
  // drawer in/out on ≤768px (desktop ignores the class , the nav stays sticky).
  // BUG-9: on desktop, the hamburger opens the #app-sidebar overlay instead.
  // The drawer closes on: scrim tap (same action), any section button, Escape,
  // and a viewport resize back to desktop width.
  let _navBound = false;
  function closeNav() {
    document.body.classList.remove('nav-open');
    // OWNER 2026-08-15: on desktop the sidebar is the pinned primary nav , 
    // section clicks do NOT close it (only the hamburger / Escape does).
    const btn = U.$('nav-btn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }
  // Dismiss bindings are installed once at init (not lazily on first click),
  // so Escape/resize/section-click always close the drawer AND the desktop
  // sidebar overlay even when the pref opened the sidebar at boot without a click.
  function bindNavDismiss() {
    if (_navBound) return;
    _navBound = true;
    document.addEventListener('click', function (e) {
      const t = e.target;
      // Section buttons close the mobile drawer; on desktop the pinned rail
      // stays open (the hamburger is its close control).
      if (t && t.closest && t.closest('.sec-btn')) closeNav();
      // Outside-click closes the backup popover (not on the indicator itself
      // or anything inside the popover).
      const pop = U.$('bk-pop');
      if (pop && !pop.hidden && !(t && t.closest && (t.closest('#bk-pop') || t.closest('#dirty-ind')))) bkClose();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      closeNav();
      bkClose();
      // Escape also closes the desktop pinned rail , full-screen work, the
      // hamburger reopens it.
      if (window.innerWidth > 768 && document.body.classList.contains('sidebar-open')) setSidebarOpen(false);
    });
    window.addEventListener('resize', function () {
      closeNav();
      syncSidebarChrome();
    });
  }
  // The one hamburger drives both navigations by viewport: ≤768px the mobile
  // off-canvas drawer (body.nav-open), desktop the overlay sidebar (BUG-9:
  // always available, no pref gate , the overlay is transient, not pinned).
  function tglNav() {
    bindNavDismiss();
    const btn = U.$('nav-btn');
    if (window.innerWidth <= 768) {
      const open = document.body.classList.toggle('nav-open');
      if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      // BUG-10: the mobile off-canvas drawer is the same overflow scroll
      // container as the desktop sidebar , reset it to the top on open too,
      // so the first section is always the first thing visible.
      if (open) {
        const nav = U.$('sec-nav');
        if (nav) nav.scrollTop = 0;
      }
      return;
    }
    // BUG-9: desktop always toggles the overlay sidebar (no pref check).
    setSidebarOpen(!document.body.classList.contains('sidebar-open'));
  }

  // ---- SIDEBAR-HAMBURGER-TOGGLE-PLAN (2026-08-12): opt-in desktop sidebar ----
  // A fixed left rail (~240px) that mirrors the horizontal .sec-nav groups.
  // It is a DEVICE preference (localStorage mmgr_sidebar = 'on'|'off', default
  // 'off' , current users see zero change until they opt in), persisted to the
  // same session-gated R2 prefs blob as the theme (worker.js /api/cloud/prefs/
  // theme gains a sidebar field) so a signed-in account's layout follows across
  // devices. The sidebar itself is desktop-only (≤768px the existing .sec-nav
  // drawer remains the only mobile nav). Pure device-UI chrome , never project
  // state, safe in view-only mode.
  const SIDEBAR_KEY = 'mmgr_sidebar';
  let _sidebarUserTouched = false;

  // ---- Sidebar delegation shims (extracted to js/app/sidebar.js) ----
  function readDevicePref(key) { return ns.AppSidebar ? ns.AppSidebar.readDevicePref(key) : null; }
  function writeDevicePref(key, v) { if (ns.AppSidebar) ns.AppSidebar.writeDevicePref(key, v); }
  function sidebarEnabled() { return true; }
  function syncSidebarChrome() { if (ns.AppSidebar) ns.AppSidebar.syncSidebarChrome(); }
  function setSidebarOpen(open) { if (ns.AppSidebar) ns.AppSidebar.setSidebarOpen(open); }
  function toggleSidebar() { if (ns.AppSidebar) ns.AppSidebar.toggleSidebar(); }
  function pushSidebarBackend(on) { if (ns.AppSidebar) ns.AppSidebar.pushSidebarBackend(on); }
  function pullSidebarBackend() { if (ns.AppSidebar) ns.AppSidebar.pullSidebarBackend(); }
  function buildSidebar() { if (ns.AppSidebar) ns.AppSidebar.buildSidebar(); }


  // ---- PLAN-OF-ACTION-AI-VOICE-SYNC-v1 4.5: optional Google identity ----
  function syncConnect() {
    if (ns.Sync && ns.Sync.connect) ns.Sync.connect();
  }
  function syncSignOut() {
    if (ns.Sync && ns.Sync.signOut) ns.Sync.signOut();
  }
  function syncClientId(el) {
    if (ns.Sync && ns.Sync.setClientId) ns.Sync.setClientId(el);
  }
  function syncDismissSuggest() {
    if (ns.Sync && ns.Sync.dismissSuggestion) ns.Sync.dismissSuggestion();
  }

  function tglCh() {
    const tgl = U.$('ch-tgl');
    const on = tgl && tgl.checked;
    document.body.classList.toggle('crosshair-on', on);
    ns.State.updateState(function(s) { s.crosshairOn = on; });
  }

  // ---- Phase 2: feature flags ----
  // Checkbox-driven (same contract as theme/crosshair): Chrome toggles
  // `checked` before the handler runs, so read it as-is and let the native
  // toggle stand. state.flags drives the Controls-drawer chips and the
  // render-side UI gating (renderFlags in mmgr-render.js).
  function tglFlag(el) {
    const flag = el.getAttribute('data-flag');
    if (!flag) return;
    const on = el.type === 'checkbox' ? el.checked : (S().flags && S().flags[flag] !== false);
    ns.State.updateState(function(s) {
      if (!s.flags || typeof s.flags !== 'object') s.flags = {};
      s.flags[flag] = on;
    });
    R.renderAll();
  }

  // ---- Phase 2: client error surface ----
  function clearErrorLog() {
    if (ns.Errors && ns.Errors.clear) ns.Errors.clear();
    showToast('Error log cleared.', 'ok');
  }

  // ---- DIR-1a: error log export (Copy / Download) ----
  // Consumes ns.Errors.getLog() , the single data source. Plain-text format
  // matches the drawer's ts / action / msg columns. Zero network calls.
  function errLogText() {
    // Single source of truth: ns.Errors.formatEntry shares the drawer's ts
    // formatter (mmgr-errors.js fmtTs), so the exported log can never drift
    // from the on-screen log.
    const entries = (ns.Errors && ns.Errors.getLog) ? ns.Errors.getLog() : [];
    const fmt = (ns.Errors && ns.Errors.formatEntry) ? ns.Errors.formatEntry : function(en) { return String(en.msg); };
    return entries.map(fmt).join('\n');
  }

  async function copyErrorLog() {
    const text = errLogText();
    if (!text) { showToast('Error log is empty.', 'warn'); return; }
    // U.copyToClipboard never rejects (clipboard API + execCommand fallback
    // both resolve true), so no catch is needed , a successful copy is the
    // only path that reaches the success toast.
    await U.copyToClipboard(text);
    showToast('Error log copied.', 'ok');
  }

  function downloadErrorLog() {
    const text = errLogText();
    if (!text) { showToast('Error log is empty.', 'warn'); return; }
    try {
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'mymanager-error-log-' + new Date().toISOString().slice(0, 10) + '.txt';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function() { URL.revokeObjectURL(a.href); }, 400);
      showToast('Error log downloaded.', 'ok');
    } catch (e) {
      showToast('Could not download the error log.', 'err');
    }
  }

  // ---- MASTER-ACTION-PLAN Rank 6.1: Report Issue (sanitized) ----
  // Zero-network diagnostic package (js/mmgr-report.js). The payload is
  // COUNTS-ONLY by default , budget figures, risk descriptions, and names
  // are never included (hard rule from the plan). The Include-project-
  // context toggle opts THIS report in to names + budget totals; the pref
  // is session-only and each report defaults back to sanitized on reload.
  let _reportCtx = false;

  function tglReportContext() {
    const tgl = U.$('report-ctx-tgl');
    _reportCtx = tgl ? tgl.checked : false;
    showToast(_reportCtx
      ? 'Report will include project context (names + budget totals).'
      : 'Report is counts-only (sanitized).', _reportCtx ? 'warn' : 'ok');
  }

  async function reportIssueCopy() {
    if (!ns.Report || typeof ns.Report.copyPackage !== 'function') { showToast('Report module unavailable.', 'err'); return; }
    const ok = await ns.Report.copyPackage(_reportCtx);
    showToast(ok ? 'Report copied , paste it wherever you file the issue.' : 'Could not copy the report.', ok ? 'ok' : 'err');
  }

  function reportIssueDownload() {
    if (!ns.Report || typeof ns.Report.downloadPackage !== 'function') { showToast('Report module unavailable.', 'err'); return; }
    showToast(ns.Report.downloadPackage(_reportCtx) ? 'Report downloaded.' : 'Could not download the report.', 'ok');
  }

  // ---- DIR-1b: opt-in remote error reporting ----
  // Device-level preference (localStorage, never project state), off by
  // default. The actual POST lives in mmgr-errors.js (routed through
  // MMGR.Net's circuit-breaker). These handlers only move the toggle/URL.
  function tglErrReport() {
    const tgl = U.$('err-report-tgl');
    const on = tgl ? tgl.checked : false;
    if (ns.Errors && ns.Errors.setReportCfg) ns.Errors.setReportCfg({ enabled: on });
    showToast(on
      ? 'Remote error reporting ON , new errors are posted to your webhook.'
      : 'Remote error reporting OFF , errors stay on this device only.',
      on ? 'ok' : 'warn');
  }

  function setErrWebhook(el) {
    if (ns.Errors && ns.Errors.setReportCfg) ns.Errors.setReportCfg({ url: el.value });
  }

  function tglLock() {
    ns.State.updateState(function(s) { s.methodologyLocked = !s.methodologyLocked; });
    R.renderLock();
  }

  function setWorkWeek(val) {
    ns.State.updateState(function(s) { s.workWeek = parseInt(val) || 5; });
  }

  // ---- Methodology ----
  function swMeth(meth, btn) {
    const s = S();
    if (s && s.methodologyLocked) {
      showToast('Methodology is locked. Unlock in Controls to switch.', 'err');
      return;
    }
    ns.State.updateState(function(state) { state.methodology = meth; });
    R.renderMethodology();
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
  }

  // ---- Sections ----
  function showSec(section, btn) {
    R.showSection(section, btn);
  }

  // ---- Focus Mode ----
  function tglFocusMode() {
    // Monolith parity: the focus state persists so a hard refresh keeps the
    // focused workspace (S.focus in the monolith).
    ns.State.updateState(function(s) { s.focusMode = !s.focusMode; });
    document.body.classList.toggle('focus-mode', !!S().focusMode);
  }

  // ---- Drawer ----
  function openDrw() {
    const drw = U.$('drw');
    if (drw) drw.classList.add('open');
  }

  function closeDrw() {
    const drw = U.$('drw');
    if (drw) drw.classList.remove('open');
  }

  function swDtab(tab, btn) {
    document.querySelectorAll('.dtab').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    ['feat', 'qa', 'prompt', 'ctrl'].forEach(t => {
      const el = U.$('db-' + t);
      if (el) el.classList.toggle('is-hide', t !== tab);
    });
  }

  // DIR-3 (PROJECT-UX-NAV-WEATHER-EXPORT-DIRECTIVE): jump the user straight
  // to the Advanced Packs toggles , open the Controls drawer, switch to the
  // Controls tab (the packs live there), and bring the section into view.
  // Instant scroll (behavior 'auto'): zero motion, motion-preference safe.
  function openPacks() {
    openDrw();
    swDtab('ctrl', document.querySelector('.dtab[data-tab="ctrl"]'));
    const el = U.$('adv-packs-section');
    if (el) {
      requestAnimationFrame(function() {
        try { el.scrollIntoView({ block: 'center', behavior: 'auto' }); }
        catch (e) { el.scrollIntoView(); }
        // Keyboard users land on a focused control, not a blind tab-through.
        const firstPack = U.$('pk-schedule');
        if (firstPack) { try { firstPack.focus({ preventScroll: true }); } catch (e2) { /* ignore */ } }
      });
    }
  }

  // DIR-3: dismiss the Core-Mode nudge forever for this project.
  function dismissPacksCallout() {
    ns.State.updateState(function(s) { s.packsCalloutDismissed = true; });
    if (ns.Render && ns.Render.renderCoreCallout) ns.Render.renderCoreCallout();
  }

  // ---- Toast ----
  // Owner directive 2026-08-15: notifications are polished pills, not plain
  // rectangles , circular border, tinted circular icon tile (check-circle /
  // x / alert-triangle), one-word label (Done / Error / Note), full-contrast
  // message, slide-up + hold + graceful fade-out. Shared markup + the .toast
  // CSS in css/mmgr.css (same as app.html / admin.html) , one look everywhere.
  // DELEGATE: real implementation lives in js/app/components.js (MMGR.Components.showToast).
  // This one-liner keeps the local call-site unchanged while the monolith shrinks.
  function showToast(msg, type, action) {
    if (window.MMGR && MMGR.Components && MMGR.Components.showToast) { MMGR.Components.showToast(msg, type, action); }
  }

  // ---- Methodology Learning Card ----
  let mlcTimer = null;
  const MLC_DATA = {
    waterfall: {
      title: 'Waterfall Methodology',
      body: 'A linear, sequential approach where each phase must be completed before the next begins. Best for construction, manufacturing, and regulated environments where requirements are stable and changes are costly.',
      when: 'Best for: Fixed-price contracts, regulatory projects, and any project where the full scope is known upfront.',
      example: 'Example: Building a bridge , design must be approved before steel is ordered, and steel must arrive before erection begins.'
    },
    agile: {
      title: 'Agile Methodology',
      body: 'An iterative approach that delivers work in small, time-boxed increments called sprints. Best for software, product development, and environments where requirements evolve rapidly.',
      when: 'Best for: Projects with evolving requirements, innovation work, and teams that benefit from rapid feedback loops.',
      example: 'Example: Developing a mobile app , each 2-week sprint delivers a working feature set that users can test and provide feedback on.'
    },
    hybrid: {
      title: 'Hybrid Methodology',
      body: 'Combines the structure of Waterfall (planning, design, governance) with the flexibility of Agile (iterative delivery, continuous improvement). Best for complex projects that need both certainty and adaptability.',
      when: 'Best for: Large-scale digital transformations, capital projects with software components, and any project where parts are well-defined and parts are exploratory.',
      example: 'Example: A factory automation project , the physical layout and equipment procurement follow Waterfall, while the control software is developed in Agile sprints.'
    }
  };

  function showMLC(meth) {
    const data = MLC_DATA[meth];
    if (!data) return;
    const card = U.$('meth-learn-card');
    if (!card) return;
    U.$('mlc-title').textContent = data.title;
    U.$('mlc-body').textContent = data.body;
    U.$('mlc-when').textContent = data.when;
    U.$('mlc-example').textContent = data.example;
    card.classList.remove('is-hide');
  }

  function closeMLC() {
    const card = U.$('meth-learn-card');
    if (card) card.classList.add('is-hide');
  }

  function scheduleMLCClose() {
    if (mlcTimer) clearTimeout(mlcTimer);
    mlcTimer = setTimeout(closeMLC, 500);
  }

  function clearMlcTimer() {
    if (mlcTimer) clearTimeout(mlcTimer);
  }

  // ---- Copy All / Export Text ---- (extracted to js/app/copy-text.js)
  function cpAllPage(section) { if (ns.AppCopy) ns.AppCopy.cpAllPage(section); }
  function buildDigest(s) { return ns.AppCopy ? ns.AppCopy.buildDigest(s) : ''; }
  function copyAsText(kind) { return ns.AppCopy ? ns.AppCopy.copyAsText(kind) : ''; }
  function renderCtrlPreviews() { if (ns.AppCopy) ns.AppCopy.renderCtrlPreviews(); }
  function cpFormats(kind) { if (ns.AppCopy) ns.AppCopy.cpFormats(kind); }
  function emailTplText(kind) { return ns.AppCopy ? ns.AppCopy.emailTplText(kind) : ''; }
  function emailTpl(kind) { if (ns.AppCopy) ns.AppCopy.emailTpl(kind); }

  // ---- 5.2 Definitions tooltips ---- (extracted to js/app/definitions.js)
  function defTipFor(term) { return ns.AppDefs && ns.AppDefs.defTipFor ? ns.AppDefs.defTipFor(term) : null; }
  function showDefTip(el, term) { if (ns.AppDefs && ns.AppDefs.showDefTip) ns.AppDefs.showDefTip(el, term); }
  function hideDefTip() { if (ns.AppDefs && ns.AppDefs.hideDefTip) ns.AppDefs.hideDefTip(); }

  // ---- 5.x Gantt high-res PNG export ----
  // Renders the CURRENT schedule to an offscreen 2x canvas (bars + critical
  // path gold + weather-exposed hatching + baseline overlay + weekday
  // header) and downloads it as a large print-ready PNG. Client-side only;
  // no server, no external library.
  function exportGanttPNG() {
    const s = ns.State.getState();
    const tasks = (s.tasks || []).filter(t => t.startDate && t.endDate);
    if (!tasks.length) { showToast('No dated tasks to export.', 'err'); return; }
    let minDate = null, maxDate = null;
    tasks.forEach(t => {
      if (!minDate || t.startDate < minDate) minDate = t.startDate;
      if (!maxDate || t.endDate > maxDate) maxDate = t.endDate;
    });
    const dayWidth = 14, rowH = 26, headerH = 40, padL = 180, padR = 20, padT = 16, padB = 24;
    const totalDays = U.daysBetween(minDate, maxDate) + 1;
    const W = padL + totalDays * dayWidth + padR;
    const H = padT + headerH + tasks.length * rowH + padB;
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = W * scale; canvas.height = H * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    // Background
    ctx.fillStyle = '#0e1116'; ctx.fillRect(0, 0, W, H);
    // Header + weekday labels
    ctx.fillStyle = '#f1f5f9'; ctx.font = '700 11px sans-serif';
    ctx.fillText((s.projectName || 'Project') + ' , Schedule Export', padL, padT + 12);
    ctx.font = '10px sans-serif'; ctx.fillStyle = '#94a3b8';
    for (let i = 0; i < totalDays; i++) {
      const d = U.addDays(minDate, i);
      const x = padL + i * dayWidth;
      if (d.getDay() === 1) { ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fillRect(x, padT + headerH - 20, dayWidth, tasks.length * rowH + 20); ctx.fillStyle = '#94a3b8'; }
      ctx.fillText(String(d.getDate()), x + 1, padT + headerH - 6);
    }
    // Baseline overlay bars
    const baseMap = {};
    if (s.baseline && s.baseline.tasks) (s.baseline.tasks || []).forEach(bt => { baseMap[bt.id] = bt; });
    tasks.forEach((t, ri) => {
      const y = padT + headerH + ri * rowH;
      const x0 = padL + U.daysBetween(minDate, t.startDate) * dayWidth;
      const bw = Math.max(1, U.daysBetween(t.startDate, t.endDate)) * dayWidth;
      // Task label
      ctx.fillStyle = '#e2e8f0'; ctx.font = '600 10px sans-serif';
      ctx.fillText(U.escapeHtml ? t.name : t.name, 8, y + rowH / 2 + 3);
      // Baseline (grey underlay)
      const bt = baseMap[t.id];
      if (bt && bt.startDate && bt.endDate) {
        const bx = padL + U.daysBetween(minDate, bt.startDate) * dayWidth;
        const bww = Math.max(1, U.daysBetween(bt.startDate, bt.endDate)) * dayWidth;
        ctx.fillStyle = 'rgba(148,163,184,.35)'; ctx.fillRect(bx, y + 3, bww, rowH - 10);
      }
      // Weather hatching on exposed bars
      if (t.weatherExposed) {
        ctx.fillStyle = 'rgba(56,189,248,.25)';
        ctx.fillRect(x0, y, bw, rowH);
        ctx.strokeStyle = 'rgba(56,189,248,.8)'; ctx.lineWidth = 1;
        for (let hx = x0; hx < x0 + bw; hx += 7) { ctx.beginPath(); ctx.moveTo(hx, y); ctx.lineTo(hx + 7, y + rowH); ctx.stroke(); }
      }
      // Bar color by status
      const col = t.critical ? '#d4af37' : t.status === 'completed' ? '#009b3a' : U.isOverdue(t.endDate) && t.status !== 'completed' ? '#dc3545' : U.isDueSoon(t.endDate, 3) && t.status !== 'completed' ? '#f59e0b' : '#3b82f6';
      ctx.fillStyle = col;
      ctx.fillRect(x0, y + (t.critical ? 0 : 4), bw, rowH - (t.critical ? 0 : 8));
      if (t.critical) { ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1; ctx.strokeRect(x0 + .5, y + .5, bw - 1, rowH - 1); }
    });
    // Legend
    ctx.font = '9px sans-serif';
    const legend = [['#d4af37', 'Critical'], ['#3b82f6', 'Task'], ['#009b3a', 'Done'], ['#f59e0b', 'Due soon'], ['#dc3545', 'Overdue'], ['rgba(56,189,248,.6)', 'Weather-exposed'], ['rgba(148,163,184,.5)', 'Baseline']];
    let lx = padL;
    legend.forEach(l => {
      ctx.fillStyle = l[0]; ctx.fillRect(lx, H - 18, 12, 10);
      ctx.fillStyle = '#94a3b8'; ctx.fillText(l[1], lx + 15, H - 9);
      lx += 18 + ctx.measureText(l[1]).width + 16;
    });
    canvas.toBlob(function(blob) {
      if (!blob) { showToast('Export failed.', 'err'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (s.projectName || 'project').replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '-gantt-' + new Date().toISOString().slice(0, 10) + '.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){ URL.revokeObjectURL(a.href); }, 400);
      showToast('High-res Gantt exported (PNG).', 'ok');
    }, 'image/png');
  }

  // ---- Weather actions ---- (extracted to js/app/weather.js)
  async function wxGeocode() { if (ns.AppWeather) ns.AppWeather.wxGeocode(); }
  async function wxRefresh() { if (ns.AppWeather) ns.AppWeather.wxRefresh(); }
  async function wxUseLocation() { if (ns.AppWeather) ns.AppWeather.wxUseLocation(); }
  function wxLogToday() { if (ns.AppWeather) ns.AppWeather.wxLogToday(); }
  function wxLogManual() { if (ns.AppWeather) ns.AppWeather.wxLogManual(); }
  function wxCopyNotice() { if (ns.AppWeather) ns.AppWeather.wxCopyNotice(); }
  function wxSetView(el) { if (ns.AppWeather) ns.AppWeather.wxSetView(el); }
  function wxDelLogEntry(el) { if (ns.AppWeather) ns.AppWeather.wxDelLogEntry(el); }

  // ---- Hold / Clear / Undo / Redo ---- (extracted to js/app/history.js)
  function startHold(section) { if (ns.AppHistory) ns.AppHistory.startHold(section); }
  function cancelHold() { if (ns.AppHistory) ns.AppHistory.cancelHold(); }
  function clearSection(section) { if (ns.AppHistory) ns.AppHistory.clearSection(section); }
  function undoClr() { if (ns.AppHistory) ns.AppHistory.undoClr(); }
  function undo() { if (ns.AppHistory) ns.AppHistory.undo(); }
  function redo() { if (ns.AppHistory) ns.AppHistory.redo(); }
  function updateUndoUi() { if (ns.AppHistory) ns.AppHistory.updateUndoUi(); }

  // ---- Weather Region ---- (extracted to js/app/weather.js)
  function setRegion(val) { if (ns.AppWeather && ns.AppWeather.setRegion) ns.AppWeather.setRegion(val); }

  // ---- Confirmation Dialog (replaces bare confirm() for destructive ops) ----
  // ---- Confirmation Dialog ---- (extracted to js/app/confirm.js)
  function askConfirm(opts) { if (ns.AppConfirm) ns.AppConfirm.askConfirm(opts); }
  function cfmOk() { if (ns.AppConfirm) ns.AppConfirm.cfmOk(); }
  function cfmCancel() { if (ns.AppConfirm) ns.AppConfirm.cfmCancel(); }

  // ---- Multi-tab Conflict Resolution ----
  let _pendingExternal = null;
  function onExternalChange(parsed) {
    const s = S();
    if (!parsed || !s || !parsed.updatedAt) return;
    if (parsed.updatedAt <= s.updatedAt) return; // not newer , ignore
    if (JSON.stringify(parsed) === JSON.stringify(s)) return; // same content
    _pendingExternal = parsed;
    const modal = U.$('conflict-modal');
    if (modal) {
      const info = U.$('conflict-info');
      if (info) {
        info.textContent = 'Another tab saved a newer version of this project (' +
          new Date(parsed.updatedAt).toLocaleString() +
          '). Keep your current edits, or load their version.';
      }
      modal.classList.add('on');
    }
  }

  function keepMine() {
    const modal = U.$('conflict-modal');
    if (modal) modal.classList.remove('on');
    _pendingExternal = null;
    ns.State.save(true); // re-persist ours with a fresh updatedAt
    showToast('Kept your version.', 'ok');
  }

  function keepTheirs() {
    const modal = U.$('conflict-modal');
    if (modal) modal.classList.remove('on');
    const incoming = _pendingExternal;
    _pendingExternal = null;
    if (incoming && ns.State.adoptExternal(incoming)) {
      R.renderAll();
      if (ns.Charter) ns.Charter.loadCharterData();
      if (ns.Sprint) ns.Sprint.loadSprintData();
      showToast('Loaded the other tab\'s version.', 'ok');
    }
  }

  // Close every custom modal we own (Escape key path).
  // (extracted to js/app/confirm.js)
  function closeModals() { if (ns.AppConfirm) ns.AppConfirm.closeModals(); }

  // ---- Baseline Restore (undoable) ----
  function restoreBaseline() {
    const s = S();
    if (!s || !s.baseline || !s.baseline.tasks || !s.baseline.tasks.length) {
      showToast('No baseline saved.', 'err');
      return;
    }
    askConfirm({
      title: 'Restore Baseline?',
      message: 'This copies the baseline start/end dates, durations and statuses back onto the current task list.',
      danger: true,
      confirmLabel: 'Restore Baseline',
      onOk: function() {
        ns.State.pushUndo();
        ns.State.updateState(function(state) {
          const baseMap = {};
          (state.baseline.tasks || []).forEach(bt => { baseMap[bt.id] = bt; });
          (state.tasks || []).forEach(t => {
            const bt = baseMap[t.id];
            if (bt) {
              t.startDate = bt.startDate;
              t.endDate = bt.endDate;
              t.duration = bt.duration;
              if (bt.status) t.status = bt.status;
            }
          });
        });
        R.renderWbs();
        R.renderGantt();
        R.renderKanban();
        R.renderDash();
        showToast('Baseline restored.', 'ok');
        updateUndoUi();
      }
    });
  }

  // ---- Gantt (delegated) ----
  function cascadeGantt() {
    if (ns.Schedule && ns.Schedule.cascade) {
      // cascade() toasts its own outcomes and may show a confirmation dialog
      ns.Schedule.cascade();
    } else {
      R.renderGantt();
      showToast('Gantt refreshed.', 'ok');
    }
  }

  function toggleCritical(btn) {
    // Monolith Critical Path Highlighter (S.cp): persisted state that dims
    // the non-critical chain in the Gantt. State-driven so the chip and the
    // bars can never drift apart across re-renders.
    ns.State.updateState(function(st) { st.hlCritical = !st.hlCritical; });
    R.renderGantt();
    R.renderWbs();
    if (btn) btn.classList.toggle('is-on', !!S().hlCritical);
  }

  function tglLeadtimeLane(btn) {
    // Monolith kb-leadtime-tgl: dedicated Kanban swimlane for Lead-Time /
    // third-party tasks. Persisted so re-renders keep the lane state.
    ns.State.updateState(function(st) { st.kbShowLeadtime = !st.kbShowLeadtime; });
    R.renderKanban();
    if (btn) btn.classList.toggle('is-on', !!S().kbShowLeadtime);
  }

  // ---- Kanban ----
  let dragTaskId = null;

  function dragCard(ev, taskId) {
    dragTaskId = taskId;
    ev.dataTransfer.effectAllowed = 'move';
  }

  function dropCard(ev, status) {
    ev.preventDefault();
    if (dragTaskId) {
      const task = (S().tasks || []).find(t => t.id === dragTaskId);
      // Monolith drop guard: lead-time cards belong in the Lead-Time lane , 
      // WIP columns are for crew-driven work. Refuse the drop with a toast
      // instead of silently moving a third-party wait into a work column.
      if (task && task.leadTime) {
        showToast('Lead-time cards belong in the Lead-Time lane , WIP columns are for crew-driven work.', 'err');
        dragTaskId = null;
        document.querySelectorAll('.kcol').forEach(c => c.classList.remove('dov'));
        return;
      }
      ns.State.updateState(function(s) {
        const task = (s.tasks || []).find(t => t.id === dragTaskId);
        if (task) task.status = status;
      });
      R.renderKanban();
      R.renderWbs();
      R.renderDash();
    }
    dragTaskId = null;
    document.querySelectorAll('.kcol').forEach(c => c.classList.remove('dov'));
  }

  function dropCardLeadtime(ev) {
    ev.preventDefault();
    if (dragTaskId) {
      ns.State.updateState(function(s) {
        const task = (s.tasks || []).find(t => t.id === dragTaskId);
        if (task) task.leadTime = !task.leadTime;
      });
      // Interaction re-audit: toggling lead-time changes the WBS row (LT badge
      // + submitted/expected inputs) and the Dashboard's Lead-Time Tracker , 
      // refresh all three surfaces, not just the board lane.
      R.renderKanban();
      R.renderWbs();
      R.renderDash();
    }
    dragTaskId = null;
    // Symmetry with dropCard: clear any lingering drop-highlight styling on
    // the columns after a lead-time drop.
    document.querySelectorAll('.kcol').forEach(c => c.classList.remove('dov'));
  }

  function populateSprint() {
    // Pull the sprint's date span from the unstarted (todo) tasks.
    const s = S();
    const unstarted = (s.tasks || []).filter(t => (t.status || 'todo') === 'todo' && !t.isPhase);
    if (!unstarted.length) {
      showToast('No unstarted tasks to populate the sprint with.', 'err');
      return;
    }
    const starts = unstarted.map(t => t.startDate).filter(Boolean).sort();
    const ends = unstarted.map(t => t.endDate).filter(Boolean).sort();
    ns.State.updateState(function(state) {
      if (!state.sprint) state.sprint = { name: 'Sprint 1', start: '', end: '' };
      state.sprint.start = starts.length ? starts[0] : '';
      state.sprint.end = ends.length ? ends[ends.length - 1] : '';
    });
    // Refresh the sprint panel inputs
    if (ns.Tasks && ns.Tasks.loadSprintData) ns.Tasks.loadSprintData();
    showToast('Sprint populated with ' + unstarted.length + ' unstarted task(s).', 'ok');
  }

  // ---- Prompts ----
  function openPrompt(type) {
    const prompt = ns.Prompts.generate(type);
    const txt = U.$('om-txt');
    const modal = U.$('om');
    if (txt && modal) {
      txt.value = prompt;
      U.$('om-title').innerHTML = '<svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-edit"></use></svg> Prompt , ' + type;
      modal.classList.add('open');
    }
    // Monolith port: the Daily Field report gets a "Snapshot Now" button in
    // the modal header. Clicking it saves today's task statuses so tomorrow's
    // prompt shows a real completed-since-last-snapshot diff.
    const existing = document.getElementById('snap-daily-btn');
    if (existing) existing.remove();
    if (type === 'daily') {
      const title = U.$('om-title');
      if (title) {
        setTimeout(() => {
          if (document.getElementById('snap-daily-btn')) return;
          const b = document.createElement('button');
          b.id = 'snap-daily-btn';
          b.className = 'btn btn-g btn-s';
          b.style.marginLeft = '10px';
          b.textContent = 'Snapshot Now';
          b.title = 'Save current task statuses. Tomorrow\'s report will show what changed since this snapshot.';
          b.addEventListener('click', function() {
            if (ns.FieldReport && ns.FieldReport.snapshotDaily) {
              ns.FieldReport.snapshotDaily();
            }
          });
          title.parentNode.appendChild(b);
        }, 30);
      }
    }
  }

  function openDrwToSave() {
    swDtab('ctrl', null);
    openDrw();
  }

  // ---- Backup & Cloud-Sync UI ---- (extracted to js/app/backup.js)
  function cloudLinked() { return ns.AppBackup && ns.AppBackup.cloudLinked ? ns.AppBackup.cloudLinked() : false; }
  function scheduleCloudAutoSave() { if (ns.AppBackup) ns.AppBackup.scheduleCloudAutoSave(); }
  function flushCloudAutoSave() { if (ns.AppBackup) ns.AppBackup.flushCloudAutoSave(); }
  function bkToggle() { if (ns.AppBackup) ns.AppBackup.bkToggle(); }
  function bkClose() { if (ns.AppBackup) ns.AppBackup.bkClose(); }
  function bkSyncHint() { if (ns.AppBackup) ns.AppBackup.bkSyncHint(); }
  function bkCloud() { if (ns.AppBackup) ns.AppBackup.bkCloud(); }

  function openDrwToPrompts(type) {
    swDtab('prompt', null);
    openDrw();
  }

  function jumpToDashTimeline() {
    showSec('dash', document.querySelector('.sec-btn'));
  }

  // ---- Export & File I/O ---- (extracted to js/app/export.js)
  function openOM() { if (ns.AppExport) ns.AppExport.openOM(); }
  function closeOM() { if (ns.AppExport) ns.AppExport.closeOM(); }
  function cpOut() { if (ns.AppExport) ns.AppExport.cpOut(); }
  function loadClip() { if (ns.AppExport) ns.AppExport.loadClip(); }
  function saveProjectFile() { if (ns.AppExport) ns.AppExport.saveProjectFile(); }
  function loadProjectFile(ev) { if (ns.AppExport) ns.AppExport.loadProjectFile(ev); }

  // Rank 4.4: field-level merge of an exported project file into the current
  // plan. Every tracked field keeps whichever side is newer (per-field
  // timestamps, falling back to updatedAt); ties keep the LOCAL value, so a
  // merge never silently discards local edits. Reports a per-field summary.
  function mergeProjectFile(ev) {
    const file = ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
      let parsed = null;
      try { parsed = JSON.parse(e.target.result); }
      catch (err) { showToast('Invalid project file.', 'err'); return; }
      const out = ns.State.mergeExternal(parsed);
      if (!out) { showToast('Invalid project file.', 'err'); return; }
      R.renderAll();
      if (ns.Charter) ns.Charter.loadCharterData();
      if (ns.Sprint) ns.Sprint.loadSprintData();
      // Surface every two-way conflict by NAME , never silently resolved.
      // A conflict is a field present on BOTH sides; the newer stamp wins
      // and the loser is named in the toast so the user can verify it.
      const conflicts = out.report.filter(r => r.reason === 'newer-timestamp' || r.reason === 'local-equal-or-newer');
      // Cap the named list , a full project import can conflict on dozens of
      // fields and would overflow the toast.
      const NAMED = 5;
      const names = conflicts.slice(0, NAMED).map(r => r.field).join(', ');
      const more = conflicts.length > NAMED ? ', +' + (conflicts.length - NAMED) + ' more' : '';
      const fromFile = out.report.filter(r => r.side === 'incoming').length;
      const keptLocal = out.report.length - fromFile;
      const summary = names
        ? 'Merged ' + fromFile + ' field(s) from file, kept ' + keptLocal + ' local. Conflicting fields (newest edit won): ' + names + more + '.'
        : 'Merged ' + fromFile + ' field(s) from file, kept ' + keptLocal + ' local. No field had edits on both sides.';
      // Rank 4.5: after a merge (multi-device use detected), offer the
      // single dismissible optional-identity suggestion , if not signed in
      // and not already dismissed on this device. Never a modal, never spam.
      if (ns.Sync && ns.Sync.noteMultiDeviceUse) ns.Sync.noteMultiDeviceUse();
      showToast(summary, out.adopted > 0 ? 'ok' : 'warn');
    };
    reader.readAsText(file);
    ev.target.value = '';
  }

  function saveBaseline() { if (ns.AppExport) ns.AppExport.saveBaseline(); }

  // ---- Init ----
  // Explicit module-readiness gate. init() must not run until every module
  // the app depends on is present, otherwise a module that fails to load (or
  // a future reorder of the <script> tags) produces a silent, partial boot.
  // We poll every 50ms , which covers deferred scripts and slow network , and
  // after ~5s give up LOUDLY with the missing module names instead of initing
  // against an incomplete namespace.
  //
  // NOTE: Utils and Render are captured at parse time (const U / const R
  // above), so those two scripts must still load BEFORE app.js , the gate
  // guards the rest of the boot, not that specific parse-time capture.
  const REQUIRED_MODULES = [
    'Utils', 'State', 'Render', 'Prompts', 'Weather', 'FieldReport', 'Schedule',
    'Tasks', 'Sprint', 'WbsImport', 'ImportDates',
    'Risks', 'Resources', 'Budget', 'Spend', 'Stakeholders', 'Changes', 'Log',
    'Closure', 'Comms', 'Documents', 'Raci', 'Charter',
    'Health', 'Evm', 'Dmaic', 'Meetings', 'Voice', 'Defs', 'Decisions', 'Forecast', 'Claim', 'Digest'
  ];

  function modulesReady() {
    return REQUIRED_MODULES.every(m => !!ns[m]);
  }

  function _boot() {
    let attempts = 0;
    const MAX_ATTEMPTS = 100; // 100 × 50ms = 5s
    function tryInit() {
      if (document.readyState === 'loading') {
        attempts++;
        if (attempts > MAX_ATTEMPTS) {
          console.error('My MaNaGeR boot timed out waiting for the DOM.');
          return;
        }
        setTimeout(tryInit, 50);
        return;
      }
      if (!modulesReady()) {
        const missing = REQUIRED_MODULES.filter(m => !ns[m]);
        attempts++;
        if (attempts > MAX_ATTEMPTS) {
          const msg = 'My MaNaGeR boot ABORTED , missing modules: ' + missing.join(', ') + '. Check the <script> load order in project.html.';
          console.error(msg);
          // Fail visibly for end users too , a silent blank page tells them
          // nothing about why nothing rendered.
          const sp = document.getElementById('boot-splash');
          if (sp) sp.classList.add('off');
          const el = document.createElement('div');
          el.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#1a1a1a;color:#ff6b6b;font:14px/1.5 monospace;padding:40px;text-align:center;z-index:99999';
          el.textContent = 'App failed to start , missing modules: ' + missing.join(', ') + '. Check the <script> load order.';
          document.body.appendChild(el);
          return;
        }
        setTimeout(tryInit, 50);
        return;
      }
      init();
    }
    tryInit();
  }

  // ---- API ----
  ns.App = {
    init: init,
    _boot: _boot,
    isReadonly: isReadonly,
    cloudCodeHeld: cloudCodeHeld,
    cloudExportBlocked: cloudExportBlocked,
    setUserName: setUserName,
    tglTheme: tglTheme,
    tglCh: tglCh,
    tglLock: tglLock,
    setWorkWeek: setWorkWeek,
    // PLAN-OF-ACTION-LIQUID-GLASS-UI 3.5.3 + PLAN-OF-ACTION-AI-VOICE-SYNC-v1 4.5
    tglGlassMode: tglGlassMode,
    tglNav: tglNav,
    tglSidebar: toggleSidebar,
    tglSidebarOpen: function () { setSidebarOpen(!document.body.classList.contains('sidebar-open')); },
    syncConnect: syncConnect,
    syncSignOut: syncSignOut,
    syncClientId: syncClientId,
    syncDismissSuggest: syncDismissSuggest,
    swMeth: swMeth,
    showSec: showSec,
    tglFocusMode: tglFocusMode,
    openDrw: openDrw,
    closeDrw: closeDrw,
    swDtab: swDtab,
    openPacks: openPacks,
    dismissPacksCallout: dismissPacksCallout,
    showToast: showToast,
    showMLC: showMLC,
    closeMLC: closeMLC,
    scheduleMLCClose: scheduleMLCClose,
    tglFlag: tglFlag,
    clearErrorLog: clearErrorLog,
    copyErrorLog: copyErrorLog,
    downloadErrorLog: downloadErrorLog,
    errLogText: errLogText,
    tglErrReport: tglErrReport,
    setErrWebhook: setErrWebhook,
    // MASTER-ACTION-PLAN Rank 6.1
    reportIssueCopy: reportIssueCopy,
    reportIssueDownload: reportIssueDownload,
    tglReportContext: tglReportContext,
    clearMlcTimer: clearMlcTimer,
    cpAllPage: cpAllPage,
    cpFormats: cpFormats,
    copyAsText: copyAsText,
    renderCtrlPreviews: renderCtrlPreviews,
    emailTpl: emailTpl,
    emailTplText: emailTplText,
    wxGeocode: wxGeocode,
    wxUseLocation: wxUseLocation,
    wxRefresh: wxRefresh,
    wxSetView: wxSetView,
    wxLogToday: wxLogToday,
    wxLogManual: wxLogManual,
    wxCopyNotice: wxCopyNotice,
    wxDelLogEntry: wxDelLogEntry,
    defTipFor: defTipFor,
    showDefTip: showDefTip,
    hideDefTip: hideDefTip,
    exportGanttPNG: exportGanttPNG,
    startHold: startHold,
    cancelHold: cancelHold,
    clearSection: clearSection,
    undoClr: undoClr,
    undo: undo,
    redo: redo,
    updateUndoUi: updateUndoUi,
    setRegion: setRegion,
    askConfirm: askConfirm,
    cfmOk: cfmOk,
    cfmCancel: cfmCancel,
    keepMine: keepMine,
    keepTheirs: keepTheirs,
    restoreBaseline: restoreBaseline,
    cascadeGantt: cascadeGantt,
    toggleCritical: toggleCritical,
    tglLeadtimeLane: tglLeadtimeLane,
    dragCard: dragCard,
    dropCard: dropCard,
    dropCardLeadtime: dropCardLeadtime,
    populateSprint: populateSprint,
    openPrompt: openPrompt,
    openDrwToSave: openDrwToSave,
    openDrwToPrompts: openDrwToPrompts,
    bkToggle: bkToggle,
    bkClose: bkClose,
    bkCloud: bkCloud,
    jumpToDashTimeline: jumpToDashTimeline,
    openOM: openOM,
    closeOM: closeOM,
    cpOut: cpOut,
    loadClip: loadClip,
    saveProjectFile: saveProjectFile,
    loadProjectFile: loadProjectFile,
    mergeProjectFile: mergeProjectFile,
    saveBaseline: saveBaseline,
    checkAccess: checkAccess
  };

  // Auto-boot
  _boot();

})(MMGR);
window.MMGR = MMGR;

/* ============================================================
   Data-action event delegation system.
   Replaces all inline event handlers with data-action attributes.
   Usage: <button data-action="addTask">Add Task</button>
   ============================================================ */
(function() {   const ACTION_MAP = {
    // App controller
    'showSec': (el) => {
      const section = el.getAttribute('data-section');
      window.MMGR.App.showSec(section, el);
    },
    'swMeth': (el) => {
      const meth = el.getAttribute('data-meth');
      window.MMGR.App.swMeth(meth, el);
    },
    'swDtab': (el) => {
      window.MMGR.App.swDtab(el.getAttribute('data-tab'), el);
    },
    'addTask': () => window.MMGR.Tasks.addTask(),
    'delTask': (el) => window.MMGR.Tasks.delTask(el.getAttribute('data-id')),
    'indentTask': (el) => window.MMGR.Tasks.indentTask(el.getAttribute('data-id')),
    'addTaskComment': (el) => {
      const taskId = el.getAttribute('data-id');
      const input = document.getElementById('comment-input-' + taskId);
      if (input && input.value.trim()) {
        window.MMGR.Tasks.addTaskComment(taskId, input.value.trim());
        input.value = '';
      }
    },
    'delTaskComment': (el) => window.MMGR.Tasks.delTaskComment(el.getAttribute('data-task-id'), el.getAttribute('data-comment-id')),
    'setTaskFollowUp': (el) => {
      const taskId = el.getAttribute('data-id');
      const assignee = prompt('Follow-up assignee:');
      const dueDate = prompt('Due date (YYYY-MM-DD):');
      if (assignee) window.MMGR.Tasks.setTaskFollowUp(taskId, assignee, dueDate);
    },
    'completeTaskFollowUp': (el) => window.MMGR.Tasks.completeTaskFollowUp(el.getAttribute('data-id')),
    'clearTaskFollowUp': (el) => window.MMGR.Tasks.clearTaskFollowUp(el.getAttribute('data-id')),
    'toggleTaskComments': (el) => { if (ns.Render && ns.Render.toggleTaskComments) ns.Render.toggleTaskComments(el.getAttribute('data-id')); },
    'importCrossProjectResources': () => {
      // Build a modal listing localStorage projects with their resources
      const currentId = ns.projectId || '';
      const projects = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith('mmgr_state_')) {
            const pid = k.replace('mmgr_state_', '');
            if (pid === currentId) continue;
            try {
              const st = JSON.parse(localStorage.getItem(k));
              const res = (st && st.resources && st.resources.length) ? st.resources : [];
              if (res.length) {
                projects.push({ id: pid, name: st.charter && st.charter.projectName ? st.charter.projectName : pid, resources: res });
              }
            } catch(e) {}
          }
        }
      } catch(e) {}
      if (!projects.length) { showToast('No other projects with resources found on this device.', 'warn'); return; }
      // Show modal
      let html = '<div class="card m0a" style="padding:16px;max-width:500px"><div style="font-weight:600;font-size:.85rem;margin-bottom:10px">Import Resources from Another Project</div>';
      projects.forEach(function(p) {
        const curRes = (S().resources || []).map(r => r.name.toLowerCase());
        const newRes = p.resources.filter(r => r.name && curRes.indexOf(r.name.toLowerCase()) === -1);
        html += '<div style="border:1px solid var(--border);border-radius:6px;padding:10px;margin-bottom:8px">';
        html += '<div style="font-weight:600;font-size:.8rem">' + U.escapeHtml(p.name) + ' <span style="color:var(--slate);font-size:.7rem">(' + p.resources.length + ' resources, ' + newRes.length + ' new)</span></div>';
        if (newRes.length) {
          html += '<div style="font-size:.72rem;color:var(--slate);margin:4px 0">New: ' + newRes.map(r => U.escapeHtml(r.name)).join(', ') + '</div>';
          html += '<button class="btn btn-g btn-s" style="font-size:.7rem" data-action="doImportResources" data-src-id="' + U.escapeHtml(p.id) + '" data-count="' + newRes.length + '">Import ' + newRes.length + ' resource(s)</button>';
        } else {
          html += '<div style="font-size:.72rem;color:var(--slate)">All resources already in this project.</div>';
        }
        html += '</div>';
      });
      html += '<button class="btn btn-n btn-s" style="font-size:.7rem;margin-top:4px" data-action="closeImportModal">Cancel</button>';
      html += '</div>';
      const overlay = document.createElement('div');
      overlay.id = 'import-modal';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:200;display:flex;align-items:center;justify-content:center';
      overlay.innerHTML = html;
      overlay.addEventListener('click', function(e) {
        if (e.target === overlay || e.target.getAttribute('data-action') === 'closeImportModal') overlay.remove();
      });
      document.body.appendChild(overlay);
    },
    'doImportResources': (el) => {
      const srcId = el.getAttribute('data-src-id');
      if (!srcId) return;
      try {
        const srcState = JSON.parse(localStorage.getItem('mmgr_state_' + srcId));
        const srcRes = (srcState && srcState.resources) || [];
        const curNames = (S().resources || []).map(r => r.name.toLowerCase());
        const toImport = srcRes.filter(r => r.name && curNames.indexOf(r.name.toLowerCase()) === -1);
        if (!toImport.length) { showToast('All resources already imported.', 'warn'); return; }
        ns.State.updateState(function(st) {
          if (!st.resources) st.resources = [];
          toImport.forEach(function(r) {
            st.resources.push({
              id: U.genShortId('R'), name: r.name, type: r.type || 'Labor',
              role: r.role || '', availability: r.availability || 100,
              rate: r.rate || 0, hoursAllocated: r.hoursAllocated || 0, utilization: 0
            });
          });
        });
        const modal = document.getElementById('import-modal');
        if (modal) modal.remove();
        R.renderResources();
        showToast('Imported ' + toImport.length + ' resource(s).', 'ok');
      } catch(e) {
        showToast('Import failed: ' + e.message, 'err');
      }
    },
    'closeImportModal': () => { const m = document.getElementById('import-modal'); if (m) m.remove(); },
    'saveAsTemplate': () => {
      const name = prompt('Template name:');
      if (name) { window.MMGR.Templates.saveAsTemplate(name); alert('Template saved: ' + name); }
    },
    'applyTemplate': (el) => {
      const tplId = el.getAttribute('data-tpl-id');
      if (tplId) window.MMGR.Templates.applyTemplate(tplId);
    },
    'deleteTemplate': (el) => {
      const tplId = el.getAttribute('data-tpl-id');
      if (tplId && confirm('Delete this template?')) window.MMGR.Templates.deleteTemplate(tplId);
    },
    'outdentTask': (el) => window.MMGR.Tasks.outdentTask(el.getAttribute('data-id')),
    'tglPhase': (el) => window.MMGR.Tasks.tglPhase(el.getAttribute('data-id')),
    'tglWeather': (el) => window.MMGR.Tasks.tglWeather(el.getAttribute('data-id')),
    'tglLeadTime': (el) => window.MMGR.Tasks.tglLeadTime(el.getAttribute('data-id')),
    'openWbsImport': () => window.MMGR.Tasks.openWbsImport(),
    'wiPreview': () => window.MMGR.Tasks.wiPreview(),
    'wiCommit': () => window.MMGR.Tasks.wiCommit(),
    'openImportDates': () => window.MMGR.Tasks.openImportDates(),
    'idPreview': () => window.MMGR.Tasks.idPreview(),
    'idCommit': () => window.MMGR.Tasks.idCommit(),
    // MONOLITH-FEATURE-PARITY-DIRECTIVES RESTORE-2: Import Dates 'Copy List'.
    'copyIdTemplate': () => window.MMGR.Tasks.copyIdTemplate(),
    'saveSprint': () => window.MMGR.Tasks.saveSprint(),
    'addRisk': () => window.MMGR.Risks.addRisk(),
    'delRisk': (el) => window.MMGR.Risks.delRisk(parseInt(el.getAttribute('data-idx'))),
    'toggleRiskIssue': (el) => window.MMGR.Risks.toggleRiskIssue(parseInt(el.getAttribute('data-idx'))),
    'delIssue': (el) => window.MMGR.Risks.delIssue(parseInt(el.getAttribute('data-idx'))),
    // MONOLITH-FEATURE-PARITY-DIRECTIVES RESTORE-1: risk matrix
    // click-to-filter (view-only , filtering the list, not mutating state).
    'riskMatrixCell': (el) => window.MMGR.Render.riskMatrixCell(el.getAttribute('data-prob'), el.getAttribute('data-imp')),
    'riskMatrixClear': () => window.MMGR.Render.clearRiskFilter(),
    // MONOLITH-FEATURE-PARITY-DIRECTIVES RESTORE-7: WBS schedule-issues
    // banner toggle (view-only).
    'tglWbsIssues': () => window.MMGR.Render.toggleWbsIssues(),
    'addResource': () => window.MMGR.Resources.addResource(),
    'delResource': (el) => window.MMGR.Resources.delResource(parseInt(el.getAttribute('data-idx'))),
    'pushResourcesToBudget': () => window.MMGR.Resources.pushResourcesToBudget(),
    'addBudgetLine': () => window.MMGR.Budget.addBudgetLine(),
    'delBudgetLine': (el) => window.MMGR.Budget.delBudgetLine(parseInt(el.getAttribute('data-idx'))),
    'updEnvelope': (el, e) => window.MMGR.Budget.updEnvelope(el.value, e && e.type),
    'addStake': () => window.MMGR.Stakeholders.addStake(),
    'delStake': (el) => window.MMGR.Stakeholders.delStake(parseInt(el.getAttribute('data-idx'))),
    // MARKET-FEATURE-ROADMAP A3/A4 (T8 REBUILD 2026-08-16): bid leveling +
    // Go/No-Go scoring actions , modal-created packages, leveled grid,
    // weighted star scorecard. State mutations are deliberately NOT in
    // READONLY_SAFE_ACTIONS; bidProposal/bidClarify open links (safe).
    'bidAdd': () => window.MMGR.Bids.openBidPkgModal(),
    'bidEdit': (el) => window.MMGR.Bids.openBidPkgModal(parseInt(el.getAttribute('data-pkg'))),
    'bidModalAddItem': () => window.MMGR.Bids.bidModalAddItem(),
    'bidModalDelItem': (el) => window.MMGR.Bids.bidModalDelItem(parseInt(el.getAttribute('data-idx'))),
    'bidPkgSave': () => window.MMGR.Bids.bidPkgSave(),
    'closeBidPkg': () => window.MMGR.Bids.closeBidPkgModal(),
    'closeBidPkgBg': (el, e) => { if (e.target === el) window.MMGR.Bids.closeBidPkgModal(); },
    'bidSubAdd': (el) => window.MMGR.Bids.addSub(parseInt(el.getAttribute('data-pkg'))),
    'bidSubDel': (el) => window.MMGR.Bids.delSub(parseInt(el.getAttribute('data-pkg')), parseInt(el.getAttribute('data-sid'))),
    'bidPkgUpd': (el, e) => window.MMGR.Bids.updPkg(parseInt(el.getAttribute('data-pkg')), el.getAttribute('data-field'), el.value, e && e.type),
    'bidSubUpd': (el, e) => window.MMGR.Bids.updSub(parseInt(el.getAttribute('data-pkg')), parseInt(el.getAttribute('data-sid')), el.getAttribute('data-field'), el.value, e && e.type),
    'bidLineUpd': (el, e) => window.MMGR.Bids.updLine(parseInt(el.getAttribute('data-pkg')), parseInt(el.getAttribute('data-lid')), el.getAttribute('data-field'), el.value, e && e.type),
    'bidLineDel': (el) => window.MMGR.Bids.delLine(parseInt(el.getAttribute('data-pkg')), parseInt(el.getAttribute('data-lid'))),
    'bidAmount': (el, e) => window.MMGR.Bids.updAmount(parseInt(el.getAttribute('data-pkg')), parseInt(el.getAttribute('data-sid')), parseInt(el.getAttribute('data-lid')), el.value, e && e.type),
    'bidAddLine': (el) => window.MMGR.Bids.addLine(parseInt(el.getAttribute('data-pkg'))),
    'bidAward': (el) => window.MMGR.Bids.awardSub(parseInt(el.getAttribute('data-pkg')), parseInt(el.getAttribute('data-sid'))),
    'bidProposal': (el) => window.MMGR.Bids.openProposal(parseInt(el.getAttribute('data-pkg')), parseInt(el.getAttribute('data-sid'))),
    'bidClarify': (el) => window.MMGR.Bids.clarifySub(parseInt(el.getAttribute('data-pkg')), parseInt(el.getAttribute('data-sid'))),
    'bidDelPkg': (el) => window.MMGR.Bids.delBidPackage(parseInt(el.getAttribute('data-pkg'))),
    'gonogoAdd': () => window.MMGR.Bids.addGoNoGo(),
    'gonogoUpd': (el, e) => window.MMGR.Bids.updGoNoGo(parseInt(el.getAttribute('data-idx')), el.getAttribute('data-field'), el.value, e && e.type),
    'gonogoCatUpd': (el, e) => window.MMGR.Bids.updGoNoGoCat(parseInt(el.getAttribute('data-idx')), parseInt(el.getAttribute('data-cidx')), el.getAttribute('data-field'), el.value, e && e.type),
    'gonogoCritUpd': (el, e) => window.MMGR.Bids.updGoNoGoCrit(parseInt(el.getAttribute('data-idx')), parseInt(el.getAttribute('data-cidx')), parseInt(el.getAttribute('data-ridx')), el.getAttribute('data-field'), el.value, e && e.type),
    'gonogoStar': (el) => window.MMGR.Bids.setGoNoGoStar(parseInt(el.getAttribute('data-idx')), parseInt(el.getAttribute('data-cidx')), parseInt(el.getAttribute('data-ridx')), parseInt(el.getAttribute('data-val'))),
    'gonogoAddCat': (el) => window.MMGR.Bids.addGoNoGoCat(parseInt(el.getAttribute('data-idx'))),
    'gonogoDelCat': (el) => window.MMGR.Bids.delGoNoGoCat(parseInt(el.getAttribute('data-idx')), parseInt(el.getAttribute('data-cidx'))),
    'gonogoAddCrit': (el) => window.MMGR.Bids.addGoNoGoCriterion(parseInt(el.getAttribute('data-idx')), parseInt(el.getAttribute('data-cidx'))),
    'gonogoDelCrit': (el) => window.MMGR.Bids.delGoNoGoCriterion(parseInt(el.getAttribute('data-idx')), parseInt(el.getAttribute('data-cidx')), parseInt(el.getAttribute('data-ridx'))),
    'gonogoDel': (el) => window.MMGR.Bids.delGoNoGo(parseInt(el.getAttribute('data-idx'))),
    'addChange': () => window.MMGR.Changes.addChange(),
    'delChange': (el) => window.MMGR.Changes.delChange(parseInt(el.getAttribute('data-idx'))),
    'addLog': () => window.MMGR.Log.addLog(),
    'delLog': (el) => window.MMGR.Log.delLog(parseInt(el.getAttribute('data-idx'))),
    'addCloseItem': () => window.MMGR.Closure.addCloseItem(),
    'delCloseItem': (el) => window.MMGR.Closure.delCloseItem(parseInt(el.getAttribute('data-idx'))),
    'addComms': () => window.MMGR.Comms.addComms(),
    'delComms': (el) => window.MMGR.Comms.delComms(parseInt(el.getAttribute('data-idx'))),
    'addDoc': () => window.MMGR.Documents.addDoc(),
    'delDoc': (el) => window.MMGR.Documents.delDoc(parseInt(el.getAttribute('data-idx'))),
    // MARKET-FEATURE-ROADMAP C1/C2/C3: RFI + Submittal + Punch List actions.
    'addRfi': () => window.MMGR.Rfis.addRfi(),
    'delRfi': (el) => window.MMGR.Rfis.delRfi(parseInt(el.getAttribute('data-idx'))),
    'addSubmittal': () => window.MMGR.Submittals.addSubmittal(),
    'delSubmittal': (el) => window.MMGR.Submittals.delSubmittal(parseInt(el.getAttribute('data-idx'))),
    'addPunch': () => window.MMGR.PunchList.addPunch(),
    'delPunch': (el) => window.MMGR.PunchList.delPunch(parseInt(el.getAttribute('data-idx'))),
    // MARKET-FEATURE-ROADMAP Section C batch 2 (state mutations , never
    // READONLY_SAFE): pay applications, inspections, incidents, handover,
    // warranty, drawing distribution log, permits.
    'addPayApp': () => window.MMGR.PayApps.addPayApp(true),
    'genPayApp': () => window.MMGR.PayApps.genPayApp(),
    'delPayApp': (el) => window.MMGR.PayApps.delPayApp(parseInt(el.getAttribute('data-idx'))),
    'addInspection': () => window.MMGR.Inspections.addInspection(),
    'delInspection': (el) => window.MMGR.Inspections.delInspection(parseInt(el.getAttribute('data-idx'))),
    'addInspItem': (el) => window.MMGR.Inspections.addInspItem(parseInt(el.getAttribute('data-idx'))),
    'delInspItem': (el) => window.MMGR.Inspections.delInspItem(parseInt(el.getAttribute('data-idx')), parseInt(el.getAttribute('data-iidx'))),
    'inspItemToggle': (el) => window.MMGR.Inspections.toggleInspItem(parseInt(el.getAttribute('data-idx')), parseInt(el.getAttribute('data-iidx'))),
    'updInspItem': (el) => window.MMGR.Inspections.updInspItem(parseInt(el.getAttribute('data-idx')), parseInt(el.getAttribute('data-iidx')), el.getAttribute('data-field'), el.value),
    'addIncident': () => window.MMGR.Incidents.addIncident(),
    'delIncident': (el) => window.MMGR.Incidents.delIncident(parseInt(el.getAttribute('data-idx'))),
    'addHandoverItem': () => window.MMGR.Handover.addHandoverItem(),
    'delHandoverItem': (el) => window.MMGR.Handover.delHandoverItem(parseInt(el.getAttribute('data-idx'))),
    'addWarranty': () => window.MMGR.Warranty.addWarranty(),
    'delWarranty': (el) => window.MMGR.Warranty.delWarranty(parseInt(el.getAttribute('data-idx'))),
    'addDrawLog': () => window.MMGR.DrawingLog.addDrawLog(),
    'delDrawLog': (el) => window.MMGR.DrawingLog.delDrawLog(parseInt(el.getAttribute('data-idx'))),
    'addPermit': () => window.MMGR.Permits.addPermit(),
    'delPermit': (el) => window.MMGR.Permits.delPermit(parseInt(el.getAttribute('data-idx'))),
    'addProcurement': () => window.MMGR.Procurement.addProcurement(),
    'delProcurement': (el) => window.MMGR.Procurement.delProcurement(parseInt(el.getAttribute('data-idx'))),
    'addTimeEntry': () => window.MMGR.TimeTracking.addTimeEntry(),
    'delTimeEntry': (el) => window.MMGR.TimeTracking.delTimeEntry(parseInt(el.getAttribute('data-idx'))),
    'addEquipment': () => window.MMGR.Equipment.addEquipment(),
    'delEquipment': (el) => window.MMGR.Equipment.delEquipment(parseInt(el.getAttribute('data-idx'))),
    'addKPI': () => window.MMGR.Charter.addKPI(),
    'delKPI': (el) => window.MMGR.Charter.delKPI(parseInt(el.getAttribute('data-idx'))),
    'openChartUp': () => window.MMGR.Charter.openChartUp(),
    'closeChartUp': () => window.MMGR.Charter.closeChartUp(),
    'closeChartUpBg': (el, e) => { if (e.target === el) window.MMGR.Charter.closeChartUp(); },
    'regenChartPrompt': () => window.MMGR.Charter.regenChartPrompt(),
    'copyChartPrompt': () => window.MMGR.Charter.copyChartPrompt(),
    'applyChartAIOutput': () => window.MMGR.Charter.applyChartAIOutput(),
    // MONOLITH-FEATURE-PARITY-DIRECTIVES RESTORE-5/6: Print Charter + Save
    // Charter (save mutates state and stays blocked in view-only; print is
    // view-only).
    'printCharter': () => window.MMGR.Charter.printCharter(),
    'saveCharter': () => window.MMGR.Charter.saveCharter(),
    'cpAllPage': (el) => window.MMGR.App.cpAllPage(el.getAttribute('data-section')),
    'cpFormats': (el) => window.MMGR.App.cpFormats(el.getAttribute('data-kind')),
    // MONOLITH-FEATURE-PARITY-DIRECTIVES RESTORE-3: one-click email template
    // generator (view-only , composes + copies, never mutates state).
    'emailTpl': (el) => window.MMGR.App.emailTpl(el.getAttribute('data-kind')),
    'exportGanttPNG': () => window.MMGR.App.exportGanttPNG(),
    'wxGeocode': () => window.MMGR.App.wxGeocode(),
    'wxUseLocation': () => window.MMGR.App.wxUseLocation(),
    'wxRefresh': () => window.MMGR.App.wxRefresh(),
    'wxSetView': (el) => window.MMGR.App.wxSetView(el),
    'wxLogToday': () => window.MMGR.App.wxLogToday(),
    'wxLogManual': () => window.MMGR.App.wxLogManual(),
    'wxCopyNotice': () => window.MMGR.App.wxCopyNotice(),
    'delWeatherLogEntry': (el) => window.MMGR.App.wxDelLogEntry(el),
    // MASTER-ACTION-PLAN-v3-STRICT Rank 1: claim package + slip cause tags.
    'claimGenerate': () => window.MMGR.Claim.generate(),
    'claimSetCause': (el) => window.MMGR.Claim.setCause(el.getAttribute('data-task'), el.value),
    // MASTER-ACTION-PLAN-v3-STRICT Rank 2.1: digest generation is a read-only
    // compose; pinning writes the reference point into state.
    'digestGenerate': () => window.MMGR.Digest.generate(),
    'digestPin': () => window.MMGR.Digest.pin(),
    'meetSentiment': (el) => window.MMGR.Meetings.recordSentiment(el.getAttribute('data-val')),
    'tglLeadtimeReview': (el) => window.MMGR.Tasks.tglLeadtimeReview(el.getAttribute('data-id')),
    'openAiWin': () => window.MMGR.AiWin.open(),
    'closeAiWin': () => window.MMGR.AiWin.close(),
    'closeAiWinBg': (el, e) => { if (e.target === el) window.MMGR.AiWin.close(); },
    'aiPreset': (el) => window.MMGR.AiWin.preset(el.getAttribute('data-type')),
    'aiAttachContext': () => window.MMGR.AiWin.attachContext(),
    'aiCopy': () => window.MMGR.AiWin.copy(),
    'aiClear': () => window.MMGR.AiWin.clear(),
    // Rank 2.3: real model wiring , run preset / run question / settings.
    'aiRunPreset': (el) => window.MMGR.AiWin.runPreset(el.getAttribute('data-type')),
    'aiRun': () => window.MMGR.AiWin.runQuestion(),
    'aiCopyOut': () => window.MMGR.AiWin.copyOut(),
    'aiSetTier': (el) => { window.MMGR.AiWin.setAiCfg({ tier: el.value }); window.MMGR.AiWin.syncSettingsUI(); },
    'aiToggleMcp': (el) => { var pid = window.MMGR && MMGR.App && MMGR.App.projectId ? MMGR.App.projectId : ''; if (pid) { try { localStorage.setItem('mmgr_mcp_toggle_' + pid, el.checked ? '1' : '0'); } catch(e) {} } },
    'aiVoiceToggle': () => { if (window.MMGR && MMGR.Voice) MMGR.Voice.toggleAiRecording(); },
    // MERGED-AI-CONTROL (audit 1.2): the drawer's AI Assistant switch is now
    // the single AI on/off control , it reads/writes state.config.ai.tier
    // directly (flags.aiWindow is dropped as a gate). OFF -> tier 'off'; ON
    // -> restore the last non-off tier (default 'local').
    'tglAiTier': (el) => window.MMGR.AiWin.tglDrawerTier(el),
    // AI-CLOUD-CONNECT-UI (DIR-2): no aiSetKey action , and no aiSetProvider /
    // aiSetEndpoint / aiSetModel actions either. The BYO provider select is
    // read directly by the Connect & Test flow, and the key is wired
    // directly in mmgr-ai.js (session vault only); setAiCfg drops apiKey
    // patches anyway , a key can never be persisted into project state.
    // Rank 3.4: viewport prompt answers write a device-level preference only
    // (localStorage, never project state) , safe in view-only. toggleFull is
    // a pure DOM class toggle.
    'vpAccept': (el) => window.MMGR.Viewport.accept(el.getAttribute('data-section')),
    'vpDismiss': (el) => window.MMGR.Viewport.dismiss(el.getAttribute('data-section')),
    'vpFull': (el) => window.MMGR.Viewport.toggleFull(el.getAttribute('data-section')),
    // Rank 3.5 (PLAN-OF-ACTION-LIQUID-GLASS-UI): premium visual mode toggle , 
    // writes a device-level preference only (localStorage, never project
    // state), so it is safe in view-only, exactly like the viewport prefs.
    'tglGlassMode': () => window.MMGR.App.tglGlassMode(),
    // Calculator toggle (floating draggable FAB).
    'toggleCalc': () => { const C = window.MMGR.Calculator; if (C && C.toggle) C.toggle(); },
    // THEME-SYSTEM-AND-MOBILE-UI-ACTION-PLAN §4.2: mobile nav drawer toggle.
    'tglNav': () => window.MMGR.App.tglNav(),
    'tglSidebar': () => window.MMGR.App.tglSidebar(),
    'tglSidebarOpen': () => window.MMGR.App.tglSidebarOpen(),
    // Rank 4.5 (PLAN-OF-ACTION-AI-VOICE-SYNC-v1): optional Google identity
    // for sync , device-level label only, never a gate, safe in view-only.
    'syncConnect': () => window.MMGR.App.syncConnect(),
    'syncSignOut': () => window.MMGR.App.syncSignOut(),
    'syncClientId': (el) => window.MMGR.App.syncClientId(el),
    'syncDismissSuggest': () => window.MMGR.App.syncDismissSuggest(),
    // GOOGLE-DRIVE-BACKUP: optional Drive backup/restore controls in the
    // Controls drawer (project.html). Backup is export-equivalent (reads the
    // workspace, writes Drive + a device pref), restore is import-equivalent
    // (confirm-gated, overwrites local workspace), and the auto-interval is a
    // device pref , all user-initiated, never gating. GoogleAuth is optional,
    // so every handler guards before touching it (zero-throw module).
    // PART F T9: driveBackup is an offline-copy surface , refused while a
    // cloud share code is held (the recipient must not copy the project to
    // their own Drive).
    'driveBackup': () => { if (window.MMGR.App && window.MMGR.App.cloudExportBlocked('driveBackup')) return; const G = window.MMGR.GoogleAuth; if (G && G.triggerBackup) G.triggerBackup(); },
    'driveRestore': () => { const G = window.MMGR.GoogleAuth; if (G && G.triggerRestore) G.triggerRestore(); },
    'driveAutoInterval': (el) => { const G = window.MMGR.GoogleAuth; if (G && G.setAutoIntervalFrom) G.setAutoIntervalFrom(el); },
    'driveSetPass': (el) => { const G = window.MMGR.GoogleAuth; if (G && G.setDrivePassFrom) G.setDrivePassFrom(el); },
    // CLOUD-BACKEND-ARCHITECTURE-PLAN Phase 1: optional Cloud Backup section
    // (owner-code create/save/load/recover + Google sign-in for recovery).
    // Same zero-throw pattern as the Drive entries above.
    'cloudCreate': () => { const C = window.MMGR.Cloud; if (C && C.createProject) C.createProject(); },
    'cloudUpgrade': () => { const C = window.MMGR.Cloud; if (C && C.cloudUpgrade) C.cloudUpgrade(); },
    'cloudResendVerify': () => { const C = window.MMGR.Cloud; if (C && C.cloudResendVerify) C.cloudResendVerify(); },
    'cloudSave': () => { const C = window.MMGR.Cloud; if (C && C.saveToCloud) C.saveToCloud(); },
    'cloudLoad': () => { const C = window.MMGR.Cloud; if (C && C.loadFromCloud) C.loadFromCloud(); },
    'cloudRecover': () => { const C = window.MMGR.Cloud; if (C && C.recoverCode) C.recoverCode(); },
    // GAP-AUDIT-CLOUD-31: unlink (owner-only, deletes the CLOUD copy, keeps
    // local data) + the shown-once editor-code banner's Copy/Done actions.
    'cloudUnlink': () => { const C = window.MMGR.Cloud; if (C && C.unlinkProject) C.unlinkProject(); },
    'cloudWebhookList': () => { const C = window.MMGR.Cloud; if (C && C.webhookList) C.webhookList(); },
    'cloudWebhookAdd': () => { const C = window.MMGR.Cloud; if (C && C.webhookAdd) C.webhookAdd(); },
    'cloudWebhookDel': (el) => { const C = window.MMGR.Cloud; if (C && C.webhookDel) C.webhookDel(el && el.getAttribute('data-id')); },
    'cloudCopyEditorCode': (el) => { const C = window.MMGR.Cloud; if (C && C.copyEditorCode && el) C.copyEditorCode(el.getAttribute('data-code')); },
    'cloudEditorCodeDone': () => { const C = window.MMGR.Cloud; if (C && C.editorCodeDone) C.editorCodeDone(); },
    'cloudCopyCode': () => { const C = window.MMGR.Cloud; if (C && C.copyCode) C.copyCode(); },
    'mcpCopyUrl': () => { var inp = document.getElementById('mcp-url'); if (inp && inp.value) { navigator.clipboard.writeText(inp.value).then(function() { var st = document.getElementById('mcp-status'); if (st) st.textContent = 'Copied to clipboard.'; setTimeout(function() { var s = document.getElementById('mcp-status'); if (s) s.textContent = ''; }, 2000); }).catch(function() { inp.select(); document.execCommand('copy'); }); } },
    'cloudSignIn': () => { const C = window.MMGR.Cloud; if (C && C.signIn) C.signIn(); },
    'cloudLoadWithCode': () => { const C = window.MMGR.Cloud; if (C && C.loadWithCode) C.loadWithCode(); },
    // CLOUD-BACKEND-ARCHITECTURE-PLAN Phase 2/3: editor-code management
    // (create/list/revoke , owner-only, enforced server-side) and the
    // changelog view/revert (owner-only). Same zero-throw pattern as the
    // Phase 1 entries above.
    'cloudEditorCreate': () => { const C = window.MMGR.Cloud; if (C && C.createEditor) C.createEditor(); },
    'cloudEditorList': () => { const C = window.MMGR.Cloud; if (C && C.listEditors) C.listEditors(); },
    'cloudEditorRevoke': (el) => { const C = window.MMGR.Cloud; if (C && C.revokeEditor) C.revokeEditor(el && el.getAttribute('data-id')); },
    'cloudLogList': () => { const C = window.MMGR.Cloud; if (C && C.listLog) C.listLog(); },
    'cloudLogRevert': (el) => { const C = window.MMGR.Cloud; if (C && C.revertLog) C.revertLog(el && el.getAttribute('data-id')); },
    'cloudLogToggleDiffs': (el) => { const C = window.MMGR.Cloud; if (C && C.toggleDiffs) C.toggleDiffs(el && el.getAttribute('data-id')); },
    'cloudDropEditor': () => { const C = window.MMGR.Cloud; if (C && C.dropEditor) C.dropEditor(); },
    // CLOUD-FIRST SYNC (PART 3, approved 2026-08-17): offline copies +
    // broadcast. cloudMakeCopy registers this device (view-only);
    // cloudUpdateCopy pulls the newest snapshot (no full reload);
    // cloudRemoveCopy unregisters; cloudBroadcast + cloudAutoBroadcast are
    // the owner's manual + automatic broadcast controls; cloudOfflineRemove
    // drops one registered copy from the owner's list.
    'cloudMakeCopy': () => { const C = window.MMGR.Cloud; if (C && C.cloudMakeCopy) C.cloudMakeCopy(); },
    'cloudUpdateCopy': () => { const C = window.MMGR.Cloud; if (C && C.cloudUpdateCopy) C.cloudUpdateCopy(); },
    'cloudRemoveCopy': () => { const C = window.MMGR.Cloud; if (C && C.cloudRemoveCopy) C.cloudRemoveCopy(); },
    'cloudBroadcast': () => { const C = window.MMGR.Cloud; if (C && C.cloudBroadcast) C.cloudBroadcast(); },
    'cloudAutoBroadcast': () => { const C = window.MMGR.Cloud; if (C && C.cloudAutoBroadcast) C.cloudAutoBroadcast(); },
    'cloudOfflineRemove': (el) => { const C = window.MMGR.Cloud; if (C && C.cloudOfflineRemove) C.cloudOfflineRemove(el && el.getAttribute('data-id')); },
    // REVIEW QUEUE (2026-08-17, approved "always on"): owner review list +
    // accept/reject decisions; cloudReviewMine is the editor's own status.
    'cloudReviewList': () => { const C = window.MMGR.Cloud; if (C && C.cloudReviewList) C.cloudReviewList(); },
    'cloudReviewMine': () => { const C = window.MMGR.Cloud; if (C && C.cloudReviewMine) C.cloudReviewMine(); },
    'cloudReviewAccept': (el) => { const C = window.MMGR.Cloud; if (C && C.cloudReviewAccept) C.cloudReviewAccept(el && el.getAttribute('data-id')); },
    'cloudReviewReject': (el) => { const C = window.MMGR.Cloud; if (C && C.cloudReviewReject) C.cloudReviewReject(el && el.getAttribute('data-id')); },
    'cloudReviewToggleDiffs': (el) => { const C = window.MMGR.Cloud; if (C && C.reviewToggleDiffs) C.reviewToggleDiffs(el && el.getAttribute('data-id')); },
    // IN-PROJECT DELETE (owner 2026-08-17): Settings > Controls > Danger
    // Zone , confirm modal + password verify + the owner-only soft delete.
    'cloudDeleteOpen': () => { const C = window.MMGR.Cloud; if (C && C.cloudDeleteOpen) C.cloudDeleteOpen(); },
    'cloudDeleteClose': () => { const C = window.MMGR.Cloud; if (C && C.cloudDeleteClose) C.cloudDeleteClose(); },
    'cloudDeleteConfirm': () => { const C = window.MMGR.Cloud; if (C && C.cloudDeleteConfirm) C.cloudDeleteConfirm(); },
    'cascadeGantt': () => window.MMGR.App.cascadeGantt(),
    'toggleCritical': (el) => window.MMGR.App.toggleCritical(el),
    'tglLeadtimeLane': (el) => window.MMGR.App.tglLeadtimeLane(el),
    'populateSprint': () => window.MMGR.App.populateSprint(),
    'openPrompt': (el) => window.MMGR.App.openPrompt(el.getAttribute('data-type')),
    'openDrwToSave': () => window.MMGR.App.openDrwToSave(),
    'openDrwToPrompts': (el) => window.MMGR.App.openDrwToPrompts(el.getAttribute('data-type')),
    'bkToggle': () => window.MMGR.App.bkToggle(),
    'bkCloud': () => window.MMGR.App.bkCloud(),
    // PART F T9 (no-offline-copy): export/download are refused while a cloud
    // share code is held , the recipient must not leave with the project file.
    'saveProjectFile': () => { if (window.MMGR.App && window.MMGR.App.cloudExportBlocked('saveProjectFile')) return; window.MMGR.App.saveProjectFile(); },
    'saveBaseline': () => window.MMGR.App.saveBaseline(),
    'restoreBaseline': () => window.MMGR.App.restoreBaseline(),
    'undo': () => window.MMGR.App.undo(),
    'redo': () => window.MMGR.App.redo(),
    'setRegion': (el) => window.MMGR.App.setRegion(el.value),
    'cfmOk': () => window.MMGR.App.cfmOk(),
    'cfmCancel': () => window.MMGR.App.cfmCancel(),
    'keepMine': () => window.MMGR.App.keepMine(),
    'keepTheirs': () => window.MMGR.App.keepTheirs(),
    'openOM': () => { if (window.MMGR.App && window.MMGR.App.cloudExportBlocked('openOM')) return; window.MMGR.App.openOM(); },
    'closeOM': () => window.MMGR.App.closeOM(),
    'cpOut': () => { if (window.MMGR.App && window.MMGR.App.cloudExportBlocked('cpOut')) return; window.MMGR.App.cpOut(); },
    'loadClip': () => window.MMGR.App.loadClip(),
    'openDrw': () => window.MMGR.App.openDrw(),
    'closeDrw': () => window.MMGR.App.closeDrw(),
    // DIR-3: Core-Mode onboarding callout , jump to the pack toggles / dismiss.
    'openPacks': () => window.MMGR.App.openPacks(),
    'dismissPacksCallout': () => window.MMGR.App.dismissPacksCallout(),
    'undoClr': () => window.MMGR.App.undoClr(),
    'closeMLC': () => window.MMGR.App.closeMLC(),
    'closeWbsImport': () => window.MMGR.Tasks.closeWbsImport(),
    'closeWbsImportBg': (el, e) => { if (e.target === el) window.MMGR.Tasks.closeWbsImport(); },
    'closeImportDates': () => window.MMGR.Tasks.closeImportDates(),
    'closeImportDatesBg': (el, e) => { if (e.target === el) window.MMGR.Tasks.closeImportDates(); },
    'addRaciTaskFromPicker': (el) => { window.MMGR.Raci.addRaciTaskFromPicker(el.value); el.value = ''; },
    'addRaciPersonFromPicker': (el) => { window.MMGR.Raci.addRaciPersonFromPicker(el.value); el.value = ''; },
    'cycleRaci': (el, ev) => window.MMGR.Raci.cycleRaci(
      el.getAttribute('data-task'),
      el.getAttribute('data-person'),
      ev
    ),
    // Settings panel
    'setUserName': (el) => window.MMGR.App.setUserName(el.value),
    'tglTheme': (el) => { window.MMGR.App.tglTheme(); },
    'tglCh': (el) => { window.MMGR.App.tglCh(); },
    'tglFlag': (el) => window.MMGR.App.tglFlag(el),
    'clearErrorLog': () => window.MMGR.App.clearErrorLog(),
    // DIR-1a/1b: error log export (view-only) + remote-reporting toggle/URL
    // (device-level preference, not project state).
    'copyErrorLog': () => window.MMGR.App.copyErrorLog(),
    'downloadErrorLog': () => window.MMGR.App.downloadErrorLog(),
    'tglErrReport': (el) => window.MMGR.App.tglErrReport(),
    // MASTER-ACTION-PLAN Rank 6.1 , sanitized report package (read-only).
    'reportIssueCopy': () => window.MMGR.App.reportIssueCopy(),
    'reportIssueDownload': () => window.MMGR.App.reportIssueDownload(),
    'tglReportContext': () => window.MMGR.App.tglReportContext(),
    'setErrWebhook': (el) => window.MMGR.App.setErrWebhook(el),
    // Rank 3.1: Core Mode vs Advanced Packs , toggling a pack mutates
    // state.packs (blocked in view-only, like every other write). Same
    // checkbox convention as tglFlag: Chrome has already flipped `checked`
    // before this runs, so read it as-is (no manual flip, no preventDefault).
    'tglPack': (el) => {
      const pack = el.getAttribute('data-pack');
      if (!pack) return;
      const on = el.type === 'checkbox' ? el.checked : (window.MMGR.State.getState().packs && window.MMGR.State.getState().packs[pack] !== false);
      window.MMGR.State.updateState(function(s) {
        if (!s.packs) s.packs = {};
        s.packs[pack] = on;
        // DIR-3: once any pack has EVER been turned on, the Core-Mode nudge
        // stays hidden forever even if every pack is switched off again.
        if (on) s.packsEverEnabled = true;
      });
      if (window.MMGR.Render && window.MMGR.Render.renderPacks) window.MMGR.Render.renderPacks();
      if (window.MMGR.Render && window.MMGR.Render.syncPackChips) window.MMGR.Render.syncPackChips();
      if (window.MMGR.App && window.MMGR.App.showToast) {
        window.MMGR.App.showToast('Advanced pack ' + pack + ' turned ' + (on ? 'on' : 'off') + '.', 'ok');
      }
    },
    'tglLock': () => window.MMGR.App.tglLock(),
    'setWorkWeek': (el) => window.MMGR.App.setWorkWeek(el.value),
    'loadProjectFileClick': () => { document.getElementById('load-file').click(); },
    'loadProjectFile': (el) => window.MMGR.App.loadProjectFile({ target: el }),
    'mergeProjectFileClick': () => { document.getElementById('merge-file').click(); },
    'mergeProjectFile': (el) => window.MMGR.App.mergeProjectFile({ target: el }),
    'print': () => window.print(),
    // Charter fields
    'updCharter': (el) => {
      const field = el.getAttribute('data-charter-field');
      window.MMGR.Charter.updCharter(field, el.value);
    },
    // Closure fields
    'updClose': (el) => {
      const field = el.getAttribute('data-close-field');
      window.MMGR.Closure.updClose(field, el.value);
    },
    // Hold-to-clear is driven by pointerdown/pointerup delegation below,
    // NOT by click , a plain click must never start the hold countdown.
    // Drag and drop (Kanban)
    'dragDrop': (el) => {
      // Handled by special drag/drop event listeners
    },
    // Hold-to-clear runs on pointerdown delegation (never click), so the
    // click path is an explicit no-op , enforced by the headless audit.
    'startHold': () => {}, // pointerdown-only
    // Jump to timeline
    'jumpToDashTimeline': () => window.MMGR.App.jumpToDashTimeline(),
    // Generic field update for dynamic render templates (WBS, risks, etc.)
    // evtType ('input' vs 'change') is forwarded so table-rendering updaters
    // can save on keystroke but defer the re-render to blur/commit , a
    // re-render on every keystroke destroys the focused input (browser-verified).
    'updTaskField': (el, e) => {
      const id = el.getAttribute('data-id');
      const field = el.getAttribute('data-field');
      window.MMGR.Tasks.updTaskField(id, field, el.value, e && e.type);
    },
    'updKPI': (el) => {
      const idx = parseInt(el.getAttribute('data-idx'));
      const field = el.getAttribute('data-field');
      window.MMGR.Charter.updKPI(idx, field, el.value);
    },
    'updKPILink': (el) => window.MMGR.Charter.updKPILink(parseInt(el.getAttribute('data-idx')), el.value),
    'updKPIDir': (el) => window.MMGR.Charter.updKPIDir(parseInt(el.getAttribute('data-idx')), el.value),
    'updRaciTask': (el) => window.MMGR.Raci.updRaciTask(parseInt(el.getAttribute('data-idx')), el.value),
    'updRaciPerson': (el) => window.MMGR.Raci.updRaciPerson(parseInt(el.getAttribute('data-idx')), el.getAttribute('data-field'), el.value),
    'delRaciTask': (el) => window.MMGR.Raci.delRaciTask(parseInt(el.getAttribute('data-idx'))),
    'delRaciPerson': (el) => window.MMGR.Raci.delRaciPerson(parseInt(el.getAttribute('data-idx'))),
    'collapseAll': () => window.MMGR.Tasks.collapseAll(),
    'expandAll': () => window.MMGR.Tasks.expandAll(),
    'tglMilestone': (el) => window.MMGR.Tasks.tglMilestone(el.getAttribute('data-id')),
    'runMonteCarlo': () => window.MMGR.Schedule.runMonteCarlo(),
    'tglDMAICPhase': (el) => window.MMGR.Dmaic.tglDMAICPhase(el.getAttribute('data-phase')),
    'updDMAIC': (el) => window.MMGR.Dmaic.updDMAIC(el.getAttribute('data-phase'), el.getAttribute('data-field'), el.value),
    'uploadCharterDoc': () => window.MMGR.Charter.uploadCharterDoc(),
    'handleCharterUpload': (el) => window.MMGR.Charter.handleCharterUpload({ target: el }),
    'cuSwitchTab': (el) => window.MMGR.Charter.cuSwitchTab(el.getAttribute('data-which')),
    'addSpendEntry': () => window.MMGR.Spend.addSpendEntry(),
    'updSpendEntry': (el, e) => window.MMGR.Spend.updSpendEntry(parseInt(el.getAttribute('data-idx')), el.getAttribute('data-field'), el.value, e && e.type),
    'delSpendEntry': (el) => window.MMGR.Spend.delSpendEntry(parseInt(el.getAttribute('data-idx'))),
    // Meetings
    'startMeeting': (el) => window.MMGR.Meetings.startMeeting(el.getAttribute('data-kind')),
    'copyMeetingTemplate': (el) => window.MMGR.Meetings.copyMeetingTemplate(el.getAttribute('data-kind')),
    'openMeetPrompt': () => window.MMGR.Meetings.openMeetPrompt(),
    'tglMeetItem': (el) => window.MMGR.Meetings.tglMeetItem(parseInt(el.getAttribute('data-idx'))),
    'updMeetItemNote': (el) => window.MMGR.Meetings.updMeetItemNote(parseInt(el.getAttribute('data-idx')), el.value),
    'updMeetField': (el) => window.MMGR.Meetings.updMeetField(el.getAttribute('data-field'), el.value),
    'endMeeting': () => window.MMGR.Meetings.endMeeting(),
    'cancelActiveMeeting': () => window.MMGR.Meetings.cancelActiveMeeting(),
    'copyMeetingMinutes': (el) => window.MMGR.Meetings.copyMeetingMinutes(parseInt(el.getAttribute('data-id'))),
    // T6 (2026-08-16): delete a concluded meeting with undo. MUTATING , 
    // deliberately absent from READONLY_SAFE_ACTIONS (view-only scopes refuse).
    'delMeeting': (el) => window.MMGR.Meetings.delMeeting(parseInt(el.getAttribute('data-id'))),
    'undoDelMeeting': () => window.MMGR.Meetings.undoDelMeeting(),
    'tglPromise': (el) => window.MMGR.Meetings.tglPromise(el.getAttribute('data-kind'), parseInt(el.getAttribute('data-idx'))),
    // Rank 1.5: meeting voice capture (mutates state , NOT in READONLY_SAFE_ACTIONS)
    'voiceStartCapture': () => window.MMGR.Voice.startCapture(),
    'voiceStopCapture': () => window.MMGR.Voice.stopCapture(),
    'voiceDiscardCapture': () => window.MMGR.Voice.discardCapture(false),
    // Tier 1: manual offline whisper transcription / retry (mutates state , blocked in view-only)
    'voiceTranscribeOffline': () => window.MMGR.Voice.transcribeOffline(),
    'voiceRecoverDismiss': () => window.MMGR.Voice.dismissRecovery(),
    'updField': (el, e) => {
      const module = el.getAttribute('data-module');
      const field = el.getAttribute('data-field');
      const idx = parseInt(el.getAttribute('data-idx'));
      const val = el.type === 'checkbox' ? el.checked : el.value;
      // Explicit module → { namespace, updater } map. No string surgery, so
      // a new module can never silently route to the wrong function.
      const MODULE_UPDATERS = {
        'Risks':        { ns: 'Risks', fn: 'updRisk' },
        'Issues':       { ns: 'Risks', fn: 'updIssue' }, // Issues live in Risks
        'Resources':    { ns: 'Resources', fn: 'updResource' },
        'Budget':       { ns: 'Budget', fn: 'updBudgetLine' },
        'Stakeholders': { ns: 'Stakeholders', fn: 'updStake' },
        'Changes':      { ns: 'Changes', fn: 'updChange' },
        'Log':          { ns: 'Log', fn: 'updLog' },
        // CloseItems' updater takes (index, done) , no field parameter.
        'CloseItems':   { ns: 'Closure', fn: 'updCloseItem', doneOnly: true },
        'Comms':        { ns: 'Comms', fn: 'updComms' },
        'Documents':    { ns: 'Documents', fn: 'updDoc' },
        // MARKET-FEATURE-ROADMAP C1/C2/C3: RFI + Submittal + Punch List
        // registries (state mutations , never READONLY_SAFE).
        'Rfis':         { ns: 'Rfis', fn: 'updRfi' },
        'Submittals':   { ns: 'Submittals', fn: 'updSubmittal' },
        'PunchList':    { ns: 'PunchList', fn: 'updPunch' },
        // MARKET-FEATURE-ROADMAP Section C batch 2 (state mutations , never
        // READONLY_SAFE).
        'PayApps':      { ns: 'PayApps', fn: 'updPayApp' },
        'Inspections':  { ns: 'Inspections', fn: 'updInspection' },
        'Incidents':    { ns: 'Incidents', fn: 'updIncident' },
        'Handover':     { ns: 'Handover', fn: 'updHandoverItem' },
        'Warranty':     { ns: 'Warranty', fn: 'updWarranty' },
        'DrawingLog':   { ns: 'DrawingLog', fn: 'updDrawLog' },
        'Permits':      { ns: 'Permits', fn: 'updPermit' },
        'Procurement':  { ns: 'Procurement', fn: 'updProcurement' },
        'TimeTracking': { ns: 'TimeTracking', fn: 'updTimeEntry' },
        'Equipment':    { ns: 'Equipment', fn: 'updEquipment' }
      };
      const target = MODULE_UPDATERS[module];
      if (!target) { console.warn('updField: no updater mapped for module "' + module + '"'); return; }
      const updater = window.MMGR[target.ns] && window.MMGR[target.ns][target.fn];
      if (typeof updater !== 'function') { console.warn('updField: ' + target.ns + '.' + target.fn + ' is not a function'); return; }
      // evtType forwarded (see 'updTaskField'): table-rendering updaters save
      // on `input` keystrokes and re-render on `change` so focus is kept.
      const evtType = e && e.type;
      if (target.doneOnly) {
        updater(idx, val, evtType);
      } else {
        updater(idx, field, val, evtType);
      }
    }
  };

  // ACTION-PLAN 4.1: read-only gate , the ONLY actions allowed in a
  // view-only scope are non-mutating ones (navigation, copy, print, drawer
  // views, report generation). Everything else is refused with a toast.
  const READONLY_SAFE_ACTIONS = {
    'showSec': 1, 'cpAllPage': 1, 'print': 1, 'openDrw': 1, 'closeDrw': 1,
    // T8 bids rebuild: opening a proposal link / composing a clarification
    // email and dismissing the Add Bid Package modal never mutate state.
    'bidProposal': 1, 'bidClarify': 1, 'closeBidPkg': 1, 'closeBidPkgBg': 1,
    'swDtab': 1, 'openDrwToPrompts': 1, 'openDrwToSave': 1,
    'jumpToDashTimeline': 1, 'closeMLC': 1, 'openMeetPrompt': 1,
    'copyMeetingMinutes': 1, 'runMonteCarlo': 1, 'undoClr': 1,
    // MONOLITH-FEATURE-PARITY-DIRECTIVES restorations: risk matrix filtering,
    // WBS issues banner toggle, Import Dates Copy List, email templates, and
    // Print Charter are ALL view-only. saveCharter mutates state and stays
    // blocked in view-only (deliberately not listed here).
    'riskMatrixCell': 1, 'riskMatrixClear': 1, 'tglWbsIssues': 1,
    'copyIdTemplate': 1, 'emailTpl': 1, 'printCharter': 1,
    // Phase 7: wxRefresh (view the forecast) + wxCopyNotice (copy text) are
    // read-only; wxGeocode writes the site location config and wxLogToday /
    // wxLogManual write the LD-claim weather log , all stay blocked in
    // view-only mode. meetSentiment and tglLeadtimeReview mutate state too.
    'wxRefresh': 1, 'wxCopyNotice': 1,
    // Rank 3.1: tglPack mutates state.packs -> stays blocked in view-only.
    // Rank 1.1: claimGenerate composes a read-only package; claimSetCause
    // mutates slip tags and stays blocked in view-only mode.
    'claimGenerate': 1,
    // Rank 2.1: digestGenerate composes a read-only summary; digestPin writes
    // the reference snapshot and stays blocked in view-only mode.
    'digestGenerate': 1,
    // AI window: open/close/load/copy/attach are read-only. Rank 2.3's
    // aiRunPreset/aiRun WRITE state.aiOutputs and aiSet* writes state.config
    // , all correctly stay BLOCKED in view-only mode.
    'openAiWin': 1, 'closeAiWin': 1, 'closeAiWinBg': 1, 'aiPreset': 1,
    'aiAttachContext': 1, 'aiCopy': 1, 'aiClear': 1, 'aiCopyOut': 1,
    // Rank 1.5: dismissRecovery only hides a local chip (module flag + DOM)
    // , non-mutating, safe in view-only mode. The three capture actions
    // (voiceStartCapture/voiceStopCapture/voiceDiscardCapture) DO mutate
    // state and correctly stay blocked.
    'voiceRecoverDismiss': 1,
    // Rank 3.4: viewport preference is a device-level screen choice, not
    // project state , allowed in view-only (like theme is a preference, but
    // this one intentionally stays out of project state entirely).
    'vpAccept': 1, 'vpDismiss': 1, 'vpFull': 1,
    // Rank 3.5: glass preference is a device-level screen choice, not
    // project state , allowed in view-only like the viewport prefs.
    'tglGlassMode': 1,
    // Theme-persistence: the theme preference is a device-level choice too
    // (localStorage mmgr_theme, the same slot the launcher + admin read) , 
    // allowed in view-only like glass mode. tglTheme writes only the device
    // pref + body class in view-only; the per-project state write is skipped.
    'tglTheme': 1,
    // THEME-SYSTEM-AND-MOBILE-UI-ACTION-PLAN §4.2: the mobile nav drawer is
    // pure device-UI chrome (body.nav-open class only) , never project state.
    // SIDEBAR-HAMBURGER-TOGGLE-PLAN: the sidebar toggle is the same kind of
    // pure device-UI chrome (body.sidebar-on + localStorage pref).
    'tglNav': 1, 'tglSidebar': 1, 'tglSidebarOpen': 1, 'bkToggle': 1, 'bkCloud': 1,
    // DIR-1a/1b: copying/downloading the error log is read-only; the
    // remote-reporting toggle + webhook URL are device-level preferences
    // (localStorage, like the glass mode toggle) , never project state.
    'copyErrorLog': 1, 'downloadErrorLog': 1, 'tglErrReport': 1, 'setErrWebhook': 1,
    // MASTER-ACTION-PLAN Rank 6.1: building/copying/downloading the report
    // is read-only; the context toggle is a session-only UI pref.
    'reportIssueCopy': 1, 'reportIssueDownload': 1, 'tglReportContext': 1,
    // Rank 4.5: Google identity is a device-level label, never a gate to
    // project data , signing in/out/dismissing never mutates project state.
    'syncConnect': 1, 'syncSignOut': 1, 'syncClientId': 1, 'syncDismissSuggest': 1,
    // GOOGLE-DRIVE-BACKUP: backup is export-equivalent (reads the workspace,
    // writes Drive + a device pref) and the auto-interval + backup passphrase
    // are device-level preferences (localStorage / sessionStorage, never
    // project state) , safe in view-only, like claimGenerate / digestGenerate
    // / runMonteCarlo above. Restore is DELIBERATELY excluded: it overwrites
    // local workspace, exactly like import, so it stays blocked in view-only.
    'driveBackup': 1, 'driveAutoInterval': 1, 'driveSetPass': 1,
    // CLOUD-BACKEND-ARCHITECTURE-PLAN Phase 1: cloud create/save/recover/
    // copy/sign-in never mutate the local workspace (they push to the server
    // or manage session-only credentials) , safe in view-only, exactly like
    // driveBackup above. Load is DELIBERATELY excluded: it overwrites the
    // local workspace like driveRestore/import, so it stays blocked in
    // view-only.
    'cloudCreate': 1, 'cloudUpgrade': 1, 'cloudResendVerify': 1, 'cloudSave': 1, 'cloudRecover': 1, 'cloudCopyCode': 1, 'cloudSignIn': 1,
    // CLOUD-BACKEND-ARCHITECTURE-PLAN Phase 2/3: editor-code management and
    // changelog view/revert never mutate the local workspace (owner-only
    // server calls; a revert changes the CLOUD snapshot, not this device) , 
    // safe in view-only, like the Phase 1 cloud entries above.
    'cloudEditorCreate': 1, 'cloudEditorList': 1, 'cloudEditorRevoke': 1,
    'cloudLogList': 1, 'cloudLogRevert': 1, 'cloudLogToggleDiffs': 1, 'cloudDropEditor': 1,
    // GAP-AUDIT-CLOUD-31: unlink only mutates the CLOUD copy (like the other
    // cloud actions above), and the banner Copy/Done are clipboard/session
    // only , all safe in view-only.
    'cloudUnlink': 1, 'cloudCopyEditorCode': 1, 'cloudEditorCodeDone': 1,
    // MASTER-ACTION-PLAN RANK 9.2: webhook CRUD only mutates the SERVER
    // subscription table (like the other cloud actions) , safe in view-only.
    'cloudWebhookList': 1, 'cloudWebhookAdd': 1, 'cloudWebhookDel': 1,
    // CLOUD-FIRST SYNC (PART 3, approved 2026-08-17): offline copies +
    // broadcast. cloudMakeCopy registers this device server-side (view-only
    // by owner decision , the copy can never edit), cloudUpdateCopy pulls the
    // newest snapshot into the copy (overwriting a VIEW-ONLY snapshot is
    // always safe , no local edits exist to lose), cloudRemoveCopy
    // unregisters, and the owner's broadcast/auto-broadcast/offline-list
    // controls only mutate SERVER state or the copy registry , all safe in
    // view-only mode, exactly like the other cloud actions above.
    'cloudMakeCopy': 1, 'cloudUpdateCopy': 1, 'cloudRemoveCopy': 1,
    'cloudBroadcast': 1, 'cloudAutoBroadcast': 1, 'cloudOfflineRemove': 1,
    // REVIEW QUEUE: the review list/accept/reject/mine actions only mutate
    // SERVER state (proposals + the cloud snapshot on accept) , never the
    // local workspace , so they stay safe in view-only mode like broadcast.
    'cloudReviewList': 1, 'cloudReviewMine': 1, 'cloudReviewAccept': 1, 'cloudReviewReject': 1, 'cloudReviewToggleDiffs': 1
  };
  function guardReadonly(action) {
    // The ACTION_MAP delegation IIFE has no closure over the App module's
    // isReadonly() , route through the published API (MMGR.App.isReadonly).
    const ro = window.MMGR.App && typeof window.MMGR.App.isReadonly === 'function' && window.MMGR.App.isReadonly();
    if (!ro) return true;
    if (READONLY_SAFE_ACTIONS[action]) return true;
    if (window.MMGR.App && typeof window.MMGR.App.showToast === 'function') {
      window.MMGR.App.showToast('View-only mode , read-only access. Contact the admin for full access.', 'err');
    }
    return false;
  }

  // Click event delegation
  document.addEventListener('click', function(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    // P0 ("the dates are fighting me" , real-click path): editable field
    // controls (text/date inputs, selects, textareas) own their change/input
    // events; the delegated change/input listeners below are their ONLY
    // handlers. Firing their data-action on every click would re-render the
    // WBS row or derived panels mid-click (select dropdowns close, the native
    // date picker never opens because preventDefault suppresses the default
    // click action, and the next field is unclickable until the churn
    // settles). File inputs are skipped too so the native open-dialog default
    // is never prevented. Checkboxes keep their special-case handling below
    // (their click IS the action).
    const _tag = el.tagName;
    if (_tag === 'SELECT' || _tag === 'TEXTAREA' ||
        (_tag === 'INPUT' && el.type !== 'checkbox' && el.type !== 'radio' && el.type !== 'button')) {
      return;
    }
    const action = el.getAttribute('data-action');
    if (!guardReadonly(action)) {
      // View-only rejection: Chrome has already flipped a checkbox's `checked`
      // before this handler runs, so revert it , otherwise the switch would
      // visually toggle while the state it controls stays unchanged (audit
      // 1.2 / 1.3 , the AI master switch, tglPack, tglFlag all behave this way).
      if (el.tagName === 'INPUT' && el.type === 'checkbox') el.checked = !el.checked;
      return;
    }
    const handler = ACTION_MAP[action];
    if (handler) {
      if (el.tagName === 'INPUT' && el.type === 'checkbox') {
        // CRITICAL (browser-verified): Chrome toggles checkbox `checked` when
        // the click event is DISPATCHED , i.e. BEFORE this listener runs , and
        // a subsequent preventDefault() REVERTS it to the original value.
        // The old flip-then-preventDefault pattern therefore double-toggled
        // back to the pre-click value, leaving theme/crosshair/milestone
        // checkboxes dead. Fix: read the already-updated value as-is and let
        // the native toggle stand (no manual flip, no preventDefault).
        handler(el, e);
        return;
      }
      e.preventDefault();
      handler(el, e);
    }
  });

  // Change event delegation for input/select elements
  document.addEventListener('change', function(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.getAttribute('data-action');
    if (!guardReadonly(action)) return;
    const handler = ACTION_MAP[action];
    // CLAUDE-BUG-AUDIT (2026-08-11) #1: syncClientId is a type-then-blur text
    // field (Google OAuth Client ID) , it was missing from this change
    // whitelist, so the value sat in the box but was never persisted.
    // `change` is the correct event for a one-time paste/type-then-blur field.
    if (handler && (action === 'updEnvelope' || action === 'saveSprint' || action === 'setWorkWeek' || action === 'setRegion' || action === 'loadProjectFile' || action === 'mergeProjectFile' || action === 'updCharter' || action === 'updClose' || action === 'setUserName' || action === 'addRaciTaskFromPicker' || action === 'addRaciPersonFromPicker' || action === 'updField' || action === 'updTaskField' || action === 'updKPI' || action === 'updKPILink' || action === 'updKPIDir' || action === 'updSpendEntry' || action === 'updRaciTask' || action === 'updRaciPerson' || action === 'claimSetCause' || action === 'aiSetTier' || action === 'setErrWebhook' || action === 'driveAutoInterval' || action === 'driveSetPass' || action === 'syncClientId' || action === 'bidPkgUpd' || action === 'bidSubUpd' || action === 'bidLineUpd' || action === 'bidAmount' || action === 'gonogoUpd' || action === 'gonogoCatUpd' || action === 'gonogoCritUpd' || action === 'updInspItem')) {
      handler(el, e);
    }
  });

  // Rank 3.1: tglPack chips are checkboxes , the click delegation handles
  // them (checkbox click IS the action), and the action map entry above flips
  // state.packs. No change/input whitelist entry needed.

  // Input event delegation for textarea/input elements
  document.addEventListener('input', function(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.getAttribute('data-action');
    if (!guardReadonly(action)) return;
    const handler = ACTION_MAP[action];
    if (handler && (action === 'updCharter' || action === 'updClose' || action === 'setUserName' || action === 'updEnvelope' || action === 'wiPreview' || action === 'idPreview' || action === 'regenChartPrompt' || action === 'updField' || action === 'updTaskField' || action === 'updKPI' || action === 'updSpendEntry' || action === 'updRaciTask' || action === 'updRaciPerson' || action === 'updDMAIC' || action === 'updMeetItemNote' || action === 'updMeetField' || action === 'handleCharterUpload' || action === 'setErrWebhook' || action === 'bidPkgUpd' || action === 'bidSubUpd' || action === 'bidLineUpd' || action === 'bidAmount' || action === 'gonogoUpd' || action === 'gonogoCatUpd' || action === 'gonogoCritUpd' || action === 'updInspItem')) {
      handler(el, e);
    }
  });

  // 5.2 Definitions tooltips: any element with data-def="<term>" shows the
  // glossary entry on hover. Delegated mouseover/out , zero inline handlers.
  document.addEventListener('mouseover', function(e) {
    const el = e.target.closest && e.target.closest('[data-def]');
    if (el) window.MMGR.App.showDefTip(el, el.getAttribute('data-def'));
  });
  document.addEventListener('mouseout', function(e) {
    const el = e.target.closest && e.target.closest('[data-def]');
    if (el) window.MMGR.App.hideDefTip();
  });

  // RACI right-click cycles backward (feature 5) , contextmenu must be
  // prevented so the browser's menu never appears over the matrix.
  document.addEventListener('contextmenu', function(e) {
    const cell = e.target.closest && e.target.closest('[data-action="cycleRaci"]');
    if (cell) {
      e.preventDefault();
      window.MMGR.Raci.cycleRaci(cell.getAttribute('data-task'), cell.getAttribute('data-person'), { button: 2 });
    }
  });

  // RACI picker refresh on mousedown
  document.addEventListener('mousedown', function(e) {
    const el = e.target.closest('[data-action="addRaciTaskFromPicker"], [data-action="addRaciPersonFromPicker"]');
    if (el) {
      const action = el.getAttribute('data-action');
      if (action === 'addRaciTaskFromPicker') {
        window.MMGR.Raci.refreshRaciTaskPicker();
      } else if (action === 'addRaciPersonFromPicker') {
        window.MMGR.Raci.refreshRaciPersonPicker();
      }
    }
  });

  // MLC hover handling (mouseenter/mouseleave on meth buttons)
  // e.target can be the document node when synthetic/edge events fire , 
  // guard every closest() so hover handling never throws.
  document.addEventListener('mouseenter', function(e) {
    const el = e.target && e.target.closest ? e.target.closest('[data-mlc]') : null;
    if (el) {
      window.MMGR.App.showMLC(el.getAttribute('data-mlc'));
    }
  }, true);

  document.addEventListener('mouseleave', function(e) {
    const el = e.target && e.target.closest ? e.target.closest('[data-mlc]') : null;
    if (el) {
      window.MMGR.App.scheduleMLCClose();
    }
  }, true);

  // MLC card hover , keep open
  document.addEventListener('mouseenter', function(e) {
    if (e.target && e.target.closest && e.target.closest('#meth-learn-card')) {
      window.MMGR.App.clearMlcTimer();
    }
  }, true);

  document.addEventListener('mouseleave', function(e) {
    if (e.target && e.target.closest && e.target.closest('#meth-learn-card')) {
      window.MMGR.App.scheduleMLCClose();
    }
  }, true);

  // Kanban drag and drop
  document.addEventListener('dragstart', function(e) {
    const el = e.target.closest('[data-drag-id]');
    if (el) {
      window.MMGR.App.dragCard(e, el.getAttribute('data-drag-id'));
    }
  });

  document.addEventListener('dragover', function(e) {
    const col = e.target.closest('[data-drop-status]');
    if (col) {
      e.preventDefault();
      col.classList.add('dov');
    }
  });

  document.addEventListener('dragleave', function(e) {
    const col = e.target.closest('[data-drop-status]');
    if (col) {
      col.classList.remove('dov');
    }
  });

  document.addEventListener('drop', function(e) {
    const col = e.target.closest('[data-drop-status]');
    if (!col) return;
    e.preventDefault();
    const status = col.getAttribute('data-drop-status');
    if (status === 'leadtime') {
      window.MMGR.App.dropCardLeadtime(e);
    } else {
      window.MMGR.App.dropCard(e, status);
    }
  });

  // Hold-to-clear: start the hold on pointer down; cancel on release,
  // pointer cancel, leaving the button, or window blur. cancelHold is a
  // no-op when no hold is active, so these may be global listeners.
  document.addEventListener('pointerdown', function(e) {
    const el = e.target.closest('[data-action="startHold"]');
    if (el) window.MMGR.App.startHold(el.getAttribute('data-section'));
  });

  // Release anywhere cancels , cancelHold is a no-op when nothing is held,
  // so no closest() gating is needed (and it covers releases over other
  // elements, re-rendered buttons, and pointer-capture edge cases).
  document.addEventListener('pointerup', () => window.MMGR.App.cancelHold());

  document.addEventListener('pointercancel', () => window.MMGR.App.cancelHold());

  document.addEventListener('mouseleave', function(e) {
    if (e.target.closest && e.target.closest('[data-action="startHold"]')) window.MMGR.App.cancelHold();
  }, true);

  window.addEventListener('blur', () => window.MMGR.App.cancelHold());
})();