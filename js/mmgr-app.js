/* ============================================================
   My MaNaGeR — Application Controller Module
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

  // ---- Access Gate ----
  // Full codes set mmgr_unlocked_<id>='1'. A VIEW-ONLY code (ACTION-PLAN
  // 4.1) sets the same unlock flag PLUS mmgr_scope_<id>='readonly' — the
  // project opens in a reduced, non-editable view. Both paths are
  // client-side localStorage (simulated backend), matching the existing
  // SHA-256 model; the plaintext code never leaves the browser.
  // ---- DIR-1 (ADMIN-PUBLISH-SYNC-AND-PROJECT-SELECT-POLISH): local-first
  // creator access. A project id present in this device's admin working list
  // (localStorage mmgr_admin_projects) is owned HERE — the creator's own
  // access must never depend on the publish/deploy step, which gates only
  // OTHER people's access. Locally-owned projects open with full scope, no
  // code re-entry, even on a deep link straight to project.html.
  // Security note: this is exactly equivalent to the pre-existing ability to
  // set mmgr_unlocked_<id> directly in localStorage — convenience protection
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
    // always full scope — the creator is never gated by a code they set.
    ns.scope = locallyOwned ? 'full' : (localStorage.getItem('mmgr_scope_' + projectId) === 'readonly' ? 'readonly' : 'full');
    return true;
  }

  function isReadonly() { return ns.scope === 'readonly'; }

  // ---- Init ----
  function init() {
    if (!checkAccess()) return;

    ns.State.load();

    const s = S();

    // ACTION-PLAN 4.1: view-only scope — reduced read-only view. The body
    // class + banner are the visible state; the delegated event guards below
    // block every mutating data-action, while navigation / Copy All / Print
    // keep working.
    if (isReadonly()) {
      document.body.classList.add('readonly-mode');
      const banner = U.$('readonly-banner');
      if (banner) banner.classList.remove('is-hide');
    }

    // Apply theme — light is the default; dark is opt-in. The device-level
    // preference (localStorage mmgr_theme — the same slot the launcher and
    // admin read, and the same slot tglTheme writes) is the MASTER so the
    // choice made anywhere persists everywhere; per-project state.theme is
    // the portable fallback for a fresh device or an imported project file.
    const thmTgl = U.$('thm-tgl');
    let theme = s.theme || 'light';
    try { theme = localStorage.getItem('mmgr_theme') || theme; } catch (e) { /* ignore */ }
    if (theme === 'dark') {
      document.body.classList.add('dark-mode');
      if (thmTgl) thmTgl.checked = false;
    } else {
      document.body.classList.remove('dark-mode');
      if (thmTgl) thmTgl.checked = true;
    }
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
    // OWNER 2026-08-15: the sidebar IS the view on desktop — boot the pinned
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

    // Rank 4.2: crash-durability journal restore — if the IndexedDB journal
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

    // OWNER 2026-08-15: background cloud auto-sync — once the user goes
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
        // focus — guard so the shortcut never throws.
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
        if (ns.Charter) { ns.Charter.closeChartUp(); }
        if (ns.WbsImport) { ns.WbsImport.closeWbsImport(); }
        if (ns.ImportDates) { ns.ImportDates.closeImportDates(); }
        if (ns.AiWin) { ns.AiWin.close(); }
      }
    });

    // PLAN-OF-ACTION-LIQUID-GLASS-UI 3.5.2/3.5.4: apply the glass engine on
    // boot if the device preference + capability floor allow it. Also sync
    // the settings toggle's checked state to the stored preference. The
    // engine is dynamically imported and only then — zero cost otherwise.
    if (ns.Viewport && ns.Viewport.getGlassMode) {
      const gt = U.$('glass-tgl');
      if (gt) gt.checked = ns.Viewport.getGlassMode() === 'premium';
    }
    if (ns.Glass && ns.Glass.sync) ns.Glass.sync();

    // DIR-1b: reflect the device-level remote-error-reporting preference
    // (localStorage slot, like the glass mode toggle above — never project
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
    // into the Controls drawer (project.html only — app.html uses its
    // auth-bar controls). Same zero-throw guard as the sync section above.
    if (ns.GoogleAuth && ns.GoogleAuth.renderDriveSection) ns.GoogleAuth.renderDriveSection();

    // CLOUD-BACKEND-ARCHITECTURE-PLAN Phase 1: render the optional Cloud
    // Backup (D1 + R2 owner-code storage) section into the Controls drawer.
    // Strictly additive and never gating — the module no-ops without
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
    // portable export still carries the theme for fresh devices — but that
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
  // the shared device-preference slot (localStorage — NOT project state, so
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
      ? (effective === 'premium' ? 'Premium visual mode on — liquid-glass backdrop active.' : 'Preference saved — this device uses CSS glass (capability floor).')
      : 'Premium visual mode off — CSS glass stays on.',
      effective === 'premium' ? 'ok' : 'warn');
  }

  // ---- THEME-SYSTEM-AND-MOBILE-UI-ACTION-PLAN §4.2: mobile nav drawer ----
  // Hamburger + scrim toggle body.nav-open, which slides the .sec-nav off-canvas
  // drawer in/out on ≤768px (desktop ignores the class — the nav stays sticky).
  // BUG-9: on desktop, the hamburger opens the #app-sidebar overlay instead.
  // The drawer closes on: scrim tap (same action), any section button, Escape,
  // and a viewport resize back to desktop width.
  let _navBound = false;
  function closeNav() {
    document.body.classList.remove('nav-open');
    // OWNER 2026-08-15: on desktop the sidebar is the pinned primary nav —
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
      // Escape also closes the desktop pinned rail — full-screen work, the
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
  // always available, no pref gate — the overlay is transient, not pinned).
  function tglNav() {
    bindNavDismiss();
    const btn = U.$('nav-btn');
    if (window.innerWidth <= 768) {
      const open = document.body.classList.toggle('nav-open');
      if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      // BUG-10: the mobile off-canvas drawer is the same overflow scroll
      // container as the desktop sidebar — reset it to the top on open too,
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
  // 'off' — current users see zero change until they opt in), persisted to the
  // same session-gated R2 prefs blob as the theme (worker.js /api/cloud/prefs/
  // theme gains a sidebar field) so a signed-in account's layout follows across
  // devices. The sidebar itself is desktop-only (≤768px the existing .sec-nav
  // drawer remains the only mobile nav). Pure device-UI chrome — never project
  // state, safe in view-only mode.
  const SIDEBAR_KEY = 'mmgr_sidebar';
  let _sidebarUserTouched = false;

  function readDevicePref(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function writeDevicePref(key, v) { try { localStorage.setItem(key, v); } catch (e) {} }

  // OWNER 2026-08-15: the sidebar is the ONLY desktop view — the legacy
  // mmgr_sidebar pref no longer gates it. body.sidebar-on is therefore always
  // applied; body.sidebar-open is the rail's transient open/closed state.
  function sidebarEnabled() { return true; }

  // Reflect the pref onto <body> + the settings toggle. aria-expanded is
  // VIEWPORT-AWARE: on mobile it tracks the drawer (tglNav owns it there);
  // on desktop it tracks the overlay's temporary open state.
  // BUG-9: the hamburger is always visible on desktop regardless of pref.
  function syncSidebarChrome() {
    const on = sidebarEnabled();
    document.body.classList.toggle('sidebar-on', on);
    // BUG-10 (2026-08-14): the overlay sidebar must ALWAYS open at the top.
    // visibility:hidden does NOT reset an overflow scroll container, so a
    // previously-scrolled sidebar would re-open mid-list (Governance/Closeout/
    // DMAIC visible, Overview hidden above the fold). Reset whenever the
    // overlay is open — covers every open path (hamburger, settings toggle,
    // backend pull, boot-with-pref) in one place, idempotently.
    if (document.body.classList.contains('sidebar-open')) {
      const sb = U.$('app-sidebar');
      if (sb) sb.scrollTop = 0;
    }
    const btn = U.$('nav-btn');
    if (btn) {
      const mobile = window.innerWidth <= 768;
      btn.setAttribute('aria-expanded', mobile ? 'false' : (document.body.classList.contains('sidebar-open') ? 'true' : 'false'));
      btn.setAttribute('aria-controls', mobile ? 'sec-nav' : 'app-sidebar');
    }
    const tgl = U.$('sb-tgl');
    if (tgl) tgl.checked = on;
  }

  // BUG-9: temporary open/close of the overlay sidebar (hamburger, × button,
  // Escape, section click). The overlay is always available on desktop — no
  // pref gate. The persisted layout preference (sidebar-on) is kept for
  // backward compat but no longer controls hamburger visibility.
  function setSidebarOpen(open) {
    document.body.classList.toggle('sidebar-open', !!open);
    syncSidebarChrome();
  }

  // BUG-9: Preference toggle (settings switch) now controls whether the
  // sidebar overlay opens by DEFAULT on page load. Turning it on opens the
  // overlay; turning it off closes it. The hamburger is always available
  // regardless of this pref. Local write first (instant), then a best-effort
  // backend push when signed in.
  function toggleSidebar() {
    _sidebarUserTouched = true;
    const on = !sidebarEnabled();
    writeDevicePref(SIDEBAR_KEY, on ? 'on' : 'off');
    document.body.classList.toggle('sidebar-open', on);
    syncSidebarChrome();
    pushSidebarBackend(on);
  }

  function pushSidebarBackend(on) {
    try {
      fetch('/api/cloud/prefs/theme', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sidebar: on ? 'on' : 'off' })
      }).then(function (r) {
        // Same arming flag the theme helper uses: any successful round trip
        // enables the one-per-load backend pull on this device.
        if (r.ok) writeDevicePref('mmgr_palette_backend', '1');
      }).catch(function () { /* offline / no worker — localStorage is the cache */ });
    } catch (e) { /* ignore */ }
  }

  // One-per-load backend pull (mirrors js/mmgr-theme.js): only on a device
  // that has already synced SOME pref, and only until a LOCAL sidebar pref
  // exists — the signed-in account's saved layout then follows across devices
  // without ever clobbering a fresh local choice.
  function pullSidebarBackend() {
    if (_sidebarUserTouched) return;
    if (readDevicePref('mmgr_palette_backend') !== '1') return; // never synced — nothing to pull
    if (readDevicePref(SIDEBAR_KEY) != null) return;            // local pref wins
    try {
      fetch('/api/cloud/prefs/theme', { headers: { 'Accept': 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d || !d.ok || !d.theme) return;
          if (_sidebarUserTouched) return; // user chose mid-flight — their pick wins
          const v = d.theme.sidebar;
          if (v !== 'on' && v !== 'off') return;
          writeDevicePref(SIDEBAR_KEY, v);
          document.body.classList.toggle('sidebar-open', v === 'on');
          syncSidebarChrome();
        }).catch(function () { /* backend unreachable — keep local cache */ });
    } catch (e) { /* ignore */ }
  }

  // Build the sidebar content by CLONING the horizontal .sec-nav groups (one
  // source of truth — the links/actions can never drift), stripping the ids
  // (the originals own them: gnav/knav/dmaic-nav), and keeping every clone's
  // pack/methodology visibility mirrored to its original forever. Active-state
  // sync needs no mirror: showSection's global .sec-btn query already covers
  // both navs. Placement after <main> keeps document.querySelector first-
  // matches on the ORIGINAL top nav, so programmatic showSection calls
  // highlight the top pill exactly as before.
  function buildSidebar() {
    const sb = U.$('app-sidebar');
    const nav = U.$('sec-nav');
    if (!sb || !nav) return;
    const groups = nav.querySelectorAll('.nav-group');
    for (let i = 0; i < groups.length; i++) {
      const c = groups[i].cloneNode(true);
      c.querySelectorAll('[id]').forEach(function (el) { el.removeAttribute('id'); });
      sb.appendChild(c);
    }
    // Mirror .is-hide (pack/methodology gates) from the originals to the
    // clones. The render gates in mmgr-render.js already use global .sec-btn
    // selectors (renderPacks/renderMethodology) that cover the clones too, so
    // this observer is a drift-proofing safety net, not the driver.
    const mo = new MutationObserver(function (muts) {
      for (let i = 0; i < muts.length; i++) {
        const m = muts[i];
        if (m.type !== 'attributes' || m.attributeName !== 'class') continue;
        const orig = m.target;
        if (!orig.classList || !orig.classList.contains('sec-btn')) continue;
        const sec = orig.getAttribute('data-section');
        if (!sec) continue;
        const twin = sb.querySelector('.sec-btn[data-section="' + sec + '"]');
        if (twin) twin.classList.toggle('is-hide', orig.classList.contains('is-hide'));
      }
    });
    mo.observe(nav, { subtree: true, attributes: true, attributeFilter: ['class'] });
  }


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
  // Consumes ns.Errors.getLog() — the single data source. Plain-text format
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
    // both resolve true), so no catch is needed — a successful copy is the
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
  // COUNTS-ONLY by default — budget figures, risk descriptions, and names
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
    showToast(ok ? 'Report copied — paste it wherever you file the issue.' : 'Could not copy the report.', ok ? 'ok' : 'err');
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
      ? 'Remote error reporting ON — new errors are posted to your webhook.'
      : 'Remote error reporting OFF — errors stay on this device only.',
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
  // to the Advanced Packs toggles — open the Controls drawer, switch to the
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
  // rectangles — circular border, tinted circular icon tile (check-circle /
  // x / alert-triangle), one-word label (Done / Error / Note), full-contrast
  // message, slide-up + hold + graceful fade-out. Shared markup + the .toast
  // CSS in css/mmgr.css (same as app.html / admin.html) — one look everywhere.
  function showToast(msg, type) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const isErr = type === 'err' || type === 'error';
    const isWarn = type === 'warn';
    const t = document.createElement('div');
    t.className = 'toast ' + (isErr ? 'err' : (isWarn ? 'warn' : 'ok'));
    // GAP-AUDIT-CLOUD-31 (E18): the toast is a live region so async outcomes
    // (AI answers, save confirmations, errors) reach screen readers. Errors
    // are assertive; confirmations/warnings stay polite.
    t.setAttribute('role', isErr ? 'alert' : 'status');
    t.setAttribute('aria-live', isErr ? 'assertive' : 'polite');
    const icon = isErr ? 'i-x' : (isWarn ? 'i-alert-triangle' : 'i-check-circle');
    const label = isErr ? 'Error' : (isWarn ? 'Note' : 'Done');
    t.innerHTML = '<span class="toast-ico"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#' + icon + '"></use></svg></span>' +
                  '<span class="toast-body"><b></b><span></span></span>';
    t.querySelector('b').textContent = label;
    t.querySelector('.toast-body > span').textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('is-out'), 2600);
    setTimeout(() => t.remove(), 3100);
  }

  // ---- Methodology Learning Card ----
  let mlcTimer = null;
  const MLC_DATA = {
    waterfall: {
      title: 'Waterfall Methodology',
      body: 'A linear, sequential approach where each phase must be completed before the next begins. Best for construction, manufacturing, and regulated environments where requirements are stable and changes are costly.',
      when: 'Best for: Fixed-price contracts, regulatory projects, and any project where the full scope is known upfront.',
      example: 'Example: Building a bridge — design must be approved before steel is ordered, and steel must arrive before erection begins.'
    },
    agile: {
      title: 'Agile Methodology',
      body: 'An iterative approach that delivers work in small, time-boxed increments called sprints. Best for software, product development, and environments where requirements evolve rapidly.',
      when: 'Best for: Projects with evolving requirements, innovation work, and teams that benefit from rapid feedback loops.',
      example: 'Example: Developing a mobile app — each 2-week sprint delivers a working feature set that users can test and provide feedback on.'
    },
    hybrid: {
      title: 'Hybrid Methodology',
      body: 'Combines the structure of Waterfall (planning, design, governance) with the flexibility of Agile (iterative delivery, continuous improvement). Best for complex projects that need both certainty and adaptability.',
      when: 'Best for: Large-scale digital transformations, capital projects with software components, and any project where parts are well-defined and parts are exploratory.',
      example: 'Example: A factory automation project — the physical layout and equipment procurement follow Waterfall, while the control software is developed in Agile sprints.'
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

  // ---- Copy All ----
  // Section-specific formatted blocks for the ported sections (RACI, Comms,
  // Docs, Meetings) match the monolith's exports; everything else falls
  // back to the generic table-dump.
  function cpAllPage(section) {
    const s = ns.State.getState();
    const ts = `[Copied: ${new Date().toLocaleString()} | My MaNaGeR | ${((s && s.methodology) || '').toUpperCase()}]`;
    let text = ts + '\n\n';
    if (section === 'raci' && ns.Raci && ns.Raci.raciExportBlock) {
      text += 'RACI MATRIX\n' + '='.repeat(40) + '\n' + ns.Raci.raciExportBlock();
      U.copyToClipboard(text);
      showToast('Copied!', 'ok');
      return;
    }
    if (section === 'comms') {
      text += 'COMMUNICATION LOG\n' + '='.repeat(40) + '\n';
      ((s && s.commsEntries) || []).forEach(c => {
        text += `[${c.id}] ${c.date} | ${c.type} | ${c.attendees}\n  Summary: ${c.summary}\n  Actions: ${c.actionItems}\n  Follow-up: ${c.followUp || '—'}\n\n`;
      });
      U.copyToClipboard(text);
      showToast('Copied!', 'ok');
      return;
    }
    if (section === 'docs') {
      text += 'DOCUMENT REGISTER\n' + '='.repeat(40) + '\n';
      ((s && s.documents) || []).forEach(d => {
        text += `[${d.id}] ${d.docNo} | ${d.title} | ${d.type} v${d.version} | ${d.status} | ${d.responsible} | Issued: ${d.dateIssued || '—'} | ${d.notes || ''}\n`;
      });
      U.copyToClipboard(text);
      showToast('Copied!', 'ok');
      return;
    }
    // ACTION-PLAN 7.4: dispute-ready weather delay log export (date,
    // conditions, note, affected tasks + LD exposure). Client-side text —
    // no server round-trip; the log itself is localStorage state.
    if (section === 'wxlog') {
      text += 'WEATHER DELAY LOG (DISPUTE RECORD)\n' + '='.repeat(40) + '\n';
      const log = (s && s.weatherLog) || [];
      if (log.length) {
        log.forEach(e => {
          text += e.date + ' | ' + (e.condition || '—') + (e.note ? ' | Note: ' + e.note : '') +
            (e.affectedTaskIds && e.affectedTaskIds.length ? ' | Affected: ' + e.affectedTaskIds.join(', ') : '') + '\n';
        });
      } else {
        text += 'No weather delay days logged yet.\n';
      }
      if (ns.Forecast && ns.Forecast.ldExposure) {
        const ld = ns.Forecast.ldExposure(s);
        text += '\nLD EXPOSURE\n' + '-'.repeat(30) + '\n' +
          'Logged days: ' + ld.days + ' | LD rate: $' + Number(ld.rate).toLocaleString() + '/day | Exposure: $' + Number(ld.exposure).toLocaleString() + '\n';
      }
      U.copyToClipboard(text);
      showToast('Weather log copied!', 'ok');
      return;
    }
    if (section === 'meet' && ns.Meetings) {
      const M = ns.Meetings;
      text += 'MEETING AGENDAS & TEMPLATES\n' + '='.repeat(40) + '\n\nPRE-PROJECT KICKOFF (' + M.MEET_TEMPLATES.kickoff.dur + ')\n' + '-'.repeat(30) + '\n';
      M.MEET_KICKOFF_ITEMS.forEach((it, i) => { text += (i + 1) + '. ' + it + '\n'; });
      text += '\nRECURRING TEMPLATES\n' + '-'.repeat(30) + '\n';
      M.MEET_RECURRING.concat(M.MEET_SPECIALIZED).forEach(m => { text += '• ' + m.t + ' (' + m.dur + ') — ' + m.d + '\n'; });
      if (s && (s.methodology === 'agile' || s.methodology === 'hybrid')) {
        text += '\nAGILE CEREMONIES\n' + '-'.repeat(30) + '\n';
        M.MEET_AGILE.forEach(m => { text += '• ' + m.t + ' (' + m.dur + ') — ' + m.d + '\n'; });
      }
      U.copyToClipboard(text);
      showToast('All meeting templates copied!', 'ok');
      return;
    }
    // ACTION-PLAN 3.4: the weekly baseline narrative feeds Copy All — a
    // client-side plain-English diff, no server round-trip.
    if (section === 'baselinen') {
      text += 'WHAT CHANGED THIS WEEK\n' + '='.repeat(40) + '\n';
      const narr = ns.Render && ns.Render.computeBaselineNarrative ? ns.Render.computeBaselineNarrative(s) : null;
      if (narr) {
        narr.forEach(n => { text += '• ' + n + '\n'; });
      } else {
        text += 'No baseline captured yet — Settings > Controls > Save Baseline.\n';
      }
      text += '\nCURRENT PLAN (tasks)\n' + '='.repeat(40) + '\n';
      ((s && s.tasks) || []).forEach(t => {
        text += '[' + t.id + '] ' + t.name + ' | ' + (t.status || '') + ' | ' + (t.startDate || '—') + ' → ' + (t.endDate || '—') + '\n';
      });
      U.copyToClipboard(text);
      showToast('Copied!', 'ok');
      return;
    }
    // MASTER-ACTION-PLAN-v3-STRICT Rank 1.1: the one-click claim/delay
    // package — composed live from unified state via the Claim module,
    // windowed by the Claim Pack tab's date range. Client-side text, same
    // zero-server Copy All path.
    if (section === 'claim' && ns.Claim) {
      const fromEl = U.$('claim-from');
      const toEl = U.$('claim-to');
      const pack = ns.Claim.buildClaimPack(s, fromEl ? fromEl.value : '', toEl ? toEl.value : '');
      text += ns.Claim.claimPackText(pack);
      U.copyToClipboard(text);
      showToast('Claim pack copied!', 'ok');
      return;
    }
    // MASTER-ACTION-PLAN-v3-STRICT Rank 2.1: the auto-generated "what
    // changed" digest — diffed against the pinned reference point (or the
    // baseline) and copied as plain text. Local generation only.
    if (section === 'digest' && ns.Digest && ns.Digest.computeDigest && ns.Digest.buildDigestText) {
      text += ns.Digest.buildDigestText(ns.Digest.computeDigest(s));
      U.copyToClipboard(text);
      showToast('Digest copied!', 'ok');
      return;
    }
    const body = U.$(section + '-body');
    if (!body) return;
    text = Array.from(body.querySelectorAll('tr')).map(tr =>
      Array.from(tr.querySelectorAll('td,th')).map(td => td.textContent.trim()).join(' | ')
    ).join('\n');
    U.copyToClipboard(text);
    showToast('Copied!', 'ok');
  }

  // ============================================================
  // ACTION-PLAN Phase 5 — export & polish
  // ============================================================

  // ---- 5.1 Multi-format Copy All ----
  // Existing cpAllPage copies per-section tables. These three variants
  // compose the SAME live state into share-format text: a Slack digest,
  // an email digest, and a printable client summary. Pure client-side
  // composition (simulated backend: no server round-trip).
  function _fmtMoney(n) { return '$' + Number(n || 0).toLocaleString(); }

  function buildDigest(s) {
    const lines = [];
    const f = (s.charter) || {};
    lines.push('*' + (s.projectName || f.name || 'Project') + '*');
    lines.push('Status: ' + (f.status || '—') + ' | Methodology: ' + ((s.methodology || 'waterfall').toUpperCase()));
    const tasks = s.tasks || [];
    const done = tasks.filter(t => t.status === 'completed').length;
    const overdue = tasks.filter(t => U.isOverdue(t.endDate) && t.status !== 'completed').length;
    lines.push('Tasks: ' + done + '/' + tasks.length + ' complete' + (overdue ? ' | *' + overdue + ' overdue*' : ''));
    if (f.targetCompletion) {
      const t = ns.Render && ns.Render.computeTimelineStatus ? ns.Render.computeTimelineStatus(s) : null;
      if (t) lines.push('Timeline: ' + t.status + (t.overrunDays > 0 ? ' (+' + t.overrunDays + 'd)' : ''));
    }
    const risks = (s.risks || []).filter(r => !r.issueId && (r.probability === 'High' || r.probability === 'high'));
    if (risks.length) lines.push('High risks: ' + risks.map(r => r.description).join('; '));
    const issues = (s.issues || []).filter(i => i.status !== 'resolved' && i.status !== 'closed');
    if (issues.length) lines.push('Open issues: ' + issues.map(i => i.description).join('; '));
    const planned = (s.budgetLines || []).reduce((n, l) => n + (+l.planned || 0), 0);
    const actual = (s.budgetLines || []).reduce((n, l) => n + (+l.actual || 0), 0);
    lines.push('Budget: ' + _fmtMoney(actual) + ' spent of ' + _fmtMoney(planned) + ' planned' + (planned > actual ? '' : ' | *over planned*'));
    if (ns.Render && ns.Render.computeAgingActions) {
      const open = ns.Render.computeAgingActions(s).filter(a => (a.age || 0) > 0).length;
      if (open) lines.push('Action items past due: ' + open);
    }
    return lines.join('\n');
  }

  // Explain-before-copy builders (owner 2026-08-15): the exact text each
  // Copy As format produces — used BOTH by cpFormats (the copy action) and
  // by renderCtrlPreviews (the live previews in the Controls tab), so the
  // preview is always byte-identical to what gets copied.
  function copyAsText(kind) {
    const s = ns.State.getState();
    const ts = new Date().toLocaleString();
    if (kind === 'slack') {
      return '*My MaNaGeR — Weekly Digest* (' + ts + ')\n' + buildDigest(s);
    } else if (kind === 'email') {
      const body = buildDigest(s).replace(/\*/g, '');
      return 'Subject: Project Digest — ' + (s.projectName || '') + '\n\nHi team,\n\n' + body.replace(/\n/g, '\n') + '\n\n— My MaNaGeR\n';
    } else if (kind === 'client') {
      // Printable client summary — clean text, no markup, safe to paste into
      // a doc or print directly.
      const f = (s.charter) || {};
      const tasks = s.tasks || [];
      const done = tasks.filter(t => t.status === 'completed').length;
      const lines = [];
      lines.push('CLIENT PROJECT SUMMARY');
      lines.push('='.repeat(40));
      lines.push('Project: ' + (s.projectName || f.name || '—'));
      lines.push('Status: ' + (f.status || '—'));
      lines.push('Prepared: ' + ts);
      lines.push('');
      lines.push('PROGRESS');
      lines.push('-'.repeat(30));
      lines.push('Completion: ' + (tasks.length ? Math.round(done / tasks.length * 100) : 0) + '% (' + done + ' of ' + tasks.length + ' tasks)');
      if (f.targetCompletion) lines.push('Target completion: ' + f.targetCompletion);
      lines.push('');
      lines.push('KEY METRICS');
      lines.push('-'.repeat(30));
      const planned = (s.budgetLines || []).reduce((n, l) => n + (+l.planned || 0), 0);
      const actual = (s.budgetLines || []).reduce((n, l) => n + (+l.actual || 0), 0);
      lines.push('Budget: ' + _fmtMoney(actual) + ' spent / ' + _fmtMoney(planned) + ' planned');
      lines.push('Open issues: ' + (s.issues || []).filter(i => i.status !== 'resolved' && i.status !== 'closed').length);
      lines.push('Open high risks: ' + (s.risks || []).filter(r => !r.issueId && (r.probability === 'High' || r.probability === 'high')).length);
      lines.push('');
      lines.push('GENERATED BY MY MANAGER');
      return lines.join('\n');
    }
    return '';
  }

  // Live previews for the Copy As + Email Template cards. textContent only
  // (the previews are plain text — never innerHTML). Wired into the render
  // tail so they always mirror the current state.
  function renderCtrlPreviews() {
    const set = function(id, txt) {
      const el = U.$(id);
      if (el) el.textContent = txt || '';
    };
    set('pv-slack', copyAsText('slack'));
    set('pv-email', copyAsText('email'));
    set('pv-client', copyAsText('client'));
    set('pv-tpl-status', emailTplText('status'));
    set('pv-tpl-change', emailTplText('change'));
    set('pv-tpl-risk', emailTplText('risk'));
    set('pv-tpl-closure', emailTplText('closure'));
  }

  function cpFormats(kind) {
    const txt = copyAsText(kind);
    if (!txt) { showToast('Nothing to copy yet.', 'warn'); return; }
    U.copyToClipboard(txt);
    const label = kind === 'slack' ? 'Slack digest' : (kind === 'email' ? 'Email digest' : 'Client summary');
    showToast(label + ' copied!', 'ok');
  }

  // ---- MONOLITH-FEATURE-PARITY-DIRECTIVES RESTORE-3: one-click email
  // template generator (Status Update / Change Request / Risk Escalation /
  // Closure Sign-Off). Restored as the monolith's ORIGINAL static, zero-AI
  // version — every button copies a ready-to-send email draft built from
  // live project state, so it works with no model configured and remains the
  // guaranteed fallback. BACKLOG B-N (2026-08-12): the same body is now also
  // exposed as a pure emailTplText(kind) getter so the AI window's LOCAL
  // tier can return it verbatim (zero-fabrication baseline) while the Cloud
  // tier drafts an AI-polished 'email' preset on top — the buttons below are
  // unchanged and never depend on a model.
  function emailTplText(kind) {
    const s = ns.State.getState();
    const f = s.charter || {};
    const pn = f.name || '[Project Name]';
    // The current charter schema has no PM field — the signer is deliberately
    // a distinct placeholder rather than reusing the sponsor, so the email
    // does not imply the sponsor wrote it.
    const pm = '[PM]';
    const sp = f.sponsor || '[Sponsor]';
    const tasks = s.tasks || [];
    const tot = tasks.length;
    const dn = tasks.filter(t => t.status === 'completed').length;
    const pct = tot ? Math.round(dn / tot * 100) : 0;
    const openIssues = (s.issues || []).filter(i => i.status !== 'resolved' && i.status !== 'closed');
    let body = '';
    if (kind === 'status') {
      body = 'Subject: ' + pn + ' — Weekly Status Update\n\nHi ' + sp + ',\n\nQuick status on ' + pn + ' as of ' + new Date().toLocaleDateString() + ':\n• Overall progress: ' + pct + '% Completed (' + dn + '/' + tot + ' tasks)\n• In Progress: ' + tasks.filter(t => t.status === 'inprogress').length + '\n• Blocked: ' + tasks.filter(t => t.status === 'blocked').length + '\n• Live issues: ' + openIssues.length + '\n\nNext priorities:\n' + (tasks.filter(t => t.status !== 'completed').slice(0, 3).map(t => '  - ' + (t.name || t.id)).join('\n') || '  - (none)') + '\n\nRegards,\n' + pm;
    } else if (kind === 'change') {
      const pending = (s.changes || []).filter(c => c.status === 'submitted' || c.status === 'review');
      body = 'Subject: ' + pn + ' — Change Request for Approval\n\nHi ' + sp + ',\n\nA change request has been raised on ' + pn + '. Please review the impact below and confirm approval:\n\n' + (pending.map(c => '• ' + (c.title || '(untitled)') + ' (Sched ' + (c.schedImpact || '—') + ', Cost ' + (c.costImpact || '—') + ') — Requester: ' + (c.requester || '—') + '\n  Notes: ' + (c.notes || '')).join('\n') || '(no pending changes)') + '\n\nAwaiting your decision.\n\nRegards,\n' + pm;
    } else if (kind === 'risk') {
      const highRisks = (s.risks || []).filter(r => !r.issueId && (r.probability === 'High' || r.probability === 'Very High' || r.impact === 'High' || r.impact === 'Very High'));
      body = 'Subject: ' + pn + ' — Risk / Issue Escalation\n\nHi ' + sp + ',\n\nThe following items require attention on ' + pn + ':\n\nACTIVE ISSUES:\n' + (openIssues.map(r => '• [' + (r.id || 'I?') + '] ' + r.description + ' | Owner: ' + (r.owner || '—') + ' | Target: ' + (r.targetDate || '—')).join('\n') || '(none)') + '\n\nHIGH RISKS:\n' + (highRisks.map(r => '• [' + (r.id || 'R?') + '] ' + r.description + ' | Prob ' + r.probability + ' | Impact ' + r.impact + ' | Mitigation: ' + (r.mitigation || '—')).join('\n') || '(none)') + '\n\nRegards,\n' + pm;
    } else {
      const items = (s.closure && s.closure.items) || [];
      body = 'Subject: ' + pn + ' — Closure Sign-Off Request\n\nHi ' + sp + ',\n\n' + pn + ' is ready for formal closure. Summary:\n• Overall: ' + pct + '% Completed\n• Deliverables checklist: ' + items.filter(c => c.done).length + '/' + items.length + ' complete\n\nLessons learned and final report attached. Please confirm sign-off.\n\nRegards,\n' + pm;
    }
    return body;
  }

  function emailTpl(kind) {
    U.copyToClipboard(emailTplText(kind));
    showToast('Email template copied!', 'ok');
  }

  // ---- 5.2 Definitions tooltips ----
  // Any element carrying data-def="<term>" gets a floating tooltip from
  // the Definitions glossary on hover. Delegated once, no inline handlers.
  // The tooltip element is created once lazily (same pattern as the toast).
  let _defTipEl = null;
  let _defTipTimer = null;

  function defTipFor(term) {
    if (!ns.Defs || !ns.Defs.DATA) return null;
    const entry = ns.Defs.DATA.find(d => d.term.toLowerCase() === String(term || '').toLowerCase());
    return entry || null;
  }

  function showDefTip(el, term) {
    const entry = defTipFor(term);
    if (!entry) return;
    if (_defTipTimer) { clearTimeout(_defTipTimer); _defTipTimer = null; }
    if (!_defTipEl) {
      _defTipEl = document.createElement('div');
      _defTipEl.id = 'def-tooltip';
      _defTipEl.className = 'def-tooltip';
      document.body.appendChild(_defTipEl);
    }
    _defTipEl.innerHTML = '<div class="dt-term">' + U.escapeHtml(entry.term) + (entry.group ? '<span class="def-badge">' + U.escapeHtml(entry.group) + '</span>' : '') + '</div>' +
      '<div class="dt-body">' + U.escapeHtml(entry.meaning) + '</div>';
    _defTipEl.classList.add('vis');
    const r = el.getBoundingClientRect();
    _defTipEl.style.left = Math.min(r.left, window.innerWidth - 280) + 'px';
    _defTipEl.style.top = (r.bottom + 8) + 'px';
  }

  function hideDefTip() {
    if (_defTipTimer) { clearTimeout(_defTipTimer); _defTipTimer = null; }
    if (_defTipEl) _defTipEl.classList.remove('vis');
  }

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
    ctx.fillText((s.projectName || 'Project') + ' — Schedule Export', padL, padT + 12);
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

  // ---- ACTION-PLAN 7 weather actions ----
  // Open-Meteo is fetch-only (CSP connect-src permits api.open-meteo.com).
  // All four handlers are client-side; failures degrade to a toast, never
  // a throw, and the static regional windows remain the fallback.
  async function wxGeocode() {
    const place = (U.$('wx-place-in') || {}).value || '';
    if (!place.trim()) { showToast('Enter a site city first.', 'err'); return; }
    const ok = await ns.Forecast.geocode(place.trim());
    if (ok) { showToast('Site located — refresh for the forecast.', 'ok'); R.renderAll(); }
    else { showToast('Could not find that location — check the city name.', 'err'); }
  }

  async function wxRefresh() {
    const s = S();
    if (s.siteLat === null || s.siteLon === null) { showToast('Locate the site city first.', 'err'); return; }
    try {
      await ns.Forecast.fetchForecast(s.siteLat, s.siteLon);
      showToast('Forecast refreshed.', 'ok');
    } catch (e) {
      showToast('Forecast unavailable (offline?). Using cached or regional windows.', 'err');
    }
    R.renderAll();
  }

  // OWNER 2026-08-15: "Use my current location" — browser geolocation pins
  // the exact coordinates where the user is right now and fetches the
  // Open-Meteo forecast for them, so the weather is tailored to their
  // location. Reverse-geocodes a friendly place label when it can. Never
  // throws: denied permission / no coverage / insecure context all degrade
  // to a toast pointing at the type-a-city path (the offline-safe fallback).
  async function wxUseLocation() {
    if (!navigator.geolocation) {
      showToast('Location lookup is unavailable in this browser — type your site city instead.', 'err');
      return;
    }
    showToast('Locating you…', 'ok');
    let pos;
    try {
      pos = await new Promise(function(res, rej) {
        navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 15000, maximumAge: 300000 });
      });
    } catch (e) {
      showToast('Could not get your location (permission or coverage) — type your site city instead.', 'err');
      return;
    }
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    ns.State.updateState(function(s) {
      s.siteLat = lat;
      s.siteLon = lon;
      s.sitePlace = '';
    });
    // Best-effort reverse label (Open-Meteo's geo API has no true reverse
    // lookup, so this usually returns ''); fall back to a readable coordinate
    // pair so the forecast header always shows where the weather is pinned.
    let place = '';
    try { place = (await ns.Forecast.reverseGeocode(lat, lon)) || ''; } catch (e) { place = ''; }
    if (!place) place = lat.toFixed(2) + ', ' + lon.toFixed(2);
    ns.State.updateState(function(s) { s.sitePlace = place; });
    try {
      await ns.Forecast.fetchForecast(lat, lon);
      showToast('Forecast set for your current location' + (place ? ' — ' + place : '') + '.', 'ok');
    } catch (e) {
      showToast('Location saved, but the forecast could not be fetched (offline?) — regional windows remain.', 'err');
    }
    R.renderAll();
  }

  function wxLogToday() {
    const s = S();
    const today = U.todayStr();
    // Affected tasks: weather-sensitive tasks running today.
    const affected = (s.tasks || []).filter(t => t.weatherSensitive && t.startDate && t.endDate &&
      U.parseDL(t.startDate) <= new Date() && U.parseDL(t.endDate) >= new Date()).map(t => t.id);
    ns.Forecast.logWeatherDay(s, { note: '', affectedTaskIds: affected });
    showToast('Weather day logged.', 'ok');
    R.renderAll();
  }

  // ACTION-PLAN 25: manual on-site weather override. A PM can log today's
  // ACTUAL conditions (hyperlocal reality beats API forecast) instead of the
  // auto-pulled values — feeds the same dispute-ready daily log.
  function wxLogManual() {
    const s = S();
    const condEl = U.$('wx-manual-cond');
    const noteEl = U.$('wx-manual-note');
    const condition = (condEl && condEl.value.trim()) || '';
    if (!condition) { showToast('Enter the manual conditions first.', 'err'); return; }
    const note = (noteEl && noteEl.value.trim()) || '';
    const affected = (s.tasks || []).filter(t => t.weatherSensitive && t.startDate && t.endDate &&
      U.parseDL(t.startDate) <= new Date() && U.parseDL(t.endDate) >= new Date()).map(t => t.id);
    ns.Forecast.logWeatherDay(s, { note: note, affectedTaskIds: affected, manual: true, condition: condition });
    if (condEl) condEl.value = '';
    if (noteEl) noteEl.value = '';
    showToast('Manual weather day logged.', 'ok');
    R.renderAll();
  }

  function wxCopyNotice() {
    U.copyToClipboard(ns.Forecast.subcontractorNotice(S()));
    showToast('Subcontractor notice copied.', 'ok');
  }

  // ACTION-PLAN 7.1: forecast strip horizon toggle (7-day vs the 16-day
  // Open-Meteo max, used as the monthly-rollup approximation). View-only
  // preference; the forecast itself is never re-fetched by this toggle.
  function wxSetView(el) {
    const days = parseInt((el && el.getAttribute('data-days')) || '7', 10);
    ns.State.updateState(function(s) { s.wxViewDays = days === 16 ? 16 : 7; });
    R.renderAll();
  }

  function wxDelLogEntry(el) {
    ns.Forecast.delWeatherLogEntry(parseInt(el.getAttribute('data-idx'), 10));
    R.renderAll();
  }

  // ---- Hold to Clear ----
  // Press and HOLD the Clear All button for 10s to confirm. The hold starts
  // on pointerdown and is cancelled on release, pointer cancel, leaving the
  // button, or losing window focus (see delegation in the event layer).
  let holdTimer = null;
  let holdShowedBar = false; // did THIS hold bring up the undo bar?
  const HOLD_MSG_ON = ' Hold to clear — release to cancel';
  const HOLD_MSG_OFF = ' Page cleared.';

  function startHold(section) {
    if (holdTimer) return; // already holding
    const dur = U.$('ut');
    if (dur) dur.textContent = '10';
    // Only show the bar if it isn't already up with a real undo message —
    // a pending "Page cleared. Undo" bar must not be discarded by a tap.
    const ub = U.$('ub');
    if (ub && !ub.classList.contains('vis')) {
      ub.classList.add('vis');
      holdShowedBar = true;
    }
    const msg = U.$('ub-msg');
    if (msg) msg.textContent = HOLD_MSG_ON;
    holdTimer = setInterval(() => {
      const el = U.$('ut');
      if (el) {
        const v = parseInt(el.textContent) - 1;
        el.textContent = v;
        if (v <= 0) {
          clearInterval(holdTimer);
          holdTimer = null;
          // The hold succeeded: the bar now legitimately shows "Page cleared."
          // so a later hold-cancel must not hide it as if it were ours.
          holdShowedBar = false;
          clearSection(section);
        }
      }
    }, 1000);
  }

  function cancelHold() {
    if (!holdTimer) return;
    clearInterval(holdTimer);
    holdTimer = null;
    if (holdShowedBar) {
      const ub = U.$('ub');
      if (ub) ub.classList.remove('vis');
      holdShowedBar = false;
    }
    const msg = U.$('ub-msg');
    if (msg) msg.textContent = HOLD_MSG_OFF;
    const dur = U.$('ut');
    if (dur) dur.textContent = '5';
  }

  function clearSection(section) {
    // Make the whole clear undoable (persistent stack, not just the 5s bar)
    ns.State.pushUndo();
    ns.State.updateState(function(s) {
      switch(section) {
        case 'wbs': s.tasks = []; break;
        case 'risk': s.risks = []; s.issues = []; break;
        case 'log': s.logEntries = []; break;
        case 'kan': s.tasks = s.tasks.filter(t => t.status === 'completed'); break;
        case 'comms': s.commsEntries = []; break;
      }
    });
    R.renderWbs();
    R.renderKanban();
    R.renderRisks();
    R.renderLog();
    R.renderComms();
    R.renderDash();
    const ub = U.$('ub');
    if (ub) { ub.classList.add('vis'); setTimeout(() => ub.classList.remove('vis'), 5000); }
    const msg = U.$('ub-msg');
    if (msg) msg.textContent = HOLD_MSG_OFF;
    updateUndoUi();
  }

  function undoClr() {
    const ub = U.$('ub');
    if (ub) ub.classList.remove('vis');
    if (ns.State.undo()) {
      R.renderAll();
      if (ns.Charter) ns.Charter.loadCharterData();
      if (ns.Sprint) ns.Sprint.loadSprintData();
      showToast('Undone.', 'ok');
    } else {
      showToast('Nothing to undo.', 'err');
    }
    updateUndoUi();
  }

  // ---- Persistent Undo / Redo (command stack, 20 snapshots) ----
  function undo() {
    if (ns.State.undo()) {
      R.renderAll();
      if (ns.Charter) ns.Charter.loadCharterData();
      if (ns.Sprint) ns.Sprint.loadSprintData();
      showToast('Undone.', 'ok');
    } else {
      showToast('Nothing to undo.', 'err');
    }
    updateUndoUi();
  }

  function redo() {
    if (ns.State.redo()) {
      R.renderAll();
      if (ns.Charter) ns.Charter.loadCharterData();
      if (ns.Sprint) ns.Sprint.loadSprintData();
      showToast('Redone.', 'ok');
    } else {
      showToast('Nothing to redo.', 'err');
    }
    updateUndoUi();
  }

  function updateUndoUi() {
    const u = U.$('undo-btn');
    if (u) u.textContent = 'Undo' + (ns.State.undoDepth() ? ' (' + ns.State.undoDepth() + ')' : '');
    const r = U.$('redo-btn');
    if (r) r.textContent = 'Redo' + (ns.State.redoDepth() ? ' (' + ns.State.redoDepth() + ')' : '');
  }

  // ---- Weather Region ----
  function setRegion(val) {
    ns.State.updateState(function(s) { s.weatherRegion = val; });
    if (ns.Schedule && ns.Schedule.checkWeatherExposure) {
      ns.Schedule.checkWeatherExposure((S().tasks || []), val);
    }
    R.renderWbs();
    R.renderGantt();
    let label = val;
    if (ns.Weather && ns.Weather.getRegion) {
      const r = ns.Weather.getRegion(val);
      if (r && r.name) label = r.name;
    }
    showToast('Weather region: ' + label, 'ok');
  }

  // ---- Confirmation Dialog (replaces bare confirm() for destructive ops) ----
  let _cfmCb = null;
  let _cfmCancelCb = null;
  function askConfirm(opts) {
    const modal = U.$('cfm-modal');
    if (!modal) {
      // No dialog in the DOM: fall back to native confirm so safety holds.
      if (window.confirm((opts && opts.message) || 'Confirm?')) {
        if (opts && opts.onOk) opts.onOk();
      }
      return;
    }
    _cfmCb = (opts && opts.onOk) || null;
    _cfmCancelCb = (opts && opts.onCancel) || null;
    const title = U.$('cfm-title');
    if (title) title.textContent = (opts && opts.title) || 'Confirm';
    const msg = U.$('cfm-msg');
    if (msg) msg.textContent = (opts && opts.message) || '';
    const items = U.$('cfm-items');
    if (items) {
      const list = (opts && opts.items) || [];
      if (list.length) {
        items.classList.remove('is-hide');
        items.innerHTML = '<div class="cfm-list-label">Affected task IDs:</div><div class="cfm-list">' +
          list.map(id => '<code>' + U.escapeHtml(id) + '</code>').join('') + '</div>';
      } else {
        items.classList.add('is-hide');
      }
    }
    const okBtn = U.$('cfm-ok');
    if (okBtn) {
      okBtn.textContent = (opts && opts.confirmLabel) || 'Confirm';
      if (opts && opts.danger) {
        okBtn.classList.add('btn-d');
        okBtn.classList.remove('btn-g');
      } else {
        okBtn.classList.add('btn-g');
        okBtn.classList.remove('btn-d');
      }
    }
    const cancelBtn = U.$('cfm-cancel');
    if (cancelBtn) cancelBtn.textContent = (opts && opts.cancelLabel) || 'Cancel';
    modal.classList.add('on');
  }

  function cfmOk() {
    const modal = U.$('cfm-modal');
    if (modal) modal.classList.remove('on');
    const items = U.$('cfm-items');
    if (items) items.classList.add('is-hide');
    const cb = _cfmCb;
    _cfmCb = null;
    _cfmCancelCb = null;
    if (cb) cb();
  }

  function cfmCancel() {
    const modal = U.$('cfm-modal');
    if (modal) modal.classList.remove('on');
    const items = U.$('cfm-items');
    if (items) items.classList.add('is-hide');
    const cb = _cfmCancelCb;
    _cfmCb = null;
    _cfmCancelCb = null;
    if (cb) cb();
  }

  // ---- Multi-tab Conflict Resolution ----
  let _pendingExternal = null;
  function onExternalChange(parsed) {
    const s = S();
    if (!parsed || !s || !parsed.updatedAt) return;
    if (parsed.updatedAt <= s.updatedAt) return; // not newer — ignore
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

  // Close every custom modal we own (Escape key path). An Escape on the
  // confirmation dialog behaves exactly like Cancel — the onCancel callback
  // (e.g. a Gantt-drag rollback) must still run.
  function closeModals() {
    ['cfm-modal', 'conflict-modal'].forEach(id => {
      const el = U.$(id);
      if (el) el.classList.remove('on');
    });
    const cb = _cfmCancelCb;
    _cfmCb = null;
    _cfmCancelCb = null;
    if (cb) cb();
  }

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
      // Monolith drop guard: lead-time cards belong in the Lead-Time lane —
      // WIP columns are for crew-driven work. Refuse the drop with a toast
      // instead of silently moving a third-party wait into a work column.
      if (task && task.leadTime) {
        showToast('Lead-time cards belong in the Lead-Time lane — WIP columns are for crew-driven work.', 'err');
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
      // + submitted/expected inputs) and the Dashboard's Lead-Time Tracker —
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
      U.$('om-title').innerHTML = '<svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-edit"></use></svg> Prompt — ' + type;
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

  // ---- OWNER 2026-08-15: backup popover (header backup indicator) ----
  // The indicator (green "Cloud backed up" when linked, amber "Not backed
  // up" when not) opens a small glass card with the two backup routes:
  // Backup to cloud (linked projects save immediately; unlinked projects
  // route to the drawer's Cloud Backup section to link first) and Backup to
  // local (.json export). Closed by outside click / Escape / choosing an
  // option.

  // Background cloud auto-sync debounce (see the State.onChange wiring):
  // after CLOUD_AUTO_IDLE_MS of quiet, push the snapshot to the cloud for
  // linked projects. Works for ANY cloud credential (owner OR editor — the
  // Worker scopes an editor's merge server-side), so every edit in a linked
  // project eventually reaches the cloud without a manual Save. Never throws;
  // failures just wait for the next cycle.
  let _cloudAutoTimer = null;
  const CLOUD_AUTO_IDLE_MS = 25000;
  function cloudLinked() {
    const C = window.MMGR.Cloud;
    if (!C) return false;
    if (C.getCode && C.getCode()) return true;
    if (C.getECode && C.getECode()) return true;
    return false;
  }
  function scheduleCloudAutoSave() {
    if (!cloudLinked()) return; // not cloud-linked
    if (_cloudAutoTimer) clearTimeout(_cloudAutoTimer);
    _cloudAutoTimer = setTimeout(function() {
      _cloudAutoTimer = null;
      const C = window.MMGR.Cloud;
      if (C && C.autoSaveToCloud) { try { C.autoSaveToCloud(); } catch (e) { /* never throws */ } }
    }, CLOUD_AUTO_IDLE_MS);
  }

  // OWNER 2026-08-15: flush a pending cloud save when the tab is hidden or
  // closed so the final edits aren't lost — the auto-save uses keepalive so
  // it survives pagehide; large states defer to the idle debounce (already
  // fired in the common walk-away case).
  function flushCloudAutoSave() {
    if (!_cloudAutoTimer) return;
    clearTimeout(_cloudAutoTimer);
    _cloudAutoTimer = null;
    if (!cloudLinked()) return;
    const C = window.MMGR.Cloud;
    if (C && C.autoSaveToCloud) { try { C.autoSaveToCloud({ keepalive: true }); } catch (e) { /* never throws */ } }
  }
  window.addEventListener('pagehide', flushCloudAutoSave);

  function bkToggle() {
    const pop = U.$('bk-pop');
    const ind = U.$('dirty-ind');
    if (!pop) return;
    if (pop.hidden) {
      bkSyncHint();
      pop.hidden = false;
      if (ind) ind.setAttribute('aria-expanded', 'true');
    } else {
      pop.hidden = true;
      if (ind) ind.setAttribute('aria-expanded', 'false');
    }
  }
  function bkClose() {
    const pop = U.$('bk-pop');
    const ind = U.$('dirty-ind');
    if (pop && !pop.hidden) pop.hidden = true;
    if (ind) ind.setAttribute('aria-expanded', 'false');
  }
  function bkSyncHint() {
    const el = U.$('bk-cloud-hint');
    if (!el) return;
    const C = window.MMGR.Cloud;
    el.textContent = (C && C.getCode && C.getCode())
      ? 'Cloud-backed project — snapshots auto-sync to the cloud as you work.'
      : 'File backup is optional — save a .json copy whenever you\u2019re ready (e.g. at the end of a task). Link to the cloud once in Settings for automatic backups.';
  }
  function bkCloud() {
    const C = window.MMGR.Cloud;
    bkClose();
    if (C && C.getCode && C.getCode()) {
      if (C.saveToCloud) C.saveToCloud();
    } else {
      // Not linked yet — open the drawer at the Cloud Backup section so the
      // project can be linked (Create Cloud Project, then Save to Cloud).
      openDrwToSave();
    }
  }

  function openDrwToPrompts(type) {
    swDtab('prompt', null);
    openDrw();
  }

  function jumpToDashTimeline() {
    showSec('dash', document.querySelector('.sec-btn'));
  }

  // ---- Export Modal ----
  function openOM() {
    const modal = U.$('om');
    const txt = U.$('om-txt');
    if (!modal || !txt) return;
    txt.value = ns.State.exportState();
    modal.classList.add('open');
  }

  function closeOM() {
    const modal = U.$('om');
    if (modal) modal.classList.remove('open');
  }

  function cpOut() {
    const txt = U.$('om-txt');
    if (txt) { U.copyToClipboard(txt.value); showToast('Copied to clipboard!', 'ok'); }
  }

  function loadClip() {
    navigator.clipboard.readText().then(text => {
      if (text && ns.State.importState(text)) {
        R.renderAll();
        if (ns.Charter) ns.Charter.loadCharterData();
        if (ns.Sprint) ns.Sprint.loadSprintData();
        showToast('State loaded from clipboard!', 'ok');
      } else {
        showToast('Invalid state data in clipboard.', 'err');
      }
    }).catch(() => { showToast('Cannot read clipboard. Paste manually.', 'err'); });
  }

  // ---- File Import/Export ----
  function saveProjectFile() {
    const data = ns.State.exportState();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mmgr-project-' + ns.projectId + '-' + U.todayStr() + '.json';
    a.click();
    URL.revokeObjectURL(url);
    // Stamp the file-backup watermark (same timestamp as updatedAt) so the
    // header dirty indicator clears — it returns the moment the project is
    // edited again.
    ns.State.save(true, { backup: true });
    R.renderDirtyIndicator();
    showToast('Project backed up to file!', 'ok');
  }

  function loadProjectFile(ev) {
    const file = ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
      if (ns.State.importState(e.target.result)) {
        R.renderAll();
        if (ns.Charter) ns.Charter.loadCharterData();
        if (ns.Sprint) ns.Sprint.loadSprintData();
        showToast('Project loaded!', 'ok');
      } else {
        showToast('Invalid project file.', 'err');
      }
    };
    reader.readAsText(file);
    ev.target.value = '';
  }

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
      // Surface every two-way conflict by NAME — never silently resolved.
      // A conflict is a field present on BOTH sides; the newer stamp wins
      // and the loser is named in the toast so the user can verify it.
      const conflicts = out.report.filter(r => r.reason === 'newer-timestamp' || r.reason === 'local-equal-or-newer');
      // Cap the named list — a full project import can conflict on dozens of
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
      // single dismissible optional-identity suggestion — if not signed in
      // and not already dismissed on this device. Never a modal, never spam.
      if (ns.Sync && ns.Sync.noteMultiDeviceUse) ns.Sync.noteMultiDeviceUse();
      showToast(summary, out.adopted > 0 ? 'ok' : 'warn');
    };
    reader.readAsText(file);
    ev.target.value = '';
  }

  function saveBaseline() {
    ns.State.saveBaseline();
    showToast('Baseline saved!', 'ok');
  }

  // ---- Init ----
  // Explicit module-readiness gate. init() must not run until every module
  // the app depends on is present, otherwise a module that fails to load (or
  // a future reorder of the <script> tags) produces a silent, partial boot.
  // We poll every 50ms — which covers deferred scripts and slow network — and
  // after ~5s give up LOUDLY with the missing module names instead of initing
  // against an incomplete namespace.
  //
  // NOTE: Utils and Render are captured at parse time (const U / const R
  // above), so those two scripts must still load BEFORE app.js — the gate
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
          const msg = 'My MaNaGeR boot ABORTED — missing modules: ' + missing.join(', ') + '. Check the <script> load order in project.html.';
          console.error(msg);
          // Fail visibly for end users too — a silent blank page tells them
          // nothing about why nothing rendered.
          const sp = document.getElementById('boot-splash');
          if (sp) sp.classList.add('off');
          const el = document.createElement('div');
          el.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#1a1a1a;color:#ff6b6b;font:14px/1.5 monospace;padding:40px;text-align:center;z-index:99999';
          el.textContent = 'App failed to start — missing modules: ' + missing.join(', ') + '. Check the <script> load order.';
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
    // click-to-filter (view-only — filtering the list, not mutating state).
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
    // generator (view-only — composes + copies, never mutates state).
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
    // Rank 2.3: real model wiring — run preset / run question / settings.
    'aiRunPreset': (el) => window.MMGR.AiWin.runPreset(el.getAttribute('data-type')),
    'aiRun': () => window.MMGR.AiWin.runQuestion(),
    'aiCopyOut': () => window.MMGR.AiWin.copyOut(),
    'aiSetTier': (el) => { window.MMGR.AiWin.setAiCfg({ tier: el.value }); window.MMGR.AiWin.syncSettingsUI(); },
    // MERGED-AI-CONTROL (audit 1.2): the drawer's AI Assistant switch is now
    // the single AI on/off control — it reads/writes state.config.ai.tier
    // directly (flags.aiWindow is dropped as a gate). OFF -> tier 'off'; ON
    // -> restore the last non-off tier (default 'local').
    'tglAiTier': (el) => window.MMGR.AiWin.tglDrawerTier(el),
    // AI-CLOUD-CONNECT-UI (DIR-2): no aiSetKey action — and no aiSetProvider /
    // aiSetEndpoint / aiSetModel actions either. The BYO provider select is
    // read directly by the Connect & Test flow, and the key is wired
    // directly in mmgr-ai.js (session vault only); setAiCfg drops apiKey
    // patches anyway — a key can never be persisted into project state.
    // Rank 3.4: viewport prompt answers write a device-level preference only
    // (localStorage, never project state) — safe in view-only. toggleFull is
    // a pure DOM class toggle.
    'vpAccept': (el) => window.MMGR.Viewport.accept(el.getAttribute('data-section')),
    'vpDismiss': (el) => window.MMGR.Viewport.dismiss(el.getAttribute('data-section')),
    'vpFull': (el) => window.MMGR.Viewport.toggleFull(el.getAttribute('data-section')),
    // Rank 3.5 (PLAN-OF-ACTION-LIQUID-GLASS-UI): premium visual mode toggle —
    // writes a device-level preference only (localStorage, never project
    // state), so it is safe in view-only, exactly like the viewport prefs.
    'tglGlassMode': () => window.MMGR.App.tglGlassMode(),
    // THEME-SYSTEM-AND-MOBILE-UI-ACTION-PLAN §4.2: mobile nav drawer toggle.
    'tglNav': () => window.MMGR.App.tglNav(),
    'tglSidebar': () => window.MMGR.App.tglSidebar(),
    'tglSidebarOpen': () => window.MMGR.App.tglSidebarOpen(),
    // Rank 4.5 (PLAN-OF-ACTION-AI-VOICE-SYNC-v1): optional Google identity
    // for sync — device-level label only, never a gate, safe in view-only.
    'syncConnect': () => window.MMGR.App.syncConnect(),
    'syncSignOut': () => window.MMGR.App.syncSignOut(),
    'syncClientId': (el) => window.MMGR.App.syncClientId(el),
    'syncDismissSuggest': () => window.MMGR.App.syncDismissSuggest(),
    // GOOGLE-DRIVE-BACKUP: optional Drive backup/restore controls in the
    // Controls drawer (project.html). Backup is export-equivalent (reads the
    // workspace, writes Drive + a device pref), restore is import-equivalent
    // (confirm-gated, overwrites local workspace), and the auto-interval is a
    // device pref — all user-initiated, never gating. GoogleAuth is optional,
    // so every handler guards before touching it (zero-throw module).
    'driveBackup': () => { const G = window.MMGR.GoogleAuth; if (G && G.triggerBackup) G.triggerBackup(); },
    'driveRestore': () => { const G = window.MMGR.GoogleAuth; if (G && G.triggerRestore) G.triggerRestore(); },
    'driveAutoInterval': (el) => { const G = window.MMGR.GoogleAuth; if (G && G.setAutoIntervalFrom) G.setAutoIntervalFrom(el); },
    'driveSetPass': (el) => { const G = window.MMGR.GoogleAuth; if (G && G.setDrivePassFrom) G.setDrivePassFrom(el); },
    // CLOUD-BACKEND-ARCHITECTURE-PLAN Phase 1: optional Cloud Backup section
    // (owner-code create/save/load/recover + Google sign-in for recovery).
    // Same zero-throw pattern as the Drive entries above.
    'cloudCreate': () => { const C = window.MMGR.Cloud; if (C && C.createProject) C.createProject(); },
    'cloudUpgrade': () => { const C = window.MMGR.Cloud; if (C && C.cloudUpgrade) C.cloudUpgrade(); },
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
    'cloudSignIn': () => { const C = window.MMGR.Cloud; if (C && C.signIn) C.signIn(); },
    'cloudLoadWithCode': () => { const C = window.MMGR.Cloud; if (C && C.loadWithCode) C.loadWithCode(); },
    // CLOUD-BACKEND-ARCHITECTURE-PLAN Phase 2/3: editor-code management
    // (create/list/revoke — owner-only, enforced server-side) and the
    // changelog view/revert (owner-only). Same zero-throw pattern as the
    // Phase 1 entries above.
    'cloudEditorCreate': () => { const C = window.MMGR.Cloud; if (C && C.createEditor) C.createEditor(); },
    'cloudEditorList': () => { const C = window.MMGR.Cloud; if (C && C.listEditors) C.listEditors(); },
    'cloudEditorRevoke': (el) => { const C = window.MMGR.Cloud; if (C && C.revokeEditor) C.revokeEditor(el && el.getAttribute('data-id')); },
    'cloudLogList': () => { const C = window.MMGR.Cloud; if (C && C.listLog) C.listLog(); },
    'cloudLogRevert': (el) => { const C = window.MMGR.Cloud; if (C && C.revertLog) C.revertLog(el && el.getAttribute('data-id')); },
    'cloudLogToggleDiffs': (el) => { const C = window.MMGR.Cloud; if (C && C.toggleDiffs) C.toggleDiffs(el && el.getAttribute('data-id')); },
    'cloudDropEditor': () => { const C = window.MMGR.Cloud; if (C && C.dropEditor) C.dropEditor(); },
    'cascadeGantt': () => window.MMGR.App.cascadeGantt(),
    'toggleCritical': (el) => window.MMGR.App.toggleCritical(el),
    'tglLeadtimeLane': (el) => window.MMGR.App.tglLeadtimeLane(el),
    'populateSprint': () => window.MMGR.App.populateSprint(),
    'openPrompt': (el) => window.MMGR.App.openPrompt(el.getAttribute('data-type')),
    'openDrwToSave': () => window.MMGR.App.openDrwToSave(),
    'openDrwToPrompts': (el) => window.MMGR.App.openDrwToPrompts(el.getAttribute('data-type')),
    'bkToggle': () => window.MMGR.App.bkToggle(),
    'bkCloud': () => window.MMGR.App.bkCloud(),
    'saveProjectFile': () => window.MMGR.App.saveProjectFile(),
    'saveBaseline': () => window.MMGR.App.saveBaseline(),
    'restoreBaseline': () => window.MMGR.App.restoreBaseline(),
    'undo': () => window.MMGR.App.undo(),
    'redo': () => window.MMGR.App.redo(),
    'setRegion': (el) => window.MMGR.App.setRegion(el.value),
    'cfmOk': () => window.MMGR.App.cfmOk(),
    'cfmCancel': () => window.MMGR.App.cfmCancel(),
    'keepMine': () => window.MMGR.App.keepMine(),
    'keepTheirs': () => window.MMGR.App.keepTheirs(),
    'openOM': () => window.MMGR.App.openOM(),
    'closeOM': () => window.MMGR.App.closeOM(),
    'cpOut': () => window.MMGR.App.cpOut(),
    'loadClip': () => window.MMGR.App.loadClip(),
    'openDrw': () => window.MMGR.App.openDrw(),
    'closeDrw': () => window.MMGR.App.closeDrw(),
    // DIR-3: Core-Mode onboarding callout — jump to the pack toggles / dismiss.
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
    // MASTER-ACTION-PLAN Rank 6.1 — sanitized report package (read-only).
    'reportIssueCopy': () => window.MMGR.App.reportIssueCopy(),
    'reportIssueDownload': () => window.MMGR.App.reportIssueDownload(),
    'tglReportContext': () => window.MMGR.App.tglReportContext(),
    'setErrWebhook': (el) => window.MMGR.App.setErrWebhook(el),
    // Rank 3.1: Core Mode vs Advanced Packs — toggling a pack mutates
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
    // NOT by click — a plain click must never start the hold countdown.
    // Drag and drop (Kanban)
    'dragDrop': (el) => {
      // Handled by special drag/drop event listeners
    },
    // Hold-to-clear runs on pointerdown delegation (never click), so the
    // click path is an explicit no-op — enforced by the headless audit.
    'startHold': () => {}, // pointerdown-only
    // Jump to timeline
    'jumpToDashTimeline': () => window.MMGR.App.jumpToDashTimeline(),
    // Generic field update for dynamic render templates (WBS, risks, etc.)
    // evtType ('input' vs 'change') is forwarded so table-rendering updaters
    // can save on keystroke but defer the re-render to blur/commit — a
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
    'tglPromise': (el) => window.MMGR.Meetings.tglPromise(el.getAttribute('data-kind'), parseInt(el.getAttribute('data-idx'))),
    // Rank 1.5: meeting voice capture (mutates state — NOT in READONLY_SAFE_ACTIONS)
    'voiceStartCapture': () => window.MMGR.Voice.startCapture(),
    'voiceStopCapture': () => window.MMGR.Voice.stopCapture(),
    'voiceDiscardCapture': () => window.MMGR.Voice.discardCapture(false),
    // Tier 1: manual offline whisper transcription / retry (mutates state — blocked in view-only)
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
        // CloseItems' updater takes (index, done) — no field parameter.
        'CloseItems':   { ns: 'Closure', fn: 'updCloseItem', doneOnly: true },
        'Comms':        { ns: 'Comms', fn: 'updComms' },
        'Documents':    { ns: 'Documents', fn: 'updDoc' }
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

  // ACTION-PLAN 4.1: read-only gate — the ONLY actions allowed in a
  // view-only scope are non-mutating ones (navigation, copy, print, drawer
  // views, report generation). Everything else is refused with a toast.
  const READONLY_SAFE_ACTIONS = {
    'showSec': 1, 'cpAllPage': 1, 'print': 1, 'openDrw': 1, 'closeDrw': 1,
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
    // wxLogManual write the LD-claim weather log — all stay blocked in
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
    // — all correctly stay BLOCKED in view-only mode.
    'openAiWin': 1, 'closeAiWin': 1, 'closeAiWinBg': 1, 'aiPreset': 1,
    'aiAttachContext': 1, 'aiCopy': 1, 'aiClear': 1, 'aiCopyOut': 1,
    // Rank 1.5: dismissRecovery only hides a local chip (module flag + DOM)
    // — non-mutating, safe in view-only mode. The three capture actions
    // (voiceStartCapture/voiceStopCapture/voiceDiscardCapture) DO mutate
    // state and correctly stay blocked.
    'voiceRecoverDismiss': 1,
    // Rank 3.4: viewport preference is a device-level screen choice, not
    // project state — allowed in view-only (like theme is a preference, but
    // this one intentionally stays out of project state entirely).
    'vpAccept': 1, 'vpDismiss': 1, 'vpFull': 1,
    // Rank 3.5: glass preference is a device-level screen choice, not
    // project state — allowed in view-only like the viewport prefs.
    'tglGlassMode': 1,
    // Theme-persistence: the theme preference is a device-level choice too
    // (localStorage mmgr_theme, the same slot the launcher + admin read) —
    // allowed in view-only like glass mode. tglTheme writes only the device
    // pref + body class in view-only; the per-project state write is skipped.
    'tglTheme': 1,
    // THEME-SYSTEM-AND-MOBILE-UI-ACTION-PLAN §4.2: the mobile nav drawer is
    // pure device-UI chrome (body.nav-open class only) — never project state.
    // SIDEBAR-HAMBURGER-TOGGLE-PLAN: the sidebar toggle is the same kind of
    // pure device-UI chrome (body.sidebar-on + localStorage pref).
    'tglNav': 1, 'tglSidebar': 1, 'tglSidebarOpen': 1, 'bkToggle': 1, 'bkCloud': 1,
    // DIR-1a/1b: copying/downloading the error log is read-only; the
    // remote-reporting toggle + webhook URL are device-level preferences
    // (localStorage, like the glass mode toggle) — never project state.
    'copyErrorLog': 1, 'downloadErrorLog': 1, 'tglErrReport': 1, 'setErrWebhook': 1,
    // MASTER-ACTION-PLAN Rank 6.1: building/copying/downloading the report
    // is read-only; the context toggle is a session-only UI pref.
    'reportIssueCopy': 1, 'reportIssueDownload': 1, 'tglReportContext': 1,
    // Rank 4.5: Google identity is a device-level label, never a gate to
    // project data — signing in/out/dismissing never mutates project state.
    'syncConnect': 1, 'syncSignOut': 1, 'syncClientId': 1, 'syncDismissSuggest': 1,
    // GOOGLE-DRIVE-BACKUP: backup is export-equivalent (reads the workspace,
    // writes Drive + a device pref) and the auto-interval + backup passphrase
    // are device-level preferences (localStorage / sessionStorage, never
    // project state) — safe in view-only, like claimGenerate / digestGenerate
    // / runMonteCarlo above. Restore is DELIBERATELY excluded: it overwrites
    // local workspace, exactly like import, so it stays blocked in view-only.
    'driveBackup': 1, 'driveAutoInterval': 1, 'driveSetPass': 1,
    // CLOUD-BACKEND-ARCHITECTURE-PLAN Phase 1: cloud create/save/recover/
    // copy/sign-in never mutate the local workspace (they push to the server
    // or manage session-only credentials) — safe in view-only, exactly like
    // driveBackup above. Load is DELIBERATELY excluded: it overwrites the
    // local workspace like driveRestore/import, so it stays blocked in
    // view-only.
    'cloudCreate': 1, 'cloudUpgrade': 1, 'cloudSave': 1, 'cloudRecover': 1, 'cloudCopyCode': 1, 'cloudSignIn': 1,
    // CLOUD-BACKEND-ARCHITECTURE-PLAN Phase 2/3: editor-code management and
    // changelog view/revert never mutate the local workspace (owner-only
    // server calls; a revert changes the CLOUD snapshot, not this device) —
    // safe in view-only, like the Phase 1 cloud entries above.
    'cloudEditorCreate': 1, 'cloudEditorList': 1, 'cloudEditorRevoke': 1,
    'cloudLogList': 1, 'cloudLogRevert': 1, 'cloudLogToggleDiffs': 1, 'cloudDropEditor': 1,
    // GAP-AUDIT-CLOUD-31: unlink only mutates the CLOUD copy (like the other
    // cloud actions above), and the banner Copy/Done are clipboard/session
    // only — all safe in view-only.
    'cloudUnlink': 1, 'cloudCopyEditorCode': 1, 'cloudEditorCodeDone': 1,
    // MASTER-ACTION-PLAN RANK 9.2: webhook CRUD only mutates the SERVER
    // subscription table (like the other cloud actions) — safe in view-only.
    'cloudWebhookList': 1, 'cloudWebhookAdd': 1, 'cloudWebhookDel': 1
  };
  function guardReadonly(action) {
    // The ACTION_MAP delegation IIFE has no closure over the App module's
    // isReadonly() — route through the published API (MMGR.App.isReadonly).
    const ro = window.MMGR.App && typeof window.MMGR.App.isReadonly === 'function' && window.MMGR.App.isReadonly();
    if (!ro) return true;
    if (READONLY_SAFE_ACTIONS[action]) return true;
    if (window.MMGR.App && typeof window.MMGR.App.showToast === 'function') {
      window.MMGR.App.showToast('View-only mode — read-only access. Contact the admin for full access.', 'err');
    }
    return false;
  }

  // Click event delegation
  document.addEventListener('click', function(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    // P0 ("the dates are fighting me" — real-click path): editable field
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
      // before this handler runs, so revert it — otherwise the switch would
      // visually toggle while the state it controls stays unchanged (audit
      // 1.2 / 1.3 — the AI master switch, tglPack, tglFlag all behave this way).
      if (el.tagName === 'INPUT' && el.type === 'checkbox') el.checked = !el.checked;
      return;
    }
    const handler = ACTION_MAP[action];
    if (handler) {
      if (el.tagName === 'INPUT' && el.type === 'checkbox') {
        // CRITICAL (browser-verified): Chrome toggles checkbox `checked` when
        // the click event is DISPATCHED — i.e. BEFORE this listener runs — and
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
    // field (Google OAuth Client ID) — it was missing from this change
    // whitelist, so the value sat in the box but was never persisted.
    // `change` is the correct event for a one-time paste/type-then-blur field.
    if (handler && (action === 'updEnvelope' || action === 'saveSprint' || action === 'setWorkWeek' || action === 'setRegion' || action === 'loadProjectFile' || action === 'mergeProjectFile' || action === 'updCharter' || action === 'updClose' || action === 'setUserName' || action === 'addRaciTaskFromPicker' || action === 'addRaciPersonFromPicker' || action === 'updField' || action === 'updTaskField' || action === 'updKPI' || action === 'updKPILink' || action === 'updKPIDir' || action === 'updSpendEntry' || action === 'updRaciTask' || action === 'updRaciPerson' || action === 'claimSetCause' || action === 'aiSetTier' || action === 'setErrWebhook' || action === 'driveAutoInterval' || action === 'driveSetPass' || action === 'syncClientId')) {
      handler(el, e);
    }
  });

  // Rank 3.1: tglPack chips are checkboxes — the click delegation handles
  // them (checkbox click IS the action), and the action map entry above flips
  // state.packs. No change/input whitelist entry needed.

  // Input event delegation for textarea/input elements
  document.addEventListener('input', function(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.getAttribute('data-action');
    if (!guardReadonly(action)) return;
    const handler = ACTION_MAP[action];
    if (handler && (action === 'updCharter' || action === 'updClose' || action === 'setUserName' || action === 'updEnvelope' || action === 'wiPreview' || action === 'idPreview' || action === 'regenChartPrompt' || action === 'updField' || action === 'updTaskField' || action === 'updKPI' || action === 'updSpendEntry' || action === 'updRaciTask' || action === 'updRaciPerson' || action === 'updDMAIC' || action === 'updMeetItemNote' || action === 'updMeetField' || action === 'handleCharterUpload' || action === 'setErrWebhook')) {
      handler(el, e);
    }
  });

  // 5.2 Definitions tooltips: any element with data-def="<term>" shows the
  // glossary entry on hover. Delegated mouseover/out — zero inline handlers.
  document.addEventListener('mouseover', function(e) {
    const el = e.target.closest && e.target.closest('[data-def]');
    if (el) window.MMGR.App.showDefTip(el, el.getAttribute('data-def'));
  });
  document.addEventListener('mouseout', function(e) {
    const el = e.target.closest && e.target.closest('[data-def]');
    if (el) window.MMGR.App.hideDefTip();
  });

  // RACI right-click cycles backward (feature 5) — contextmenu must be
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
  // e.target can be the document node when synthetic/edge events fire —
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

  // MLC card hover — keep open
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

  // Release anywhere cancels — cancelHold is a no-op when nothing is held,
  // so no closest() gating is needed (and it covers releases over other
  // elements, re-rendered buttons, and pointer-capture edge cases).
  document.addEventListener('pointerup', () => window.MMGR.App.cancelHold());

  document.addEventListener('pointercancel', () => window.MMGR.App.cancelHold());

  document.addEventListener('mouseleave', function(e) {
    if (e.target.closest && e.target.closest('[data-action="startHold"]')) window.MMGR.App.cancelHold();
  }, true);

  window.addEventListener('blur', () => window.MMGR.App.cancelHold());
})();